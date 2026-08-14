# 聊天延迟优化 Spec 1：scope classifier 去阻塞化

日期：2026-08-12
状态：draft（revision 2，已按 2026-08-12 复审修订，待复审冻结）
修订号：2
适用版本：聊天体验迭代 V1.1 之后
变更标识：chat-latency-scope-classifier

> **修订标注（2026-08-14）**：本 Spec 的 OOS 拦截语义被 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）修订——越界/OOS 不再走 `OUT_OF_SCOPE_FALLBACK` + `excludedFromContext=true` 拦截，改为放行 agent 角色化回复；本 Spec 的 OOS 拦截率承诺需按新口径重评。

## 1. 文档目的与冻结边界

本文档冻结「剧情越界分类（scope classifier）不再阻塞主回复链路」的实现边界。它只解决分类调用的时序、超时与失败语义，**不改变 out_of_scope 的产品语义、不改变 OOS 回复文案、不改变 done 事件契约**（**修订：2026-08-14 架构 Spec 已改变 OOS 产品语义——agent 角色化回复替代 OOS fallback + excluded，本句相应作废**）。

冻结：
- 分类调用在主生成链路上的时序与超时；
- 分类失败/超时后的默认行为；
- 可观测指标（含宽限期放弃计数）。

revision 1 澄清（依据 2026-08-12 审核）：本 Spec **首选方案 A（并行分类，assistantDraft 可选化）**；「不改变 out_of_scope 产品语义」指：OOS 命中仍需退款、`outOfScope=true`、`excludedFromContext=true`。任何方案都不得出现「命中 OOS 但不拦截」的行为（**修订：2026-08-14 架构 Spec 推翻「命中 OOS 必须拦截」——越界/OOS 放行 agent 角色化处理；硬安全拦截 `checkInput.blocked` 除外**）；方案 B 的定位改为「宽限期放弃」，而非「完全不拦截」。

不冻结：分类器 prompt 内容、in_scope/out_of_scope 判定规则本身（Spec 4 会扩展输入预检，与本 Spec 无文件冲突点见第 6 节）。

## 2. 现状与证据

- 代码：`apps/api/src/server/modules/chat/stream-runner.ts`（`createGenerationResponse` 内生成结束后串行调用 `classifyChatScope`）；`apps/api/src/server/modules/chat/scope-classifier.ts`（`Math.min(config.fastclawTimeoutMs, 10_000)` 上限，失败仅 `console.warn` 后按 in_scope 继续——但**先阻塞等完**才继续）。
- 审计证据（真实链路 2026-08-12，见 `apps/miniapp/e2e/artifacts/overnight/ai-chat-report.md` 第 2 节）：
  - scope classifier 单次调用：DeepSeek p50=2.13s / p90=3.80s / max=8.43s（n=95）；Qwen p50=3.35s / p90=10.0s（触顶，n=84）。
  - script 模式 `moderationMs` P50=2116ms vs free 模式 3ms；script 总时长 P50 5.7s vs free 3.3s——分类约占 script 总时长 35–40%。
  - 生产历史日志：`scope_classifier_failed` 48 次（多为 aborted），失败后仍阻塞主链路直到超时。
- 现有单测：`apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`、`scope-classifier` 相关用例。

## 3. 目标与非目标

目标：
- script 模式每轮去掉 2–4s 的串行等待；分类失败/超时不再让用户多等。
- 保持 OOS 召回能力不显著劣化（见验证矩阵）。

非目标：
- 不改变 OOS 兜底文案与 done 事件字段；
- 不引入队列/消息系统；
- 不改 FastClaw vendored 代码。

## 4. 设计

### 4.1 推荐方案（首选方案 A，实现取其一）

1. **方案 A：并行分类 + 宽限期**（首选）：
   - 分类输入改为 `assistantDraft?: string` 可选（见 4.2 签名变更）。生成**前**用「用户消息 + 角色 + 剧本」发起分类请求（无草稿）；生成完成后若分类已返回，取其结果；若分类在 `SCOPE_CLASSIFY_GRACE_MS`（建议 500ms）宽限期内未返回，**放弃等待**，按 in_scope 放行，并记录 `scope_classifier_grace_expired`。
   - OOS 命中（宽限期内返回）仍走既有路径：退款（`stream-runner.ts:581`）、`finalizeAssistantTurn(outOfScope=true, excludedFromContext=true)`（L590）、`OUT_OF_SCOPE_FALLBACK` 文案与 done.outOfScope=true 不变（**修订：2026-08-14 改为放行 agent 角色化回复，不再 OOS fallback + excluded；本句作废**）。
   - 行为代价：无草稿分类的 OOS 召回可能低于「带草稿」基线（审计中白藏/DS 改协议-JSON 正是靠草稿判 OOS 拦截）。因此对「改协议-JSON」类输入由 Spec 4 的输入预检先行短路（Spec 4 第 4.2 节），补偿无草稿窗口。
2. **方案 B：生成后分类 + 超时上限**（保底，revision 2 修订）：保留带草稿分类，`await` 改为「等待至 min(分类完成, SCOPE_CLASSIFY_TIMEOUT_MS=3_000)」，超时即按 in_scope 放行并计 `scope_classifier_grace_expired`。OOS 语义与退款/排除逻辑不变。**注意（revision 2 明确）：500ms 宽限期只对方案 A（生成前发起、分类有整个生成期可用）成立；方案 B 是生成后才发起，分类 p50=2.13s，500ms 内返回率约 15%，会导致 OOS 拦截率从基线 54% 掉到个位数，无法通过「OOS 偏差 ≤10pp」验收。因此方案 B 只承诺延迟改善（等待上限 3s），不承诺 OOS 召回，「OOS ≤10pp」验收仅绑定方案 A（见 5 矩阵）。**
3. **超时收紧（与 A/B 叠加的常量化）**：`Math.min(config.fastclawTimeoutMs, 10_000)` → `Math.min(config.fastclawTimeoutMs, 3_000)`；abort/失败统一快速返回 in_scope（现状已返回 in_scope，但收紧后等待上限 3s，缓解长尾）。

> 明确不采用：`void classifyChatScope(...).then(mark)` 完全不等待的方案——它会使 OOS 命中不再退款/排除上下文，违反本 Spec 冻结边界，且 p50 2.13s 下绝大多数 OOS 不拦截，「OOS 召回不劣化」目标必败。
### 4.2 代码位置

- `apps/api/src/server/modules/chat/scope-classifier.ts`：
  - `ScopeClassifierInput.assistantDraft` 改为 `assistantDraft?: string`（可选）；prompt 中「助手草稿：」行仅在草稿存在时拼接（`classifyChatScope` L51 现为必拼，需条件化）。
  - 新增 `SCOPE_CLASSIFY_TIMEOUT_MS = 3_000`（分类请求自身超时，方案 A/B 共用）与 `SCOPE_CLASSIFY_GRACE_MS = 500`（**仅方案 A**：生成前发起后，生成完成时对未返回结果的放弃等待窗口）。
  - 新增 `classifyChatScopeNonBlocking`：返回 `{ classification, settledInGrace }`（方案 A 用 `settledInGrace` 标记「宽限期内完成」；方案 B 无需该标记，直接 `await` 至超时上限），内部自行计时。
- `apps/api/src/server/modules/chat/stream-runner.ts`：`createGenerationResponse` 中把 L559 `await classifyChatScope(...)` 替换为方案 A/B 的调用；宽限期放弃时 `console.info({ event: 'scope_classifier_grace_expired', sessionId, userMessageId, clientMessageId })`；OOS 命中路径（L579-637）不变。
- 常量：`config.fastclawTimeoutMs` 不改（主生成仍 120s）。
### 4.3 行为变化

- 用户可见：script 模式首字/总时长下降约 2–4s（与 Spec 2 合并后体验叠加）。
- 分类失败：不再增加用户等待；OOS 召回可能略降（宽限期内未返回即 in_scope）。
- 计费/幂等/上下文：不变。

## 5. 验证矩阵

> 验证命令统一使用 `pnpm --filter @juben-sha/api test` / `pnpm --filter @juben-sha/api typecheck`（AGENTS.md：rtk 对 `--filter` 透传有限，直接用 pnpm）。

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| **方案 A**：script 模式 `moderationMs` P50 下降 ≥50% | 复用 `scripts/phase-a-quality.mjs` + `parse-api-logs.mjs` 对比改前后 | `chat_stream_latency.moderationMs` P50/P90（基线 2116ms） |
| **方案 B**：`moderationMs` P90 下降 ≥30% 且 max ≤3.5s，P50 不劣化 | 同上，按方案 B 单独验收 | `chat_stream_latency.moderationMs` P90 基线 **3206ms（混合 script+free 口径，`ai-chat-report.md` 2.2）**；script-only P90 无单独基线，实施前先补测同口径再对比 |
| 分类失败/超时（mock 8s 延迟/断连）不阻塞回复 | 单测 mock `classifyChatScope` reject/挂起 + 计时 | 单测断言总时长 ≤（生成 + 宽限期 + 余量），回复正常 |
| 宽限期放弃有观测 | 单测/日志断言 `scope_classifier_grace_expired` 出现 | API console |
| OOS 召回不显著劣化（**仅方案 A**，revision 2 明确） | 重跑越界矩阵（6 角色 × script），OOS 命中率与基线（DS 54%）偏差 ≤10pp；方案 B 不承诺该线（OOS 拦截率必然下降，只验收延迟） | phase-a 越界场景结果 |
| done 事件与 OOS 文案不变 | 既有 `stream-runner.test.ts` 全绿 | vitest |
| 无回归 | `pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/api typecheck` | CI |

> **验收重评（2026-08-14）**：OOS 拦截率承诺不再适用新口径——越界/OOS 改为 agent 角色化吸收（放行），验收按 2026-08-14 架构 Spec §10（角色化化解 + 协议泄漏=0 + 硬安全拦截负向用例）执行。

## 5.1 发布与回滚

- 发布：随 API 常规发版；无数据迁移、无前端依赖（客户端不感知分类时序）。
- 回滚：恢复 `await classifyChatScope(...)` + 原 `10_000` 上限（即回滚到本 Spec 基线）；无需回滚数据。
- 灰度关注：上线后 24h 观察 `scope_classifier_grace_expired` 占比与 OOS 命中率（对比上线前 7 天 `chat_turn_out_of_scope` 事件数）。

## 6. 并行边界与合并顺序

- 改动文件：`scope-classifier.ts`、`stream-runner.ts`、`__tests__/*`。
- **与 Spec 2 冲突**：Spec 2 也改 `stream-runner.ts` 的 `createGenerationResponse` 输出段。约定：本 Spec 只动「分类调用/超时」段（约 15 行），Spec 2 只动「controller.enqueue 输出段」；**合并顺序必须 Spec 1 → Spec 2**（Spec 2 基于 Spec 1 后的 `createGenerationResponse` 结构 rebase）。
- 与 Spec 3 同在 `stream-runner.ts`：本 Spec 分类调用段（L556-577）vs Spec 3 上下文组装段（L329-392），**函数级不重叠**，顺序合并不冲突（revision 2 措辞修订）。
- 与 Spec 4 同在 `stream-runner.ts`：本 Spec 分类调用段 vs Spec 4 输入预检段（L116/154/204），按段位隔离；若实现冲突，以本 Spec 的调用点为准并 rebase。
- 与 Spec 5 无重叠。

## 7. 文档同步

- 实现后更新 `docs/api-v1.md`（若出现可观测字段/错误码变化）与 `docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md` 第 15 节可观测性（仅当指标名变化）。

## 8. 修订记录

- revision 0：draft，基于 2026-08-12 夜间审计（`ai-chat-report.md` 2.2/2.4）。
- revision 2（2026-08-12，依据复审）：
  - 方案 B 宽限期改为 `SCOPE_CLASSIFY_TIMEOUT_MS=3_000`（500ms 仅方案 A 可用），并明确方案 B 只保延迟、不承诺 OOS 召回；「OOS ≤10pp」验收绑定方案 A；
  - 5 矩阵方案 B 基线勘误：3319ms（无出处）→ 3206ms（混合口径），并注明 script-only P90 需先补测；
  - 6 节措辞：与 Spec 3 同文件不同段（函数级不重叠），不再声明「无文件重叠」。
- revision 1（2026-08-12，依据 `/tmp/chat-spec-audit-2026-08-12.md` 审核）：
  - 方案 B 从「完全不拦截」改为「宽限期放弃」，消除与冻结边界（OOS 语义）的矛盾；
  - 方案 A 明确 `assistantDraft` 可选化与 prompt 条件拼接，并声明无草稿窗口的 OOS 召回代价与 Spec 4 预检补偿；
  - 验证矩阵按方案 A/B 分别绑定验收线；
  - 新增 `scope_classifier_grace_expired` 观测、5.1 发布/回滚节；
  - 验证命令改用 `pnpm --filter`（AGENTS.md）。
