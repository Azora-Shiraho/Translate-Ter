import type { RuntimeVariant } from '@shared/models';

type RuntimeProviderId = 'whisper.cpp';

type RuntimeManifestModelInput = {
  id: string;
  displayName: string;
  languageScope: 'multilingual' | 'english-only';
  sizeBytes: number;
  estimatedVramBytes?: number;
  sha256: string;
  path: string;
  url: string | null;
};

type RuntimeManifestV1PlatformInput = {
  binary: string;
  sha256: string;
  url: string | null;
  acceleration?: string;
  cudaVersion?: string;
};

type RuntimeManifestV1Input = {
  enabled?: boolean;
  runtime?: {
    provider?: string;
    version?: string;
    platforms?: Record<string, RuntimeManifestV1PlatformInput>;
  };
  models?: RuntimeManifestModelInput[];
};

type RuntimeManifestV2Input = {
  enabled?: boolean;
  providers?: Record<
    string,
    {
      runtimes?: Array<{
        platform: string;
        arch: string;
        variant?: string;
        platformKey?: string;
        binary: string;
        sha256: string;
        url: string | null;
        acceleration?: string;
        cudaVersion?: string;
      }>;
      version?: string;
    }
  >;
  models?: RuntimeManifestModelInput[];
};

export type RuntimeManifestInput = RuntimeManifestV1Input | RuntimeManifestV2Input;

export type NormalizedRuntimeModel = {
  id: string;
  displayName: string;
  languageScope: 'multilingual' | 'english-only';
  sizeBytes: number;
  estimatedVramBytes?: number;
  sha256: string;
  path: string;
  url: string | null;
};

export type NormalizedRuntimeCandidate = {
  provider: RuntimeProviderId;
  platform: string;
  arch: string;
  platformKey: string;
  variant: RuntimeVariant;
  binary: string;
  sha256: string;
  url: string | null;
  cudaVersion?: string;
  acceleration?: string;
};

export type NormalizedRuntimeManifest = {
  enabled: boolean;
  provider: RuntimeProviderId;
  version?: string;
  candidates: NormalizedRuntimeCandidate[];
  models: NormalizedRuntimeModel[];
};

const SUPPORTED_RUNTIME_VARIANTS: ReadonlySet<RuntimeVariant> = new Set(['cpu', 'cuda', 'metal', 'vulkan']);

export function normalizeRuntimeManifest(manifest: RuntimeManifestInput): NormalizedRuntimeManifest {
  const provider = normalizeProvider(manifest);
  const models = normalizeModels(manifest.models);

  if (hasV2ProviderRuntimes(manifest)) {
    const providerEntry = manifest.providers?.[provider];
    return {
      enabled: manifest.enabled !== false,
      provider,
      version: providerEntry?.version,
      candidates: normalizeV2Candidates(provider, providerEntry?.runtimes ?? []),
      models
    };
  }

  return {
    enabled: manifest.enabled !== false,
    provider,
    version: hasV1Runtime(manifest) ? manifest.runtime?.version : undefined,
    candidates: hasV1Runtime(manifest) ? normalizeV1Candidates(provider, manifest.runtime?.platforms ?? {}) : [],
    models
  };
}

function normalizeProvider(manifest: RuntimeManifestInput): RuntimeProviderId {
  if (hasV2ProviderRuntimes(manifest) && manifest.providers?.['whisper.cpp']) {
    return 'whisper.cpp';
  }

  if (hasV1Runtime(manifest) && manifest.runtime?.provider === 'whisper.cpp') {
    return 'whisper.cpp';
  }

  return 'whisper.cpp';
}

function normalizeModels(models: RuntimeManifestInput['models']): NormalizedRuntimeModel[] {
  return Array.isArray(models)
    ? models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        languageScope: model.languageScope,
        sizeBytes: model.sizeBytes,
        estimatedVramBytes: model.estimatedVramBytes,
        sha256: model.sha256,
        path: model.path,
        url: model.url
      }))
    : [];
}

function normalizeV1Candidates(
  provider: RuntimeProviderId,
  platforms: Record<string, RuntimeManifestV1PlatformInput>
): NormalizedRuntimeCandidate[] {
  return Object.entries(platforms).flatMap(([platformKey, runtime]) => {
    const key = parsePlatformKey(platformKey, runtime.acceleration);
    if (!key) {
      return [];
    }

    return [
      {
        provider,
        platform: key.platform,
        arch: key.arch,
        platformKey,
        variant: key.variant,
        binary: runtime.binary,
        sha256: runtime.sha256,
        url: runtime.url,
        cudaVersion: runtime.cudaVersion,
        acceleration: runtime.acceleration
      }
    ];
  });
}

function normalizeV2Candidates(
  provider: RuntimeProviderId,
  runtimes: NonNullable<RuntimeManifestV2Input['providers']>[string]['runtimes']
): NormalizedRuntimeCandidate[] {
  return (runtimes ?? []).flatMap((runtime) => {
    const variant = normalizeRuntimeVariant(runtime.variant);
    if (!variant) {
      return [];
    }

    const platformKey = runtime.platformKey ?? `${runtime.platform}-${runtime.arch}${variant === 'cpu' ? '' : `-${variant}`}`;
    return [
      {
        provider,
        platform: runtime.platform,
        arch: runtime.arch,
        platformKey,
        variant,
        binary: runtime.binary,
        sha256: runtime.sha256,
        url: runtime.url,
        cudaVersion: runtime.cudaVersion,
        acceleration: runtime.acceleration
      }
    ];
  });
}

function parsePlatformKey(
  platformKey: string,
  acceleration?: string
): { platform: string; arch: string; variant: RuntimeVariant } | undefined {
  const parts = platformKey.split('-');
  if (parts.length < 2) {
    return undefined;
  }

  const [platform, arch, suffix] = parts;
  const variant = suffix ? normalizeRuntimeVariant(suffix) : normalizeV1Acceleration(acceleration) ?? 'cpu';
  if (!variant || !platform || !arch) {
    return undefined;
  }

  return { platform, arch, variant };
}

function normalizeV1Acceleration(value: unknown): RuntimeVariant | undefined {
  if (value === 'cpu' || value === 'cuda' || value === 'metal' || value === 'vulkan') {
    return value;
  }

  return undefined;
}

function normalizeRuntimeVariant(value: unknown): RuntimeVariant | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return SUPPORTED_RUNTIME_VARIANTS.has(value as RuntimeVariant) ? (value as RuntimeVariant) : undefined;
}

function hasV1Runtime(manifest: RuntimeManifestInput): manifest is RuntimeManifestV1Input {
  return typeof manifest === 'object' && manifest !== null && 'runtime' in manifest;
}

function hasV2ProviderRuntimes(manifest: RuntimeManifestInput): manifest is RuntimeManifestV2Input {
  return typeof manifest === 'object' && manifest !== null && 'providers' in manifest;
}
