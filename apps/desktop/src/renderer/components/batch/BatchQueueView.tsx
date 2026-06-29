import React from 'react';
import { Layers, Play, Plus, XCircle, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { useBatchViewModel } from '../../viewModels/useBatchViewModel';

type BatchQueueViewProps = {
  batchVm: ReturnType<typeof useBatchViewModel>;
  workspaceRunning: boolean;
};

export function BatchQueueView({ batchVm, workspaceRunning }: BatchQueueViewProps): JSX.Element {
  const { t } = useTranslation();
  const queue = batchVm.queue;

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Clock size={16} className="statusIcon running" />;
      case 'completed': return <CheckCircle2 size={16} className="statusIcon good" style={{ color: 'var(--tt-accent)' }} />;
      case 'failed': return <AlertCircle size={16} className="statusIcon error" style={{ color: 'var(--tt-status-error)' }} />;
      case 'cancelled': return <XCircle size={16} className="statusIcon muted" />;
      default: return <Clock size={16} className="statusIcon muted" />;
    }
  };

  return (
    <section className="viewFrame">
      <main className="workspaceLayout" style={{ overflowY: 'auto' }}>
        <div className="workspaceMain">
          <div className="workspaceHero">
            <div className="jobMediaCard" style={{ gridColumn: '1 / -1' }}>
              <div className="workspaceCardTop">
                <div className="workflowRailLead">
                  <div className="summaryToggle">
                    <Layers size={20} />
                  </div>
                  <div className="workflowRailCopy">
                    <strong>{t('batchProcessing')}</strong>
                    <small>{t('batchProcessingHint')}</small>
                  </div>
                </div>
                <div className="workspaceActionStack">
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="primaryButton" onClick={() => batchVm.addJobs()} disabled={queue.status === 'running'}>
                      <Plus size={16} style={{ marginRight: '6px' }} />
                      {t('addBatchJobs')}
                    </button>
                    {queue.status !== 'running' && queue.items.some((i) => i.status === 'queued') && (
                      <button className="primaryButton" onClick={() => batchVm.start()} disabled={workspaceRunning}>
                        <Play size={16} style={{ marginRight: '6px' }} />
                        {t('startBatch')}
                      </button>
                    )}
                    {(queue.status === 'running' || queue.items.some((i) => i.status === 'queued')) && (
                      <button className="dangerButton" onClick={() => batchVm.cancel()} disabled={workspaceRunning}>
                        <XCircle size={16} style={{ marginRight: '6px' }} />
                        {t('cancelBatch')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {workspaceRunning && (
              <div className="workspaceInspectorNotice actionable" style={{ gridColumn: '1 / -1' }}>
                <AlertCircle size={16} className="statusIcon warn" />
                <div>
                  <strong>⚠️ {t('backendBusyWorkspaceRunning')}</strong>
                </div>
              </div>
            )}

            <div className="workspaceSignalDeck" style={{ gridColumn: '1 / -1' }}>
              <div className="railHeader">
                <strong>{t('batchSummaryTotal')}: {queue.totalCount}</strong>
              </div>
              <div className="workspaceHealthGrid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                <div className="statusLine">
                  <span>{t('status')}</span>
                  <strong>{t(`batchStatus.${queue.status}`)}</strong>
                </div>
                <div className="statusLine">
                  <span>{t('batchSummaryCompleted')}</span>
                  <strong className="good">{queue.completedCount}</strong>
                </div>
                <div className="statusLine">
                  <span>{t('batchSummaryFailed')}</span>
                  <strong className="error">{queue.failedCount}</strong>
                </div>
                <div className="statusLine">
                  <span>{t('batchSummaryCancelled')}</span>
                  <strong className="muted">{queue.cancelledCount}</strong>
                </div>
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '12px', paddingBottom: '40px' }}>
              {queue.items.length === 0 ? (
                <div className="emptyState" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--tt-text-muted)' }}>
                  <Layers size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                  <p>{t('batchQueueEmpty')}</p>
                </div>
              ) : (
                queue.items.map((item) => (
                  <div key={item.id} className="metricCard" style={{ padding: '16px', display: 'grid', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.fileName}
                      </strong>
                      <span className={`status ${item.status}`} style={{ textTransform: 'capitalize' }}>
                        {renderStatusIcon(item.status)}
                        <span style={{ marginLeft: '4px' }}>{t(`batchStatus.${item.status}`)}</span>
                      </span>
                    </div>
                    {item.status === 'running' && (
                      <div className="workspaceProgressTrack active">
                        <span style={{ width: `${Math.max(2, item.progress)}%` }} />
                      </div>
                    )}
                    {item.message && (
                      <div style={{ fontSize: '13px', color: 'var(--tt-text-muted)' }}>
                        {item.message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </section>
  );
}
