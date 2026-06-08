import { describe, expect, it } from 'vitest';
import { parseSrt } from '../srt';
import { CircuitBreaker } from './circuitBreaker';
import { TokenBucket } from './rateLimiter';
import { computeBackoffMs, retryWithBackoff } from './retry';
import { TranslationScheduler } from './scheduler';
import { MockTranslationProvider } from './providers';
import type { TranslationBatchRequest, TranslationBatchResult, TranslationProvider } from './types';
import { ProviderError } from './types';

describe('translation resilience primitives', () => {
  it('retries retryable provider errors with backoff', async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new ProviderError('try again', { code: 'RateLimited', retryable: true });
        }
        return 'ok';
      },
      { maxRetries: 2, initialBackoffMs: 1, maxBackoffMs: 1, jitterRatio: 0 }
    );

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('opens and half-opens circuit breaker after cooldown', () => {
    let now = 1000;
    const breaker = new CircuitBreaker(2, 100, () => now);
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe('open');
    expect(breaker.canRequest()).toBe(false);
    now += 101;
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.snapshot().state).toBe('half-open');
  });

  it('tracks token bucket refill', async () => {
    let now = 0;
    const bucket = new TokenBucket(2, 1, now);
    expect(bucket.available(now)).toBe(2);
    expect(bucket.tryTake(2, now)).toBe(true);
    expect(bucket.available(now)).toBe(0);
    now = 1;
    expect(bucket.available(now)).toBe(1);
  });

  it('supports fixed and linear retry backoff strategies', () => {
    expect(
      computeBackoffMs(3, {
        initialBackoffMs: 100,
        maxBackoffMs: 1000,
        jitterRatio: 0,
        backoffStrategy: 'fixed'
      })
    ).toBe(100);
    expect(
      computeBackoffMs(3, {
        initialBackoffMs: 100,
        maxBackoffMs: 1000,
        jitterRatio: 0,
        backoffStrategy: 'linear'
      })
    ).toBe(400);
  });

  it('fails over to the next provider without changing segment times', async () => {
    const failingProvider: TranslationProvider = {
      id: 'failing.llm',
      kind: 'llm',
      priority: 1,
      capabilities: () => ({
        maxSegmentsPerBatch: 10,
        maxCharactersPerBatch: 1000,
        supportsGlossary: false,
        supportsTone: true
      }),
      health: async () => ({ ok: true }),
      translateBatch: async () => {
        throw new ProviderError('temporary outage', { code: 'ProviderUnavailable', retryable: false });
      }
    };
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    const scheduler = new TranslationScheduler([failingProvider, new MockTranslationProvider()], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0
    });

    const result = await scheduler.translateDocument(doc, {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      providerPriority: ['failing.llm', 'mock.local']
    });

    expect(result.document.segments[0].startMs).toBe(1000);
    expect(result.document.segments[0].translatedText).toBe('[zh-CN] Hello');
    expect(result.checkpoints[0].providerAttempts.map((attempt) => attempt.providerId)).toEqual([
      'failing.llm',
      'mock.local'
    ]);
  });

  it('uses explicit provider priority ahead of numeric priority', async () => {
    const calls: string[] = [];
    const first = createStaticProvider('first.llm', 1, calls);
    const preferred = createStaticProvider('preferred.llm', 99, calls);
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    const scheduler = new TranslationScheduler([first, preferred], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0
    });

    const result = await scheduler.translateDocument(doc, {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      providerPriority: ['preferred.llm']
    });

    expect(calls).toEqual(['preferred.llm']);
    expect(result.document.segments[0].translatedText).toBe('[preferred.llm] Hello');
  });

  it('keeps batches small enough for fallback providers', async () => {
    const largeFailingProvider: TranslationProvider = {
      ...createStaticProvider('large.llm', 1),
      capabilities: () => ({
        maxSegmentsPerBatch: 10,
        maxCharactersPerBatch: 1000,
        supportsGlossary: true,
        supportsTone: true
      }),
      translateBatch: async () => {
        throw new ProviderError('down', { code: 'ProviderUnavailable', retryable: false });
      }
    };
    const smallFallback = createStaticProvider('small.llm', 2, [], {
      maxSegmentsPerBatch: 1
    });
    const doc = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n'
    );
    const scheduler = new TranslationScheduler([largeFailingProvider, smallFallback], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0,
      concurrency: 2
    });

    const result = await scheduler.translateDocument(doc, {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });

    expect(result.checkpoints).toHaveLength(2);
    expect(result.document.segments.map((segment) => segment.translatedText)).toEqual([
      '[small.llm] Hello',
      '[small.llm] World'
    ]);
  });

  it('runs batches concurrently while preserving segment updates by id', async () => {
    let active = 0;
    let maxActive = 0;
    const concurrentProvider = createStaticProvider('concurrent.llm', 1, [], {
      maxSegmentsPerBatch: 1,
      translateBatch: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return translateAsProvider('concurrent.llm', request);
      }
    });
    const doc = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n\n3\n00:00:05,000 --> 00:00:06,000\nThree\n'
    );
    const scheduler = new TranslationScheduler([concurrentProvider], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0,
      concurrency: 2
    });

    const result = await scheduler.translateDocument(doc, {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });

    expect(maxActive).toBe(2);
    expect(result.document.segments.map((segment) => segment.translatedText)).toEqual([
      '[concurrent.llm] One',
      '[concurrent.llm] Two',
      '[concurrent.llm] Three'
    ]);
  });

  it('skips providers while their circuit is open', async () => {
    const failingProvider = createStaticProvider('flaky.llm', 1, [], {
      translateBatch: async () => {
        throw new ProviderError('down', { code: 'ProviderUnavailable', retryable: false });
      }
    });
    const fallback = createStaticProvider('fallback.llm', 2);
    const scheduler = new TranslationScheduler([failingProvider, fallback], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 60_000
    });

    await scheduler.translateDocument(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nFirst\n'), {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });
    const second = await scheduler.translateDocument(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nSecond\n'), {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });

    expect(second.checkpoints[0].providerAttempts[0]).toMatchObject({
      providerId: 'flaky.llm',
      attempt: 0,
      errorCode: 'CircuitOpen'
    });
    expect(second.document.segments[0].translatedText).toBe('[fallback.llm] Second');
  });

  it('honors provider-specific token budget before falling back', async () => {
    const limitedProvider = createStaticProvider('limited.llm', 1, [], {
      rateLimits: () => ({ tokenBudgetPerMinute: 1 })
    });
    const fallback = createStaticProvider('fallback.llm', 2);
    const scheduler = new TranslationScheduler([limitedProvider, fallback], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0,
      tokenBudgetPerMinute: 1000
    });

    const result = await scheduler.translateDocument(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nLong enough\n'), {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });

    expect(result.checkpoints[0].providerAttempts[0]).toMatchObject({
      providerId: 'limited.llm',
      errorCode: 'Unknown'
    });
    expect(result.document.segments[0].translatedText).toBe('[fallback.llm] Long enough');
  });

  it('keeps original text and marks warnings when all providers fail', async () => {
    const failingProvider = createStaticProvider('down.llm', 1, [], {
      translateBatch: async () => {
        throw new ProviderError('gateway timeout', { code: 'ProviderUnavailable', retryable: true });
      }
    });
    const scheduler = new TranslationScheduler([failingProvider], {
      maxRetries: 0,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      jitterRatio: 0
    });

    const result = await scheduler.translateDocument(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nOriginal line\n'), {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN'
    });

    expect(result.checkpoints[0].status).toBe('failed');
    expect(result.document.segments[0]).toMatchObject({
      translatedText: 'Original line',
      status: 'warning'
    });
    expect(result.document.segments[0].notes).toContain('gateway timeout');
  });
});

function createStaticProvider(
  id: string,
  priority: number,
  calls: string[] = [],
  overrides: {
    maxSegmentsPerBatch?: number;
    translateBatch?: (request: TranslationBatchRequest) => Promise<TranslationBatchResult>;
    rateLimits?: TranslationProvider['rateLimits'];
  } = {}
): TranslationProvider {
  return {
    id,
    kind: 'llm',
    priority,
    capabilities: () => ({
      maxSegmentsPerBatch: overrides.maxSegmentsPerBatch ?? 10,
      maxCharactersPerBatch: 1000,
      supportsGlossary: true,
      supportsTone: true
    }),
    rateLimits: overrides.rateLimits,
    health: async () => ({ ok: true }),
    translateBatch: overrides.translateBatch ?? (async (request) => {
      calls.push(id);
      return translateAsProvider(id, request);
    })
  };
}

function translateAsProvider(providerId: string, request: TranslationBatchRequest): TranslationBatchResult {
  return {
    providerId,
    translations: request.segments.map((segment) => ({
      id: segment.id,
      translatedText: `[${providerId}] ${segment.sourceText}`
    }))
  };
}
