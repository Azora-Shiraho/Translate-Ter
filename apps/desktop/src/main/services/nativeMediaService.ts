import type { NativeProtocolResponse } from '@shared/models';
import type {
  NativeAudioExtractPayload,
  NativeAudioExtractRequest,
  NativeBackendClient,
  NativeMediaProbePayload,
  NativeMediaProbeRequest
} from './nativeBackendClient';
import {
  createNativeProtocolErrorResponse,
  normalizeThrownNativeProtocolError
} from './nativeBackendClient';

export class NativeMediaService {
  constructor(
    private readonly nativeBackend: Pick<NativeBackendClient, 'probeMedia' | 'extractAudio'>
  ) {}

  async probeMedia(
    payload: NativeMediaProbeRequest
  ): Promise<NativeProtocolResponse<NativeMediaProbePayload>> {
    try {
      const response = await this.nativeBackend.probeMedia(payload);
      if (response.ok && !response.payload) {
        return createNativeProtocolErrorResponse('media.probe', response.requestId, {
          code: 'InternalError',
          message: 'The native media probe returned no payload.',
          retryable: true
        });
      }
      return response;
    } catch (error) {
      return normalizeThrownNativeProtocolError('media.probe', error, 'The media file could not be checked.');
    }
  }

  async extractAudio(
    payload: NativeAudioExtractRequest
  ): Promise<NativeProtocolResponse<NativeAudioExtractPayload>> {
    try {
      const response = await this.nativeBackend.extractAudio(payload);
      if (response.ok && !response.payload) {
        return createNativeProtocolErrorResponse('audio.extract', response.requestId, {
          code: 'InternalError',
          message: 'The native audio extractor returned no payload.',
          retryable: true
        });
      }
      return response;
    } catch (error) {
      return normalizeThrownNativeProtocolError('audio.extract', error, 'Audio could not be extracted from this file.');
    }
  }
}
