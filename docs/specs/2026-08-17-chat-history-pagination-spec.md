# 聊天历史 50 条截断 + 首屏窗口修复 SPEC（2026-08-17，revision 1）

> 状态：`PLANNED`（用户已口头批准方案方向：进入会话显示最近一段历史 + 顶部加载更早消息；revision 1 已按审查意见定稿，待用户批准后进入实现）
> 变更标识：chat-history-pagination-2026-08-17
> 基线：`main` HEAD `b67c247`
> 客户反馈来源：2026-08-17 客户反馈（聊天超过 50 轮后不再记录后续轮次）+ 追加明确要求（进入会话不能是最早 50 条，应是最近 50 条；聊天记录要能一直往上拉看到全部历史）。

## 1. 目标

1. **首屏显示最近窗口**：进入会话时默认展示**最近 50 条**（而非现在的最早 50 条），解决"超过 50 轮后看不到最近对话、像是不再记录"的客户体感。
2. **无限向上回溯**：聊天记录支持往上拉持续加载更早消息，直到没有更早消息为止，全程可见全部历史。
3. **测试同步**：API 单元/集成测试 + 前端纯逻辑测试 + mock 服务测试 + UI e2e（环境可用时）覆盖新分页语义。

## 2. 范围与边界

### 2.1 范围内

| 板块 | 内容 | 优先级 |
| --- | --- | --- |
| A. API 分页契约 | `GET /api/chat/sessions/:id/messages` 改为游标分页：无游标返回最近窗口，`before` 游标返回更早窗口；响应新增 `hasMoreBefore`；移除 `page` | P0 |
| B. 前端首屏 | `chat/index.tsx` `loadSessionHistory` 走新契约，首屏 = 最近 50 条升序 | P0 |
| C. 前端上拉加载 | `ScrollView` `onScrollToUpper` 加载更早消息，prepend 保位，直到 `hasMoreBefore=false` | P0 |
| D. mock 对齐 | `mock-api-server.mjs` 全部 4 个 `/messages` 分支实现同语义分页（含递增时间戳语料） | P0 |
| E. 测试 | API 单元/集成 + `index.model` 纯逻辑 + mock 服务测试 + UI e2e | P0 |

### 2.2 边界 / 非目标

- **不改 FastClaw**：根因在前端历史加载写死 `page=1&limit=50`，FastClaw 记忆层无 50 轮上限（详见 §3.3），本 spec 不触碰 `fastclaw/`。
- **不做数据迁移**：无 schema/索引变更，`created_at` 已有值可直接作游标（毫秒截断见 §4.1）；不加 `total`（前端只需 `hasMoreBefore`，YAGNI）。
- **移除 `page` 参数**：请求不再解析、响应不再回显（见 P2-5 采纳说明）。全仓唯一调用方只传 `page=1`，无现实兼容负担；相关 API 测试同步改写。
- **不触碰用户 WIP**：`apps/miniapp/config/api-base-url.ts`、`infra/caddy/Caddyfile`（已 M）及所有未跟踪文件一律不动。
- **不做"加载更多"底部分页**：历史天然向更早方向增长，只做向上回溯。

## 3. 现状与根因（代码事实）

### 3.1 前端写死最早窗口，无翻页

`apps/miniapp/src/pages/chat/index.tsx:271-286`（`loadSessionHistory`）：

```ts
const data = await api.get<MessagesResponse>(`/api/chat/sessions/${targetSessionId}/messages?page=1&limit=50`);
// …中间经 map 转换为 ChatMessage…
setMessages(historyMessages);
```

（实际代码中 `api.get` 在 277 行、`setMessages` 在 285 行，中间隔着消息映射。）

- 全页无 `page>1` 调用、无 `onScrollToUpper`、无加载更早逻辑。
- 因此超过 50 条后：进入会话只见最早 50 条，最近对话"消失"，客户体感即"不再记录聊天/记忆到上限"。

### 3.2 API 分页按 offset 升序，page=1 = 最早窗口

`apps/api/src/app/api/chat/sessions/[id]/messages/route.ts`：

```ts
const page = parsePositiveInteger(url.searchParams.get('page'), 1);
const limit = Math.min(100, parsePositiveInteger(url.searchParams.get('limit'), 50));
const offset = (page - 1) * limit;
...
.orderBy(asc(messages.createdAt))
.limit(limit)
.offset(offset);
```

- `page=1` 返回**最早** 50 条（升序），与"进入会话看最近"需求相反。
- 响应仅 `session/messages/page/limit`，无 `hasMore`/`total`，前端无从知道是否还有更早消息。

### 3.3 FastClaw 记忆层无 50 轮上限（排除项）

- `fastclaw/internal/agent/loop.go` 的 `turnCount` 仅用于每 5 轮触发 AutoPersist，无 50 上限。
- 记忆文件（USER.md/MEMORY.md）无数量上限；压缩按 80K token 阈值（`compaction.go` `DefaultTokenThreshold = 80000`）。
- 与**聊天历史 50 条显示截断**相关的"50"仅消息 API 的默认 limit（`apps/api/src/app/api/chat/sessions/[id]/messages/route.ts` 的 `limit=50` 与前端写死的 `limit=50`）。
- 全仓其余"50"均与聊天历史截断无关，逐一排除：
  - `apps/api/src/app/api/chat/characters/route.ts:10` `MAX_LIMIT = 50`：聊天列表接口分页上限，非历史截断；
  - `apps/api/src/app/api/chat/sessions/route.ts:22` `Math.min(50, …)`：会话列表分页上限，非历史截断；
  - `apps/api/src/app/admin/*/page.tsx` 6 处 `pageSize: 50`：管理后台分页，非历史截断；
  - `apps/miniapp/e2e/mock-api-server.mjs` 4 处默认 `limit 50`：mock 回显，属本 spec 同步对象；
  - `fastclaw/internal/agent/memory.go:266` `reviewCount := 50`：heartbeat 只回顾最近 50 行 history log 的记忆抽取窗口，**不影响消息落库**，排除结论仍成立；
  - `fastclaw/internal/setup/handlers.go:632` `RecentTasks(50)`：任务队列查询，与聊天历史无关。

### 3.4 mock 服务分页是摆设

`apps/miniapp/e2e/mock-api-server.mjs` 共 **4 个** `/messages` 分支：
- `session-hakuzo-free`（L696）、`session-hakuzo-free-only`（L729）为**硬编码数组**，不走 `chatCorpusMessages`；
- `session-hakuzo`（L752）、`session-chengyuhuai`（L773）返回全量 `chatCorpusMessages(...)`。

四个分支的 `page/limit` 仅回显、无实际分页；`chatCorpusMessages`（L248-254）里所有消息 `createdAt` 均为同一个 `now`，无法演示分页窗口。若只改 corpus 分支，free 分支响应缺 `hasMoreBefore` → 前端 `undefined` 配合守卫可能反复请求，因此**全部 4 个分支必须同语义**。

## 4. 接口契约（新）

### 4.1 请求

| 参数 | 类型 | 语义 |
| --- | --- | --- |
| `limit` | int | 每页条数，默认 50，上限 100（不变） |
| `beforeCreatedAt` | ISO 8601 | 游标：仅返回早于该时刻的消息；**必须与 `beforeId` 成对出现** |
| `beforeId` | string | 游标：同毫秒时按 id 字典序取更小者，复合游标防漏 |

- 无 `before*`：返回**最近** `limit` 条（服务端 `ORDER BY ms_trunc(created_at) DESC, id DESC` 取 `limit+1` 条，返回前 `limit` 条并 reverse 为升序）。
- 有 `before*`：`WHERE (ms_trunc(created_at) < :beforeCreatedAt) OR (ms_trunc(created_at) = :beforeCreatedAt AND id < :beforeId)`，同序取窗，返回升序。
- **`page` 参数：不再解析、不再回显**（revision 1 移除，见 §2.2；旧客户端传 `page` 被忽略，不影响新行为）。
- **输入校验（P0-2 定稿）**：
  - `beforeCreatedAt` 与 `beforeId` 任一缺失 → `400 errorResponse('beforeCreatedAt and beforeId must be provided together')`；
  - `beforeCreatedAt` 非法（`Date.parse` 失败）→ `400 errorResponse('invalid beforeCreatedAt')`；
  - `limit` 非法 → 沿用现有 `parsePositiveInteger` 回退默认 50（不变）。

### 4.2 响应

```jsonc
{
  "session": { /* 不变 */ },
  "messages": [ /* 恒为升序，与旧客户端渲染兼容 */ ],
  "limit": 50,
  "hasMoreBefore": true   // 新增：是否还有更早消息（取 limit+1 判断，无 count 查询）
}
```

- `hasMoreBefore` 判定：窗口查询取 `limit+1` 条，取到第 `limit+1` 条则 `true`，响应只含前 `limit` 条。
- 消息不足 `limit` 条时 `hasMoreBefore=false`，首屏即全量。
- **空窗口**：`before` 游标早于全部消息 → `messages: []` + `hasMoreBefore: false`（P2-3 显式定义）。

### 4.3 毫秒截断与游标一致性（P0-1 定稿）

- `messages.created_at` 为 Postgres `timestamptz`（微秒精度，`schema.ts:149`）；drizzle 以 JS `Date` 返回，JSON 序列化为**毫秒** ISO 字符串，客户端回传的只能是毫秒值。
- 若不截断，跨页边界可能静默丢消息：两条消息相差 <1ms（如 `.001100` 与 `.001123`，均序列化为 `.001Z`），游标比较 `created_at < '.001Z'`（µs 精度）与 `= '.001Z'` 都不命中较早那条。
- **修复**：SQL 层比较与排序统一用 `date_trunc('milliseconds', created_at)`（即 `ms_trunc`），序列化粒度与查询粒度一致；同毫秒内全部由 `id` 决胜。代价是 `session_id_created_at_idx` 索引不再被直接利用，当前数据量下可接受，不做迁移。

## 5. 前端交互设计

### 5.1 首屏（`loadSessionHistory`）

- 请求改为 `/api/chat/sessions/:id/messages?limit=50`（不带 `page`/`before*`）。
- 现有 `historyLoadIdRef` 竞态守卫、`scrollIntoViewRef` 定位、空历史复位逻辑（`index.tsx:317/352` 两处 `= ''`，08-16 已落地）全部保留。

### 5.2 上拉加载更早（新增 `loadEarlierMessages`）

- `ScrollView`（`index.tsx:806`）增加 `onScrollToUpper`。
- 触发条件：`messages.length > 0`、`hasMoreBefore === true`（严格相等，非 `!== false`，防字段缺失/旧缓存反复触发，P2-4）、`!earlierLoadingRef.current`、`!historyLoading`。
- 游标取当前 `messages[0]`：`beforeCreatedAt=messages[0].createdAt&beforeId=messages[0].id`。
- 成功：`setMessages(prev => mergeEarlierMessages(earlier.messages, prev))`（按 id 去重后 prepend，防御重复返回）。
- **竞态守卫（P1-5 定稿）**：新增 `earlierLoadingRef`（`useRef(false)`），进入时同步置 `true`、结束（成功/失败/会话切换丢弃）复位 `false`，**state 只用于渲染**，防同帧多次 `onScrollToUpper` 在重渲染前并发进入；同时保留既有模式——进入时记录 `historyLoadIdRef.current`，返回时比对，不一致则丢弃结果（会话已切换）。
- **失败处理（P1-3 定稿）**：独立 `earlierError` 状态 + 顶部错误条 + 重试按钮，**只重试当前游标**（重新调用 `loadEarlierMessages`，不重置窗口）；**不复用 `historyError`**（其"重新加载"走 `retryHistoryLoad` → `loadSessionHistory` → 重拉最近窗口并贴底，会丢掉用户上拉位置）。
- 终止：`hasMoreBefore=false` 后不再触发；"已到最早消息"提示**仅在有上拉尝试或 `messages.length >= limit` 后显示**，短会话首屏不出现（P2-6）。
- 加载中：顶部轻量 loading，不复用 `historyLoading`（那是"正在切换会话"文案）。

### 5.3 滚动保位

- prepend 前记录原首条 id（`anchorId = messages[0].id`）；prepend 后置 `scrollIntoViewRef.current = 'msg-' + anchorId`。
- Taro 对相同锚点值不重复触发（08-16 spec 已踩过），prepend 后原首条 id 已不是新首条，值必然变化 → 触发滚动锚定，用户看到的视口内容不跳动。
- `scrollWithAnimation` 保持现有 true；若锚定动画导致跳动，e2e/手动验证后改为滚动前临时关闭动画（实现期验证，不做预留抽象）。
- **级联风险（P2-7）**：锚定后若仍落在 upperThreshold 内，`onScrollToUpper` 可能连续自动加载直到 `hasMoreBefore=false`（行为上不算错，但会一次性拉完全部历史）。e2e 验证；如出现，用 `earlierLoadingRef` 触发后短时冷却（实现期定，不做预留抽象）。

## 6. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/app/api/chat/sessions/[id]/messages/route.ts` | 游标分页：无 `before` 取最近窗口；`beforeCreatedAt`+`beforeId` 复合游标（成对校验 + 非法 400）；SQL 毫秒截断比较/排序（`date_trunc('milliseconds', created_at)`）；`ORDER BY ms_trunc DESC, id DESC`；响应加 `hasMoreBefore`、移除 `page` |
| `apps/api/src/app/api/chat/sessions/[id]/messages/route.test.ts` | 新增：最近窗口升序、before 翻页、`hasMoreBefore` true/false、空窗口、同毫秒复合游标不丢消息、`before*` 缺失/非法 400、`page` 被忽略且响应无 `page`（改写现有 3 个 page 用例）；适配 db mock 调用序（orderBy 变化） |
| `apps/miniapp/src/pages/chat/index.tsx` | `MessagesResponse` 接口加 `hasMoreBefore: boolean`（L76-85，P1-7）；`loadSessionHistory` 新契约；新增 `loadEarlierMessages` + `onScrollToUpper` + `earlierLoadingRef` 竞态守卫 + 顶部 loading/错误/终点态 + 滚动保位 |
| `apps/miniapp/src/pages/chat/index.model.ts` | 纯函数：`buildMessagesUrl`（limit/before 参数构造）、`mergeEarlierMessages`（id 去重 prepend，命名统一，P2-2） |
| `apps/miniapp/src/pages/chat/index.model.test.ts` | 上述纯函数用例（URL 构造、去重 prepend、空输入） |
| `apps/miniapp/e2e/mock-api-server.mjs` | **全部 4 个** `/messages` 分支同语义（无游标=最近窗口升序 + `hasMoreBefore`）；`chatCorpusMessages` 生成递增 `createdAt`（如 `now - (N - index) * 60000`）；chengyuhuai 语料程序化扩充 ≥51 条（保留现有 6 条头部语义，追加可区分首尾内容，id 规则沿用 `msg-chengyuhuai-N`）；**列表预览 `lastMessage` 改为从 corpus 末条派生**（L589/668 两处，消除与消息流不一致的漂移，P1-8） |
| `apps/miniapp/e2e/mock-api-server.test.mjs` | 新增：最近窗口（首条=语料第 N-49 条而非第 1 条）、before 翻页、`hasMoreBefore` 边界、**free 分支（含 `session-hakuzo-free`）也含 `hasMoreBefore`**（P1-4）；适配现有断言（L333/L441 的 `page=1&limit=50` URL 仍可用，mock 容忍 `page` 参数） |
| `apps/miniapp/e2e/runtime-ui-authenticated.mjs` | 新增 e2e：首屏最近窗口 + 上拉加载更早（驱动与断言见 §7.2，微信开发者工具可用才跑） |
| `docs/specs/2026-08-17-chat-history-pagination-spec.md` | 本文件（revision 1） |

> 不改：`fastclaw/`、用户 WIP 文件、schema/迁移、`apps/miniapp/config/api-base-url.ts`、`infra/caddy/Caddyfile`。

## 7. 验证方案

### 7.1 自动化命令（推进会话必须全部真实通过）

```bash
# API 单元/集成
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/api typecheck

# miniapp 单元 + mock 服务测试
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck

# harness 门禁
rtk pnpm run test:dev-script
rtk pnpm run test:deploy-config

# UI e2e（需微信开发者工具；环境可用才跑，不可用则记录阻塞，不得声称通过）
rtk pnpm --filter @juben-sha/miniapp test:e2e:ui:auth
```

### 7.2 功能验收清单

1. 长会话（chengyuhuai 语料 ≥51 条）进入：首屏可见**最近** 50 条，**首条 = 语料第 N-49 条（而非第 1 条）**，最后一条贴底。
2. 上拉：持续加载更早窗口，滚动位置不跳动；到底后不再触发，显示"已到最早消息"。
3. 短会话（<50 条）：首屏全量，无上拉入口、无"已到最早消息"文案。
4. 加载更早期间切换模式/退出会话：不串消息、不闪错误。
5. 现有行为回归：空历史、单边模式切换滚动定位（08-16 修复点）、发送消息后贴底不受影响。
6. **e2e 驱动方式（P1-6 定稿，`runtime-ui-authenticated.mjs`）**：
   - 触发上拉的尝试顺序：① `page.callMethod('onScrollToUpper')`（或 Taro 组件实例方法）→ ② `element.trigger('scrolltoupper', { detail: { scrollTop: 0 } })` → ③ 模拟 touch 上滑（touchstart/touchmove/touchend）；以能真实驱动 `onScrollToUpper` 为准，并在脚本注释记录最终采用的方式。
   - 断言点：首屏首条 = `msg-chengyuhuai-<N-49>`（非 `msg-chengyuhuai-1`）；触发上拉后消息数增加（≥51）；原首条仍在视口（prepend 不跳，用 bubble 相对位置或 `scrollTop` 口径，与 08-16 同风格 fallback 说明）；`hasMoreBefore=false` 后消息数不再增长。

## 8. 风险与回撤

- **行为变更**：`page` 从"最早窗口 + offset 分页"改为"无游标 = 最近窗口 + before 游标"，且响应移除 `page`。全仓唯一调用方随本 spec 同步修改；若有遗漏调用方，看到最近消息属预期修复方向，不构成回退。
- **游标精度（P0-1）**：SQL 层 `date_trunc('milliseconds', created_at)` 统一比较与排序，序列化粒度（毫秒 ISO）与查询粒度一致，同毫秒（含微秒级差）由 `id` 决胜——**无静默遗漏**。代价：`messages_session_id_created_at_idx` 索引不再直接命中，当前数据量下可接受；数据量增长后另立 spec 评估 `created_at` 毫秒截断表达式索引。
- **同毫秒顺序**：同毫秒内消息顺序按 id 字典序，与业务插入顺序可能不完全一致（极端罕见，可接受）。
- **滚动跳动/级联**：锚点保位方案若出现跳动，e2e 验证后调整（临时关闭 `scrollWithAnimation`）；级联加载（P2-7）行为不算错，必要时 `earlierLoadingRef` 冷却。
- **mock 语料变化**：chengyuhuai 扩充至 ≥51 条、`createdAt` 递增、列表预览派生自 corpus 末条，可能影响现有 mock 测试断言（如消息数、排序），属预期，需同步更新，不是实现失败。
- **e2e 环境**：微信开发者工具不可用时不得声称 e2e 通过；必须在环境可用后补跑或明确记录阻塞。
- **回撤**：改动均为纯代码/测试，`git revert` 对应提交即可；无数据迁移、无 schema 变更。

## 9. 验收定义（Done）

- [ ] API 路由：无 `before` 返回最近窗口（升序）、`beforeCreatedAt`+`beforeId` 游标返回更早窗口、响应含 `hasMoreBefore`、无 `page`；`before*` 缺失/非法返回 400。
- [ ] API 测试覆盖：最近窗口、before 翻页、`hasMoreBefore` true/false、空窗口、同毫秒复合游标（毫秒截断）不丢消息、`before*` 400、`page` 忽略。
- [ ] `MessagesResponse` 加 `hasMoreBefore: boolean`；前端首屏走新契约（最近 50 条），`onScrollToUpper` 加载更早直至 `hasMoreBefore=false`，`earlierLoadingRef` 竞态守卫，prepend 去重 + 滚动保位，独立 `earlierError` 仅重试当前游标。
- [ ] `index.model.ts` 纯函数 + 测试落地（`buildMessagesUrl`、`mergeEarlierMessages`）。
- [ ] mock 全部 4 个 `/messages` 分支与真实服务同语义（含递增时间戳语料、chengyuhuai ≥51 条、列表预览派生末条），mock 测试覆盖 free 分支 `hasMoreBefore`。
- [ ] §7.1 全部命令真实通过（e2e 按环境可用性处理）；无用户 WIP 文件被改动。

## 10. 修订记录

- revision 0（2026-08-17）：初稿。基于客户反馈（50 轮截断 + 最近窗口 + 全量回溯）、`chat/index.tsx`、消息 API 路由、mock/e2e 基建代码审计；根因排除 FastClaw 记忆层。用户已批准方案方向。
- revision 1（2026-08-17）：按审查意见修订（审查结论：修改后批准）。
  - **P0-1**：游标比较/排序统一 `date_trunc('milliseconds', created_at)`，§8 删除"保证不丢"绝对化表述，改为"毫秒截断 + id 决胜，无静默遗漏"。
  - **P0-2**：`before*` 成对校验 + 非法 400，写入 §4.1 与测试清单。
  - **P1-1**：§3.3 改写为"与聊天历史截断相关的 50 仅消息 API limit"，逐一排除其余 50（含 `memory.go:266` reviewCount 说明）。
  - **P1-2**：`ScrollView` 行号 801 → 806。
  - **P1-3**：失败处理定稿为独立 `earlierError` + 仅重试当前游标。
  - **P1-4**：mock 全部 4 个 `/messages` 分支同语义 + free 分支 `hasMoreBefore` 断言。
  - **P1-5**：`earlierLoadingRef` 同步守卫，state 仅渲染。
  - **P1-6**：e2e 驱动方式（callMethod → trigger → touch 兜底顺序）与断言点写入 §7.2。
  - **P1-7**：改动清单补 `MessagesResponse` 加 `hasMoreBefore: boolean`。
  - **P1-8**：chengyuhuai 语料程序化扩充 ≥51 条、列表预览派生自 corpus 末条。
  - **P2 全部采纳**：行号与省略标记（P2-1）、命名统一 `mergeEarlierMessages`（P2-2）、空窗口显式定义（P2-3）、守卫 `=== true`（P2-4）、移除 `page` 参数（P2-5）、短会话不显示终点文案（P2-6）、级联风险记录（P2-7）、§3.4 表述修正（P2-8）。
  - **一致性**：本 spec 覆盖 2026-08-16 §5 中"messages 端点无契约变更"的声明（08-17 是有意的 supersede）。
