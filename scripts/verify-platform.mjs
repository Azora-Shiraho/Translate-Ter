import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');
const host = `${process.platform}-${process.arch}`;
const backendName = process.platform === 'win32' ? 'translate-ter-backend.exe' : 'translate-ter-backend';
const backendPath = resolve(projectRoot, 'build', 'native', 'bin', backendName);
const manifestPath = resolve(projectRoot, 'resources', 'whisper-manifest.json');

function section(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function item(label, value) {
  console.log(`- ${label}: ${value}`);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000
  });
}

function loadManifestPlatforms() {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Object.keys(manifest?.runtime?.platforms ?? {});
  } catch {
    return [];
  }
}

function probeSystemWhisperCli() {
  const result = run(process.platform === 'win32' ? 'where' : 'which', [process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli']);
  if (result.status !== 0) {
    return undefined;
  }

  const candidate = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!candidate) {
    return undefined;
  }

  const help = run(candidate, ['--help']);
  return help.status === 0 ? candidate : undefined;
}

function probeNvidiaSmi() {
  const result = run('nvidia-smi', ['-L']);
  return result.status === 0;
}

section('Translate-Ter Platform Verify');
item('Host', host);
item('Electron mainline', 'Cross-platform');
item('Windows native host', process.platform === 'win32' ? 'Applicable on this host' : 'Windows-only');
item('Future extensions', 'Do not add coreml/mlx/tensorrt; treat vulkan as reserved/experimental');

const manifestPlatforms = loadManifestPlatforms();
item(
  'Manifest runtime keys',
  manifestPlatforms.length > 0 ? manifestPlatforms.join(', ') : 'Unavailable or unreadable'
);

section('Recommended Commands');
item('Core checks', 'npm test && npm run build && npm run native:build');
item('Packaging boundary', 'npm run package:electron');
item('Current helper', 'npm run verify:platform');
item(
  'Windows-only packaging',
  process.platform === 'win32' ? 'npm run native:package' : 'Expected to skip with a Windows-only message'
);

section('Current Host Checks');
if (!existsSync(backendPath)) {
  item('Native backend', `Missing ${backendPath}`);
  console.error('\nRun "npm run native:build" before "npm run verify:platform".');
  process.exit(1);
}

item('Native backend', backendPath);
const backendHealth = run(backendPath, ['--health']);
if (backendHealth.status !== 0) {
  item('Backend health', `Failed with exit code ${backendHealth.status ?? 'unknown'}`);
  if (backendHealth.error?.message) {
    console.error(backendHealth.error.message);
  }
  if (backendHealth.stderr) {
    console.error(backendHealth.stderr.trim());
  }
  process.exit(1);
}

item('Backend health', 'OK');
const healthOutput = String(backendHealth.stdout || '').trim();
if (healthOutput) {
  console.log(healthOutput);
}

if (process.platform === 'win32') {
  item('CUDA optional probe (nvidia-smi)', probeNvidiaSmi() ? 'Detected' : 'Not detected');
  item('Windows CPU baseline', 'Supported baseline');
  item('Windows CUDA', 'Optional path; CPU fallback remains expected when unavailable');
} else if (process.platform === 'darwin') {
  const whisperCli = probeSystemWhisperCli();
  item('macOS Metal system whisper-cli', whisperCli ? `Detected at ${whisperCli}` : 'Not detected or not runnable');
  item('Trust model', 'System whisper-cli uses executable probe only, not SHA-256');
  item('WebView2 native host', 'Not built on macOS');
} else if (process.platform === 'linux') {
  item('Linux CPU baseline', 'Supported baseline');
  item('WebView2 native host', 'Not built on Linux');
}

section('Boundary Summary');
item('native:build', process.platform === 'win32' ? 'Backend + WebView2 host' : 'Backend only');
item('package:electron', 'Cross-platform mainline packaging path');
item('Validated optional accelerators', 'Windows CUDA, macOS Metal system whisper-cli');
