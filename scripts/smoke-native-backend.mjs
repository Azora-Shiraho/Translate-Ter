import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { projectRoot } from './native-build-utils.mjs';

const backendName = process.platform === 'win32' ? 'translate-ter-backend.exe' : 'translate-ter-backend';
const expectedBackendPath = resolve(projectRoot, 'build', 'native', 'bin', backendName);
const sampleSrt = `1
00:00:00,000 --> 00:00:00,800
Hello smoke

2
00:00:01,000 --> 00:00:02,000
Second line
`;

async function main() {
  const executable = await discoverBackendExecutable();
  logInfo(`backend executable: ${executable}`);

  const cliHealth = runSync(executable, ['--health']);
  assertOk(cliHealth.status === 0, `backend --health exited with code ${cliHealth.status ?? 'unknown'}`);

  const cliHealthPayload = parseJson(cliHealth.stdout, 'backend --health');
  assertOk(cliHealthPayload.protocolVersion === 1, 'backend --health returns protocolVersion=1');

  const session = new NativeBackendSession(executable);
  const workspace = await mkdtemp(join(tmpdir(), 'translate-ter-smoke-'));

  try {
    const runtimeHealth = await session.request('runtime.health', {});
    assertResponseOk(runtimeHealth, 'runtime.health');
    assertOk(runtimeHealth.payload.protocolVersion === 1, 'runtime.health payload includes protocolVersion=1');
    assertOk(Array.isArray(runtimeHealth.payload.capabilities), 'runtime.health payload includes capabilities');
    assertOk(
      runtimeHealth.payload.capabilities.includes('runtime.health'),
      'runtime.health capability list includes runtime.health'
    );
    assertOk(runtimeHealth.payload.capabilities.includes('srt.parse'), 'runtime.health capability list includes srt.parse');
    assertOk(
      runtimeHealth.payload.capabilities.includes('srt.serialize'),
      'runtime.health capability list includes srt.serialize'
    );
    assertOk(runtimeHealth.payload.capabilities.includes('job.cancel'), 'runtime.health capability list includes job.cancel');

    const parseResponse = await session.request('srt.parse', {
      srt: sampleSrt,
      sourceLanguage: 'en-US',
      inputMediaPath: 'smoke-input.srt'
    });
    assertResponseOk(parseResponse, 'srt.parse');
    assertOk(parseResponse.payload.document.format === 'srt', 'srt.parse returns an SRT document');
    assertOk(parseResponse.payload.document.sourceLanguage === 'en-US', 'srt.parse preserves sourceLanguage');
    assertOk(parseResponse.payload.document.segments.length === 2, 'srt.parse returns two segments');
    assertOk(
      parseResponse.payload.document.segments[0].sourceText === 'Hello smoke',
      'srt.parse preserves the first segment text'
    );

    const serializeResponse = await session.request('srt.serialize', {
      segments: [
        {
          index: 2,
          startMs: 1000,
          endMs: 2000,
          sourceText: 'Second line {speaker}',
          translatedText: '第二行 {speaker}'
        },
        {
          index: 1,
          startMs: 0,
          endMs: 800,
          sourceText: 'Hello {smoke}',
          translatedText: '你好 {smoke}'
        }
      ],
      variant: 'bilingual',
      bilingualOrder: 'source-first'
    });
    assertResponseOk(serializeResponse, 'srt.serialize');
    const expectedSerialized = `1
00:00:00,000 --> 00:00:00,800
Hello {smoke}
你好 {smoke}

2
00:00:01,000 --> 00:00:02,000
Second line {speaker}
第二行 {speaker}

`;
    assertOk(
      serializeResponse.payload.srt === expectedSerialized,
      'srt.serialize preserves brace-containing bilingual SRT output'
    );

    const emptyTranslatedResponse = await session.request('srt.serialize', {
      segments: [
        {
          id: 'seg-empty',
          index: 1,
          startMs: 0,
          endMs: 800,
          sourceText: 'Hello source',
          translatedText: ''
        }
      ],
      variant: 'translated'
    });
    assertOk(emptyTranslatedResponse.ok === false, 'srt.serialize rejects empty translated subtitle segments');
    assertOk(
      emptyTranslatedResponse.error?.message === 'Cannot export empty subtitle segment seg-empty.',
      'srt.serialize reports a clear empty translated segment error'
    );

    const cancelResponse = await session.request('job.cancel', { jobId: 'smoke-job' });
    assertResponseOk(cancelResponse, 'job.cancel');
    assertOk(cancelResponse.payload.cancelled === true, 'job.cancel acknowledges cancellation');

    const fixtureDirectory = join(workspace, 'fixtures');
    const outputDirectory = join(workspace, 'audio-output');
    await mkdir(fixtureDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });

    const fixtureAudioPath = join(fixtureDirectory, 'fixture.wav');
    await createSilentWavFixture(fixtureAudioPath);

    if (commandAvailable('ffprobe')) {
      const probeResponse = await session.request('media.probe', {
        mediaPath: fixtureAudioPath
      });
      assertResponseOk(probeResponse, 'media.probe');
      assertOk(probeResponse.payload.tool === 'ffprobe', 'media.probe reports ffprobe as the active tool');
      assertOk(Array.isArray(probeResponse.payload.raw?.streams), 'media.probe returns ffprobe stream metadata');
    } else {
      logSkip('ffprobe is unavailable on this machine; skipping media.probe');
    }

    if (commandAvailable('ffmpeg')) {
      const extractResponse = await session.request('audio.extract', {
        jobId: 'smoke-audio',
        mediaPath: fixtureAudioPath,
        outputDir: outputDirectory,
        format: 'wav'
      });
      assertResponseOk(extractResponse, 'audio.extract');
      assertOk(extractResponse.payload.tool === 'ffmpeg', 'audio.extract reports ffmpeg as the active tool');
      assertOk(extractResponse.payload.files.length > 0, 'audio.extract returns at least one output file');
      assertOk(await pathExists(extractResponse.payload.files[0].path), 'audio.extract output file exists on disk');
    } else {
      logSkip('ffmpeg is unavailable on this machine; skipping audio.extract');
    }

    console.log('\nNative smoke checks passed.');
  } finally {
    await session.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

async function discoverBackendExecutable() {
  if (await pathExists(expectedBackendPath, constants.X_OK)) {
    return expectedBackendPath;
  }

  throw new Error(
    `Native backend executable was not found at the native:build output path.\n- expected: ${expectedBackendPath}\nRun "npm run native:build" first.`
  );
}

function runSync(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000
  });
}

function commandAvailable(command) {
  const result = runSync(command, ['-version']);
  return result.status === 0;
}

async function pathExists(path, mode = constants.F_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(String(text).trim());
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertResponseOk(response, label) {
  assertOk(response.ok === true, `${label} returned ok=true`);
}

function assertOk(condition, label) {
  if (!condition) {
    throw new Error(label);
  }
  console.log(`[pass] ${label}`);
}

function logInfo(message) {
  console.log(`[info] ${message}`);
}

function logSkip(message) {
  console.log(`[skip] ${message}`);
}

class NativeBackendSession {
  constructor(executable) {
    this.executable = executable;
    this.child = undefined;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.nextRequestId = 1;
    this.pending = new Map();
  }

  async request(type, payload) {
    const child = this.ensureProcess();
    const requestId = `smoke-${this.nextRequestId++}`;
    const message = JSON.stringify({
      protocolVersion: 1,
      requestId,
      type,
      payload
    });

    return new Promise((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        rejectResponse(new Error(`${type} timed out after 30 seconds.`));
      }, 30_000);

      this.pending.set(requestId, {
        resolveResponse,
        rejectResponse,
        timeout
      });

      child.stdin.write(`${message}\n`, 'utf8', (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        rejectResponse(new Error(`Failed to write ${type}: ${error.message}`));
      });
    });
  }

  ensureProcess() {
    if (this.child) {
      return this.child;
    }

    const child = spawn(this.executable, ['--stdio-json'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk;
      this.flushStdout();
    });

    child.stderr.on('data', (chunk) => {
      this.stderrBuffer += chunk;
    });

    child.once('error', (error) => {
      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.rejectResponse(new Error(`Native backend failed before responding to ${requestId}: ${error.message}`));
      }
      this.pending.clear();
    });

    child.once('close', (code, signal) => {
      this.flushStdout(true);
      const detail = this.stderrBuffer.trim();
      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.rejectResponse(
          new Error(
            `Native backend closed before responding to ${requestId} (code=${code ?? 'null'}, signal=${
              signal ?? 'null'
            })${detail ? `: ${detail}` : ''}`
          )
        );
      }
      this.pending.clear();
      this.child = undefined;
    });

    this.child = child;
    return child;
  }

  flushStdout(flushRemainder = false) {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    this.stdoutBuffer = flushRemainder ? '' : remainder;
    if (flushRemainder && remainder.trim()) {
      lines.push(remainder);
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const response = parseJson(line, 'native backend stdout');
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(response.requestId);
      pending.resolveResponse(response);
    }
  }

  async close() {
    if (!this.child) {
      return;
    }

    const child = this.child;
    await new Promise((resolveClose) => {
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Best-effort shutdown for smoke cleanup.
        }
      }, 5_000);

      child.once('close', () => {
        clearTimeout(timeout);
        resolveClose();
      });

      child.stdin.end();
    });
  }
}

async function createSilentWavFixture(path) {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const durationMs = 1000;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  await writeFile(path, buffer);
}

await main();
