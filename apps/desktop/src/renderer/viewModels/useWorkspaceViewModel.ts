import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettingsPublic, ExportVariant, JobSnapshot, ProviderSecretInput, SubtitleSegment, SubtitleWarning } from '@shared/types';
import type { JobEvent, JobStage } from '@shared/models';
import { translateTerGateway } from '../api/translateTerGateway';
import { useJobEvents } from './useJobEvents';
import type { RunningAction, UiFeedback } from '../app/types';
import type { RuntimeVariantSelection } from '../asrSettings';

type UseWorkspaceViewModelInput = {
  t: (key: string, options?: Record<string, unknown>) => string;
  feedback: UiFeedback;
  settings?: AppSettingsPublic;
  effectiveLocalWhisperUseCuda: boolean;
  effectivePreferredRuntimeVariant?: RuntimeVariantSelection;
  ignoreCudaMismatch: boolean;
  clearActiveDownload: () => void;
};

export function useWorkspaceViewModel(input: UseWorkspaceViewModelInput) {
  const {
    t,
    feedback,
    settings,
    effectiveLocalWhisperUseCuda,
    effectivePreferredRuntimeVariant,
    ignoreCudaMismatch,
    clearActiveDownload
  } = input;
  const [job, setJob] = useState<JobSnapshot>();
  const [mediaPath, setMediaPath] = useState('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [warningPanelOpen, setWarningPanelOpen] = useState(false);
  const [selectedWarningId, setSelectedWarningId] = useState<string>();
  const [runningAction, setRunningAction] = useState<RunningAction>();
  const [exportingVariant, setExportingVariant] = useState<ExportVariant>();
  const [busy, setBusy] = useState(false);
  const actionTokenRef = useRef(0);

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

  const translateStage = useCallback((stage: JobStage) => t(stageLabel(stage)), [t]);

  const workspaceJobIdRef = useRef<string>();

  useEffect(() => {
    workspaceJobIdRef.current = job?.id;
  }, [job?.id]);

  const handleJobEvent = useCallback(
    (event: JobEvent) => {
      feedback.writeUiLog('debug', 'jobs.event-received', summarizeJobEventForLog(event), 'renderer.jobs');
      if (event.type === 'snapshot') {
        const matchesJobId = workspaceJobIdRef.current && event.job.id === workspaceJobIdRef.current;
        const matchesMediaPath = !workspaceJobIdRef.current && mediaPath && event.job.mediaPath === mediaPath;
        if (matchesJobId || matchesMediaPath) {
          workspaceJobIdRef.current = event.job.id;
          setJob(event.job);
        }
      } else {
        if (workspaceJobIdRef.current && event.jobId === workspaceJobIdRef.current) {
          if (event.type === 'progress') feedback.setMessage(event.message ?? translateStage(event.stage));
          if (event.type === 'error') feedback.pushStatus(event.message, 'error');
        }
      }
    },
    [feedback, translateStage, mediaPath]
  );

  useJobEvents(handleJobEvent);

  async function pickMedia(): Promise<void> {
    if (job && !['idle', 'completed', 'failed', 'cancelled'].includes(job.stage)) {
      feedback.writeUiLog('debug', 'media.pick.blocked-active-job', { jobId: job.id, stage: job.stage }, 'renderer.workspace');
      return;
    }
    feedback.writeUiLog('info', 'media.pick.request', undefined, 'renderer.workspace');
    const selected = await translateTerGateway.selectVideo();
    if (selected) {
      feedback.writeUiLog('info', 'media.pick.success', { mediaPath: selected }, 'renderer.workspace');
      setMediaPath(selected);
      setJob(undefined);
      setSelectedSegmentId(undefined);
      setWarningPanelOpen(false);
      setSelectedWarningId(undefined);
      return;
    }
    feedback.writeUiLog('debug', 'media.pick.cancelled', undefined, 'renderer.workspace');
  }

  async function createAndStart(): Promise<void> {
    const selectedMediaPath = mediaPath.trim() || job?.mediaPath.trim() || '';
    if (!settings || !selectedMediaPath) return;
    feedback.writeUiLog(
      'info',
      'job.start-transcription',
      {
        mediaPath: selectedMediaPath,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        useCuda: effectiveLocalWhisperUseCuda
      },
      'renderer.workspace'
    );
    const token = beginAction('transcribe');
    try {
      const nextJob = await translateTerGateway.startTranscription({
        mediaPath: selectedMediaPath,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        localWhisperUseCuda: effectiveLocalWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant:
          effectivePreferredRuntimeVariant === 'auto' ? undefined : effectivePreferredRuntimeVariant,
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
      workspaceJobIdRef.current = nextJob.id;
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) {
        feedback.pushStatus(
          feedback.reportUiError('job.start-transcription-failed', error, { mediaPath: selectedMediaPath }, 'renderer.workspace'),
          'error'
        );
      }
    } finally {
      endAction(token);
    }
  }

  async function translateJob(): Promise<void> {
    if (!job) return;
    feedback.writeUiLog('info', 'job.start-translation', { jobId: job.id }, 'renderer.workspace');
    const token = beginAction('translate');
    try {
      const nextJob = await translateTerGateway.startTranslation(job.id);
      workspaceJobIdRef.current = nextJob.id;
      if (isCurrentAction(token)) setJob(nextJob);
    } catch (error) {
      if (isCurrentAction(token)) {
        feedback.pushStatus(
          feedback.reportUiError('job.start-translation-failed', error, { jobId: job.id }, 'renderer.workspace'),
          'error'
        );
      }
    } finally {
      endAction(token);
    }
  }

  async function exportSrt(variant: ExportVariant): Promise<void> {
    if (!job?.subtitleDocument) return;
    feedback.writeUiLog('info', 'job.export-srt', { jobId: job.id, variant }, 'renderer.workspace');
    const token = beginAction('export', variant);
    try {
      const result = await translateTerGateway.exportConfiguredSrt(job.subtitleDocument, job.mediaPath, variant);
      if (isCurrentAction(token) && !result.cancelled) feedback.pushStatus(t('exported'), 'success');
    } catch (error) {
      if (isCurrentAction(token)) {
        feedback.pushStatus(
          feedback.reportUiError('job.export-srt-failed', error, { jobId: job.id, variant }, 'renderer.workspace'),
          'error'
        );
      }
    } finally {
      endAction(token);
    }
  }

  async function updateSegment(segment: SubtitleSegment, patch: Partial<SubtitleSegment>): Promise<void> {
    if (!job) return;
    feedback.writeUiLog('debug', 'subtitle.segment-update', { jobId: job.id, segmentId: segment.id, patch }, 'renderer.subtitles');
    const next = await translateTerGateway.subtitles.updateSegment(job.id, { ...segment, ...patch });
    setJob(next);
  }

  async function forceStop(): Promise<void> {
    if (!job) return;
    feedback.writeUiLog('warning', 'job.force-stop', { jobId: job.id }, 'renderer.workspace');
    invalidateActiveAction();
    clearActiveDownload();
    await translateTerGateway.jobs.cancel(job.id);
    const nextJob = await translateTerGateway.jobs.get(job.id);
    workspaceJobIdRef.current = nextJob.id;
    setJob(nextJob);
    feedback.pushStatus(t('stopped'), 'warning');
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

  function toggleWarningPanel(): void {
    if (workflowWarnings.length === 0) return;
    setWarningPanelOpen((current) => {
      const next = !current;
      if (next) {
        setSelectedWarningId((warningId) => warningId ?? workflowWarnings[0]?.id);
      }
      return next;
    });
  }

  return {
    job,
    mediaPath,
    selectedSegmentId,
    warningPanelOpen,
    selectedWarningId,
    runningAction,
    exportingVariant,
    busy,
    workflowWarnings,
    setSelectedSegmentId,
    setSelectedWarningId,
    pickMedia,
    createAndStart,
    translateJob,
    exportSrt,
    updateSegment,
    forceStop,
    toggleWarningPanel
  };
}

function stageLabel(stage: JobStage): string {
  return `stage.${stage}`;
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
    message: event.message
  };
}

function deriveWorkflowWarnings(job?: JobSnapshot): SubtitleWarning[] {
  if (!job) return [];
  const jobWarnings = job.warnings ?? [];
  const documentWarnings = job.subtitleDocument?.metadata.warnings ?? [];
  const allWarnings = [...jobWarnings, ...documentWarnings];
  if (!allWarnings.length) return [];
  const segments = job.subtitleDocument?.segments ?? [];
  const seen = new Set<string>();
  return allWarnings
    .filter((warning) => {
      if (warning.stage === 'translate') return true;
      return [
        'ParseError',
        'InvalidTiming',
        'EmptyText',
        'TimingOverlap',
        'CudaFallback',
        'CudaTranscriptionCrashFallback',
        'CudaRuntimeNotDetected',
        'CudaDisabled',
        'NativeCapabilityUnavailable',
        'download-runtime',
        'download-model',
        'download-cuda-runtime',
        'manifest-not-configured',
        'unsupported-platform',
        'pin-manifest-hashes',
        'download-required'
      ].includes(warning.code);
    })
    .map((warning, index) => enrichWarning(warning, segments, index))
    .filter((warning) => {
      const fingerprint = warningFingerprint(warning);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
}

function enrichWarning(warning: SubtitleWarning, segments: SubtitleSegment[], index: number): SubtitleWarning {
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
