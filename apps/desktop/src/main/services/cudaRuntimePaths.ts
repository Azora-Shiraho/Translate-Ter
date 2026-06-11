import { app } from 'electron';
import { dirname, join, resolve } from 'node:path';

export type SharedCudaVersion = '11.8' | '12.8';

export function sharedRuntimeRoot(): string {
  if (app.isPackaged) {
    return join(dirname(process.execPath), 'runtime');
  }
  return join(resolve('.'), '.runtime');
}

export function sharedCudaRuntimeDir(version: SharedCudaVersion): string {
  return join(sharedRuntimeRoot(), 'cuda', version, 'bin');
}

export function legacyWhisperCudaRuntimeDirs(): string[] {
  const runtimeRoot = sharedRuntimeRoot();
  return [
    join(runtimeRoot, 'whisper_cpp', 'cuda', 'Release'),
    join(runtimeRoot, 'whisper_cpp', 'bin', 'Release')
  ];
}
