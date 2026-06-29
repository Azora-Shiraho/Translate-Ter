# Issue #16 批量处理与多窗口同步计划

本文档跟踪 issue #16 的整体实现范围。当前分支作为整个 issue 的集成分支，后续子 PR 按层级合并回来。

## 目标范围

- 引入真正的多文件批量处理能力，让多个媒体文件可以入队后由后台按队列自动完成转写、翻译和导出。
- 为后续独立设置窗口预留 Main 侧设置变更广播能力，等 renderer 具备独立入口后再接上窗口生命周期和页面同步。
- 保持现有架构分层：Renderer 通过 gateway/view-model 访问桌面 API，Electron Main 负责权限、IPC、任务编排和 native 进程边界，C++ native backend 只执行既有本地能力命令。

## PR 拆分

- PR1：整个 issue 的草稿集成 PR，从 `codex/issue-16-batch-workflow` 合并到 `develop`。
- PR2：Electron Main 到 C++ native backend 的后端部分，从 `codex/issue-16-main-native-batch` 合并到 PR1 分支。

## 后端子范围

PR2 只处理 Electron Main 到 C++ native backend 相关内容：

- Main 侧批量队列服务、队列快照和事件模型。
- Main IPC handler 注册与内部事件广播。
- 单文件任务复用现有 `JobManager`，不把 provider 或 native 调用细节重新吸收到队列层。
- 取消与错误隔离策略。
- 设置更新后的 Main 侧多窗口广播基础设施。
- 相关架构文档更新和 Main/service 层测试。

## PR2 后端设计记录

- `BatchJobQueue` 是 Electron Main 服务，不下沉到 C++ native backend。
- 队列 item 保存单文件请求快照，执行时复用现有 `JobManager.create/start/translate`。
- 队列事件使用 `BatchQueueSnapshot` 和 `BatchQueueEvent`，Main 侧通过 `batch:event` 广播给所有存活窗口。
- 成功的批量 item 会在队列层触发自动导出，复用 Main 侧既有字幕导出链路，并在重名时自动避让而不是静默覆盖。
- 当前采用串行队列，避免 `job.cancel` / `cancelRunningWork` 的全局 native 取消语义误伤并发任务。
- 设置保存后由 Main 侧广播 `settings:event`，为后续独立设置窗口同步主题、语言和配置状态提供基础；窗口入口本身不在当前后端子 PR 中提前暴露。

## 非 PR2 范围

- Renderer 批量处理页面。
- Preload 与 renderer gateway 的最终用户可见接入。
- 设置独立窗口的 React 页面实现。
- UI 样式、导航和交互细节。
- C++ native protocol 新命令。批量队列应复用现有 `runtime.health`、`media.probe`、`audio.extract`、`asr.transcribe`、`srt.parse`、`srt.serialize` 和 `job.cancel` 边界。

## PR3 前端子范围

PR3 从 `codex/frontend-batch-workflow` 合并到 PR1 分支，负责所有 Renderer 和 Preload 层面的接入工作。

### 第一阶段：API 桥接 & 多窗口入口

- **Preload 桥接**：在 `preload/index.ts` 中新增 `batch` 命名空间（`addJobs`、`start`、`cancel`、`get`、`onEvent`）和 `settings.onEvent`、`window.openSettings` 通道。
- **Gateway 同步**：在 `api/translateTerGateway.ts` 中镜像同步上述所有新通道。
- **Main 多窗口**：在 `main/index.ts` 中新增 `createSettingsWindow()` 函数和 `window:open-settings` IPC handler，支持从主窗口打开独立的原生设置窗口。
- **构建配置**：在 `electron.vite.config.ts` 中将 renderer 入口从单文件改为字典模式（`index.html` + `settings.html`），并新增 `settings.html` 和 `settingsEntry.tsx` 作为设置窗口的渲染入口。

- **主侧边栏简化**：移除原有的 "设置" 路由视图，改为通过 IPC 打开独立窗口。

### 第二阶段：UI 页面实现（已完成）

- **原生设置窗口**：在 `settingsEntry.tsx` 挂载完整的 `SettingsApp` React 组件，采用侧边栏分页布局（常规、任务、识别、翻译），并通过 `settings:event` 实现跨窗口主题/语言同步。
- **重构 SettingsView**：将长达 700 行的庞大 `SettingsView.tsx` 重构为基于 `activeTab` 状态的现代化 (Sidebar + Content) 布局结构，摒弃了原有的单页超长滚动模式。
- **批量任务中心**：在主界面 `App.tsx` 侧边栏新增 "批量处理" 导航项，挂载新建的 `BatchQueueView` 页面，支持文件入队、队列控制和实时进度展示，相关数据由 `useBatchViewModel` 驱动。
- **国际化 (i18n)**：为新增的批量任务界面和导航项增加了中英双语的翻译键值，确保 UI 文案完整支持多语言。
