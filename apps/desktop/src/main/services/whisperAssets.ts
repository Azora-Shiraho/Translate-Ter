import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  LocalAsrAcceleration,
  AssetEvent,
  RuntimeVariant,
  WhisperModelInfo,
  WhisperModelRequest,
  WhisperModelStatus,
  WhisperRuntimeRequest,
  WhisperRuntimeStatus
} from '@shared/models';
import { legacyWhisperCudaRuntimeDirs, sharedCudaRuntimeDir } from './cudaRuntimePaths';
import {
  type RuntimeResolution
} from './runtimeResolver';
import {
  normalizeRuntimeManifest,
  type NormalizedRuntimeCandidate
} from './runtimeManifest';
import {
  resolveWhisperRuntimeRequestOptions,
  resolveWhisperRuntimeSelection,
  type WhisperRuntimeResolverOptions
} from './whisperRuntimeResolverAdapter';

const NVIDIA_CUDA_REDIST_BASE_URL = 'https://developer.download.nvidia.com/compute/cuda/redist/';
const NVIDIA_CUDA_REDIST_MANIFEST_URLS = {
  '11.8': `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_11.8.0.json`,
  '12.8': `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_12.8.0.json`
} as const;
const WINDOWS_CUDA_RUNTIME_DLLS = {
  '11.8': ['cublas64_11.dll', 'cublasLt64_11.dll'],
  '12.8': ['cublas64_12.dll', 'cublasLt64_12.dll']
} as const;
const MULTI_THREAD_MIN_BYTES = 8 * 1024 * 1024;
const CUDA_11_8 = '11.8' as const;
const CUDA_12_8 = '12.8' as const;
const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const REMOVE_RETRY_DELAYS_MS = [120, 240, 480, 960];

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
    estimatedVramBytes?: number;
    sha256: string;
    path: string;
    url: string | null;
  }>;
};

type WhisperManifestRuntime = WhisperManifest['runtime']['platforms'][string];

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

type WhisperRuntimeCandidateState = {
  runtime: WhisperManifestRuntime;
  variant: RuntimeVariant;
  platformKey: string;
  binaryState: {
    installPath: string;
    existingPath?: string;
    verifiedPath?: string;
    systemPath?: string;
    resolvedPath: string;
    installed: boolean;
    verified: boolean;
  };
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
          estimatedVramBytes: model.estimatedVramBytes,
          sha256: model.sha256,
          installed: Boolean(modelPath)
        };
      })
    );
  }

  async ensureModel(request: WhisperModelRequest): Promise<WhisperModelStatus> {
    await this.migrateLegacyCacheIfNeeded();
    const manifest = await this.manifest();
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];
    const managedModelPath = join(this.cacheDir(), model.path);
    const existingModelPath = await this.findExistingModelPath(model.path);
    const modelPath = existingModelPath ?? managedModelPath;
    const hashesPinned = isPinnedSha256(model.sha256);
    const modelInstalled = await this.exists(modelPath);
    const modelVerified = hashesPinned && modelInstalled ? await this.verifySha256(modelPath, model.sha256) : false;

    if (!modelVerified && request.allowDownload && manifest.enabled !== false && hashesPinned) {
      await this.downloadAndInstall(
        'model',
        model.url,
        managedModelPath,
        model.sha256,
        Boolean(request.useMultiThreadDownload)
      );
    }

    const resolvedModelPath = (await this.findExistingModelPath(model.path)) ?? managedModelPath;
    const resolvedModelInstalled = await this.exists(resolvedModelPath);
    const resolvedModelVerified = hashesPinned && resolvedModelInstalled
      ? await this.verifySha256(resolvedModelPath, model.sha256)
      : false;

    if (resolvedModelVerified) {
      return this.modelStatus(resolvedModelPath, model.id, resolvedModelInstalled, true, {
        actionRequired: 'none',
        message: 'Selected whisper model is ready.'
      });
    }

    if (manifest.enabled === false) {
      return this.modelStatus(resolvedModelPath, model.id, resolvedModelInstalled, false, {
        actionRequired: 'manifest-not-configured',
        message:
          manifest.note ??
          'This build does not include the download information needed for local Whisper files yet. Please update the app or use a complete package.'
      });
    }

    if (!hashesPinned) {
      return this.modelStatus(resolvedModelPath, model.id, resolvedModelInstalled, false, {
        actionRequired: 'manifest-not-configured',
        message: 'The model download information is incomplete right now, so the app cannot verify or download this model automatically.'
      });
    }

    return this.modelStatus(resolvedModelPath, model.id, resolvedModelInstalled, false, {
      actionRequired: 'download-model',
      message: 'Selected whisper model is missing. Download the model before transcription.'
    });
  }

  async ensureRuntime(request: WhisperRuntimeRequest): Promise<WhisperRuntimeStatus> {
    await this.migrateLegacyCacheIfNeeded();
    const manifest = await this.manifest();
    const normalizedManifest = normalizeRuntimeManifest(manifest);
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];
    const runtimeRequest = resolveWhisperRuntimeRequestOptions(request);
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
    let cudaRuntimeDetected = detectCudaSupport(
      this.cudaRuntimeSearchRoots(normalizedManifest.candidates, preferredCudaVersion),
      preferredCudaVersion
    );
    if (runtimeRequest.preferCuda && cudaHardwareSupported && !cudaRuntimeDetected && canDownloadCudaRuntime) {
      await this.ensureWindowsCudaRuntimeDependencies(
        normalizedManifest.candidates,
        preferredCudaVersion,
        Boolean(request.useMultiThreadDownload)
      );
      cudaRuntimeDetected = detectCudaSupport(
        this.cudaRuntimeSearchRoots(normalizedManifest.candidates, preferredCudaVersion),
        preferredCudaVersion
      );
    }
    const hasPinnedCudaRuntime = Boolean(manifest.runtime.platforms[`${this.platformKey()}-cuda`]);
    const runtimeCudaVersion = this.runtimeCudaVersion(manifest);
    const compatibility = isCudaRuntimeCompatibleWithGpu(runtimeCudaVersion, gpuInfo);
    const versionMismatch = hasPinnedCudaRuntime && cudaHardwareSupported && cudaRuntimeDetected && !compatibility.ok;
    const cudaSupported =
      hasPinnedCudaRuntime &&
      cudaHardwareSupported &&
      cudaRuntimeDetected &&
      (!versionMismatch || runtimeRequest.ignoreCudaMismatch);
    const managedModelPath = join(this.cacheDir(), model.path);
    const existingModelPath = await this.findExistingModelPath(model.path);
    const modelPath = existingModelPath ?? managedModelPath;
    const modelExists = await this.exists(modelPath);
    const modelVerified = isPinnedSha256(model.sha256) && modelExists ? await this.verifySha256(modelPath, model.sha256) : false;
    const capabilities = {
      cuda: {
        hardwareDetected: cudaHardwareSupported,
        runtimeDetected: cudaRuntimeDetected,
        compatible: !versionMismatch,
        warning: versionMismatch && compatibility.message
          ? {
              code: 'cuda-version-mismatch' as const,
              message: compatibility.message
            }
          : undefined
      }
    } satisfies Parameters<typeof resolveWhisperRuntimeSelection>[0]['capabilities'];
    const runtimeCandidates = await this.collectRuntimeCandidateStates(manifest, normalizedManifest.candidates);
    const runtimeBinaries = Object.fromEntries(
      Object.entries(runtimeCandidates).map(([platformKey, state]) => [
        platformKey,
        {
          exists: state.binaryState.installed,
          verified: state.binaryState.verified,
          resolvedPath: state.binaryState.resolvedPath
        }
      ])
    );
    const { resolution } = resolveWhisperRuntimeSelection({
      manifest,
      platform: process.platform,
      arch: process.arch,
      modelId: model.id,
      options: {
        acceleration: runtimeRequest.acceleration,
        preferredVariant: runtimeRequest.preferredVariant,
        ignoreCudaMismatch: runtimeRequest.ignoreCudaMismatch
      },
      runtimeBinaries,
      modelFile: {
        exists: modelExists,
        verified: modelVerified,
        resolvedPath: modelPath
      },
      capabilities
    });
    const selectedRuntimeState = runtimeCandidates[resolution.platformKey];
    const selectedRuntime = selectedRuntimeState?.runtime;
    const platformKey = this.statusPlatformKey(resolution, runtimeRequest);
    const compatibilityMessage = this.compatibilityMessageForResolution(
      resolution,
      runtimeRequest,
      compatibility.message
    );
    const statusVariant = resolution.variant;
    const statusActionRequired = this.statusActionRequiredForResolution(resolution, selectedRuntime);
    const statusRuntimeBinary = selectedRuntime?.binary ?? 'unsupported-platform';
    const statusRuntimePath = selectedRuntimeState?.binaryState.resolvedPath ?? statusRuntimeBinary;

    if (manifest.enabled === false) {
      return this.status(
        platformKey,
        selectedRuntime?.binary ?? 'manifest-disabled',
        model.path,
        model.id,
        statusVariant,
        runtimeRequest.acceleration,
        resolution,
        cudaHardwareSupported,
        cudaRuntimeDetected,
        cudaSupported,
        versionMismatch,
        requiredCudaVersion,
        runtimeCudaVersion,
        false,
        false,
        false,
        false,
        {
          actionRequired: 'manifest-not-configured',
          message:
            manifest.note ??
            'This build does not include the download information needed for local Whisper files yet. Please update the app or use a complete package.'
        }
      );
    }

    if (!selectedRuntime || resolution.binaryPath === undefined) {
      return this.status(
        platformKey,
        selectedRuntime?.binary ?? 'unsupported-platform',
        model.path,
        model.id,
        statusVariant,
        runtimeRequest.acceleration,
        resolution,
        cudaHardwareSupported,
        cudaRuntimeDetected,
        cudaSupported,
        versionMismatch,
        requiredCudaVersion,
        runtimeCudaVersion,
        false,
        false,
        false,
        false,
        {
          actionRequired: statusActionRequired,
          message: compatibilityMessage ?? 'This version does not provide a local Whisper program for your computer yet.'
        }
      );
    }

    const managedBinary = selectedRuntimeState!.binaryState;
    const hashesPinned = isPinnedSha256(selectedRuntime.sha256) && isPinnedSha256(model.sha256);
    const binaryExists = managedBinary.installed;
    const binaryVerified = managedBinary.verified;

    if (!hashesPinned) {
      return this.status(
        platformKey,
        selectedRuntime.binary,
        model.path,
        model.id,
        statusVariant,
        runtimeRequest.acceleration,
        resolution,
        cudaHardwareSupported,
        cudaRuntimeDetected,
        cudaSupported,
        versionMismatch,
        requiredCudaVersion,
        runtimeCudaVersion,
        binaryExists,
        modelExists,
        false,
        false,
        {
          actionRequired: 'manifest-not-configured',
          message: 'The local Whisper download information is incomplete right now, so the app cannot verify or download these files automatically.'
        }
      );
    }

    if (!binaryVerified && canDownloadRuntime) {
      await this.downloadAndInstall(
        'runtime',
        selectedRuntime.url,
        managedBinary.installPath,
        selectedRuntime.sha256,
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

    const resolvedManagedBinary = await this.probeRuntimeBinaryState(selectedRuntime, selectedRuntimeState!.variant);
    const resolvedModelPath = (await this.findExistingModelPath(model.path)) ?? managedModelPath;
    const resolvedBinaryInstalled = resolvedManagedBinary.installed;
    const resolvedModelInstalled = await this.exists(resolvedModelPath);
    const resolvedBinaryVerified = resolvedManagedBinary.verified;
    const resolvedModelVerified = await this.verifyIfPresent(resolvedModelPath, model.sha256);

    return this.status(
      platformKey,
      resolvedManagedBinary.resolvedPath ?? statusRuntimePath,
      resolvedModelPath,
      model.id,
      statusVariant,
      runtimeRequest.acceleration,
      resolution,
      cudaHardwareSupported,
      cudaRuntimeDetected,
      cudaSupported,
      versionMismatch,
      requiredCudaVersion,
      runtimeCudaVersion,
      resolvedBinaryInstalled,
      resolvedModelInstalled,
      resolvedBinaryVerified,
      resolvedModelVerified,
      {
        actionRequired: !resolvedBinaryVerified
          ? 'download-runtime'
          : !resolvedModelVerified
            ? 'download-model'
            : statusActionRequired,
        message:
          !resolvedBinaryVerified
            ? 'whisper.cpp binary is missing or cannot run. Download whisper runtime before testing local transcription.'
            : !resolvedModelVerified
              ? 'Selected whisper model is missing. Download the model before transcription.'
              : compatibilityMessage ?? 'whisper.cpp runtime is ready.'
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
      return join(dirname(process.execPath), 'runtime', 'whisper_cpp');
    }
    return join(resolve('.'), '.runtime', 'whisper_cpp');
  }

  cudaRuntimeDir(cudaVersion: SupportedCudaVersion): string {
    return sharedCudaRuntimeDir(cudaVersion);
  }

  private legacyCacheDir(): string {
    return join(app.getPath('userData'), 'runtime', 'whisper');
  }

  private legacyRuntimeDirs(): string[] {
    return [
      this.legacyCacheDir(),
      join(dirname(process.execPath), 'runtime', 'whisper'),
      join(resolve('.'), '.runtime', 'whisper')
    ];
  }

  private cudaRuntimeSearchRoots(
    candidates: readonly NormalizedRuntimeCandidate[],
    cudaVersion?: SupportedCudaVersion
  ): string[] {
    const runtimes = candidates.filter((candidate) => candidate.variant === 'cuda');
    const ordered = cudaVersion
      ? [
            ...runtimes.filter((candidate) => candidate.cudaVersion === cudaVersion),
            ...runtimes.filter((candidate) => candidate.cudaVersion !== cudaVersion)
          ]
      : runtimes;

    return uniquePaths(
      ordered.flatMap((runtime) => [
        ...(isSupportedCudaVersion(runtime.cudaVersion) ? [this.cudaRuntimeDir(runtime.cudaVersion)] : []),
        ...legacyWhisperCudaRuntimeDirs(),
        ...this.runtimeBinarySearchRootsForBinary(runtime.binary)
      ])
    );
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
      throw new Error('The download information for this file is incomplete, so it cannot be downloaded right now.');
    }

    const tmpPath = this.shouldExtractArchive(url, destination) ? `${destination}.download.zip` : `${destination}.tmp`;
    await mkdir(dirname(destination), { recursive: true });
    await this.removePathWithRetry(tmpPath);

    this.emitAsset({
      type: 'download-start',
      scope,
      message: scope === 'runtime' ? 'Downloading local Whisper files.' : 'Downloading Whisper model.'
    });

    if (url.startsWith('file://')) {
      const sourcePath = url.slice('file://'.length);
      await copyFile(sourcePath, tmpPath);
    } else if (url.startsWith('https://')) {
      await this.downloadHttp(scope, url, tmpPath, useMultiThreadDownload);
    } else {
      throw new Error('This download link is not supported by the app.');
    }

    this.emitAsset({ type: 'verify', scope, message: scope === 'runtime' ? 'Checking downloaded Whisper files.' : 'Checking downloaded model file.' });
    const verified = await this.verifySha256(tmpPath, sha256);
    if (!verified) {
      await this.removePathWithRetry(tmpPath);
      this.emitAsset({ type: 'error', scope, message: 'The downloaded file did not pass the integrity check.' });
      throw new Error('The downloaded file did not pass the integrity check. Please try again.');
    }
    if (this.shouldExtractArchive(url, destination)) {
      const extractDir = this.archiveExtractDir(destination);
      await mkdir(extractDir, { recursive: true });
      this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Preparing local Whisper files.' });
      await this.extractZip(tmpPath, extractDir);
      await writeFile(this.archiveMarkerPath(destination), sha256, 'utf8');
      await this.removePathWithRetry(tmpPath);
      this.emitAsset({ type: 'ready', scope, message: 'Local Whisper files are ready.' });
      return;
    }

    await rename(tmpPath, destination);
    this.emitAsset({ type: 'ready', scope, message: scope === 'runtime' ? 'Local Whisper files are ready.' : 'Model download complete.' });
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
        await this.removePathWithRetry(destination);
      }
    }

    await this.downloadHttpSingle(scope, url, destination);
  }

  private async downloadHttpSingle(scope: 'runtime' | 'model', url: string, destination: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      this.emitAsset({ type: 'error', scope, message: `Download failed (HTTP ${response.status}).` });
      throw new Error(`Download failed (HTTP ${response.status}).`);
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
              scope,
              message: scope === 'runtime' ? 'Downloading local Whisper files...' : 'Downloading Whisper model...',
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
          message: scope === 'runtime' ? 'Downloading local Whisper files...' : 'Downloading Whisper model...',
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

  private status(
    platformKey: string,
    runtimeBinary: string,
    modelPath: string,
    modelId: string,
    runtimeAcceleration: 'cpu' | 'cuda' | 'metal' | 'vulkan',
    requestedAcceleration: LocalAsrAcceleration,
    resolution: RuntimeResolution,
    cudaHardwareSupported: boolean,
    cudaRuntimeDetected: boolean,
    cudaSupported: boolean,
    versionMismatch: boolean,
    requiredCudaVersion: SupportedCudaVersion | undefined,
    runtimeCudaVersion: SupportedCudaVersion | undefined,
    binaryInstalled: boolean,
    modelInstalled: boolean,
    binaryVerified: boolean,
    modelVerified: boolean,
    extra: Pick<WhisperRuntimeStatus, 'actionRequired' | 'message'>
  ): WhisperRuntimeStatus {
    const selected = runtimeAcceleration === 'cpu' ? 'cpu' : 'gpu';

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
        requested: requestedAcceleration,
        selected,
        cudaSupported,
        hardwareDetected: cudaHardwareSupported,
        runtimeDetected: cudaRuntimeDetected,
        versionMismatch,
        requiredCudaVersion,
        runtimeCudaVersion,
        runtimeVariant: runtimeAcceleration,
        fallbackReason: resolution.fallbackReason
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
      throw new Error('The local Whisper file list is missing. Please reinstall or update the app.');
    }
    this.manifestCache = JSON.parse(raw) as WhisperManifest;
    return this.manifestCache;
  }

  private platformKey(): string {
    return `${process.platform}-${process.arch}`;
  }

  private runtimeCudaVersion(manifest: WhisperManifest): SupportedCudaVersion | undefined {
    const runtime = manifest.runtime.platforms[`${this.platformKey()}-cuda`];
    return runtime?.cudaVersion;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async findSystemWhisperBinary(runtime: WhisperManifestRuntime, variant: RuntimeVariant): Promise<string | undefined> {
    if (variant !== 'cpu') {
      return undefined;
    }

    const manifestBinaryPath = runtime.binary;
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

  private runtimeBinaryInstallPath(runtime: WhisperManifestRuntime): string {
    return join(this.cacheDir(), runtime.binary);
  }

  private runtimeBinaryInstallPathForBinary(binary: string): string {
    return join(this.cacheDir(), binary);
  }

  private runtimeBinarySearchRoots(runtime: WhisperManifestRuntime): string[] {
    return uniquePaths(this.runtimeBinarySearchPaths(runtime).map((candidate) => dirname(candidate)));
  }

  private runtimeBinarySearchRootsForBinary(binary: string): string[] {
    return uniquePaths(this.runtimeBinarySearchPathsForBinary(binary).map((candidate) => dirname(candidate)));
  }

  private runtimeBinarySearchPaths(runtime: WhisperManifestRuntime): string[] {
    return this.runtimeBinarySearchPathsForBinary(runtime.binary);
  }

  private runtimeBinarySearchPathsForBinary(binary: string): string[] {
    const fileName = basename(binary);
    const cacheRoots = uniquePaths([this.cacheDir(), ...this.legacyRuntimeDirs()]);
    return uniquePaths([
      this.runtimeBinaryInstallPathForBinary(binary),
      ...cacheRoots.map((root) => join(root, binary)),
      ...cacheRoots.map((root) => join(root, 'bin', 'Release', fileName))
    ]);
  }

  private async probeManagedRuntimeBinary(
    runtime: WhisperManifestRuntime
  ): Promise<{ installPath: string; existingPath?: string; verifiedPath?: string }> {
    const installPath = this.runtimeBinaryInstallPath(runtime);
    let existingPath: string | undefined;

    for (const candidate of this.runtimeBinarySearchPaths(runtime)) {
      if (!(await this.exists(candidate))) {
        continue;
      }
      existingPath ??= candidate;
      if (await this.verifyRuntime(candidate, runtime.url, runtime.sha256)) {
        return { installPath, existingPath: candidate, verifiedPath: candidate };
      }
    }

    return { installPath, existingPath };
  }

  private async probeRuntimeBinaryState(
    runtime: WhisperManifestRuntime,
    variant: RuntimeVariant
  ): Promise<WhisperRuntimeCandidateState['binaryState']> {
    const managedBinary = await this.probeManagedRuntimeBinary(runtime);
    const systemPath = managedBinary.verifiedPath ? undefined : await this.findSystemWhisperBinary(runtime, variant);
    const resolvedPath = managedBinary.verifiedPath ?? systemPath ?? managedBinary.existingPath ?? managedBinary.installPath;
    return {
      installPath: managedBinary.installPath,
      existingPath: managedBinary.existingPath,
      verifiedPath: managedBinary.verifiedPath,
      systemPath,
      resolvedPath,
      installed: Boolean(systemPath) || Boolean(managedBinary.existingPath),
      verified: Boolean(systemPath) || Boolean(managedBinary.verifiedPath)
    };
  }

  private async collectRuntimeCandidateStates(
    manifest: WhisperManifest,
    normalizedCandidates: readonly NormalizedRuntimeCandidate[] = normalizeRuntimeManifest(manifest).candidates
  ): Promise<Record<string, WhisperRuntimeCandidateState>> {
    const normalizedByPlatformKey = new Map(normalizedCandidates.map((candidate) => [candidate.platformKey, candidate]));
    const entries = await Promise.all(
      Object.entries(manifest.runtime.platforms).map(async ([platformKey, runtime]) => [
        platformKey,
        await this.runtimeCandidateState(platformKey, runtime, normalizedByPlatformKey.get(platformKey))
      ] as const)
    );
    return Object.fromEntries(entries);
  }

  private async runtimeCandidateState(
    platformKey: string,
    runtime: WhisperManifestRuntime,
    normalizedCandidate?: NormalizedRuntimeCandidate
  ): Promise<WhisperRuntimeCandidateState> {
    const variant = normalizedCandidate?.variant ?? normalizeRuntimeVariantFromPlatformKey(platformKey, runtime.acceleration);
    return {
      runtime,
      platformKey,
      variant,
      binaryState: await this.probeRuntimeBinaryState(runtime, variant)
    };
  }

  private statusPlatformKey(resolution: RuntimeResolution, request: WhisperRuntimeResolverOptions): string {
    if (resolution.supported) {
      return resolution.platformKey;
    }

    if (resolution.actionRequired === 'manifest-not-configured' || resolution.actionRequired === 'unsupported-platform') {
      const baseKey = this.platformKey();
      const wantsGpu = request.acceleration === 'gpu' || (request.acceleration === 'auto' && request.preferredVariant === 'cuda');
      return wantsGpu ? `${baseKey}-cuda` : baseKey;
    }

    return resolution.platformKey;
  }

  private compatibilityMessageForResolution(
    resolution: RuntimeResolution,
    request: WhisperRuntimeResolverOptions,
    mismatchMessage?: string
  ): string | undefined {
    if (
      request.preferCuda &&
      resolution.variant === 'cpu' &&
      resolution.fallbackReason === 'gpu-not-compatible' &&
      mismatchMessage
    ) {
      return mismatchMessage;
    }

    return undefined;
  }

  private statusActionRequiredForResolution(
    resolution: RuntimeResolution,
    runtime: WhisperManifestRuntime | undefined
  ): NonNullable<WhisperRuntimeStatus['actionRequired']> {
    return resolution.actionRequired;
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
      ...this.legacyRuntimeDirs().map((entry) => join(entry, dirname(manifestModelPath))),
      join(dirname(process.execPath), 'runtime', 'whisper', dirname(manifestModelPath)),
      join(dirname(process.execPath), dirname(manifestModelPath)),
      join(dirname(process.execPath), 'models'),
      resolve(dirname(manifestModelPath)),
      resolve('models'),
      resolve('.runtime', 'whisper', dirname(manifestModelPath)),
      resolve('.runtime', 'whisper_cpp', dirname(manifestModelPath))
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
      ...this.legacyRuntimeDirs(),
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
    if (await this.exists(nextCacheDir)) return;
    for (const legacyCacheDir of uniquePaths(this.legacyRuntimeDirs())) {
      if (nextCacheDir === legacyCacheDir) continue;
      if (!(await this.exists(legacyCacheDir))) continue;

      await mkdir(dirname(nextCacheDir), { recursive: true });
      try {
        await rename(legacyCacheDir, nextCacheDir);
        return;
      } catch {
        // Fall back to copy-on-demand via normal download/install flow if move fails.
      }
    }
  }

  private async ensureWindowsCudaRuntimeDependencies(
    candidates: readonly NormalizedRuntimeCandidate[],
    cudaVersion: SupportedCudaVersion,
    useMultiThreadDownload: boolean
  ): Promise<void> {
    if (process.platform !== 'win32') return;
    const runtime =
      candidates.find((candidate) => candidate.variant === 'cuda' && candidate.cudaVersion === cudaVersion) ??
      candidates.find((candidate) => candidate.variant === 'cuda');
    if (!runtime) return;

    const runtimeDir = this.cudaRuntimeDir(cudaVersion);
    if (hasWindowsCudaRuntime(cudaVersion, [runtimeDir])) return;

    const packageInfo = await this.fetchCudaLibcublasPackage(cudaVersion);
    if (!packageInfo.relative_path || !packageInfo.sha256 || !isPinnedSha256(packageInfo.sha256)) {
      throw new Error('The CUDA download information is incomplete right now.');
    }

    const downloadDir = join(this.cacheDir(), 'downloads');
    const archivePath = join(downloadDir, basename(packageInfo.relative_path));
    const extractDir = join(this.cacheDir(), 'cuda-redist', 'libcublas');
    await mkdir(downloadDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });

    this.emitAsset({ type: 'download-start', scope: 'runtime', message: 'Downloading CUDA components.' });
    await this.downloadHttp(
      'runtime',
      `${NVIDIA_CUDA_REDIST_BASE_URL}${packageInfo.relative_path}`,
      archivePath,
      useMultiThreadDownload
    );

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Checking downloaded CUDA components.' });
    const verified = await this.verifySha256(archivePath, packageInfo.sha256);
    if (!verified) {
      await this.removePathWithRetry(archivePath);
      throw new Error('The downloaded CUDA files did not pass the integrity check. Please try again.');
    }

    this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Preparing CUDA components.' });
    await mkdir(extractDir, { recursive: true });
    await this.extractZip(archivePath, extractDir);

    const runtimeDlls = WINDOWS_CUDA_RUNTIME_DLLS[cudaVersion];
    const dllPaths = await findFilesByName(extractDir, runtimeDlls);
    for (const dllName of runtimeDlls) {
      const sourcePath = dllPaths.get(dllName.toLowerCase());
      if (!sourcePath) {
        throw new Error('The downloaded CUDA package is incomplete.');
      }
      await copyFile(sourcePath, join(runtimeDir, dllName));
    }

    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });
    this.emitAsset({ type: 'ready', scope: 'runtime', message: 'CUDA components are ready.' });
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

  private async fetchCudaLibcublasPackage(cudaVersion: SupportedCudaVersion): Promise<NonNullable<CudaRedistribManifest['libcublas']>[string]> {
    const response = await fetch(NVIDIA_CUDA_REDIST_MANIFEST_URLS[cudaVersion]);
    if (!response.ok) {
      throw new Error(`Failed to get the required CUDA download information (HTTP ${response.status}).`);
    }
    const manifest = (await response.json()) as CudaRedistribManifest;
    const packageInfo = manifest.libcublas?.['windows-x86_64'];
    if (!packageInfo) {
      throw new Error('The required CUDA download information is incomplete.');
    }
    return packageInfo;
  }

  private modelStatus(
    modelPath: string,
    modelId: string,
    installed: boolean,
    verified: boolean,
    extra: Pick<WhisperModelStatus, 'actionRequired' | 'message'>
  ): WhisperModelStatus {
    return {
      id: modelId,
      cacheDir: this.cacheDir(),
      expectedPath: isAbsolute(modelPath) ? modelPath : join(this.cacheDir(), modelPath),
      installed,
      verified,
      ...extra
    };
  }
}

function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}

function isSupportedCudaVersion(value: string | undefined): value is SupportedCudaVersion {
  return value === CUDA_11_8 || value === CUDA_12_8;
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
  if (!gpuInfo || !runtimeCudaVersion) return { ok: true };
  const requiredCudaVersion = requiredCudaVersionForGpu(gpuInfo);
  if (runtimeCudaVersion === requiredCudaVersion) {
    return { ok: true };
  }

  if (requiredCudaVersion === CUDA_12_8 && runtimeCudaVersion === CUDA_11_8) {
    return {
      ok: false,
      message: `Detected ${gpuInfo.name}. This graphics card works better with CUDA 12.8, but the current local Whisper CUDA files are ${runtimeCudaVersion}. The app will use CPU until matching CUDA files are available.`
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

function normalizeRuntimeVariantFromPlatformKey(platformKey: string, acceleration?: string): RuntimeVariant {
  const parts = platformKey.split('-');
  const suffix = parts.length > 2 ? parts[2] : undefined;
  if (suffix === 'cuda' || suffix === 'metal' || suffix === 'vulkan') {
    return suffix;
  }
  if (acceleration === 'cuda' || acceleration === 'metal' || acceleration === 'vulkan') {
    return acceleration;
  }
  return 'cpu';
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
