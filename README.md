# Translate-Ter

Translate-Ter is a Windows-first Electron desktop app skeleton for importing media, producing subtitles with local-first ASR, translating subtitle segments through provider-neutral LLM adapters, and exporting SRT.

## Quick Start

```powershell
npm install
npm run dev
```

The desktop worker is an Electron + React + TypeScript + Vite app. `npm run dev` starts the Electron shell with the renderer UI; `npm run build` type-checks and emits production bundles under `out/`. `package.json` points both Electron's `main` field and electron-builder's `files` list at that same production output.

Run tests:

```powershell
npm test
```

Native backend skeleton:

```powershell
npm run native:configure
npm run native:build
backend\cpp\build\Release\translate-ter-backend.exe --health
```

This repository intentionally has no initial commit yet. The coordinating agent will decide when the reviewed baseline is ready to commit.

## Current MVP Shape

- Electron main/preload/renderer are separated with a narrow `window.translateTer` API.
- The preload contract exposes the frontend workflow calls `selectVideo`, `startTranscription`, `startTranslation`, `exportSrt`, `getSettings`, and `saveSettings`; ASR now crosses the native backend boundary unless the explicit `mock.asr` dev provider is selected.
- The renderer is a single-page Apple-inspired workflow surface: media import, ASR settings, local/cloud provider selection, model status, subtitle preview/editing table, translation provider/target language, progress, retry/error status, language switching, and SRT export.
- Renderer cannot read provider secrets or run native binaries directly.
- ASR defaults to `local.whisper.cpp`; cloud ASR is represented as an explicit opt-in provider interface.
- Shared subtitle data uses a stable `Segment`/`SubtitleSegment` shape with `id`, `index`, `startMs`, `endMs`, source/translated text, status, and notes.
- SRT parsing/writing keeps cue boundaries in milliseconds and translation only mutates text by stable segment id.
- Translation policy includes provider config, token-bucket request/token limits, retry with exponential backoff plus jitter, circuit breaker state, and batch checkpoint records. A mock provider supports deterministic tests and offline workflow checks.
- ASR has a provider-neutral abstraction plus a local `whisper.cpp` provider id. Whisper runtime/model handling includes platform/arch/accelerator manifest design, cache path resolution, SHA-256 verification expectations, and atomic install hooks. The checked-in manifest is a disabled sample; users or CI must supply a pinned manifest before downloads/execution are considered configured.
- C++ backend is a buildable CLI boundary with `--health` and a newline-delimited JSON stdio protocol for `runtime.health`, `srt.parse`, `srt.serialize`, and typed runtime-required `asr.transcribe` errors.

## Layout

```text
apps/desktop/src/main      Electron main, IPC, job/provider/runtime services
apps/desktop/src/preload   contextBridge API
apps/desktop/src/renderer  React UI and i18n resources
apps/desktop/src/shared    Contracts, SRT model/parser/writer, translation core
backend/cpp                Native backend CLI skeleton
contracts                  Protocol notes
resources                  Whisper runtime/model manifest
```

## Known Gaps

Real whisper.cpp downloads, model hashes, ffmpeg integration, and full provider SDK adapters remain behind stable interfaces. The dev app simulates ASR output only when `mock.asr` is selected. Provider secrets are persisted by Electron main with `safeStorage` encrypted userData files when available, and renderer settings never include secret values.
