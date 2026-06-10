import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import type { AssetEvent, FfmpegRequest, FfmpegStatus } from '@shared/models';
import { ffmpegBinDir, ffmpegCacheDir } from './mediaToolPaths';

const FFMPEG_WINDOWS_VERSION = '8.1.1';
const FFMPEG_WINDOWS_ARCHIVE_URL =
  `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${FFMPEG_WINDOWS_VERSION}-essentials_build.zip`;
const FFMPEG_WINDOWS_ARCHIVE_SHA256 = '6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541';
const FFMPEG_WINDOWS_ARCHIVE_NAME = basename(FFMPEG_WINDOWS_ARCHIVE_URL);
const FFMPEG_MARKER_FILE = '.ffmpeg-install.json';
const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const REMOVE_RETRY_DELAYS_MS = [120, 240, 480, 960];
const MULTI_THREAD_MIN_BYTES = 8 * 1024 * 1024;

export class FfmpegAssetManager extends EventEmitter {
  async ensureInstalled(request: FfmpegRequest): Promise<FfmpegStatus> {
    const status = await this.status();
    if (status.available || !request.allowDownload) {
      return status;
    }

    await this.downloadAndInstall(Boolean(request.useMultiThreadDownload));
    return this.status();
  }

  async status(): Promise<FfmpegStatus> {
    const managed = await this.managedStatus();
    if (managed.available) {
      return {
        ...managed,
        source: 'managed',
        actionRequired: 'none'
      };
    }

    const system = await this.systemStatus();
    if (system.available) {
      return {
        ...system,
        source: 'system',
        actionRequired: 'none'
      };
    }

    const hasManagedFiles = managed.ffmpegAvailable || managed.ffprobeAvailable;
    const hasSystemFiles = system.ffmpegAvailable || system.ffprobeAvailable;
    return {
      cacheDir: ffmpegCacheDir(),
      binDir: ffmpegBinDir(),
      ffmpegPath: managed.ffmpegPath ?? system.ffmpegPath,
      ffprobePath: managed.ffprobePath ?? system.ffprobePath,
      ffmpegAvailable: managed.ffmpegAvailable || system.ffmpegAvailable,
      ffprobeAvailable: managed.ffprobeAvailable || system.ffprobeAvailable,
      available: false,
      source: hasManagedFiles ? 'managed' : hasSystemFiles ? 'system' : 'missing',
      actionRequired: 'download-required'
    };
  }

  private async managedStatus(): Promise<FfmpegStatus> {
    const binDir = ffmpegBinDir();
    const ffmpegPath = join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffprobePath = join(binDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

    return {
      cacheDir: ffmpegCacheDir(),
      binDir,
      ffmpegPath: existsSync(ffmpegPath) ? ffmpegPath : undefined,
      ffprobePath: existsSync(ffprobePath) ? ffprobePath : undefined,
      ffmpegAvailable: existsSync(ffmpegPath),
      ffprobeAvailable: existsSync(ffprobePath),
      available: existsSync(ffmpegPath) && existsSync(ffprobePath),
      source: 'managed',
      actionRequired: existsSync(ffmpegPath) && existsSync(ffprobePath) ? 'none' : 'download-required'
    };
  }

  private async systemStatus(): Promise<FfmpegStatus> {
    const ffmpegPath = findToolOnPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffprobePath = findToolOnPath(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    return {
      cacheDir: ffmpegCacheDir(),
      binDir: ffmpegBinDir(),
      ffmpegPath,
      ffprobePath,
      ffmpegAvailable: Boolean(ffmpegPath),
      ffprobeAvailable: Boolean(ffprobePath),
      available: Boolean(ffmpegPath && ffprobePath),
      source: ffmpegPath || ffprobePath ? 'system' : 'missing',
      actionRequired: ffmpegPath && ffprobePath ? 'none' : 'download-required'
    };
  }

  private async downloadAndInstall(useMultiThreadDownload: boolean): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('Automatic FFmpeg install is currently only supported on Windows.');
    }

    const cacheDir = ffmpegCacheDir();
    const downloadDir = join(cacheDir, 'downloads');
    const archivePath = join(downloadDir, FFMPEG_WINDOWS_ARCHIVE_NAME);
    const extractDir = join(cacheDir, 'extract');
    const binDir = ffmpegBinDir();
    const stagingDir = join(cacheDir, 'bin.next');
    const backupDir = join(cacheDir, 'bin.prev');
    const markerPath = join(cacheDir, FFMPEG_MARKER_FILE);

    await mkdir(downloadDir, { recursive: true });
    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });
    await this.removePathWithRetry(stagingDir, { recursive: true });
    await this.removePathWithRetry(backupDir, { recursive: true });

    this.emitAsset({ type: 'download-start', scope: 'ffmpeg', message: 'Downloading FFmpeg tools.' });
    await this.downloadHttp(FFMPEG_WINDOWS_ARCHIVE_URL, archivePath, useMultiThreadDownload);

    this.emitAsset({ type: 'verify', scope: 'ffmpeg', message: 'Verifying FFmpeg archive.' });
    const verified = await verifySha256(archivePath, FFMPEG_WINDOWS_ARCHIVE_SHA256);
    if (!verified) {
      await this.removePathWithRetry(archivePath);
      this.emitAsset({ type: 'error', scope: 'ffmpeg', message: 'Downloaded FFmpeg archive failed SHA-256 verification.' });
      throw new Error('Downloaded FFmpeg archive failed SHA-256 verification.');
    }

    this.emitAsset({ type: 'extract', scope: 'ffmpeg', message: 'Extracting FFmpeg tools.' });
    await mkdir(extractDir, { recursive: true });
    await extractZip(archivePath, extractDir);

    const sourceBinDir = await findNamedDirectory(extractDir, 'bin');
    if (!sourceBinDir) {
      throw new Error('FFmpeg archive did not contain a bin directory.');
    }

    const ffmpegSource = join(sourceBinDir, 'ffmpeg.exe');
    const ffprobeSource = join(sourceBinDir, 'ffprobe.exe');
    if (!existsSync(ffmpegSource) || !existsSync(ffprobeSource)) {
      throw new Error('FFmpeg archive did not contain both ffmpeg.exe and ffprobe.exe.');
    }

    await mkdir(stagingDir, { recursive: true });
    const sourceEntries = await readdir(sourceBinDir, { withFileTypes: true });
    for (const entry of sourceEntries) {
      if (!entry.isFile()) continue;
      await copyFile(join(sourceBinDir, entry.name), join(stagingDir, entry.name));
    }

    if (existsSync(binDir)) {
      await rename(binDir, backupDir);
    }
    await rename(stagingDir, binDir);
    await this.removePathWithRetry(backupDir, { recursive: true });
    await writeFile(
      markerPath,
      JSON.stringify(
        {
          version: FFMPEG_WINDOWS_VERSION,
          archiveUrl: FFMPEG_WINDOWS_ARCHIVE_URL,
          archiveSha256: FFMPEG_WINDOWS_ARCHIVE_SHA256
        },
        null,
        2
      ),
      'utf8'
    );

    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });
    this.emitAsset({ type: 'ready', scope: 'ffmpeg', message: 'FFmpeg tools are ready.' });
  }

  private async downloadHttp(url: string, destination: string, useMultiThreadDownload = false): Promise<void> {
    if (useMultiThreadDownload) {
      try {
        const downloaded = await this.downloadHttpSegmented(url, destination);
        if (downloaded) return;
      } catch {
        await this.removePathWithRetry(destination);
      }
    }

    await this.downloadHttpSingle(url, destination);
  }

  private async downloadHttpSingle(url: string, destination: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      this.emitAsset({ type: 'error', scope: 'ffmpeg', message: `FFmpeg download failed with HTTP ${response.status}.` });
      throw new Error(`Failed to download FFmpeg archive: HTTP ${response.status}`);
    }

    const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    await new Promise<void>((resolveDownload, reject) => {
      const stream = createWriteStream(destination, { flags: 'wx' });
      const reader = response.body!.getReader();
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        void reader.cancel().catch(() => undefined);
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
        reject(error);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        resolveDownload();
      };

      stream.on('error', fail);
      stream.on('finish', succeed);
      let receivedBytes = 0;
      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              stream.end();
              return;
            }

            const chunk = Buffer.from(value);
            receivedBytes += chunk.length;
            this.emitAsset({
              type: 'download-progress',
              scope: 'ffmpeg',
              message: 'Downloading FFmpeg tools...',
              receivedBytes,
              totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined
            });
            stream.write(chunk, (error) => {
              if (error) {
                fail(error);
                return;
              }
              pump();
            });
          })
          .catch(fail);
      };
      pump();
    }).catch(async (error) => {
      await this.removePathWithRetry(destination);
      throw error;
    });
  }

  private async downloadHttpSegmented(url: string, destination: string): Promise<boolean> {
    const plan = await this.segmentedDownloadPlan(url);
    if (!plan) return false;

    const file = await open(destination, 'w');
    try {
      await file.truncate(plan.totalBytes);
      let receivedBytes = 0;
      const emitProgress = (delta: number): void => {
        receivedBytes += delta;
        this.emitAsset({
          type: 'download-progress',
          scope: 'ffmpeg',
          message: 'Downloading FFmpeg tools...',
          receivedBytes,
          totalBytes: plan.totalBytes
        });
      };

      await Promise.all(
        plan.ranges.map(async (range) => {
          const response = await fetch(url, {
            headers: {
              Range: `bytes=${range.start}-${range.end}`
            }
          });
          if (response.status !== 206 || !response.body) {
            throw new Error(`Segmented FFmpeg download range failed with HTTP ${response.status}.`);
          }

          const reader = response.body.getReader();
          let offset = range.start;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            await file.write(chunk, 0, chunk.length, offset);
            offset += chunk.length;
            emitProgress(chunk.length);
          }
        })
      );
      return true;
    } finally {
      await file.close();
    }
  }

  private async segmentedDownloadPlan(url: string): Promise<{ totalBytes: number; ranges: Array<{ start: number; end: number }> } | undefined> {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return undefined;
    const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const acceptsRanges = response.headers.get('accept-ranges')?.toLowerCase().includes('bytes') ?? false;
    if (!acceptsRanges || !Number.isFinite(totalBytes) || totalBytes < MULTI_THREAD_MIN_BYTES) return undefined;

    const maxParts = defaultConcurrentDownloadParts();
    if (maxParts <= 1) return undefined;
    const partCount = Math.min(maxParts, Math.max(2, Math.ceil(totalBytes / MULTI_THREAD_MIN_BYTES)));
    const partSize = Math.ceil(totalBytes / partCount);
    const ranges = Array.from({ length: partCount }, (_, index) => {
      const start = index * partSize;
      return {
        start,
        end: Math.min(totalBytes - 1, start + partSize - 1)
      };
    }).filter((range) => range.start <= range.end);

    return { totalBytes, ranges };
  }

  private async removePathWithRetry(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    let attempt = 0;
    while (true) {
      try {
        await rm(path, { force: true, recursive: Boolean(options.recursive) });
        return;
      } catch (error) {
        if (!isTransientFsError(error) || attempt >= REMOVE_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await wait(REMOVE_RETRY_DELAYS_MS[attempt]);
        attempt += 1;
      }
    }
  }

  private emitAsset(event: AssetEvent): void {
    this.emit('asset-event', event);
  }
}

function findToolOnPath(fileName: string): string | undefined {
  const candidates = String(process.env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((root) => join(root, fileName));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function verifySha256(path: string, expected: string): Promise<boolean> {
  return new Promise((resolveResult, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveResult(hash.digest('hex').toLowerCase() === expected.toLowerCase()));
  });
}

async function extractZip(archivePath: string, destinationDir: string): Promise<void> {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`
    ],
    {
      windowsHide: true,
      stdio: 'pipe',
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`Failed to extract FFmpeg archive: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

async function findNamedDirectory(root: string, name: string): Promise<string | undefined> {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase() === name.toLowerCase()) {
        return nextPath;
      }
      queue.push(nextPath);
    }
  }
  return undefined;
}

function isTransientFsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && TRANSIENT_FS_ERROR_CODES.has(String(error.code));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function defaultConcurrentDownloadParts(): number {
  const parallelism = detectParallelism();
  return Math.max(1, Math.min(16, Math.ceil(parallelism / 2)));
}

function detectParallelism(): number {
  try {
    return typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  } catch {
    return cpus().length;
  }
}
