import React from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { useBatchViewModel } from '../../viewModels/useBatchViewModel';

type BatchQueueViewProps = {
  batchVm: ReturnType<typeof useBatchViewModel>;
  workspaceRunning: boolean;
};

export function BatchQueueView({ batchVm, workspaceRunning }: BatchQueueViewProps): JSX.Element {
  const { t } = useTranslation();
  const queue = batchVm.queue;

  return (
    <section className="viewFrame">
      <main className="batchPage" style={{ padding: '40px' }}>
        <header style={{ marginBottom: '24px' }}>
          <h2><Layers size={24} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> {t('batchProcessing')}</h2>
          <p style={{ opacity: 0.7 }}>{t('batchProcessingHint')}</p>
        </header>

        {workspaceRunning && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '6px',
            backgroundColor: 'var(--tt-color-surface-hover)',
            border: '1px solid var(--tt-color-border)',
            color: 'var(--tt-color-text-primary)',
            fontSize: '14px',
            lineHeight: '1.5'
          }}>
            ⚠️ {t('backendBusyWorkspaceRunning')}
          </div>
        )}

        {queue.items.length === 0 ? (
          <div className="emptyState">
            <p>{t('batchQueueEmpty')}</p>
            <button className="primaryButton" onClick={() => batchVm.addJobs()}>
              {t('addBatchJobs')}
            </button>
          </div>
        ) : (
          <div className="batchQueue">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button className="primaryButton" onClick={() => batchVm.addJobs()} disabled={queue.status === 'running'}>
                {t('addBatchJobs')}
              </button>
              {queue.status !== 'running' && queue.items.some(i => i.status === 'queued') && (
                <button className="primaryButton" onClick={() => batchVm.start()} disabled={workspaceRunning}>
                  {t('startBatch')}
                </button>
              )}
              {(queue.status === 'running' || queue.items.some(i => i.status === 'queued')) && (
                <button className="dangerButton" onClick={() => batchVm.cancel()} disabled={workspaceRunning}>
                  {t('cancelBatch')}
                </button>
              )}
            </div>

            <div className="batchStats">
              Status: {queue.status} | Total: {queue.totalCount} | Completed: {queue.completedCount} | Failed: {queue.failedCount} | Cancelled: {queue.cancelledCount}
            </div>

            <ul className="batchList" style={{ listStyle: 'none', padding: 0, marginTop: '16px' }}>
              {queue.items.map(item => (
                <li key={item.id} style={{ padding: '12px', border: '1px solid var(--tt-color-border)', borderRadius: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong>{item.fileName}</strong>
                    <span className={`badge ${item.status}`}>{item.status}</span>
                  </div>
                  {item.status === 'running' && (
                    <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--tt-color-surface-hover)', borderRadius: '2px', marginTop: '8px' }}>
                      <div style={{ width: `${item.progress}%`, height: '100%', backgroundColor: 'var(--tt-color-accent)', borderRadius: '2px' }} />
                    </div>
                  )}
                  {item.message && <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>{item.message}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </section>
  );
}
