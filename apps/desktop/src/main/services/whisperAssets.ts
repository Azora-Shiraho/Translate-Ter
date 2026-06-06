import { app } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { WhisperModelInfo, WhisperRuntimeRequest, WhisperRuntimeStatus } from '@shared/models';

type WhisperManifest = {
  manifestVersion: number;
  enabled?: boolean;
  note?: string;
  runtime: {
    provider: 'whisper.cpp';
    version: string;
    platforms: Record<string, { binary: string; sha256: string; url: string | null }>;
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

export class WhisperAssetManager {
  private manifestCache?: WhisperManifest;

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
    const platformKey = this.platformKey();
    const runtime = manifest.runtime.platforms[platformKey];
    const model = manifest.models.find((item) => item.id === request.modelId) ?? manifest.models[0];

    if (manifest.enabled === false) {
      return this.status(platformKey, runtime?.binary ?? 'manifest-disabled', model.path, model.id, false, false, false, false, {
        actionRequired: 'manifest-not-configured',
        message:
          manifest.note ??
          'The checked-in whisper manifest is a disabled sample. Provide a pinned runtime/model manifest before transcription.'
      });
    }

    if (!runtime) {
      return this.status(platformKey, 'unsupported-platform', model.path, model.id, false, false, false, false, {
        actionRequired: 'download-runtime',
        message: `No whisper.cpp runtime is pinned for ${platformKey}.`
      });
    }

    const binaryPath = join(this.cacheDir(), runtime.binary);
    const modelPath = join(this.cacheDir(), model.path);
    const hashesPinned = isPinnedSha256(runtime.sha256) && isPinnedSha256(model.sha256);
    const binaryExists = await this.exists(binaryPath);
    const modelExists = await this.exists(modelPath);
    const binaryVerified = hashesPinned && binaryExists ? await this.verifySha256(binaryPath, runtime.sha256) : false;
    const modelVerified = hashesPinned && modelExists ? await this.verifySha256(modelPath, model.sha256) : false;

    if (!hashesPinned) {
      return this.status(platformKey, runtime.binary, model.path, model.id, binaryExists, modelExists, false, false, {
        actionRequired: 'manifest-not-configured',
        message: 'Runtime/model hashes are not pinned. Provide trusted SHA-256 values before enabling download or execution.'
      });
    }

    if (request.allowDownload && (!binaryVerified || !modelVerified)) {
      await this.downloadAndInstallPlaceholder(runtime.url, binaryPath, runtime.sha256);
      await this.downloadAndInstallPlaceholder(model.url, modelPath, model.sha256);
    }

    return this.status(
      platformKey,
      runtime.binary,
      model.path,
      model.id,
      await this.exists(binaryPath),
      await this.exists(modelPath),
      await this.verifyIfPresent(binaryPath, runtime.sha256),
      await this.verifyIfPresent(modelPath, model.sha256),
      {
        actionRequired: !binaryVerified ? 'download-runtime' : !modelVerified ? 'download-model' : 'none',
        message: binaryVerified && modelVerified ? 'whisper.cpp runtime is ready.' : 'Runtime or model is missing.'
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

  private async downloadAndInstallPlaceholder(url: string | null, destination: string, sha256: string): Promise<void> {
    if (!url) return;
    if (url.startsWith('file://')) {
      const sourcePath = url.slice('file://'.length);
      const tmpPath = `${destination}.tmp`;
      await mkdir(dirname(destination), { recursive: true });
      await rm(tmpPath, { force: true });
      await rename(sourcePath, tmpPath);
      const verified = await this.verifySha256(tmpPath, sha256);
      if (!verified) {
        await rm(tmpPath, { force: true });
        throw new Error('Downloaded asset failed SHA-256 verification.');
      }
      await rename(tmpPath, destination);
    }
  }

  private status(
    platformKey: string,
    runtimeBinary: string,
    modelPath: string,
    modelId: string,
    binaryInstalled: boolean,
    modelInstalled: boolean,
    binaryVerified: boolean,
    modelVerified: boolean,
    extra: Pick<WhisperRuntimeStatus, 'actionRequired' | 'message'>
  ): WhisperRuntimeStatus {
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
        requested: 'auto',
        selected: 'cpu',
        fallbackReason: 'GPU detection hook is reserved for CUDA/Metal/Vulkan runtime variants.'
      },
      ...extra
    };
  }

  private async manifest(): Promise<WhisperManifest> {
    if (this.manifestCache) return this.manifestCache;
    const raw = await readFile(resolve('resources/whisper-manifest.json'), 'utf8');
    this.manifestCache = JSON.parse(raw) as WhisperManifest;
    return this.manifestCache;
  }

  private platformKey(): string {
    return `${process.platform}-${process.arch}`;
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
}

function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}
