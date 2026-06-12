import { describe, expect, it } from 'vitest';
import {
  resolveWhisperRuntimeRequestOptions,
  resolveWhisperRuntimeSelection
} from './whisperRuntimeResolverAdapter';

const manifestV1: Parameters<typeof resolveWhisperRuntimeSelection>[0]['manifest'] & { manifestVersion: number } = {
  manifestVersion: 1,
  enabled: true,
  runtime: {
    provider: 'whisper.cpp',
    version: 'v1.8.3',
    platforms: {
      'win32-x64': {
        binary: 'cpu/Release/whisper-cli.exe',
        sha256: 'cpu-sha',
        url: 'https://example.test/cpu.zip',
        acceleration: 'cpu'
      },
      'win32-x64-cuda': {
        binary: 'cuda/Release/whisper-cli.exe',
        sha256: 'cuda-sha',
        url: 'https://example.test/cuda.zip',
        acceleration: 'cuda',
        cudaVersion: '11.8'
      }
    }
  },
  models: [
    {
      id: 'ggml-base',
      displayName: 'Whisper base',
      languageScope: 'multilingual',
      sizeBytes: 1,
      sha256: 'model-sha',
      path: 'models/ggml-base.bin',
      url: 'https://example.test/model.bin'
    }
  ]
};

function createSelectionInput(overrides: Partial<Parameters<typeof resolveWhisperRuntimeSelection>[0]> = {}) {
  return {
    manifest: manifestV1,
    platform: 'win32',
    arch: 'x64',
    modelId: 'ggml-base',
    options: {
      acceleration: 'gpu' as const,
      preferredVariant: 'cuda' as const,
      ignoreCudaMismatch: false
    },
    runtimeBinaries: {
      'win32-x64': {
        exists: true,
        verified: true,
        resolvedPath: '.runtime/whisper_cpp/cpu/whisper-cli.exe'
      },
      'win32-x64-cuda': {
        exists: true,
        verified: true,
        resolvedPath: '.runtime/whisper_cpp/cuda/whisper-cli.exe'
      }
    },
    modelFile: {
      exists: true,
      verified: true,
      resolvedPath: '.runtime/whisper_cpp/models/ggml-base.bin'
    },
    capabilities: {
      cuda: {
        hardwareDetected: true,
        runtimeDetected: true,
        compatible: true
      }
    },
    ...overrides
  };
}

describe('resolveWhisperRuntimeRequestOptions', () => {
  it('maps legacy preferCuda=true to gpu/cuda', () => {
    const resolved = resolveWhisperRuntimeRequestOptions({
      preferCuda: true,
      ignoreCudaMismatch: false
    });

    expect(resolved.acceleration).toBe('gpu');
    expect(resolved.preferredVariant).toBe('cuda');
    expect(resolved.preferCuda).toBe(true);
  });

  it('maps legacy preferCuda=false to cpu/cpu', () => {
    const resolved = resolveWhisperRuntimeRequestOptions({
      preferCuda: false,
      ignoreCudaMismatch: false
    });

    expect(resolved.acceleration).toBe('cpu');
    expect(resolved.preferredVariant).toBe('cpu');
    expect(resolved.preferCuda).toBe(false);
  });

  it('prefers explicit new fields while keeping legacy callers valid', () => {
    const resolved = resolveWhisperRuntimeRequestOptions({
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      ignoreCudaMismatch: true
    });

    expect(resolved.acceleration).toBe('auto');
    expect(resolved.preferredVariant).toBeUndefined();
    expect(resolved.preferCuda).toBe(false);
    expect(resolved.ignoreCudaMismatch).toBe(true);
  });
});

describe('resolveWhisperRuntimeSelection', () => {
  it('supports manifest v1 input for current ensureRuntime flow', () => {
    const result = resolveWhisperRuntimeSelection(createSelectionInput());

    expect(result.normalizedManifest.candidates).toHaveLength(2);
    expect(result.resolution.variant).toBe('cuda');
    expect(result.resolution.platformKey).toBe('win32-x64-cuda');
  });

  it('selects cpu when cpu mode is requested', () => {
    const result = resolveWhisperRuntimeSelection(
      createSelectionInput({
        options: {
          acceleration: 'cpu',
          preferredVariant: 'cpu',
          ignoreCudaMismatch: false
        }
      })
    );

    expect(result.resolution.variant).toBe('cpu');
    expect(result.resolution.platformKey).toBe('win32-x64');
  });

  it('keeps cuda when windows cuda is ready', () => {
    const result = resolveWhisperRuntimeSelection(createSelectionInput());

    expect(result.resolution.variant).toBe('cuda');
    expect(result.resolution.actionRequired).toBe('none');
  });

  it('falls back to cpu when cuda runtime is missing', () => {
    const result = resolveWhisperRuntimeSelection(
      createSelectionInput({
        capabilities: {
          cuda: {
            hardwareDetected: true,
            runtimeDetected: false,
            compatible: true
          }
        }
      })
    );

    expect(result.resolution.variant).toBe('cpu');
    expect(result.resolution.fallbackReason).toBe('gpu-runtime-missing');
  });

  it('falls back to cpu on cuda mismatch when ignore is false', () => {
    const result = resolveWhisperRuntimeSelection(
      createSelectionInput({
        capabilities: {
          cuda: {
            hardwareDetected: true,
            runtimeDetected: true,
            compatible: false,
            warning: {
              code: 'cuda-version-mismatch',
              message: 'CUDA 版本不匹配'
            }
          }
        }
      })
    );

    expect(result.resolution.variant).toBe('cpu');
    expect(result.resolution.fallbackReason).toBe('gpu-not-compatible');
    expect(result.resolution.warnings).toEqual([
      {
        code: 'cuda-version-mismatch',
        message: 'CUDA 版本不匹配'
      }
    ]);
  });

  it('keeps cuda on mismatch when ignore is true', () => {
    const result = resolveWhisperRuntimeSelection(
      createSelectionInput({
        options: {
          acceleration: 'gpu',
          preferredVariant: 'cuda',
          ignoreCudaMismatch: true
        },
        capabilities: {
          cuda: {
            hardwareDetected: true,
            runtimeDetected: true,
            compatible: false,
            warning: {
              code: 'cuda-version-mismatch',
              message: 'CUDA 版本不匹配'
            }
          }
        }
      })
    );

    expect(result.resolution.variant).toBe('cuda');
    expect(result.resolution.warnings).toEqual([
      {
        code: 'cuda-version-mismatch',
        message: 'CUDA 版本不匹配'
      }
    ]);
  });
});
