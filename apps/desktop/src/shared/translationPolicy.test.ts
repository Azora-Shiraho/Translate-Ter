import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  InMemoryBatchCheckpointStore,
  ProviderError,
  TokenBucket,
  createMockTranslationProvider,
  computeBackoffMs,
  createProviderBuckets,
  retryWithExponentialBackoff,
  translateWithPolicy,
  estimateRequestTokens
} from './translationPolicy';

describe('translation policy', () => {
  it('retries retryable provider failures with exponential backoff', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await retryWithExponentialBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new ProviderError('temporary', { code: 'Temporary', retryable: true });
        }
        return 'ok';
      },
      {
        maxRetries: 3,
        initialBackoffMs: 100,
        maxBackoffMs: 1000,
        jitterRatio: 0,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        }
      }
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('opens circuit after threshold and recovers after cooldown success', () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 500,
      now: () => now
    });

    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('closed');
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    expect(breaker.canRequest()).toBe(false);

    now += 500;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.snapshot().state).toBe('half-open');
    breaker.recordSuccess();
    expect(breaker.snapshot()).toMatchObject({ state: 'closed', failures: 0 });
  });

  it('computes multiple backoff strategies deterministically', () => {
    const base = {
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      jitterRatio: 0,
      random: () => 0.5
    };

    expect(computeBackoffMs(2, { ...base, backoffStrategy: 'exponential' })).toBe(400);
    expect(computeBackoffMs(2, { ...base, backoffStrategy: 'linear' })).toBe(300);
    expect(computeBackoffMs(2, { ...base, backoffStrategy: 'fixed' })).toBe(100);
  });

  it('records checkpoint attempts while translating through policy', async () => {
    const provider = createMockTranslationProvider({ failTimes: 1 });
    const checkpointStore = new InMemoryBatchCheckpointStore();

    const result = await translateWithPolicy(
      provider,
      {
        batchId: 'batch-1',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        segments: [{ id: 'seg-1', sourceText: 'Hello' }]
      },
      {
        rateLimiter: new TokenBucket(100, 100),
        circuitBreaker: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => 0 }),
        checkpointStore,
        policy: {
          maxRetries: 1,
          initialBackoffMs: 1,
          maxBackoffMs: 1,
          jitterRatio: 0,
          sleep: async () => {}
        }
      }
    );

    const checkpoint = await checkpointStore.load('batch-1');
    expect(result.translations[0].translatedText).toBe('[zh-CN] Hello');
    expect(checkpoint?.status).toBe('completed');
    expect(checkpoint?.providerAttempts).toHaveLength(2);
  });

  it('uses independent request and token buckets for policy translation', async () => {
    const provider = createMockTranslationProvider();
    const request = {
      batchId: 'batch-2',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'seg-1', sourceText: 'Hello world' }]
    };
    const requestBucket = new TokenBucket(1, 1);
    const tokenBucket = new TokenBucket(100, 100);

    await translateWithPolicy(provider, request, {
      rateLimiters: {
        requests: requestBucket,
        tokens: tokenBucket
      },
      circuitBreaker: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => 0 }),
      policy: {
        maxRetries: 0,
        initialBackoffMs: 1,
        maxBackoffMs: 1,
        jitterRatio: 0,
        sleep: async () => {}
      }
    });

    expect(requestBucket.available(0)).toBe(0);
    expect(tokenBucket.available(0)).toBe(100 - estimateRequestTokens(request));
  });

  it('creates provider request and token buckets from provider config', () => {
    const provider = createMockTranslationProvider();
    const buckets = createProviderBuckets(provider.config, 0);

    expect(buckets.requests.capacity).toBe(provider.config.rpm);
    expect(buckets.tokens.capacity).toBe(provider.config.tokenBudgetPerMinute);
  });
});
