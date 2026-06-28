# PR9：Renderer 页面、组件和 view-model 拆分

## 合并方向

- Base：`架构更新`
- Head：`arch-update/pr09-renderer-modules`
- Milestone：`架构更新-M1-前端解耦`
- 依赖：PR8
- 建议标签：`architecture`, `frontend`, `test-required`

## 目标

把当前集中的 Renderer 页面拆成应用装配、view-model 和组件模块。重点是前端解耦，不改变业务行为、不新增 provider、不修改后端。

## 负责内容

目标目录：

```text
apps/desktop/src/renderer/app/
  App.tsx

apps/desktop/src/renderer/components/
  workspace/
  settings/
  subtitles/
  status/
  export/

apps/desktop/src/renderer/viewModels/
  useWorkspaceViewModel.ts
  useSettingsViewModel.ts
  useProviderStatusViewModel.ts
```

建议第一批拆分对象：

- ASR 设置区域。
- Provider 设置区域。
- Runtime、FFmpeg、native backend 状态展示。
- 字幕表格。
- 警告面板。
- 导出操作区。

## 实施步骤

1. 创建 `app/App.tsx`，把原 `main.tsx` 中的 `App` 组件移动过去。
2. 保留 `main.tsx` 为 React mount 文件。
3. 把纯展示函数和小组件迁移到 `components/*`。
4. 把初始化、设置更新、provider health、运行时状态推导迁移到 `viewModels/*`。
5. 拆分时每一步保持 TypeScript 编译通过，避免一次性移动过多。
6. 保持现有 CSS class 名称，除非必须修正局部命名冲突。
7. 保持 i18n key 不变。

## 限制范围

允许修改：

```text
apps/desktop/src/renderer/main.tsx
apps/desktop/src/renderer/app
apps/desktop/src/renderer/components
apps/desktop/src/renderer/viewModels
apps/desktop/src/renderer/styles.css
apps/desktop/src/renderer/i18n.ts
```

不允许修改：

```text
apps/desktop/src/main
apps/desktop/src/preload
apps/desktop/src/shared/models.ts
apps/desktop/src/shared/translation
backend/cpp
contracts/native-protocol.md
```

不允许做：

- 不改用户流程。
- 不改 provider 选择逻辑。
- 不重命名 IPC API。
- 不把业务逻辑移进组件。
- 不引入新的状态管理库。
- 不做设计重绘。

## 验证方法

必须运行：

```powershell
npm test
npm run build
```

人工验证：

- `npm run dev` 启动正常。
- 工作台默认加载正常。
- 设置页打开、保存、返回工作台正常。
- ASR provider、模型、加速选项、导出设置仍能展示。
- 字幕表格在已有 job snapshot 下仍能选择和编辑。
- 浏览器控制台没有 React key、hook order 或 undefined property 错误。

Review checklist：

- `main.tsx` 只保留 mount 逻辑。
- 新组件文件职责单一。
- view-model 不包含 JSX。
- 组件不直接访问 `window.translateTer`。
- 拆分没有造成 CSS 选择器失效。
