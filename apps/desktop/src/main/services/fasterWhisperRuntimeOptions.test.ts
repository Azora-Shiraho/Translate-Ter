import { describe, expect, it } from 'vitest';
import {
  mergeFasterWhisperRuntimeRequestWithSettings,
  resolveFasterWhisperAccelerationStatus,
  resolveFasterWhisperRequestOptions
} from './fasterWhisperRuntimeOptions';

describe('resolveFasterWhisperAccelerationStatus', () => {
  it('keeps CPU selected when CPU is requested even if CUDA is ready', () => {
    const status = resolveFasterWhisperAccelerationStatus(
      {
        preferCuda: true,
        localAsrAcceleration: 'cpu',
        preferredRuntimeVariant: 'cpu'
      },
      {
        hardwareDetected: true,
        runtimeDetected: true,
        cudaSupported: true
      }
    );

    expect(status.requested).toBe('cpu');
    expect(status.selected).toBe('cpu');
    expect(status.runtimeVariant).toBe('cpu');
    expect(status.supported).toBe(true);
    expect(status.fallbackReason).toBeUndefined();
  });

  it('selects CUDA when GPU is requested and CUDA is ready', () => {
    const status = resolveFasterWhisperAccelerationStatus(
      {
        preferCuda: false,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda'
      },
      {
        hardwareDetected: true,
        runtimeDetected: true,
        cudaSupported: true
      }
    );

    expect(status.requested).toBe('gpu');
    expect(status.selected).toBe('gpu');
    expect(status.runtimeVariant).toBe('cuda');
    expect(status.supported).toBe(true);
  });

  it('falls back to CPU with a structured reason when CUDA runtime is missing', () => {
    const status = resolveFasterWhisperAccelerationStatus(
      {
        preferCuda: true,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda'
      },
      {
        hardwareDetected: true,
        runtimeDetected: false,
        cudaSupported: false
      }
    );

    expect(status.requested).toBe('gpu');
    expect(status.selected).toBe('cpu');
    expect(status.runtimeVariant).toBe('cpu');
    expect(status.supported).toBe(true);
    expect(status.fallbackReason).toBe('gpu-runtime-missing');
  });

  it('keeps CPU selected when runtime files are present but hardware detection is false', () => {
    const status = resolveFasterWhisperAccelerationStatus(
      {
        preferCuda: true,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda'
      },
      {
        hardwareDetected: false,
        runtimeDetected: true,
        cudaSupported: false
      }
    );

    expect(status.hardwareDetected).toBe(false);
    expect(status.runtimeDetected).toBe(true);
    expect(status.selected).toBe('cpu');
    expect(status.runtimeVariant).toBe('cpu');
    expect(status.fallbackReason).toBe('gpu-not-detected');
  });

  it('marks metal and vulkan as unsupported and falls back to CPU', () => {
    const status = resolveFasterWhisperAccelerationStatus(
      {
        preferCuda: true,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'metal'
      },
      {
        hardwareDetected: true,
        runtimeDetected: true,
        cudaSupported: true
      }
    );

    expect(status.selected).toBe('cpu');
    expect(status.runtimeVariant).toBe('cpu');
    expect(status.supported).toBe(false);
    expect(status.fallbackReason).toBe('preferred-variant-unavailable');
  });
});

describe('resolveFasterWhisperRequestOptions', () => {
  it('maps legacy preferCuda=true to gpu/cuda', () => {
    const resolved = resolveFasterWhisperRequestOptions({
      preferCuda: true
    });

    expect(resolved.acceleration).toBe('gpu');
    expect(resolved.preferredVariant).toBe('cuda');
    expect(resolved.preferCuda).toBe(true);
  });

  it('maps legacy preferCuda=false to cpu/cpu', () => {
    const resolved = resolveFasterWhisperRequestOptions({
      preferCuda: false
    });

    expect(resolved.acceleration).toBe('cpu');
    expect(resolved.preferredVariant).toBe('cpu');
    expect(resolved.preferCuda).toBe(false);
  });
});

describe('mergeFasterWhisperRuntimeRequestWithSettings', () => {
  it('preserves explicit acceleration fields and inherits download settings', () => {
    const merged = mergeFasterWhisperRuntimeRequestWithSettings(
      {
        modelId: 'ggml-base',
        allowDownload: false,
        preferCuda: false,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda'
      },
      {
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'metal',
        enableMultiThreadDownload: true
      }
    );

    expect(merged.localAsrAcceleration).toBe('gpu');
    expect(merged.preferredRuntimeVariant).toBe('cuda');
    expect(merged.useMultiThreadDownload).toBe(true);
  });
});
