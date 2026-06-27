import type {
  JobSnapshot,
  ProviderHealth,
  SubtitleDocument,
  SubtitleSegment,
  SubtitleWarning,
  WhisperRuntimeStatus
} from '@shared/models';
import type { SettingsStore } from '../../services/settingsStore';
import { createNativeRuntimePayload } from '../../services/nativeTranscribePayload';
import type { NativeBackendClient } from '../../services/nativeBackendClient';
import { resolveLocalInferenceThreadCount } from '../../services/localInferenceProfile';
import type { WhisperAssetManager } from '../../services/whisperAssets';
import type { AsrProviderAdapter, AsrTranscribeRequest } from '../types';
import { ProviderOperationError } from '../types';

const PROVIDER_ID = 'local.whisper.cpp';

export function createLocalWhisperCppAsrProvider(options: {
  settingsStore: Pick<SettingsStore, 'get'>;
  whisperAssets: Pick<WhisperAssetManager, 'ensureRuntime'>;
  nativeBackend: Pick<NativeBackendClient, 'transcribe'>;
}): AsrProviderAdapter {
  return {
    id: PROVIDER_ID,
    async health(): Promise<ProviderHealth> {
      const settings = await options.settingsStore.get();
      const runtime = await options.whisperAssets.ensureRuntime({
        modelId: settings.whisperModelId,
        allowDownload: false,
        preferCuda: settings.localWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: settings.preferredRuntimeVariant,
        ignoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'none'
      });

      const runnable = runtime.binary.verified && runtime.model.verified;
      return {
        providerId: PROVIDER_ID,
        ok: runnable,
        status: runnable ? 'healthy' : 'degraded',
        message: localWhisperRuntimeMessage(runtime)
      };
    },
    async transcribe(request: AsrTranscribeRequest): Promise<SubtitleDocument> {
      const runtime = await options.whisperAssets.ensureRuntime({
        modelId: request.job.whisperModelId,
        allowDownload: false,
        preferCuda: request.job.localWhisperUseCuda,
        localAsrAcceleration: request.job.localAsrAcceleration,
        preferredRuntimeVariant: request.job.preferredRuntimeVariant,
        ignoreCudaMismatch: request.job.localWhisperIgnoreCudaMismatch,
        downloadScope: 'none'
      });

      if (runtime.actionRequired && runtime.actionRequired !== 'none') {
        request.job.warnings.push({
          code: runtime.actionRequired,
          message: runtime.message ?? 'Local recognition needs to be set up before starting.'
        });
        throw new ProviderOperationError(
          runtime.message ?? 'Local recognition needs to be set up before starting.',
          {
            code: runtimeActionToErrorCode(runtime.actionRequired),
            retryable:
              runtime.actionRequired !== 'manifest-not-configured' &&
              runtime.actionRequired !== 'unsupported-platform'
          }
        );
      }

      const cpuThreadCount = resolveLocalInferenceThreadCount(request.job.localAsrCpuMode);
      const useCudaForNativeWhisper = runtime.acceleration.selected === 'gpu';
      const nativeRuntimePayload = createNativeRuntimePayload({
        provider: 'whisper.cpp',
        variant: runtime.acceleration.runtimeVariant,
        binaryPath: runtime.binary.expectedPath,
        modelPath: runtime.model.expectedPath
      });
      const cpuRetryRuntimePayload = createNativeRuntimePayload({
        provider: 'whisper.cpp',
        variant: 'cpu',
        binaryPath: runtime.binary.expectedPath,
        modelPath: runtime.model.expectedPath
      });
      const response = await options.nativeBackend.transcribe({
        jobId: request.job.id,
        mediaPath: request.job.mediaPath,
        audioPath: request.audioPath,
        modelId: request.job.whisperModelId,
        sourceLanguage: request.job.sourceLanguage,
        targetLanguage: request.job.targetLanguage,
        asrProviderId: request.job.asrProviderId,
        preferCuda: useCudaForNativeWhisper ?? request.job.localWhisperUseCuda,
        cpuThreadCount,
        binaryPath: nativeRuntimePayload.binaryPath,
        modelPath: nativeRuntimePayload.modelPath,
        runtime: nativeRuntimePayload.runtime
      });

      if (!response.ok) {
        const shouldRetryOnCpu = shouldRetryLocalWhisperOnCpu(
          request.job,
          useCudaForNativeWhisper ?? request.job.localWhisperUseCuda,
          response.error
        );
        if (shouldRetryOnCpu) {
          request.job.warnings.push({
            code: 'CudaTranscriptionCrashFallback',
            message: 'GPU recognition stopped unexpectedly. Trying CPU once instead.',
            stage: 'asr',
            createdAt: new Date().toISOString()
          });
          await request.reportProgress?.(78, 'GPU recognition stopped. Retrying with CPU.');
          const cpuRetry = await options.nativeBackend.transcribe({
            jobId: request.job.id,
            mediaPath: request.job.mediaPath,
            audioPath: request.audioPath,
            modelId: request.job.whisperModelId,
            sourceLanguage: request.job.sourceLanguage,
            targetLanguage: request.job.targetLanguage,
            asrProviderId: request.job.asrProviderId,
            preferCuda: false,
            cpuThreadCount,
            binaryPath: cpuRetryRuntimePayload.binaryPath,
            modelPath: cpuRetryRuntimePayload.modelPath,
            runtime: cpuRetryRuntimePayload.runtime
          });
          if (cpuRetry.ok) {
            const cpuRetryDocument = nativePayloadToDocument(cpuRetry.payload, request.job);
            if (!cpuRetryDocument) {
              throw new ProviderOperationError(
                'Recognition finished, but no subtitle content was returned after the CPU retry.',
                {
                  code: 'MalformedNativeResponse',
                  retryable: true
                }
              );
            }

            return {
              ...cpuRetryDocument,
              metadata: {
                ...cpuRetryDocument.metadata,
                warnings: dedupeWarnings([
                  ...(cpuRetryDocument.metadata.warnings ?? []),
                  ...request.job.warnings
                ])
              }
            };
          }
        }

        throw new ProviderOperationError(
          response.error?.message ?? 'Local recognition failed.',
          {
            code: response.error?.code ?? 'NativeBackendError',
            retryable: Boolean(response.error?.retryable)
          }
        );
      }

      const document = nativePayloadToDocument(response.payload, request.job);
      if (!document) {
        throw new ProviderOperationError('Recognition finished, but no subtitle content was returned.', {
          code: 'MalformedNativeResponse',
          retryable: true
        });
      }

      return document;
    }
  };
}

function runtimeActionToErrorCode(
  action: NonNullable<JobSnapshot['error']>['code'] | string
): 'ManifestNotConfigured' | 'DownloadRequired' | 'UnsupportedPlatform' {
  if (action === 'manifest-not-configured') {
    return 'ManifestNotConfigured';
  }
  if (action === 'unsupported-platform') {
    return 'UnsupportedPlatform';
  }
  return 'DownloadRequired';
}

function nativePayloadToDocument(payload: unknown, job: JobSnapshot): SubtitleDocument | undefined {
  const candidate = payload as { document?: SubtitleDocument; segments?: SubtitleSegment[] } | undefined;
  if (candidate?.document?.format === 'srt' && Array.isArray(candidate.document.segments)) {
    return candidate.document;
  }
  if (Array.isArray(candidate?.segments)) {
    return {
      id: `doc-${job.id}`,
      format: 'srt',
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      segments: candidate.segments,
      metadata: {
        inputMediaPath: job.mediaPath,
        createdAt: new Date().toISOString(),
        asrProvider: job.asrProviderId,
        warnings: [...job.warnings]
      }
    };
  }
  return undefined;
}

function shouldRetryLocalWhisperOnCpu(
  job: JobSnapshot,
  attemptedGpu: boolean,
  error?: { code?: string; message?: string; retryable?: boolean }
): boolean {
  if (job.asrProviderId !== PROVIDER_ID || !attemptedGpu) {
    return false;
  }
  const message = error?.message?.toLowerCase() ?? '';
  return message.includes('0xc0000409') || message.includes('3221226505') || message.includes('stack buffer overrun');
}

function dedupeWarnings(warnings: SubtitleWarning[]): SubtitleWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = [
      warning.code.trim(),
      warning.message.trim().toLowerCase(),
      warning.batchId ?? '',
      warning.segmentId ?? '',
      warning.startIndex ?? '',
      warning.endIndex ?? '',
      warning.startMs ?? '',
      warning.endMs ?? ''
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localWhisperRuntimeMessage(runtime: WhisperRuntimeStatus): string {
  if (runtime.binary.verified && runtime.model.verified) {
    return runtime.message ?? 'whisper.cpp is ready.';
  }
  if (!runtime.binary.verified) {
    return runtime.message ?? 'whisper.cpp runtime binary is missing or cannot run.';
  }
  if (!runtime.model.verified) {
    return runtime.message ?? 'Selected whisper model is missing.';
  }
  return runtime.message ?? 'Local whisper check failed.';
}
