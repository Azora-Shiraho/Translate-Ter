# Translate-Ter

*[English](#english) | [简体中文](#简体中文)*

---

## English

Translate-Ter is a Windows-first subtitle workflow app for importing media, producing subtitles with local-first ASR, translating subtitle segments through provider-neutral LLM adapters, and exporting SRT.

The current migration target is a native Windows entry executable. `TranslateTer.exe` owns the app window through WebView2, loads the built web frontend, starts the C++ backend, and shuts the backend down when the entry program exits. Electron remains available as a development/reference shell while the native host reaches feature parity.

### Quick Start

```powershell
npm install
npm run dev
```

The desktop worker is an Electron + React + TypeScript + Vite app. `npm run dev` starts the Electron shell with the renderer UI; `npm run build` type-checks and emits production bundles under `out/`. `package.json` points both Electron's `main` field and electron-builder's `files` list at that same production output.

Native unzip-and-run package:

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

Native backend skeleton:

```powershell
npm run native:configure
npm run native:build
build\native\bin\translate-ter-backend.exe --health
```

This repository intentionally has no initial commit yet. The coordinating agent will decide when the reviewed baseline is ready to commit.

### Current MVP Shape

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

### Layout

```text
apps/desktop/src/main      Electron main, IPC, job/provider/runtime services
apps/desktop/src/preload   contextBridge API
apps/desktop/src/renderer  React UI and i18n resources
apps/desktop/src/shared    Contracts, SRT model/parser/writer, translation core
apps/native-host           Native Win32/WebView2 entry executable
backend/cpp                Native backend CLI skeleton
contracts                  Protocol notes
resources                  Whisper runtime/model manifest
scripts                    Native dependency and packaging helpers
```

### Known Gaps

Real whisper.cpp downloads, model hashes, ffmpeg integration, and full provider SDK adapters remain behind stable interfaces. The dev app simulates ASR output only when `mock.asr` is selected. Provider secrets are persisted by Electron main with `safeStorage` encrypted userData files when available, and renderer settings never include secret values.

---

## 简体中文

Translate-Ter 是一个以 Windows 为首要平台的字幕工作流应用，支持导入媒体文件、使用本地 ASR（自动语音识别）生成字幕、通过中立的 LLM 适配器翻译字幕片段，并导出 SRT 文件。

当前的迁移目标是原生 Windows 入口可执行文件。`TranslateTer.exe` 通过 WebView2 接管应用窗口，加载构建好的 Web 前端，启动 C++ 后端，并在入口程序退出时关闭后端。在原生宿主达到功能对等之前，Electron 仍可作为开发和参考外壳使用。

### 快速开始

```powershell
npm install
npm run dev
```

桌面端是一个 Electron + React + TypeScript + Vite 应用。`npm run dev` 启动带有渲染器 UI 的 Electron 外壳；`npm run build` 执行类型检查并在 `out/` 目录下生成生产构建。`package.json` 中的 Electron 的 `main` 字段和 electron-builder 的 `files` 列表都指向相同的生产输出目录。

原生免安装绿色包：

```powershell
npm run native:package
dist\native\TranslateTer.exe
```

原生包包含一个面向用户的入口可执行文件以及本地应用文件：

```text
dist/native/
  TranslateTer.exe
  WebView2Loader.dll
  app/
    frontend/
    backend/translate-ter-backend.exe
    resources/whisper-manifest.json
```

`TranslateTer.exe` 会自动启动并监督后端。关闭入口程序也会同时关闭后端。第一个原生宿主切片注入了一个临时前端适配器，使得 Web UI 可以在 WebView2 中渲染；下一个切片应将该适配器连接到原生后端协议，而不是使用模拟的预览数据。

运行测试：

```powershell
npm test
```

原生后端框架：

```powershell
npm run native:configure
npm run native:build
build\native\bin\translate-ter-backend.exe --health
```

此代码库目前故意没有初始提交。协调代理将决定审查后的基线何时准备好提交。

### 当前 MVP 形态

- Electron main/preload/renderer 通过狭窄的 `window.translateTer` API 进行隔离。
- Preload 契约暴露了前端工作流调用 `selectVideo`、`startTranscription`、`startTranslation`、`exportSrt`、`getSettings` 和 `saveSettings`；ASR 现在跨越原生后端边界，除非显式选择了 `mock.asr` 开发者提供程序。
- 渲染器是一个受苹果设计风格启发的单页工作流界面：包括媒体导入、ASR 设置、本地/云提供商选择、模型状态、字幕预览/编辑表、翻译提供商/目标语言、进度、重试/错误状态、语言切换和 SRT 导出。
- 渲染器无法直接读取提供商密钥或运行原生二进制文件。
- ASR 默认为 `local.whisper.cpp`；云 ASR 作为明确的选择性加入提供商接口展示。
- 共享的字幕数据使用稳定的 `Segment`/`SubtitleSegment` 结构，包含 `id`、`index`、`startMs`、`endMs`、源/翻译文本、状态和备注。
- SRT 解析/写入保持时间轴边界以毫秒为单位，且翻译仅根据稳定的片段 ID 修改文本。
- 翻译策略包括提供商优先级/故障转移、独立的令牌桶请求/令牌限制、固定/线性/指数重试回退加上抖动、断路器状态、并发批处理调度和批处理检查点记录。Mock 提供程序支持确定性测试和离线工作流检查。
- ASR 具有提供商中立的抽象，外加一个本地 `whisper.cpp` 提供商 ID。Whisper 运行时/模型的处理包括平台/架构/加速器清单设计、缓存路径解析、SHA-256 验证预期以及原子安装钩子。检入的清单是一个被禁用的示例；在考虑下载/执行已配置之前，用户或 CI 必须提供固定的清单。
- C++ 后端是一个可构建的 CLI 边界，支持 `--health` 以及用于 `runtime.health`、`srt.parse`、`srt.serialize` 和强类型的且为运行时所需的 `asr.transcribe` 错误的换行符分隔 JSON 标准输入输出协议。

### 目录结构

```text
apps/desktop/src/main      Electron 主进程，IPC，任务/提供商/运行时服务
apps/desktop/src/preload   contextBridge API
apps/desktop/src/renderer  React UI 和 i18n 资源
apps/desktop/src/shared    契约，SRT 模型/解析器/写入器，翻译核心
apps/native-host           原生 Win32/WebView2 入口可执行文件
backend/cpp                原生后端 CLI 框架
contracts                  协议说明
resources                  Whisper 运行时/模型清单
scripts                    原生依赖和打包辅助工具
```

### 已知差距

真正的 whisper.cpp 下载、模型哈希、ffmpeg 集成和完整的提供商 SDK 适配器仍然落后于稳定接口。仅当选择 `mock.asr` 时，开发应用才会模拟 ASR 输出。当可用时，提供商密钥由 Electron 主进程通过 `safeStorage` 加密的 userData 文件持久化，渲染器设置绝不包含密钥值。
