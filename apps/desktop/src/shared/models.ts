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
export type LocalAsrCpuMode = 'low' | 'balanced' | 'high';
export type LocalAsrAcceleration = 'auto' | 'cpu' | 'gpu';
export type RuntimeVariant = 'cpu' | 'cuda' | 'metal' | 'vulkan';
export type AppLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type AppSettingsPublic = {
  schemaVersion: 1;
  uiLanguage: 'en-US' | 'zh-CN';
  theme: 'dark' | 'light' | 'system';
  logLevel: AppLogLevel;
  sourceLanguage: string;
  targetLanguage: string;
  asrProviderId: string;
  whisperModelId: string;
  localAsrAcceleration: LocalAsrAcceleration;
  preferredRuntimeVariant?: RuntimeVariant;
  localWhisperUseCuda: boolean;
  localAsrCpuMode: LocalAsrCpuMode;
  localAsrCompatibilityOverrides: {
    ignoreCudaMismatch: boolean;
  };
  localWhisperIgnoreCudaMismatch: boolean;
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
  acceleration?: ProviderAccelerationStatus;
};

export type ProviderAccelerationStatus = {
  requested: LocalAsrAcceleration;
  selected: 'gpu' | 'cpu';
  runtimeVariant: RuntimeVariant;
  hardwareDetected: boolean;
  runtimeDetected: boolean;
  supported: boolean;
  fallbackReason?: string;
};

export type ProviderSecretInput = {
  apiFormat?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type WhisperModelInfo = {
  id: string;
  displayName: string;
  languageScope: 'multilingual' | 'english-only';
  sizeBytes: number;
  estimatedVramBytes?: number;
  installed: boolean;
  sha256: string;
};

export type WhisperRuntimeRequest = {
  modelId: string;
  allowDownload: boolean;
  preferCuda: boolean;
  localAsrAcceleration?: LocalAsrAcceleration;
  preferredRuntimeVariant?: RuntimeVariant;
  ignoreCudaMismatch?: boolean;
  useMultiThreadDownload?: boolean;
  downloadScope?: 'all' | 'runtime' | 'cuda-runtime' | 'model' | 'none';
};

export type WhisperModelRequest = {
  modelId: string;
  allowDownload: boolean;
  useMultiThreadDownload?: boolean;
};

export type WhisperModelStatus = {
  id: string;
  cacheDir: string;
  expectedPath: string;
  installed: boolean;
  verified: boolean;
  actionRequired?: 'download-model' | 'manifest-not-configured' | 'none';
  message?: string;
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
    hardwareDetected: boolean;
    runtimeDetected: boolean;
    versionMismatch: boolean;
    requiredCudaVersion?: '11.8' | '12.8';
    runtimeCudaVersion?: '11.8' | '12.8';
    runtimeVariant: 'cpu' | 'cuda' | 'metal' | 'vulkan';
    fallbackReason?: string;
  };
  actionRequired?:
    | 'download-runtime'
    | 'download-model'
    | 'unsupported-platform'
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
  localAsrAcceleration?: LocalAsrAcceleration;
  preferredRuntimeVariant?: RuntimeVariant;
  localAsrCpuMode?: LocalAsrCpuMode;
  localWhisperIgnoreCudaMismatch?: boolean;
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
  localAsrAcceleration: LocalAsrAcceleration;
  preferredRuntimeVariant?: RuntimeVariant;
  localAsrCpuMode: LocalAsrCpuMode;
  localWhisperIgnoreCudaMismatch: boolean;
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
  | { type: 'download-start'; scope: 'runtime' | 'model' | 'ffmpeg'; message: string }
  | { type: 'download-progress'; scope: 'runtime' | 'model' | 'ffmpeg'; message: string; receivedBytes?: number; totalBytes?: number }
  | { type: 'verify'; scope: 'runtime' | 'model' | 'ffmpeg'; message: string }
  | { type: 'extract'; scope: 'runtime' | 'ffmpeg'; message: string }
  | { type: 'ready'; scope: 'runtime' | 'model' | 'ffmpeg'; message: string }
  | { type: 'error'; scope: 'runtime' | 'model' | 'ffmpeg'; message: string };

export type FfmpegRequest = {
  allowDownload: boolean;
  useMultiThreadDownload?: boolean;
};

export type FasterWhisperRuntimeRequest = {
  modelId: string;
  allowDownload: boolean;
  preferCuda: boolean;
  localAsrAcceleration?: LocalAsrAcceleration;
  preferredRuntimeVariant?: RuntimeVariant;
  useMultiThreadDownload?: boolean;
  forceManaged?: boolean;
};

export type FasterWhisperRuntimeStatus = ProviderHealth & {
  providerId: 'local.faster-whisper';
  acceleration: ProviderAccelerationStatus;
};

export type FasterWhisperCudaRequest = {
  allowDownload: boolean;
  useMultiThreadDownload?: boolean;
};

export type FasterWhisperCudaStatus = {
  provider: 'local.faster-whisper';
  cacheDir: string;
  runtimeDir: string;
  source: 'managed' | 'system' | 'missing';
  hardwareDetected: boolean;
  runtimeDetected: boolean;
  cudaSupported: boolean;
  requiredCudaVersion: '12.8';
  actionRequired?: 'download-cuda-runtime' | 'none';
  message?: string;
};

export type FfmpegStatus = {
  cacheDir: string;
  binDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  available: boolean;
  source: 'managed' | 'system' | 'missing';
  actionRequired?: 'download-required' | 'none';
};

export type NativeAcceleratorHealth = {
  variant: 'cuda' | 'metal' | 'vulkan';
  hardwareDetected: boolean;
  runtimeDetected: boolean;
  supported: boolean;
  message?: string;
};

export type NativeHealth = {
  protocolVersion: number;
  backendVersion: string;
  status: 'ok' | 'degraded';
  detail?: string;
  capabilities: string[];
  accelerators: NativeAcceleratorHealth[];
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
