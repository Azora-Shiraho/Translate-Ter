export type SubtitleStatus =
  | 'new'
  | 'transcribed'
  | 'translated'
  | 'edited'
  | 'warning'
  | 'failed';

export type SubtitleWarning = {
  id?: string;
  code: string;
  message: string;
  segmentId?: string;
  stage?: 'asr' | 'translate' | 'export' | 'subtitle';
  createdAt?: string;
  providerId?: string;
  batchId?: string;
  startIndex?: number;
  endIndex?: number;
  startMs?: number;
  endMs?: number;
};

export type SubtitleSegment = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText?: string;
  speaker?: string;
  confidence?: number;
  status: SubtitleStatus;
  notes?: string[];
};

export type SubtitleDocument = {
  id: string;
  format: 'srt';
  sourceLanguage: string;
  targetLanguage?: string;
  segments: SubtitleSegment[];
  metadata: {
    inputMediaPath?: string;
    createdAt: string;
    asrProvider?: string;
    translationProvider?: string;
    warnings: SubtitleWarning[];
  };
};

export type WorkflowStep = 'import' | 'asr' | 'subtitles' | 'translate' | 'export';
export type ExportDestinationMode = 'source-directory' | 'selected-directory' | 'ask-each-time';
export type ExportVariant = 'source' | 'translated' | 'bilingual';
export type BilingualOrder = 'source-first' | 'target-first';

export type AppSettingsPublic = {
  schemaVersion: 1;
  uiLanguage: 'en-US' | 'zh-CN';
  theme: 'dark' | 'light' | 'system';
  sourceLanguage: string;
  targetLanguage: string;
  asrProviderId: string;
  whisperModelId: string;
  localWhisperUseCuda: boolean;
  allowWhisperAssetDownload: boolean;
  enableMultiThreadDownload: boolean;
  allowCloudAsrUpload: boolean;
  translationProviderPriority: string[];
  translationConcurrency: number;
  translationRequestsPerMinute: number;
  translationTokenBudgetPerMinute: number;
  translationLinesPerRequest: number;
  translationBatchStride: number;
  exportDestinationMode: ExportDestinationMode;
  exportDirectory: string;
  exportBilingualOrder: BilingualOrder;
};

export type AppSettingsPatch = Partial<AppSettingsPublic>;

export type ProviderHealth = {
  providerId: string;
  ok: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'unavailable';
  message?: string;
};

export type ProviderSecretInput = {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  model?: string;
};

export type WhisperModelInfo = {
  id: string;
  displayName: string;
  languageScope: 'multilingual' | 'english-only';
  sizeBytes: number;
  installed: boolean;
  sha256: string;
};

export type WhisperRuntimeRequest = {
  modelId: string;
  allowDownload: boolean;
  preferCuda: boolean;
  useMultiThreadDownload?: boolean;
  downloadScope?: 'all' | 'runtime' | 'cuda-runtime' | 'model' | 'none';
};

export type WhisperRuntimeStatus = {
  provider: 'whisper.cpp';
  platformKey: string;
  cacheDir: string;
  binary: {
    expectedPath: string;
    installed: boolean;
    verified: boolean;
  };
  model: {
    id: string;
    expectedPath: string;
    installed: boolean;
    verified: boolean;
  };
  acceleration: {
    requested: 'auto' | 'gpu' | 'cpu';
    selected: 'gpu' | 'cpu';
    cudaSupported: boolean;
    runtimeVariant: 'cpu' | 'cuda' | 'metal' | 'vulkan';
    fallbackReason?: string;
  };
  actionRequired?:
    | 'download-runtime'
    | 'download-model'
    | 'pin-manifest-hashes'
    | 'manifest-not-configured'
    | 'download-required'
    | 'none';
  message?: string;
};

export type CreateJobRequest = {
  mediaPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  asrProviderId: string;
  whisperModelId: string;
  localWhisperUseCuda?: boolean;
  allowWhisperAssetDownload?: boolean;
  allowCloudAsrUpload?: boolean;
  translationProviderPriority: string[];
  translationConcurrency?: number;
  translationRequestsPerMinute?: number;
  translationTokenBudgetPerMinute?: number;
  translationLinesPerRequest?: number;
  translationBatchStride?: number;
};

export type JobStage =
  | 'idle'
  | 'imported'
  | 'checking-runtime'
  | 'probing'
  | 'extracting-audio'
  | 'transcribing'
  | 'translating'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobSnapshot = {
  id: string;
  mediaPath: string;
  fileName: string;
  step: WorkflowStep;
  stage: JobStage;
  progress: number;
  sourceLanguage: string;
  targetLanguage: string;
  asrProviderId: string;
  whisperModelId: string;
  localWhisperUseCuda: boolean;
  allowWhisperAssetDownload: boolean;
  allowCloudAsrUpload: boolean;
  translationProviderPriority: string[];
  translationConcurrency: number;
  translationRequestsPerMinute: number;
  translationTokenBudgetPerMinute: number;
  translationLinesPerRequest: number;
  translationBatchStride: number;
  subtitleDocument?: SubtitleDocument;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  warnings: SubtitleWarning[];
  createdAt: string;
  updatedAt: string;
};

export type JobEvent =
  | { type: 'snapshot'; job: JobSnapshot }
  | { type: 'progress'; jobId: string; stage: JobStage; progress: number; message?: string }
  | { type: 'error'; jobId: string; code: string; message: string; retryable: boolean };

export type AssetEvent =
  | { type: 'download-start'; scope: 'runtime' | 'model'; message: string }
  | { type: 'download-progress'; scope: 'runtime' | 'model'; message: string; receivedBytes?: number; totalBytes?: number }
  | { type: 'verify'; scope: 'runtime' | 'model'; message: string }
  | { type: 'extract'; scope: 'runtime'; message: string }
  | { type: 'ready'; scope: 'runtime' | 'model'; message: string }
  | { type: 'error'; scope: 'runtime' | 'model'; message: string };

export type NativeHealth = {
  protocolVersion: number;
  backendVersion: string;
  status: 'ok' | 'degraded';
  capabilities: string[];
  whisperRuntimeAvailable: boolean;
  ffmpegAvailable?: boolean;
  ffprobeAvailable?: boolean;
  hardwareAcceleration: 'cpu' | 'gpu' | 'unknown';
  cudaSupported: boolean;
  recommendedLocalAcceleration: 'gpu' | 'cpu';
};

export type NativeProtocolType =
  | 'runtime.health'
  | 'media.probe'
  | 'audio.extract'
  | 'asr.transcribe'
  | 'srt.parse'
  | 'srt.serialize'
  | 'job.cancel';

export type NativeProtocolErrorCode =
  | 'MissingRuntime'
  | 'DownloadRequired'
  | 'ManifestNotConfigured'
  | 'UnsupportedCommand'
  | 'MalformedRequest'
  | 'InternalError';

export type NativeProtocolError = {
  code: NativeProtocolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type NativeProtocolRequest<TPayload = unknown> = {
  protocolVersion: 1;
  requestId: string;
  type: NativeProtocolType;
  payload: TPayload;
};

export type NativeProtocolResponse<TPayload = unknown> = {
  protocolVersion: 1;
  requestId: string;
  type: NativeProtocolType;
  ok: boolean;
  payload?: TPayload;
  error?: NativeProtocolError;
};
