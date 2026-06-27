# PR12：本地能力 C++ 边界收敛

## 合并方向

- Base：`架构更新`
- Head：`arch-update/pr12-native-local-capabilities`
- Milestone：`架构更新-M3-native边界`
- 依赖：PR11
- 建议标签：`architecture`, `native`, `test-required`, `no-protocol-change`

## 目标

明确并收敛“适合用 C++ 写”的本地能力。原则是：本地工具执行、媒体处理、严格字幕格式处理和 whisper.cpp 执行由 C++ backend 承担；TypeScript 保持编排、设置、密钥、provider HTTP 和 UI 职责。

这个 PR 不追求把所有 TS 工具代码删除，而是先建立 Main 侧 native service 边界，并优先使用已有 native protocol 能力。

## 负责内容

新增或整理：

```text
apps/desktop/src/main/services/nativeSubtitleService.ts
apps/desktop/src/main/services/nativeMediaService.ts
apps/desktop/src/main/services/nativeLocalCapabilityPolicy.ts
```

继续使用已有 native command：

```text
runtime.health
media.probe
audio.extract
asr.transcribe
srt.parse
srt.serialize
job.cancel
```

## 实施步骤

1. 建立 `nativeSubtitleService`：
   - `parseSrt(raw, options)` 调 `NativeBackendClient.parseSrt`。
   - `serializeSrt(document, options)` 优先调 `NativeBackendClient.serializeSrt`。
   - native 返回失败时，不静默 fallback；由调用方决定是否显示错误。
2. 建立 `nativeMediaService`：
   - 包装 `probeMedia` 和 `extractAudio`。
   - 统一错误码到现有 `NativeProtocolResponse` 形态。
3. 修改 Main 侧调用：
   - `subtitles:import-srt` 使用 `nativeSubtitleService.parseSrt`。
   - SRT 导出路径可以使用 `nativeSubtitleService.serializeSrt`。
   - ASS 导出继续使用 TypeScript `serializeAss`，因为 C++ backend 当前没有 ASS serializer。
4. 保留 TypeScript `srt.ts`：
   - 继续作为共享测试工具、fallback 参考或非 native 环境工具。
   - 不在本 PR 删除，避免扩大风险。
5. 增加 native service 测试：
   - mock `NativeBackendClient` 成功返回。
   - mock native 返回 typed error。
   - 验证不会吞掉 native error。
6. 如发现 C++ `srt.serialize` 字段支持不足，优先补 C++ 单元/smoke 覆盖；除非必须，不新增 protocol 字段。

## 限制范围

允许修改：

```text
apps/desktop/src/main/index.ts
apps/desktop/src/main/services/nativeBackendClient.ts
apps/desktop/src/main/services/nativeSubtitleService.ts
apps/desktop/src/main/services/nativeMediaService.ts
apps/desktop/src/main/services/jobManager.ts
backend/cpp/src/subtitle
backend/cpp/src/protocol
backend/cpp/src/media
scripts/smoke-native-backend.mjs
docs/architecture-update
```

不允许修改：

```text
apps/desktop/src/renderer/components
apps/desktop/src/renderer/viewModels
apps/desktop/src/shared/providers
resources/whisper-manifest.json
contracts/native-protocol.md
```

除非另开 PR，不允许做：

- 不新增 native protocol command。
- 不改变 request/response 顶层结构。
- 不把 cloud provider HTTP 请求移到 C++。
- 不让 C++ backend 读取 provider secret。
- 不让 C++ backend 下载 whisper runtime/model。
- 不删除 TypeScript SRT 实现。
- 不把 ASS serializer 下沉到 C++。

## 验证方法

必须运行：

```powershell
npm test
npm run build
npm run native:build
npm run smoke:native
```

建议运行：

```powershell
npm run verify:platform
```

人工验证：

- 导入 SRT 正常。
- 导出 SRT 正常。
- 导出 ASS 正常，且仍走 TypeScript `serializeAss`。
- 未构建 native backend 时，错误提示仍清晰，不出现 undefined crash。
- native backend smoke 中 `srt.parse`、`srt.serialize`、`media.probe`、`audio.extract` 行为保持稳定。

Review checklist：

- Main 侧本地能力通过 service 包装，不直接在多个位置调用 `NativeBackendClient`。
- C++ 修改没有引入协议不兼容。
- TypeScript 仍负责路径选择、错误展示和用户设置。
- C++ 只负责本地确定性能力。
- 所有 native failure 都是 typed error。
