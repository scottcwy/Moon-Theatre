# 聊天延迟优化 Spec 2：moderated-buffered 改增量放行

日期：2026-08-12
状态：draft（revision 2，已按 2026-08-12 复审修订，待复审冻结）
修订号：2
适用版本：聊天体验迭代 V1.1 之后
变更标识：chat-streaming-incremental-output

## 1. 文档目的与冻结边界

本文档冻结「客户端首字渲染从『整轮完成』提前到『生成开始』」的实现边界。它改变 API 对客户端的流式输出时序，**不改变 done 事件字段、不改变消息落库、不改变计费与幂等**。

冻结：
- 客户端可见的流式输出时序（status/delta 提前下发）；
- 输出审核（`checkOutput`）与增量放行的关系；
- 客户端超时与断流提示。

revision 1 澄清（依据 2026-08-12 审核）：done 事件**仅新增可选 `content` 字段**（仅 blocked 场景携带，用于客户端刷新为修正后全文），既有字段语义不变；「不改变 done 事件字段」冻结边界相应修订为「不改变既有字段、允许新增可选字段」。

不冻结：增量分块粒度、具体渲染动画（前端可迭代）。

## 2. 现状与证据

- 代码：`apps/api/src/server/modules/chat/stream-runner.ts`（`createGenerationResponse`：`controller.enqueue(status)` → 全量生成 → sanitize/parseMood → scope 分类（Spec 1）→ checkOutput → finalize → 单个 delta + done）；`apps/miniapp/src/services/api.ts`（`streamChat` 已支持 `onChunkReceived` 逐 chunk 解析，`CHAT_STREAM_REQUEST_TIMEOUT_MS=130000`）。
- 审计证据（592 条真实样本）：**100% single delta，TTFT == 总时长**。基线口径（2026-08-12 审核澄清，验收以此为准）：
  - 客户端整轮等待：script P50 5.7s / P90 9.3s / max 18.0s（n=246）；free P50 3.3s / P90 5.2s（n=198）。
  - 服务端 `totalUntilDone`：DS P50 4.7s / P90 8.3s / max 20.1s（n=460）；Qwen 更差（mean 8.0s / P90 20.2s）。
  - 输出过滤 `blocked=true` **0 命中**（n=514+）。
- 已知风险：E2E 观测「partial 断流 25s 无错误提示」；客户端 130s 超时 vs 上游 120s 窗口仅 10s。

## 3. 目标与非目标

目标：
- 客户端首字/首段在生成早期到达（目标 TTFT ≤1.5s，P50）；
- 断流/超时在 15s 内有明确提示；
- 保留关键词输出过滤能力（当前 0 命中，风险低但能力不删）。

非目标：
- 不做逐 token 服务端存储/重建；
- 不改 FastClaw adapter 的流协议；
- 不引入 WebSocket/SSE 以外的传输（继续 ndjson over HTTP）。

## 4. 设计

### 4.1 推荐方案

1. **审核后移 + 增量放行（首选）**：
   - `createGenerationResponse` 维护 `sentContent` 累积变量：收到 FastClaw 每个 delta 后先经 `sanitizeAssistantOutput` 行级清理（仅剥离内部标签行，不做整段缓冲），追加进 `sentContent` 并立即 `controller.enqueue({type:'delta', content: chunk})`。
   - 首个 delta 到达时把 status 事件的 `mode:'moderated_buffered'`（现 `stream-runner.ts:511`）改为 `'incremental_buffered'`，与 `X-Stream-Mode` 头变更同步（见 4.3 共享头说明）。
   - `checkOutput(sentContent)` 在生成完成后对「已发送全文」复核：命中时追加 `{type:'delta', content:'（内容已按安全规则调整）'}`，done 携带 `blocked:true` 与可选 `content`。**契约（revision 2 明确）：`done.content` == 落库 `finalContent`（修正后全文，不含修正提示句）**；修正提示 delta 只是「刷新前」的过渡展示，客户端 onDone 收到 `content` 后以 `content` 为准覆盖气泡（提示语义不再进入气泡内容；如需提示可短暂 toast，不落内容）。落库以 `finalContent` 为准（现状 `stream-runner.ts:641` 逻辑保留）。
2. **尾部缓冲（次选）**：只缓冲最后 N=200 字符，前段增量放行，末尾拼接后过 `checkOutput`；命中则整段替换为兜底（回退到近似现状，但前段已展示，需客户端支持替换——复杂度高于方案 1）。
3. **最小改动（保底）**：保持全量缓冲，但在生成开始即下发 `{type:'status', stage:'generating'}`（已有）+ 客户端把「正在输入…」改为「角色正在回应…」；TTFT 不变。此方案只作为无法改服务端时的兜底，不满足本 Spec 目标，不建议采用。

### 4.2 代码位置

- 服务端：`apps/api/src/server/modules/chat/stream-runner.ts`（`createGenerationResponse` 输出段）；`apps/api/src/server/modules/moderation/service.ts`（`checkOutput` 增加异步/增量入口，保持既有同步接口兼容）。
- 客户端：`apps/miniapp/src/services/api.ts`（`streamChat`：done 前已能处理多个 delta；增加「无数据心跳」计时：15s 内无任何 chunk 且未 done 时 `onError('stream_stalled')`）；`apps/miniapp/src/pages/chat/index.tsx`（`getFriendlyStreamErrorMessage` 增加 `stream_stalled` 文案；断流时若已展示部分内容则保留 + 显示「回复被中断，已为你保留以上内容」，可 `reconcileFailedSend` 恢复）。
- 超时：`CHAT_STREAM_REQUEST_TIMEOUT_MS` 130000 → 150000（配合 FastClaw 上游 `FASTCLAW_TIMEOUT_MS=120000`，`apps/api/src/server/config/index.ts:13` + 网络余量）。

### 4.3 行为变化

- 客户端：生成中可见增量文本（打字指示在首字后消失）；断流/超时出现明确错误卡片；`onDelta` 多次触发（前端 `updateAssistantPlaceholder` 已支持追加，需确认滚动/字数上限）。
- 服务端：`X-Stream-Mode` 头与 status 事件 `mode` 值由 `moderated-buffered` 改为 `incremental-buffered`。注意 `STREAM_HEADERS`（`stream-runner.ts:44-49`）被 replay/error/blocked 等所有流式响应共用，改动影响全部流式响应头，需同步 `docs/api-v1.md` 观测口径（客户端不依赖该头）。
- done 事件：仅 blocked 场景新增可选 `content`（修正后全文），其余场景字段不变。
- 输出过滤命中率基线 0/514——若后续命中，按 4.1-1 的修正提示语义处理，不阻断已展示内容（产品需接受该取舍，见第 8 节风险）。

## 5. 验证矩阵

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| 客户端 TTFT ≤1.5s（P50，script 口径） | 复用审计脚本 `lib.mjs streamChat` 记录 firstDeltaAtMs；真实 DeepSeek ≥30 样本 | 对比基线 script P50 5.7s |
| blocked 命中时客户端展示与落库一致 | 单测 + 真实样本：done.content 到达后气泡内容 == messages API 落库内容 | vitest + C 段断言 |
| 老版本客户端兼容 | 老包仅按 delta 追加、忽略未知字段；用 `phase-c-mock` 验证无报错 | C 段 UI |
| 多 delta 到达且内容完整（**非 blocked 场景**，revision 2 限定） | 客户端记录 deltas 数量 >1 且拼接 == done 落库内容；blocked 场景按 done.content 契约单独断言 | 对比 messages API |
| 断流（partial 后 destroy）15s 内出现错误提示 | 单测 + `phase-c-mock` `partial-then-disconnect` 场景 | C 段 UI 断言 |
| blocked 关键词仍可拦截 | 插入 blocked 关键词样本，确认修正提示出现且落库不含关键词 | vitest + 真实样本 |
| done 事件字段/幂等/计费不变 | 既有 stream-runner/service 测试全绿 + 重放测试 | `pnpm --filter @juben-sha/api test` |
| 无回归 | `pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/miniapp test`、typecheck | CI |

## 5.1 发布与回滚

- 前后端同版本发布（客户端需同时含 `stream_stalled`/done.content 支持）；老客户端对多 delta 追加式兼容、对未知字段忽略，可先于新客户端运行（但无断流提示）。
- 回滚：服务端恢复全量缓冲 + `X-Stream-Mode: moderated-buffered` + 去掉 done.content；客户端保留（对新字段无影响）。无需数据回滚。
- 灰度关注：TTFT P50、`stream_stalled` 触发率、blocked 命中率（预期 ≈0）。

## 6. 并行边界与合并顺序

- 改动文件：`stream-runner.ts`（服务端输出段）、`moderation/service.ts`、`services/api.ts`、`pages/chat/index.tsx`、`index.model.ts`、`__tests__/*`。
- **依赖 Spec 1**：本 Spec 的 `createGenerationResponse` 结构基于 Spec 1 合并后的代码；合并顺序 **Spec 1 → Spec 2**。
- 与 Spec 3 同在 `stream-runner.ts`：本 Spec 输出段（L511/703-720，内部为 `createGenerationResponse`）vs Spec 3 上下文组装段（L329-392，`buildPromptContext`/`createPreparedGenerationResponse`），**函数级不重叠**；合并顺序 Spec 2 之后（保守，避免同文件多段并发 rebase 成本）。
- 与 Spec 4 同在 `stream-runner.ts`：本 Spec 输出段 vs Spec 4 输入预检段（L116/154/204），按段位隔离；与 Spec 5 无重叠。
- 前端改动仅本 Spec（`services/api.ts`、`pages/chat/index.tsx`、`index.model.ts`），Spec 3/4/5 无前端。

> 与 `docs/specs/2026-08-12-chat-audit-nonconflicting-fixes-spec.md`（rev3）共享 `apps/miniapp/src/services/api.ts` 与 `apps/miniapp/src/pages/chat/index.tsx`：看门狗以本 Spec 的 `stream_stalled`（15s）为唯一实现，对方不再新增计时器；批 A（余额刷新/竞态守卫/重复逻辑）与软提示排本 Spec 合入之后。对方工作树中这两文件的改动以「本 Spec 优先、对方增量」方式合入。

## 7. 文档同步

- 实现后更新 `docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md` 第 6 条「输出审核继续采用 moderated-buffered，不恢复逐 token 展示」的表述（本 Spec 冻结后该条作废/修订）；
- `docs/api-v1.md` 流式响应节补充：`stream_stalled` 错误码、`X-Stream-Mode` 新值、done 事件可选 `content` 字段（仅 blocked 场景，语义=落库 finalContent，revision 2）。

## 8. 风险与取舍

- 增量放行意味着「已展示内容可能在复核后被判定需修正」——当前 0 命中，风险低；产品需接受「修正提示」而非「整段撤回」。
- 客户端性能：大段回复逐 chunk 追加渲染，需确认 5000 字输入/300 字回复下无卡顿（真机验证）。

## 9. 修订记录

- revision 0：draft，基于 2026-08-12 夜间审计（`ai-chat-report.md` 2.1/2.2/2.4）与 E2E 断流观测。
- revision 2（2026-08-12，依据复审）：
  - 明确 `done.content` == 落库 `finalContent`（不含修正提示句），修正提示仅作刷新前过渡展示；客户端以 `content` 为准覆盖气泡；
  - 7 节文档同步补 `done.content` 字段的 api-v1.md 更新；
  - 5 矩阵「多 delta 拼接 == 落库」限定为非 blocked 场景；
  - 6 节措辞：与 Spec 3 同文件不同段（函数级不重叠），修订「createPreparedGenerationResponse 周边结构」的错误表述。
- revision 1（2026-08-12，依据 `/tmp/chat-spec-audit-2026-08-12.md` 审核）：
  - 删除不存在的「Spec 7」引用，改为 FastClaw 上游 `FASTCLAW_TIMEOUT_MS=120000`；
  - 闭环「已下发 vs 落库」：blocked 时 done 新增可选 `content`，客户端用其刷新气泡；冻结边界修订为「允许新增可选字段」；
  - TTFT 基线统一为客户端口径（script P50 5.7s / free P50 3.3s），服务端数据另行列出；
  - 补充 `sentContent` 累积、status 事件 `mode` 值变更、`STREAM_HEADERS` 共享影响；
  - 新增 5.1 发布/回滚节与 blocked/老客户端验证用例；验证命令改用 `pnpm --filter`。
