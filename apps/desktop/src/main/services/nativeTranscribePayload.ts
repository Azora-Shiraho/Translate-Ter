import type { RuntimeVariant } from '@shared/models';

export type NativeRuntimeProvider = 'whisper.cpp' | 'faster-whisper' | 'mlx' | 'coreml';

export type NativeRuntimePayload = {
  provider: NativeRuntimeProvider;
  variant: RuntimeVariant;
  binaryPath?: string;
  modelPath: string;
  libraryPaths?: string[];
  env?: Record<string, string>;
};

export type NativeRuntimePayloadInput = {
  provider: NativeRuntimeProvider;
  variant: RuntimeVariant;
  binaryPath?: string;
  modelPath: string;
  libraryPaths?: string[];
  env?: Record<string, string>;
};

export function createNativeRuntimePayload(
  input: NativeRuntimePayloadInput
): {
  binaryPath?: string;
  modelPath: string;
  runtime: NativeRuntimePayload;
} {
  const runtime: NativeRuntimePayload = {
    provider: input.provider,
    variant: input.variant,
    modelPath: input.modelPath
  };

  if (input.binaryPath) {
    runtime.binaryPath = input.binaryPath;
  }

  if (input.libraryPaths && input.libraryPaths.length > 0) {
    runtime.libraryPaths = [...input.libraryPaths];
  }

  if (input.env && Object.keys(input.env).length > 0) {
    runtime.env = { ...input.env };
  }

  return {
    binaryPath: input.binaryPath,
    modelPath: input.modelPath,
    runtime
  };
}
