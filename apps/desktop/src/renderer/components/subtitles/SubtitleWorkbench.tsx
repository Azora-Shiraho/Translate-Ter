import React, { useRef, useEffect } from 'react';
import { Clock3, AlignLeft, Target } from 'lucide-react';
import type { JobSnapshot, SubtitleSegment } from '@shared/types';
import { formatTimestamp } from '@shared/srt';
import { statusLabel } from '../../app/displayHelpers';

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
  const hasSegments = segments.length > 0;
  
  // Create a ref for auto-scrolling to selected segment in list if needed
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A simple approach to scroll active card into view
    if (props.selectedSegment && listRef.current) {
      const activeEl = listRef.current.querySelector('.segmentCard.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [props.selectedSegment?.id]);

  if (!props.job?.subtitleDocument || !hasSegments) {
    return (
      <section className="subtitleWorkbench" style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
        <div className="empty" style={{ textAlign: 'center', color: 'var(--tt-text-muted)' }}>
          <Clock3 size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
          <strong style={{ display: 'block', fontSize: '18px', marginBottom: '8px', color: 'var(--tt-text-strong)' }}>{props.t('noSubtitlesTitle')}</strong>
          <span>{props.t('noSubtitles')}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="workbenchSplitView">
      <div className="workbenchListArea" ref={listRef}>
        {segments.map((segment) => {
          const isActive = segment.id === props.selectedSegment?.id;
          return (
            <div 
              key={segment.id} 
              className={`segmentCard ${isActive ? 'active' : ''}`}
              onClick={() => props.onSelectSegment(segment.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onSelectSegment(segment.id);
                }
              }}
            >
              <div className="segmentCardHeader">
                <span className="segmentTime">
                  <Clock3 size={11} />
                  {formatTimestamp(segment.startMs)} - {formatTimestamp(segment.endMs)}
                </span>
                <span className={`status ${segment.status}`} style={{ fontSize: '11px' }}>
                  {props.t(statusLabel(segment.status))}
                </span>
              </div>
              <div className="segmentPreviewText">{segment.sourceText}</div>
              {segment.translatedText && (
                <div className="segmentPreviewTranslated">{segment.translatedText}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="workbenchEditorArea">
        {props.selectedSegment ? (
          <>
            <div className="editorHeader">
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: 'var(--tt-text-strong)' }}>
                  {props.t('segmentDetails')} <span style={{ color: 'var(--tt-accent)', marginLeft: '8px' }}>#{props.selectedSegment.index}</span>
                </h3>
                <span className="segmentTime" style={{ fontSize: '12px' }}>
                  <Clock3 size={12} />
                  {formatTimestamp(props.selectedSegment.startMs)} ➔ {formatTimestamp(props.selectedSegment.endMs)}
                </span>
              </div>
              <span className={`status ${props.selectedSegment.status}`} style={{ padding: '6px 12px', fontSize: '13px' }}>
                {props.t(statusLabel(props.selectedSegment.status))}
              </span>
            </div>

            <div className="editorPaneBlock">
              <div className="editorPaneLabel">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlignLeft size={14}/> {props.sourceLabel} ({props.t('original')})</span>
                <span>{props.selectedSegment.sourceText.length} {props.t('chars')}</span>
              </div>
              <textarea
                className="editorTextArea"
                aria-label={`${props.t('original')} ${props.selectedSegment.index}`}
                value={props.selectedSegment.sourceText}
                onChange={(event) => props.onUpdateSegment(props.selectedSegment!, { sourceText: event.target.value })}
              />
            </div>

            <div className="editorPaneBlock">
              <div className="editorPaneLabel">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--tt-accent)' }}><Target size={14}/> {props.targetLabel} ({props.t('translated')})</span>
                <span>{(props.selectedSegment.translatedText ?? '').length} {props.t('chars')}</span>
              </div>
              <textarea
                className="editorTextArea translated"
                aria-label={`${props.t('translated')} ${props.selectedSegment.index}`}
                value={props.selectedSegment.translatedText ?? ''}
                placeholder={props.t('translated')}
                onChange={(event) =>
                  props.onUpdateSegment(props.selectedSegment!, { translatedText: event.target.value })
                }
              />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--tt-text-muted)' }}>
            <p>{props.t('selectSegmentToEdit')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
