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
- `ManifestNotConfigured`
- `UnsupportedCommand`
- `MalformedRequest`
- `InternalError`

## Implemented Skeleton

`runtime.health` returns native protocol version, backend version, capability
names, acceleration status, and whether a verified whisper runtime is available.
Current development builds report `whisperRuntimeAvailable: false`.

`srt.parse` accepts:

```json
{
  "srt": "1\n00:00:01,000 --> 00:00:02,000\nHello\n"
}
```

It returns a `document` payload with parsed segments.

`srt.serialize` accepts segment-like objects in the request payload with
`startMs`, `endMs`, and `sourceText`, then returns:

```json
{
  "srt": "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n"
}
```

`asr.transcribe` currently validates that runtime/model paths are supplied and
then returns `DownloadRequired` until Electron main provides checksum-verified
whisper.cpp runtime and model files. It must not return successful mock
transcripts.

`media.probe` and `audio.extract` return `MissingRuntime` until ffmpeg or an
equivalent local media tool is configured.

`job.cancel` acknowledges cancellation for protocol wiring; long-running native
task cancellation will be attached when ASR/media commands become persistent.
