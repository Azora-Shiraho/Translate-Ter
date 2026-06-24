import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowUpRight,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  EyeOff,
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
  Search,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react';
import './i18n';
import './styles.css';
import type {
  AppLogLevel,
  AppSettingsPublic,
  ExportDestinationMode,
  SubtitleFileFormat,
  ExportVariant,
  FasterWhisperCudaStatus,
  FfmpegStatus,
  JobSnapshot,
  NativeHealth,
  ProviderHealth,
  ProviderSecretInput,
  SubtitleSegment,
  SubtitleStatus,
  SubtitleWarning,
  WhisperModelInfo,
  WhisperModelStatus,
  WhisperRuntimeStatus
} from '@shared/types';
import type { AssetEvent, JobEvent, JobStage } from '@shared/models';
import { formatTimestamp } from '@shared/srt';
import { languageLabel, languageRegistry } from '@shared/languages';
import {
  buildIgnoreCudaMismatchPatch,
  buildLocalAsrSettingsPatch,
  deriveFasterWhisperWorkspaceMode,
  deriveRuntimeVariantSelection,
  inferRuntimePlatformFamily,
  isExperimentalWhisperRuntimeVariant,
  isCudaFlowRelevant,
  isVerifiedWhisperGpuRuntimeVariant,
  listRuntimeVariantSelections,
  resolveSupportedRuntimeVariantSelection,
  resolveAccelerationForVariantSelection,
  resolveVariantSelectionForAcceleration,
  type RuntimeVariantSelection
} from './asrSettings';

const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;
const translationProviders = ['openai.compatible'] as const;

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
  scope: 'runtime' | 'model' | 'ffmpeg';
  receivedBytes: number;
  totalBytes?: number;
  message: string;
};
type HealthTone = 'good' | 'accent' | 'warn' | 'error' | 'muted';
type DerivedHealthState = {
  tone: HealthTone;
  label: string;
  detail: string;
};
type SettingsJumpTarget = 'asr-provider' | 'ffmpeg' | 'cuda' | 'whisper-model' | 'translation-provider';
type RuntimeStatusRow = {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'error' | 'accent' | 'muted';
};

const asrProviders = [
  { id: 'local.whisper.cpp', nameKey: 'localProvider', descriptionKey: 'localProviderDetail' },
  { id: 'local.faster-whisper', nameKey: 'localProvider', descriptionKey: 'localFasterWhisperProviderDetail' },
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
  const [cudaStatus, setCudaStatus] = useState<WhisperRuntimeStatus>();
  const [fasterWhisperCudaStatus, setFasterWhisperCudaStatus] = useState<FasterWhisperCudaStatus>();
  const [modelStatus, setModelStatus] = useState<WhisperModelStatus>();
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>();
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealth>>({});
  const [providerSecrets, setProviderSecrets] = useState<Record<string, ProviderSecretInput>>({});
  const [job, setJob] = useState<JobSnapshot>();
  const [mediaPath, setMediaPath] = useState('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [warningPanelOpen, setWarningPanelOpen] = useState(false);
  const [selectedWarningId, setSelectedWarningId] = useState<string>();
  const [message, setMessage] = useState(t('ready'));
  const [ffmpegActivity, setFfmpegActivity] = useState<string>();
  const [modelActivity, setModelActivity] = useState<string>();
  const [activeDownload, setActiveDownload] = useState<ActiveDownload>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [copyBubble, setCopyBubble] = useState<string>();
  const [runningAction, setRunningAction] = useState<RunningAction>();
  const [exportingVariant, setExportingVariant] = useState<ExportVariant>();
  const [busy, setBusy] = useState(false);
  const [runtimeOperation, setRuntimeOperation] =
    useState<
      'runtime-download' | 'ffmpeg-check' | 'ffmpeg-download' | 'cuda-check' | 'cuda-download' | 'model-check' | 'model'
    >();
  const [checkingProvider, setCheckingProvider] = useState<string>();
  const [activeSettingsJumpTarget, setActiveSettingsJumpTarget] = useState<SettingsJumpTarget>();
  const actionTokenRef = useRef(0);
  const asrProviderSettingsRef = useRef<HTMLDivElement | null>(null);
  const ffmpegSettingsRef = useRef<HTMLDivElement | null>(null);
  const cudaSettingsRef = useRef<HTMLDivElement | null>(null);
  const whisperModelSettingsRef = useRef<HTMLDivElement | null>(null);
  const translationProviderSettingsRef = useRef<HTMLDivElement | null>(null);
  const settingsJumpResetRef = useRef<number>();
  const hostPlatform = window.translateTer.host.platform;
  const configuredAcceleration = settings?.localAsrAcceleration ?? 'auto';
  const configuredRuntimeVariant = deriveRuntimeVariantSelection(
    configuredAcceleration,
    settings?.preferredRuntimeVariant
  );
  const ignoreCudaMismatch = Boolean(
    settings?.localAsrCompatibilityOverrides?.ignoreCudaMismatch ?? settings?.localWhisperIgnoreCudaMismatch
  );
  const platformFamily = useMemo(
    () =>
      inferRuntimePlatformFamily({
        runtimeStatus,
        hostPlatform,
        nativeHealth
      }),
    [hostPlatform, nativeHealth, runtimeStatus]
  );
  const runtimeVariantSelections = useMemo(
    () =>
      settings
        ? listRuntimeVariantSelections({
            providerId: settings.asrProviderId,
            platformFamily,
            currentVariant: settings.preferredRuntimeVariant
          })
        : [],
    [platformFamily, settings]
  );
  const effectiveRuntimeVariantSelection = useMemo(
    () =>
      resolveSupportedRuntimeVariantSelection(
        configuredAcceleration,
        configuredRuntimeVariant,
        runtimeVariantSelections
      ),
    [configuredAcceleration, configuredRuntimeVariant, runtimeVariantSelections]
  );
  const effectivePreferredRuntimeVariant =
    effectiveRuntimeVariantSelection === 'auto' ? undefined : effectiveRuntimeVariantSelection;
  const mirroredLegacyUseCuda = Boolean(settings?.localWhisperUseCuda);
  const cudaApproved = Boolean(cudaStatus?.acceleration.cudaSupported);
  const fasterWhisperCudaApproved = Boolean(fasterWhisperCudaStatus?.cudaSupported);
  const effectiveLocalWhisperUseCuda = Boolean(
    mirroredLegacyUseCuda &&
      (settings?.asrProviderId === 'local.faster-whisper' ? fasterWhisperCudaApproved : cudaApproved)
  );
  const cudaFlowRelevant = settings
    ? isCudaFlowRelevant(settings.asrProviderId, platformFamily, effectiveRuntimeVariantSelection)
    : false;
  const writeUiLog = useCallback(
    (level: AppLogLevel, event: string, details?: unknown, scope = 'renderer.ui', message?: string) => {
      if (level === 'debug') {
        window.translateTer.logs.debug(event, details, scope, message);
        return;
      }
      if (level === 'info') {
        window.translateTer.logs.info(event, details, scope, message);
        return;
      }
      if (level === 'warning') {
        window.translateTer.logs.warning(event, details, scope, message);
        return;
      }
      window.translateTer.logs.error(event, details, scope, message);
    },
    []
  );
  const reportUiError = useCallback(
    (event: string, error: unknown, details?: Record<string, unknown>, scope = 'renderer.ui'): string => {
      const message = error instanceof Error ? error.message : String(error);
      writeUiLog('error', event, { ...details, error }, scope, message);
      return message;
    },
    [writeUiLog]
  );

  const translateStage = useCallback((stage: JobStage) => i18n.t(stageLabel(stage)), [i18n]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const nextSettings = await window.translateTer.getSettings();
      const [nextModels, cloudAsrSecret, llmSecret] = await Promise.all([
        window.translateTer.assets.listWhisperModels(nextSettings.asrProviderId),
        window.translateTer.settings.getSecret('cloud.openai'),
        window.translateTer.settings.getSecret('openai.compatible')
      ]);
      const nextFfmpegStatus = await window.translateTer.assets
        .ensureFfmpeg({
          allowDownload: false,
          useMultiThreadDownload: nextSettings.enableMultiThreadDownload
        })
        .catch(() => undefined);
      const nextHealth = await readNativeHealthWithRetry();

      if (!mounted) return;

      setSettings(nextSettings);
      setModels(nextModels);
      setNativeHealth(nextHealth);
      setFfmpegStatus(nextFfmpegStatus);
      setProviderSecrets({
        'cloud.openai': cloudAsrSecret ?? {},
        'openai.compatible': llmSecret ?? {}
      });
      await i18n.changeLanguage(nextSettings.uiLanguage);
      if (mounted) {
        setMessage(i18n.t('ready'));
        writeUiLog(
          'info',
          'bootstrap.ready',
          {
            asrProviderId: nextSettings.asrProviderId,
            whisperModelId: nextSettings.whisperModelId,
            logLevel: nextSettings.logLevel
          },
          'renderer.app',
          'Renderer bootstrap completed.'
        );
      }
    })();

    const unsubscribeJobs = window.translateTer.jobs.onEvent((event) => {
      writeUiLog('debug', 'jobs.event-received', summarizeJobEventForLog(event), 'renderer.jobs');
      if (event.type === 'snapshot') setJob(event.job);
      if (event.type === 'progress') setMessage(event.message ?? translateStage(event.stage));
      if (event.type === 'error') pushStatus(event.message, 'error');
    });
    const unsubscribeAssets = window.translateTer.assets.onEvent((event) => {
      writeUiLog('debug', 'assets.event-received', event, 'renderer.assets');
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
      } else if (event.scope === 'ffmpeg') {
        setFfmpegActivity(nextMessage);
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
  }, [i18n, translateStage, writeUiLog]);

  useEffect(() => {
    if (settings?.logLevel !== 'debug') return;

    const handleClick = (event: MouseEvent): void => {
      writeUiLog(
        'debug',
        'dom.click',
        {
          target: describeDomTarget(event.target),
          button: event.button,
          detail: event.detail
        },
        'renderer.dom',
        'Captured click event.'
      );
    };

    const handleChange = (event: Event): void => {
      writeUiLog(
        'debug',
        'dom.change',
        {
          target: describeDomTarget(event.target),
          value: describeDomValue(event.target)
        },
        'renderer.dom',
        'Captured change event.'
      );
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('change', handleChange, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('change', handleChange, true);
    };
  }, [settings?.logLevel, writeUiLog]);

  useEffect(() => {
    return () => {
      if (settingsJumpResetRef.current) {
        window.clearTimeout(settingsJumpResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!settings || settings.asrProviderId !== 'local.whisper.cpp') return;

    let cancelled = false;
    void (async () => {
      const status = await window.translateTer.assets
        .ensureWhisperRuntime({
          modelId: settings.whisperModelId,
          allowDownload: false,
          preferCuda: effectiveLocalWhisperUseCuda,
          localAsrAcceleration: settings.localAsrAcceleration,
          preferredRuntimeVariant: effectivePreferredRuntimeVariant,
          ignoreCudaMismatch,
          useMultiThreadDownload: settings.enableMultiThreadDownload,
          downloadScope: 'none'
        })
        .catch(() => undefined);
      if (!status || cancelled) return;
      setRuntimeStatus(status);
      syncLocalWhisperHealth(status);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settings?.asrProviderId,
    settings?.whisperModelId,
    effectiveLocalWhisperUseCuda,
    settings?.localAsrAcceleration,
    settings?.preferredRuntimeVariant,
    ignoreCudaMismatch,
    settings?.enableMultiThreadDownload
  ]);

  useEffect(() => {
    if (!settings || settings.asrProviderId !== 'local.whisper.cpp') return;

    let cancelled = false;
    void (async () => {
      const status = await window.translateTer.assets
        .ensureWhisperModel({
          modelId: settings.whisperModelId,
          allowDownload: false,
          useMultiThreadDownload: settings.enableMultiThreadDownload
        })
        .catch(() => undefined);
      if (!status || cancelled) return;
      setModelStatus(status);
    })();

    return () => {
      cancelled = true;
    };
  }, [settings?.asrProviderId, settings?.whisperModelId, settings?.enableMultiThreadDownload]);

  useEffect(() => {
    if (!settings || settings.asrProviderId !== 'local.whisper.cpp' || !cudaStatus) return;

    let cancelled = false;
    void (async () => {
      const status = await window.translateTer.assets
        .ensureWhisperRuntime({
          modelId: settings.whisperModelId,
          allowDownload: false,
          preferCuda: true,
          localAsrAcceleration: 'gpu',
          preferredRuntimeVariant: 'cuda',
          ignoreCudaMismatch,
          useMultiThreadDownload: settings.enableMultiThreadDownload,
          downloadScope: 'none'
        })
        .catch(() => undefined);
      if (!status || cancelled) return;
      setCudaStatus(status);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    Boolean(cudaStatus),
    settings?.asrProviderId,
    settings?.whisperModelId,
    ignoreCudaMismatch,
    settings?.enableMultiThreadDownload
  ]);

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
    writeUiLog('info', 'settings.update', { patch }, 'renderer.settings', 'Saving settings changes.');
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      const next = await window.translateTer.saveSettings(patch);
      setSettings(next);
      if (patch.uiLanguage) {
        await i18n.changeLanguage(next.uiLanguage);
        setMessage(i18n.t('ready'));
      }
    } catch (error) {
      const nextMessage = reportUiError('settings.update-failed', error, { patch }, 'renderer.settings');
      pushStatus(nextMessage, 'error');
      throw error;
    }
  }

  async function updateLocalAsrAccelerationSetting(
    acceleration: AppSettingsPublic['localAsrAcceleration']
  ): Promise<void> {
    if (!settings) return;

    const nextVariant = resolveVariantSelectionForAcceleration(
      acceleration,
      effectiveRuntimeVariantSelection,
      runtimeVariantSelections
    );
    await updateSettings(buildLocalAsrSettingsPatch(acceleration, nextVariant));
  }

  async function updateLocalRuntimeVariantSetting(
    variantSelection: RuntimeVariantSelection
  ): Promise<void> {
    if (!settings) return;

    const nextAcceleration = resolveAccelerationForVariantSelection(variantSelection, configuredAcceleration);
    await updateSettings(buildLocalAsrSettingsPatch(nextAcceleration, variantSelection));
  }

  async function updateIgnoreCudaMismatchSetting(nextIgnoreCudaMismatch: boolean): Promise<void> {
    if (!settings) return;
    await updateSettings(buildIgnoreCudaMismatchPatch(nextIgnoreCudaMismatch));
  }

  async function readNativeHealthWithRetry(): Promise<NativeHealth | undefined> {
    const first = await window.translateTer.native.health().catch(() => undefined);
    if (!first || !shouldRetryNativeHealth(first)) {
      return first;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    return (await window.translateTer.native.health().catch(() => first)) ?? first;
  }

  async function refreshNativeHealth(): Promise<void> {
    setNativeHealth(await readNativeHealthWithRetry());
  }

  async function refreshModels(): Promise<void> {
    setModels(await window.translateTer.assets.listWhisperModels(settings?.asrProviderId));
  }

  useEffect(() => {
    if (!settings?.asrProviderId) return;
    void refreshModels();
  }, [settings?.asrProviderId]);

  async function checkFfmpegTools(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'ffmpeg.check', { multiThreadDownload: settings.enableMultiThreadDownload }, 'renderer.runtime');
    setRuntimeOperation('ffmpeg-check');
    setActiveDownload(undefined);
    setFfmpegActivity(t('ffmpegChecking'));
    pushStatus(t('ffmpegChecking'));
    try {
      const status = await window.translateTer.assets.ensureFfmpeg({
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFfmpegStatus(status);
      await refreshNativeHealth();
      const nextMessage = describeFfmpegStatusDetail(status, t);
      setFfmpegActivity(nextMessage);
      pushStatus(nextMessage, status.available ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('ffmpeg.check-failed', error, undefined, 'renderer.runtime');
      setFfmpegActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFfmpegTools(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'ffmpeg.download', { multiThreadDownload: settings.enableMultiThreadDownload }, 'renderer.runtime');
    setRuntimeOperation('ffmpeg-download');
    setActiveDownload(undefined);
    setFfmpegActivity(t('ffmpegChecking'));
    pushStatus(t('ffmpegChecking'));
    try {
      const status = await window.translateTer.assets.ensureFfmpeg({
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFfmpegStatus(status);
      await refreshNativeHealth();
      const nextMessage = describeFfmpegStatusDetail(status, t);
      setFfmpegActivity(nextMessage);
      pushStatus(nextMessage, status.available ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('ffmpeg.download-failed', error, undefined, 'renderer.runtime');
      setFfmpegActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function refreshLocalWhisperRuntimeSnapshot(): Promise<void> {
    if (!settings) return;
    const status = await window.translateTer.assets.ensureWhisperRuntime({
      modelId: settings.whisperModelId,
      allowDownload: false,
      preferCuda: effectiveLocalWhisperUseCuda,
      localAsrAcceleration: settings.localAsrAcceleration,
      preferredRuntimeVariant: effectivePreferredRuntimeVariant,
      ignoreCudaMismatch,
      useMultiThreadDownload: settings.enableMultiThreadDownload,
      downloadScope: 'none'
    });
    setRuntimeStatus(status);
    syncLocalWhisperHealth(status);
  }

  async function checkLocalWhisperRuntime(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'whisper.runtime.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeChecking'));
    const status = await window.translateTer.assets.ensureWhisperRuntime({
      modelId: settings.whisperModelId,
      allowDownload: false,
      preferCuda: effectiveLocalWhisperUseCuda,
      localAsrAcceleration: settings.localAsrAcceleration,
      preferredRuntimeVariant: effectivePreferredRuntimeVariant,
      ignoreCudaMismatch,
      useMultiThreadDownload: settings.enableMultiThreadDownload,
      downloadScope: 'none'
    });
    setRuntimeStatus(status);
    syncLocalWhisperHealth(status);
    await refreshModels();
    pushStatus(
      describeLocalWhisperTestResult(status, t),
      status.binary.verified && status.model.verified ? 'success' : 'warning'
    );
  }

  async function downloadLocalWhisperRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    writeUiLog('info', 'whisper.runtime.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('runtime-download');
    setActiveDownload(undefined);
    pushStatus(t('runtimeDownloading'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: effectiveLocalWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: effectivePreferredRuntimeVariant,
        ignoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'runtime'
      });
      setRuntimeStatus(status);
      syncLocalWhisperHealth(status);
      const nextMessage = describeLocalWhisperTestResult(status, t);
      pushStatus(nextMessage, status.binary.verified ? 'success' : 'warning');
    } catch (error) {
      pushStatus(reportUiError('whisper.runtime.download-failed', error, undefined, 'renderer.runtime'), 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFasterWhisperRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    writeUiLog('info', 'faster-whisper.runtime.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('runtime-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeDownloading'));
    try {
      const health = await window.translateTer.assets.ensureFasterWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: Boolean(settings.localWhisperUseCuda),
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: effectivePreferredRuntimeVariant,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        forceManaged: true
      });
      setProviderHealth((current) => ({ ...current, 'local.faster-whisper': health }));
      pushStatus(health.message ?? t('providerReady'), health.ok ? 'success' : 'warning');
    } catch (error) {
      pushStatus(reportUiError('faster-whisper.runtime.download-failed', error, undefined, 'renderer.runtime'), 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkFasterWhisperCuda(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'faster-whisper.cuda.check', undefined, 'renderer.runtime');
    setRuntimeOperation('cuda-check');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeChecking'));
    try {
      const status = await window.translateTer.assets.ensureFasterWhisperCuda({
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFasterWhisperCudaStatus(status);
      pushStatus(status.message ?? t('runtimeNotChecked'), status.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      pushStatus(reportUiError('faster-whisper.cuda.check-failed', error, undefined, 'renderer.runtime'), 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFasterWhisperCudaRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    writeUiLog('info', 'faster-whisper.cuda.download', undefined, 'renderer.runtime');
    setRuntimeOperation('cuda-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeDownloading'));
    try {
      const status = await window.translateTer.assets.ensureFasterWhisperCuda({
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFasterWhisperCudaStatus(status);
      pushStatus(status.message ?? t('runtimeReady'), status.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      pushStatus(reportUiError('faster-whisper.cuda.download-failed', error, undefined, 'renderer.runtime'), 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkCuda(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'whisper.cuda.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('cuda-check');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeChecking'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: false,
        preferCuda: true,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda',
        ignoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'none'
      });
      setCudaStatus(status);
      const nextMessage = describeCudaStatusDetail(status, t, ignoreCudaMismatch);
      pushStatus(nextMessage, status.acceleration.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('whisper.cuda.check-failed', error, undefined, 'renderer.runtime');
      setActiveDownload(undefined);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadCudaRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    writeUiLog('info', 'whisper.cuda.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('cuda-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    pushStatus(t('runtimeDownloading'));
    try {
      const status = await window.translateTer.assets.ensureWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: true,
        localAsrAcceleration: 'gpu',
        preferredRuntimeVariant: 'cuda',
        ignoreCudaMismatch,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        downloadScope: 'cuda-runtime'
      });
      setCudaStatus(status);
      const nextMessage = describeCudaStatusDetail(status, t, ignoreCudaMismatch);
      pushStatus(nextMessage, status.acceleration.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('whisper.cuda.download-failed', error, undefined, 'renderer.runtime');
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkSelectedModel(): Promise<void> {
    if (!settings) return;
    writeUiLog('info', 'whisper.model.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('model-check');
    setActiveDownload(undefined);
    setModelActivity(t('runtimeChecking'));
    pushStatus(t('runtimeChecking'));
    try {
      const status = await window.translateTer.assets.ensureWhisperModel({
        modelId: settings.whisperModelId,
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setModelStatus(status);
      await refreshModels();
      await refreshLocalWhisperRuntimeSnapshot();
      const nextMessage = describeSelectedModelResult(status, t);
      setModelActivity(nextMessage);
      pushStatus(nextMessage, status.verified ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('whisper.model.check-failed', error, undefined, 'renderer.runtime');
      setModelActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadSelectedModel(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    writeUiLog('info', 'whisper.model.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('model');
    setActiveDownload(undefined);
    setModelActivity(t('runtimeChecking'));
    pushStatus(t('runtimeChecking'));
    try {
      const preflight = await window.translateTer.assets.ensureWhisperModel({
        modelId: settings.whisperModelId,
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setModelStatus(preflight);
      await refreshModels();
      await refreshLocalWhisperRuntimeSnapshot();
      if (preflight.verified) {
        const nextMessage = t('modelReady');
        setModelActivity(nextMessage);
        pushStatus(nextMessage, 'success');
        return;
      }

      const status = await window.translateTer.assets.ensureWhisperModel({
        modelId: settings.whisperModelId,
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setModelStatus(status);
      await refreshModels();
      await refreshLocalWhisperRuntimeSnapshot();
      const nextMessage = describeSelectedModelResult(status, t);
      setModelActivity(nextMessage);
      pushStatus(nextMessage, status.verified ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = reportUiError('whisper.model.download-failed', error, undefined, 'renderer.runtime');
      setActiveDownload(undefined);
      setModelActivity(nextMessage);
      pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function testProvider(providerId: string): Promise<void> {
    writeUiLog('info', 'provider.test', { providerId }, 'renderer.providers');
    setCheckingProvider(providerId);
    try {
      if (providerId === 'local.whisper.cpp' && settings) {
        await checkLocalWhisperRuntime();
        return;
      }
      if (providerId === 'local.faster-whisper' && settings) {
        const health = await window.translateTer.assets.ensureFasterWhisperRuntime({
          modelId: settings.whisperModelId,
          allowDownload: false,
          preferCuda: Boolean(settings.localWhisperUseCuda),
          localAsrAcceleration: settings.localAsrAcceleration,
          preferredRuntimeVariant: effectivePreferredRuntimeVariant
        });
        setProviderHealth((current) => ({ ...current, [providerId]: health }));
        pushStatus(health.message ?? t(providerStatusLabel(health.status)), health.ok ? 'success' : 'warning');
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
      pushStatus(reportUiError('provider.test-failed', error, { providerId }, 'renderer.providers'), 'error');
    } finally {
      setCheckingProvider(undefined);
    }
  }

  async function pickMedia(): Promise<void> {
    writeUiLog('info', 'media.pick.request', undefined, 'renderer.workspace');
    const selected = await window.translateTer.selectVideo();
    if (selected) {
      writeUiLog('info', 'media.pick.success', { mediaPath: selected }, 'renderer.workspace');
      setMediaPath(selected);
      return;
    }
    writeUiLog('debug', 'media.pick.cancelled', undefined, 'renderer.workspace');
  }

  async function createAndStart(): Promise<void> {
    if (!settings || !mediaPath.trim()) return;
    writeUiLog(
      'info',
      'job.start-transcription',
      {
        mediaPath: mediaPath.trim(),
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        useCuda: effectiveLocalWhisperUseCuda
      },
      'renderer.workspace'
    );
    const token = beginAction('transcribe');
    try {
      const nextJob = await window.translateTer.startTranscription({
        mediaPath: mediaPath.trim(),
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        localWhisperUseCuda: effectiveLocalWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: effectivePreferredRuntimeVariant,
        localAsrCpuMode: settings.localAsrCpuMode,
        localWhisperIgnoreCudaMismatch: ignoreCudaMismatch,
        allowWhisperAssetDownload: settings.allowWhisperAssetDownload,
        allowCloudAsrUpload: settings.asrProviderId === 'cloud.openai' ? true : settings.allowCloudAsrUpload,
        translationProviderPriority: settings.translationProviderPriority,
        translationConcurrency: settings.translationConcurrency,
        translationRequestsPerMinute: settings.translationRequestsPerMinute,
        translationTokenBudgetPerMinute: settings.translationTokenBudgetPerMinute,
        translationLinesPerRequest: settings.translationLinesPerRequest,
        translationBatchStride: settings.translationBatchStride
      });
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) {
        pushStatus(
          reportUiError('job.start-transcription-failed', error, { mediaPath: mediaPath.trim() }, 'renderer.workspace'),
          'error'
        );
      }
    } finally {
      endAction(token);
    }
  }

  async function translateJob(): Promise<void> {
    if (!job) return;
    writeUiLog('info', 'job.start-translation', { jobId: job.id }, 'renderer.workspace');
    const token = beginAction('translate');
    try {
      const nextJob = await window.translateTer.startTranslation(job.id);
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) {
        pushStatus(reportUiError('job.start-translation-failed', error, { jobId: job.id }, 'renderer.workspace'), 'error');
      }
    } finally {
      endAction(token);
    }
  }

  async function exportSrt(variant: ExportVariant): Promise<void> {
    if (!job?.subtitleDocument) return;
    writeUiLog('info', 'job.export-srt', { jobId: job.id, variant }, 'renderer.workspace');
    const token = beginAction('export', variant);
    try {
      const result = await window.translateTer.exportConfiguredSrt(job.subtitleDocument, job.mediaPath, variant);
      if (isCurrentAction(token) && !result.cancelled) pushStatus(t('exported'), 'success');
    } catch (error) {
      if (isCurrentAction(token)) {
        pushStatus(reportUiError('job.export-srt-failed', error, { jobId: job.id, variant }, 'renderer.workspace'), 'error');
      }
    } finally {
      endAction(token);
    }
  }

  async function pickExportDirectory(): Promise<void> {
    writeUiLog('info', 'export.pick-directory.request', undefined, 'renderer.settings');
    const selected = await window.translateTer.selectDirectory();
    if (selected) await updateSettings({ exportDirectory: selected, exportDestinationMode: 'selected-directory' });
  }

  async function updateSegment(segment: SubtitleSegment, patch: Partial<SubtitleSegment>): Promise<void> {
    if (!job) return;
    writeUiLog('debug', 'subtitle.segment-update', { jobId: job.id, segmentId: segment.id, patch }, 'renderer.subtitles');
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
    writeUiLog('info', 'provider.save-secret', { providerId }, 'renderer.providers');
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

  function renderProviderApiSettings(providerId: 'cloud.openai' | 'openai.compatible'): JSX.Element {
    const secret = providerSecrets[providerId] ?? {};
    const config = providerApiSettingsConfig[providerId];
    const selectedFormatId =
      secret.apiFormat && config.formats.some((format) => format.id === secret.apiFormat)
        ? secret.apiFormat
        : config.defaultFormatId;
    const selectedFormat =
      config.formats.find((format) => format.id === selectedFormatId) ?? config.formats[0];

    return (
      <div className="settingsGroupCard">
        <InspectorSection
          icon={<KeyRound size={16} />}
          title={t(config.sectionTitleKey)}
        >
          <label>
            {t('apiFormat')}
            <select
              value={selectedFormatId}
              onChange={(event) => updateProviderSecret(providerId, { apiFormat: event.target.value })}
            >
              {config.formats.map((format) => (
                <option key={format.id} value={format.id}>
                  {t(format.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <p className="settingsMicrocopy">{t(selectedFormat.detailKey)}</p>
          {selectedFormat.fields.map((field) => (
            <TextField
              key={`${providerId}-${selectedFormat.id}-${field.key}`}
              label={t(field.labelKey)}
              value={secret[field.key] ?? ''}
              placeholder={field.placeholder}
              type={field.type}
              revealable={field.revealable}
              showToggleLabel={t('showSecret')}
              hideToggleLabel={t('hideSecret')}
              onChange={(value) => updateProviderSecret(providerId, { [field.key]: value })}
            />
          ))}
          {providerId === 'cloud.openai' ? <p className="settingsMicrocopy">{t('cloudUploadNotice')}</p> : null}
          <ProviderActionRow
            savingLabel={t('saveProvider')}
            testingLabel={checkingProvider === providerId ? t('checking') : t('test')}
            onSave={() => void saveProviderSecret(providerId)}
            onTest={() => void testProvider(providerId)}
            testDisabled={checkingProvider === providerId}
          />
        </InspectorSection>
      </div>
    );
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
  const asrProviderId = settings?.asrProviderId ?? 'local.whisper.cpp';
  const translationProviderId = settings?.translationProviderPriority[0] ?? 'openai.compatible';
  const selectedModelStatus = modelStatus && modelStatus.id === settings?.whisperModelId ? modelStatus : undefined;
  const selectedModelInstalled = selectedModelStatus?.installed ?? selectedModel?.installed ?? false;
  const selectedModelVerified = selectedModelStatus?.verified ?? false;
  const cudaBlockingMismatch = hasBlockingCudaMismatch(cudaStatus, ignoreCudaMismatch);
  const cudaStatusDetail = cudaFlowRelevant
    ? describeCudaStatusDetail(cudaStatus, t, ignoreCudaMismatch)
    : effectiveRuntimeVariantSelection === 'metal' || effectiveRuntimeVariantSelection === 'vulkan'
      ? t('cudaNotApplicableForVariant')
      : configuredAcceleration === 'cpu'
        ? t('cudaDisabledUsesCpu')
        : configuredAcceleration === 'auto'
          ? t('runtimeVariantAutomatic')
          : t('runtimeNotChecked');
  const cudaStatusShort = cudaFlowRelevant
    ? describeCudaStatusShort(cudaStatus, t, ignoreCudaMismatch)
    : configuredAcceleration === 'auto'
      ? t('autoOption')
      : configuredAcceleration === 'cpu'
        ? t('disabledShort')
        : t('notRequired');
  const fasterWhisperCudaDetail = fasterWhisperCudaStatus?.message ?? t('runtimeNotChecked');
  const fasterWhisperCudaShort = fasterWhisperCudaStatus
    ? fasterWhisperCudaStatus.cudaSupported
      ? t('ok')
      : fasterWhisperCudaStatus.actionRequired === 'download-cuda-runtime'
        ? t('downloadCudaRuntime')
        : t('degraded')
    : t('notChecked');
  const ffmpegState = deriveFfmpegState({ t, ffmpegStatus, nativeHealth });
  const nativeBackendState = deriveNativeBackendState({ t, health: nativeHealth });
  const ffmpegAvailable = ffmpegStatus?.available ?? Boolean(nativeHealth?.ffmpegAvailable && nativeHealth?.ffprobeAvailable);
  const cudaMismatchDetected = cudaFlowRelevant && cudaBlockingMismatch;
  const cudaRuntimeMissing = Boolean(
    cudaFlowRelevant &&
      cudaStatus?.acceleration.hardwareDetected &&
      !cudaStatus.acceleration.runtimeDetected
  );
  const showCudaRuntimeDownload = Boolean(
    settings?.allowWhisperAssetDownload && cudaFlowRelevant && cudaRuntimeMissing && !cudaBlockingMismatch
  );
  const showFasterWhisperCudaDownload = Boolean(
    settings?.allowWhisperAssetDownload && fasterWhisperCudaStatus?.actionRequired === 'download-cuda-runtime'
  );
  const showFfmpegDownload = !ffmpegAvailable;
  const llmHealth = providerHealth[translationProviderId];
  const asrHealth = providerHealth[asrProviderId];
  const usingWhisperCpp = asrProviderId === 'local.whisper.cpp';
  const usingFasterWhisper = asrProviderId === 'local.faster-whisper';
  const fasterWhisperUnsupportedVariant = Boolean(
    usingFasterWhisper && asrHealth?.acceleration && !asrHealth.acceleration.supported
  );
  const usingLocalAsr = usingWhisperCpp || usingFasterWhisper;
  const canForceStop = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.stage));
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0];
  const selectedWarning = workflowWarnings.find((warning) => warning.id === selectedWarningId) ?? workflowWarnings[0];
  const showWarningList = workflowWarnings.length > 1;
  const warningHint = deriveWarningHint(selectedWarning, t);
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
  const workspaceRailMessage = deriveWorkspaceRailMessage({
    t,
    asrProviderId,
    activeDownload,
    footerTitle,
    stage: job?.stage ?? 'idle',
    sourceLabel,
    targetLabel
  });
  const runtimeState = deriveRuntimeState({
    t,
    runtimeStatus,
    ffmpegStatus,
    nativeHealth,
    asrProviderId,
    asrHealth,
    job
  });
  const backendAccelerationState = deriveBackendAccelerationState({
    t,
    runtimeStatus,
    asrProviderId
  });
  const runtimeModelState = deriveRuntimeModelState({
    t,
    runtimeStatus,
    selectedModelInstalled,
    selectedModelVerified,
    asrProviderId
  });
  const selectedModelOverviewState = deriveSelectedModelOverviewState({
    t,
    selectedModel,
    selectedModelInstalled,
    selectedModelVerified,
    asrProviderId
  });
  const translationState = deriveTranslationState({
    t,
    providerId: translationProviderId,
    health: llmHealth,
    job
  });
  const asrProviderDescription = t(
    asrProviders.find((provider) => provider.id === asrProviderId)?.descriptionKey ?? 'providerReady'
  );
  const asrProviderState = deriveAsrProviderState({
    t,
    asrProviderId,
    description: asrProviderDescription,
    health: asrHealth,
    runtimeState,
    job
  });
  const asrProviderTone = asrProviderState.tone;
  const asrProviderStatusLabel = asrProviderState.label;
  const asrProviderSummaryDetail = asrProviderState.detail;
  const workspaceRuntimeDetail = deriveWorkspaceRuntimeDetail({
    t,
    asrProviderId,
    asrHealth,
    runtimeState,
    ffmpegStatus,
    nativeHealth
  });
  const fasterWhisperRuntimeMissing = usingFasterWhisper && !asrHealth?.ok;
  const runtimeSummaryJumpTarget: SettingsJumpTarget = usingWhisperCpp
    ? !ffmpegAvailable
      ? 'ffmpeg'
      : !runtimeStatus?.binary.verified
        ? 'asr-provider'
        : !runtimeStatus?.model.verified
          ? 'whisper-model'
          : (cudaFlowRelevant &&
              (runtimeStatus?.acceleration.requested === 'gpu' || cudaRuntimeMissing || cudaMismatchDetected))
            ? 'cuda'
            : 'asr-provider'
    : fasterWhisperRuntimeMissing
      ? 'asr-provider'
      : 'asr-provider';
  const backendJumpTarget: SettingsJumpTarget = ffmpegAvailable ? 'asr-provider' : 'ffmpeg';
  const ffmpegJumpTarget: SettingsJumpTarget = 'ffmpeg';
  const accelerationJumpTarget: SettingsJumpTarget = usingWhisperCpp ? 'cuda' : 'asr-provider';
  const modelJumpTarget: SettingsJumpTarget = usingLocalAsr ? 'whisper-model' : 'asr-provider';
  const translationJumpTarget: SettingsJumpTarget = 'translation-provider';
  const showFasterWhisperRuntimeDownloadAction = Boolean(
    settings?.allowWhisperAssetDownload &&
      usingFasterWhisper &&
      !fasterWhisperUnsupportedVariant &&
      (!asrHealth || asrHealth.status === 'unavailable')
  );
  const showRuntimeDownloadAction =
    Boolean(settings?.allowWhisperAssetDownload) &&
    (usingWhisperCpp || showFasterWhisperRuntimeDownloadAction) &&
    !asrHealth?.ok;
  const runtimeDownloadDisabled =
    runtimeOperation === 'runtime-download' ||
    checkingProvider === asrProviderId ||
    (usingWhisperCpp ? Boolean(runtimeStatus?.binary.verified) : Boolean(asrHealth?.ok));
  const runtimeStatusRows: RuntimeStatusRow[] = usingWhisperCpp
    ? buildWhisperRuntimeStatusRows({
        t,
        runtimeStatus,
        requestedAcceleration: configuredAcceleration,
        requestedVariant: effectiveRuntimeVariantSelection
      })
    : usingFasterWhisper
      ? buildFasterWhisperRuntimeStatusRows({
          t,
          acceleration: asrHealth?.acceleration,
          requestedAcceleration: configuredAcceleration,
          requestedVariant: effectiveRuntimeVariantSelection
        })
      : [];

  async function forceStop(): Promise<void> {
    if (!job) return;
    writeUiLog('warning', 'job.force-stop', { jobId: job.id }, 'renderer.workspace');
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

  function toggleWarningPanel(): void {
    if (warningCount === 0) return;
    setWarningPanelOpen((current) => {
      const next = !current;
      if (next) {
        setSelectedWarningId((warningId) => warningId ?? workflowWarnings[0]?.id);
      }
      return next;
    });
  }

  function jumpToSettingsTarget(target: SettingsJumpTarget): void {
    writeUiLog('debug', 'settings.jump-target', { target }, 'renderer.settings');
    const element = (() => {
      switch (target) {
        case 'asr-provider':
          return asrProviderSettingsRef.current;
        case 'ffmpeg':
          return ffmpegSettingsRef.current;
        case 'cuda':
          return cudaSettingsRef.current;
        case 'whisper-model':
          return whisperModelSettingsRef.current;
        case 'translation-provider':
          return translationProviderSettingsRef.current;
      }
    })();

    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    setActiveSettingsJumpTarget(target);
    if (settingsJumpResetRef.current) {
      window.clearTimeout(settingsJumpResetRef.current);
    }
    settingsJumpResetRef.current = window.setTimeout(() => {
      setActiveSettingsJumpTarget((current) => (current === target ? undefined : current));
    }, 1800);
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
            <div className="workflowRailLead">
              <div className="workflowRailCopy">
                <strong>{t('workspace')}</strong>
                <small title={footerMessage}>{workspaceRailMessage}</small>
              </div>
            </div>
            <div className="workflowRailTrack">
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
            </div>
            <div className="workflowRailMeta">
              <span className="metaPill">{`${t('progress')} ${completion}%`}</span>
              <span className={`status ${runtimeState.tone}`}>{runtimeState.label}</span>
              <button
                className="summaryToggle"
                title={statsCollapsed ? t('expandSummary') : t('collapseSummary')}
                onClick={() => setStatsCollapsed((current) => !current)}
              >
                {statsCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            </div>
          </nav>

          <main
            className={`workspaceLayout${statsCollapsed ? ' statsCollapsed' : ''}`}
          >
            {!statsCollapsed && (
              <aside className="statsRail workspaceInspector">
                <div className="railContent">
                  <div className="railHeader inspectorHeader">
                    <span>{t('workflowSummary')}</span>
                    <strong title={jobTitle}>{jobTitle}</strong>
                    <small>{t(stageLabel(job?.stage ?? 'idle'))}</small>
                  </div>
                  <div className="railMetrics inspectorMetrics">
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
                      onClick={warningCount > 0 ? () => toggleWarningPanel() : undefined}
                    />
                  </div>
                  {!warningPanelOpen &&
                    (warningCount > 0 ? (
                      <button className="workspaceInspectorNotice actionable" onClick={() => toggleWarningPanel()} type="button">
                        <span className="signal warn" />
                        <div>
                          <strong>{t('warningDetails')}</strong>
                          <small>{warningHint}</small>
                        </div>
                      </button>
                    ) : (
                      <div className="workspaceInspectorNotice">
                        <span className={`signal ${translationComplete ? 'good' : 'muted'}`} />
                        <div>
                          <strong>{t('workflowSummary')}</strong>
                          <small>{t('subtitlePanelHint')}</small>
                        </div>
                      </div>
                    ))}
                  {warningPanelOpen && workflowWarnings.length > 0 && selectedWarning && (
                    <div className="warningPanel">
                      <div className="warningPanelHeader">
                        <div>
                          <strong>{t('warningDetails')}</strong>
                          <small>{warningHint}</small>
                        </div>
                        <button className="textButton" onClick={() => toggleWarningPanel()} type="button">
                          <AlertCircle size={14} />
                          {t('warnings')}
                        </button>
                      </div>
                      {showWarningList && (
                        <div className="warningList" role="list">
                          {workflowWarnings.map((warning) => (
                            <button
                              className={`warningItem${selectedWarning.id === warning.id ? ' active' : ''}`}
                              key={warning.id}
                              onClick={() => setSelectedWarningId(warning.id)}
                              type="button"
                            >
                              <span className="signal warn" />
                              <div className="warningItemBody">
                                <div className="warningItemHeader">
                                  <strong>{warningSummaryLabel(warning, t)}</strong>
                                  <span className="warningPill">{warningCategoryLabel(warning, t)}</span>
                                </div>
                                <small>{warning.message}</small>
                                <div className="warningItemMeta">
                                  <span>{warningSourceLabel(warning, asrProviderId, translationProviderId, t)}</span>
                                  {formatWarningSegmentRange(warning) !== '--' && (
                                    <span>{formatWarningSegmentRange(warning)}</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className={`warningDetailCard${showWarningList ? '' : ' solo'}`}>
                        <div className="warningDetailTitle">
                          <span className="signal warn" />
                          <div>
                            <strong>{warningSummaryLabel(selectedWarning, t)}</strong>
                            <small>{selectedWarning.message}</small>
                          </div>
                        </div>
                        <div className="warningDetailBadges">
                          <span className="warningPill">{warningCategoryLabel(selectedWarning, t)}</span>
                          <span className="warningPill">
                            {warningSourceLabel(selectedWarning, asrProviderId, translationProviderId, t)}
                          </span>
                        </div>
                        <div className="warningMetaGrid">
                          <div className="warningMetaCard">
                            <span>{t('warningType')}</span>
                            <strong>{warningCategoryLabel(selectedWarning, t)}</strong>
                          </div>
                          <div className="warningMetaCard">
                            <span>{t('warningCode')}</span>
                            <strong className="muted">{selectedWarning.code}</strong>
                          </div>
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
                              {warningSourceLabel(selectedWarning, asrProviderId, translationProviderId, t)}
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
                        <small title={runtimeState.detail}>{workspaceRuntimeDetail}</small>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            )}

            <section className="workspaceMain">
              <section
                className={`workspaceHero${usingFasterWhisper ? ' fasterWhisperHero' : ''}`}
                aria-label={t('currentJob')}
              >
                <div className="jobMediaCard">
                  <div className="workspaceCardTop">
                    <span className="fieldLabel">{t('currentJob')}</span>
                    <span className="stageBadge">{t(stageLabel(job?.stage ?? 'idle'))}</span>
                  </div>
                  <strong title={jobTitle}>{jobTitle}</strong>
                  <p className="workspacePath" title={selectedMediaPath || t('placeholderPath')}>
                    {selectedMediaPath || t('placeholderPath')}
                  </p>
                  <div className="jobMediaMeta">
                    <span className="metaPill">{`${sourceLabel} -> ${targetLabel}`}</span>
                    <span className="metaPill">{providerLabel(settings.asrProviderId, t)}</span>
                    <span className="metaPill">{providerLabel(translationProviderId, t)}</span>
                  </div>
                  <div className="workspaceProgressPanel">
                    <div className="workspaceProgressCopy">
                      <span>{t('progress')}</span>
                      <strong>{completion}%</strong>
                    </div>
                    <div className={`workspaceProgressTrack${jobIsRunning ? ' active' : ''}`} aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
                    </div>
                  </div>
                </div>

                <div className="jobActionCard">
                  <div className="workspaceCardTop">
                    <span className="fieldLabel">{t('workflowSummary')}</span>
                    <span className="metaPill">{t('languagePair')}</span>
                  </div>
                  <strong className="workspaceRoute">{`${sourceLabel} -> ${targetLabel}`}</strong>
                  <div className="workspaceActionStack">
                    <button className="secondary wideButton" onClick={() => void pickMedia()}>
                      <FileVideo size={16} />
                      {t('chooseMedia')}
                    </button>
                    <div className="workspaceActionRow">
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
                  </div>
                  <p className="workspaceActionHint">{t('reviewHint')}</p>
                </div>

                <div className="workspaceSignalDeck">
                  <div className="workspaceSignalGrid">
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
                      onClick={warningCount > 0 ? () => toggleWarningPanel() : undefined}
                    />
                  </div>
                  <div className="workspaceHealthGrid">
                    <div className="railNote workspaceCompactNote">
                      <span className={`signal ${translationState.tone}`} />
                      <div>
                        <strong>{providerLabel(translationProviderId, t)}</strong>
                        <small>{translationState.detail}</small>
                      </div>
                    </div>
                    <div className="railNote workspaceCompactNote">
                      <span className={`signal ${runtimeState.tone}`} />
                      <div>
                        <strong>{t('runtime')}</strong>
                        <small title={runtimeState.detail}>{workspaceRuntimeDetail}</small>
                      </div>
                    </div>
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
                    <span className="metaPill">{t('rows', { count: segments.length })}</span>
                    <span className="metaPill">{`${translatedCount}/${segments.length}`}</span>
                    {warningCount > 0 && (
                      <button className="textButton" onClick={() => toggleWarningPanel()} type="button">
                        <AlertCircle size={14} />
                        {`${warningCount} ${t('warnings')}`}
                      </button>
                    )}
                  </div>
                </div>
                {job?.subtitleDocument ? (
                  <div className="subtitleWorkspace">
                    <div className="subtitleTableShell">
                      <div className="subtitleTableIntro">
                        <div>
                          <span className="fieldLabel">{t('workflowSummary')}</span>
                          <strong>{jobTitle}</strong>
                        </div>
                        <div className="subtitleTableChips">
                          <span className="metaPill">{`${sourceLabel} -> ${targetLabel}`}</span>
                          <span className="metaPill">{providerLabel(settings.asrProviderId, t)}</span>
                        </div>
                      </div>
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
                  <span className="settingsBadge">{providerLabel(asrProviderId, t)}</span>
                  <span className="settingsBadge">{providerLabel(translationProviderId, t)}</span>
                  <span className={`settingsBadge tone-${asrProviderTone}`}>{asrProviderStatusLabel}</span>
                </div>
              </div>
              <div className="settingsSummaryGrid">
                {usingWhisperCpp ? (
                  <>
                    <SettingsOverviewCard
                      icon={<ShieldCheck size={16} />}
                      eyebrow={t('summaryRecognitionRuntime')}
                      title={runtimeState.label}
                      detail={runtimeState.detail}
                      tone={runtimeState.tone}
                      featured
                      onClick={() => jumpToSettingsTarget(runtimeSummaryJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<ShieldCheck size={16} />}
                      label={t('summaryDesktopBackend')}
                      value={nativeBackendState.label}
                      detail={nativeBackendState.detail}
                      tone={nativeBackendState.tone}
                      onClick={() => jumpToSettingsTarget(backendJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<Download size={16} />}
                      label={t('summaryFfmpegTools')}
                      value={ffmpegState.label}
                      tone={ffmpegState.tone}
                      onClick={() => jumpToSettingsTarget(ffmpegJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<MonitorCog size={16} />}
                      label={t('summaryBackendAcceleration')}
                      value={backendAccelerationState.label}
                      tone={backendAccelerationState.tone}
                      onClick={() => jumpToSettingsTarget(accelerationJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<Gauge size={16} />}
                      label={t('summaryCudaEnvironment')}
                      value={cudaStatusShort}
                      tone={cudaApproved ? 'good' : cudaMismatchDetected || cudaRuntimeMissing ? 'warn' : 'muted'}
                      onClick={() => jumpToSettingsTarget(accelerationJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<HardDriveDownload size={16} />}
                      label={t('summaryModelFiles')}
                      value={runtimeModelState.label}
                      tone={runtimeModelState.tone}
                      onClick={() => jumpToSettingsTarget(modelJumpTarget)}
                    />
                    <SettingsOverviewCard
                      icon={<MonitorCog size={16} />}
                      eyebrow={t('summaryAsrProvider')}
                      title={providerLabel(asrProviderId, t)}
                      detail={asrProviderSummaryDetail}
                      tone={asrProviderTone}
                      onClick={() => jumpToSettingsTarget('asr-provider')}
                    />
                    <SettingsOverviewCard
                      icon={<HardDriveDownload size={16} />}
                      eyebrow={t('summaryWhisperModel')}
                      title={selectedModelOverviewState.label}
                      detail={selectedModelOverviewState.detail}
                      tone={selectedModelOverviewState.tone}
                      onClick={() => jumpToSettingsTarget(modelJumpTarget)}
                    />
                    <SettingsOverviewCard
                      icon={<Languages size={16} />}
                      eyebrow={t('summaryTranslationProvider')}
                      title={providerLabel(translationProviderId, t)}
                      detail={translationState.detail}
                      tone={translationState.tone}
                      onClick={() => jumpToSettingsTarget(translationJumpTarget)}
                    />
                  </>
                ) : usingFasterWhisper ? (
                  <>
                    <SettingsOverviewCard
                      icon={<MonitorCog size={16} />}
                      eyebrow={t('summaryAsrProvider')}
                      title={providerLabel(asrProviderId, t)}
                      detail={asrProviderSummaryDetail}
                      tone={asrProviderTone}
                      featured
                      onClick={() => jumpToSettingsTarget('asr-provider')}
                    />
                    <SettingsFactCard
                      icon={<ShieldCheck size={16} />}
                      label={t('summaryDesktopBackend')}
                      value={nativeBackendState.label}
                      detail={nativeBackendState.detail}
                      tone={nativeBackendState.tone}
                      onClick={() => jumpToSettingsTarget(backendJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<Download size={16} />}
                      label={t('summaryFfmpegTools')}
                      value={ffmpegState.label}
                      tone={ffmpegState.tone}
                      onClick={() => jumpToSettingsTarget(ffmpegJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<MonitorCog size={16} />}
                      label={t('summaryBackendAcceleration')}
                      value={
                        asrHealth?.acceleration
                          ? t(accelerationOptionLabel(asrHealth.acceleration.selected))
                          : t(accelerationOptionLabel(configuredAcceleration))
                      }
                      detail={asrHealth?.message ?? t('fasterWhisperCudaDetail')}
                      tone={asrHealth?.acceleration?.selected === 'gpu' ? 'good' : 'accent'}
                      onClick={() => jumpToSettingsTarget(modelJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<Gauge size={16} />}
                      label={t('summaryCudaEnvironment')}
                      value={fasterWhisperCudaShort}
                      detail={fasterWhisperCudaDetail}
                      tone={
                        fasterWhisperCudaStatus
                          ? fasterWhisperCudaStatus.cudaSupported
                            ? 'good'
                            : fasterWhisperCudaStatus.hardwareDetected
                              ? 'warn'
                              : 'muted'
                          : 'muted'
                      }
                      onClick={() => jumpToSettingsTarget('cuda')}
                    />
                    <SettingsOverviewCard
                      icon={<HardDriveDownload size={16} />}
                      eyebrow={t('summaryWhisperModel')}
                      title={selectedModel?.displayName ?? t('whisperModel')}
                      detail={
                        selectedModel
                          ? [describeModelFootprint(selectedModel, t), t('fasterWhisperModelManagedDetail')].join(' · ')
                          : t('fasterWhisperModelManagedDetail')
                      }
                      tone="accent"
                      onClick={() => jumpToSettingsTarget(modelJumpTarget)}
                    />
                    <SettingsOverviewCard
                      icon={<Languages size={16} />}
                      eyebrow={t('summaryTranslationProvider')}
                      title={providerLabel(translationProviderId, t)}
                      detail={translationState.detail}
                      tone={translationState.tone}
                      onClick={() => jumpToSettingsTarget(translationJumpTarget)}
                    />
                  </>
                ) : (
                  <>
                    <SettingsOverviewCard
                      icon={<MonitorCog size={16} />}
                      eyebrow={t('summaryAsrProvider')}
                      title={providerLabel(asrProviderId, t)}
                      detail={asrProviderSummaryDetail}
                      tone={asrProviderTone}
                      featured
                      onClick={() => jumpToSettingsTarget('asr-provider')}
                    />
                    <SettingsFactCard
                      icon={<ShieldCheck size={16} />}
                      label={t('summaryDesktopBackend')}
                      value={nativeBackendState.label}
                      detail={nativeBackendState.detail}
                      tone={nativeBackendState.tone}
                      onClick={() => jumpToSettingsTarget(backendJumpTarget)}
                    />
                    <SettingsFactCard
                      icon={<Download size={16} />}
                      label={t('summaryFfmpegTools')}
                      value={ffmpegState.label}
                      tone={ffmpegState.tone}
                      onClick={() => jumpToSettingsTarget(ffmpegJumpTarget)}
                    />
                    <SettingsOverviewCard
                      icon={<Languages size={16} />}
                      eyebrow={t('summaryTranslationProvider')}
                      title={providerLabel(translationProviderId, t)}
                      detail={translationState.detail}
                      tone={translationState.tone}
                      onClick={() => jumpToSettingsTarget(translationJumpTarget)}
                    />
                  </>
                )}
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
                        <div className="settingsSubsection">
                          <SectionTitle icon={<ListChecks size={15} />} title={t('activityLogs')} />
                          <div className="settingsOptionStack">
                            <label>
                              {t('logLevel')}
                              <select
                                value={settings.logLevel}
                                onChange={(event) =>
                                  void updateSettings({ logLevel: event.target.value as AppLogLevel })
                                }
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
                            {(['srt', 'ass'] as SubtitleFileFormat[]).map((format) => (
                              <button
                                className={settings.exportFileFormat === format ? 'selected' : ''}
                                key={format}
                                onClick={() => void updateSettings({ exportFileFormat: format })}
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
                                onClick={() => void updateSettings({ exportBilingualOrder: order })}
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
                    <p>
                      {t(
                        asrProviders.find((provider) => provider.id === settings.asrProviderId)?.descriptionKey ?? 'providerReady'
                      )}
                    </p>
                  </div>
                  <div className="settingsShelf">
                    <div
                      className={`settingsGroupCard${activeSettingsJumpTarget === 'asr-provider' ? ' settingsJumpTargetActive' : ''}`}
                      ref={asrProviderSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<MonitorCog size={16} />} title={t('asrProvider')}>
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
                          actionDisabled={runtimeOperation === 'runtime-download'}
                          onTest={() => void testProvider(settings.asrProviderId)}
                          actionLabel={usingWhisperCpp ? t('checkRuntime') : t('test')}
                          secondaryActionLabel={showRuntimeDownloadAction ? t('downloadRuntime') : undefined}
                          secondaryActionLoading={runtimeOperation === 'runtime-download'}
                          secondaryActionDisabled={runtimeDownloadDisabled}
                          onSecondaryAction={
                            showRuntimeDownloadAction
                              ? usingWhisperCpp
                                ? () => void downloadLocalWhisperRuntime()
                                : () => void downloadFasterWhisperRuntime()
                              : undefined
                          }
                          showMessage
                        />
                        {usingLocalAsr && (
                          <div className="settingsOptionStack">
                            <span className="fieldLabel">{t('localCpuUsage')}</span>
                            <p className="settingsMicrocopy">{t('localCpuUsageDetail')}</p>
                            <div className="segmented three">
                              {(['low', 'balanced', 'high'] as const).map((mode) => (
                                <button
                                  key={mode}
                                  className={settings.localAsrCpuMode === mode ? 'selected' : ''}
                                  onClick={() => void updateSettings({ localAsrCpuMode: mode })}
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
                      className={`settingsGroupCard${activeSettingsJumpTarget === 'ffmpeg' ? ' settingsJumpTargetActive' : ''}`}
                      ref={ffmpegSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<Download size={16} />} title={t('ffmpegTools')}>
                        <div className="modelCard">
                          <div>
                            <span className={`signal ${ffmpegState.tone}`} />
                            <strong>{t('ffmpegTools')}</strong>
                            <small>{ffmpegActivity ?? ffmpegState.detail}</small>
                          </div>
                          <div className="settingsActionRow">
                            <button
                              className="secondary compact settingsActionButton"
                              disabled={runtimeOperation === 'ffmpeg-check' || runtimeOperation === 'ffmpeg-download'}
                              onClick={() => void checkFfmpegTools()}
                            >
                              <Search size={16} />
                              {runtimeOperation === 'ffmpeg-check' ? t('checking') : t('checkFfmpeg')}
                            </button>
                            {showFfmpegDownload && (
                              <button
                                className="secondary compact settingsActionButton"
                                disabled={runtimeOperation === 'ffmpeg-check' || runtimeOperation === 'ffmpeg-download'}
                                onClick={() => void downloadFfmpegTools()}
                              >
                                <HardDriveDownload size={16} />
                                {runtimeOperation === 'ffmpeg-download' ? t('downloadProgress') : t('downloadFfmpeg')}
                              </button>
                            )}
                          </div>
                          {ffmpegStatus && (
                            <p title={ffmpegStatus.ffmpegPath ?? ffmpegStatus.ffprobePath}>
                              {describeFfmpegLocation(ffmpegStatus, t)}
                            </p>
                          )}
                        </div>
                      </InspectorSection>
                    </div>

                    {usingWhisperCpp && (
                      <div className="settingsShelf twoUp">
                        <div
                          className={`settingsGroupCard settingsGroupCardAccent${activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`}
                          ref={cudaSettingsRef}
                          tabIndex={-1}
                        >
                          <InspectorSection icon={<Gauge size={16} />} title={t('acceleration')}>
                            <div className="modelCard accentCard">
                              <div>
                                <span
                                  className={
                                    runtimeStatus?.acceleration.selected === 'gpu'
                                      ? 'signal good'
                                      : cudaMismatchDetected || cudaRuntimeMissing
                                        ? 'signal warn'
                                        : 'signal accent'
                                  }
                                />
                                <strong>{t('acceleration')}</strong>
                                <small>{cudaStatusDetail}</small>
                              </div>
                              <label>
                                {t('acceleration')}
                                <select
                                  value={configuredAcceleration}
                                  onChange={(event) =>
                                    void updateLocalAsrAccelerationSetting(
                                      event.target.value as AppSettingsPublic['localAsrAcceleration']
                                    )
                                  }
                                >
                                  {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                                    <option key={option} value={option}>
                                      {t(accelerationOptionLabel(option))}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {runtimeVariantSelections.length > 0 && (
                                <label>
                                  {t('runtimeVariant')}
                                  <select
                                    value={effectiveRuntimeVariantSelection}
                                    onChange={(event) =>
                                      void updateLocalRuntimeVariantSetting(event.target.value as RuntimeVariantSelection)
                                    }
                                  >
                                    {runtimeVariantSelections.map((option) => (
                                      <option key={option} value={option}>
                                        {t(runtimeVariantOptionLabel(option))}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {cudaFlowRelevant && (
                                <div className="settingsActionRow">
                                  <button
                                    className="secondary compact settingsActionButton"
                                    disabled={runtimeOperation === 'cuda-check' || runtimeOperation === 'cuda-download'}
                                    onClick={() => void checkCuda()}
                                  >
                                    <Search size={16} />
                                    {runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                                  </button>
                                  {showCudaRuntimeDownload && (
                                    <button
                                      className="secondary compact settingsActionButton"
                                      disabled={runtimeOperation === 'cuda-check' || runtimeOperation === 'cuda-download'}
                                      onClick={() => void downloadCudaRuntime()}
                                    >
                                      <HardDriveDownload size={16} />
                                      {runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                                    </button>
                                  )}
                                </div>
                              )}
                              {cudaFlowRelevant && (
                                <ToggleField
                                  label={t('ignoreCudaMismatch')}
                                  detail={t('ignoreCudaMismatchDetail')}
                                  checked={ignoreCudaMismatch}
                                  onChange={(checked) => void updateIgnoreCudaMismatchSetting(checked)}
                                />
                              )}
                              <div className="runtimeGrid">
                                {runtimeStatusRows.map((row) => (
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
                          className={`settingsGroupCard${activeSettingsJumpTarget === 'whisper-model' ? ' settingsJumpTargetActive' : ''}`}
                          ref={whisperModelSettingsRef}
                          tabIndex={-1}
                        >
                          <InspectorSection icon={<HardDriveDownload size={16} />} title={t('whisperModel')}>
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
                                    {model.displayName} · {describeModelFootprint(model, t)} ·{' '}
                                    {model.installed ? t('installed') : t('missing')}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="settingsActionRow">
                              <button
                                className="secondary compact settingsActionButton"
                                disabled={runtimeOperation === 'model-check' || runtimeOperation === 'model'}
                                onClick={() => void checkSelectedModel()}
                              >
                                <Search size={16} />
                                {runtimeOperation === 'model-check' ? t('checking') : t('checkModel')}
                              </button>
                              <button
                                className="secondary compact settingsActionButton"
                                disabled={
                                  runtimeOperation === 'model-check' ||
                                  runtimeOperation === 'model' ||
                                  !settings.allowWhisperAssetDownload ||
                                  selectedModelVerified
                                }
                                onClick={() => void downloadSelectedModel()}
                              >
                                <HardDriveDownload size={16} />
                                {runtimeOperation === 'model' ? t('downloadProgress') : t('downloadModel')}
                              </button>
                            </div>
                            <div className="modelCard">
                              <div>
                                <span
                                  className={
                                    selectedModelVerified ? 'signal good' : selectedModelInstalled ? 'signal warn' : 'signal'
                                  }
                                />
                                <strong>{selectedModel?.displayName ?? t('whisperModel')}</strong>
                                <small>{selectedModel ? describeModelFootprint(selectedModel, t) : t('missing')}</small>
                              </div>
                              {selectedModel && (
                                <div className="modelMetaRow">
                                  {selectedModel.sizeBytes > 0 && (
                                    <span className="modelMetaChip">
                                      {t('modelSizeLabel')}: {formatBytes(selectedModel.sizeBytes)}
                                    </span>
                                  )}
                                  {selectedModel.estimatedVramBytes && (
                                    <span className="modelMetaChip">
                                      {t('estimatedVramLabel')}: {formatBytes(selectedModel.estimatedVramBytes)}
                                    </span>
                                  )}
                                </div>
                              )}
                              {selectedModelStatus && (
                                <p title={selectedModelStatus.message}>
                                  {t(modelActionLabel(selectedModelStatus.actionRequired))}
                                  {' · '}
                                  {t('runtimeModel')}: {selectedModelStatus.verified ? t('installed') : t('missing')}
                                </p>
                              )}
                              {modelActivity && <p title={modelActivity}>{modelActivity}</p>}
                            </div>
                          </InspectorSection>
                        </div>
                      </div>
                    )}

                    {usingFasterWhisper && (
                      <div className="settingsShelf twoUp">
                        <div
                          className={`settingsGroupCard settingsGroupCardAccent${activeSettingsJumpTarget === 'cuda' ? ' settingsJumpTargetActive' : ''}`}
                          ref={cudaSettingsRef}
                          tabIndex={-1}
                        >
                          <InspectorSection icon={<Gauge size={16} />} title={t('acceleration')}>
                            <div className="modelCard accentCard">
                              <div>
                                <span
                                  className={
                                    asrHealth?.acceleration?.selected === 'gpu'
                                      ? 'signal good'
                                      : fasterWhisperCudaStatus?.hardwareDetected
                                        ? 'signal warn'
                                        : 'signal accent'
                                  }
                                />
                                <strong>{t('acceleration')}</strong>
                                <small>{fasterWhisperCudaDetail}</small>
                              </div>
                              <label>
                                {t('acceleration')}
                                <select
                                  value={configuredAcceleration}
                                  onChange={(event) =>
                                    void updateLocalAsrAccelerationSetting(
                                      event.target.value as AppSettingsPublic['localAsrAcceleration']
                                    )
                                  }
                                >
                                  {(['auto', 'cpu', 'gpu'] as const).map((option) => (
                                    <option key={option} value={option}>
                                      {t(accelerationOptionLabel(option))}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {runtimeVariantSelections.length > 0 && (
                                <label>
                                  {t('runtimeVariant')}
                                  <select
                                    value={effectiveRuntimeVariantSelection}
                                    onChange={(event) =>
                                      void updateLocalRuntimeVariantSetting(event.target.value as RuntimeVariantSelection)
                                    }
                                  >
                                    {runtimeVariantSelections.map((option) => (
                                      <option key={option} value={option}>
                                        {t(runtimeVariantOptionLabel(option))}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {cudaFlowRelevant && (
                                <div className="settingsActionRow">
                                  <button
                                    className="secondary compact settingsActionButton"
                                    disabled={runtimeOperation === 'cuda-check' || runtimeOperation === 'cuda-download'}
                                    onClick={() => void checkFasterWhisperCuda()}
                                  >
                                    <Search size={16} />
                                    {runtimeOperation === 'cuda-check' ? t('checking') : t('checkCuda')}
                                  </button>
                                  {showFasterWhisperCudaDownload && (
                                    <button
                                      className="secondary compact settingsActionButton"
                                      disabled={runtimeOperation === 'cuda-check' || runtimeOperation === 'cuda-download'}
                                      onClick={() => void downloadFasterWhisperCudaRuntime()}
                                    >
                                      <HardDriveDownload size={16} />
                                      {runtimeOperation === 'cuda-download' ? t('downloadProgress') : t('downloadCudaRuntime')}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="runtimeGrid">
                                {runtimeStatusRows.map((row) => (
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
                          className={`settingsGroupCard settingsGroupCardAccent${activeSettingsJumpTarget === 'whisper-model' ? ' settingsJumpTargetActive' : ''}`}
                          ref={whisperModelSettingsRef}
                          tabIndex={-1}
                        >
                          <InspectorSection icon={<HardDriveDownload size={16} />} title={t('whisperModel')}>
                            <label>
                              {t('whisperModel')}
                              <select
                                value={settings.whisperModelId}
                                onChange={(event) => void updateSettings({ whisperModelId: event.target.value })}
                              >
                                {models.map((model) => (
                                  <option key={model.id} value={model.id}>
                                    {model.displayName} · {describeModelFootprint(model, t)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="modelCard accentCard">
                              <div>
                                <span className="signal accent" />
                                <strong>{selectedModel?.displayName ?? t('whisperModel')}</strong>
                                <small>{selectedModel ? describeModelFootprint(selectedModel, t) : t('whisperModel')}</small>
                              </div>
                              {selectedModel && (
                                <div className="modelMetaRow">
                                  {selectedModel.estimatedVramBytes && (
                                    <span className="modelMetaChip">
                                      {t('estimatedVramLabel')}: {formatBytes(selectedModel.estimatedVramBytes)}
                                    </span>
                                  )}
                                </div>
                              )}
                              <p>{t('fasterWhisperPythonDetail')}</p>
                            </div>
                          </InspectorSection>
                        </div>
                      </div>
                    )}

                    {settings.asrProviderId === 'cloud.openai' && (
                      renderProviderApiSettings('cloud.openai')
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
                      className={`settingsGroupCard${activeSettingsJumpTarget === 'translation-provider' ? ' settingsJumpTargetActive' : ''}`}
                      ref={translationProviderSettingsRef}
                      tabIndex={-1}
                    >
                      <InspectorSection icon={<Languages size={16} />} title={t('translationProvider')}>
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
                      </InspectorSection>
                    </div>

                    {translationProviderId === 'openai.compatible' && (
                      <>
                        {renderProviderApiSettings('openai.compatible')}

                        <div className="settingsGroupCard">
                          <InspectorSection icon={<SlidersHorizontal size={16} />} title={t('translationRateLimits')}>
                            <p className="settingsMicrocopy">{t('translationRateLimitsDetail')}</p>
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

function SettingsOverviewCard(props: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
  tone: HealthTone;
  featured?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const className = [
    'settingsOverviewCard',
    'settingsSummaryCard',
    `tone-${props.tone}`,
    props.featured ? 'featured' : '',
    props.onClick ? 'interactive' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <div className="settingsOverviewTop">
        <span className={`signal ${props.tone}`} />
        <span className="settingsOverviewEyebrow">{props.eyebrow}</span>
        <div className="settingsOverviewIcon">{props.icon}</div>
      </div>
      <strong title={props.title}>{props.title}</strong>
      <p title={props.detail}>{props.detail}</p>
      {props.onClick && (
        <div className="settingsSummaryCardFooter">
          <span className="settingsCardAction">
            {t('jumpToSettings')}
            <ArrowUpRight size={14} />
          </span>
        </div>
      )}
    </>
  );

  if (props.onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={props.onClick}
        aria-label={`${props.eyebrow} · ${t('jumpToSettings')}`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function SettingsFactCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone: HealthTone;
  onClick?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const className = ['settingsFactCard', 'settingsSummaryCard', `tone-${props.tone}`, props.onClick ? 'interactive' : '']
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <div className="settingsFactCardTop">
        <span className={`signal ${props.tone}`} />
        <span className="settingsOverviewEyebrow">{props.label}</span>
        <div className="settingsOverviewIcon">{props.icon}</div>
      </div>
      <strong className={props.tone} title={props.value}>
        {props.value}
      </strong>
      {props.detail && <p title={props.detail}>{props.detail}</p>}
      {props.onClick && (
        <div className="settingsSummaryCardFooter">
          <span className="settingsCardAction">
            {t('jumpToSettings')}
            <ArrowUpRight size={14} />
          </span>
        </div>
      )}
    </>
  );

  if (props.onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={props.onClick}
        aria-label={`${props.label} · ${t('jumpToSettings')}`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
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
  actionDisabled?: boolean;
  onTest: () => void;
  actionLabel?: string;
  secondaryActionLabel?: string;
  secondaryActionLoading?: boolean;
  secondaryActionDisabled?: boolean;
  onSecondaryAction?: () => void;
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
      <div className="settingsActionRow">
        <button className="secondary compact settingsActionButton" disabled={props.loading || props.actionDisabled} onClick={props.onTest}>
          <CheckCircle2 size={16} />
          {props.loading ? t('checking') : (props.actionLabel ?? t('test'))}
        </button>
        {props.onSecondaryAction && props.secondaryActionLabel && (
          <button
            className="secondary compact settingsActionButton"
            disabled={props.secondaryActionDisabled}
            onClick={props.onSecondaryAction}
          >
            <HardDriveDownload size={16} />
            {props.secondaryActionLoading ? t('downloadProgress') : props.secondaryActionLabel}
          </button>
        )}
      </div>
      {props.showMessage !== false && props.health?.message && <p title={props.health.message}>{props.health.message}</p>}
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  revealable?: boolean;
  showToggleLabel?: string;
  hideToggleLabel?: string;
}): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const effectiveType = props.revealable ? (revealed ? 'text' : props.type ?? 'password') : props.type ?? 'text';
  return (
    <label>
      {props.label}
      <div className="textFieldControl">
        <input
          className="textFieldInput"
          type={effectiveType}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {props.revealable ? (
          <button
            type="button"
            className="textFieldActionButton"
            aria-label={revealed ? props.hideToggleLabel ?? 'Hide' : props.showToggleLabel ?? 'Show'}
            title={revealed ? props.hideToggleLabel ?? 'Hide' : props.showToggleLabel ?? 'Show'}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{revealed ? props.hideToggleLabel ?? 'Hide' : props.showToggleLabel ?? 'Show'}</span>
          </button>
        ) : null}
      </div>
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

function modelActionLabel(action: WhisperModelStatus['actionRequired'] = 'none'): string {
  return `runtimeAction.${action}`;
}

function exportDestinationModeLabel(mode: ExportDestinationMode): string {
  return `exportDestination.${mode}`;
}

function assetEventLabel(event: AssetEvent, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (event.type) {
    case 'download-start':
      return event.scope === 'ffmpeg' ? t('ffmpegDownloading') : t('runtimeDownloading');
    case 'download-progress':
      return event.receivedBytes
        ? t(event.scope === 'ffmpeg' ? 'ffmpegDownloadingBytes' : 'runtimeDownloadingBytes', {
            bytes: formatBytes(event.receivedBytes)
          })
        : t(event.scope === 'ffmpeg' ? 'ffmpegDownloading' : 'runtimeDownloading');
    case 'verify':
      return t(event.scope === 'ffmpeg' ? 'ffmpegVerifying' : 'runtimeVerifying');
    case 'extract':
      return t(event.scope === 'ffmpeg' ? 'ffmpegExtracting' : 'runtimeExtracting');
    case 'ready':
      return t(event.scope === 'ffmpeg' ? 'ffmpegReady' : 'runtimeReady');
    case 'error':
      return event.message || t(event.scope === 'ffmpeg' ? 'ffmpegError' : 'runtimeError');
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
    case 'local.faster-whisper':
      return t('localFasterWhisperProvider');
    case 'cloud.openai':
      return t('cloudOpenaiProvider');
    case 'openai.compatible':
      return t('openaiCompatibleProvider');
    default:
      return providerId;
  }
}

function accelerationOptionLabel(acceleration: AppSettingsPublic['localAsrAcceleration']): string {
  switch (acceleration) {
    case 'cpu':
      return 'cpuOption';
    case 'gpu':
      return 'gpuOption';
    default:
      return 'autoOption';
  }
}

function runtimeVariantOptionLabel(variant: RuntimeVariantSelection): string {
  switch (variant) {
    case 'cpu':
      return 'cpuOption';
    case 'cuda':
      return 'runtimeVariantCuda';
    case 'metal':
      return 'runtimeVariantMetal';
    case 'vulkan':
      return 'runtimeVariantVulkan';
    default:
      return 'autoOption';
  }
}

function buildWhisperRuntimeStatusRows(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  requestedAcceleration: AppSettingsPublic['localAsrAcceleration'];
  requestedVariant: RuntimeVariantSelection;
}): RuntimeStatusRow[] {
  const { t, runtimeStatus, requestedAcceleration, requestedVariant } = input;

  return [
    { label: t('provider'), value: 'whisper.cpp', tone: 'accent' },
    {
      label: t('requestedAcceleration'),
      value: t(accelerationOptionLabel(runtimeStatus?.acceleration.requested ?? requestedAcceleration)),
      tone: 'accent'
    },
    {
      label: t('selectedAcceleration'),
      value: runtimeStatus ? t(accelerationOptionLabel(runtimeStatus.acceleration.selected)) : t('notChecked'),
      tone:
        runtimeStatus?.acceleration.selected === 'gpu'
          ? isExperimentalWhisperRuntimeVariant(runtimeStatus.acceleration.runtimeVariant)
            ? 'warn'
            : 'good'
          : runtimeStatus
            ? 'accent'
            : 'muted'
    },
    {
      label: t('runtimeVariant'),
      value: t(runtimeVariantOptionLabel(runtimeStatus?.acceleration.runtimeVariant ?? requestedVariant)),
      tone:
        runtimeStatus?.acceleration.runtimeVariant === 'cuda' || runtimeStatus?.acceleration.runtimeVariant === 'metal'
          ? 'good'
          : runtimeStatus?.acceleration.runtimeVariant === 'vulkan'
            ? 'warn'
          : runtimeStatus
            ? 'accent'
            : 'muted'
    },
    {
      label: t('fallbackReason'),
      value: runtimeStatus?.acceleration.fallbackReason
        ? fallbackReasonLabel(runtimeStatus.acceleration.fallbackReason, t, requestedVariant)
        : t('none'),
      tone: runtimeStatus?.acceleration.fallbackReason ? 'warn' : 'muted'
    },
    {
      label: t('binaryVerified'),
      value: runtimeStatus ? t(runtimeStatus.binary.verified ? 'verified' : 'notVerified') : t('notChecked'),
      tone: runtimeStatus?.binary.verified ? 'good' : runtimeStatus ? 'warn' : 'muted'
    },
    {
      label: t('modelVerified'),
      value: runtimeStatus ? t(runtimeStatus.model.verified ? 'verified' : 'notVerified') : t('notChecked'),
      tone: runtimeStatus?.model.verified ? 'good' : runtimeStatus ? 'warn' : 'muted'
    }
  ];
}

function buildFasterWhisperRuntimeStatusRows(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  acceleration?: ProviderHealth['acceleration'];
  requestedAcceleration: AppSettingsPublic['localAsrAcceleration'];
  requestedVariant: RuntimeVariantSelection;
}): RuntimeStatusRow[] {
  const { t, acceleration, requestedAcceleration, requestedVariant } = input;

  return [
    { label: t('provider'), value: 'faster-whisper', tone: 'accent' },
    {
      label: t('requestedAcceleration'),
      value: t(accelerationOptionLabel(acceleration?.requested ?? requestedAcceleration)),
      tone: 'accent'
    },
    {
      label: t('selectedAcceleration'),
      value: acceleration ? t(accelerationOptionLabel(acceleration.selected)) : t('notChecked'),
      tone: acceleration?.selected === 'gpu' ? 'good' : acceleration ? 'accent' : 'muted'
    },
    {
      label: t('runtimeVariant'),
      value: t(runtimeVariantOptionLabel(acceleration?.runtimeVariant ?? requestedVariant)),
      tone: acceleration?.runtimeVariant === 'cuda' ? 'good' : acceleration ? 'accent' : 'muted'
    },
    {
      label: t('fallbackReason'),
      value: acceleration?.fallbackReason ? fallbackReasonLabel(acceleration.fallbackReason, t, requestedVariant) : t('none'),
      tone: acceleration?.fallbackReason ? 'warn' : 'muted'
    }
  ];
}

function summarizeJobEventForLog(event: JobEvent): Record<string, unknown> {
  if (event.type === 'snapshot') {
    return {
      type: event.type,
      jobId: event.job.id,
      stage: event.job.stage,
      step: event.job.step,
      progress: event.job.progress
    };
  }
  if (event.type === 'progress') {
    return {
      type: event.type,
      jobId: event.jobId,
      stage: event.stage,
      progress: event.progress,
      message: event.message
    };
  }
  return {
    type: event.type,
    jobId: event.jobId,
    code: event.code,
    message: event.message,
    retryable: event.retryable
  };
}

function describeDomTarget(target: EventTarget | null): Record<string, unknown> {
  if (!(target instanceof HTMLElement)) {
    return {
      tag: 'unknown'
    };
  }

  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || undefined,
    role: target.getAttribute('role') || undefined,
    name: target.getAttribute('name') || undefined,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    text: target.textContent?.trim().slice(0, 80) || undefined,
    classes: target.className || undefined
  };
}

function describeDomValue(target: EventTarget | null): unknown {
  if (target instanceof HTMLInputElement) {
    if (target.type === 'checkbox' || target.type === 'radio') {
      return target.checked;
    }
    if (target.type === 'password') {
      return '[REDACTED]';
    }
    return target.value;
  }
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
    return target.value;
  }
  return undefined;
}

function deriveWorkspaceRailMessage(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  asrProviderId: string;
  activeDownload?: ActiveDownload;
  footerTitle: string;
  stage: JobStage;
  sourceLabel: string;
  targetLabel: string;
}): string {
  const { t, asrProviderId, activeDownload, footerTitle, stage, sourceLabel, targetLabel } = input;
  if (activeDownload) {
    return footerTitle;
  }
  if (stage !== 'idle') {
    return t('workspaceActiveSummary', {
      asr: providerLabel(asrProviderId, t),
      stage: t(stageLabel(stage))
    });
  }
  return t('workspaceIdleSummary', {
    asr: providerLabel(asrProviderId, t),
    source: sourceLabel,
    target: targetLabel
  });
}

function deriveWorkspaceRuntimeDetail(input: {
  t: (key: string) => string;
  asrProviderId: string;
  asrHealth?: ProviderHealth;
  runtimeState: DerivedHealthState;
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
}): string {
  const { t, asrProviderId, asrHealth, runtimeState, ffmpegStatus, nativeHealth } = input;
  const ffmpegAvailable = ffmpegStatus?.available ?? Boolean(nativeHealth?.ffmpegAvailable && nativeHealth?.ffprobeAvailable);
  if (!ffmpegAvailable || asrProviderId !== 'local.faster-whisper') {
    return runtimeState.detail;
  }
  if (!asrHealth) {
    return t('fasterWhisperWorkspaceSetupHint');
  }
  switch (
    deriveFasterWhisperWorkspaceMode({
      ok: asrHealth.ok,
      status: asrHealth.status,
      acceleration: asrHealth.acceleration
    })
  ) {
    case 'cuda-ready':
      return t('fasterWhisperWorkspaceReadyCuda');
    case 'cpu-ready':
      return t('fasterWhisperWorkspaceReadyCpu');
    case 'cuda-fallback':
      return t('fasterWhisperWorkspaceCudaFallback');
    default:
      return t('fasterWhisperWorkspaceSetupHint');
  }
}

function describeLocalWhisperTestResult(status: WhisperRuntimeStatus, t: (key: string) => string): string {
  if (status.actionRequired === 'unsupported-platform') {
    return t(runtimeActionLabel(status.actionRequired));
  }
  if (!status.binary.verified) {
    return t('runtimeBinaryMissingDetail');
  }
  if (!status.model.verified) {
    return t('runtimeModelMissingDetail');
  }
  return describeWhisperAccelerationDetail(status, t);
}

function describeSelectedModelResult(
  status: WhisperModelStatus,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (status.verified) {
    return t('modelReady');
  }
  if (status.installed) {
    return t('modelInstalledPendingCheck');
  }
  if (status.actionRequired === 'manifest-not-configured') {
    return t(modelActionLabel(status.actionRequired));
  }
  return t('runtimeModelMissingDetail');
}

function describeCudaStatusDetail(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  ignoreMismatch = false
): string {
  if (!status) return t('runtimeNotChecked');
  if (status.acceleration.cudaSupported) {
    return status.acceleration.versionMismatch ? t('cudaDetectedIgnoredMismatch') : t('cudaDetected');
  }
  if (hasBlockingCudaMismatch(status, ignoreMismatch)) {
    return t('cudaRuntimeMismatchWithVersion', {
      required: status.acceleration.requiredCudaVersion ?? 'unknown',
      current: status.acceleration.runtimeCudaVersion ?? 'unknown'
    });
  }
  if (status.acceleration.hardwareDetected && !status.acceleration.runtimeDetected) {
    return t('cudaRuntimeMissing');
  }
  if (!status.acceleration.hardwareDetected) {
    return t('cudaNoHardware');
  }
  return fallbackReasonLabel(status.acceleration.fallbackReason, t, 'cuda');
}

function describeWhisperAccelerationDetail(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  ignoreMismatch = false
): string {
  if (!status) return t('runtimeNotChecked');
  if (status.acceleration.selected === 'gpu') {
    switch (status.acceleration.runtimeVariant) {
      case 'cuda':
        return describeCudaStatusDetail(status, t, ignoreMismatch);
      case 'metal':
        return t('metalDetected');
      case 'vulkan':
        return t('vulkanExperimental');
      default:
        return t('gpuDetected');
    }
  }
  if (status.acceleration.fallbackReason) {
    return fallbackReasonLabel(status.acceleration.fallbackReason, t);
  }
  return t('runtimeReady');
}

function describeCudaStatusShort(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string,
  ignoreMismatch = false
): string {
  if (!status) return t('notChecked');
  if (status.acceleration.cudaSupported) return t('cudaDetectedShort');
  if (hasBlockingCudaMismatch(status, ignoreMismatch)) return t('versionMismatchShort');
  if (status.acceleration.hardwareDetected && !status.acceleration.runtimeDetected) return t('missingRuntimeShort');
  if (!status.acceleration.hardwareDetected) return t('cudaUnavailableShort');
  return t('cudaUnavailableShort');
}

function hasBlockingCudaMismatch(status: WhisperRuntimeStatus | undefined, ignoreMismatch = false): boolean {
  if (!status || ignoreMismatch) return false;
  const required = status.acceleration.requiredCudaVersion;
  const current = status.acceleration.runtimeCudaVersion;
  return Boolean(required && current && required !== current);
}

function fallbackReasonLabel(
  code: string | undefined,
  t: (key: string) => string,
  variant: RuntimeVariantSelection = 'auto'
): string {
  const isCudaVariant = variant === 'cuda';
  if (code === 'gpu-runtime-missing') return isCudaVariant ? t('cudaRuntimeMissing') : t('gpuUnavailable');
  if (code === 'gpu-not-detected') return isCudaVariant ? t('cudaNoHardware') : t('gpuNoHardware');
  if (
    code === 'gpu-not-compatible' ||
    code === 'preferred-variant-unavailable' ||
    code === 'gpu-variant-unavailable'
  ) {
    return isCudaVariant ? t('cudaUnavailable') : t('gpuUnavailable');
  }
  return isCudaVariant ? t('cudaUnavailable') : t('gpuUnavailable');
}

function describeFfmpegStatusDetail(
  status: FfmpegStatus | undefined,
  t: (key: string) => string
): string {
  if (!status) return t('ffmpegNotChecked');
  if (status.available) {
    return status.source === 'managed' ? t('ffmpegManagedReadyDetail') : t('ffmpegSystemReadyDetail');
  }
  if (status.ffmpegAvailable && !status.ffprobeAvailable) {
    return t('ffprobeMissingDetail');
  }
  if (!status.ffmpegAvailable && status.ffprobeAvailable) {
    return t('ffmpegBinaryMissingDetail');
  }
  return t('ffmpegMissingDetail');
}

function describeFfmpegLocation(
  status: FfmpegStatus,
  t: (key: string) => string
): string {
  if (status.source === 'managed') {
    return t('ffmpegManagedLocation');
  }
  if (status.source === 'system') {
    return t('ffmpegSystemLocation');
  }
  return t('ffmpegMissingDetail');
}

function deriveWorkflowWarnings(job?: JobSnapshot): SubtitleWarning[] {
  if (!job) return [];

  const segments = job.subtitleDocument?.segments ?? [];
  const warnings = [...(job.warnings ?? []), ...(job.subtitleDocument?.metadata.warnings ?? [])];
  const seen = new Set<string>();

  return warnings
    .map((warning, index) => enrichWarning(warning, segments, index))
    .filter((warning) => {
      if (!isActionableWorkflowWarning(warning)) {
        return false;
      }
      const key = warningFingerprint(warning);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isActionableWorkflowWarning(warning: SubtitleWarning): boolean {
  return warning.code !== 'NativeFasterWhisperRuntime';
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

function warningFingerprint(warning: SubtitleWarning): string {
  return [
    warning.code.trim(),
    warning.message.trim().toLowerCase(),
    warning.batchId ?? '',
    warning.segmentId ?? '',
    warning.startIndex ?? '',
    warning.endIndex ?? '',
    warning.startMs ?? '',
    warning.endMs ?? ''
  ].join('|');
}

function warningSummaryLabel(warning: SubtitleWarning, t: (key: string) => string): string {
  if (warning.stage === 'translate') return t('warningFallbackSummary');
  switch (warning.code) {
    case 'CudaFallback':
    case 'CudaTranscriptionCrashFallback':
      return t('warningSummaryCudaFallback');
    case 'NativeCapabilityUnavailable':
      return t('warningSummaryBackendCapability');
    case 'ParseError':
      return t('warningSummarySubtitleParse');
    case 'InvalidTiming':
      return t('warningSummaryInvalidTiming');
    case 'EmptyText':
      return t('warningSummaryEmptySubtitle');
    case 'TimingOverlap':
      return t('warningSummaryTimingOverlap');
    default:
      return humanizeWarningCode(warning.code);
  }
}

function deriveWarningHint(
  warning: SubtitleWarning | undefined,
  t: (key: string) => string
): string {
  if (warning?.stage === 'translate') {
    return t('warningFallbackHint');
  }
  return t('warningReviewHint');
}

function warningCategoryLabel(warning: SubtitleWarning, t: (key: string) => string): string {
  if (warning.stage === 'translate') return t('warningCategoryTranslation');
  if (warning.stage === 'asr') return t('warningCategoryRecognition');
  if (warning.stage === 'subtitle') return t('warningCategorySubtitles');
  if (warning.stage === 'export') return t('warningCategoryExport');
  if (isSubtitleWarningCode(warning.code)) return t('warningCategorySubtitles');
  if (isRuntimeWarningCode(warning.code)) return t('warningCategoryRuntime');
  return t('warningCategoryWorkflow');
}

function warningSourceLabel(
  warning: SubtitleWarning,
  asrProviderId: string,
  translationProviderId: string,
  t: (key: string) => string
): string {
  if (warning.providerId) return providerLabel(warning.providerId, t);
  if (warning.stage === 'translate') return providerLabel(translationProviderId, t);
  if (warning.stage === 'asr') return providerLabel(asrProviderId, t);
  if (warning.stage === 'export') return t('export');
  if (isSubtitleWarningCode(warning.code)) return t('warningSourceSubtitleParser');
  if (warning.code === 'NativeCapabilityUnavailable') return t('summaryDesktopBackend');
  if (isRuntimeWarningCode(warning.code)) return t('warningSourceLocalRuntime');
  return t('warningSourceWorkflow');
}

function isSubtitleWarningCode(code: string): boolean {
  return ['ParseError', 'InvalidTiming', 'EmptyText', 'TimingOverlap'].includes(code);
}

function isRuntimeWarningCode(code: string): boolean {
  return [
    'download-runtime',
    'download-model',
    'download-cuda-runtime',
    'manifest-not-configured',
    'unsupported-platform',
    'pin-manifest-hashes'
  ].includes(code);
}

function humanizeWarningCode(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\bCpu\b/g, 'CPU')
    .replace(/\bCuda\b/g, 'CUDA')
    .replace(/\bAsr\b/g, 'ASR')
    .replace(/\bFfmpeg\b/g, 'FFmpeg')
    .replace(/\bWhisper\b/g, 'Whisper')
    .replace(/^./, (value) => value.toUpperCase());
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

function deriveAsrProviderState(input: {
  t: (key: string) => string;
  asrProviderId: string;
  description: string;
  health?: ProviderHealth;
  runtimeState: DerivedHealthState;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, asrProviderId, description, health, runtimeState, job } = input;
  if (asrProviderId === 'local.whisper.cpp') {
    return runtimeState;
  }
  if (job?.stage === 'failed' && job.error && (job.step === 'asr' || job.step === 'subtitles')) {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: description
    };
  }
  if (health.ok) {
    return {
      tone: 'good',
      label: t(providerStatusLabel(health.status)),
      detail: health.message ?? description
    };
  }
  return {
    tone: health.status === 'degraded' ? 'warn' : 'error',
    label: t(providerStatusLabel(health.status)),
    detail: health.message ?? description
  };
}

function deriveFfmpegState(input: {
  t: (key: string) => string;
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
}): DerivedHealthState {
  const { t, ffmpegStatus, nativeHealth } = input;
  if (!ffmpegStatus && !nativeHealth) {
    return { tone: 'muted', label: t('notChecked'), detail: t('ffmpegNotChecked') };
  }

  const ffmpegAvailable = ffmpegStatus?.ffmpegAvailable ?? Boolean(nativeHealth?.ffmpegAvailable);
  const ffprobeAvailable = ffmpegStatus?.ffprobeAvailable ?? Boolean(nativeHealth?.ffprobeAvailable);
  const available = ffmpegStatus?.available ?? Boolean(ffmpegAvailable && ffprobeAvailable);
  if (available) {
    return {
      tone: 'good',
      label: t('installed'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  if (ffmpegAvailable || ffprobeAvailable) {
    return {
      tone: 'warn',
      label: t('degraded'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  return {
    tone: 'error',
    label: t('missing'),
    detail: t('ffmpegMissingDetail')
  };
}

function deriveNativeBackendState(input: {
  t: (key: string, options?: Record<string, unknown>) => string;
  health?: NativeHealth;
}): DerivedHealthState {
  const { t, health } = input;
  if (!health) {
    return {
      tone: 'muted',
      label: t('notChecked'),
      detail: t('runtimeNotChecked')
    };
  }

  if (health.status === 'ok') {
    return {
      tone: 'good',
      label: t('ok'),
      detail: t('nativeBackendReadyDetail', { version: health.backendVersion })
    };
  }

  if (health.detail?.trim()) {
    return {
      tone: 'warn',
      label: t('degraded'),
      detail: health.detail
    };
  }

  const issues: string[] = [];
  if (!health.ffmpegAvailable && !health.ffprobeAvailable) {
    issues.push(t('nativeBackendMissingFfmpegPair'));
  } else {
    if (!health.ffmpegAvailable) issues.push(t('nativeBackendMissingFfmpeg'));
    if (!health.ffprobeAvailable) issues.push(t('nativeBackendMissingFfprobe'));
  }
  if (!health.capabilities.includes('asr.transcribe')) {
    issues.push(t('nativeBackendMissingAsrCapability'));
  }
  if (!health.capabilities.includes('audio.extract')) {
    issues.push(t('nativeBackendMissingAudioCapability'));
  }
  if (health.hardwareAcceleration === 'unknown') {
    issues.push(t('nativeBackendAccelerationUnknown'));
  }
  if (health.capabilities.length === 1 && health.capabilities[0] === 'runtime.health') {
    issues.unshift(t('nativeBackendFallbackDetail'));
  }

  return {
    tone: 'warn',
    label: t('degraded'),
    detail: issues[0] ?? t('nativeBackendGenericDegraded')
  };
}

function shouldRetryNativeHealth(health: NativeHealth): boolean {
  if (health.status !== 'degraded') return false;
  if (health.capabilities.length === 1 && health.capabilities[0] === 'runtime.health') {
    return true;
  }
  const detail = health.detail?.toLowerCase() ?? '';
  return detail.includes('timed out') || detail.includes('exited unexpectedly') || detail.includes('failed to');
}

function deriveRuntimeState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  ffmpegStatus?: FfmpegStatus;
  nativeHealth?: NativeHealth;
  asrProviderId: string;
  asrHealth?: ProviderHealth;
  job?: JobSnapshot;
}): DerivedHealthState {
  const { t, runtimeStatus, ffmpegStatus, nativeHealth, asrProviderId, asrHealth, job } = input;
  if (job?.stage === 'failed' && job.error && (job.step === 'asr' || job.step === 'subtitles')) {
    return { tone: 'error', label: t('error'), detail: job.error.message };
  }
  const ffmpegAvailable = ffmpegStatus?.available ?? Boolean(nativeHealth?.ffmpegAvailable && nativeHealth?.ffprobeAvailable);
  if (!ffmpegAvailable) {
    return {
      tone: ffmpegStatus || nativeHealth ? 'error' : 'muted',
      label: t(ffmpegStatus || nativeHealth ? 'missing' : 'notChecked'),
      detail: describeFfmpegStatusDetail(ffmpegStatus, t)
    };
  }
  if (asrProviderId === 'local.faster-whisper') {
    if (!asrHealth) {
      return {
        tone: 'muted',
        label: t('notChecked'),
        detail: t('fasterWhisperPythonDetail')
      };
    }
    if (asrHealth.ok) {
      return {
        tone: 'good',
        label: t(providerStatusLabel(asrHealth.status)),
        detail: asrHealth.message ?? t('providerReady')
      };
    }
    return {
      tone: asrHealth.status === 'degraded' ? 'warn' : 'error',
      label: t(providerStatusLabel(asrHealth.status)),
      detail: asrHealth.message ?? t('fasterWhisperPythonDetail')
    };
  }
  if (asrProviderId !== 'local.whisper.cpp') {
    if (!asrHealth) {
      return {
        tone: 'muted',
        label: t('notChecked'),
        detail: t('cloudProviderDetail')
      };
    }
    if (asrHealth.ok) {
      return {
        tone: 'good',
        label: t(providerStatusLabel(asrHealth.status)),
        detail: asrHealth.message ?? t('cloudProviderDetail')
      };
    }
    return {
      tone: asrHealth.status === 'degraded' ? 'warn' : 'error',
      label: t(providerStatusLabel(asrHealth.status)),
      detail: asrHealth.message ?? t('cloudProviderDetail')
    };
  }
  if (!runtimeStatus) {
    return { tone: 'muted', label: t('notChecked'), detail: t('runtimeNotChecked') };
  }
  const experimentalGpuPath =
    runtimeStatus.acceleration.selected === 'gpu' &&
    isExperimentalWhisperRuntimeVariant(runtimeStatus.acceleration.runtimeVariant);
  if (runtimeStatus.binary.verified && runtimeStatus.model.verified) {
    return {
      tone: experimentalGpuPath ? 'warn' : 'good',
      label: t(experimentalGpuPath ? 'experimental' : 'installed'),
      detail: describeWhisperAccelerationDetail(runtimeStatus, t)
    };
  }
  if (!runtimeStatus.binary.verified) {
    return {
      tone: runtimeStatus.binary.installed ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired ?? 'download-runtime')),
      detail:
        runtimeStatus.actionRequired === 'manifest-not-configured' ||
        runtimeStatus.actionRequired === 'unsupported-platform' ||
        runtimeStatus.actionRequired === 'pin-manifest-hashes'
          ? t(runtimeActionLabel(runtimeStatus.actionRequired))
          : t('runtimeBinaryMissingDetail')
    };
  }
  if (!runtimeStatus.model.verified) {
    return {
      tone: runtimeStatus.model.installed ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired ?? 'download-model')),
      detail:
        runtimeStatus.actionRequired === 'manifest-not-configured'
          ? t(runtimeActionLabel(runtimeStatus.actionRequired))
          : t('runtimeModelMissingDetail')
    };
  }
  const action = t(runtimeActionLabel(runtimeStatus.actionRequired));
  return {
    tone: runtimeStatus.binary.installed || runtimeStatus.model.installed ? 'warn' : 'error',
    label: action,
    detail: action
  };
}

function deriveBackendAccelerationState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, runtimeStatus, asrProviderId } = input;
  if (asrProviderId !== 'local.whisper.cpp') {
    return { tone: 'muted', label: t('unknown'), detail: t('localWhisperNotRequiredDetail') };
  }
  if (!runtimeStatus || !runtimeStatus.binary.verified || !runtimeStatus.model.verified) {
    return { tone: 'muted', label: t('unknown'), detail: t('runtimeNotChecked') };
  }

  const selectedVariant =
    runtimeStatus.acceleration.selected === 'gpu' ? runtimeStatus.acceleration.runtimeVariant : ('cpu' as const);

  if (runtimeStatus.acceleration.selected === 'gpu') {
    return {
      tone: isVerifiedWhisperGpuRuntimeVariant(selectedVariant) ? 'good' : 'warn',
      label: t(runtimeVariantOptionLabel(selectedVariant)),
      detail: describeWhisperAccelerationDetail(runtimeStatus, t)
    };
  }

  if (runtimeStatus.acceleration.requested === 'cpu') {
    return { tone: 'accent', label: t('cpuOption'), detail: t('gpuDisabledUsesCpu') };
  }

  return {
    tone: runtimeStatus.acceleration.fallbackReason ? 'warn' : 'accent',
    label: t('cpuOption'),
    detail: describeWhisperAccelerationDetail(runtimeStatus, t)
  };
}

function deriveRuntimeModelState(input: {
  t: (key: string) => string;
  runtimeStatus?: WhisperRuntimeStatus;
  selectedModelInstalled: boolean;
  selectedModelVerified: boolean;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, runtimeStatus, selectedModelInstalled, selectedModelVerified, asrProviderId } = input;
  if (asrProviderId !== 'local.whisper.cpp') {
    return { tone: 'muted', label: t('notRequired'), detail: t('localWhisperNotRequiredDetail') };
  }
  if (selectedModelVerified || runtimeStatus?.model.verified) {
    return { tone: 'good', label: t('installed'), detail: t('modelReady') };
  }
  if (selectedModelInstalled || runtimeStatus?.model.installed) {
    return { tone: 'warn', label: t('installed'), detail: t('modelInstalledPendingCheck') };
  }
  if (!runtimeStatus) {
    return { tone: 'muted', label: t('notChecked'), detail: t('runtimeNotChecked') };
  }
  if (runtimeStatus.actionRequired === 'manifest-not-configured') {
    return {
      tone: runtimeStatus.binary.verified ? 'warn' : 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired)),
      detail: t(runtimeActionLabel(runtimeStatus.actionRequired))
    };
  }
  if (runtimeStatus.actionRequired === 'unsupported-platform') {
    return {
      tone: 'error',
      label: t(runtimeActionLabel(runtimeStatus.actionRequired)),
      detail: t(runtimeActionLabel(runtimeStatus.actionRequired))
    };
  }
  return {
    tone: runtimeStatus.binary.verified ? 'warn' : 'error',
    label: t(runtimeActionLabel('download-model')),
    detail: t('runtimeModelMissingDetail')
  };
}

function deriveSelectedModelOverviewState(input: {
  t: (key: string) => string;
  selectedModel?: WhisperModelInfo;
  selectedModelInstalled: boolean;
  selectedModelVerified: boolean;
  asrProviderId: string;
}): DerivedHealthState {
  const { t, selectedModel, selectedModelInstalled, selectedModelVerified, asrProviderId } = input;
  const footprint = selectedModel ? describeModelFootprint(selectedModel, t) : undefined;
  if (asrProviderId !== 'local.whisper.cpp') {
    return {
      tone: 'muted',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: t('localWhisperNotRequiredDetail')
    };
  }
  if (selectedModelVerified) {
    return {
      tone: 'good',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: [t('modelReady'), footprint].filter(Boolean).join(' · ')
    };
  }
  if (selectedModelInstalled) {
    return {
      tone: 'warn',
      label: selectedModel?.displayName ?? t('whisperModel'),
      detail: [t('modelInstalledPendingCheck'), footprint].filter(Boolean).join(' · ')
    };
  }
  return {
    tone: 'muted',
    label: selectedModel?.displayName ?? t('whisperModel'),
    detail: [t('runtimeModelMissingDetail'), footprint].filter(Boolean).join(' · ')
  };
}

function localCpuModeLabel(mode: AppSettingsPublic['localAsrCpuMode']): string {
  switch (mode) {
    case 'low':
      return 'cpuModeLow';
    case 'high':
      return 'cpuModeHigh';
    case 'balanced':
    default:
      return 'cpuModeBalanced';
  }
}

function localCpuModeDetailLabel(mode: AppSettingsPublic['localAsrCpuMode']): string {
  switch (mode) {
    case 'low':
      return 'cpuModeLowDetail';
    case 'high':
      return 'cpuModeHighDetail';
    case 'balanced':
    default:
      return 'cpuModeBalancedDetail';
  }
}

function logLevelDetailLabel(level: AppLogLevel): string {
  switch (level) {
    case 'debug':
      return 'logLevelDebugDetail';
    case 'warning':
      return 'logLevelWarningDetail';
    case 'error':
      return 'logLevelErrorDetail';
    case 'info':
    default:
      return 'logLevelInfoDetail';
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

function describeModelFootprint(
  model: WhisperModelInfo,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const parts: string[] = [];
  if (model.sizeBytes > 0) {
    parts.push(formatBytes(model.sizeBytes));
  }
  if (model.estimatedVramBytes && model.estimatedVramBytes > 0) {
    parts.push(t('estimatedVramInline', { value: formatBytes(model.estimatedVramBytes) }));
  }
  return parts.join(' · ') || t('modelFootprintPending');
}

createRoot(document.getElementById('root')!).render(<App />);
