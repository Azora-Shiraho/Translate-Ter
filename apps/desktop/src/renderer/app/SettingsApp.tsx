import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Settings, MonitorCog, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { translateTerGateway } from '../api/translateTerGateway';
import type { ReportUiError, ToastMessage, ToastTone, WriteUiLog } from './types';
import { useSettingsViewModel } from '../viewModels/useSettingsViewModel';
import { useProviderStatusViewModel } from '../viewModels/useProviderStatusViewModel';
import { SettingsView } from '../components/settings/SettingsView';
import { ToastStack } from '../components/status/ToastStack';

export type SettingsTab = 'general' | 'asr' | 'translation';

export function SettingsApp(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const writeUiLog = useCallback<WriteUiLog>(
    (level, event, details, scope = 'renderer.settings', messageText) => {
      if (level === 'debug') translateTerGateway.logs.debug(event, details, scope, messageText);
      else if (level === 'info') translateTerGateway.logs.info(event, details, scope, messageText);
      else if (level === 'warning') translateTerGateway.logs.warning(event, details, scope, messageText);
      else translateTerGateway.logs.error(event, details, scope, messageText);
    },
    []
  );

  const reportUiError = useCallback<ReportUiError>(
    (event, error, details, scope = 'renderer.settings') => {
      const nextMessage = error instanceof Error ? error.message : String(error);
      writeUiLog('error', event, { ...details, error }, scope, nextMessage);
      return nextMessage;
    },
    [writeUiLog]
  );

  const pushToast = useCallback((nextMessage: string, tone: ToastTone = 'neutral') => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current.slice(-3), { id, message: nextMessage, tone, exiting: false }]);
    window.setTimeout(() => {
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 360);
    }, 4200);
  }, []);

  const pushStatus = useCallback(
    (nextMessage: string, tone: ToastTone = 'neutral') => {
      pushToast(nextMessage, tone);
    },
    [pushToast]
  );

  const feedback = useMemo(
    () => ({
      writeUiLog,
      reportUiError,
      setMessage: () => {}, // Not used in settings
      pushStatus,
      pushToast
    }),
    [pushStatus, pushToast, reportUiError, writeUiLog]
  );

  const settingsVm = useSettingsViewModel({ t, i18n, feedback });

  const statusVm = useProviderStatusViewModel({
    t,
    settings: settingsVm.settings,
    models: settingsVm.models,
    nativeHealth: settingsVm.nativeHealth,
    runtimeStatus: settingsVm.runtimeStatus,
    cudaStatus: settingsVm.cudaStatus,
    fasterWhisperCudaStatus: settingsVm.fasterWhisperCudaStatus,
    modelStatus: settingsVm.modelStatus,
    ffmpegStatus: settingsVm.ffmpegStatus,
    providerHealth: settingsVm.providerHealth,
    configuredAcceleration: settingsVm.configuredAcceleration,
    effectiveRuntimeVariantSelection: settingsVm.effectiveRuntimeVariantSelection,
    runtimeVariantSelections: settingsVm.runtimeVariantSelections,
    ignoreCudaMismatch: settingsVm.ignoreCudaMismatch,
    cudaFlowRelevant: settingsVm.cudaFlowRelevant
  });

  // Cross-window sync: refresh settings when another window updates them
  useEffect(() => {
    const unsubscribe = translateTerGateway.settings.onEvent((event) => {
      if (event.type === 'changed') {
        settingsVm.refreshSettings();
      }
    });
    return () => unsubscribe();
  }, [settingsVm]);

  if (!settingsVm.settings) {
    return <div className="boot">Loading Settings...</div>;
  }

  return (
    <div className="appContainer">
      <aside className="appSidebar" style={{ width: '240px', minWidth: '240px' }}>
        <div className="sidebarBrand">
          <Settings size={24} className="brandIcon" />
          <h2>{t('settings')}</h2>
        </div>
        
        <nav className="sidebarNav" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
          <button 
            className={`navItem ${activeTab === 'general' ? 'active' : ''}`} 
            onClick={() => setActiveTab('general')} 
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', border: 'none', background: activeTab === 'general' ? 'var(--tt-color-surface-hover)' : 'transparent', borderRadius: '6px', cursor: 'pointer', color: 'var(--tt-color-text-primary)' }}
          >
            <Settings size={18} />
            {t('generalControls')}
          </button>
          <button 
            className={`navItem ${activeTab === 'asr' ? 'active' : ''}`} 
            onClick={() => setActiveTab('asr')} 
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', border: 'none', background: activeTab === 'asr' ? 'var(--tt-color-surface-hover)' : 'transparent', borderRadius: '6px', cursor: 'pointer', color: 'var(--tt-color-text-primary)' }}
          >
            <MonitorCog size={18} />
            {t('asr')}
          </button>
          <button 
            className={`navItem ${activeTab === 'translation' ? 'active' : ''}`} 
            onClick={() => setActiveTab('translation')} 
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', border: 'none', background: activeTab === 'translation' ? 'var(--tt-color-surface-hover)' : 'transparent', borderRadius: '6px', cursor: 'pointer', color: 'var(--tt-color-text-primary)' }}
          >
            <Languages size={18} />
            {t('translate')}
          </button>
        </nav>
      </aside>

      <main className="appMain">
        <SettingsView 
          t={t} 
          settingsVm={settingsVm} 
          statusVm={statusVm} 
          activeTab={activeTab} 
        />
        <ToastStack toasts={toasts} copyTitle={t('copyErrorToast')} onCopyError={(toast) => void navigator.clipboard.writeText(toast.message)} />
      </main>
    </div>
  );
}
