import type { NativeProtocolResponse, SubtitleDocument } from '@shared/models';
import type { SerializeSrtOptions } from '@shared/srt';
import type { NativeBackendClient } from './nativeBackendClient';
import {
  createNativeProtocolErrorResponse,
  createNativeProtocolServiceError,
  normalizeThrownNativeProtocolError,
  type NativeProtocolServiceError
} from './nativeBackendClient';

export type NativeParseSrtOptions = {
  sourceLanguage?: string;
  inputMediaPath?: string;
};

export type NativeParseSrtPayload = {
  document: SubtitleDocument;
};

export type NativeSerializeSrtPayload = {
  srt: string;
};

export class NativeSubtitleService {
  constructor(
    private readonly nativeBackend: Pick<NativeBackendClient, 'parseSrt' | 'serializeSrt'>
  ) {}

  async parseSrt(
    raw: string,
    options: NativeParseSrtOptions = {}
  ): Promise<NativeProtocolResponse<NativeParseSrtPayload>> {
    try {
      const response = await this.nativeBackend.parseSrt({
        srt: raw,
        ...options
      });
      if (response.ok && !response.payload?.document) {
        return createNativeProtocolErrorResponse('srt.parse', response.requestId, {
          code: 'InternalError',
          message: 'The native subtitle parser returned no subtitle document.',
          retryable: true
        });
      }
      return response as NativeProtocolResponse<NativeParseSrtPayload>;
    } catch (error) {
      return normalizeThrownNativeProtocolError('srt.parse', error, 'The subtitle file could not be parsed.');
    }
  }

  async serializeSrt(
    document: SubtitleDocument,
    options: SerializeSrtOptions = {}
  ): Promise<NativeProtocolResponse<NativeSerializeSrtPayload>> {
    try {
      const response = await this.nativeBackend.serializeSrt({
        segments: document.segments,
        variant: options.variant,
        bilingualOrder: options.bilingualOrder
      });
      if (response.ok && typeof response.payload?.srt !== 'string') {
        return createNativeProtocolErrorResponse('srt.serialize', response.requestId, {
          code: 'InternalError',
          message: 'The native subtitle serializer returned no SRT content.',
          retryable: true
        });
      }
      return response as NativeProtocolResponse<NativeSerializeSrtPayload>;
    } catch (error) {
      return normalizeThrownNativeProtocolError('srt.serialize', error, 'The subtitle file could not be exported.');
    }
  }
}

export function assertNativeSubtitlePayload<TPayload>(
  response: NativeProtocolResponse<TPayload>,
  fallbackMessage: string
): TPayload {
  if (response.ok && response.payload) {
    return response.payload;
  }
  throw createNativeProtocolServiceError(response, fallbackMessage);
}

export type { NativeProtocolServiceError };
