# PR11：Main 侧 provider registry 与 adapter 化

## 合并方向

- Base：`架构更新`
- Head：`arch-update/pr11-main-provider-adapters`
- Milestone：`架构更新-M2-provider扩展`
- 依赖：PR10
- 建议标签：`architecture`, `provider`, `test-required`

## 目标

把 Main 侧 provider 分流从 `JobManager` 和 IPC handler 中抽出来，形成 registry + adapter。新增 provider 时，应优先新增 adapter 和 catalog 条目，而不是继续扩大条件分支。

## 负责内容

新增目录：

```text
apps/desktop/src/main/providers/
  types.ts
  asrProviderRegistry.ts
  translationProviderRegistry.ts
  adapters/
    localWhisperCppAsrProvider.ts
    fasterWhisperAsrProvider.ts
    cloudOpenAiAsrProvider.ts
    openAiCompatibleTranslationProviderFactory.ts
```

建议接口：

```ts
type AsrProviderAdapter = {
  id: string;
  health(): Promise<ProviderHealth>;
  transcribe(request: AsrTranscribeRequest): Promise<SubtitleDocument>;
};

type TranslationProviderFactory = {
  id: string;
  create(): TranslationProvider;
};
```

## 实施步骤

1. 定义 Main provider adapter 类型。
2. 提取 cloud OpenAI ASR 逻辑：
   - 从 `JobManager.transcribeWithCloudAsr` 移到 `cloudOpenAiAsrProvider.ts`。
   - 保持错误码和 retryable 行为不变。
3. 提取 local whisper.cpp ASR adapter：
   - adapter 仍通过 `WhisperAssetManager`、`NativeBackendClient` 和现有 payload builder。
   - 不改变 native request payload。
4. 提取 faster-whisper ASR adapter：
   - adapter 仍通过 `FasterWhisperService`。
   - 保持 runtime option merge 行为不变。
5. 提取 translation provider factory：
   - `openai.compatible` factory 读取 `SettingsStore.getSecret`。
   - `mock.local` 保持测试和 fallback 角色。
6. 修改 `JobManager`：
   - 接收 provider registry 或 provider factory。
   - `start()` 只负责 workflow 顺序，不直接实现 provider HTTP 请求。
   - `translate()` 通过 translation registry 创建 scheduler providers。
7. 修改 `settings:test-provider` IPC：
   - 优先从 provider registry 获取 health。
   - 保留未知 provider 的兼容 fallback。
8. 补充 JobManager 和 registry 单元测试。

## 限制范围

允许修改：

```text
apps/desktop/src/main/index.ts
apps/desktop/src/main/services/jobManager.ts
apps/desktop/src/main/services/providerHealth.ts
apps/desktop/src/main/providers
apps/desktop/src/shared/providers
apps/desktop/src/shared/translation/providers.ts
apps/desktop/src/main/services/*.test.ts
```

不允许修改：

```text
apps/desktop/src/renderer/components
apps/desktop/src/renderer/styles.css
apps/desktop/src/preload/index.ts
backend/cpp
contracts/native-protocol.md
resources/whisper-manifest.json
```

不允许做：

- 不新增真实 provider。
- 不改变 native backend 协议。
- 不改变 whisper runtime 下载和校验。
- 不改变 secret 文件格式。
- 不改变用户可见 provider 名称。
- 不把 provider registry 暴露给 Renderer 直接调用。

## 验证方法

必须运行：

```powershell
npm test
npm run build
```

建议额外运行：

```powershell
npm run verify:platform
```

人工验证：

- `local.whisper.cpp` provider health 行为不变。
- `local.faster-whisper` provider health 行为不变。
- `cloud.openai` 未配置 apiKey 时仍返回 unconfigured。
- `openai.compatible` 未配置 apiKey 时仍返回 unconfigured。
- 翻译仍使用当前 provider priority、并发、RPM、token budget 和 batch 设置。

Review checklist：

- `JobManager` 的 provider 条件分支明显减少。
- adapter 不直接操作 Renderer 状态。
- registry 没有吞掉 provider 错误。
- cloud ASR HTTP 错误码和 retryable 策略保持兼容。
- 测试覆盖本地、云端和未知 provider。
