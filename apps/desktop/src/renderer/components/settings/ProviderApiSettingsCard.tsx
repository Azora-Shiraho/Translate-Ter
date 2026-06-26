import React from 'react';
import { KeyRound } from 'lucide-react';
import type { ProviderSecretInput } from '@shared/types';
import { InspectorSection, ProviderActionRow, TextField } from './Primitives';

type ProviderApiFieldKey = 'baseUrl' | 'apiKey' | 'model';
type ProviderApiFieldConfig = {
  key: ProviderApiFieldKey;
  labelKey: 'baseUrl' | 'apiKey' | 'model';
  placeholder: string;
  type?: 'text' | 'password';
  revealable?: boolean;
};

type ProviderApiFormatConfig = {
  id: string;
  labelKey: 'apiFormatOpenaiCompatible' | 'apiFormatOpenaiAudio';
  detailKey: 'apiFormatOpenaiCompatibleDetail' | 'apiFormatOpenaiAudioDetail';
  fields: ProviderApiFieldConfig[];
};

type ProviderApiSettingsConfig = {
  sectionTitleKey: 'cloudProviderSettings' | 'llmProviderSettings';
  defaultFormatId: string;
  formats: ProviderApiFormatConfig[];
};

const providerApiSettingsConfig: Record<'cloud.openai' | 'openai.compatible', ProviderApiSettingsConfig> = {
  'cloud.openai': {
    sectionTitleKey: 'cloudProviderSettings',
    defaultFormatId: 'openai-audio',
    formats: [
      {
        id: 'openai-audio',
        labelKey: 'apiFormatOpenaiAudio',
        detailKey: 'apiFormatOpenaiAudioDetail',
        fields: [
          { key: 'baseUrl', labelKey: 'baseUrl', placeholder: 'https://api.openai.com/v1' },
          { key: 'apiKey', labelKey: 'apiKey', placeholder: 'sk-...', type: 'password', revealable: true },
          { key: 'model', labelKey: 'model', placeholder: 'whisper-1' }
        ]
      }
    ]
  },
  'openai.compatible': {
    sectionTitleKey: 'llmProviderSettings',
    defaultFormatId: 'openai-compatible',
    formats: [
      {
        id: 'openai-compatible',
        labelKey: 'apiFormatOpenaiCompatible',
        detailKey: 'apiFormatOpenaiCompatibleDetail',
        fields: [
          { key: 'baseUrl', labelKey: 'baseUrl', placeholder: 'https://api.openai.com/v1' },
          { key: 'apiKey', labelKey: 'apiKey', placeholder: 'sk-...', type: 'password', revealable: true },
          { key: 'model', labelKey: 'model', placeholder: 'gpt-4o-mini' }
        ]
      }
    ]
  }
};

type ProviderApiSettingsCardProps = {
  t: (key: string) => string;
  providerId: 'cloud.openai' | 'openai.compatible';
  secret: ProviderSecretInput;
  checkingProvider?: string;
  onUpdateProviderSecret: (providerId: string, patch: Partial<ProviderSecretInput>) => void;
  onSaveProviderSecret: (providerId: string) => void;
  onTestProvider: (providerId: string) => void;
};

export function ProviderApiSettingsCard(props: ProviderApiSettingsCardProps): JSX.Element {
  const config = providerApiSettingsConfig[props.providerId];
  const selectedFormatId =
    props.secret.apiFormat && config.formats.some((format) => format.id === props.secret.apiFormat)
      ? props.secret.apiFormat
      : config.defaultFormatId;
  const selectedFormat = config.formats.find((format) => format.id === selectedFormatId) ?? config.formats[0];

  return (
    <div className="settingsGroupCard">
      <InspectorSection icon={<KeyRound size={16} />} title={props.t(config.sectionTitleKey)}>
        <label>
          {props.t('apiFormat')}
          <select
            value={selectedFormatId}
            onChange={(event) => props.onUpdateProviderSecret(props.providerId, { apiFormat: event.target.value })}
          >
            {config.formats.map((format) => (
              <option key={format.id} value={format.id}>
                {props.t(format.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <p className="settingsMicrocopy">{props.t(selectedFormat.detailKey)}</p>
        {selectedFormat.fields.map((field) => (
          <TextField
            key={`${props.providerId}-${selectedFormat.id}-${field.key}`}
            label={props.t(field.labelKey)}
            value={props.secret[field.key] ?? ''}
            placeholder={field.placeholder}
            type={field.type}
            revealable={field.revealable}
            showToggleLabel={props.t('showSecret')}
            hideToggleLabel={props.t('hideSecret')}
            onChange={(value) => props.onUpdateProviderSecret(props.providerId, { [field.key]: value })}
          />
        ))}
        {props.providerId === 'cloud.openai' ? <p className="settingsMicrocopy">{props.t('cloudUploadNotice')}</p> : null}
        <ProviderActionRow
          savingLabel={props.t('saveProvider')}
          testingLabel={props.checkingProvider === props.providerId ? props.t('checking') : props.t('test')}
          onSave={() => props.onSaveProviderSecret(props.providerId)}
          onTest={() => props.onTestProvider(props.providerId)}
          testDisabled={props.checkingProvider === props.providerId}
        />
      </InspectorSection>
    </div>
  );
}
