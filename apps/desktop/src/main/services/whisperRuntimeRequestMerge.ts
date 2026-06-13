import type { AppSettingsPublic, WhisperRuntimeRequest } from '@shared/models';

export function mergeWhisperRuntimeRequestWithSettings(
  request: WhisperRuntimeRequest,
  settings: Pick<AppSettingsPublic, 'localAsrAcceleration' | 'preferredRuntimeVariant' | 'enableMultiThreadDownload'>
): WhisperRuntimeRequest {
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
