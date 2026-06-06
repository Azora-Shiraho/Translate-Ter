export type HostPlatform = 'win32' | 'darwin' | 'linux';
export type HostArch = 'x64' | 'arm64';
export type Accelerator = 'cpu' | 'cuda' | 'metal' | 'vulkan';
export type DownloadAssetKind = 'runtime' | 'model';

export type DownloadManifestAsset = {
  id: string;
  kind: DownloadAssetKind;
  platform?: HostPlatform;
  arch?: HostArch;
  accelerator: Accelerator;
  fileName: string;
  url: string | null;
  sha256: string;
  sizeBytes: number;
  cacheRelativePath: string;
};

export type WhisperDownloadManifest = {
  manifestVersion: number;
  provider: 'whisper.cpp';
  generatedAt?: string;
  assets: DownloadManifestAsset[];
};

export type DownloadTarget = {
  asset: DownloadManifestAsset;
  cachePath: string;
  tempPath: string;
};

export type DownloadHost = {
  platform: HostPlatform;
  arch: HostArch;
  accelerator: 'auto' | Accelerator;
};

export function platformKey(host: Pick<DownloadHost, 'platform' | 'arch'>): string {
  return `${host.platform}-${host.arch}`;
}

export function resolveWhisperAssets(manifest: WhisperDownloadManifest, host: DownloadHost): DownloadManifestAsset[] {
  const acceleratorPreference =
    host.accelerator === 'auto' ? preferredAccelerators(host.platform) : [host.accelerator, 'cpu'];

  return manifest.assets.filter((asset) => {
    if (asset.platform && asset.platform !== host.platform) return false;
    if (asset.arch && asset.arch !== host.arch) return false;
    return acceleratorPreference.includes(asset.accelerator);
  });
}

export function createDownloadTarget(asset: DownloadManifestAsset, cacheDir: string): DownloadTarget {
  const normalizedRelativePath = asset.cacheRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalizedRelativePath.includes('../')) {
    throw new Error(`Unsafe cache path in manifest asset ${asset.id}.`);
  }

  const cachePath = `${cacheDir.replace(/[\\/]+$/, '')}/${normalizedRelativePath}`;
  return {
    asset,
    cachePath,
    tempPath: `${cachePath}.download`
  };
}

export async function downloadAndInstallWhisperAsset(_target: DownloadTarget, _signal?: AbortSignal): Promise<void> {
  // TODO: Implement only after URLs and SHA-256 values are pinned from trusted whisper.cpp/model provenance.
  // Required behavior: stream to tempPath, verify sha256, then atomically rename into cachePath.
  throw new Error('Whisper asset download is disabled until manifest URLs and hashes are pinned.');
}

function preferredAccelerators(platform: HostPlatform): Accelerator[] {
  if (platform === 'darwin') return ['metal', 'cpu'];
  if (platform === 'win32' || platform === 'linux') return ['cuda', 'vulkan', 'cpu'];
  return ['cpu'];
}
