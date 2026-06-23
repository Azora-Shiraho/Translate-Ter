# Platform Validation Checklist

This checklist is for validating the current cross-platform local ASR runtime documentation and smoke path without changing business behavior, download logic, or native runtime selection rules.

## Validation Principles

- Electron is the cross-platform mainline.
- Windows WebView2 native host is Windows-only.
- `native:build` validates the cross-platform C++ backend everywhere, and additionally validates the WebView2 host on Windows.
- `package:electron` remains the cross-platform packaging path.
- macOS Metal is currently an optional system `whisper-cli` path on Apple Silicon.
- CUDA and Metal are optional accelerators, not required baselines.
- Vulkan, Core ML, MLX, and TensorRT are future-extension topics and are not part of the validated matrix for this checklist.

## Common Commands

Run from the repository root:

```powershell
npm test
npm run build
npm run native:build
```

If the lightweight helper exists:

```powershell
npm run verify:platform
```

Optional packaging boundary check:

```powershell
npm run package:electron
```

## Expected Platform Boundaries

| Area | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Electron shell | Supported mainline | Supported mainline | Supported mainline |
| WebView2 native host | Supported | Not built | Not built |
| `native:build` | Builds backend + WebView2 host | Builds backend only | Builds backend only |
| `package:electron` | Supported | Supported | Supported |
| `native:package` | Supported | Expected skip | Expected skip |
| Local whisper.cpp baseline | CPU | Documented around system/runtime boundary | CPU |
| Optional accelerator | CUDA | Metal system `whisper-cli` | None in current validated scope |

## Windows CPU Baseline

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run native:build` produces:
  - `build/native/bin/translate-ter-backend.exe`
  - `build/native/bin/TranslateTer.exe`
  - `build/native/bin/WebView2Loader.dll`
- [ ] `npm run verify:platform` succeeds if the helper script is present.
- [ ] Running `build/native/bin/translate-ter-backend.exe --health` returns a valid health payload.
- [ ] The validation result is acceptable even when no GPU runtime is available, because CPU is the baseline path.

## Windows CUDA Optional

- [ ] Validate only on a machine with NVIDIA hardware and a local CUDA runtime.
- [ ] Confirm the runtime path is optional; CPU fallback remains acceptable when CUDA is unavailable or incompatible.
- [ ] Check that the current documentation still describes CUDA as:
  - hardware-dependent
  - runtime-dependent
  - subject to version mismatch handling
- [ ] Do not treat this checklist as permission to change `RuntimeResolver`, `NativeHealth`, or download behavior.

Recommended local spot checks:

```powershell
build\native\bin\translate-ter-backend.exe --health
npm run verify:platform
```

Expected outcome:

- `runtime.health` may report CUDA diagnostics through `accelerators`.
- Missing CUDA runtime files or mismatched CUDA versions should still leave CPU fallback as the safe outcome.

## macOS Metal System `whisper-cli` Optional

- [ ] Validate only on Apple Silicon when testing the Metal path.
- [ ] `npm run native:build` builds `translate-ter-backend` only.
- [ ] Confirm `apps/native-host` is not part of the macOS build.
- [ ] If testing Metal, ensure `whisper-cli` is already available on system `PATH`.
- [ ] Confirm the documentation states that the app trusts this path through an executable probe, not SHA-256 verification.
- [ ] Confirm CPU fallback remains the documented outcome when the system `whisper-cli` probe fails.

Recommended local spot checks:

```bash
./build/native/bin/translate-ter-backend --health
npm run verify:platform
whisper-cli --help
```

Expected outcome:

- Metal is optional.
- No WebView2 host is built.
- The system `whisper-cli` path is probe-based only.

## Linux CPU Baseline

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run native:build` produces `build/native/bin/translate-ter-backend`.
- [ ] `npm run verify:platform` succeeds if the helper script is present.
- [ ] `./build/native/bin/translate-ter-backend --health` succeeds.
- [ ] Confirm the docs keep Linux in the Electron mainline and backend baseline path, without claiming a WebView2 host.

## `native:build` Platform Boundary

- [ ] On Windows, it configures the native build and builds both the backend helper and the WebView2 native host.
- [ ] On macOS/Linux, it configures the native build and builds only the backend helper.
- [ ] No checklist step changes CMake options, target names, or backend behavior.

## `package:electron` Platform Boundary

- [ ] Treat `package:electron` as the cross-platform packaging path.
- [ ] On Windows, expect the script to create a zipped Electron artifact under `dist/`.
- [ ] On macOS/Linux, expect the script to create an unpacked Electron directory package under `dist/`.
- [ ] Do not confuse `package:electron` with the Windows-only `native:package` path.

## Known Limitations To Record

- [ ] CUDA requires supported NVIDIA hardware and local CUDA runtime files.
- [ ] Metal requires Apple Silicon plus a runnable local `whisper-cli`.
- [ ] macOS and Linux do not build the WebView2 native host.
- [ ] System `whisper-cli` is probed by executability and is not SHA-256 verified.
- [ ] This checklist does not validate Vulkan, Core ML, MLX, or TensorRT as supported runtime variants.

## Suggested Evidence To Capture

- command line used
- host OS and architecture
- whether backend `--health` succeeded
- whether optional accelerator prerequisites were present
- whether any fallback behavior was observed
