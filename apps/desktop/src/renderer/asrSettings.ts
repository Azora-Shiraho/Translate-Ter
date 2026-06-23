import type {
  AppSettingsPublic,
  LocalAsrAcceleration,
  NativeHealth,
  ProviderAccelerationStatus,
  RuntimeVariant,
  WhisperRuntimeStatus
} from '@shared/models';

export type RuntimeVariantSelection = 'auto' | RuntimeVariant;
export type RuntimePlatformFamily = 'windows-linux' | 'mac' | 'unknown';
export type FasterWhisperWorkspaceMode = 'setup' | 'cpu-ready' | 'cuda-ready' | 'cuda-fallback';

export function deriveRuntimeVariantSelection(
  acceleration: LocalAsrAcceleration,
  preferredRuntimeVariant: RuntimeVariant | undefined
): RuntimeVariantSelection {
  if (acceleration === 'cpu') {
    return 'cpu';
  }

  return preferredRuntimeVariant ?? 'auto';
}

export function inferRuntimePlatformFamily(input: {
  runtimeStatus?: Pick<WhisperRuntimeStatus, 'platformKey'>;
  hostPlatform?: string;
  nativeHealth?: Pick<NativeHealth, 'accelerators'>;
}): RuntimePlatformFamily {
  const platformKey = input.runtimeStatus?.platformKey;
  if (platformKey?.startsWith('darwin-')) {
    return 'mac';
  }
  if (platformKey?.startsWith('win32-') || platformKey?.startsWith('linux-')) {
    return 'windows-linux';
  }

  if (input.hostPlatform === 'darwin') {
    return 'mac';
  }
  if (input.hostPlatform === 'win32' || input.hostPlatform === 'linux') {
    return 'windows-linux';
  }

  const acceleratorVariants = new Set((input.nativeHealth?.accelerators ?? []).map((item) => item.variant));
  if (acceleratorVariants.has('metal')) {
    return 'mac';
  }
  if (acceleratorVariants.has('cuda') || acceleratorVariants.has('vulkan')) {
    return 'windows-linux';
  }

  return 'unknown';
}

export function listRuntimeVariantSelections(input: {
  providerId: string;
  platformFamily: RuntimePlatformFamily;
  currentVariant?: RuntimeVariant;
}): RuntimeVariantSelection[] {
  if (input.providerId === 'cloud.openai') {
    return [];
  }

  const selections: RuntimeVariantSelection[] = ['auto', 'cpu'];

  if (input.providerId === 'local.whisper.cpp') {
    if (input.platformFamily === 'windows-linux') {
      selections.push('cuda', 'vulkan');
    } else if (input.platformFamily === 'mac') {
      selections.push('metal');
    }
  }

  if (input.providerId === 'local.faster-whisper' && input.platformFamily === 'windows-linux') {
    selections.push('cuda');
  }

  return selections;
}

export function resolveSupportedRuntimeVariantSelection(
  acceleration: LocalAsrAcceleration,
  currentVariant: RuntimeVariantSelection,
  availableVariants: RuntimeVariantSelection[]
): RuntimeVariantSelection {
  if (acceleration === 'cpu') {
    return 'cpu';
  }

  if (acceleration === 'auto') {
    return 'auto';
  }

  if (currentVariant !== 'auto' && currentVariant !== 'cpu' && availableVariants.includes(currentVariant)) {
    return currentVariant;
  }

  return 'auto';
}

export function resolveVariantSelectionForAcceleration(
  acceleration: LocalAsrAcceleration,
  currentVariant: RuntimeVariantSelection,
  availableVariants: RuntimeVariantSelection[]
): RuntimeVariantSelection {
  if (acceleration === 'auto') {
    return 'auto';
  }

  if (acceleration === 'cpu') {
    return 'cpu';
  }

  if (currentVariant !== 'auto' && currentVariant !== 'cpu' && availableVariants.includes(currentVariant)) {
    return currentVariant;
  }

  const preferredGpuVariantOrder: RuntimeVariant[] = ['cuda', 'metal', 'vulkan'];
  for (const candidate of preferredGpuVariantOrder) {
    if (availableVariants.includes(candidate)) {
      return candidate;
    }
  }

  return 'auto';
}

export function resolveAccelerationForVariantSelection(
  variantSelection: RuntimeVariantSelection,
  currentAcceleration: LocalAsrAcceleration
): LocalAsrAcceleration {
  if (variantSelection === 'auto') {
    return currentAcceleration === 'gpu' ? 'gpu' : 'auto';
  }

  if (variantSelection === 'cpu') {
    return 'cpu';
  }

  return 'gpu';
}

export function buildLocalAsrSettingsPatch(
  acceleration: LocalAsrAcceleration,
  variantSelection: RuntimeVariantSelection
): Partial<AppSettingsPublic> {
  const normalized =
    variantSelection === 'cpu'
      ? {
          localAsrAcceleration: 'cpu' as const,
          preferredRuntimeVariant: 'cpu' as const
        }
      : variantSelection === 'auto'
        ? acceleration === 'gpu'
          ? {
              localAsrAcceleration: 'gpu' as const,
              preferredRuntimeVariant: undefined
            }
          : {
              localAsrAcceleration: 'auto' as const,
              preferredRuntimeVariant: undefined
            }
        : {
            localAsrAcceleration: 'gpu' as const,
            preferredRuntimeVariant: variantSelection
          };

  return {
    ...normalized,
    ...mirrorLegacyAccelerationFields(normalized.localAsrAcceleration, normalized.preferredRuntimeVariant)
  };
}

export function buildIgnoreCudaMismatchPatch(ignoreCudaMismatch: boolean): Partial<AppSettingsPublic> {
  return {
    localAsrCompatibilityOverrides: {
      ignoreCudaMismatch
    },
    localWhisperIgnoreCudaMismatch: ignoreCudaMismatch
  };
}

export function isCudaFlowRelevant(
  providerId: string,
  platformFamily: RuntimePlatformFamily,
  variantSelection: RuntimeVariantSelection
): boolean {
  if (platformFamily !== 'windows-linux') {
    return false;
  }

  if (providerId !== 'local.whisper.cpp' && providerId !== 'local.faster-whisper') {
    return false;
  }

  return variantSelection === 'auto' || variantSelection === 'cuda';
}

export function deriveFasterWhisperWorkspaceMode(input: {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'unavailable';
  acceleration?: ProviderAccelerationStatus;
}): FasterWhisperWorkspaceMode {
  const selectedCuda =
    input.acceleration?.selected === 'gpu' || input.acceleration?.runtimeVariant === 'cuda';
  const requestedGpu = input.acceleration?.requested === 'gpu';

  if (input.ok) {
    return selectedCuda ? 'cuda-ready' : 'cpu-ready';
  }

  if (requestedGpu && input.acceleration?.selected === 'cpu' && input.status === 'degraded') {
    return 'cuda-fallback';
  }

  return 'setup';
}

function mirrorLegacyAccelerationFields(
  acceleration: LocalAsrAcceleration,
  preferredRuntimeVariant: RuntimeVariant | undefined
): Partial<AppSettingsPublic> {
  if (acceleration === 'gpu' && preferredRuntimeVariant === 'cuda') {
    return { localWhisperUseCuda: true };
  }

  if (acceleration === 'cpu' && preferredRuntimeVariant === 'cpu') {
    return { localWhisperUseCuda: false };
  }

  return {};
}
