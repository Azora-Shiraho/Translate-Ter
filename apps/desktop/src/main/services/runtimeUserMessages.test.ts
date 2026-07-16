import { describe, expect, it } from 'vitest';
import { withAssetUserMessage } from './runtimeUserMessages';

describe('runtime asset message descriptors', () => {
  it('maps asset lifecycle events to stable translation keys', () => {
    expect(
      withAssetUserMessage({ type: 'verify', scope: 'ffmpeg', message: 'Checking downloaded FFmpeg files.' })
    ).toMatchObject({
      userMessage: {
        messageKey: 'ffmpegVerifying',
        technicalMessage: 'Checking downloaded FFmpeg files.'
      }
    });
  });

  it('keeps HTTP download details out of the user-facing message', () => {
    expect(
      withAssetUserMessage({ type: 'error', scope: 'runtime', message: 'Runtime download failed with HTTP 503.' })
    ).toMatchObject({
      userMessage: {
        messageKey: 'runtimeMessage.assetDownloadHttpFailed',
        messageParams: { status: '503' },
        technicalMessage: 'Runtime download failed with HTTP 503.'
      }
    });
  });
});
