# Translate-Ter C++ Backend

This directory is the native process boundary for local media and ASR work. The
MVP provides a buildable CLI with `--health` and newline-delimited JSON stdio so
Electron can detect protocol compatibility and route local work without exposing
runtime paths to the renderer.

This backend helper is the cross-platform native target. The separate
`apps/native-host` WebView2 window host remains Windows-only.

Related runtime docs:

- `../../docs/asr-runtime-architecture.md`
- `../../docs/platform-validation.md`
- `../../contracts/native-protocol.md`

```powershell
cmake -S backend/cpp -B backend/cpp/build
cmake --build backend/cpp/build --config Release
backend\cpp\build\bin\translate-ter-backend.exe --health
```

From the repository root, `npm run native:build` configures the top-level CMake
project and builds this helper on every platform. On Windows it also builds the
WebView2 native host; on macOS/Linux it skips `apps/native-host` and produces
only `translate-ter-backend`.

Planned commands over stdin/stdout JSON:

- `runtime.health`
- `media.probe`
- `audio.extract`
- `asr.transcribe`
- `srt.parse`
- `srt.serialize`
- `job.cancel`

whisper.cpp is the current native implementation behind `asr.transcribe`.
Electron main remains responsible for manifest selection, download consent,
managed-runtime SHA-256 verification, atomic installation, and the
darwin-arm64 system `whisper-cli` probe exception before handing runtime paths
to this helper.

Implemented native behavior:

- `media.probe` shells out to `ffprobe` from `payload.ffprobePath` or PATH and
  returns raw ffprobe JSON.
- `audio.extract` shells out to `ffmpeg` from `payload.ffmpegPath` or PATH,
  creates mono 16 kHz WAV by default, and can split output with
  `segmentSeconds`.
- `asr.transcribe` accepts only local Whisper requests
  (`asrProviderId=local.whisper*` with `runtime.provider=whisper.cpp`) and
  executes local `whisper.cpp` CLI paths. Non-WAV input is pre-extracted
  through ffmpeg.
- `srt.parse` and `srt.serialize` keep subtitle timing and bilingual export
  wiring available even when native runtimes are missing.
- `mock.asr` remains an Electron/app-layer fallback and is not implemented by
  this native helper.

The checked-in `resources/whisper-manifest.json` is enabled for current
validation. Windows CPU/CUDA runtime entries and model entries already point to
real URLs with pinned SHA-256 values. The managed Linux/macOS runtime entries
still use placeholder metadata, and darwin-arm64 may instead rely on a system
`whisper-cli` that is trusted by executable probe rather than SHA-256
verification.
