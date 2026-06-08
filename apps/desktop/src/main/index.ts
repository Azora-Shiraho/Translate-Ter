import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type {
  AssetEvent,
  BilingualOrder,
  CreateJobRequest,
  ExportVariant,
  JobEvent,
  JobSnapshot,
  SubtitleDocument,
  SubtitleSegment
} from '@shared/models';
import { JobManager } from './services/jobManager';
import { NativeBackendClient } from './services/nativeBackendClient';
import { SettingsStore } from './services/settingsStore';
import { WhisperAssetManager } from './services/whisperAssets';
import { asrProviders } from './services/asrProviders';

let mainWindow: BrowserWindow | undefined;
const settingsStore = new SettingsStore();
const whisperAssets = new WhisperAssetManager();
const nativeBackend = new NativeBackendClient();
const jobManager = new JobManager(settingsStore, whisperAssets, nativeBackend);

function createWindow(): void {
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
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc(): void {
  jobManager.on('job-event', (event: JobEvent) => {
    mainWindow?.webContents.send('jobs:event', event);
  });
  whisperAssets.on('asset-event', (event: AssetEvent) => {
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
    const response = await nativeBackend.serializeSrt({
      segments: payload.document.segments,
      variant: payload.variant,
      bilingualOrder: payload.bilingualOrder
    });
    if (!response.ok || !response.payload?.srt) {
      throw new Error(response.error?.message ?? 'Native backend failed to serialize SRT.');
    }
    await writeFile(payload.path, response.payload.srt, 'utf8');
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
    const defaultName = defaultSubtitleFileName(mediaPath, variant);
    if (settings.exportDestinationMode === 'ask-each-time') {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export subtitle',
        defaultPath: join(dirname(mediaPath), defaultName),
        filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
      });
      return result.canceled ? undefined : result.filePath;
    }

    const targetDir =
      settings.exportDestinationMode === 'selected-directory' && settings.exportDirectory
        ? settings.exportDirectory
        : dirname(mediaPath);
    return join(targetDir, defaultName);
  }

  function defaultSubtitleFileName(mediaPath: string, variant: ExportVariant): string {
    const extension = extname(mediaPath);
    const name = basename(mediaPath, extension);
    const suffix = variant === 'source' ? 'source' : variant === 'bilingual' ? 'bilingual' : 'translated';
    return `${name}.${suffix}.srt`;
  }

  ipcMain.handle('selectVideo', async () => selectMedia());
  ipcMain.handle('selectDirectory', async () => selectExportDirectory());
  ipcMain.handle('startTranscription', async (_event, request: CreateJobRequest) => startTranscription(request));
  ipcMain.handle('startTranslation', async (_event, jobId: string) => jobManager.translate(jobId));
  ipcMain.handle('exportSrt', async (_event, payload) => exportSrt(payload));
  ipcMain.handle('exportConfiguredSrt', async (_event, payload) => exportConfiguredSrt(payload));
  ipcMain.handle('getSettings', async () => settingsStore.get());
  ipcMain.handle('saveSettings', async (_event, patch) => settingsStore.update(patch));

  ipcMain.handle('desktop:select-media', async () => {
    return selectMedia();
  });

  ipcMain.handle('jobs:create', async (_event, request: CreateJobRequest) => jobManager.create(request));
  ipcMain.handle('jobs:start', async (_event, jobId: string) => jobManager.start(jobId));
  ipcMain.handle('jobs:translate', async (_event, jobId: string) => jobManager.translate(jobId));
  ipcMain.handle('jobs:cancel', async (_event, jobId: string) => jobManager.cancel(jobId));
  ipcMain.handle('jobs:get', async (_event, jobId: string) => jobManager.get(jobId));

  ipcMain.handle('subtitles:import-srt', async (_event, path: string) => {
    const raw = await readFile(path, 'utf8');
    const response = await nativeBackend.parseSrt({ srt: raw, inputMediaPath: path });
    if (!response.ok || !response.payload?.document) {
      throw new Error(response.error?.message ?? 'Native backend failed to parse SRT.');
    }
    return response.payload.document as SubtitleDocument;
  });

  ipcMain.handle(
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

  ipcMain.handle('subtitles:update-segment', async (_event, jobId: string, segment: SubtitleSegment) =>
    jobManager.updateSegment(jobId, segment)
  );

  ipcMain.handle('settings:get', async () => settingsStore.get());
  ipcMain.handle('settings:update', async (_event, patch) => settingsStore.update(patch));
  ipcMain.handle('settings:get-secret', async (_event, providerId: string) => settingsStore.getSecret(providerId));
  ipcMain.handle('settings:set-secret', async (_event, providerId, secret) => settingsStore.setSecret(providerId, secret));
  ipcMain.handle('settings:test-provider', async (_event, providerId: string) => {
    if (providerId === 'local.whisper.cpp') {
      const settings = await settingsStore.get();
      const runtime = await whisperAssets.ensureRuntime({
        modelId: settings.whisperModelId,
        allowDownload: settings.allowWhisperAssetDownload,
        preferCuda: settings.localWhisperUseCuda,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'runtime'
      });
      return {
        providerId,
        ok: runtime.binary.verified,
        status: runtime.binary.verified ? 'healthy' : 'degraded',
        message: runtime.binary.verified
          ? 'whisper.cpp runtime is ready.'
          : (runtime.message ?? 'whisper.cpp binary is missing or cannot run.')
      };
    }

    const asrProvider = asrProviders.find((provider) => provider.id === providerId);
    if (asrProvider) return asrProvider.health();
    const secret = settingsStore.getSecret(providerId);
    return {
      providerId,
      ok: Boolean(secret?.apiKey),
      status: secret?.apiKey ? 'healthy' : 'unconfigured',
      message: secret?.apiKey ? undefined : 'Provider API key is not configured.'
    };
  });

  ipcMain.handle('assets:list-whisper-models', async () => whisperAssets.listModels());
  ipcMain.handle('assets:ensure-whisper-runtime', async (_event, request) => {
    const settings = await settingsStore.get();
    return whisperAssets.ensureRuntime({
      ...request,
      useMultiThreadDownload: request.useMultiThreadDownload ?? settings.enableMultiThreadDownload
    });
  });
  ipcMain.handle('assets:delete-model', async (_event, modelId: string) => whisperAssets.deleteModel(modelId));
  ipcMain.handle('native:health', async () => nativeBackend.health());
}
