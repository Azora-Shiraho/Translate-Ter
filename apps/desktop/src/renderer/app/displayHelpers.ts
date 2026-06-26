import type {
  AppLogLevel,
  ExportDestinationMode,
  FfmpegStatus,
  NativeHealth,
  ProviderHealth,
  SubtitleSegment,
  SubtitleStatus,
  SubtitleWarning,
  WhisperModelInfo,
  WhisperModelStatus,
  WhisperRuntimeStatus
} from '@shared/types';
import type { JobStage } from '@shared/models';
import { formatTimestamp } from '@shared/srt';
import type { ActiveDownload } from './types';

export function stageLabel(stage: JobStage): string {
  return `stage.${stage}`;
}

export function statusLabel(status: SubtitleStatus): string {
  switch (status) {
    case 'new':
      return 'segmentStatus.new';
    case 'transcribed':
      return 'segmentStatus.transcribed';
    case 'translated':
      return 'segmentStatus.translated';
    case 'edited':
      return 'segmentStatus.edited';
    case 'warning':
      return 'segmentStatus.warning';
    case 'failed':
    default:
      return 'segmentStatus.failed';
  }
}

export function providerStatusLabel(status: ProviderHealth['status']): string {
  return `providerStatus.${status}`;
}

export function runtimeActionLabel(action: WhisperRuntimeStatus['actionRequired'] = 'none'): string {
  return `runtimeAction.${action}`;
}

export function modelActionLabel(action: WhisperModelStatus['actionRequired'] = 'none'): string {
  return `runtimeAction.${action}`;
}

export function exportDestinationModeLabel(mode: ExportDestinationMode): string {
  return `exportDestination.${mode}`;
}

export function providerLabel(providerId: string, t: (key: string) => string): string {
  switch (providerId) {
    case 'local.whisper.cpp':
      return t('localProvider');
    case 'local.faster-whisper':
      return t('localProvider');
    case 'cloud.openai':
      return t('cloudProvider');
    case 'openai.compatible':
      return t('translationProvider');
    default:
      return providerId;
  }
}

export function accelerationOptionLabel(acceleration: 'auto' | 'cpu' | 'gpu'): string {
  switch (acceleration) {
    case 'cpu':
      return 'cpuOption';
    case 'gpu':
      return 'gpuOption';
    default:
      return 'autoOption';
  }
}

export function runtimeVariantOptionLabel(variant: 'auto' | 'cpu' | 'cuda' | 'metal' | 'vulkan'): string {
  switch (variant) {
    case 'cpu':
      return 'cpuOption';
    case 'cuda':
      return 'runtimeVariantCuda';
    case 'metal':
      return 'runtimeVariantMetal';
    case 'vulkan':
      return 'runtimeVariantVulkan';
    default:
      return 'autoOption';
  }
}

export function localCpuModeLabel(mode: 'low' | 'balanced' | 'high'): string {
  switch (mode) {
    case 'low':
      return 'cpuModeLow';
    case 'high':
      return 'cpuModeHigh';
    case 'balanced':
    default:
      return 'cpuModeBalanced';
  }
}

export function localCpuModeDetailLabel(mode: 'low' | 'balanced' | 'high'): string {
  switch (mode) {
    case 'low':
      return 'cpuModeLowDetail';
    case 'high':
      return 'cpuModeHighDetail';
    case 'balanced':
    default:
      return 'cpuModeBalancedDetail';
  }
}

export function logLevelDetailLabel(level: AppLogLevel): string {
  switch (level) {
    case 'debug':
      return 'logLevelDebugDetail';
    case 'warning':
      return 'logLevelWarningDetail';
    case 'error':
      return 'logLevelErrorDetail';
    case 'info':
    default:
      return 'logLevelInfoDetail';
  }
}

export function describeFfmpegLocation(status: FfmpegStatus, t: (key: string) => string): string {
  if (status.ffmpegPath && status.ffprobePath) {
    return `${status.ffmpegPath} · ${status.ffprobePath}`;
  }
  if (status.ffmpegPath) return `${t('ffmpegTools')}: ${status.ffmpegPath}`;
  if (status.ffprobePath) return `ffprobe: ${status.ffprobePath}`;
  return t('ffmpegNotChecked');
}

export function warningSummaryLabel(warning: SubtitleWarning, t: (key: string) => string): string {
  if (warning.stage === 'translate') return t('warningFallbackSummary');
  switch (warning.code) {
    case 'CudaFallback':
    case 'CudaTranscriptionCrashFallback':
      return t('warningSummaryCudaFallback');
    case 'NativeCapabilityUnavailable':
      return t('warningSummaryBackendCapability');
    case 'ParseError':
      return t('warningSummarySubtitleParse');
    case 'InvalidTiming':
      return t('warningSummaryInvalidTiming');
    case 'EmptyText':
      return t('warningSummaryEmptySubtitle');
    case 'TimingOverlap':
      return t('warningSummaryTimingOverlap');
    default:
      return humanizeWarningCode(warning.code);
  }
}

export function deriveWarningHint(
  warning: SubtitleWarning | undefined,
  t: (key: string) => string
): string {
  if (warning?.stage === 'translate') {
    return t('warningFallbackHint');
  }
  return t('warningReviewHint');
}

export function warningCategoryLabel(warning: SubtitleWarning, t: (key: string) => string): string {
  if (warning.stage === 'translate') return t('warningCategoryTranslation');
  if (warning.stage === 'asr') return t('warningCategoryRecognition');
  if (warning.stage === 'subtitle') return t('warningCategorySubtitles');
  if (warning.stage === 'export') return t('warningCategoryExport');
  if (isSubtitleWarningCode(warning.code)) return t('warningCategorySubtitles');
  if (isRuntimeWarningCode(warning.code)) return t('warningCategoryRuntime');
  return t('warningCategoryWorkflow');
}

export function warningSourceLabel(
  warning: SubtitleWarning,
  asrProviderId: string,
  translationProviderId: string,
  t: (key: string) => string
): string {
  if (warning.providerId) return providerLabel(warning.providerId, t);
  if (warning.stage === 'translate') return providerLabel(translationProviderId, t);
  if (warning.stage === 'asr') return providerLabel(asrProviderId, t);
  if (warning.stage === 'export') return t('export');
  if (isSubtitleWarningCode(warning.code)) return t('warningSourceSubtitleParser');
  if (warning.code === 'NativeCapabilityUnavailable') return t('summaryDesktopBackend');
  if (isRuntimeWarningCode(warning.code)) return t('warningSourceLocalRuntime');
  return t('warningSourceWorkflow');
}

export function formatWarningSegmentRange(warning: SubtitleWarning): string {
  if (warning.startIndex && warning.endIndex) {
    return warning.startIndex === warning.endIndex
      ? `#${warning.startIndex}`
      : `#${warning.startIndex} - #${warning.endIndex}`;
  }
  return '--';
}

export function formatWarningTimeline(warning: SubtitleWarning): string {
  if (warning.startMs !== undefined && warning.endMs !== undefined) {
    return `${formatTimestamp(warning.startMs)} - ${formatTimestamp(warning.endMs)}`;
  }
  return '--';
}

export function formatWarningDate(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(index <= 1 ? 0 : 1)} ${units[index]}`;
}

export function describeModelFootprint(
  model: WhisperModelInfo,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const parts: string[] = [];
  if (model.sizeBytes > 0) {
    parts.push(formatBytes(model.sizeBytes));
  }
  if (model.estimatedVramBytes && model.estimatedVramBytes > 0) {
    parts.push(t('estimatedVramInline', { value: formatBytes(model.estimatedVramBytes) }));
  }
  return parts.join(' · ') || t('modelFootprintPending');
}

export function deriveWorkspaceRailMessage(input: {
  t: (key: string) => string;
  asrProviderId: string;
  activeDownload?: ActiveDownload;
  footerTitle: string;
  stage: JobStage | 'idle';
  sourceLabel: string;
  targetLabel: string;
}): string {
  if (input.activeDownload) return input.footerTitle;
  if (input.stage === 'idle') return `${input.sourceLabel} -> ${input.targetLabel}`;
  if (input.stage === 'failed') return input.t('warningReviewHint');
  if (input.stage === 'completed') return input.t('exported');
  return `${providerLabel(input.asrProviderId, input.t)} · ${input.t(stageLabel(input.stage))}`;
}

export function deriveWorkspaceRuntimeDetail(input: {
  t: (key: string) => string;
  asrProviderId: string;
  asrHealth?: ProviderHealth;
  runtimeState: { detail: string };
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
}): string {
  if (input.asrProviderId === 'local.whisper.cpp') return input.runtimeState.detail;
  if (input.asrProviderId === 'local.faster-whisper') {
    return input.asrHealth?.message ?? input.t('fasterWhisperPythonDetail');
  }
  if (input.ffmpegStatus?.available ?? Boolean(input.nativeHealth?.ffmpegAvailable && input.nativeHealth?.ffprobeAvailable)) {
    return input.asrHealth?.message ?? input.t('cloudProviderDetail');
  }
  return input.t('ffmpegMissingDetail');
}

function isSubtitleWarningCode(code: string): boolean {
  return ['ParseError', 'InvalidTiming', 'EmptyText', 'TimingOverlap'].includes(code);
}

function isRuntimeWarningCode(code: string): boolean {
  return [
    'download-runtime',
    'download-model',
    'download-cuda-runtime',
    'manifest-not-configured',
    'unsupported-platform',
    'pin-manifest-hashes'
  ].includes(code);
}

function humanizeWarningCode(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\bCpu\b/g, 'CPU')
    .replace(/\bCuda\b/g, 'CUDA')
    .replace(/\bAsr\b/g, 'ASR')
    .replace(/\bFfmpeg\b/g, 'FFmpeg')
    .replace(/\bWhisper\b/g, 'Whisper')
    .replace(/^./, (value) => value.toUpperCase());
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}
