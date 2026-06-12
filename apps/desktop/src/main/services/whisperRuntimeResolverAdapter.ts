import type { LocalAsrAcceleration, RuntimeVariant, WhisperRuntimeRequest } from '@shared/models';
import { normalizeRuntimeManifest, type NormalizedRuntimeManifest, type RuntimeManifestInput } from './runtimeManifest';
import {
  resolveRuntime,
  type RuntimeBinaryState,
  type RuntimeCapability,
  type RuntimeResolution
} from './runtimeResolver';

export type WhisperRuntimeResolverOptions = {
  acceleration: LocalAsrAcceleration;
  preferredVariant?: RuntimeVariant;
  ignoreCudaMismatch: boolean;
  preferCuda: boolean;
};

export type WhisperRuntimeResolverAdapterInput = {
  manifest: RuntimeManifestInput;
  platform: string;
  arch: string;
  modelId?: string;
  options: Pick<WhisperRuntimeResolverOptions, 'acceleration' | 'preferredVariant' | 'ignoreCudaMismatch'>;
  runtimeBinaries: Partial<Record<string, RuntimeBinaryState>>;
  modelFile: {
    exists: boolean;
    verified: boolean;
    resolvedPath?: string;
  };
  capabilities?: Partial<Record<RuntimeVariant, RuntimeCapability>>;
};

export type WhisperRuntimeResolverAdapterOutput = {
  normalizedManifest: NormalizedRuntimeManifest;
  resolution: RuntimeResolution;
};

export function resolveWhisperRuntimeRequestOptions(
  request: Pick<
    WhisperRuntimeRequest,
    'preferCuda' | 'localAsrAcceleration' | 'preferredRuntimeVariant' | 'ignoreCudaMismatch'
  >
): WhisperRuntimeResolverOptions {
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
    ignoreCudaMismatch: Boolean(request.ignoreCudaMismatch),
    preferCuda
  };
}

export function resolveWhisperRuntimeSelection(
  input: WhisperRuntimeResolverAdapterInput
): WhisperRuntimeResolverAdapterOutput {
  const normalizedManifest = normalizeRuntimeManifest(input.manifest);
  const model =
    normalizedManifest.models.find((candidate) => candidate.id === input.modelId) ?? normalizedManifest.models[0];

  const resolution = resolveRuntime({
    providerId: normalizedManifest.provider,
    runtimeProvider: normalizedManifest.provider,
    enabled: normalizedManifest.enabled,
    platform: input.platform,
    arch: input.arch,
    acceleration: input.options.acceleration,
    preferredVariant: input.options.preferredVariant,
    ignoreCudaMismatch: input.options.ignoreCudaMismatch,
    candidates: normalizedManifest.candidates,
    model,
    runtimeBinaries: input.runtimeBinaries,
    modelFile: input.modelFile,
    capabilities: input.capabilities
  });

  return {
    normalizedManifest,
    resolution
  };
}
