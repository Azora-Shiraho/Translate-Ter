import { describe, expect, it } from 'vitest';
import { resolveRuntime, type RuntimeResolveRequest } from './runtimeResolver';
import type { RuntimeVariant } from '@shared/models';

function createRequest(overrides: Partial<RuntimeResolveRequest> = {}): RuntimeResolveRequest {
  return {
    providerId: 'whisper.cpp',
    runtimeProvider: 'whisper.cpp',
    enabled: true,
    platform: 'win32',
    arch: 'x64',
    acceleration: 'auto',
    ignoreCudaMismatch: false,
    candidates: [
      {
        provider: 'whisper.cpp',
        platform: 'win32',
        arch: 'x64',
        platformKey: 'win32-x64',
        variant: 'cpu',
        binary: 'cpu/Release/whisper-cli.exe',
        sha256: 'cpu-sha',
        url: 'https://example.test/cpu.zip'
      },
      {
        provider: 'whisper.cpp',
        platform: 'win32',
        arch: 'x64',
        platformKey: 'win32-x64-cuda',
        variant: 'cuda',
        binary: 'cuda/Release/whisper-cli.exe',
        sha256: 'cuda-sha',
        url: 'https://example.test/cuda.zip',
        cudaVersion: '11.8'
      }
    ],
    model: {
      id: 'ggml-base',
      displayName: 'Whisper base',
      languageScope: 'multilingual',
      sizeBytes: 1,
      sha256: 'model-sha',
      path: 'models/ggml-base.bin',
      url: 'https://example.test/model.bin'
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

function withVariantCapability(variant: RuntimeVariant, overrides: RuntimeResolveRequest['capabilities']): RuntimeResolveRequest['capabilities'] {
  return {
    [variant]: {
      hardwareDetected: true,
      runtimeDetected: true,
      compatible: true
    },
    ...overrides
  };
}

describe('resolveRuntime', () => {
  it('selects cuda for windows auto when cuda is ready', () => {
    const resolution = resolveRuntime(createRequest());

    expect(resolution.variant).toBe('cuda');
    expect(resolution.actionRequired).toBe('none');
  });

  it('falls back to cpu for windows auto when cuda runtime is missing', () => {
    const resolution = resolveRuntime(
      createRequest({
        capabilities: {
          cuda: {
            hardwareDetected: true,
            runtimeDetected: false,
            compatible: true
          }
        }
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.fallbackReason).toBe('gpu-not-compatible');
  });

  it('returns manifest-not-configured when cpu mode is forced but no cpu candidate exists', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'cpu',
        preferredVariant: 'cpu',
        candidates: [
          {
            provider: 'whisper.cpp',
            platform: 'win32',
            arch: 'x64',
            platformKey: 'win32-x64-cuda',
            variant: 'cuda',
            binary: 'cuda/Release/whisper-cli.exe',
            sha256: 'cuda-sha',
            url: 'https://example.test/cuda.zip'
          }
        ]
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.platformKey).toBe('win32-x64');
    expect(resolution.actionRequired).toBe('manifest-not-configured');
  });

  it('keeps cpu when cpu mode is forced even if cuda is ready', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'cpu',
        preferredVariant: 'cpu'
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.actionRequired).toBe('none');
  });

  it('defaults to cuda for gpu mode on windows when no preferred variant is provided', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: undefined
      })
    );

    expect(resolution.variant).toBe('cuda');
    expect(resolution.actionRequired).toBe('none');
  });

  it('treats preferred cpu variant as explicit cpu in gpu mode', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cpu'
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.actionRequired).toBe('none');
  });

  it('treats preferred cpu variant as explicit cpu in auto mode', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'auto',
        preferredVariant: 'cpu'
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.actionRequired).toBe('none');
  });

  it('falls back to cpu when preferred cuda variant is unavailable', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cuda',
        capabilities: {
          cuda: {
            hardwareDetected: false,
            runtimeDetected: false,
            compatible: false
          }
        }
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.fallbackReason).toBe('gpu-not-detected');
  });

  it('falls back to cpu on cuda mismatch when ignore is false', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cuda',
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

    expect(resolution.variant).toBe('cpu');
    expect(resolution.fallbackReason).toBe('gpu-not-compatible');
    expect(resolution.warnings).toEqual([
      {
        code: 'cuda-version-mismatch',
        message: 'CUDA 版本不匹配'
      }
    ]);
  });

  it('keeps cuda on mismatch when ignore is true and preserves warning', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cuda',
        ignoreCudaMismatch: true,
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

    expect(resolution.variant).toBe('cuda');
    expect(resolution.warnings).toHaveLength(1);
  });

  it('preserves warning when auto mode falls back to cpu on cuda mismatch', () => {
    const resolution = resolveRuntime(
      createRequest({
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

    expect(resolution.variant).toBe('cpu');
    expect(resolution.fallbackReason).toBe('gpu-not-compatible');
    expect(resolution.warnings).toEqual([
      {
        code: 'cuda-version-mismatch',
        message: 'CUDA 版本不匹配'
      }
    ]);
  });

  it('selects metal for macOS auto when metal is ready', () => {
    const resolution = resolveRuntime(
      createRequest({
        platform: 'darwin',
        arch: 'arm64',
        candidates: [
          {
            provider: 'whisper.cpp',
            platform: 'darwin',
            arch: 'arm64',
            platformKey: 'darwin-arm64',
            variant: 'cpu',
            binary: 'bin/whisper-cli',
            sha256: 'cpu-sha',
            url: 'https://example.test/cpu'
          },
          {
            provider: 'whisper.cpp',
            platform: 'darwin',
            arch: 'arm64',
            platformKey: 'darwin-arm64-metal',
            variant: 'metal',
            binary: 'bin/whisper-cli',
            sha256: 'metal-sha',
            url: 'https://example.test/metal'
          }
        ],
        capabilities: withVariantCapability('metal', {})
      })
    );

    expect(resolution.variant).toBe('metal');
  });

  it('returns download-runtime when runtime binary is missing', () => {
    const resolution = resolveRuntime(
      createRequest({
        runtimeBinaries: {
          'win32-x64': {
            exists: false,
            verified: false
          },
          'win32-x64-cuda': {
            exists: false,
            verified: false
          }
        }
      })
    );

    expect(resolution.actionRequired).toBe('download-runtime');
  });

  it('returns download-model when model is missing', () => {
    const resolution = resolveRuntime(
      createRequest({
        modelFile: {
          exists: false,
          verified: false
        }
      })
    );

    expect(resolution.actionRequired).toBe('download-model');
  });

  it('prefers download-runtime when runtime binary and model are both missing', () => {
    const resolution = resolveRuntime(
      createRequest({
        runtimeBinaries: {
          'win32-x64': {
            exists: false,
            verified: false
          },
          'win32-x64-cuda': {
            exists: false,
            verified: false
          }
        },
        modelFile: {
          exists: false,
          verified: false
        }
      })
    );

    expect(resolution.actionRequired).toBe('download-runtime');
  });

  it('returns download-runtime when selected cuda runtime is missing even if cpu runtime exists', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cuda',
        runtimeBinaries: {
          'win32-x64': {
            exists: true,
            verified: true,
            resolvedPath: '.runtime/whisper_cpp/cpu/whisper-cli.exe'
          },
          'win32-x64-cuda': {
            exists: false,
            verified: false
          }
        }
      })
    );

    expect(resolution.variant).toBe('cuda');
    expect(resolution.binaryPath).toBe('cuda/Release/whisper-cli.exe');
    expect(resolution.actionRequired).toBe('download-runtime');
  });

  it('returns manifest-not-configured when runtime manifest is disabled', () => {
    const resolution = resolveRuntime(
      createRequest({
        enabled: false
      })
    );

    expect(resolution.actionRequired).toBe('manifest-not-configured');
  });

  it('returns manifest-not-configured when gpu fallback has no cpu candidate', () => {
    const resolution = resolveRuntime(
      createRequest({
        acceleration: 'gpu',
        preferredVariant: 'cuda',
        candidates: [
          {
            provider: 'whisper.cpp',
            platform: 'win32',
            arch: 'x64',
            platformKey: 'win32-x64-cuda',
            variant: 'cuda',
            binary: 'cuda/Release/whisper-cli.exe',
            sha256: 'cuda-sha',
            url: 'https://example.test/cuda.zip'
          }
        ],
        capabilities: {
          cuda: {
            hardwareDetected: false,
            runtimeDetected: false,
            compatible: false
          }
        }
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.actionRequired).toBe('manifest-not-configured');
  });

  it('returns unsupported-platform when manifest has no runtime for current platform', () => {
    const resolution = resolveRuntime(
      createRequest({
        platform: 'linux',
        arch: 'arm64'
      })
    );

    expect(resolution.actionRequired).toBe('unsupported-platform');
  });

  it('ignores non-current-platform candidates during selection', () => {
    const resolution = resolveRuntime(
      createRequest({
        candidates: [
          {
            provider: 'whisper.cpp',
            platform: 'linux',
            arch: 'x64',
            platformKey: 'linux-x64-cuda',
            variant: 'cuda',
            binary: 'bin/whisper-cli',
            sha256: 'linux-cuda',
            url: 'https://example.test/linux-cuda'
          },
          {
            provider: 'whisper.cpp',
            platform: 'win32',
            arch: 'x64',
            platformKey: 'win32-x64',
            variant: 'cpu',
            binary: 'cpu/Release/whisper-cli.exe',
            sha256: 'cpu-sha',
            url: 'https://example.test/cpu.zip'
          }
        ],
        capabilities: {
          cuda: {
            hardwareDetected: true,
            runtimeDetected: true,
            compatible: true
          }
        }
      })
    );

    expect(resolution.variant).toBe('cpu');
    expect(resolution.platformKey).toBe('win32-x64');
  });
});
