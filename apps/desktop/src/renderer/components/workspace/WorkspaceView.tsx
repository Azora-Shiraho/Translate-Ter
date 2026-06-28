import React from 'react';
import {
  AlertCircle,
  FileVideo,
  Languages,
  Play,
  ShieldCheck,
  CheckCircle2,
  Clock
} from 'lucide-react';
import type { JobSnapshot, SubtitleSegment, SubtitleWarning, ExportVariant } from '@shared/types';
import type { JobStage } from '@shared/models';
import { WarningPanel } from '../status/WarningPanel';
import { SubtitleWorkbench } from '../subtitles/SubtitleWorkbench';
import { providerLabel, stageLabel } from '../../app/displayHelpers';
import type { DerivedHealthState, RunningAction } from '../../app/types';
import { ExportActionGroup } from '../export/ExportActionGroup';

type WorkspaceViewProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  steps: readonly string[];
  statsCollapsed: boolean;
  onToggleStatsCollapsed: () => void;
  workspaceRailMessage: string;
  footerMessage: string;
  runtimeState: DerivedHealthState;
  currentStepIndex: number;
  runningStep?: string;
  failedStep?: string;
  completion: number;
  job?: JobSnapshot;
  jobTitle: string;
  translatedCount: number;
  warningCount: number;
  warningPanelOpen: boolean;
  selectedWarning?: SubtitleWarning;
  workflowWarnings: SubtitleWarning[];
  translationState: DerivedHealthState;
  translationProviderId: string;
  workspaceRuntimeDetail: string;
  sourceLabel: string;
  targetLabel: string;
  asrProviderId: string;
  selectedMediaPath: string;
  mediaPath: string;
  hasRecognizedSubtitles: boolean;
  translationComplete: boolean;
  runningAction?: RunningAction;
  jobIsRunning: boolean;
  selectedSegment?: SubtitleSegment;
  onToggleWarnings: () => void;
  onSelectWarning: (warningId: string) => void;
  onPickMedia: () => void;
  onCreateAndStart: () => void;
  onTranslateJob: () => void;
  onSelectSegment: (segmentId: string) => void;
  onUpdateSegment: (segment: SubtitleSegment, patch: Partial<SubtitleSegment>) => void;
  canExportTranslated?: boolean;
  canExportSource?: boolean;
  canExportBilingual?: boolean;
  exportingVariant?: ExportVariant;
  onExportSrt?: (variant: ExportVariant) => void;
};

export function WorkspaceView(props: WorkspaceViewProps): JSX.Element {
  const showWarningList = props.workflowWarnings.length > 1;
  const segmentsCount = props.job?.subtitleDocument?.segments.length ?? 0;

  return (
    <div className="workspaceModernLayout">
      <header className="workspaceHeader">
        <h1>{props.t('workspace')}</h1>
        <div className="headerActions">
          {props.onExportSrt && (
            <ExportActionGroup
              title={props.t('export')}
              labels={{ translated: props.t('translated'), source: props.t('original'), bilingual: props.t('bilingual') }}
              exportingVariant={props.exportingVariant}
              disabled={{
                translated: !props.canExportTranslated,
                source: !props.canExportSource,
                bilingual: !props.canExportBilingual
              }}
              onExport={props.onExportSrt}
            />
          )}
        </div>
      </header>

      <div className="workspaceContent" style={{ display: 'flex', flexDirection: 'column', gap: '32px', flexGrow: 1, minHeight: 0 }}>
        <div className="workspaceWizard">
          <div className="wizardStep">
            <div className="stepIcon"><FileVideo size={24} /></div>
            <div className="stepContent">
              <h3>1. {props.t('chooseMedia')}</h3>
              <p>{props.selectedMediaPath || props.t('placeholderPath')}</p>
              <button 
                className="modernBtn secondaryBtn"
                disabled={Boolean(props.runningAction) || props.jobIsRunning}
                onClick={props.onPickMedia}
                type="button"
              >
                <FileVideo size={16} />
                {props.t('chooseMedia')}
              </button>
            </div>
          </div>

          <div className={`wizardStep ${!props.mediaPath.trim() ? 'disabled' : ''}`}>
            <div className="stepIcon"><Play size={24} /></div>
            <div className="stepContent">
              <h3>2. {props.t('startTranscription')}</h3>
              <p>{providerLabel(props.asrProviderId, props.t)} - {props.workspaceRuntimeDetail}</p>
              <button 
                className={`modernBtn ${props.hasRecognizedSubtitles ? 'secondaryBtn' : ''}`}
                disabled={Boolean(props.runningAction) || !props.mediaPath.trim()}
                onClick={props.onCreateAndStart}
                type="button"
              >
                <Play size={16} />
                {props.t('startTranscription')}
              </button>
            </div>
          </div>

          <div className={`wizardStep ${!props.job?.subtitleDocument ? 'disabled' : ''}`}>
            <div className="stepIcon"><Languages size={24} /></div>
            <div className="stepContent">
              <h3>3. {props.t('translateSubtitles')}</h3>
              <p>{`${props.sourceLabel} -> ${props.targetLabel}`}</p>
              <button 
                className={`modernBtn ${props.hasRecognizedSubtitles && !props.translationComplete ? '' : 'secondaryBtn'}`}
                disabled={Boolean(props.runningAction) || !props.job?.subtitleDocument}
                onClick={props.onTranslateJob}
                type="button"
              >
                <Languages size={16} />
                {props.t('translateSubtitles')}
              </button>
            </div>
          </div>
        </div>

        {(props.jobIsRunning || props.hasRecognizedSubtitles) && (
          <div className="workspaceDashboard">
            <div className="dashMetric">
              <div className="dashMetricIcon"><Clock size={20} /></div>
              <div className="dashMetricInfo">
                <span>{props.t('progress')}</span>
                <strong>{props.completion}% - {props.t(stageLabel(props.job?.stage ?? 'idle'))}</strong>
              </div>
            </div>
            
            <div className="dashMetric">
              <div className="dashMetricIcon"><ShieldCheck size={20} /></div>
              <div className="dashMetricInfo">
                <span>{props.t('translatedRows')}</span>
                <strong>{props.translatedCount} / {segmentsCount}</strong>
              </div>
            </div>
            
            <div className="dashMetric" style={{ cursor: props.warningCount > 0 ? 'pointer' : 'default' }} onClick={props.warningCount > 0 ? props.onToggleWarnings : undefined}>
              <div className="dashMetricIcon" style={{ color: props.warningCount > 0 ? 'var(--tt-status-warning)' : 'inherit' }}>
                {props.warningCount > 0 ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
              </div>
              <div className="dashMetricInfo">
                <span>{props.t('warnings')}</span>
                <strong>{props.warningCount}</strong>
              </div>
            </div>
            
            <div className="dashMetric">
              <div className="dashMetricIcon"><Languages size={20} /></div>
              <div className="dashMetricInfo">
                <span>{providerLabel(props.translationProviderId, props.t)}</span>
                <strong style={{ color: props.translationState.tone === 'good' ? 'var(--tt-status-success)' : 'var(--tt-status-warning)' }}>
                   {props.translationState.label}
                </strong>
              </div>
            </div>
          </div>
        )}

        {props.warningPanelOpen && props.workflowWarnings.length > 0 && props.selectedWarning && (
          <WarningPanel
            t={props.t}
            warnings={props.workflowWarnings}
            selectedWarning={props.selectedWarning}
            asrProviderId={props.asrProviderId}
            translationProviderId={props.translationProviderId}
            onToggle={props.onToggleWarnings}
            onSelectWarning={props.onSelectWarning}
          />
        )}

        {props.hasRecognizedSubtitles && (
          <div className="workspaceWorkbenchArea" style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SubtitleWorkbench
              t={props.t}
              job={props.job}
              jobTitle={props.jobTitle}
              sourceLabel={props.sourceLabel}
              targetLabel={props.targetLabel}
              asrProviderId={props.asrProviderId}
              selectedSegment={props.selectedSegment}
              warningCount={props.warningCount}
              translatedCount={props.translatedCount}
              onToggleWarnings={props.onToggleWarnings}
              onSelectSegment={props.onSelectSegment}
              onUpdateSegment={props.onUpdateSegment}
            />
          </div>
        )}
      </div>
    </div>
  );
}
