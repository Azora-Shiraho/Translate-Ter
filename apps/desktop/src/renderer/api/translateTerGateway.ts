import type { TranslateTerApi } from '../../preload';

function getTranslateTerApi(): TranslateTerApi {
  return window.translateTer;
}

function passThrough<TArgs extends unknown[], TResult>(
  selector: (api: TranslateTerApi) => (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return (...args) => selector(getTranslateTerApi())(...args);
}

export const translateTerGateway: TranslateTerApi = {
  host: {
    get platform() {
      return getTranslateTerApi().host.platform;
    }
  },
  selectVideo: passThrough((api) => api.selectVideo),
  selectDirectory: passThrough((api) => api.selectDirectory),
  startTranscription: passThrough((api) => api.startTranscription),
  startTranslation: passThrough((api) => api.startTranslation),
  exportSrt: passThrough((api) => api.exportSrt),
  exportConfiguredSrt: passThrough((api) => api.exportConfiguredSrt),
  getSettings: passThrough((api) => api.getSettings),
  saveSettings: passThrough((api) => api.saveSettings),
  desktop: {
    selectMedia: passThrough((api) => api.desktop.selectMedia),
    selectMultipleMedia: passThrough((api) => api.desktop.selectMultipleMedia)
  },
  jobs: {
    create: passThrough((api) => api.jobs.create),
    start: passThrough((api) => api.jobs.start),
    translate: passThrough((api) => api.jobs.translate),
    cancel: passThrough((api) => api.jobs.cancel),
    get: passThrough((api) => api.jobs.get),
    onEvent: passThrough((api) => api.jobs.onEvent)
  },
  batch: {
    addJobs: passThrough((api) => api.batch.addJobs),
    start: passThrough((api) => api.batch.start),
    cancel: passThrough((api) => api.batch.cancel),
    get: passThrough((api) => api.batch.get),
    onEvent: passThrough((api) => api.batch.onEvent)
  },
  subtitles: {
    importSrt: passThrough((api) => api.subtitles.importSrt),
    exportSrt: passThrough((api) => api.subtitles.exportSrt),
    updateSegment: passThrough((api) => api.subtitles.updateSegment)
  },
  settings: {
    get: passThrough((api) => api.settings.get),
    update: passThrough((api) => api.settings.update),
    getSecret: passThrough((api) => api.settings.getSecret),
    setSecret: passThrough((api) => api.settings.setSecret),
    testProvider: passThrough((api) => api.settings.testProvider),
    onEvent: passThrough((api) => api.settings.onEvent)
  },
  window: {
    openSettings: passThrough((api) => api.window.openSettings)
  },
  assets: {
    listWhisperModels: passThrough((api) => api.assets.listWhisperModels),
    ensureWhisperModel: passThrough((api) => api.assets.ensureWhisperModel),
    ensureWhisperRuntime: passThrough((api) => api.assets.ensureWhisperRuntime),
    ensureFasterWhisperRuntime: passThrough((api) => api.assets.ensureFasterWhisperRuntime),
    ensureFasterWhisperCuda: passThrough((api) => api.assets.ensureFasterWhisperCuda),
    ensureFfmpeg: passThrough((api) => api.assets.ensureFfmpeg),
    deleteModel: passThrough((api) => api.assets.deleteModel),
    onEvent: passThrough((api) => api.assets.onEvent)
  },
  native: {
    health: passThrough((api) => api.native.health)
  },
  logs: {
    write: passThrough((api) => api.logs.write),
    debug: passThrough((api) => api.logs.debug),
    info: passThrough((api) => api.logs.info),
    warning: passThrough((api) => api.logs.warning),
    error: passThrough((api) => api.logs.error)
  }
};

export type TranslateTerGateway = typeof translateTerGateway;
