# PR8：Renderer API gateway 与前端边界准备

## 合并方向

- Base：`架构更新`
- Head：`arch-update/pr08-renderer-gateway`
- Milestone：`架构更新-M1-前端解耦`
- 建议标签：`architecture`, `frontend`, `test-required`

## 目标

建立 Renderer 内部的桌面 API 访问边界，避免页面组件直接散落 `window.translateTer.*` 调用。这个 PR 不做视觉改版，不拆大组件，只先准备可迁移的 API 层和事件订阅边界。

## 负责内容

新增：

```text
apps/desktop/src/renderer/api/translateTerGateway.ts
apps/desktop/src/renderer/api/translateTerGateway.test.ts
apps/desktop/src/renderer/viewModels/useJobEvents.ts
apps/desktop/src/renderer/viewModels/useAssetEvents.ts
```

建议职责：

- `translateTerGateway.ts` 包装 `window.translateTer`，导出稳定函数。
- `useJobEvents.ts` 封装 `window.translateTer.jobs.onEvent`。
- `useAssetEvents.ts` 封装 `window.translateTer.assets.onEvent`。
- 组件仍可暂时保留在 `main.tsx`，但新代码不再直接访问 `window.translateTer`。

## 实施步骤

1. 创建 `renderer/api` 和 `renderer/viewModels` 目录。
2. 在 gateway 中按现有 preload API 分组导出：
   - `settings`
   - `jobs`
   - `assets`
   - `subtitles`
   - `desktop`
   - `native`
   - `logs`
3. 保持参数和返回值完全对齐 preload 类型，不改变 IPC channel。
4. 把 `main.tsx` 中初始化阶段最容易迁移的调用改为 gateway：
   - `getSettings`
   - `assets.listWhisperModels`
   - `settings.getSecret`
   - `assets.ensureFfmpeg`
   - `native.health`
5. 把 job/asset 事件订阅迁移到 hooks，但不改变 UI 行为。
6. 为 gateway 增加 mock 测试，验证调用透传和 unsubscribe 行为。

## 限制范围

允许修改：

```text
apps/desktop/src/renderer/api
apps/desktop/src/renderer/viewModels
apps/desktop/src/renderer/main.tsx
apps/desktop/src/renderer/global.d.ts
vitest.config.ts
```

不允许修改：

```text
apps/desktop/src/main
apps/desktop/src/preload
apps/desktop/src/shared/translation
backend/cpp
contracts/native-protocol.md
resources/whisper-manifest.json
```

不允许做：

- 不改 UI 文案和视觉布局。
- 不新增 provider。
- 不改 IPC channel 名称。
- 不改 `window.translateTer` 暴露结构。
- 不处理 `JobManager` 或 native backend。

## 验证方法

必须运行：

```powershell
npm test
npm run build
```

人工验证：

- 启动 `npm run dev`。
- 打开应用后设置、模型列表、native health、FFmpeg 状态能正常加载。
- job 和 asset 事件订阅没有重复触发。
- 切换设置页和工作台不出现控制台错误。

Review checklist：

- `main.tsx` 中新增代码不再直接调用 `window.translateTer`。
- gateway 没有吞掉错误。
- hooks 在 unmount 时正确 unsubscribe。
- 测试使用 mock，不依赖真实 Electron。
