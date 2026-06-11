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

describe('SettingsStore secret storage', () => {
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

    const settingsPath = join(electronState.userData, 'settings.json');
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    parsed.logLevel = 'verbose';
    await writeFile(settingsPath, JSON.stringify(parsed, null, 2), 'utf8');

    expect((await store.get()).logLevel).toBe('warning');
  });
});
