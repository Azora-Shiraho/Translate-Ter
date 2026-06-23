# Translate-Ter C++ Backend

This directory is the native process boundary for local media and ASR work. The
MVP provides a buildable CLI with `--health` and newline-delimited JSON stdio so
Electron can detect protocol compatibility and route local work without exposing
runtime paths to the renderer.

This backend helper is the cross-platform native target. The separate
`apps/native-host` WebView2 window host remains Windows-only.

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

whisper.cpp will be integrated as an adapter behind `asr.transcribe`. Electron main remains responsible for manifest selection, download consent, SHA-256 verification, and atomic installation before any runtime binary is executed.

Implemented native behavior:

- `media.probe` shells out to `ffprobe` from `payload.ffprobePath` or PATH and
  returns raw ffprobe JSON.
- `audio.extract` shells out to `ffmpeg` from `payload.ffmpegPath` or PATH,
  creates mono 16 kHz WAV by default, and can split output with
  `segmentSeconds`.
- `asr.transcribe` supports explicit `mock.asr` fallback and verified local
  `local.whisper.cpp` CLI paths. Non-WAV input is pre-extracted through ffmpeg.
- `srt.parse` and `srt.serialize` keep subtitle timing and bilingual export
  wiring available even when native runtimes are missing.

The checked-in `resources/whisper-manifest.json` is intentionally disabled.
Replace it with a trusted manifest containing real URLs, file sizes, and
non-zero pinned SHA-256 values before enabling download or execution.
