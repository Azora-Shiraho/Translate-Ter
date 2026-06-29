# Translate-Ter

*[English](#english) | [简体中文](#简体中文)*

---

## English

**Translate-Ter** is a local-first desktop subtitle workflow application. It covers the full pipeline from media import to subtitle export: import audio/video files, transcribe speech with ASR engines, edit subtitle segments inline, translate subtitles through LLM providers, and export to SRT or ASS format.

### Features

- **Media Import** — Supports mp4, mov, mkv, mp3, wav, m4a, aac
- **ASR Transcription** — Multiple provider backends:
  - Local [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (GPU acceleration: CUDA / Metal / Vulkan)
  - Local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (Python runner)
  - Cloud OpenAI Whisper API
  - Mock provider for offline development
- **Subtitle Editing** — Inline segment editing with status tracking (new, transcribed, translated, edited, warning, failed)
- **LLM Translation** — Provider-neutral adapter layer with batching, rate limiting, retry/backoff, and circuit breaker
- **Batch Processing** — Serial queue for processing multiple files in one run; per-item status, progress, and error tracking
- **Export** — SRT and ASS formats, with source-only / translated-only / bilingual export modes
- **Multi-Window** — Separate settings window with cross-window state synchronization
- **Internationalization** — Full English and Simplified Chinese UI (375+ translation keys)
- **Secure Secrets** — Provider API keys encrypted via Electron `safeStorage`

### Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 31 |
| Frontend | React 18 · TypeScript · Vite 5 |
| Build | electron-vite · electron-builder |
| Styling | Vanilla CSS |
| Icons | lucide-react |
| i18n | i18next · react-i18next |
| Testing | Vitest |
| Native Backend | C++20 · CMake 3.20+ |
| Native Host | Win32 / WebView2 (Windows only) |
| Audio | FFmpeg / FFprobe |

### Quick Start

```powershell
npm install
npm run dev
```

`npm run dev` launches the Electron shell with hot-reloading renderer UI. `npm run build` type-checks and emits production bundles under `out/`.

### Architecture

```text
React Renderer  →  Preload Bridge (contextBridge)  →  Electron Main  →  C++ Native Backend
```

**Renderer** — React SPA with MVVM-style view models. Communicates exclusively through the `window.translateTer` gateway. Never accesses local files, provider secrets, or native processes directly.

**Preload Bridge** — `contextBridge` exposes a typed API surface organized into namespaces: `desktop`, `jobs`, `batch`, `subtitles`, `settings`, `window`, `assets`, `native`, `logs`. All IPC calls are logged with request/response tracking.

**Electron Main** — Authority for permissions, secrets, filesystem access, and native process management. Hosts service composition: JobManager, BatchJobQueue, SettingsStore, NativeBackendClient, provider registries (ASR + Translation), and asset managers (Whisper, FFmpeg, faster-whisper).

**Native Backend** — C++ CLI communicating over a newline-delimited JSON stdio protocol. Handles `runtime.health`, `media.probe`, `audio.extract`, `asr.transcribe`, `srt.parse`, `srt.serialize`, and `job.cancel`. Does not download runtimes, manage secrets, or call cloud APIs.

### Directory Structure

```text
apps/desktop/src/
├── main/                Electron main process, IPC handlers, service composition
│   ├── services/        JobManager, BatchJobQueue, SettingsStore, NativeBackendClient,
│   │                    WhisperAssetManager, FfmpegAssetManager, FasterWhisperService, etc.
│   └── providers/       ASR & translation provider registries and adapters
├── preload/             contextBridge API (window.translateTer)
├── renderer/
│   ├── app/             App.tsx (main), SettingsApp.tsx (settings window)
│   ├── api/             translateTerGateway — centralized preload access
│   ├── viewModels/      State derivation & event subscription (MVVM)
│   └── components/      workspace, batch, settings, subtitles, export, status
└── shared/              Models, SRT/ASS parsers, i18n strings, translation core,
                         provider catalog, language definitions

apps/native-host/        Windows-only Win32/WebView2 entry executable
backend/cpp/             C++ native backend CLI (CMake project)
contracts/               Native protocol specification
docs/                    Architecture, ASR runtime, batch workflow, logging, platform validation
resources/               Whisper runtime/model manifest, faster-whisper Python runner
scripts/                 Build, package, smoke test, and platform verification helpers
```

### Scripts Reference

| Script | Description |
|---|---|
| `npm run dev` | Start Electron + Vite dev server |
| `npm run build` | Type-check and build production bundles to `out/` |
| `npm test` | Run Vitest test suite |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run package:electron` | Cross-platform Electron packaging via electron-builder |
| `npm run native:deps` | Ensure WebView2 dependencies (Windows) |
| `npm run native:configure` | CMake configure only |
| `npm run native:build` | Build native backend (+ WebView2 host on Windows) |
| `npm run native:package` | Windows-only native unzip-and-run package |
| `npm run smoke:native` | Native backend smoke test |
| `npm run verify:platform` | Platform verification helper |

### Native Build

```powershell
npm run native:build
```

On Windows, this builds both the `translate-ter-backend` binary and the WebView2 native host. On macOS/Linux, only the backend binary is built.

Windows-only native package (unzip-and-run):

```powershell
npm run native:package
dist\native\TranslateTer.exe
```

Backend health check:

```powershell
# Windows
build\native\bin\translate-ter-backend.exe --health
# macOS / Linux
./build/native/bin/translate-ter-backend --health
```

### Testing

The project includes 20+ test files covering services, providers, parsers, and view models:

```powershell
npm test
```

Smoke test for native backend:

```powershell
npm run native:build
npm run smoke:native
```

### Documentation

- [Architecture Overview](docs/architecture.md)
- [ASR Runtime Architecture](docs/asr-runtime-architecture.md)
- [Batch Workflow](docs/issue-16-batch-workflow.md)
- [Logging](docs/logging.md)
- [Platform Validation Checklist](docs/platform-validation.md)
- [Native Protocol Contract](contracts/native-protocol.md)

---

## 简体中文

**Translate-Ter** 是一个本地优先的桌面字幕工作流应用，覆盖从媒体导入到字幕导出的完整流程：导入音视频文件、通过 ASR 引擎语音转文字、内联编辑字幕片段、调用 LLM 翻译字幕，最终导出 SRT 或 ASS 格式。

### 功能特性

- **媒体导入** — 支持 mp4、mov、mkv、mp3、wav、m4a、aac
- **ASR 语音识别** — 多后端提供商：
  - 本地 [whisper.cpp](https://github.com/ggerganov/whisper.cpp)（GPU 加速：CUDA / Metal / Vulkan）
  - 本地 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（Python 运行器）
  - 云端 OpenAI Whisper API
  - Mock 提供商（离线开发用）
- **字幕编辑** — 内联片段编辑，支持状态追踪（新建、已转录、已翻译、已编辑、警告、失败）
- **LLM 翻译** — 提供商中立的适配器层，支持批处理、速率限制、重试退避和熔断器
- **批量处理** — 多文件串行队列处理，逐项追踪状态、进度和错误
- **导出** — SRT 和 ASS 格式，支持仅原文 / 仅译文 / 双语导出模式
- **多窗口** — 独立设置窗口，跨窗口状态同步
- **国际化** — 完整的英文和简体中文界面（375+ 翻译键值）
- **安全密钥存储** — 提供商 API 密钥通过 Electron `safeStorage` 加密

### 技术栈

| 层级 | 技术 |
|---|---|
| 外壳 | Electron 31 |
| 前端 | React 18 · TypeScript · Vite 5 |
| 构建 | electron-vite · electron-builder |
| 样式 | 原生 CSS |
| 图标 | lucide-react |
| 国际化 | i18next · react-i18next |
| 测试 | Vitest |
| 原生后端 | C++20 · CMake 3.20+ |
| 原生宿主 | Win32 / WebView2（仅 Windows） |
| 音频工具 | FFmpeg / FFprobe |

### 快速开始

```powershell
npm install
npm run dev
```

`npm run dev` 启动 Electron 外壳并加载热重载的渲染器 UI。`npm run build` 执行类型检查并在 `out/` 目录生成生产构建。

### 架构

```text
React 渲染器  →  Preload 桥接 (contextBridge)  →  Electron 主进程  →  C++ 原生后端
```

**渲染器** — React 单页应用，采用 MVVM 模式的视图模型。仅通过 `window.translateTer` 网关通信，不直接访问本地文件、提供商密钥或原生进程。

**Preload 桥接** — 通过 `contextBridge` 暴露类型化 API，按命名空间组织：`desktop`、`jobs`、`batch`、`subtitles`、`settings`、`window`、`assets`、`native`、`logs`。所有 IPC 调用均带有请求/响应日志追踪。

**Electron 主进程** — 权限、密钥、文件系统访问和原生进程管理的权威层。托管服务组合：JobManager、BatchJobQueue、SettingsStore、NativeBackendClient、提供商注册表（ASR + 翻译）和资产管理器（Whisper、FFmpeg、faster-whisper）。

**原生后端** — C++ CLI，通过换行分隔的 JSON 标准输入输出协议通信。处理 `runtime.health`、`media.probe`、`audio.extract`、`asr.transcribe`、`srt.parse`、`srt.serialize` 和 `job.cancel`。不负责下载运行时、管理密钥或调用云 API。

### 目录结构

```text
apps/desktop/src/
├── main/                Electron 主进程、IPC 处理器、服务组合
│   ├── services/        JobManager、BatchJobQueue、SettingsStore、NativeBackendClient、
│   │                    WhisperAssetManager、FfmpegAssetManager、FasterWhisperService 等
│   └── providers/       ASR 和翻译提供商注册表及适配器
├── preload/             contextBridge API (window.translateTer)
├── renderer/
│   ├── app/             App.tsx（主应用）、SettingsApp.tsx（设置窗口）
│   ├── api/             translateTerGateway — 集中式 preload 访问层
│   ├── viewModels/      状态派生与事件订阅（MVVM）
│   └── components/      workspace、batch、settings、subtitles、export、status
└── shared/              数据模型、SRT/ASS 解析器、i18n 字符串、翻译核心、
                         提供商目录、语言定义

apps/native-host/        仅 Windows 的 Win32/WebView2 入口可执行文件
backend/cpp/             C++ 原生后端 CLI（CMake 项目）
contracts/               原生协议规范
docs/                    架构、ASR 运行时、批量工作流、日志、平台验证
resources/               Whisper 运行时/模型清单、faster-whisper Python 运行器
scripts/                 构建、打包、冒烟测试和平台验证辅助脚本
```

### 脚本参考

| 脚本 | 说明 |
|---|---|
| `npm run dev` | 启动 Electron + Vite 开发服务器 |
| `npm run build` | 类型检查并构建生产包至 `out/` |
| `npm test` | 运行 Vitest 测试套件 |
| `npm run test:watch` | 以监听模式运行 Vitest |
| `npm run package:electron` | 通过 electron-builder 跨平台打包 Electron 应用 |
| `npm run native:deps` | 确保 WebView2 依赖就绪（Windows） |
| `npm run native:configure` | 仅执行 CMake 配置 |
| `npm run native:build` | 构建原生后端（Windows 上同时构建 WebView2 宿主） |
| `npm run native:package` | Windows 专属的原生免安装绿色包 |
| `npm run smoke:native` | 原生后端冒烟测试 |
| `npm run verify:platform` | 平台验证辅助脚本 |

### 原生构建

```powershell
npm run native:build
```

在 Windows 上，会同时构建 `translate-ter-backend` 二进制文件和 WebView2 原生宿主。在 macOS/Linux 上仅构建后端二进制文件。

Windows 专属原生包（解压即用）：

```powershell
npm run native:package
dist\native\TranslateTer.exe
```

后端健康检查：

```powershell
# Windows
build\native\bin\translate-ter-backend.exe --health
# macOS / Linux
./build/native/bin/translate-ter-backend --health
```

### 测试

项目包含 20 余个测试文件，覆盖服务、提供商、解析器和视图模型：

```powershell
npm test
```

原生后端冒烟测试：

```powershell
npm run native:build
npm run smoke:native
```

### 项目文档

- [架构总览](docs/architecture.md)
- [ASR 运行时架构](docs/asr-runtime-architecture.md)
- [批量工作流](docs/issue-16-batch-workflow.md)
- [日志系统](docs/logging.md)
- [平台验证清单](docs/platform-validation.md)
- [原生协议契约](contracts/native-protocol.md)
