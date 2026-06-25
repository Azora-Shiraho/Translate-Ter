import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { i18n as I18n } from 'i18next';
import type {
  AppLogLevel,
  AppSettingsPublic,
  ExportDestinationMode,
  FasterWhisperCudaStatus,
  FfmpegStatus,
  NativeHealth,
  ProviderHealth,
  ProviderSecretInput,
  SubtitleFileFormat,
  WhisperModelInfo,
  WhisperModelStatus,
  WhisperRuntimeStatus
} from '@shared/types';
import type { AssetEvent } from '@shared/models';
import { translateTerGateway } from '../api/translateTerGateway';
import {
  buildIgnoreCudaMismatchPatch,
  buildLocalAsrSettingsPatch,
  deriveRuntimeVariantSelection,
  inferRuntimePlatformFamily,
  isCudaFlowRelevant,
  resolveAccelerationForVariantSelection,
  resolveVariantSelectionForAcceleration,
  listRuntimeVariantSelections,
  resolveSupportedRuntimeVariantSelection,
  type RuntimeVariantSelection
} from '../asrSettings';
import { useAssetEvents } from './useAssetEvents';
import type { ActiveDownload, SettingsJumpTarget, UiFeedback } from '../app/types';

type UseSettingsViewModelInput = {
  t: (key: string, options?: Record<string, unknown>) => string;
  i18n: I18n;
  feedback: UiFeedback;
};

export function useSettingsViewModel(input: UseSettingsViewModelInput) {
  const { t, i18n, feedback } = input;
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
  const [ffmpegActivity, setFfmpegActivity] = useState<string>();
  const [modelActivity, setModelActivity] = useState<string>();
  const [activeDownload, setActiveDownload] = useState<ActiveDownload>();
  const [runtimeOperation, setRuntimeOperation] =
    useState<
      'runtime-download' | 'ffmpeg-check' | 'ffmpeg-download' | 'cuda-check' | 'cuda-download' | 'model-check' | 'model'
    >();
  const [checkingProvider, setCheckingProvider] = useState<string>();
  const [activeSettingsJumpTarget, setActiveSettingsJumpTarget] = useState<SettingsJumpTarget>();
  const asrProviderSettingsRef = useRef<HTMLDivElement | null>(null);
  const ffmpegSettingsRef = useRef<HTMLDivElement | null>(null);
  const cudaSettingsRef = useRef<HTMLDivElement | null>(null);
  const whisperModelSettingsRef = useRef<HTMLDivElement | null>(null);
  const translationProviderSettingsRef = useRef<HTMLDivElement | null>(null);
  const settingsJumpResetRef = useRef<number>();
  const hostPlatform = translateTerGateway.host.platform;
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

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const nextSettings = await translateTerGateway.getSettings();
      const [nextModels, cloudAsrSecret, llmSecret] = await Promise.all([
        translateTerGateway.assets.listWhisperModels(nextSettings.asrProviderId),
        translateTerGateway.settings.getSecret('cloud.openai'),
        translateTerGateway.settings.getSecret('openai.compatible')
      ]);
      const nextFfmpegStatus = await translateTerGateway.assets
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
        feedback.setMessage(i18n.t('ready'));
        feedback.writeUiLog(
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

    return () => {
      mounted = false;
    };
  }, [feedback, i18n]);

  useEffect(() => {
    if (settings?.logLevel !== 'debug') return;

    const handleClick = (event: MouseEvent): void => {
      feedback.writeUiLog(
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
      feedback.writeUiLog(
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
  }, [feedback, settings?.logLevel]);

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
      const status = await translateTerGateway.assets
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
      const status = await translateTerGateway.assets
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
      const status = await translateTerGateway.assets
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

  const handleAssetEvent = useCallback(
    (event: AssetEvent) => {
      feedback.writeUiLog('debug', 'assets.event-received', event, 'renderer.assets');
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
      feedback.setMessage(nextMessage);
      if (event.type !== 'download-progress') {
        feedback.pushToast(nextMessage, toastToneForAssetEvent(event));
      }
      if (event.type === 'ready' || event.type === 'error') {
        void refreshModels();
      }
    },
    [feedback, i18n, settings?.asrProviderId]
  );

  useAssetEvents(handleAssetEvent);

  useEffect(() => {
    if (!settings?.asrProviderId) return;
    void refreshModels();
  }, [settings?.asrProviderId]);

  async function updateSettings(patch: Partial<AppSettingsPublic>): Promise<void> {
    feedback.writeUiLog('info', 'settings.update', { patch }, 'renderer.settings', 'Saving settings changes.');
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      const next = await translateTerGateway.saveSettings(patch);
      setSettings(next);
      if (patch.uiLanguage) {
        await i18n.changeLanguage(next.uiLanguage);
        feedback.setMessage(i18n.t('ready'));
      }
    } catch (error) {
      const nextMessage = feedback.reportUiError('settings.update-failed', error, { patch }, 'renderer.settings');
      feedback.pushStatus(nextMessage, 'error');
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
    const first = await translateTerGateway.native.health().catch(() => undefined);
    if (!first || !shouldRetryNativeHealth(first)) {
      return first;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    return (await translateTerGateway.native.health().catch(() => first)) ?? first;
  }

  async function refreshNativeHealth(): Promise<void> {
    setNativeHealth(await readNativeHealthWithRetry());
  }

  async function refreshModels(): Promise<void> {
    setModels(await translateTerGateway.assets.listWhisperModels(settings?.asrProviderId));
  }

  async function checkFfmpegTools(): Promise<void> {
    if (!settings) return;
    feedback.writeUiLog(
      'info',
      'ffmpeg.check',
      { multiThreadDownload: settings.enableMultiThreadDownload },
      'renderer.runtime'
    );
    setRuntimeOperation('ffmpeg-check');
    setActiveDownload(undefined);
    setFfmpegActivity(t('ffmpegChecking'));
    feedback.pushStatus(t('ffmpegChecking'));
    try {
      const status = await translateTerGateway.assets.ensureFfmpeg({
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFfmpegStatus(status);
      await refreshNativeHealth();
      const nextMessage = describeFfmpegStatusDetail(status, t);
      setFfmpegActivity(nextMessage);
      feedback.pushStatus(nextMessage, status.available ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('ffmpeg.check-failed', error, undefined, 'renderer.runtime');
      setFfmpegActivity(nextMessage);
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFfmpegTools(): Promise<void> {
    if (!settings) return;
    feedback.writeUiLog(
      'info',
      'ffmpeg.download',
      { multiThreadDownload: settings.enableMultiThreadDownload },
      'renderer.runtime'
    );
    setRuntimeOperation('ffmpeg-download');
    setActiveDownload(undefined);
    setFfmpegActivity(t('ffmpegChecking'));
    feedback.pushStatus(t('ffmpegChecking'));
    try {
      const status = await translateTerGateway.assets.ensureFfmpeg({
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFfmpegStatus(status);
      await refreshNativeHealth();
      const nextMessage = describeFfmpegStatusDetail(status, t);
      setFfmpegActivity(nextMessage);
      feedback.pushStatus(nextMessage, status.available ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('ffmpeg.download-failed', error, undefined, 'renderer.runtime');
      setFfmpegActivity(nextMessage);
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function refreshLocalWhisperRuntimeSnapshot(): Promise<void> {
    if (!settings) return;
    const status = await translateTerGateway.assets.ensureWhisperRuntime({
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
    feedback.writeUiLog('info', 'whisper.runtime.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeChecking'));
    const status = await translateTerGateway.assets.ensureWhisperRuntime({
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
    feedback.pushStatus(
      describeLocalWhisperTestResult(status, t),
      status.binary.verified && status.model.verified ? 'success' : 'warning'
    );
  }

  async function downloadLocalWhisperRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    feedback.writeUiLog('info', 'whisper.runtime.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('runtime-download');
    setActiveDownload(undefined);
    feedback.pushStatus(t('runtimeDownloading'));
    try {
      const status = await translateTerGateway.assets.ensureWhisperRuntime({
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
      feedback.pushStatus(nextMessage, status.binary.verified ? 'success' : 'warning');
    } catch (error) {
      feedback.pushStatus(
        feedback.reportUiError('whisper.runtime.download-failed', error, undefined, 'renderer.runtime'),
        'error'
      );
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFasterWhisperRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    feedback.writeUiLog(
      'info',
      'faster-whisper.runtime.download',
      { modelId: settings.whisperModelId },
      'renderer.runtime'
    );
    setRuntimeOperation('runtime-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeDownloading'));
    try {
      const health = await translateTerGateway.assets.ensureFasterWhisperRuntime({
        modelId: settings.whisperModelId,
        allowDownload: true,
        preferCuda: Boolean(settings.localWhisperUseCuda),
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: effectivePreferredRuntimeVariant,
        useMultiThreadDownload: settings.enableMultiThreadDownload,
        forceManaged: true
      });
      setProviderHealth((current) => ({ ...current, 'local.faster-whisper': health }));
      feedback.pushStatus(health.message ?? t('providerReady'), health.ok ? 'success' : 'warning');
    } catch (error) {
      feedback.pushStatus(
        feedback.reportUiError('faster-whisper.runtime.download-failed', error, undefined, 'renderer.runtime'),
        'error'
      );
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkFasterWhisperCuda(): Promise<void> {
    if (!settings) return;
    feedback.writeUiLog('info', 'faster-whisper.cuda.check', undefined, 'renderer.runtime');
    setRuntimeOperation('cuda-check');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeChecking'));
    try {
      const status = await translateTerGateway.assets.ensureFasterWhisperCuda({
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFasterWhisperCudaStatus(status);
      feedback.pushStatus(status.message ?? t('runtimeNotChecked'), status.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      feedback.pushStatus(
        feedback.reportUiError('faster-whisper.cuda.check-failed', error, undefined, 'renderer.runtime'),
        'error'
      );
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadFasterWhisperCudaRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    feedback.writeUiLog('info', 'faster-whisper.cuda.download', undefined, 'renderer.runtime');
    setRuntimeOperation('cuda-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeDownloading'));
    try {
      const status = await translateTerGateway.assets.ensureFasterWhisperCuda({
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setFasterWhisperCudaStatus(status);
      feedback.pushStatus(status.message ?? t('runtimeReady'), status.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      feedback.pushStatus(
        feedback.reportUiError('faster-whisper.cuda.download-failed', error, undefined, 'renderer.runtime'),
        'error'
      );
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkCuda(): Promise<void> {
    if (!settings) return;
    feedback.writeUiLog('info', 'whisper.cuda.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('cuda-check');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeChecking'));
    try {
      const status = await translateTerGateway.assets.ensureWhisperRuntime({
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
      feedback.pushStatus(nextMessage, status.acceleration.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('whisper.cuda.check-failed', error, undefined, 'renderer.runtime');
      setActiveDownload(undefined);
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadCudaRuntime(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    feedback.writeUiLog('info', 'whisper.cuda.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('cuda-download');
    setActiveDownload(undefined);
    setModelActivity(undefined);
    feedback.pushStatus(t('runtimeDownloading'));
    try {
      const status = await translateTerGateway.assets.ensureWhisperRuntime({
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
      feedback.pushStatus(nextMessage, status.acceleration.cudaSupported ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('whisper.cuda.download-failed', error, undefined, 'renderer.runtime');
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function checkSelectedModel(): Promise<void> {
    if (!settings) return;
    feedback.writeUiLog('info', 'whisper.model.check', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('model-check');
    setActiveDownload(undefined);
    setModelActivity(t('runtimeChecking'));
    feedback.pushStatus(t('runtimeChecking'));
    try {
      const status = await translateTerGateway.assets.ensureWhisperModel({
        modelId: settings.whisperModelId,
        allowDownload: false,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setModelStatus(status);
      await refreshModels();
      await refreshLocalWhisperRuntimeSnapshot();
      const nextMessage = describeSelectedModelResult(status, t);
      setModelActivity(nextMessage);
      feedback.pushStatus(nextMessage, status.verified ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('whisper.model.check-failed', error, undefined, 'renderer.runtime');
      setModelActivity(nextMessage);
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function downloadSelectedModel(): Promise<void> {
    if (!settings || !settings.allowWhisperAssetDownload) return;
    feedback.writeUiLog('info', 'whisper.model.download', { modelId: settings.whisperModelId }, 'renderer.runtime');
    setRuntimeOperation('model');
    setActiveDownload(undefined);
    setModelActivity(t('runtimeChecking'));
    feedback.pushStatus(t('runtimeChecking'));
    try {
      const preflight = await translateTerGateway.assets.ensureWhisperModel({
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
        feedback.pushStatus(nextMessage, 'success');
        return;
      }

      const status = await translateTerGateway.assets.ensureWhisperModel({
        modelId: settings.whisperModelId,
        allowDownload: true,
        useMultiThreadDownload: settings.enableMultiThreadDownload
      });
      setModelStatus(status);
      await refreshModels();
      await refreshLocalWhisperRuntimeSnapshot();
      const nextMessage = describeSelectedModelResult(status, t);
      setModelActivity(nextMessage);
      feedback.pushStatus(nextMessage, status.verified ? 'success' : 'warning');
    } catch (error) {
      const nextMessage = feedback.reportUiError('whisper.model.download-failed', error, undefined, 'renderer.runtime');
      setActiveDownload(undefined);
      setModelActivity(nextMessage);
      feedback.pushStatus(nextMessage, 'error');
    } finally {
      setActiveDownload(undefined);
      setRuntimeOperation(undefined);
    }
  }

  async function testProvider(providerId: string): Promise<void> {
    feedback.writeUiLog('info', 'provider.test', { providerId }, 'renderer.providers');
    setCheckingProvider(providerId);
    try {
      if (providerId === 'local.whisper.cpp' && settings) {
        await checkLocalWhisperRuntime();
        return;
      }
      if (providerId === 'local.faster-whisper' && settings) {
        const health = await translateTerGateway.assets.ensureFasterWhisperRuntime({
          modelId: settings.whisperModelId,
          allowDownload: false,
          preferCuda: Boolean(settings.localWhisperUseCuda),
          localAsrAcceleration: settings.localAsrAcceleration,
          preferredRuntimeVariant: effectivePreferredRuntimeVariant
        });
        setProviderHealth((current) => ({ ...current, [providerId]: health }));
        feedback.pushStatus(health.message ?? t(providerStatusLabel(health.status)), health.ok ? 'success' : 'warning');
        return;
      }

      const draftSecret = providerSecrets[providerId];
      if (draftSecret) {
        await translateTerGateway.settings.setSecret(providerId, draftSecret);
      }
      const health = await translateTerGateway.settings.testProvider(providerId);
      setProviderHealth((current) => ({ ...current, [providerId]: health }));
      const healthMessage =
        providerId === 'local.whisper.cpp' && !health.ok
          ? t('downloadWhisperPrompt')
          : health.message ?? t(providerStatusLabel(health.status));
      feedback.pushStatus(healthMessage, health.ok ? 'success' : 'warning');
    } catch (error) {
      feedback.pushStatus(
        feedback.reportUiError('provider.test-failed', error, { providerId }, 'renderer.providers'),
        'error'
      );
    } finally {
      setCheckingProvider(undefined);
    }
  }

  async function pickExportDirectory(): Promise<void> {
    feedback.writeUiLog('info', 'export.pick-directory.request', undefined, 'renderer.settings');
    const selected = await translateTerGateway.selectDirectory();
    if (selected) await updateSettings({ exportDirectory: selected, exportDestinationMode: 'selected-directory' });
  }

  async function swapLanguages(): Promise<void> {
    if (!settings || settings.sourceLanguage === 'auto') return;
    await updateSettings({
      sourceLanguage: settings.targetLanguage,
      targetLanguage: settings.sourceLanguage
    });
  }

  async function saveProviderSecret(providerId: string): Promise<void> {
    feedback.writeUiLog('info', 'provider.save-secret', { providerId }, 'renderer.providers');
    await translateTerGateway.settings.setSecret(providerId, providerSecrets[providerId] ?? {});
    feedback.pushStatus(t('providerSaved'), 'success');
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

  function jumpToSettingsTarget(target: SettingsJumpTarget): void {
    feedback.writeUiLog('debug', 'settings.jump-target', { target }, 'renderer.settings');
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

  return {
    settings,
    models,
    nativeHealth,
    runtimeStatus,
    cudaStatus,
    fasterWhisperCudaStatus,
    modelStatus,
    ffmpegStatus,
    providerHealth,
    providerSecrets,
    ffmpegActivity,
    modelActivity,
    activeDownload,
    runtimeOperation,
    checkingProvider,
    activeSettingsJumpTarget,
    asrProviderSettingsRef,
    ffmpegSettingsRef,
    cudaSettingsRef,
    whisperModelSettingsRef,
    translationProviderSettingsRef,
    configuredAcceleration,
    configuredRuntimeVariant,
    ignoreCudaMismatch,
    platformFamily,
    runtimeVariantSelections,
    effectiveRuntimeVariantSelection,
    effectivePreferredRuntimeVariant,
    effectiveLocalWhisperUseCuda,
    cudaFlowRelevant,
    cudaApproved,
    fasterWhisperCudaApproved,
    hostPlatform,
    setProviderHealth,
    refreshModels,
    updateSettings,
    updateLocalAsrAccelerationSetting,
    updateLocalRuntimeVariantSetting,
    updateIgnoreCudaMismatchSetting,
    checkFfmpegTools,
    downloadFfmpegTools,
    checkLocalWhisperRuntime,
    downloadLocalWhisperRuntime,
    downloadFasterWhisperRuntime,
    checkFasterWhisperCuda,
    downloadFasterWhisperCudaRuntime,
    checkCuda,
    downloadCudaRuntime,
    checkSelectedModel,
    downloadSelectedModel,
    testProvider,
    pickExportDirectory,
    swapLanguages,
    saveProviderSecret,
    updateProviderSecret,
    jumpToSettingsTarget
  };
}

function providerStatusLabel(status: ProviderHealth['status']): string {
  return status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'unavailable';
}

function runtimeActionLabel(action: WhisperRuntimeStatus['actionRequired'] = 'none'): string {
  return action === 'none' ? 'ready' : action.replace(/-/g, '');
}

function modelActionLabel(action: WhisperModelStatus['actionRequired'] = 'none'): string {
  return action === 'none' ? 'ready' : action.replace(/-/g, '');
}

function assetEventLabel(event: AssetEvent, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (event.type) {
    case 'download-start':
      return t('downloadStarting');
    case 'download-progress':
      return t('downloadProgress');
    case 'ready':
      return event.scope === 'ffmpeg' ? t('ffmpegReady') : event.scope === 'model' ? t('modelReady') : t('runtimeReady');
    case 'error':
      return event.message;
    default:
      return event.message ?? event.type;
  }
}

function toastToneForAssetEvent(event: AssetEvent): 'neutral' | 'warning' | 'error' | 'success' {
  switch (event.type) {
    case 'error':
      return 'error';
    case 'ready':
      return 'success';
    default:
      return 'neutral';
  }
}

function describeDomTarget(target: EventTarget | null): Record<string, unknown> {
  if (!(target instanceof HTMLElement)) return { tagName: 'unknown' };
  return {
    tagName: target.tagName.toLowerCase(),
    id: target.id || undefined,
    className: target.className || undefined,
    name: 'name' in target ? (target as HTMLInputElement).name || undefined : undefined,
    type: 'type' in target ? (target as HTMLInputElement).type || undefined : undefined
  };
}

function describeDomValue(target: EventTarget | null): unknown {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return undefined;
  }
  if (target instanceof HTMLInputElement && target.type === 'checkbox') {
    return target.checked;
  }
  return target.value;
}

function describeLocalWhisperTestResult(
  status: WhisperRuntimeStatus,
  t: (key: string) => string
): string {
  if (status.binary.verified && status.model.verified) {
    return t('runtimeReady');
  }
  if (!status.binary.verified) {
    return t(runtimeActionLabel(status.actionRequired ?? 'download-runtime'));
  }
  if (!status.model.verified) {
    return t(runtimeActionLabel(status.actionRequired ?? 'download-model'));
  }
  return status.message ?? t('runtimeNotChecked');
}

function describeSelectedModelResult(
  status: WhisperModelStatus,
  t: (key: string) => string
): string {
  if (status.verified) {
    return t('modelReady');
  }
  return status.message ?? t(modelActionLabel(status.actionRequired));
}

function describeCudaStatusDetail(
  status: WhisperRuntimeStatus | undefined,
  t: (key: string) => string,
  ignoreMismatch: boolean
): string {
  if (!status) return t('runtimeNotChecked');
  if (status.acceleration.cudaSupported) {
    return describeWhisperAccelerationDetail(status, t);
  }
  if (status.acceleration.hardwareDetected && !status.acceleration.runtimeDetected) {
    return t('cudaRuntimeMissingDetail');
  }
  if (!ignoreMismatch && status.acceleration.fallbackReason === 'cuda-mismatch') {
    return t('cudaMismatchDetail');
  }
  return status.message ?? t('runtimeNotChecked');
}

function describeWhisperAccelerationDetail(
  status: WhisperRuntimeStatus,
  t: (key: string) => string
): string {
  if (status.acceleration.selected === 'gpu') {
    return t('gpuEnabledUsesCuda');
  }
  if (status.acceleration.requested === 'cpu') {
    return t('gpuDisabledUsesCpu');
  }
  return status.acceleration.fallbackReason ? t(fallbackReasonLabel(status.acceleration.fallbackReason)) : t('autoOption');
}

function fallbackReasonLabel(reason?: WhisperRuntimeStatus['acceleration']['fallbackReason']): string {
  switch (reason) {
    case 'cuda-mismatch':
      return 'cudaMismatchDetail';
    case 'cuda-unavailable':
      return 'cudaUnavailableDetail';
    case 'gpu-not-supported':
      return 'gpuNotSupportedDetail';
    default:
      return 'runtimeVariantAutomatic';
  }
}

function describeFfmpegStatusDetail(
  status: FfmpegStatus | undefined,
  t: (key: string) => string
): string {
  if (!status) return t('ffmpegNotChecked');
  if (status.available) return t('ffmpegReady');
  if (status.ffmpegAvailable || status.ffprobeAvailable) return t('ffmpegPartialDetail');
  return t('ffmpegMissingDetail');
}

function shouldRetryNativeHealth(health: NativeHealth): boolean {
  if (health.status !== 'degraded') return false;
  if (health.capabilities.length === 1 && health.capabilities[0] === 'runtime.health') {
    return true;
  }
  const detail = health.detail?.toLowerCase() ?? '';
  return detail.includes('timed out') || detail.includes('exited unexpectedly') || detail.includes('failed to');
}
