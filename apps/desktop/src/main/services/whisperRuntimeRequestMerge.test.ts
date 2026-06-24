import { describe, expect, it } from 'vitest';
import type { AppSettingsPublic, WhisperRuntimeRequest } from '@shared/models';
import { mergeWhisperRuntimeRequestWithSettings } from './whisperRuntimeRequestMerge';

function createSettings(overrides: Partial<AppSettingsPublic> = {}): AppSettingsPublic {
  return {
    schemaVersion: 1,
    uiLanguage: 'en-US',
    theme: 'system',
    logLevel: 'info',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    asrProviderId: 'local.whisper.cpp',
    whisperModelId: 'ggml-base',
    localAsrAcceleration: 'auto',
    preferredRuntimeVariant: undefined,
    localWhisperUseCuda: true,
    localAsrCpuMode: 'balanced',
    localAsrCompatibilityOverrides: {
      ignoreCudaMismatch: false
    },
    localWhisperIgnoreCudaMismatch: false,
    allowWhisperAssetDownload: true,
    enableMultiThreadDownload: true,
    allowCloudAsrUpload: false,
    translationProviderPriority: ['openai.compatible'],
    translationConcurrency: 2,
    translationRequestsPerMinute: 60,
    translationTokenBudgetPerMinute: 60000,
    translationLinesPerRequest: 8,
    translationBatchStride: 4,
    exportDestinationMode: 'source-directory',
    exportDirectory: '',
    exportBilingualOrder: 'source-first',
    exportFileFormat: 'srt',
    ...overrides
  };
}

function createRequest(overrides: Partial<WhisperRuntimeRequest> = {}): WhisperRuntimeRequest {
  return {
    modelId: 'ggml-base',
    allowDownload: false,
    preferCuda: false,
    downloadScope: 'none',
    ...overrides
  };
}

describe('mergeWhisperRuntimeRequestWithSettings', () => {
  it('keeps legacy-only request driven by preferCuda even when settings use auto', () => {
    const settings = createSettings({
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined
    });

    const merged = mergeWhisperRuntimeRequestWithSettings(
      createRequest({
        preferCuda: false
      }),
      settings
    );

    expect(merged.preferCuda).toBe(false);
    expect(merged.localAsrAcceleration).toBeUndefined();
    expect(merged.preferredRuntimeVariant).toBeUndefined();
    expect(merged.useMultiThreadDownload).toBe(true);
  });

  it('applies settings-backed new fields when caller already opted into new request shape', () => {
    const settings = createSettings({
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined
    });

    const merged = mergeWhisperRuntimeRequestWithSettings(
      createRequest({
        preferCuda: false,
        localAsrAcceleration: 'auto'
      }),
      settings
    );

    expect(merged.localAsrAcceleration).toBe('auto');
    expect(merged.preferredRuntimeVariant).toBeUndefined();
    expect(merged.useMultiThreadDownload).toBe(true);
  });

  it('preserves explicit cpu variant without overwriting it from settings', () => {
    const settings = createSettings({
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda'
    });

    const merged = mergeWhisperRuntimeRequestWithSettings(
      createRequest({
        preferCuda: true,
        localAsrAcceleration: 'cpu',
        preferredRuntimeVariant: 'cpu',
        useMultiThreadDownload: false
      }),
      settings
    );

    expect(merged.localAsrAcceleration).toBe('cpu');
    expect(merged.preferredRuntimeVariant).toBe('cpu');
    expect(merged.useMultiThreadDownload).toBe(false);
  });
});
