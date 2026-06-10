import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettingsPatch,
  AppSettingsPublic,
  ExportVariant,
  CreateJobRequest,
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

const api = {
  selectVideo: () => ipcRenderer.invoke('selectVideo') as Promise<string | undefined>,
  selectDirectory: () => ipcRenderer.invoke('selectDirectory') as Promise<string | undefined>,
  startTranscription: (input: CreateJobRequest) =>
    ipcRenderer.invoke('startTranscription', input) as Promise<JobSnapshot>,
  startTranslation: (jobId: string) => ipcRenderer.invoke('startTranslation', jobId) as Promise<JobSnapshot>,
  exportSrt: (
    document: SubtitleDocument,
    path: string,
    variant: 'source' | 'translated' | 'bilingual',
    bilingualOrder: 'source-first' | 'target-first'
  ) => ipcRenderer.invoke('exportSrt', { document, path, variant, bilingualOrder }) as Promise<void>,
  exportConfiguredSrt: (document: SubtitleDocument, mediaPath: string, variant: ExportVariant) =>
    ipcRenderer.invoke('exportConfiguredSrt', { document, mediaPath, variant }) as Promise<{ path?: string; cancelled: boolean }>,
  getSettings: () => ipcRenderer.invoke('getSettings') as Promise<AppSettingsPublic>,
  saveSettings: (patch: AppSettingsPatch) => ipcRenderer.invoke('saveSettings', patch) as Promise<AppSettingsPublic>,
  desktop: {
    selectMedia: () => ipcRenderer.invoke('desktop:select-media') as Promise<string | undefined>
  },
  jobs: {
    create: (input: CreateJobRequest) => ipcRenderer.invoke('jobs:create', input) as Promise<JobSnapshot>,
    start: (jobId: string) => ipcRenderer.invoke('jobs:start', jobId) as Promise<void>,
    translate: (jobId: string) => ipcRenderer.invoke('jobs:translate', jobId) as Promise<JobSnapshot>,
    cancel: (jobId: string) => ipcRenderer.invoke('jobs:cancel', jobId) as Promise<void>,
    get: (jobId: string) => ipcRenderer.invoke('jobs:get', jobId) as Promise<JobSnapshot>,
    onEvent: (listener: (event: JobEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: JobEvent) => listener(payload);
      ipcRenderer.on('jobs:event', handler);
      return () => {
        ipcRenderer.off('jobs:event', handler);
      };
    }
  },
  subtitles: {
    importSrt: (path: string) => ipcRenderer.invoke('subtitles:import-srt', path) as Promise<SubtitleDocument>,
    exportSrt: (
      document: SubtitleDocument,
      path: string,
      variant: 'source' | 'translated' | 'bilingual',
      bilingualOrder: 'source-first' | 'target-first'
    ) => ipcRenderer.invoke('subtitles:export-srt', { document, path, variant, bilingualOrder }) as Promise<void>,
    updateSegment: (jobId: string, segment: SubtitleSegment) =>
      ipcRenderer.invoke('subtitles:update-segment', jobId, segment) as Promise<JobSnapshot>
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettingsPublic>,
    update: (patch: AppSettingsPatch) => ipcRenderer.invoke('settings:update', patch) as Promise<AppSettingsPublic>,
    getSecret: (providerId: string) => ipcRenderer.invoke('settings:get-secret', providerId) as Promise<ProviderSecretInput | undefined>,
    setSecret: (providerId: string, secret: ProviderSecretInput) =>
      ipcRenderer.invoke('settings:set-secret', providerId, secret) as Promise<void>,
    testProvider: (providerId: string) => ipcRenderer.invoke('settings:test-provider', providerId) as Promise<ProviderHealth>
  },
  assets: {
    listWhisperModels: () => ipcRenderer.invoke('assets:list-whisper-models') as Promise<WhisperModelInfo[]>,
    ensureWhisperModel: (request: WhisperModelRequest) =>
      ipcRenderer.invoke('assets:ensure-whisper-model', request) as Promise<WhisperModelStatus>,
    ensureWhisperRuntime: (request: WhisperRuntimeRequest) =>
      ipcRenderer.invoke('assets:ensure-whisper-runtime', request) as Promise<WhisperRuntimeStatus>,
    ensureFfmpeg: (request: FfmpegRequest) =>
      ipcRenderer.invoke('assets:ensure-ffmpeg', request) as Promise<FfmpegStatus>,
    deleteModel: (modelId: string) => ipcRenderer.invoke('assets:delete-model', modelId) as Promise<void>,
    onEvent: (listener: (event: AssetEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AssetEvent) => listener(payload);
      ipcRenderer.on('assets:event', handler);
      return () => {
        ipcRenderer.off('assets:event', handler);
      };
    }
  },
  native: {
    health: () => ipcRenderer.invoke('native:health') as Promise<NativeHealth>
  }
};

contextBridge.exposeInMainWorld('translateTer', api);

export type TranslateTerApi = typeof api;
