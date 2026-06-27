import { describe, expect, it, vi } from 'vitest';
import type { SubtitleDocument } from '@shared/models';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/translate-ter')
  }
}));

import { NativeProtocolServiceError } from './nativeBackendClient';
import {
  assertNativeSubtitlePayload,
  NativeSubtitleService
} from './nativeSubtitleService';

function createDocument(): SubtitleDocument {
  return {
    id: 'doc-1',
    format: 'srt',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    segments: [
      {
        id: 'seg-1',
        index: 1,
        startMs: 0,
        endMs: 1000,
        sourceText: 'hello',
        translatedText: '你好',
        status: 'translated'
      }
    ],
    metadata: {
      createdAt: '2026-06-27T00:00:00.000Z',
      warnings: []
    }
  };
}

describe('NativeSubtitleService', () => {
  it('delegates SRT parsing to the native backend client', async () => {
    const document = createDocument();
    const client = {
      parseSrt: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-parse',
        type: 'srt.parse',
        ok: true,
        payload: { document }
      }),
      serializeSrt: vi.fn()
    };
    const service = new NativeSubtitleService(client as any);

    const response = await service.parseSrt('1\n00:00:00,000 --> 00:00:01,000\nhello\n', {
      inputMediaPath: 'D:/captions/demo.srt'
    });

    expect(client.parseSrt).toHaveBeenCalledWith({
      srt: '1\n00:00:00,000 --> 00:00:01,000\nhello\n',
      inputMediaPath: 'D:/captions/demo.srt'
    });
    expect(response).toMatchObject({
      ok: true,
      payload: { document }
    });
  });

  it('does not swallow typed native parse errors', async () => {
    const client = {
      parseSrt: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-parse-error',
        type: 'srt.parse',
        ok: false,
        error: {
          code: 'MissingRuntime',
          message: 'The local helper program is missing.',
          retryable: false
        }
      }),
      serializeSrt: vi.fn()
    };
    const service = new NativeSubtitleService(client as any);

    const response = await service.parseSrt('broken');

    expect(response.ok).toBe(false);
    expect(response.error).toMatchObject({
      code: 'MissingRuntime',
      message: 'The local helper program is missing.',
      retryable: false
    });
  });

  it('serializes subtitle documents through the native backend client', async () => {
    const document = createDocument();
    const client = {
      parseSrt: vi.fn(),
      serializeSrt: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-serialize',
        type: 'srt.serialize',
        ok: true,
        payload: {
          srt: '1\n00:00:00,000 --> 00:00:01,000\nhello\n你好\n'
        }
      })
    };
    const service = new NativeSubtitleService(client as any);

    const response = await service.serializeSrt(document, {
      variant: 'bilingual',
      bilingualOrder: 'source-first'
    });

    expect(client.serializeSrt).toHaveBeenCalledWith({
      segments: document.segments,
      variant: 'bilingual',
      bilingualOrder: 'source-first'
    });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        srt: '1\n00:00:00,000 --> 00:00:01,000\nhello\n你好\n'
      }
    });
  });

  it('lets callers receive identifiable subtitle errors', () => {
    const response = {
      protocolVersion: 1,
      requestId: 'native-serialize-error',
      type: 'srt.serialize',
      ok: false,
      error: {
        code: 'MissingRuntime',
        message: 'Native backend executable was not found.',
        retryable: false
      }
    } as const;

    expect(() =>
      assertNativeSubtitlePayload(response, 'The subtitle file could not be exported.')
    ).toThrowError(NativeProtocolServiceError);

    try {
      assertNativeSubtitlePayload(response, 'The subtitle file could not be exported.');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeProtocolServiceError);
      expect(error).toMatchObject({
        code: 'MissingRuntime',
        retryable: false,
        message: 'Native backend executable was not found.'
      });
    }
  });
});
