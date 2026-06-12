import type { LocalAsrAcceleration, RuntimeVariant } from '@shared/models';
import type { NormalizedRuntimeCandidate, NormalizedRuntimeModel } from './runtimeManifest';

export type RuntimeActionRequired =
  | 'manifest-not-configured'
  | 'unsupported-platform'
  | 'download-runtime'
  | 'download-model'
  | 'none';

export type RuntimeFallbackReason =
  | 'preferred-variant-unavailable'
  | 'gpu-variant-unavailable'
  | 'gpu-runtime-missing'
  | 'gpu-not-compatible'
  | 'gpu-not-detected';

export type RuntimeWarningCode = 'cuda-version-mismatch';

export type RuntimeResolverWarning = {
  code: RuntimeWarningCode;
  message: string;
};

export type RuntimeCandidate = NormalizedRuntimeCandidate;

export type RuntimeModel = NormalizedRuntimeModel;

export type RuntimeResolveRequest = {
  providerId: 'whisper.cpp';
  runtimeProvider: 'whisper.cpp';
  enabled: boolean;
  platform: string;
  arch: string;
  acceleration: LocalAsrAcceleration;
  preferredVariant?: RuntimeVariant;
  ignoreCudaMismatch: boolean;
  candidates: RuntimeCandidate[];
  model?: RuntimeModel;
  runtimeBinaries: Partial<Record<string, RuntimeBinaryState>>;
  modelFile: {
    exists: boolean;
    verified: boolean;
    resolvedPath?: string;
  };
  capabilities?: Partial<Record<RuntimeVariant, RuntimeCapability>>;
};

export type RuntimeBinaryState = {
  exists: boolean;
  verified: boolean;
  resolvedPath?: string;
};

export type RuntimeCapability = {
  hardwareDetected: boolean;
  runtimeDetected: boolean;
  compatible: boolean;
  warning?: RuntimeResolverWarning;
};

export type RuntimeResolution = {
  providerId: 'whisper.cpp';
  runtimeProvider: 'whisper.cpp';
  platformKey: string;
  variant: RuntimeVariant;
  binaryPath?: string;
  modelPath?: string;
  binaryVerified: boolean;
  modelVerified: boolean;
  hardwareDetected: boolean;
  runtimeDetected: boolean;
  supported: boolean;
  fallbackReason?: RuntimeFallbackReason;
  warnings: RuntimeResolverWarning[];
  actionRequired: RuntimeActionRequired;
};

const GPU_VARIANTS: RuntimeVariant[] = ['cuda', 'metal', 'vulkan'];

export function resolveRuntime(request: RuntimeResolveRequest): RuntimeResolution {
  const platformCandidates = request.candidates.filter(
    (candidate) => candidate.platform === request.platform && candidate.arch === request.arch
  );

  if (!request.enabled || request.candidates.length === 0) {
    return unresolved(request, {
      platformKey: `${request.platform}-${request.arch}`,
      variant: cpuPreference(request),
      actionRequired: 'manifest-not-configured'
    });
  }

  if (platformCandidates.length === 0) {
    return unresolved(request, {
      platformKey: `${request.platform}-${request.arch}`,
      variant: cpuPreference(request),
      actionRequired: 'unsupported-platform'
    });
  }

  const cpuCandidate = platformCandidates.find((candidate) => candidate.variant === 'cpu');
  const preferredVariant = normalizePreferredVariant(request);

  if (preferredVariant === 'cpu' || request.acceleration === 'cpu') {
    return finalizeCpuResolution(request, cpuCandidate, {
      fallbackReason: cpuCandidate ? undefined : 'preferred-variant-unavailable'
    });
  }

  if (request.acceleration === 'gpu') {
    const preferredGpuVariant = preferredVariant ?? defaultGpuVariant(request.platform);
    const gpuSelection = selectGpuCandidate(platformCandidates, request, preferredGpuVariant);
    if (gpuSelection.selected) {
      return finalizeResolution(request, gpuSelection.selected, gpuSelection);
    }

    return finalizeCpuResolution(request, cpuCandidate, {
      fallbackReason: gpuSelection.fallbackReason,
      warnings: gpuSelection.warnings
    });
  }

  const autoSelection = selectAutoCandidate(platformCandidates, request);
  if (autoSelection.selected) {
    return finalizeResolution(request, autoSelection.selected, autoSelection);
  }

  return finalizeCpuResolution(request, cpuCandidate, {
    fallbackReason: autoSelection.fallbackReason,
    warnings: autoSelection.warnings
  });
}

function selectAutoCandidate(
  candidates: RuntimeCandidate[],
  request: RuntimeResolveRequest
): {
  selected?: RuntimeCandidate;
  fallbackReason?: RuntimeFallbackReason;
  warnings?: RuntimeResolverWarning[];
} {
  const selectableGpuCandidates = candidates.filter((candidate) => {
    if (!GPU_VARIANTS.includes(candidate.variant)) {
      return false;
    }

    const capability = capabilityFor(candidate.variant, request);
    return capability.hardwareDetected && runtimeSelectable(candidate.variant, capability, request.ignoreCudaMismatch);
  });

  const prioritizedGpuCandidates = sortGpuCandidates(selectableGpuCandidates, request.platform);
  if (prioritizedGpuCandidates.length > 0) {
    const selected = prioritizedGpuCandidates[0];
    return {
      selected,
      warnings: warningsFor(selected.variant, request)
    };
  }

  const fallbackReason = resolveGpuFallbackReason(candidates, request);

  const warnings = candidates.flatMap((candidate) => {
    if (!GPU_VARIANTS.includes(candidate.variant)) {
      return [];
    }

    const capability = capabilityFor(candidate.variant, request);
    return capability.hardwareDetected || capability.runtimeDetected ? warningsFor(candidate.variant, request) : [];
  });

  return {
    fallbackReason,
    warnings
  };
}

function selectGpuCandidate(
  candidates: RuntimeCandidate[],
  request: RuntimeResolveRequest,
  preferredVariant: RuntimeVariant
): {
  selected?: RuntimeCandidate;
  fallbackReason?: RuntimeFallbackReason;
  warnings?: RuntimeResolverWarning[];
} {
  const preferred = candidates.find((candidate) => candidate.variant === preferredVariant);
  if (!preferred) {
    return { fallbackReason: 'preferred-variant-unavailable' };
  }

  const capability = capabilityFor(preferred.variant, request);
  if (!capability.hardwareDetected && !capability.runtimeDetected) {
    return { fallbackReason: 'gpu-not-detected' };
  }

  if (preferred.variant === 'cuda' && capability.hardwareDetected && !capability.runtimeDetected) {
    return {
      fallbackReason: 'gpu-runtime-missing',
      warnings: warningsFor(preferred.variant, request)
    };
  }

  if (!runtimeSelectable(preferred.variant, capability, request.ignoreCudaMismatch)) {
    return {
      fallbackReason: 'gpu-not-compatible',
      warnings: warningsFor(preferred.variant, request)
    };
  }

  return {
    selected: preferred,
    warnings: warningsFor(preferred.variant, request)
  };
}

function finalizeResolution(
  request: RuntimeResolveRequest,
  candidate: RuntimeCandidate | undefined,
  result: {
    fallbackReason?: RuntimeFallbackReason;
    warnings?: RuntimeResolverWarning[];
  }
): RuntimeResolution {
  const selected = candidate ?? unresolvedCandidate(request);
  const capability = capabilityFor(selected.variant, request);
  const warnings = result.warnings ?? warningsFor(selected.variant, request);
  const binaryState = runtimeBinaryStateFor(selected, request);
  const binaryVerified = binaryState.exists && binaryState.verified;
  const modelVerified = request.modelFile.exists && request.modelFile.verified;

  return {
    providerId: request.providerId,
    runtimeProvider: request.runtimeProvider,
    platformKey: selected.platformKey,
    variant: selected.variant,
    binaryPath: binaryState.resolvedPath ?? selected.binary,
    modelPath: request.modelFile.resolvedPath ?? request.model?.path,
    binaryVerified,
    modelVerified,
    hardwareDetected: capability.hardwareDetected,
    runtimeDetected: capability.runtimeDetected,
    supported: selected.platform === request.platform && selected.arch === request.arch,
    fallbackReason: result.fallbackReason,
    warnings,
    actionRequired: resolveActionRequired(request, candidate)
  };
}

function finalizeCpuResolution(
  request: RuntimeResolveRequest,
  candidate: RuntimeCandidate | undefined,
  result: {
    fallbackReason?: RuntimeFallbackReason;
    warnings?: RuntimeResolverWarning[];
  }
): RuntimeResolution {
  if (!candidate) {
    const unresolvedPlatformKey = unresolvedCpuPlatformKey(request, result.fallbackReason);
    return unresolved(request, {
      platformKey: unresolvedPlatformKey,
      variant: 'cpu',
      actionRequired: resolveActionRequired(request, undefined),
      fallbackReason: result.fallbackReason,
      warnings: result.warnings ?? []
    });
  }

  return finalizeResolution(request, candidate, result);
}

function resolveActionRequired(
  request: RuntimeResolveRequest,
  candidate: RuntimeCandidate | undefined
): RuntimeActionRequired {
  if (!request.enabled || request.candidates.length === 0) {
    return 'manifest-not-configured';
  }

  const hasPlatformCandidate = request.candidates.some(
    (entry) => entry.platform === request.platform && entry.arch === request.arch
  );
  if (!hasPlatformCandidate) {
    return 'unsupported-platform';
  }

  if (!candidate) {
    return 'download-runtime';
  }

  const binaryState = runtimeBinaryStateFor(candidate, request);
  if (!binaryState.exists || !binaryState.verified) {
    return 'download-runtime';
  }

  if (!request.modelFile.exists || !request.modelFile.verified) {
    return 'download-model';
  }

  return 'none';
}

function unresolved(
  request: RuntimeResolveRequest,
  state: {
    platformKey: string;
    variant: RuntimeVariant;
    actionRequired: RuntimeActionRequired;
    fallbackReason?: RuntimeFallbackReason;
    warnings?: RuntimeResolverWarning[];
  }
): RuntimeResolution {
  return {
    providerId: request.providerId,
    runtimeProvider: request.runtimeProvider,
    platformKey: state.platformKey,
    variant: state.variant,
    binaryPath: undefined,
    modelPath: request.modelFile.resolvedPath ?? request.model?.path,
    binaryVerified: false,
    modelVerified: request.modelFile.exists && request.modelFile.verified,
    hardwareDetected: false,
    runtimeDetected: false,
    supported: false,
    fallbackReason: state.fallbackReason,
    warnings: state.warnings ?? [],
    actionRequired: state.actionRequired
  };
}

function runtimeBinaryStateFor(candidate: RuntimeCandidate, request: RuntimeResolveRequest): RuntimeBinaryState {
  return request.runtimeBinaries[candidate.platformKey] ?? {
    exists: false,
    verified: false
  };
}

function unresolvedCandidate(request: RuntimeResolveRequest): RuntimeCandidate {
  return {
    provider: 'whisper.cpp',
    platform: request.platform,
    arch: request.arch,
    platformKey: `${request.platform}-${request.arch}`,
    variant: cpuPreference(request),
    binary: '',
    sha256: '',
    url: null
  };
}

function capabilityFor(variant: RuntimeVariant, request: RuntimeResolveRequest): RuntimeCapability {
  if (variant === 'cpu') {
    return {
      hardwareDetected: true,
      runtimeDetected: true,
      compatible: true
    };
  }

  return {
    hardwareDetected: false,
    runtimeDetected: false,
    compatible: false,
    ...request.capabilities?.[variant]
  };
}

function warningsFor(variant: RuntimeVariant, request: RuntimeResolveRequest): RuntimeResolverWarning[] {
  const warning = capabilityFor(variant, request).warning;
  return warning ? [warning] : [];
}

function resolveGpuFallbackReason(
  candidates: RuntimeCandidate[],
  request: RuntimeResolveRequest
): RuntimeFallbackReason {
  const gpuCandidates = candidates.filter((candidate) => GPU_VARIANTS.includes(candidate.variant));
  const capabilities = gpuCandidates.map((candidate) => capabilityFor(candidate.variant, request));

  const anyHardwareDetected = capabilities.some((capability) => capability.hardwareDetected);
  if (!anyHardwareDetected) {
    return 'gpu-not-detected';
  }

  const hasCudaRuntimeMissing = gpuCandidates.some((candidate) => {
    if (candidate.variant !== 'cuda') {
      return false;
    }

    const capability = capabilityFor(candidate.variant, request);
    return capability.hardwareDetected && !capability.runtimeDetected;
  });
  if (hasCudaRuntimeMissing) {
    return 'gpu-runtime-missing';
  }

  const anyRuntimeDetected = capabilities.some((capability) => capability.runtimeDetected);
  if (!anyRuntimeDetected) {
    return 'gpu-not-compatible';
  }

  return 'gpu-not-compatible';
}

function runtimeSelectable(
  variant: RuntimeVariant,
  capability: RuntimeCapability,
  ignoreCudaMismatch: boolean
): boolean {
  if (!capability.hardwareDetected) {
    return false;
  }

  if (variant === 'cuda') {
    if (!capability.runtimeDetected) {
      return false;
    }

    if (capability.compatible) {
      return true;
    }

    return ignoreCudaMismatch;
  }

  return capability.compatible;
}

function normalizePreferredVariant(request: RuntimeResolveRequest): RuntimeVariant | undefined {
  if (request.preferredVariant === 'cpu') {
    return 'cpu';
  }

  if (request.acceleration === 'cpu') {
    return 'cpu';
  }

  return request.preferredVariant;
}

function defaultGpuVariant(platform: string): RuntimeVariant {
  if (platform === 'darwin') {
    return 'metal';
  }

  return 'cuda';
}

function unresolvedCpuPlatformKey(
  request: RuntimeResolveRequest,
  fallbackReason?: RuntimeFallbackReason
): string {
  const baseKey = `${request.platform}-${request.arch}`;
  const prefersGpuFallback =
    request.acceleration !== 'cpu' &&
    fallbackReason !== undefined &&
    fallbackReason !== 'preferred-variant-unavailable';

  if (!prefersGpuFallback) {
    return baseKey;
  }

  const preferredVariant = normalizePreferredVariant(request) ?? defaultGpuVariant(request.platform);
  if (!GPU_VARIANTS.includes(preferredVariant)) {
    return baseKey;
  }

  return `${baseKey}-${preferredVariant}`;
}

function cpuPreference(request: RuntimeResolveRequest): RuntimeVariant {
  return request.preferredVariant === 'cpu' || request.acceleration === 'cpu' ? 'cpu' : 'cpu';
}

function sortGpuCandidates(candidates: RuntimeCandidate[], platform: string): RuntimeCandidate[] {
  const preferred = defaultGpuVariant(platform);
  return [...candidates].sort((left, right) => scoreVariant(right.variant, preferred) - scoreVariant(left.variant, preferred));
}

function scoreVariant(variant: RuntimeVariant, preferred: RuntimeVariant): number {
  if (variant === preferred) {
    return 3;
  }

  if (variant === 'cuda' || variant === 'metal' || variant === 'vulkan') {
    return 2;
  }

  return 0;
}
