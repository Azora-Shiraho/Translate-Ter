import type {
  AppLogLevel,
  AppSettingsPatch,
  AppSettingsPublic,
  BilingualOrder,
  CreateJobRequest,
  ExportDestinationMode,
  SubtitleFileFormat,
  ExportVariant,
  FasterWhisperCudaRequest,
  FasterWhisperCudaStatus,
  FasterWhisperRuntimeRequest,
  FasterWhisperRuntimeStatus,
  FfmpegRequest,
  FfmpegStatus,
  JobEvent,
  JobSnapshot,
  NativeHealth,
  NativeProtocolError,
  NativeProtocolRequest,
  NativeProtocolResponse,
  NativeProtocolType,
  LocalAsrCpuMode,
  LocalAsrAcceleration,
  ProviderHealth,
  ProviderSecretInput,
  RuntimeVariant,
  SubtitleDocument,
  SubtitleSegment,
  SubtitleStatus,
  SubtitleWarning,
  UserMessageDescriptor,
  WhisperModelInfo,
  WhisperModelRequest,
  WhisperModelStatus,
  WhisperRuntimeRequest,
  WhisperRuntimeStatus
} from './models';

export type Segment = SubtitleSegment;
export type SegmentStatus = SubtitleStatus;
export type SegmentWarning = SubtitleWarning;

export type SubtitleTimeline = {
  startMs: number;
  endMs: number;
};

export type SegmentPatch = Partial<
  Pick<Segment, 'sourceText' | 'translatedText' | 'speaker' | 'confidence' | 'status' | 'notes'>
> &
  SubtitleTimeline;

export type { SubtitleDocument, SubtitleSegment, SubtitleStatus, SubtitleWarning };
export type {
  AppLogLevel,
  AppSettingsPatch,
  AppSettingsPublic,
  BilingualOrder,
  CreateJobRequest,
  ExportDestinationMode,
  SubtitleFileFormat,
  ExportVariant,
  FasterWhisperCudaRequest,
  FasterWhisperCudaStatus,
  FasterWhisperRuntimeRequest,
  FasterWhisperRuntimeStatus,
  FfmpegRequest,
  FfmpegStatus,
  JobEvent,
  JobSnapshot,
  NativeHealth,
  NativeProtocolError,
  NativeProtocolRequest,
  NativeProtocolResponse,
  NativeProtocolType,
  LocalAsrCpuMode,
  LocalAsrAcceleration,
  ProviderHealth,
  ProviderSecretInput,
  RuntimeVariant,
  UserMessageDescriptor,
  WhisperModelInfo,
  WhisperModelRequest,
  WhisperModelStatus,
  WhisperRuntimeRequest,
  WhisperRuntimeStatus
};

export function createSegment(input: {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText?: string;
  speaker?: string;
  confidence?: number;
  status?: SegmentStatus;
  notes?: string[];
}): Segment {
  return {
    id: input.id,
    index: input.index,
    startMs: input.startMs,
    endMs: input.endMs,
    sourceText: input.sourceText,
    translatedText: input.translatedText,
    speaker: input.speaker,
    confidence: input.confidence,
    status: input.status ?? 'new',
    notes: input.notes
  };
}
