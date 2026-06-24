import type { SubtitleDocument, SubtitleSegment } from './models';

const DEFAULT_LINE_LENGTH = 24;
const MAX_LINES_PER_SEGMENT = 2;
const MIN_SEGMENT_SPLIT_DURATION_MS = 3200;
const MIN_CHUNK_DURATION_MS = 1400;
const MAX_SEGMENT_CHAR_COUNT = DEFAULT_LINE_LENGTH * MAX_LINES_PER_SEGMENT;

export function normalizeSubtitleDocumentLayout(document: SubtitleDocument): SubtitleDocument {
  const splitSegments = splitLongSubtitleSegments(document.segments);
  return {
    ...document,
    segments: splitSegments.map((segment, index) => ({
      ...segment,
      index: index + 1,
      sourceText: wrapSubtitleText(segment.sourceText),
      translatedText: segment.translatedText ? wrapSubtitleText(segment.translatedText) : segment.translatedText
    }))
  };
}

export function wrapSubtitleText(text: string, maxLineLength = DEFAULT_LINE_LENGTH): string {
  const normalized = normalizeSubtitleWhitespace(text);
  if (!normalized) return '';

  if (!normalized.includes(' ')) {
    return chunkCompactText(normalized, maxLineLength).join('\n');
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxLineLength) {
      lines.push(current);
      if (word.length > maxLineLength) {
        const slices = chunkCompactText(word, maxLineLength);
        current = slices.pop() ?? '';
        lines.push(...slices);
      } else {
        current = word;
      }
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function splitLongSubtitleSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.flatMap((segment) => splitSubtitleSegment(segment));
}

function splitSubtitleSegment(segment: SubtitleSegment): SubtitleSegment[] {
  const normalizedSegment: SubtitleSegment = {
    ...segment,
    sourceText: normalizeSubtitleWhitespace(segment.sourceText),
    translatedText: segment.translatedText ? normalizeSubtitleWhitespace(segment.translatedText) : segment.translatedText
  };
  if (normalizedSegment.translatedText) {
    return [normalizedSegment];
  }

  const durationMs = Math.max(0, normalizedSegment.endMs - normalizedSegment.startMs);
  const lineCount = countWrappedLines(normalizedSegment.sourceText);
  if (
    !normalizedSegment.sourceText ||
    durationMs < MIN_SEGMENT_SPLIT_DURATION_MS ||
    lineCount <= MAX_LINES_PER_SEGMENT
  ) {
    return [normalizedSegment];
  }

  const maxChunksByDuration = Math.max(1, Math.floor(durationMs / MIN_CHUNK_DURATION_MS));
  let desiredChunkCount = Math.min(maxChunksByDuration, Math.ceil(lineCount / MAX_LINES_PER_SEGMENT));
  if (desiredChunkCount <= 1) {
    return [normalizedSegment];
  }

  let chunks: string[] = [];
  while (desiredChunkCount <= maxChunksByDuration) {
    chunks = splitTextIntoBalancedChunks(normalizedSegment.sourceText, desiredChunkCount);
    if (chunks.length > 1 && chunks.every((chunk) => countWrappedLines(chunk) <= MAX_LINES_PER_SEGMENT)) {
      break;
    }
    desiredChunkCount += 1;
  }

  if (chunks.length <= 1) {
    return [normalizedSegment];
  }

  const timings = distributeChunkTimings(normalizedSegment.startMs, normalizedSegment.endMs, chunks);
  return chunks.map((chunk, index) => ({
    ...normalizedSegment,
    id: `${normalizedSegment.id}-part-${index + 1}`,
    startMs: timings[index].startMs,
    endMs: timings[index].endMs,
    sourceText: chunk
  }));
}

function splitTextIntoBalancedChunks(text: string, chunkCount: number): string[] {
  const normalized = normalizeSubtitleWhitespace(text);
  if (!normalized || chunkCount <= 1) {
    return normalized ? [normalized] : [];
  }

  let units = splitPreferredUnits(normalized);
  let separator = normalized.includes(' ') ? ' ' : '';
  if (units.length < chunkCount) {
    if (normalized.includes(' ')) {
      units = normalized.split(' ').filter(Boolean);
      separator = ' ';
    } else {
      units = Array.from(normalized);
      separator = '';
    }
  }

  if (units.length <= 1) {
    return chunkCompactText(normalized, Math.max(DEFAULT_LINE_LENGTH, Math.ceil(normalized.length / chunkCount)));
  }

  const weights = units.map(measureTextWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const chunks: string[] = [];
  let unitIndex = 0;
  let consumedWeight = 0;

  for (let chunkIndex = 0; chunkIndex < chunkCount && unitIndex < units.length; chunkIndex += 1) {
    const remainingChunks = chunkCount - chunkIndex;
    const remainingWeight = totalWeight - consumedWeight;
    if (remainingChunks === 1) {
      chunks.push(joinUnits(units.slice(unitIndex), separator));
      unitIndex = units.length;
      break;
    }

    const targetWeight = remainingWeight / remainingChunks;
    const currentUnits: string[] = [];
    let currentWeight = 0;

    while (unitIndex < units.length) {
      const unitsLeft = units.length - unitIndex;
      if (currentUnits.length > 0 && unitsLeft <= remainingChunks - 1) {
        break;
      }

      const nextUnit = units[unitIndex];
      const nextWeight = weights[unitIndex];
      const projectedWeight = currentWeight + nextWeight;
      const currentText = joinUnits(currentUnits, separator);
      const projectedText = joinUnits([...currentUnits, nextUnit], separator);
      const shouldBreakBeforeNext =
        currentUnits.length > 0 &&
        (projectedText.length > MAX_SEGMENT_CHAR_COUNT ||
          (projectedWeight > targetWeight * 1.18 &&
            (projectedWeight - targetWeight > targetWeight - currentWeight || endsWithHardBreak(currentText))));
      if (shouldBreakBeforeNext) {
        break;
      }

      currentUnits.push(nextUnit);
      currentWeight = projectedWeight;
      unitIndex += 1;

      const nextText = joinUnits(currentUnits, separator);
      if (
        currentWeight >= targetWeight &&
        (endsWithHardBreak(nextText) || currentWeight >= targetWeight * 1.05)
      ) {
        break;
      }
    }

    if (currentUnits.length === 0 && unitIndex < units.length) {
      currentUnits.push(units[unitIndex]);
      currentWeight += weights[unitIndex];
      unitIndex += 1;
    }

    chunks.push(joinUnits(currentUnits, separator));
    consumedWeight += currentWeight;
  }

  if (unitIndex < units.length) {
    chunks[chunks.length - 1] = joinUnits(
      [chunks[chunks.length - 1], joinUnits(units.slice(unitIndex), separator)].filter(Boolean),
      separator
    );
  }

  return rebalanceTrailingShortChunks(chunks.filter(Boolean), chunkCount, separator);
}

function splitPreferredUnits(text: string): string[] {
  const clauses = text
    .match(/[^,.;!?，。！？；：]+(?:[,.;!?，。！？；：]+)?/g)
    ?.map((entry) => entry.trim())
    .filter(Boolean);
  if (clauses && clauses.length > 1) {
    return clauses;
  }
  if (text.includes(' ')) {
    return text.split(' ').filter(Boolean);
  }
  return Array.from(text);
}

function rebalanceTrailingShortChunks(chunks: string[], desiredCount: number, separator: string): string[] {
  if (chunks.length <= 1) return chunks;
  const output = [...chunks];
  while (output.length > desiredCount) {
    const tail = output.pop();
    if (!tail) break;
    output[output.length - 1] = joinUnits([output[output.length - 1], tail].filter(Boolean), separator);
  }
  while (output.length >= 2 && measureTextWeight(output[output.length - 1]) <= 6) {
    const tail = output.pop();
    if (!tail) break;
    output[output.length - 1] = joinUnits([output[output.length - 1], tail].filter(Boolean), separator);
  }
  return output;
}

function distributeChunkTimings(
  startMs: number,
  endMs: number,
  chunks: string[]
): Array<{ startMs: number; endMs: number }> {
  const totalDuration = Math.max(endMs - startMs, chunks.length);
  const weights = chunks.map((chunk) => Math.max(1, measureTextWeight(chunk)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = startMs;
  let consumedWeight = 0;

  return chunks.map((chunk, index) => {
    if (index === chunks.length - 1) {
      return { startMs: cursor, endMs };
    }

    const remainingChunks = chunks.length - index;
    const remainingWeight = totalWeight - consumedWeight;
    const remainingDuration = endMs - cursor;
    const maxEnd = endMs - MIN_CHUNK_DURATION_MS * (remainingChunks - 1);
    const idealDuration = Math.round((remainingDuration * weights[index]) / remainingWeight);
    const nextEnd = Math.min(maxEnd, cursor + Math.max(MIN_CHUNK_DURATION_MS, idealDuration));
    const slice = {
      startMs: cursor,
      endMs: Math.max(cursor + 1, nextEnd)
    };
    cursor = slice.endMs;
    consumedWeight += weights[index];
    return slice;
  });
}

function countWrappedLines(text: string): number {
  const wrapped = wrapSubtitleText(text);
  return wrapped ? wrapped.split('\n').length : 0;
}

function chunkCompactText(text: string, chunkSize: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(''));
  }
  return chunks;
}

function normalizeSubtitleWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function measureTextWeight(text: string): number {
  return Math.max(1, text.replace(/\s+/g, '').length);
}

function endsWithHardBreak(text: string): boolean {
  return /[,.;!?，。！？；：]$/.test(text.trim());
}

function joinUnits(units: string[], separator: string): string {
  return units.filter(Boolean).join(separator).replace(/\s+([,.;!?，。！？；：])/g, '$1').trim();
}
