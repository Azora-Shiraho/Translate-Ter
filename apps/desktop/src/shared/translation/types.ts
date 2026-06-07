import type { SubtitleDocument, SubtitleSegment } from '../models';

export type TranslationProviderKind = 'llm' | 'traditional' | 'mock';

export type ProviderCapabilities = {
  maxSegmentsPerBatch: number;
  maxCharactersPerBatch: number;
  supportsGlossary: boolean;
  supportsTone: boolean;
};

export type TranslationBatchRequest = {
  batchId: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: 'neutral' | 'formal' | 'casual';
  glossary?: Record<string, string>;
  segments: Pick<SubtitleSegment, 'id' | 'sourceText'>[];
  targetSegmentIds?: string[];
  signal?: AbortSignal;
};

export type TranslationBatchResult = {
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
  kind: TranslationProviderKind;
  priority: number;
  capabilities(): ProviderCapabilities;
  rateLimits?(): Partial<Pick<TranslationSchedulerOptions, 'rpm' | 'tokenBudgetPerMinute'>>;
  health(): Promise<{ ok: boolean; message?: string }>;
  translateBatch(request: TranslationBatchRequest): Promise<TranslationBatchResult>;
};

export type BackoffStrategy = 'exponential' | 'linear' | 'fixed';

export type TranslationSchedulerOptions = {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  backoffStrategy: BackoffStrategy;
  concurrency: number;
  rpm: number;
  tokenBudgetPerMinute: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
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
};

export type TranslationRunResult = {
  document: SubtitleDocument;
  checkpoints: BatchCheckpoint[];
};

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
