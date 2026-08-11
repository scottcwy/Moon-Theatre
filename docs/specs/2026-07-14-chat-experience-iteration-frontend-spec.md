# V1.1 聊天体验迭代前端修改 SPEC

日期：2026-07-14  
状态：已实现（V1.1 前端 P0/P1 已于 2026-08 全部落地；后续迭代衔接见第 13 节）
适用版本：V1.1 内测修复版  
变更标识：chat-experience-iteration-frontend-v1-1

## 1. 文档目的

本文档定义 V1.1 后端能力对应的小程序前端修改范围、页面行为、客户端数据契约、错误处理和验收标准。

本文档是前端实现和验收的执行依据，不重新定义后端业务规则。后端接口以 `docs/api-v1.md` 和 V1.1 技术 SPEC 为准；本文件只规定小程序如何消费这些接口并向用户呈现状态。

本次前端改动必须保持以下边界：

- 复用现有 Taro 页面结构和 `@juben-sha/miniapp-ui` 组件。
- 不引入新的全局状态管理、消息队列、WebSocket 或 FastClaw 客户端会话。
- 不在客户端推断或修改服务端已经持久化的会话作用域。
- 不通过本地静态剧本数据覆盖 API 返回的数据。
- 不把后端原始异常、系统提示、内部推理或 FastClaw 错误直接展示给用户。

## 2. 关联文档与代码基线

### 2.1 关联文档

- `docs/specs/2026-07-14-chat-experience-iteration-product-spec.md`
- `docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md`
- `docs/api-v1.md`
- `CONTEXT.md`
- `docs/adr/0001-api-owned-chat-context-and-client-message-id.md`
- `docs/adr/0002-character-chat-mode-boundary.md`

### 2.2 当前前端基线

当前小程序已经具备：

- 微信登录和 JWT 本地保存；
- 角色列表、角色详情和基础羁绊展示；
- `moderated-buffered` 聊天流处理；
- `Client Message ID` 生成、失败对账和消息恢复；
- 聊天历史加载；
- 点数余额、额度包和支付页面；
- 记忆页和社区占位页。

当前缺口集中在：

- 聊天模式没有贯通到路由、状态和发送请求；
- 角色详情只有单一聊天入口；
- 会话列表仍按底层模式会话展示，可能让同一角色重复出现；
- 首页和角色选择仍依赖本地剧本数据；
- `preferredName`、`starterQuestions`、`hasSuccessfulTurn` 和 `canSend` 没有被消费；
- 成就接口和下架历史只读状态没有完成前端闭环。

## 3. 术语与前端状态模型

前端统一使用以下术语，不自行创造同义词：

| 术语 | 前端含义 |
| --- | --- |
| `Script Mode` | 剧本模式，使用指定剧本的世界观、剧情和线索约束 |
| `Free Conversation Mode` | 自由对话模式，保留角色身份和性格，不强制推进剧情 |
| `Chat Session` | 某个用户、角色和单一模式下的一段可恢复会话 |
| `Character Chat Entry` | 聊天列表中一个用户和角色对应的唯一聚合入口 |
| `Visible History` | 聊天页当前模式下可见的独立消息历史 |
| `Generation Context` | 仅由当前模式会话历史和允许的记忆构成的模型上下文 |
| `Client Message ID` | 一次发送尝试的客户端幂等标识 |
| `User Preferred Name` | 用户希望角色自然使用的对话称呼 |
| `starterQuestions` | 当前角色和模式对应的静态推荐问题 |
| `canSend` | 当前会话是否允许继续发送消息 |
| `hasSuccessfulTurn` | 当前会话是否已经完成过至少一轮有效回复 |

前端新增或统一以下类型：

```ts
type ChatMode = 'script' | 'free';

interface StarterQuestions {
  script: string[];
  free: string[];
}

interface RelationshipView {
  bondLevel: number;
  bondExp: number;
}
```

`mode` 是页面和请求的业务状态，不使用中文展示值作为内部判断条件。展示文案统一由前端映射：

- `script`：剧本模式；
- `free`：自由聊天。

## 4. 前端职责与状态边界

### 4.1 API 是会话事实源

小程序负责：

- 读取路由参数；
- 展示当前模式、历史和生成状态；
- 触发模式切换和恢复查询；
- 生成 `Client Message ID`；
- 将用户输入按当前作用域提交给 API。

小程序不负责：

- 判断某个 `sessionId` 属于哪个模式；
- 根据本地角色信息改写已有会话的 `mode` 或 `scriptId`；
- 拼接剧情 Prompt；
- 在客户端过滤剧情记忆；
- 根据错误文案猜测请求是否成功。

### 4.2 页面状态优先级

聊天页按以下优先级确定当前会话：

1. 路由带 `sessionId`：先请求 `/api/chat/sessions/:id/messages`，以响应中的 `session.mode` 和 `session.scriptId` 为准。
2. 无 `sessionId` 但路由带 `mode`：使用路由指定模式；`script` 模式必须同时有 `scriptId`。
3. 无 `sessionId` 且无 `mode`：使用角色详情返回的 `lastUsedMode`；没有历史时优先 `script`，仅在 Script Mode 可用时如此，否则使用第一个可用模式。
4. 首次发送完成后：以 `done.sessionId` 和 `done.mode` 更新页面状态，不能继续依赖初始路由参数。

页面切换模式只打开另一个作用域的会话，不修改当前会话历史。生成过程中禁止切换模式。

## 5. 客户端接口契约

### 5.1 `GET /api/me`

前端读取：

```text
id
nickname
avatarUrl
preferredName
status
```

`preferredName` 可以为 `null`。本地 `StoredUser` 和资料页类型必须同步增加该字段。

### 5.2 `PATCH /api/me`

请求：

```json
{ "preferredName": "小岚" }
```

前端规则：

- 保存前 `trim`；
- 空值、纯空白、超过 20 个 Unicode 字符时不发送请求；
- 保存失败不覆盖页面当前值；
- 保存成功后更新页面状态和本地用户缓存；
- 不从 `nickname` 自动填充 `preferredName`；
- 不提供将称呼清空为空字符串的成功路径，后端返回 `invalid_preferred_name` 时保留原值。

### 5.3 `GET /api/characters/:id`

角色详情类型必须支持：

```text
availableModes: ('script' | 'free')[]
lastUsedMode: 'script' | 'free' | null
starterQuestions: { script: string[]; free: string[] }
relationship: { bondLevel: number; bondExp: number } | null
```

角色详情是新建聊天入口的数据源。若角色没有 active 剧本，只展示自由聊天入口；若接口返回 404，不允许通过本地静态数据强行进入新聊天。

### 5.4 `POST /api/chat/stream`

新客户端必须显式发送模式：

```json
{
  "characterId": "uuid",
  "sessionId": "uuid",
  "message": "你好",
  "modelTier": "standard",
  "clientMessageId": "miniapp-generated-id",
  "mode": "script",
  "scriptId": "uuid"
}
```

请求规则：

- `mode=script`：必须发送当前会话对应的 `scriptId`；
- `mode=free`：不得发送 `scriptId`；
- 有 `sessionId` 时，客户端参数只表达请求意图，最终以服务端会话作用域为准；
- `sessionId`、`characterId`、`mode` 或 `scriptId` 不一致时，进入作用域错误状态，不重发原请求；
- 每次新的发送尝试生成新的 `Client Message ID`；同一发送尝试的恢复继续使用原 ID。

`done` 事件至少消费：

```text
messageId
sessionId
mode
clientMessageId
mood
balanceAfter
bondLevel?
bondExp?
fallback?
replayed?
blocked?
outOfScope?
unlockedAchievements?
unlockedTitles?
```

`bondLevel`、`bondExp`、成就和称号字段必须按可选字段处理。字段缺失时页面保留当前状态，并通过角色详情或其他已有接口刷新，不得将 `undefined` 渲染到界面。

### 5.5 会话与历史接口

`GET /api/chat/characters` 是聊天列表唯一数据源，列表项至少消费：

```text
characterId
characterName
characterAvatarUrl
latestSessionId
lastUsedMode
lastMessage
updatedAt
canSend
```

服务端保证每个角色最多一项并在聚合后分页。前端不得再对 `/api/chat/sessions` 的分页结果按 `characterId` 去重。

列表查询使用 `q`、`page` 和 `limit`；响应消费 `page`、`limit` 和 `hasMore`。清空搜索后回到第一页，过期搜索响应不得覆盖更新关键词的结果。

`GET /api/chat/sessions` 的模式查询项至少消费：

```text
id
characterId
characterName
characterAvatarUrl
modelTier
mode
scriptId
scriptTitle
canSend
lastMessage
updatedAt
```

`GET /api/chat/sessions/:id/messages` 必须消费：

```text
session.mode
session.scriptId
session.scriptTitle
session.canSend
session.hasSuccessfulTurn
messages
```

历史会话的展示数据优先使用历史接口返回的 `session` 元数据。这样即使角色或剧本已经下架，历史消息仍然可以展示，不依赖 active-only 的角色详情接口。

`GET /api/chat/messages/by-client-id` 对账结果增加 `mode` 和 `scriptId`，恢复成功后同步更新页面会话作用域。

### 5.6 剧本目录接口

`GET /api/scripts`：

- 首页和剧本选择页使用；
- 搜索参数为 `q`；
- 只展示 API 返回的 active 剧本；
- 使用返回的 `id` 作为后续请求和路由参数；
- `slug` 只作为展示或稳定标识，不能替代需要 UUID 的 `scriptId`。

`GET /api/scripts/:id`：

- 进入剧本角色选择页后调用；
- 需要认证；
- 使用返回的剧本详情和角色列表渲染页面；
- 不从本地 `MOON_GARDEN_ROLES` 补齐后端缺失数据。

### 5.7 成就接口

`GET /api/achievements` 的 `achievements` 和 `titles` 用于“我的”页面。聊天 `done` 返回新解锁结果时，可在当前页显示一次轻量反馈；完整列表以接口数据为准。

## 6. 路由与页面契约

### 6.1 路由约定

角色详情：

```text
/pages/character/detail?characterId=<characterId>
```

聊天页：

```text
/pages/chat/index?characterId=<characterId>&mode=<script|free>&scriptId=<scriptId>
/pages/chat/index?characterId=<characterId>&sessionId=<sessionId>
```

打开已有会话时，`sessionId` 优先；不要求列表页额外相信或重建 `mode/scriptId`。

通用剧本角色选择页：

```text
/pages/script/select?scriptId=<scriptId>
```

页面必须加入 `apps/miniapp/src/app.config.ts`。现有月见庭院页面可以作为兼容入口，但新入口不能继续使用固定剧本映射。

### 6.2 角色详情页

页面行为：

- 展示角色身份、剧本信息和羁绊；
- 展示“进入剧本”和“自由聊天”两个明确入口；
- `lastUsedMode` 只用于默认突出显示，不隐藏另一模式；
- 没有历史时默认突出剧本模式；
- 角色没有 active 剧本时不展示剧本入口；
- 点击入口后携带明确的 `mode`，剧本模式同时携带 `scriptId`；
- 角色详情加载失败、认证过期和角色不可用分别展示对应状态。

复用：`CharacterDetailHero`、`PageSection`、`BottomAction`、`StatusStateCard`、现有按钮组件。

### 6.3 聊天页

页面必须维护以下局部状态：

```text
character
sessionId
mode
scriptId
messages
canSend
hasSuccessfulTurn
starterQuestions
sending
streamError
bondLevel
bondExp
pointsBalance
```

加载流程：

1. 有 `sessionId` 时先加载历史和 `session` 元数据；
2. 有 `sessionId` 且历史允许继续聊天时，在开放模式切换前完成角色详情加载，补齐角色所属 active 剧本元数据；
3. 无 `sessionId` 时加载角色详情，解析可用模式和默认模式；
4. 当前模式对应的推荐问题（P1）只在未成功完成过聊天时展示；
5. `canSend=false` 时进入历史只读状态；
6. 历史加载失败不得清空已有页面状态，显示可重试错误。

模式切换流程：

1. 当前无发送任务时允许切换；
2. 根据角色和目标模式查询已有 active 会话；
3. 有会话则加载其历史；
4. 无会话则打开空聊天页，首次发送时由后端创建；
5. 切换后清理当前页未完成的临时 assistant 气泡，不能把它带到另一模式；
6. Free Session 的历史元数据不得擦除角色详情中的 active `scriptId` 和剧本标题；
7. 不修改原模式会话，也不合并两边消息。

推荐问题流程：

- 当前模式有 1～3 条问题且 `hasSuccessfulTurn=false` 时展示；
- 输入框为空时点击问题会填入输入框；
- 输入框非空时不得覆盖，给出轻提示；
- 点击问题不创建消息、不调用模型、不扣点；
- 用户第一次成功收到 assistant 回复后隐藏；
- 输入拦截、输出过滤、剧情越界、模型失败和超时不算成功。

发送与恢复流程：

- 发送前保留现有的本地 user 临时消息和 assistant 生成占位；
- 生成中显示明确状态并禁用重复发送；
- `done` 到达后将临时 assistant 消息替换为服务端 `messageId`；
- `error` 到达后使用稳定错误码映射中文文案；
- 流中断后使用原 `Client Message ID` 调用对账接口；
- 对账得到 assistant 消息时补全原占位；
- 对账只有 user 消息时保持可恢复状态，不重复插入 user 消息；
- 用户重新发起一条新消息时才生成新的 `Client Message ID`。

只读状态：

- 保留历史消息和角色信息；
- 禁用输入、发送、模式切换和任何会创建新会话的操作；
- 显示“该剧本已下架，历史对话仍可查看”；
- 收到 `script_unavailable` 时立即转为只读，不能继续重试同一请求。

复用：`CharacterHeader`、`ChatBubble`、`ChatInputBar`、`ModelTierSegmentedControl`、`StatusStateCard`、`EmptyState`。

模式切换可以复用现有分段控件样式；只有在两个以上页面确实需要相同交互时才抽取新的公共组件。

### 6.4 聊天列表页

页面行为：

- 每个角色显示一条 Character Chat Entry，包含角色名、最后消息和更新时间；
- 剧本模式和自由聊天不生成重复角色记录，也不在列表显示模式标签；
- 列表不提供“全部 / 剧本模式 / 自由聊天”筛选；
- 角色 inactive 或其所属剧本非 active 时，在搜索和分页前从聚合结果排除，不展示只读入口；
- 点击入口只携带 `latestSessionId`，由聊天页从服务端恢复最近模式；
- 搜索由 `/api/chat/characters?q=...` 在角色聚合后执行，前端不得对分页结果做角色去重；
- 无聊天、无搜索结果、未登录和接口失败使用不同空状态。

### 6.5 首页与剧本目录

首页行为：

- 通过 `GET /api/scripts` 加载剧本卡片；
- 不再维护 `featuredScripts` 作为业务数据源；
- 删除“流氓叙事”本地卡片、跳转映射和专用失效入口；
- API 返回为空时展示空状态，不使用本地假数据补位；
- 保留现有剧本卡片视觉结构和图片兜底逻辑。

剧本搜索页或首页剧本区域：

- 搜索对象是剧本；
- 输入剧本名称、类型或关键词后请求 `/api/scripts?q=...`；
- 搜索请求需要防止过期响应覆盖新关键词结果；
- 无结果时提供清除搜索操作；
- 清空搜索后重新加载完整 active 剧本列表；
- 不因结果为空自动进入第一项。

### 6.6 通用角色选择页

页面行为：

- 根据 `scriptId` 调用 `/api/scripts/:id`；
- 展示剧本封面、标题、类型、简介和角色列表；
- 角色卡点击进入角色详情，不直接绕过模式选择进入聊天；
- 使用后端返回的角色 `id`、`name`、`avatarUrl`、`identity`、`description`；
- 处理剧本不存在、已下架、未登录和加载失败；
- 只有 active 剧本和 active 角色出现在新入口中。

现有月见庭院专用页面可保留用于兼容视觉验收，但不应作为新增剧本的长期页面模式。

### 6.7 我的页面

页面行为：

- 对话称呼合并进档案头部，不显示独立设置卡片；
- 展示名按 `preferredName -> nickname -> 我的` 回退；
- 平时显示展示名和小编辑图标，点击后原位切换为输入框和保存按钮；
- 编辑态初值使用当前 `preferredName`；未设置时不把微信昵称自动保存为 `preferredName`；
- 保存成功后保留当前页面，不强制重新登录或跳转；
- 保存失败保留旧值，并展示明确中文提示；
- 连接 `/api/achievements` 展示称号和成就；
- 聊天页收到新解锁结果时可以展示一次反馈，返回“我的”后以接口列表为准；
- 继续保留点数、登录状态、退出登录和 AI 内容提示。

### 6.8 记忆页

本次不改变记忆页的数据结构。后端 `scope` 用于聊天上下文隔离，当前 `/api/memory` 仍按角色返回分组。

只有在后端额外返回 `scope`、`scriptId` 和剧本名称后，前端才可以增加“共享记忆 / 剧本记忆”展示；前端不得根据记忆类型或内容自行猜测作用域。

## 7. 错误与状态呈现

前端集中维护稳定错误码到中文文案的映射：

| 错误码 | 页面行为 |
| --- | --- |
| `invalid_preferred_name` | 保留旧称呼，提示称呼格式不合法 |
| `session_scope_mismatch` | 停止当前请求，提示会话模式已变化并重新加载正确会话 |
| `script_unavailable` | 当前聊天转只读，历史仍可查看 |
| `client_message_id_collision` | 不继续恢复，生成新的发送尝试 ID |
| `in_progress` | 保持生成中或提示上一条仍在处理，不重复调用模型 |
| `insufficient_points` | 展示余额不足和购买入口 |
| `timeout` | 保留可恢复状态，允许使用原发送内容重新尝试 |
| `upstream_error` / `upstream_incomplete` / `unknown` | 展示统一生成失败文案，不展示原始异常 |
| `out_of_scope` | 展示剧情边界提示，不增加羁绊 |
| `input_blocked` | 展示安全提示，不增加羁绊 |
| `output_filtered` | 展示回复被过滤的统一状态，不把原始内容写入页面 |

状态要求：

- loading、empty、error、read-only、sending 必须视觉区分；
- 错误卡片必须提供当前场景可执行的下一步；
- 任何后端异常的英文 `message` 只用于日志，不直接渲染；
- 认证过期统一交给现有 `useAuthGuard` 处理；
- 页面退出和重新进入后优先从服务端恢复，不依赖临时本地 assistant 文本。

## 8. 文件修改范围

### 8.1 必改文件

- `apps/miniapp/src/services/api.ts`
- `apps/miniapp/src/pages/character/detail.tsx`
- `apps/miniapp/src/pages/chat/index.tsx`
- `apps/miniapp/src/pages/chat/index.model.ts`
- `apps/miniapp/src/pages/chat/list.tsx`
- `apps/miniapp/src/pages/chat/list.model.ts`
- `apps/miniapp/src/pages/home/index.tsx`
- `apps/miniapp/src/pages/home/index.model.ts`
- `apps/miniapp/src/pages/profile/index.tsx`
- `apps/miniapp/src/app.config.ts`

### 8.2 新增或按实际需要修改

- `apps/miniapp/src/pages/script/select.tsx`
- `apps/miniapp/src/pages/script/select.scss`
- `apps/miniapp/src/pages/script/select.model.ts`
- `apps/miniapp/src/pages/chat/index.scss`
- `apps/miniapp/src/pages/chat/list.scss`
- `apps/miniapp/src/pages/character/detail.scss`
- `apps/miniapp/src/pages/profile/index.scss`
- `packages/miniapp-ui/src/components/` 下的最小复用组件或样式

新增公共组件必须满足以下条件：

- 至少两个页面复用；
- 有清晰的输入和输出；
- 不持有 API 请求和跨页面业务状态；
- 不为了包裹一次性页面文案而抽象。

## 9. 测试与验收

### 9.1 接口适配测试

- `streamChat` 能发送 `script` 模式和 `free` 模式的正确参数；
- `free` 模式不会带 `scriptId`；
- `done.mode`、`sessionId` 和 `clientMessageId` 会更新页面状态；
- 成就、羁绊和余额字段缺失时页面仍可完成；
- 所有稳定错误码能映射为中文文案；
- `/api/scripts?q` 的过期响应不能覆盖最新搜索结果。

### 9.2 页面交互测试

- 角色详情可以分别进入两种模式；
- 聊天列表中同一角色只出现一次，不显示模式筛选和模式标签；
- 点击角色级入口默认打开最近使用模式，聊天页切换模式后加载另一套独立历史；
- 从 Free Session 进入后立即切换 Script Mode 时，即使没有 Script Session，也进入空历史而不是提示剧本不存在；
- 同一角色的两种模式历史不会混合；
- 生成过程中不能切换模式或重复发送；
- 推荐问题不会发请求、扣点或写入历史；
- 推荐问题不会覆盖用户已有输入；
- 首次成功回复后推荐问题消失；
- 下架剧本角色不出现在聊天列表；已知的下架会话仍可读但不可发送；
- 页面退出后重新进入可以恢复最终消息；
- 失败恢复不会重复插入 user 消息或增加临时气泡；
- 称呼非法时不覆盖旧值；
- 档案头部按 `preferredName -> nickname -> 我的` 回退，编辑和保存均在原位完成；
- 成就和称号可以从接口正确渲染。

### 9.3 剧本目录测试

- 首页不再出现“流氓叙事”；
- 搜索名称、类型和关键词均可命中对应剧本；
- 清除搜索恢复完整列表；
- 无结果不自动进入任何剧本或角色；
- 从剧本结果进入角色选择、角色详情和聊天模式选择的链路完整；
- retired 剧本不出现在新入口。

### 9.4 构建验收

在设置真实且安全的 `API_BASE_URL` 后运行：

```bash
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

构建前必须确认配置不会回退到 `api.example.com`；构建后校验必须明确证明产物不包含该域名。

## 10. 发布顺序

### P0

1. 更新 API 类型、聊天参数和错误映射。
2. 完成角色详情双模式入口。
3. 完成聊天页模式、历史恢复和只读状态。
4. 完成角色级聊天摘要、唯一列表入口和聊天页模式切换。
5. 完成“我的”页档案头部称呼原位编辑。
6. 删除“流氓叙事”前端入口。
7. 完成接口、页面和恢复场景测试。

### P1

1. 首页切换到 Scripts API。
2. 增加剧本搜索和通用角色选择页。
3. 接入 starterQuestions 的完整首聊引导。
4. 接入成就、称号解锁反馈。
5. 完成搜索、空状态、下架内容和构建验收。

P0 发布期间如果 P1 尚未完成，首页可以暂时只展示一个由 `GET /api/scripts` 返回的 active 剧本入口，但不得重新展示“流氓叙事”，也不得让本地静态数据覆盖后端状态。

## 11. 非目标

本 SPEC 不包含：

- 社区发帖、评论、关注、通知和搜索；
- 多人聊天、语音、图片输入；
- 用户可编辑的完整记忆管理；
- 新的全局状态管理方案；
- 逐 token UI 重做；
- 支付 provider 重新设计；
- FastClaw 客户端直连；
- 复杂剧情编辑器、剧情节点可视化和养成系统；
- 与本次 V1.1 功能无关的视觉大改版。

## 12. 完成定义

当以下条件全部满足时，前端 V1.1 修改完成：

- 新客户端显式传递聊天模式和剧本作用域；
- 两种模式的入口、标题、历史和发送行为清晰可区分；
- 聊天列表按角色唯一聚合，不出现模式筛选、模式标签或重复角色；
- 下架剧本角色不出现在聊天列表，但已知历史会话仍保持只读可恢复；
- 会话恢复以服务端状态为准，且不会重复消息、扣点或羁绊；
- 下架历史可读但不可继续发送；
- 用户可以在档案头部原位设置并保存对话称呼；
- 首页和剧本入口不再展示“流氓叙事”；
- 剧本搜索、角色选择和推荐问题满足对应 P1 验收；
- 错误、加载、空状态和生成中状态均有明确前端表现；
- miniapp 测试、类型检查和安全构建校验通过；
- 页面继续展示产品既有 AI 生成内容提示；
- 未引入新的全局状态、后端绕过逻辑或不必要的平行组件体系。

## 13. 实现状态与后续迭代衔接（2026-08-10）

本文件描述的 V1.1 前端修改（P0 + P1）已全部实现并通过 miniapp 测试（134 用例）、类型检查与构建校验。以下为与当前代码现实对齐的补充说明及后续迭代衔接：

- 剧本搜索已内嵌在首页（`pages/home/index`，消费 `GET /api/scripts?q=`）；`pages/script/select` 为按 `scriptId` 打开的单剧本选角页。完整剧本目录页（一级页面、可搜索）由 P0 七模块模块 5 另行落地，本文件不重复定义。
- 遗留选角页 `pages/role-select/moon-garden` 已随 2026-08-11 清理删除（提交 331b7e1），不再注册；选角统一走 `pages/script/select`（按 `scriptId` 打开）。
- 首页角色区已实现为“常聊角色”（消费 `GET /api/chat/characters?sort=turn_count`，按成功回复轮数排序 + 前 4 网格 + 点击进详情）；无聊天历史时回退“推荐角色”（`GET /api/characters` 全量 active 角色）。
- 羁绊展示层已按 2026-08 确认的 6 级名称实现：檐下 → 灯前 → 杯沿 → 留盏 → 不言 → 入念；`bondLevel`（1–10）/`bondExp` 数值模型不变，前端按 6 级累计经验门槛（0/200/700/2700/10700/26700）重算展示层级与升级提示。
- 社区保持占位页；回访留言前端（聊天列表未读红点 + check/read 调用，留言正文写入自由会话消息流）以 `docs/specs/2026-08-10-return-message-spec.md` 为准。
