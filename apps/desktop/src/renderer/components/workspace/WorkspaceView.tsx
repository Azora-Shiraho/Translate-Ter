import React from 'react';
import {
  AlertCircle,
  FileVideo,
  Languages,
  Play,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Download,
  ChevronUp
} from 'lucide-react';
import type { JobSnapshot, SubtitleSegment, SubtitleWarning, ExportVariant } from '@shared/types';
import { WarningPanel } from '../status/WarningPanel';
import { SubtitleWorkbench } from '../subtitles/SubtitleWorkbench';
import { providerLabel, stageLabel } from '../../app/displayHelpers';
import type { DerivedHealthState, RunningAction } from '../../app/types';

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
  batchRunning?: boolean;
};

export function WorkspaceView(props: WorkspaceViewProps): JSX.Element {
  const segmentsCount = props.job?.subtitleDocument?.segments.length ?? 0;

  // Step Status Calculations
  const isStep1Completed = props.mediaPath.trim() !== '';
  const isStep1Active = !isStep1Completed;

  const isStep2Completed = props.hasRecognizedSubtitles;
  const isStep2Running = props.jobIsRunning && (props.job?.stage === 'transcribing' || props.job?.stage === 'probing' || props.job?.stage === 'extracting-audio');
  const isStep2Active = isStep1Completed && !isStep2Completed && !isStep2Running;
  const isStep2Disabled = !isStep1Completed;

  const isStep3Completed = props.translationComplete;
  const isStep3Running = props.jobIsRunning && props.job?.stage === 'translating';
  const isStep3Active = props.hasRecognizedSubtitles && !isStep3Completed && !isStep3Running;
  const isStep3Disabled = !props.hasRecognizedSubtitles;

  const isStep4Completed = isStep3Completed; 
  const isStep4Active = props.translationComplete && !props.jobIsRunning;
  const isStep4Disabled = !props.hasRecognizedSubtitles;

  const hasSubtitles = props.hasRecognizedSubtitles || Boolean(props.job?.subtitleDocument);

  // Accordion Expand/Collapse State Manager
  const [expandedSteps, setExpandedSteps] = React.useState<Record<number, boolean>>({});

  const isStep1Expanded = expandedSteps[1] ?? isStep1Active;
  const isStep2Expanded = expandedSteps[2] ?? (isStep2Active || isStep2Running);
  const isStep3Expanded = expandedSteps[3] ?? (isStep3Active || isStep3Running);
  const isStep4Expanded = expandedSteps[4] ?? isStep4Active;

  const toggleStep = (stepNumber: number) => {
    setExpandedSteps(prev => {
      let defaultVal = false;
      if (stepNumber === 1) defaultVal = isStep1Active;
      else if (stepNumber === 2) defaultVal = (isStep2Active || isStep2Running);
      else if (stepNumber === 3) defaultVal = (isStep3Active || isStep3Running);
      else if (stepNumber === 4) defaultVal = isStep4Active;

      const currentVal = prev[stepNumber] ?? defaultVal;
      return {
        ...prev,
        [stepNumber]: !currentVal
      };
    });
  };

  return (
    <div className="workspaceModernLayout">
      {/* LEFT COLUMN: CONTROL PANEL SIDEBAR */}
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <h2>{props.t('workspace')}</h2>
          <p>{props.t('settingsHeadline')}</p>
        </div>

        {props.batchRunning && (
          <div style={{
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: 'var(--tt-text-strong)',
            fontSize: '12px',
            lineHeight: '1.4'
          }}>
            ⚠️ {props.t('backendBusyBatchRunning')}
          </div>
        )}

        {/* Stepper Pipeline Accordion */}
        <div className="sidebar-stepper">
          
          {/* Step 1: Choose Media */}
          {!isStep1Expanded ? (
            <div className="wizardStep-collapsed" onClick={() => toggleStep(1)}>
              <FileVideo size={14} style={{ color: isStep1Completed ? '#10b981' : 'var(--tt-text-muted)' }} />
              <span className="collapsed-title">1. {props.t('chooseMedia')}</span>
              {isStep1Completed && (
                <span className="collapsed-value">
                  {props.selectedMediaPath.split('\\').pop()?.split('/').pop()}
                </span>
              )}
            </div>
          ) : (
            <div className={`wizardStep${isStep1Active ? ' active' : ''}${isStep1Completed ? ' completed' : ''}`}>
              <div className="wizardStep-header" onClick={() => toggleStep(1)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="stepIcon" style={{ width: '28px', height: '28px' }}><FileVideo size={14} /></div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>1. {props.t('chooseMedia')}</span>
                </div>
                <ChevronUp size={14} style={{ opacity: 0.6 }} />
              </div>
              <div className="stepContent">
                {!isStep1Completed ? (
                  <div className="media-dropzone" onClick={props.onPickMedia}>
                    <FileVideo size={20} style={{ color: 'var(--tt-accent)', opacity: 0.8 }} />
                    <span style={{ fontSize: '11px', fontWeight: 600 }}>{props.t('chooseMedia')}</span>
                  </div>
                ) : (
                  <div className="media-info-card">
                    <div className="media-info-details">
                      <div className="media-info-icon-wrapper">
                        <FileVideo size={14} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tt-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={props.selectedMediaPath}>
                          {props.selectedMediaPath.split('\\').pop()?.split('/').pop() || props.selectedMediaPath}
                        </span>
                      </div>
                    </div>
                    <button 
                      className="modernBtn secondaryBtn"
                      disabled={Boolean(props.runningAction) || props.jobIsRunning || props.batchRunning}
                      onClick={props.onPickMedia}
                      type="button"
                      style={{ minHeight: '28px', padding: '0 10px', fontSize: '11px', alignSelf: 'flex-start' }}
                    >
                      {props.t('chooseFolder')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Speech Recognition */}
          {!isStep2Expanded ? (
            <div className={`wizardStep-collapsed${isStep2Disabled ? ' disabled' : ''}`} onClick={() => !isStep2Disabled && toggleStep(2)}>
              <Play size={14} style={{ color: isStep2Completed ? '#10b981' : isStep2Running ? 'var(--tt-accent)' : 'var(--tt-text-muted)' }} />
              <span className="collapsed-title">2. {props.t('startTranscription')}</span>
              {isStep2Running && <span className="radar-badge" style={{ marginLeft: 'auto' }} />}
              {isStep2Completed && <span className="collapsed-value">{providerLabel(props.asrProviderId, props.t)}</span>}
            </div>
          ) : (
            <div className={`wizardStep${isStep2Active ? ' active' : ''}${isStep2Completed ? ' completed' : ''}${isStep2Disabled ? ' disabled' : ''}`}>
              <div className="wizardStep-header" onClick={() => toggleStep(2)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="stepIcon" style={{ width: '28px', height: '28px' }}><Play size={14} /></div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>2. {props.t('startTranscription')}</span>
                  {isStep2Running && <span className="radar-badge" />}
                </div>
                <ChevronUp size={14} style={{ opacity: 0.6 }} />
              </div>
              <div className="stepContent">
                <p style={{ fontSize: '11px', marginBottom: '8px' }}>{providerLabel(props.asrProviderId, props.t)}</p>
                <button 
                  className={`modernBtn ${props.hasRecognizedSubtitles ? 'secondaryBtn' : ''}`}
                  disabled={Boolean(props.runningAction) || !props.mediaPath.trim() || props.batchRunning || props.jobIsRunning}
                  onClick={props.onCreateAndStart}
                  type="button"
                  style={{ width: '100%', minHeight: '32px', fontSize: '12px' }}
                >
                  <Play size={12} />
                  {props.t('startTranscription')}
                </button>

                {isStep2Running && (
                  <div style={{ marginTop: '8px' }}>
                    <div className="modern-progress-bar-container">
                      <div className="rainbow-progress-bar-fill" style={{ width: `${props.completion}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--tt-text-muted)', marginTop: '4px' }}>
                      <span>{props.completion}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Subtitle Translation */}
          {!isStep3Expanded ? (
            <div className={`wizardStep-collapsed${isStep3Disabled ? ' disabled' : ''}`} onClick={() => !isStep3Disabled && toggleStep(3)}>
              <Languages size={14} style={{ color: isStep3Completed ? '#10b981' : isStep3Running ? 'var(--tt-accent)' : 'var(--tt-text-muted)' }} />
              <span className="collapsed-title">3. {props.t('translateSubtitles')}</span>
              {isStep3Running && <span className="radar-badge" style={{ marginLeft: 'auto' }} />}
              {isStep3Completed && <span className="collapsed-value">{`${props.sourceLabel} -> ${props.targetLabel}`}</span>}
            </div>
          ) : (
            <div className={`wizardStep${isStep3Active ? ' active' : ''}${isStep3Completed ? ' completed' : ''}${isStep3Disabled ? ' disabled' : ''}`}>
              <div className="wizardStep-header" onClick={() => toggleStep(3)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="stepIcon" style={{ width: '28px', height: '28px' }}><Languages size={14} /></div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>3. {props.t('translateSubtitles')}</span>
                  {isStep3Running && <span className="radar-badge" />}
                </div>
                <ChevronUp size={14} style={{ opacity: 0.6 }} />
              </div>
              <div className="stepContent">
                <p style={{ fontSize: '11px', marginBottom: '8px' }}>{`${props.sourceLabel} -> ${props.targetLabel}`}</p>
                <button 
                  className={`modernBtn ${props.hasRecognizedSubtitles && !props.translationComplete ? '' : 'secondaryBtn'}`}
                  disabled={Boolean(props.runningAction) || !props.job?.subtitleDocument || props.batchRunning || props.jobIsRunning}
                  onClick={props.onTranslateJob}
                  type="button"
                  style={{ width: '100%', minHeight: '32px', fontSize: '12px' }}
                >
                  <Languages size={12} />
                  {props.t('translateSubtitles')}
                </button>

                {isStep3Running && (
                  <div style={{ marginTop: '8px' }}>
                    <div className="modern-progress-bar-container">
                      <div className="rainbow-progress-bar-fill" style={{ width: `${props.completion}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--tt-text-muted)', marginTop: '4px' }}>
                      <span>{props.completion}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Export Subtitles */}
          {!isStep4Expanded ? (
            <div className={`wizardStep-collapsed${isStep4Disabled ? ' disabled' : ''}`} onClick={() => !isStep4Disabled && toggleStep(4)}>
              <Download size={14} style={{ color: isStep4Completed ? '#10b981' : 'var(--tt-text-muted)' }} />
              <span className="collapsed-title">4. {props.t('export')}</span>
              {isStep4Completed && <span className="collapsed-value">{props.t('ready')}</span>}
            </div>
          ) : (
            <div className={`wizardStep${isStep4Active ? ' active' : ''}${isStep4Completed ? ' completed' : ''}${isStep4Disabled ? ' disabled' : ''}`}>
              <div className="wizardStep-header" onClick={() => toggleStep(4)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="stepIcon" style={{ width: '28px', height: '28px' }}><Download size={14} /></div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>4. {props.t('export')}</span>
                </div>
                <ChevronUp size={14} style={{ opacity: 0.6 }} />
              </div>
              <div className="stepContent" style={{ gap: '10px', marginTop: '4px' }}>
                {props.onExportSrt && (
                  <div className="export-buttons-stack">
                    <button
                      className="exportOptionBtn"
                      disabled={!props.canExportBilingual || Boolean(props.batchRunning)}
                      onClick={() => props.onExportSrt?.('bilingual')}
                      type="button"
                    >
                      <span>{props.t('bilingual')}</span>
                      <Download size={13} style={{ opacity: 0.6 }} />
                    </button>
                    <button
                      className="exportOptionBtn"
                      disabled={!props.canExportTranslated || Boolean(props.batchRunning)}
                      onClick={() => props.onExportSrt?.('translated')}
                      type="button"
                    >
                      <span>{props.t('translatedOnly')}</span>
                      <Download size={13} style={{ opacity: 0.6 }} />
                    </button>
                    <button
                      className="exportOptionBtn"
                      disabled={!props.canExportSource || Boolean(props.batchRunning)}
                      onClick={() => props.onExportSrt?.('source')}
                      type="button"
                    >
                      <span>{props.t('sourceOnly')}</span>
                      <Download size={13} style={{ opacity: 0.6 }} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Vertical Metric Indicator Stacks */}
        {(props.jobIsRunning || props.hasRecognizedSubtitles || props.warningCount > 0 || props.job?.stage === 'failed') && (
          <div className="workspaceDashboard">
            {/* Progress Metric */}
            <div className="dashMetric metric-progress">
              <div className={`dashMetricIcon${props.jobIsRunning ? ' running-spin' : ''}`}><Clock size={16} /></div>
              <div className="dashMetricInfo">
                <span>{props.t('progress')}</span>
                <strong>{props.completion}% - {props.t(stageLabel(props.job?.stage ?? 'idle'))}</strong>
              </div>
            </div>
            
            {/* Translated Rows Metric */}
            <div className="dashMetric metric-rows">
              <div className="dashMetricIcon"><ShieldCheck size={16} /></div>
              <div className="dashMetricInfo">
                <span>{props.t('translatedRows')}</span>
                <strong>{props.translatedCount} / {segmentsCount}</strong>
              </div>
            </div>
            
            {/* Warnings Metric */}
            <div 
              className={`dashMetric metric-warnings${props.warningCount > 0 ? ' interactive' : ''}`} 
              style={{ cursor: props.warningCount > 0 ? 'pointer' : 'default' }} 
              onClick={props.warningCount > 0 ? props.onToggleWarnings : undefined}
              role={props.warningCount > 0 ? 'button' : undefined}
              tabIndex={props.warningCount > 0 ? 0 : undefined}
              onKeyDown={props.warningCount > 0 ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onToggleWarnings();
                }
              } : undefined}
            >
              <div className="dashMetricIcon" style={{ color: props.warningCount > 0 ? 'var(--tt-status-warning)' : 'inherit' }}>
                {props.warningCount > 0 ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              </div>
              <div className="dashMetricInfo">
                <span>{props.t('warnings')}</span>
                <strong>{props.warningCount}</strong>
              </div>
            </div>
            
            {/* Engine Status Metric */}
            <div className="dashMetric metric-status">
              <div className="dashMetricIcon"><Languages size={16} /></div>
              <div className="dashMetricInfo">
                <span>{providerLabel(props.translationProviderId, props.t)}</span>
                <strong style={{ color: props.translationState.tone === 'good' ? 'var(--tt-status-success)' : 'var(--tt-status-warning)' }}>
                   {props.translationState.label}
                </strong>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* RIGHT COLUMN: MAIN WORKSPACE EDITOR STAGE */}
      <main className="workspace-main-stage">
        {hasSubtitles ? (
          <>
            <div className="workspace-main-header">
              <h2>{props.jobTitle || props.t('workspace')}</h2>
              <span style={{ fontSize: '13px', color: 'var(--tt-text-muted)', fontWeight: 500 }}>
                {props.t('rows_other', { count: segmentsCount })}
              </span>
            </div>
            
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
          </>
        ) : (
          <>
            <div className="workspace-main-header">
              <h2>{props.t('workspace')}</h2>
            </div>
            
            <div className="workspaceEmptyState">
              <div className="emptyStateCircle">
                <FileVideo size={32} />
              </div>
              <div style={{ maxWidth: '420px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--tt-text-strong)', marginBottom: '8px' }}>
                  {props.t('noSubtitlesTitle')}
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--tt-text-muted)', lineHeight: '1.5' }}>
                  {props.t('noSubtitles')}
                </p>
              </div>
            </div>
          </>
        )}

        {props.warningPanelOpen && props.workflowWarnings.length > 0 && props.selectedWarning && (
          <div style={{ borderTop: '1px solid var(--tt-border-soft)', maxHeight: '35%', overflowY: 'auto' }}>
            <WarningPanel
              t={props.t}
              warnings={props.workflowWarnings}
              selectedWarning={props.selectedWarning}
              asrProviderId={props.asrProviderId}
              translationProviderId={props.translationProviderId}
              onToggle={props.onToggleWarnings}
              onSelectWarning={props.onSelectWarning}
            />
          </div>
        )}
      </main>
    </div>
  );
}
