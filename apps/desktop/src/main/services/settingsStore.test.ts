import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from './settingsStore';

const electronState = vi.hoisted(() => ({
  userData: ''
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronState.userData)
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${Buffer.from(value, 'utf8').toString('base64')}`)),
    decryptString: vi.fn((value: Buffer) => Buffer.from(value.toString('utf8').replace(/^enc:/, ''), 'base64').toString('utf8'))
  }
}));

function currentSettingsPath(): string {
  return join(electronState.userData, 'settings.json');
}

async function writeRawSettings(settings: Record<string, unknown>): Promise<void> {
  await writeFile(currentSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

async function readPersistedSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(currentSettingsPath(), 'utf8')) as Record<string, unknown>;
}

describe('SettingsStore', () => {
  beforeEach(async () => {
    electronState.userData = await mkdtemp(join(tmpdir(), 'translate-ter-settings-'));
  });

  afterEach(async () => {
    await rm(electronState.userData, { recursive: true, force: true });
  });

  it('keeps provider secrets out of public settings and encrypted on disk', async () => {
    const store = new SettingsStore();
    await store.setSecret('openai.compatible', {
      apiKey: 'sk-secret',
      baseUrl: 'https://example.test/v1'
    });

    const publicSettings = await store.get();
    const secretFile = await readFile(join(electronState.userData, 'secrets', 'openai.compatible.json'), 'utf8');

    expect(JSON.stringify(publicSettings)).not.toContain('sk-secret');
    expect(secretFile).not.toContain('sk-secret');
    expect(store.getSecret('openai.compatible')).toMatchObject({
      apiKey: 'sk-secret',
      baseUrl: 'https://example.test/v1'
    });
  });

  it('normalizes the log level setting', async () => {
    const store = new SettingsStore();
    await store.update({ logLevel: 'debug' });
    expect((await store.get()).logLevel).toBe('debug');

    await store.update({ logLevel: 'warning' });
    expect((await store.get()).logLevel).toBe('warning');

    const parsed = JSON.parse(await readFile(currentSettingsPath(), 'utf8')) as Record<string, unknown>;
    parsed.logLevel = 'verbose';
    await writeFile(currentSettingsPath(), JSON.stringify(parsed, null, 2), 'utf8');

    expect((await store.get()).logLevel).toBe('warning');
  });

  it('migrates legacy localWhisperUseCuda=true to gpu/cuda', async () => {
    const store = new SettingsStore();
    await writeRawSettings({
      localWhisperUseCuda: true
    });

    const settings = await store.get();

    expect(settings.localAsrAcceleration).toBe('gpu');
    expect(settings.preferredRuntimeVariant).toBe('cuda');
  });

  it('migrates legacy localWhisperUseCuda=false to cpu/cpu', async () => {
    const store = new SettingsStore();
    await writeRawSettings({
      localWhisperUseCuda: false
    });

    const settings = await store.get();

    expect(settings.localAsrAcceleration).toBe('cpu');
    expect(settings.preferredRuntimeVariant).toBe('cpu');
  });

  it('migrates legacy cuda mismatch override into localAsrCompatibilityOverrides', async () => {
    const store = new SettingsStore();
    await writeRawSettings({
      localWhisperIgnoreCudaMismatch: true
    });

    const settings = await store.get();

    expect(settings.localAsrCompatibilityOverrides.ignoreCudaMismatch).toBe(true);
    expect(settings.localWhisperIgnoreCudaMismatch).toBe(true);
  });

  it('keeps explicit new fields instead of overwriting them with legacy settings', async () => {
    const store = new SettingsStore();
    await writeRawSettings({
      localWhisperUseCuda: false,
      localWhisperIgnoreCudaMismatch: false,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      localAsrCompatibilityOverrides: {
        ignoreCudaMismatch: true
      }
    });

    const settings = await store.get();

    expect(settings.localAsrAcceleration).toBe('gpu');
    expect(settings.preferredRuntimeVariant).toBe('cuda');
    expect(settings.localAsrCompatibilityOverrides.ignoreCudaMismatch).toBe(true);
    expect(settings.localWhisperUseCuda).toBe(true);
    expect(settings.localWhisperIgnoreCudaMismatch).toBe(true);
  });

  it('normalizes invalid acceleration fields to legacy-safe values', async () => {
    const store = new SettingsStore();
    await writeRawSettings({
      localWhisperUseCuda: false,
      localAsrAcceleration: 'warp',
      preferredRuntimeVariant: 'bogus'
    });

    const settings = await store.get();

    expect(settings.localAsrAcceleration).toBe('cpu');
    expect(settings.preferredRuntimeVariant).toBe('cpu');
  });

  it('syncs new fields when only legacy cuda settings are updated and persists both shapes', async () => {
    const store = new SettingsStore();

    const settings = await store.update({
      localWhisperUseCuda: true,
      localWhisperIgnoreCudaMismatch: true
    });
    const persisted = await readPersistedSettings();

    expect(settings.localAsrAcceleration).toBe('gpu');
    expect(settings.preferredRuntimeVariant).toBe('cuda');
    expect(settings.localAsrCompatibilityOverrides.ignoreCudaMismatch).toBe(true);
    expect(persisted.localAsrAcceleration).toBe('gpu');
    expect(persisted.preferredRuntimeVariant).toBe('cuda');
    expect(persisted.localWhisperUseCuda).toBe(true);
    expect(persisted.localWhisperIgnoreCudaMismatch).toBe(true);
    expect(persisted.localAsrCompatibilityOverrides).toEqual({
      ignoreCudaMismatch: true
    });
  });

  it('clears preferredRuntimeVariant for auto acceleration without rewriting legacy cuda preference', async () => {
    const store = new SettingsStore();

    await store.update({
      localWhisperUseCuda: true
    });

    const settings = await store.update({
      localAsrAcceleration: 'auto'
    });

    expect(settings.localAsrAcceleration).toBe('auto');
    expect(settings.preferredRuntimeVariant).toBeUndefined();
    expect(settings.localWhisperUseCuda).toBe(true);
  });

  it('persists auto acceleration through the new asr fields', async () => {
    const store = new SettingsStore();

    await store.update({
      localAsrAcceleration: 'auto'
    });
    const persisted = await readPersistedSettings();

    expect(persisted.localAsrAcceleration).toBe('auto');
    expect(persisted.preferredRuntimeVariant).toBeUndefined();
  });

  it('persists cpu acceleration and mirrors legacy cuda=false', async () => {
    const store = new SettingsStore();

    await store.update({
      localAsrAcceleration: 'cpu',
      preferredRuntimeVariant: 'cpu'
    });
    const persisted = await readPersistedSettings();

    expect(persisted.localAsrAcceleration).toBe('cpu');
    expect(persisted.preferredRuntimeVariant).toBe('cpu');
    expect(persisted.localWhisperUseCuda).toBe(false);
  });

  it('persists gpu cuda acceleration and mirrors legacy cuda=true', async () => {
    const store = new SettingsStore();

    await store.update({
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda'
    });
    const persisted = await readPersistedSettings();

    expect(persisted.localAsrAcceleration).toBe('gpu');
    expect(persisted.preferredRuntimeVariant).toBe('cuda');
    expect(persisted.localWhisperUseCuda).toBe(true);
  });

  it('mirrors mappable explicit new fields back into legacy settings', async () => {
    const store = new SettingsStore();

    const settings = await store.update({
      localWhisperUseCuda: false
    });
    const updated = await store.update({
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      localAsrCompatibilityOverrides: {
        ignoreCudaMismatch: true
      }
    });

    expect(settings.localWhisperUseCuda).toBe(false);
    expect(updated.localWhisperUseCuda).toBe(true);
    expect(updated.localWhisperIgnoreCudaMismatch).toBe(true);
  });

  it('does not force legacy cuda preference changes for non-legacy runtime variants', async () => {
    const store = new SettingsStore();

    await store.update({
      localWhisperUseCuda: true
    });

    const settings = await store.update({
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'metal'
    });

    expect(settings.localAsrAcceleration).toBe('gpu');
    expect(settings.preferredRuntimeVariant).toBe('metal');
    expect(settings.localWhisperUseCuda).toBe(true);
  });
});
