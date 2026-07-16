import { describe, expect, it } from 'vitest';
import { assetEventLabel } from './useSettingsViewModel';

describe('assetEventLabel', () => {
  const t = (key: string): string => `translated:${key}`;

  it('uses model asset descriptors for lifecycle events', () => {
    for (const type of ['download-start', 'download-progress', 'ready'] as const) {
      expect(
        assetEventLabel(
          {
            type,
            scope: 'model',
            message: 'Model activity.',
            userMessage: { messageKey: type === 'ready' ? 'runtimeMessage.modelReady' : 'runtimeMessage.modelDownloading' }
          },
          t
        )
      ).toBe(`translated:${type === 'ready' ? 'runtimeMessage.modelReady' : 'runtimeMessage.modelDownloading'}`);
    }
  });
});
