# 架构更新 PR 计划总览

本文档是架构更新系列 PR 的总入口。系列目标是把前端拆开、降低新增 provider 的改动成本，并明确哪些本地能力应该下沉到 C++ backend，而不是继续用 TypeScript 重复实现。

## 分支策略

- 最终集成分支：`架构更新`
- 最终合并目标：`develop`
- 子 PR 合并方向：各子分支合并到 `架构更新`
- 最终 PR 合并方向：`架构更新` 合并到 `develop`

建议子分支命名：

```text
arch-update/pr08-renderer-gateway
arch-update/pr09-renderer-modules
arch-update/pr10-provider-catalog
arch-update/pr11-main-provider-adapters
arch-update/pr12-native-local-capabilities
arch-update/pr13-integration
```

## GitHub 里程碑建议

| Milestone | 包含 PR | 目标 |
| --- | --- | --- |
| `架构更新-M1-前端解耦` | PR8, PR9 | 让页面结构、view-model 和桌面 API 调用解耦。 |
| `架构更新-M2-provider扩展` | PR10, PR11 | 让新增 provider 集中在 catalog 和 adapter。 |
| `架构更新-M3-native边界` | PR12 | 把适合 C++ 的本地能力收敛到 native backend。 |
| `架构更新-M4-总集成` | PR13 | 统一验证、文档收口并合并回 `develop`。 |

建议标签：

```text
architecture
frontend
provider
native
test-required
no-protocol-change
```

## 文档索引

- [目标架构说明](target-architecture.md)
- [PR8：Renderer API gateway 与前端边界准备](pr08-renderer-gateway.md)
- [PR9：Renderer 页面、组件和 view-model 拆分](pr09-renderer-modules.md)
- [PR10：Provider catalog 与设置 UI 配置化](pr10-provider-catalog.md)
- [PR11：Main 侧 provider registry 与 adapter 化](pr11-main-provider-adapters.md)
- [PR12：本地能力 C++ 边界收敛](pr12-native-local-capabilities.md)
- [PR13：架构更新总集成 PR](pr13-integration-merge.md)

## 总体 PR 顺序

```mermaid
flowchart LR
  PR8["PR8<br/>Renderer gateway"]
  PR9["PR9<br/>前端模块拆分"]
  PR10["PR10<br/>Provider catalog"]
  PR11["PR11<br/>Main provider adapters"]
  PR12["PR12<br/>C++ 本地能力边界"]
  PR13["PR13<br/>总集成到 develop"]

  PR8 --> PR9 --> PR10 --> PR11 --> PR12 --> PR13
```

说明：

- PR8 和 PR9 优先处理前端拆分，这是后续页面变更的基础。
- PR10 和 PR11 处理 provider 扩展点，先统一契约，再迁移 Main 侧实现。
- PR12 只处理适合 native backend 承担的本地能力，不处理 provider HTTP 调用和 UI。
- PR13 不引入大功能，只做冲突解决、验证、文档收口和最终合并。

## 架构原则

### 前端修改边界

修改用户页面时，首选改动范围应该是：

```text
apps/desktop/src/renderer/components
apps/desktop/src/renderer/viewModels
apps/desktop/src/renderer/api
apps/desktop/src/renderer/styles.css
apps/desktop/src/renderer/i18n.ts
```

正常页面改版不应该修改：

```text
backend/cpp
contracts/native-protocol.md
apps/desktop/src/main/services/nativeBackendClient.ts
```

### Provider 修改边界

新增 provider 时，首选改动范围应该是：

```text
apps/desktop/src/shared/providers
apps/desktop/src/main/providers
apps/desktop/src/shared/translation/providers.ts
apps/desktop/src/main/services/providerHealth.ts
```

除非新增的是本地工具型 provider，否则不应该修改：

```text
backend/cpp
contracts/native-protocol.md
resources/whisper-manifest.json
```

### TypeScript 与 C++ 职责分配

适合 TypeScript 的内容：

- UI 状态、view-model、表单、i18n。
- Electron IPC、设置、密钥、文件选择、导出路径。
- Provider HTTP adapter、请求重试、限流、熔断、provider failover。
- 工作流编排和 job 状态快照。

适合 C++ 的内容：

- 本地媒体探测和音频抽取。
- 本地工具执行边界，例如 `ffmpeg`、`ffprobe`、`whisper.cpp`。
- 格式严格、和 native protocol 相关的 SRT parse/serialize。
- 长期需要跨 Electron 与 native host 复用的本地能力。

不建议下沉到 C++ 的内容：

- 云端 provider HTTP 调用。
- Provider secret 读取和 safeStorage。
- Renderer 页面状态。
- 业务配置表单。
- LLM 翻译调度策略，除非未来有明确性能瓶颈和跨端复用需求。

## 总体验收标准

完成 PR13 前需要满足：

- `apps/desktop/src/renderer/main.tsx` 不再承担大部分页面细节和状态派生。
- Renderer 通过 gateway/view-model 访问 `window.translateTer`，页面组件不直接散落 IPC 调用。
- Provider 元数据、密钥字段和设置 UI 来源于统一 catalog。
- Main 侧 provider 分流集中在 registry/adapter，不继续扩大 `JobManager` 条件分支。
- 适合 C++ 的本地能力通过 native backend service 边界调用，TypeScript 保持编排职责。
- 现有 ASR、翻译、字幕导入导出和打包路径行为不变。
- `npm test` 和 `npm run build` 通过。
- 涉及 native backend 的 PR 额外通过 `npm run native:build` 和 `npm run smoke:native`。
