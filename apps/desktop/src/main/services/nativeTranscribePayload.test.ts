import { describe, expect, it } from 'vitest';
import { createNativeRuntimePayload } from './nativeTranscribePayload';

describe('createNativeRuntimePayload', () => {
  it('builds cpu runtime payload and preserves legacy top-level paths', () => {
    const payload = createNativeRuntimePayload({
      provider: 'whisper.cpp',
      variant: 'cpu',
      binaryPath: 'D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });

    expect(payload.binaryPath).toBe('D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe');
    expect(payload.modelPath).toBe('D:/runtime/whisper_cpp/models/ggml-base.bin');
    expect(payload.runtime).toEqual({
      provider: 'whisper.cpp',
      variant: 'cpu',
      binaryPath: 'D:/runtime/whisper_cpp/cpu/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });
  });

  it('builds cuda runtime payload and preserves legacy top-level paths', () => {
    const payload = createNativeRuntimePayload({
      provider: 'whisper.cpp',
      variant: 'cuda',
      binaryPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });

    expect(payload.binaryPath).toBe('D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe');
    expect(payload.modelPath).toBe('D:/runtime/whisper_cpp/models/ggml-base.bin');
    expect(payload.runtime).toEqual({
      provider: 'whisper.cpp',
      variant: 'cuda',
      binaryPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      modelPath: 'D:/runtime/whisper_cpp/models/ggml-base.bin'
    });
  });
});
