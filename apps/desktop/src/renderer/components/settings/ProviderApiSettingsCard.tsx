import React from 'react';
import { KeyRound } from 'lucide-react';
import type { ProviderSecretInput } from '@shared/types';
import type {
  ProviderCatalogEntry,
  ProviderSecretField,
  ProviderSecretSelectField,
  ProviderSecretTextField
} from '@shared/providers/types';
import { InspectorSection, ProviderActionRow, TextField } from './Primitives';

type ProviderApiSettingsCardProps = {
  t: (key: string) => string;
  provider: ProviderCatalogEntry;
  secret: ProviderSecretInput;
  checkingProvider?: string;
  onUpdateProviderSecret: (providerId: string, patch: Partial<ProviderSecretInput>) => void;
  onSaveProviderSecret: (providerId: string) => void;
  onTestProvider: (providerId: string) => void;
};

export function ProviderApiSettingsCard(props: ProviderApiSettingsCardProps): JSX.Element {
  const apiFormatField = props.provider.secretFields.find(isApiFormatField);
  const selectedFormatId = resolveSelectedFormatId(apiFormatField, props.secret.apiFormat);
  const textFields = props.provider.secretFields.filter(isTextField);
  const selectedFormat = apiFormatField?.options.find((option) => option.value === selectedFormatId);

  return (
    <div className="settingsGroupCard">
      <InspectorSection icon={<KeyRound size={16} />} title={props.t(props.provider.settingsTitleKey ?? 'providerConfig')}>
        {apiFormatField ? (
          <>
            <label>
              {props.t(apiFormatField.labelKey ?? 'apiFormat')}
              <select
                value={selectedFormatId}
                onChange={(event) =>
                  props.onUpdateProviderSecret(props.provider.id, { apiFormat: event.target.value })
                }
              >
                {apiFormatField.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {props.t(option.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            {selectedFormat?.descriptionKey ? (
              <p className="settingsMicrocopy">{props.t(selectedFormat.descriptionKey)}</p>
            ) : null}
          </>
        ) : null}
        {textFields.map((field) => (
          <TextField
            key={`${props.provider.id}-${field.key}`}
            label={props.t(field.labelKey ?? field.key)}
            value={props.secret[field.key] ?? ''}
            placeholder={resolveFieldPlaceholder(props.provider, field)}
            type={field.input === 'password' ? 'password' : 'text'}
            revealable={field.revealable}
            showToggleLabel={props.t('showSecret')}
            hideToggleLabel={props.t('hideSecret')}
            onChange={(value) =>
              props.onUpdateProviderSecret(props.provider.id, { [field.key]: value } as Partial<ProviderSecretInput>)
            }
          />
        ))}
        {props.provider.settingsNoticeKey ? (
          <p className="settingsMicrocopy">{props.t(props.provider.settingsNoticeKey)}</p>
        ) : null}
        <ProviderActionRow
          savingLabel={props.t('saveProvider')}
          testingLabel={props.checkingProvider === props.provider.id ? props.t('checking') : props.t('test')}
          onSave={() => props.onSaveProviderSecret(props.provider.id)}
          onTest={() => props.onTestProvider(props.provider.id)}
          testDisabled={props.checkingProvider === props.provider.id}
        />
      </InspectorSection>
    </div>
  );
}

function isApiFormatField(field: ProviderSecretField): field is ProviderSecretSelectField {
  return field.key === 'apiFormat';
}

function isTextField(field: ProviderSecretField): field is ProviderSecretTextField {
  return field.key !== 'apiFormat';
}

function resolveSelectedFormatId(
  field: ProviderSecretSelectField | undefined,
  currentValue: string | undefined
): string {
  if (!field) return '';
  if (currentValue && field.options.some((option) => option.value === currentValue)) {
    return currentValue;
  }
  return field.defaultValue ?? field.options[0]?.value ?? '';
}

function resolveFieldPlaceholder(provider: ProviderCatalogEntry, field: ProviderSecretField): string {
  if (field.key === 'apiFormat') return '';
  if (field.placeholder) return field.placeholder;
  if (field.key === 'baseUrl') return provider.defaultBaseUrl ?? '';
  if (field.key === 'model') return provider.defaultModel ?? '';
  return '';
}
