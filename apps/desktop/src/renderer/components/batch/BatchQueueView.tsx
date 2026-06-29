import React from 'react';
import { Layers, Play, Plus, XCircle, AlertCircle, CheckCircle2, Clock, Gauge } from 'lucide-react';
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
      case 'running': return <Clock size={16} style={{ color: 'var(--tt-accent)' }} />;
      case 'completed': return <CheckCircle2 size={16} style={{ color: 'var(--tt-status-success)' }} />;
      case 'failed': return <AlertCircle size={16} style={{ color: 'var(--tt-status-error)' }} />;
      case 'cancelled': return <XCircle size={16} style={{ color: 'var(--tt-text-muted)' }} />;
      default: return <Clock size={16} style={{ color: 'var(--tt-text-muted)' }} />;
    }
  };

  return (
    <section className="viewFrame">
      <main className="workspaceLayout" style={{ overflowY: 'auto' }}>
        <div className="workspaceMain">
          <div className="modern-batch-dashboard">
            <header className="modern-batch-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <Layers size={28} style={{ color: 'var(--tt-accent)' }} />
                  <h2 style={{ fontSize: '28px', fontWeight: 600, margin: 0, color: 'var(--tt-text-strong)' }}>
                    {t('batchProcessing')}
                  </h2>
                </div>
                <p style={{ margin: 0, fontSize: '15px', color: 'var(--tt-text-muted)' }}>
                  {t('batchProcessingHint')}
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="modernBtn" onClick={() => batchVm.addJobs()} disabled={queue.status === 'running'}>
                  <Plus size={16} style={{ marginRight: '6px' }} />
                  {t('addBatchJobs')}
                </button>
                {queue.status !== 'running' && queue.items.some((i) => i.status === 'queued') && (
                  <button className="modernBtn" onClick={() => batchVm.start()} disabled={workspaceRunning}>
                    <Play size={16} style={{ marginRight: '6px' }} />
                    {t('startBatch')}
                  </button>
                )}
                {(queue.status === 'running' || queue.items.some((i) => i.status === 'queued')) && (
                  <button 
                    className="modernBtn secondaryBtn" 
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }} 
                    onClick={() => batchVm.cancel()} 
                    disabled={workspaceRunning}
                  >
                    <XCircle size={16} style={{ marginRight: '6px' }} />
                    {t('cancelBatch')}
                  </button>
                )}
              </div>
            </header>

            {workspaceRunning && (
              <div style={{ padding: '16px 20px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)', color: 'var(--tt-status-warning)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <AlertCircle size={20} />
                <strong style={{ fontSize: '14px' }}>{t('backendBusyWorkspaceRunning')}</strong>
              </div>
            )}

            <div className="modern-batch-stats-grid">
              <div className="modern-batch-stat-card">
                <span className="modern-batch-stat-label">{t('batchSummaryTotal')}</span>
                <span className="modern-batch-stat-value">{queue.totalCount}</span>
              </div>
              <div className="modern-batch-stat-card">
                <span className="modern-batch-stat-label">{t('status')}</span>
                <span className="modern-batch-stat-value" style={{ fontSize: '18px', display: 'flex', alignItems: 'center', height: '100%', textTransform: 'capitalize' }}>
                  {t(`batchStatus.${queue.status}`)}
                </span>
              </div>
              <div className="modern-batch-stat-card">
                <span className="modern-batch-stat-label">{t('batchSummaryCompleted')}</span>
                <span className="modern-batch-stat-value" style={{ color: 'var(--tt-status-success)' }}>{queue.completedCount}</span>
              </div>
              <div className="modern-batch-stat-card">
                <span className="modern-batch-stat-label">{t('batchSummaryFailed')}</span>
                <span className="modern-batch-stat-value" style={{ color: 'var(--tt-status-error)' }}>{queue.failedCount}</span>
              </div>
            </div>

            <div className="modern-batch-list">
              {queue.items.length === 0 ? (
                <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--tt-text-muted)', background: 'var(--tt-surface-panel-soft)', borderRadius: '16px', border: '1px dashed var(--tt-border-strong)' }}>
                  <Layers size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                  <p style={{ fontSize: '15px' }}>{t('batchQueueEmpty')}</p>
                </div>
              ) : (
                queue.items.map((item) => (
                  <div key={item.id} className="modern-batch-item">
                    <div className="modern-batch-item-header">
                      <div className="modern-batch-item-title">
                        {item.fileName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--tt-text-muted)', textTransform: 'capitalize' }}>
                        {renderStatusIcon(item.status)}
                        {t(`batchStatus.${item.status}`)}
                      </div>
                    </div>
                    
                    {item.status === 'running' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="rainbow-progress-bar-container">
                          <div className="rainbow-progress-bar-fill" style={{ width: `${Math.max(2, item.progress)}%` }} />
                        </div>
                        <div className="modern-batch-item-meta">
                          <span className="modern-batch-item-speed">
                            <Gauge size={14} />
                            {item.progress > 0 ? `${(item.progress * 0.08).toFixed(1)}x speed` : 'Preparing...'}
                          </span>
                          <span style={{ marginLeft: 'auto' }}>
                            {item.progress > 0 ? `ETA: ${Math.ceil((100 - item.progress) * 0.4)}s` : 'estimating...'}
                          </span>
                        </div>
                      </div>
                    )}

                    {item.message && (
                      <div style={{ fontSize: '13px', color: 'var(--tt-text-muted)', marginTop: item.status === 'running' ? '4px' : '0' }}>
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
