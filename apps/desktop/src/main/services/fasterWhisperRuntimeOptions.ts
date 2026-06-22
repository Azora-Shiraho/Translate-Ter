import type {
  AppSettingsPublic,
  FasterWhisperRuntimeRequest,
  LocalAsrAcceleration,
  ProviderAccelerationStatus,
  RuntimeVariant
} from '@shared/models';

type FasterWhisperRequestLike = Pick<
  FasterWhisperRuntimeRequest,
  'preferCuda' | 'localAsrAcceleration' | 'preferredRuntimeVariant'
>;

export type ResolvedFasterWhisperRequestOptions = {
  acceleration: LocalAsrAcceleration;
  preferredVariant?: RuntimeVariant;
  preferCuda: boolean;
};

export function resolveFasterWhisperRequestOptions(
  request: FasterWhisperRequestLike
): ResolvedFasterWhisperRequestOptions {
  const legacyAcceleration = request.preferCuda ? 'gpu' : 'cpu';
  const acceleration = request.localAsrAcceleration ?? legacyAcceleration;

  let preferredVariant = request.preferredRuntimeVariant;
  if (preferredVariant === undefined) {
    if (request.localAsrAcceleration === undefined) {
      preferredVariant = request.preferCuda ? 'cuda' : 'cpu';
    } else if (acceleration === 'cpu') {
      preferredVariant = 'cpu';
    }
  }

  const preferCuda =
    request.localAsrAcceleration === undefined
      ? request.preferCuda
      : acceleration === 'gpu' && preferredVariant !== 'cpu';

  return {
    acceleration,
    preferredVariant,
    preferCuda
  };
}

export function mergeFasterWhisperRuntimeRequestWithSettings(
  request: FasterWhisperRuntimeRequest,
  settings: Pick<AppSettingsPublic, 'localAsrAcceleration' | 'preferredRuntimeVariant' | 'enableMultiThreadDownload'>
): FasterWhisperRuntimeRequest {
  const hasExplicitAcceleration = request.localAsrAcceleration !== undefined;
  const hasExplicitVariant = request.preferredRuntimeVariant !== undefined;
  const isLegacyOnlyRequest = !hasExplicitAcceleration && !hasExplicitVariant;

  return {
    ...request,
    localAsrAcceleration: isLegacyOnlyRequest ? request.localAsrAcceleration : request.localAsrAcceleration ?? settings.localAsrAcceleration,
    preferredRuntimeVariant:
      isLegacyOnlyRequest
        ? request.preferredRuntimeVariant
        : request.preferredRuntimeVariant !== undefined
          ? request.preferredRuntimeVariant
          : request.localAsrAcceleration === undefined
            ? settings.preferredRuntimeVariant
            : request.localAsrAcceleration === 'cpu'
              ? 'cpu'
              : undefined,
    useMultiThreadDownload: request.useMultiThreadDownload ?? settings.enableMultiThreadDownload
  };
}

export function resolveFasterWhisperAccelerationStatus(
  request: FasterWhisperRequestLike,
  availability: {
    hardwareDetected: boolean;
    runtimeDetected: boolean;
    cudaSupported: boolean;
  }
): ProviderAccelerationStatus {
  const resolved = resolveFasterWhisperRequestOptions(request);
  const { acceleration, preferredVariant } = resolved;
  const baseStatus = {
    requested: acceleration,
    hardwareDetected: availability.hardwareDetected,
    runtimeDetected: availability.runtimeDetected
  } satisfies Pick<ProviderAccelerationStatus, 'requested' | 'hardwareDetected' | 'runtimeDetected'>;

  if (preferredVariant === 'metal' || preferredVariant === 'vulkan') {
    return {
      ...baseStatus,
      selected: 'cpu',
      runtimeVariant: 'cpu',
      supported: false,
      fallbackReason: 'preferred-variant-unavailable'
    };
  }

  if (acceleration === 'cpu' || preferredVariant === 'cpu') {
    return {
      ...baseStatus,
      selected: 'cpu',
      runtimeVariant: 'cpu',
      supported: true
    };
  }

  if (availability.cudaSupported) {
    return {
      ...baseStatus,
      selected: 'gpu',
      runtimeVariant: 'cuda',
      supported: true
    };
  }

  return {
    ...baseStatus,
    selected: 'cpu',
    runtimeVariant: 'cpu',
    supported: true,
    fallbackReason: availability.hardwareDetected ? 'gpu-runtime-missing' : 'gpu-not-detected'
  };
}
