import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  nativeBuildDir,
  npmCommand,
  projectRoot,
  readConfigArg,
  runOrThrow
} from './native-build-utils.mjs';

const configuration = readConfigArg();

if (process.platform !== 'win32') {
  console.log(
    `native:package skipped on ${process.platform}: the WebView2 native host is Windows-only. Use "npm run native:build" to build the cross-platform backend helper, or "npm run package:electron" for the Electron shell.`
  );
  process.exit(0);
}

const distDir = join(projectRoot, 'dist', 'native');
const frontendDir = join(distDir, 'app', 'frontend');
const backendDir = join(distDir, 'app', 'backend');
const resourcesDir = join(distDir, 'app', 'resources');
const ensureWebView2Script = join(projectRoot, 'scripts', 'ensure-webview2.ps1');
const buildScript = join(projectRoot, 'scripts', 'build-native.mjs');
const buildBinDir = join(nativeBuildDir, 'bin');

await rm(distDir, { force: true, recursive: true });
await mkdir(frontendDir, { recursive: true });
await mkdir(backendDir, { recursive: true });
await mkdir(resourcesDir, { recursive: true });

runOrThrow(npmCommand(), ['run', 'build']);
runOrThrow('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureWebView2Script]);
runOrThrow(process.execPath, [buildScript, '--config', configuration]);

const hostExecutable = join(buildBinDir, 'TranslateTer.exe');
const webView2Loader = join(buildBinDir, 'WebView2Loader.dll');
const backendExecutable = join(buildBinDir, 'translate-ter-backend.exe');

for (const artifact of [hostExecutable, webView2Loader, backendExecutable]) {
  if (!existsSync(artifact)) {
    throw new Error(`Expected packaged artifact is missing: ${artifact}`);
  }
}

await copyFile(hostExecutable, join(distDir, 'TranslateTer.exe'));
await copyFile(webView2Loader, join(distDir, 'WebView2Loader.dll'));
await copyFile(backendExecutable, join(backendDir, 'translate-ter-backend.exe'));
await rm(frontendDir, { force: true, recursive: true });
await cp(join(projectRoot, 'out', 'renderer'), frontendDir, { recursive: true });
await copyFile(join(projectRoot, 'resources', 'whisper-manifest.json'), join(resourcesDir, 'whisper-manifest.json'));

console.log(`Native unzip-and-run package created at ${distDir}`);
