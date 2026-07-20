import { describe, expect, it } from 'vitest';
import { assetEventLabel } from './useSettingsViewModel';

describe('assetEventLabel', () => {
  const t = (key: string, options?: Record<string, unknown>): string =>
    `translated:${key}${options?.bytes ? `:${String(options.bytes)}` : ''}`;

  it('uses model asset descriptors for lifecycle events', () => {
    for (const type of ['download-start', 'ready'] as const) {
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

  it('interpolates received bytes into localized progress descriptors', () => {
    expect(
      assetEventLabel(
        {
          type: 'download-progress',
          scope: 'model',
          message: 'Downloading Whisper model...',
          receivedBytes: 42 * 1024 * 1024,
          userMessage: { messageKey: 'runtimeMessage.modelDownloadingBytes' }
        },
        t
      )
    ).toBe('translated:runtimeMessage.modelDownloadingBytes:42.0 MB');
  });
});
