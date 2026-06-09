import { app, safeStorage } from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalSourceLanguageCode, canonicalTargetLanguageCode } from '@shared/languages';
import type { AppSettingsPatch, AppSettingsPublic, ProviderSecretInput } from '@shared/models';

const STATIC_DEFAULT_SETTINGS: Omit<AppSettingsPublic, 'localWhisperUseCuda'> = {
  schemaVersion: 1,
  uiLanguage: 'en-US',
  theme: 'system',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  asrProviderId: 'local.whisper.cpp',
  whisperModelId: 'ggml-base',
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
  exportBilingualOrder: 'source-first'
};

export class SettingsStore {
  private defaultsPromise: Promise<AppSettingsPublic> | undefined;

  async get(): Promise<AppSettingsPublic> {
    const defaults = await this.defaults();
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      return normalizeSettings({ ...defaults, ...(JSON.parse(raw) as AppSettingsPublic), schemaVersion: 1 });
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
    const normalized = normalizeSettings(next);
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
      this.defaultsPromise = Promise.resolve({
        ...STATIC_DEFAULT_SETTINGS,
        localWhisperUseCuda: detectCudaSupport()
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

function normalizeSettings(settings: AppSettingsPublic): AppSettingsPublic {
  return {
    ...settings,
    localWhisperIgnoreCudaMismatch: Boolean(settings.localWhisperIgnoreCudaMismatch),
    sourceLanguage: canonicalSourceLanguageCode(settings.sourceLanguage),
    targetLanguage: canonicalTargetLanguageCode(settings.targetLanguage)
  };
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
  return Boolean(secret.apiKey || secret.baseUrl || secret.organization || secret.model);
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return STATIC_DEFAULT_SETTINGS.translationConcurrency;
  return Math.max(1, Math.min(6, Math.round(value)));
}

function clampPositiveInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
