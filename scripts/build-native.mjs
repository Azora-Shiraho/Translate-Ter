import { cmakeCommand, nativeBuildDir, projectRoot, readConfigArg, runOrThrow } from './native-build-utils.mjs';

const args = new Set(process.argv.slice(2));
const configuration = readConfigArg();
const configureOnly = args.has('--configure-only');

runOrThrow(cmakeCommand(), ['-S', projectRoot, '-B', nativeBuildDir]);

if (configureOnly) {
  console.log(`Configured native build directory at ${nativeBuildDir}`);
  process.exit(0);
}

runOrThrow(cmakeCommand(), ['--build', nativeBuildDir, '--config', configuration]);
console.log(`Built native targets for ${process.platform} (${configuration}).`);
