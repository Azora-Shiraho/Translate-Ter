import type { SubtitleDocument, SubtitleSegment } from '../models';
import type { ProviderCapabilities, TranslationBatchRequest } from './types';

export function createSubtitleBatches(
  document: SubtitleDocument,
  capabilities: ProviderCapabilities,
  requestBase: Omit<TranslationBatchRequest, 'batchId' | 'segments'>
): TranslationBatchRequest[] {
  const batches: TranslationBatchRequest[] = [];
  let current: Pick<SubtitleSegment, 'id' | 'sourceText'>[] = [];
  let chars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({
      ...requestBase,
      batchId: `batch-${String(batches.length + 1).padStart(3, '0')}`,
      segments: current
    });
    current = [];
    chars = 0;
  };

  for (const segment of document.segments) {
    const length = segment.sourceText.length;
    const wouldOverflow =
      current.length >= capabilities.maxSegmentsPerBatch ||
      chars + length > capabilities.maxCharactersPerBatch;

    if (wouldOverflow) flush();
    current.push({ id: segment.id, sourceText: segment.sourceText });
    chars += length;
  }

  flush();
  return batches;
}
