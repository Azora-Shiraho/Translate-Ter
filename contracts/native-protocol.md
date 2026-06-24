# Native Backend Protocol MVP

Electron main owns the native process boundary. Renderer code never spawns the
C++ backend and never receives provider secrets or runtime credentials.

The development backend supports:

```text
translate-ter-backend --health
translate-ter-backend --stdio-json
```

`--stdio-json` uses newline-delimited JSON. Each stdin line is one request and
each stdout line is one response.

## Request

```json
{
  "protocolVersion": 1,
  "requestId": "uuid-or-counter",
  "type": "runtime.health",
  "payload": {}
}
```

Known command types:

- `runtime.health`
- `media.probe`
- `audio.extract`
- `asr.transcribe`
- `srt.parse`
- `srt.serialize`
- `job.cancel`

## Response

```json
{
  "protocolVersion": 1,
  "requestId": "uuid-or-counter",
  "type": "runtime.health",
  "ok": true,
  "payload": {}
}
```

Errors are typed and do not use placeholder success:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid-or-counter",
  "type": "asr.transcribe",
  "ok": false,
  "error": {
    "code": "DownloadRequired",
    "message": "Verified whisper.cpp runtime/model files are not available to the native backend.",
    "retryable": false,
    "details": {}
  }
}
```

Error codes used by the MVP skeleton:

- `MissingRuntime`
- `DownloadRequired`
- `RuntimeNotVerified`
- `ManifestNotConfigured`
- `UnsupportedCommand`
- `MalformedRequest`
- `InternalError`

## Implemented Commands

`runtime.health` returns native protocol version, backend version, capability
names, acceleration status, and whether a verified whisper runtime is available.
Current development builds report `whisperRuntimeAvailable: false` because
Electron main, not the backend, owns manifest download and SHA-256 verification.
It also reports `ffmpegAvailable` and `ffprobeAvailable` from the native
process PATH.

The payload now includes `accelerators`, an array describing native accelerator
variants that the backend can report:

```json
[
  {
    "variant": "cuda",
    "hardwareDetected": true,
    "runtimeDetected": true,
    "supported": true,
    "message": "Optional human-readable detail."
  },
  {
    "variant": "metal",
    "hardwareDetected": false,
    "runtimeDetected": false,
    "supported": false
  },
  {
    "variant": "vulkan",
    "hardwareDetected": false,
    "runtimeDetected": false,
    "supported": false
  }
]
```

For CUDA, `hardwareDetected` and `runtimeDetected` are lightweight best-effort
signals split from the existing probes; `supported` follows the existing backend
CUDA detection logic for compatibility. Metal and Vulkan may conservatively
report `supported: false` until the backend grows dedicated detection. The
legacy fields `cudaSupported`, `hardwareAcceleration`, and
`recommendedLocalAcceleration` remain part of `runtime.health` for compatibility
and must not be removed by clients.

`media.probe` accepts:

```json
{
  "mediaPath": "D:/video/input.mp4",
  "ffprobePath": "D:/tools/ffprobe.exe"
}
```

`ffprobePath` is optional. If omitted, the backend searches PATH for `ffprobe`.
The successful payload includes `tool`, `ffprobePath`, and `raw`, where `raw`
is ffprobe JSON from `-show_format -show_streams`. If the input is missing or
ffprobe cannot be found, the command returns a typed error instead of a mock
probe result.

`audio.extract` accepts:

```json
{
  "jobId": "job-123",
  "mediaPath": "D:/video/input.mp4",
  "outputDir": "D:/tmp/translate-ter/job-123/audio",
  "ffmpegPath": "D:/tools/ffmpeg.exe",
  "sampleRate": 16000,
  "channels": 1,
  "format": "wav",
  "audioCodec": "pcm_s16le",
  "segmentSeconds": 600,
  "startMs": 0,
  "durationMs": 0
}
```

`ffmpegPath`, `outputDir`, `sampleRate`, `channels`, `format`, `audioCodec`,
`segmentSeconds`, `startMs`, and `durationMs` are optional. Defaults are mono
16 kHz PCM WAV output in the OS temp directory. When `segmentSeconds` is
positive, ffmpeg writes numbered segment files and the response returns a
`files` array with `path`, `index`, `startMs`, optional `durationMs`, and
`sizeBytes`. When `segmentSeconds` is zero or omitted, a single audio file is
returned.

`srt.parse` accepts:

```json
{
  "srt": "1\n00:00:01,000 --> 00:00:02,000\nHello\n"
}
```

It returns a `document` payload with parsed segments.

`srt.serialize` accepts segment-like objects in the request payload with
`startMs`, `endMs`, and `sourceText`. Optional `variant` values are `source`,
`translated`, and `bilingual`; optional `bilingualOrder` values are
`source-first` and `target-first`. It then returns:

```json
{
  "srt": "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n"
}
```

`asr.transcribe` accepts:

```json
{
  "jobId": "job-123",
  "mediaPath": "D:/video/input.wav",
  "modelId": "ggml-base",
  "sourceLanguage": "auto",
  "targetLanguage": "zh-CN",
  "asrProviderId": "local.whisper.cpp",
  "runtime": {
    "provider": "whisper.cpp",
    "variant": "cpu",
    "binaryPath": "D:/userData/runtime/whisper/bin/whisper-cli.exe",
    "modelPath": "D:/userData/runtime/whisper/models/ggml-base.bin",
    "libraryPaths": ["D:/userData/runtime/whisper/bin"],
    "env": {
      "WHISPER_CACHE_DIR": "D:/userData/runtime/whisper/cache"
    }
  },
  "binaryPath": "D:/userData/runtime/whisper/bin/whisper-cli.exe",
  "modelPath": "D:/userData/runtime/whisper/models/ggml-base.bin",
  "preferCuda": false,
  "ffmpegPath": "D:/tools/ffmpeg.exe",
  "outputDir": "D:/tmp/translate-ter/job-123/asr"
}
```

`runtime.provider` currently accepts `whisper.cpp`, `faster-whisper`, `mlx`,
and `coreml` at the contract level, but the C++ backend only executes
`whisper.cpp`. Other providers return `UnsupportedCommand` and must keep using
their existing Electron main services.

`runtime.variant` supports `cpu`, `cuda`, `metal`, and `vulkan`. For
`whisper.cpp`, the backend treats `cpu` as a forced CPU run and adds `-ng` to
the CLI command. For `cuda`, `metal`, and `vulkan`, it does not add `-ng`. If
`runtime.variant` is missing, the backend falls back to the legacy `preferCuda`
flag and preserves existing behavior.

`runtime.libraryPaths` and `runtime.env` are optional runtime launch hints for
Electron main to pass through. The backend uses them only to augment the native
child process environment; it does not resolve downloads, manifests, or trust.

Legacy compatibility remains enabled:

- `preferCuda` may still be sent and still works as the fallback selector when
  `runtime.variant` is absent.
- `runtime.binaryPath` and `runtime.modelPath` from the older nested structure
  still work.
- top-level `binaryPath` and `modelPath` still work and are preserved for
  compatibility.

Electron main must assemble the `runtime` object and must only send managed
executable or model paths after manifest pinning, local file existence checks,
and SHA-256 verification. The current exception is a darwin-arm64 system
`whisper-cli`, which may be sent after a successful executable probe. Renderer
code does not assemble runtime internals. The native backend checks existence
but does not trust or download assets.

For `local.whisper.cpp` on `darwin-arm64`, the initial `metal` runtime path may
also come from a system `whisper-cli` discovered on `PATH`. This does not add
new protocol fields: Electron main still sends the same `runtime.provider`,
`runtime.variant`, `runtime.binaryPath`, and `runtime.modelPath`. The only
difference is trust policy inside Electron main: managed runtimes stay
SHA-256-pinned, while a system `metal` runtime is accepted only after an
executable probe succeeds and is not auto-downloaded or unpacked by the app.

For `local.whisper.cpp`, the backend invokes whisper.cpp CLI with `-osrt` and
parses the generated SRT into the shared subtitle document shape. Non-WAV input
is converted to mono 16 kHz WAV with ffmpeg before transcription. If ffmpeg is
missing and the input is not WAV, the command returns `MissingRuntime`.

`mock.asr` remains the only provider allowed to return mock subtitles. It is
used for development UI fallback and is explicit in the request.

## Runtime Download Strategy

The checked-in `resources/whisper-manifest.json` is enabled for the current
validation flow. Windows CPU/CUDA runtime entries and model entries already use
real URLs plus pinned SHA-256 values. The managed Linux/macOS runtime entries
still contain placeholder metadata until verified distribution URLs and hashes
are supplied.

Electron main is responsible for:

- selecting the platform entry and requested model;
- requiring user consent before network downloads;
- downloading to a temporary file;
- verifying SHA-256 against the manifest;
- atomically moving verified files into `userData/runtime/whisper`;
- assembling the runtime payload and passing verified `binaryPath`,
  `modelPath`, optional `runtime.libraryPaths`, optional `runtime.env`, and
  optional `ffmpegPath` to the backend.

The backend returns `DownloadRequired` or `MissingRuntime` when verified paths
are absent. It does not fetch URLs from the manifest and does not execute
unverified paths.

`job.cancel` acknowledges cancellation for protocol wiring; long-running native
task cancellation will be attached when ASR/media commands become persistent.
