# PR13：架构更新总集成 PR

## 合并方向

- Base：`develop`
- Head：`架构更新`
- Milestone：`架构更新-M4-总集成`
- 依赖：PR8, PR9, PR10, PR11, PR12
- 建议标签：`architecture`, `test-required`

## 目标

把 PR8 到 PR12 的改动作为一个完整架构更新合并回 `develop`。这个 PR 不引入新的重构主题，只做集成、冲突处理、验证、文档收口和必要的小修。

## 负责内容

- 解决 `架构更新` 与 `develop` 的冲突。
- 确认文档和实际代码结构一致。
- 确认 provider 扩展边界清晰。
- 确认前端页面拆分后行为不变。
- 确认 native backend 边界没有协议漂移。
- 生成中文 release note 草案。

## 实施步骤

1. 从 `develop` 更新 `架构更新`：

```powershell
git switch 架构更新
git fetch origin
git merge origin/develop
```

2. 解决冲突时优先保持：
   - provider catalog 是 provider 元数据来源。
   - Renderer 组件不直接访问 `window.translateTer`。
   - JobManager 不重新吸收 provider 实现细节。
   - native protocol 不被无意修改。
3. 跑完整验证命令。
4. 检查文档：
   - `docs/architecture.md` 是否需要更新为新现状。
   - `docs/asr-runtime-architecture.md` 是否仍准确。
   - `docs/architecture-update/target-architecture.md` 是否已实现或需要标注剩余差异。
5. 准备 PR 描述和 release note 草案。

## 限制范围

允许修改：

```text
docs
apps/desktop/src/renderer
apps/desktop/src/main
apps/desktop/src/shared/providers
apps/desktop/src/shared/translation
backend/cpp
scripts
package.json
vitest.config.ts
```

只允许做集成必要的小修改。

不允许做：

- 不新增 provider。
- 不新增 UI 大功能。
- 不新增 native protocol command。
- 不重做设计系统。
- 不引入新的构建工具。
- 不把未完成的实验性代码合并回 `develop`。

## 验证方法

必须运行：

```powershell
npm test
npm run build
npm run native:build
npm run smoke:native
npm run verify:platform
```

人工回归：

- 应用启动。
- 设置页读写。
- Provider health 检查。
- Whisper 模型列表加载。
- FFmpeg 状态检查。
- SRT 导入。
- SRT 导出。
- ASS 导出。
- 本地 ASR 失败时错误提示可读。
- 翻译 provider 未配置时提示正确。

## PR 描述模板

标题：

```text
架构更新：拆分前端边界并整理 provider/native 能力层
```

摘要：

```text
本 PR 汇总 PR8 到 PR12 的架构更新：Renderer 拆分为 gateway、view-model 和组件层；provider 元数据集中到 catalog，并在 Main 侧通过 registry/adapter 扩展；适合 C++ 的本地媒体、字幕和 whisper.cpp 能力通过 native service 边界调用。目标是降低新增 provider 和后续用户页面改版的耦合成本。
```

验证：

```text
- npm test
- npm run build
- npm run native:build
- npm run smoke:native
- npm run verify:platform
```

中文 release note 草案：

```text
架构更新：拆分前端页面和桌面 API 边界，整理 provider 扩展点，并收敛本地媒体/字幕能力到 native backend 服务边界。现有转写、翻译、字幕导入导出流程保持兼容。
```

Review checklist：

- 系列 PR 的文档链接完整。
- `develop` 合并冲突解决合理。
- 所有验证命令通过。
- release note 使用简体中文。
- 没有把新 provider、UI 大功能或协议变更混入集成 PR。
