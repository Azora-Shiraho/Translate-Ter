import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(scriptsDir, '..');
export const nativeBuildDir = resolve(projectRoot, 'build', 'native');

export function nativeHostCmakeOptionValue() {
  return process.platform === 'win32' ? 'ON' : 'OFF';
}

export function cmakeCommand() {
  if (process.platform === 'win32') {
    const preferred =
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe';
    if (existsSync(preferred)) {
      return preferred;
    }
  }

  return 'cmake';
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function runOrThrow(command, args, options = {}) {
  let resolvedCommand = command;
  let resolvedArgs = [...args];

  if (process.platform === 'win32' && /(^|\\)npm\.cmd$/i.test(command) && process.env.npm_execpath) {
    resolvedCommand = process.execPath;
    resolvedArgs = [process.env.npm_execpath, ...args];
  }

  const printable = [resolvedCommand, ...resolvedArgs].join(' ');
  console.log(`> ${printable}`);

  const result = spawnSync(resolvedCommand, resolvedArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function readConfigArg(defaultValue = 'Release') {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  if (configIndex === -1) {
    return defaultValue;
  }

  const value = args[configIndex + 1];
  if (!value) {
    throw new Error('Missing value for --config.');
  }

  return value;
}
