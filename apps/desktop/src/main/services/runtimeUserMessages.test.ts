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

  it('keeps byte-aware keys for FFmpeg progress and classifies GPU components as CUDA', () => {
    expect(
      withAssetUserMessage({ type: 'download-progress', scope: 'ffmpeg', message: 'Downloading FFmpeg tools.', receivedBytes: 42 })
    ).toMatchObject({ userMessage: { messageKey: 'ffmpegDownloadingBytes' } });
    expect(
      withAssetUserMessage({ type: 'download-progress', scope: 'runtime', message: 'Downloading GPU components for faster-whisper...', receivedBytes: 42 })
    ).toMatchObject({ userMessage: { messageKey: 'runtimeMessage.cudaDownloadingBytes' } });
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

  it('uses CUDA-specific keys for CUDA runtime lifecycle events', () => {
    expect(
      withAssetUserMessage({ type: 'download-progress', scope: 'runtime', message: 'Downloading CUDA components...', receivedBytes: 42 })
    ).toMatchObject({
      userMessage: {
        messageKey: 'runtimeMessage.cudaDownloadingBytes',
        technicalMessage: 'Downloading CUDA components...'
      }
    });
    expect(
      withAssetUserMessage({ type: 'ready', scope: 'runtime', message: 'CUDA components are ready.' })
    ).toMatchObject({
      userMessage: { messageKey: 'runtimeMessage.cudaReady' }
    });
  });
});
