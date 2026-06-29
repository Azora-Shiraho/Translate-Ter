import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslateTerApi } from '../../preload';
import { translateTerGateway } from './translateTerGateway';

function installMockApi(api: TranslateTerApi): void {
  Object.defineProperty(globalThis, 'window', {
    value: { translateTer: api },
    configurable: true,
    writable: true
  });
}

describe('translateTerGateway', () => {
  const jobListener = vi.fn();
  const assetListener = vi.fn();
  const jobUnsubscribe = vi.fn();
  const assetUnsubscribe = vi.fn();
  const getSettingsMock = vi.fn();
  const saveSettingsMock = vi.fn();
  const selectVideoMock = vi.fn();
  const selectMediaMock = vi.fn();
  const selectMultipleMediaMock = vi.fn();
  const getSecretMock = vi.fn();
  const listWhisperModelsMock = vi.fn();
  const ensureFfmpegMock = vi.fn();
  const updateSegmentMock = vi.fn();
  const nativeHealthMock = vi.fn();
  const jobsOnEventMock = vi.fn();
  const assetsOnEventMock = vi.fn();
  const logWarningMock = vi.fn();
  const settingsResult = {
    asrProviderId: 'local.whisper.cpp'
  } as unknown as Awaited<ReturnType<TranslateTerApi['getSettings']>>;
  const settingsPatch = { uiLanguage: 'zh-CN' } as Parameters<TranslateTerApi['saveSettings']>[0];
  const secretResult = { apiKey: 'sk-test' } as unknown as Awaited<
    ReturnType<TranslateTerApi['settings']['getSecret']>
  >;
  const ffmpegRequest = {
    allowDownload: false,
    useMultiThreadDownload: true
  } as Parameters<TranslateTerApi['assets']['ensureFfmpeg']>[0];
  const ffmpegResult = { available: true } as unknown as Awaited<
    ReturnType<TranslateTerApi['assets']['ensureFfmpeg']>
  >;
  const subtitleSegment = { id: 'segment-1', text: 'hello' } as unknown as Parameters<
    TranslateTerApi['subtitles']['updateSegment']
  >[1];
  const subtitleJob = { id: 'job-1' } as unknown as Awaited<
    ReturnType<TranslateTerApi['subtitles']['updateSegment']>
  >;
  const nativeHealth = { status: 'ok' } as unknown as Awaited<ReturnType<TranslateTerApi['native']['health']>>;
  const modelList = [{ id: 'tiny' }] as unknown as Awaited<
    ReturnType<TranslateTerApi['assets']['listWhisperModels']>
  >;

  const mockApi: TranslateTerApi = {
    host: { platform: 'win32' },
    selectVideo: selectVideoMock,
    selectDirectory: vi.fn().mockResolvedValue('D:/exports'),
    startTranscription: vi.fn().mockResolvedValue({ id: 'job-transcribe' }),
    startTranslation: vi.fn().mockResolvedValue({ id: 'job-translate' }),
    exportSrt: vi.fn().mockResolvedValue(undefined),
    exportConfiguredSrt: vi.fn().mockResolvedValue({ cancelled: false, path: 'D:/exports/demo.srt' }),
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
    desktop: {
      selectMedia: selectMediaMock,
      selectMultipleMedia: selectMultipleMediaMock
    },
    jobs: {
      create: vi.fn().mockResolvedValue({ id: 'job-create' }),
      start: vi.fn().mockResolvedValue(undefined),
      translate: vi.fn().mockResolvedValue({ id: 'job-jobs-translate' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ id: 'job-get' }),
      onEvent: jobsOnEventMock
    },
    batch: {
      addJobs: vi.fn().mockResolvedValue({ id: 'batch-queue', status: 'idle', items: [] }),
      start: vi.fn().mockResolvedValue({ id: 'batch-queue', status: 'running', items: [] }),
      cancel: vi.fn().mockResolvedValue({ id: 'batch-queue', status: 'cancelled', items: [] }),
      get: vi.fn().mockResolvedValue({ id: 'batch-queue', status: 'idle', items: [] }),
      onEvent: vi.fn().mockReturnValue(vi.fn())
    },
    subtitles: {
      importSrt: vi.fn().mockResolvedValue({ segments: [] }),
      exportSrt: vi.fn().mockResolvedValue(undefined),
      updateSegment: updateSegmentMock
    },
    settings: {
      get: vi.fn().mockResolvedValue(settingsResult),
      update: vi.fn().mockResolvedValue(settingsResult),
      getSecret: getSecretMock,
      setSecret: vi.fn().mockResolvedValue(undefined),
      testProvider: vi.fn().mockResolvedValue({ ok: true }),
      onEvent: vi.fn().mockReturnValue(vi.fn())
    },
    window: {
      openSettings: vi.fn().mockResolvedValue(undefined)
    },
    assets: {
      listWhisperModels: listWhisperModelsMock,
      ensureWhisperModel: vi.fn().mockResolvedValue({ verified: true }),
      ensureWhisperRuntime: vi.fn().mockResolvedValue({ binary: { verified: true }, model: { verified: true } }),
      ensureFasterWhisperRuntime: vi.fn().mockResolvedValue({ ok: true }),
      ensureFasterWhisperCuda: vi.fn().mockResolvedValue({ cudaSupported: true }),
      ensureFfmpeg: ensureFfmpegMock,
      deleteModel: vi.fn().mockResolvedValue(undefined),
      onEvent: assetsOnEventMock
    },
    native: {
      health: nativeHealthMock
    },
    logs: {
      write: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warning: logWarningMock,
      error: vi.fn()
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue(settingsResult);
    saveSettingsMock.mockResolvedValue(settingsResult);
    selectVideoMock.mockResolvedValue('video.mp4');
    selectMediaMock.mockResolvedValue('media.mp4');
    selectMultipleMediaMock.mockResolvedValue(['media.mp4']);
    getSecretMock.mockResolvedValue(secretResult);
    listWhisperModelsMock.mockResolvedValue(modelList);
    ensureFfmpegMock.mockResolvedValue(ffmpegResult);
    updateSegmentMock.mockResolvedValue(subtitleJob);
    nativeHealthMock.mockResolvedValue(nativeHealth);
    jobsOnEventMock.mockReturnValue(jobUnsubscribe);
    assetsOnEventMock.mockReturnValue(assetUnsubscribe);
    installMockApi(mockApi);
  });

  it('reads host platform lazily from window.translateTer', () => {
    expect(translateTerGateway.host.platform).toBe('win32');
  });

  it('passes through top-level calls and returns the underlying values', async () => {
    await expect(translateTerGateway.getSettings()).resolves.toBe(settingsResult);
    await expect(translateTerGateway.saveSettings(settingsPatch)).resolves.toBe(settingsResult);
    await expect(translateTerGateway.selectVideo()).resolves.toBe('video.mp4');

    expect(getSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(settingsPatch);
    expect(selectVideoMock).toHaveBeenCalledOnce();
  });

  it('passes through grouped settings, assets, subtitles, desktop, native, and log calls', async () => {
    await expect(translateTerGateway.settings.getSecret('cloud.openai')).resolves.toBe(secretResult);
    await expect(translateTerGateway.assets.listWhisperModels('local.whisper.cpp')).resolves.toBe(modelList);
    await expect(translateTerGateway.assets.ensureFfmpeg(ffmpegRequest)).resolves.toBe(ffmpegResult);
    await expect(translateTerGateway.subtitles.updateSegment('job-1', subtitleSegment)).resolves.toBe(subtitleJob);
    await expect(translateTerGateway.desktop.selectMedia()).resolves.toBe('media.mp4');
    await expect(translateTerGateway.desktop.selectMultipleMedia()).resolves.toEqual(['media.mp4']);
    await expect(translateTerGateway.native.health()).resolves.toBe(nativeHealth);

    translateTerGateway.logs.warning('renderer.test', { ok: true }, 'renderer.gateway', 'warning message');

    expect(getSecretMock).toHaveBeenCalledWith('cloud.openai');
    expect(listWhisperModelsMock).toHaveBeenCalledWith('local.whisper.cpp');
    expect(ensureFfmpegMock).toHaveBeenCalledWith(ffmpegRequest);
    expect(updateSegmentMock).toHaveBeenCalledWith('job-1', subtitleSegment);
    expect(selectMediaMock).toHaveBeenCalledOnce();
    expect(selectMultipleMediaMock).toHaveBeenCalledOnce();
    expect(nativeHealthMock).toHaveBeenCalledOnce();
    expect(logWarningMock).toHaveBeenCalledWith(
      'renderer.test',
      { ok: true },
      'renderer.gateway',
      'warning message'
    );
  });

  it('passes through job and asset event subscriptions', () => {
    expect(translateTerGateway.jobs.onEvent(jobListener)).toBe(jobUnsubscribe);
    expect(translateTerGateway.assets.onEvent(assetListener)).toBe(assetUnsubscribe);

    expect(jobsOnEventMock).toHaveBeenCalledWith(jobListener);
    expect(assetsOnEventMock).toHaveBeenCalledWith(assetListener);
  });

  it('does not swallow errors from the underlying API', async () => {
    const error = new Error('ffmpeg failed');
    ensureFfmpegMock.mockRejectedValueOnce(error);

    await expect(translateTerGateway.assets.ensureFfmpeg(ffmpegRequest)).rejects.toBe(error);
  });
});
