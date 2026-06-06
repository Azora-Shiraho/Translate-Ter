import type { SubtitleDocument } from '../models';
import { createSubtitleBatches } from './batcher';
import { CircuitBreaker } from './circuitBreaker';
import { estimateTextTokens, TokenBucket } from './rateLimiter';
import { retryWithBackoff } from './retry';
import type {
  BatchCheckpoint,
  ProviderCapabilities,
  TranslationProvider,
  TranslationRunResult,
  TranslationSchedulerOptions
} from './types';
import { ProviderError } from './types';

const DEFAULT_OPTIONS: TranslationSchedulerOptions = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30_000,
  jitterRatio: 0.2,
  backoffStrategy: 'exponential',
  concurrency: 2,
  rpm: 60,
  tokenBudgetPerMinute: 60_000,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 60_000
};

export class TranslationScheduler {
  private readonly options: TranslationSchedulerOptions;
  private readonly buckets = new Map<string, { requests: TokenBucket; tokens: TokenBucket }>();
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly providers: TranslationProvider[],
    options: Partial<TranslationSchedulerOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async translateDocument(
    document: SubtitleDocument,
    request: {
      sourceLanguage: string;
      targetLanguage: string;
      tone?: 'neutral' | 'formal' | 'casual';
      providerPriority?: string[];
      signal?: AbortSignal;
    }
  ): Promise<TranslationRunResult> {
    const orderedProviders = this.orderProviders(request.providerPriority);
    if (orderedProviders.length === 0) {
      throw new ProviderError('No translation providers are configured.', {
        code: 'NoProvider',
        retryable: false
      });
    }

    const batches = createSubtitleBatches(document, combineCapabilities(orderedProviders), {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      tone: request.tone ?? 'neutral',
      signal: request.signal
    });
    const checkpoints: BatchCheckpoint[] = batches.map((batch) => ({
      batchId: batch.batchId,
      segmentIds: batch.segments.map((segment) => segment.id),
      status: 'queued',
      providerAttempts: []
    }));
    const output: SubtitleDocument = structuredClone(document);

    await runPool(batches, this.options.concurrency, async (batch, batchIndex) => {
      const checkpoint = checkpoints[batchIndex];
      checkpoint.status = 'running';
      let lastError: unknown;

      for (const provider of orderedProviders) {
        const breaker = this.breakerFor(provider.id);
        if (!breaker.canRequest()) {
          checkpoint.providerAttempts.push({
            providerId: provider.id,
            attempt: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            errorCode: 'CircuitOpen',
            message: 'Provider circuit is open.'
          });
          lastError = new ProviderError(`Provider circuit is open: ${provider.id}`, {
            code: 'CircuitOpen',
            retryable: false
          });
          continue;
        }

        try {
          const result = await retryWithBackoff(
            async (attempt) => {
              const attemptRecord: BatchCheckpoint['providerAttempts'][number] = {
                providerId: provider.id,
                attempt,
                startedAt: new Date().toISOString()
              };
              checkpoint.providerAttempts.push(attemptRecord);

              try {
                await this.consumeLimits(provider, batch.segments.map((segment) => segment.sourceText).join('\n'), request.signal);
                const health = await provider.health();
                if (!health.ok) {
                  throw new ProviderError(health.message ?? 'Provider is unhealthy.', {
                    code: 'ProviderUnavailable',
                    retryable: true
                  });
                }
                const providerResult = await provider.translateBatch(batch);
                validateTranslationCoverage(
                  batch.segments.map((segment) => segment.id),
                  providerResult.translations.map((item) => item.id)
                );
                attemptRecord.completedAt = new Date().toISOString();
                return providerResult;
              } catch (error) {
                attemptRecord.completedAt = new Date().toISOString();
                attemptRecord.errorCode = error instanceof ProviderError ? error.code : 'Unknown';
                attemptRecord.message = error instanceof Error ? error.message : String(error);
                throw error;
              }
            },
            {
              maxRetries: this.options.maxRetries,
              initialBackoffMs: this.options.initialBackoffMs,
              maxBackoffMs: this.options.maxBackoffMs,
              jitterRatio: this.options.jitterRatio,
              backoffStrategy: this.options.backoffStrategy,
              signal: request.signal
            }
          );

          for (const translation of result.translations) {
            const segment = output.segments.find((item) => item.id === translation.id);
            if (segment) {
              segment.translatedText = translation.translatedText;
              segment.status = 'translated';
            }
          }
          output.metadata.translationProvider = result.providerId;
          checkpoint.status = 'completed';
          breaker.recordSuccess();
          return;
        } catch (error) {
          lastError = error;
          breaker.recordFailure();
        }
      }

      checkpoint.status = 'failed';
      for (const id of checkpoint.segmentIds) {
        const segment = output.segments.find((item) => item.id === id);
        if (segment) {
          segment.status = 'failed';
          segment.notes = [...(segment.notes ?? []), lastError instanceof Error ? lastError.message : 'Translation failed.'];
        }
      }
    });

    return { document: output, checkpoints };
  }

  private orderProviders(priority?: string[]): TranslationProvider[] {
    const providersById = new Map(this.providers.map((provider) => [provider.id, provider]));
    const explicit = (priority ?? [])
      .map((providerId) => providersById.get(providerId))
      .filter((provider): provider is TranslationProvider => Boolean(provider));
    const rest = this.providers
      .filter((provider) => !priority?.includes(provider.id))
      .sort((a, b) => a.priority - b.priority);
    return [...explicit, ...rest];
  }

  private async consumeLimits(provider: TranslationProvider, text: string, signal?: AbortSignal): Promise<void> {
    const bucket = this.bucketFor(provider);
    await bucket.requests.take(1, signal);
    await bucket.tokens.take(estimateTextTokens(text), signal);
  }

  private bucketFor(provider: TranslationProvider): { requests: TokenBucket; tokens: TokenBucket } {
    let bucket = this.buckets.get(provider.id);
    if (!bucket) {
      const limits = provider.rateLimits?.() ?? {};
      const rpm = limits.rpm ?? this.options.rpm;
      const tokenBudgetPerMinute = limits.tokenBudgetPerMinute ?? this.options.tokenBudgetPerMinute;
      bucket = {
        requests: new TokenBucket(rpm, rpm / 60_000),
        tokens: new TokenBucket(tokenBudgetPerMinute, tokenBudgetPerMinute / 60_000)
      };
      this.buckets.set(provider.id, bucket);
    }
    return bucket;
  }

  private breakerFor(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(this.options.circuitFailureThreshold, this.options.circuitCooldownMs);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }
}

function combineCapabilities(providers: TranslationProvider[]): ProviderCapabilities {
  const capabilities = providers.map((provider) => provider.capabilities());
  return {
    maxSegmentsPerBatch: Math.max(1, Math.min(...capabilities.map((item) => item.maxSegmentsPerBatch))),
    maxCharactersPerBatch: Math.max(1, Math.min(...capabilities.map((item) => item.maxCharactersPerBatch))),
    supportsGlossary: capabilities.every((item) => item.supportsGlossary),
    supportsTone: capabilities.every((item) => item.supportsTone)
  };
}

function validateTranslationCoverage(expectedIds: string[], actualIds: string[]): void {
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) {
    throw new ProviderError('Provider response changed segment alignment.', {
      code: 'SegmentAlignmentError',
      retryable: true
    });
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}
