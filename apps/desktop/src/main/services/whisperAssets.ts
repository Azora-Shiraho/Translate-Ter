import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { AssetEvent, WhisperModelInfo, WhisperRuntimeRequest, WhisperRuntimeStatus } from '@shared/models';

const NVIDIA_CUDA_REDIST_BASE_URL = 'https://developer.download.nvidia.com/compute/cuda/redist/';
const NVIDIA_CUDA_11_8_REDIST_MANIFEST_URL = `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_11.8.0.json`;
const WINDOWS_CUBLAS_DLLS = ['cublas64_11.dll', 'cublasLt64_11.dll'];

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

type CudaRedistribManifest = {
  libcublas?: Record<
    string,
    {
      relative_path?: string;
      sha256?: string;
    }
  >;
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
    await this.migrateLegacyCacheIfNeeded();
    const manifest = await this.manifest();
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];
    const cudaHardwareSupported = detectCudaHardwareSupport();
    let cudaSupported = detectCudaSupport(this.cudaRuntimeSearchRoots(manifest));
    if (request.preferCuda && cudaHardwareSupported && !cudaSupported && request.allowDownload) {
      await this.ensureWindowsCudaRuntimeDependencies(manifest);
      cudaSupported = detectCudaSupport(this.cudaRuntimeSearchRoots(manifest));
    }
    const { runtime, platformKey } = this.selectRuntime(manifest, request.preferCuda, cudaSupported);

    if (manifest.enabled === false) {
      return this.status(
        platformKey,
        runtime?.binary ?? 'manifest-disabled',
        model.path,
        model.id,
        runtime?.acceleration ?? 'cpu',
        request.preferCuda,
        cudaHardwareSupported,
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
        cudaHardwareSupported,
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
        cudaHardwareSupported,
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
      cudaHardwareSupported,
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
    if (app.isPackaged) {
      return join(dirname(process.execPath), 'runtime', 'whisper');
    }
    return join(resolve('.'), '.runtime', 'whisper');
  }

  private legacyCacheDir(): string {
    return join(app.getPath('userData'), 'runtime', 'whisper');
  }

  private cudaRuntimeSearchRoots(manifest: WhisperManifest): string[] {
    const runtime = manifest.runtime.platforms[`${this.platformKey()}-cuda`];
    return runtime ? [dirname(join(this.cacheDir(), runtime.binary))] : [];
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
              scope,
              message: scope === 'runtime' ? 'Downloading whisper runtime...' : 'Downloading whisper model...',
              receivedBytes
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
    cudaHardwareSupported: boolean,
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
        : preferCuda && cudaHardwareSupported && !cudaSupported
          ? 'NVIDIA hardware is present, but the required CUDA runtime DLLs for whisper.cpp were not found.'
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

  private async migrateLegacyCacheIfNeeded(): Promise<void> {
    const nextCacheDir = this.cacheDir();
    const legacyCacheDir = this.legacyCacheDir();
    if (nextCacheDir === legacyCacheDir) return;
    if (await this.exists(nextCacheDir)) return;
    if (!(await this.exists(legacyCacheDir))) return;

    await mkdir(dirname(nextCacheDir), { recursive: true });
    try {
      await rename(legacyCacheDir, nextCacheDir);
    } catch {
      // Fall back to copy-on-demand via normal download/install flow if move fails.
    }
  }

  private async ensureWindowsCudaRuntimeDependencies(manifest: WhisperManifest): Promise<void> {
    if (process.platform !== 'win32') return;
    const runtime = manifest.runtime.platforms[`${this.platformKey()}-cuda`];
    if (!runtime) return;

    const runtimeDir = dirname(join(this.cacheDir(), runtime.binary));
    if (hasWindowsCudaRuntime([runtimeDir])) return;

    const packageInfo = await this.fetchCudaLibcublasPackage();
    if (!packageInfo.relative_path || !packageInfo.sha256 || !isPinnedSha256(packageInfo.sha256)) {
      throw new Error('NVIDIA CUDA libcublas redistributable metadata is missing a pinned SHA-256 hash.');
    }

    const downloadDir = join(this.cacheDir(), 'downloads');
    const archivePath = join(downloadDir, basename(packageInfo.relative_path));
    const extractDir = join(this.cacheDir(), 'cuda-redist', 'libcublas');
    await mkdir(downloadDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await rm(archivePath, { force: true });
    await rm(extractDir, { force: true, recursive: true });

    this.emitAsset({ type: 'download-start', scope: 'runtime', message: 'Downloading CUDA cuBLAS runtime.' });
    await this.downloadHttp('runtime', `${NVIDIA_CUDA_REDIST_BASE_URL}${packageInfo.relative_path}`, archivePath);

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Verifying CUDA cuBLAS runtime checksum.' });
    const verified = await this.verifySha256(archivePath, packageInfo.sha256);
    if (!verified) {
      await rm(archivePath, { force: true });
      throw new Error('Downloaded CUDA cuBLAS runtime failed SHA-256 verification.');
    }

    this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Extracting CUDA cuBLAS runtime.' });
    await mkdir(extractDir, { recursive: true });
    await this.extractZip(archivePath, extractDir);

    const dllPaths = await findFilesByName(extractDir, WINDOWS_CUBLAS_DLLS);
    for (const dllName of WINDOWS_CUBLAS_DLLS) {
      const sourcePath = dllPaths.get(dllName.toLowerCase());
      if (!sourcePath) {
        throw new Error(`CUDA cuBLAS runtime archive did not contain ${dllName}.`);
      }
      await copyFile(sourcePath, join(runtimeDir, dllName));
    }

    await rm(archivePath, { force: true });
    await rm(extractDir, { force: true, recursive: true });
    this.emitAsset({ type: 'ready', scope: 'runtime', message: 'CUDA cuBLAS runtime is ready.' });
  }

  private async fetchCudaLibcublasPackage(): Promise<NonNullable<CudaRedistribManifest['libcublas']>[string]> {
    const response = await fetch(NVIDIA_CUDA_11_8_REDIST_MANIFEST_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch NVIDIA CUDA redistributable manifest: HTTP ${response.status}`);
    }
    const manifest = (await response.json()) as CudaRedistribManifest;
    const packageInfo = manifest.libcublas?.['windows-x86_64'];
    if (!packageInfo) {
      throw new Error('NVIDIA CUDA redistributable manifest does not list libcublas for windows-x86_64.');
    }
    return packageInfo;
  }
}

function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}

function detectCudaSupport(extraSearchRoots: string[] = []): boolean {
  if (process.platform !== 'win32' && process.platform !== 'linux') return false;
  if (process.platform === 'win32') {
    return hasWindowsCudaRuntime(extraSearchRoots);
  }
  if (process.env.CUDA_PATH || process.env.CUDA_HOME) return true;

  const probe = spawnSync('nvidia-smi', ['-L'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  if (probe.status === 0) return true;

  return false;
}

function detectCudaHardwareSupport(): boolean {
  if (process.platform !== 'win32' && process.platform !== 'linux') return false;

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

function hasWindowsCudaRuntime(extraSearchRoots: string[] = []): boolean {
  const searchRoots = [
    ...extraSearchRoots,
    process.env.CUDA_PATH ? join(process.env.CUDA_PATH, 'bin') : undefined,
    process.env.CUDA_HOME ? join(process.env.CUDA_HOME, 'bin') : undefined,
    ...String(process.env.PATH ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
  ].filter((entry): entry is string => Boolean(entry));

  return WINDOWS_CUBLAS_DLLS.every((dllName) => searchRoots.some((root) => existsSync(join(root, dllName))));
}

async function findFilesByName(root: string, names: string[]): Promise<Map<string, string>> {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const found = new Map<string, string>();
  const stack = [root];

  while (stack.length > 0 && found.size < wanted.size) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      const key = entry.name.toLowerCase();
      if (wanted.has(key)) {
        found.set(key, path);
      }
    }
  }

  return found;
}
