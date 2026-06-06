import type { Segment, SubtitleDocument } from './types';

export type TranslationProviderKind = 'llm' | 'traditional' | 'mock';

export type ProviderConfig = {
  id: string;
  kind: TranslationProviderKind;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  priority: number;
  rpm: number;
  tokenBudgetPerMinute: number;
  maxSegmentsPerBatch: number;
  maxCharactersPerBatch: number;
  timeoutMs?: number;
};

export type TranslationRequest = {
  batchId: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone?: 'neutral' | 'formal' | 'casual';
  glossary?: Record<string, string>;
  segments: Pick<Segment, 'id' | 'sourceText'>[];
  signal?: AbortSignal;
};

export type TranslationResult = {
  providerId: string;
  modelId?: string;
  translations: Array<{
    id: string;
    translatedText: string;
    warnings?: string[];
  }>;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type TranslationProvider = {
  id: string;
  config: ProviderConfig;
  health(): Promise<{ ok: boolean; message?: string }>;
  translateBatch(request: TranslationRequest): Promise<TranslationResult>;
};

export type RetryPolicy = {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export type CircuitBreakerPolicy = {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
};

export type TranslationPolicy = {
  retry: RetryPolicy;
  circuitBreaker: CircuitBreakerPolicy;
};

export type BatchCheckpoint = {
  batchId: string;
  segmentIds: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  providerAttempts: Array<{
    providerId: string;
    attempt: number;
    startedAt: string;
    completedAt?: string;
    errorCode?: string;
    message?: string;
  }>;
  completedSegmentIds: string[];
};

export type BatchCheckpointStore = {
  load(batchId: string): Promise<BatchCheckpoint | undefined>;
  save(checkpoint: BatchCheckpoint): Promise<void>;
};

export class InMemoryBatchCheckpointStore implements BatchCheckpointStore {
  private readonly checkpoints = new Map<string, BatchCheckpoint>();

  async load(batchId: string): Promise<BatchCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(batchId);
    return checkpoint ? cloneCheckpoint(checkpoint) : undefined;
  }

  async save(checkpoint: BatchCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.batchId, cloneCheckpoint(checkpoint));
  }
}

export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { code: string; retryable: boolean; retryAfterMs?: number }) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    readonly capacity: number,
    private readonly refillPerMs: number,
    now: number = Date.now()
  ) {
    if (capacity <= 0 || refillPerMs <= 0) {
      throw new Error('TokenBucket capacity and refill rate must be positive.');
    }
    this.tokens = capacity;
    this.lastRefill = now;
  }

  available(now: number = Date.now()): number {
    this.refill(now);
    return this.tokens;
  }

  tryTake(count: number, now: number = Date.now()): boolean {
    if (count > this.capacity) return false;
    if (this.available(now) < count) return false;
    this.tokens -= count;
    return true;
  }

  async take(count: number, options: { signal?: AbortSignal; now?: () => number; sleep?: RetryPolicy['sleep'] } = {}): Promise<void> {
    if (count > this.capacity) {
      throw new Error(`Requested ${count} tokens but bucket capacity is ${this.capacity}.`);
    }

    const now = options.now ?? Date.now;
    const sleepFn = options.sleep ?? sleep;
    while (this.available(now()) < count) {
      const missing = count - this.tokens;
      const waitMs = Math.max(1, Math.ceil(missing / this.refillPerMs));
      await sleepFn(waitMs, options.signal);
    }
    this.tokens -= count;
  }

  private refill(now: number): void {
    if (now <= this.lastRefill) return;
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';
  private readonly policy: Required<CircuitBreakerPolicy>;

  constructor(policy: CircuitBreakerPolicy) {
    this.policy = {
      failureThreshold: policy.failureThreshold,
      cooldownMs: policy.cooldownMs,
      now: policy.now ?? Date.now
    };
  }

  canRequest(): boolean {
    if (this.state !== 'open') return true;
    if (this.policy.now() - this.openedAt >= this.policy.cooldownMs) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.policy.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.policy.now();
    }
  }

  snapshot(): { state: CircuitState; failures: number; openedAt?: number } {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.state === 'open' ? this.openedAt : undefined
    };
  }
}

export async function retryWithExponentialBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal
): Promise<T> {
  const sleepFn = policy.sleep ?? sleep;
  for (let attempt = 1; attempt <= policy.maxRetries + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable = error instanceof ProviderError ? error.retryable : true;
      if (!retryable || attempt > policy.maxRetries) {
        throw error;
      }
      const providerDelay = error instanceof ProviderError ? error.retryAfterMs : undefined;
      const delayMs = providerDelay ?? computeBackoffMs(attempt - 1, policy);
      await sleepFn(delayMs, signal);
    }
  }
  throw new Error('Retry loop exited unexpectedly.');
}

export function computeBackoffMs(
  attemptZeroBased: number,
  policy: Pick<RetryPolicy, 'initialBackoffMs' | 'maxBackoffMs' | 'jitterRatio' | 'random'>
): number {
  const base = Math.min(policy.maxBackoffMs, policy.initialBackoffMs * 2 ** attemptZeroBased);
  const jitter = base * policy.jitterRatio;
  const random = policy.random ?? Math.random;
  return Math.round(base - jitter + random() * jitter * 2);
}

export async function translateWithPolicy(
  provider: TranslationProvider,
  request: TranslationRequest,
  options: {
    rateLimiter: TokenBucket;
    circuitBreaker: CircuitBreaker;
    policy: RetryPolicy;
    checkpointStore?: BatchCheckpointStore;
  }
): Promise<TranslationResult> {
  if (!options.circuitBreaker.canRequest()) {
    throw new ProviderError(`Provider circuit is open: ${provider.id}`, {
      code: 'CircuitOpen',
      retryable: false
    });
  }

  const checkpoint = createBatchCheckpoint(request.batchId, request.segments.map((segment) => segment.id));
  checkpoint.status = 'running';
  await options.checkpointStore?.save(checkpoint);

  const estimatedTokens = estimateRequestTokens(request);
  try {
    await options.rateLimiter.take(1, { signal: request.signal, sleep: options.policy.sleep });
    await options.rateLimiter.take(estimatedTokens, { signal: request.signal, sleep: options.policy.sleep });

    const result = await retryWithExponentialBackoff(async (attempt) => {
      const startedAt = new Date().toISOString();
      try {
        const translated = await provider.translateBatch(request);
        checkpoint.providerAttempts.push({
          providerId: provider.id,
          attempt,
          startedAt,
          completedAt: new Date().toISOString()
        });
        return translated;
      } catch (error) {
        checkpoint.providerAttempts.push({
          providerId: provider.id,
          attempt,
          startedAt,
          completedAt: new Date().toISOString(),
          errorCode: error instanceof ProviderError ? error.code : 'ProviderError',
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        await options.checkpointStore?.save(checkpoint);
      }
    }, options.policy, request.signal);

    checkpoint.status = 'completed';
    checkpoint.completedSegmentIds = result.translations.map((translation) => translation.id);
    await options.checkpointStore?.save(checkpoint);
    options.circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    checkpoint.status = 'failed';
    await options.checkpointStore?.save(checkpoint);
    options.circuitBreaker.recordFailure();
    throw error;
  }
}

export function applyTranslations(document: SubtitleDocument, result: TranslationResult): SubtitleDocument {
  const translations = new Map(result.translations.map((item) => [item.id, item.translatedText]));
  return {
    ...document,
    metadata: {
      ...document.metadata,
      translationProvider: result.providerId
    },
    segments: document.segments.map((segment) => {
      const translatedText = translations.get(segment.id);
      return translatedText
        ? { ...segment, translatedText, status: 'translated' }
        : segment;
    })
  };
}

export function createBatchCheckpoint(batchId: string, segmentIds: string[]): BatchCheckpoint {
  return {
    batchId,
    segmentIds,
    status: 'queued',
    providerAttempts: [],
    completedSegmentIds: []
  };
}

export function createCircuitBreaker(policy: CircuitBreakerPolicy): CircuitBreaker {
  return new CircuitBreaker(policy);
}

export function createProviderBuckets(config: ProviderConfig, now: number = Date.now()): {
  requests: TokenBucket;
  tokens: TokenBucket;
} {
  return {
    requests: new TokenBucket(config.rpm, config.rpm / 60_000, now),
    tokens: new TokenBucket(config.tokenBudgetPerMinute, config.tokenBudgetPerMinute / 60_000, now)
  };
}

export function estimateRequestTokens(request: TranslationRequest): number {
  const textTokens = request.segments.reduce((sum, segment) => sum + estimateTextTokens(segment.sourceText), 0);
  return Math.max(1, textTokens + estimateTextTokens(request.sourceLanguage) + estimateTextTokens(request.targetLanguage));
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createMockTranslationProvider(options: {
  id?: string;
  failTimes?: number;
  failure?: ProviderError;
  translate?: (text: string, targetLanguage: string) => string;
} = {}): TranslationProvider {
  let remainingFailures = options.failTimes ?? 0;
  const id = options.id ?? 'mock.translation';

  return {
    id,
    config: {
      id,
      kind: 'mock',
      priority: 100,
      rpm: 60,
      tokenBudgetPerMinute: 60_000,
      maxSegmentsPerBatch: 20,
      maxCharactersPerBatch: 8_000
    },
    async health() {
      return { ok: true };
    },
    async translateBatch(request) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw (
          options.failure ??
          new ProviderError('Mock provider transient failure.', {
            code: 'MockTransientFailure',
            retryable: true
          })
        );
      }
      const translate = options.translate ?? ((text, targetLanguage) => `[${targetLanguage}] ${text}`);
      return {
        providerId: id,
        modelId: 'mock',
        translations: request.segments.map((segment) => ({
          id: segment.id,
          translatedText: translate(segment.sourceText, request.targetLanguage)
        }))
      };
    }
  };
}

function cloneCheckpoint(checkpoint: BatchCheckpoint): BatchCheckpoint {
  return {
    ...checkpoint,
    segmentIds: [...checkpoint.segmentIds],
    providerAttempts: checkpoint.providerAttempts.map((attempt) => ({ ...attempt })),
    completedSegmentIds: [...checkpoint.completedSegmentIds]
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}
