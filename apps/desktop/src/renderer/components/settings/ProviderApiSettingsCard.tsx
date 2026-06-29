import React, { useState } from 'react';
import { KeyRound, CheckCircle2, Save } from 'lucide-react';
import type { ProviderSecretInput } from '@shared/types';
import type {
  ProviderCatalogEntry,
  ProviderSecretField,
  ProviderSecretSelectField,
  ProviderSecretTextField
} from '@shared/providers/types';

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
  const { t, provider, secret, checkingProvider, onUpdateProviderSecret, onSaveProviderSecret, onTestProvider } = props;
  const apiFormatField = provider.secretFields.find(isApiFormatField);
  const selectedFormatId = resolveSelectedFormatId(apiFormatField, secret.apiFormat);
  const textFields = provider.secretFields.filter(isTextField);
  const selectedFormat = apiFormatField?.options.find((option) => option.value === selectedFormatId);
  const [revealedStates, setRevealedStates] = useState<Record<string, boolean>>({});

  return (
    <div className="custom-settings-card" style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--tt-border-soft)', paddingBottom: '12px' }}>
        <KeyRound size={18} style={{ color: 'var(--tt-accent)' }} />
        <strong style={{ fontSize: '16px', color: 'var(--tt-text-strong)' }}>
          {t(provider.settingsTitleKey ?? 'providerConfig')}
        </strong>
      </div>

      {apiFormatField && (
        <div className="custom-settings-row">
          <div className="custom-settings-row-label">
            <span className="custom-settings-row-title">{t(apiFormatField.labelKey ?? 'apiFormat')}</span>
            {selectedFormat?.descriptionKey && (
              <span className="custom-settings-row-desc">{t(selectedFormat.descriptionKey)}</span>
            )}
          </div>
          <div className="custom-select-box">
            <select
              value={selectedFormatId}
              onChange={(event) =>
                onUpdateProviderSecret(provider.id, { apiFormat: event.target.value })
              }
            >
              {apiFormatField.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {textFields.map((field) => {
        const isRevealed = revealedStates[field.key] ?? false;
        const inputType = field.revealable ? (isRevealed ? 'text' : 'password') : (field.input === 'password' ? 'password' : 'text');
        
        return (
          <div className="custom-settings-row" key={`${provider.id}-${field.key}`}>
            <div className="custom-settings-row-label">
              <span className="custom-settings-row-title">{t(field.labelKey ?? field.key)}</span>
            </div>
            <div className="custom-number-wrapper" style={{ minWidth: '240px', padding: '4px 10px' }}>
              <input
                type={inputType}
                value={secret[field.key] ?? ''}
                placeholder={resolveFieldPlaceholder(provider, field)}
                onChange={(e) => onUpdateProviderSecret(provider.id, { [field.key]: e.target.value } as Partial<ProviderSecretInput>)}
                style={{
                  flexGrow: 1,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--tt-text-strong)',
                  fontSize: '14px',
                  outline: 'none',
                  padding: '4px 0',
                  textAlign: 'left',
                  width: '100%'
                }}
              />
              {field.revealable && (
                <button
                  type="button"
                  className="custom-number-btn"
                  style={{ width: 'auto', padding: '0 8px', fontSize: '11px', height: '20px' }}
                  onClick={() => setRevealedStates(prev => ({ ...prev, [field.key]: !isRevealed }))}
                >
                  {isRevealed ? t('hideSecret') : t('showSecret')}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {provider.settingsNoticeKey && (
        <p className="custom-settings-row-desc" style={{ marginTop: '12px', fontSize: '12px' }}>
          {t(provider.settingsNoticeKey)}
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end', borderTop: '1px solid var(--tt-border-soft)', paddingTop: '16px' }}>
        <button
          className="modernBtn secondaryBtn"
          style={{ padding: '8px 16px', fontSize: '13px' }}
          onClick={() => onSaveProviderSecret(provider.id)}
          type="button"
        >
          <Save size={14} style={{ marginRight: '6px' }} />
          {t('saveProvider')}
        </button>
        <button
          className="modernBtn"
          style={{ padding: '8px 16px', fontSize: '13px' }}
          disabled={checkingProvider === provider.id}
          onClick={() => onTestProvider(provider.id)}
          type="button"
        >
          <CheckCircle2 size={14} style={{ marginRight: '6px' }} />
          {checkingProvider === provider.id ? t('checking') : t('test')}
        </button>
      </div>
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
