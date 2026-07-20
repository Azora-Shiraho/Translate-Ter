# 版本号管理规范

Translate-Ter 从 `v2.2.0` 起使用本规范。历史 tag 保留原样，不重写、不补造。

## 1. 版本格式与唯一来源

- 遵循 SemVer：稳定版为 `MAJOR.MINOR.PATCH`，tag 固定添加 `v` 前缀。
- 预发布版仅允许 `alpha.N`、`beta.N`、`rc.N`，例如 `2.3.0-beta.1` / `v2.3.0-beta.1`；序号从 1 开始且只递增。
- `package.json` 是版本号的唯一来源，`package-lock.json` 必须同步，Git tag 必须严格等于 `v` + 包版本。
- 已发布 tag 永不移动或复用。发布修复使用新的 patch 或预发布序号。

## 2. 如何选择 major、minor、patch

先判断兼容性和用户影响，再参考修改规模。代码行数不能覆盖 SemVer 语义。

| 级别 | 必须升级的情况 | 提交标记 | 示例 |
| --- | --- | --- | --- |
| `major` | 删除或改变已有用户能力、配置/数据/IPC/CLI 契约不兼容且没有迁移兼容层 | `type!:` 或正文 `BREAKING CHANGE:` | 旧项目文件无法继续打开 |
| `minor` | 向后兼容的新功能、新工作流、新平台或新的公开配置项 | `feat:` | 新增字幕导出格式 |
| `patch` | 向后兼容的缺陷、性能或回退修复 | `fix:`、`perf:`、`revert:` | 修正浅色主题显示 |
| 不发布 | 仅文档、测试、CI、格式或内部维护，且不改变交付产物行为 | `docs:`、`test:`、`ci:`、`chore:` 等 | 修改开发文档 |

同一发布范围内取最高级别。安全修复按兼容性归入 patch/minor/major，并在 release note 中突出说明。

无法用提交类型准确表达时，PR 必须添加 `release:major`、`release:minor`、`release:patch` 或 `release:none` 结论，并在 squash/merge 提交中使用相应 Conventional Commit。工具在产品代码变化但提交信息不足时会保守建议 patch，并要求人工复核。

## 3. 修改规模与验证强度

工具统计相对当前分支可达的最近稳定版 tag 的已提交变更文件数、增删行数和顶层区域数。生成文件、依赖锁文件可能放大数据，所以规模只决定复核与测试强度，不直接决定版本级别；运行建议前应先提交待评估的工作区改动。

| 规模 | 默认阈值（满足全部条件） | 发布要求 |
| --- | --- | --- |
| small | `<=10` 文件、`<=200` 变更行、`<=2` 区域 | 单元测试 + 受影响平台冒烟 |
| medium | `<=30` 文件、`<=1500` 变更行、`<=4` 区域 | 完整 CI + 全平台构建/冒烟 |
| large | 超出以上范围 | 完整 CI + 全平台发布候选验证 + 人工回归；若仅建议 patch，必须复核遗漏的 feat/breaking 标记 |

## 4. 发布通道

- `alpha.N`：功能或契约仍可能变化，只供开发验证。
- `beta.N`：功能范围冻结，供更广泛测试；本项目默认预发布通道。
- `rc.N`：候选正式版，只接受阻塞发布的修复。
- 稳定版：同一目标版本的最后一个 RC 验证通过后，去掉后缀；不得递增成另一个版本号。

示例：`2.3.0-alpha.1` → `2.3.0-beta.1` → `2.3.0-rc.1` → `2.3.0`。每个通道单独从 1 计数；同一通道继续发布则加 1。

## 5. 标准流程

1. 从 `develop` 查看相对最近稳定 tag 的建议：

   ```powershell
   npm run version:recommend
   # 或显式选择：alpha / beta / rc / stable
   npm run version:recommend -- rc
   ```

2. 人工确认最高兼容性影响和修改规模，再同步版本文件：

   ```powershell
   npm run version:set -- 2.3.0-beta.1
   npm run version:check
   ```

3. 更新简体中文 release note，至少包含：用户可见变化、兼容/迁移说明、已知问题、产物、验证结果。commit 与 release 记录均使用简体中文。
4. 完成 `npm test`、`npm run build`、`npm run native:build`、`npm run smoke:native`；medium/large 变更等待三平台 CI 通过。
5. 合并发布提交后创建带注释 tag。tag 指向的提交中，版本文件和 release note 必须已经就绪：

   ```powershell
   git tag -a v2.3.0-beta.1 -m "发布 2.3.0 beta 1 预发布版本"
   git push origin v2.3.0-beta.1
   ```

6. tag 推送触发发布资产工作流。工作流会在构建前验证 tag 与 `package.json` / `package-lock.json` 一致，不一致则拒绝发布。

## 6. 分支与热修复

- 常规功能进入 `develop`，稳定发布合入 `master`；版本以准备发布的提交为准。
- 正式版紧急修复从对应稳定 tag/master 建分支，只做必要修复，发布下一个 patch（如 `2.2.0` → `2.2.1`），再回合并到 `develop`。
- beta/rc 修复不提升 patch 目标，只增加预发布序号（如 `2.3.0-beta.1` → `2.3.0-beta.2`）。
- 若预发布期间加入新功能，保持目标 minor 版本但回到 beta；若出现不兼容变化，则重新计算 major 目标。
