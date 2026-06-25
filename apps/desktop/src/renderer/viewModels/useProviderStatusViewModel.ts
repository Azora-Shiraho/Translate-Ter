import { useMemo } from 'react';
import type {
  AppSettingsPublic,
  FasterWhisperCudaStatus,
  FfmpegStatus,
  JobSnapshot,
  NativeHealth,
  ProviderHealth,
  WhisperModelInfo,
  WhisperModelStatus,
  WhisperRuntimeStatus
} from '@shared/types';
import type { RuntimeVariantSelection } from '../asrSettings';
import { isExperimentalWhisperRuntimeVariant, isVerifiedWhisperGpuRuntimeVariant } from '../asrSettings';
import { asrProviders } from '../app/constants';
import type { DerivedHealthState, RuntimeStatusRow, SettingsJumpTarget } from '../app/types';

type UseProviderStatusViewModelInput = {
  t: (key: string, options?: Record<string, unknown>) => string;
  settings?: AppSettingsPublic;
  models: WhisperModelInfo[];
  nativeHealth?: NativeHealth;
  runtimeStatus?: WhisperRuntimeStatus;
  cudaStatus?: WhisperRuntimeStatus;
  fasterWhisperCudaStatus?: FasterWhisperCudaStatus;
  modelStatus?: WhisperModelStatus;
  ffmpegStatus?: FfmpegStatus;
  providerHealth: Record<string, ProviderHealth>;
  job?: JobSnapshot;
  configuredAcceleration: AppSettingsPublic['localAsrAcceleration'];
  effectiveRuntimeVariantSelection: RuntimeVariantSelection;
  runtimeVariantSelections: RuntimeVariantSelection[];
  cudaFlowRelevant: boolean;
  ignoreCudaMismatch: boolean;
};

export function useProviderStatusViewModel(input: UseProviderStatusViewModelInput) {
  const {
    t,
    settings,
    models,
    nativeHealth,
    runtimeStatus,
    cudaStatus,
    fasterWhisperCudaStatus,
    modelStatus,
    ffmpegStatus,
    providerHealth,
    job,
    configuredAcceleration,
    effectiveRuntimeVariantSelection,
    cudaFlowRelevant,
    ignoreCudaMismatch
  } = input;

  return useMemo(() => {
    const asrProviderId = settings?.asrProviderId ?? 'local.whisper.cpp';
    const translationProviderId = settings?.translationProviderPriority[0] ?? 'openai.compatible';
    const selectedModel = models.find((model) => model.id === settings?.whisperModelId);
    const selectedModelStatus = modelStatus && modelStatus.id === settings?.whisperModelId ? modelStatus : undefined;
    const selectedModelInstalled = selectedModelStatus?.installed ?? selectedModel?.installed ?? false;
    const selectedModelVerified = selectedModelStatus?.verified ?? false;
    const ffmpegState = deriveFfmpegState({ t, ffmpegStatus, nativeHealth });
    const nativeBackendState = deriveNativeBackendState({ t, health: nativeHealth });
    const llmHealth = providerHealth[translationProviderId];
    const asrHealth = providerHealth[asrProviderId];
    const runtimeState = deriveRuntimeState({
      t,
      runtimeStatus,
      ffmpegStatus,
      nativeHealth,
      asrProviderId,
      asrHealth,
      job
    });
    const backendAccelerationState = deriveBackendAccelerationState({ t, runtimeStatus, asrProviderId });
    const runtimeModelState = deriveRuntimeModelState({
      t,
      runtimeStatus,
      selectedModelInstalled,
      selectedModelVerified,
      asrProviderId
    });
    const selectedModelOverviewState = deriveSelectedModelOverviewState({
      t,
      selectedModel,
      selectedModelInstalled,
      selectedModelVerified,
      asrProviderId
    });
    const translationState = deriveTranslationState({
      t,
      providerId: translationProviderId,
      health: llmHealth,
      job
    });
    const asrProviderDescription = t(
      asrProviders.find((provider) => provider.id === asrProviderId)?.descriptionKey ?? 'providerReady'
    );
    const asrProviderState = deriveAsrProviderState({
      t,
      asrProviderId,
      description: asrProviderDescription,
      health: asrHealth,
      runtimeState,
      job
    });
    const ffmpegAvailable = ffmpegStatus?.available ?? Boolean(nativeHealth?.ffmpegAvailable && nativeHealth?.ffprobeAvailable);
    const usingWhisperCpp = asrProviderId === 'local.whisper.cpp';
    const usingFasterWhisper = asrProviderId === 'local.faster-whisper';
    const usingLocalAsr = usingWhisperCpp || usingFasterWhisper;
    const fasterWhisperUnsupportedVariant = Boolean(
      usingFasterWhisper && asrHealth?.acceleration && !asrHealth.acceleration.supported
    );
    const cudaBlockingMismatch = hasBlockingCudaMismatch(cudaStatus, ignoreCudaMismatch);
    const cudaMismatchDetected = cudaFlowRelevant && cudaBlockingMismatch;
    const cudaRuntimeMissing = Boolean(
      cudaFlowRelevant &&
        cudaStatus?.acceleration.hardwareDetected &&
        !cudaStatus.acceleration.runtimeDetected
    );
    const showCudaRuntimeDownload = Boolean(
      settings?.allowWhisperAssetDownload && cudaFlowRelevant && cudaRuntimeMissing && !cudaBlockingMismatch
    );
    const showFasterWhisperCudaDownload = Boolean(
      settings?.allowWhisperAssetDownload && fasterWhisperCudaStatus?.actionRequired === 'download-cuda-runtime'
    );
    const showFfmpegDownload = !ffmpegAvailable;
    const fasterWhisperRuntimeMissing = usingFasterWhisper && !asrHealth?.ok;
    const runtimeSummaryJumpTarget: SettingsJumpTarget = usingWhisperCpp
      ? !ffmpegAvailable
        ? 'ffmpeg'
        : !runtimeStatus?.binary.verified
          ? 'asr-provider'
          : !runtimeStatus?.model.verified
            ? 'whisper-model'
            : (cudaFlowRelevant &&
                (runtimeStatus?.acceleration.requested === 'gpu' || cudaRuntimeMissing || cudaMismatchDetected))
              ? 'cuda'
              : 'asr-provider'
      : fasterWhisperRuntimeMissing
        ? 'asr-provider'
        : 'asr-provider';
    const backendJumpTarget: SettingsJumpTarget = ffmpegAvailable ? 'asr-provider' : 'ffmpeg';
    const ffmpegJumpTarget: SettingsJumpTarget = 'ffmpeg';
    const accelerationJumpTarget: SettingsJumpTarget = usingWhisperCpp ? 'cuda' : 'asr-provider';
    const modelJumpTarget: SettingsJumpTarget = usingLocalAsr ? 'whisper-model' : 'asr-provider';
    const translationJumpTarget: SettingsJumpTarget = 'translation-provider';
    const showFasterWhisperRuntimeDownloadAction = Boolean(
      settings?.allowWhisperAssetDownload &&
        usingFasterWhisper &&
        !fasterWhisperUnsupportedVariant &&
        (!asrHealth || asrHealth.status === 'unavailable')
    );
    const showRuntimeDownloadAction =
      Boolean(settings?.allowWhisperAssetDownload) &&
      (usingWhisperCpp || showFasterWhisperRuntimeDownloadAction) &&
      !asrHealth?.ok;
    const runtimeDownloadDisabled =
      settings?.asrProviderId === 'local.whisper.cpp' ? Boolean(runtimeStatus?.binary.verified) : Boolean(asrHealth?.ok);
    const runtimeStatusRows: RuntimeStatusRow[] = usingWhisperCpp
      ? buildWhisperRuntimeStatusRows({
          t,
          runtimeStatus,
          requestedAcceleration: configuredAcceleration,
          requestedVariant: effectiveRuntimeVariantSelection
        })
      : usingFasterWhisper
        ? buildFasterWhisperRuntimeStatusRows({
            t,
            acceleration: asrHealth?.acceleration,
            requestedAcceleration: configuredAcceleration,
            requestedVariant: effectiveRuntimeVariantSelection
          })
        : [];
    const cudaStatusDetail = cudaFlowRelevant
      ? describeCudaStatusDetail(cudaStatus, t, ignoreCudaMismatch)
      : effectiveRuntimeVariantSelection === 'metal' || effectiveRuntimeVariantSelection === 'vulkan'
        ? t('cudaNotApplicableForVariant')
        : configuredAcceleration === 'cpu'
          ? t('cudaDisabledUsesCpu')
          : configuredAcceleration === 'auto'
            ? t('runtimeVariantAutomatic')
            : t('runtimeNotChecked');
    const cudaStatusShort = cudaFlowRelevant
      ? describeCudaStatusShort(cudaStatus, t, ignoreCudaMismatch)
      : configuredAcceleration === 'auto'
        ? t('autoOption')
        : configuredAcceleration === 'cpu'
          ? t('disabledShort')
          : t('notRequired');
    const fasterWhisperCudaDetail = fasterWhisperCudaStatus?.message ?? t('runtimeNotChecked');
    const fasterWhisperCudaShort = fasterWhisperCudaStatus
      ? fasterWhisperCudaStatus.cudaSupported
        ? t('ok')
        : fasterWhisperCudaStatus.actionRequired === 'download-cuda-runtime'
          ? t('downloadCudaRuntime')
          : t('degraded')
      : t('notChecked');

    return {
      asrProviderId,
      translationProviderId,
      selectedModel,
      selectedModelStatus,
      selectedModelInstalled,
      selectedModelVerified,
      llmHealth,
      asrHealth,
      ffmpegState,
      nativeBackendState,
      runtimeState,
      backendAccelerationState,
      runtimeModelState,
      selectedModelOverviewState,
      translationState,
      asrProviderState,
      ffmpegAvailable,
      usingWhisperCpp,
      usingFasterWhisper,
      usingLocalAsr,
      fasterWhisperUnsupportedVariant,
      cudaMismatchDetected,
      cudaRuntimeMissing,
      showCudaRuntimeDownload,
      showFasterWhisperCudaDownload,
      showFfmpegDownload,
      runtimeSummaryJumpTarget,
      backendJumpTarget,
      ffmpegJumpTarget,
      accelerationJumpTarget,
      modelJumpTarget,
      translationJumpTarget,
      showFasterWhisperRuntimeDownloadAction,
      showRuntimeDownloadAction,
      runtimeDownloadDisabled,
      runtimeStatusRows,
      cudaStatusDetail,
      cudaStatusShort,
      fasterWhisperCudaDetail,
      fasterWhisperCudaShort
    };
  }, [
    asrProviders,
    configuredAcceleration,
    cudaFlowRelevant,
    cudaStatus,
    effectiveRuntimeVariantSelection,
    fasterWhisperCudaStatus,
    ffmpegStatus,
    ignoreCudaMismatch,
    job,
    modelStatus,
    models,
    nativeHealth,
    providerHealth,
    runtimeStatus,
    settings,
    t
  ]);
}

function providerStatusLabel(status: ProviderHealth['status']): string {
  return status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'unavailable';
}

function runtimeActionLabel(action: WhisperRuntimeStatus['actionRequired'] = 'none'): string {
  return action === 'none' ? 'ready' : action.replace(/-/g, '');
}

function accelerationOptionLabel(acceleration: AppSettingsPublic['localAsrAcceleration']): string {
  switch (acceleration) {
    case 'cpu':
      return 'cpuOption';
    case 'gpu':
      return 'gpuOption';
    default:
      return 'autoOption';
  }
}

function runtimeVariantOptionLabel(variant: RuntimeVariantSelection): string {
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

function buildWhisperRuntimeStatusRows(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  requestedAcceleration: AppSettingsPublic['localAsrAcceleration'];
  requestedVariant: RuntimeVariantSelection;
}): RuntimeStatusRow[] {
  const { t, runtimeStatus, requestedAcceleration, requestedVariant } = input;
  if (!runtimeStatus) {
    return [
      { label: t('acceleration'), value: t(accelerationOptionLabel(requestedAcceleration)), tone: 'muted' },
      { label: t('runtimeVariant'), value: t(runtimeVariantOptionLabel(requestedVariant)), tone: 'muted' }
    ];
  }

  return [
    {
      label: t('acceleration'),
      value: t(accelerationOptionLabel(runtimeStatus.acceleration.selected)),
      tone: runtimeStatus.acceleration.selected === 'gpu' ? 'good' : 'accent'
    },
    {
      label: t('runtimeVariant'),
      value: t(runtimeVariantOptionLabel(runtimeStatus.acceleration.runtimeVariant)),
      tone:
        runtimeStatus.acceleration.selected === 'gpu' && isVerifiedWhisperGpuRuntimeVariant(runtimeStatus.acceleration.runtimeVariant)
          ? 'good'
          : runtimeStatus.acceleration.selected === 'gpu'
            ? 'warn'
            : 'accent'
    },
    {
      label: t('runtimeBinary'),
      value: runtimeStatus.binary.verified ? t('installed') : t(runtimeActionLabel(runtimeStatus.actionRequired)),
      tone: runtimeStatus.binary.verified ? 'good' : runtimeStatus.binary.installed ? 'warn' : 'error'
    },
    {
      label: t('runtimeModel'),
      value: runtimeStatus.model.verified ? t('installed') : t(runtimeActionLabel(runtimeStatus.actionRequired)),
      tone: runtimeStatus.model.verified ? 'good' : runtimeStatus.model.installed ? 'warn' : 'error'
    }
  ];
}

function buildFasterWhisperRuntimeStatusRows(input: {
  t: (key: string) => string;
  acceleration?: ProviderHealth['acceleration'];
  requestedAcceleration: AppSettingsPublic['localAsrAcceleration'];
  requestedVariant: RuntimeVariantSelection;
}): RuntimeStatusRow[] {
  const { t, acceleration, requestedAcceleration, requestedVariant } = input;
  return [
    {
      label: t('acceleration'),
      value: t(accelerationOptionLabel(acceleration?.selected ?? requestedAcceleration)),
      tone: acceleration?.selected === 'gpu' ? 'good' : 'accent'
    },
    {
      label: t('runtimeVariant'),
      value: t(runtimeVariantOptionLabel(acceleration?.runtimeVariant ?? requestedVariant)),
      tone: acceleration?.selected === 'gpu' ? 'good' : 'accent'
    }
  ];
}

function deriveTranslationState(input: {
  t: (key: string) => string;
  providerId: string;
  health?: ProviderHealth;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, providerId, health, job } = input;
  if (job?.stage === 'failed' && job.error && job.step === 'translate') {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: t(providerId === 'openai.compatible' ? 'translationProviderNotChecked' : 'notChecked')
    };
  }
  if (health.ok) {
    return {
      tone: 'good',
      label: t(providerStatusLabel(health.status)),
      detail: health.message ?? t('providerReady')
    };
  }
  return {
    tone: health.status === 'degraded' ? 'warn' : 'error',
    label: t(providerStatusLabel(health.status)),
    detail: health.message ?? t(providerStatusLabel(health.status))
  };
}

function deriveAsrProviderState(input: {
  t: (key: string) => string;
  asrProviderId: string;
  description: string;
  health?: ProviderHealth;
  runtimeState: DerivedHealthState;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, asrProviderId, description, health, runtimeState, job } = input;
  if (asrProviderId === 'local.whisper.cpp') {
    return runtimeState;
  }
  if (job?.stage === 'failed' && job.error && (job.step === 'asr' || job.step === 'subtitles')) {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: description
    };
  }
  if (health.ok) {
    return {
      tone: 'good',
      label: t(providerStatusLabel(health.status)),
      detail: health.message ?? description
    };
  }
  return {
    tone: health.status === 'degraded' ? 'warn' : 'error',
    label: t(providerStatusLabel(health.status)),
    detail: health.message ?? description
  };
}

function deriveFfmpegState(input: {
  t: (key: string) => string;
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
}): DerivedHealthState {
  const { t, ffmpegStatus, nativeHealth } = input;
  if (!ffmpegStatus && !nativeHealth) {
    return { tone: 'muted', label: t('notChecked'), detail: t('ffmpegNotChecked') };
  }

  const ffmpegAvailable = ffmpegStatus?.ffmpegAvailable ?? Boolean(nativeHealth?.ffmpegAvailable);
  const ffprobeAvailable = ffmpegStatus?.ffprobeAvailable ?? Boolean(nativeHealth?.ffprobeAvailable);
  const available = ffmpegStatus?.available ?? Boolean(ffmpegAvailable && ffprobeAvailable);
  if (available) {
    return {
      tone: 'good',
      label: t('installed'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  if (ffmpegAvailable || ffprobeAvailable) {
    return {
      tone: 'warn',
      label: t('degraded'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  return {
    tone: 'error',
    label: t('missing'),
    detail: t('ffmpegMissingDetail')
  };
}

function deriveNativeBackendState(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  health?: NativeHealth;
}): DerivedHealthState {
  const { t, health } = input;
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: t('runtimeNotChecked')
    };
  }

  if (health.status === 'ok') {
    return {
      tone: 'good',
      label: t('ok'),
      detail: t('nativeBackendReadyDetail', { version: health.backendVersion })
    };
  }

  if (health.detail?.trim()) {
    return {
      tone: 'warn',
      label: t('degraded'),
      detail: health.detail
    };
  }

  const issues: string[] = [];
  if (!health.ffmpegAvailable && !health.ffprobeAvailable) {
    issues.push(t('nativeBackendMissingFfmpegPair'));
  } else {
    if (!health.ffmpegAvailable) issues.push(t('nativeBackendMissingFfmpeg'));
    if (!health.ffprobeAvailable) issues.push(t('nativeBackendMissingFfprobe'));
  }
  if (!health.capabilities.includes('asr.transcribe')) {
    issues.push(t('nativeBackendMissingAsrCapability'));
  }
  if (!health.capabilities.includes('audio.extract')) {
    issues.push(t('nativeBackendMissingAudioCapability'));
  }
  if (health.hardwareAcceleration === 'unknown') {
    issues.push(t('nativeBackendAccelerationUnknown'));
  }
  if (health.capabilities.length === 1 && health.capabilities[0] === 'runtime.health') {
    issues.unshift(t('nativeBackendFallbackDetail'));
  }

  return {
    tone: 'warn',
    label: t('degraded'),
    detail: issues[0] ?? t('nativeBackendGenericDegraded')
  };
}

function deriveRuntimeState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
  asrProviderId: string;
  asrHealth?: ProviderHealth;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, runtimeStatus, ffmpegStatus, nativeHealth, asrProviderId, asrHealth, job } = input;
  if (job?.stage === 'failed' && job.error && (job.step === 'asr' || job.step === 'subtitles')) {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  const ffmpegAvailable = ffmpegStatus?.available ?? Boolean(nativeHealth?.ffmpegAvailable && nativeHealth?.ffprobeAvailable);
  if (!ffmpegAvailable) {
    return {
      tone: ffmpegStatus || nativeHealth ? 'error' : 'muted',
      label: t(ffmpegStatus || nativeHealth ? 'missing' : 'notChecked'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  if (asrProviderId === 'local.faster-whisper') {
    if (!asrHealth) {
      return {
        tone: 'muted',
        label: t('notChecked'),
        detail: t('fasterWhisperPythonDetail')
      };
    }
    if (asrHealth.ok) {
      return {
        tone: 'good',
        label: t(providerStatusLabel(asrHealth.status)),
        detail: asrHealth.message ?? t('providerReady')
      };
    }
    return {
      tone: asrHealth.status === 'degraded' ? 'warn' : 'error',
      label: t(providerStatusLabel(asrHealth.status)),
      detail: asrHealth.message ?? t('fasterWhisperPythonDetail')
    };
  }
  if (asrProviderId !== 'local.whisper.cpp') {
    if (!asrHealth) {
      return {
        tone: 'muted',
        label: t('notChecked'),
        detail: t('cloudProviderDetail')
      };
    }
    if (asrHealth.ok) {
      return {
        tone: 'good',
        label: t(providerStatusLabel(asrHealth.status)),
        detail: asrHealth.message ?? t('cloudProviderDetail')
      };
    }
    return {
      tone: asrHealth.status === 'degraded' ? 'warn' : 'error',
      label: t(providerStatusLabel(asrHealth.status)),
      detail: asrHealth.message ?? t('cloudProviderDetail')
    };
  }
  if (!runtimeStatus) {
    return { tone: 'muted', label: t('notChecked'), detail: t('runtimeNotChecked') };
  }
  const experimentalGpuPath =
    runtimeStatus.acceleration.selected === 'gpu' &&
    isExperimentalWhisperRuntimeVariant(runtimeStatus.acceleration.runtimeVariant);
  if (runtimeStatus.binary.verified && runtimeStatus.model.verified) {
    return {
      tone: experimentalGpuPath ? 'warn' : 'good',
      label: t(experimentalGpuPath ? 'experimental' : 'installed'),
      detail: describeWhisperAccelerationDetail(runtimeStatus, t)
    };
  }
  if (!runtimeStatus.binary.verified) {
    return {
      tone: runtimeStatus.binary.installed ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired ?? 'download-runtime')),
      detail:
        runtimeStatus.actionRequired === 'manifest-not-configured' ||
        runtimeStatus.actionRequired === 'unsupported-platform' ||
        runtimeStatus.actionRequired === 'pin-manifest-hashes'
          ? t(runtimeActionLabel(runtimeStatus.actionRequired))
          : t('runtimeBinaryMissingDetail')
    };
  }
  if (!runtimeStatus.model.verified) {
    return {
      tone: runtimeStatus.model.installed ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired ?? 'download-model')),
      detail:
        runtimeStatus.actionRequired === 'manifest-not-configured'
          ? t(runtimeActionLabel(runtimeStatus.actionRequired))
          : t('runtimeModelMissingDetail')
    };
  }
  const action = t(runtimeActionLabel(runtimeStatus.actionRequired));
  return {
    tone: runtimeStatus.binary.installed || runtimeStatus.model.installed ? 'warn' : 'error',
    label: action,
    detail: action
  };
}

function deriveBackendAccelerationState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, runtimeStatus, asrProviderId } = input;
  if (asrProviderId !== 'local.whisper.cpp') {
    return { tone: 'muted', label: t('unknown'), detail: t('localWhisperNotRequiredDetail') };
  }
  if (!runtimeStatus || !runtimeStatus.binary.verified || !runtimeStatus.model.verified) {
    return { tone: 'muted', label: t('unknown'), detail: t('runtimeNotChecked') };
  }

  const selectedVariant =
    runtimeStatus.acceleration.selected === 'gpu' ? runtimeStatus.acceleration.runtimeVariant : ('cpu' as const);

  if (runtimeStatus.acceleration.selected === 'gpu') {
    return {
      tone: isVerifiedWhisperGpuRuntimeVariant(selectedVariant) ? 'good' : 'warn',
      label: t(runtimeVariantOptionLabel(selectedVariant)),
      detail: describeWhisperAccelerationDetail(runtimeStatus, t)
    };
  }

  if (runtimeStatus.acceleration.requested === 'cpu') {
    return { tone: 'accent', label: t('cpuOption'), detail: t('gpuDisabledUsesCpu') };
  }

  return {
    tone: runtimeStatus.acceleration.fallbackReason ? 'warn' : 'accent',
    label: t('cpuOption'),
    detail: describeWhisperAccelerationDetail(runtimeStatus, t)
  };
}

function deriveRuntimeModelState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  selectedModelInstalled: boolean;
  selectedModelVerified: boolean;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, runtimeStatus, selectedModelInstalled, selectedModelVerified, asrProviderId } = input;
  if (asrProviderId !== 'local.whisper.cpp') {
    return { tone: 'muted', label: t('notRequired'), detail: t('localWhisperNotRequiredDetail') };
  }
  if (selectedModelVerified || runtimeStatus?.model.verified) {
    return { tone: 'good', label: t('installed'), detail: t('modelReady') };
  }
  if (selectedModelInstalled || runtimeStatus?.model.installed) {
    return { tone: 'warn', label: t('installed'), detail: t('modelInstalledPendingCheck') };
  }
  if (!runtimeStatus) {
    return { tone: 'muted', label: t('notChecked'), detail: t('runtimeNotChecked') };
  }
  if (runtimeStatus.actionRequired === 'manifest-not-configured') {
    return {
      tone: runtimeStatus.binary.verified ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired)),
      detail: t(runtimeActionLabel(runtimeStatus.actionRequired))
    };
  }
  if (runtimeStatus.actionRequired === 'unsupported-platform') {
    return {
      tone: 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired)),
      detail: t(runtimeActionLabel(runtimeStatus.actionRequired))
    };
  }
  return {
    tone: runtimeStatus.binary.verified ? 'warn' : 'error',
    label: t(runtimeActionLabel('download-model')),
    detail: t('runtimeModelMissingDetail')
  };
}

function deriveSelectedModelOverviewState(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  selectedModel?: WhisperModelInfo;
  selectedModelInstalled: boolean;
  selectedModelVerified: boolean;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, selectedModel, selectedModelInstalled, selectedModelVerified, asrProviderId } = input;
  const footprint = selectedModel ? describeModelFootprint(selectedModel, t) : undefined;
  if (asrProviderId !== 'local.whisper.cpp') {
    return {
      tone: 'muted',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: t('localWhisperNotRequiredDetail')
    };
  }
  if (selectedModelVerified) {
    return {
      tone: 'good',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: [t('modelReady'), footprint].filter(Boolean).join(' · ')
    };
  }
  if (selectedModelInstalled) {
    return {
      tone: 'warn',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: [t('modelInstalledPendingCheck'), footprint].filter(Boolean).join(' · ')
    };
  }
  return {
    tone: 'muted',
    label: selectedModel?.displayName ?? t('whisperModel'),
    detail: [t('runtimeModelMissingDetail'), footprint].filter(Boolean).join(' · ')
  };
}

function describeCudaStatusDetail(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string,
  ignoreMismatch: boolean
): string {
  if (!status) return t('runtimeNotChecked');
  if (status.acceleration.cudaSupported) {
    return describeWhisperAccelerationDetail(status, t);
  }
  if (status.acceleration.hardwareDetected && !status.acceleration.runtimeDetected) {
    return t('cudaRuntimeMissingDetail');
  }
  if (!ignoreMismatch && status.acceleration.fallbackReason === 'cuda-mismatch') {
    return t('cudaMismatchDetail');
  }
  return status.message ?? t('runtimeNotChecked');
}

function describeWhisperAccelerationDetail(
  status: WhisperRuntimeStatus,
  t: (key: string) => string
): string {
  if (status.acceleration.selected === 'gpu') {
    return t('gpuEnabledUsesCuda');
  }
  if (status.acceleration.requested === 'cpu') {
    return t('gpuDisabledUsesCpu');
  }
  return status.acceleration.fallbackReason ? t(fallbackReasonLabel(status.acceleration.fallbackReason)) : t('autoOption');
}

function describeCudaStatusShort(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string,
  ignoreMismatch: boolean
): string {
  if (!status) return t('notChecked');
  if (status.acceleration.cudaSupported) return t('ok');
  if (!ignoreMismatch && status.acceleration.fallbackReason === 'cuda-mismatch') return t('degraded');
  if (status.acceleration.hardwareDetected && !status.acceleration.runtimeDetected) return t('downloadCudaRuntime');
  return t('notRequired');
}

function hasBlockingCudaMismatch(status: WhisperRuntimeStatus | undefined, ignoreMismatch = false): boolean {
  if (ignoreMismatch || !status) return false;
  return status.acceleration.hardwareDetected && status.acceleration.fallbackReason === 'cuda-mismatch';
}

function fallbackReasonLabel(reason?: WhisperRuntimeStatus['acceleration']['fallbackReason']): string {
  switch (reason) {
    case 'cuda-mismatch':
      return 'cudaMismatchDetail';
    case 'cuda-unavailable':
      return 'cudaUnavailableDetail';
    case 'gpu-not-supported':
      return 'gpuNotSupportedDetail';
    default:
      return 'runtimeVariantAutomatic';
  }
}

function describeFfmpegStatusDetail(
  status: FfmpegStatus | undefined,
  t: (key: string) => string
): string {
  if (!status) return t('ffmpegNotChecked');
  if (status.available) return t('ffmpegReady');
  if (status.ffmpegAvailable || status.ffprobeAvailable) return t('ffmpegPartialDetail');
  return t('ffmpegMissingDetail');
}

function formatBytes(value: number): string {
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

function describeModelFootprint(
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
