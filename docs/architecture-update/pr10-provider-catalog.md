# PR10：Provider catalog 与设置 UI 配置化

## 合并方向

- Base：`架构更新`
- Head：`arch-update/pr10-provider-catalog`
- Milestone：`架构更新-M2-provider扩展`
- 依赖：PR8, PR9
- 建议标签：`architecture`, `frontend`, `provider`, `test-required`

## 目标

建立共享 provider catalog，让 provider 元数据、设置字段和 UI 渲染来源统一。这个 PR 只建立契约和 UI 配置化，不迁移 Main 侧 provider 实现细节。

## 负责内容

新增：

```text
apps/desktop/src/shared/providers/
  types.ts
  catalog.ts
  catalog.test.ts
```

catalog 需要覆盖现有 provider：

- `local.whisper.cpp`
- `local.faster-whisper`
- `cloud.openai`
- `openai.compatible`
- `mock.local`
- `mock.asr`，如当前代码仍需显式开发 provider 描述

Provider 描述建议字段：

```ts
type ProviderCatalogEntry = {
  id: string;
  kind: 'asr' | 'translation';
  runtimeKind: 'local' | 'cloud' | 'mock';
  labelKey: string;
  descriptionKey: string;
  secretFields: ProviderSecretField[];
  defaultBaseUrl?: string;
  defaultModel?: string;
  supportsHealthCheck: boolean;
  supportsLocalRuntime: boolean;
  requiresBackend: boolean;
  visibleInSettings: boolean;
  visibleInWorkflow: boolean;
};
```

## 实施步骤

1. 新增 `shared/providers/types.ts` 定义 catalog 类型。
2. 新增 `shared/providers/catalog.ts` 注册当前内置 provider。
3. 增加测试：
   - provider id 唯一。
   - 每个可见 provider 有 `labelKey` 和 `descriptionKey`。
   - secret field key 只允许 `apiFormat`、`baseUrl`、`apiKey`、`model` 等已支持字段。
   - 默认 ASR provider 和默认翻译 provider 存在。
4. 修改 Renderer 设置页 provider 列表来源：
   - ASR provider 列表从 catalog 过滤 `kind === 'asr'`。
   - 翻译 provider 列表从 catalog 过滤 `kind === 'translation'`。
   - Provider API 表单从 `secretFields` 渲染。
5. 保留当前设置值和 secret 存储结构。
6. 不修改 Main 的 health check 分支，最多只复用 catalog 常量做 id 校验。

## 限制范围

允许修改：

```text
apps/desktop/src/shared/providers
apps/desktop/src/renderer/components/settings
apps/desktop/src/renderer/viewModels
apps/desktop/src/renderer/i18n.ts
apps/desktop/src/renderer/main.tsx
apps/desktop/src/shared/models.ts
```

不允许修改：

```text
apps/desktop/src/main/services/jobManager.ts
apps/desktop/src/main/services/nativeBackendClient.ts
backend/cpp
contracts/native-protocol.md
resources/whisper-manifest.json
```

不允许做：

- 不新增真实 provider。
- 不改变 provider 请求行为。
- 不改变 secret 文件格式。
- 不改变 settings schemaVersion。
- 不把 provider HTTP 调用放到 Renderer。
- 不引入运行时动态加载 provider。

## 验证方法

必须运行：

```powershell
npm test
npm run build
```

人工验证：

- 设置页 ASR provider 列表和当前版本一致。
- 设置页翻译 provider 列表和当前版本一致。
- `cloud.openai` 和 `openai.compatible` 的 baseUrl/apiKey/model 字段仍能显示和保存。
- 切换 provider 后健康检查按钮仍能触发现有 Main IPC。

Review checklist：

- catalog 是共享元数据，不包含 secret 值。
- Renderer 不硬编码 provider 表单字段。
- provider id 没有大小写漂移。
- mock provider 不会被误设为生产默认 provider。
