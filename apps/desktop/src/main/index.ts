import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type {
  AssetEvent,
  AppSettingsPatch,
  BilingualOrder,
  CreateJobRequest,
  ExportVariant,
  FasterWhisperCudaRequest,
  FasterWhisperRuntimeRequest,
  FfmpegRequest,
  JobEvent,
  JobSnapshot,
  ProviderSecretInput,
  SubtitleDocument,
  SubtitleSegment,
  WhisperModelRequest,
  WhisperRuntimeRequest
} from '@shared/models';
import { serializeAss } from '@shared/ass';
import { JobManager } from './services/jobManager';
import { FasterWhisperService } from './services/fasterWhisperService';
import { NativeBackendClient } from './services/nativeBackendClient';
import { NativeMediaService } from './services/nativeMediaService';
import {
  assertNativeSubtitlePayload,
  NativeSubtitleService
} from './services/nativeSubtitleService';
import {
  shouldUseNativeSrtSerialization,
  shouldUseTypeScriptAssSerialization
} from './services/nativeLocalCapabilityPolicy';
import { SettingsStore } from './services/settingsStore';
import { FfmpegAssetManager } from './services/ffmpegAssets';
import { AppLogger, type RendererLogWriteInput } from './services/logger';
import { WhisperAssetManager } from './services/whisperAssets';
import { mergeFasterWhisperRuntimeRequestWithSettings } from './services/fasterWhisperRuntimeOptions';
import { mergeWhisperRuntimeRequestWithSettings } from './services/whisperRuntimeRequestMerge';
import { asrProviders } from './services/asrProviders';
import { createMainAsrProviderRegistry } from './providers/asrProviderRegistry';
import { createMainTranslationProviderRegistry } from './providers/translationProviderRegistry';

let mainWindow: BrowserWindow | undefined;
const logger = new AppLogger();
const appLogger = logger.createScope('app');
const ipcLogger = logger.createScope('ipc');
const jobLogger = logger.createScope('jobs');
const assetLogger = logger.createScope('assets');
const settingsStore = new SettingsStore();
const whisperAssets = new WhisperAssetManager();
const ffmpegAssets = new FfmpegAssetManager();
const nativeBackend = new NativeBackendClient(logger.createScope('native-backend'));
const nativeMediaService = new NativeMediaService(nativeBackend);
const nativeSubtitleService = new NativeSubtitleService(nativeBackend);
const fasterWhisper = new FasterWhisperService(logger.createScope('faster-whisper'));
const providerHealthLogger = logger.createScope('provider-health');
const asrProviderRegistry = createMainAsrProviderRegistry({
  settingsStore,
  whisperAssets,
  nativeBackend,
  fasterWhisper,
  logger: providerHealthLogger
});
const translationProviderRegistry = createMainTranslationProviderRegistry({
  settingsStore,
  logger: providerHealthLogger
});
const jobManager = new JobManager(
  settingsStore,
  nativeBackend,
  nativeMediaService,
  fasterWhisper,
  asrProviderRegistry,
  translationProviderRegistry
);

function createWindow(): void {
  appLogger.info('window.create', 'Creating main window.', {
    width: 1280,
    height: 820
  });
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Translate-Ter',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    appLogger.info('window.load-url', 'Loading renderer development URL.', {
      url: process.env.ELECTRON_RENDERER_URL
    });
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    appLogger.info('window.load-file', 'Loading packaged renderer file.');
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('unresponsive', () => {
    appLogger.warn('window.unresponsive', 'The main window became unresponsive.');
  });
  mainWindow.on('responsive', () => {
    appLogger.info('window.responsive', 'The main window is responsive again.');
  });
  mainWindow.on('closed', () => {
    appLogger.info('window.closed', 'The main window was closed.');
    mainWindow = undefined;
  });
}

app.whenReady().then(() => {
  void (async () => {
    const initialSettings = await settingsStore.get();
    const logFilePath = await logger.initialize(initialSettings.logLevel);
    appLogger.info('lifecycle.ready', 'Electron app is ready.', {
      logFilePath,
      packaged: app.isPackaged
    });
    Menu.setApplicationMenu(null);
    registerIpc();
    const smokeHandled = await maybeRunFasterWhisperSmokeTest();
    if (smokeHandled) {
      appLogger.info('smoke-test.handled', 'Faster-whisper smoke test mode handled startup.');
      return;
    }

    createWindow();

    app.on('activate', () => {
      appLogger.debug('lifecycle.activate', 'Application activate event fired.');
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })().catch((error) => {
    appLogger.error('startup.failed', 'Application startup failed.', {
      error
    });
  });
});

app.on('window-all-closed', () => {
  appLogger.info('lifecycle.window-all-closed', 'All windows were closed.');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appLogger.info('lifecycle.before-quit', 'Application is shutting down.');
  void logger.dispose();
});

function registerIpc(): void {
  const infoChannels = new Set([
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

  const registerHandle = <Args extends unknown[], Result>(
    channel: string,
    handler: (_event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const requestId = `ipc-${crypto.randomUUID()}`;
      const shouldInfoLog = infoChannels.has(channel);
      if (ipcLogger.shouldLog('debug')) {
        ipcLogger.debug('request', 'IPC request received.', {
          requestId,
          channel,
          args
        });
      } else if (shouldInfoLog) {
        ipcLogger.info('request', 'IPC request received.', {
          requestId,
          channel,
          args: summarizeIpcValue(args)
        });
      }

      try {
        const result = await handler(event, ...(args as Args));
        if (ipcLogger.shouldLog('debug')) {
          ipcLogger.debug('response', 'IPC request completed.', {
            requestId,
            channel,
            result
          });
        } else if (shouldInfoLog) {
          ipcLogger.info('response', 'IPC request completed.', {
            requestId,
            channel,
            result: summarizeIpcValue(result)
          });
        }
        return result;
      } catch (error) {
        ipcLogger.error('response.error', 'IPC request failed.', {
          requestId,
          channel,
          error,
          args: shouldInfoLog ? summarizeIpcValue(args) : undefined
        });
        throw error;
      }
    });
  };

  ipcMain.on('logs:write', (_event, entry: RendererLogWriteInput) => {
    logger.writeFromRenderer(entry);
  });

  jobManager.on('job-event', (event: JobEvent) => {
    if (event.type === 'error') {
      jobLogger.error('event', event.message, event);
    } else if (event.type === 'progress') {
      jobLogger.info('event', event.message ?? 'Job progress update.', event);
    } else {
      jobLogger.debug('event', 'Job snapshot updated.', {
        jobId: event.job.id,
        stage: event.job.stage,
        step: event.job.step,
        progress: event.job.progress
      });
    }
    mainWindow?.webContents.send('jobs:event', event);
  });
  whisperAssets.on('asset-event', (event: AssetEvent) => {
    logAssetEvent('whisper.cpp', event);
    mainWindow?.webContents.send('assets:event', event);
  });
  ffmpegAssets.on('asset-event', (event: AssetEvent) => {
    logAssetEvent('ffmpeg', event);
    mainWindow?.webContents.send('assets:event', event);
  });
  fasterWhisper.on('asset-event', (event: AssetEvent) => {
    logAssetEvent('faster-whisper', event);
    mainWindow?.webContents.send('assets:event', event);
  });

  async function selectMedia(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import video or audio',
      properties: ['openFile'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'mp3', 'wav', 'm4a', 'aac'] },
        { name: 'SRT', extensions: ['srt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    return result.canceled ? undefined : result.filePaths[0];
  }

  async function startTranscription(request: CreateJobRequest): Promise<JobSnapshot> {
    const job = jobManager.create(request);
    await jobManager.start(job.id);
    return jobManager.get(job.id);
  }

  async function exportSrt(payload: {
    document: SubtitleDocument;
    path: string;
    variant: ExportVariant;
    bilingualOrder: BilingualOrder;
  }): Promise<void> {
    const settings = await settingsStore.get();
    const format = resolveSubtitleFileFormat(payload.path, settings.exportFileFormat);
    let serialized: string;
    if (shouldUseTypeScriptAssSerialization(format)) {
      serialized = serializeAss(payload.document, {
        variant: payload.variant,
        bilingualOrder: payload.bilingualOrder
      });
    } else if (shouldUseNativeSrtSerialization(format)) {
      const response = await nativeSubtitleService.serializeSrt(payload.document, {
        variant: payload.variant,
        bilingualOrder: payload.bilingualOrder
      });
      serialized = assertNativeSubtitlePayload(
        response,
        'The subtitle file could not be exported through the native backend.'
      ).srt;
    } else {
      throw new Error(`Unsupported subtitle export format: ${format}`);
    }
    await writeFile(payload.path, serialized, 'utf8');
  }

  async function selectExportDirectory(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select subtitle export folder',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? undefined : result.filePaths[0];
  }

  async function exportConfiguredSrt(payload: {
    document: SubtitleDocument;
    mediaPath: string;
    variant: ExportVariant;
  }): Promise<{ path?: string; cancelled: boolean }> {
    const settings = await settingsStore.get();
    const path = await resolveExportPath(payload.mediaPath, payload.variant, settings);
    if (!path) return { cancelled: true };

    if (existsSync(path)) {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Overwrite subtitle file?',
        message: 'The target subtitle file already exists.',
        detail: path
      });
      if (result.response !== 0) return { cancelled: true };
    }

    await exportSrt({
      document: payload.document,
      path,
      variant: payload.variant,
      bilingualOrder: settings.exportBilingualOrder
    });
    return { path, cancelled: false };
  }

  async function resolveExportPath(
    mediaPath: string,
    variant: ExportVariant,
    settings: Awaited<ReturnType<SettingsStore['get']>>
  ): Promise<string | undefined> {
    const defaultName = defaultSubtitleFileName(mediaPath, variant, settings.exportFileFormat);
    if (settings.exportDestinationMode === 'ask-each-time') {
      const { extension, filterName } = exportFileFormatMeta(settings.exportFileFormat);
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export subtitle',
        defaultPath: join(dirname(mediaPath), defaultName),
        filters: [{ name: filterName, extensions: [extension] }]
      });
      return result.canceled ? undefined : result.filePath;
    }

    const targetDir =
      settings.exportDestinationMode === 'selected-directory' && settings.exportDirectory
        ? settings.exportDirectory
        : dirname(mediaPath);
    return join(targetDir, defaultName);
  }

  function defaultSubtitleFileName(mediaPath: string, variant: ExportVariant, format: 'srt' | 'ass'): string {
    const extension = extname(mediaPath);
    const name = basename(mediaPath, extension);
    const suffix = variant === 'source' ? 'source' : variant === 'bilingual' ? 'bilingual' : 'translated';
    return `${name}.${suffix}.${format}`;
  }

  function resolveSubtitleFileFormat(path: string, fallback: 'srt' | 'ass'): 'srt' | 'ass' {
    const extension = extname(path).toLowerCase();
    if (extension === '.ass') return 'ass';
    if (extension === '.srt') return 'srt';
    return fallback;
  }

  function exportFileFormatMeta(format: 'srt' | 'ass'): { extension: 'srt' | 'ass'; filterName: string } {
    return format === 'ass'
      ? { extension: 'ass', filterName: 'Advanced SubStation Alpha' }
      : { extension: 'srt', filterName: 'SubRip Subtitle' };
  }

  registerHandle('selectVideo', async () => selectMedia());
  registerHandle('selectDirectory', async () => selectExportDirectory());
  registerHandle('startTranscription', async (_event, request: CreateJobRequest) => startTranscription(request));
  registerHandle('startTranslation', async (_event, jobId: string) => jobManager.translate(jobId));
  registerHandle(
    'exportSrt',
    async (
      _event,
      payload: { document: SubtitleDocument; path: string; variant: ExportVariant; bilingualOrder: BilingualOrder }
    ) => exportSrt(payload)
  );
  registerHandle(
    'exportConfiguredSrt',
    async (_event, payload: { document: SubtitleDocument; mediaPath: string; variant: ExportVariant }) =>
      exportConfiguredSrt(payload)
  );
  registerHandle('getSettings', async () => settingsStore.get());
  registerHandle('saveSettings', async (_event, patch: AppSettingsPatch) => {
    const next = await settingsStore.update(patch);
    logger.setLevel(next.logLevel);
    return next;
  });

  registerHandle('desktop:select-media', async () => {
    return selectMedia();
  });

  registerHandle('jobs:create', async (_event, request: CreateJobRequest) => jobManager.create(request));
  registerHandle('jobs:start', async (_event, jobId: string) => jobManager.start(jobId));
  registerHandle('jobs:translate', async (_event, jobId: string) => jobManager.translate(jobId));
  registerHandle('jobs:cancel', async (_event, jobId: string) => jobManager.cancel(jobId));
  registerHandle('jobs:get', async (_event, jobId: string) => jobManager.get(jobId));

  registerHandle('subtitles:import-srt', async (_event, path: string) => {
    const raw = await readFile(path, 'utf8');
    const response = await nativeSubtitleService.parseSrt(raw, { inputMediaPath: path });
    return assertNativeSubtitlePayload(response, 'The subtitle file could not be read.').document;
  });

  registerHandle(
    'subtitles:export-srt',
    async (
      _event,
      payload: {
        document: SubtitleDocument;
        path: string;
        variant: ExportVariant;
        bilingualOrder: BilingualOrder;
      }
    ) => {
      await exportSrt(payload);
    }
  );

  registerHandle('subtitles:update-segment', async (_event, jobId: string, segment: SubtitleSegment) =>
    jobManager.updateSegment(jobId, segment)
  );

  registerHandle('settings:get', async () => settingsStore.get());
  registerHandle('settings:update', async (_event, patch: AppSettingsPatch) => {
    const next = await settingsStore.update(patch);
    logger.setLevel(next.logLevel);
    return next;
  });
  registerHandle('settings:get-secret', async (_event, providerId: string) => settingsStore.getSecret(providerId));
  registerHandle('settings:set-secret', async (_event, providerId: string, secret: ProviderSecretInput) =>
    settingsStore.setSecret(providerId, secret)
  );
  registerHandle('settings:test-provider', async (_event, providerId: string) => {
    const asrHealth = await asrProviderRegistry.health(providerId);
    if (asrHealth) return asrHealth;
    const translationHealth = await translationProviderRegistry.health(providerId);
    if (translationHealth) return translationHealth;

    const asrProvider = asrProviders.find((provider) => provider.id === providerId);
    if (asrProvider) return asrProvider.health();
    const secret = settingsStore.getSecret(providerId);
    return {
      providerId,
      ok: Boolean(secret?.apiKey),
      status: secret?.apiKey ? 'healthy' : 'unconfigured',
      message: secret?.apiKey ? undefined : 'The API key has not been filled in yet.'
    };
  });

  registerHandle('assets:list-whisper-models', async (_event, providerId?: string) => {
    const settings = await settingsStore.get();
    const resolvedProviderId = providerId ?? settings.asrProviderId;
    if (resolvedProviderId === 'local.faster-whisper') {
      return fasterWhisper.listModels();
    }
    return whisperAssets.listModels();
  });
  registerHandle('assets:ensure-whisper-model', async (_event, request: WhisperModelRequest) => {
    const settings = await settingsStore.get();
    return whisperAssets.ensureModel({
      ...request,
      useMultiThreadDownload: request.useMultiThreadDownload ?? settings.enableMultiThreadDownload
    });
  });
  registerHandle('assets:ensure-whisper-runtime', async (_event, request: WhisperRuntimeRequest) => {
    const settings = await settingsStore.get();
    return whisperAssets.ensureRuntime(mergeWhisperRuntimeRequestWithSettings(request, settings));
  });
  registerHandle('assets:ensure-faster-whisper-runtime', async (_event, request: FasterWhisperRuntimeRequest) => {
    const settings = await settingsStore.get();
    return fasterWhisper.ensureRuntime(mergeFasterWhisperRuntimeRequestWithSettings(request, settings));
  });
  registerHandle('assets:ensure-faster-whisper-cuda', async (_event, request: FasterWhisperCudaRequest) => {
    const settings = await settingsStore.get();
    return fasterWhisper.ensureCudaRuntime({
      ...request,
      useMultiThreadDownload: request.useMultiThreadDownload ?? settings.enableMultiThreadDownload
    });
  });
  registerHandle('assets:ensure-ffmpeg', async (_event, request: FfmpegRequest) => {
    const settings = await settingsStore.get();
    const status = await ffmpegAssets.ensureInstalled({
      ...request,
      useMultiThreadDownload: request.useMultiThreadDownload ?? settings.enableMultiThreadDownload
    });
    await nativeBackend.cancelRunningWork();
    return status;
  });
  registerHandle('assets:delete-model', async (_event, modelId: string) => whisperAssets.deleteModel(modelId));
  registerHandle('native:health', async () => nativeBackend.health());
}

function logAssetEvent(source: string, event: AssetEvent): void {
  const details = {
    source,
    ...event
  };
  if (event.type === 'error') {
    assetLogger.error('event', event.message, details);
    return;
  }
  if (event.type === 'download-progress') {
    assetLogger.info('event', event.message, details);
    return;
  }
  assetLogger.info('event', event.message, details);
}

function summarizeIpcValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      sample: value.slice(0, 3).map((entry) => summarizeIpcValue(entry))
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
  if ('id' in record && typeof record.id === 'string') {
    summary.id = record.id;
  }
  if ('jobId' in record && typeof record.jobId === 'string') {
    summary.jobId = record.jobId;
  }
  if ('message' in record && typeof record.message === 'string') {
    summary.message = record.message;
  }
  return summary;
}

async function maybeRunFasterWhisperSmokeTest(): Promise<boolean> {
  if (process.env.TRANSLATE_TER_SMOKE_TEST_FASTWHISPER !== '1') {
    return false;
  }

  const modelId = process.env.TRANSLATE_TER_SMOKE_TEST_MODEL?.trim() || 'ggml-base';
  const allowDownload = process.env.TRANSLATE_TER_SMOKE_TEST_ALLOW_DOWNLOAD === '1';
  const preferCuda = process.env.TRANSLATE_TER_SMOKE_TEST_PREFER_CUDA === '1';
  const useMultiThreadDownload = process.env.TRANSLATE_TER_SMOKE_TEST_MULTI !== '0';
  const forceManaged = process.env.TRANSLATE_TER_SMOKE_TEST_FORCE_MANAGED !== '0';
  const shouldTranscribe = process.env.TRANSLATE_TER_SMOKE_TEST_TRANSCRIBE === '1';
  const audioPath = process.env.TRANSLATE_TER_SMOKE_TEST_AUDIO_PATH?.trim();
  const logAssetEvent = (event: AssetEvent): void => {
    console.log(
      JSON.stringify({
        smoke: 'faster-whisper',
        type: 'asset-event',
        event
      })
    );
  };

  fasterWhisper.on('asset-event', logAssetEvent);
  try {
    console.log(
      JSON.stringify({
        smoke: 'faster-whisper',
        type: 'start',
        request: {
          modelId,
          allowDownload,
          preferCuda,
          useMultiThreadDownload,
          forceManaged
        }
      })
    );
    const result = await fasterWhisper.ensureRuntime({
      modelId,
      allowDownload,
      preferCuda,
      useMultiThreadDownload,
      forceManaged
    });
    if (shouldTranscribe) {
      if (!audioPath) {
        throw new Error('TRANSLATE_TER_SMOKE_TEST_AUDIO_PATH is required when TRANSLATE_TER_SMOKE_TEST_TRANSCRIBE=1.');
      }
      const document = await fasterWhisper.transcribe({
        jobId: 'smoke-test',
        audioPath,
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        modelId,
        preferCuda,
        allowDownload,
        useMultiThreadDownload
      });
      console.log(
        JSON.stringify({
          smoke: 'faster-whisper',
          type: 'transcribe-result',
          summary: {
            asrProvider: document.metadata.asrProvider,
            segmentCount: document.segments.length,
            sourceLanguage: document.sourceLanguage,
            warningCount: document.metadata.warnings.length
          }
        })
      );
    }
    console.log(
      JSON.stringify({
        smoke: 'faster-whisper',
        type: 'result',
        result
      })
    );
    app.exit(result.ok ? 0 : 2);
  } catch (error) {
    console.error(
      JSON.stringify({
        smoke: 'faster-whisper',
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    );
    app.exit(1);
  } finally {
    fasterWhisper.off('asset-event', logAssetEvent);
  }

  return true;
}
