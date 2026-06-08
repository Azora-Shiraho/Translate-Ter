import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  FileVideo,
  Gauge,
  HardDriveDownload,
  KeyRound,
  Languages,
  ListChecks,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal
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
import type { AssetEvent, JobStage } from '@shared/models';
import { formatTimestamp } from '@shared/srt';
import { languageLabel, languageRegistry } from '@shared/languages';

const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;
const translationProviders = ['openai.compatible'] as const;

type ExportVariant = 'source' | 'translated' | 'bilingual';
type BilingualOrder = 'source-first' | 'target-first';
type AppView = 'workspace' | 'settings';
type ToastTone = 'neutral' | 'warning' | 'error' | 'success';
type ToastMessage = {
  id: string;
  message: string;
  tone: ToastTone;
  exiting: boolean;
};
type ActiveDownload = {
  scope: 'runtime' | 'model';
  receivedBytes: number;
  totalBytes?: number;
  message: string;
};

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
  const [runtimeActivity, setRuntimeActivity] = useState<string>();
  const [modelActivity, setModelActivity] = useState<string>();
  const [activeDownload, setActiveDownload] = useState<ActiveDownload>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [copyBubble, setCopyBubble] = useState<string>();
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

    const unsubscribeJobs = window.translateTer.jobs.onEvent((event) => {
      if (event.type === 'snapshot') setJob(event.job);
      if (event.type === 'progress') setMessage(event.message ?? translateStage(event.stage));
      if (event.type === 'error') pushStatus(event.message, 'error');
    });
    const unsubscribeAssets = window.translateTer.assets.onEvent((event) => {
      const nextMessage = assetEventLabel(event, (key, options) => i18n.t(key, options));
      if (event.type === 'download-start' || event.type === 'download-progress') {
        setActiveDownload({
          scope: event.scope,
          receivedBytes: event.type === 'download-progress' ? (event.receivedBytes ?? 0) : 0,
          totalBytes: event.type === 'download-progress' ? event.totalBytes : undefined,
          message: nextMessage
        });
      } else {
        setActiveDownload(undefined);
      }
      if (event.scope === 'model') {
        setModelActivity(nextMessage);
      } else {
        setRuntimeActivity(nextMessage);
      }
      setMessage(nextMessage);
      if (event.type !== 'download-progress') {
        pushToast(nextMessage, toastToneForAssetEvent(event));
      }
      if (event.type === 'ready' || event.type === 'error') {
        void refreshModels();
      }
    });

    return () => {
      mounted = false;
      unsubscribeJobs();
      unsubscribeAssets();
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

  async function checkCudaRuntime(): Promise<void> {
    if (!settings) return;
    setCheckingRuntime(true);
    setActiveDownload(undefined);
    setRuntimeActivity(t('runtimeChecking'));
    setModelActivity(undefined);
    pushStatus(t('runtimeChecking'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: settings.allowWhisperAssetDownload,
        preferCuda: true,
        downloadScope: 'cuda-runtime'
      });
      setRuntimeStatus(status);
      const nextMessage = status.acceleration.cudaSupported ? t('cudaDetected') : t('cudaUnavailable');
      setRuntimeActivity(nextMessage);
      pushStatus(nextMessage, status.acceleration.cudaSupported ? 'success' : 'warning');
      if (status.acceleration.cudaSupported && !settings.localWhisperUseCuda) {
        await updateSettings({ localWhisperUseCuda: true });
      }
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setActiveDownload(undefined);
      setRuntimeActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setCheckingRuntime(false);
    }
  }

  async function downloadSelectedModel(): Promise<void> {
    if (!settings) return;
    setCheckingRuntime(true);
    setActiveDownload(undefined);
    setRuntimeActivity(undefined);
    setModelActivity(t('runtimeDownloading'));
    pushStatus(t('runtimeDownloading'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: settings.allowWhisperAssetDownload,
        preferCuda: settings.localWhisperUseCuda,
        downloadScope: 'model'
      });
      setRuntimeStatus(status);
      const nextMessage = status.model.verified ? t('modelReady') : (status.message ?? t('runtimeError'));
      setModelActivity(nextMessage);
      pushStatus(nextMessage, status.model.verified ? 'success' : 'warning');
      await refreshModels();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setActiveDownload(undefined);
      setModelActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
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
      const healthMessage =
        providerId === 'local.whisper.cpp' && !health.ok
          ? t('downloadWhisperPrompt')
          : health.message ?? t(providerStatusLabel(health.status));
      pushStatus(healthMessage, health.ok ? 'success' : 'warning');
    } catch (error) {
      pushStatus(error instanceof Error ? error.message : String(error), 'error');
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
      pushStatus(error instanceof Error ? error.message : String(error), 'error');
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
      pushStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exportSrt(): Promise<void> {
    if (!job?.subtitleDocument || !exportPath.trim()) return;
    setBusy(true);
    try {
      await window.translateTer.exportSrt(job.subtitleDocument, exportPath.trim(), exportVariant, bilingualOrder);
      pushStatus(t('exported'), 'success');
    } catch (error) {
      pushStatus(error instanceof Error ? error.message : String(error), 'error');
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
    pushStatus(t('providerSaved'), 'success');
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
  const exportDockVisible = job?.step === 'export';
  const jobIsRunning = Boolean(
    job && !['idle', 'completed', 'failed', 'cancelled'].includes(job.stage)
  );
  const appWorking = busy || checkingRuntime || Boolean(checkingProvider) || jobIsRunning;
  const workingMessage = runtimeActivity ?? modelActivity ?? message;
  const downloadPercent =
    activeDownload?.totalBytes && activeDownload.totalBytes > 0
      ? Math.min(100, Math.round((activeDownload.receivedBytes / activeDownload.totalBytes) * 100))
      : undefined;
  const footerProgress = activeDownload ? (downloadPercent ?? 100) : completion;
  const footerTitle = activeDownload
    ? `${t('downloadProgress')}${downloadPercent === undefined ? '' : ` ${downloadPercent}%`}`
    : `${t('progress')} ${completion}%`;
  const footerMessage = activeDownload?.message ?? message;

  async function forceStop(): Promise<void> {
    if (!job) return;
    setBusy(false);
    await window.translateTer.jobs.cancel(job.id);
    setJob(await window.translateTer.jobs.get(job.id));
    pushStatus(t('stopped'), 'warning');
  }

  function pushStatus(nextMessage: string, tone: ToastTone = 'neutral'): void {
    setMessage(nextMessage);
    pushToast(nextMessage, tone);
  }

  function pushToast(nextMessage: string, tone: ToastTone = 'neutral'): void {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current.slice(-3), { id, message: nextMessage, tone, exiting: false }]);
    window.setTimeout(() => {
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 360);
    }, 4200);
  }

  async function copyToastMessage(toast: ToastMessage): Promise<void> {
    if (toast.tone !== 'error') return;
    try {
      await navigator.clipboard.writeText(toast.message);
      showCopyBubble(t('copiedToClipboard'));
    } catch {
      showCopyBubble(t('copyFailed'));
    }
  }

  function showCopyBubble(nextMessage: string): void {
    setCopyBubble(nextMessage);
    window.setTimeout(() => setCopyBubble(undefined), 1800);
  }

  if (!settings) return <div className="boot">Translate-Ter</div>;

  return (
    <div className={`appShell${appWorking ? ' isWorking' : ''}`}>
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
            <button
              className="summaryToggle"
              title={statsCollapsed ? t('expandSummary') : t('collapseSummary')}
              onClick={() => setStatsCollapsed((current) => !current)}
            >
              {statsCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
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

          <main
            className={`workspaceLayout${statsCollapsed ? ' statsCollapsed' : ''}${
              exportDockVisible ? ' exportVisible' : ''
            }`}
          >
            {!statsCollapsed && (
              <aside className="statsRail">
                <div className="railContent">
                  <div className="railHeader">
                    <strong>{t('workflowSummary')}</strong>
                    <span>{t(stageLabel(job?.stage ?? 'idle'))}</span>
                  </div>
                  <div className="railMetrics">
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
                  </div>
                  <div className="railStatusStack">
                    <div className="railNote">
                      <span className={`signal ${llmHealth?.ok ? 'good' : llmHealth ? 'warn' : ''}`} />
                      <div>
                        <strong>{providerLabel(translationProviderId, t)}</strong>
                        <small>
                          {llmHealth ? t(providerStatusLabel(llmHealth.status)) : t('translationProviderDetail')}
                        </small>
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
                </div>
              </aside>
            )}

            <section className="workspaceMain">
              <section className="jobOverview" aria-label={t('currentJob')}>
                <div className="workspaceHero">
                  <div className="jobFocusPanel">
                    <div className="jobMediaCard">
                      <span className="fieldLabel">{t('mediaFile')}</span>
                      <strong title={jobTitle}>{jobTitle}</strong>
                      <small title={selectedMediaPath}>{selectedMediaPath || t('placeholderPath')}</small>
                    </div>

                    <div className="jobProgressCard">
                      <div className="progressHeader">
                        <span className="stageBadge">{t(stageLabel(job?.stage ?? 'idle'))}</span>
                        <strong>{completion}%</strong>
                      </div>
                      <div className={`track${appWorking ? ' active' : ''}`}>
                        <span style={{ width: `${completion}%` }} />
                      </div>
                      {appWorking ? (
                        <WorkingRibbon message={workingMessage} />
                      ) : (
                        <small title={message}>{message}</small>
                      )}
                    </div>
                  </div>

                  <div className="jobActionCard">
                    <span className="fieldLabel">{t('currentJob')}</span>
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
                        <span className="rowStart">{t('start')}</span>
                        <span className="rowEnd">{t('end')}</span>
                        <span className="rowOriginal">{t('original')}</span>
                        <span className="rowTranslated">{t('translated')}</span>
                        <span className="rowStatus">{t('status')}</span>
                      </div>
                      {job.subtitleDocument.segments.map((segment) => (
                        <button
                          type="button"
                          className={segment.id === selectedSegment?.id ? 'row selectable selected' : 'row selectable'}
                          key={segment.id}
                          onClick={() => setSelectedSegmentId(segment.id)}
                        >
                          <span className="rowStart">{formatTimestamp(segment.startMs)}</span>
                          <span className="rowEnd">{formatTimestamp(segment.endMs)}</span>
                          <div className="previewText rowOriginal">{segment.sourceText}</div>
                          <div className="previewText translatedPreview rowTranslated">
                            {segment.translatedText ?? ''}
                          </div>
                          <span className={`status rowStatus ${segment.status}`}>{t(statusLabel(segment.status))}</span>
                        </button>
                      ))}
                    </div>
                    {selectedSegment && (
                      <div className="segmentDetail">
                        <div className="segmentDetailHero">
                          <div className="segmentTitleStack">
                            <span className="fieldLabel">{t('segmentDetails')}</span>
                            <h3>
                              <span className="segmentIndexBadge">#{selectedSegment.index}</span>
                            </h3>
                            <p>
                              {formatTimestamp(selectedSegment.startMs)} - {formatTimestamp(selectedSegment.endMs)}
                            </p>
                          </div>
                          <span className={`status ${selectedSegment.status}`}>
                            {t(statusLabel(selectedSegment.status))}
                          </span>
                        </div>
                        <div className="segmentDetailMeta">
                          <span className="metaPill">
                            {t('start')} {formatTimestamp(selectedSegment.startMs)}
                          </span>
                          <span className="metaPill">
                            {t('end')} {formatTimestamp(selectedSegment.endMs)}
                          </span>
                        </div>
                        <div className="editorGrid">
                          <div className="editorPane">
                            <label>
                              <div className="editorPaneHeader">
                                <span>{t('original')}</span>
                                <small>{selectedSegment.sourceText.length}</small>
                              </div>
                              <textarea
                                aria-label={`${t('original')} ${selectedSegment.index}`}
                                value={selectedSegment.sourceText}
                                onChange={(event) =>
                                  void updateSegment(selectedSegment, { sourceText: event.target.value })
                                }
                              />
                            </label>
                          </div>
                          <div className="editorPane translatedPane">
                            <label>
                              <div className="editorPaneHeader">
                                <span>{t('translated')}</span>
                                <small>{(selectedSegment.translatedText ?? '').length}</small>
                              </div>
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
                <div className="exportGroup">
                  <span className="fieldLabel">{t('export')}</span>
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
                </div>
                {exportVariant === 'bilingual' && (
                  <div className="exportGroup">
                    <span className="fieldLabel">{t('bilingual')}</span>
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
                  </div>
                )}
                <label className="exportGroup">
                  {t('exportPath')}
                  <input
                    value={exportPath}
                    placeholder={t('exportPath')}
                    onChange={(event) => setExportPath(event.target.value)}
                  />
                </label>
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
                  <InspectorSection icon={<MonitorCog size={16} />} title={t('asr')}>
                    <div className="settingsSubsection">
                      <SectionTitle icon={<MonitorCog size={15} />} title={t('asrProvider')} />
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
                        detail={t(
                          asrProviders.find((provider) => provider.id === settings.asrProviderId)?.descriptionKey ??
                            'providerReady'
                        )}
                        health={asrHealth}
                        loading={checkingProvider === settings.asrProviderId}
                        onTest={() => void testProvider(settings.asrProviderId)}
                        showMessage={settings.asrProviderId !== 'local.whisper.cpp'}
                      />
                    </div>
                    {settings.asrProviderId === 'local.whisper.cpp' && (
                      <>
                        <div className="settingsSubsection">
                          <SectionTitle icon={<Gauge size={15} />} title={t('cudaAcceleration')} />
                          <div className="modelCard accentCard">
                            <div>
                              <span className={supportsCuda ? 'signal good' : 'signal'} />
                              <strong>{t('cudaAcceleration')}</strong>
                              <small>{supportsCuda ? t('cudaDetected') : t('cudaUnavailable')}</small>
                            </div>
                            <button
                              className="secondary compact"
                              disabled={checkingRuntime || !settings.allowWhisperAssetDownload}
                              onClick={() => void checkCudaRuntime()}
                            >
                              <HardDriveDownload size={16} />
                              {checkingRuntime ? t('checking') : t('checkCudaRuntime')}
                            </button>
                            <ToggleField
                              label={t('useCudaAcceleration')}
                              detail={t('useCudaAccelerationDetail')}
                              checked={settings.localWhisperUseCuda}
                              disabled={!supportsCuda}
                              onChange={(checked) => void updateSettings({ localWhisperUseCuda: checked })}
                            />
                          </div>
                        </div>
                        <div className="settingsSubsection">
                          <SectionTitle icon={<HardDriveDownload size={15} />} title={t('whisperModel')} />
                          <ToggleField
                            label={t('allowWhisperDownloads')}
                            detail={t('allowWhisperDownloadsDetail')}
                            checked={settings.allowWhisperAssetDownload}
                            onChange={(checked) => void updateSettings({ allowWhisperAssetDownload: checked })}
                          />
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
                          <div className="modelCard">
                            <div>
                              <span className={selectedModel?.installed ? 'signal good' : 'signal'} />
                              <strong>{selectedModel?.displayName ?? t('whisperModel')}</strong>
                              <small>{selectedModel ? formatBytes(selectedModel.sizeBytes) : t('missing')}</small>
                            </div>
                            {!selectedModel?.installed && (
                              <button
                                className="secondary compact"
                                disabled={checkingRuntime || !settings.allowWhisperAssetDownload}
                                onClick={() => void downloadSelectedModel()}
                              >
                                <HardDriveDownload size={16} />
                                {checkingRuntime ? t('checking') : t('downloadModel')}
                              </button>
                            )}
                            {runtimeStatus && (
                              <p title={runtimeStatus.acceleration.fallbackReason}>
                                {t(runtimeActionLabel(runtimeStatus.actionRequired))}
                                {' · '}
                                {t('runtimeModel')}: {runtimeStatus.model.verified ? t('installed') : t('missing')}
                              </p>
                            )}
                            {modelActivity && <p title={modelActivity}>{modelActivity}</p>}
                          </div>
                        </div>
                      </>
                    )}
                    {settings.asrProviderId === 'cloud.openai' && (
                      <div className="settingsSubsection">
                        <SectionTitle icon={<KeyRound size={15} />} title={t('providerConfig')} />
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
                      </div>
                    )}
                  </InspectorSection>
                </section>

                <section className="settingsPanel">
                  <InspectorSection icon={<Languages size={16} />} title={t('translate')}>
                    <div className="settingsSubsection">
                      <SectionTitle icon={<Languages size={15} />} title={t('translationProvider')} />
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
                    </div>
                    {translationProviderId === 'openai.compatible' && (
                      <>
                        <div className="settingsSubsection">
                          <SectionTitle icon={<KeyRound size={15} />} title={t('providerConfig')} />
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
                        </div>
                        <div className="settingsSubsection">
                          <SectionTitle icon={<SlidersHorizontal size={15} />} title={t('translationRateLimits')} />
                          <div className="settingsFieldGrid">
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
                          </div>
                        </div>
                        <div className="settingsSubsection">
                          <SectionTitle icon={<ListChecks size={15} />} title={t('translationBatching')} />
                          <div className="settingsFieldGrid">
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
                          </div>
                        </div>
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
        <div className="systemProgress">
          <span className={appWorking ? 'systemPulse active' : 'systemPulse'} />
          <div className="systemProgressCopy">
            <strong>{footerTitle}</strong>
            <span title={footerMessage}>{footerMessage}</span>
          </div>
          <div className={`systemMiniTrack${activeDownload && downloadPercent === undefined ? ' indeterminate' : ''}`} aria-hidden="true">
            <span style={{ width: `${footerProgress}%` }} />
          </div>
        </div>
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
      <ToastStack toasts={toasts} copyTitle={t('copyErrorToast')} onCopyError={(toast) => void copyToastMessage(toast)} />
      <BottomBubble message={copyBubble} />
    </div>
  );
}

function WorkingRibbon(props: { message: string }): JSX.Element {
  return (
    <div className="workingRibbon" role="status" aria-live="polite">
      <span className="workingOrb" />
      <span title={props.message}>{props.message}</span>
    </div>
  );
}

function ToastStack(props: {
  toasts: ToastMessage[];
  copyTitle: string;
  onCopyError: (toast: ToastMessage) => void;
}): JSX.Element | null {
  if (props.toasts.length === 0) return null;
  return (
    <div className="toastStack" aria-live="polite" aria-atomic="false">
      {[...props.toasts].reverse().map((toast) =>
        toast.tone === 'error' ? (
          <button
            className={`toastCard copyable ${toast.tone}${toast.exiting ? ' exiting' : ''}`}
            key={toast.id}
            title={props.copyTitle}
            type="button"
            onClick={() => props.onCopyError(toast)}
          >
            <span className="toastMark" />
            <p>{toast.message}</p>
          </button>
        ) : (
          <div className={`toastCard ${toast.tone}${toast.exiting ? ' exiting' : ''}`} key={toast.id}>
            <span className="toastMark" />
            <p>{toast.message}</p>
          </div>
        )
      )}
    </div>
  );
}

function BottomBubble(props: { message?: string }): JSX.Element | null {
  if (!props.message) return null;
  return <div className="bottomBubble">{props.message}</div>;
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

function SectionTitle(props: { icon: React.ReactNode; title: string }): JSX.Element {
  return (
    <div className="sectionTitle">
      {props.icon}
      <strong>{props.title}</strong>
    </div>
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
  showMessage?: boolean;
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
      {props.showMessage !== false && props.health?.message && <p title={props.health.message}>{props.health.message}</p>}
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

function assetEventLabel(event: AssetEvent, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (event.type) {
    case 'download-start':
      return t('runtimeDownloading');
    case 'download-progress':
      return event.receivedBytes
        ? t('runtimeDownloadingBytes', { bytes: formatBytes(event.receivedBytes) })
        : t('runtimeDownloading');
    case 'verify':
      return t('runtimeVerifying');
    case 'extract':
      return t('runtimeExtracting');
    case 'ready':
      return t('runtimeReady');
    case 'error':
      return event.message || t('runtimeError');
  }
}

function toastToneForAssetEvent(event: AssetEvent): ToastTone {
  switch (event.type) {
    case 'ready':
      return 'success';
    case 'error':
      return 'error';
    case 'verify':
    case 'extract':
      return 'warning';
    case 'download-start':
    case 'download-progress':
    default:
      return 'neutral';
  }
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
