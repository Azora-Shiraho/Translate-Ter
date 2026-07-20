import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBasicProviderHealth, testOpenAICompatibleProvider } from './providerHealth';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('providerHealth', () => {
  it('returns unconfigured when the API key is missing', async () => {
    await expect(
      testOpenAICompatibleProvider({
        providerId: 'openai.compatible',
        secret: undefined,
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini'
      })
    ).resolves.toMatchObject({
      providerId: 'openai.compatible',
      ok: false,
      status: 'unconfigured',
      userMessage: { messageKey: 'runtimeMessage.providerApiKeyMissing' }
    });
  });

  it('maps HTTP 429 to degraded health status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('{"error":{"message":"slow down"}}')
      })
    );

    await expect(
      testOpenAICompatibleProvider({
        providerId: 'openai.compatible',
        secret: {
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1'
        },
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini'
      })
    ).resolves.toMatchObject({
      providerId: 'openai.compatible',
      ok: false,
      status: 'degraded',
      message: 'HTTP 429: slow down',
      userMessage: {
        messageKey: 'runtimeMessage.providerRateLimited',
        technicalMessage: 'HTTP 429: slow down'
      }
    });
  });

  it('creates basic healthy and unhealthy provider health objects', () => {
    expect(createBasicProviderHealth('mock.local', { ok: true, message: 'ready' })).toEqual({
      providerId: 'mock.local',
      ok: true,
      status: 'healthy',
      message: 'ready'
    });
    expect(createBasicProviderHealth('mock.local', { ok: false, message: 'offline' }, 'degraded')).toEqual({
      providerId: 'mock.local',
      ok: false,
      status: 'degraded',
      message: 'offline'
    });
  });
});
