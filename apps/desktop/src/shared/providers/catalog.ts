import type { ProviderCatalogEntry, ProviderKind, ProviderSecretField } from './types';

export const DEFAULT_ASR_PROVIDER_ID = 'local.whisper.cpp';
export const DEFAULT_TRANSLATION_PROVIDER_ID = 'openai.compatible';

const openAiAudioSecretFields: ProviderSecretField[] = [
  {
    key: 'apiFormat',
    input: 'select',
    defaultValue: 'openai-audio',
    options: [
      {
        value: 'openai-audio',
        labelKey: 'apiFormatOpenaiAudio',
        descriptionKey: 'apiFormatOpenaiAudioDetail'
      }
    ]
  },
  { key: 'baseUrl' },
  { key: 'apiKey', input: 'password', placeholder: 'sk-...', revealable: true },
  { key: 'model' }
];

const openAiCompatibleSecretFields: ProviderSecretField[] = [
  {
    key: 'apiFormat',
    input: 'select',
    defaultValue: 'openai-compatible',
    options: [
      {
        value: 'openai-compatible',
        labelKey: 'apiFormatOpenaiCompatible',
        descriptionKey: 'apiFormatOpenaiCompatibleDetail'
      }
    ]
  },
  { key: 'baseUrl' },
  { key: 'apiKey', input: 'password', placeholder: 'sk-...', revealable: true },
  { key: 'model' }
];

export const providerCatalog = [
  {
    id: 'local.whisper.cpp',
    kind: 'asr',
    runtimeKind: 'local',
    labelKey: 'localWhisperCppProvider',
    descriptionKey: 'localProviderDetail',
    secretFields: [],
    supportsHealthCheck: true,
    supportsLocalRuntime: true,
    requiresBackend: true,
    visibleInSettings: true,
    visibleInWorkflow: true
  },
  {
    id: 'local.faster-whisper',
    kind: 'asr',
    runtimeKind: 'local',
    labelKey: 'localFasterWhisperProvider',
    descriptionKey: 'localFasterWhisperProviderDetail',
    secretFields: [],
    supportsHealthCheck: true,
    supportsLocalRuntime: true,
    requiresBackend: true,
    visibleInSettings: true,
    visibleInWorkflow: true
  },
  {
    id: 'cloud.openai',
    kind: 'asr',
    runtimeKind: 'cloud',
    labelKey: 'cloudOpenaiProvider',
    descriptionKey: 'cloudProviderDetail',
    secretFields: openAiAudioSecretFields,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
    supportsHealthCheck: true,
    supportsLocalRuntime: false,
    requiresBackend: true,
    visibleInSettings: true,
    visibleInWorkflow: true,
    settingsTitleKey: 'cloudProviderSettings',
    settingsNoticeKey: 'cloudUploadNotice'
  },
  {
    id: 'openai.compatible',
    kind: 'translation',
    runtimeKind: 'cloud',
    labelKey: 'openaiCompatibleProvider',
    descriptionKey: 'translationProviderDetail',
    secretFields: openAiCompatibleSecretFields,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    supportsHealthCheck: true,
    supportsLocalRuntime: false,
    requiresBackend: true,
    visibleInSettings: true,
    visibleInWorkflow: true,
    settingsTitleKey: 'llmProviderSettings'
  },
  {
    id: 'mock.local',
    kind: 'translation',
    runtimeKind: 'mock',
    labelKey: 'mockTranslationProvider',
    descriptionKey: 'mockProviderDetail',
    secretFields: [],
    supportsHealthCheck: false,
    supportsLocalRuntime: false,
    requiresBackend: false,
    visibleInSettings: false,
    visibleInWorkflow: false
  },
  {
    id: 'mock.asr',
    kind: 'asr',
    runtimeKind: 'mock',
    labelKey: 'mockAsrProvider',
    descriptionKey: 'mockProviderDetail',
    secretFields: [],
    supportsHealthCheck: false,
    supportsLocalRuntime: false,
    requiresBackend: false,
    visibleInSettings: false,
    visibleInWorkflow: false
  }
] as const satisfies readonly ProviderCatalogEntry[];

const providerCatalogEntries = providerCatalog.map((provider) => [provider.id, provider] as const);

export const providerCatalogById = new Map<string, ProviderCatalogEntry>(providerCatalogEntries);

export const providerCatalogWithSecrets = providerCatalog.filter((provider) => provider.secretFields.length > 0);
export const settingsVisibleProviders = providerCatalog.filter((provider) => provider.visibleInSettings);
export const workflowVisibleProviders = providerCatalog.filter((provider) => provider.visibleInWorkflow);

export const settingsVisibleAsrProviders = settingsVisibleProviders.filter((provider) => provider.kind === 'asr');
export const settingsVisibleTranslationProviders = settingsVisibleProviders.filter(
  (provider) => provider.kind === 'translation'
);
export const workflowVisibleAsrProviders = workflowVisibleProviders.filter((provider) => provider.kind === 'asr');
export const workflowVisibleTranslationProviders = workflowVisibleProviders.filter(
  (provider) => provider.kind === 'translation'
);

export function getProviderCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return providerCatalogById.get(providerId);
}

export function listProvidersByKind(kind: ProviderKind): ProviderCatalogEntry[] {
  return providerCatalog.filter((provider) => provider.kind === kind);
}

export function isKnownProviderId(providerId: string): boolean {
  return providerCatalogById.has(providerId);
}
