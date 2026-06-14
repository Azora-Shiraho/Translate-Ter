import { describe, expect, it } from 'vitest';
import { FasterWhisperService } from './fasterWhisperService';

describe('FasterWhisperService error normalization', () => {
  it('maps huggingface download and tls failures to a readable download error', () => {
    const service = new FasterWhisperService();
    const normalized = (
      service as unknown as {
        normalizeRunnerError(error: unknown): Error & { code?: string; retryable?: boolean };
      }
    ).normalizeRunnerError(
      'huggingface_hub.errors.LocalEntryNotFoundError: Got: ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol'
    );

    expect(normalized.code).toBe('DownloadRequired');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toContain('faster-whisper 模型下载失败');
  });

  it('maps cache permission failures to a readable cache error', () => {
    const service = new FasterWhisperService();
    const normalized = (
      service as unknown as {
        normalizeRunnerError(error: unknown): Error & { code?: string; retryable?: boolean };
      }
    ).normalizeRunnerError('Permission denied: cannot write model cache');

    expect(normalized.code).toBe('DownloadRequired');
    expect(normalized.retryable).toBe(true);
    expect(normalized.message).toContain('模型缓存目录不可写');
  });
});
