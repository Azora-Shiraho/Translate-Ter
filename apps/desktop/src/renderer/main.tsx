import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileVideo,
  FolderOpen,
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
  ExportDestinationMode,
  ExportVariant,
  JobSnapshot,
  NativeHealth,
  ProviderHealth,
  ProviderSecretInput,
  SubtitleSegment,
  SubtitleStatus,
  SubtitleWarning,
  WhisperModelInfo,
  WhisperRuntimeStatus
} from '@shared/types';
import type { AssetEvent, JobStage } from '@shared/models';
import { formatTimestamp } from '@shared/srt';
import { languageLabel, languageRegistry } from '@shared/languages';

const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;
const translationProviders = ['openai.compatible'] as const;

type AppView = 'workspace' | 'settings';
type RunningAction = 'transcribe' | 'translate' | 'export';
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
type HealthTone = 'good' | 'warn' | 'error' | 'muted';
type DerivedHealthState = {
  tone: HealthTone;
  label: string;
  detail: string;
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
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [warningPanelOpen, setWarningPanelOpen] = useState(false);
  const [selectedWarningId, setSelectedWarningId] = useState<string>();
  const [message, setMessage] = useState(t('ready'));
  const [runtimeActivity, setRuntimeActivity] = useState<string>();
  const [modelActivity, setModelActivity] = useState<string>();
  const [activeDownload, setActiveDownload] = useState<ActiveDownload>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [copyBubble, setCopyBubble] = useState<string>();
  const [runningAction, setRunningAction] = useState<RunningAction>();
  const [exportingVariant, setExportingVariant] = useState<ExportVariant>();
  const [busy, setBusy] = useState(false);
  const [runtimeOperation, setRuntimeOperation] = useState<'cuda' | 'model'>();
  const [checkingProvider, setCheckingProvider] = useState<string>();
  const actionTokenRef = useRef(0);

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
      const initialRuntimeStatus = nextSettings.asrProviderId === 'local.whisper.cpp'
        ? await window.translateTer.assets.ensureWhisperRuntime({
            modelId: nextSettings.whisperModelId,
            allowDownload: false,
            preferCuda: nextSettings.localWhisperUseCuda,
            ignoreCudaMismatch: nextSettings.localWhisperIgnoreCudaMismatch,
            useMultiThreadDownload: nextSettings.enableMultiThreadDownload,
            downloadScope: 'none'
          }).catch(() => undefined)
        : undefined;
      if (initialRuntimeStatus) {
        setRuntimeStatus(initialRuntimeStatus);
        syncLocalWhisperHealth(initialRuntimeStatus);
      }
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

  const workflowWarnings = useMemo(() => deriveWorkflowWarnings(job), [job]);

  useEffect(() => {
    if (!workflowWarnings.length) {
      setWarningPanelOpen(false);
      setSelectedWarningId(undefined);
      return;
    }

    setSelectedWarningId((current) =>
      current && workflowWarnings.some((warning) => warning.id === current)
        ? current
        : workflowWarnings[0]?.id
    );
  }, [workflowWarnings]);

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
    setRuntimeOperation('cuda');
    setActiveDownload(undefined);
    setRuntimeActivity(t('runtimeChecking'));
    setModelActivity(undefined);
    pushStatus(t('runtimeChecking'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: true,
        ignoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
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
      setRuntimeOperation(undefined);
    }
  }

  async function downloadSelectedModel(): Promise<void> {
    if (!settings) return;
    setRuntimeOperation('model');
    setActiveDownload(undefined);
    setRuntimeActivity(undefined);
    setModelActivity(t('runtimeDownloading'));
    pushStatus(t('runtimeDownloading'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: settings.localWhisperUseCuda,
        ignoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'model'
      });
      setRuntimeStatus(status);
      syncLocalWhisperHealth(status);
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
      setRuntimeOperation(undefined);
    }
  }

  async function testProvider(providerId: string): Promise<void> {
    setCheckingProvider(providerId);
    try {
      if (providerId === 'local.whisper.cpp' && settings) {
        const nextRuntimeStatus = await window.translateTer.assets.ensureWhisperRuntime({
          modelId: settings.whisperModelId,
          allowDownload: true,
          preferCuda: settings.localWhisperUseCuda,
          ignoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
          useMultiThreadDownload: settings.enableMultiThreadDownload,
          downloadScope: 'runtime'
        });
        setRuntimeStatus(nextRuntimeStatus);
        syncLocalWhisperHealth(nextRuntimeStatus);
        pushStatus(describeLocalWhisperTestResult(nextRuntimeStatus, t), nextRuntimeStatus.binary.verified ? 'success' : 'warning');
        return;
      }

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
    const token = beginAction('transcribe');
    try {
      const nextJob = await window.translateTer.startTranscription({
        mediaPath: mediaPath.trim(),
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        localWhisperUseCuda: settings.localWhisperUseCuda,
        localWhisperIgnoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
        allowWhisperAssetDownload: settings.allowWhisperAssetDownload,
        allowCloudAsrUpload: settings.allowCloudAsrUpload,
        translationProviderPriority: settings.translationProviderPriority,
        translationConcurrency: settings.translationConcurrency,
        translationRequestsPerMinute: settings.translationRequestsPerMinute,
        translationTokenBudgetPerMinute: settings.translationTokenBudgetPerMinute,
        translationLinesPerRequest: settings.translationLinesPerRequest,
        translationBatchStride: settings.translationBatchStride
      });
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) pushStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      endAction(token);
    }
  }

  async function translateJob(): Promise<void> {
    if (!job) return;
    const token = beginAction('translate');
    try {
      const nextJob = await window.translateTer.startTranslation(job.id);
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) pushStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      endAction(token);
    }
  }

  async function exportSrt(variant: ExportVariant): Promise<void> {
    if (!job?.subtitleDocument) return;
    const token = beginAction('export', variant);
    try {
      const result = await window.translateTer.exportConfiguredSrt(job.subtitleDocument, job.mediaPath, variant);
      if (isCurrentAction(token) && !result.cancelled) pushStatus(t('exported'), 'success');
    } catch (error) {
      if (isCurrentAction(token)) pushStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      endAction(token);
    }
  }

  async function pickExportDirectory(): Promise<void> {
    const selected = await window.translateTer.selectDirectory();
    if (selected) await updateSettings({ exportDirectory: selected, exportDestinationMode: 'selected-directory' });
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
  const warningCount = workflowWarnings.length;
  const sourceLabel = settings ? languageLabel(settings.sourceLanguage, settings.uiLanguage) : '';
  const targetLabel = settings ? languageLabel(settings.targetLanguage, settings.uiLanguage) : '';
  const translationProviderId = settings?.translationProviderPriority[0] ?? 'openai.compatible';
  const supportsCuda = Boolean(nativeHealth?.cudaSupported || runtimeStatus?.acceleration.cudaSupported);
  const cudaStatusDetail = describeCudaStatusDetail(runtimeStatus, t);
  const cudaStatusShort = describeCudaStatusShort(runtimeStatus, t);
  const cudaMismatchDetected = Boolean(runtimeStatus && /requires CUDA 12\.8\+/i.test(`${runtimeStatus.message ?? ''} ${runtimeStatus.acceleration.fallbackReason ?? ''}`));
  const llmHealth = providerHealth[translationProviderId];
  const asrHealth = providerHealth[settings?.asrProviderId ?? 'local.whisper.cpp'];
  const cloudAsrSecret = providerSecrets['cloud.openai'] ?? {};
  const llmSecret = providerSecrets['openai.compatible'] ?? {};
  const canForceStop = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.stage));
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0];
  const selectedWarning = workflowWarnings.find((warning) => warning.id === selectedWarningId) ?? workflowWarnings[0];
  const selectedMediaPath = job?.mediaPath ?? mediaPath.trim();
  const selectedMediaFileName =
    job?.fileName ?? selectedMediaPath.split(/[\\/]/).filter(Boolean).at(-1) ?? t('chooseMedia');
  const jobTitle = selectedMediaFileName;
  const jobIsRunning = Boolean(
    job && !['idle', 'completed', 'failed', 'cancelled'].includes(job.stage)
  );
  const transcribingStages: JobStage[] = ['checking-runtime', 'probing', 'extracting-audio', 'transcribing'];
  const isTranscribing = runningAction === 'transcribe' || Boolean(job && transcribingStages.includes(job.stage));
  const isTranslating = runningAction === 'translate' || job?.stage === 'translating';
  const runningStep = isTranscribing ? 'asr' : isTranslating ? 'translate' : undefined;
  const failedStep = job?.stage === 'failed' ? job.step : undefined;
  const appWorking = busy || Boolean(runtimeOperation) || Boolean(checkingProvider) || jobIsRunning;
  const hasRecognizedSubtitles = Boolean(job?.subtitleDocument?.segments.length);
  const translationComplete = hasRecognizedSubtitles && translatedCount === segments.length && segments.length > 0;
  const canExportTranslated = translationComplete && !busy;
  const canExportSource = hasRecognizedSubtitles && !busy;
  const canExportBilingual = translationComplete && !busy;
  const downloadPercent =
    activeDownload?.totalBytes && activeDownload.totalBytes > 0
      ? Math.min(100, Math.round((activeDownload.receivedBytes / activeDownload.totalBytes) * 100))
      : undefined;
  const footerProgress = activeDownload ? (downloadPercent ?? 100) : completion;
  const footerTitle = activeDownload
    ? `${t('downloadProgress')}${downloadPercent === undefined ? '' : ` ${downloadPercent}%`}`
    : `${t('progress')} ${completion}%`;
  const footerMessage = activeDownload?.message ?? message;
  const runtimeState = deriveRuntimeState({
    t,
    runtimeStatus,
    selectedModel,
    asrProviderId: settings?.asrProviderId ?? 'local.whisper.cpp',
    job
  });
  const translationState = deriveTranslationState({
    t,
    providerId: translationProviderId,
    health: llmHealth,
    job
  });

  async function forceStop(): Promise<void> {
    if (!job) return;
    invalidateActiveAction();
    setActiveDownload(undefined);
    await window.translateTer.jobs.cancel(job.id);
    setJob(await window.translateTer.jobs.get(job.id));
    pushStatus(t('stopped'), 'warning');
  }

  function beginAction(action: RunningAction, exporting?: ExportVariant): number {
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setBusy(true);
    setRunningAction(action);
    setExportingVariant(exporting);
    return token;
  }

  function endAction(token: number): void {
    if (!isCurrentAction(token)) return;
    setExportingVariant(undefined);
    setRunningAction(undefined);
    setBusy(false);
  }

  function isCurrentAction(token: number): boolean {
    return actionTokenRef.current === token;
  }

  function invalidateActiveAction(): void {
    actionTokenRef.current += 1;
    setExportingVariant(undefined);
    setRunningAction(undefined);
    setBusy(false);
  }

  function syncLocalWhisperHealth(status: WhisperRuntimeStatus): void {
    const ok = status.binary.verified && status.model.verified;
    setProviderHealth((current) => ({
      ...current,
      'local.whisper.cpp': {
        providerId: 'local.whisper.cpp',
        ok,
        status: ok ? 'healthy' : 'degraded',
        message: status.message
      }
    }));
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
                  [
                    'workflowStep',
                    index < currentStepIndex ? 'done' : '',
                    index === currentStepIndex ? 'active' : '',
                    runningStep === step ? 'running' : '',
                    failedStep === step ? 'failed' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')
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
            className={`workspaceLayout${statsCollapsed ? ' statsCollapsed' : ''}`}
          >
            {!statsCollapsed && (
              <aside className="statsRail">
                <div className="railContent">
                  <div className="railHeader">
                    <strong>{t('workflowSummary')}</strong>
                  </div>
                  <div className="railMetrics">
                    <MetricCard
                      icon={<ShieldCheck size={16} />}
                      label={t('translatedRows')}
                      value={`${translatedCount}/${segments.length}`}
                    />
                    <MetricCard
                      icon={<AlertCircle size={16} />}
                      label={t('warnings')}
                      value={String(warningCount)}
                      active={warningCount > 0 && warningPanelOpen}
                      onClick={
                        warningCount > 0
                          ? () => {
                              setWarningPanelOpen((current) => {
                                const next = !current;
                                if (next) {
                                  setSelectedWarningId((warningId) => warningId ?? workflowWarnings[0]?.id);
                                }
                                return next;
                              });
                            }
                          : undefined
                      }
                    />
                  </div>
                  {warningPanelOpen && workflowWarnings.length > 0 && selectedWarning && (
                    <div className="warningPanel">
                      <div className="warningPanelHeader">
                        <strong>{t('warningDetails')}</strong>
                        <small>{t('warningFallbackHint')}</small>
                      </div>
                      <div className="warningList" role="list">
                        {workflowWarnings.map((warning) => (
                          <button
                            className={`warningItem${selectedWarning.id === warning.id ? ' active' : ''}`}
                            key={warning.id}
                            onClick={() => setSelectedWarningId(warning.id)}
                            type="button"
                          >
                            <span className="signal warn" />
                            <div>
                              <strong>{warningSummaryLabel(warning, t)}</strong>
                              <small>{warning.message}</small>
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="warningDetailCard">
                        <div className="warningDetailTitle">
                          <span className="signal warn" />
                          <div>
                            <strong>{warningSummaryLabel(selectedWarning, t)}</strong>
                            <small>{selectedWarning.message}</small>
                          </div>
                        </div>
                        <div className="warningMetaGrid">
                          <div className="warningMetaCard">
                            <span>{t('warningSegmentRange')}</span>
                            <strong className="warn">{formatWarningSegmentRange(selectedWarning)}</strong>
                          </div>
                          <div className="warningMetaCard">
                            <span>{t('warningTimeline')}</span>
                            <strong className="warn">{formatWarningTimeline(selectedWarning)}</strong>
                          </div>
                          <div className="warningMetaCard">
                            <span>{t('warningGeneratedAt')}</span>
                            <strong className="muted">{formatWarningDate(selectedWarning.createdAt)}</strong>
                          </div>
                          <div className="warningMetaCard">
                            <span>{t('warningProvider')}</span>
                            <strong className="muted">
                              {providerLabel(selectedWarning.providerId ?? translationProviderId, t)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="railStatusStack">
                    <div className="railNote">
                      <span className={`signal ${translationState.tone}`} />
                      <div>
                        <strong>{providerLabel(translationProviderId, t)}</strong>
                        <small>{translationState.detail}</small>
                      </div>
                    </div>
                    <div className="railNote">
                      <span className={`signal ${runtimeState.tone}`} />
                      <div>
                        <strong>{t('runtime')}</strong>
                        <small>{runtimeState.detail}</small>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            )}

            <section className="workspaceMain">
              <section className="workspaceHero" aria-label={t('currentJob')}>
                <div className="jobMediaCard">
                  <span className="fieldLabel">{t('mediaFile')}</span>
                  <strong title={jobTitle}>{jobTitle}</strong>
                  <div className="jobMediaMeta">
                    <span className="stageBadge">{t(stageLabel(job?.stage ?? 'idle'))}</span>
                    <span className="metaPill">{`${sourceLabel} -> ${targetLabel}`}</span>
                  </div>
                </div>

                <div className="jobActionCard">
                  <span className="fieldLabel">{t('currentJob')}</span>
                  <button className="secondary" onClick={() => void pickMedia()}>
                    <FileVideo size={16} />
                    {t('chooseMedia')}
                  </button>
                  <button
                    className={hasRecognizedSubtitles ? 'secondary' : 'primary'}
                    disabled={busy || !mediaPath.trim()}
                    onClick={() => void createAndStart()}
                  >
                    {runningAction === 'transcribe' ? (
                      <InlineDots />
                    ) : (
                      <>
                        <Play size={16} />
                        {t('startTranscription')}
                      </>
                    )}
                  </button>
                  <button
                    className={hasRecognizedSubtitles && !translationComplete ? 'primary' : 'secondary'}
                    disabled={busy || !job?.subtitleDocument}
                    onClick={() => void translateJob()}
                  >
                    {runningAction === 'translate' ? (
                      <InlineDots />
                    ) : (
                      <>
                        <Languages size={16} />
                        {t('translateSubtitles')}
                      </>
                    )}
                  </button>
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
                          </div>
                          <span className={`status ${selectedSegment.status}`}>
                            {t(statusLabel(selectedSegment.status))}
                          </span>
                        </div>
                        <div className="segmentDetailMeta">
                          <span className="metaPill">{formatTimestamp(selectedSegment.startMs)}</span>
                          <span className="metaPill">{formatTimestamp(selectedSegment.endMs)}</span>
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
                  <ToggleField
                    label={t('multiThreadDownload')}
                    detail={t('multiThreadDownloadDetail')}
                    checked={settings.enableMultiThreadDownload}
                    onChange={(checked) => void updateSettings({ enableMultiThreadDownload: checked })}
                  />
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
                        value={cudaStatusShort}
                        tone={supportsCuda ? 'good' : cudaMismatchDetected ? 'warn' : 'muted'}
                      />
                      <StatusLine
                        label={t('runtimeBinary')}
                        value={runtimeState.label}
                        tone={runtimeState.tone}
                      />
                      <StatusLine
                        label={t('runtimeModel')}
                        value={runtimeState.detail}
                        tone={runtimeState.tone}
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
                    <div className="settingsSubsection">
                      <SectionTitle icon={<Download size={15} />} title={t('exportSettings')} />
                      <div className="segmented three">
                        {(['source-directory', 'selected-directory', 'ask-each-time'] as ExportDestinationMode[]).map(
                          (mode) => (
                            <button
                              className={settings.exportDestinationMode === mode ? 'selected' : ''}
                              key={mode}
                              onClick={() => void updateSettings({ exportDestinationMode: mode })}
                            >
                              {t(exportDestinationModeLabel(mode))}
                            </button>
                          )
                        )}
                      </div>
                      {settings.exportDestinationMode === 'selected-directory' && (
                        <button className="secondary" onClick={() => void pickExportDirectory()}>
                          <FolderOpen size={16} />
                          {settings.exportDirectory || t('chooseFolder')}
                        </button>
                      )}
                      <div className="segmented two">
                        {(['source-first', 'target-first'] as const).map((order) => (
                          <button
                            className={settings.exportBilingualOrder === order ? 'selected' : ''}
                            key={order}
                            onClick={() => void updateSettings({ exportBilingualOrder: order })}
                          >
                            {t(order === 'source-first' ? 'sourceFirst' : 'targetFirst')}
                          </button>
                        ))}
                      </div>
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
                        state={runtimeState}
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
                              <small>{cudaStatusDetail}</small>
                            </div>
                            <button
                              className="secondary compact"
                              disabled={runtimeOperation === 'cuda'}
                              onClick={() => void checkCudaRuntime()}
                            >
                              <HardDriveDownload size={16} />
                              {runtimeOperation === 'cuda' ? t('checking') : t('checkCudaRuntime')}
                            </button>
                            <ToggleField
                              label={t('useCudaAcceleration')}
                              detail={t('useCudaAccelerationDetail')}
                              checked={settings.localWhisperUseCuda}
                              disabled={!supportsCuda && !settings.localWhisperIgnoreCudaMismatch}
                              onChange={(checked) => void updateSettings({ localWhisperUseCuda: checked })}
                            />
                            <ToggleField
                              label={t('ignoreCudaMismatch')}
                              detail={t('ignoreCudaMismatchDetail')}
                              checked={settings.localWhisperIgnoreCudaMismatch}
                              disabled={!cudaMismatchDetected}
                              onChange={(checked) => void updateSettings({ localWhisperIgnoreCudaMismatch: checked })}
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
                                disabled={runtimeOperation === 'model'}
                                onClick={() => void downloadSelectedModel()}
                              >
                                <HardDriveDownload size={16} />
                                {runtimeOperation === 'model' ? t('checking') : t('downloadModel')}
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
                        state={translationState}
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
        <ExportActionGroup
          title={t('export')}
          labels={{
            translated: t('translated'),
            source: t('original'),
            bilingual: t('bilingual')
          }}
          exportingVariant={exportingVariant}
          disabled={{
            translated: !canExportTranslated,
            source: !canExportSource,
            bilingual: !canExportBilingual
          }}
          onExport={(variant) => void exportSrt(variant)}
        />
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

function InlineDots(): JSX.Element {
  return (
    <span className="inlineDots" aria-label="Working">
      <span />
      <span />
      <span />
    </span>
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

function ExportActionGroup(props: {
  title: string;
  labels: Record<ExportVariant, string>;
  exportingVariant?: ExportVariant;
  disabled: Record<ExportVariant, boolean>;
  onExport: (variant: ExportVariant) => void;
}): JSX.Element {
  const variants: ExportVariant[] = ['translated', 'source', 'bilingual'];
  return (
    <div className="exportActionGroup" aria-label={props.title}>
      <span>{props.title}</span>
      <div className="exportActions">
        {variants.map((variant) => (
          <button
            className="exportButton"
            disabled={props.disabled[variant]}
            key={variant}
            onClick={() => props.onExport(variant)}
          >
            {props.exportingVariant === variant ? <InlineDots /> : props.labels[variant]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      {props.icon}
      <span>{props.label}</span>
      <strong title={props.value}>{props.value}</strong>
    </>
  );
  if (props.onClick) {
    return (
      <button className={`metricCard metricButton${props.active ? ' active' : ''}`} onClick={props.onClick} type="button">
        {content}
      </button>
    );
  }
  return <div className="metricCard">{content}</div>;
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
  state?: DerivedHealthState;
  loading: boolean;
  onTest: () => void;
  showMessage?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const tone = props.state?.tone ?? (props.health?.ok ? 'good' : props.health ? 'warn' : 'muted');
  const summary = props.state?.detail ?? (props.health ? t(providerStatusLabel(props.health.status)) : props.detail);
  return (
    <div className="providerCard">
      <div>
        <span className={`signal ${tone}`} />
        <strong title={props.activeId}>{providerLabel(props.activeId, t)}</strong>
        <small>{summary}</small>
      </div>
      <button className="secondary compact" disabled={props.loading} onClick={props.onTest}>
        <CheckCircle2 size={16} />
        {props.loading ? t('checking') : t('test')}
      </button>
      {props.showMessage !== false && props.health?.message && <p title={props.health.message}>{props.health.message}</p>}
    </div>
  );
}

function StatusLine(props: { label: string; value: string; tone: HealthTone }): JSX.Element {
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

function exportDestinationModeLabel(mode: ExportDestinationMode): string {
  return `exportDestination.${mode}`;
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

function describeLocalWhisperTestResult(status: WhisperRuntimeStatus, t: (key: string) => string): string {
  if (!status.binary.verified) {
    return status.message ?? t('downloadWhisperPrompt');
  }
  if (!status.model.verified) {
    return t('modelReadyPending');
  }
  if (status.acceleration.requested === 'gpu') {
    return describeCudaStatusDetail(status, t);
  }
  return status.message ?? t('providerReady');
}

function describeCudaStatusDetail(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string
): string {
  if (!status) return t('runtimeNotChecked');
  if (status.acceleration.cudaSupported) return t('cudaDetected');

  const combined = `${status.message ?? ''} ${status.acceleration.fallbackReason ?? ''}`;
  if (/requires CUDA 12\.8\+/i.test(combined)) {
    return t('cudaRuntimeMismatch');
  }
  if (/required CUDA runtime DLLs/i.test(combined)) {
    return t('cudaRuntimeMissing');
  }
  if (/no supported NVIDIA runtime was detected/i.test(combined)) {
    return t('cudaNoHardware');
  }
  return status.message ?? status.acceleration.fallbackReason ?? t('cudaUnavailable');
}

function describeCudaStatusShort(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string
): string {
  if (!status) return t('notChecked');
  if (status.acceleration.cudaSupported) return t('cudaDetectedShort');
  const combined = `${status.message ?? ''} ${status.acceleration.fallbackReason ?? ''}`;
  if (/requires CUDA 12\.8\+/i.test(combined)) return t('versionMismatchShort');
  if (/required CUDA runtime DLLs/i.test(combined)) return t('missingRuntimeShort');
  if (/no supported NVIDIA runtime was detected/i.test(combined)) return t('cudaUnavailableShort');
  return t('cudaUnavailableShort');
}

function deriveWorkflowWarnings(job?: JobSnapshot): SubtitleWarning[] {
  if (!job) return [];

  const segments = job.subtitleDocument?.segments ?? [];
  const warnings = [...(job.warnings ?? []), ...(job.subtitleDocument?.metadata.warnings ?? [])];
  const seen = new Set<string>();

  return warnings
    .map((warning, index) => enrichWarning(warning, segments, index))
    .filter((warning) => {
      const key = [
        warning.id ?? '',
        warning.code,
        warning.message,
        warning.segmentId ?? '',
        warning.startIndex ?? '',
        warning.endIndex ?? '',
        warning.startMs ?? '',
        warning.endMs ?? ''
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function enrichWarning(warning: SubtitleWarning, segments: SubtitleSegment[], index: number): SubtitleWarning {
  if (warning.startIndex && warning.endIndex && warning.startMs !== undefined && warning.endMs !== undefined) {
    return { ...warning, id: warning.id ?? `warning-${index}` };
  }

  const segment = warning.segmentId ? segments.find((item) => item.id === warning.segmentId) : undefined;
  return {
    ...warning,
    id: warning.id ?? `warning-${index}`,
    startIndex: warning.startIndex ?? segment?.index,
    endIndex: warning.endIndex ?? segment?.index,
    startMs: warning.startMs ?? segment?.startMs,
    endMs: warning.endMs ?? segment?.endMs
  };
}

function warningSummaryLabel(warning: SubtitleWarning, t: (key: string) => string): string {
  if (warning.stage === 'translate') return t('warningFallbackSummary');
  return warning.code;
}

function formatWarningSegmentRange(warning: SubtitleWarning): string {
  if (warning.startIndex && warning.endIndex) {
    return warning.startIndex === warning.endIndex
      ? `#${warning.startIndex}`
      : `#${warning.startIndex} - #${warning.endIndex}`;
  }
  return '--';
}

function formatWarningTimeline(warning: SubtitleWarning): string {
  if (warning.startMs !== undefined && warning.endMs !== undefined) {
    return `${formatTimestamp(warning.startMs)} - ${formatTimestamp(warning.endMs)}`;
  }
  return '--';
}

function formatWarningDate(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function deriveTranslationState(input: {
  t: (key: string) => string;
  providerId: string;
  health?: ProviderHealth;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, providerId, health, job } = input;
  if (job?.stage === 'failed' && job.error && job.step === 'translate') {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: t(providerId === 'openai.compatible' ? 'translationProviderNotChecked' : 'notChecked')
    };
  }
  if (health.ok) {
    return {
      tone: 'good',
      label: t(providerStatusLabel(health.status)),
      detail: health.message ?? t('providerReady')
    };
  }
  return {
    tone: health.status === 'degraded' ? 'warn' : 'error',
    label: t(providerStatusLabel(health.status)),
    detail: health.message ?? t(providerStatusLabel(health.status))
  };
}

function deriveRuntimeState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  selectedModel?: WhisperModelInfo;
  asrProviderId: string;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, runtimeStatus, selectedModel, asrProviderId, job } = input;
  if (asrProviderId !== 'local.whisper.cpp') {
    return { tone: 'good', label: t('providerReady'), detail: t('cloudProviderDetail') };
  }
  if (job?.stage === 'failed' && job.error && (job.step === 'asr' || job.step === 'subtitles')) {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  if (!runtimeStatus) {
    return { tone: 'muted', label: t('notChecked'), detail: t('runtimeNotChecked') };
  }
  if (runtimeStatus.binary.verified && runtimeStatus.model.verified) {
    return {
      tone: 'good',
      label: t('installed'),
      detail: runtimeStatus.message ?? `${selectedModel?.displayName ?? 'Whisper'} · ${t('runtimeReady')}`
    };
  }
  const action = t(runtimeActionLabel(runtimeStatus.actionRequired));
  return {
    tone: runtimeStatus.binary.installed || runtimeStatus.model.installed ? 'warn' : 'error',
    label: action,
    detail: runtimeStatus.message ?? `${action} · ${runtimeStatus.acceleration.selected.toUpperCase()}`
  };
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
