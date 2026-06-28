import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type {
  CreateBatchJobsRequest,
  CreateJobRequest,
  JobEvent,
  JobSnapshot,
  SubtitleDocument
} from '@shared/models';
import { BatchJobQueue } from './batchJobQueue';

function createBatchRequest(overrides: Partial<CreateBatchJobsRequest> = {}): CreateBatchJobsRequest {
  return {
    mediaPaths: ['D:/media/a.mp4'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    asrProviderId: 'local.whisper.cpp',
    whisperModelId: 'ggml-base',
    localWhisperUseCuda: false,
    localAsrAcceleration: 'cpu',
    preferredRuntimeVariant: 'cpu',
    localAsrCpuMode: 'balanced',
    localWhisperIgnoreCudaMismatch: false,
    allowWhisperAssetDownload: true,
    allowCloudAsrUpload: false,
    translationProviderPriority: ['mock.local'],
    translationConcurrency: 1,
    translationRequestsPerMinute: 60,
    translationTokenBudgetPerMinute: 60000,
    translationLinesPerRequest: 8,
    translationBatchStride: 4,
    ...overrides
  };
}

function createDocument(mediaPath: string): SubtitleDocument {
  return {
    id: `doc-${mediaPath}`,
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
      inputMediaPath: mediaPath,
      createdAt: new Date().toISOString(),
      warnings: []
    }
  };
}

function createJobSnapshot(id: string, request: CreateJobRequest): JobSnapshot {
  return {
    id,
    mediaPath: request.mediaPath,
    fileName: request.mediaPath.split(/[\\/]/).filter(Boolean).at(-1) ?? request.mediaPath,
    step: 'asr',
    stage: 'imported',
    progress: 0,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    asrProviderId: request.asrProviderId,
    whisperModelId: request.whisperModelId,
    localWhisperUseCuda: Boolean(request.localWhisperUseCuda),
    localAsrAcceleration: request.localAsrAcceleration ?? 'auto',
    preferredRuntimeVariant: request.preferredRuntimeVariant,
    localAsrCpuMode: request.localAsrCpuMode ?? 'balanced',
    localWhisperIgnoreCudaMismatch: request.localWhisperIgnoreCudaMismatch ?? false,
    allowWhisperAssetDownload: request.allowWhisperAssetDownload ?? true,
    allowCloudAsrUpload: request.allowCloudAsrUpload ?? false,
    translationProviderPriority: request.translationProviderPriority,
    translationConcurrency: request.translationConcurrency ?? 2,
    translationRequestsPerMinute: request.translationRequestsPerMinute ?? 60,
    translationTokenBudgetPerMinute: request.translationTokenBudgetPerMinute ?? 60000,
    translationLinesPerRequest: request.translationLinesPerRequest ?? 8,
    translationBatchStride: request.translationBatchStride ?? 4,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

class FakeJobManager extends EventEmitter {
  readonly create = vi.fn((request: CreateJobRequest) => {
    const job = createJobSnapshot(`job-${this.jobs.size + 1}`, request);
    this.jobs.set(job.id, job);
    this.createOrder.push(request.mediaPath);
    return structuredClone(job);
  });
  readonly start = vi.fn(async (jobId: string) => {
    this.startOrder.push(jobId);
    const job = this.requireJob(jobId);
    this.emitProgress(jobId, 'probing', 25, 'Checking media.');
    this.onStart?.();
    if (this.startBlock) {
      await this.startBlock.promise;
    }
    if (job.stage === 'cancelled') {
      return;
    }
    if (this.failMediaPaths.has(job.mediaPath)) {
      job.stage = 'failed';
      job.step = 'asr';
      job.progress = 25;
      job.error = {
        code: 'ProbeFailed',
        message: 'The media file could not be checked.',
        retryable: true
      };
      this.emitEvent({ type: 'error', jobId, ...job.error });
      this.emitEvent({ type: 'snapshot', job: structuredClone(job) });
      return;
    }
    job.stage = 'completed';
    job.step = 'subtitles';
    job.progress = 100;
    job.subtitleDocument = createDocument(job.mediaPath);
    job.updatedAt = new Date().toISOString();
    this.emitEvent({ type: 'snapshot', job: structuredClone(job) });
  });
  readonly translate = vi.fn(async (jobId: string) => {
    this.translateOrder.push(jobId);
    const job = this.requireJob(jobId);
    job.stage = 'completed';
    job.step = 'export';
    job.progress = 100;
    job.subtitleDocument = job.subtitleDocument
      ? {
          ...job.subtitleDocument,
          segments: job.subtitleDocument.segments.map((segment) => ({
            ...segment,
            translatedText: `[zh-CN] ${segment.sourceText}`,
            status: 'translated'
          }))
        }
      : undefined;
    job.updatedAt = new Date().toISOString();
    this.emitEvent({ type: 'snapshot', job: structuredClone(job) });
    return structuredClone(job);
  });
  readonly cancel = vi.fn(async (jobId: string) => {
    this.cancelOrder.push(jobId);
    const job = this.requireJob(jobId);
    job.stage = 'cancelled';
    job.step = 'asr';
    job.progress = 0;
    job.error = undefined;
    job.updatedAt = new Date().toISOString();
    this.emitEvent({ type: 'snapshot', job: structuredClone(job) });
  });
  readonly get = vi.fn((jobId: string) => structuredClone(this.requireJob(jobId)));

  readonly createOrder: string[] = [];
  readonly startOrder: string[] = [];
  readonly translateOrder: string[] = [];
  readonly cancelOrder: string[] = [];
  readonly failMediaPaths = new Set<string>();
  startBlock?: Deferred<void>;
  onStart?: () => void;

  private readonly jobs = new Map<string, JobSnapshot>();

  private requireJob(jobId: string): JobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    return job;
  }

  private emitProgress(jobId: string, stage: JobSnapshot['stage'], progress: number, message: string): void {
    this.emitEvent({ type: 'progress', jobId, stage, progress, message });
  }

  private emitEvent(event: JobEvent): void {
    this.emit('job-event', event);
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForQueue(queue: BatchJobQueue): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (queue.get().status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Batch queue did not settle.');
}

describe('BatchJobQueue', () => {
  it('runs queued jobs sequentially and translates each item by default', async () => {
    const manager = new FakeJobManager();
    const queue = new BatchJobQueue(manager as any);
    queue.addJobs(
      createBatchRequest({
        mediaPaths: ['D:/media/a.mp4', 'D:/media/b.mp4']
      })
    );

    await queue.start();
    await waitForQueue(queue);

    const snapshot = queue.get();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.completedCount).toBe(2);
    expect(snapshot.failedCount).toBe(0);
    expect(snapshot.items.map((item) => item.status)).toEqual(['completed', 'completed']);
    expect(manager.createOrder).toEqual(['D:/media/a.mp4', 'D:/media/b.mp4']);
    expect(manager.translateOrder).toHaveLength(2);
  });

  it('marks one failed item and continues with the next queued file', async () => {
    const manager = new FakeJobManager();
    manager.failMediaPaths.add('D:/media/bad.mp4');
    const queue = new BatchJobQueue(manager as any);
    queue.addJobs(
      createBatchRequest({
        mediaPaths: ['D:/media/good-1.mp4', 'D:/media/bad.mp4', 'D:/media/good-2.mp4']
      })
    );

    await queue.start();
    await waitForQueue(queue);

    const snapshot = queue.get();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.completedCount).toBe(2);
    expect(snapshot.failedCount).toBe(1);
    expect(snapshot.items.map((item) => item.status)).toEqual(['completed', 'failed', 'completed']);
    expect(snapshot.items[1]?.error?.code).toBe('ProbeFailed');
    expect(manager.createOrder).toEqual(['D:/media/good-1.mp4', 'D:/media/bad.mp4', 'D:/media/good-2.mp4']);
  });

  it('cancels the active native-backed job and queued items', async () => {
    const manager = new FakeJobManager();
    const started = createDeferred();
    manager.startBlock = createDeferred();
    manager.onStart = () => started.resolve();
    const queue = new BatchJobQueue(manager as any);
    queue.addJobs(
      createBatchRequest({
        mediaPaths: ['D:/media/long.mp4', 'D:/media/next.mp4']
      })
    );

    await queue.start();
    await started.promise;
    await queue.cancel();
    manager.startBlock.resolve();
    await waitForQueue(queue);

    const snapshot = queue.get();
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.cancelledCount).toBe(2);
    expect(snapshot.items.map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(manager.cancelOrder).toHaveLength(1);
    expect(manager.createOrder).toEqual(['D:/media/long.mp4']);
  });

  it('does not rewrite non-empty media paths before enqueueing', async () => {
    const manager = new FakeJobManager();
    const queue = new BatchJobQueue(manager as any);
    queue.addJobs(
      createBatchRequest({
        mediaPaths: ['  ', 'D:/media/final-space .mp4']
      })
    );

    await queue.start();
    await waitForQueue(queue);

    expect(manager.createOrder).toEqual(['D:/media/final-space .mp4']);
    expect(queue.get().items[0]?.mediaPath).toBe('D:/media/final-space .mp4');
  });

  it('keeps a completed queue completed when cancel is requested late', async () => {
    const manager = new FakeJobManager();
    const queue = new BatchJobQueue(manager as any);
    queue.addJobs(
      createBatchRequest({
        mediaPaths: ['D:/media/a.mp4']
      })
    );

    await queue.start();
    await waitForQueue(queue);
    const beforeCancel = queue.get();
    const afterCancel = await queue.cancel();

    expect(beforeCancel.status).toBe('completed');
    expect(afterCancel.status).toBe('completed');
    expect(afterCancel.completedCount).toBe(1);
    expect(manager.cancelOrder).toHaveLength(0);
  });
});
