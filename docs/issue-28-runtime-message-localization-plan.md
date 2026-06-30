# Issue #28 runtime message localization plan

关联 issue: Closes #28

## 背景

Issue #28 目标是让运行时检测、provider 连通性、资产下载、任务进度、批量队列和警告面板里的用户可见文案跟随当前 UI 语言，同时保留原始技术诊断信息。

对照 `docs/architecture.md`、`contracts/native-protocol.md`、`docs/logging.md` 和 `docs/asr-runtime-architecture.md` 后，本 PR 草案采用如下边界：

- Renderer 负责用户可见文本、本地化和降级展示。
- Electron Main、provider adapter 和资产服务负责产出稳定的机器可读状态、错误分类和技术细节。
- Native backend 继续只执行本地工具和协议命令，不感知 UI language，不新增本地化命令。
- 日志和诊断细节使用结构化 `details` / `technicalMessage`，不把调试信息压进用户文案。

## 方案决策

不长期采用 issue 正文里的 `message: string` 内嵌 JSON 方案。该方案虽然改动小，但会让 `ProviderHealth.message`、`AssetEvent.message`、`JobEvent.message`、`BatchQueueItem.message`、`SubtitleWarning.message` 同时承担人类可读文本和协议载体两种语义。

推荐新增共享消息描述结构，并保持旧字段兼容：

```ts
export type UserMessageDescriptor = {
  messageKey: string;
  messageParams?: Record<string, string | number | boolean | null | undefined>;
  technicalMessage?: string;
  details?: Record<string, unknown>;
};
```

各共享模型先追加可选字段，不删除旧 `message`：

- `ProviderHealth.userMessage?: UserMessageDescriptor`
- `AssetEvent.userMessage?: UserMessageDescriptor`
- `JobEvent.userMessage?: UserMessageDescriptor`
- `JobSnapshot.error.userMessage?: UserMessageDescriptor`
- `BatchJobItemSnapshot.userMessage?: UserMessageDescriptor`
- `BatchJobItemSnapshot.error.userMessage?: UserMessageDescriptor`
- `BatchQueueEvent.userMessage?: UserMessageDescriptor`
- `SubtitleWarning.userMessage?: UserMessageDescriptor`

Renderer 统一使用 `resolveUserMessage(value, t)`：

1. 优先读取 `userMessage.messageKey` 并用 `messageParams` 调 `t()`。
2. 其次读取旧 `message`，对已知 legacy 静态文案做兼容映射。
3. 最后原样 fallback，避免旧事件或第三方错误丢失信息。
4. 诊断区域或详情面板展示 `technicalMessage` / `details`，普通 Toast 和状态卡只展示友好文案。

## 前端需要处理

### 1. 统一 resolver

建议位置：`apps/desktop/src/renderer/app/displayHelpers.ts` 或相邻模块。

需要实现：

- `resolveUserMessage(input, t, fallbackKey?)`
- `resolveTechnicalMessage(input)`
- legacy raw string 到 i18n key 的兼容映射
- 参数插值覆盖测试
- 无 key、未知 key、损坏 legacy payload 的 fallback 测试

### 2. 接入所有展示入口

需要把以下 raw `message` 展示改为统一 resolver：

- `apps/desktop/src/renderer/app/App.tsx`
  - `pushToast`
  - `pushStatus`
  - 全局 `reportUiError` 结果
- `apps/desktop/src/renderer/app/SettingsApp.tsx`
  - 设置页 Toast / status
  - `Loading Settings...` 改为 `t('loadingSettings')`
- `apps/desktop/src/renderer/viewModels/useSettingsViewModel.ts`
  - `AssetEvent` 下载、校验、解压、ready/error 文案
  - `ProviderHealth.message`
  - FFmpeg / whisper / faster-whisper runtime 状态
- `apps/desktop/src/renderer/viewModels/useWorkspaceViewModel.ts`
  - `JobEvent.message`
  - `JobSnapshot.error.message`
  - workflow warning 派生信息
- `apps/desktop/src/renderer/viewModels/useBatchViewModel.ts`
  - `BatchQueueEvent.message`
  - `BatchQueueItem.message`
  - `BatchQueueItem.error.message`
- `apps/desktop/src/renderer/viewModels/useProviderStatusViewModel.ts`
  - provider card、runtime card、workspace rail detail
- `apps/desktop/src/renderer/components/status/WarningPanel.tsx`
  - warning 列表和详情里的 `SubtitleWarning.message`
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx`
  - step 4 折叠态 `Ready` 改为 `t('ready')`

### 3. 补齐 i18n 词条

建议在 `apps/desktop/src/shared/i18n.ts` 同步补齐 `en-US` / `zh-CN`：

- 现有缺项：`exportDirectory`、`noDirectorySelected`、`loadingSettings`、`ffmpegPartialDetail`
- provider health：API key 缺失、Base URL 缺失、连接超时、凭据拒绝、限流、HTTP 状态错误、未知网络错误
- asset event：下载开始、下载进度、校验、解压、ready、完整性校验失败、HTTP 下载失败
- faster-whisper：本地环境缺失、模型下载失败、缓存不可写、CUDA 不可用、GPU fallback 到 CPU
- job/batch：导入、探测、音频提取、ASR、翻译、导出、取消、失败、完成
- warning：字幕解析、时间轴错误、空文本、翻译 fallback、segment alignment、provider failure

## 后端 / Main 需要处理

### 1. 共享类型演进

修改 `apps/desktop/src/shared/models.ts`：

- 新增 `UserMessageDescriptor`
- 为上述事件、状态和错误类型增加可选 `userMessage`
- 保留旧 `message` 字段作为兼容 fallback
- 更新 `apps/desktop/src/shared/types.ts` re-export

### 2. 生产者逐步迁移

需要优先迁移这些生产者，让它们产出结构化 `userMessage`：

- `apps/desktop/src/main/services/providerHealth.ts`
  - 不再返回硬编码中文 `请先填写 API Key。`
  - `code` / HTTP status 用于稳定分类
  - 原始 response / error 放入 `technicalMessage` 或 `details`
- `apps/desktop/src/main/services/fasterWhisperService.ts`
  - runtime health、CUDA 检测、安装/下载事件、runner 错误都产出 key
  - Python/subprocess 原始 stderr 保留为技术细节
- `apps/desktop/src/main/services/whisperAssets.ts`
  - runtime/model 下载、校验、解压、ready/error 事件产出 key
- `apps/desktop/src/main/services/ffmpegAssets.ts`
  - FFmpeg 下载、校验、解压、ready/error 事件产出 key
- `apps/desktop/src/main/services/jobManager.ts`
  - progress/error/warning 产出 key，失败时保留原始错误
- `apps/desktop/src/main/services/batchJobQueue.ts`
  - item 状态、导出中、取消、失败事件产出 key
- `apps/desktop/src/shared/srt.ts`
  - 字幕解析 warning 产出 key，原始 block index / timestamp 放 params 或 details
- `apps/desktop/src/shared/translation/scheduler.ts`
  - provider circuit、重试耗尽、batch 失败 warning 产出 key
- `apps/desktop/src/shared/translation/providers.ts`
  - API key 缺失等 provider validation 产出稳定 key

### 3. Main 进程系统对话框

`apps/desktop/src/main/index.ts` 仍有系统对话框标题、按钮、错误提示硬编码英文。因为系统对话框由 Main 直接展示，建议：

- Main 只读取当前公开设置里的 `uiLanguage`
- 在 Main 侧新增很小的 dialog 文案映射表
- 范围限定在 Electron 系统对话框标题、按钮、确认文案
- 不把通用 UI 本地化逻辑下沉到 provider/native

## Native protocol 需要处理

Native protocol 保持兼容，不新增命令，不让 C++ backend 读取 UI language。

如果 native error 需要携带更友好的上层展示上下文，可以复用 `NativeProtocolError.details`：

```json
{
  "code": "DownloadRequired",
  "message": "Verified whisper.cpp runtime/model files are not available to the native backend.",
  "retryable": false,
  "details": {
    "messageKey": "runtime.downloadRequired",
    "params": {
      "provider": "whisper.cpp"
    },
    "technicalMessage": "Verified whisper.cpp runtime/model files are not available to the native backend."
  }
}
```

Electron Main 再把 `details.messageKey` 映射成 `UserMessageDescriptor`。如果没有 details，继续用 `code` 或 `message` fallback。

## 验收标准

- 切换 `en-US` / `zh-CN` 后，Toast、状态卡、批量队列、warning panel、provider 检测结果不再混用语言。
- 用户主界面展示友好文案，原始 HTTP / subprocess / Python / native 错误仍能在详情、诊断区域或日志里找到。
- `message` legacy 字段仍可被旧事件和未迁移生产者消费。
- 不新增 native command，不让 native backend 或 provider adapter 依赖 UI 语言。
- `npm run test` 通过，至少覆盖 resolver、i18n 缺项和关键事件映射。

## 建议落地顺序

1. 补齐硬编码 UI 文案和缺失词条。
2. 新增 `UserMessageDescriptor` 和 Renderer `resolveUserMessage`，先兼容旧 raw string。
3. 迁移 `ProviderHealth`、`AssetEvent`、`JobEvent` / `JobSnapshot.error`、`BatchQueueEvent`、`SubtitleWarning` 生产者。
4. 在 warning/detail/diagnostics 区域展示 `technicalMessage` 和必要结构化 `details`。
5. 补测试并做中英文手动验证。

## 非目标

- 不在本 issue 中重构 provider registry 或 native runtime selection。
- 不新增 Native protocol command。
- 不删除现有 `message` 字段。
- 不要求 C++ backend 或 provider adapter 返回按 UI 语言翻译后的自然语言。
