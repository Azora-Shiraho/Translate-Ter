# Issue #16 批量处理与多窗口同步计划

本文档跟踪 issue #16 的整体实现范围。当前分支作为整个 issue 的集成分支，后续子 PR 按层级合并回来。

## 目标范围

- 引入真正的多文件批量处理能力，让多个媒体文件可以入队后由后台按队列自动完成转写、翻译和导出前准备。
- 为独立设置窗口准备 Main 侧窗口管理和设置变更广播能力，后续 Renderer 可以订阅设置变化并同步主题、语言和配置状态。
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
- 当前采用串行队列，避免 `job.cancel` / `cancelRunningWork` 的全局 native 取消语义误伤并发任务。
- 设置保存后由 Main 侧广播 `settings:event`，为后续独立设置窗口同步主题、语言和配置状态提供基础。

## 非 PR2 范围

- Renderer 批量处理页面。
- Preload 与 renderer gateway 的最终用户可见接入。
- 设置独立窗口的 React 页面实现。
- UI 样式、导航和交互细节。
- C++ native protocol 新命令。批量队列应复用现有 `runtime.health`、`media.probe`、`audio.extract`、`asr.transcribe`、`srt.parse`、`srt.serialize` 和 `job.cancel` 边界。
