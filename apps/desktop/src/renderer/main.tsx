import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileVideo,
  Gauge,
  HardDriveDownload,
  Languages,
  MonitorCog,
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
const translationProviders = ['mock.local', 'openai.compatible'] as const;

type ExportVariant = 'source' | 'translated' | 'bilingual';
type BilingualOrder = 'source-first' | 'target-first';

const asrProviders = [
  { id: 'local.whisper.cpp', nameKey: 'localProvider', descriptionKey: 'localProviderDetail' },
  { id: 'cloud.openai', nameKey: 'cloudProvider', descriptionKey: 'cloudProviderDetail' },
  { id: 'mock.asr', nameKey: 'mockProvider', descriptionKey: 'mockProviderDetail' }
] as const;

function App(): JSX.Element {
  const { t, i18n } = useTranslation();
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

  async function updateSettings(patch: Partial<AppSettingsPublic>): Promise<void> {
    const next = await window.translateTer.saveSettings(patch);
    setSettings(next);
    if (patch.uiLanguage) {
      await i18n.changeLanguage(patch.uiLanguage);
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
  const translationProviderId = settings?.translationProviderPriority[0] ?? 'mock.local';
  const supportsCuda = Boolean(nativeHealth?.cudaSupported || runtimeStatus?.acceleration.cudaSupported);
  const llmHealth = providerHealth[translationProviderId];
  const asrHealth = providerHealth[settings?.asrProviderId ?? 'mock.asr'];
  const cloudAsrSecret = providerSecrets['cloud.openai'] ?? {};
  const llmSecret = providerSecrets['openai.compatible'] ?? {};
  const canForceStop = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.stage));

  async function forceStop(): Promise<void> {
    if (!job) return;
    setBusy(false);
    await window.translateTer.jobs.cancel(job.id);
    setJob(await window.translateTer.jobs.get(job.id));
    setMessage(t('stopped'));
  }

  if (!settings) return <div className="boot">Translate-Ter</div>;

  return (
    <div className="app">
      <header className="header">
        <div className="windowDots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand">
          <FileVideo size={18} />
          <div>
            <strong>{t('appName')}</strong>
            <span title={job?.fileName ?? t('mockNotice')}>{job?.fileName ?? t('mockNotice')}</span>
          </div>
        </div>
        <nav className="stepper">
          {steps.map((step, index) => (
            <span className={index <= currentStepIndex ? 'step active' : 'step'} key={step}>
              <span>{index + 1}</span>
              {t(step)}
            </span>
          ))}
        </nav>
        <label className="languageSwitch">
          <span>{t('uiLanguage')}</span>
          <select
            aria-label={t('uiLanguage')}
            value={settings.uiLanguage}
            onChange={(event) => void updateSettings({ uiLanguage: event.target.value as 'en-US' | 'zh-CN' })}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>
        </label>
      </header>

      <main className="workspace">
        <section className="mainPane">
          <section className="jobHero" aria-label={t('preview')}>
            <div className="jobHeroHeader">
              <strong title={job?.fileName ?? t('chooseMedia')}>{job?.fileName ?? t('chooseMedia')}</strong>
              <span>{t(stageLabel(job?.stage ?? 'idle'))}</span>
            </div>
            <div className="jobHeroMeta">
              <span>{sourceLabel}</span>
              <ArrowRight size={16} />
              <span>{targetLabel}</span>
              <span className="jobHeroProgress">{completion}%</span>
            </div>
            <div className="track">
              <span style={{ width: `${completion}%` }} />
            </div>
          </section>

          <section className="summaryGrid" aria-label={t('workflowSummary')}>
            <MetricCard icon={<Gauge size={16} />} label={t('jobStage')} value={t(stageLabel(job?.stage ?? 'idle'))} />
            <MetricCard icon={<Languages size={16} />} label={t('languagePair')} value={`${shortLanguage(settings.sourceLanguage)} -> ${shortLanguage(settings.targetLanguage)}`} />
            <MetricCard icon={<ShieldCheck size={16} />} label={t('translatedRows')} value={`${translatedCount}/${segments.length}`} />
            <MetricCard icon={<AlertCircle size={16} />} label={t('warnings')} value={String(warningCount)} />
          </section>

          <section className="subtitlePanel">
            <div className="panelHeader">
              <div>
                <h2>{t('subtitles')}</h2>
                <p>{t('subtitlePanelHint')}</p>
              </div>
              <span>{t('rows', { count: segments.length })}</span>
            </div>
            {job?.subtitleDocument ? (
              <div className="subtitleTable">
                <div className="row head">
                  <span>{t('start')}</span>
                  <span>{t('end')}</span>
                  <span>{t('original')}</span>
                  <span>{t('translated')}</span>
                  <span>{t('status')}</span>
                </div>
                {job.subtitleDocument.segments.map((segment) => (
                  <div className="row" key={segment.id}>
                    <span>{formatTimestamp(segment.startMs)}</span>
                    <span>{formatTimestamp(segment.endMs)}</span>
                    <textarea
                      aria-label={`${t('original')} ${segment.index + 1}`}
                      value={segment.sourceText}
                      onChange={(event) => void updateSegment(segment, { sourceText: event.target.value })}
                    />
                    <textarea
                      aria-label={`${t('translated')} ${segment.index + 1}`}
                      value={segment.translatedText ?? ''}
                      placeholder={t('translated')}
                      onChange={(event) => void updateSegment(segment, { translatedText: event.target.value })}
                    />
                    <span className={`status ${segment.status}`}>{t(statusLabel(segment.status))}</span>
                  </div>
                ))}
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

        <aside className="inspector">
          <InspectorSection icon={<Download size={16} />} title={t('import')}>
            <label>
              {t('mediaPath')}
              <input
                value={mediaPath}
                placeholder={t('placeholderPath')}
                onChange={(event) => setMediaPath(event.target.value)}
              />
            </label>
            <button className="secondary" onClick={() => void pickMedia()}>
              <FileVideo size={16} />
              {t('chooseMedia')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Settings size={16} />} title={t('asr')}>
            <div className="languagePair">
              <SelectField
                label={t('sourceLanguage')}
                uiLanguage={settings.uiLanguage}
                value={settings.sourceLanguage}
                onChange={(value) => void updateSettings({ sourceLanguage: value })}
              />
              <button className="swapButton" disabled={settings.sourceLanguage === 'auto'} title={t('swapLanguages')} onClick={() => void swapLanguages()}>
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
            <label>
              {t('asrProvider')}
              <select value={settings.asrProviderId} onChange={(event) => void updateSettings({ asrProviderId: event.target.value })}>
                {asrProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {t(provider.nameKey)} · {provider.id}
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
            {settings.asrProviderId === 'mock.asr' && (
              <InlineNotice
                title={t('mockProvider')}
                detail={t('mockProviderBypass')}
              />
            )}
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
                  <select value={settings.whisperModelId} onChange={(event) => void updateSettings({ whisperModelId: event.target.value })}>
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
                  <button className="secondary compact" disabled={checkingRuntime} onClick={() => void checkRuntime()}>
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
            <button className="primary" disabled={busy || !mediaPath.trim()} onClick={() => void createAndStart()}>
              <Play size={16} />
              {t('startTranscription')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Languages size={16} />} title={t('translate')}>
            <label>
              {t('translationProvider')}
              <select
                value={translationProviderId}
                onChange={(event) =>
                  void updateSettings({
                    translationProviderPriority:
                      event.target.value === 'mock.local' ? ['mock.local'] : [event.target.value, 'mock.local']
                  })
                }
              >
                {translationProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
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
            {translationProviderId === 'mock.local' && (
              <InlineNotice
                title={t('translationProvider')}
                detail={t('mockTranslationBypass')}
              />
            )}
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
            <button className="primary" disabled={busy || !job?.subtitleDocument} onClick={() => void translateJob()}>
              <Languages size={16} />
              {t('translateSubtitles')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Save size={16} />} title={t('export')}>
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
            <input value={exportPath} placeholder={t('exportPath')} onChange={(event) => setExportPath(event.target.value)} />
            <button className="primary" disabled={busy || !job?.subtitleDocument || !exportPath.trim()} onClick={() => void exportSrt()}>
              <Save size={16} />
              {t('exportSrt')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<MonitorCog size={16} />} title={t('runtime')}>
            <div className="runtimeGrid">
              <StatusLine label={t('nativeBackend')} value={nativeHealth?.status ? t(nativeHealth.status) : t('unknown')} tone={nativeHealth?.status === 'ok' ? 'good' : 'muted'} />
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
              <StatusLine label={t('runtimeBinary')} value={runtimeStatus?.binary.installed ? t('installed') : t('notChecked')} tone={runtimeStatus?.binary.installed ? 'good' : 'muted'} />
              <StatusLine label={t('runtimeModel')} value={runtimeStatus?.model.installed ? t('installed') : t('notChecked')} tone={runtimeStatus?.model.installed ? 'good' : 'muted'} />
            </div>
          </InspectorSection>
        </aside>
      </main>

      <footer className="statusStrip">
        <span>{t('progress')}: {completion}%</span>
        <span title={message}>{message}</span>
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
        <strong title={props.activeId}>{props.activeId}</strong>
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
  const options = languageRegistry.filter((language) => (props.targetOnly ? language.supportsTranslationTarget : language.supportsAsr));
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
