export const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;

export const translationProviders = ['openai.compatible'] as const;

export const asrProviders = [
  { id: 'local.whisper.cpp', nameKey: 'localWhisperCppProvider', descriptionKey: 'localProviderDetail' },
  { id: 'local.faster-whisper', nameKey: 'localFasterWhisperProvider', descriptionKey: 'localFasterWhisperProviderDetail' },
  { id: 'cloud.openai', nameKey: 'cloudProvider', descriptionKey: 'cloudProviderDetail' }
] as const;
