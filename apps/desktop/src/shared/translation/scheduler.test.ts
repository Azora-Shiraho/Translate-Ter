import { describe, expect, it } from 'vitest';
import { parseSrt } from '../srt';
import { CircuitBreaker } from './circuitBreaker';
import { TokenBucket } from './rateLimiter';
import { retryWithBackoff } from './retry';
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
});
