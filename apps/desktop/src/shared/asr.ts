import type { ProviderHealth, SubtitleDocument } from './models';

export type AsrProviderKind = 'local' | 'cloud' | 'mock';

export type AsrProviderConfig = {
  id: string;
  kind: AsrProviderKind;
  displayName: string;
  requiresConsentForUpload: boolean;
  supportedFormats: string[];
};

export type AsrTranscriptionRequest = {
  mediaPath: string;
  sourceLanguage: string;
  outputFormat: 'srt';
  modelId?: string;
  signal?: AbortSignal;
};

export type AsrTranscriptionResult = {
  providerId: string;
  modelId?: string;
  document: SubtitleDocument;
  rawOutputPath?: string;
};

export type AsrProvider = {
  config: AsrProviderConfig;
  health(): Promise<ProviderHealth>;
  transcribe(request: AsrTranscriptionRequest): Promise<AsrTranscriptionResult>;
};

export const WHISPER_CPP_PROVIDER_ID = 'local.whisper.cpp';

export function createMockAsrProvider(now: () => string = () => new Date().toISOString()): AsrProvider {
  const providerId = 'mock.asr';
  return {
    config: {
      id: providerId,
      kind: 'mock',
      displayName: 'Mock ASR',
      requiresConsentForUpload: false,
      supportedFormats: ['srt']
    },
    async health() {
      return {
        providerId,
        ok: true,
        status: 'healthy'
      };
    },
    async transcribe(request) {
      return {
        providerId,
        modelId: request.modelId ?? 'mock',
        document: {
          id: `asr-${Date.now()}`,
          format: 'srt',
          sourceLanguage: request.sourceLanguage,
          segments: [
            {
              id: 'seg-0001',
              index: 1,
              startMs: 0,
              endMs: 2000,
              sourceText: 'Mock transcription segment.',
              status: 'transcribed'
            }
          ],
          metadata: {
            inputMediaPath: request.mediaPath,
            createdAt: now(),
            asrProvider: providerId,
            warnings: []
          }
        }
      };
    }
  };
}
