# 聊天审计非冲突修复 SPEC（2026-08-12，revision 3）

> 状态：`PLANNED`（尚未实现；实现由后续会话推进）
> 变更标识：chat-audit-nonconflicting-fixes-2026-08-12
> 基线：`main` HEAD `d806faf` + 用户未提交 WIP（审计基线，见 `apps/miniapp/e2e/artifacts/overnight/e2e-report.md`）
> revision 2：按 2026-08-12 spec 审核修订——修正冲突边界（services/api.ts、chat/index.tsx 为共享文件）、看门狗与并行 Spec 2 合并、批 A 时序后移、P2 编号、A1/A2/A3/A12 细节。
> revision 3：按 2026-08-12 rev2 复审放行条件修订——补 P1-1 迟到回调契约（stall 后 abort + 不再送达 delta/done）、P1-2 并行 Spec 2 边界声明建议（§2.4）；顺手修正 P2：home/index.tsx WIP 归属、A6 行号、A10 提交策略、验收断言载体、§2.3 补 prompt-builder/docs/api-v1。

## 1. 目标

把夜间审计报告中**与并行会话零文件冲突**的修复点收敛为可独立推进、可验收的落地单元；对**共享文件**（`services/api.ts`、`chat/index.tsx`）明确协调策略与合入顺序，避免双会话互相覆盖。

## 2. 范围与边界

### 2.1 范围内（本 spec 落地单元）

| 板块 | 内容 | 优先级 | 时序 |
| --- | --- | --- | --- |
| A. 聊天页状态正确性 | A1 充值返回余额刷新（P0-1）；A3 模式切换/发送竞态守卫（P1-3）；A12 boot/retry 重复逻辑合并 | P0/P1 | **等并行 Spec 2 合入后**（chat/index.tsx 共享） |
| B. 流式健壮性（客户端） | A4 `streamChat` 看门狗——**与并行 Spec 2 合并为单一实现**（P1-1/P1-4）；A7 为看门狗补 mock 场景与回归 | P1 | A4 主体由并行 Spec 2 实现，本 spec 负责验收/校准/软提示补充（均在共享文件，排 Spec 2 合入后）；A7 可先行 |
| C. 门禁与 E2E 健康度 | A2 typecheck 门禁修复（P1-2）；A5 mock `unreadCount` 漂移清理（P2-3）；A6 script-select 断言过期修复（P2-4） | P1/P2 | **现在可做**（并行会话实测不碰 e2e 文件） |
| D. 整洁度与性能（低风险） | A8 聊天列表全量重拉缓存（P2-5）；A9 share canvas 魔法数字；A10 ChatInputBar a11y；A11 防抖/动画常量收敛 | P2 | 现在可做（均非并行会话文件；A10 注意 ChatInputBar 是用户 WIP） |

### 2.2 边界 / 非目标

- **不做**（并行会话独占）：`apps/api/src/server/modules/chat/stream-runner.ts`、`scope-classifier.ts`、`moderation/service.ts`、`memory/*`、`output-sanitizer.ts`、`index.model.ts`（并行 Spec 2 会改 `getFriendlyStreamErrorMessage`）、模型配置。
- **服务端审计项 P2-2**（首 token 串行 DB 链并行 + characters/scripts 重复查询去重，落在 stream-runner/service）：等待并行会话合入后另立 spec，本 spec 不涉及。
- 不引入新状态管理、不改服务端流协议（事件类型/字段）；客户端超时常量 `CHAT_STREAM_REQUEST_TIMEOUT_MS` 由并行 Spec 2 定为 150s，本 spec 不重复修改。
- 本 spec 不覆盖并行会话的 5 项 Spec 内容（分类去阻塞、增量放行、记忆去污染、协议输出加固、默认 DeepSeek）。

### 2.3 文件冲突地图（双会话约定，revision 2 修正）

| 文件 | 归属 | 协调策略 |
| --- | --- | --- |
| `apps/miniapp/src/services/api.ts` | **共享**（并行 Spec 2：`stream_stalled` 心跳 + 130s→150s；本 spec A4 原方案） | **看门狗合并**：以并行 Spec 2 的「15s 无任何 chunk 且未 done → `onError('stream_stalled')`」为唯一实现；本 spec A4 不再新增计时器，只负责验收、阈值校准与软提示（见 §4） |
| `apps/miniapp/src/pages/chat/index.tsx` | **共享**（并行 Spec 2：`stream_stalled` 文案、断流保留部分内容、reconcile；本 spec A1/A3/A12） | 批 A 与软提示**排在并行 Spec 2 合入之后**；该文件同时是用户 WIP，落地时只产出 diff 不自行 commit |
| `apps/miniapp/src/pages/chat/list.tsx`、`share/preview.tsx`、`home/index.tsx` | 本 spec（D 板块） | 并行会话不碰；home/index.tsx **非 WIP**（用户 WIP 为其 `index.scss` 与 `index.layout.test.tsx`） |
| `packages/miniapp-ui/src/components/chat/ChatInputBar.tsx` | 本 spec（A10） | **用户 WIP 文件，revision 2 补入地图**；并行会话不碰 |
| `apps/miniapp-playbook/src/pages/playbook/index.tsx` | 本 spec（C） | 并行会话不碰 |
| `apps/miniapp/e2e/mock-api-server.mjs`、`runtime-ui-authenticated.mjs` | 本 spec（C/B 回归） | 并行会话实测不触碰（边界准确）；两文件均为用户 WIP，改动保持增量 |
| `apps/api/src/server/modules/chat/stream-runner.ts`、`scope-classifier.ts`、`moderation/service.ts`、`memory/*`、`output-sanitizer.ts`、`index.model.ts`、`prompt-builder.ts`、`docs/api-v1.md`、模型配置 | 并行会话 | 本 spec 不碰（prompt-builder.ts 与 docs/api-v1.md 为并行独占，非阻塞） |

### 2.4 对并行 Spec 2 的边界声明建议（P1-2，待对方采纳）

复审确认并行 Spec 2 §6 仍写「前端改动仅本 Spec」，未识别本 spec 也改 `chat/index.tsx`。**本 spec 不直接修改对方工作树文件**，建议并行会话在其 §6 补充以下声明（可直接粘贴）：

> 与 `docs/specs/2026-08-12-chat-audit-nonconflicting-fixes-spec.md`（rev3）共享 `apps/miniapp/src/services/api.ts` 与 `apps/miniapp/src/pages/chat/index.tsx`：看门狗以本 Spec 的 `stream_stalled`（15s）为唯一实现，对方不再新增计时器；批 A（余额刷新/竞态守卫/重复逻辑）与软提示排本 Spec 合入之后。对方工作树中这两文件的改动以「本 Spec 优先、对方增量」方式合入。

## 3. 板块 A：聊天页状态正确性（均在共享文件，排并行 Spec 2 合入后）

### A1. 充值完成返回聊天页后余额不刷新（P0-1）

- 现状证据：`chat/index.tsx` 无 `useDidShow`；`quota/result.tsx:71` `handleGoBack` → `navigateBackOrHome`，**实际路径为 result → buy → chat 两步返回**（页面栈 chat→buy→result），最终回到 chat 时原页面状态保留。夜间 E2E s4 两次复现：头部「点数 0」、不足提示仍在、输入禁用。
- 目标行为：最终回到聊天页时重新拉取余额，`pointsBalance` 更新后 `isInsufficientPoints` 自动恢复、输入可用。
- 最小改法：
  1. chat 页引入 `useDidShow`，回调内 `void loadBalance()`；
  2. **用 `skipFirstShowRef`（home/index.tsx 同范式）跳过首帧 onShow**，避免首挂载与首 show 重复拉余额；
  3. 确认两步返回后 onShow 在回到 chat 时触发（Taro 页面栈语义），并在 E2E s4 中按「两步返回」路径断言。
- 验收：余额 0 → 充值 30 → result 返回 → buy 返回 → chat，头部显示 30、提示消失、输入可输入（s4 断言转正）；**首帧余额请求仅 1 次**（mock `GET /api/quota/balance` 计数断言，rev3 补断言载体）。
- 风险/回撤：低；回撤即删除 useDidShow/skipFirstShowRef 块。

### A3. 模式切换 / 发送竞态守卫（P1-3）

- 现状证据：`chat/index.tsx:392-393` `handleModeChange` 用状态闭包守卫，夜间 E2E s1 复现 300ms 内连点触发 2 次 `GET /api/chat/sessions`；`chat/index.tsx:515-518` `handleSend` 同型 `sending` 闭包守卫，静态分析确认双击可发两个 streamChat（双 clientMessageId → 双轮/双扣点）。
- **补充（审核确认）**：`onAuthExpired` 分支不复位 `sending` 是既有缺口——新增 `sendingRef` 时必须把 `onAuthExpired` 纳入复位核对出口。
- 最小改法：新增 `scopeSwitchingRef` / `sendingRef` 同步守卫；复位出口核对清单：`onDone`、`onError`（reconcile 与非 reconcile 两分支）、`reconcileFailedSend finally`、`onAuthExpired`。
- 验收：s1 快速连点仅 1 次 sessions 查询；s2 双击仅 1 次 stream 请求；30 次慢速切换不回归；`onAuthExpired` 后 `sending` 复位（**需 mock 401 注入能力**，rev3 标注：A7 增加 401 注入场景，否则该项验收降级为静态核对）。
- 范围注记（rev3 补）：onAuthExpired 后临时空占位气泡的清理**不在本项范围**（goLogin 跳转不卸载页面，气泡会在重进后消失）；如需顺带清理，单独小提交。
- 风险/回撤：中；复位遗漏会反向卡死，需全出口核对；回撤即删守卫。

### A12. boot / retry 重复逻辑合并（P2-8）

- 现状：boot effect 与 `handleRetryPageLoad` 各有「sessionId 路径 / characterId 路径」加载逻辑（~40 行重复）。
- **语义决策（审核确认）**：boot 的错误文案含 `/模式|剧本信息/` 正则映射（保留具体错误），retry 无此映射（统一「无法进入当前对话」）——**以 boot 为权威**，抽公共 `loadPage` 后两处使用 boot 的文案映射；先定语义再合并。
- 验收：页面重试与首载错误文案一致（**retry 路径显式断言出现 boot 的具体错误文案**，如「当前角色不支持所选聊天模式」/「剧本模式缺少剧本信息」，rev3 补断言载体）；`pnpm --filter @juben-sha/miniapp test` 通过；s1–s4 不回归。
- 风险：中（核心路径），与 A1/A3 同提交。

## 4. 板块 B：流式健壮性（客户端）

### A4. 流式看门狗——与并行 Spec 2 合并（P1-1/P1-4，revision 2 重写）

- 现状证据：审计 s3 复现「partial 断流 25s 无提示、UI 卡发送中」；s8 复现「8s 无首字节期间无中间提示」；并行 Spec 2（`.worktrees/overnight-audit/docs/specs/2026-08-12-chat-streaming-incremental-output-spec.md` §4.2）已规划「15s 内无任何 chunk 且未 done → `onError('stream_stalled')`」。
- **合并决策（审核确认，P0）**：两 spec 不重复实现计时器。唯一实现 = 并行 Spec 2 的 `stream_stalled`（15s 统一覆盖「无首字节」与「增量间隔」两类场景）；本 spec A4 缩减为三件事：
  1. **验收与校准**：Spec 2 合入后，用 `overnight-e2e.mjs s3/s8` 验证断流 15s 内出现 `stream_stalled` 文案（`getFriendlyStreamErrorMessage` 由 Spec 2 增加映射）；
  2. **s8 用例重定义（审核确认，P1）**：现 s8 的 0/500ms/2s/8s 延迟均 < 15s，预期**保持「成功且无中间错误」**（不与看门狗冲突）；新增 ≥15s 断流用例（如 20s 延迟）预期出现 `stream_stalled`；
  3. **软提示补充（审核确认，P1-4 未闭环项）**：P1-4 期望的「等待 3–5s 出现『正在等待回应』软提示」未在 Spec 2 中——由本 spec 在 `chat/index.tsx`（共享文件，Spec 2 合入后）补一个非错误软提示状态（首字节前 3–5s 显示，15s 仍由 `stream_stalled` 收口）；实现需与 Spec 2 的断流 UI 语义（保留已展示内容）对齐。
- **迟到回调契约（rev3 补，P1-1）**：Spec 2 心跳触发 `onError('stream_stalled')` 时必须**同时 `requestTask.abort()`**，并约定「stall 之后不再送达 delta/done」；客户端侧防御：`onDelta/onDone` 在已收到 `stream_stalled` 后忽略迟到回调（防「错误卡 + 完整消息」并存）。此契约需同步到并行 Spec 2 §4.2/§5。
- 验收（含断言载体，rev3 补）：s3 partial 断流 15s 内出现明确提示且 `sending` 复位、**stall 后无 done 到达**（断言 mock 请求序列）；s8 新增 20s 用例在 **≈15s** 出现 `stream_stalled`（elapsed 断言），且 20s 时 mock 不再写 delta/done（A7 约定）或写也被客户端忽略；正常发送（0/500ms/2s/8s）不误报（elapsed 断言）；软提示在慢首字节 3–5s 出现（文案断言）、不误报错误。
- 风险：中；阈值与软提示均在共享文件，必须排 Spec 2 合入后，且验收命令里不自行冻结 5s/10s。

### A7. 为看门狗补 mock 场景与回归（P2-4，可先行）

- 现状：正式 mock `chatMode` 仅 3 值，`by-client-id` 恒 404；夜间 `overnight/scripts/chat-mock.mjs` 已实现全套场景。
- 最小改法：移植 `partial-then-disconnect` / `silent-then-respond` / `success-slow` / `error-event`、`by-client-id` recover/in-progress、延迟注入为正式 mock 配置（默认行为不变）。
- **20s 用例约定（rev3 补）**：`streamDelayMs` 支持 ≥20s（现有 `chat-mock.mjs` 无上限，可注入）；stall 场景在触发看门狗后**不再写 delta/done**（或写也被客户端忽略），以支撑 P1-1 契约验收。
- 验收：`pnpm --filter @juben-sha/miniapp test` 全绿；Spec 2 合入后 s3/s8 用正式 mock 重跑。
- 风险：低；mock-api-server.mjs 是用户 WIP，保持增量。

## 5. 板块 C：门禁与 E2E 健康度（现在可做）

### A2. typecheck 门禁修复（P1-2）

- 现状：`pnpm -r typecheck` 唯一失败点 = `apps/miniapp-playbook/src/pages/playbook/index.tsx:94` 传布尔 `unread`，`ChatSessionRow.tsx` 已改 `unreadCount?: number`；**`packages/miniapp-ui/dist` 未跟踪，无需重建**（审核实测确认）。
- 最小改法：playbook 页面 `unread` → `unreadCount={1}`。
- 验收：`rtk pnpm -r typecheck` 全绿。
- 风险：无。

### A5. mock `unreadCount` 漂移清理（P2-3）

- 现状：`mock-api-server.mjs:557,573,589` 三处 `unreadCount`，**无任何测试/断言消费者**（红点走 `/api/return-messages/check`，审核实测确认），可安全删除。
- 最小改法：删除三处字段。
- 验收：`pnpm --filter @juben-sha/miniapp test` 全绿；auth E2E `auth-chat-list` / `auth-return-message-flow` 不回归。
- 风险：无。

### A6. script-select 断言过期修复（P2-4）

- 现状：`runtime-ui-authenticated.mjs:189-198`（断言块起始 :189、数量断言 :196-198）断言 9 张卡，实际 11（程聿怀/羌青瓷男女变体展开）。
- 最小改法：断言按 `getCharacterGenderVariants` 展开数计算（或 `>= 9` 且含变体）；同步文案。
- 验收：auth E2E 该项转绿（DevTools 稳定前提下）。
- 风险：无。

## 6. 板块 D：整洁度与性能（低风险，现在可做）

- **A8** 聊天列表全量重拉缓存（P2-5）：`chat/list.tsx:116-119` `useDidShow` 全量重拉 → 内存缓存按 `searchQuery` 键控 + 后台静默刷新；与 `characterUnread` 状态解耦。验收：切 tab 返回无重复 loading 抖动；单测全绿。
- **A9** share canvas 魔法数字（P2-8）：`share/preview.tsx:89` `250,580,190,56` 抽命名常量。验收：渲染无变化。
- **A10** ChatInputBar 可访问性（P2-8）：`ChatInputBar.tsx:37-39` 补 `aria-label`（发送/发送中/充值）。**该文件是用户 WIP**，改动增量、不自行 commit；以工作树 diff 留待统一提交（rev3 补明确提交策略）。
- **A11** 防抖/动画常量收敛（P2-8）：`home/index.tsx:100,194` 与 `chat/list.tsx:150` 裸数字抽常量（不改变值）。验收：无行为变化。

## 7. 时序依赖与落地顺序（revision 2 重排）

**现在可做（与并行会话零交集）**：
1. A2 → A5 → A6（门禁/测试健康度，~0.5h）
2. A7（mock 场景移植，~0.5–1h，为看门狗备回归）
3. D 板块 A8/A9/A10/A11（穿插做）

**必须等并行会话合入后（共享文件）**：
4. 并行 Spec 1（分类去阻塞）→ Spec 2（增量放行，含 `stream_stalled` 心跳）合入
5. 批 A（A1 → A3 → A12）：全部在 `chat/index.tsx`，Spec 2 也改该文件 → 排在 Spec 2 之后
6. A4 验收与校准：s3/s8 重跑 + 新增 20s 断流用例 + 软提示补充（chat/index.tsx / api.ts 共享文件）

**明确不做**：审计 **P2-2**（首 token 串行 DB 链并行化，落在 stream-runner/service），等并行会话合入后另立 spec。

## 8. 验收命令

```bash
rtk pnpm -r typecheck                                        # A2 后全绿
rtk pnpm -C apps/miniapp-playbook run typecheck              # A2 单包（rtk 会拦截 --filter，用 -C 直跑）
rtk pnpm --filter @juben-sha/miniapp test                    # A5/A6/A9/A10/A11
WECHAT_DEVTOOLS_HEADLESS=true rtk node apps/miniapp/e2e/artifacts/overnight/scripts/overnight-e2e.mjs s1 s4   # 批 A（Spec 2 合入后）
WECHAT_DEVTOOLS_HEADLESS=true rtk node apps/miniapp/e2e/artifacts/overnight/scripts/overnight-e2e.mjs s3 s8   # A4（Spec 2 合入后，含新增 20s 用例）
rtk pnpm test:e2e:miniapp:ui:auth                            # A6（DevTools 稳定前提下）
```

## 9. 关联证据与文档

- 审计报告：`apps/miniapp/e2e/artifacts/overnight/e2e-report.md`
- 场景结果：`apps/miniapp/e2e/artifacts/overnight/results/overnight-e2e-report.json`、`screenshots/`
- 进度记录：`apps/miniapp/e2e/artifacts/overnight/progress-1.log`
- 并行会话 Spec 2（增量放行，含 stream_stalled 心跳）：`.worktrees/overnight-audit/docs/specs/2026-08-12-chat-streaming-incremental-output-spec.md`
- 并行会话其他 Spec：`2026-08-12-chat-latency-scope-classifier-spec.md`、`chat-memory-fact-persistence-spec.md`、`chat-model-routing-deepseek-only-spec.md`、`chat-output-protocol-sanitization-spec.md`
