# ASR Runtime Architecture

This document records the current local ASR runtime architecture for PR12 validation. It is intentionally descriptive: it documents the existing layering, compatibility behavior, protocol payload, and platform boundaries without changing runtime selection rules, native protocol fields, or backend behavior.

## Scope

- Electron is the cross-platform mainline shell.
- `apps/native-host` is a Windows-only WebView2 native host and is not the cross-platform app path.
- This document covers the local ASR runtime path for `local.whisper.cpp` and how it coexists with other ASR providers.
- This document does not introduce new runtime variants, new manifests, new download flows, or new backend execution providers.

## Layering: Provider vs. Runtime Variant

The current ASR stack has two separate decision layers:

| Layer | Current values | What it controls | What it does not control |
| --- | --- | --- | --- |
| ASR provider | `local.whisper.cpp`, `local.faster-whisper`, `cloud.openai`, `mock.asr` | Which recognition implementation handles the job | Which local binary variant is picked |
| Runtime variant | `cpu`, `cuda`, `metal`, `vulkan` | Which local runtime flavor a local provider prefers | Which provider owns the job |

Current behavior by provider:

- `local.whisper.cpp`: Electron main resolves a local runtime candidate, then sends a native `runtime` payload to the C++ backend.
- `local.faster-whisper`: keeps using the Electron main Python-side service; it consumes the same acceleration preferences, but it does not go through the C++ whisper.cpp runtime resolver.
- `cloud.openai`: ignores local runtime variants because the work is not executed by a local whisper runtime.
- `mock.asr`: remains a development-only fallback and is the only provider allowed to return mock subtitles.

Important boundary:

- The native protocol contract can name `whisper.cpp`, `faster-whisper`, `mlx`, and `coreml` as `runtime.provider`, but the current C++ backend only executes `whisper.cpp`.
- `coreml`, `mlx`, and `tensorrt` are not runtime variants in the current app model.
- `vulkan` already exists in the TypeScript enum as a reserved/experimental placeholder, but it is not part of the currently validated support matrix and should not be treated as an approved platform target in this PR.
- This PR does not add any new `RuntimeVariant` values.

## Settings Compatibility

The runtime preference model is layered on top of legacy CUDA-era fields for backward compatibility.

### Current authoritative fields

| Field | Meaning |
| --- | --- |
| `localAsrAcceleration` | High-level user intent: `auto`, `cpu`, or `gpu` |
| `preferredRuntimeVariant` | Optional local runtime override such as `cpu`, `cuda`, or `metal` |
| `localAsrCompatibilityOverrides.ignoreCudaMismatch` | Explicit compatibility override for CUDA mismatch cases |

### Legacy compatibility fields

| Field | Current role |
| --- | --- |
| `localWhisperUseCuda` | Legacy boolean mirror used to keep older call sites valid |
| `localWhisperIgnoreCudaMismatch` | Legacy mirror of the CUDA mismatch override |

Compatibility rules in the current store/UI flow:

- `localWhisperUseCuda=true` migrates to `localAsrAcceleration='gpu'` plus `preferredRuntimeVariant='cuda'`.
- `localWhisperUseCuda=false` migrates to `localAsrAcceleration='cpu'` plus `preferredRuntimeVariant='cpu'`.
- Explicit new fields win over the legacy boolean when both are present.
- `localAsrAcceleration='auto'` keeps `preferredRuntimeVariant` unset.
- When the new fields map exactly to the old boolean shape, they mirror back:
  - `gpu + cuda` mirrors `localWhisperUseCuda=true`
  - `cpu + cpu` mirrors `localWhisperUseCuda=false`
- Non-legacy variants such as `metal` keep the new fields authoritative and preserve the existing legacy boolean instead of forcing a lossy rewrite.
- `localAsrCompatibilityOverrides.ignoreCudaMismatch` and `localWhisperIgnoreCudaMismatch` stay mirrored.

This lets old request paths keep working while newer code can distinguish:

- intent: `auto` vs. forced `cpu` vs. forced `gpu`
- variant: `cuda` vs. `metal`
- compatibility override: ignore or honor CUDA version mismatch

## RuntimeResolver Responsibility

The current whisper runtime resolution flow is split between asset/probe code and pure selection code.

### `WhisperAssetManager`

`apps/desktop/src/main/services/whisperAssets.ts` is responsible for:

- reading and probing the manifest/runtime candidates
- checking local files and SHA-256 for managed runtimes/models
- optionally detecting a system `whisper-cli`
- building runtime capability input such as CUDA/Metal availability
- calling the resolver with concrete candidate state

### `whisperRuntimeResolverAdapter.ts`

`apps/desktop/src/main/services/whisperRuntimeResolverAdapter.ts` is the compatibility boundary that:

- uses `resolveWhisperRuntimeRequestOptions()` to translate `preferCuda`,
  `localAsrAcceleration`, `preferredRuntimeVariant`, and the legacy CUDA
  compatibility flag into one normalized resolver input
- uses `resolveWhisperRuntimeSelection()` to normalize the current manifest
  shape, select the requested model, and delegate the actual
  pick/fallback decision to `resolveRuntime()`

### `resolveRuntime()`

`apps/desktop/src/main/services/runtimeResolver.ts` is responsible for:

- filtering candidates by `platform` and `arch`
- honoring `localAsrAcceleration` and `preferredRuntimeVariant`
- preferring GPU variants only when capability probes say they are selectable
- falling back to CPU when the preferred GPU path is missing, incompatible, or unavailable
- returning:
  - `platformKey`
  - selected `variant`
  - resolved binary/model path hints
  - `hardwareDetected` / `runtimeDetected`
  - `fallbackReason`
  - warnings such as CUDA version mismatch
  - `actionRequired`

The resolver does not:

- download files
- verify hashes itself
- mutate settings
- change native protocol fields
- execute the backend

## Native Protocol Runtime Payload

When the selected provider is `local.whisper.cpp`, Electron main builds the payload in `apps/desktop/src/main/services/nativeTranscribePayload.ts` and sends both:

- a nested `runtime` object for the native protocol
- top-level `binaryPath` and `modelPath` for legacy compatibility

Current shape:

```json
{
  "binaryPath": "D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe",
  "modelPath": "D:/runtime/whisper_cpp/models/ggml-base.bin",
  "runtime": {
    "provider": "whisper.cpp",
    "variant": "cuda",
    "binaryPath": "D:/runtime/whisper_cpp/cuda/Release/whisper-cli.exe",
    "modelPath": "D:/runtime/whisper_cpp/models/ggml-base.bin"
  }
}
```

Notes:

- `runtime.provider` is currently `whisper.cpp` on the active native execution path.
- `runtime.variant` remains `cpu`, `cuda`, `metal`, or `vulkan` at the contract level.
- `libraryPaths` and `env` are optional launch hints only.
- The C++ backend still accepts older top-level and nested path fields for compatibility.

## NativeHealth Accelerators

`runtime.health` includes both legacy summary fields and the newer `accelerators` array.

Current `NativeHealth` accelerator entries:

- `cuda`
- `metal`
- `vulkan`

Current meaning:

- `cuda`: best-effort split between hardware detection and runtime detection, with `supported` following the current backend CUDA support logic.
- `metal`: present in the payload, but the C++ backend still reports detection as not implemented.
- `vulkan`: present in the payload, but the C++ backend still reports detection as not implemented.

Compatibility rules:

- `cudaSupported`, `hardwareAcceleration`, and `recommendedLocalAcceleration` remain part of `runtime.health`.
- Clients must keep reading those legacy fields while adopting `accelerators`.
- `accelerators` is a diagnostic surface, not a manifest resolver or download policy.

## Current Platform Support Boundary

### Electron mainline

- Electron remains the cross-platform app path on Windows, macOS, and Linux.
- `package:electron` is the cross-platform packaging path.

### Windows

- Baseline local path: `local.whisper.cpp` with CPU runtime.
- Optional accelerator path: CUDA when the machine has supported NVIDIA hardware, local CUDA runtime files, and a matching/pinned CUDA runtime candidate.
- The checked-in manifest already pins Windows CPU/CUDA managed runtime entries and model entries with real URLs plus SHA-256 values.
- WebView2 native host packaging exists only on Windows.

### macOS

- Initial validated GPU path is Apple Silicon `metal` using a system `whisper-cli` found on `PATH`.
- That system binary is accepted through an executable probe (`--help`), not through SHA-256 pinning.
- The checked-in managed macOS runtime entry is still a placeholder path and is not the validated install path in this PR.
- WebView2 native host is not built on macOS.

### Linux

- Baseline local path is CPU-oriented backend/electron validation.
- The checked-in managed Linux runtime entry still uses placeholder download metadata and is not a fully pinned managed install path yet.
- WebView2 native host is not built on Linux.

### CPU fallback

CPU fallback is part of the current selection behavior, not a separate provider:

- Windows CUDA can fall back to CPU when GPU runtime files are missing or incompatible.
- macOS Metal can fall back to CPU selection logic when the system `whisper-cli` probe fails.
- CPU fallback depends on the resolver seeing a CPU-capable local path; this PR documents the current behavior but does not change manifest contents or fallback rules.

## Known Limitations

- CUDA and Metal both require matching hardware plus a usable local runtime on the machine.
- macOS and Linux do not build the WebView2 native host.
- System `whisper-cli` is trusted by executable probe only; it is not SHA-256 verified by the app.
- The checked-in manifest is enabled and already pins Windows CPU/CUDA runtime entries plus model entries, but managed macOS/Linux runtime entries are still incomplete placeholders rather than fully pinned install targets.
- This PR does not promote Vulkan, Core ML, MLX, or TensorRT into the validated runtime matrix.

## Related Files

- `apps/desktop/src/shared/models.ts`
- `apps/desktop/src/main/services/settingsStore.ts`
- `apps/desktop/src/main/services/whisperRuntimeResolverAdapter.ts`
- `apps/desktop/src/main/services/runtimeResolver.ts`
- `apps/desktop/src/main/services/whisperAssets.ts`
- `apps/desktop/src/main/services/nativeTranscribePayload.ts`
- `backend/cpp/src/runtime/health.h`
- `contracts/native-protocol.md`
