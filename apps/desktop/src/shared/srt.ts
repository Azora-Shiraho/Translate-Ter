import type { SubtitleDocument, SubtitleSegment, SubtitleWarning } from './models';

const TIMESTAMP_PATTERN =
  /^(\d{1,2}):([0-5]\d):([0-5]\d),(\d{1,3})\s*-->\s*(\d{1,2}):([0-5]\d):([0-5]\d),(\d{1,3})(?:\s+.*)?$/;

export type ParseSrtOptions = {
  sourceLanguage?: string;
  inputMediaPath?: string;
};

export function parseSrt(input: string, options: ParseSrtOptions = {}): SubtitleDocument {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const warnings: SubtitleWarning[] = [];
  const blocks = normalized.length === 0 ? [] : normalized.split(/\n{2,}/);
  const segments: SubtitleSegment[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const lines = blocks[blockIndex].split('\n');
    if (lines.length < 2) {
      warnings.push({
        code: 'ParseError',
        message: `Skipped malformed SRT block ${blockIndex + 1}.`,
        userMessage: {
          messageKey: 'runtimeMessage.warningMalformedSrt',
          messageParams: { block: blockIndex + 1 }
        }
      });
      continue;
    }

    const indexLine = lines.shift()!.trim();
    const parsedIndex = Number.parseInt(indexLine, 10);
    const timingLine = lines.shift()!.trim();
    const timing = TIMESTAMP_PATTERN.exec(timingLine);

    if (!timing) {
      warnings.push({
        code: 'ParseError',
        message: `Skipped block ${indexLine || blockIndex + 1}: invalid timestamp.`,
        userMessage: {
          messageKey: 'runtimeMessage.warningInvalidTimestamp',
          messageParams: { block: indexLine || blockIndex + 1 }
        }
      });
      continue;
    }

    const startMs = timestampPartsToMs(timing.slice(1, 5));
    const endMs = timestampPartsToMs(timing.slice(5, 9));
    const sourceText = lines.join('\n').trim();
    const id = `seg-${String(segments.length + 1).padStart(4, '0')}`;
    const segmentWarnings: string[] = [];

    if (endMs <= startMs) {
      segmentWarnings.push('End time must be after start time.');
      warnings.push({
        code: 'InvalidTiming',
        message: 'End time must be after start time.',
        userMessage: { messageKey: 'runtimeMessage.warningInvalidTiming' },
        segmentId: id
      });
    }

    if (!sourceText) {
      segmentWarnings.push('Subtitle text is empty.');
      warnings.push({
        code: 'EmptyText',
        message: 'Subtitle text is empty.',
        userMessage: { messageKey: 'runtimeMessage.warningEmptyText' },
        segmentId: id
      });
    }

    const previous = segments.at(-1);
    if (previous && startMs < previous.endMs) {
      segmentWarnings.push('Timing overlaps with previous segment.');
      warnings.push({
        code: 'TimingOverlap',
        message: 'Timing overlaps with previous segment.',
        userMessage: { messageKey: 'runtimeMessage.warningTimingOverlap' },
        segmentId: id
      });
    }

    segments.push({
      id,
      index: Number.isFinite(parsedIndex) ? parsedIndex : segments.length + 1,
      startMs,
      endMs,
      sourceText,
      status: segmentWarnings.length > 0 ? 'warning' : 'transcribed',
      notes: segmentWarnings
    });
  }

  return {
    id: `srt-${Date.now()}`,
    format: 'srt',
    sourceLanguage: options.sourceLanguage ?? 'auto',
    segments,
    metadata: {
      inputMediaPath: options.inputMediaPath,
      createdAt: new Date().toISOString(),
      warnings
    }
  };
}

export type SerializeSrtOptions = {
  variant?: 'source' | 'translated' | 'bilingual';
  bilingualOrder?: 'source-first' | 'target-first';
  allowEmpty?: boolean;
};

export function serializeSrt(document: SubtitleDocument, options: SerializeSrtOptions = {}): string {
  const variant = options.variant ?? 'translated';
  const bilingualOrder = options.bilingualOrder ?? 'source-first';
  const sorted = [...document.segments].sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  const blocks = sorted.map((segment, index) => {
    const text = textForVariant(segment, variant, bilingualOrder);
    if (!options.allowEmpty && !text.trim()) {
      throw new Error(`Cannot export empty subtitle segment ${segment.id}.`);
    }
    return [
      String(index + 1),
      `${formatTimestamp(segment.startMs)} --> ${formatTimestamp(segment.endMs)}`,
      text
    ].join('\n');
  });

  return `${blocks.join('\n\n')}\n`;
}

export const writeSrt = serializeSrt;

export function formatTimestamp(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`Invalid timestamp: ${ms}`);
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function textForVariant(
  segment: SubtitleSegment,
  variant: NonNullable<SerializeSrtOptions['variant']>,
  bilingualOrder: NonNullable<SerializeSrtOptions['bilingualOrder']>
): string {
  if (variant === 'source') return segment.sourceText;
  if (variant === 'translated') return segment.translatedText ?? segment.sourceText;
  const translated = segment.translatedText ?? '';
  return bilingualOrder === 'source-first'
    ? [segment.sourceText, translated].filter(Boolean).join('\n')
    : [translated, segment.sourceText].filter(Boolean).join('\n');
}

function timestampPartsToMs(parts: string[]): number {
  const [hours, minutes, seconds, millis] = parts.map((value) => Number.parseInt(value, 10));
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + normalizeMillis(millis);
}

function normalizeMillis(value: number): number {
  if (value < 10) return value * 100;
  if (value < 100) return value * 10;
  return value;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}
