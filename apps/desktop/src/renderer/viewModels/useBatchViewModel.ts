import { useCallback, useEffect, useState } from 'react';
import type { AppSettingsPublic, BatchQueueSnapshot, BatchQueueEvent, CreateBatchJobsRequest } from '@shared/models';
import { translateTerGateway } from '../api/translateTerGateway';
import type { UiFeedback } from '../app/types';

type UseBatchViewModelProps = {
  feedback: UiFeedback;
  settings?: AppSettingsPublic;
};

export function useBatchViewModel({ feedback, settings }: UseBatchViewModelProps) {
  const [queue, setQueue] = useState<BatchQueueSnapshot>({
    id: 'empty',
    status: 'idle',
    items: [],
    totalCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  useEffect(() => {
    translateTerGateway.batch.get().then(setQueue).catch((error) => {
      feedback.reportUiError('batch.fetch', error, undefined, 'renderer.batch');
    });

    const unsubscribe = translateTerGateway.batch.onEvent((event: BatchQueueEvent) => {
      if (event.type === 'snapshot') {
        setQueue(event.queue);
      } else if (event.type === 'item') {
        setQueue((current) => {
          if (current.id !== event.queueId) return current;
          return {
            ...current,
            items: current.items.map((item) => (item.id === event.item.id ? event.item : item))
          };
        });
      }
    });

    return () => unsubscribe();
  }, [feedback]);

  const addJobs = useCallback(async () => {
    try {
      const mediaPaths = await translateTerGateway.desktop.selectMultipleMedia();
      if (!mediaPaths || !settings) return;
      const paths = mediaPaths;
      
      const request: CreateBatchJobsRequest = {
        mediaPaths: paths,
        autoTranslate: true, // we could add this to Settings later, for now true
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        localWhisperUseCuda: settings.localWhisperUseCuda,
        localAsrAcceleration: settings.localAsrAcceleration,
        preferredRuntimeVariant: settings.preferredRuntimeVariant,
        localAsrCpuMode: settings.localAsrCpuMode,
        localWhisperIgnoreCudaMismatch: settings.localWhisperIgnoreCudaMismatch,
        allowWhisperAssetDownload: settings.allowWhisperAssetDownload,
        allowCloudAsrUpload: settings.allowCloudAsrUpload,
        translationProviderPriority: settings.translationProviderPriority,
        translationConcurrency: settings.translationConcurrency,
        translationRequestsPerMinute: settings.translationRequestsPerMinute,
        translationTokenBudgetPerMinute: settings.translationTokenBudgetPerMinute,
        translationLinesPerRequest: settings.translationLinesPerRequest,
        translationBatchStride: settings.translationBatchStride
      };
      const result = await translateTerGateway.batch.addJobs(request);
      setQueue(result);
    } catch (error) {
      feedback.reportUiError('batch.addJobs', error, undefined, 'renderer.batch');
    }
  }, [feedback, settings]);

  const start = useCallback(async () => {
    try {
      const result = await translateTerGateway.batch.start();
      setQueue(result);
    } catch (error) {
      feedback.reportUiError('batch.start', error, undefined, 'renderer.batch');
    }
  }, [feedback]);

  const cancel = useCallback(async () => {
    try {
      const result = await translateTerGateway.batch.cancel();
      setQueue(result);
    } catch (error) {
      feedback.reportUiError('batch.cancel', error, undefined, 'renderer.batch');
    }
  }, [feedback]);

  return {
    queue,
    addJobs,
    start,
    cancel
  };
}
