import { describe, expect, it, vi } from 'vitest';
import { JobManager } from './jobManager';
import type { AppSettingsPublic, CreateJobRequest, WhisperRuntimeStatus } from '@shared/models';

function createSettings() {
  const settings: AppSettingsPublic = {
    schemaVersion: 1,
    uiLanguage: 'en-US',
    theme: 'system',
    logLevel: 'info',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    asrProviderId: 'local.whisper.cpp',
    whisperModelId: 'ggml-base',
    localAsrAcceleration: 'auto',
    preferredRuntimeVariant: undefined,
    localWhisperUseCuda: true,
    localAsrCpuMode: 'balanced',
    localAsrCompatibilityOverrides: {
      ignoreCudaMismatch: false
    },
    localWhisperIgnoreCudaMismatch: false,
    allowWhisperAssetDownload: true,
    enableMultiThreadDownload: false,
    allowCloudAsrUpload: false,
    translationProviderPriority: ['openai.compatible'],
    translationConcurrency: 2,
    translationRequestsPerMinute: 60,
    translationTokenBudgetPerMinute: 60000,
    translationLinesPerRequest: 8,
    translationBatchStride: 4,
    exportDestinationMode: 'source-directory',
    exportDirectory: '',
    exportBilingualOrder: 'source-first'
  };

  return {
    get: vi.fn().mockResolvedValue(settings),
    getSecret: vi.fn()
  };
}

function createRuntimeStatus(overrides: Partial<WhisperRuntimeStatus> = {}): WhisperRuntimeStatus {
  return {
    provider: 'whisper.cpp',
    platformKey: 'win32-x64',
    cacheDir: 'D:/runtime/whisper_cpp',
    binary: {
      expectedPath: 'D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe',
      installed: true,
      verified: true
    },
    model: {
      id: 'ggml-base',
      expectedPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin',
      installed: true,
      verified: true
    },
    acceleration: {
      requested: 'gpu',
      selected: 'cpu',
      cudaSupported: false,
      hardwareDetected: true,
      runtimeDetected: false,
      versionMismatch: false,
      runtimeVariant: 'cpu',
      fallbackReason: 'gpu-runtime-missing'
    },
    actionRequired: 'none',
    message: 'whisper.cpp runtime is ready.',
    ...overrides
  };
}

function createRequest(overrides: Partial<CreateJobRequest> = {}): CreateJobRequest {
  return {
    mediaPath: 'D:/media/demo.mp4',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    asrProviderId: 'local.whisper.cpp',
    whisperModelId: 'ggml-base',
    localWhisperUseCuda: true,
    localAsrAcceleration: 'auto',
    preferredRuntimeVariant: undefined,
    localAsrCpuMode: 'balanced',
    localWhisperIgnoreCudaMismatch: false,
    allowWhisperAssetDownload: true,
    allowCloudAsrUpload: false,
    translationProviderPriority: ['openai.compatible'],
    ...overrides
  };
}

describe('JobManager', () => {
  it('preserves unsupported-platform as job error code', async () => {
    const settings = createSettings();
    const whisperAssets = {
      ensureRuntime: vi.fn().mockResolvedValue(
        createRuntimeStatus({
          actionRequired: 'unsupported-platform',
          message: 'This version does not provide a local Whisper program for your computer yet.'
        })
      )
    };
    const nativeBackend = {
      health: vi.fn().mockResolvedValue({
        capabilities: ['asr.transcribe'],
        protocolVersion: 1,
        backendVersion: 'test',
        status: 'ok',
        whisperRuntimeAvailable: true,
        hardwareAcceleration: 'gpu',
        cudaSupported: true,
        recommendedLocalAcceleration: 'gpu'
      })
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const manager = new JobManager(settings as any, whisperAssets as any, nativeBackend as any, fasterWhisper as any);
    const job = manager.create(createRequest());

    await manager.start(job.id);

    const failed = manager.get(job.id);
    expect(failed.stage).toBe('failed');
    expect(failed.error?.code).toBe('UnsupportedPlatform');
    expect(failed.error?.retryable).toBe(false);
  });

  it('passes preferCuda=false to native backend when resolver selected cpu fallback', async () => {
    const settings = createSettings();
    const whisperAssets = {
      ensureRuntime: vi.fn().mockResolvedValue(createRuntimeStatus())
    };
    const nativeBackend = {
      health: vi.fn().mockResolvedValue({
        capabilities: ['asr.transcribe'],
        protocolVersion: 1,
        backendVersion: 'test',
        status: 'ok',
        whisperRuntimeAvailable: true,
        hardwareAcceleration: 'gpu',
        cudaSupported: true,
        recommendedLocalAcceleration: 'gpu'
      }),
      probeMedia: vi.fn().mockResolvedValue({
        ok: true,
        payload: {}
      }),
      extractAudio: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          audioPath: 'D:/media/demo.wav'
        }
      }),
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          document: {
            id: 'doc-1',
            format: 'srt',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            segments: [],
            metadata: {
              createdAt: new Date().toISOString(),
              warnings: []
            }
          }
        }
      }),
      cancelRunningWork: vi.fn()
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const manager = new JobManager(settings as any, whisperAssets as any, nativeBackend as any, fasterWhisper as any);
    const job = manager.create(createRequest());

    await manager.start(job.id);

    expect(nativeBackend.transcribe).toHaveBeenCalledTimes(1);
    expect(nativeBackend.transcribe.mock.calls[0][0].preferCuda).toBe(false);
    expect(nativeBackend.transcribe.mock.calls[0][0].binaryPath).toBe('D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe');
    expect(nativeBackend.transcribe.mock.calls[0][0].modelPath).toBe('D:/runtime/whisper_cpp/models/ggml-base.bin');
    expect(nativeBackend.transcribe.mock.calls[0][0].runtime).toEqual({
      provider: 'whisper.cpp',
      variant: 'cpu',
      binaryPath: 'D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });
  });

  it('passes runtime.variant=cuda to native backend when resolver selected gpu runtime', async () => {
    const settings = createSettings();
    const whisperAssets = {
      ensureRuntime: vi.fn().mockResolvedValue(
        createRuntimeStatus({
          platformKey: 'win32-x64-cuda',
          binary: {
            expectedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
            installed: true,
            verified: true
          },
          acceleration: {
            requested: 'gpu',
            selected: 'gpu',
            cudaSupported: true,
            hardwareDetected: true,
            runtimeDetected: true,
            versionMismatch: false,
            runtimeVariant: 'cuda'
          }
        })
      )
    };
    const nativeBackend = {
      health: vi.fn().mockResolvedValue({
        capabilities: ['asr.transcribe'],
        protocolVersion: 1,
        backendVersion: 'test',
        status: 'ok',
        whisperRuntimeAvailable: true,
        hardwareAcceleration: 'gpu',
        cudaSupported: true,
        recommendedLocalAcceleration: 'gpu'
      }),
      probeMedia: vi.fn().mockResolvedValue({
        ok: true,
        payload: {}
      }),
      extractAudio: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          audioPath: 'D:/media/demo.wav'
        }
      }),
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          document: {
            id: 'doc-1',
            format: 'srt',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            segments: [],
            metadata: {
              createdAt: new Date().toISOString(),
              warnings: []
            }
          }
        }
      }),
      cancelRunningWork: vi.fn()
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const manager = new JobManager(settings as any, whisperAssets as any, nativeBackend as any, fasterWhisper as any);
    const job = manager.create(createRequest());

    await manager.start(job.id);

    expect(nativeBackend.transcribe).toHaveBeenCalledTimes(1);
    expect(nativeBackend.transcribe.mock.calls[0][0].preferCuda).toBe(true);
    expect(nativeBackend.transcribe.mock.calls[0][0].binaryPath).toBe('D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe');
    expect(nativeBackend.transcribe.mock.calls[0][0].modelPath).toBe('D:/runtime/whisper_cpp/models/ggml-base.bin');
    expect(nativeBackend.transcribe.mock.calls[0][0].runtime).toEqual({
      provider: 'whisper.cpp',
      variant: 'cuda',
      binaryPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });
  });

  it('keeps local.faster-whisper on FasterWhisperService instead of native backend', async () => {
    const settings = createSettings();
    const whisperAssets = {
      ensureRuntime: vi.fn()
    };
    const nativeBackend = {
      health: vi.fn().mockResolvedValue({
        capabilities: ['asr.transcribe'],
        protocolVersion: 1,
        backendVersion: 'test',
        status: 'ok',
        whisperRuntimeAvailable: true,
        hardwareAcceleration: 'gpu',
        cudaSupported: true,
        recommendedLocalAcceleration: 'gpu'
      }),
      probeMedia: vi.fn().mockResolvedValue({
        ok: true,
        payload: {}
      }),
      extractAudio: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          audioPath: 'D:/media/demo.wav'
        }
      }),
      transcribe: vi.fn(),
      cancelRunningWork: vi.fn()
    };
    const fasterWhisper = {
      transcribe: vi.fn().mockResolvedValue({
        id: 'doc-1',
        format: 'srt',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        segments: [],
        metadata: {
          createdAt: new Date().toISOString(),
          warnings: []
        }
      }),
      cancel: vi.fn()
    };
    const manager = new JobManager(settings as any, whisperAssets as any, nativeBackend as any, fasterWhisper as any);
    const job = manager.create(
      createRequest({
        asrProviderId: 'local.faster-whisper'
      })
    );

    await manager.start(job.id);

    expect(whisperAssets.ensureRuntime).not.toHaveBeenCalled();
    expect(fasterWhisper.transcribe).toHaveBeenCalledTimes(1);
    expect(nativeBackend.transcribe).not.toHaveBeenCalled();
  });

  it('forces runtime.variant=cpu during local whisper cpu retry fallback', async () => {
    const settings = createSettings();
    const whisperAssets = {
      ensureRuntime: vi.fn().mockResolvedValue(
        createRuntimeStatus({
          platformKey: 'win32-x64-cuda',
          binary: {
            expectedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
            installed: true,
            verified: true
          },
          acceleration: {
            requested: 'gpu',
            selected: 'gpu',
            cudaSupported: true,
            hardwareDetected: true,
            runtimeDetected: true,
            versionMismatch: false,
            runtimeVariant: 'cuda'
          }
        })
      )
    };
    const nativeBackend = {
      health: vi.fn().mockResolvedValue({
        capabilities: ['asr.transcribe'],
        protocolVersion: 1,
        backendVersion: 'test',
        status: 'ok',
        whisperRuntimeAvailable: true,
        hardwareAcceleration: 'gpu',
        cudaSupported: true,
        recommendedLocalAcceleration: 'gpu'
      }),
      probeMedia: vi.fn().mockResolvedValue({
        ok: true,
        payload: {}
      }),
      extractAudio: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          audioPath: 'D:/media/demo.wav'
        }
      }),
      transcribe: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          error: {
            code: 'InternalError',
            message: 'process exited with 0xC0000409',
            retryable: true
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          payload: {
            document: {
              id: 'doc-1',
              format: 'srt',
              sourceLanguage: 'en',
              targetLanguage: 'zh-CN',
              segments: [],
              metadata: {
                createdAt: new Date().toISOString(),
                warnings: []
              }
            }
          }
        }),
      cancelRunningWork: vi.fn()
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const manager = new JobManager(settings as any, whisperAssets as any, nativeBackend as any, fasterWhisper as any);
    const job = manager.create(createRequest());

    await manager.start(job.id);

    expect(nativeBackend.transcribe).toHaveBeenCalledTimes(2);
    expect(nativeBackend.transcribe.mock.calls[0][0].runtime.variant).toBe('cuda');
    expect(nativeBackend.transcribe.mock.calls[1][0].preferCuda).toBe(false);
    expect(nativeBackend.transcribe.mock.calls[1][0].runtime.variant).toBe('cpu');
  });
});
