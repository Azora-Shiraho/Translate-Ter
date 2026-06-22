import { describe, expect, it } from 'vitest';
import type { NativeHealth, NativeProtocolResponse, NativeProtocolType } from '@shared/models';
import { NativeBackendClient } from './nativeBackendClient';

class TestNativeBackendClient extends NativeBackendClient {
  constructor(private readonly response: NativeProtocolResponse<NativeHealth>) {
    super();
  }

  override async request<TPayload = unknown>(
    _type: NativeProtocolType,
    _payload: unknown
  ): Promise<NativeProtocolResponse<TPayload>> {
    return this.response as NativeProtocolResponse<TPayload>;
  }
}

describe('NativeBackendClient health', () => {
  it('returns fallback health with empty accelerators and legacy CUDA fields', async () => {
    const client = new TestNativeBackendClient({
      protocolVersion: 1,
      requestId: 'native-test',
      type: 'runtime.health',
      ok: false,
      error: {
        code: 'MissingRuntime',
        message: 'The local helper program is missing.',
        retryable: false
      }
    });

    const health = await client.health();

    expect(health.status).toBe('degraded');
    expect(health.accelerators).toEqual([]);
    expect(health.cudaSupported).toBe(false);
    expect(health.hardwareAcceleration).toBe('unknown');
    expect(health.recommendedLocalAcceleration).toBe('cpu');
  });

  it('accepts runtime.health payloads with accelerators and legacy CUDA fields', async () => {
    const payload: NativeHealth = {
      protocolVersion: 1,
      backendVersion: 'test',
      status: 'ok',
      capabilities: ['runtime.health'],
      accelerators: [
        {
          variant: 'cuda',
          hardwareDetected: true,
          runtimeDetected: true,
          supported: true
        },
        {
          variant: 'metal',
          hardwareDetected: false,
          runtimeDetected: false,
          supported: false,
          message: 'Metal accelerator detection is not implemented yet.'
        },
        {
          variant: 'vulkan',
          hardwareDetected: false,
          runtimeDetected: false,
          supported: false
        }
      ],
      whisperRuntimeAvailable: false,
      ffmpegAvailable: true,
      ffprobeAvailable: true,
      hardwareAcceleration: 'gpu',
      cudaSupported: true,
      recommendedLocalAcceleration: 'gpu'
    };
    const client = new TestNativeBackendClient({
      protocolVersion: 1,
      requestId: 'native-test',
      type: 'runtime.health',
      ok: true,
      payload
    });

    const health = await client.health();

    expect(health.accelerators.map((accelerator) => accelerator.variant)).toEqual(['cuda', 'metal', 'vulkan']);
    expect(health.accelerators[0]).toMatchObject({
      variant: 'cuda',
      hardwareDetected: true,
      runtimeDetected: true,
      supported: true
    });
    expect(health).toHaveProperty('cudaSupported', true);
  });
});
