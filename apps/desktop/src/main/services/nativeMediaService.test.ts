import { describe, expect, it, vi } from 'vitest';
import { NativeMediaService } from './nativeMediaService';

describe('NativeMediaService', () => {
  it('returns native media probe success payloads unchanged', async () => {
    const client = {
      probeMedia: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-probe',
        type: 'media.probe',
        ok: true,
        payload: {
          tool: 'ffprobe',
          raw: {
            streams: []
          }
        }
      }),
      extractAudio: vi.fn()
    };
    const service = new NativeMediaService(client as any);

    const response = await service.probeMedia({ mediaPath: 'D:/media/demo.wav' });

    expect(client.probeMedia).toHaveBeenCalledWith({ mediaPath: 'D:/media/demo.wav' });
    expect(response).toMatchObject({
      ok: true,
      payload: {
        tool: 'ffprobe'
      }
    });
  });

  it('returns typed native media errors unchanged', async () => {
    const client = {
      probeMedia: vi.fn(),
      extractAudio: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-extract-error',
        type: 'audio.extract',
        ok: false,
        error: {
          code: 'MissingRuntime',
          message: 'FFmpeg is missing, so audio cannot be extracted yet.',
          retryable: false
        }
      })
    };
    const service = new NativeMediaService(client as any);

    const response = await service.extractAudio({ mediaPath: 'D:/media/demo.mp4' });

    expect(response.ok).toBe(false);
    expect(response.error).toMatchObject({
      code: 'MissingRuntime',
      message: 'FFmpeg is missing, so audio cannot be extracted yet.',
      retryable: false
    });
  });

  it('normalizes thrown probe failures into typed protocol errors', async () => {
    const client = {
      probeMedia: vi.fn().mockRejectedValue(new Error('spawn ENOENT')),
      extractAudio: vi.fn()
    };
    const service = new NativeMediaService(client as any);

    const response = await service.probeMedia({ mediaPath: 'D:/media/demo.mp4' });

    expect(response.ok).toBe(false);
    expect(response.error).toMatchObject({
      code: 'InternalError',
      message: 'spawn ENOENT',
      retryable: true
    });
  });

  it('normalizes malformed native extract success payloads to avoid undefined crashes', async () => {
    const client = {
      probeMedia: vi.fn(),
      extractAudio: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        requestId: 'native-extract-malformed',
        type: 'audio.extract',
        ok: true
      })
    };
    const service = new NativeMediaService(client as any);

    const response = await service.extractAudio({ mediaPath: 'D:/media/demo.mp4' });

    expect(response.ok).toBe(false);
    expect(response.error).toMatchObject({
      code: 'InternalError',
      message: 'The native audio extractor returned no payload.',
      retryable: true
    });
  });
});
