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
  mediaPath: string;
  modelId: string;
  sourceLanguage: string;
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
      hardwareAcceleration: 'unknown'
    };
  }

  async transcribe(payload: NativeTranscribePayload): Promise<NativeProtocolResponse> {
    return this.request('asr.transcribe', payload);
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

    return new Promise((resolveResponse) => {
      const child = spawn(executable, ['--stdio-json'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      let stdout = '';
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolveResponse(this.errorResponse(type, requestId, {
          code: 'InternalError',
          message: 'Native backend protocol request timed out.',
          retryable: true
        }));
      }, 10_000);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResponse(this.errorResponse(type, requestId, {
          code: 'MissingRuntime',
          message: 'Failed to spawn native backend executable.',
          retryable: false
        }));
      });
      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          const line = stdout
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean)
            .find((item) => item.startsWith('{'));
          if (!line) throw new Error('empty native protocol response');
          resolveResponse(JSON.parse(line) as NativeProtocolResponse<TPayload>);
        } catch {
          resolveResponse(this.errorResponse(type, requestId, {
            code: 'MalformedRequest',
            message: 'Native backend returned unreadable protocol output.',
            retryable: true
          }));
        }
      });

      child.stdin.end(`${JSON.stringify(message)}\n`, 'utf8');
    });
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
            join(resourcesPath, 'app.asar.unpacked', 'backend', 'cpp', 'build', 'Release'),
            join(resourcesPath, 'app.asar.unpacked', 'backend', 'cpp', 'build'),
            join(resourcesPath, 'backend', 'cpp', 'build', 'Release'),
            join(resourcesPath, 'backend', 'cpp', 'build')
          ]
        : []),
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
}
