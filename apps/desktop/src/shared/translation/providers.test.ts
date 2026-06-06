import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleTranslationProvider } from './providers';
import type { TranslationBatchRequest } from './types';

const request: TranslationBatchRequest = {
  batchId: 'batch-1',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  tone: 'neutral',
  segments: [{ id: 'seg-1', sourceText: 'Hello' }]
};

describe('OpenAICompatibleTranslationProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repairs fenced provider JSON before validating segment alignment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: '```json\n{"segments":[{"id":"seg-1","translatedText":"你好",},],}\n```'
              }
            }
          ],
          usage: { prompt_tokens: 5, completion_tokens: 7 }
        })
      )
    );

    const provider = new OpenAICompatibleTranslationProvider({
      id: 'openai.compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      priority: 1
    });

    await expect(provider.translateBatch(request)).resolves.toMatchObject({
      translations: [{ id: 'seg-1', translatedText: '你好' }],
      tokenUsage: { inputTokens: 5, outputTokens: 7 }
    });
  });

  it('surfaces Retry-After on provider rate limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
    );

    const provider = new OpenAICompatibleTranslationProvider({
      id: 'openai.compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      priority: 1
    });

    await expect(provider.translateBatch(request)).rejects.toMatchObject({
      code: 'RateLimited',
      retryable: true,
      retryAfterMs: 2000
    });
  });
});
