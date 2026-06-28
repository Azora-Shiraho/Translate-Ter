import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { FileVideo, Gauge, Settings, AlertCircle, RotateCcw, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageLabel } from '@shared/languages';
import { translateTerGateway } from '../api/translateTerGateway';
import { steps } from './constants';
import { deriveWorkspaceRailMessage, deriveWorkspaceRuntimeDetail } from './displayHelpers';
import type { AppView, ReportUiError, ToastMessage, ToastTone, WriteUiLog } from './types';
import { useSettingsViewModel } from '../viewModels/useSettingsViewModel';
import { useWorkspaceViewModel } from '../viewModels/useWorkspaceViewModel';
import { useProviderStatusViewModel } from '../viewModels/useProviderStatusViewModel';
import { WorkspaceView } from '../components/workspace/WorkspaceView';
import { BatchQueueView } from '../components/batch/BatchQueueView';
import { useBatchViewModel } from '../viewModels/useBatchViewModel';
import { ToastStack } from '../components/status/ToastStack';
import { BottomBubble } from '../components/status/BottomBubble';

export function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>('workspace');
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const [message, setMessage] = useState(() => t('ready'));
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [copyBubble, setCopyBubble] = useState<string>();

  const writeUiLog = useCallback<WriteUiLog>(
    (level, event, details, scope = 'renderer.ui', messageText) => {
      if (level === 'debug') {
        translateTerGateway.logs.debug(event, details, scope, messageText);
        return;
      }
      if (level === 'info') {
        translateTerGateway.logs.info(event, details, scope, messageText);
        return;
      }
      if (level === 'warning') {
        translateTerGateway.logs.warning(event, details, scope, messageText);
        return;
      }
      translateTerGateway.logs.error(event, details, scope, messageText);
    },
    []
  );

  const reportUiError = useCallback<ReportUiError>(
    (event, error, details, scope = 'renderer.ui') => {
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
      setMessage(nextMessage);
      pushToast(nextMessage, tone);
    },
    [pushToast]
  );

  const feedback = useMemo(
    () => ({
      writeUiLog,
      reportUiError,
      setMessage,
      pushStatus,
      pushToast
    }),
    [pushStatus, pushToast, reportUiError, writeUiLog]
  );

  const settingsVm = useSettingsViewModel({ t, i18n, feedback });
  const workspaceVm = useWorkspaceViewModel({
    t,
    feedback,
    settings: settingsVm.settings,
    effectiveLocalWhisperUseCuda: settingsVm.effectiveLocalWhisperUseCuda,
    effectivePreferredRuntimeVariant: settingsVm.effectivePreferredRuntimeVariant,
    ignoreCudaMismatch: settingsVm.ignoreCudaMismatch,
    clearActiveDownload: settingsVm.clearActiveDownload
  });
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
    job: workspaceVm.job,
    configuredAcceleration: settingsVm.configuredAcceleration,
    effectiveRuntimeVariantSelection: settingsVm.effectiveRuntimeVariantSelection,
    runtimeVariantSelections: settingsVm.runtimeVariantSelections,
    ignoreCudaMismatch: settingsVm.ignoreCudaMismatch,
    cudaFlowRelevant: settingsVm.cudaFlowRelevant
  });

  const batchVm = useBatchViewModel({
    feedback,
    settings: settingsVm.settings
  });

  useEffect(() => {
    const unsubscribe = translateTerGateway.settings.onEvent((event) => {
      if (event.type === 'changed') {
        settingsVm.refreshSettings();
      }
    });
    return () => unsubscribe();
  }, [settingsVm]);

  if (!settingsVm.settings) {
    return <div className="boot">Translate-Ter</div>;
  }

  const settings = settingsVm.settings;
  const segments = workspaceVm.job?.subtitleDocument?.segments ?? [];
  const translatedCount = segments.filter((segment) => Boolean(segment.translatedText?.trim())).length;
  const warningCount = workspaceVm.workflowWarnings.length;
  const selectedSegment = segments.find((segment) => segment.id === workspaceVm.selectedSegmentId) ?? segments[0];
  const selectedWarning =
    workspaceVm.workflowWarnings.find((warning) => warning.id === workspaceVm.selectedWarningId) ??
    workspaceVm.workflowWarnings[0];
  const currentStepIndex = Math.max(0, steps.indexOf(workspaceVm.job?.step ?? 'import'));
  const sourceLabel = languageLabel(settings.sourceLanguage, settings.uiLanguage);
  const targetLabel = languageLabel(settings.targetLanguage, settings.uiLanguage);
  const selectedMediaPath = workspaceVm.job?.mediaPath ?? workspaceVm.mediaPath.trim();
  const selectedMediaFileName =
    workspaceVm.job?.fileName ?? selectedMediaPath.split(/[\\/]/).filter(Boolean).at(-1) ?? t('chooseMedia');
  const jobTitle = selectedMediaFileName;
  const completion = Math.max(0, Math.min(100, workspaceVm.job?.progress ?? 0));
  const jobIsRunning = Boolean(
    workspaceVm.job && !['idle', 'completed', 'failed', 'cancelled'].includes(workspaceVm.job.stage)
  );
  const transcribingStages = ['checking-runtime', 'probing', 'extracting-audio', 'transcribing'];
  const isTranscribing =
    workspaceVm.runningAction === 'transcribe' ||
    Boolean(workspaceVm.job && transcribingStages.includes(workspaceVm.job.stage));
  const isTranslating =
    workspaceVm.runningAction === 'translate' || workspaceVm.job?.stage === 'translating';
  const runningStep = isTranscribing ? 'asr' : isTranslating ? 'translate' : undefined;
  const failedStep = workspaceVm.job?.stage === 'failed' ? workspaceVm.job.step : undefined;
  const batchRunning = batchVm.queue.status === 'running';
  const appWorking =
    workspaceVm.busy || Boolean(settingsVm.runtimeOperation) || Boolean(settingsVm.checkingProvider) || jobIsRunning || batchRunning;
  const hasRecognizedSubtitles = Boolean(workspaceVm.job?.subtitleDocument?.segments.length);
  const translationComplete = hasRecognizedSubtitles && translatedCount === segments.length && segments.length > 0;
  const canExportTranslated = translationComplete && !workspaceVm.busy;
  const canExportSource = hasRecognizedSubtitles && !workspaceVm.busy;
  const canExportBilingual = translationComplete && !workspaceVm.busy;
  const downloadPercent =
    settingsVm.activeDownload?.totalBytes && settingsVm.activeDownload.totalBytes > 0
      ? Math.min(100, Math.round((settingsVm.activeDownload.receivedBytes / settingsVm.activeDownload.totalBytes) * 100))
      : undefined;
  const footerProgress = settingsVm.activeDownload ? downloadPercent ?? 100 : completion;
  const footerTitle = settingsVm.activeDownload
    ? `${t('downloadProgress')}${downloadPercent === undefined ? '' : ` ${downloadPercent}%`}`
    : `${t('progress')} ${completion}%`;
  const footerMessage = settingsVm.activeDownload?.message ?? message;
  const workspaceRailMessage = deriveWorkspaceRailMessage({
    t,
    asrProviderId: statusVm.asrProviderId,
    activeDownload: settingsVm.activeDownload,
    footerTitle,
    stage: workspaceVm.job?.stage ?? 'idle',
    sourceLabel,
    targetLabel
  });
  const workspaceRuntimeDetail = deriveWorkspaceRuntimeDetail({
    t,
    asrProviderId: statusVm.asrProviderId,
    asrHealth: statusVm.asrHealth,
    runtimeState: statusVm.runtimeState,
    ffmpegStatus: settingsVm.ffmpegStatus,
    nativeHealth: settingsVm.nativeHealth
  });
  const canForceStop = Boolean(
    workspaceVm.job && !['idle', 'completed', 'failed', 'cancelled'].includes(workspaceVm.job.stage)
  );

  async function copyToastMessage(toast: ToastMessage): Promise<void> {
    if (toast.tone !== 'error') return;
    try {
      await navigator.clipboard.writeText(toast.message);
      setCopyBubble(t('copiedToClipboard'));
    } catch {
      setCopyBubble(t('copyFailed'));
    }
    window.setTimeout(() => setCopyBubble(undefined), 1800);
  }

  return (
    <div className={`appContainer${appWorking ? ' isWorking' : ''}`}>
      <aside className="appSidebar">
        <div className="sidebarBrand">
          <FileVideo size={24} className="brandIcon" />
          <h2>{t('appName')}</h2>
        </div>
        
        <nav className="sidebarNav">
          <button
            className={`navItem${activeView === 'workspace' ? ' active' : ''}`}
            onClick={() => setActiveView('workspace')}
            title={t('navWorkspace')}
            type="button"
          >
            <FileVideo size={18} />
            <span>{t('navWorkspace')}</span>
          </button>
          <button
            className={`navItem${activeView === 'batch' ? ' active' : ''}`}
            onClick={() => setActiveView('batch')}
            title={t('batchProcessing')}
            type="button"
          >
            <Layers size={18} />
            <span>{t('batchProcessing')}</span>
          </button>
          <button
            className="navItem"
            onClick={() => translateTerGateway.window.openSettings()}
            title={batchRunning ? t('backendBusyBatchRunning') : t('navSettings')}
            type="button"
            style={{ marginTop: 'auto' }}
            disabled={batchRunning}
          >
            <Settings size={18} />
            <span>{t('navSettings')}</span>
          </button>
        </nav>

        <div className="sidebarFooter">
          <div className="systemStatusBlock">
            <span className={appWorking ? 'statusPulse active' : 'statusPulse'} />
            <div className="statusText">
              <strong>{footerTitle}</strong>
              <span title={footerMessage}>{footerMessage}</span>
            </div>
          </div>
          {(canForceStop || workspaceVm.job?.error) && (
            <div className="sidebarActions">
              {canForceStop && (
                <button onClick={() => void workspaceVm.forceStop()} type="button" disabled={batchRunning}>
                  <AlertCircle size={14} />
                  {t('forceStop')}
                </button>
              )}
              {workspaceVm.job?.error && (
                <button onClick={() => void workspaceVm.createAndStart()} type="button" disabled={batchRunning}>
                  <RotateCcw size={14} />
                  {t('retry')}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="appMain">
        {activeView === 'workspace' && (
          <WorkspaceView
            t={t}
            steps={steps}
            statsCollapsed={statsCollapsed}
            onToggleStatsCollapsed={() => setStatsCollapsed((current) => !current)}
            workspaceRailMessage={workspaceRailMessage}
            footerMessage={footerMessage}
            runtimeState={statusVm.runtimeState}
            currentStepIndex={currentStepIndex}
            runningStep={runningStep}
            failedStep={failedStep}
            completion={completion}
            job={workspaceVm.job}
            jobTitle={jobTitle}
            translatedCount={translatedCount}
            warningCount={warningCount}
            warningPanelOpen={workspaceVm.warningPanelOpen}
            selectedWarning={selectedWarning}
            workflowWarnings={workspaceVm.workflowWarnings}
            translationState={statusVm.translationState}
            translationProviderId={statusVm.translationProviderId}
            workspaceRuntimeDetail={workspaceRuntimeDetail}
            sourceLabel={sourceLabel}
            targetLabel={targetLabel}
            asrProviderId={statusVm.asrProviderId}
            selectedMediaPath={selectedMediaPath}
            mediaPath={workspaceVm.mediaPath}
            hasRecognizedSubtitles={hasRecognizedSubtitles}
            translationComplete={translationComplete}
            runningAction={workspaceVm.runningAction}
            jobIsRunning={jobIsRunning}
            selectedSegment={selectedSegment}
            onToggleWarnings={workspaceVm.toggleWarningPanel}
            onSelectWarning={workspaceVm.setSelectedWarningId}
            onPickMedia={() => void workspaceVm.pickMedia()}
            onCreateAndStart={() => void workspaceVm.createAndStart()}
            onTranslateJob={() => void workspaceVm.translateJob()}
            onSelectSegment={workspaceVm.setSelectedSegmentId}
            onUpdateSegment={(segment, patch) => void workspaceVm.updateSegment(segment, patch)}
            canExportTranslated={canExportTranslated}
            canExportSource={canExportSource}
            canExportBilingual={canExportBilingual}
            exportingVariant={workspaceVm.exportingVariant}
            onExportSrt={(variant) => void workspaceVm.exportSrt(variant)}
            batchRunning={batchRunning}
          />
        )}
        {activeView === 'batch' && (
          <BatchQueueView batchVm={batchVm} workspaceRunning={workspaceVm.busy || jobIsRunning} />
        )}
      </main>

      <ToastStack toasts={toasts} copyTitle={t('copyErrorToast')} onCopyError={(toast) => void copyToastMessage(toast)} />
      <BottomBubble message={copyBubble} />
    </div>
  );
}
