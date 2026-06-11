import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import type {
  AssetEvent,
  FasterWhisperCudaRequest,
  FasterWhisperCudaStatus,
  FasterWhisperRuntimeRequest,
  ProviderHealth,
  SubtitleDocument,
  SubtitleSegment,
  SubtitleWarning,
  WhisperModelInfo
} from '@shared/models';
import { legacyWhisperCudaRuntimeDirs, sharedCudaRuntimeDir } from './cudaRuntimePaths';
import type { ScopedLogger } from './logger';

type CudaRedistribManifest = {
  libcublas?: Record<
    string,
    {
      relative_path?: string;
      sha256?: string;
    }
  >;
};

type PythonCommand = {
  executable: string;
  prefixArgs: string[];
  label: string;
  source: 'environment' | 'managed' | 'system';
};

type FasterWhisperHealthResponse = {
  ok: boolean;
  python_version?: string;
  faster_whisper_version?: string;
  ctranslate2_version?: string;
  cache_dir?: string;
  device_requested?: 'cpu' | 'cuda';
  cuda_device_count?: number;
  message?: string;
};

type FasterWhisperSegment = {
  id?: string;
  start_ms: number;
  end_ms: number;
  text: string;
};

type FasterWhisperTranscriptionResponse = {
  ok: boolean;
  model: string;
  device: 'cpu' | 'cuda';
  device_requested?: 'cpu' | 'cuda';
  cpu_threads?: number;
  compute_type?: string | null;
  detected_language?: string;
  segments: FasterWhisperSegment[];
};

type DetectedRuntime =
  | {
      ok: true;
      command: PythonCommand;
      python_version?: string;
      faster_whisper_version?: string;
      ctranslate2_version?: string;
      cache_dir?: string;
      cuda_device_count?: number;
    }
  | {
      ok: false;
      message?: string;
    };

export type FasterWhisperTranscriptionRequest = {
  jobId: string;
  audioPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  modelId: string;
  preferCuda: boolean;
  cpuThreadCount?: number;
  allowDownload?: boolean;
  useMultiThreadDownload?: boolean;
};

const FASTER_WHISPER_PROVIDER_ID = 'local.faster-whisper';
const NVIDIA_CUDA_REDIST_BASE_URL = 'https://developer.download.nvidia.com/compute/cuda/redist/';
const NVIDIA_CUDA_REDIST_MANIFEST_URL = `${NVIDIA_CUDA_REDIST_BASE_URL}redistrib_12.8.0.json`;
const PYTHON_EMBED_VERSION = '3.11.9';
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_EMBED_VERSION}/python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`;
const PYTHON_EMBED_SHA256 = '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const GET_PIP_SHA256 = 'a341e1a43e38001c551a1508a73ff23636a11970b61d901d9a1cad2a18f57055';
const MANAGED_RUNTIME_PACKAGES = [
  'faster-whisper==1.2.1',
  'ctranslate2==4.8.0',
  'huggingface-hub==1.18.0',
  'tokenizers==0.23.1',
  'onnxruntime==1.26.0',
  'av==17.1.0',
  'tqdm==4.68.2'
] as const;
const MULTI_THREAD_MIN_BYTES = 8 * 1024 * 1024;
const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const REMOVE_RETRY_DELAYS_MS = [120, 240, 480, 960];
const FASTER_WHISPER_CUDA_VERSION = '12.8' as const;
const FASTER_WHISPER_CUDA_RUNTIME_DLLS = ['cublas64_12.dll', 'cublasLt64_12.dll'] as const;
const FASTER_WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: 'ggml-tiny',
    displayName: 'Whisper tiny',
    languageScope: 'multilingual',
    sizeBytes: 0,
    estimatedVramBytes: 536870912,
    sha256: '',
    installed: false
  },
  {
    id: 'ggml-base',
    displayName: 'Whisper base',
    languageScope: 'multilingual',
    sizeBytes: 0,
    estimatedVramBytes: 805306368,
    sha256: '',
    installed: false
  },
  {
    id: 'ggml-small',
    displayName: 'Whisper small',
    languageScope: 'multilingual',
    sizeBytes: 0,
    estimatedVramBytes: 1610612736,
    sha256: '',
    installed: false
  },
  {
    id: 'ggml-medium',
    displayName: 'Whisper medium',
    languageScope: 'multilingual',
    sizeBytes: 0,
    estimatedVramBytes: 3221225472,
    sha256: '',
    installed: false
  },
  {
    id: 'ggml-large-v3-turbo',
    displayName: 'Whisper turbo',
    languageScope: 'multilingual',
    sizeBytes: 0,
    estimatedVramBytes: 3758096384,
    sha256: '',
    installed: false
  }
];

export class FasterWhisperService extends EventEmitter {
  constructor(private readonly logger?: ScopedLogger) {
    super();
  }

  private resolvedPython?: PythonCommand;
  private readonly activeTranscriptions = new Map<string, ChildProcess>();
  private readonly cancelledJobs = new Set<string>();

  async listModels(): Promise<WhisperModelInfo[]> {
    return FASTER_WHISPER_MODELS.map((model) => ({ ...model }));
  }

  async ensureCudaRuntime(request: FasterWhisperCudaRequest): Promise<FasterWhisperCudaStatus> {
    let status = this.cudaRuntimeStatus();
    if (!status.cudaSupported && request.allowDownload && status.hardwareDetected) {
      await this.installManagedCudaRuntime(Boolean(request.useMultiThreadDownload));
      status = this.cudaRuntimeStatus();
    }
    return status;
  }

  async health(input: { modelId: string; preferCuda: boolean }): Promise<ProviderHealth> {
    const cudaStatus = input.preferCuda ? await this.ensureCudaRuntime({ allowDownload: false }) : undefined;
    const preferredRuntime = await this.detectHealthyPython(input.modelId, input.preferCuda);
    const preferredRuntimeMessage = preferredRuntime.ok ? undefined : preferredRuntime.message;
    const cudaRuntimeReady = !input.preferCuda || Boolean(cudaStatus?.cudaSupported);
    if (preferredRuntime.ok && cudaRuntimeReady) {
      return this.providerHealth(preferredRuntime, input.preferCuda);
    }

    if (input.preferCuda) {
      const cpuRuntime = await this.detectHealthyPython(input.modelId, false);
      if (cpuRuntime.ok) {
        return {
          providerId: FASTER_WHISPER_PROVIDER_ID,
          ok: false,
          status: 'degraded',
          message: [
            cudaRuntimeReady ? preferredRuntimeMessage ?? 'CUDA mode is unavailable.' : cudaStatus?.message ?? this.missingCudaRuntimeMessage(),
            this.baseReadyMessage(cpuRuntime, false)
          ]
            .filter(Boolean)
            .join(' ')
        };
      }
    }

    return {
      providerId: FASTER_WHISPER_PROVIDER_ID,
      ok: false,
      status: 'unavailable',
      message: preferredRuntimeMessage
    };
  }

  async ensureRuntime(request: FasterWhisperRuntimeRequest): Promise<ProviderHealth> {
    const preferredRuntime = await this.detectHealthyPython(request.modelId ?? 'ggml-base', request.preferCuda, {
      bundledOnly: Boolean(request.forceManaged)
    });
    const preferredRuntimeMessage = preferredRuntime.ok ? undefined : preferredRuntime.message;
    const cudaStatus = request.preferCuda ? await this.ensureCudaRuntime({ allowDownload: false }) : undefined;
    const cudaRuntimeReady = !request.preferCuda || Boolean(cudaStatus?.cudaSupported);
    if (preferredRuntime.ok && cudaRuntimeReady) {
      return this.providerHealth(preferredRuntime, request.preferCuda);
    }

    if (!request.allowDownload) {
      if (request.preferCuda && !request.forceManaged) {
        const cpuRuntime = await this.detectHealthyPython(request.modelId ?? 'ggml-base', false);
        if (cpuRuntime.ok) {
          return {
            providerId: FASTER_WHISPER_PROVIDER_ID,
            ok: false,
            status: 'degraded',
            message: [
              cudaRuntimeReady ? preferredRuntimeMessage ?? 'CUDA mode is unavailable.' : cudaStatus?.message ?? this.missingCudaRuntimeMessage(),
              this.baseReadyMessage(cpuRuntime, false)
            ]
              .filter(Boolean)
              .join(' ')
          };
        }
      }
      return {
        providerId: FASTER_WHISPER_PROVIDER_ID,
        ok: false,
        status: 'unavailable',
        message: preferredRuntimeMessage
      };
    }

    await this.ensureManagedRuntimeInstalled(request.modelId ?? 'ggml-base', Boolean(request.useMultiThreadDownload));

    const managedPreferred = await this.detectHealthyPython(request.modelId ?? 'ggml-base', request.preferCuda, {
      bundledOnly: true
    });
    const managedPreferredMessage = managedPreferred.ok ? undefined : managedPreferred.message;
    const managedCudaStatus = request.preferCuda ? await this.ensureCudaRuntime({ allowDownload: false }) : undefined;
    const managedCudaRuntimeReady = !request.preferCuda || Boolean(managedCudaStatus?.cudaSupported);
    if (managedPreferred.ok && managedCudaRuntimeReady) {
      return this.providerHealth(managedPreferred, request.preferCuda);
    }

    if (request.preferCuda) {
      const managedCpu = await this.detectHealthyPython(request.modelId ?? 'ggml-base', false, {
        bundledOnly: true
      });
      if (managedCpu.ok) {
        return {
          providerId: FASTER_WHISPER_PROVIDER_ID,
          ok: false,
          status: 'degraded',
          message: [
            managedCudaRuntimeReady
              ? managedPreferredMessage ?? 'CUDA mode is unavailable.'
              : managedCudaStatus?.message ?? this.missingCudaRuntimeMessage(),
            this.baseReadyMessage(managedCpu, false)
          ]
            .filter(Boolean)
            .join(' ')
        };
      }
    }

    return {
      providerId: FASTER_WHISPER_PROVIDER_ID,
      ok: false,
      status: 'unavailable',
      message: managedPreferredMessage ?? 'Bundled faster-whisper runtime is still unavailable after install.'
    };
  }

  async transcribe(request: FasterWhisperTranscriptionRequest): Promise<SubtitleDocument> {
    this.cancelledJobs.delete(request.jobId);
    await mkdir(this.cacheDir(), { recursive: true });

    const baseRuntime = await this.ensureRuntime({
      modelId: request.modelId,
      allowDownload: Boolean(request.allowDownload),
      preferCuda: false,
      useMultiThreadDownload: request.useMultiThreadDownload
    });
    if (!baseRuntime.ok && baseRuntime.status === 'unavailable') {
      throw new Error(baseRuntime.message ?? 'The local faster-whisper environment is not ready.');
    }

    const firstAttempt = await this.runTranscription({
      ...request,
      useCuda: request.preferCuda
    });
    if (this.cancelledJobs.has(request.jobId)) {
      throw cancellationError();
    }
    let output = firstAttempt;
    let warnings = firstAttempt.warnings;

    if (!firstAttempt.ok && request.preferCuda && shouldFallbackToCpu(firstAttempt.errorMessage)) {
      this.logger?.warn('transcribe.cuda-fallback', 'CUDA transcription failed once and will retry on CPU.', {
        jobId: request.jobId,
        modelId: request.modelId,
        errorMessage: firstAttempt.errorMessage
      });
      const cpuAttempt = await this.runTranscription({
        ...request,
        useCuda: false
      });
      if (this.cancelledJobs.has(request.jobId)) {
        throw cancellationError();
      }
      if (cpuAttempt.ok) {
        output = cpuAttempt;
        warnings = [
          ...warnings,
          {
            code: 'CudaFallback',
            message: 'GPU recognition failed once, so the app retried with CPU.',
            stage: 'asr',
            createdAt: new Date().toISOString()
          }
        ];
      }
    }

    if (!output.ok) {
      throw new Error(output.errorMessage ?? 'faster-whisper transcription failed.');
    }
    if (this.cancelledJobs.has(request.jobId)) {
      throw cancellationError();
    }

    const now = new Date().toISOString();
    const payload = output.payload;
    const segments: SubtitleSegment[] = payload.segments.map((segment, index) => ({
      id: segment.id ?? `seg-${String(index + 1).padStart(4, '0')}`,
      index: index + 1,
      startMs: Math.max(0, Math.round(segment.start_ms)),
      endMs: Math.max(Math.round(segment.start_ms), Math.round(segment.end_ms)),
      sourceText: segment.text.trim(),
      status: 'transcribed'
    }));

    return {
      id: `doc-${request.jobId}`,
      format: 'srt',
      sourceLanguage: payload.detected_language || request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      segments,
      metadata: {
        createdAt: now,
        asrProvider: FASTER_WHISPER_PROVIDER_ID,
        warnings
      }
    };
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelledJobs.add(jobId);
    const activeChild = this.activeTranscriptions.get(jobId);
    if (!activeChild) {
      return;
    }

    this.logger?.warn('transcribe.cancel', 'Cancelling faster-whisper transcription process.', {
      jobId,
      pid: activeChild.pid
    });
    this.activeTranscriptions.delete(jobId);
    try {
      activeChild.kill();
    } catch (error) {
      this.logger?.error('transcribe.cancel-failed', 'Failed to cancel faster-whisper transcription process.', {
        jobId,
        pid: activeChild.pid,
        error
      });
    }
  }

  private async runTranscription(
    input: FasterWhisperTranscriptionRequest & { useCuda: boolean }
  ): Promise<
    | { ok: true; payload: FasterWhisperTranscriptionResponse; warnings: SubtitleWarning[] }
    | { ok: false; errorMessage: string; warnings: SubtitleWarning[] }
  > {
    if (input.useCuda && !this.hasRequiredCudaRuntimeLibraries()) {
      return {
        ok: false,
        errorMessage: this.missingCudaRuntimeMessage(),
        warnings: []
      };
    }

    const runtime = await this.detectHealthyPython(input.modelId, input.useCuda);
    if (!runtime.ok) {
      return {
        ok: false,
        errorMessage: runtime.message ?? 'The local faster-whisper environment is not ready.',
        warnings: []
      };
    }

    const args = [
      ...runtime.command.prefixArgs,
      this.runnerScriptPath(),
      '--mode',
      'transcribe',
      '--audio-path',
      input.audioPath,
      '--model',
      normalizeFasterWhisperModelId(input.modelId),
      '--language',
      normalizeLanguageForFasterWhisper(input.sourceLanguage),
      '--device',
      input.useCuda ? 'cuda' : 'cpu',
      '--cpu-threads',
      String(input.cpuThreadCount ?? defaultTranscriptionThreads()),
      '--cache-dir',
      this.cacheDir()
    ];
    const response = await this.runPythonJson(runtime.command, args, 30 * 60 * 1000, input.jobId);
    if (!response.ok) {
      return {
        ok: false,
        errorMessage: response.errorMessage,
        warnings: []
      };
    }

    const payload = response.payload as FasterWhisperTranscriptionResponse;
    const warnings: SubtitleWarning[] = [];
    if (input.useCuda && payload.device !== 'cuda') {
      warnings.push({
        code: 'CudaFallback',
        message: 'GPU mode was requested, but this recognition run finished on CPU.',
        stage: 'asr',
        createdAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      payload,
      warnings
    };
  }

  private async detectHealthyPython(
    modelId: string,
    preferCuda: boolean,
    options: { bundledOnly?: boolean } = {}
  ): Promise<DetectedRuntime> {
    const failures: string[] = [];
    const candidates = this.pythonCandidates(options);
    if (candidates.length === 0) {
      return {
        ok: false,
        message: options.bundledOnly
          ? 'The built-in faster-whisper environment is not installed. Download runtime to continue.'
          : 'No available faster-whisper environment was found. Download runtime to let the app install one, or use an existing local environment.'
      };
    }

    for (const candidate of candidates) {
      const args = [
        ...candidate.prefixArgs,
        this.runnerScriptPath(),
        '--mode',
        'health',
        '--model',
        normalizeFasterWhisperModelId(modelId),
        '--device',
        preferCuda ? 'cuda' : 'cpu',
        '--cache-dir',
        this.cacheDir()
      ];
      try {
        const result = await runCommandCapture(candidate.executable, args, {
          env: this.pythonEnv(candidate),
          timeoutMs: 2 * 60 * 1000,
          logger: this.logger,
          logLabel: `${candidate.label} health check`
        });
        if (result.timedOut) {
        failures.push(`${candidate.label} timed out while checking faster-whisper health.`);
        continue;
        }

        const payload = tryParseHealthPayload(result.stdout);
        if (result.code === 0 && payload?.ok) {
          this.resolvedPython = candidate;
          return {
            ok: true,
            command: candidate,
            python_version: payload.python_version,
            faster_whisper_version: payload.faster_whisper_version,
            ctranslate2_version: payload.ctranslate2_version,
            cache_dir: payload.cache_dir,
            cuda_device_count: payload.cuda_device_count
          };
        }

        if (payload?.message) {
          failures.push(payload.message);
          continue;
        }

        const stderr = String(result.stderr || result.stdout || '').trim();
        if (stderr) {
          failures.push(`${candidate.label}: ${stderr}`);
        }
      } catch (error) {
        failures.push(error instanceof Error ? `${candidate.label}: ${error.message}` : `${candidate.label}: ${String(error)}`);
      }
    }

    return {
      ok: false,
      message:
        failures[0] ??
        (preferCuda
          ? 'A local faster-whisper environment was found, but GPU mode could not be confirmed.'
          : 'No available faster-whisper environment was found. Download runtime to let the app install one.')
    };
  }

  private providerHealth(runtime: Extract<DetectedRuntime, { ok: true }>, preferCuda: boolean): ProviderHealth {
    return {
      providerId: FASTER_WHISPER_PROVIDER_ID,
      ok: true,
      status: 'healthy',
      message: this.baseReadyMessage(runtime, preferCuda)
    };
  }

  private baseReadyMessage(runtime: Extract<DetectedRuntime, { ok: true }>, preferCuda: boolean): string {
    const detailParts = [
      runtime.faster_whisper_version ? `faster-whisper ${runtime.faster_whisper_version}` : undefined,
      runtime.ctranslate2_version ? `CTranslate2 ${runtime.ctranslate2_version}` : undefined,
      runtime.python_version ? `Python ${runtime.python_version}` : undefined
    ].filter(Boolean);
    const sourceDetail =
      runtime.command.source === 'managed'
        ? 'Using the built-in local environment.'
        : runtime.command.source === 'environment'
          ? 'Using your existing local environment.'
          : 'Using a system-installed Python environment.';
    const deviceDetail = preferCuda
      ? runtime.cuda_device_count && runtime.cuda_device_count > 0
        ? `CUDA mode is available (${runtime.cuda_device_count} device${runtime.cuda_device_count > 1 ? 's' : ''} reported).`
        : 'CUDA mode is enabled for this Python runtime.'
      : 'CPU mode is ready.';

    return [detailParts.join(' · '), sourceDetail, deviceDetail, runtime.cache_dir ? `Model files: ${runtime.cache_dir}` : undefined]
      .filter(Boolean)
      .join(' ');
  }

  private async ensureManagedRuntimeInstalled(modelId: string, useMultiThreadDownload: boolean): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('Automatic faster-whisper setup is currently available only on Windows.');
    }

    await mkdir(this.runtimeRoot(), { recursive: true });
    await this.ensureBundledPythonInstalled(useMultiThreadDownload);
    await this.enableEmbeddedSitePackages();

    const managedRuntime = await this.detectHealthyPython(modelId, false, { bundledOnly: true });
    if (managedRuntime.ok) {
      this.emitAsset({ type: 'ready', scope: 'runtime', message: 'The local faster-whisper environment is ready.' });
      return;
    }

    await this.ensureBundledPipInstalled(useMultiThreadDownload);
    await this.installManagedPackages();

    const installedRuntime = await this.detectHealthyPython(modelId, false, { bundledOnly: true });
    if (!installedRuntime.ok) {
      this.emitAsset({ type: 'error', scope: 'runtime', message: installedRuntime.message ?? 'The local faster-whisper environment could not be installed.' });
      throw new Error(installedRuntime.message ?? 'The local faster-whisper environment could not be installed.');
    }

    this.emitAsset({ type: 'ready', scope: 'runtime', message: 'The local faster-whisper environment is ready.' });
  }

  private async ensureBundledPythonInstalled(useMultiThreadDownload: boolean): Promise<void> {
    const bundledCommand = this.bundledPythonCommand();
    if (bundledCommand && (await this.canRunPython(bundledCommand))) {
      return;
    }

    const runtimeDir = this.runtimeRoot();
    const downloadDir = join(runtimeDir, 'downloads');
    const archivePath = join(downloadDir, basename(PYTHON_EMBED_URL));
    const stagingDir = join(runtimeDir, 'python.next');
    const installDir = join(runtimeDir, 'python');
    const backupDir = join(runtimeDir, 'python.prev');

    await mkdir(downloadDir, { recursive: true });
    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(stagingDir, { recursive: true });
    await this.removePathWithRetry(backupDir, { recursive: true });

    this.emitAsset({ type: 'download-start', scope: 'runtime', message: 'Downloading the local recognition environment.' });
    await this.downloadRuntimeFile(PYTHON_EMBED_URL, archivePath, useMultiThreadDownload);

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Checking the downloaded local environment.' });
    const verified = await verifySha256(archivePath, PYTHON_EMBED_SHA256);
    if (!verified) {
      await this.removePathWithRetry(archivePath);
      this.emitAsset({ type: 'error', scope: 'runtime', message: 'The downloaded local environment did not pass the integrity check.' });
      throw new Error('The downloaded local environment did not pass the integrity check. Please try again.');
    }

    this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Preparing the local recognition environment.' });
    await mkdir(stagingDir, { recursive: true });
    await extractZip(archivePath, stagingDir, this.logger);
    if (!existsSync(join(stagingDir, 'python.exe'))) {
      throw new Error('The downloaded local environment package is incomplete.');
    }

    if (existsSync(installDir)) {
      await rename(installDir, backupDir);
    }
    await rename(stagingDir, installDir);
    await this.removePathWithRetry(backupDir, { recursive: true });
    await this.removePathWithRetry(archivePath);
  }

  private async enableEmbeddedSitePackages(): Promise<void> {
    const pythonDir = join(this.runtimeRoot(), 'python');
    await mkdir(join(pythonDir, 'Lib', 'site-packages'), { recursive: true });
    const entries = await readdir(pythonDir);
    const pthFile = entries.find((entry) => /^python\d+._pth$/i.test(entry));
    if (!pthFile) {
      throw new Error('Bundled Python runtime did not contain a python._pth file.');
    }

    const pthPath = join(pythonDir, pthFile);
    const current = await readFile(pthPath, 'utf8');
    const nextLines = current.split(/\r?\n/);
    if (!nextLines.some((line) => line.trim().toLowerCase() === 'lib\\site-packages')) {
      const importSiteIndex = nextLines.findIndex((line) => line.replace(/\s/g, '').toLowerCase() === '#importsite');
      const insertIndex = importSiteIndex >= 0 ? importSiteIndex : nextLines.length;
      nextLines.splice(insertIndex, 0, 'Lib\\site-packages');
    }
    const siteLineIndex = nextLines.findIndex((line) => line.replace(/\s/g, '').toLowerCase() === '#importsite');
    if (siteLineIndex >= 0) {
      nextLines[siteLineIndex] = 'import site';
    } else if (!nextLines.some((line) => line.trim().toLowerCase() === 'import site')) {
      nextLines.push('import site');
    }

    const next = `${nextLines.join('\n').replace(/\n+$/, '')}\n`;
    if (next !== current) {
      await writeFile(pthPath, next, 'utf8');
    }
  }

  private async ensureBundledPipInstalled(useMultiThreadDownload: boolean): Promise<void> {
    const bundledCommand = this.requireBundledPythonCommand();
    if (await this.canRunPip(bundledCommand)) {
      return;
    }

    const downloadDir = join(this.runtimeRoot(), 'downloads');
    const scriptPath = join(downloadDir, basename(GET_PIP_URL));
    await mkdir(downloadDir, { recursive: true });
    await this.removePathWithRetry(scriptPath);

    this.emitAsset({ type: 'download-start', scope: 'runtime', message: 'Downloading Python package manager.' });
    await this.downloadRuntimeFile(GET_PIP_URL, scriptPath, useMultiThreadDownload);

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Checking the required installer.' });
    const verified = await verifySha256(scriptPath, GET_PIP_SHA256);
    if (!verified) {
      await this.removePathWithRetry(scriptPath);
      this.emitAsset({ type: 'error', scope: 'runtime', message: 'The downloaded installer did not pass the integrity check.' });
      throw new Error('The downloaded installer did not pass the integrity check. Please try again.');
    }

    const result = await runCommandCapture(
      bundledCommand.executable,
      [...bundledCommand.prefixArgs, scriptPath, '--disable-pip-version-check', '--no-warn-script-location'],
      {
        cwd: join(this.runtimeRoot(), 'python'),
        timeoutMs: 10 * 60 * 1000,
        logger: this.logger,
        logLabel: 'bundled Python pip bootstrap',
        env: {
          ...this.pythonEnv(bundledCommand),
          PIP_DISABLE_PIP_VERSION_CHECK: '1'
        }
      }
    );
    await this.removePathWithRetry(scriptPath);

    if (result.timedOut || result.code !== 0 || !(await this.canRunPip(bundledCommand))) {
      throw new Error(
        String(result.stderr || result.stdout || 'Failed to prepare the local recognition environment.').trim()
      );
    }
  }

  private async installManagedPackages(): Promise<void> {
    const bundledCommand = this.requireBundledPythonCommand();
    const result = await runCommandCapture(
      bundledCommand.executable,
      [
        ...bundledCommand.prefixArgs,
        '-m',
        'pip',
        'install',
        '--upgrade',
        '--no-input',
        '--disable-pip-version-check',
        '--no-warn-script-location',
        '--only-binary=:all:',
        '--prefer-binary',
        ...MANAGED_RUNTIME_PACKAGES
      ],
      {
        cwd: join(this.runtimeRoot(), 'python'),
        timeoutMs: 30 * 60 * 1000,
        logger: this.logger,
        logLabel: 'bundled Python package install',
        env: {
          ...this.pythonEnv(bundledCommand),
          PIP_DISABLE_PIP_VERSION_CHECK: '1',
          PIP_CACHE_DIR: join(this.runtimeRoot(), 'pip-cache')
        }
      }
    );

    if (result.timedOut || result.code !== 0) {
      throw new Error(String(result.stderr || result.stdout || 'Failed to install the required faster-whisper components.').trim());
    }
  }

  private bundledPythonCommand(): PythonCommand | undefined {
    const bundledPython = process.platform === 'win32'
      ? join(this.runtimeRoot(), 'python', 'python.exe')
      : join(this.runtimeRoot(), 'python', 'bin', 'python3');
    return existsSync(bundledPython)
      ? {
          executable: bundledPython,
          prefixArgs: [],
          label: bundledPython,
          source: 'managed'
        }
      : undefined;
  }

  private requireBundledPythonCommand(): PythonCommand {
    const bundledCommand = this.bundledPythonCommand();
    if (!bundledCommand) {
      throw new Error('The built-in faster-whisper environment is not installed.');
    }
    return bundledCommand;
  }

  private pythonCandidates(options: { bundledOnly?: boolean } = {}): PythonCommand[] {
    const bundledPython = this.bundledPythonCommand();
    const envPython = process.env.FASTER_WHISPER_PYTHON?.trim();
    if (options.bundledOnly) {
      return bundledPython ? [bundledPython] : [];
    }

    const candidates = [
      envPython
        ? {
            executable: envPython,
            prefixArgs: [],
            label: envPython,
            source: 'environment' as const
          }
        : undefined,
      bundledPython,
      this.resolvedPython,
      {
        executable: 'python',
        prefixArgs: [],
        label: 'python',
        source: 'system' as const
      },
      {
        executable: 'python3',
        prefixArgs: [],
        label: 'python3',
        source: 'system' as const
      },
      process.platform === 'win32'
        ? {
            executable: 'py',
            prefixArgs: ['-3'],
            label: 'py -3',
            source: 'system' as const
          }
        : undefined
    ].filter((entry): entry is PythonCommand => Boolean(entry));

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.executable} ${candidate.prefixArgs.join(' ')}`.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async canRunPython(command: PythonCommand): Promise<boolean> {
    try {
      const result = await runCommandCapture(command.executable, [...command.prefixArgs, '-V'], {
        timeoutMs: 15_000,
        env: this.pythonEnv(command),
        logger: this.logger,
        logLabel: `${command.label} python version probe`
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async canRunPip(command: PythonCommand): Promise<boolean> {
    try {
      const result = await runCommandCapture(command.executable, [...command.prefixArgs, '-m', 'pip', '--version'], {
        cwd: join(this.runtimeRoot(), 'python'),
        timeoutMs: 20_000,
        logger: this.logger,
        logLabel: `${command.label} pip probe`,
        env: {
          ...this.pythonEnv(command),
          PIP_DISABLE_PIP_VERSION_CHECK: '1'
        }
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private pythonEnv(command: PythonCommand): NodeJS.ProcessEnv {
    const pathEntries = uniqueStrings([...this.cudaRuntimeSearchRoots(), process.env.PATH ?? '']);
    return {
      ...process.env,
      PATH: pathEntries.join(delimiter),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    };
  }

  private hasRequiredCudaRuntimeLibraries(): boolean {
    return this.resolveCudaRuntimeSource().runtimeDetected;
  }

  private missingCudaRuntimeMessage(): string {
    return 'GPU mode was requested, but the required CUDA files were not found. Download the CUDA components and try again.';
  }

  private cudaRuntimeStatus(): FasterWhisperCudaStatus {
    const hardwareDetected = detectNvidiaHardwareSupport();
    const source = this.resolveCudaRuntimeSource();
    const managedRuntimeDir = this.managedCudaRuntimeDir();
    return {
      provider: FASTER_WHISPER_PROVIDER_ID,
      cacheDir: this.runtimeRoot(),
      runtimeDir: managedRuntimeDir,
      source: source.source,
      hardwareDetected,
      runtimeDetected: source.runtimeDetected,
      cudaSupported: hardwareDetected && source.runtimeDetected,
      requiredCudaVersion: FASTER_WHISPER_CUDA_VERSION,
      actionRequired: hardwareDetected && !source.runtimeDetected ? 'download-cuda-runtime' : 'none',
      message: !hardwareDetected
        ? 'No NVIDIA GPU was found for faster-whisper GPU mode.'
        : source.source === 'managed'
          ? 'Required CUDA files are ready in the app folder.'
          : source.source === 'system'
            ? 'Required CUDA files were found in another local installation.'
            : this.missingCudaRuntimeMessage()
    };
  }

  private resolveCudaRuntimeSource(): { source: FasterWhisperCudaStatus['source']; runtimeDetected: boolean } {
    const managedRoot = this.managedCudaRuntimeDir();
    if (hasRuntimeDllSet(managedRoot, FASTER_WHISPER_CUDA_RUNTIME_DLLS)) {
      return { source: 'managed', runtimeDetected: true };
    }

    for (const root of this.cudaRuntimeSearchRoots()) {
      if (root === managedRoot) {
        continue;
      }
      if (hasRuntimeDllSet(root, FASTER_WHISPER_CUDA_RUNTIME_DLLS)) {
        return { source: 'system', runtimeDetected: true };
      }
    }

    return { source: 'missing', runtimeDetected: false };
  }

  private async installManagedCudaRuntime(useMultiThreadDownload: boolean): Promise<void> {
    const packageInfo = await this.fetchCudaLibcublasPackage();
    if (!packageInfo.relative_path || !packageInfo.sha256 || !isPinnedSha256(packageInfo.sha256)) {
      throw new Error('The CUDA download information is incomplete right now.');
    }

    const downloadDir = join(this.runtimeRoot(), 'downloads');
    const archivePath = join(downloadDir, basename(packageInfo.relative_path));
    const extractDir = join(this.runtimeRoot(), 'cuda-redist', 'libcublas');
    const runtimeDir = this.managedCudaRuntimeDir();
    await mkdir(downloadDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });

    this.emitAsset({ type: 'download-start', scope: 'runtime', message: 'Downloading GPU components for faster-whisper.' });
    await this.downloadRuntimeFile(`${NVIDIA_CUDA_REDIST_BASE_URL}${packageInfo.relative_path}`, archivePath, useMultiThreadDownload);

    this.emitAsset({ type: 'verify', scope: 'runtime', message: 'Checking downloaded GPU components.' });
    const verified = await verifySha256(archivePath, packageInfo.sha256);
    if (!verified) {
      await this.removePathWithRetry(archivePath);
      this.emitAsset({ type: 'error', scope: 'runtime', message: 'The downloaded GPU files did not pass the integrity check.' });
      throw new Error('The downloaded GPU files did not pass the integrity check. Please try again.');
    }

    this.emitAsset({ type: 'extract', scope: 'runtime', message: 'Preparing GPU components for faster-whisper.' });
    await mkdir(extractDir, { recursive: true });
    await extractZip(archivePath, extractDir, this.logger);
    const dllPaths = await findFilesByName(extractDir, FASTER_WHISPER_CUDA_RUNTIME_DLLS);
    for (const dllName of FASTER_WHISPER_CUDA_RUNTIME_DLLS) {
      const sourcePath = dllPaths.get(dllName.toLowerCase());
      if (!sourcePath) {
        throw new Error('The downloaded GPU package is incomplete.');
      }
      await copyFile(sourcePath, join(runtimeDir, dllName));
    }

    await this.removePathWithRetry(archivePath);
    await this.removePathWithRetry(extractDir, { recursive: true });
    this.emitAsset({ type: 'ready', scope: 'runtime', message: 'GPU components for faster-whisper are ready.' });
  }

  private cudaRuntimeSearchRoots(): string[] {
    const executableDir = dirname(process.execPath);
    const pathEntries = String(process.env.PATH ?? '')
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return uniqueStrings([
      this.managedCudaRuntimeDir(),
      ...legacyWhisperCudaRuntimeDirs(),
      ...pathEntries
    ]);
  }

  private managedCudaRuntimeDir(): string {
    return sharedCudaRuntimeDir(FASTER_WHISPER_CUDA_VERSION);
  }

  private async fetchCudaLibcublasPackage(): Promise<NonNullable<CudaRedistribManifest['libcublas']>[string]> {
    const response = await fetch(NVIDIA_CUDA_REDIST_MANIFEST_URL);
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

  private async runPythonJson(
    command: PythonCommand,
    args: string[],
    timeoutMs: number,
    jobId?: string
  ): Promise<{ ok: true; payload: unknown } | { ok: false; errorMessage: string }> {
    try {
      const result = await runCommandCapture(command.executable, args, {
        env: this.pythonEnv(command),
        timeoutMs,
        logger: this.logger,
        logLabel: `faster-whisper runner (${args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'unknown'})`,
        onSpawn: (child) => {
          if (!jobId) return;
          if (this.cancelledJobs.has(jobId)) {
            try {
              child.kill();
            } catch {
              // Best effort.
            }
            return;
          }
          this.activeTranscriptions.set(jobId, child);
        },
        onClose: () => {
          if (!jobId) return;
          this.activeTranscriptions.delete(jobId);
        }
      });
      if (result.timedOut) {
        return {
          ok: false,
          errorMessage: `faster-whisper Python runner timed out after ${Math.round(timeoutMs / 1000)} seconds.`
        };
      }
      if (result.code !== 0) {
        return {
          ok: false,
          errorMessage: String(result.stderr || result.stdout || 'faster-whisper runner failed.').trim()
        };
      }
      try {
        return {
          ok: true,
          payload: JSON.parse(result.stdout.trim())
        };
      } catch {
        return {
          ok: false,
          errorMessage: 'faster-whisper runner returned invalid JSON.'
        };
      }
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (jobId) {
        this.activeTranscriptions.delete(jobId);
      }
    }
  }

  private async downloadRuntimeFile(url: string, destination: string, useMultiThreadDownload = false): Promise<void> {
    if (url.startsWith('file://')) {
      await copyFile(url.slice('file://'.length), destination);
      return;
    }

    try {
      if (useMultiThreadDownload) {
        try {
          const downloaded = await this.downloadHttpSegmented(url, destination);
          if (downloaded) return;
        } catch {
          await this.removePathWithRetry(destination);
        }
      }

      await this.downloadHttpSingle(url, destination);
      return;
    } catch (error) {
      await this.removePathWithRetry(destination);
      if (process.platform === 'win32') {
        await this.downloadWithCurl(url, destination);
        return;
      }
      throw error;
    }
  }

  private async downloadHttpSingle(url: string, destination: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      this.emitAsset({ type: 'error', scope: 'runtime', message: `Runtime download failed with HTTP ${response.status}.` });
      throw new Error(`Failed to download faster-whisper runtime asset: HTTP ${response.status}`);
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
              scope: 'runtime',
              message: 'Downloading faster-whisper runtime...',
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
          scope: 'runtime',
          message: 'Downloading faster-whisper runtime...',
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
            throw new Error(`Segmented runtime download range failed with HTTP ${response.status}.`);
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

  private async segmentedDownloadPlan(
    url: string
  ): Promise<{ totalBytes: number; ranges: Array<{ start: number; end: number }> } | undefined> {
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

  private async downloadWithCurl(url: string, destination: string): Promise<void> {
    const result = await runCommandCapture('curl.exe', ['-L', '--fail', '--output', destination, url], {
      timeoutMs: 30 * 60 * 1000,
      logger: this.logger,
      logLabel: 'runtime download via curl'
    });
    if (result.timedOut || result.code !== 0) {
      await this.removePathWithRetry(destination);
      throw new Error(String(result.stderr || result.stdout || `Failed to download ${url} with curl.`).trim());
    }
  }

  private cacheDir(): string {
    return join(this.runtimeRoot(), 'models');
  }

  private runtimeRoot(): string {
    if (app.isPackaged) {
      return join(dirname(process.execPath), 'runtime', 'faster_whisper');
    }
    return join(resolve('.'), '.runtime', 'faster_whisper');
  }

  private runnerScriptPath(): string {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      process.env.FASTER_WHISPER_RUNNER?.trim(),
      resourcesPath ? join(resourcesPath, 'faster-whisper-runner.py') : undefined,
      resolve('resources', 'faster-whisper-runner.py')
    ].filter((entry): entry is string => Boolean(entry));

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error('The faster-whisper files are incomplete. Please reinstall the app or download runtime again.');
  }

  private emitAsset(event: AssetEvent): void {
    if (event.type === 'error') {
      this.logger?.error('asset.event', event.message, event);
    } else if (event.type === 'verify' || event.type === 'extract' || event.type === 'ready' || event.type === 'download-start') {
      this.logger?.info('asset.event', event.message, event);
    } else {
      this.logger?.debug('asset.event', event.message, event);
    }
    this.emit('asset-event', event);
  }
}

function normalizeFasterWhisperModelId(modelId: string): string {
  switch (modelId) {
    case 'ggml-tiny':
      return 'tiny';
    case 'ggml-base':
      return 'base';
    case 'ggml-small':
      return 'small';
    case 'ggml-medium':
      return 'medium';
    case 'ggml-large-v3-turbo':
      return 'turbo';
    default:
      return modelId;
  }
}

function normalizeLanguageForFasterWhisper(languageCode: string): string {
  const lower = languageCode.trim().toLowerCase();
  if (!lower || lower === 'auto') return 'auto';
  return lower.split('-')[0];
}

function defaultTranscriptionThreads(): number {
  const parallelism = detectParallelism();
  return Math.max(1, Math.min(16, Math.ceil(parallelism / 2)));
}

function shouldFallbackToCpu(message?: string): boolean {
  const normalized = message?.toLowerCase() ?? '';
  return (
    normalized.includes('cuda') ||
    normalized.includes('cublas') ||
    normalized.includes('cudnn') ||
    normalized.includes('ctranslate2') ||
    normalized.includes('gpu')
  );
}

function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}

function hasRuntimeDllSet(root: string, dllNames: readonly string[]): boolean {
  return dllNames.every((dllName) => existsSync(join(root, dllName)));
}

async function findFilesByName(root: string, fileNames: readonly string[]): Promise<Map<string, string>> {
  const matches = new Map<string, string>();
  if (!existsSync(root)) {
    return matches;
  }

  const pending = new Set(fileNames.map((entry) => entry.toLowerCase()));
  const stack: string[] = [root];
  while (stack.length > 0 && pending.size > 0) {
    const current = stack.pop()!;
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = await readdir(current, { encoding: 'utf8', withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      const normalizedName = entry.name.toLowerCase();
      if (pending.has(normalizedName)) {
        matches.set(normalizedName, nextPath);
        pending.delete(normalizedName);
      }
    }
  }

  return matches;
}

function detectNvidiaHardwareSupport(): boolean {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return false;
  }
  if (process.env.CUDA_PATH || process.env.CUDA_HOME) {
    return true;
  }

  const executable = process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi';
  const probe = spawnSync(executable, ['-L'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  return probe.status === 0;
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

async function extractZip(archivePath: string, destinationDir: string, logger?: ScopedLogger): Promise<void> {
  const result = await runCommandCapture(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`
    ],
    {
      timeoutMs: 10 * 60 * 1000,
      logger,
      logLabel: 'faster-whisper runtime archive extraction'
    }
  );
  if (result.timedOut || result.code !== 0) {
    throw new Error(`Failed to extract faster-whisper runtime archive: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

function tryParseHealthPayload(stdout: string): FasterWhisperHealthResponse | undefined {
  try {
    return JSON.parse(stdout.trim()) as FasterWhisperHealthResponse;
  } catch {
    return undefined;
  }
}

async function runCommandCapture(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    logger?: ScopedLogger;
    logLabel?: string;
    onSpawn?: (child: ChildProcess) => void;
    onClose?: (child: ChildProcess) => void;
  } = {}
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolveResult, reject) => {
    options.logger?.debug('command.start', 'Starting external command.', {
      label: options.logLabel,
      executable,
      args,
      cwd: options.cwd
    });
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    options.onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const settle = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
          options.logger?.error('command.timeout', 'External command timed out.', {
            label: options.logLabel,
            executable,
            timeoutMs: options.timeoutMs
          });
        }, options.timeoutMs)
      : undefined;

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      options.logger?.error('command.error', 'Failed to start external command.', {
        label: options.logLabel,
        executable,
        error
      });
      if (timeout) clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      options.onClose?.(child);
      if (stdout.trim()) {
        options.logger?.info('command.stdout', 'External command output.', {
          label: options.logLabel,
          executable,
          stdout: stdout.trim()
        });
      }
      if (stderr.trim()) {
        options.logger?.info('command.stderr', 'External command error output.', {
          label: options.logLabel,
          executable,
          stderr: stderr.trim()
        });
      }
      options.logger?.debug('command.close', 'External command finished.', {
        label: options.logLabel,
        executable,
        code,
        timedOut
      });
      settle({ code, stdout, stderr, timedOut });
    });
  });
}

function defaultConcurrentDownloadParts(): number {
  const parallelism = detectParallelism();
  return Math.max(1, Math.min(16, Math.ceil(parallelism / 2)));
}

function detectParallelism(): number {
  try {
    return typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  } catch {
    return cpus().length || 4;
  }
}

function isTransientFsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && TRANSIENT_FS_ERROR_CODES.has(String(error.code));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cancellationError(): Error {
  const error = new Error('faster-whisper transcription was cancelled.');
  error.name = 'AbortError';
  return error;
}
