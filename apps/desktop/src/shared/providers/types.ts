export const providerKinds = ['asr', 'translation'] as const;
export const providerRuntimeKinds = ['local', 'cloud', 'mock'] as const;
export const providerSecretFieldKeys = ['apiFormat', 'baseUrl', 'apiKey', 'model'] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type ProviderRuntimeKind = (typeof providerRuntimeKinds)[number];
export type ProviderSecretFieldKey = (typeof providerSecretFieldKeys)[number];

export type ProviderSecretSelectOption = {
  value: string;
  labelKey: string;
  descriptionKey?: string;
};

export type ProviderSecretSelectField = {
  key: 'apiFormat';
  input: 'select';
  labelKey?: string;
  defaultValue?: string;
  options: ProviderSecretSelectOption[];
};

export type ProviderSecretTextField = {
  key: Exclude<ProviderSecretFieldKey, 'apiFormat'>;
  input?: 'text' | 'password';
  labelKey?: string;
  placeholder?: string;
  revealable?: boolean;
};

export type ProviderSecretField = ProviderSecretSelectField | ProviderSecretTextField;

export type ProviderCatalogEntry = {
  id: string;
  kind: ProviderKind;
  runtimeKind: ProviderRuntimeKind;
  labelKey: string;
  descriptionKey: string;
  secretFields: ProviderSecretField[];
  defaultBaseUrl?: string;
  defaultModel?: string;
  supportsHealthCheck: boolean;
  supportsLocalRuntime: boolean;
  requiresBackend: boolean;
  visibleInSettings: boolean;
  visibleInWorkflow: boolean;
  settingsTitleKey?: string;
  settingsNoticeKey?: string;
};
