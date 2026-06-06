import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  InMemoryBatchCheckpointStore,
  ProviderError,
  TokenBucket,
  createMockTranslationProvider,
  retryWithExponentialBackoff,
  translateWithPolicy
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
});
