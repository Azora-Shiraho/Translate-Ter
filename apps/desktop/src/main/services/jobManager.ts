import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type {
  CreateJobRequest,
  JobEvent,
  JobSnapshot,
  JobStage,
  SubtitleDocument,
  SubtitleSegment,
  SubtitleWarning,
  WorkflowStep
} from '@shared/models';
import { canonicalSourceLanguageCode, canonicalTargetLanguageCode } from '@shared/languages';
import { normalizeSubtitleDocumentLayout } from '@shared/subtitleLayout';
import { TranslationScheduler } from '@shared/translation/scheduler';
import type { FasterWhisperService } from './fasterWhisperService';
import type { NativeBackendClient } from './nativeBackendClient';
import type { SettingsStore } from './settingsStore';
import { resolveFasterWhisperRequestOptions } from './fasterWhisperRuntimeOptions';
import type {
  AsrProviderRegistry,
  TranslationProviderRegistry
} from '../providers/types';

export class JobManager extends EventEmitter {
  private jobs = new Map<string, JobSnapshot>();
  private cancelledJobs = new Set<string>();
  private translationControllers = new Map<string, AbortController>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly nativeBackend: NativeBackendClient,
    private readonly fasterWhisper: FasterWhisperService,
    private readonly asrProviders: AsrProviderRegistry,
    private readonly translationProviders: TranslationProviderRegistry
  ) {
    super();
  }

  create(request: CreateJobRequest): JobSnapshot {
    if (!this.asrProviders.has(request.asrProviderId)) {
      throw new Error('The selected recognition method is not available.');
    }
    const jobId = `job-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const resolvedFasterWhisper = resolveFasterWhisperRequestOptions({
      preferCuda: Boolean(request.localWhisperUseCuda),
      localAsrAcceleration: request.localAsrAcceleration,
      preferredRuntimeVariant: request.preferredRuntimeVariant
    });
    const localAsrAcceleration = resolvedFasterWhisper.acceleration;
    const preferredRuntimeVariant = resolvedFasterWhisper.preferredVariant;
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
      localWhisperUseCuda: resolvedFasterWhisper.preferCuda,
      localAsrAcceleration,
      preferredRuntimeVariant,
      localAsrCpuMode: request.localAsrCpuMode ?? 'balanced',
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
      const currentSettings = await this.settings.get();
      await this.setProgress(job, 'checking-runtime', 8, 'Checking local recognition tools.');
      const nativeHealth = await this.nativeBackend.health();
      if (this.isCancelled(job.id)) return;
      if (!nativeHealth.capabilities.includes('asr.transcribe')) {
        job.warnings.push({
          code: 'NativeCapabilityUnavailable',
          message: 'The local helper is running, but speech recognition is not ready yet.'
        });
      }

      await this.setProgress(job, 'probing', 18, 'Checking the media file.');
      const probe = await this.nativeBackend.probeMedia({ mediaPath: job.mediaPath });
      if (this.isCancelled(job.id)) return;
      if (!probe.ok) {
        this.fail(
          job,
          probe.error?.code ?? 'ProbeFailed',
          probe.error?.message ?? 'The media file could not be checked.',
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
          extraction.error?.message ?? 'Audio could not be extracted from this file.',
          true
        );
        return;
      }

      await this.setProgress(job, 'transcribing', 72, 'Starting speech recognition.');
      const document = await this.asrProviders.resolve(job.asrProviderId).transcribe({
        job,
        settings: currentSettings,
        audioPath: extraction.payload?.audioPath ?? extraction.payload?.files?.[0]?.path,
        reportProgress: async (progress, message) => this.setProgress(job, 'transcribing', progress, message)
      });
      if (this.isCancelled(job.id)) return;

      job.subtitleDocument = normalizeDocumentForSubtitleDisplay(document);
      job.step = 'subtitles';
      this.cancelledJobs.delete(job.id);
      await this.setProgress(job, 'completed', 100, completionMessageForAsr(job));
    } catch (error) {
      if (this.isCancelled(job.id)) return;
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code ?? 'DownloadRequired')
          : 'DownloadRequired';
      const retryable =
        typeof error === 'object' && error && 'retryable' in error
          ? Boolean((error as { retryable?: unknown }).retryable)
          : true;
      const message = error instanceof Error ? error.message : String(error);
      this.fail(job, code, message, retryable);
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
      const scheduler = new TranslationScheduler(
        this.translationProviders.createProviders(),
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
          void this.setProgress(
            job,
            'translating',
            Math.min(95, progress),
            `Translating ${completedBatches}/${totalBatches} batches.`
          );
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
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code ?? 'TranslationFailed')
          : 'TranslationFailed';
      const retryable =
        typeof error === 'object' && error && 'retryable' in error
          ? Boolean((error as { retryable?: unknown }).retryable)
          : true;
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
    await this.fasterWhisper.cancel(job.id);
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
    job.subtitleDocument.segments[index] = {
      ...segment,
      status: segment.status === 'translated' ? 'translated' : 'edited'
    };
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
  return normalizeSubtitleDocumentLayout(document);
}

function completionMessageForAsr(job: JobSnapshot): string {
  if (job.asrProviderId === 'cloud.openai') {
    return 'Cloud recognition is complete.';
  }
  if (job.asrProviderId === 'local.faster-whisper') {
    return 'Local recognition is complete.';
  }
  if (job.warnings.some((warning) => warning.code === 'CudaTranscriptionCrashFallback')) {
    return 'Recognition is complete after retrying with CPU.';
  }
  return 'Recognition is complete.';
}
