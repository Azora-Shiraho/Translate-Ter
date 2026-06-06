# Translate-Ter C++ Backend

This directory is the native process boundary for local media and ASR work. The MVP provides a buildable CLI with `--health` so Electron can detect protocol compatibility.

```powershell
cmake -S backend/cpp -B backend/cpp/build
cmake --build backend/cpp/build --config Release
backend\cpp\build\Release\translate-ter-backend.exe --health
```

Planned commands over stdin/stdout JSON:

- `runtime.health`
- `media.probe`
- `audio.extract`
- `asr.transcribe`
- `srt.parse`
- `srt.serialize`
- `job.cancel`

whisper.cpp will be integrated as an adapter behind `asr.transcribe`. Electron main remains responsible for manifest selection, download consent, SHA-256 verification, and atomic installation before any runtime binary is executed.
