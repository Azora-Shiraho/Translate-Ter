import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  CreateJobRequest,
  JobEvent,
  JobSnapshot,
  JobStage,
  SubtitleDocument,
  SubtitleWarning,
  SubtitleSegment,
  WorkflowStep
} from '@shared/models';
import { canonicalSourceLanguageCode, canonicalTargetLanguageCode, normalizeAsrLanguageCode } from '@shared/languages';
import { TranslationScheduler } from '@shared/translation/scheduler';
import { MockTranslationProvider, OpenAICompatibleTranslationProvider } from '@shared/translation/providers';
import { validateAsrRequest } from './asrProviders';
import type { NativeBackendClient } from './nativeBackendClient';
import type { SettingsStore } from './settingsStore';
import type { WhisperAssetManager } from './whisperAssets';

export class JobManager extends EventEmitter {
  private jobs = new Map<string, JobSnapshot>();
  private cancelledJobs = new Set<string>();
  private translationControllers = new Map<string, AbortController>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly whisperAssets: WhisperAssetManager,
    private readonly nativeBackend: NativeBackendClient
  ) {
    super();
  }

  create(request: CreateJobRequest): JobSnapshot {
    validateAsrRequest(request);
    const jobId = `job-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const job: JobSnapshot = {
      id: jobId,
      mediaPath: request.mediaPath,
      fileName: basename(request.mediaPath),
      step: 'asr',
      stage: 'imported',
      progress: 0,
      sourceLanguage: canonicalSourceLanguageCode(request.sourceLanguage),
      targetLanguage: canonicalTargetLanguageCode(request.targetLanguage),
      asrProviderId: request.asrProviderId,
      whisperModelId: request.whisperModelId,
      localWhisperUseCuda: request.localWhisperUseCuda ?? false,
      localWhisperIgnoreCudaMismatch: request.localWhisperIgnoreCudaMismatch ?? false,
      allowWhisperAssetDownload: request.allowWhisperAssetDownload ?? true,
      allowCloudAsrUpload: request.allowCloudAsrUpload ?? false,
      translationProviderPriority: request.translationProviderPriority,
      translationConcurrency: request.translationConcurrency ?? 2,
      translationRequestsPerMinute: request.translationRequestsPerMinute ?? 60,
      translationTokenBudgetPerMinute: request.translationTokenBudgetPerMinute ?? 60_000,
      translationLinesPerRequest: request.translationLinesPerRequest ?? 8,
      translationBatchStride: request.translationBatchStride ?? 4,
      warnings: [],
      createdAt: now,
      updatedAt: now
    };
    this.cancelledJobs.delete(jobId);
    this.save(job);
    return job;
  }

  get(jobId: string): JobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    return job;
  }

  async start(jobId: string): Promise<void> {
    const job = this.get(jobId);
    try {
      await this.setProgress(job, 'checking-runtime', 8, 'Checking ASR runtime.');
      const nativeHealth = await this.nativeBackend.health();
      if (this.isCancelled(job.id)) return;
      if (!nativeHealth.capabilities.includes('asr.transcribe')) {
        job.warnings.push({
          code: 'NativeCapabilityUnavailable',
          message: 'Native backend does not currently advertise asr.transcribe.'
        });
      }

      const isLocalWhisper = job.asrProviderId === 'local.whisper.cpp';
      const runtime = isLocalWhisper
        ? await this.whisperAssets.ensureRuntime({
            modelId: job.whisperModelId,
            allowDownload: false,
            preferCuda: job.localWhisperUseCuda,
            ignoreCudaMismatch: job.localWhisperIgnoreCudaMismatch,
            downloadScope: 'none'
          })
        : undefined;
      if (this.isCancelled(job.id)) return;

      if (runtime?.actionRequired && runtime.actionRequired !== 'none') {
        job.warnings.push({
          code: runtime.actionRequired,
          message: runtime.message ?? 'Local runtime needs setup before real transcription.'
        });
        this.fail(
          job,
          runtimeActionToErrorCode(runtime.actionRequired),
          runtime.message ?? 'Local runtime needs setup before real transcription.',
          runtime.actionRequired !== 'manifest-not-configured'
        );
        return;
      }

      await this.setProgress(job, 'probing', 18, 'Probing media.');
      const probe = await this.nativeBackend.probeMedia({ mediaPath: job.mediaPath });
      if (this.isCancelled(job.id)) return;
      if (!probe.ok) {
        this.fail(
          job,
          probe.error?.code ?? 'ProbeFailed',
          probe.error?.message ?? 'Native backend failed to probe media.',
          true
        );
        return;
      }

      await this.setProgress(job, 'extracting-audio', 38, 'Extracting audio.');
      const extraction = await this.nativeBackend.extractAudio({
        mediaPath: job.mediaPath
      });
      if (this.isCancelled(job.id)) return;
      if (!extraction.ok) {
        this.fail(
          job,
          extraction.error?.code ?? 'AudioExtractFailed',
          extraction.error?.message ?? 'Native backend failed to extract audio.',
          true
        );
        return;
      }

      await this.setProgress(job, 'transcribing', 72, 'Transcribing through native backend.');

      if (job.asrProviderId === 'cloud.openai') {
        const cloudDocument = await this.transcribeWithCloudAsr(
          job,
          extraction.payload?.audioPath ?? extraction.payload?.files?.[0]?.path
        );
        if (this.isCancelled(job.id)) return;
        if (!cloudDocument) return;
        job.subtitleDocument = normalizeDocumentForSubtitleDisplay(cloudDocument);
        job.step = 'subtitles';
        await this.setProgress(job, 'completed', 100, 'Cloud transcription complete.');
        return;
      }

      const response = await this.nativeBackend.transcribe({
        jobId: job.id,
        mediaPath: job.mediaPath,
        audioPath: extraction.payload?.audioPath ?? extraction.payload?.files?.[0]?.path,
        modelId: job.whisperModelId,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        asrProviderId: job.asrProviderId,
        preferCuda: job.localWhisperUseCuda,
        runtime: runtime
          ? {
              binaryPath: runtime.binary.expectedPath,
              modelPath: runtime.model.expectedPath
            }
          : undefined
      });
      if (this.isCancelled(job.id)) return;

      if (!response.ok) {
        const shouldRetryOnCpu = shouldRetryLocalWhisperOnCpu(job, response.error);
        if (shouldRetryOnCpu) {
          job.warnings.push({
            code: 'CudaTranscriptionCrashFallback',
            message: 'Local whisper CUDA transcription crashed. Retrying once on CPU.',
            stage: 'asr',
            createdAt: new Date().toISOString()
          });
          await this.setProgress(job, 'transcribing', 78, 'Local GPU transcription crashed. Retrying on CPU.');
          const cpuRetry = await this.nativeBackend.transcribe({
            jobId: job.id,
            mediaPath: job.mediaPath,
            audioPath: extraction.payload?.audioPath ?? extraction.payload?.files?.[0]?.path,
            modelId: job.whisperModelId,
            sourceLanguage: job.sourceLanguage,
            targetLanguage: job.targetLanguage,
            asrProviderId: job.asrProviderId,
            preferCuda: false,
            runtime: runtime
              ? {
                  binaryPath: runtime.binary.expectedPath,
                  modelPath: runtime.model.expectedPath
                }
              : undefined
          });
          if (this.isCancelled(job.id)) return;
          if (cpuRetry.ok) {
            const cpuRetryDocument = nativePayloadToDocument(cpuRetry.payload, job);
            if (!cpuRetryDocument) {
              this.fail(job, 'MalformedNativeResponse', 'Native backend did not return a subtitle document after CPU retry.', true);
              return;
            }

            job.subtitleDocument = normalizeDocumentForSubtitleDisplay({
              ...cpuRetryDocument,
              metadata: {
                ...cpuRetryDocument.metadata,
                warnings: dedupeWarnings([...(cpuRetryDocument.metadata.warnings ?? []), ...job.warnings])
              }
            });
            job.step = 'subtitles';
            this.cancelledJobs.delete(job.id);
            await this.setProgress(job, 'completed', 100, 'Transcription complete after CPU retry.');
            return;
          }
        }
        this.fail(
          job,
          response.error?.code ?? 'NativeBackendError',
          response.error?.message ?? 'Native backend failed.',
          Boolean(response.error?.retryable)
        );
        return;
      }

      const document = nativePayloadToDocument(response.payload, job);
      if (this.isCancelled(job.id)) return;
      if (!document) {
        this.fail(job, 'MalformedNativeResponse', 'Native backend did not return a subtitle document.', true);
        return;
      }

      job.subtitleDocument = normalizeDocumentForSubtitleDisplay(document);
      job.step = 'subtitles';
      this.cancelledJobs.delete(job.id);
      await this.setProgress(job, 'completed', 100, 'Transcription complete.');
    } catch (error) {
      if (this.isCancelled(job.id)) return;
      const message = error instanceof Error ? error.message : String(error);
      this.fail(job, 'DownloadRequired', message, true);
    }
  }

  async translate(jobId: string): Promise<JobSnapshot> {
    const job = this.get(jobId);
    this.translationControllers.get(job.id)?.abort();
    const controller = new AbortController();
    this.translationControllers.set(job.id, controller);
    this.cancelledJobs.delete(job.id);
    try {
      if (!job.subtitleDocument) throw new Error('No subtitle document is available to translate.');
      await this.setProgress(job, 'translating', 35, 'Translating subtitle batches.');
      const secret = this.settings.getSecret('openai.compatible');
      const scheduler = new TranslationScheduler(
        [
          new MockTranslationProvider(),
          new OpenAICompatibleTranslationProvider({
            id: 'openai.compatible',
            baseUrl: secret?.baseUrl ?? 'https://api.openai.com/v1',
            apiKey: secret?.apiKey,
            model: secret?.model ?? 'gpt-4o-mini',
            priority: 10
          })
        ],
        {
          concurrency: job.translationConcurrency,
          rpm: job.translationRequestsPerMinute,
          tokenBudgetPerMinute: job.translationTokenBudgetPerMinute
        }
      );
      const result = await scheduler.translateDocument(job.subtitleDocument, {
        sourceLanguage: job.sourceLanguage === 'auto' ? 'en' : job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        providerPriority: job.translationProviderPriority,
        batchSize: job.translationLinesPerRequest,
        batchStride: job.translationBatchStride,
        signal: controller.signal,
        onProgress: ({ completedBatches, totalBatches }) => {
          if (controller.signal.aborted || this.isCancelled(job.id)) return;
          const progress = 35 + Math.round((completedBatches / Math.max(1, totalBatches)) * 60);
          void this.setProgress(job, 'translating', Math.min(95, progress), `Translating ${completedBatches}/${totalBatches} batches.`);
        }
      });
      if (controller.signal.aborted || this.isCancelled(job.id)) {
        return this.get(job.id);
      }
      const translationWarnings = buildTranslationWarnings(
        job.subtitleDocument,
        result.checkpoints,
        translationProviderIdFromPriority(job.translationProviderPriority)
      );
      job.subtitleDocument = normalizeDocumentForSubtitleDisplay({
        ...result.document,
        metadata: {
          ...result.document.metadata,
          warnings: dedupeWarnings([...(result.document.metadata.warnings ?? []), ...translationWarnings])
        }
      });
      job.step = 'export';
      await this.setProgress(job, 'completed', 100, 'Translation complete.');
      return this.get(job.id);
    } catch (error) {
      if (controller.signal.aborted || this.isCancelled(job.id) || isAbortError(error)) {
        return this.get(job.id);
      }
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? 'TranslationFailed') : 'TranslationFailed';
      const retryable =
        typeof error === 'object' && error && 'retryable' in error ? Boolean((error as { retryable?: unknown }).retryable) : true;
      const message = error instanceof Error ? error.message : String(error);
      this.fail(job, code, message, retryable);
      return this.get(job.id);
    } finally {
      if (this.translationControllers.get(job.id) === controller) {
        this.translationControllers.delete(job.id);
      }
    }
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.get(jobId);
    this.cancelledJobs.add(job.id);
    this.translationControllers.get(job.id)?.abort();
    await this.nativeBackend.cancelRunningWork();
    job.stage = 'cancelled';
    job.step = cancelledStep(job);
    job.progress = 0;
    job.error = undefined;
    job.updatedAt = new Date().toISOString();
    this.save(job);
  }

  updateSegment(jobId: string, segment: SubtitleSegment): JobSnapshot {
    const job = this.get(jobId);
    if (!job.subtitleDocument) throw new Error('No subtitle document is available.');
    const index = job.subtitleDocument.segments.findIndex((item) => item.id === segment.id);
    if (index === -1) throw new Error(`Segment ${segment.id} not found.`);
    job.subtitleDocument.segments[index] = { ...segment, status: segment.status === 'translated' ? 'translated' : 'edited' };
    job.updatedAt = new Date().toISOString();
    this.save(job);
    return job;
  }

  private async setProgress(job: JobSnapshot, stage: JobStage, progress: number, message: string): Promise<void> {
    if (this.isCancelled(job.id)) {
      return;
    }
    job.stage = stage;
    job.progress = progress;
    job.updatedAt = new Date().toISOString();
    this.save(job);
    this.emit('job-event', { type: 'progress', jobId: job.id, stage, progress, message } satisfies JobEvent);
    await delay(100);
  }

  private fail(job: JobSnapshot, code: string, message: string, retryable: boolean): void {
    if (this.isCancelled(job.id)) {
      return;
    }
    const failedStep = failureStepFor(job);
    this.cancelledJobs.delete(job.id);
    job.stage = 'failed';
    job.step = failedStep;
    job.error = { code, message, retryable };
    job.updatedAt = new Date().toISOString();
    this.save(job);
    this.emit('job-event', { type: 'error', jobId: job.id, code, message, retryable } satisfies JobEvent);
  }

  private save(job: JobSnapshot): void {
    this.jobs.set(job.id, structuredClone(job));
    this.emit('job-event', { type: 'snapshot', job: structuredClone(job) } satisfies JobEvent);
  }

  private isCancelled(jobId: string): boolean {
    return this.cancelledJobs.has(jobId);
  }

  private async transcribeWithCloudAsr(job: JobSnapshot, audioPath?: string): Promise<SubtitleDocument | undefined> {
    const secret = this.settings.getSecret('cloud.openai');
    if (!secret?.apiKey) {
      this.fail(job, 'ProviderUnconfigured', 'Cloud ASR API key is not configured.', false);
      return undefined;
    }

    const uploadPath = audioPath ?? job.mediaPath;
    const fileBuffer = await readFile(uploadPath);
    const fileName = basename(uploadPath);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), fileName);
    form.append('model', secret.model ?? 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (job.sourceLanguage !== 'auto') {
      form.append('language', normalizeAsrLanguageCode(job.sourceLanguage));
    }

    const response = await fetch(`${(secret.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret.apiKey}`
      },
      body: form
    });

    if (!response.ok) {
      this.fail(job, 'ProviderUnavailable', `Cloud ASR request failed with HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
      return undefined;
    }

    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      segments?: Array<{ id?: number | string; start?: number; end?: number; text?: string }>;
    };
    const segments = Array.isArray(payload.segments) && payload.segments.length > 0
      ? payload.segments.map((segment, index) => ({
          id: `${job.id}-seg-${index + 1}`,
          index: index + 1,
          startMs: Math.round((segment.start ?? index * 3) * 1000),
          endMs: Math.round((segment.end ?? (index + 1) * 3) * 1000),
          sourceText: segment.text?.trim() || '...',
          status: 'transcribed' as const,
          confidence: 0.9
        }))
      : [
          {
            id: `${job.id}-seg-1`,
            index: 1,
            startMs: 0,
            endMs: 5000,
            sourceText: payload.text?.trim() || '...',
            status: 'transcribed' as const,
            confidence: 0.9
          }
        ];

    return {
      id: `doc-${job.id}`,
      format: 'srt',
      sourceLanguage: payload.language || job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      segments,
      metadata: {
        inputMediaPath: job.mediaPath,
        createdAt: new Date().toISOString(),
        asrProvider: job.asrProviderId,
        warnings: [...job.warnings]
      }
    };
  }
}

function runtimeActionToErrorCode(action: NonNullable<JobSnapshot['error']>['code'] | string): 'ManifestNotConfigured' | 'DownloadRequired' {
  return action === 'manifest-not-configured' ? 'ManifestNotConfigured' : 'DownloadRequired';
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTranslationWarnings(
  document: SubtitleDocument,
  checkpoints: Array<{
    batchId: string;
    segmentIds: string[];
    status: 'queued' | 'running' | 'completed' | 'failed';
    providerAttempts: Array<{
      providerId: string;
      attempt: number;
      startedAt: string;
      completedAt?: string;
      errorCode?: string;
      message?: string;
    }>;
  }>,
  providerId: string
): SubtitleWarning[] {
  return checkpoints
    .filter((checkpoint) => checkpoint.status === 'failed')
    .map((checkpoint) => {
      const matchedSegments = checkpoint.segmentIds
        .map((id) => document.segments.find((segment) => segment.id === id))
        .filter((segment): segment is SubtitleSegment => Boolean(segment))
        .sort((left, right) => left.index - right.index);
      const first = matchedSegments[0];
      const last = matchedSegments[matchedSegments.length - 1];
      const attempt = [...checkpoint.providerAttempts]
        .reverse()
        .find((record) => Boolean(record.message || record.errorCode));

      return {
        id: `warning-${checkpoint.batchId}`,
        code: attempt?.errorCode ?? 'TranslationBatchFailed',
        message: attempt?.message ?? `Batch ${checkpoint.batchId} failed. Original text was kept.`,
        stage: 'translate',
        createdAt: attempt?.completedAt ?? attempt?.startedAt ?? new Date().toISOString(),
        providerId: attempt?.providerId ?? providerId,
        batchId: checkpoint.batchId,
        segmentId: first?.id,
        startIndex: first?.index,
        endIndex: last?.index ?? first?.index,
        startMs: first?.startMs,
        endMs: last?.endMs ?? first?.endMs
      } satisfies SubtitleWarning;
    });
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

function translationProviderIdFromPriority(priority: string[]): string {
  return priority[0] ?? 'openai.compatible';
}

function shouldRetryLocalWhisperOnCpu(
  job: JobSnapshot,
  error?: { code?: string; message?: string; retryable?: boolean }
): boolean {
  if (job.asrProviderId !== 'local.whisper.cpp' || !job.localWhisperUseCuda) {
    return false;
  }
  const message = error?.message?.toLowerCase() ?? '';
  return message.includes('0xc0000409') || message.includes('3221226505') || message.includes('stack buffer overrun');
}

function cancelledStep(job: JobSnapshot): WorkflowStep {
  if (job.stage === 'translating') return 'translate';
  if (job.subtitleDocument?.segments.length) return 'subtitles';
  return 'asr';
}

function failureStepFor(job: JobSnapshot): WorkflowStep {
  switch (job.stage) {
    case 'checking-runtime':
    case 'probing':
    case 'extracting-audio':
    case 'transcribing':
      return 'asr';
    case 'translating':
      return 'translate';
    case 'completed':
      return 'export';
    default:
      return job.step;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function normalizeDocumentForSubtitleDisplay(document: SubtitleDocument): SubtitleDocument {
  return {
    ...document,
    segments: document.segments.map((segment) => ({
      ...segment,
      sourceText: wrapSubtitleText(segment.sourceText),
      translatedText: segment.translatedText ? wrapSubtitleText(segment.translatedText) : segment.translatedText
    }))
  };
}

function wrapSubtitleText(text: string, maxLineLength = 28): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxLineLength) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
