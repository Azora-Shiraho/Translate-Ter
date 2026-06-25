export const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;

export const translationProviders = ['openai.compatible'] as const;

export const asrProviders = [
  { id: 'local.whisper.cpp', nameKey: 'localProvider', descriptionKey: 'localProviderDetail' },
  { id: 'local.faster-whisper', nameKey: 'localProvider', descriptionKey: 'localFasterWhisperProviderDetail' },
  { id: 'cloud.openai', nameKey: 'cloudProvider', descriptionKey: 'cloudProviderDetail' }
] as const;
