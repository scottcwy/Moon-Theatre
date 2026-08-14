# 聊天质量优化 Spec 4：协议输出加固（JSON 块剥离 + 改协议预检）

日期：2026-08-12
状态：draft（revision 2，已按 2026-08-12 复审修订，待复审冻结）
修订号：2
适用版本：聊天体验迭代 V1.1 之后
变更标识：chat-output-protocol-sanitization

> **修订标注（2026-08-14）**：本 Spec 的 `isProtocolProbe` 预检短路被 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）修订为「放行 agent 角色化处理」（硬安全拦截 `checkInput.blocked` 除外）；泄漏验收（protocolLeaks=0）保留。

## 1. 文档目的与冻结边界

本文档冻结「最终回复不再包含内部消息结构」的实现边界。它扩展 `output-sanitizer` 的清理能力并增加「要求改变回复协议」类输入的预检，**不改变 OOS 兜底文案、不改变 done 事件字段、不改变其他 sanitizer 已有规则**。

冻结：
- sanitizer 对 JSON 块/内部字段的剥离规则；
- 改协议类输入的预检与短路（**修订：2026-08-14 改为放行 agent 角色化处理，预检不再短路；硬安全拦截 `checkInput.blocked` 除外**）；
- 命中可观测计数。

不冻结：剥离后追加的提示文案（可迭代）、分类器 prompt。

## 2. 现状与证据

- 代码：`apps/api/src/server/modules/chat/output-sanitizer.ts`（现有规则只清 think/analysis/reasoning 标签行、重复句、AI 拒答兜底）；`apps/api/src/server/modules/chat/stream-runner.ts`（`sanitizeAssistantOutput` 调用点 + scope 分类调用点）。
- 审计证据（真实链路 4/4 例结构泄漏，全在「改协议-JSON」）：
  - DS 月岛澪/script：`{ "mood": "静寂而专注…", "content": "…" }`
  - DS 久远/script：`{"mood":"沉静·警惕","content":"……北门不是散步的地方…"}`
  - Qwen 白藏/script：`` ```json { "mood": "温柔", "content": "…" } ``
  - Qwen 久远/script：`{ "mood": "克制", "content": "不能这样…" }`
  - 对照：白藏(DS)该场景被 scope 分类判 OOS，未泄漏——「放行即泄漏」。
- 现有测试：`apps/api/src/server/modules/chat/__tests__/output-sanitizer.test.ts`。

## 3. 目标与非目标

目标：
- 「改协议-JSON」等诱导下最终回复不含 JSON 块/内部 mood/content 字段；
- 泄漏命中可观测（按模型/角色/场景计数）。

非目标：
- 不引入 LLM 二次判定（保持正则轻量）；
- 不改变正常角色对白（误伤控制见 4.1-2）。

## 4. 设计

### 4.1 sanitizer 扩展（`output-sanitizer.ts`）

1. **JSON 块剥离**：
   - 匹配并移除 ` ```json\s*{...}\s*``` `（fenced code block，`/```json[\s\S]*?```/gi`）。
   - 匹配并移除「整段为 JSON 对象」的裸块：`^\s*\{[\s\S]*\}\s*$` 且解析后含内部字段之一（`mood`、`content`、`type`、`message`、`emotion`、`reply`），只剥对象外层，保留对象内正文（若 `content` 字段存在且非空，用其值作为清理后文本）。
2. **误伤控制**：仅当文本可整体解析为 JSON 且含上述字段才剥离；正文中段出现的 `{...}` 角色动作（如 `（白藏微微一怔）`）不命中。
3. **剥离后空值兜底（revision 2 勘误）**：若剥离后文本为空（如模型只输出 `{"mood":"…"}` 且无 content、或 content 为空），`sanitizeAssistantOutput` **现状已覆盖**——`output-sanitizer.ts:30` 的 `if (!cleaned || GENERIC_AI_REFUSAL_PATTERN.test(cleaned)) return IN_CHARACTER_FALLBACK;` 中 `!cleaned` 已兜底空串，无需新增判空实现。本 Spec 只需补单测确认该路径（`{"mood":"…"}` 无 content → 输出 IN_CHARACTER_FALLBACK），避免落库空消息/发空 delta。
4. **非标准 JSON 观察（revision 2 明确）**：模型输出单引号/无引号 key 等无法 `JSON.parse` 的疑似 JSON 块时，剥离规则不命中，泄漏窗口仍在。对策：正则先识别「疑似 JSON 块」形态（整段以 `{` 起、以 `}` 止且含 `mood|content|type|emotion` 字段名），解析失败时 `console.info({ event: 'output_sanitizer_parse_fail' })` 并**直接删除整个疑似块（宁删勿错）**——从疑似块中提取 content 值存在跨字段误提取风险，不作为本期实现，留作后续增强。与预检形成双保险。
5. **命中计数**：`sanitizeAssistantOutput` 剥离 JSON 时 `console.info({ event: 'output_sanitizer_hit', kind: 'json-block', characterId?, modelName? })`（调用点补充元数据），并计入现有 `model_usage_logs.errorCode`（新值 `output_json_block`）或独立日志事件，按模型/角色可聚合。

### 4.2 改协议类输入预检（`stream-runner.ts` 输入段）

> **修订（2026-08-14）**：本节的预检短路不再实施——改协议类输入放行给 roleplay agent 角色化处理（agent 依 SOUL.md safety 指引化解）；`checkInput.blocked` 硬安全拦截维持短接。以下原方案保留作为历史设计，不再作为实现依据。

- 在 `checkInput` 之后新增轻量预检函数 `isProtocolProbe(message)`（不进 scope-classifier，避免与 Spec 1 冲突），并在 `runChatStream` 的**三处 checkInput 调用点之后统一调用**（`stream-runner.ts:116` acquired_existing、L154 created、L204 新会话；抽公共函数避免三处复制）：
  - 命中规则（revision 1 收窄，避免误伤正常请求）：
    - **强命中**：消息包含 `JSON|json|mood|content|协议`（不要求组合），或 `（回复|输出|回答）` 且 `（格式|标签|标记）` 同时命中；
    - **不预检**：仅含「格式/标签/标记」单词（如「以书信格式回复」「按这个格式写」）——这类正常可化解请求交给模型（与审计中「改协议-无标签」大多角色内化解一致）。
  - 命中后的行为（二选一，revision 2 明确 done 形态）：
    a) 角色化引导：用角色内回复（文案模板按角色生成，放 `stream-runner.ts` 常量）直接 `finalizeAssistantTurn` + 流式响应（复用 `createBlockedInputResponse` 的流式构造模式，`excludedFromContext=true`，不调模型、不扣点）。**done 形态：使用 `outOfScope:true`**（与语义一致：excludedFromContext=true、不扣点；客户端 `isSuccessfulDoneEvent` 与 OOS 路径一致返回 false），done 携带角色化文案全文；**不使用 `blocked:true`**（blocked 语义专指安全拦截，见 `stream-runner.ts:404-410` 现状）。
    b) 走现有 OOS 分支（`OUT_OF_SCOPE_FALLBACK`）+ `excludedFromContext=true`（done.outOfScope=true，现状不变）。
    推荐 (a)（沉浸优先）；实现时需与 Spec 1 方案 A 的并行分类联动：预检命中则**不再发起**分类请求。
- 该预检是 Spec 1 分类超时之外的**第一道防线**（输入侧，不增加 LLM 调用）。

### 4.3 代码位置

- `apps/api/src/server/modules/chat/output-sanitizer.ts`
- `apps/api/src/server/modules/chat/__tests__/output-sanitizer.test.ts`
- `apps/api/src/server/modules/chat/stream-runner.ts`（`isProtocolProbe` 公共函数 + 三处调用 + sanitizer 调用点元数据；预检命中后的 `finalizeAssistantTurn` + 流式响应构造，复用 `createBlockedInputResponse` 模式）
- 文案常量：`apps/api/src/server/modules/chat/stream-runner.ts`（新增 `PROTOCOL_PROBE_FALLBACK`，按角色可选）

## 5. 验证矩阵

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| 改协议-JSON 4/4 泄漏 → 0 | 复用审计 `phase-a-quality.mjs` 改协议场景（6 角色 × 2 模型） | phase-a 结果 protocolLeaks=0 |
| sanitizer 单测覆盖 JSON 块/裸块/误伤/空 content/parse fail | `output-sanitizer.test.ts` 新增用例（含 `{"mood":"…"}` 无 content、单引号 JSON） | vitest |
| 预检误伤控制：正常请求不命中 | 单测：「以书信格式回复」「按这个格式写」「你不要走」不命中 | vitest |
| 三处输入路径均走预检 | `stream-runner.test.ts` 对 acquired_existing/created/新会话各一例 | vitest |
| 预检命中后 done 形态 | 单测断言角色化引导路径 done.outOfScope=true、不含 blocked:true、携带角色化文案全文 | vitest |
| 正常角色对白不受影响 | 全量回归矩阵泄漏率与基线一致（<1%） | phase-a |
| 命中可观测 | 日志出现 `output_sanitizer_hit` / `errorCode=output_json_block` | API console |
| 无回归 | `pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/api typecheck` | CI |

> **验收重评（2026-08-14）**：预检短路不再实施；越界/改协议预检按 2026-08-14 架构 Spec 放行 agent 角色化处理（硬安全 `checkInput.blocked` 除外），`protocolLeaks=0` 泄漏验收保留。

## 5.1 发布与回滚

- 发布：随 API 常规发版；预检行为可通过环境变量/常量开关（如 `PROTOCOL_PROBE_ENABLED`，默认 true）控制，用于线上快速回退。
- 回滚：关预检开关 + 回退 sanitizer 剥离规则（代码回滚到 revision 0）；无需数据回滚。
- 灰度关注：`output_sanitizer_hit`、`output_sanitizer_parse_fail`、预检命中后的「角色化引导 vs 模型回复」用户反馈。

## 6. 并行边界与合并顺序

- 改动文件：`output-sanitizer.ts`、`output-sanitizer.test.ts`、`stream-runner.ts`（输入预检段，约 10 行）。
- **与 Spec 1/2/3 同在 `stream-runner.ts`**：本 Spec 只新增「输入预检函数」并在 `runChatStream` 的 `checkInput` 后调用（输入段 L116/154/204），与 Spec 1（分类调用段 L556-577）、Spec 2（输出段 L511/703-720）、Spec 3（上下文组装段 L329-392）**函数级不重叠**（revision 2 措辞修订）；冲突时 rebase，合并顺序建议 Spec 1 → Spec 2 → Spec 4（预检命中则不再发起分类，与 Spec 1 联动）。
- 与 Spec 5 无重叠。

## 7. 文档同步

- 实现后更新 `docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md` 10.3/15（输出过滤与可观测性：新增 `output_json_block` 与 `output_sanitizer_hit`）。

## 8. 风险与取舍

- JSON 剥离的误伤面：只剥「整段可解析且含内部字段」的对象，正常对白几乎不可能命中；需用全量回归样本确认。
- 「改协议-JSON」预检用角色化引导而非 OOS 兜底，保持沉浸（与 Spec 1 的 OOS 语义不冲突：预检先于分类）。

## 9. 修订记录

- revision 0：draft，基于 2026-08-12 夜间审计（`ai-chat-report.md` 1.2）。
- revision 2（2026-08-12，依据复审）：
  - 4.1-3 勘误：`output-sanitizer.ts:30` 的 `!cleaned` 已兜底空串，删除「需补判空」实现项，改为补单测确认；
  - 4.2 明确角色化引导路径 done 形态为 `outOfScope:true`（不用 blocked:true），验证矩阵补 done 形态断言；
  - 4.1-4 宽松剥离默认「直接删除整个疑似块」，content 值提取留作后续增强；
  - 6 节措辞：与 Spec 1/2/3 同文件不同段（函数级不重叠）。
- revision 1（2026-08-12，依据 `/tmp/chat-spec-audit-2026-08-12.md` 审核）：
  - 预检正则收窄：强命中仅 `JSON|json|mood|content|协议`（或「回复/输出」+「格式/标签」组合），「格式/标签」单词不再单独预检，消除与「无标签不预检」的矛盾；
  - 明确预检覆盖 `runChatStream` 三处输入路径（抽 `isProtocolProbe` 公共函数）与命中后的落库/流式响应构造；
  - 剥离后空 content 回退 `IN_CHARACTER_FALLBACK`/OOS；新增 `output_sanitizer_parse_fail` 观察与宽松剥离；
  - 新增 5.1 发布/回滚节（预检开关）；验证矩阵补误伤/空 content/parse fail/三路径用例；验证命令改用 `pnpm --filter`。
