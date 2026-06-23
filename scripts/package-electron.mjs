import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { npmCommand, projectRoot, readConfigArg, runOrThrow } from './native-build-utils.mjs';

const configuration = readConfigArg();
const buildScript = join(projectRoot, 'scripts', 'build-native.mjs');
const builder = join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const distDir = join(projectRoot, 'dist');

runOrThrow(npmCommand(), ['run', 'build']);
runOrThrow(process.execPath, [buildScript, '--config', configuration]);

if (!existsSync(builder)) {
  throw new Error('electron-builder is not installed. Run npm install first.');
}

if (process.platform === 'win32') {
  const winUnpacked = join(distDir, 'win-unpacked');
  await rm(winUnpacked, { force: true, recursive: true });
  runOrThrow(process.execPath, [builder, '--dir', '--win', '--x64', '--publish', 'never']);

  const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const zipName = `Translate-Ter-v${packageJson.version}-windows-x64-electron.zip`;
  const zipPath = join(distDir, zipName);
  await rm(zipPath, { force: true });
  runOrThrow('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${join(winUnpacked, '*')}' -DestinationPath '${zipPath}'`
  ]);
  console.log(`Electron zip package created at ${zipPath}`);
  process.exit(0);
}

runOrThrow(process.execPath, [builder, '--dir', '--publish', 'never']);
console.log(`Electron package created under ${distDir}`);
