import type { AssetEvent, UserMessageDescriptor } from '@shared/models';

export function withAssetUserMessage(event: AssetEvent): AssetEvent {
  if (event.userMessage) return event;
  return {
    ...event,
    userMessage: assetDescriptor(event)
  } as AssetEvent;
}

function assetDescriptor(event: AssetEvent): UserMessageDescriptor {
  const technicalMessage = event.message;
  if (event.type === 'error') {
    const status = event.message.match(/HTTP\s+(\d+)/i)?.[1];
    if (status) {
      return {
        messageKey: 'runtimeMessage.assetDownloadHttpFailed',
        messageParams: { status },
        technicalMessage
      };
    }
    if (/integrity|完整性|校验/i.test(event.message)) {
      return { messageKey: 'runtimeMessage.assetIntegrityFailed', technicalMessage };
    }
    if (/faster-whisper/i.test(event.message)) {
      return { messageKey: 'runtimeMessage.fasterWhisperInstallFailed', technicalMessage };
    }
    return { messageKey: event.scope === 'ffmpeg' ? 'ffmpegError' : 'runtimeError', technicalMessage };
  }

  if (event.scope === 'ffmpeg') {
    return {
      messageKey: {
        'download-start': 'ffmpegDownloading',
        'download-progress': 'ffmpegDownloading',
        verify: 'ffmpegVerifying',
        extract: 'ffmpegExtracting',
        ready: 'ffmpegReady'
      }[event.type],
      technicalMessage
    };
  }
  if (event.scope === 'model') {
    return {
      messageKey: {
        'download-start': 'runtimeMessage.modelDownloading',
        'download-progress': 'runtimeMessage.modelDownloadingBytes',
        verify: 'runtimeMessage.modelVerifying',
        ready: 'runtimeMessage.modelReady'
      }[event.type],
      technicalMessage
    };
  }

  const cuda = /CUDA components/i.test(event.message);
  const fasterWhisper = /faster-whisper|local recognition environment|Python package manager/i.test(event.message);
  return {
    messageKey: cuda
      ? {
          'download-start': 'runtimeMessage.cudaDownloading',
          'download-progress': 'runtimeMessage.cudaDownloadingBytes',
          verify: 'runtimeMessage.cudaVerifying',
          extract: 'runtimeMessage.cudaExtracting',
          ready: 'runtimeMessage.cudaReady'
        }[event.type]
      : fasterWhisper
      ? {
          'download-start': 'runtimeMessage.fasterWhisperDownloading',
          'download-progress': 'runtimeMessage.fasterWhisperDownloadingBytes',
          verify: 'runtimeMessage.fasterWhisperVerifying',
          extract: 'runtimeMessage.fasterWhisperExtracting',
          ready: 'runtimeMessage.fasterWhisperReady'
        }[event.type]
      : {
          'download-start': 'runtimeDownloading',
          'download-progress': 'runtimeDownloadingBytes',
          verify: 'runtimeVerifying',
          extract: 'runtimeExtracting',
          ready: 'runtimeReady'
        }[event.type],
    technicalMessage
  };
}
