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
  ShieldCheck,
  SlidersHorizontal,
  ArrowRightLeft
} from 'lucide-react';
import type { AppLogLevel, AppSettingsPublic, ExportDestinationMode, SubtitleFileFormat } from '@shared/types';
import type { useSettingsViewModel } from '../../viewModels/useSettingsViewModel';
import type { useProviderStatusViewModel } from '../../viewModels/useProviderStatusViewModel';
import {
  accelerationOptionLabel,
  describeFfmpegLocation,
  describeModelFootprint,
  exportDestinationModeLabel,
  localCpuModeDetailLabel,
  localCpuModeLabel,
  logLevelDetailLabel,
  providerLabel,
  runtimeVariantOptionLabel
} from '../../app/displayHelpers';
import { ProviderApiSettingsCard } from './ProviderApiSettingsCard';
import {
  InspectorSection,
  NumberField,
  ProviderCard,
  SectionTitle,
  SelectField,
  SettingsFactCard,
  SettingsOverviewCard,
  ToggleField
} from './Primitives';

type SettingsViewProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  settingsVm: ReturnType<typeof useSettingsViewModel>;
  statusVm: ReturnType<typeof useProviderStatusViewModel>;
};

export function SettingsView(props: SettingsViewProps): JSX.Element | null {
  const { t, settingsVm, statusVm } = props;
  const settings = settingsVm.settings;

  if (!settings) return null;

  return (
    <section className="viewFrame settingsFrame">
      <main className="settingsPage">
        <section className="settingsSummaryBar">
          <div className="settingsSummaryIntro">
            <div className="settingsPanelHeading">
              <div className="settingsPanelLeadIcon">
                <Settings size={16} />
              </div>
              <div className="settingsSummaryCopy">
                <h2>{t('settingsOverview')}</h2>
                <p>{t('settingsHint')}</p>
              </div>
            </div>
            <div className="settingsBadgeRow">
              <span className="settingsBadge">{providerLabel(statusVm.asrProviderId, t)}</span>
              <span className="settingsBadge">{providerLabel(statusVm.translationProviderId, t)}</span>
              <span className={`settingsBadge tone-${statusVm.asrProviderState.tone}`}>{statusVm.asrProviderState.label}</span>
            </div>
          </div>
          <div className="settingsSummaryGrid">
            {statusVm.usingWhisperCpp ? (
              <>
                <SettingsOverviewCard
                  icon={<ShieldCheck size={16} />}
                  eyebrow={t('summaryRecognitionRuntime')}
                  title={statusVm.runtimeState.label}
                  detail={statusVm.runtimeState.detail}
                  tone={statusVm.runtimeState.tone}
                  featured
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.runtimeSummaryJumpTarget)}
                />
                <SettingsFactCard
                  icon={<ShieldCheck size={16} />}
                  label={t('summaryDesktopBackend')}
                  value={statusVm.nativeBackendState.label}
                  detail={statusVm.nativeBackendState.detail}
                  tone={statusVm.nativeBackendState.tone}
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.backendJumpTarget)}
                />
                <SettingsFactCard
                  icon={<Download size={16} />}
                  label={t('summaryFfmpegTools')}
                  value={statusVm.ffmpegState.label}
                  tone={statusVm.ffmpegState.tone}
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.ffmpegJumpTarget)}
                />
                <SettingsFactCard
                  icon={<MonitorCog size={16} />}
                  label={t('summaryBackendAcceleration')}
                  value={statusVm.backendAccelerationState.label}
                  detail={statusVm.backendAccelerationState.detail}
                  tone={statusVm.backendAccelerationState.tone}
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.accelerationJumpTarget)}
                />
                <SettingsFactCard
                  icon={<Gauge size={16} />}
                  label={t('summaryCudaEnvironment')}
                  value={statusVm.cudaStatusShort}
                  tone={statusVm.cudaMismatchDetected || statusVm.cudaRuntimeMissing ? 'warn' : statusVm.cudaStatusShort === t('ok') ? 'good' : 'muted'}
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.accelerationJumpTarget)}
                />
                <SettingsFactCard
                  icon={<HardDriveDownload size={16} />}
                  label={t('summaryModelFiles')}
                  value={statusVm.runtimeModelState.label}
                  tone={statusVm.runtimeModelState.tone}
                  onClick={() => settingsVm.jumpToSettingsTarget(statusVm.modelJumpTarget)}
                />
              </>
            ) : null}
            <SettingsOverviewCard
              icon={<MonitorCog size={16} />}
              eyebrow={t('summaryAsrProvider')}
              title={providerLabel(statusVm.asrProviderId, t)}
              detail={statusVm.asrProviderState.detail}
              tone={statusVm.asrProviderState.tone}
              featured={!statusVm.usingWhisperCpp}
              onClick={() => settingsVm.jumpToSettingsTarget('asr-provider')}
            />
            <SettingsOverviewCard
              icon={<Languages size={16} />}
              eyebrow={t('summaryTranslationProvider')}
              title={providerLabel(statusVm.translationProviderId, t)}
              detail={statusVm.translationState.detail}
              tone={statusVm.translationState.tone}
              onClick={() => settingsVm.jumpToSettingsTarget(statusVm.translationJumpTarget)}
            />
          </div>
        </section>

        <div className="settingsWorkbench">
          <section className="settingsRail settingsRailPrimary">
            <section className="settingsPanel settingsPanelFeature">
              <div className="settingsPanelLead">
                <span>{t('generalControls')}</span>
                <div className="settingsPanelHeading">
                  <div className="settingsPanelLeadIcon">
                    <Settings size={16} />
                  </div>
                  <h3>{t('softwareSettings')}</h3>
                </div>
                <p>{t('reviewHint')}</p>
              </div>
              <div className="settingsShelf twoUp">
                <div className="settingsGroupCard">
                  <InspectorSection icon={<Settings size={16} />} title={t('appearance')}>
                    <div className="segmented three">
                      <button className={settings.theme === 'system' ? 'selected' : ''} onClick={() => void settingsVm.updateSettings({ theme: 'system' })} type="button">
                        {t('systemMode')}
                      </button>
                      <button className={settings.theme === 'dark' ? 'selected' : ''} onClick={() => void settingsVm.updateSettings({ theme: 'dark' })} type="button">
                        {t('darkMode')}
                      </button>
                      <button className={settings.theme === 'light' ? 'selected' : ''} onClick={() => void settingsVm.updateSettings({ theme: 'light' })} type="button">
                        {t('lightMode')}
                      </button>
                    </div>
                    <label>
                      {t('uiLanguage')}
                      <select
                        value={settings.uiLanguage}
                        onChange={(event) => void settingsVm.updateSettings({ uiLanguage: event.target.value as 'en-US' | 'zh-CN' })}
                      >
                        <option value="en-US">English</option>
                        <option value="zh-CN">中文</option>
                      </select>
                    </label>
                    <ToggleField
                      label={t('multiThreadDownload')}
                      detail={t('multiThreadDownloadDetail')}
                      checked={settings.enableMultiThreadDownload}
                      onChange={(checked) => void settingsVm.updateSettings({ enableMultiThreadDownload: checked })}
                    />
                    <div className="settingsSubsection">
                      <SectionTitle icon={<ListChecks size={15} />} title={t('activityLogs')} />
                      <div className="settingsOptionStack">
                        <label>
                          {t('logLevel')}
                          <select
                            value={settings.logLevel}
                            onChange={(event) => void settingsVm.updateSettings({ logLevel: event.target.value as AppLogLevel })}
                          >
                            {(['warning', 'error', 'info', 'debug'] as AppLogLevel[]).map((level) => (
                              <option key={level} value={level}>
                                {level.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="settingsMicrocopy">{t(logLevelDetailLabel(settings.logLevel))}</p>
                      </div>
                    </div>
                  </InspectorSection>
                </div>

                <div className="settingsGroupCard">
                  <InspectorSection icon={<Download size={16} />} title={t('workflowSettings')}>
                    <div className="languagePair">
                      <SelectField
                        label={t('sourceLanguage')}
                        uiLanguage={settings.uiLanguage}
                        value={settings.sourceLanguage}
                        onChange={(value) => void settingsVm.updateSettings({ sourceLanguage: value })}
                      />
                      <button className="swapButton" disabled={settings.sourceLanguage === 'auto'} title={t('swapLanguages')} onClick={() => void settingsVm.swapLanguages()} type="button">
                        <ArrowRightLeft size={16} />
                      </button>
                      <SelectField
                        label={t('targetLanguage')}
                        uiLanguage={settings.uiLanguage}
                        value={settings.targetLanguage}
                        targetOnly
                        onChange={(value) => void settingsVm.updateSettings({ targetLanguage: value })}
                      />
                    </div>
                    <div className="settingsSubsection">
                      <SectionTitle icon={<Download size={15} />} title={t('exportSettings')} />
                      <div className="segmented three">
                        {(['source-directory', 'selected-directory', 'ask-each-time'] as ExportDestinationMode[]).map((mode) => (
                          <button
                            className={settings.exportDestinationMode === mode ? 'selected' : ''}
                            key={mode}
                            onClick={() => void settingsVm.updateSettings({ exportDestinationMode: mode })}
                            type="button"
                          >
                            {t(exportDestinationModeLabel(mode))}
                          </button>
                        ))}
                      </div>
                      {settings.exportDestinationMode === 'selected-directory' && (
                        <button className="secondary" onClick={() => void settingsVm.pickExportDirectory()} type="button">
                          <FolderOpen size={16} />
                          {settings.exportDirectory || t('chooseFolder')}
                        </button>
                      )}
                      <div className="segmented two">
                        {(['srt', 'ass'] as SubtitleFileFormat[]).map((format) => (
                          <button
                            className={settings.exportFileFormat === format ? 'selected' : ''}
                            key={format}
                            onClick={() => void settingsVm.updateSettings({ exportFileFormat: format })}
                            type="button"
                          >
                            {t(format === 'srt' ? 'subtitleFormatSrt' : 'subtitleFormatAss')}
                          </button>
                        ))}
                      </div>
                      <div className="segmented two">
                        {(['source-first', 'target-first'] as const).map((order) => (
                          <button
                            className={settings.exportBilingualOrder === order ? 'selected' : ''}
                            key={order}
                            onClick={() => void settingsVm.updateSettings({ exportBilingualOrder: order })}
                            type="button"
                          >
                            {t(order === 'source-first' ? 'sourceFirst' : 'targetFirst')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </InspectorSection>
                </div>
              </div>
            </section>

            <section className="settingsPanel settingsPanelFeature">
              <div className="settingsPanelLead">
                <span>{t('recognitionWorkbench')}</span>
                <div className="settingsPanelHeading">
                  <div className="settingsPanelLeadIcon">
                    <MonitorCog size={16} />
                  </div>
                  <h3>{t('asr')}</h3>
                </div>
                <p>{statusVm.asrProviderState.detail}</p>
              </div>
              <div className="settingsShelf">
                <div
                  className={`settingsGroupCard${settingsVm.activeSettingsJumpTarget === 'asr-provider' ? ' settingsJumpTargetActive' : ''}`}
                  ref={settingsVm.asrProviderSettingsRef}
                  tabIndex={-1}
                >
                  <InspectorSection icon={<MonitorCog size={16} />} title={t('asrProvider')}>
                    <label>
                      {t('asrProvider')}
                      <select
                        value={settings.asrProviderId}
                        onChange={(event) => void settingsVm.updateSettings({ asrProviderId: event.target.value })}
                      >
                        <option value="local.whisper.cpp">{providerLabel('local.whisper.cpp', t)}</option>
                        <option value="local.faster-whisper">{providerLabel('local.faster-whisper', t)}</option>
                        <option value="cloud.openai">{providerLabel('cloud.openai', t)}</option>
                      </select>
                    </label>
                    <ProviderCard
                      activeId={settings.asrProviderId}
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
                    {statusVm.usingLocalAsr && (
                      <div className="settingsOptionStack">
                        <span className="fieldLabel">{t('localCpuUsage')}</span>
                        <p className="settingsMicrocopy">{t('localCpuUsageDetail')}</p>
                        <div className="segmented three">
                          {(['low', 'balanced', 'high'] as const).map((mode) => (
                            <button
                              key={mode}
                              className={settings.localAsrCpuMode === mode ? 'selected' : ''}
                              onClick={() => void settingsVm.updateSettings({ localAsrCpuMode: mode })}
                              type="button"
                            >
                              {t(localCpuModeLabel(mode))}
                            </button>
                          ))}
                        </div>
                        <p className="settingsMicrocopy">{t(localCpuModeDetailLabel(settings.localAsrCpuMode))}</p>
                      </div>
                    )}
                  </InspectorSection>
                </div>

                <div
                  className={`settingsGroupCard${settingsVm.activeSettingsJumpTarget === 'ffmpeg' ? ' settingsJumpTargetActive' : ''}`}
                  ref={settingsVm.ffmpegSettingsRef}
                  tabIndex={-1}
                >
                  <InspectorSection icon={<Download size={16} />} title={t('ffmpegTools')}>
                    <div className="modelCard">
                      <div>
                        <span className={`signal ${statusVm.ffmpegState.tone}`} />
                        <strong>{t('ffmpegTools')}</strong>
                        <small>{settingsVm.ffmpegActivity ?? statusVm.ffmpegState.detail}</small>
                      </div>
                      <div className="settingsActionRow">
                        <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'ffmpeg-check' || settingsVm.runtimeOperation === 'ffmpeg-download'} onClick={() => void settingsVm.checkFfmpegTools()} type="button">
                          <Search size={16} />
                          {settingsVm.runtimeOperation === 'ffmpeg-check' ? t('checking') : t('checkFfmpeg')}
                        </button>
                        {statusVm.showFfmpegDownload && (
                          <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'ffmpeg-check' || settingsVm.runtimeOperation === 'ffmpeg-download'} onClick={() => void settingsVm.downloadFfmpegTools()} type="button">
                            <HardDriveDownload size={16} />
                            {settingsVm.runtimeOperation === 'ffmpeg-download' ? t('downloadProgress') : t('downloadFfmpeg')}
                          </button>
                        )}
                      </div>
                      {settingsVm.ffmpegStatus && <p title={settingsVm.ffmpegStatus.ffmpegPath ?? settingsVm.ffmpegStatus.ffprobePath}>{describeFfmpegLocation(settingsVm.ffmpegStatus, t)}</p>}
                    </div>
                  </InspectorSection>
                </div>

                {statusVm.usingWhisperCpp && (
                  <div className="settingsShelf twoUp">
                    <div
                      className={`settingsGroupCard settingsGroupCardAccent${settingsVm.activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`}
                      ref={settingsVm.cudaSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<Gauge size={16} />} title={t('acceleration')}>
                        <div className="modelCard accentCard">
                          <div>
                            <span className={statusVm.cudaMismatchDetected || statusVm.cudaRuntimeMissing ? 'signal warn' : statusVm.cudaStatusShort === t('ok') ? 'signal good' : 'signal accent'} />
                            <strong>{t('acceleration')}</strong>
                            <small>{statusVm.cudaStatusDetail}</small>
                          </div>
                          <label>
                            {t('acceleration')}
                            <select
                              value={settingsVm.configuredAcceleration}
                              onChange={(event) => void settingsVm.updateLocalAsrAccelerationSetting(event.target.value as AppSettingsPublic['localAsrAcceleration'])}
                            >
                              {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                                <option key={option} value={option}>
                                  {t(accelerationOptionLabel(option))}
                                </option>
                              ))}
                            </select>
                          </label>
                          {settingsVm.runtimeVariantSelections.length > 0 && (
                            <label>
                              {t('runtimeVariant')}
                              <select
                                value={settingsVm.effectiveRuntimeVariantSelection}
                                onChange={(event) => void settingsVm.updateLocalRuntimeVariantSetting(event.target.value as any)}
                              >
                                {settingsVm.runtimeVariantSelections.map((option) => (
                                  <option key={option} value={option}>
                                    {t(runtimeVariantOptionLabel(option))}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {settingsVm.cudaFlowRelevant && (
                            <div className="settingsActionRow">
                              <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.checkCuda()} type="button">
                                <Search size={16} />
                                {settingsVm.runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                              </button>
                              {statusVm.showCudaRuntimeDownload && (
                                <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.downloadCudaRuntime()} type="button">
                                  <HardDriveDownload size={16} />
                                  {settingsVm.runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                                </button>
                              )}
                            </div>
                          )}
                          {settingsVm.cudaFlowRelevant && (
                            <ToggleField
                              label={t('ignoreCudaMismatch')}
                              detail={t('ignoreCudaMismatchDetail')}
                              checked={settingsVm.ignoreCudaMismatch}
                              onChange={(checked) => void settingsVm.updateIgnoreCudaMismatchSetting(checked)}
                            />
                          )}
                          <div className="runtimeGrid">
                            {statusVm.runtimeStatusRows.map((row) => (
                              <div className="statusLine" key={row.label}>
                                <span>{row.label}</span>
                                <strong className={row.tone}>{row.value}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </InspectorSection>
                    </div>

                    <div
                      className={`settingsGroupCard${settingsVm.activeSettingsJumpTarget === 'whisper-model' ? ' settingsJumpTargetActive' : ''}`}
                      ref={settingsVm.whisperModelSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<HardDriveDownload size={16} />} title={t('whisperModel')}>
                        <ToggleField
                          label={t('allowWhisperDownloads')}
                          detail={t('allowWhisperDownloadsDetail')}
                          checked={settings.allowWhisperAssetDownload}
                          onChange={(checked) => void settingsVm.updateSettings({ allowWhisperAssetDownload: checked })}
                        />
                        <label>
                          {t('whisperModel')}
                          <select value={settings.whisperModelId} onChange={(event) => void settingsVm.updateSettings({ whisperModelId: event.target.value })}>
                            {settingsVm.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.displayName} · {describeModelFootprint(model, t)} · {model.installed ? t('installed') : t('missing')}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="settingsActionRow">
                          <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'model-check' || settingsVm.runtimeOperation === 'model'} onClick={() => void settingsVm.checkSelectedModel()} type="button">
                            <Search size={16} />
                            {settingsVm.runtimeOperation === 'model-check' ? t('checking') : t('checkModel')}
                          </button>
                          <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'model-check' || settingsVm.runtimeOperation === 'model' || !settings.allowWhisperAssetDownload || statusVm.selectedModelVerified} onClick={() => void settingsVm.downloadSelectedModel()} type="button">
                            <HardDriveDownload size={16} />
                            {settingsVm.runtimeOperation === 'model' ? t('downloadProgress') : t('downloadModel')}
                          </button>
                        </div>
                        <div className="modelCard">
                          <div>
                            <span className={statusVm.selectedModelVerified ? 'signal good' : statusVm.selectedModelInstalled ? 'signal warn' : 'signal'} />
                            <strong>{statusVm.selectedModel?.displayName ?? t('whisperModel')}</strong>
                            <small>{statusVm.selectedModel ? describeModelFootprint(statusVm.selectedModel, t) : t('missing')}</small>
                          </div>
                          {settingsVm.modelActivity ? <p title={settingsVm.modelActivity}>{settingsVm.modelActivity}</p> : null}
                        </div>
                      </InspectorSection>
                    </div>
                  </div>
                )}

                {statusVm.usingFasterWhisper && (
                  <div className="settingsShelf twoUp">
                    <div
                      className={`settingsGroupCard settingsGroupCardAccent${settingsVm.activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`}
                      ref={settingsVm.cudaSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<Gauge size={16} />} title={t('acceleration')}>
                        <div className="modelCard accentCard">
                          <div>
                            <span className={statusVm.fasterWhisperCudaShort === t('ok') ? 'signal good' : 'signal accent'} />
                            <strong>{t('acceleration')}</strong>
                            <small>{statusVm.fasterWhisperCudaDetail}</small>
                          </div>
                          <label>
                            {t('acceleration')}
                            <select
                              value={settingsVm.configuredAcceleration}
                              onChange={(event) => void settingsVm.updateLocalAsrAccelerationSetting(event.target.value as AppSettingsPublic['localAsrAcceleration'])}
                            >
                              {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                                <option key={option} value={option}>
                                  {t(accelerationOptionLabel(option))}
                                </option>
                              ))}
                            </select>
                          </label>
                          {settingsVm.runtimeVariantSelections.length > 0 && (
                            <label>
                              {t('runtimeVariant')}
                              <select
                                value={settingsVm.effectiveRuntimeVariantSelection}
                                onChange={(event) => void settingsVm.updateLocalRuntimeVariantSetting(event.target.value as any)}
                              >
                                {settingsVm.runtimeVariantSelections.map((option) => (
                                  <option key={option} value={option}>
                                    {t(runtimeVariantOptionLabel(option))}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {settingsVm.cudaFlowRelevant && (
                            <div className="settingsActionRow">
                              <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.checkFasterWhisperCuda()} type="button">
                                <Search size={16} />
                                {settingsVm.runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                              </button>
                              {statusVm.showFasterWhisperCudaDownload && (
                                <button className="secondary compact settingsActionButton" disabled={settingsVm.runtimeOperation === 'cuda-check' || settingsVm.runtimeOperation === 'cuda-download'} onClick={() => void settingsVm.downloadFasterWhisperCudaRuntime()} type="button">
                                  <HardDriveDownload size={16} />
                                  {settingsVm.runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                                </button>
                              )}
                            </div>
                          )}
                          <div className="runtimeGrid">
                            {statusVm.runtimeStatusRows.map((row) => (
                              <div className="statusLine" key={row.label}>
                                <span>{row.label}</span>
                                <strong className={row.tone}>{row.value}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </InspectorSection>
                    </div>
                  </div>
                )}

                {settings.asrProviderId === 'cloud.openai' && (
                  <ProviderApiSettingsCard
                    t={t}
                    providerId="cloud.openai"
                    secret={settingsVm.providerSecrets['cloud.openai'] ?? {}}
                    checkingProvider={settingsVm.checkingProvider}
                    onUpdateProviderSecret={settingsVm.updateProviderSecret}
                    onSaveProviderSecret={(providerId) => void settingsVm.saveProviderSecret(providerId)}
                    onTestProvider={(providerId) => void settingsVm.testProvider(providerId)}
                  />
                )}
              </div>
            </section>
          </section>

          <section className="settingsRail settingsRailSecondary">
            <section className="settingsPanel">
              <div className="settingsPanelLead compact">
                <span>{t('translationControl')}</span>
                <div className="settingsPanelHeading">
                  <div className="settingsPanelLeadIcon">
                    <Languages size={16} />
                  </div>
                  <h3>{t('translate')}</h3>
                </div>
                <p>{t('translationProviderDetail')}</p>
              </div>
              <div className="settingsShelf">
                <div
                  className={`settingsGroupCard${settingsVm.activeSettingsJumpTarget === 'translation-provider' ? ' settingsJumpTargetActive' : ''}`}
                  ref={settingsVm.translationProviderSettingsRef}
                  tabIndex={-1}
                >
                  <InspectorSection icon={<Languages size={16} />} title={t('translationProvider')}>
                    <label>
                      {t('translationProvider')}
                      <select
                        value={statusVm.translationProviderId}
                        onChange={(event) => void settingsVm.updateSettings({ translationProviderPriority: [event.target.value] })}
                      >
                        <option value="openai.compatible">{providerLabel('openai.compatible', t)}</option>
                      </select>
                    </label>
                    <ProviderCard
                      activeId={statusVm.translationProviderId}
                      detail={t('translationProviderDetail')}
                      health={statusVm.llmHealth}
                      state={statusVm.translationState}
                      loading={settingsVm.checkingProvider === statusVm.translationProviderId}
                      actionLabel={settingsVm.checkingProvider === statusVm.translationProviderId ? t('checking') : t('test')}
                      onTest={() => void settingsVm.testProvider(statusVm.translationProviderId)}
                    />
                  </InspectorSection>
                </div>

                {statusVm.translationProviderId === 'openai.compatible' && (
                  <>
                    <ProviderApiSettingsCard
                      t={t}
                      providerId="openai.compatible"
                      secret={settingsVm.providerSecrets['openai.compatible'] ?? {}}
                      checkingProvider={settingsVm.checkingProvider}
                      onUpdateProviderSecret={settingsVm.updateProviderSecret}
                      onSaveProviderSecret={(providerId) => void settingsVm.saveProviderSecret(providerId)}
                      onTestProvider={(providerId) => void settingsVm.testProvider(providerId)}
                    />

                    <div className="settingsGroupCard">
                      <InspectorSection icon={<SlidersHorizontal size={16} />} title={t('translationRateLimits')}>
                        <p className="settingsMicrocopy">{t('translationRateLimitsDetail')}</p>
                        <div className="settingsFieldGrid">
                          <NumberField label={t('concurrency')} min={1} max={6} value={settings.translationConcurrency} onChange={(value) => void settingsVm.updateSettings({ translationConcurrency: value })} />
                          <NumberField label={t('requestsPerMinute')} min={1} max={600} value={settings.translationRequestsPerMinute} onChange={(value) => void settingsVm.updateSettings({ translationRequestsPerMinute: value })} />
                          <NumberField label={t('tokenBudgetPerMinute')} min={1000} max={1000000} step={1000} value={settings.translationTokenBudgetPerMinute} onChange={(value) => void settingsVm.updateSettings({ translationTokenBudgetPerMinute: value })} />
                        </div>
                      </InspectorSection>
                    </div>

                    <div className="settingsGroupCard">
                      <InspectorSection icon={<ListChecks size={16} />} title={t('translationBatching')}>
                        <p className="settingsMicrocopy">{t('translationBatchingDetail')}</p>
                        <div className="settingsFieldGrid">
                          <NumberField
                            label={t('linesPerRequest')}
                            min={1}
                            max={32}
                            value={settings.translationLinesPerRequest}
                            onChange={(value) =>
                              void settingsVm.updateSettings({
                                translationLinesPerRequest: value,
                                translationBatchStride: Math.min(settings.translationBatchStride, value)
                              })
                            }
                          />
                          <NumberField
                            label={t('batchStride')}
                            min={1}
                            max={settings.translationLinesPerRequest}
                            value={settings.translationBatchStride}
                            onChange={(value) => void settingsVm.updateSettings({ translationBatchStride: value })}
                          />
                        </div>
                      </InspectorSection>
                    </div>
                  </>
                )}
              </div>
            </section>
          </section>
        </div>
      </main>
    </section>
  );
}
