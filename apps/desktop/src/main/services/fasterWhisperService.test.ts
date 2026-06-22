import { describe, expect, it } from 'vitest';
import { FasterWhisperService } from './fasterWhisperService';

describe('FasterWhisperService error normalization', () => {
  it('maps huggingface download and tls failures to a readable download error', () => {
    const service = new FasterWhisperService();
    const normalized = (
      service as unknown as {
        normalizeRunnerError(error: unknown): Error & { code?: string; retryable?: boolean };
      }
    ).normalizeRunnerError(
      'huggingface_hub.errors.LocalEntryNotFoundError: Got: ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol'
    );

    expect(normalized.code).toBe('DownloadRequired');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toContain('faster-whisper 模型下载失败');
  });

  it('maps cache permission failures to a readable cache error', () => {
    const service = new FasterWhisperService();
    const normalized = (
      service as unknown as {
        normalizeRunnerError(error: unknown): Error & { code?: string; retryable?: boolean };
      }
    ).normalizeRunnerError('Permission denied: cannot write model cache');

    expect(normalized.code).toBe('DownloadRequired');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toContain('模型缓存目录不可写');
  });
});

describe('FasterWhisperService runtime status', () => {
  it('upgrades to GPU only after a CUDA probe confirms a visible device', async () => {
    const service = new FasterWhisperService();
    const internal = service as any;
    const probes: boolean[] = [];
    internal.cudaRuntimeStatus = () => ({
      hardwareDetected: false,
      runtimeDetected: true,
      cudaSupported: false
    });
    internal.detectHealthyPython = async (_modelId: string, preferCuda: boolean) => {
      probes.push(preferCuda);
      return {
        ok: true,
        command: { source: 'managed' },
        python_version: '3.11.9',
        faster_whisper_version: '1.2.1',
        ctranslate2_version: '4.8.0',
        cache_dir: 'D:/cache',
        cuda_device_count: preferCuda ? 1 : 0
      };
    };

    const health = await service.health({
      modelId: 'ggml-base',
      preferCuda: true,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda'
    });

    expect(probes).toEqual([true]);
    expect(health.acceleration?.selected).toBe('gpu');
    expect(health.acceleration?.runtimeVariant).toBe('cuda');
    expect(health.ok).toBe(true);
  });

  it('keeps the runtime failure detail when GPU fallback and CPU runtime both fail', async () => {
    const service = new FasterWhisperService();
    const internal = service as any;

    const result = internal.unavailableProviderHealth(
      'No available faster-whisper environment was found.',
      {
        requested: 'gpu',
        selected: 'cpu',
        runtimeVariant: 'cpu',
        hardwareDetected: false,
        runtimeDetected: false,
        supported: true,
        fallbackReason: 'gpu-not-detected'
      },
      'cuda'
    );

    expect(result.message).toContain('GPU mode was requested, but no NVIDIA GPU was found.');
    expect(result.message).toContain('Falling back to CPU mode.');
    expect(result.message).toContain('No available faster-whisper environment was found.');
  });
});
