import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppLogLevel,
  AppSettingsPatch,
  AppSettingsPublic,
  ExportVariant,
  CreateJobRequest,
  FasterWhisperCudaRequest,
  FasterWhisperCudaStatus,
  FasterWhisperRuntimeRequest,
  FfmpegRequest,
  FfmpegStatus,
  JobEvent,
  JobSnapshot,
  NativeHealth,
  AssetEvent,
  ProviderHealth,
  ProviderSecretInput,
  SubtitleDocument,
  SubtitleSegment,
  WhisperModelInfo,
  WhisperModelRequest,
  WhisperModelStatus,
  WhisperRuntimeRequest,
  WhisperRuntimeStatus
} from '@shared/models';

type RendererLogEntry = {
  level: AppLogLevel;
  scope?: string;
  event: string;
  message?: string;
  details?: unknown;
};

const INFO_CHANNELS = new Set([
  'selectVideo',
  'selectDirectory',
  'startTranscription',
  'startTranslation',
  'exportConfiguredSrt',
  'getSettings',
  'saveSettings',
  'desktop:select-media',
  'jobs:create',
  'jobs:start',
  'jobs:translate',
  'jobs:cancel',
  'jobs:get',
  'subtitles:import-srt',
  'subtitles:export-srt',
  'subtitles:update-segment',
  'settings:get',
  'settings:update',
  'settings:get-secret',
  'settings:set-secret',
  'settings:test-provider',
  'assets:list-whisper-models',
  'assets:ensure-whisper-model',
  'assets:ensure-whisper-runtime',
  'assets:ensure-faster-whisper-runtime',
  'assets:ensure-faster-whisper-cuda',
  'assets:ensure-ffmpeg',
  'assets:delete-model',
  'native:health'
]);

function writeRendererLog(entry: RendererLogEntry): void {
  ipcRenderer.send('logs:write', entry);
}

function invokeLogged<TResult>(
  channel: string,
  args: unknown[] = [],
  options: {
    info?: boolean;
  } = {}
): Promise<TResult> {
  const requestId = `renderer-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const shouldInfo = options.info ?? INFO_CHANNELS.has(channel);
  const level: AppLogLevel = shouldInfo ? 'info' : 'debug';
  writeRendererLog({
    level,
    scope: 'renderer.ipc',
    event: 'invoke.request',
    message: 'Renderer sent an IPC request.',
    details: {
      requestId,
      channel,
      args: summarizeRendererValue(args)
    }
  });

  return ipcRenderer.invoke(channel, ...args).then(
    (result) => {
      writeRendererLog({
        level,
        scope: 'renderer.ipc',
        event: 'invoke.response',
        message: 'Renderer received an IPC response.',
        details: {
          requestId,
          channel,
          result: summarizeRendererValue(result)
        }
      });
      return result as TResult;
    },
    (error) => {
      writeRendererLog({
        level: 'error',
        scope: 'renderer.ipc',
        event: 'invoke.error',
        message: 'Renderer IPC request failed.',
        details: {
          requestId,
          channel,
          args: summarizeRendererValue(args),
          error
        }
      });
      throw error;
    }
  );
}

function summarizeRendererValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      sample: value.slice(0, 3).map((entry) => summarizeRendererValue(entry))
    };
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record).slice(0, 12)) {
    if (Array.isArray(nestedValue)) {
      summary[key] = {
        kind: 'array',
        length: nestedValue.length
      };
      continue;
    }
    if (nestedValue && typeof nestedValue === 'object') {
      summary[key] = `[${(nestedValue as { constructor?: { name?: string } }).constructor?.name ?? 'Object'}]`;
      continue;
    }
    summary[key] = nestedValue;
  }
  return summary;
}

const api = {
  selectVideo: () => invokeLogged<string | undefined>('selectVideo'),
  selectDirectory: () => invokeLogged<string | undefined>('selectDirectory'),
  startTranscription: (input: CreateJobRequest) =>
    invokeLogged<JobSnapshot>('startTranscription', [input]),
  startTranslation: (jobId: string) => invokeLogged<JobSnapshot>('startTranslation', [jobId]),
  exportSrt: (
    document: SubtitleDocument,
    path: string,
    variant: 'source' | 'translated' | 'bilingual',
    bilingualOrder: 'source-first' | 'target-first'
  ) => invokeLogged<void>('exportSrt', [{ document, path, variant, bilingualOrder }]),
  exportConfiguredSrt: (document: SubtitleDocument, mediaPath: string, variant: ExportVariant) =>
    invokeLogged<{ path?: string; cancelled: boolean }>('exportConfiguredSrt', [{ document, mediaPath, variant }]),
  getSettings: () => invokeLogged<AppSettingsPublic>('getSettings'),
  saveSettings: (patch: AppSettingsPatch) => invokeLogged<AppSettingsPublic>('saveSettings', [patch]),
  desktop: {
    selectMedia: () => invokeLogged<string | undefined>('desktop:select-media')
  },
  jobs: {
    create: (input: CreateJobRequest) => invokeLogged<JobSnapshot>('jobs:create', [input]),
    start: (jobId: string) => invokeLogged<void>('jobs:start', [jobId]),
    translate: (jobId: string) => invokeLogged<JobSnapshot>('jobs:translate', [jobId]),
    cancel: (jobId: string) => invokeLogged<void>('jobs:cancel', [jobId]),
    get: (jobId: string) => invokeLogged<JobSnapshot>('jobs:get', [jobId]),
    onEvent: (listener: (event: JobEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: JobEvent) => listener(payload);
      ipcRenderer.on('jobs:event', handler);
      return () => {
        ipcRenderer.off('jobs:event', handler);
      };
    }
  },
  subtitles: {
    importSrt: (path: string) => invokeLogged<SubtitleDocument>('subtitles:import-srt', [path]),
    exportSrt: (
      document: SubtitleDocument,
      path: string,
      variant: 'source' | 'translated' | 'bilingual',
      bilingualOrder: 'source-first' | 'target-first'
    ) => invokeLogged<void>('subtitles:export-srt', [{ document, path, variant, bilingualOrder }]),
    updateSegment: (jobId: string, segment: SubtitleSegment) =>
      invokeLogged<JobSnapshot>('subtitles:update-segment', [jobId, segment])
  },
  settings: {
    get: () => invokeLogged<AppSettingsPublic>('settings:get'),
    update: (patch: AppSettingsPatch) => invokeLogged<AppSettingsPublic>('settings:update', [patch]),
    getSecret: (providerId: string) => invokeLogged<ProviderSecretInput | undefined>('settings:get-secret', [providerId]),
    setSecret: (providerId: string, secret: ProviderSecretInput) =>
      invokeLogged<void>('settings:set-secret', [providerId, secret]),
    testProvider: (providerId: string) => invokeLogged<ProviderHealth>('settings:test-provider', [providerId])
  },
  assets: {
    listWhisperModels: (providerId?: string) =>
      invokeLogged<WhisperModelInfo[]>('assets:list-whisper-models', providerId === undefined ? [] : [providerId]),
    ensureWhisperModel: (request: WhisperModelRequest) =>
      invokeLogged<WhisperModelStatus>('assets:ensure-whisper-model', [request]),
    ensureWhisperRuntime: (request: WhisperRuntimeRequest) =>
      invokeLogged<WhisperRuntimeStatus>('assets:ensure-whisper-runtime', [request]),
    ensureFasterWhisperRuntime: (request: FasterWhisperRuntimeRequest) =>
      invokeLogged<ProviderHealth>('assets:ensure-faster-whisper-runtime', [request]),
    ensureFasterWhisperCuda: (request: FasterWhisperCudaRequest) =>
      invokeLogged<FasterWhisperCudaStatus>('assets:ensure-faster-whisper-cuda', [request]),
    ensureFfmpeg: (request: FfmpegRequest) =>
      invokeLogged<FfmpegStatus>('assets:ensure-ffmpeg', [request]),
    deleteModel: (modelId: string) => invokeLogged<void>('assets:delete-model', [modelId]),
    onEvent: (listener: (event: AssetEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AssetEvent) => listener(payload);
      ipcRenderer.on('assets:event', handler);
      return () => {
        ipcRenderer.off('assets:event', handler);
      };
    }
  },
  native: {
    health: () => invokeLogged<NativeHealth>('native:health')
  },
  logs: {
    write: (entry: RendererLogEntry) => writeRendererLog(entry),
    debug: (event: string, details?: unknown, scope = 'renderer.ui', message?: string) =>
      writeRendererLog({ level: 'debug', event, details, scope, message }),
    info: (event: string, details?: unknown, scope = 'renderer.ui', message?: string) =>
      writeRendererLog({ level: 'info', event, details, scope, message }),
    warning: (event: string, details?: unknown, scope = 'renderer.ui', message?: string) =>
      writeRendererLog({ level: 'warning', event, details, scope, message }),
    error: (event: string, details?: unknown, scope = 'renderer.ui', message?: string) =>
      writeRendererLog({ level: 'error', event, details, scope, message })
  }
};

contextBridge.exposeInMainWorld('translateTer', api);

export type TranslateTerApi = typeof api;
