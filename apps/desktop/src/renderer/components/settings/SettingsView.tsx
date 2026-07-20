import React from 'react';
import {
  Download,
  FolderOpen,
  Gauge,
  HardDriveDownload,
  Languages,
  ListChecks,
  MonitorCog,
  Search,
  Settings,
  SlidersHorizontal,
  ArrowRightLeft,
  Eye,
  EyeOff,
  Save,
  CheckCircle2
} from 'lucide-react';
import type { AppLogLevel, AppSettingsPublic, ExportDestinationMode, SubtitleFileFormat } from '@shared/types';
import {
  getProviderCatalogEntry,
  settingsVisibleAsrProviders,
  settingsVisibleTranslationProviders
} from '@shared/providers/catalog';
import type { useSettingsViewModel } from '../../viewModels/useSettingsViewModel';
import type { useProviderStatusViewModel } from '../../viewModels/useProviderStatusViewModel';
import {
  accelerationOptionLabel,
  describeFfmpegLocation,
  describeModelFootprint,
  exportDestinationModeLabel,
  formatBytes,
  localCpuModeDetailLabel,
  localCpuModeLabel,
  logLevelDetailLabel,
  providerLabel,
  runtimeVariantOptionLabel
} from '../../app/displayHelpers';
import { ProviderApiSettingsCard } from './ProviderApiSettingsCard';
import { languageRegistry } from '@shared/languages';
import { ProviderCard } from './Primitives';

type SettingsViewProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  settingsVm: ReturnType<typeof useSettingsViewModel>;
  statusVm: ReturnType<typeof useProviderStatusViewModel>;
  activeTab?: 'general' | 'asr' | 'translation';
};

// --- Premium Custom Components for Settings ---

function CustomToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="custom-settings-row">
      <div className="custom-settings-row-label">
        <span className="custom-settings-row-title">{label}</span>
        <span className="custom-settings-row-desc">{detail}</span>
      </div>
      <label className="custom-toggle-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="custom-toggle-slider" />
      </label>
    </div>
  );
}

function CustomSelect({ label, desc, value, onChange, children }: { label: string; desc?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="custom-settings-row">
      <div className="custom-settings-row-label">
        <span className="custom-settings-row-title">{label}</span>
        {desc && <span className="custom-settings-row-desc">{desc}</span>}
      </div>
      <div className="custom-select-box">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      </div>
    </div>
  );
}

function CustomNumber({ label, desc, min, max, step = 1, value, onChange }: { label: string; desc?: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="custom-settings-row">
      <div className="custom-settings-row-label">
        <span className="custom-settings-row-title">{label}</span>
        {desc && <span className="custom-settings-row-desc">{desc}</span>}
      </div>
      <div className="custom-number-wrapper">
        <button type="button" className="custom-number-btn" onClick={() => onChange(Math.max(min, value - step))}>-</button>
        <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" className="custom-number-btn" onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  );
}

function CompactLanguageSelect({ label, uiLanguage, value, targetOnly, onChange }: { label: string; uiLanguage: 'en-US' | 'zh-CN'; value: string; targetOnly?: boolean; onChange: (v: string) => void }) {
  const options = languageRegistry.filter((language) =>
    targetOnly ? language.supportsTranslationTarget : language.supportsAsr
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', width: '100%' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tt-text-muted)' }}>{label}</span>
      <div className="custom-select-box">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((language) => (
            <option key={language.code} value={language.code}>
              {uiLanguage === 'zh-CN' ? language.nativeName : language.englishName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SettingsView(props: SettingsViewProps): JSX.Element | null {
  const { t, settingsVm, statusVm, activeTab = 'general' } = props;
  const settings = settingsVm.settings;
  const currentAsrProvider = getProviderCatalogEntry(settings?.asrProviderId ?? '');
  const currentTranslationProvider = getProviderCatalogEntry(statusVm.translationProviderId);

  if (!settings) return null;

  const renderThemePicker = () => (
    <div className="theme-picker-grid">
      <div
        className={`theme-preview-card system-preview${settings.theme === 'system' ? ' selected' : ''}`}
        onClick={() => void settingsVm.updateSettings({ theme: 'system' })}
      >
        <div className="theme-visual" style={{ display: 'flex', overflow: 'hidden', width: '100%' }}>
          {/* Left half: Light Mode */}
          <div style={{ width: '50%', height: '100%', display: 'flex', background: '#f8fafc', borderRight: '1px solid rgba(128, 128, 128, 0.15)', overflow: 'hidden' }}>
            <div style={{ width: '25%', height: '100%', background: '#f1f5f9', borderRight: '1px solid #e2e8f0' }} />
            <div style={{ flexGrow: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ height: '6px', borderRadius: '2px', background: '#cbd5e1', width: '70%' }} />
              <div style={{ height: '6px', borderRadius: '2px', background: '#cbd5e1', width: '40%' }} />
            </div>
          </div>
          {/* Right half: Dark Mode */}
          <div style={{ width: '50%', height: '100%', display: 'flex', background: '#050506', overflow: 'hidden' }}>
            <div style={{ width: '25%', height: '100%', background: '#0f1013', borderRight: '1px solid rgba(255, 255, 255, 0.06)' }} />
            <div style={{ flexGrow: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ height: '6px', borderRadius: '2px', background: '#27272a', width: '70%' }} />
              <div style={{ height: '6px', borderRadius: '2px', background: '#27272a', width: '40%' }} />
            </div>
          </div>
        </div>
        <span className="theme-label">{t('systemMode')}</span>
      </div>
      <div
        className={`theme-preview-card dark-preview${settings.theme === 'dark' ? ' selected' : ''}`}
        onClick={() => void settingsVm.updateSettings({ theme: 'dark' })}
      >
        <div className="theme-visual" style={{ display: 'flex', background: '#050506', overflow: 'hidden', width: '100%' }}>
          <div style={{ width: '25%', height: '100%', background: '#0f1013', borderRight: '1px solid rgba(255,255,255,0.06)' }} />
          <div style={{ flexGrow: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ height: '6px', borderRadius: '2px', background: '#27272a', width: '70%' }} />
            <div style={{ height: '6px', borderRadius: '2px', background: '#27272a', width: '40%' }} />
          </div>
        </div>
        <span className="theme-label">{t('darkMode')}</span>
      </div>
      <div
        className={`theme-preview-card light-preview${settings.theme === 'light' ? ' selected' : ''}`}
        onClick={() => void settingsVm.updateSettings({ theme: 'light' })}
      >
        <div className="theme-visual" style={{ display: 'flex', background: '#f8fafc', overflow: 'hidden', width: '100%' }}>
          <div style={{ width: '25%', height: '100%', background: '#f1f5f9', borderRight: '1px solid #e2e8f0' }} />
          <div style={{ flexGrow: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ height: '6px', borderRadius: '2px', background: '#cbd5e1', width: '70%' }} />
            <div style={{ height: '6px', borderRadius: '2px', background: '#cbd5e1', width: '40%' }} />
          </div>
        </div>
        <span className="theme-label">{t('lightMode')}</span>
      </div>
    </div>
  );

  const renderGeneralTab = () => (
    <div className="settingsPanel">
      <div className="settingsPanelLead">
        <div className="settingsPanelHeading">
          <div className="settingsPanelLeadIcon">
            <Settings size={20} />
          </div>
          <h3>{t('generalControls')}</h3>
        </div>
        <p>{t('reviewHint')}</p>
      </div>

      <div className="settingsShelf" style={{ maxWidth: '860px', paddingBottom: '40px' }}>
        <div className="modern-settings-section">
          <div className="modern-settings-section-title">
            {t('appearance')}
          </div>
          
          <div className="custom-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <span className="custom-settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>{t('appearance')}</span>
              {renderThemePicker()}
            </div>
            
            <CustomSelect
              label={t('uiLanguage')}
              value={settings.uiLanguage}
              onChange={(val) => void settingsVm.updateSettings({ uiLanguage: val as 'en-US' | 'zh-CN' })}
            >
              <option value="en-US">English</option>
              <option value="zh-CN">中文</option>
            </CustomSelect>

            <CustomToggle
              label={t('multiThreadDownload')}
              detail={t('multiThreadDownloadDetail')}
              checked={settings.enableMultiThreadDownload}
              onChange={(checked) => void settingsVm.updateSettings({ enableMultiThreadDownload: checked })}
            />
          </div>
        </div>

        <div className="modern-settings-section">
          <div className="modern-settings-section-title">
            {t('activityLogs')}
          </div>
          <div className="custom-settings-card">
            <CustomSelect
              label={t('logLevel')}
              desc={t(logLevelDetailLabel(settings.logLevel))}
              value={settings.logLevel}
              onChange={(val) => void settingsVm.updateSettings({ logLevel: val as AppLogLevel })}
            >
              {(['warning', 'error', 'info', 'debug'] as AppLogLevel[]).map((level) => (
                <option key={level} value={level}>{level.toUpperCase()}</option>
              ))}
            </CustomSelect>
          </div>
        </div>

        <div className="modern-settings-section">
          <div className="modern-settings-section-title">
            {t('workflowSettings')}
          </div>
          <div className="custom-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="languagePair" style={{ background: 'var(--tt-surface-panel-soft)', padding: '20px', borderRadius: '16px', border: '1px solid var(--tt-border-soft)' }}>
              <CompactLanguageSelect
                label={t('sourceLanguage')}
                uiLanguage={settings.uiLanguage as 'en-US' | 'zh-CN'}
                value={settings.sourceLanguage}
                onChange={(val) => void settingsVm.updateSettings({ sourceLanguage: val })}
              />
              <button
                className="swapButton"
                disabled={settings.sourceLanguage === 'auto'}
                title={t('swapLanguages')}
                onClick={() => void settingsVm.swapLanguages()}
                type="button"
                style={{ background: 'var(--tt-surface-panel-soft)', border: '1px solid var(--tt-border-strong)', color: 'var(--tt-text-strong)', cursor: 'pointer', outline: 'none' }}
              >
                <ArrowRightLeft size={16} />
              </button>
              <CompactLanguageSelect
                label={t('targetLanguage')}
                uiLanguage={settings.uiLanguage as 'en-US' | 'zh-CN'}
                value={settings.targetLanguage}
                targetOnly
                onChange={(val) => void settingsVm.updateSettings({ targetLanguage: val })}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--tt-border-soft)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Download size={16} style={{ color: 'var(--tt-accent)' }} />
                <strong style={{ fontSize: '15px', color: 'var(--tt-text-strong)' }}>{t('exportSettings')}</strong>
              </div>

              <CustomSelect
                label={t('exportDestinationMode')}
                value={settings.exportDestinationMode}
                onChange={(val) => void settingsVm.updateSettings({ exportDestinationMode: val as ExportDestinationMode })}
              >
                {(['source-directory', 'selected-directory', 'ask-each-time'] as ExportDestinationMode[]).map((mode) => (
                  <option key={mode} value={mode}>{t(exportDestinationModeLabel(mode))}</option>
                ))}
              </CustomSelect>

              {settings.exportDestinationMode === 'selected-directory' && (
                <div className="custom-settings-row">
                  <div className="custom-settings-row-label">
                    <span className="custom-settings-row-title">{t('exportDirectory')}</span>
                    <span className="custom-settings-row-desc">{settings.exportDirectory || t('noDirectorySelected')}</span>
                  </div>
                  <button className="modernBtn secondaryBtn" onClick={() => void settingsVm.pickExportDirectory()} type="button">
                    <FolderOpen size={16} style={{ marginRight: '6px' }} />
                    {t('chooseFolder')}
                  </button>
                </div>
              )}

              <CustomSelect
                label={t('subtitleFormat')}
                value={settings.exportFileFormat}
                onChange={(val) => void settingsVm.updateSettings({ exportFileFormat: val as SubtitleFileFormat })}
              >
                <option value="srt">{t('subtitleFormatSrt')}</option>
                <option value="ass">{t('subtitleFormatAss')}</option>
              </CustomSelect>

              <CustomSelect
                label={t('exportBilingualOrder')}
                value={settings.exportBilingualOrder}
                onChange={(val) => void settingsVm.updateSettings({ exportBilingualOrder: val as 'source-first' | 'target-first' })}
              >
                <option value="source-first">{t('sourceFirst')}</option>
                <option value="target-first">{t('targetFirst')}</option>
              </CustomSelect>

              <CustomToggle
                label={t('exportBatchWithLanguageSuffix')}
                detail={t('exportBatchWithLanguageSuffixDetail')}
                checked={settings.exportBatchWithLanguageSuffix ?? false}
                onChange={(checked) => void settingsVm.updateSettings({ exportBatchWithLanguageSuffix: checked })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAsrTab = () => (
    <div className="settingsPanel">
      <div className="settingsPanelLead">
        <div className="settingsPanelHeading">
          <div className="settingsPanelLeadIcon">
            <MonitorCog size={20} />
          </div>
          <h3>{t('recognitionWorkbench')}</h3>
        </div>
        <p>{statusVm.asrProviderState.detail}</p>
      </div>

      <div className="settingsShelf" style={{ maxWidth: '860px', paddingBottom: '40px' }}>
        <div className="modern-settings-section" ref={settingsVm.asrProviderSettingsRef} tabIndex={-1}>
          <div className="modern-settings-section-title">
            {t('asrProvider')}
          </div>
          <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'asr-provider' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <CustomSelect
              label={t('asrProvider')}
              value={settings.asrProviderId}
              onChange={(val) => void settingsVm.updateSettings({ asrProviderId: val })}
            >
              {settingsVisibleAsrProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{providerLabel(provider.id, t)}</option>
              ))}
            </CustomSelect>
            
            <div style={{ borderTop: '1px solid var(--tt-border-soft)', paddingTop: '20px' }}>
              <ProviderCard
                t={t}
                activeId={settings.asrProviderId}
                title={providerLabel(settings.asrProviderId, t)}
                detail={statusVm.asrProviderState.detail}
                health={statusVm.asrHealth}
                state={statusVm.runtimeState}
                loading={settingsVm.checkingProvider === settings.asrProviderId}
                actionDisabled={settingsVm.runtimeOperation === 'runtime-download'}
                actionLabel={statusVm.usingWhisperCpp ? t('checkRuntime') : t('test')}
                secondaryActionLabel={statusVm.showRuntimeDownloadAction ? t('downloadRuntime') : undefined}
                secondaryActionLoading={settingsVm.runtimeOperation === 'runtime-download'}
                secondaryActionDisabled={
                  settingsVm.runtimeOperation === 'runtime-download' ||
                  settingsVm.checkingProvider === settings.asrProviderId ||
                  statusVm.runtimeDownloadDisabled
                }
                onTest={() => void settingsVm.testProvider(settings.asrProviderId)}
                onSecondaryAction={
                  statusVm.showRuntimeDownloadAction
                    ? statusVm.usingWhisperCpp
                      ? () => void settingsVm.downloadLocalWhisperRuntime()
                      : () => void settingsVm.downloadFasterWhisperRuntime()
                    : undefined
                }
                showMessage
              />
            </div>

            {statusVm.usingLocalAsr && (
              <div style={{ borderTop: '1px solid var(--tt-border-soft)', paddingTop: '20px' }}>
                <CustomSelect
                  label={t('localCpuUsage')}
                  desc={t(localCpuModeDetailLabel(settings.localAsrCpuMode))}
                  value={settings.localAsrCpuMode}
                  onChange={(val) => void settingsVm.updateSettings({ localAsrCpuMode: val as 'low' | 'balanced' | 'high' })}
                >
                  <option value="low">{t(localCpuModeLabel('low'))}</option>
                  <option value="balanced">{t(localCpuModeLabel('balanced'))}</option>
                  <option value="high">{t(localCpuModeLabel('high'))}</option>
                </CustomSelect>
              </div>
            )}
          </div>
        </div>

        <div className="modern-settings-section" ref={settingsVm.ffmpegSettingsRef} tabIndex={-1}>
          <div className="modern-settings-section-title">
            {t('ffmpegTools')}
          </div>
          <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'ffmpeg' ? ' settingsJumpTargetActive' : ''}`}>
             <div className="modelCard" style={{ background: 'var(--tt-surface-app)', border: '1px solid var(--tt-border-soft)' }}>
              <div>
                <span className={`signal ${statusVm.ffmpegState.tone}`} />
                <strong>{t('ffmpegTools')}</strong>
                <small>{settingsVm.ffmpegActivity ?? statusVm.ffmpegState.detail}</small>
              </div>
              <div className="settingsActionRow" style={{ marginTop: '14px' }}>
                <button className="modernBtn secondaryBtn" disabled={settingsVm.runtimeOperation === 'ffmpeg-check' || settingsVm.runtimeOperation === 'ffmpeg-download'} onClick={() => void settingsVm.checkFfmpegTools()} type="button">
                  <Search size={14} style={{ marginRight: '6px' }} />
                  {settingsVm.runtimeOperation === 'ffmpeg-check' ? t('checking') : t('checkFfmpeg')}
                </button>
                {statusVm.showFfmpegDownload && (
                  <button className="modernBtn" disabled={settingsVm.runtimeOperation === 'ffmpeg-check' || settingsVm.runtimeOperation === 'ffmpeg-download'} onClick={() => void settingsVm.downloadFfmpegTools()} type="button">
                    <HardDriveDownload size={14} style={{ marginRight: '6px' }} />
                    {settingsVm.runtimeOperation === 'ffmpeg-download' ? t('downloadProgress') : t('downloadFfmpeg')}
                  </button>
                )}
              </div>
              {settingsVm.ffmpegStatus && <p style={{ fontSize: '12px', color: 'var(--tt-text-muted)', marginTop: '8px' }} title={settingsVm.ffmpegStatus.ffmpegPath ?? settingsVm.ffmpegStatus.ffprobePath}>{describeFfmpegLocation(settingsVm.ffmpegStatus, t)}</p>}
            </div>
          </div>
        </div>

        {statusVm.usingWhisperCpp && (
          <>
            <div className="modern-settings-section" ref={settingsVm.cudaSettingsRef} tabIndex={-1}>
              <div className="modern-settings-section-title">
                {t('acceleration')}
              </div>
              <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                 <div className="modelCard accentCard" style={{ background: 'var(--tt-surface-app)', border: '1px solid var(--tt-border-soft)' }}>
                  <div>
                    <span className={statusVm.cudaMismatchDetected || statusVm.cudaRuntimeMissing ? 'signal warn' : statusVm.cudaStatusShort === t('ok') ? 'signal good' : 'signal accent'} />
                    <strong>{t('acceleration')}</strong>
                    <small>{statusVm.cudaStatusDetail}</small>
                  </div>
                  
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <CustomSelect
                      label={t('acceleration')}
                      value={settingsVm.configuredAcceleration}
                      onChange={(val) => void settingsVm.updateLocalAsrAccelerationSetting(val as AppSettingsPublic['localAsrAcceleration'])}
                    >
                      {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                        <option key={option} value={option}>{t(accelerationOptionLabel(option))}</option>
                      ))}
                    </CustomSelect>

                    {settingsVm.runtimeVariantSelections.length > 0 && (
                      <CustomSelect
                        label={t('runtimeVariant')}
                        value={settingsVm.effectiveRuntimeVariantSelection}
                        onChange={(val) => void settingsVm.updateLocalRuntimeVariantSetting(val as any)}
                      >
                        {settingsVm.runtimeVariantSelections.map((option) => (
                          <option key={option} value={option}>{t(runtimeVariantOptionLabel(option))}</option>
                        ))}
                      </CustomSelect>
                    )}
                  </div>

                  {settingsVm.cudaFlowRelevant && (
                    <div className="settingsActionRow" style={{ marginTop: '16px' }}>
                      <button className="modernBtn secondaryBtn" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.checkCuda()} type="button">
                        <Search size={14} style={{ marginRight: '6px' }} />
                        {settingsVm.runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                      </button>
                      {statusVm.showCudaRuntimeDownload && (
                        <button className="modernBtn" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.downloadCudaRuntime()} type="button">
                          <HardDriveDownload size={14} style={{ marginRight: '6px' }} />
                          {settingsVm.runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                        </button>
                      )}
                    </div>
                  )}
                  {settingsVm.cudaFlowRelevant && (
                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--tt-border-soft)', paddingTop: '16px' }}>
                      <CustomToggle
                        label={t('ignoreCudaMismatch')}
                        detail={t('ignoreCudaMismatchDetail')}
                        checked={settingsVm.ignoreCudaMismatch}
                        onChange={(checked) => void settingsVm.updateIgnoreCudaMismatchSetting(checked)}
                      />
                    </div>
                  )}
                  <div className="runtimeGrid" style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {statusVm.runtimeStatusRows.map((row) => (
                      <div className="statusLine" key={row.label} style={{ background: 'var(--tt-surface-panel-soft)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--tt-border-soft)', fontSize: '12px' }}>
                        <span style={{ color: 'var(--tt-text-muted)', marginRight: '6px' }}>{row.label}</span>
                        <strong className={row.tone} style={{ color: 'var(--tt-text-strong)' }}>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="modern-settings-section" ref={settingsVm.whisperModelSettingsRef} tabIndex={-1}>
              <div className="modern-settings-section-title">
                {t('whisperModel')}
              </div>
              <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'whisper-model' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <CustomToggle
                  label={t('allowWhisperDownloads')}
                  detail={t('allowWhisperDownloadsDetail')}
                  checked={settings.allowWhisperAssetDownload}
                  onChange={(checked) => void settingsVm.updateSettings({ allowWhisperAssetDownload: checked })}
                />
                
                <CustomSelect
                  label={t('whisperModel')}
                  value={settings.whisperModelId}
                  onChange={(val) => void settingsVm.updateSettings({ whisperModelId: val })}
                >
                  {settingsVm.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName} · {describeModelFootprint(model, t)} · {model.installed ? t('installed') : t('missing')}
                    </option>
                  ))}
                </CustomSelect>

                <div className="settingsActionRow" style={{ display: 'flex', gap: '12px' }}>
                  <button className="modernBtn secondaryBtn" disabled={settingsVm.runtimeOperation === 'model-check' || settingsVm.runtimeOperation === 'model'} onClick={() => void settingsVm.checkSelectedModel()} type="button">
                    <Search size={14} style={{ marginRight: '6px' }} />
                    {settingsVm.runtimeOperation === 'model-check' ? t('checking') : t('checkModel')}
                  </button>
                  <button className="modernBtn" disabled={settingsVm.runtimeOperation === 'model-check' || settingsVm.runtimeOperation === 'model' || !settings.allowWhisperAssetDownload || statusVm.selectedModelVerified} onClick={() => void settingsVm.downloadSelectedModel()} type="button">
                    <HardDriveDownload size={14} style={{ marginRight: '6px' }} />
                    {settingsVm.runtimeOperation === 'model' ? t('downloadProgress') : t('downloadModel')}
                  </button>
                </div>
                <div className="modelCard" style={{ background: 'var(--tt-surface-app)', border: '1px solid var(--tt-border-soft)' }}>
                  <div>
                    <span className={statusVm.selectedModelVerified ? 'signal good' : statusVm.selectedModelInstalled ? 'signal warn' : 'signal'} />
                    <strong>{statusVm.selectedModel?.displayName ?? t('whisperModel')}</strong>
                    <small>{statusVm.selectedModel ? describeModelFootprint(statusVm.selectedModel, t) : t('missing')}</small>
                  </div>
                  {settingsVm.modelActivity ? <p style={{ fontSize: '12px', color: 'var(--tt-text-muted)', marginTop: '8px' }} title={settingsVm.modelActivity}>{settingsVm.modelActivity}</p> : null}
                </div>
              </div>
            </div>
          </>
        )}

        {statusVm.usingFasterWhisper && (
          <>
            <div className="modern-settings-section" ref={settingsVm.cudaSettingsRef} tabIndex={-1}>
              <div className="modern-settings-section-title">
                {t('acceleration')}
              </div>
              <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="modelCard accentCard" style={{ background: 'var(--tt-surface-app)', border: '1px solid var(--tt-border-soft)' }}>
                  <div>
                    <span className={statusVm.fasterWhisperCudaShort === t('ok') ? 'signal good' : statusVm.fasterWhisperCudaShort === t('notChecked') ? 'signal muted' : 'signal warn'} />
                    <strong>{t('acceleration')}</strong>
                    <small>{statusVm.fasterWhisperCudaDetail}</small>
                  </div>
                  
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <CustomSelect
                      label={t('acceleration')}
                      value={settingsVm.configuredAcceleration}
                      onChange={(val) => void settingsVm.updateLocalAsrAccelerationSetting(val as AppSettingsPublic['localAsrAcceleration'])}
                    >
                      {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                        <option key={option} value={option}>{t(accelerationOptionLabel(option))}</option>
                      ))}
                    </CustomSelect>

                    {settingsVm.runtimeVariantSelections.length > 0 && (
                      <CustomSelect
                        label={t('runtimeVariant')}
                        value={settingsVm.effectiveRuntimeVariantSelection}
                        onChange={(val) => void settingsVm.updateLocalRuntimeVariantSetting(val as any)}
                      >
                        {settingsVm.runtimeVariantSelections.map((option) => (
                          <option key={option} value={option}>{t(runtimeVariantOptionLabel(option))}</option>
                        ))}
                      </CustomSelect>
                    )}
                  </div>

                  {settingsVm.cudaFlowRelevant && (
                    <div className="settingsActionRow" style={{ marginTop: '16px' }}>
                      <button className="modernBtn secondaryBtn" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.checkFasterWhisperCuda()} type="button">
                        <Search size={14} style={{ marginRight: '6px' }} />
                        {settingsVm.runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                      </button>
                      {statusVm.showFasterWhisperCudaDownload && (
                        <button className="modernBtn" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.downloadFasterWhisperCudaRuntime()} type="button">
                          <HardDriveDownload size={14} style={{ marginRight: '6px' }} />
                          {settingsVm.runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="runtimeGrid" style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {statusVm.runtimeStatusRows.map((row) => (
                      <div className="statusLine" key={row.label} style={{ background: 'var(--tt-surface-panel-soft)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--tt-border-soft)', fontSize: '12px' }}>
                        <span style={{ color: 'var(--tt-text-muted)', marginRight: '6px' }}>{row.label}</span>
                        <strong className={row.tone} style={{ color: 'var(--tt-text-strong)' }}>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="modern-settings-section" ref={settingsVm.whisperModelSettingsRef} tabIndex={-1}>
              <div className="modern-settings-section-title">
                {t('whisperModel')}
              </div>
              <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'whisper-model' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <CustomSelect
                  label={t('whisperModel')}
                  value={settings.whisperModelId}
                  onChange={(val) => void settingsVm.updateSettings({ whisperModelId: val })}
                >
                  {settingsVm.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName} · {describeModelFootprint(model, t)}
                    </option>
                  ))}
                </CustomSelect>

                <div className="modelCard accentCard" style={{ background: 'var(--tt-surface-app)', border: '1px solid var(--tt-border-soft)' }}>
                  <div>
                    <span className="signal accent" />
                    <strong>{statusVm.selectedModel?.displayName ?? t('whisperModel')}</strong>
                    <small>{statusVm.selectedModel ? describeModelFootprint(statusVm.selectedModel, t) : t('whisperModel')}</small>
                  </div>
                  {statusVm.selectedModel && (
                    <div className="modelMetaRow" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                      {statusVm.selectedModel.estimatedVramBytes && (
                        <span className="modelMetaChip" style={{ background: 'var(--tt-surface-panel-soft)', border: '1px solid var(--tt-border-soft)', padding: '4px 8px', borderRadius: '6px', fontSize: '11px' }}>
                          {t('estimatedVramLabel')}: {formatBytes(statusVm.selectedModel.estimatedVramBytes)}
                        </span>
                      )}
                    </div>
                  )}
                  <p style={{ fontSize: '13px', color: 'var(--tt-text-muted)', marginTop: '10px' }}>{t('fasterWhisperModelManagedDetail')}</p>
                </div>
              </div>
            </div>
          </>
        )}

        {currentAsrProvider?.visibleInSettings && currentAsrProvider.secretFields.length > 0 && (
          <ProviderApiSettingsCard
            t={t}
            provider={currentAsrProvider}
            secret={settingsVm.providerSecrets[currentAsrProvider.id] ?? {}}
            checkingProvider={settingsVm.checkingProvider}
            onUpdateProviderSecret={settingsVm.updateProviderSecret}
            onSaveProviderSecret={(providerId) => void settingsVm.saveProviderSecret(providerId)}
            onTestProvider={(providerId) => void settingsVm.testProvider(providerId)}
          />
        )}
      </div>
    </div>
  );

  const renderTranslationTab = () => (
    <div className="settingsPanel">
      <div className="settingsPanelLead compact">
        <div className="settingsPanelHeading">
          <div className="settingsPanelLeadIcon">
            <Languages size={20} />
          </div>
          <h3>{t('translationControl')}</h3>
        </div>
        <p>{t('translationProviderDetail')}</p>
      </div>

      <div className="settingsShelf" style={{ maxWidth: '860px', paddingBottom: '40px' }}>
        <div className="modern-settings-section" ref={settingsVm.translationProviderSettingsRef} tabIndex={-1}>
          <div className="modern-settings-section-title">
            {t('translationProvider')}
          </div>
          <div className={`custom-settings-card${settingsVm.activeSettingsJumpTarget === 'translation-provider' ? ' settingsJumpTargetActive' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <CustomSelect
              label={t('translationProvider')}
              value={statusVm.translationProviderId}
              onChange={(val) => void settingsVm.updateSettings({ translationProviderPriority: [val] })}
            >
              {settingsVisibleTranslationProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{providerLabel(provider.id, t)}</option>
              ))}
            </CustomSelect>
            <div style={{ borderTop: '1px solid var(--tt-border-soft)', paddingTop: '20px' }}>
              <ProviderCard
                t={t}
                activeId={statusVm.translationProviderId}
                title={providerLabel(statusVm.translationProviderId, t)}
                detail={t('translationProviderDetail')}
                health={statusVm.llmHealth}
                state={statusVm.translationState}
                loading={settingsVm.checkingProvider === statusVm.translationProviderId}
                actionLabel={settingsVm.checkingProvider === statusVm.translationProviderId ? t('checking') : t('test')}
                onTest={() => void settingsVm.testProvider(statusVm.translationProviderId)}
              />
            </div>
          </div>
        </div>

        {currentTranslationProvider?.visibleInSettings && currentTranslationProvider.secretFields.length > 0 && (
          <>
            <ProviderApiSettingsCard
              t={t}
              provider={currentTranslationProvider}
              secret={settingsVm.providerSecrets[currentTranslationProvider.id] ?? {}}
              checkingProvider={settingsVm.checkingProvider}
              onUpdateProviderSecret={settingsVm.updateProviderSecret}
              onSaveProviderSecret={(providerId) => void settingsVm.saveProviderSecret(providerId)}
              onTestProvider={(providerId) => void settingsVm.testProvider(providerId)}
            />

            <div className="modern-settings-section">
              <div className="modern-settings-section-title">
                {t('translationRateLimits')}
              </div>
              <div className="custom-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p className="custom-settings-row-desc" style={{ marginBottom: '8px' }}>{t('translationRateLimitsDetail')}</p>
                <CustomNumber
                  label={t('concurrency')}
                  min={1}
                  max={6}
                  value={settings.translationConcurrency}
                  onChange={(val) => void settingsVm.updateSettings({ translationConcurrency: val })}
                />
                <CustomNumber
                  label={t('requestsPerMinute')}
                  min={1}
                  max={600}
                  value={settings.translationRequestsPerMinute}
                  onChange={(val) => void settingsVm.updateSettings({ translationRequestsPerMinute: val })}
                />
                <CustomNumber
                  label={t('tokenBudgetPerMinute')}
                  min={1000}
                  max={1000000}
                  step={1000}
                  value={settings.translationTokenBudgetPerMinute}
                  onChange={(val) => void settingsVm.updateSettings({ translationTokenBudgetPerMinute: val })}
                />
              </div>
            </div>

            <div className="modern-settings-section">
              <div className="modern-settings-section-title">
                {t('translationBatching')}
              </div>
              <div className="custom-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p className="custom-settings-row-desc" style={{ marginBottom: '8px' }}>{t('translationBatchingDetail')}</p>
                <CustomNumber
                  label={t('linesPerRequest')}
                  min={1}
                  max={32}
                  value={settings.translationLinesPerRequest}
                  onChange={(val) => void settingsVm.updateSettings({ translationLinesPerRequest: val, translationBatchStride: Math.min(settings.translationBatchStride, val) })}
                />
                <CustomNumber
                  label={t('batchStride')}
                  min={1}
                  max={settings.translationLinesPerRequest}
                  value={settings.translationBatchStride}
                  onChange={(val) => void settingsVm.updateSettings({ translationBatchStride: val })}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
      {activeTab === 'general' && renderGeneralTab()}
      {activeTab === 'asr' && renderAsrTab()}
      {activeTab === 'translation' && renderTranslationTab()}
    </div>
  );
}

