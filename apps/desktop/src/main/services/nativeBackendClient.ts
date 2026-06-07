import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  NativeHealth,
  NativeProtocolError,
  NativeProtocolRequest,
  NativeProtocolResponse,
  NativeProtocolType
} from '@shared/models';

export type NativeTranscribePayload = {
  jobId?: string;
  mediaPath: string;
  audioPath?: string;
  modelId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  asrProviderId?: string;
  preferCuda?: boolean;
  runtime?: {
    binaryPath?: string;
    modelPath?: string;
  };
};

const MISSING_EXECUTABLE_ERROR: NativeProtocolError = {
  code: 'MissingRuntime',
  message: 'Native backend executable is not built or packaged.',
  retryable: false
};

export class NativeBackendClient {
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

  async health(): Promise<NativeHealth> {
    const response = await this.request<NativeHealth>('runtime.health', {});
    if (response.ok && response.payload) {
      return response.payload;
    }

    return {
      protocolVersion: 1,
      backendVersion: response.error?.code ?? 'missing-dev-build',
      status: 'degraded',
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
    if (!child) {
      return;
    }
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

    const child = await this.getOrCreateProcess(executable);
    if (!child) {
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
        resolveResponse(
          this.errorResponse(type, requestId, {
            code: 'InternalError',
            message: 'Native backend protocol request timed out.',
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

      child.stderr.on('data', () => {
        // Protocol is stdout-only for now.
      });

      child.once('spawn', () => finalize(child));
      child.once('spawn', () => {
        this.childProcess = child;
      });
      child.once('error', () => finalize(undefined));
      child.once('close', () => {
        if (this.childProcess === child) {
          this.childProcess = undefined;
        }
        if (this.processPromise) {
          this.processPromise = undefined;
        }
        this.stdoutBuffer = '';
        for (const [requestId, pending] of this.pending) {
          clearTimeout(pending.timeout);
          pending.resolve(
            this.errorResponse(pending.type, requestId, {
              code: 'MissingRuntime',
              message: 'Native backend process exited unexpectedly.',
              retryable: true
            })
          );
        }
        this.pending.clear();
      });
    });
  }

  private flushStdoutBuffer(): void {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('{')) continue;
      try {
        const response = JSON.parse(line) as NativeProtocolResponse;
        const pending = this.pending.get(response.requestId);
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.pending.delete(response.requestId);
        pending.resolve(response);
      } catch {
        // Ignore malformed lines; caller timeout will surface the failure.
      }
    }
  }
}
