# Translate-Ter

Translate-Ter is a desktop subtitle workflow app for importing media, producing subtitles with local-first ASR, translating subtitle segments through provider-neutral LLM adapters, and exporting SRT.

Electron is the cross-platform mainline shell. On Windows, the repository also keeps a native `TranslateTer.exe` entry executable that owns the app window through WebView2, loads the built web frontend, starts the C++ backend, and shuts the backend down when the entry program exits.

## Quick Start

```powershell
npm install
npm run dev
```

The desktop worker is an Electron + React + TypeScript + Vite app. `npm run dev` starts the Electron shell with the renderer UI; `npm run build` type-checks and emits production bundles under `out/`. `package.json` points both Electron's `main` field and electron-builder's `files` list at that same production output.

Windows-only native unzip-and-run package:

```powershell
npm run native:package
dist\native\TranslateTer.exe
```

The native package contains one user-facing entry executable plus local app files:

```text
dist/native/
  TranslateTer.exe
  WebView2Loader.dll
  app/
    frontend/
    backend/translate-ter-backend.exe
    resources/whisper-manifest.json
```

`TranslateTer.exe` starts and supervises the backend automatically. Closing the entry program closes the backend too. The first native host slice injects a temporary frontend adapter so the web UI can render in WebView2; the next slice should wire that adapter to the native backend protocol instead of mock preview data.

Run tests:

```powershell
npm test
```

Platform verification helper:

```powershell
npm run verify:platform
```

Native backend skeleton:

```powershell
npm run native:configure
npm run native:build
```

`npm run native:build` always configures CMake first. On Windows it builds both `translate-ter-backend` and the WebView2 native host. On macOS/Linux it only builds `translate-ter-backend`, so `apps/native-host` and `windows.h` are never compiled there.

Platform-specific backend helper paths:

- Windows: `build\native\bin\translate-ter-backend.exe --health`
- macOS/Linux: `./build/native/bin/translate-ter-backend --health`

Electron packaging stays cross-platform:

```powershell
npm run package:electron
```

On macOS/Linux, `npm run native:package` now exits with a clear Windows-only message instead of attempting to build the WebView2 host.

## ASR Runtime Docs

- [ASR runtime architecture](docs/asr-runtime-architecture.md)
- [Platform validation checklist](docs/platform-validation.md)
- [Native protocol contract](contracts/native-protocol.md)

This repository intentionally has no initial commit yet. The coordinating agent will decide when the reviewed baseline is ready to commit.

## Current MVP Shape

- Electron main/preload/renderer are separated with a narrow `window.translateTer` API.
- The preload contract exposes the frontend workflow calls `selectVideo`, `startTranscription`, `startTranslation`, `exportSrt`, `getSettings`, and `saveSettings`; ASR now crosses the native backend boundary unless the explicit `mock.asr` dev provider is selected.
- The renderer is a single-page Apple-inspired workflow surface: media import, ASR settings, local/cloud provider selection, model status, subtitle preview/editing table, translation provider/target language, progress, retry/error status, language switching, and SRT export.
- Renderer cannot read provider secrets or run native binaries directly.
- ASR defaults to `local.whisper.cpp`; cloud ASR is represented as an explicit opt-in provider interface.
- Shared subtitle data uses a stable `Segment`/`SubtitleSegment` shape with `id`, `index`, `startMs`, `endMs`, source/translated text, status, and notes.
- SRT parsing/writing keeps cue boundaries in milliseconds and translation only mutates text by stable segment id.
- Translation policy includes provider priority/failover, separate token-bucket request/token limits, fixed/linear/exponential retry backoff plus jitter, circuit breaker state, concurrent batch scheduling, and batch checkpoint records. A mock provider supports deterministic tests and offline workflow checks.
- ASR has a provider-neutral abstraction plus a local `whisper.cpp` provider id. Whisper runtime/model handling includes platform/arch/accelerator manifest design, cache path resolution, SHA-256 verification expectations, and atomic install hooks. The checked-in manifest is a disabled sample; users or CI must supply a pinned manifest before downloads/execution are considered configured.
- C++ backend is a buildable CLI boundary with `--health` and a newline-delimited JSON stdio protocol for `runtime.health`, `srt.parse`, `srt.serialize`, and typed runtime-required `asr.transcribe` errors.

## Layout

```text
apps/desktop/src/main      Electron main, IPC, job/provider/runtime services
apps/desktop/src/preload   contextBridge API
apps/desktop/src/renderer  React UI and i18n resources
apps/desktop/src/shared    Contracts, SRT model/parser/writer, translation core
apps/native-host           Windows-only Win32/WebView2 entry executable
backend/cpp                Native backend CLI skeleton
contracts                  Protocol notes
resources                  Whisper runtime/model manifest
scripts                    Native dependency and packaging helpers
```

## Known Gaps

Real whisper.cpp downloads, model hashes, ffmpeg integration, and full provider SDK adapters remain behind stable interfaces. The dev app simulates ASR output only when `mock.asr` is selected. Provider secrets are persisted by Electron main with `safeStorage` encrypted userData files when available, and renderer settings never include secret values.
