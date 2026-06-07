import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  FileVideo,
  Gauge,
  HardDriveDownload,
  Languages,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck
} from 'lucide-react';
import './i18n';
import './styles.css';
import type {
  AppSettingsPublic,
  JobSnapshot,
  NativeHealth,
  ProviderHealth,
  ProviderSecretInput,
  SubtitleSegment,
  SubtitleStatus,
  WhisperModelInfo,
  WhisperRuntimeStatus
} from '@shared/types';
import type { JobStage } from '@shared/models';
import { formatTimestamp } from '@shared/srt';
import { languageLabel, languageRegistry } from '@shared/languages';

const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;
const translationProviders = ['openai.compatible'] as const;

type ExportVariant = 'source' | 'translated' | 'bilingual';
type BilingualOrder = 'source-first' | 'target-first';
type AppView = 'workspace' | 'settings';

const asrProviders = [
  { id: 'local.whisper.cpp', nameKey: 'localProvider', descriptionKey: 'localProviderDetail' },
  { id: 'cloud.openai', nameKey: 'cloudProvider', descriptionKey: 'cloudProviderDetail' }
] as const;

function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>('workspace');
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);
  const [settings, setSettings] = useState<AppSettingsPublic>();
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [nativeHealth, setNativeHealth] = useState<NativeHealth>();
  const [runtimeStatus, setRuntimeStatus] = useState<WhisperRuntimeStatus>();
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealth>>({});
  const [providerSecrets, setProviderSecrets] = useState<Record<string, ProviderSecretInput>>({});
  const [job, setJob] = useState<JobSnapshot>();
  const [mediaPath, setMediaPath] = useState('');
  const [exportPath, setExportPath] = useState('');
  const [exportVariant, setExportVariant] = useState<ExportVariant>('translated');
  const [bilingualOrder, setBilingualOrder] = useState<BilingualOrder>('source-first');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [message, setMessage] = useState(t('ready'));
  const [busy, setBusy] = useState(false);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [checkingProvider, setCheckingProvider] = useState<string>();

  const translateStage = useCallback((stage: JobStage) => i18n.t(stageLabel(stage)), [i18n]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const [nextSettings, nextModels, nextHealth] = await Promise.all([
        window.translateTer.getSettings(),
        window.translateTer.assets.listWhisperModels(),
        window.translateTer.native.health().catch(() => undefined)
      ]);
      const [cloudAsrSecret, llmSecret] = await Promise.all([
        window.translateTer.settings.getSecret('cloud.openai'),
        window.translateTer.settings.getSecret('openai.compatible')
      ]);

      if (!mounted) return;

      setSettings(nextSettings);
      setModels(nextModels);
      setNativeHealth(nextHealth);
      setProviderSecrets({
        'cloud.openai': cloudAsrSecret ?? {},
        'openai.compatible': llmSecret ?? {}
      });
      await i18n.changeLanguage(nextSettings.uiLanguage);
      if (mounted) setMessage(i18n.t('ready'));
    })();

    const unsubscribe = window.translateTer.jobs.onEvent((event) => {
      if (event.type === 'snapshot') setJob(event.job);
      if (event.type === 'progress') setMessage(event.message ?? translateStage(event.stage));
      if (event.type === 'error') setMessage(event.message);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [i18n, translateStage]);

  useEffect(() => {
    if (!job?.subtitleDocument?.segments.length) {
      setSelectedSegmentId(undefined);
      return;
    }

    setSelectedSegmentId((current) =>
      current && job.subtitleDocument?.segments.some((segment) => segment.id === current)
        ? current
        : job.subtitleDocument?.segments[0]?.id
    );
  }, [job?.subtitleDocument]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = (): void => setSystemPrefersDark(mediaQuery.matches);
    syncSystemTheme();
    mediaQuery.addEventListener('change', syncSystemTheme);
    return () => mediaQuery.removeEventListener('change', syncSystemTheme);
  }, []);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme =
      settings.theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : settings.theme;
  }, [settings, systemPrefersDark]);

  useEffect(() => {
    if (!settings) return;
    const migratedTranslationPriority = settings.translationProviderPriority.filter(
      (providerId) => providerId !== 'mock.local'
    );
    const migratedAsrProviderId =
      settings.asrProviderId === 'mock.asr' ? 'local.whisper.cpp' : settings.asrProviderId;
    const needsMigration =
      migratedAsrProviderId !== settings.asrProviderId ||
      migratedTranslationPriority.length !== settings.translationProviderPriority.length ||
      migratedTranslationPriority.length === 0;

    if (!needsMigration) return;

    void updateSettings({
      asrProviderId: migratedAsrProviderId,
      translationProviderPriority:
        migratedTranslationPriority.length > 0 ? migratedTranslationPriority : ['openai.compatible']
    });
  }, [settings]);

  async function updateSettings(patch: Partial<AppSettingsPublic>): Promise<void> {
    const next = await window.translateTer.saveSettings(patch);
    setSettings(next);
    if (patch.uiLanguage) {
      await i18n.changeLanguage(next.uiLanguage);
      setMessage(i18n.t('ready'));
    }
  }

  async function refreshModels(): Promise<void> {
    setModels(await window.translateTer.assets.listWhisperModels());
  }

  async function checkRuntime(): Promise<void> {
    if (!settings) return;
    setCheckingRuntime(true);
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: settings.allowWhisperAssetDownload,
        preferCuda: settings.localWhisperUseCuda
      });
      setRuntimeStatus(status);
      setMessage(status.message ?? t(runtimeActionLabel(status.actionRequired)));
      await refreshModels();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingRuntime(false);
    }
  }

  async function testProvider(providerId: string): Promise<void> {
    setCheckingProvider(providerId);
    try {
      const draftSecret = providerSecrets[providerId];
      if (draftSecret) {
        await window.translateTer.settings.setSecret(providerId, draftSecret);
      }
      const health = await window.translateTer.settings.testProvider(providerId);
      setProviderHealth((current) => ({ ...current, [providerId]: health }));
      setMessage(health.message ?? t(providerStatusLabel(health.status)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingProvider(undefined);
    }
  }

  async function pickMedia(): Promise<void> {
    const selected = await window.translateTer.selectVideo();
    if (selected) setMediaPath(selected);
  }

  async function createAndStart(): Promise<void> {
    if (!settings || !mediaPath.trim()) return;
    setBusy(true);
    try {
      const nextJob = await window.translateTer.startTranscription({
        mediaPath: mediaPath.trim(),
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        localWhisperUseCuda: settings.localWhisperUseCuda,
        allowWhisperAssetDownload: settings.allowWhisperAssetDownload,
        allowCloudAsrUpload: settings.allowCloudAsrUpload,
        translationProviderPriority: settings.translationProviderPriority,
        translationConcurrency: settings.translationConcurrency,
        translationRequestsPerMinute: settings.translationRequestsPerMinute,
        translationTokenBudgetPerMinute: settings.translationTokenBudgetPerMinute,
        translationLinesPerRequest: settings.translationLinesPerRequest,
        translationBatchStride: settings.translationBatchStride
      });
      setJob(nextJob);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function translateJob(): Promise<void> {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await window.translateTer.startTranslation(job.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSrt(): Promise<void> {
    if (!job?.subtitleDocument || !exportPath.trim()) return;
    setBusy(true);
    try {
      await window.translateTer.exportSrt(job.subtitleDocument, exportPath.trim(), exportVariant, bilingualOrder);
      setMessage(t('exported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateSegment(segment: SubtitleSegment, patch: Partial<SubtitleSegment>): Promise<void> {
    if (!job) return;
    const next = await window.translateTer.subtitles.updateSegment(job.id, { ...segment, ...patch });
    setJob(next);
  }

  async function swapLanguages(): Promise<void> {
    if (!settings || settings.sourceLanguage === 'auto') return;
    await updateSettings({
      sourceLanguage: settings.targetLanguage,
      targetLanguage: settings.sourceLanguage
    });
  }

  async function saveProviderSecret(providerId: string): Promise<void> {
    await window.translateTer.settings.setSecret(providerId, providerSecrets[providerId] ?? {});
    setMessage(t('providerSaved'));
  }

  function updateProviderSecret(providerId: string, patch: Partial<ProviderSecretInput>): void {
    setProviderSecrets((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        ...patch
      }
    }));
  }

  const currentStepIndex = useMemo(() => {
    const step = job?.step ?? 'import';
    return steps.indexOf(step);
  }, [job]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === settings?.whisperModelId),
    [models, settings?.whisperModelId]
  );

  const completion = job?.progress ?? 0;
  const segments = job?.subtitleDocument?.segments ?? [];
  const translatedCount = segments.filter((segment) => Boolean(segment.translatedText?.trim())).length;
  const warningCount = (job?.warnings.length ?? 0) + (job?.subtitleDocument?.metadata.warnings.length ?? 0);
  const sourceLabel = settings ? languageLabel(settings.sourceLanguage, settings.uiLanguage) : '';
  const targetLabel = settings ? languageLabel(settings.targetLanguage, settings.uiLanguage) : '';
  const translationProviderId = settings?.translationProviderPriority[0] ?? 'openai.compatible';
  const supportsCuda = Boolean(nativeHealth?.cudaSupported || runtimeStatus?.acceleration.cudaSupported);
  const llmHealth = providerHealth[translationProviderId];
  const asrHealth = providerHealth[settings?.asrProviderId ?? 'local.whisper.cpp'];
  const cloudAsrSecret = providerSecrets['cloud.openai'] ?? {};
  const llmSecret = providerSecrets['openai.compatible'] ?? {};
  const canForceStop = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.stage));
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0];
  const runtimeSummary = runtimeStatus
    ? `${t(runtimeActionLabel(runtimeStatus.actionRequired))} · ${runtimeStatus.acceleration.selected.toUpperCase()}`
    : t('notChecked');
  const selectedMediaPath = job?.mediaPath ?? mediaPath.trim();
  const selectedMediaFileName =
    job?.fileName ?? selectedMediaPath.split(/[\\/]/).filter(Boolean).at(-1) ?? t('chooseMedia');
  const jobTitle = selectedMediaFileName;

  async function forceStop(): Promise<void> {
    if (!job) return;
    setBusy(false);
    await window.translateTer.jobs.cancel(job.id);
    setJob(await window.translateTer.jobs.get(job.id));
    setMessage(t('stopped'));
  }

  if (!settings) return <div className="boot">Translate-Ter</div>;

  return (
    <div className="appShell">
      <header className="topChrome">
        <div className="brand">
          <FileVideo size={18} />
          <div>
            <strong>{t('appName')}</strong>
          </div>
        </div>
        <div className="topChromeTabs">
          <button
            className={activeView === 'workspace' ? 'chromeTab active' : 'chromeTab'}
            onClick={() => setActiveView('workspace')}
          >
            <Gauge size={15} />
            {t('workspace')}
          </button>
          <button
            className={activeView === 'settings' ? 'chromeTab active' : 'chromeTab'}
            onClick={() => setActiveView('settings')}
          >
            <Settings size={15} />
            {t('settings')}
          </button>
        </div>
      </header>

      {activeView === 'workspace' ? (
        <section className="viewFrame workspaceFrame">
          <nav className="workflowRail">
            {steps.map((step, index) => (
              <span
                className={
                  index < currentStepIndex
                    ? 'workflowStep done'
                    : index === currentStepIndex
                      ? 'workflowStep active'
                      : 'workflowStep'
                }
                key={step}
              >
                <span className="workflowStepDot" />
                <strong>{index + 1}</strong>
                <span>{t(step)}</span>
              </span>
            ))}
          </nav>

          <main className={`workspaceLayout${statsCollapsed ? ' statsCollapsed' : ''}`}>
            <aside className={`statsRail${statsCollapsed ? ' collapsed' : ''}`}>
              <button
                className="railToggle"
                title={statsCollapsed ? t('expandSummary') : t('collapseSummary')}
                onClick={() => setStatsCollapsed((current) => !current)}
              >
                {statsCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
              {!statsCollapsed && (
                <div className="railContent">
                  <div className="railHeader">
                    <strong>{t('workflowSummary')}</strong>
                    <span>{t(stageLabel(job?.stage ?? 'idle'))}</span>
                  </div>
                  <MetricCard
                    icon={<Gauge size={16} />}
                    label={t('jobStage')}
                    value={t(stageLabel(job?.stage ?? 'idle'))}
                  />
                  <MetricCard
                    icon={<Languages size={16} />}
                    label={t('languagePair')}
                    value={`${sourceLabel} -> ${targetLabel}`}
                  />
                  <MetricCard
                    icon={<ShieldCheck size={16} />}
                    label={t('translatedRows')}
                    value={`${translatedCount}/${segments.length}`}
                  />
                  <MetricCard
                    icon={<AlertCircle size={16} />}
                    label={t('warnings')}
                    value={String(warningCount)}
                  />
                  <div className="railNote">
                    <span className={`signal ${llmHealth?.ok ? 'good' : llmHealth ? 'warn' : ''}`} />
                    <div>
                      <strong>{providerLabel(translationProviderId, t)}</strong>
                      <small>{llmHealth ? t(providerStatusLabel(llmHealth.status)) : t('translationProviderDetail')}</small>
                    </div>
                  </div>
                  <div className="railNote">
                    <span className={`signal ${runtimeStatus?.binary.installed ? 'good' : ''}`} />
                    <div>
                      <strong>{t('runtime')}</strong>
                      <small>{runtimeSummary}</small>
                    </div>
                  </div>
                </div>
              )}
            </aside>

            <section className="workspaceMain">
              <section className="jobOverview" aria-label={t('currentJob')}>
                <div className="jobOverviewMain">
                  <div className="jobTitleBlock">
                    <strong title={jobTitle}>{jobTitle}</strong>
                    <div className="jobOverviewMeta">
                      <span className="stageBadge">{t(stageLabel(job?.stage ?? 'idle'))}</span>
                      <span className="metaPill">
                        <Languages size={14} />
                        {sourceLabel} <ArrowRight size={12} /> {targetLabel}
                      </span>
                      <span className="metaPill">
                        <Gauge size={14} />
                        {completion}%
                      </span>
                    </div>
                  </div>
                  <div className="jobPrimaryActions">
                    <button className="secondary" onClick={() => void pickMedia()}>
                      <FileVideo size={16} />
                      {t('chooseMedia')}
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !mediaPath.trim()}
                      onClick={() => void createAndStart()}
                    >
                      <Play size={16} />
                      {t('startTranscription')}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !job?.subtitleDocument}
                      onClick={() => void translateJob()}
                    >
                      <Languages size={16} />
                      {t('translateSubtitles')}
                    </button>
                  </div>
                </div>
                <div className="track">
                  <span style={{ width: `${completion}%` }} />
                </div>
                <div className="jobOverviewFooter">
                  <div className="heroField mediaSummary">
                    <span className="fieldLabel">{t('mediaFile')}</span>
                    <strong title={jobTitle}>{jobTitle}</strong>
                    <small title={selectedMediaPath}>{selectedMediaPath || t('placeholderPath')}</small>
                  </div>
                  <div className="overviewMetaGrid">
                    <MetricCard
                      icon={<Gauge size={16} />}
                      label={t('jobStage')}
                      value={t(stageLabel(job?.stage ?? 'idle'))}
                    />
                    <MetricCard
                      icon={<ShieldCheck size={16} />}
                      label={t('translatedRows')}
                      value={`${translatedCount}/${segments.length}`}
                    />
                    <MetricCard
                      icon={<AlertCircle size={16} />}
                      label={t('warnings')}
                      value={String(warningCount)}
                    />
                  </div>
                </div>
              </section>

              <section className="subtitleWorkbench">
                <div className="panelHeader">
                  <div>
                    <h2>{t('subtitles')}</h2>
                    <p>{t('reviewHint')}</p>
                  </div>
                  <div className="panelHeaderMeta">
                    <span>{t('rows', { count: segments.length })}</span>
                  </div>
                </div>
                {job?.subtitleDocument ? (
                  <div className="subtitleWorkspace">
                    <div className="subtitleTable">
                      <div className="row head">
                        <span>{t('start')}</span>
                        <span>{t('end')}</span>
                        <span>{t('original')}</span>
                        <span>{t('translated')}</span>
                        <span>{t('status')}</span>
                      </div>
                      {job.subtitleDocument.segments.map((segment) => (
                        <button
                          type="button"
                          className={segment.id === selectedSegment?.id ? 'row selectable selected' : 'row selectable'}
                          key={segment.id}
                          onClick={() => setSelectedSegmentId(segment.id)}
                        >
                          <span>{formatTimestamp(segment.startMs)}</span>
                          <span>{formatTimestamp(segment.endMs)}</span>
                          <div className="previewText">{segment.sourceText}</div>
                          <div className="previewText translatedPreview">{segment.translatedText ?? ''}</div>
                          <span className={`status ${segment.status}`}>{t(statusLabel(segment.status))}</span>
                        </button>
                      ))}
                    </div>
                    {selectedSegment && (
                      <div className="segmentDetail">
                        <div className="panelHeader compactHeader">
                          <div>
                            <h3>{t('segmentDetails')} #{selectedSegment.index}</h3>
                            <p>
                              {formatTimestamp(selectedSegment.startMs)} - {formatTimestamp(selectedSegment.endMs)}
                            </p>
                          </div>
                          <span className={`status ${selectedSegment.status}`}>
                            {t(statusLabel(selectedSegment.status))}
                          </span>
                        </div>
                        <div className="editorGrid">
                          <label>
                            {t('original')}
                            <textarea
                              aria-label={`${t('original')} ${selectedSegment.index}`}
                              value={selectedSegment.sourceText}
                              onChange={(event) =>
                                void updateSegment(selectedSegment, { sourceText: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t('translated')}
                            <textarea
                              className="translatedField"
                              aria-label={`${t('translated')} ${selectedSegment.index}`}
                              value={selectedSegment.translatedText ?? ''}
                              placeholder={t('translated')}
                              onChange={(event) =>
                                void updateSegment(selectedSegment, { translatedText: event.target.value })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty">
                    <Clock3 size={24} />
                    <strong>{t('noSubtitlesTitle')}</strong>
                    <span>{t('noSubtitles')}</span>
                  </div>
                )}
              </section>
            </section>

            <aside className="exportDock">
              <section className="exportPanel">
                <div className="panelHeader exportHeader">
                  <div>
                    <h3>
                      <Save size={16} />
                      {t('export')}
                    </h3>
                  </div>
                </div>
                <div className="segmented">
                  {[
                    ['translated', t('translatedOnly')],
                    ['source', t('sourceOnly')],
                    ['bilingual', t('bilingual')]
                  ].map(([value, label]) => (
                    <button
                      className={exportVariant === value ? 'selected' : ''}
                      key={value}
                      onClick={() => setExportVariant(value as ExportVariant)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {exportVariant === 'bilingual' && (
                  <div className="segmented two">
                    {[
                      ['source-first', t('sourceFirst')],
                      ['target-first', t('targetFirst')]
                    ].map(([value, label]) => (
                      <button
                        className={bilingualOrder === value ? 'selected' : ''}
                        key={value}
                        onClick={() => setBilingualOrder(value as BilingualOrder)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  value={exportPath}
                  placeholder={t('exportPath')}
                  onChange={(event) => setExportPath(event.target.value)}
                />
                <button
                  className="primary wideButton"
                  disabled={busy || !job?.subtitleDocument || !exportPath.trim()}
                  onClick={() => void exportSrt()}
                >
                  <Save size={16} />
                  {t('exportSrt')}
                </button>
              </section>
            </aside>
          </main>
        </section>
      ) : (
        <section className="viewFrame settingsFrame">
          <main className="settingsPage">
            <div className="settingsGrid">
              <section className="settingsColumn">
                <section className="settingsPanel">
                  <InspectorSection icon={<Settings size={16} />} title={t('softwareSettings')}>
                  <div className="segmented three">
                    <button
                      className={settings.theme === 'system' ? 'selected' : ''}
                      onClick={() => void updateSettings({ theme: 'system' })}
                    >
                      {t('systemMode')}
                    </button>
                    <button
                      className={settings.theme === 'dark' ? 'selected' : ''}
                      onClick={() => void updateSettings({ theme: 'dark' })}
                    >
                      {t('darkMode')}
                    </button>
                    <button
                      className={settings.theme === 'light' ? 'selected' : ''}
                      onClick={() => void updateSettings({ theme: 'light' })}
                    >
                      {t('lightMode')}
                    </button>
                  </div>
                  <label>
                    {t('uiLanguage')}
                    <select
                      value={settings.uiLanguage}
                      onChange={(event) =>
                        void updateSettings({ uiLanguage: event.target.value as 'en-US' | 'zh-CN' })
                      }
                    >
                      <option value="en-US">English</option>
                      <option value="zh-CN">中文</option>
                    </select>
                  </label>
                  </InspectorSection>
                </section>

                <section className="settingsPanel">
                  <InspectorSection icon={<MonitorCog size={16} />} title={t('runtime')}>
                    <div className="runtimeGrid">
                      <StatusLine
                        label={t('nativeBackend')}
                        value={nativeHealth?.status ? t(nativeHealth.status) : t('unknown')}
                        tone={nativeHealth?.status === 'ok' ? 'good' : 'muted'}
                      />
                      <StatusLine
                        label={t('acceleration')}
                        value={nativeHealth?.hardwareAcceleration?.toUpperCase() ?? t('unknown')}
                        tone={nativeHealth?.hardwareAcceleration === 'gpu' ? 'good' : 'muted'}
                      />
                      <StatusLine
                        label={t('cudaAcceleration')}
                        value={supportsCuda ? t('cudaDetectedShort') : t('cudaUnavailableShort')}
                        tone={supportsCuda ? 'good' : 'muted'}
                      />
                      <StatusLine
                        label={t('runtimeBinary')}
                        value={runtimeStatus?.binary.installed ? t('installed') : t('notChecked')}
                        tone={runtimeStatus?.binary.installed ? 'good' : 'muted'}
                      />
                      <StatusLine
                        label={t('runtimeModel')}
                        value={runtimeStatus?.model.installed ? t('installed') : t('notChecked')}
                        tone={runtimeStatus?.model.installed ? 'good' : 'muted'}
                      />
                    </div>
                  </InspectorSection>
                </section>
              </section>

              <section className="settingsColumn">
                <section className="settingsPanel">
                  <InspectorSection icon={<Settings size={16} />} title={t('workflowSettings')}>
                    <div className="languagePair">
                      <SelectField
                        label={t('sourceLanguage')}
                        uiLanguage={settings.uiLanguage}
                        value={settings.sourceLanguage}
                        onChange={(value) => void updateSettings({ sourceLanguage: value })}
                      />
                      <button
                        className="swapButton"
                        disabled={settings.sourceLanguage === 'auto'}
                        title={t('swapLanguages')}
                        onClick={() => void swapLanguages()}
                      >
                        <ArrowRightLeft size={16} />
                      </button>
                      <SelectField
                        label={t('targetLanguage')}
                        uiLanguage={settings.uiLanguage}
                        value={settings.targetLanguage}
                        targetOnly
                        onChange={(value) => void updateSettings({ targetLanguage: value })}
                      />
                    </div>
                  </InspectorSection>
                </section>

                <section className="settingsPanel">
                  <InspectorSection icon={<Settings size={16} />} title={t('asr')}>
                <label>
                  {t('asrProvider')}
                  <select
                    value={settings.asrProviderId}
                    onChange={(event) => void updateSettings({ asrProviderId: event.target.value })}
                  >
                    {asrProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                        {providerLabel(provider.id, t)}
                    </option>
                    ))}
                  </select>
                </label>
                <ProviderCard
                  activeId={settings.asrProviderId}
                  detail={t(asrProviders.find((provider) => provider.id === settings.asrProviderId)?.descriptionKey ?? 'providerReady')}
                  health={asrHealth}
                  loading={checkingProvider === settings.asrProviderId}
                  onTest={() => void testProvider(settings.asrProviderId)}
                />
                {settings.asrProviderId === 'local.whisper.cpp' && (
                  <>
                    <div className="providerCard">
                      <div>
                        <strong>{t('localRuntimeSettings')}</strong>
                        <small>{t('localProviderDetail')}</small>
                      </div>
                    </div>
                    <label>
                      {t('whisperModel')}
                      <select
                        value={settings.whisperModelId}
                        onChange={(event) => void updateSettings({ whisperModelId: event.target.value })}
                      >
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName} · {model.installed ? t('installed') : t('missing')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ToggleField
                      label={t('allowWhisperDownloads')}
                      detail={t('allowWhisperDownloadsDetail')}
                      checked={settings.allowWhisperAssetDownload}
                      onChange={(checked) => void updateSettings({ allowWhisperAssetDownload: checked })}
                    />
                    <ToggleField
                      label={t('cudaAcceleration')}
                      detail={supportsCuda ? t('cudaDetected') : t('cudaUnavailable')}
                      checked={settings.localWhisperUseCuda}
                      disabled={!supportsCuda}
                      onChange={(checked) => void updateSettings({ localWhisperUseCuda: checked })}
                    />
                    <div className="modelCard">
                      <div>
                        <span className={selectedModel?.installed ? 'signal good' : 'signal'} />
                        <strong>{selectedModel?.displayName ?? t('whisperModel')}</strong>
                        <small>{selectedModel ? formatBytes(selectedModel.sizeBytes) : t('missing')}</small>
                      </div>
                      <button
                        className="secondary compact"
                        disabled={checkingRuntime}
                        onClick={() => void checkRuntime()}
                      >
                        <HardDriveDownload size={16} />
                        {checkingRuntime ? t('checking') : t('checkRuntime')}
                      </button>
                      {runtimeStatus && (
                        <p title={runtimeStatus.acceleration.fallbackReason}>
                          {t(runtimeActionLabel(runtimeStatus.actionRequired))}
                          {' · '}
                          {runtimeStatus.acceleration.selected.toUpperCase()}
                          {' · '}
                          {t('runtimeVariant')}: {runtimeStatus.acceleration.runtimeVariant.toUpperCase()}
                        </p>
                      )}
                    </div>
                  </>
                )}
                {settings.asrProviderId === 'cloud.openai' && (
                  <>
                    <div className="providerCard">
                      <div>
                        <strong>{t('cloudProviderSettings')}</strong>
                        <small>{t('cloudProviderDetail')}</small>
                      </div>
                    </div>
                    <TextField
                      label={t('baseUrl')}
                      value={cloudAsrSecret.baseUrl ?? ''}
                      placeholder="https://api.openai.com/v1"
                      onChange={(value) => updateProviderSecret('cloud.openai', { baseUrl: value })}
                    />
                    <TextField
                      label={t('apiKey')}
                      value={cloudAsrSecret.apiKey ?? ''}
                      placeholder="sk-..."
                      type="password"
                      onChange={(value) => updateProviderSecret('cloud.openai', { apiKey: value })}
                    />
                    <TextField
                      label={t('model')}
                      value={cloudAsrSecret.model ?? ''}
                      placeholder="whisper-1"
                      onChange={(value) => updateProviderSecret('cloud.openai', { model: value })}
                    />
                    <ToggleField
                      label={t('uploadConsent')}
                      detail={t('uploadConsentDetail')}
                      checked={settings.allowCloudAsrUpload}
                      onChange={(checked) => void updateSettings({ allowCloudAsrUpload: checked })}
                    />
                    <ProviderActionRow
                      savingLabel={t('saveProvider')}
                      testingLabel={checkingProvider === 'cloud.openai' ? t('checking') : t('test')}
                      onSave={() => void saveProviderSecret('cloud.openai')}
                      onTest={() => void testProvider('cloud.openai')}
                      testDisabled={checkingProvider === 'cloud.openai'}
                    />
                  </>
                )}
                  </InspectorSection>
                </section>

                <section className="settingsPanel">
                  <InspectorSection icon={<Languages size={16} />} title={t('translate')}>
                <label>
                  {t('translationProvider')}
                  <select
                    value={translationProviderId}
                    onChange={(event) =>
                      void updateSettings({
                        translationProviderPriority: [event.target.value]
                      })
                    }
                  >
                    {translationProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {providerLabel(provider, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <ProviderCard
                  activeId={translationProviderId}
                  detail={t('translationProviderDetail')}
                  health={llmHealth}
                  loading={checkingProvider === translationProviderId}
                  onTest={() => void testProvider(translationProviderId)}
                />
                {translationProviderId === 'openai.compatible' && (
                  <>
                    <div className="providerCard">
                      <div>
                        <strong>{t('llmProviderSettings')}</strong>
                        <small>{t('translationProviderDetail')}</small>
                      </div>
                    </div>
                    <TextField
                      label={t('baseUrl')}
                      value={llmSecret.baseUrl ?? ''}
                      placeholder="https://api.openai.com/v1"
                      onChange={(value) => updateProviderSecret('openai.compatible', { baseUrl: value })}
                    />
                    <TextField
                      label={t('apiKey')}
                      value={llmSecret.apiKey ?? ''}
                      placeholder="sk-..."
                      type="password"
                      onChange={(value) => updateProviderSecret('openai.compatible', { apiKey: value })}
                    />
                    <TextField
                      label={t('model')}
                      value={llmSecret.model ?? ''}
                      placeholder="gpt-4o-mini"
                      onChange={(value) => updateProviderSecret('openai.compatible', { model: value })}
                    />
                    <TextField
                      label={t('organization')}
                      value={llmSecret.organization ?? ''}
                      placeholder={t('optional')}
                      onChange={(value) => updateProviderSecret('openai.compatible', { organization: value })}
                    />
                    <div className="providerCard">
                      <div>
                        <strong>{t('translationRateLimits')}</strong>
                        <small>{t('translationRateLimitsDetail')}</small>
                      </div>
                    </div>
                    <NumberField
                      label={t('concurrency')}
                      min={1}
                      max={6}
                      value={settings.translationConcurrency}
                      onChange={(value) => void updateSettings({ translationConcurrency: value })}
                    />
                    <NumberField
                      label={t('requestsPerMinute')}
                      min={1}
                      max={600}
                      value={settings.translationRequestsPerMinute}
                      onChange={(value) => void updateSettings({ translationRequestsPerMinute: value })}
                    />
                    <NumberField
                      label={t('tokenBudgetPerMinute')}
                      min={1000}
                      max={1000000}
                      step={1000}
                      value={settings.translationTokenBudgetPerMinute}
                      onChange={(value) => void updateSettings({ translationTokenBudgetPerMinute: value })}
                    />
                    <div className="providerCard">
                      <div>
                        <strong>{t('translationBatching')}</strong>
                        <small>{t('translationBatchingDetail')}</small>
                      </div>
                    </div>
                    <NumberField
                      label={t('linesPerRequest')}
                      min={1}
                      max={32}
                      value={settings.translationLinesPerRequest}
                      onChange={(value) =>
                        void updateSettings({
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
                      onChange={(value) => void updateSettings({ translationBatchStride: value })}
                    />
                    <ProviderActionRow
                      savingLabel={t('saveProvider')}
                      testingLabel={checkingProvider === 'openai.compatible' ? t('checking') : t('test')}
                      onSave={() => void saveProviderSecret('openai.compatible')}
                      onTest={() => void testProvider('openai.compatible')}
                      testDisabled={checkingProvider === 'openai.compatible'}
                    />
                  </>
                )}
                  </InspectorSection>
                </section>
              </section>
            </div>
          </main>
        </section>
      )}

      <footer className="systemStrip">
        <span>
          {t('progress')}: {completion}%
        </span>
        <span title={message}>{message}</span>
        <div className="systemActions">
          {canForceStop && (
            <button className="textButton" onClick={() => void forceStop()}>
              <AlertCircle size={14} />
              {t('forceStop')}
            </button>
          )}
          {job?.error && (
            <button className="textButton" onClick={() => void createAndStart()}>
              <RotateCcw size={14} />
              {t('retry')}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function MetricCard(props: { icon: React.ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="metricCard">
      {props.icon}
      <span>{props.label}</span>
      <strong title={props.value}>{props.value}</strong>
    </div>
  );
}

function InspectorSection(props: { icon: React.ReactNode; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="inspectorSection">
      <h3>
        {props.icon}
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function InlineNotice(props: { title: string; detail: string }): JSX.Element {
  return (
    <div className="providerCard">
      <div>
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </div>
    </div>
  );
}

function ProviderCard(props: {
  activeId: string;
  detail: string;
  health?: ProviderHealth;
  loading: boolean;
  onTest: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const tone = props.health?.ok ? 'good' : props.health ? 'warn' : 'muted';
  return (
    <div className="providerCard">
      <div>
        <span className={`signal ${tone}`} />
        <strong title={props.activeId}>{providerLabel(props.activeId, t)}</strong>
        <small>{props.health ? t(providerStatusLabel(props.health.status)) : props.detail}</small>
      </div>
      <button className="secondary compact" disabled={props.loading} onClick={props.onTest}>
        <CheckCircle2 size={16} />
        {props.loading ? t('checking') : t('test')}
      </button>
      {props.health?.message && <p title={props.health.message}>{props.health.message}</p>}
    </div>
  );
}

function StatusLine(props: { label: string; value: string; tone: 'good' | 'muted' }): JSX.Element {
  return (
    <div className="statusLine">
      <span>{props.label}</span>
      <strong className={props.tone}>{props.value}</strong>
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}): JSX.Element {
  return (
    <label>
      {props.label}
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleField(props: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <div className="statusLine">
        <span>{props.detail}</span>
        <input
          type="checkbox"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.checked)}
        />
      </div>
    </label>
  );
}

function ProviderActionRow(props: {
  savingLabel: string;
  testingLabel: string;
  onSave: () => void;
  onTest: () => void;
  testDisabled?: boolean;
}): JSX.Element {
  return (
    <div className="segmented two">
      <button onClick={props.onSave}>
        <Save size={16} />
        {props.savingLabel}
      </button>
      <button onClick={props.onTest} disabled={props.testDisabled}>
        <CheckCircle2 size={16} />
        {props.testingLabel}
      </button>
    </div>
  );
}

function SelectField(props: {
  label: string;
  uiLanguage: 'en-US' | 'zh-CN';
  value: string;
  targetOnly?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const options = languageRegistry.filter((language) =>
    props.targetOnly ? language.supportsTranslationTarget : language.supportsAsr
  );
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {options.map((language) => (
          <option key={language.code} value={language.code}>
            {languageLabel(language.code, props.uiLanguage)}
          </option>
        ))}
      </select>
    </label>
  );
}

function stageLabel(stage: JobStage): string {
  return `stage.${stage}`;
}

function statusLabel(status: SubtitleStatus): string {
  return `segmentStatus.${status}`;
}

function providerStatusLabel(status: ProviderHealth['status']): string {
  return `providerStatus.${status}`;
}

function runtimeActionLabel(action: WhisperRuntimeStatus['actionRequired'] = 'none'): string {
  return `runtimeAction.${action}`;
}

function providerLabel(providerId: string, t: (key: string) => string): string {
  switch (providerId) {
    case 'local.whisper.cpp':
      return t('localWhisperCppProvider');
    case 'cloud.openai':
      return t('cloudOpenaiProvider');
    case 'openai.compatible':
      return t('openaiCompatibleProvider');
    default:
      return providerId;
  }
}

function shortLanguage(code: string): string {
  return code === 'auto' ? 'Auto' : code.toUpperCase();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(index <= 1 ? 0 : 1)} ${units[index]}`;
}

createRoot(document.getElementById('root')!).render(<App />);
