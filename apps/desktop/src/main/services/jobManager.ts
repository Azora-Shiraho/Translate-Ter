import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type { CreateJobRequest, JobEvent, JobSnapshot, JobStage, SubtitleDocument, SubtitleSegment } from '@shared/models';
import { TranslationScheduler } from '@shared/translation/scheduler';
import { MockTranslationProvider, OpenAICompatibleTranslationProvider } from '@shared/translation/providers';
import { validateAsrRequest } from './asrProviders';
import type { NativeBackendClient } from './nativeBackendClient';
import type { SettingsStore } from './settingsStore';
import type { WhisperAssetManager } from './whisperAssets';

export class JobManager extends EventEmitter {
  private jobs = new Map<string, JobSnapshot>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly whisperAssets: WhisperAssetManager,
    private readonly nativeBackend: NativeBackendClient
  ) {
    super();
  }

  create(request: CreateJobRequest): JobSnapshot {
    validateAsrRequest(request);
    const now = new Date().toISOString();
    const job: JobSnapshot = {
      id: `job-${crypto.randomUUID()}`,
      mediaPath: request.mediaPath,
      fileName: basename(request.mediaPath),
      step: 'asr',
      stage: 'imported',
      progress: 0,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      asrProviderId: request.asrProviderId,
      whisperModelId: request.whisperModelId,
      translationProviderPriority: request.translationProviderPriority,
      warnings: [],
      createdAt: now,
      updatedAt: now
    };
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
    if (job.asrProviderId === 'mock.asr') {
      await this.startMockAsr(job);
      return;
    }

    await this.setProgress(job, 'checking-runtime', 8, 'Checking local whisper.cpp runtime.');
    const nativeHealth = await this.nativeBackend.health();
    if (!nativeHealth.capabilities.includes('asr.transcribe')) {
      job.warnings.push({
        code: 'NativeCapabilityUnavailable',
        message: 'Native backend does not currently advertise asr.transcribe.'
      });
    }

    const runtime = await this.whisperAssets.ensureRuntime({
      modelId: job.whisperModelId,
      allowDownload: false
    });

    if (runtime.actionRequired && runtime.actionRequired !== 'none') {
      job.warnings.push({
        code: runtime.actionRequired,
        message: runtime.message ?? 'Local runtime needs setup before real transcription.'
      });
    }

    await this.setProgress(job, 'probing', 18, 'Probing media.');
    await delay(100);
    await this.setProgress(job, 'extracting-audio', 38, 'Extracting audio.');
    await delay(100);
    await this.setProgress(job, 'transcribing', 72, 'Transcribing through native backend.');

    const response = await this.nativeBackend.transcribe({
      mediaPath: job.mediaPath,
      modelId: job.whisperModelId,
      sourceLanguage: job.sourceLanguage,
      runtime: {
        binaryPath: runtime.binary.expectedPath,
        modelPath: runtime.model.expectedPath
      }
    });

    if (!response.ok) {
      this.fail(job, response.error?.code ?? 'NativeBackendError', response.error?.message ?? 'Native backend failed.', Boolean(response.error?.retryable));
      return;
    }

    const document = nativePayloadToDocument(response.payload, job);
    if (!document) {
      this.fail(job, 'MalformedNativeResponse', 'Native backend did not return a subtitle document.', true);
      return;
    }

    job.subtitleDocument = document;
    job.step = 'subtitles';
    await this.setProgress(job, 'completed', 100, 'Transcription complete.');
  }

  async translate(jobId: string): Promise<JobSnapshot> {
    const job = this.get(jobId);
    if (!job.subtitleDocument) throw new Error('No subtitle document is available to translate.');
    await this.setProgress(job, 'translating', 35, 'Translating subtitle batches.');
    const secret = this.settings.getSecret('openai.compatible');
    const scheduler = new TranslationScheduler([
      new MockTranslationProvider(),
      new OpenAICompatibleTranslationProvider({
        id: 'openai.compatible',
        baseUrl: secret?.baseUrl ?? 'https://api.openai.com/v1',
        apiKey: secret?.apiKey,
        model: 'gpt-4o-mini',
        priority: 10
      })
    ]);
    const result = await scheduler.translateDocument(job.subtitleDocument, {
      sourceLanguage: job.sourceLanguage === 'auto' ? 'en' : job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      providerPriority: job.translationProviderPriority
    });
    job.subtitleDocument = result.document;
    job.step = 'export';
    job.warnings = [
      ...job.warnings,
      ...result.checkpoints
        .filter((checkpoint) => checkpoint.status === 'failed')
        .map((checkpoint) => ({
          code: 'TranslationBatchFailed',
          message: `Batch ${checkpoint.batchId} failed.`,
          segmentId: checkpoint.segmentIds[0]
        }))
    ];
    await this.setProgress(job, 'completed', 100, 'Translation complete.');
    return job;
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.get(jobId);
    job.stage = 'cancelled';
    job.progress = 0;
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
    job.stage = stage;
    job.progress = progress;
    job.updatedAt = new Date().toISOString();
    this.save(job);
    this.emit('job-event', { type: 'progress', jobId: job.id, stage, progress, message } satisfies JobEvent);
    await delay(100);
  }

  private async startMockAsr(job: JobSnapshot): Promise<void> {
    await this.setProgress(job, 'checking-runtime', 8, 'Using explicit mock ASR provider.');
    await this.setProgress(job, 'probing', 18, 'Probing media.');
    await delay(100);
    await this.setProgress(job, 'extracting-audio', 38, 'Extracting audio.');
    await delay(100);
    await this.setProgress(job, 'transcribing', 72, 'Generating mock subtitle segments.');
    await delay(100);
    job.subtitleDocument = createMockDocument(job);
    job.step = 'subtitles';
    await this.setProgress(job, 'completed', 100, 'Mock transcription complete.');
  }

  private fail(job: JobSnapshot, code: string, message: string, retryable: boolean): void {
    job.stage = 'failed';
    job.error = { code, message, retryable };
    job.updatedAt = new Date().toISOString();
    this.save(job);
    this.emit('job-event', { type: 'error', jobId: job.id, code, message, retryable } satisfies JobEvent);
  }

  private save(job: JobSnapshot): void {
    this.jobs.set(job.id, structuredClone(job));
    this.emit('job-event', { type: 'snapshot', job: structuredClone(job) } satisfies JobEvent);
  }
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

function createMockDocument(job: JobSnapshot): SubtitleDocument {
  const now = new Date().toISOString();
  return {
    id: `doc-${job.id}`,
    format: 'srt',
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    segments: [
      segment('seg-0001', 1, 900, 3100, 'Welcome to Translate-Ter.'),
      segment('seg-0002', 2, 3600, 6200, 'This first build keeps every subtitle timestamp stable.'),
      segment('seg-0003', 3, 6900, 9800, 'You can edit text, translate batches, and export SRT.')
    ],
    metadata: {
      inputMediaPath: job.mediaPath,
      createdAt: now,
      asrProvider: job.asrProviderId,
      warnings: [...job.warnings]
    }
  };
}

function segment(id: string, index: number, startMs: number, endMs: number, sourceText: string): SubtitleSegment {
  return {
    id,
    index,
    startMs,
    endMs,
    sourceText,
    confidence: 0.92,
    status: 'transcribed'
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
