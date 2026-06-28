import { useEffect } from 'react';
import type { AssetEvent } from '@shared/models';
import { translateTerGateway } from '../api/translateTerGateway';

export function subscribeToAssetEvents(listener: (event: AssetEvent) => void): () => void {
  return translateTerGateway.assets.onEvent(listener);
}

export function useAssetEvents(listener: (event: AssetEvent) => void): void {
  useEffect(() => subscribeToAssetEvents(listener), [listener]);
}
