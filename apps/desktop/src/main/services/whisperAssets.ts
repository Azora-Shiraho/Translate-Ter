import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AssetEvent, WhisperModelInfo, WhisperRuntimeRequest, WhisperRuntimeStatus } from '@shared/models';

type WhisperManifest = {
  manifestVersion: number;
  enabled?: boolean;
  note?: string;
  runtime: {
    provider: 'whisper.cpp';
    version: string;
    platforms: Record<
      string,
      { binary: string; sha256: string; url: string | null; acceleration: 'cpu' | 'cuda' | 'metal' | 'vulkan' }
    >;
  };
  models: Array<{
    id: string;
    displayName: string;
    languageScope: 'multilingual' | 'english-only';
    sizeBytes: number;
    sha256: string;
    path: string;
    url: string | null;
  }>;
};

export class WhisperAssetManager extends EventEmitter {
  private manifestCache?: WhisperManifest;

  constructor() {
    super();
  }

  async listModels(): Promise<WhisperModelInfo[]> {
    const manifest = await this.manifest();
    return Promise.all(
      manifest.models.map(async (model) => ({
        id: model.id,
        displayName: model.displayName,
        languageScope: model.languageScope,
        sizeBytes: model.sizeBytes,
        sha256: model.sha256,
        installed: await this.exists(join(this.cacheDir(), model.path))
      }))
    );
  }

  async ensureRuntime(request: WhisperRuntimeRequest): Promise<WhisperRuntimeStatus> {
    const manifest = await this.manifest();
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];
    const cudaSupported = detectCudaSupport();
    const { runtime, platformKey } = this.selectRuntime(manifest, request.preferCuda, cudaSupported);

    if (manifest.enabled === false) {
      return this.status(
        platformKey,
        runtime?.binary ?? 'manifest-disabled',
        model.path,
        model.id,
        runtime?.acceleration ?? 'cpu',
        request.preferCuda,
        cudaSupported,
        false,
        false,
        false,
        false,
        {
          actionRequired: 'manifest-not-configured',
          message:
            manifest.note ??
            'The checked-in whisper manifest is a disabled sample. Provide a pinned runtime/model manifest before transcription.'
        }
      );
    }

    if (!runtime) {
      return this.status(
        platformKey,
        'unsupported-platform',
        model.path,
        model.id,
        'cpu',
        request.preferCuda,
        cudaSupported,
        false,
        false,
        false,
        false,
        {
          actionRequired: 'download-runtime',
          message: `No whisper.cpp runtime is pinned for ${platformKey}.`
        }
      );
    }

    const binaryPath = join(this.cacheDir(), runtime.binary);
    const modelPath = join(this.cacheDir(), model.path);
    const hashesPinned = isPinnedSha256(runtime.sha256) && isPinnedSha256(model.sha256);
    const binaryExists = await this.exists(binaryPath);
    const modelExists = await this.exists(modelPath);
    const binaryVerified = hashesPinned && binaryExists ? await this.verifyRuntime(binaryPath, runtime.url, runtime.sha256) : false;
    const modelVerified = hashesPinned && modelExists ? await this.verifySha256(modelPath, model.sha256) : false;

    if (!hashesPinned) {
      return this.status(
        platformKey,
        runtime.binary,
        model.path,
        model.id,
        runtime.acceleration,
        request.preferCuda,
        cudaSupported,
        binaryExists,
        modelExists,
        false,
        false,
        {
          actionRequired: 'manifest-not-configured',
          message: 'Runtime/model hashes are not pinned. Provide trusted SHA-256 values before enabling download or execution.'
        }
      );
    }

    if (request.allowDownload && (!binaryVerified || !modelVerified)) {
      if (!binaryVerified) await this.downloadAndInstall('runtime', runtime.url, binaryPath, runtime.sha256);
      if (!modelVerified) await this.downloadAndInstall('model', model.url, modelPath, model.sha256);
    }

    const resolvedBinaryInstalled = await this.exists(binaryPath);
    const resolvedModelInstalled = await this.exists(modelPath);
    const resolvedBinaryVerified = await this.verifyRuntime(binaryPath, runtime.url, runtime.sha256);
    const resolvedModelVerified = await this.verifyIfPresent(modelPath, model.sha256);

    return this.status(
      platformKey,
      runtime.binary,
      model.path,
      model.id,
      runtime.acceleration,
      request.preferCuda,
      cudaSupported,
      resolvedBinaryInstalled,
      resolvedModelInstalled,
      resolvedBinaryVerified,
      resolvedModelVerified,
      {
        actionRequired: !resolvedBinaryVerified ? 'download-runtime' : !resolvedModelVerified ? 'download-model' : 'none',
        message: resolvedBinaryVerified && resolvedModelVerified ? 'whisper.cpp runtime is ready.' : 'Runtime or model is missing.'
      }
    );
  }

  async deleteModel(modelId: string): Promise<void> {
    const manifest = await this.manifest();
    const model = manifest.models.find((item) => item.id === modelId);
    if (!model) return;
    await rm(join(this.cacheDir(), model.path), { force: true });
  }

  cacheDir(): string {
    return join(app.getPath('userData'), 'runtime', 'whisper');
  }

  private async downloadAndInstall(scope: 'runtime' | 'model', url: string | null, destination: string, sha256: string): Promise<void> {
    if (!url || url.startsWith('disabled://')) return;
    if (!isPinnedSha256(sha256)) {
      throw new Error('Refusing to download whisper asset without a pinned SHA-256 hash.');
    }

    const tmpPath = this.shouldExtractArchive(url, destination) ? `${destination}.download.zip` : `${destination}.tmp`;
    await mkdir(dirname(destination), { recursive: true });
    await rm(tmpPath, { force: true });

    this.emitAsset({
      type: 'download-start',
      scope,
      message: scope === 'runtime' ? 'Downloading whisper runtime.' : 'Downloading whisper model.'
    });

    if (url.startsWith('file://')) {
      const sourcePath = url.slice('file://'.length);
      await copyFile(sourcePath, tmpPath);
    } else if (url.startsWith('https://')) {
      await this.downloadHttp(scope, url, tmpPath);
    } else {
      throw new Error(`Unsupported whisper asset URL scheme: ${url}`);
    }

    this.emitAsset({ type: 'verify', scope, message: scope === 'runtime' ? 'Verifying runtime checksum.' : 'Verifying model checksum.' });
    const verified = await this.verifySha256(tmpPath, sha256);
    if (!verified) {
      await rm(tmpPath, { force: true });
      this.emitAsset({ type: 'error', scope, message: 'Downloaded file failed checksum verification.' });
      throw new Error('Downloaded asset failed SHA-256 verification.');
    }
    if (this.shouldExtractArchive(url, destination)) {
      const extractDir = this.archiveExtractDir(destination);
      await mkdir(extractDir, { recursive: true });
      this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Extracting runtime archive.' });
      await this.extractZip(tmpPath, extractDir);
      await writeFile(this.archiveMarkerPath(destination), sha256, 'utf8');
      await rm(tmpPath, { force: true });
      this.emitAsset({ type: 'ready', scope, message: 'Runtime download complete.' });
      return;
    }

    await rename(tmpPath, destination);
    this.emitAsset({ type: 'ready', scope, message: scope === 'runtime' ? 'Runtime download complete.' : 'Model download complete.' });
  }

  private async downloadHttp(scope: 'runtime' | 'model', url: string, destination: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      this.emitAsset({ type: 'error', scope, message: `Download failed with HTTP ${response.status}.` });
      throw new Error(`Failed to download whisper asset: HTTP ${response.status}`);
    }

    await new Promise<void>((resolveDownload, reject) => {
      const stream = createWriteStream(destination, { flags: 'wx' });
      stream.on('error', reject);
      stream.on('finish', resolveDownload);

      const reader = response.body!.getReader();
      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              stream.end();
              return;
            }
            const chunk = Buffer.from(value);
            this.emitAsset({
              type: 'download-progress',
              scope,
              message: scope === 'runtime' ? 'Downloading whisper runtime...' : 'Downloading whisper model...',
              receivedBytes: chunk.length
            });
            stream.write(chunk, (error) => {
              if (error) {
                reject(error);
                return;
              }
              pump();
            });
          })
          .catch(reject);
      };
      pump();
    });
  }

  private status(
    platformKey: string,
    runtimeBinary: string,
    modelPath: string,
    modelId: string,
    runtimeAcceleration: 'cpu' | 'cuda' | 'metal' | 'vulkan',
    preferCuda: boolean,
    cudaSupported: boolean,
    binaryInstalled: boolean,
    modelInstalled: boolean,
    binaryVerified: boolean,
    modelVerified: boolean,
    extra: Pick<WhisperRuntimeStatus, 'actionRequired' | 'message'>
  ): WhisperRuntimeStatus {
    const canUseCuda = preferCuda && cudaSupported && runtimeAcceleration === 'cuda';
    const fallbackReason =
      preferCuda && runtimeAcceleration !== 'cuda'
        ? 'The selected whisper runtime build does not include CUDA acceleration.'
        : preferCuda && !cudaSupported
          ? 'CUDA was requested but no supported NVIDIA runtime was detected on this machine.'
          : runtimeAcceleration === 'cuda' && !cudaSupported
            ? 'This runtime can use CUDA, but no supported NVIDIA runtime was detected on this machine.'
            : 'Using CPU execution for the selected whisper runtime.';

    return {
      provider: 'whisper.cpp',
      platformKey,
      cacheDir: this.cacheDir(),
      binary: {
        expectedPath: join(this.cacheDir(), runtimeBinary),
        installed: binaryInstalled,
        verified: binaryVerified
      },
      model: {
        id: modelId,
        expectedPath: join(this.cacheDir(), modelPath),
        installed: modelInstalled,
        verified: modelVerified
      },
      acceleration: {
        requested: preferCuda ? 'gpu' : 'cpu',
        selected: canUseCuda ? 'gpu' : 'cpu',
        cudaSupported,
        runtimeVariant: runtimeAcceleration,
        fallbackReason
      },
      ...extra
    };
  }

  private async manifest(): Promise<WhisperManifest> {
    if (this.manifestCache) return this.manifestCache;
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resourcesPath ? join(resourcesPath, 'whisper-manifest.json') : undefined,
      resolve('resources/whisper-manifest.json')
    ].filter((value): value is string => Boolean(value));

    let raw: string | undefined;
    for (const candidate of candidates) {
      try {
        raw = await readFile(candidate, 'utf8');
        break;
      } catch {
        // continue
      }
    }
    if (!raw) {
      throw new Error('Whisper manifest was not found in packaged resources or workspace resources.');
    }
    this.manifestCache = JSON.parse(raw) as WhisperManifest;
    return this.manifestCache;
  }

  private platformKey(): string {
    return `${process.platform}-${process.arch}`;
  }

  private selectRuntime(
    manifest: WhisperManifest,
    preferCuda: boolean,
    cudaSupported: boolean
  ): {
    runtime: WhisperManifest['runtime']['platforms'][string] | undefined;
    platformKey: string;
  } {
    const baseKey = this.platformKey();
    const preferredKeys = preferCuda && cudaSupported ? [`${baseKey}-cuda`, baseKey] : [baseKey];
    for (const key of preferredKeys) {
      const runtime = manifest.runtime.platforms[key];
      if (runtime) {
        return { runtime, platformKey: key };
      }
    }
    return { runtime: undefined, platformKey: preferredKeys[0] };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyIfPresent(path: string, sha256: string): Promise<boolean> {
    if (!(await this.exists(path))) return false;
    return this.verifySha256(path, sha256);
  }

  private async verifyRuntime(path: string, url: string | null, sha256: string): Promise<boolean> {
    if (!(await this.exists(path))) return false;
    if (!url || !this.shouldExtractArchive(url, path)) {
      return this.verifySha256(path, sha256);
    }

    try {
      const marker = await readFile(this.archiveMarkerPath(path), 'utf8');
      return marker.trim().toLowerCase() === sha256.toLowerCase();
    } catch {
      return false;
    }
  }

  private shouldExtractArchive(url: string, destination: string): boolean {
    return url.toLowerCase().endsWith('.zip') && !destination.toLowerCase().endsWith('.zip');
  }

  private archiveMarkerPath(destination: string): string {
    return `${destination}.archive-sha256`;
  }

  private archiveExtractDir(destination: string): string {
    if (process.platform === 'win32') {
      return dirname(dirname(destination));
    }
    return dirname(destination);
  }

  private async extractZip(archivePath: string, destinationDir: string): Promise<void> {
    if (process.platform === 'win32') {
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
        throw new Error(`Failed to extract runtime archive: ${String(result.stderr || result.stdout || '').trim()}`);
      }
      return;
    }

    const result = spawnSync('tar', ['-xf', archivePath, '-C', destinationDir], {
      windowsHide: true,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`Failed to extract runtime archive: ${String(result.stderr || result.stdout || '').trim()}`);
    }
  }

  private verifySha256(path: string, expected: string): Promise<boolean> {
    if (!isPinnedSha256(expected)) return Promise.resolve(false);
    return new Promise((resolveResult, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolveResult(hash.digest('hex').toLowerCase() === expected.toLowerCase()));
    });
  }

  private emitAsset(event: AssetEvent): void {
    this.emit('asset-event', event);
  }
}

function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}

function detectCudaSupport(): boolean {
  if (process.platform !== 'win32' && process.platform !== 'linux') return false;
  if (process.env.CUDA_PATH || process.env.CUDA_HOME) return true;

  const probe = spawnSync('nvidia-smi', ['-L'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  if (probe.status === 0) return true;

  if (process.platform === 'win32') {
    const nvidiaGpu = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Measure-Object).Count"
      ],
      {
        windowsHide: true,
        encoding: 'utf8'
      }
    );
    if (nvidiaGpu.status === 0 && Number.parseInt(String(nvidiaGpu.stdout ?? '').trim(), 10) > 0) {
      return true;
    }
  }

  return false;
}
