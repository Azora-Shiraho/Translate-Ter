import { useEffect } from 'react';
import type { JobEvent } from '@shared/models';
import { translateTerGateway } from '../api/translateTerGateway';

export function subscribeToJobEvents(listener: (event: JobEvent) => void): () => void {
  return translateTerGateway.jobs.onEvent(listener);
}

export function useJobEvents(listener: (event: JobEvent) => void): void {
  useEffect(() => subscribeToJobEvents(listener), [listener]);
}
