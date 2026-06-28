import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import type {
  BatchJobItemSnapshot,
  BatchQueueEvent,
  BatchQueueSnapshot,
  CreateJobRequest,
  CreateBatchJobsRequest,
  JobEvent,
  JobSnapshot
} from '@shared/models';

type JobManagerLike = EventEmitter & {
  create(request: CreateJobRequest): JobSnapshot;
  start(jobId: string): Promise<void>;
  translate(jobId: string): Promise<JobSnapshot>;
  cancel(jobId: string): Promise<void>;
  get(jobId: string): JobSnapshot;
};

export class BatchJobQueue extends EventEmitter {
  private queue = createEmptyQueue();
  private readonly jobIdToItemId = new Map<string, string>();
  private readonly itemRequests = new Map<string, CreateJobRequest>();
  private runningPromise?: Promise<void>;
  private cancelRequested = false;

  constructor(private readonly jobManager: JobManagerLike) {
    super();
    this.handleJobEvent = this.handleJobEvent.bind(this);
    this.jobManager.on('job-event', this.handleJobEvent);
  }

  addJobs(request: CreateBatchJobsRequest): BatchQueueSnapshot {
    const mediaPaths = request.mediaPaths.filter((path) => path.trim().length > 0);
    if (mediaPaths.length === 0) {
      throw new Error('At least one media file is required for batch processing.');
    }

    const now = new Date().toISOString();
    const { mediaPaths: _mediaPaths, autoTranslate: _autoTranslate, ...baseRequest } = request;
    const autoTranslate = request.autoTranslate ?? true;
    const nextItems = mediaPaths.map((mediaPath) => {
      const item = {
        id: `batch-item-${crypto.randomUUID()}`,
        mediaPath,
        fileName: basename(mediaPath),
        status: 'queued',
        step: 'asr',
        progress: 0,
        autoTranslate,
        createdAt: now,
        updatedAt: now
      } satisfies BatchJobItemSnapshot;
      this.itemRequests.set(item.id, {
        ...baseRequest,
        mediaPath
      });
      return item;
    });

    this.queue = withCounts({
      ...this.queue,
      status: this.queue.status === 'running' ? 'running' : 'idle',
      items: [...this.queue.items, ...nextItems],
      updatedAt: now
    });
    this.emitSnapshot();
    return this.get();
  }

  async start(): Promise<BatchQueueSnapshot> {
    if (this.runningPromise) {
      return this.get();
    }
    if (!this.queue.items.some((item) => item.status === 'queued')) {
      this.queue = withCounts({
        ...this.queue,
        status: this.queue.items.length === 0 ? 'idle' : 'completed',
        updatedAt: new Date().toISOString()
      });
      this.emitSnapshot();
      return this.get();
    }

    this.cancelRequested = false;
    this.queue = withCounts({
      ...this.queue,
      status: 'running',
      updatedAt: new Date().toISOString()
    });
    this.emitSnapshot();
    this.runningPromise = this.runQueue().finally(() => {
      this.runningPromise = undefined;
    });
    return this.get();
  }

  async cancel(): Promise<BatchQueueSnapshot> {
    const hasCancellableWork = this.queue.items.some((item) => item.status === 'queued' || item.status === 'running');
    if (!hasCancellableWork) {
      return this.get();
    }

    this.cancelRequested = true;
    const activeItem = this.queue.items.find((item) => item.id === this.queue.currentItemId);
    this.queue = withCounts({
      ...this.queue,
      status: 'cancelled',
      items: this.queue.items.map((item) =>
        item.status === 'queued'
          ? {
              ...item,
              status: 'cancelled',
              stage: 'cancelled',
              progress: 0,
              message: 'Batch item cancelled before it started.',
              updatedAt: new Date().toISOString()
            }
          : item
      ),
      updatedAt: new Date().toISOString()
    });
    this.emitSnapshot();

    if (activeItem?.jobId) {
      await this.jobManager.cancel(activeItem.jobId);
    }
    return this.get();
  }

  get(): BatchQueueSnapshot {
    return structuredClone(this.queue);
  }

  dispose(): void {
    this.jobManager.off('job-event', this.handleJobEvent);
  }

  private async runQueue(): Promise<void> {
    while (!this.cancelRequested) {
      const nextItem = this.queue.items.find((item) => item.status === 'queued');
      if (!nextItem) break;
      await this.processItem(nextItem.id);
    }

    const now = new Date().toISOString();
    const status = this.cancelRequested ? 'cancelled' : 'completed';
    this.queue = withCounts({
      ...this.queue,
      status,
      currentItemId: undefined,
      updatedAt: now
    });
    this.emitSnapshot();
  }

  private async processItem(itemId: string): Promise<void> {
    const item = this.requireItem(itemId);
    this.updateItem(itemId, {
      status: 'running',
      stage: 'imported',
      progress: 0,
      message: 'Batch item started.'
    });
    this.queue = withCounts({
      ...this.queue,
      currentItemId: itemId,
      updatedAt: new Date().toISOString()
    });
    this.emitSnapshot();

    let jobId: string | undefined;
    try {
      const job = this.jobManager.create(this.requireJobRequest(item.id));
      jobId = job.id;
      this.jobIdToItemId.set(job.id, itemId);
      this.updateItem(itemId, {
        jobId: job.id,
        step: job.step,
        stage: job.stage,
        progress: job.progress
      });

      await this.jobManager.start(job.id);
      let nextJob = this.jobManager.get(job.id);
      this.assertJobSucceeded(nextJob);
      if (this.cancelRequested || nextJob.stage === 'cancelled') {
        this.updateItem(itemId, {
          status: 'cancelled',
          stage: 'cancelled',
          progress: 0,
          message: 'Batch item cancelled.'
        });
        return;
      }

      if (item.autoTranslate) {
        nextJob = await this.jobManager.translate(job.id);
        this.assertJobSucceeded(nextJob);
      }
      if (this.cancelRequested || nextJob.stage === 'cancelled') {
        this.updateItem(itemId, {
          status: 'cancelled',
          stage: 'cancelled',
          progress: 0,
          message: 'Batch item cancelled.'
        });
        return;
      }

      this.updateItem(itemId, {
        status: 'completed',
        step: nextJob.step,
        stage: nextJob.stage,
        progress: 100,
        message: item.autoTranslate ? 'Transcription and translation complete.' : 'Transcription complete.'
      });
    } catch (error) {
      if (this.cancelRequested) {
        this.updateItem(itemId, {
          status: 'cancelled',
          stage: 'cancelled',
          progress: 0,
          message: 'Batch item cancelled.'
        });
        return;
      }
      const normalized = normalizeBatchError(error);
      this.updateItem(itemId, {
        status: 'failed',
        stage: 'failed',
        error: normalized,
        message: normalized.message
      });
      this.emit('batch-event', {
        type: 'error',
        queueId: this.queue.id,
        itemId,
        ...normalized
      } satisfies BatchQueueEvent);
    } finally {
      if (jobId) {
        this.jobIdToItemId.delete(jobId);
      }
    }
  }

  private handleJobEvent(event: JobEvent): void {
    const jobId = event.type === 'snapshot' ? event.job.id : event.jobId;
    const itemId = this.jobIdToItemId.get(jobId);
    if (!itemId) return;

    if (event.type === 'snapshot') {
      this.updateItemFromJob(itemId, event.job);
      return;
    }

    if (event.type === 'progress') {
      this.updateItem(itemId, {
        stage: event.stage,
        progress: event.progress,
        message: event.message
      });
      return;
    }

    this.updateItem(itemId, {
      status: 'failed',
      stage: 'failed',
      error: {
        code: event.code,
        message: event.message,
        retryable: event.retryable
      },
      message: event.message
    });
  }

  private updateItemFromJob(itemId: string, job: JobSnapshot): void {
    const current = this.requireItem(itemId);
    const status =
      job.stage === 'failed'
        ? 'failed'
        : job.stage === 'cancelled'
          ? 'cancelled'
          : current.status === 'queued'
            ? 'running'
            : current.status;
    this.updateItem(itemId, {
      jobId: job.id,
      status,
      step: job.step,
      stage: job.stage,
      progress: job.progress,
      error: job.error,
      message: job.error?.message ?? current.message
    });
  }

  private assertJobSucceeded(job: JobSnapshot): void {
    if (job.stage === 'failed' && job.error) {
      throw job.error;
    }
  }

  private updateItem(itemId: string, patch: Partial<BatchJobItemSnapshot>): void {
    let nextItem: BatchJobItemSnapshot | undefined;
    const now = new Date().toISOString();
    this.queue = withCounts({
      ...this.queue,
      items: this.queue.items.map((item) => {
        if (item.id !== itemId) return item;
        nextItem = {
          ...item,
          ...patch,
          updatedAt: now
        };
        return nextItem;
      }),
      updatedAt: now
    });
    if (!nextItem) {
      throw new Error(`Batch item ${itemId} not found.`);
    }
    this.emit('batch-event', {
      type: 'item',
      queueId: this.queue.id,
      item: structuredClone(nextItem)
    } satisfies BatchQueueEvent);
    this.emitSnapshot();
  }

  private requireItem(itemId: string): BatchJobItemSnapshot {
    const item = this.queue.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Batch item ${itemId} not found.`);
    return item;
  }

  private requireJobRequest(itemId: string): CreateJobRequest {
    const request = this.itemRequests.get(itemId);
    if (!request) throw new Error(`Batch item ${itemId} has no job request.`);
    return request;
  }

  private emitSnapshot(): void {
    this.emit('batch-event', {
      type: 'snapshot',
      queue: this.get()
    } satisfies BatchQueueEvent);
  }
}

function createEmptyQueue(): BatchQueueSnapshot {
  const now = new Date().toISOString();
  return {
    id: `batch-queue-${crypto.randomUUID()}`,
    status: 'idle',
    items: [],
    totalCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

function withCounts(queue: BatchQueueSnapshot): BatchQueueSnapshot {
  return {
    ...queue,
    totalCount: queue.items.length,
    completedCount: queue.items.filter((item) => item.status === 'completed').length,
    failedCount: queue.items.filter((item) => item.status === 'failed').length,
    cancelledCount: queue.items.filter((item) => item.status === 'cancelled').length
  };
}

function normalizeBatchError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (typeof error === 'object' && error) {
    const record = error as { code?: unknown; message?: unknown; retryable?: unknown };
    return {
      code: typeof record.code === 'string' ? record.code : 'BatchItemFailed',
      message: typeof record.message === 'string' ? record.message : String(error),
      retryable: typeof record.retryable === 'boolean' ? record.retryable : true
    };
  }
  return {
    code: 'BatchItemFailed',
    message: String(error),
    retryable: true
  };
}
