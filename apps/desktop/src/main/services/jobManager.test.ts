import { describe, expect, it, vi } from 'vitest';
import type { AppSettingsPublic, CreateJobRequest, SubtitleDocument } from '@shared/models';
import type { TranslationProvider } from '@shared/translation/types';
import { ProviderError } from '@shared/translation/types';
import { JobManager } from './jobManager';
import type {
  AsrProviderRegistry,
  TranslationProviderRegistry
} from '../providers/types';

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
    exportBilingualOrder: 'source-first',
    exportFileFormat: 'srt',
    exportBatchWithLanguageSuffix: false
  };
}

function createSettings() {
  const settings = createSettingsValue();
  return {
    get: vi.fn().mockResolvedValue(settings),
    getSecret: vi.fn()
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

function createDocument(overrides: Partial<SubtitleDocument> = {}): SubtitleDocument {
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
        status: 'transcribed'
      }
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      warnings: []
    },
    ...overrides
  };
}

function createAsrRegistry(options: {
  has?: boolean;
  transcribe?: ReturnType<typeof vi.fn>;
} = {}): AsrProviderRegistry {
  const transcribe = options.transcribe ?? vi.fn().mockResolvedValue(createDocument());
  return {
    get: vi.fn(),
    resolve: vi.fn().mockReturnValue({
      id: 'local.whisper.cpp',
      health: vi.fn(),
      transcribe
    }),
    has: vi.fn().mockReturnValue(options.has ?? true),
    health: vi.fn(),
    list: vi.fn().mockReturnValue([])
  };
}

function createTranslationRegistry(providers: TranslationProvider[]): TranslationProviderRegistry {
  return {
    get: vi.fn(),
    has: vi.fn().mockImplementation((id: string) => providers.some((provider) => provider.id === id)),
    createProviders: vi.fn().mockReturnValue(providers),
    health: vi.fn(),
    list: vi.fn().mockReturnValue([])
  };
}

describe('JobManager', () => {
  it('validates ASR provider ids through the registry', () => {
    const settings = createSettings();
    const nativeBackend = {
      cancelRunningWork: vi.fn()
    };
    const nativeMedia = {
      probeMedia: vi.fn(),
      extractAudio: vi.fn()
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const manager = new JobManager(
      settings as any,
      nativeBackend as any,
      nativeMedia as any,
      fasterWhisper as any,
      createAsrRegistry({ has: false }),
      createTranslationRegistry([])
    );

    expect(() => manager.create(createRequest())).toThrowError('The selected recognition method is not available.');
  });

  it('delegates transcription to the ASR registry adapter', async () => {
    const settings = createSettings();
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
      cancelRunningWork: vi.fn()
    };
    const nativeMedia = {
      probeMedia: vi.fn().mockResolvedValue({
        ok: true,
        payload: {}
      }),
      extractAudio: vi.fn().mockResolvedValue({
        ok: true,
        payload: {
          audioPath: 'D:/media/demo.wav'
        }
      })
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const transcribe = vi.fn().mockResolvedValue(createDocument());
    const asrRegistry = createAsrRegistry({ transcribe });
    const manager = new JobManager(
      settings as any,
      nativeBackend as any,
      nativeMedia as any,
      fasterWhisper as any,
      asrRegistry,
      createTranslationRegistry([])
    );
    const job = manager.create(createRequest());

    await manager.start(job.id);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0]).toMatchObject({
      audioPath: 'D:/media/demo.wav',
      job: {
        id: job.id,
        asrProviderId: 'local.whisper.cpp'
      },
      settings: {
        enableMultiThreadDownload: false
      }
    });
    expect(manager.get(job.id).stage).toBe('completed');
    expect(manager.get(job.id).subtitleDocument?.segments[0]?.sourceText).toBe('hello');
  });

  it('creates translation scheduler providers through the translation registry', async () => {
    const settings = createSettings();
    const nativeBackend = {
      cancelRunningWork: vi.fn()
    };
    const nativeMedia = {
      probeMedia: vi.fn(),
      extractAudio: vi.fn()
    };
    const fasterWhisper = {
      cancel: vi.fn()
    };
    const primaryProvider: TranslationProvider = {
      id: 'openai.compatible',
      kind: 'llm',
      priority: 10,
      capabilities: () => ({
        maxSegmentsPerBatch: 8,
        maxCharactersPerBatch: 4000,
        supportsGlossary: true,
        supportsTone: true
      }),
      health: async () => ({ ok: true }),
      async translateBatch() {
        throw new ProviderError('Primary provider unavailable.', {
          code: 'ProviderUnavailable',
          retryable: false
        });
      }
    };
    const fallbackProvider: TranslationProvider = {
      id: 'mock.local',
      kind: 'mock',
      priority: 100,
      capabilities: () => ({
        maxSegmentsPerBatch: 8,
        maxCharactersPerBatch: 4000,
        supportsGlossary: true,
        supportsTone: true
      }),
      health: async () => ({ ok: true }),
      async translateBatch(request) {
        return {
          providerId: 'mock.local',
          translations: request.segments.map((segment) => ({
            id: segment.id,
            translatedText: `[zh-CN] ${segment.sourceText}`
          }))
        };
      }
    };
    const translationRegistry = createTranslationRegistry([primaryProvider, fallbackProvider]);
    const manager = new JobManager(
      settings as any,
      nativeBackend as any,
      nativeMedia as any,
      fasterWhisper as any,
      createAsrRegistry(),
      translationRegistry
    );
    const job = manager.create(
      createRequest({
        translationProviderPriority: ['openai.compatible', 'mock.local']
      })
    );
    const storedJob = manager.get(job.id);
    storedJob.subtitleDocument = createDocument();

    const result = await manager.translate(job.id);

    expect(translationRegistry.createProviders).toHaveBeenCalledTimes(1);
    expect(result.step).toBe('export');
    expect(result.subtitleDocument?.segments[0]?.translatedText).toBe('[zh-CN] hello');
  });
});
