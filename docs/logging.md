# Translate-Ter Logging Guide

## Purpose

This project uses a single structured logging system for both the Electron main process and the renderer. Do not add ad hoc `console.log(...)` calls for normal product logging.

## File Rules

- Log files are written to the app directory `logs/` folder first.
- If the app directory is not writable, fall back to the app data `logs/` directory.
- Each app launch creates its own file based on startup time, precise to the minute.
- The filename format is `YYYY-MM-DD_HH-mm.log`.
- If the same minute is reused, a numeric suffix may be appended to keep files separate.

## Format

- Logs are stored as JSON Lines (`.log` file with one JSON object per line).
- Each line contains:
  - `ts`: ISO timestamp
  - `session`: startup session id
  - `level`: `DEBUG`, `INFO`, `WARNING`, or `ERROR`
  - `scope`: subsystem name such as `ipc`, `renderer.ui`, `native-backend`, or `faster-whisper`
  - `event`: stable event id
  - `message`: short human-readable summary
  - `details`: optional structured data

## Level Rules

- `DEBUG`
  - Record detailed frontend and backend activity.
  - Include renderer click/change capture, low-level IPC flow, and detailed runtime checks.
- `INFO`
  - Record backend output and important user-triggered interactions.
  - Include runtime/model/CUDA/FFmpeg checks, recognition start, translation start, export, provider test/save, and subprocess stdout/stderr.
- `WARNING`
  - Record warnings and recoverable problems.
  - Examples: degraded runtime, fallback behavior, unexpected window/process state, user-visible warnings.
- `ERROR`
  - Record failures only.
  - Include thrown errors, failed IPC requests, failed subprocess launches, failed downloads, and failed recognition/translation/export actions.

## Main Process Usage

- Reuse `apps/desktop/src/main/services/logger.ts`.
- Create scoped loggers with `logger.createScope('scope-name')`.
- Prefer stable event ids such as `request.timeout`, `asset.event`, or `process.closed`.
- For IPC, use the shared wrapper in `apps/desktop/src/main/index.ts` instead of writing per-channel logging by hand.

## Renderer Usage

- Use `window.translateTer.logs.debug/info/warning/error(...)`.
- Keep `scope` values user-flow oriented, for example:
  - `renderer.ui`
  - `renderer.workspace`
  - `renderer.settings`
  - `renderer.providers`
  - `renderer.dom`
- Do not log on every render. Log only real events, actions, or state transitions.

## Redaction Rules

- Never log secrets in plaintext.
- The logger automatically redacts common sensitive keys such as API keys, tokens, passwords, and authorization fields.
- Do not rely only on automatic redaction when writing custom details. Avoid passing raw secret payloads unless strictly required for debugging.

## Good Practices

- Prefer structured `details` over packing everything into `message`.
- Keep `event` names stable so logs remain searchable across versions.
- Log the action once at the right layer instead of duplicating the same message everywhere.
- When adding a new backend service, wire it into the shared logger early instead of adding temporary logging.

## Examples

```ts
const runtimeLogger = logger.createScope('whisper-runtime');
runtimeLogger.info('check.start', 'Checking local Whisper runtime.', { modelId });
runtimeLogger.error('check.failed', 'Local Whisper runtime check failed.', { error });
```

```ts
window.translateTer.logs.info(
  'job.start-transcription',
  { mediaPath, asrProviderId, whisperModelId },
  'renderer.workspace'
);
```
