import { describe, expect, it } from 'vitest';
import { normalizeRuntimeManifest } from './runtimeManifest';

describe('normalizeRuntimeManifest', () => {
  it('normalizes v1 win32 cpu and cuda runtimes', () => {
    const normalized = normalizeRuntimeManifest({
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
            acceleration: 'gpu',
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
    });

    expect(normalized.provider).toBe('whisper.cpp');
    expect(normalized.version).toBe('v1.8.3');
    expect(normalized.candidates).toEqual([
      expect.objectContaining({
        platform: 'win32',
        arch: 'x64',
        platformKey: 'win32-x64',
        variant: 'cpu',
        acceleration: 'cpu'
      }),
      expect.objectContaining({
        platform: 'win32',
        arch: 'x64',
        platformKey: 'win32-x64-cuda',
        variant: 'cuda',
        acceleration: 'gpu',
        cudaVersion: '11.8'
      })
    ]);
    expect(normalized.models[0]?.id).toBe('ggml-base');
  });

  it('normalizes v2 darwin arm64 metal runtime', () => {
    const normalized = normalizeRuntimeManifest({
      enabled: true,
      providers: {
        'whisper.cpp': {
          version: 'v2-preview',
          runtimes: [
            {
              platform: 'darwin',
              arch: 'arm64',
              variant: 'metal',
              binary: 'bin/whisper-cli',
              sha256: 'metal-sha',
              url: 'https://example.test/metal.tar.gz',
              acceleration: 'gpu'
            }
          ]
        }
      },
      models: []
    });

    expect(normalized.version).toBe('v2-preview');
    expect(normalized.candidates).toEqual([
      expect.objectContaining({
        platform: 'darwin',
        arch: 'arm64',
        platformKey: 'darwin-arm64-metal',
        variant: 'metal'
      })
    ]);
  });

  it('prefers v1 platform key suffix over acceleration when deriving variant', () => {
    const normalized = normalizeRuntimeManifest({
      runtime: {
        provider: 'whisper.cpp',
        platforms: {
          'darwin-arm64-metal': {
            binary: 'bin/whisper-cli',
            sha256: 'sha',
            url: 'https://example.test/runtime',
            acceleration: 'cpu'
          }
        }
      }
    });

    expect(normalized.candidates[0]?.variant).toBe('metal');
    expect(normalized.candidates[0]?.acceleration).toBe('cpu');
  });

  it('falls back to v1 acceleration when the platform key has no variant suffix', () => {
    const normalized = normalizeRuntimeManifest({
      runtime: {
        provider: 'whisper.cpp',
        platforms: {
          'darwin-arm64': {
            binary: 'bin/whisper-cli',
            sha256: 'sha',
            url: 'https://example.test/runtime',
            acceleration: 'metal'
          }
        }
      }
    });

    expect(normalized.candidates[0]?.platformKey).toBe('darwin-arm64');
    expect(normalized.candidates[0]?.variant).toBe('metal');
  });

  it('ignores unsupported runtime variants', () => {
    const normalized = normalizeRuntimeManifest({
      providers: {
        'whisper.cpp': {
          runtimes: [
            {
              platform: 'darwin',
              arch: 'arm64',
              variant: 'mlx',
              binary: 'bin/whisper-cli',
              sha256: 'sha',
              url: 'https://example.test/runtime'
            },
            {
              platform: 'linux',
              arch: 'x64',
              variant: 'vulkan',
              binary: 'bin/whisper-cli',
              sha256: 'sha2',
              url: 'https://example.test/runtime2'
            }
          ]
        }
      }
    });

    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0]?.variant).toBe('vulkan');
  });
});
