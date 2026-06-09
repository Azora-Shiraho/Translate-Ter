import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import type { AssetEvent, WhisperModelInfo, WhisperRuntimeRequest, WhisperRuntimeStatus } from '@shared/models';

const NVIDIA_CUDA_REDIST_BASE_URL = 'https://developer.download.nvidia.com/compute/cuda/redist/';
const NVIDIA_CUDA_REDIST_MANIFEST_URLS = {
  '11.8': `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_11.8.0.json`,
  '12.8': `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_12.8.0.json`
} as const;
const WINDOWS_CUDA_RUNTIME_DLLS = {
  '11.8': ['cublas64_11.dll', 'cublasLt64_11.dll'],
  '12.8': ['cublas64_12.dll', 'cublasLt64_12.dll']
} as const;
const MULTI_THREAD_DOWNLOAD_PARTS = 4;
const MULTI_THREAD_MIN_BYTES = 8 * 1024 * 1024;
const CUDA_11_8 = '11.8' as const;
const CUDA_12_8 = '12.8' as const;

type SupportedCudaVersion = keyof typeof NVIDIA_CUDA_REDIST_MANIFEST_URLS;

type WhisperManifest = {
  manifestVersion: number;
  enabled?: boolean;
  note?: string;
  runtime: {
    provider: 'whisper.cpp';
    version: string;
    platforms: Record<
      string,
      {
        binary: string;
        sha256: string;
        url: string | null;
        acceleration: 'cpu' | 'cuda' | 'metal' | 'vulkan';
        cudaVersion?: SupportedCudaVersion;
      }
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

type NvidiaGpuInfo = {
  name: string;
  architecture?: string;
  computeCapability?: string;
};

export class WhisperAssetManager extends EventEmitter {
  private manifestCache?: WhisperManifest;

  constructor() {
    super();
  }

  async listModels(): Promise<WhisperModelInfo[]> {
    const manifest = await this.manifest();
    return Promise.all(
      manifest.models.map(async (model) => {
        const modelPath = await this.findExistingModelPath(model.path);
        return {
          id: model.id,
          displayName: model.displayName,
          languageScope: model.languageScope,
          sizeBytes: model.sizeBytes,
          sha256: model.sha256,
          installed: Boolean(modelPath)
        };
      })
    );
  }

  async ensureRuntime(request: WhisperRuntimeRequest): Promise<WhisperRuntimeStatus> {
    await this.migrateLegacyCacheIfNeeded();
    const manifest = await this.manifest();
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];
    const gpuInfo = detectNvidiaGpuInfo();
    const requiredCudaVersion = gpuInfo ? requiredCudaVersionForGpu(gpuInfo) : undefined;
    const downloadScope = request.downloadScope ?? 'all';
    const canDownloadRuntime =
      request.allowDownload && (downloadScope === 'all' || downloadScope === 'runtime');
    const canDownloadCudaRuntime =
      request.allowDownload &&
      (downloadScope === 'all' || downloadScope === 'runtime' || downloadScope === 'cuda-runtime');
    const canDownloadModel = request.allowDownload && (downloadScope === 'all' || downloadScope === 'model');
    const cudaHardwareSupported = detectCudaHardwareSupport();
    const preferredCudaVersion = requiredCudaVersion ?? CUDA_11_8;
    let cudaSupported = detectCudaSupport(this.cudaRuntimeSearchRoots(manifest, preferredCudaVersion), preferredCudaVersion);
    if (request.preferCuda && cudaHardwareSupported && !cudaSupported && canDownloadCudaRuntime) {
      await this.ensureWindowsCudaRuntimeDependencies(
        manifest,
        preferredCudaVersion,
        Boolean(request.useMultiThreadDownload)
      );
      cudaSupported = detectCudaSupport(this.cudaRuntimeSearchRoots(manifest, preferredCudaVersion), preferredCudaVersion);
    }
    const { runtime, platformKey, compatibilityMessage } = this.selectRuntime(
      manifest,
      request.preferCuda,
      cudaSupported,
      gpuInfo
    );

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
          message: compatibilityMessage ?? `No whisper.cpp runtime is pinned for ${platformKey}.`
        }
      );
    }

    const managedBinaryPath = join(this.cacheDir(), runtime.binary);
    const systemBinaryPath = await this.findSystemWhisperBinary(runtime.binary);
    const binaryPath = systemBinaryPath ?? managedBinaryPath;
    const managedModelPath = join(this.cacheDir(), model.path);
    const existingModelPath = await this.findExistingModelPath(model.path);
    const modelPath = existingModelPath ?? managedModelPath;
    const hashesPinned = isPinnedSha256(runtime.sha256) && isPinnedSha256(model.sha256);
    const binaryExists = await this.exists(binaryPath);
    const modelExists = await this.exists(modelPath);
    const binaryVerified = systemBinaryPath
      ? true
      : hashesPinned && binaryExists
        ? await this.verifyRuntime(binaryPath, runtime.url, runtime.sha256)
        : false;
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

    if (!binaryVerified && canDownloadRuntime) {
      await this.downloadAndInstall(
        'runtime',
        runtime.url,
        managedBinaryPath,
        runtime.sha256,
        Boolean(request.useMultiThreadDownload)
      );
    }
    if (!modelVerified && canDownloadModel) {
      await this.downloadAndInstall(
        'model',
        model.url,
        managedModelPath,
        model.sha256,
        Boolean(request.useMultiThreadDownload)
      );
    }

    const resolvedSystemBinaryPath = systemBinaryPath ?? (await this.findSystemWhisperBinary(runtime.binary));
    const resolvedBinaryPath = resolvedSystemBinaryPath ?? managedBinaryPath;
    const resolvedModelPath = (await this.findExistingModelPath(model.path)) ?? managedModelPath;
    const resolvedBinaryInstalled = await this.exists(resolvedBinaryPath);
    const resolvedModelInstalled = await this.exists(resolvedModelPath);
    const resolvedBinaryVerified = resolvedSystemBinaryPath
      ? true
      : await this.verifyRuntime(resolvedBinaryPath, runtime.url, runtime.sha256);
    const resolvedModelVerified = await this.verifyIfPresent(resolvedModelPath, model.sha256);

    return this.status(
      platformKey,
      resolvedBinaryPath,
      resolvedModelPath,
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
        message:
          compatibilityMessage ??
          (resolvedBinaryVerified && resolvedModelVerified
            ? 'whisper.cpp runtime is ready.'
            : !resolvedBinaryVerified
              ? 'whisper.cpp binary is missing or cannot run. Download whisper runtime before testing local transcription.'
              : 'Selected whisper model is missing. Download the model before transcription.')
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

  private cudaRuntimeSearchRoots(manifest: WhisperManifest, cudaVersion?: SupportedCudaVersion): string[] {
    const runtime = Object.values(manifest.runtime.platforms).find(
      (candidate) => candidate.acceleration === 'cuda' && (!cudaVersion || candidate.cudaVersion === cudaVersion)
    );
    return runtime ? [dirname(join(this.cacheDir(), runtime.binary))] : [];
  }

  private async downloadAndInstall(
    scope: 'runtime' | 'model',
    url: string | null,
    destination: string,
    sha256: string,
    useMultiThreadDownload: boolean
  ): Promise<void> {
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
      await this.downloadHttp(scope, url, tmpPath, useMultiThreadDownload);
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

  private async downloadHttp(
    scope: 'runtime' | 'model',
    url: string,
    destination: string,
    useMultiThreadDownload = false
  ): Promise<void> {
    if (useMultiThreadDownload) {
      try {
        const downloaded = await this.downloadHttpSegmented(scope, url, destination);
        if (downloaded) return;
      } catch {
        await rm(destination, { force: true });
      }
    }

    await this.downloadHttpSingle(scope, url, destination);
  }

  private async downloadHttpSingle(scope: 'runtime' | 'model', url: string, destination: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      this.emitAsset({ type: 'error', scope, message: `Download failed with HTTP ${response.status}.` });
      throw new Error(`Failed to download whisper asset: HTTP ${response.status}`);
    }
    const totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);

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
              receivedBytes,
              totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined
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

  private async downloadHttpSegmented(scope: 'runtime' | 'model', url: string, destination: string): Promise<boolean> {
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
          scope,
          message: scope === 'runtime' ? 'Downloading whisper runtime...' : 'Downloading whisper model...',
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
            throw new Error(`Segmented download range failed with HTTP ${response.status}.`);
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

    const partCount = Math.min(MULTI_THREAD_DOWNLOAD_PARTS, Math.max(2, Math.ceil(totalBytes / MULTI_THREAD_MIN_BYTES)));
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
        expectedPath: isAbsolute(runtimeBinary) ? runtimeBinary : join(this.cacheDir(), runtimeBinary),
        installed: binaryInstalled,
        verified: binaryVerified
      },
      model: {
        id: modelId,
        expectedPath: isAbsolute(modelPath) ? modelPath : join(this.cacheDir(), modelPath),
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
    cudaSupported: boolean,
    gpuInfo?: NvidiaGpuInfo
  ): {
    runtime: WhisperManifest['runtime']['platforms'][string] | undefined;
    platformKey: string;
    compatibilityMessage?: string;
  } {
    const baseKey = this.platformKey();
    if (preferCuda && cudaSupported) {
      const cudaRuntime = manifest.runtime.platforms[`${baseKey}-cuda`];
      if (cudaRuntime) {
        const compatibility = isCudaRuntimeCompatibleWithGpu(cudaRuntime.cudaVersion, gpuInfo);
        if (compatibility.ok) {
          return { runtime: cudaRuntime, platformKey: `${baseKey}-cuda` };
        }

        const cpuRuntime = manifest.runtime.platforms[baseKey];
        return {
          runtime: cpuRuntime,
          platformKey: cpuRuntime ? baseKey : `${baseKey}-cuda`,
          compatibilityMessage: compatibility.message
        };
      }
    }

    const cpuRuntime = manifest.runtime.platforms[baseKey];
    if (cpuRuntime) {
      return { runtime: cpuRuntime, platformKey: baseKey };
    }

    return { runtime: undefined, platformKey: preferCuda ? `${baseKey}-cuda` : baseKey };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async findSystemWhisperBinary(manifestBinaryPath: string): Promise<string | undefined> {
    const names = new Set([
      basename(manifestBinaryPath),
      process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    ]);
    const candidates = String(process.env.PATH ?? '')
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .flatMap((root) => [...names].map((name) => join(root, name)));

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      if (canRunWhisperBinary(candidate)) return candidate;
    }
    return undefined;
  }

  private async findExistingModelPath(manifestModelPath: string): Promise<string | undefined> {
    const configuredPath = process.env.WHISPER_MODEL_PATH?.trim();
    if (configuredPath && existsSync(configuredPath)) {
      return configuredPath;
    }

    const fileName = basename(manifestModelPath);
    const candidateDirs = [
      process.env.WHISPER_MODEL_DIR?.trim(),
      join(this.cacheDir(), dirname(manifestModelPath)),
      join(this.legacyCacheDir(), dirname(manifestModelPath)),
      join(dirname(process.execPath), 'runtime', 'whisper', dirname(manifestModelPath)),
      join(dirname(process.execPath), dirname(manifestModelPath)),
      join(dirname(process.execPath), 'models'),
      resolve(dirname(manifestModelPath)),
      resolve('models'),
      resolve('.runtime', 'whisper', dirname(manifestModelPath))
    ].filter((entry): entry is string => Boolean(entry));

    for (const dir of uniquePaths(candidateDirs)) {
      const directCandidate = join(dir, fileName);
      if (existsSync(directCandidate)) {
        return directCandidate;
      }
    }

    const searchRoots = uniquePaths([
      process.env.WHISPER_MODEL_DIR?.trim(),
      dirname(process.execPath),
      this.cacheDir(),
      this.legacyCacheDir(),
      resolve('.')
    ].filter((entry): entry is string => Boolean(entry)));

    for (const root of searchRoots) {
      const matched = await findFileByName(root, fileName, 3);
      if (matched) {
        return matched;
      }
    }

    return undefined;
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

  private async ensureWindowsCudaRuntimeDependencies(
    manifest: WhisperManifest,
    cudaVersion: SupportedCudaVersion,
    useMultiThreadDownload: boolean
  ): Promise<void> {
    if (process.platform !== 'win32') return;
    const runtime = Object.values(manifest.runtime.platforms).find(
      (candidate) => candidate.acceleration === 'cuda' && candidate.cudaVersion === cudaVersion
    );
    if (!runtime) return;

    const runtimeDir = dirname(join(this.cacheDir(), runtime.binary));
    if (hasWindowsCudaRuntime(cudaVersion, [runtimeDir])) return;

    const packageInfo = await this.fetchCudaLibcublasPackage(cudaVersion);
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
    await this.downloadHttp(
      'runtime',
      `${NVIDIA_CUDA_REDIST_BASE_URL}${packageInfo.relative_path}`,
      archivePath,
      useMultiThreadDownload
    );

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Verifying CUDA cuBLAS runtime checksum.' });
    const verified = await this.verifySha256(archivePath, packageInfo.sha256);
    if (!verified) {
      await rm(archivePath, { force: true });
      throw new Error('Downloaded CUDA cuBLAS runtime failed SHA-256 verification.');
    }

    this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Extracting CUDA cuBLAS runtime.' });
    await mkdir(extractDir, { recursive: true });
    await this.extractZip(archivePath, extractDir);

    const runtimeDlls = WINDOWS_CUDA_RUNTIME_DLLS[cudaVersion];
    const dllPaths = await findFilesByName(extractDir, runtimeDlls);
    for (const dllName of runtimeDlls) {
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

  private async fetchCudaLibcublasPackage(cudaVersion: SupportedCudaVersion): Promise<NonNullable<CudaRedistribManifest['libcublas']>[string]> {
    const response = await fetch(NVIDIA_CUDA_REDIST_MANIFEST_URLS[cudaVersion]);
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

function detectCudaSupport(
  extraSearchRoots: string[] = [],
  cudaVersion: SupportedCudaVersion = CUDA_11_8
): boolean {
  if (process.platform !== 'win32' && process.platform !== 'linux') return false;
  if (process.platform === 'win32') {
    return hasWindowsCudaRuntime(cudaVersion, extraSearchRoots);
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

function detectNvidiaGpuInfo(): NvidiaGpuInfo | undefined {
  const query = spawnSync('nvidia-smi', ['--query-gpu=name,compute_cap', '--format=csv,noheader'], {
    windowsHide: true,
    encoding: 'utf8'
  });
  if (query.status !== 0) return undefined;

  const line = String(query.stdout ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return undefined;

  const parts = line.split(',').map((entry) => entry.trim());
  const architectureQuery =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "(nvidia-smi -q | Select-String -Pattern 'Product Architecture' | Select-Object -First 1).ToString()"
          ],
          {
            windowsHide: true,
            encoding: 'utf8'
          }
        )
      : undefined;
  const architectureLine = String(architectureQuery?.stdout ?? '');
  const architectureMatch = architectureLine.match(/Product Architecture\\s*:\\s*(.+)/i);

  return {
    name: parts[0] ?? 'NVIDIA GPU',
    computeCapability: parts[1],
    architecture: architectureMatch?.[1]?.trim()
  };
}

function hasWindowsCudaRuntime(cudaVersion: SupportedCudaVersion, extraSearchRoots: string[] = []): boolean {
  const searchRoots = [
    ...extraSearchRoots,
    process.env.CUDA_PATH ? join(process.env.CUDA_PATH, 'bin') : undefined,
    process.env.CUDA_HOME ? join(process.env.CUDA_HOME, 'bin') : undefined,
    ...String(process.env.PATH ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
  ].filter((entry): entry is string => Boolean(entry));

  return WINDOWS_CUDA_RUNTIME_DLLS[cudaVersion].every((dllName) =>
    searchRoots.some((root) => existsSync(join(root, dllName)))
  );
}

function requiredCudaVersionForGpu(gpuInfo: NvidiaGpuInfo): SupportedCudaVersion {
  const capability = Number.parseFloat(gpuInfo.computeCapability ?? '');
  if (Number.isFinite(capability) && capability >= 12) {
    return CUDA_12_8;
  }
  return CUDA_11_8;
}

function isCudaRuntimeCompatibleWithGpu(
  runtimeCudaVersion: SupportedCudaVersion | undefined,
  gpuInfo?: NvidiaGpuInfo
): { ok: boolean; message?: string } {
  if (!gpuInfo) return { ok: true };
  const requiredCudaVersion = requiredCudaVersionForGpu(gpuInfo);
  if (!runtimeCudaVersion || runtimeCudaVersion === requiredCudaVersion) {
    return { ok: true };
  }

  if (requiredCudaVersion === CUDA_12_8 && runtimeCudaVersion === CUDA_11_8) {
    return {
      ok: false,
      message: `Detected ${gpuInfo.name}${gpuInfo.computeCapability ? ` (compute capability ${gpuInfo.computeCapability})` : ''}. This GPU generation requires CUDA 12.8+ for local whisper CUDA, but the pinned runtime is CUDA ${runtimeCudaVersion}. Falling back to CPU until a matching whisper CUDA runtime is provided.`
    };
  }

  return { ok: true };
}

function canRunWhisperBinary(path: string): boolean {
  const probe = spawnSync(path, ['--help'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5_000
  });
  return probe.status === 0;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((entry) => resolve(entry)))];
}

async function findFileByName(root: string, fileName: string, maxDepth: number): Promise<string | undefined> {
  if (!existsSync(root)) return undefined;

  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const target = fileName.toLowerCase();

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const nextPath = join(current.path, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === target) {
        return nextPath;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ path: nextPath, depth: current.depth + 1 });
      }
    }
  }

  return undefined;
}

async function findFilesByName(root: string, names: readonly string[]): Promise<Map<string, string>> {
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
