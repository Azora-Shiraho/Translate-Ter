import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import type { AppSettingsPublic, JobSnapshot, WhisperRuntimeStatus } from '@shared/models';
import { createAsrProviderRegistry, createMainAsrProviderRegistry } from '../providers/asrProviderRegistry';
import { createMainTranslationProviderRegistry } from '../providers/translationProviderRegistry';
import { createCloudOpenAiAsrProvider } from '../providers/adapters/cloudOpenAiAsrProvider';
import { createFasterWhisperAsrProvider } from '../providers/adapters/fasterWhisperAsrProvider';
import { createLocalWhisperCppAsrProvider } from '../providers/adapters/localWhisperCppAsrProvider';

function createSettingsValue(): AppSettingsPublic {
  return {
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
    enableMultiThreadDownload: true,
    allowCloudAsrUpload: false,
    translationProviderPriority: ['openai.compatible'],
    translationConcurrency: 2,
    translationRequestsPerMinute: 60,
    translationTokenBudgetPerMinute: 60000,
    translationLinesPerRequest: 8,
    translationBatchStride: 4,
    exportDestinationMode: 'source-directory',
    exportDirectory: '',
    exportBilingualOrder: 'source-first',
    exportFileFormat: 'srt',
    exportBatchWithLanguageSuffix: false
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

function createJob(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    mediaPath: 'D:/media/demo.mp4',
    fileName: 'demo.mp4',
    step: 'asr',
    stage: 'transcribing',
    progress: 72,
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
    translationConcurrency: 2,
    translationRequestsPerMinute: 60,
    translationTokenBudgetPerMinute: 60000,
    translationLinesPerRequest: 8,
    translationBatchStride: 4,
    warnings: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('provider registries and adapters', () => {
  it('rejects unknown provider ids when registering ASR adapters', () => {
    expect(() =>
      createAsrProviderRegistry([
        {
          id: 'unknown.provider',
          health: vi.fn(),
          transcribe: vi.fn()
        }
      ] as any)
    ).toThrowError('Provider unknown.provider is not a known asr provider in the shared catalog.');
  });

  it('local whisper adapter keeps the native payload unchanged for cpu fallback selection', async () => {
    const nativeTranscribe = vi.fn().mockResolvedValue({
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
    });
    const adapter = createLocalWhisperCppAsrProvider({
      settingsStore: {
        get: vi.fn().mockResolvedValue(createSettingsValue())
      } as any,
      whisperAssets: {
        ensureRuntime: vi.fn().mockResolvedValue(createRuntimeStatus())
      } as any,
      nativeBackend: {
        transcribe: nativeTranscribe
      } as any
    });

    await adapter.transcribe({
      job: createJob(),
      settings: createSettingsValue(),
      audioPath: 'D:/media/demo.wav'
    });

    expect(nativeTranscribe).toHaveBeenCalledTimes(1);
    expect(nativeTranscribe.mock.calls[0][0].preferCuda).toBe(false);
    expect(nativeTranscribe.mock.calls[0][0].binaryPath).toBe('D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe');
    expect(nativeTranscribe.mock.calls[0][0].modelPath).toBe('D:/runtime/whisper_cpp/models/ggml-base.bin');
    expect(nativeTranscribe.mock.calls[0][0].runtime).toEqual({
      provider: 'whisper.cpp',
      variant: 'cpu',
      binaryPath: 'D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });
  });

  it('local whisper adapter retries with a cpu runtime payload after a gpu crash', async () => {
    const nativeBackend = {
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
        })
    };
    const adapter = createLocalWhisperCppAsrProvider({
      settingsStore: {
        get: vi.fn().mockResolvedValue(createSettingsValue())
      } as any,
      whisperAssets: {
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
      } as any,
      nativeBackend: nativeBackend as any
    });
    const job = createJob();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    const document = await adapter.transcribe({
      job,
      settings: createSettingsValue(),
      audioPath: 'D:/media/demo.wav',
      reportProgress
    });

    expect(nativeBackend.transcribe).toHaveBeenCalledTimes(2);
    expect(nativeBackend.transcribe.mock.calls[0][0].runtime.variant).toBe('cuda');
    expect(nativeBackend.transcribe.mock.calls[1][0].preferCuda).toBe(false);
    expect(nativeBackend.transcribe.mock.calls[1][0].runtime.variant).toBe('cpu');
    expect(reportProgress).toHaveBeenCalledWith(78, 'GPU recognition stopped. Retrying with CPU.');
    expect(document.metadata.warnings.some((warning) => warning.code === 'CudaTranscriptionCrashFallback')).toBe(true);
  });

  it('local whisper adapter skips the cpu retry when the job has been cancelled', async () => {
    const nativeBackend = {
      transcribe: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'InternalError',
          message: 'process exited with 0xC0000409',
          retryable: true
        }
      })
    };
    const adapter = createLocalWhisperCppAsrProvider({
      settingsStore: {
        get: vi.fn().mockResolvedValue(createSettingsValue())
      } as any,
      whisperAssets: {
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
      } as any,
      nativeBackend: nativeBackend as any
    });

    await expect(
      adapter.transcribe({
        job: createJob(),
        settings: createSettingsValue(),
        audioPath: 'D:/media/demo.wav',
        isCancelled: () => true,
        reportProgress: vi.fn()
      })
    ).rejects.toMatchObject({
      name: 'AbortError'
    });

    expect(nativeBackend.transcribe).toHaveBeenCalledTimes(1);
  });

  it('faster-whisper adapter preserves runtime option merge inputs', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      id: 'doc-1',
      format: 'srt',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [],
      metadata: {
        createdAt: new Date().toISOString(),
        warnings: []
      }
    });
    const adapter = createFasterWhisperAsrProvider({
      settingsStore: {
        get: vi.fn().mockResolvedValue(createSettingsValue())
      } as any,
      fasterWhisper: {
        health: vi.fn(),
        transcribe
      } as any
    });

    await adapter.transcribe({
      job: createJob({
        asrProviderId: 'local.faster-whisper',
        allowWhisperAssetDownload: false
      }),
      settings: createSettingsValue(),
      audioPath: 'D:/media/demo.wav'
    });

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        audioPath: 'D:/media/demo.wav',
        preferCuda: true,
        allowDownload: false,
        useMultiThreadDownload: true
      })
    );
  });

  it('cloud and translation registry health keep unconfigured status when apiKey is missing', async () => {
    const settingsStore = {
      get: vi.fn().mockResolvedValue(createSettingsValue()),
      getSecret: vi.fn().mockReturnValue(undefined)
    };
    const asrRegistry = createMainAsrProviderRegistry({
      settingsStore: settingsStore as any,
      whisperAssets: {
        ensureRuntime: vi.fn().mockResolvedValue(createRuntimeStatus())
      } as any,
      nativeBackend: {
        transcribe: vi.fn()
      } as any,
      fasterWhisper: {
        health: vi.fn(),
        transcribe: vi.fn()
      } as any
    });
    const translationRegistry = createMainTranslationProviderRegistry({
      settingsStore: settingsStore as any
    });

    await expect(asrRegistry.health('cloud.openai')).resolves.toMatchObject({
      providerId: 'cloud.openai',
      status: 'unconfigured'
    });
    await expect(translationRegistry.health('openai.compatible')).resolves.toMatchObject({
      providerId: 'openai.compatible',
      status: 'unconfigured'
    });
  });

  it('cloud openai adapter preserves retryable strategy for 429 responses', async () => {
    const tempFile = join(tmpdir(), `translate-ter-cloud-asr-${Date.now()}.wav`);
    await writeFile(tempFile, 'audio');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429
      })
    );
    const adapter = createCloudOpenAiAsrProvider({
      settingsStore: {
        getSecret: vi.fn().mockReturnValue({
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'whisper-1'
        })
      } as any
    });

    await expect(
      adapter.transcribe({
        job: createJob({
          asrProviderId: 'cloud.openai',
          mediaPath: tempFile,
          fileName: 'audio.wav'
        }),
        settings: createSettingsValue(),
        audioPath: tempFile
      })
    ).rejects.toMatchObject({
      code: 'ProviderUnavailable',
      retryable: true
    });
  });
});
