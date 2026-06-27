import { resolveLocalInferenceThreadCount } from '../../services/localInferenceProfile';
import type { FasterWhisperService } from '../../services/fasterWhisperService';
import type { SettingsStore } from '../../services/settingsStore';
import type { AsrProviderAdapter, AsrTranscribeRequest } from '../types';

const PROVIDER_ID = 'local.faster-whisper';

export function createFasterWhisperAsrProvider(options: {
  settingsStore: Pick<SettingsStore, 'get'>;
  fasterWhisper: Pick<FasterWhisperService, 'health' | 'transcribe'>;
}): AsrProviderAdapter {
  return {
    id: PROVIDER_ID,
    async health() {
      const settings = await options.settingsStore.get();
      return options.fasterWhisper.health({
        modelId: settings.whisperModelId,
        preferCuda: settings.localWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: settings.preferredRuntimeVariant
      });
    },
    async transcribe(request: AsrTranscribeRequest) {
      const cpuThreadCount = resolveLocalInferenceThreadCount(request.job.localAsrCpuMode);
      return options.fasterWhisper.transcribe({
        jobId: request.job.id,
        audioPath: request.audioPath ?? request.job.mediaPath,
        sourceLanguage: request.job.sourceLanguage,
        targetLanguage: request.job.targetLanguage,
        modelId: request.job.whisperModelId,
        preferCuda: request.job.localWhisperUseCuda,
        localAsrAcceleration: request.job.localAsrAcceleration,
        preferredRuntimeVariant: request.job.preferredRuntimeVariant,
        cpuThreadCount,
        allowDownload: request.job.allowWhisperAssetDownload,
        useMultiThreadDownload: request.settings.enableMultiThreadDownload
      });
    }
  };
}
