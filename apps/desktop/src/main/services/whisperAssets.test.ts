import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => false));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: mockSpawnSync
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync
  };
});

import { WhisperAssetManager } from './whisperAssets';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => 'D:/tmp/translate-ter')
  }
}));

const VALID_SHA_CPU = '1'.repeat(64);
const VALID_SHA_CUDA = '2'.repeat(64);
const VALID_SHA_MODEL = '3'.repeat(64);

const manifestV1 = {
  manifestVersion: 1,
  enabled: true,
  runtime: {
    provider: 'whisper.cpp',
    version: 'v1.8.3',
    platforms: {
      'win32-x64': {
        binary: 'cpu/Release/whisper-cli.exe',
        sha256: VALID_SHA_CPU,
        url: 'https://example.test/cpu.zip',
        acceleration: 'cpu'
      },
      'win32-x64-cuda': {
        binary: 'cuda/Release/whisper-cli.exe',
        sha256: VALID_SHA_CUDA,
        url: 'https://example.test/cuda.zip',
        acceleration: 'cuda',
        cudaVersion: '11.8'
      }
    }
  },
  models: [
    {
      id: 'ggml-base',
      displayName: 'Whisper base',
      languageScope: 'multilingual',
      sizeBytes: 1,
      sha256: VALID_SHA_MODEL,
      path: 'models/ggml-base.bin',
      url: 'https://example.test/model.bin'
    }
  ]
} as const;

const manifestDarwinV1 = {
  manifestVersion: 1,
  enabled: true,
  runtime: {
    provider: 'whisper.cpp',
    version: 'v1.8.3',
    platforms: {
      'darwin-arm64': {
        binary: 'cpu/bin/whisper-cli',
        sha256: VALID_SHA_CPU,
        url: 'https://example.test/cpu.tar.gz',
        acceleration: 'cpu'
      },
      'darwin-arm64-metal': {
        binary: 'metal/bin/whisper-cli',
        sha256: '',
        url: null,
        acceleration: 'metal'
      }
    }
  },
  models: [
    {
      id: 'ggml-base',
      displayName: 'Whisper base',
      languageScope: 'multilingual',
      sizeBytes: 1,
      sha256: VALID_SHA_MODEL,
      path: 'models/ggml-base.bin',
      url: 'https://example.test/model.bin'
    }
  ]
} as const;

type BinaryState = {
  installPath: string;
  existingPath?: string;
  verifiedPath?: string;
  systemPath?: string;
  resolvedPath: string;
  installed: boolean;
  verified: boolean;
  source: 'managed' | 'system' | 'missing';
  verification: 'managed-sha256' | 'system-probe' | 'none';
};

type CandidateRuntime =
  | (typeof manifestV1.runtime.platforms)[keyof typeof manifestV1.runtime.platforms]
  | (typeof manifestDarwinV1.runtime.platforms)[keyof typeof manifestDarwinV1.runtime.platforms];

type CandidateState = Record<
  string,
  {
    runtime: CandidateRuntime;
    variant: 'cpu' | 'cuda' | 'metal';
    platformKey: string;
    binaryState: BinaryState;
  }
>;

function createBinaryState(kind: 'cpu' | 'cuda' | 'metal', overrides: Partial<BinaryState> = {}): BinaryState {
  const root =
    kind === 'metal'
      ? '/usr/local/bin/whisper-cli'
      : `D:/runtime/whisper_cpp/${kind}/Release/whisper-cli.exe`;
  return {
    installPath: root,
    existingPath: root,
    verifiedPath: root,
    resolvedPath: root,
    installed: true,
    verified: true,
    source: 'managed',
    verification: 'managed-sha256',
    ...overrides
  };
}

function createCandidateStates(overrides?: {
  cpu?: Partial<BinaryState>;
  cuda?: Partial<BinaryState>;
}): CandidateState {
  return {
    'win32-x64': {
      runtime: manifestV1.runtime.platforms['win32-x64'],
      variant: 'cpu',
      platformKey: 'win32-x64',
      binaryState: createBinaryState('cpu', overrides?.cpu)
    },
    'win32-x64-cuda': {
      runtime: manifestV1.runtime.platforms['win32-x64-cuda'],
      variant: 'cuda',
      platformKey: 'win32-x64-cuda',
      binaryState: createBinaryState('cuda', overrides?.cuda)
    }
  };
}

function createDarwinCandidateStates(overrides?: {
  cpu?: Partial<BinaryState>;
  metal?: Partial<BinaryState>;
}): CandidateState {
  return {
    'darwin-arm64': {
      runtime: manifestDarwinV1.runtime.platforms['darwin-arm64'],
      variant: 'cpu',
      platformKey: 'darwin-arm64',
      binaryState: createBinaryState('cpu', {
        installPath: '/Applications/Translate-Ter.app/runtime/whisper_cpp/cpu/bin/whisper-cli',
        existingPath: '/Applications/Translate-Ter.app/runtime/whisper_cpp/cpu/bin/whisper-cli',
        verifiedPath: '/Applications/Translate-Ter.app/runtime/whisper_cpp/cpu/bin/whisper-cli',
        resolvedPath: '/Applications/Translate-Ter.app/runtime/whisper_cpp/cpu/bin/whisper-cli',
        ...overrides?.cpu
      })
    },
    'darwin-arm64-metal': {
      runtime: manifestDarwinV1.runtime.platforms['darwin-arm64-metal'],
      variant: 'metal',
      platformKey: 'darwin-arm64-metal',
      binaryState: createBinaryState('metal', {
        installPath: '/Applications/Translate-Ter.app/runtime/whisper_cpp/metal/bin/whisper-cli',
        existingPath: undefined,
        verifiedPath: undefined,
        resolvedPath: '/usr/local/bin/whisper-cli',
        installed: true,
        verified: true,
        source: 'system',
        systemPath: '/usr/local/bin/whisper-cli',
        verification: 'system-probe',
        ...overrides?.metal
      })
    }
  };
}

function createSpawnSyncMock(options?: {
  hardwareDetected?: boolean;
  gpuName?: string;
  computeCapability?: string;
  architecture?: string;
}) {
  const hardwareDetected = options?.hardwareDetected ?? false;
  const gpuName = options?.gpuName ?? 'NVIDIA GeForce RTX 4090';
  const computeCapability = options?.computeCapability ?? '12.0';
  const architecture = options?.architecture ?? 'Ada Lovelace';

  mockSpawnSync.mockImplementation((command: string, args?: readonly string[]) => {
    const normalizedArgs = args ?? [];
    if (command === 'nvidia-smi' && normalizedArgs[0] === '-L') {
      return {
        pid: 1,
        output: [],
        stdout: hardwareDetected ? 'GPU 0: NVIDIA' : '',
        stderr: '',
        status: hardwareDetected ? 0 : 1,
        signal: null
      };
    }

    if (command === 'nvidia-smi' && normalizedArgs.includes('--query-gpu=name,compute_cap')) {
      return {
        pid: 1,
        output: [],
        stdout: hardwareDetected ? `${gpuName}, ${computeCapability}\n` : '',
        stderr: '',
        status: hardwareDetected ? 0 : 1,
        signal: null
      };
    }

    if (command === 'powershell.exe') {
      const joined = normalizedArgs.join(' ');
      if (joined.includes('Win32_VideoController')) {
        return {
          pid: 1,
          output: [],
          stdout: hardwareDetected ? '1' : '0',
          stderr: '',
          status: 0,
          signal: null
        };
      }
      if (joined.includes('Product Architecture')) {
        return {
          pid: 1,
          output: [],
          stdout: hardwareDetected ? `Product Architecture                    : ${architecture}` : '',
          stderr: '',
          status: hardwareDetected ? 0 : 1,
          signal: null
        };
      }
    }

    return {
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null
    };
  });
}

function createExistsSyncMock(options?: { cudaRuntimePresent?: boolean }) {
  const cudaRuntimePresent = options?.cudaRuntimePresent ?? false;
  mockExistsSync.mockImplementation((...args: unknown[]) => {
    const [target] = args;
    if (typeof target !== 'string') {
      return false;
    }

    if (
      target.endsWith('cublas64_11.dll') ||
      target.endsWith('cublasLt64_11.dll') ||
      target.endsWith('cublas64_12.dll') ||
      target.endsWith('cublasLt64_12.dll')
    ) {
      return cudaRuntimePresent;
    }

    return false;
  });
}

function createManager(options?: {
  candidateStates?: CandidateState;
  modelExists?: boolean;
  modelVerified?: boolean;
  runtimeCudaVersion?: '11.8' | '12.8';
  manifest?: typeof manifestV1 | typeof manifestDarwinV1;
  cacheDir?: string;
  modelPath?: string;
}) {
  const manager = new WhisperAssetManager() as any;
  const manifest = options?.manifest ?? manifestV1;
  const cacheDir = options?.cacheDir ?? 'D:/runtime/whisper_cpp';
  const modelPath = options?.modelPath ?? `${cacheDir}/models/ggml-base.bin`;
  manager.manifest = vi.fn().mockResolvedValue(manifest);
  manager.migrateLegacyCacheIfNeeded = vi.fn().mockResolvedValue(undefined);
  manager.cacheDir = vi.fn().mockReturnValue(cacheDir);
  manager.findExistingModelPath = vi.fn().mockResolvedValue(modelPath);
  manager.exists = vi
    .fn()
    .mockImplementation(async (target: string) => (target.includes('ggml-base.bin') ? (options?.modelExists ?? true) : false));
  manager.verifySha256 = vi.fn().mockResolvedValue(options?.modelVerified ?? true);
  manager.verifyIfPresent = vi.fn().mockResolvedValue(options?.modelVerified ?? true);
  manager.runtimeCudaVersion = vi.fn().mockReturnValue(options?.runtimeCudaVersion ?? '11.8');
  manager.cudaRuntimeSearchRoots = vi.fn().mockReturnValue(['D:/cuda/bin']);
  manager.ensureWindowsCudaRuntimeDependencies = vi.fn().mockResolvedValue(undefined);
  manager.downloadAndInstall = vi.fn().mockResolvedValue(undefined);
  const candidateStates =
    options?.candidateStates ?? (manifest === manifestDarwinV1 ? createDarwinCandidateStates() : createCandidateStates());
  manager.collectRuntimeCandidateStates = vi.fn().mockResolvedValue(candidateStates);
  manager.probeRuntimeBinaryState = vi.fn().mockImplementation(async (_runtime: { acceleration: string }, variant: 'cpu' | 'cuda' | 'metal') => {
    if (variant === 'cuda') {
      return createBinaryState('cuda', candidateStates['win32-x64-cuda']?.binaryState);
    }
    if (variant === 'metal') {
      return createBinaryState('metal', candidateStates['darwin-arm64-metal']?.binaryState);
    }
    return createBinaryState('cpu', candidateStates['win32-x64']?.binaryState ?? candidateStates['darwin-arm64']?.binaryState);
  });
  return manager as WhisperAssetManager & Record<string, any>;
}

describe('WhisperAssetManager.ensureRuntime', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSpawnSync.mockReset();
    mockExistsSync.mockReset();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    delete process.env.CUDA_PATH;
    delete process.env.CUDA_HOME;
  });

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalArch) {
      Object.defineProperty(process, 'arch', originalArch);
    }
  });

  it('keeps cpu for legacy preferCuda=false', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('cpu');
    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.actionRequired).toBe('none');
  });

  it('keeps cuda for legacy preferCuda=true when cuda is ready', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('gpu');
    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.acceleration.cudaSupported).toBe(true);
    expect(status.actionRequired).toBe('none');
  });

  it('uses new auto settings and still reports selected gpu when resolver chooses cuda', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('auto');
    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.actionRequired).toBe('none');
  });

  it('uses explicit gpu/cuda settings in ensureRuntime', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('gpu');
    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.actionRequired).toBe('none');
  });

  it('uses explicit cpu settings in ensureRuntime even if legacy preferCuda is true', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      localAsrAcceleration: 'cpu',
      preferredRuntimeVariant: 'cpu',
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('cpu');
    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.actionRequired).toBe('none');
  });

  it('returns unsupported-platform when current platform has no candidate', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    (manager as any).collectRuntimeCandidateStates = vi.fn().mockResolvedValue({});

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      downloadScope: 'none'
    });

    expect(status.actionRequired).toBe('unsupported-platform');
    expect(status.platformKey).toBe('linux-arm64');
  });

  it('falls back to cpu when cuda runtime is missing', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.acceleration.cudaSupported).toBe(false);
    expect(status.acceleration.fallbackReason).toBe('gpu-runtime-missing');
    expect(status.actionRequired).toBe('none');
  });

  it('falls back to cpu for auto mode when gpu is unavailable', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      downloadScope: 'none'
    });

    expect(status.acceleration.requested).toBe('auto');
    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.acceleration.fallbackReason).toBe('gpu-not-detected');
    expect(status.actionRequired).toBe('none');
  });

  it('prepares windows cuda dependencies for auto mode before selecting runtime', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();

    await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: true,
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      downloadScope: 'runtime'
    });

    expect((manager as any).ensureWindowsCudaRuntimeDependencies).toHaveBeenCalledTimes(1);
    const dependencyCandidates = (manager as any).ensureWindowsCudaRuntimeDependencies.mock.calls[0][0] as Array<{ platformKey: string; variant: string }>;
    expect(dependencyCandidates.some((candidate) =>
      candidate.platformKey === 'win32-x64-cuda' && candidate.variant === 'cuda'
    )).toBe(true);
  });

  it('falls back to cpu on cuda mismatch when ignore is false', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '12.0' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      ignoreCudaMismatch: false,
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.acceleration.versionMismatch).toBe(true);
    expect(status.acceleration.cudaSupported).toBe(false);
  });

  it('keeps cuda on cuda mismatch when ignore is true', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '12.0' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({ runtimeCudaVersion: '11.8' });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      ignoreCudaMismatch: true,
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.acceleration.versionMismatch).toBe(true);
    expect(status.acceleration.cudaSupported).toBe(true);
  });

  it('returns download-runtime when selected runtime binary is missing', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const candidateStates = createCandidateStates({
      cuda: {
        existingPath: undefined,
        verifiedPath: undefined,
        resolvedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
        installed: false,
        verified: false
      }
    });
    const manager = createManager({ candidateStates });
    (manager as any).probeRuntimeBinaryState = vi.fn().mockResolvedValue({
      installPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      existingPath: undefined,
      verifiedPath: undefined,
      resolvedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      installed: false,
      verified: false
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.actionRequired).toBe('download-runtime');
  });

  it('returns download-model when runtime is ready but model is missing', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager({
      runtimeCudaVersion: '11.8',
      modelExists: false,
      modelVerified: false
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.model.installed).toBe(false);
    expect(status.model.verified).toBe(false);
    expect(status.actionRequired).toBe('download-model');
  });

  it('prefers runtime download before model download when both are missing and downloads are allowed', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const candidateStates = createCandidateStates({
      cuda: {
        existingPath: undefined,
        verifiedPath: undefined,
        resolvedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
        installed: false,
        verified: false
      }
    });
    const manager = createManager({
      candidateStates,
      modelExists: false,
      modelVerified: false
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: true,
      preferCuda: true,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      downloadScope: 'all'
    });

    expect((manager as any).downloadAndInstall).toHaveBeenCalledTimes(2);
    expect((manager as any).downloadAndInstall).toHaveBeenNthCalledWith(
      1,
      'runtime',
      'https://example.test/cuda.zip',
      'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      VALID_SHA_CUDA,
      false
    );
    expect((manager as any).downloadAndInstall).toHaveBeenNthCalledWith(
      2,
      'model',
      'https://example.test/model.bin',
      expect.stringMatching(/runtime[\\/]+whisper_cpp[\\/]+models[\\/]+ggml-base\.bin$/),
      VALID_SHA_MODEL,
      false
    );
    expect(status.actionRequired).toBe('download-runtime');
  });

  it('returns actionRequired=none after successful runtime download and verification', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const initialCandidateStates = createCandidateStates({
      cuda: {
        existingPath: undefined,
        verifiedPath: undefined,
        resolvedPath: 'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
        installed: false,
        verified: false
      }
    });
    const manager = createManager({
      candidateStates: initialCandidateStates,
      modelExists: true,
      modelVerified: true
    });
    (manager as any).probeRuntimeBinaryState = vi
      .fn()
      .mockResolvedValueOnce(createBinaryState('cuda'));

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: true,
      preferCuda: true,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      downloadScope: 'runtime'
    });

    expect((manager as any).downloadAndInstall).toHaveBeenCalledTimes(1);
    expect((manager as any).downloadAndInstall).toHaveBeenCalledWith(
      'runtime',
      'https://example.test/cuda.zip',
      'D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe',
      VALID_SHA_CUDA,
      false
    );
    expect(status.binary.installed).toBe(true);
    expect(status.binary.verified).toBe(true);
    expect(status.model.installed).toBe(true);
    expect(status.model.verified).toBe(true);
    expect(status.actionRequired).toBe('none');
  });

  it('returns download-runtime when gpu fallback has no cpu candidate', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();
    (manager as any).manifest = vi.fn().mockResolvedValue({
      ...manifestV1,
      runtime: {
        ...manifestV1.runtime,
        platforms: {
          'win32-x64-cuda': manifestV1.runtime.platforms['win32-x64-cuda']
        }
      }
    });
    (manager as any).collectRuntimeCandidateStates = vi.fn().mockResolvedValue({
      'win32-x64-cuda': {
        runtime: manifestV1.runtime.platforms['win32-x64-cuda'],
        variant: 'cuda',
        platformKey: 'win32-x64-cuda',
        binaryState: createBinaryState('cuda')
      }
    } satisfies CandidateState);

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'cuda',
      downloadScope: 'none'
    });

    expect(status.platformKey).toBe('win32-x64-cuda');
    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.actionRequired).toBe('download-runtime');
  });

  it('keeps manifest v1 suffix-derived cuda variant even if legacy acceleration field is cpu', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: true });
    const manager = createManager();
    (manager as any).manifest = vi.fn().mockResolvedValue({
      ...manifestV1,
      runtime: {
        ...manifestV1.runtime,
        platforms: {
          ...manifestV1.runtime.platforms,
          'win32-x64-cuda': {
            ...manifestV1.runtime.platforms['win32-x64-cuda'],
            acceleration: 'cpu'
          }
        }
      }
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: true,
      downloadScope: 'none'
    });

    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('cuda');
    expect(status.actionRequired).toBe('none');
  });

  it('uses suffix-derived cuda variant for cuda search roots and dependency download when v1 acceleration is wrong', async () => {
    createSpawnSyncMock({ hardwareDetected: true, computeCapability: '8.9' });
    createExistsSyncMock({ cudaRuntimePresent: false });
    const manager = createManager();
    const cudaSearchRootsSpy = vi.spyOn(manager as any, 'cudaRuntimeSearchRoots');
    (manager as any).manifest = vi.fn().mockResolvedValue({
      ...manifestV1,
      runtime: {
        ...manifestV1.runtime,
        platforms: {
          ...manifestV1.runtime.platforms,
          'win32-x64-cuda': {
            ...manifestV1.runtime.platforms['win32-x64-cuda'],
            acceleration: 'cpu'
          }
        }
      }
    });

    await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: true,
      preferCuda: true,
      downloadScope: 'runtime'
    });

    const normalizedCandidates = (cudaSearchRootsSpy.mock.calls[0]?.[0] ?? []) as Array<{ platformKey: string; variant: string }>;
    expect(normalizedCandidates.some((candidate: { platformKey: string; variant: string }) =>
      candidate.platformKey === 'win32-x64-cuda' && candidate.variant === 'cuda'
    )).toBe(true);
    expect((manager as any).ensureWindowsCudaRuntimeDependencies).toHaveBeenCalledTimes(1);
    const dependencyCandidates = (manager as any).ensureWindowsCudaRuntimeDependencies.mock.calls[0][0] as Array<{ platformKey: string; variant: string }>;
    expect(dependencyCandidates.some((candidate: { platformKey: string; variant: string }) =>
      candidate.platformKey === 'win32-x64-cuda' && candidate.variant === 'cuda'
    )).toBe(true);
  });

  it('selects darwin metal for auto mode when system whisper-cli probe succeeds', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const manager = createManager({
      manifest: manifestDarwinV1,
      candidateStates: createDarwinCandidateStates(),
      cacheDir: '/tmp/translate-ter/.runtime/whisper_cpp',
      modelPath: '/tmp/translate-ter/.runtime/whisper_cpp/models/ggml-base.bin'
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      downloadScope: 'none'
    });

    expect(status.platformKey).toBe('darwin-arm64-metal');
    expect(status.binary.expectedPath).toBe('/usr/local/bin/whisper-cli');
    expect(status.binary.installed).toBe(true);
    expect(status.binary.verified).toBe(true);
    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('metal');
    expect(status.acceleration.hardwareDetected).toBe(true);
    expect(status.acceleration.runtimeDetected).toBe(true);
    expect(status.actionRequired).toBe('none');
  });

  it('selects darwin metal for explicit gpu+metal when system whisper-cli probe succeeds', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const manager = createManager({
      manifest: manifestDarwinV1,
      candidateStates: createDarwinCandidateStates(),
      cacheDir: '/tmp/translate-ter/.runtime/whisper_cpp',
      modelPath: '/tmp/translate-ter/.runtime/whisper_cpp/models/ggml-base.bin'
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'metal',
      downloadScope: 'none'
    });

    expect(status.platformKey).toBe('darwin-arm64-metal');
    expect(status.acceleration.selected).toBe('gpu');
    expect(status.acceleration.runtimeVariant).toBe('metal');
    expect(status.actionRequired).toBe('none');
  });

  it('falls back to cpu for darwin auto when system whisper-cli is missing', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const manager = createManager({
      manifest: manifestDarwinV1,
      candidateStates: createDarwinCandidateStates({
        metal: {
          systemPath: undefined,
          resolvedPath: '/tmp/translate-ter/.runtime/whisper_cpp/metal/bin/whisper-cli',
          installed: false,
          verified: false,
          source: 'missing',
          verification: 'none'
        }
      }),
      cacheDir: '/tmp/translate-ter/.runtime/whisper_cpp',
      modelPath: '/tmp/translate-ter/.runtime/whisper_cpp/models/ggml-base.bin'
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'auto',
      preferredRuntimeVariant: undefined,
      downloadScope: 'none'
    });

    expect(status.platformKey).toBe('darwin-arm64');
    expect(status.acceleration.selected).toBe('cpu');
    expect(status.acceleration.runtimeVariant).toBe('cpu');
    expect(status.acceleration.hardwareDetected).toBe(true);
    expect(status.acceleration.runtimeDetected).toBe(false);
    expect(status.acceleration.fallbackReason).toBe('gpu-runtime-missing');
    expect(status.actionRequired).toBe('none');
  });

  it('does not require runtime sha256 for darwin metal system runtime after probe succeeds', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const manager = createManager({
      manifest: manifestDarwinV1,
      candidateStates: createDarwinCandidateStates(),
      cacheDir: '/tmp/translate-ter/.runtime/whisper_cpp',
      modelPath: '/tmp/translate-ter/.runtime/whisper_cpp/models/ggml-base.bin'
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'metal',
      downloadScope: 'none'
    });

    expect(status.binary.verified).toBe(true);
    expect(status.actionRequired).toBe('none');
    expect((manager as any).downloadAndInstall).not.toHaveBeenCalled();
  });

  it('returns download-model when darwin metal system runtime is ready but model is missing', async () => {
    createSpawnSyncMock({ hardwareDetected: false });
    createExistsSyncMock({ cudaRuntimePresent: false });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    const manager = createManager({
      manifest: manifestDarwinV1,
      candidateStates: createDarwinCandidateStates(),
      modelExists: false,
      modelVerified: false,
      cacheDir: '/tmp/translate-ter/.runtime/whisper_cpp',
      modelPath: '/tmp/translate-ter/.runtime/whisper_cpp/models/ggml-base.bin'
    });

    const status = await manager.ensureRuntime({
      modelId: 'ggml-base',
      allowDownload: false,
      preferCuda: false,
      localAsrAcceleration: 'gpu',
      preferredRuntimeVariant: 'metal',
      downloadScope: 'none'
    });

    expect(status.binary.verified).toBe(true);
    expect(status.model.installed).toBe(false);
    expect(status.model.verified).toBe(false);
    expect(status.actionRequired).toBe('download-model');
  });
});
