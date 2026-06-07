import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetEvent, CreateJobRequest, JobEvent, JobSnapshot, SubtitleDocument, SubtitleSegment } from '@shared/models';
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
    variant: 'source' | 'translated' | 'bilingual';
    bilingualOrder: 'source-first' | 'target-first';
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

  ipcMain.handle('selectVideo', async () => selectMedia());
  ipcMain.handle('startTranscription', async (_event, request: CreateJobRequest) => startTranscription(request));
  ipcMain.handle('startTranslation', async (_event, jobId: string) => jobManager.translate(jobId));
  ipcMain.handle('exportSrt', async (_event, payload) => exportSrt(payload));
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
        variant: 'source' | 'translated' | 'bilingual';
        bilingualOrder: 'source-first' | 'target-first';
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
    const asrProvider = asrProviders.find((provider) => provider.id === providerId);
    if (asrProvider) return asrProvider.health();
    const secret = settingsStore.getSecret(providerId);
    return {
      providerId,
      ok: Boolean(secret?.apiKey) || providerId === 'mock.local',
      status: providerId === 'mock.local' || secret?.apiKey ? 'healthy' : 'unconfigured',
      message: secret?.apiKey || providerId === 'mock.local' ? undefined : 'Provider API key is not configured.'
    };
  });

  ipcMain.handle('assets:list-whisper-models', async () => whisperAssets.listModels());
  ipcMain.handle('assets:ensure-whisper-runtime', async (_event, request) => whisperAssets.ensureRuntime(request));
  ipcMain.handle('assets:delete-model', async (_event, modelId: string) => whisperAssets.deleteModel(modelId));
  ipcMain.handle('native:health', async () => nativeBackend.health());
}
