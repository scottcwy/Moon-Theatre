# 聊天首 token 并行化 SPEC（P2-2，2026-08-12）

> 状态：`PLANNED`（draft；尚未实现）
> 变更标识：chat-p2-2-first-token-parallelization
> 基线：`main` HEAD `e791f6e`（已含 Spec 1-5：scope classifier 去阻塞 / 增量放行 / 记忆 / 输出加固 / 模型路由）
> 来源：`apps/miniapp/e2e/artifacts/overnight/e2e-report.md` §3 架构问题（P2-2，首 token 串行 DB 链 + 重复查询）

> **修订标注（2026-08-14）**：本 Spec 的首 token 并行化链路基于旧「API 组装 system prompt + clean history」链路，被 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）部分取代——新链路下 FastClaw 会话持有生成上下文、API 只发动态上下文 system + 当前用户消息、API 侧 clean history 组装删除；本 Spec 需按新链路重评/部分被取代。

## 1. 目标

把 `/api/chat/stream` 首 token 之前的串行 DB 链并行化并消除重复查询，降低首字延迟（TTFT），**不改变任何对外行为**（流事件、错误码、计费与幂等语义）。

## 2. 范围与边界

范围内：
- `apps/api/src/server/modules/chat/stream-runner.ts`（`runChatStream` 前置链、`resolveRequestScope`、`buildPromptContext` 的脚本查询复用）（**修订：`buildPromptContext`/clean history 组装随 2026-08-14 架构 Spec 删除，该项需按新链路重评**）
- `apps/api/src/server/modules/chat/service.ts`（`getCharacterWithPrompts` 并行、`findOrCreateSession` 去重、`resolveClientTurn` legacy 去重）
- 相关 `__tests__/*`

非目标 / 边界：
- 不改流协议与事件字段（Spec 2 已冻结）；
- 不改计费与幂等（consumePoints 的 `consume_${userMessageId}_${generationAttempt}` 计费标识不变）；
- 不改 scope classifier 与增量放行逻辑（Spec 1/2 已合入）；
- 不做 SQL 之外的内存/缓存优化（如 prompts 缓存）——本 spec 只消除串行等待与同请求重复查询；
- 不触碰 `apps/miniapp/**`。

## 3. 现状证据（基线 e791f6e 实测）

`runChatStream` 首 token 前串行链（`stream-runner.ts`）：
1. `profile` 查询（:104）
2. `getCharacterWithPrompts(characterId)`（:117）——`service.ts:172-186` 内 **characters 与 characterPrompts 两次串行查询**
3. `resolveRequestScope`（:124）——内部 `getScriptById(character.scriptId)`（:322）；sessionId 路径 `getChatSessionScope`（:328）+ `getScriptById(persisted.scriptId)`（:352）
4. `findOrCreateSession`（:259）——内部**重查 `characters.scriptId`**（`service.ts:276`）
5. `saveUserMessage`（:267）
6. `checkInput`（:269，依赖 userMsg.id）
7. `getCleanHistoryMessages`（:292，依赖 sessionId）（**修订：2026-08-14 架构 Spec 删除 clean history 组装，本项不再适用**）
8. `buildPromptContext`（:293）——内部 `getScriptById(scope.scriptId)`（:444，与 :322/:352 可能重复）（**修订：同上，本项随新链路重评**）
9. wallet：`getOrCreateWallet` → `getBalance` → `consumePoints`（:396-403，consume 依赖 userMsgId）

重复查询统计（单请求）：
- `characters` 表：最多 3 次（`service.ts:173` getCharacterWithPrompts、`service.ts:276` findOrCreateSession、`service.ts:664` resolveClientTurn legacy 路径）
- `scripts` 表：最多 3 次（`stream-runner.ts:322`、`:352`、`:444`，session 路径下 322 与 352 可能为同一脚本）
- `getCharacterWithPrompts` 内部两次串行（characters → characterPrompts）

## 4. 最小改法

### 4.1 `getCharacterWithPrompts` 并行（service.ts:172-186）
`characters` 与 `characterPrompts` 两查询用 `Promise.all` 并行；无 character 时提前返回 null（prompts 查询可先发，结果丢弃，成本可接受；或先查 character 再并行 prompts，两者二选一，取实现简单且不增加失败面者）。

### 4.2 `runChatStream` 前置链并行化（stream-runner.ts）
- 独立可并行组：`profile`、`getCharacterWithPrompts`、sessionId 路径的 `getChatSessionScope`、wallet 的 `getOrCreateWallet`（4 个相互独立）。
- 依赖关系：new-session 路径的 `resolveRequestScope` 需要 character（scriptId 校验）；`getScriptById` 需要 scope/character 的 scriptId；`saveUserMessage` 依赖 session；`checkInput` 依赖 userMsgId；`cleanHistory` 依赖 sessionId；`consumePoints` 依赖 userMsgId。
- 最小改法：
  1. 入口 `Promise.all([profile, character, walletCreate])`（sessionId 路径可再加 `scopeSession`）；
  2. 其后按现有顺序执行 `resolveRequestScope`（内部脚本查询在可能时复用 4.3）；
  3. `getOrCreateWallet` 提前到入口并行，`getBalance`/`consumePoints` 保持原位（consume 依赖 userMsgId，且 balance<cost 的 402 判断必须在 saveUserMessage 之后失败时 `failTurn` 的语义不变——核对 `createPreparedGenerationResponse` 的调用位置）。
- 错误语义保持：`Character not found` 404、`session_scope_mismatch` 409、`script_unavailable` 409、`insufficient_points` 402 的相对判定顺序不变（并行只减少等待，不改变谁先抛错）。

### 4.3 重复查询去重
- `findOrCreateSession`（service.ts:276）：不再重查 `characters.scriptId`，由调用方传入已加载的 `character.scriptId`（new-session 路径）或保持现状的 sessionId 路径。
- `resolveClientTurn` legacy 路径（service.ts:664）：复用已加载 character（或明确该路径在并行化后已不可达则删）。
- `buildPromptContext`（stream-runner.ts:444）：session 路径下 `getScriptById(scope.scriptId)` 若在 `resolveRequestScope` 已取过（:352 同一脚本），通过参数复用，消除第 3 次查询；new-session 路径 `:322` 与 `:444` 同一脚本同样复用。（**修订：`buildPromptContext` 随 2026-08-14 架构 Spec 删除；剩余 DB 前置链并行化（profile/character/wallet/scope）仍按新链路重评后实施**）

### 4.4 指标
- `chat_stream_latency.prepareMs` 是既有字段（stream-runner 已输出），本 spec 验收以此对比基线（P50/P90），不改事件结构。

## 5. 验收

- `rtk pnpm --filter @juben-sha/api test` 全绿（重点：stream-runner.test.ts 现有用例全部保持，错误码/顺序断言不回归）。
- `rtk pnpm -r typecheck` 全绿。
- 行为回归（用现有测试覆盖）：`session_scope_mismatch` / `script_unavailable` / `insufficient_points` / `client_message_id_collision` 语义不变；replay / acquired_existing / in_progress 路径不变。
- 性能：`prepareMs` P50/P90 对比合入前基线，预期显著下降（不设硬阈值，记录对比即可）。
- 重复查询消除：单请求 `scripts` 查询 ≤1 次（session 路径）、`characters` 查询 ≤1 次（new-session 路径）——用测试 spy 或日志断言。

## 6. 风险与回撤

| 风险 | 应对/回撤 |
| --- | --- |
| 并行化改变错误抛出顺序（404/409/402） | 保持 4.2 判定顺序；测试覆盖错误码顺序 |
| wallet 提前 create 改变幂等面 | `getOrCreateWallet` 幂等（原实现本就先调用），`consumePoints` 位置不变 |
| 复用脚本/角色对象引入陈旧数据 | 同请求内数据本就一致，仅消除重复读；不做跨请求缓存 |
| 测试替身（无 PG 的 db mock）行为差异 | 去重后测试替身路径同步更新（character 参数透传） |
| 全部回撤 | `git revert` 对应 commit；改动集中两个文件，回撤成本低 |

## 7. 落地顺序与验证命令

1. 4.1 → 4.2 → 4.3 → 4.4（每步独立 commit，测试跟随）。
2. 验证：`rtk pnpm --filter @juben-sha/api test`；`rtk pnpm -r typecheck`；`prepareMs` 对比记录进 progress log。
3. DevTools E2E（s1-s8）延后统一回归。

## 8. 关联

- 审计报告：`apps/miniapp/e2e/artifacts/overnight/e2e-report.md` §3（重复 / 可并行）
- 前置 Spec：`docs/specs/2026-08-12-chat-streaming-incremental-output-spec.md`（增量放行，本 spec 基于其合入后的形态）
