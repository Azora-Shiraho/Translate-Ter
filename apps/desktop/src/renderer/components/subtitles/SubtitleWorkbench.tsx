import React from 'react';
import { Clock3 } from 'lucide-react';
import type { JobSnapshot, SubtitleSegment, SubtitleWarning } from '@shared/types';
import { formatTimestamp } from '@shared/srt';
import { providerLabel, statusLabel } from '../../app/displayHelpers';

type SubtitleWorkbenchProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
  job?: JobSnapshot;
  jobTitle: string;
  sourceLabel: string;
  targetLabel: string;
  asrProviderId: string;
  selectedSegment?: SubtitleSegment;
  warningCount: number;
  translatedCount: number;
  onToggleWarnings: () => void;
  onSelectSegment: (segmentId: string) => void;
  onUpdateSegment: (segment: SubtitleSegment, patch: Partial<SubtitleSegment>) => void;
};

export function SubtitleWorkbench(props: SubtitleWorkbenchProps): JSX.Element {
  const segments = props.job?.subtitleDocument?.segments ?? [];

  return (
    <section className="subtitleWorkbench">
      <div className="panelHeader">
        <div>
          <h2>{props.t('subtitles')}</h2>
          <p>{props.t('reviewHint')}</p>
        </div>
        <div className="panelHeaderMeta">
          <span className="metaPill">{props.t('rows', { count: segments.length })}</span>
          <span className="metaPill">{`${props.translatedCount}/${segments.length}`}</span>
          {props.warningCount > 0 && (
            <button className="textButton" onClick={props.onToggleWarnings} type="button">
              {`${props.warningCount} ${props.t('warnings')}`}
            </button>
          )}
        </div>
      </div>
      {props.job?.subtitleDocument ? (
        <div className="subtitleWorkspace">
          <div className="subtitleTableShell">
            <div className="subtitleTableIntro">
              <div>
                <span className="fieldLabel">{props.t('workflowSummary')}</span>
                <strong>{props.jobTitle}</strong>
              </div>
              <div className="subtitleTableChips">
                <span className="metaPill">{`${props.sourceLabel} -> ${props.targetLabel}`}</span>
                <span className="metaPill">{providerLabel(props.asrProviderId, props.t)}</span>
              </div>
            </div>
            <div className="subtitleTable">
              <div className="row head">
                <span className="rowStart">{props.t('start')}</span>
                <span className="rowEnd">{props.t('end')}</span>
                <span className="rowOriginal">{props.t('original')}</span>
                <span className="rowTranslated">{props.t('translated')}</span>
                <span className="rowStatus">{props.t('status')}</span>
              </div>
              {props.job.subtitleDocument.segments.map((segment) => (
                <button
                  type="button"
                  className={segment.id === props.selectedSegment?.id ? 'row selectable selected' : 'row selectable'}
                  key={segment.id}
                  onClick={() => props.onSelectSegment(segment.id)}
                >
                  <span className="rowStart">{formatTimestamp(segment.startMs)}</span>
                  <span className="rowEnd">{formatTimestamp(segment.endMs)}</span>
                  <div className="previewText rowOriginal">{segment.sourceText}</div>
                  <div className="previewText translatedPreview rowTranslated">{segment.translatedText ?? ''}</div>
                  <span className={`status rowStatus ${segment.status}`}>{props.t(statusLabel(segment.status))}</span>
                </button>
              ))}
            </div>
          </div>
          {props.selectedSegment && (
            <div className="segmentDetail">
              <div className="segmentDetailHero">
                <div className="segmentTitleStack">
                  <span className="fieldLabel">{props.t('segmentDetails')}</span>
                  <h3>
                    <span className="segmentIndexBadge">#{props.selectedSegment.index}</span>
                  </h3>
                </div>
                <span className={`status ${props.selectedSegment.status}`}>
                  {props.t(statusLabel(props.selectedSegment.status))}
                </span>
              </div>
              <div className="segmentDetailMeta">
                <span className="metaPill">{formatTimestamp(props.selectedSegment.startMs)}</span>
                <span className="metaPill">{formatTimestamp(props.selectedSegment.endMs)}</span>
              </div>
              <div className="editorGrid">
                <div className="editorPane">
                  <label>
                    <div className="editorPaneHeader">
                      <span>{props.t('original')}</span>
                      <small>{props.selectedSegment.sourceText.length}</small>
                    </div>
                    <textarea
                      aria-label={`${props.t('original')} ${props.selectedSegment.index}`}
                      value={props.selectedSegment.sourceText}
                      onChange={(event) => props.onUpdateSegment(props.selectedSegment!, { sourceText: event.target.value })}
                    />
                  </label>
                </div>
                <div className="editorPane translatedPane">
                  <label>
                    <div className="editorPaneHeader">
                      <span>{props.t('translated')}</span>
                      <small>{(props.selectedSegment.translatedText ?? '').length}</small>
                    </div>
                    <textarea
                      className="translatedField"
                      aria-label={`${props.t('translated')} ${props.selectedSegment.index}`}
                      value={props.selectedSegment.translatedText ?? ''}
                      placeholder={props.t('translated')}
                      onChange={(event) =>
                        props.onUpdateSegment(props.selectedSegment!, { translatedText: event.target.value })
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
          <strong>{props.t('noSubtitlesTitle')}</strong>
          <span>{props.t('noSubtitles')}</span>
        </div>
      )}
    </section>
  );
}
