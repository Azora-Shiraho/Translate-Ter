import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { SubtitleWarning } from '@shared/types';
import {
  deriveWarningHint,
  formatWarningDate,
  formatWarningSegmentRange,
  formatWarningTimeline,
  warningCategoryLabel,
  warningSourceLabel,
  warningSummaryLabel,
  resolveTechnicalMessage,
  resolveUserMessage
} from '../../app/displayHelpers';

type WarningPanelProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  warnings: SubtitleWarning[];
  selectedWarning?: SubtitleWarning;
  asrProviderId: string;
  translationProviderId: string;
  onToggle: () => void;
  onSelectWarning: (warningId: string) => void;
};

export function WarningPanel(props: WarningPanelProps): JSX.Element {
  const warningHint = deriveWarningHint(props.selectedWarning, props.t);
  const showWarningList = props.warnings.length > 1;

  if (!props.selectedWarning) {
    return (
      <div className="workspaceInspectorNotice">
        <span className="signal muted" />
        <div>
          <strong>{props.t('workflowSummary')}</strong>
          <small>{props.t('subtitlePanelHint')}</small>
        </div>
      </div>
    );
  }

  return (
    <div className="warningPanel">
      <div className="warningPanelHeader">
        <div>
          <strong>{props.t('warningDetails')}</strong>
          <small>{warningHint}</small>
        </div>
        <button className="textButton" onClick={props.onToggle} type="button">
          <AlertCircle size={14} />
          {props.t('warnings')}
        </button>
      </div>
      {showWarningList && (
        <div className="warningList" role="list">
          {props.warnings.map((warning) => (
            <button
              className={`warningItem${props.selectedWarning?.id === warning.id ? ' active' : ''}`}
              key={warning.id}
              onClick={() => warning.id && props.onSelectWarning(warning.id)}
              type="button"
            >
              <span className="signal warn" />
              <div className="warningItemBody">
                <div className="warningItemHeader">
                  <strong>{warningSummaryLabel(warning, props.t)}</strong>
                  <span className="warningPill">{warningCategoryLabel(warning, props.t)}</span>
                </div>
                <small>{resolveUserMessage(warning, props.t)}</small>
                <div className="warningItemMeta">
                  <span>{warningSourceLabel(warning, props.asrProviderId, props.translationProviderId, props.t)}</span>
                  {formatWarningSegmentRange(warning) !== '--' && <span>{formatWarningSegmentRange(warning)}</span>}
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
            <strong>{warningSummaryLabel(props.selectedWarning, props.t)}</strong>
            <small>{resolveUserMessage(props.selectedWarning, props.t)}</small>
          </div>
        </div>
        <div className="warningDetailBadges">
          <span className="warningPill">{warningCategoryLabel(props.selectedWarning, props.t)}</span>
          <span className="warningPill">
            {warningSourceLabel(props.selectedWarning, props.asrProviderId, props.translationProviderId, props.t)}
          </span>
        </div>
        {props.selectedWarning.userMessage?.technicalMessage && (
          <details>
            <summary>{props.t('technicalDetails')}</summary>
            <small>{resolveTechnicalMessage(props.selectedWarning)}</small>
          </details>
        )}
        <div className="warningMetaGrid">
          <div className="warningMetaCard">
            <span>{props.t('warningType')}</span>
            <strong>{warningCategoryLabel(props.selectedWarning, props.t)}</strong>
          </div>
          <div className="warningMetaCard">
            <span>{props.t('warningCode')}</span>
            <strong className="muted">{props.selectedWarning.code}</strong>
          </div>
          <div className="warningMetaCard">
            <span>{props.t('warningSegmentRange')}</span>
            <strong className="warn">{formatWarningSegmentRange(props.selectedWarning)}</strong>
          </div>
          <div className="warningMetaCard">
            <span>{props.t('warningTimeline')}</span>
            <strong className="warn">{formatWarningTimeline(props.selectedWarning)}</strong>
          </div>
          <div className="warningMetaCard">
            <span>{props.t('warningGeneratedAt')}</span>
            <strong className="muted">{formatWarningDate(props.selectedWarning.createdAt)}</strong>
          </div>
          <div className="warningMetaCard">
            <span>{props.t('warningProvider')}</span>
            <strong className="muted">
              {warningSourceLabel(props.selectedWarning, props.asrProviderId, props.translationProviderId, props.t)}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
