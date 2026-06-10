import { app } from 'electron';
import { dirname, join, resolve } from 'node:path';

export function ffmpegCacheDir(): string {
  if (app.isPackaged) {
    return join(dirname(process.execPath), 'runtime', 'ffmpeg');
  }
  return join(resolve('.'), '.runtime', 'ffmpeg');
}

export function ffmpegBinDir(): string {
  return join(ffmpegCacheDir(), 'bin');
}
