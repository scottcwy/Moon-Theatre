# 聊天入口统一与历史一致性 SPEC（2026-08-12，revision 1）

> 状态：`PLANNED`（尚未实现；实现由新会话审核放行后推进）
> 变更标识：chat-entry-unification-2026-08-12
> 基线：`main` HEAD `ee8d3c4`（含 807c27f 裁剪头像合并 + ee8d3c4 素材压缩）
> revision 1：用户语义确认（2026-08-12）——聊天列表入口进自由；剧本页入口选哪个进哪个；Chat Index 进入即按 scope 加载历史；历史一致性为硬性要求；红点 free 优先且跳转进自由会话；留言正文滚动定位本期不做；Logo 换新素材。

## 1. 目标

统一「角色聊天」的两条进入链路，保证同一角色的聊天历史**不因入口不同而隔离**：

1. 聊天列表点击角色 → 一律进入**自由聊天**（`mode=free`）。
2. 剧本页/角色详情 → 用户**选哪个进哪个**（“进入剧本”→ 剧本模式；“自由聊天”→ 自由模式），入口保持用户显式选择。
3. Chat Index 无论从哪条入口进入，都**按 scope 设置模式并加载该模式历史**（修复“剧本入口空白起步”）。
4. 红点跳转 free 优先：看到红点点击角色，必须落在自由会话（留言正文在自由会话历史中可见）。
5. 聊天列表头部 Logo 替换为“月满楼”新素材。

## 2. 范围与边界

### 2.1 范围内

| 板块 | 内容 | 优先级 |
| --- | --- | --- |
| A. 统一入口 | 聊天列表点击 → `?characterId&mode=free`；剧本页保持 `?characterId&mode&scriptId`（用户选择） | P0 |
| B. 进入即加载历史 | Chat Index `characterId` 入口：按 scope 查会话并加载历史（抽公共函数，模式切换复用） | P0 |
| C. 默认模式兜底 | `getDefaultChatMode` / `getCharacterDefaultMode` 改 free 优先 | P1 |
| D. 红点跳转 | 列表点击统一 free（红点点击自动落在自由会话）；不新增独立红点跳转逻辑 | P0 |
| E. Logo | 回填新素材 + 替换 `ChatListHeader` 引用 | P2 |

### 2.2 边界 / 非目标

- **不改服务端**：统一入口与历史加载全部复用现有接口，无 API 变更。
- **不合并自由/剧本会话**：数据模型维持“同一角色按 `(characterId, mode, scriptId)` 分会话”；“历史一致”= 各模式历史完整、模式切换可见，而非单一会话混流。
- **不做留言正文滚动定位/高亮**（用户确认本期不做）。
- **不做 tabBar 红点直达**（tab 切换语义，仅提示）。
- **不做留言注入测试接口**：红点可测性问题后续另立方案讨论（见 §7 后续）。
- 不动 `apps/miniapp/e2e/runtime-ui-authenticated.mjs`（用户 WIP）。

## 3. 现状与问题（代码事实）

### 3.1 两条入口不一致

- 聊天列表：`chat/list.tsx:185-187` `handleCharacterTap` → `getCharacterChatUrl(entry.latestSessionId)`（`list.model.ts:36-38`）→ `/pages/chat/index?sessionId=...`。
- `latestSessionId` 语义：服务端 `character-summary-service.ts:63` 按 `updatedAt desc` 取该角色**最新会话（不分模式）**——实测季沧海 `lastUsedMode=script`，点列表进的是剧本会话。
- 剧本页/角色详情：`character/detail.tsx:180-189` 已有显式“进入剧本 / 自由聊天”两个按钮 → `buildCharacterChatUrl(characterId, mode, scriptId)`（`detail.model.ts`）→ `/pages/chat/index?characterId=...&mode=...`。

### 3.2 剧本入口不加载历史（“隔离感”实锤）

- `chat/index.tsx` `loadPage` 的 `characterId` 分支：`loadCharacterDetail` **只 `setScope`（模式/剧本），不加载历史**。
- `loadSessionHistory` 仅在三条路径被调用：`sessionId` 入口（`loadPage` 内）、模式切换 `handleModeChange`、流错误 reconcile/重试。
- 结论：从剧本页进入一个已聊过的角色 → 历史空白起步；切一次模式才有历史。与聊天列表入口（sessionId 直达有历史）不一致。

### 3.3 留言（红点正文）在自由会话

- `return-messages/service.ts:294-303`：留言写入该角色 active 自由会话（无则新建），`excludedFromContext: true`，作为 assistant 消息。
- `GET /api/chat/sessions/:id/messages` 只过滤 system 消息，**包含留言** → 只要落在自由会话，正文即在历史流中。
- 结论：红点点击进自由会话即可见留言正文，无需服务端改动。

### 3.4 所有角色支持 free

- `characters/service.ts:61`：`availableModes = scriptId ? ['script','free'] : ['free']` → 聊天列表统一 `mode=free` 不会出现“角色不支持自由”。

## 4. 方案设计

### 4.1 统一入口（A）

- **聊天列表**：`handleCharacterTap` 改为 `Taro.navigateTo({ url: buildCharacterChatUrl(characterId, 'free') })`；`list.model.ts` 移除/停用 `getCharacterChatUrl(latestSessionId)` 直连（保留 `sessionId` 入口兜底，见 4.2）。URL 构造复用 `character/detail.model.ts` 的 `buildCharacterChatUrl`（free 分支无需 scriptId）。
- **剧本页**：不改，保持用户显式选择（`handleEnterChat(mode)`）。

### 4.2 Chat Index 进入即加载历史（B）

- 新增公共函数 `loadScopeHistory(characterId, mode, scriptId?)`：
  1. `GET /api/chat/sessions?characterId=&mode=&scriptId=&page=1&limit=1`
  2. 有会话 → `loadSessionHistory(session.id)`（历史可见）
  3. 无会话 → 清空消息、设置 scope、显示 starter questions（空会话起步）
- `loadPage` 的 `characterId` 分支：`loadCharacterDetail` 成功后调用 `loadScopeHistory`（沿用 `historyLoadIdRef` / `mountedRef` 竞态守卫，失败不阻断页面，错误走现有错误态）。
- `handleModeChange` 改为复用 `loadScopeHistory`（行为等价，消除重复查询逻辑）。
- `sessionId` 入口保留兜底（分享/深链/充值返回），行为不变。

### 4.3 默认模式 free 优先（C）

- `chat/index.model.ts` `getDefaultChatMode` 与 `character/detail.model.ts` `getCharacterDefaultMode` 改为：`availableModes` 含 `free` 则 `free`，否则 `script`。
- 仅作兜底（裸打开 `chat/index?characterId=` 或详情页主按钮）；两条主入口均显式传 mode。

### 4.4 红点跳转（D）

- 列表点击统一 `mode=free` 已覆盖“红点点击进自由会话”；无红点点击同样进自由（用户确认）。
- 已读闭环、红点渲染逻辑（`.chat-session-row__unread-badge`、`loadCharacterUnread`、`syncChatTabRedDot`）不改。

### 4.5 Logo（E）

- 将 `brand-assets/` 中选定素材（建议 `logo-icon-480.png`，待用户确认图标/字标）回填 `apps/miniapp/src/assets/logo/`。
- `chat/list.tsx` `ChatListHeader`：`<Image src>` 由 `/assets/home/moon-tower-cover.jpg` 改为新 Logo 路径（`mode="aspectFit"` 视素材调整）。
- 主包体积复核（§6.3）。

## 5. 接口契约（无服务端变更）

| 接口 | 用途 | 变更 |
| --- | --- | --- |
| `GET /api/chat/sessions?characterId=&mode=&scriptId=&page=1&limit=1` | 进入时定位该模式会话 | 无（复用） |
| `GET /api/chat/sessions/:id/messages?page=1&limit=50` | 加载历史（含留言） | 无（复用） |
| `GET /api/chat/characters` | 聊天列表聚合 | 无（`latestSessionId` 不再作为跳转目标，仍用于预览/排序展示） |

## 6. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/miniapp/src/pages/chat/list.tsx` | `handleCharacterTap` 走 `characterId+mode=free` |
| `apps/miniapp/src/pages/chat/list.model.ts` | `getCharacterChatUrl` 停用/替换为 free 入口构造 |
| `apps/miniapp/src/pages/chat/index.tsx` | 新增 `loadScopeHistory`；`loadPage` characterId 分支加载历史；`handleModeChange` 复用 |
| `apps/miniapp/src/pages/chat/index.model.ts` | `getDefaultChatMode` free 优先 |
| `apps/miniapp/src/pages/character/detail.model.ts` | `getCharacterDefaultMode` free 优先 |
| `apps/miniapp/src/assets/logo/*` | 回填选定 Logo 素材 |
| `apps/miniapp/src/pages/chat/list.tsx` | `ChatListHeader` Logo 引用替换 |

> 说明：不新增服务端文件；`list.model.test.ts` / `detail.model.test.ts` 如有断言受影响需同步更新。

## 7. 验证方案

### 7.1 构建与体积

```bash
rtk pnpm --filter @juben-sha/miniapp build:weapp:prod
rtk pnpm --filter @juben-sha/miniapp verify:weapp
node /tmp/verify-main-package-size.mjs   # 主包 < 2MB
```

### 7.2 功能验证清单（手动/自动化）

1. 聊天列表点击角色 → 自由模式 + 自由历史可见（含历史消息）。
2. 角色详情点“进入剧本”→ 剧本模式 + 剧本历史可见（**修复点：不再空白起步**）。
3. 角色详情点“自由聊天”→ 自由模式 + 自由历史可见。
4. 同一角色：自由/剧本历史各自完整；页面内模式切换后加载另一模式历史（不丢失）。
5. 红点：注入未读留言（dev/mock 数据）→ 列表红点 → 点击 → 自由会话 + 留言正文在历史流可见 → 已读后红点消失。
6. 聊天列表头部显示新 Logo。
7. 回归：`pnpm --filter @juben-sha/miniapp typecheck`、`lint`、`test`；`test:e2e:miniapp`（smoke）。

### 7.3 后续（红点可测性，单独讨论）

- 评估 dev-only 留言注入接口或 seed 数据，使红点链路可人工/自动化复现；改进 unread 断言时序（轮询等待而非 settle 后一次取值）。本 spec 不实现。

## 8. 风险与回撤

- **竞态**：`loadScopeHistory` 与发送/模式切换并发 → 沿用现有 `scopeSwitchingRef` / `historyLoadIdRef` / `mountedRef` 守卫；回撤 = 删除新增调用与函数。
- **空历史进入**：列表进 free 但角色无自由历史 → 空会话 + starter questions（预期行为，非缺陷）。
- **主包体积**：Logo 回填可能增大包体（预计 <100KB，仍 <2MB）；超标则压缩素材或缩小回填尺寸。
- **行为变化**：聊天列表点击由“最近会话”变为“自由会话”，是需求确认的预期变化。
- 回撤方式：`git revert` 对应提交即可，无数据迁移。

## 9. 验收定义（Done）

- [ ] 两条入口均进入 `chat/index` 并加载对应模式历史；同一角色历史不隔离（手动清单 1-4 通过）。
- [ ] 红点点击落在自由会话且留言正文可见（清单 5 通过）。
- [ ] 聊天列表头部为新 Logo（清单 6 通过）。
- [ ] production 构建 + `verify:weapp` 通过，主包 < 2MB。
- [ ] miniapp typecheck / lint / test 通过。
