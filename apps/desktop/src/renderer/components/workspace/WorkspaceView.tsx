import React from 'react';
import {
  AlertCircle,
  FileVideo,
  Gauge,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  ShieldCheck
} from 'lucide-react';
import type { JobSnapshot, SubtitleSegment, SubtitleWarning } from '@shared/types';
import type { JobStage } from '@shared/models';
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
};

export function WorkspaceView(props: WorkspaceViewProps): JSX.Element {
  const showWarningList = props.workflowWarnings.length > 1;

  return (
    <section className="viewFrame workspaceFrame">
      <nav className="workflowRail">
        <div className="workflowRailLead">
          <div className="workflowRailCopy">
            <strong>{props.t('workspace')}</strong>
            <small title={props.footerMessage}>{props.workspaceRailMessage}</small>
          </div>
        </div>
        <div className="workflowRailTrack">
          {props.steps.map((step, index) => (
            <span
              className={
                [
                  'workflowStep',
                  index < props.currentStepIndex ? 'done' : '',
                  index === props.currentStepIndex ? 'active' : '',
                  props.runningStep === step ? 'running' : '',
                  props.failedStep === step ? 'failed' : ''
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              key={step}
            >
              <span className="workflowStepDot" />
              <strong>{index + 1}</strong>
              <span>{props.t(step)}</span>
            </span>
          ))}
        </div>
        <div className="workflowRailMeta">
          <span className="metaPill">{`${props.t('progress')} ${props.completion}%`}</span>
          <span className={`status ${props.runtimeState.tone}`}>{props.runtimeState.label}</span>
          <button
            className="summaryToggle"
            title={props.statsCollapsed ? props.t('expandSummary') : props.t('collapseSummary')}
            onClick={props.onToggleStatsCollapsed}
            type="button"
          >
            {props.statsCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </nav>

      <main className={`workspaceLayout${props.statsCollapsed ? ' statsCollapsed' : ''}`}>
        {!props.statsCollapsed && (
          <aside className="statsRail workspaceInspector">
            <div className="railContent">
              <div className="railHeader inspectorHeader">
                <span>{props.t('workflowSummary')}</span>
                <strong title={props.jobTitle}>{props.jobTitle}</strong>
                <small>{props.t(stageLabel(props.job?.stage ?? 'idle'))}</small>
              </div>
              <div className="railMetrics inspectorMetrics">
                <MetricCard icon={<ShieldCheck size={16} />} label={props.t('translatedRows')} value={`${props.translatedCount}/${props.job?.subtitleDocument?.segments.length ?? 0}`} />
                <MetricCard
                  icon={<AlertCircle size={16} />}
                  label={props.t('warnings')}
                  value={String(props.warningCount)}
                  active={props.warningCount > 0 && props.warningPanelOpen}
                  onClick={props.warningCount > 0 ? props.onToggleWarnings : undefined}
                />
              </div>
              {!props.warningPanelOpen &&
                (props.warningCount > 0 ? (
                  <button className="workspaceInspectorNotice actionable" onClick={props.onToggleWarnings} type="button">
                    <span className="signal warn" />
                    <div>
                      <strong>{props.t('warningDetails')}</strong>
                      <small>{props.t('warningReviewHint')}</small>
                    </div>
                  </button>
                ) : (
                  <div className="workspaceInspectorNotice">
                    <span className={`signal ${props.translationComplete ? 'good' : 'muted'}`} />
                    <div>
                      <strong>{props.t('workflowSummary')}</strong>
                      <small>{props.t('subtitlePanelHint')}</small>
                    </div>
                  </div>
                ))}
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
              <div className="railStatusStack">
                <div className="railNote">
                  <span className={`signal ${props.translationState.tone}`} />
                  <div>
                    <strong>{providerLabel(props.translationProviderId, props.t)}</strong>
                    <small>{props.translationState.detail}</small>
                  </div>
                </div>
                <div className="railNote">
                  <span className={`signal ${props.runtimeState.tone}`} />
                  <div>
                    <strong>{props.t('runtime')}</strong>
                    <small title={props.runtimeState.detail}>{props.workspaceRuntimeDetail}</small>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}

        <section className="workspaceMain">
          <section className="workspaceHero" aria-label={props.t('currentJob')}>
            <div className="jobMediaCard">
              <div className="workspaceCardTop">
                <span className="fieldLabel">{props.t('currentJob')}</span>
                <span className="stageBadge">{props.t(stageLabel(props.job?.stage ?? 'idle'))}</span>
              </div>
              <strong title={props.jobTitle}>{props.jobTitle}</strong>
              <p className="workspacePath" title={props.selectedMediaPath || props.t('placeholderPath')}>
                {props.selectedMediaPath || props.t('placeholderPath')}
              </p>
              <div className="jobMediaMeta">
                <span className="metaPill">{`${props.sourceLabel} -> ${props.targetLabel}`}</span>
                <span className="metaPill">{providerLabel(props.asrProviderId, props.t)}</span>
                <span className="metaPill">{providerLabel(props.translationProviderId, props.t)}</span>
              </div>
              <div className="workspaceProgressPanel">
                <div className="workspaceProgressCopy">
                  <span>{props.t('progress')}</span>
                  <strong>{props.completion}%</strong>
                </div>
                <div className={`workspaceProgressTrack${props.jobIsRunning ? ' active' : ''}`} aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, props.completion))}%` }} />
                </div>
              </div>
            </div>

            <div className="jobActionCard">
              <div className="workspaceCardTop">
                <span className="fieldLabel">{props.t('workflowSummary')}</span>
                <span className="metaPill">{props.t('languagePair')}</span>
              </div>
              <strong className="workspaceRoute">{`${props.sourceLabel} -> ${props.targetLabel}`}</strong>
              <div className="workspaceActionStack">
                <button className="secondary wideButton" onClick={props.onPickMedia} type="button">
                  <FileVideo size={16} />
                  {props.t('chooseMedia')}
                </button>
                <div className="workspaceActionRow">
                  <button
                    className={props.hasRecognizedSubtitles ? 'secondary' : 'primary'}
                    disabled={Boolean(props.runningAction) || !props.mediaPath.trim()}
                    onClick={props.onCreateAndStart}
                    type="button"
                  >
                    <Play size={16} />
                    {props.t('startTranscription')}
                  </button>
                  <button
                    className={props.hasRecognizedSubtitles && !props.translationComplete ? 'primary' : 'secondary'}
                    disabled={Boolean(props.runningAction) || !props.job?.subtitleDocument}
                    onClick={props.onTranslateJob}
                    type="button"
                  >
                    <Languages size={16} />
                    {props.t('translateSubtitles')}
                  </button>
                </div>
              </div>
              <p className="workspaceActionHint">{props.t('reviewHint')}</p>
            </div>

            <div className="workspaceSignalDeck">
              <div className="workspaceSignalGrid">
                <MetricCard icon={<ShieldCheck size={16} />} label={props.t('translatedRows')} value={`${props.translatedCount}/${props.job?.subtitleDocument?.segments.length ?? 0}`} />
                <MetricCard
                  icon={<AlertCircle size={16} />}
                  label={props.t('warnings')}
                  value={String(props.warningCount)}
                  active={props.warningCount > 0 && props.warningPanelOpen}
                  onClick={props.warningCount > 0 ? props.onToggleWarnings : undefined}
                />
              </div>
              <div className="workspaceHealthGrid">
                <div className="railNote workspaceCompactNote">
                  <span className={`signal ${props.translationState.tone}`} />
                  <div>
                    <strong>{providerLabel(props.translationProviderId, props.t)}</strong>
                    <small>{props.translationState.detail}</small>
                  </div>
                </div>
                <div className="railNote workspaceCompactNote">
                  <span className={`signal ${props.runtimeState.tone}`} />
                  <div>
                    <strong>{props.t('runtime')}</strong>
                    <small title={props.runtimeState.detail}>{props.workspaceRuntimeDetail}</small>
                  </div>
                </div>
              </div>
            </div>
          </section>

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
        </section>
      </main>
    </section>
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
      <div className="metricIcon">{props.icon}</div>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </>
  );

  if (props.onClick) {
    return (
      <button className={props.active ? 'metricCard active' : 'metricCard'} onClick={props.onClick} type="button">
        {content}
      </button>
    );
  }

  return <div className={props.active ? 'metricCard active' : 'metricCard'}>{content}</div>;
}
