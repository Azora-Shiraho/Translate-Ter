import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import type {
  NativeHealth,
  NativeProtocolError,
  NativeProtocolRequest,
  NativeProtocolResponse,
  NativeProtocolType
} from '@shared/models';
import { legacyWhisperCudaRuntimeDirs, sharedCudaRuntimeDir } from './cudaRuntimePaths';
import type { ScopedLogger } from './logger';
import { ffmpegBinDir } from './mediaToolPaths';

export type NativeTranscribePayload = {
  jobId?: string;
  mediaPath: string;
  audioPath?: string;
  modelId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  asrProviderId?: string;
  preferCuda?: boolean;
  cpuThreadCount?: number;
  runtime?: {
    binaryPath?: string;
    modelPath?: string;
  };
};

const MISSING_EXECUTABLE_ERROR: NativeProtocolError = {
  code: 'MissingRuntime',
  message: 'The local helper program is missing.',
  retryable: false
};

export class NativeBackendClient {
  constructor(private readonly logger?: ScopedLogger) {}

  private processPromise: Promise<import('node:child_process').ChildProcessWithoutNullStreams | undefined> | undefined;
  private childProcess: import('node:child_process').ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<
    string,
    {
      type: NativeProtocolType;
      resolve: (value: NativeProtocolResponse<any>) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private stderrLogBuffer = '';

  async health(): Promise<NativeHealth> {
    const response = await this.request<NativeHealth>('runtime.health', {});
    if (response.ok && response.payload) {
      return response.payload;
    }

    return {
      protocolVersion: 1,
      backendVersion: response.error?.code ?? 'missing-dev-build',
      status: 'degraded',
      detail: response.error?.message,
      capabilities: ['runtime.health'],
      whisperRuntimeAvailable: false,
      ffmpegAvailable: false,
      ffprobeAvailable: false,
      hardwareAcceleration: 'unknown',
      cudaSupported: false,
      recommendedLocalAcceleration: 'cpu'
    };
  }

  async transcribe(payload: NativeTranscribePayload): Promise<NativeProtocolResponse> {
    return this.request('asr.transcribe', payload);
  }

  async probeMedia(payload: { mediaPath: string }): Promise<NativeProtocolResponse<{ durationMs?: number; streams?: unknown[] }>> {
    return this.request('media.probe', payload);
  }

  async extractAudio(payload: {
    mediaPath: string;
    outputDirectory?: string;
    segmentDurationSec?: number;
  }): Promise<NativeProtocolResponse<{ audioPath?: string; files?: Array<{ path: string; startMs: number; endMs?: number }> }>> {
    return this.request('audio.extract', payload);
  }

  async parseSrt(payload: {
    srt: string;
    sourceLanguage?: string;
    inputMediaPath?: string;
  }): Promise<NativeProtocolResponse<{ document: unknown }>> {
    return this.request('srt.parse', payload);
  }

  async serializeSrt(payload: {
    segments: unknown[];
    variant?: 'source' | 'translated' | 'bilingual';
    bilingualOrder?: 'source-first' | 'target-first';
  }): Promise<NativeProtocolResponse<{ srt: string }>> {
    return this.request('srt.serialize', payload);
  }

  async cancelRunningWork(): Promise<void> {
    const child = this.childProcess;
    this.processPromise = undefined;
    this.childProcess = undefined;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.stderrLogBuffer = '';
    if (!child) {
      return;
    }
    this.logger?.info('process.cancel', 'Cancelling local helper process.');
    try {
      child.kill();
    } catch {
      // Best effort; close handler will drain pending requests.
    }
  }

  async request<TPayload = unknown>(
    type: NativeProtocolType,
    payload: unknown
  ): Promise<NativeProtocolResponse<TPayload>> {
    const executable = await this.findExecutable();
    if (!executable) {
      this.logger?.error('request.missing-runtime', 'Local helper executable was not found.', {
        type
      });
      return {
        protocolVersion: 1,
        requestId: `native-${crypto.randomUUID()}`,
        type,
        ok: false,
        error: MISSING_EXECUTABLE_ERROR
      };
    }

    const requestId = `native-${crypto.randomUUID()}`;
    const message: NativeProtocolRequest = {
      protocolVersion: 1,
      requestId,
      type,
      payload
    };
    this.logger?.debug('request.prepare', 'Preparing request for local helper.', {
      requestId,
      type,
      payload
    });

    const child = await this.getOrCreateProcess(executable);
    if (!child) {
      this.logger?.error('process.spawn-failed', 'Failed to start the local helper process.', {
        requestId,
        type,
        executable
      });
      return this.errorResponse(type, requestId, {
        code: 'MissingRuntime',
        message: 'Failed to spawn native backend executable.',
        retryable: false
      });
    }

    return new Promise((resolveResponse) => {
      const timeoutMs = this.timeoutFor(type);
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger?.error('request.timeout', 'The local helper took too long to respond.', {
          requestId,
          type,
          timeoutMs
        });
        resolveResponse(
          this.errorResponse(type, requestId, {
            code: 'InternalError',
            message: 'The local helper took too long to respond.',
            retryable: true
          })
        );
      }, timeoutMs);

      this.pending.set(requestId, {
        type,
        resolve: (value) => resolveResponse(value as NativeProtocolResponse<TPayload>),
        timeout
      });

      child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        this.logger?.error('request.write-failed', 'Failed to send request to the local helper.', {
          requestId,
          type,
          error
        });
        resolveResponse(
          this.errorResponse(type, requestId, {
            code: 'MissingRuntime',
            message: 'Failed to write request to native backend.',
            retryable: false
          })
        );
      });
    });
  }

  private timeoutFor(type: NativeProtocolType): number {
    switch (type) {
      case 'asr.transcribe':
        return 30 * 60 * 1000;
      case 'audio.extract':
        return 5 * 60 * 1000;
      case 'media.probe':
      case 'srt.parse':
      case 'srt.serialize':
      case 'runtime.health':
      case 'job.cancel':
      default:
        return 30_000;
    }
  }

  private errorResponse<TPayload>(
    type: NativeProtocolType,
    requestId: string,
    error: NativeProtocolError
  ): NativeProtocolResponse<TPayload> {
    return {
      protocolVersion: 1,
      requestId,
      type,
      ok: false,
      error
    };
  }

  private async findExecutable(): Promise<string | undefined> {
    const names = process.platform === 'win32' ? ['translate-ter-backend.exe'] : ['translate-ter-backend'];
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const roots = [
      ...(resourcesPath
        ? [
            join(resourcesPath, 'app.asar.unpacked', 'build', 'native', 'bin'),
            join(resourcesPath, 'app.asar.unpacked', 'backend', 'cpp', 'build', 'Release'),
            join(resourcesPath, 'app.asar.unpacked', 'backend', 'cpp', 'build'),
            join(resourcesPath, 'app.asar.unpacked', 'backend', 'cpp', 'build', 'bin'),
            join(resourcesPath, 'build', 'native', 'bin'),
            join(resourcesPath, 'backend', 'cpp', 'build', 'Release'),
            join(resourcesPath, 'backend', 'cpp', 'build'),
            join(resourcesPath, 'backend', 'cpp', 'build', 'bin')
          ]
        : []),
      resolve('build/native/bin'),
      resolve('backend/cpp/build/bin'),
      resolve('backend/cpp/build/Release'),
      resolve('backend/cpp/build/Debug'),
      resolve('backend/cpp/build')
    ];

    for (const root of roots) {
      for (const name of names) {
        const candidate = join(root, name);
        try {
          await access(candidate);
          this.logger?.debug('process.executable-found', 'Found local helper executable.', {
            candidate
          });
          return candidate;
        } catch {
          // Continue searching dev/build locations.
        }
      }
    }
    return undefined;
  }

  private async getOrCreateProcess(executable: string) {
    if (!this.processPromise) {
      this.processPromise = this.spawnProcess(executable);
    }
    const child = await this.processPromise;
    if (!child) {
      this.processPromise = undefined;
    }
    return child;
  }

  private async spawnProcess(executable: string) {
    return new Promise<import('node:child_process').ChildProcessWithoutNullStreams | undefined>((resolveChild) => {
      const child = spawn(executable, ['--stdio-json'], {
        env: augmentedNativeBackendEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let resolved = false;
      const finalize = (value: import('node:child_process').ChildProcessWithoutNullStreams | undefined) => {
        if (resolved) return;
        resolved = true;
        resolveChild(value);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString('utf8');
        this.flushStdoutBuffer();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunkToString(chunk);
        this.stderrBuffer += text;
        this.stderrLogBuffer += text;
        this.flushStderrBuffer();
      });

      child.once('spawn', () => {
        this.logger?.info('process.spawned', 'Local helper process started.', {
          executable
        });
        finalize(child);
      });
      child.once('spawn', () => {
        this.childProcess = child;
      });
      child.once('error', (error) => {
        this.logger?.error('process.spawn-error', 'Local helper process failed to start.', {
          executable,
          error
        });
        finalize(undefined);
      });
      child.once('close', (code, signal) => {
        this.flushStdoutBuffer(true);
        this.flushStderrBuffer(true);
        const stderrMessage = formatNativeBackendCloseDetail(this.stderrBuffer, code, signal);
        if (this.childProcess === child) {
          this.childProcess = undefined;
        }
        if (this.processPromise) {
          this.processPromise = undefined;
        }
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.stderrLogBuffer = '';
        this.logger?.warn('process.closed', 'Local helper process closed.', {
          code,
          signal,
          detail: stderrMessage
        });
        for (const [requestId, pending] of this.pending) {
          clearTimeout(pending.timeout);
          this.logger?.error('request.aborted', 'Pending request was interrupted because the local helper closed.', {
            requestId,
            type: pending.type,
            detail: stderrMessage
          });
          pending.resolve(
            this.errorResponse(pending.type, requestId, {
              code: 'MissingRuntime',
              message: stderrMessage,
              retryable: true
            })
          );
        }
        this.pending.clear();
      });
    });
  }

  private flushStdoutBuffer(flushRemainder = false): void {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    this.stdoutBuffer = flushRemainder ? '' : remainder;
    if (flushRemainder && remainder.trim()) {
      lines.push(remainder);
    }
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      this.logger?.info('process.stdout', 'Local helper output.', {
        line
      });
      if (!line.startsWith('{')) continue;
      try {
        const response = JSON.parse(line) as NativeProtocolResponse;
        const pending = this.pending.get(response.requestId);
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.pending.delete(response.requestId);
        if (response.ok) {
          if (this.logger?.shouldLog('debug')) {
            this.logger.debug('response.received', 'Received local helper response.', {
              requestId: response.requestId,
              type: response.type,
              response
            });
          } else {
            this.logger?.info('response.received', 'Received local helper response.', {
              requestId: response.requestId,
              type: response.type,
              ok: true
            });
          }
        } else {
          this.logger?.error('response.error', 'Local helper returned an error response.', {
            requestId: response.requestId,
            type: response.type,
            error: response.error
          });
        }
        pending.resolve(response);
      } catch (error) {
        this.logger?.warn('response.parse-failed', 'A local helper output line could not be parsed as JSON.', {
          line,
          error
        });
        // Ignore malformed lines; caller timeout will surface the failure.
      }
    }
  }

  private flushStderrBuffer(flushRemainder = false): void {
    const lines = this.stderrLogBuffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    this.stderrLogBuffer = flushRemainder ? '' : remainder;
    if (flushRemainder && remainder.trim()) {
      lines.push(remainder);
    }
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      this.logger?.info('process.stderr', 'Local helper error output.', {
        line
      });
    }
  }
}

function augmentedNativeBackendEnv(): NodeJS.ProcessEnv {
  const binDir = ffmpegBinDir();
  const extraEntries = [
    binDir,
    ...candidateWhisperCudaRuntimeDirs()
  ].filter((entry) => Boolean(entry) && existsSync(String(entry)));

  return {
    ...process.env,
    PATH: [...extraEntries, process.env.PATH ?? ''].filter(Boolean).join(delimiter)
  };
}

function candidateWhisperCudaRuntimeDirs(): string[] {
  return [
    sharedCudaRuntimeDir('11.8'),
    sharedCudaRuntimeDir('12.8'),
    ...legacyWhisperCudaRuntimeDirs()
  ];
}

function chunkToString(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Buffer) return chunk.toString('utf8');
  return String(chunk ?? '');
}

function formatNativeBackendCloseDetail(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const trimmed = stderr.replace(/\s+/g, ' ').trim();
  const suffixParts = [
    code !== null ? `exit code ${code}${decodeWindowsExitCode(code)}` : undefined,
    signal ? `signal ${signal}` : undefined
  ].filter(Boolean);
  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(', ')})` : '';
  if (!trimmed) {
    return `The local helper closed unexpectedly${suffix}.`;
  }
  const excerpt = trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
  return `The local helper closed unexpectedly${suffix}: ${excerpt}`;
}

function decodeWindowsExitCode(code: number): string {
  const unsigned = code >>> 0;
  switch (unsigned) {
    case 0xc0000409:
      return ', 0xC0000409 stack buffer overrun / fast-fail';
    case 0xc0000005:
      return ', 0xC0000005 access violation';
    case 0xc0000135:
      return ', 0xC0000135 missing DLL dependency';
    default:
      return '';
  }
}
