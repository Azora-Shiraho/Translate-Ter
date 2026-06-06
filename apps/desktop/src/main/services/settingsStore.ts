import { app, safeStorage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSettingsPatch, AppSettingsPublic, ProviderSecretInput } from '@shared/models';

const DEFAULT_SETTINGS: AppSettingsPublic = {
  schemaVersion: 1,
  uiLanguage: 'en-US',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  asrProviderId: 'local.whisper.cpp',
  whisperModelId: 'ggml-base',
  translationProviderPriority: ['mock.local', 'openai.compatible'],
  translationConcurrency: 2
};

export class SettingsStore {
  async get(): Promise<AppSettingsPublic> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as AppSettingsPublic), schemaVersion: 1 };
    } catch {
      await this.write(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
  }

  async update(patch: AppSettingsPatch): Promise<AppSettingsPublic> {
    const current = await this.get();
    const next: AppSettingsPublic = {
      ...current,
      ...patch,
      schemaVersion: 1,
      translationConcurrency: clampConcurrency(patch.translationConcurrency ?? current.translationConcurrency)
    };
    await this.write(next);
    return next;
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
  return Boolean(secret.apiKey || secret.baseUrl || secret.organization);
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.translationConcurrency;
  return Math.max(1, Math.min(6, Math.round(value)));
}
