import { app, safeStorage } from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalSourceLanguageCode, canonicalTargetLanguageCode } from '@shared/languages';
import type {
  AppLogLevel,
  AppSettingsPatch,
  AppSettingsPublic,
  LocalAsrAcceleration,
  ProviderSecretInput,
  RuntimeVariant
} from '@shared/models';

const STATIC_DEFAULT_SETTINGS: Omit<AppSettingsPublic, 'localWhisperUseCuda' | 'localAsrAcceleration' | 'preferredRuntimeVariant'> = {
  schemaVersion: 1,
  uiLanguage: 'en-US',
  theme: 'system',
  logLevel: 'warning',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  asrProviderId: 'local.whisper.cpp',
  whisperModelId: 'ggml-base',
  localAsrCpuMode: 'balanced',
  localAsrCompatibilityOverrides: {
    ignoreCudaMismatch: false
  },
  localWhisperIgnoreCudaMismatch: false,
  allowWhisperAssetDownload: true,
  enableMultiThreadDownload: false,
  allowCloudAsrUpload: false,
  translationProviderPriority: ['openai.compatible'],
  translationConcurrency: 2,
  translationRequestsPerMinute: 60,
  translationTokenBudgetPerMinute: 60_000,
  translationLinesPerRequest: 8,
  translationBatchStride: 4,
  exportDestinationMode: 'source-directory',
  exportDirectory: '',
  exportBilingualOrder: 'source-first',
  exportFileFormat: 'srt'
};

export class SettingsStore {
  private defaultsPromise: Promise<AppSettingsPublic> | undefined;

  async get(): Promise<AppSettingsPublic> {
    const defaults = await this.defaults();
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      const parsed = JSON.parse(raw) as SettingsSource;
      return normalizeSettings({ ...defaults, ...(parsed as Partial<AppSettingsPublic>), schemaVersion: 1 }, parsed, 'load');
    } catch {
      await this.write(defaults);
      return defaults;
    }
  }

  async update(patch: AppSettingsPatch): Promise<AppSettingsPublic> {
    const current = await this.get();
    const defaults = await this.defaults();
    const next: AppSettingsPublic = {
      ...defaults,
      ...current,
      ...patch,
      schemaVersion: 1,
      translationConcurrency: clampConcurrency(patch.translationConcurrency ?? current.translationConcurrency),
      translationRequestsPerMinute: clampPositiveInteger(
        patch.translationRequestsPerMinute ?? current.translationRequestsPerMinute,
        1,
        600,
        defaults.translationRequestsPerMinute
      ),
      translationTokenBudgetPerMinute: clampPositiveInteger(
        patch.translationTokenBudgetPerMinute ?? current.translationTokenBudgetPerMinute,
        1000,
        1_000_000,
        defaults.translationTokenBudgetPerMinute
      ),
      translationLinesPerRequest: clampPositiveInteger(
        patch.translationLinesPerRequest ?? current.translationLinesPerRequest,
        1,
        32,
        defaults.translationLinesPerRequest
      ),
      translationBatchStride: clampPositiveInteger(
        patch.translationBatchStride ?? current.translationBatchStride,
        1,
        clampPositiveInteger(
          patch.translationLinesPerRequest ?? current.translationLinesPerRequest,
          1,
          32,
          defaults.translationLinesPerRequest
        ),
        defaults.translationBatchStride
      )
    };
    const normalized = normalizeSettings(next, patch as SettingsSource, 'update');
    await this.write(normalized);
    return normalized;
  }

  async setSecret(providerId: string, secret: ProviderSecretInput): Promise<void> {
    const file = this.secretPath(providerId);
    await mkdir(dirname(file), { recursive: true });

    if (!hasSecretValue(secret)) {
      await rm(file, { force: true });
      return;
    }

    const serialized = JSON.stringify(secret);
    const record = safeStorage.isEncryptionAvailable()
      ? {
          schemaVersion: 1,
          backend: 'electron.safeStorage',
          ciphertext: safeStorage.encryptString(serialized).toString('base64')
        }
      : {
          schemaVersion: 1,
          backend: 'userData.plaintext-fallback',
          warning: 'safeStorage encryption was unavailable when this secret was saved.',
          value: secret
        };

    await writeFile(file, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // Best effort on Windows; safeStorage ciphertext remains the primary protection.
    }
  }

  getSecret(providerId: string): ProviderSecretInput | undefined {
    try {
      const raw = readFileSync(this.secretPath(providerId), 'utf8');
      const record = JSON.parse(raw) as SecretRecord;
      if (record.backend === 'electron.safeStorage') {
        return JSON.parse(safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'))) as ProviderSecretInput;
      }
      return record.value;
    } catch {
      return undefined;
    }
  }

  private async defaults(): Promise<AppSettingsPublic> {
    if (!this.defaultsPromise) {
      const localWhisperUseCuda = detectCudaSupport();
      this.defaultsPromise = Promise.resolve({
        ...STATIC_DEFAULT_SETTINGS,
        ...deriveAsrSettingsFromLegacy(localWhisperUseCuda),
        localWhisperUseCuda
      });
    }
    return this.defaultsPromise;
  }

  private async write(settings: AppSettingsPublic): Promise<void> {
    const file = this.settingsPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(settings, null, 2), 'utf8');
  }

  private settingsPath(): string {
    return join(app.getPath('userData'), 'settings.json');
  }

  private secretPath(providerId: string): string {
    const safeProviderId = providerId.replace(/[^a-z0-9._-]/gi, '_');
    return join(app.getPath('userData'), 'secrets', `${safeProviderId}.json`);
  }
}

type SettingsNormalizationMode = 'default' | 'load' | 'update';

type SettingsSource = {
  localAsrAcceleration?: unknown;
  preferredRuntimeVariant?: unknown;
  localWhisperUseCuda?: unknown;
  localWhisperIgnoreCudaMismatch?: unknown;
  localAsrCompatibilityOverrides?: { ignoreCudaMismatch?: unknown } | unknown;
} & Record<string, unknown>;

function normalizeSettings(
  settings: AppSettingsPublic,
  source?: SettingsSource,
  mode: SettingsNormalizationMode = 'default'
): AppSettingsPublic {
  const usingCloudAsr = settings.asrProviderId === 'cloud.openai';
  const hasNewAccelerationFields = hasOwn(source, 'localAsrAcceleration') || hasOwn(source, 'preferredRuntimeVariant');
  const hasLegacyAccelerationField = hasOwn(source, 'localWhisperUseCuda');
  const hasNewCompatibilityField = hasOwn(source, 'localAsrCompatibilityOverrides');
  const hasLegacyCompatibilityField = hasOwn(source, 'localWhisperIgnoreCudaMismatch');
  const legacyUseCuda = Boolean(settings.localWhisperUseCuda);
  const legacyAcceleration = deriveAsrSettingsFromLegacy(legacyUseCuda);
  const localAsrAcceleration = resolveLocalAsrAcceleration(settings, source, legacyAcceleration, hasNewAccelerationFields);
  const preferredRuntimeVariant = resolvePreferredRuntimeVariant(
    settings,
    source,
    mode,
    legacyAcceleration,
    localAsrAcceleration,
    hasNewAccelerationFields,
    hasLegacyAccelerationField
  );
  const ignoreCudaMismatch = resolveIgnoreCudaMismatch(
    settings,
    source,
    hasNewCompatibilityField,
    hasLegacyCompatibilityField
  );

  return {
    ...settings,
    allowCloudAsrUpload: usingCloudAsr ? true : Boolean(settings.allowCloudAsrUpload),
    logLevel: normalizeAppLogLevel(settings.logLevel),
    localAsrAcceleration,
    localAsrCpuMode: normalizeLocalAsrCpuMode(settings.localAsrCpuMode),
    localAsrCompatibilityOverrides: {
      ignoreCudaMismatch
    },
    localWhisperUseCuda: mirrorLegacyUseCuda(
      legacyUseCuda,
      localAsrAcceleration,
      preferredRuntimeVariant,
      hasNewAccelerationFields
    ),
    localWhisperIgnoreCudaMismatch: ignoreCudaMismatch,
    preferredRuntimeVariant,
    sourceLanguage: canonicalSourceLanguageCode(settings.sourceLanguage),
    targetLanguage: canonicalTargetLanguageCode(settings.targetLanguage),
    exportFileFormat: normalizeSubtitleFileFormat(settings.exportFileFormat)
  };
}

function normalizeSubtitleFileFormat(value: unknown): 'srt' | 'ass' {
  return value === 'ass' ? 'ass' : 'srt';
}

function detectCudaSupport(): boolean {
  if (process.platform === 'win32') {
    return hasWindowsCudaRuntime();
  }

  const hasCudaEnv = Boolean(process.env.CUDA_PATH || process.env.CUDA_HOME);
  if (hasCudaEnv) return true;

  const nvidiaSmi = spawnSync('nvidia-smi', ['-L'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  if (nvidiaSmi.status === 0) return true;

  return false;
}

function hasWindowsCudaRuntime(): boolean {
  const dllNames = ['cublas64_11.dll', 'cublasLt64_11.dll'];
  const searchRoots = [
    process.env.CUDA_PATH ? join(process.env.CUDA_PATH, 'bin') : undefined,
    process.env.CUDA_HOME ? join(process.env.CUDA_HOME, 'bin') : undefined,
    ...String(process.env.PATH ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
  ].filter((entry): entry is string => Boolean(entry));

  return dllNames.every((dllName) => searchRoots.some((root) => existsSync(join(root, dllName))));
}

type SecretRecord =
  | {
      schemaVersion: 1;
      backend: 'electron.safeStorage';
      ciphertext: string;
    }
  | {
      schemaVersion: 1;
      backend: 'userData.plaintext-fallback';
      warning: string;
      value: ProviderSecretInput;
    };

function hasSecretValue(secret: ProviderSecretInput): boolean {
  return Boolean(secret.apiFormat || secret.apiKey || secret.baseUrl || secret.model);
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return STATIC_DEFAULT_SETTINGS.translationConcurrency;
  return Math.max(1, Math.min(6, Math.round(value)));
}

function clampPositiveInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function deriveAsrSettingsFromLegacy(useCuda: boolean): Pick<AppSettingsPublic, 'localAsrAcceleration' | 'preferredRuntimeVariant'> {
  return useCuda
    ? {
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda'
      }
    : {
        localAsrAcceleration: 'cpu',
        preferredRuntimeVariant: 'cpu'
      };
}

function resolveLocalAsrAcceleration(
  settings: AppSettingsPublic,
  source: SettingsSource | undefined,
  legacyAcceleration: Pick<AppSettingsPublic, 'localAsrAcceleration' | 'preferredRuntimeVariant'>,
  hasNewAccelerationFields: boolean
): LocalAsrAcceleration {
  if (hasNewAccelerationFields && hasOwn(source, 'localAsrAcceleration')) {
    return normalizeLocalAsrAcceleration(source?.localAsrAcceleration) ?? legacyAcceleration.localAsrAcceleration;
  }

  if (!hasNewAccelerationFields && hasOwn(source, 'localWhisperUseCuda')) {
    return legacyAcceleration.localAsrAcceleration;
  }

  return normalizeLocalAsrAcceleration(settings.localAsrAcceleration) ?? legacyAcceleration.localAsrAcceleration;
}

function resolvePreferredRuntimeVariant(
  settings: AppSettingsPublic,
  source: SettingsSource | undefined,
  mode: SettingsNormalizationMode,
  legacyAcceleration: Pick<AppSettingsPublic, 'localAsrAcceleration' | 'preferredRuntimeVariant'>,
  localAsrAcceleration: LocalAsrAcceleration,
  hasNewAccelerationFields: boolean,
  hasLegacyAccelerationField: boolean
): RuntimeVariant | undefined {
  if (hasNewAccelerationFields) {
    if (hasOwn(source, 'preferredRuntimeVariant')) {
      return normalizeRuntimeVariant(source?.preferredRuntimeVariant) ?? legacyAcceleration.preferredRuntimeVariant;
    }

    if (hasOwn(source, 'localAsrAcceleration') && localAsrAcceleration === 'auto') {
      return undefined;
    }

    return mode === 'update' ? normalizeRuntimeVariant(settings.preferredRuntimeVariant) : undefined;
  }

  if (hasLegacyAccelerationField) {
    return legacyAcceleration.preferredRuntimeVariant;
  }

  return normalizeRuntimeVariant(settings.preferredRuntimeVariant);
}

function resolveIgnoreCudaMismatch(
  settings: AppSettingsPublic,
  source: SettingsSource | undefined,
  hasNewCompatibilityField: boolean,
  hasLegacyCompatibilityField: boolean
): boolean {
  if (hasNewCompatibilityField) {
    return readIgnoreCudaMismatch(source?.localAsrCompatibilityOverrides) ?? Boolean(settings.localWhisperIgnoreCudaMismatch);
  }

  if (hasLegacyCompatibilityField) {
    return Boolean(settings.localWhisperIgnoreCudaMismatch);
  }

  return readIgnoreCudaMismatch(settings.localAsrCompatibilityOverrides) ?? Boolean(settings.localWhisperIgnoreCudaMismatch);
}

function mirrorLegacyUseCuda(
  currentLegacyValue: boolean,
  localAsrAcceleration: LocalAsrAcceleration,
  preferredRuntimeVariant: RuntimeVariant | undefined,
  hasNewAccelerationFields: boolean
): boolean {
  if (!hasNewAccelerationFields) {
    return currentLegacyValue;
  }

  const mirrored = mapLegacyUseCuda(localAsrAcceleration, preferredRuntimeVariant);
  return mirrored ?? currentLegacyValue;
}

function mapLegacyUseCuda(
  localAsrAcceleration: LocalAsrAcceleration,
  preferredRuntimeVariant: RuntimeVariant | undefined
): boolean | undefined {
  if (localAsrAcceleration === 'gpu' && preferredRuntimeVariant === 'cuda') {
    return true;
  }

  if (localAsrAcceleration === 'cpu' && preferredRuntimeVariant === 'cpu') {
    return false;
  }

  return undefined;
}

function normalizeLocalAsrCpuMode(value: AppSettingsPublic['localAsrCpuMode'] | undefined): AppSettingsPublic['localAsrCpuMode'] {
  return value === 'low' || value === 'high' ? value : 'balanced';
}

function normalizeLocalAsrAcceleration(value: unknown): LocalAsrAcceleration | undefined {
  return value === 'auto' || value === 'cpu' || value === 'gpu' ? value : undefined;
}

function normalizeRuntimeVariant(value: unknown): RuntimeVariant | undefined {
  return value === 'cpu' || value === 'cuda' || value === 'metal' || value === 'vulkan' ? value : undefined;
}

function normalizeAppLogLevel(value: AppLogLevel | undefined): AppLogLevel {
  return value === 'debug' || value === 'info' || value === 'error' ? value : 'warning';
}

function readIgnoreCudaMismatch(value: unknown): boolean | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'ignoreCudaMismatch')) {
    return undefined;
  }

  return Boolean((value as { ignoreCudaMismatch?: unknown }).ignoreCudaMismatch);
}

function hasOwn(value: object | undefined, key: PropertyKey): boolean {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}
