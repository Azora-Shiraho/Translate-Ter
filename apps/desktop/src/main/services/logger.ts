import { app } from 'electron';
import { existsSync, mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppLogLevel } from '@shared/models';

const LOG_LEVEL_PRIORITY: Record<AppLogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40
};

const LOG_LEVEL_LABEL: Record<AppLogLevel, 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'> = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARNING',
  error: 'ERROR'
};

const REDACTED_VALUE = '[REDACTED]';
const MAX_LOG_DEPTH = 6;
const MAX_LOG_STRING_LENGTH = 100_000;
const SENSITIVE_KEY_PATTERN = /(^|_|-)(api[_-]?key|authorization|secret|token|password|access[_-]?key|refresh[_-]?token)(_|-|$)/i;

export type LogWriteInput = {
  level: AppLogLevel;
  scope: string;
  event: string;
  message?: string;
  details?: unknown;
};

export type RendererLogWriteInput = {
  level: AppLogLevel;
  scope?: string;
  event: string;
  message?: string;
  details?: unknown;
};

type PersistedLogEntry = {
  ts: string;
  session: string;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
  scope: string;
  event: string;
  message?: string;
  details?: unknown;
};

export class AppLogger {
  private readonly sessionStartedAt = new Date();
  private readonly sessionId = formatSessionId(this.sessionStartedAt);
  private currentLevel: AppLogLevel = 'info';
  private stream?: WriteStream;
  private filePath?: string;
  private initPromise?: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  createScope(scope: string, baseDetails?: Record<string, unknown>): ScopedLogger {
    return new ScopedLogger(this, scope, baseDetails);
  }

  async initialize(level: AppLogLevel = 'info'): Promise<string> {
    this.currentLevel = normalizeLogLevel(level);
    await this.ensureStream();
    this.log(
      {
        level: 'info',
        scope: 'logger',
        event: 'session.started',
        message: 'Log session started.',
        details: {
          filePath: this.filePath,
          configuredLevel: this.currentLevel,
          startedAt: this.sessionStartedAt.toISOString()
        }
      },
      { force: true }
    );
    return this.filePath!;
  }

  async dispose(): Promise<void> {
    await this.writeChain.catch(() => undefined);
    const stream = this.stream;
    this.stream = undefined;
    if (!stream) return;
    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  }

  getFilePath(): string | undefined {
    return this.filePath;
  }

  getLevel(): AppLogLevel {
    return this.currentLevel;
  }

  setLevel(level: AppLogLevel): void {
    const nextLevel = normalizeLogLevel(level);
    const previousLevel = this.currentLevel;
    this.currentLevel = nextLevel;
    this.log(
      {
        level: 'info',
        scope: 'logger',
        event: 'level.changed',
        message: 'Log level updated.',
        details: {
          previousLevel,
          nextLevel
        }
      },
      { force: true }
    );
  }

  shouldLog(level: AppLogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.currentLevel];
  }

  log(entry: LogWriteInput, options: { force?: boolean } = {}): void {
    if (!options.force && !this.shouldLog(entry.level)) {
      return;
    }

    const payload: PersistedLogEntry = {
      ts: new Date().toISOString(),
      session: this.sessionId,
      level: LOG_LEVEL_LABEL[normalizeLogLevel(entry.level)],
      scope: entry.scope,
      event: entry.event,
      message: sanitizeMessage(entry.message),
      details: sanitizeForLog(entry.details)
    };

    const serialized = JSON.stringify(payload) + '\n';
    this.writeChain = this.writeChain
      .then(async () => {
        await this.ensureStream();
        await new Promise<void>((resolve, reject) => {
          this.stream!.write(serialized, 'utf8', (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      })
      .catch((error) => {
        console.error('[translate-ter][logger]', error);
      });
  }

  writeFromRenderer(entry: RendererLogWriteInput): void {
    this.log({
      level: normalizeLogLevel(entry.level),
      scope: entry.scope?.trim() || 'renderer',
      event: entry.event,
      message: entry.message,
      details: entry.details
    });
  }

  debug(scope: string, event: string, message?: string, details?: unknown): void {
    this.log({ level: 'debug', scope, event, message, details });
  }

  info(scope: string, event: string, message?: string, details?: unknown): void {
    this.log({ level: 'info', scope, event, message, details });
  }

  warn(scope: string, event: string, message?: string, details?: unknown): void {
    this.log({ level: 'warning', scope, event, message, details });
  }

  error(scope: string, event: string, message?: string, details?: unknown): void {
    this.log({ level: 'error', scope, event, message, details });
  }

  private async ensureStream(): Promise<void> {
    if (this.stream) return;
    if (!this.initPromise) {
      this.initPromise = this.createStream();
    }
    await this.initPromise;
  }

  private async createStream(): Promise<void> {
    const errors: string[] = [];
    for (const logDir of preferredLogDirectories()) {
      try {
        await mkdir(logDir, { recursive: true });
        mkdirSync(logDir, { recursive: true });
        const filePath = uniqueLogFilePath(logDir, this.sessionStartedAt);
        await new Promise<void>((resolve, reject) => {
          const stream = createWriteStream(filePath, { encoding: 'utf8', flags: 'a' });
          stream.once('open', () => {
            this.filePath = filePath;
            this.stream = stream;
            resolve();
          });
          stream.once('error', reject);
        });
        return;
      } catch (error) {
        errors.push(`${logDir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`Unable to create log file. ${errors.join(' | ')}`);
  }
}

export class ScopedLogger {
  constructor(
    private readonly root: AppLogger,
    private readonly scope: string,
    private readonly baseDetails?: Record<string, unknown>
  ) {}

  shouldLog(level: AppLogLevel): boolean {
    return this.root.shouldLog(level);
  }

  debug(event: string, message?: string, details?: unknown): void {
    this.root.log(this.entry('debug', event, message, details));
  }

  info(event: string, message?: string, details?: unknown): void {
    this.root.log(this.entry('info', event, message, details));
  }

  warn(event: string, message?: string, details?: unknown): void {
    this.root.log(this.entry('warning', event, message, details));
  }

  error(event: string, message?: string, details?: unknown): void {
    this.root.log(this.entry('error', event, message, details));
  }

  private entry(level: AppLogLevel, event: string, message?: string, details?: unknown): LogWriteInput {
    const mergedDetails =
      this.baseDetails && details && isRecord(details)
        ? { ...this.baseDetails, ...details }
        : this.baseDetails
          ? { ...this.baseDetails, detail: sanitizeForLog(details) }
          : details;

    return {
      level,
      scope: this.scope,
      event,
      message,
      details: mergedDetails
    };
  }
}

function uniqueLogFilePath(logDir: string, startedAt: Date): string {
  const baseName = `${formatSessionId(startedAt)}.log`;
  const directPath = join(logDir, baseName);
  if (!existsSync(directPath)) {
    return directPath;
  }

  let suffix = 2;
  while (true) {
    const candidate = join(logDir, `${formatSessionId(startedAt)}-${String(suffix).padStart(2, '0')}.log`);
    if (!existsSync(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function preferredLogDirectories(): string[] {
  const primaryBaseDir = app.isPackaged ? dirname(process.execPath) : process.cwd();
  const directories = [join(primaryBaseDir, 'logs')];
  const fallbackDir = join(app.getPath('userData'), 'logs');
  if (!directories.includes(fallbackDir)) {
    directories.push(fallbackDir);
  }
  return directories;
}

function formatSessionId(value: Date): string {
  return [
    value.getFullYear(),
    padNumber(value.getMonth() + 1),
    padNumber(value.getDate())
  ].join('-') +
    '_' +
    [padNumber(value.getHours()), padNumber(value.getMinutes())].join('-');
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function normalizeLogLevel(value: AppLogLevel | undefined): AppLogLevel {
  return value === 'debug' || value === 'warning' || value === 'error' ? value : 'info';
}

function sanitizeMessage(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.length > MAX_LOG_STRING_LENGTH ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]` : value;
}

function sanitizeForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    return sanitizeMessage(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: sanitizeMessage(value.stack)
    };
  }
  if (value instanceof URL) {
    return value.toString();
  }
  if (value instanceof Map) {
    return sanitizeForLog(Object.fromEntries(value.entries()), depth + 1, seen);
  }
  if (value instanceof Set) {
    return sanitizeForLog([...value.values()], depth + 1, seen);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_LOG_DEPTH) {
      return `[Array(${value.length})]`;
    }
    return value.map((entry) => sanitizeForLog(entry, depth + 1, seen));
  }
  if (Buffer.isBuffer(value)) {
    return `<Buffer ${value.byteLength} bytes>`;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    if (depth >= MAX_LOG_DEPTH) {
      return `[Object ${(value as { constructor?: { name?: string } }).constructor?.name ?? 'Object'}]`;
    }
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED_VALUE
        : sanitizeForLog(nestedValue, depth + 1, seen);
    }
    seen.delete(value);
    return output;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
