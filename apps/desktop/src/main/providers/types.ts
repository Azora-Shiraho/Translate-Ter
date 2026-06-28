import type {
  AppSettingsPublic,
  JobSnapshot,
  ProviderHealth,
  SubtitleDocument
} from '@shared/models';
import type { TranslationProvider } from '@shared/translation/types';

export type AsrTranscribeRequest = {
  job: JobSnapshot;
  settings: AppSettingsPublic;
  audioPath?: string;
  isCancelled?: () => boolean;
  reportProgress?: (progress: number, message: string) => Promise<void>;
};

export type AsrProviderAdapter = {
  id: string;
  health(): Promise<ProviderHealth>;
  transcribe(request: AsrTranscribeRequest): Promise<SubtitleDocument>;
};

export type TranslationProviderFactory = {
  id: string;
  create(): TranslationProvider;
  health?(): Promise<ProviderHealth>;
};

export type AsrProviderRegistry = {
  get(id: string): AsrProviderAdapter | undefined;
  resolve(id: string): AsrProviderAdapter;
  has(id: string): boolean;
  health(id: string): Promise<ProviderHealth | undefined>;
  list(): AsrProviderAdapter[];
};

export type TranslationProviderRegistry = {
  get(id: string): TranslationProviderFactory | undefined;
  has(id: string): boolean;
  createProviders(): TranslationProvider[];
  health(id: string): Promise<ProviderHealth | undefined>;
  list(): TranslationProviderFactory[];
};

export class ProviderOperationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; retryable: boolean }) {
    super(message);
    this.name = 'ProviderOperationError';
    this.code = options.code;
    this.retryable = options.retryable;
  }
}
