# 聊天模式切换滚动定位 + 聊天搜索全量模糊 SPEC（2026-08-16，revision 0）

> 状态：`PLANNED`（用户已批准范围：实现 + 单元/集成测试 + e2e 由新会话推进）
> 变更标识：chat-scroll-reset-and-full-text-search-2026-08-16
> 基线：`main` HEAD `b67c247`
> 客户反馈来源：2026-08-16 客户反馈截图（OCR 提取 6 条）；本 spec 只处理 **#3 切换模式后聊天记录置顶** 与 **#6 搜索搜不到**；#1 动作频率、#2 布雷诺提及、#4 男女记录互通、#5 以撒设定均搁置，不在本 spec 范围。

## 1. 目标

1. **修复滚动定位（#3）**：同一角色只有单边模式有历史时，A(有历史) → B(无历史) → A 切换后聊天记录停在顶部、不显示最近；修复后每次进入/切回有历史模式都滚动到底部最近一条。
2. **搜索全量 + 模糊（#6）**：`GET /api/chat/characters?q=` 从「角色名 + 每角色最近一条预览」匹配，升级为「角色名 + 该用户该角色**全部消息正文**」的模糊匹配；搜一两个字、命中旧消息也能搜到。
3. **e2e 一起做**：本 spec 的验收必须包含微信开发者工具环境下可运行的 UI e2e（滚动定位 + 搜索），以及 mock 服务层测试、API 单元/集成测试。

## 2. 范围与边界

### 2.1 范围内

| 板块 | 内容 | 优先级 |
| --- | --- | --- |
| A. 滚动修复 | `chat/index.tsx` 空模式分支重置 `scrollIntoViewRef`（根因修复，最小改动） | P0 |
| B. 全量搜索 | `character-summary-service.ts` `getCharacterChatEntries` 增加消息正文 `ilike` 匹配，接口契约不变 | P0 |
| C. 测试 | API 单元/集成测试 + mock 服务测试 + UI e2e（滚动、搜索各一条） | P0 |
| D. mock 对齐 | `mock-api-server.mjs` 的 `/api/chat/characters` 关键词过滤改为全语料，与真实服务语义一致 | P0 |

### 2.2 边界 / 非目标

- **不改前端**：`list.tsx` / `list.model.ts` 已透传 `q`（250ms 防抖），本次零改动。
- **不做角色卡**：#1/#2/#5 搁置；#4 数据模型不动。
- **不引入 pg_trgm / GIN 索引**：数据量当前量级下全量 `ilike` 足够；若后续命中性能劣化，另立 spec。
- **不合并/迁移会话数据**：维持 `(characterId, mode, scriptId)` 分会话模型。
- **不触碰用户 WIP**：`apps/miniapp/config/api-base-url.ts`、`infra/caddy/Caddyfile`（已 M）及所有未跟踪文件一律不动。
- **搜索口径**：只搜 `role in ('user','assistant')` 的消息（与预览口径一致），不搜 system 消息；`excludedFromContext` 的留言正文属 assistant 消息，可被搜到（与历史流可见性一致）。

## 3. 现状与根因（代码事实）

### 3.1 #3 滚动定位：stale `scrollIntoViewRef` 导致 Taro 不重复触发

- `scrollIntoViewRef` 声明于 `apps/miniapp/src/pages/chat/index.tsx:166`（`useRef('')`）。
- `loadSessionHistory` 有历史时置为 `msg-<最后一条 id>`（`index.tsx:314`）。
- `loadScopeHistory` **无该模式会话**的空分支（`index.tsx:346-351`）只做 `setMessages([])` / `setHistoryError('')` / `setScope(...)` / `setCanSend(true)` / `setHasSuccessfulTurn(false)`，**未重置 `scrollIntoViewRef.current`**。
- `ScrollView`（`index.tsx:801`）`scrollIntoView={scrollIntoViewRef.current}`；Taro 对**相同值不重复触发滚动**。

**复现路径（单边历史）**：
1. 进入 A 模式（有历史）→ `ref = msg-A-last`，滚到底。✓
2. 切到 B 模式（无历史）→ 空分支清空消息，但 `ref` 仍为 `msg-A-last`；消息清空后 ScrollView 停在顶部。
3. 切回 A 模式 → `loadSessionHistory` 再次置 `ref = msg-A-last`，**与切换前的值相同** → Taro 不触发滚动 → 停留在顶部，不显示最近。✗

**双边都有历史时正常的原因**：A→B→A 时 `ref` 值依次为 `msg-A-last` → `msg-B-last` → `msg-A-last`，每次值都变化，Taro 每次都触发滚动。

### 3.2 #6 搜索：只匹配「最近一条预览」，旧消息/单字搜不到

- 前端已完整透传：`list.tsx` `SearchBar`（`packages/miniapp-ui/src/components/inputs/SearchBar.tsx`，input 类名 `.ui-search-bar__input`）→ `handleSearchInput`（250ms 防抖）→ `loadCharacterChats` → `buildCharacterChatsUrl(q)`（`list.model.ts:31-40`）→ `GET /api/chat/characters?q=`。
- 路由 `apps/api/src/app/api/chat/characters/route.ts` 已 `trim().toLowerCase()` 并透传 `keyword`。
- 服务端 `apps/api/src/server/modules/chat/character-summary-service.ts:163-168`：
  ```ts
  const matchingRows = keyword
    ? visibleRows.filter((row) => {
      const lastMessage = previews.get(row.id) ?? '';
      return `${row.characterName} ${lastMessage}`.toLowerCase().includes(keyword);
    })
    : visibleRows;
  ```
- `previews` 来自 `getLatestMessagePreviewBySession`（`service.ts:86-105`），每会话**仅最近一条** user/assistant 消息。
- 结论：搜一两个字、或关键词只出现在**非最近消息**中时，必然搜不到。前端无需改动。

## 4. 方案设计

### 4.1 A 滚动修复（`apps/miniapp/src/pages/chat/index.tsx`）

**核心修复**：`loadScopeHistory` 空分支（`index.tsx:346-351`）内，`setMessages([])` 之后补一行：

```ts
scrollIntoViewRef.current = '';
```

语义：B 模式清空后 `ref` 归零；切回 A 模式时 `ref` 由 `''` → `msg-A-last`，**值变化** → Taro 触发滚动到底。

**同一行防御（对称补漏）**：`loadSessionHistory` 中 `historyMessages.length === 0` 时（会话存在但无 user/assistant 消息的边界），同样置 `scrollIntoViewRef.current = ''`，避免 stale id 残留。两处合计 2 行，无行为副作用。

### 4.2 B 全量模糊搜索（`apps/api/src/server/modules/chat/character-summary-service.ts`）

在 `getCharacterChatEntries`（`service.ts:138-176`）内、`getLatestSessionRows` 之后做最小改动：

1. **新增私有查询**（keyword 非空时执行）：
   ```ts
   /** 命中该用户全部消息正文（user/assistant）的角色 id 集合。 */
   async function findCharacterIdsByMessageContent(userId: string, keyword: string): Promise<Set<string>> {
     const rows = await db
       .select({ characterId: chatSessions.characterId })
       .from(chatSessions)
       .innerJoin(messages, eq(messages.sessionId, chatSessions.id))
       .where(and(
         eq(chatSessions.userId, userId),
         or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
         ilike(messages.content, `%${keyword}%`),
       ));
     // 与仓库「额外一遍 JS 去重」风格一致（本文件已有先例），Set 天然去重。
     return new Set(rows.map((row) => row.characterId));
   }
   ```
   > 说明：不用 `DISTINCT ON` / `selectDistinct`，避免引入新查询形态；消息表当前无 `(characterId, content)` 索引，全量扫描由 `chatSessions.userId` 过滤收敛。查询必须带 `chatSessions.userId` 条件（防跨用户泄漏）。

2. **匹配口径替换**（`service.ts:163-168`）：
   ```ts
   const matchingByContent = keyword ? await findCharacterIdsByMessageContent(userId, keyword) : null;
   ...
   const matchingRows = keyword
     ? visibleRows.filter((row) =>
       row.characterName.toLowerCase().includes(keyword) || matchingByContent?.has(row.characterId),
     )
     : visibleRows;
   ```
   - 角色名匹配保留现状（大小写不敏感，与路由 lowercase 一致）。
   - 去掉「最近一条预览」匹配（已包含在全量正文匹配内），避免口径漂移。
   - `previews` 仍照常查询（输出条目需要 `lastMessage`），分页逻辑不变。

3. **接口契约不变**：`q` 语义由「角色名 + 最近一条」扩为「角色名 + 全量消息正文」；响应结构、分页、排序不变。

### 4.3 D mock 对齐（`apps/miniapp/e2e/mock-api-server.mjs`）

- `/api/chat/characters`（约 `mock-api-server.mjs:501-600`）当前过滤为 `characterName + lastMessage` 的 `includes`，改为**全语料过滤**：定义每角色消息语料常量（与 `/api/chat/sessions/<id>/messages` 端点共用同一数据源，避免两处漂移），过滤条件为「角色名 or 任一消息正文」包含 keyword。
- 为 e2e 准备语料：
  - **程聿怀（chengyuhuai）**：`session-chengyuhuai/messages` 扩充为多条（≥6 条，含 1 条旧消息关键词，如「铜雀街的旧案卷」），最近一条保持现状；用于滚动断言（多消息才能区分置顶/置底）与旧消息搜索断言。
  - **白藏（hakuzo）**：`session-hakuzo/messages` 保持现有一条即可；`q=白` 角色名命中的既有 mock 测试不受影响。
- 同步更新 `mock-api-server.test.mjs`：新增「旧消息关键词命中」「单字命中」「无命中返回空」用例。

### 4.4 C 测试计划

#### 4.4.1 API 单元/集成（vitest）

- `apps/api/src/server/modules/chat/__tests__/character-summary-service.test.ts`：
  - 关键词命中**非最近**的旧消息 → 该角色仍返回（核心回归）；
  - 关键词命中 user 消息正文 → 返回；
  - 单字关键词（如「月」）命中历史正文 → 返回；
  - 关键词无命中 → 空列表；
  - 角色名命中（无正文命中）→ 返回；
  - **注意**：新增 `findCharacterIdsByMessageContent` 会改变 db mock 调用顺序，现有 `orderByMock`/`selectDistinctOnMock` 的 `mockImplementationOnce` 链需按新调用序调整。
- `apps/api/src/app/api/chat/characters/route.test.ts`：
  - 新增「q 命中旧消息正文」「q 单字」「q 无命中」集成用例；
  - `setupDbMock` 需适配新增查询的调用序。

#### 4.4.2 UI e2e（`apps/miniapp/e2e/runtime-ui-authenticated.mjs`，`PAGE_CHECKS` 新增两条）

**用例 1：`chat-mode-switch-scroll-reset`（滚动定位）**
- 路由：`pages/chat/index?characterId=chengyuhuai&mode=script`（程聿怀：剧本有历史、自由无历史 → 复现单边历史）。
- 步骤：
  1. `ready: ['.chat-page', '.chat-bubble-row']`，等待历史加载；
  2. 记录滚动视图 `.chat-page__messages` 与最后一条 `.chat-bubble-row` 的 `getElementBox` rect；
  3. 点击第二个 `.chat-page__mode-option`（自由模式）→ 等待空态/starter 出现；
  4. 再点击剧本模式 option → 轮询等待 `.chat-bubble-row` 重新出现；
  5. **断言**：最后一条 bubble 的 `rect.bottom` 与 `.chat-page__messages` 的 `rect.bottom` 差在容差内（如 ≤ 40px），且 bubble 可见（`rect.top < scrollView.bottom`）；修复前该断言失败（停在顶部时最后一条 bubble 在可视区下方或远离底边）。
- 容差与元素口径在实现时以实际 devtools 坐标为准，但断言方向不变：**必须证明最后一条消息贴近滚动视图底边**。

**用例 2：`chat-search-full-text`（全量模糊搜索）**
- 路由：`pages/chat/list`（switchTab），`ready: ['.chat-list__body']`。
- 步骤：
  1. 通过 `.ui-search-bar__input` 输入旧消息关键词（如「铜雀」）→ 等待 250ms 防抖 + 列表刷新；
  2. 断言列表只剩程聿怀（`characterName` 命中旧消息，`lastMessage` 不含该词）；
  3. 清空（`.ui-search-bar__clear`）→ 输入单字关键词（如「月」）→ 断言白藏/程聿怀等按 mock 语料命中；
  4. 清空 → 断言恢复全量列表。
- 若 automator 的 `element.input()` 对 Input 组件不可用，可用 `element.trigger('input', { detail: { value } })` 或 `page.callMethod` 兜底，以能真实驱动 `onInput` 为准。

## 5. 接口契约

| 接口 | 用途 | 变更 |
| --- | --- | --- |
| `GET /api/chat/characters?q=` | 聊天列表搜索 | 语义扩为全量正文模糊匹配；响应结构/分页/排序不变 |
| `GET /api/chat/sessions?characterId=&mode=` | 模式切换定位会话 | 无 |
| `GET /api/chat/sessions/:id/messages` | 历史加载 | 无（mock 语料扩充仅影响 e2e 数据，非契约变更） |

## 6. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/miniapp/src/pages/chat/index.tsx` | 空分支 + `loadSessionHistory` 空历史分支重置 `scrollIntoViewRef.current = ''`（共 2 行） |
| `apps/api/src/server/modules/chat/character-summary-service.ts` | 新增 `findCharacterIdsByMessageContent`；`getCharacterChatEntries` 匹配口径改全量 |
| `apps/api/src/server/modules/chat/__tests__/character-summary-service.test.ts` | 新增旧消息/单字/无命中用例；适配 db mock 调用序 |
| `apps/api/src/app/api/chat/characters/route.test.ts` | 新增集成用例；适配 `setupDbMock` |
| `apps/miniapp/e2e/mock-api-server.mjs` | `/api/chat/characters` 全语料过滤；程聿怀语料扩充（≥6 条含旧关键词） |
| `apps/miniapp/e2e/mock-api-server.test.mjs` | 新增搜索过滤用例 |
| `apps/miniapp/e2e/runtime-ui-authenticated.mjs` | `PAGE_CHECKS` 新增滚动复位 + 全量搜索两条用例 |

> 不改：`apps/miniapp/src/pages/chat/list.tsx`、`list.model.ts`、`apps/api/src/app/api/chat/characters/route.ts`、用户 WIP 文件。

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

# UI e2e（需微信开发者工具；先按 README/脚本要求构建 mock dist）
rtk pnpm --filter @juben-sha/miniapp test:e2e:ui:auth
```

> e2e 前置：`apps/miniapp/e2e/runtime-ui-authenticated.mjs` 会校验 dist 是否按 `mockApiBaseUrl` 构建（`assertDistBuiltForMockApi`），需按该脚本头部注释执行对应构建命令。

### 7.2 功能验收清单

1. 程聿怀剧本（有历史）→ 自由（无历史）→ 剧本：最后一条消息贴底可见（e2e 用例 1 + 手动复核）。
2. 双边都有历史（白藏？mock 需自由会话存在的角色）切换往返：仍正常贴底（回归，防过度修复）。
3. 搜索旧消息关键词命中对应角色；搜单字命中；无命中空态；清空恢复全量（e2e 用例 2 + 手动复核）。
4. 聊天列表其余交互（红点、进入会话、翻页）回归不受影响。

## 8. 风险与回撤

- **滚动误判**：若 devtools 的 `offset()` 语义不是视口坐标，滚动断言需改用「最后一条 bubble 与 scroll-view 的 rect 相对位置」或 `page.scrollTop()` 等可行口径；断言方向（最后一条贴近底边）不变。
- **搜索性能**：全量 `ilike '%kw%'` 无索引可用；当前数据量小可接受，超阈值后另立 spec 引入 pg_trgm/GIN。
- **db mock 调用序**：新增查询会破坏现有 mock 链，属预期改动，需同步更新测试，不是实现失败。
- **e2e 环境**：微信开发者工具不可用时不得声称 e2e 通过；必须在环境可用后补跑 `test:e2e:ui:auth` 或明确记录阻塞。
- **回撤**：改动均为纯代码/测试，`git revert` 对应提交即可；无数据迁移、无 schema 变更。

## 9. 验收定义（Done）

- [ ] `index.tsx` 两处 `scrollIntoViewRef.current = ''` 复位已落地。
- [ ] `character-summary-service.ts` 全量正文 `ilike` 匹配已落地，`route.ts` 未改。
- [ ] API 单元/集成测试覆盖：旧消息命中、单字命中、user 消息命中、无命中、角色名命中。
- [ ] mock `/api/chat/characters` 全语料过滤与真实服务语义一致，mock 测试通过。
- [ ] `test:e2e:ui:auth` 新增两条用例通过（滚动复位 + 全量搜索）。
- [ ] §7.1 全部命令真实通过；无用户 WIP 文件被改动。

## 10. 修订记录

- revision 0（2026-08-16）：初稿。基于客户反馈 #3/#6、`chat/index.tsx`、`character-summary-service.ts`、mock/e2e 基建代码审计；用户已批准范围（含 e2e），待新会话推进实现。
