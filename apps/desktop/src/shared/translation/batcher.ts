import type { SubtitleDocument, SubtitleSegment } from '../models';
import type { ProviderCapabilities, TranslationBatchRequest } from './types';

export function createSubtitleBatches(
  document: SubtitleDocument,
  capabilities: ProviderCapabilities,
  requestBase: Omit<TranslationBatchRequest, 'batchId' | 'segments'>,
  options?: {
    batchSize?: number;
    batchStride?: number;
  }
): TranslationBatchRequest[] {
  const batches: TranslationBatchRequest[] = [];
  const requestedBatchSize = Math.max(1, Math.min(options?.batchSize ?? capabilities.maxSegmentsPerBatch, capabilities.maxSegmentsPerBatch));
  const requestedBatchStride = Math.max(1, Math.min(options?.batchStride ?? requestedBatchSize, requestedBatchSize));

  let start = 0;
  while (start < document.segments.length) {
    const windowSegments: Pick<SubtitleSegment, 'id' | 'sourceText'>[] = [];
    let chars = 0;

    for (let index = start; index < document.segments.length; index += 1) {
      const candidate = document.segments[index];
      const nextChars = chars + candidate.sourceText.length;
      const countOverflow = windowSegments.length >= requestedBatchSize;
      const charOverflow = windowSegments.length > 0 && nextChars > capabilities.maxCharactersPerBatch;
      if (countOverflow || charOverflow) break;
      windowSegments.push({ id: candidate.id, sourceText: candidate.sourceText });
      chars = nextChars;
    }

    if (windowSegments.length === 0) {
      const candidate = document.segments[start];
      windowSegments.push({ id: candidate.id, sourceText: candidate.sourceText });
    }

    const effectiveStride =
      start + windowSegments.length >= document.segments.length
        ? windowSegments.length
        : Math.min(requestedBatchStride, windowSegments.length);

    batches.push({
      ...requestBase,
      batchId: `batch-${String(batches.length + 1).padStart(3, '0')}`,
      segments: windowSegments,
      targetSegmentIds: windowSegments.slice(0, effectiveStride).map((segment) => segment.id)
    });

    start += effectiveStride;
  }
  return batches;
}
