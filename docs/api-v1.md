# API v1 初版

本文档记录 V1 联调所需的主要 HTTP API。除支付回调和 health/ready 外，用户端 API 使用 `Authorization: Bearer <jwt>`；admin API 使用同样 JWT，并额外要求用户 ID 在 `ADMIN_USER_IDS` 白名单内；同时 `/api/admin/**` 与 `/admin/**` 页面均由 Basic Auth middleware 保护，admin API 需 Basic Auth 与 JWT 白名单双层校验都通过。生产环境必须配置 `ADMIN_BASIC_AUTH_USER` 和 `ADMIN_BASIC_AUTH_PASSWORD`。

聊天接口当前是 `moderated-buffered`：响应为 NDJSON streaming 形态，但服务端会先完成模型回复缓冲、内部语言净化和输出审核，再发送最终内容。

## 小程序 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Auth | POST | `/api/auth/wechat-login` | 使用微信 `code` 登录，返回 JWT |
| Me | GET | `/api/me` | 当前用户信息，含 preferredName |
| Me | PATCH | `/api/me` | 更新 preferredName |
| Characters | GET | `/api/characters` | 角色列表（无需认证），含 starterQuestions |
| Characters | GET | `/api/characters/:id` | 角色详情，含 availableModes/lastUsedMode/starterQuestions/关系 |
| Scripts | GET | `/api/scripts` | 剧本列表（无需认证） |
| Scripts | GET | `/api/scripts/:id` | 剧本详情，含角色列表和 starterQuestions |
| Chat | POST | `/api/chat/stream` | 单角色聊天，NDJSON，预扣点数，失败/过滤退款；支持 mode/scriptId |
| Chat | GET | `/api/chat/messages/by-client-id` | 按客户端发送 ID 对账当前用户的一轮聊天消息，含 mode/scriptId |
| Chat | GET | `/api/chat/characters` | 当前用户按角色聚合的唯一聊天入口，默认指向最近模式 |
| Sessions | GET | `/api/chat/sessions` | 当前用户底层模式会话查询，供聊天页切换/恢复使用 |
| Sessions | GET | `/api/chat/sessions/:id/messages` | 当前用户会话消息，含 session 元数据（canSend/hasSuccessfulTurn） |
| Memory | GET | `/api/memory` | 当前用户启用记忆分组（按角色分组，scope 隔离） |
| Achievements | GET | `/api/achievements` | 当前用户已解锁成就和称号 |
| Models | GET | `/api/models` | 可用模型档位，含 modelName 和 provider |
| Quota | GET | `/api/quota/packages` | 上架额度包 |
| Quota | GET | `/api/quota/balance` | 当前用户点数余额 |
| Orders | POST | `/api/orders` | 创建额度包订单 |
| Orders | GET | `/api/orders/:id` | 当前用户订单详情 |
| Payments | POST | `/api/orders/:id/prepay` | 创建预支付参数 |
| Payments | POST | `/api/orders/:id/mock-confirm` | 本地 mock 支付确认，仅 mock provider 使用 |
| Return Messages | POST | `/api/return-messages/check` | 检查并补齐当前用户的回访留言，返回未读留言与各角色未读数（需登录） |
| Return Messages | POST | `/api/return-messages/read` | 将指定角色全部未读回访留言标记为已读（需登录） |

### `GET /api/scripts`

（无需认证）按排序返回所有上架剧本，支持可选搜索关键词 `q`。

请求：

```http
GET /api/scripts?q=月见
```

响应：

```json
{
  "scripts": [
    {
      "id": "uuid",
      "title": "月见庭院：狐神的新娘",
      "description": "剧本简介",
      "slug": "moon-garden",
      "genre": "日式",
      "coverUrl": "/covers/moon.jpg",
      "sortOrder": 1
    }
  ]
}
```

### `GET /api/scripts/:id`

（需认证）返回单个剧本详情，包含剧本下所有上架角色列表和角色 `starterQuestions`。

响应：

```json
{
  "id": "uuid",
  "title": "月见庭院：狐神的新娘",
  "description": "剧本简介",
  "worldSetting": "神社背景设定",
  "slug": "moon-garden",
  "genre": "日式",
  "searchKeywords": "狐仙,月见",
  "coverUrl": "/covers/moon.jpg",
  "sortOrder": 1,
  "status": "active",
  "characters": [
    {
      "id": "uuid",
      "name": "白藏",
      "avatarUrl": "/avatars/baizang.jpg",
      "identity": "月见庭院的狐神",
      "description": "角色简介",
      "scriptId": "uuid",
      "initialRelationship": "被选中的新娘候选",
      "starterQuestions": { "script": ["你是谁？"], "free": ["今天天气不错"] },
      "sortOrder": 1,
      "status": "active"
    }
  ]
}
```

响应中不暴露系统 Prompt。已下架剧本返回 `404`。

### `GET /api/me` / `PATCH /api/me`

`GET` 返回当前用户信息：

```json
{
  "id": "uuid",
  "nickname": "微信昵称",
  "avatarUrl": "...",
  "preferredName": "小岚",
  "status": "active"
}
```

`preferredName` 为玩家在 AI 对话中被称呼的名字，可以为 `null`。

`PATCH` 更新 `preferredName`。请求体必须包含 `preferredName` 字段，限制为 1-20 个 Unicode 码点；空字符串或空白字符串返回 `400`，`error: "invalid_preferred_name"`。

请求：

```http
PATCH /api/me
Authorization: Bearer <jwt>

{ "preferredName": "小岚" }
```

响应返回更新后的完整用户 profile。

### `GET /api/characters`

（无需认证）返回所有上架角色列表，包含 `scriptId` 和 `starterQuestions` 字段。`starterQuestions` 结构为 `{ script: string[], free: string[] }`，默认值空数组。

### `GET /api/characters/:id`

（需认证）返回角色详情，除基本信息外包含以下扩展字段：

- `availableModes`: `string[]` — 该角色可用的聊天模式。有绑定剧本的角色为 `["script", "free"]`，无绑定剧本的角色仅为 `["free"]`。
- `lastUsedMode`: `string | null` — 当前用户上次与该角色聊天的 mode，无历史则为 `null`。
- `starterQuestions`: `{ script: string[], free: string[] }` — 角色/剧本预设引导问题。
- `relationship`: `{ bondLevel: number, bondExp: number } | null` — 当前用户与该角色的羁绊关系。

响应中不暴露系统 Prompt（`prompts` 字段在路由层剥离）。角色关联的剧本已下架时返回 `404`。

### `POST /api/chat/stream`

请求体：

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

- `sessionId`: 可选；不提供时自动查找或创建活跃会话。
- `mode` / `scriptId`: 可选（向后兼容旧客户端）。`mode=script` 时 `scriptId` 必填。若提供的 `mode`/`scriptId` 与已有 session 不匹配，返回 `error.code="session_scope_mismatch"`（`409`）。`mode=free` 时不可传 `scriptId`。无 `mode` 且无 `sessionId` 时（旧客户端），服务端自动推断为 script 模式。
- `scriptId` 对应的剧本已下架时返回 `error.code="script_unavailable"`（`409`）。

响应事件示例：

```json
{"type":"status","mode":"moderated_buffered","stage":"generating"}
{"type":"delta","content":"最终审核后的 AI 回复"}
{"type":"done","messageId":"uuid","sessionId":"uuid","mode":"script","mood":"neutral","bondLevel":1,"bondExp":10,"bondDelta":10,"leveledUp":false,"balanceAfter":97,"clientMessageId":"miniapp-generated-id"}
{"type":"error","code":"upstream_error","message":"diagnostic only"}
```

`done` 事件始终包含 `mode` 字段。

`clientMessageId` 由小程序每次发送生成，服务端写入同一轮 user/assistant 消息，用于失败对账、幂等重试和分析。相同 `clientMessageId` 的已完成重试会重放已保存 assistant；仍在生成且 lease 未过期时返回 `error.code="in_progress"`；失败或 lease 过期后允许同 ID 重新获取生成 lease。

`done` 事件同步保证 `messageId`、`sessionId`、`mode`、`mood`（如可解析）、`balanceAfter` 和 `clientMessageId`（如请求提供）。还可能包含 `fallback`、`blocked`、`outOfScope`、`replayed`、`bondLevel`、`bondExp`、`bondDelta`、`leveledUp`、`unlockedAchievements`、`unlockedTitles`。点数不足返回 `error.code="insufficient_points"` 或 `402`。输入安全拦截不会预扣点数。模型失败、输出过滤、越界兜底会退款。模型原始回复进入输出审核前会先移除 `<think>`、`analysis` 等内部语言；泛化"作为 AI 模型"式拒答会被替换为角色内兜底回复。

当角色绑定的剧本已下架（`script.status != 'active'`）时，禁止在该角色上创建新对话；已有 session 的 `canSend` 字段会变为 `false`；stream 请求返回 `error.code="script_unavailable"`（`409`）。

#### 羁绊反馈（bondDelta / leveledUp）

产品端统一使用「羁绊」，数值规则：成功轮 `+10` 经验、每 `100` 经验升 1 级、服务端等级上限 `10` 级（经验继续累计，等级与展示封顶）。

- **成功轮**：`done` 事件携带最新 `bondLevel`/`bondExp`，并携带 `bondDelta: 10`；该轮跨过 100 经验阈值时 `leveledUp: true`，否则 `false`。
- **幂等重放**：相同 `clientMessageId` 的已完成重试返回 `replayed: true`，同时返回当前关系值与 `bondDelta: 0`、`leveledUp: false`，不伪造再次增长。
- **输出过滤（`blocked: true`）**、**越界（`outOfScope: true`）**、**模型失败/发送失败**：不增加羁绊；`done` 事件不包含 `bondLevel`、`bondExp`、`bondDelta`、`leveledUp`（失败轮返回 `error` 事件）。
- **前端约定**：聊天页以服务端 `bondDelta`/`leveledUp` 为准展示「羁绊 +10」或「羁绊提升至 Lv.N」，不本地猜测增量；满级（Lv.10）不再显示「距下一级」。

流式错误事件使用稳定 `code`，`message` 只用于诊断，客户端不得直接展示未知 raw message。V1 code：

```text
timeout
upstream_error
upstream_incomplete
insufficient_points
out_of_scope
in_progress
unknown
```

产品聊天由 API 拥有上下文状态：API 从数据库选取 `excluded_from_context=false` 的近期干净历史并显式传给 FastClaw；产品聊天请求不得依赖 FastClaw session history 或发送 `x-fastclaw-session-key`。

### `GET /api/chat/characters`

聊天列表的唯一数据源。服务端先按角色聚合当前用户的底层会话，再执行搜索和分页；每个 `characterId` 最多返回一项。

查询参数：

- `q`：可选，匹配角色名和该角色最近一条 user/assistant 消息。
- `page` / `limit`：聚合后分页（默认 `page=1, limit=20`，`limit` 上限 50）。

响应：

```json
{
  "characters": [
    {
      "characterId": "uuid",
      "characterName": "白藏",
      "characterAvatarUrl": "...",
      "latestSessionId": "uuid",
      "lastUsedMode": "free",
      "lastMessage": "下次也来找我。",
      "updatedAt": "2026-07-15T03:00:00.000Z",
      "canSend": true
    }
  ],
  "page": 1,
  "limit": 20,
  "hasMore": false
}
```

- `latestSessionId`：该角色最近更新的底层模式会话；列表点击后用它恢复默认模式和历史。
- `lastMessage`：最近一条 user/assistant 消息预览，最大 100 字符 + 省略号 `…`（U+2026），不暴露 system 消息。
- 聚合入口只返回 `characters.status=active` 且 `characters.scriptId` 所属剧本 `status=active` 的角色。角色或所属剧本下架后，在搜索和分页前排除，不返回只读列表行。
- `canSend`：当前聚合入口是否允许继续发送；按上述过滤规则，正常返回项为 `true`。
- 该接口只聚合导航摘要，不合并剧本模式与自由聊天的消息、模型上下文或剧情记忆。
- 下架历史没有被删除；`GET /api/chat/sessions` 和 `GET /api/chat/sessions/:id/messages` 仍可对已知会话返回 `canSend=false` 的只读数据。

### `GET /api/chat/sessions`

底层模式会话查询支持以下参数，主要供聊天页切换模式和恢复指定作用域：

- `page` / `limit`：分页（默认 `page=1, limit=20`，`limit` 上限 50）。
- `characterId`：按角色筛选。
- `mode`：按模式筛选（`"script"` 或 `"free"`）。
- `scriptId`：按剧本筛选。

响应：

```json
{
  "sessions": [
    {
      "id": "uuid",
      "characterId": "uuid",
      "characterName": "白藏",
      "characterAvatarUrl": "...",
      "modelTier": "standard",
      "mode": "script",
      "scriptId": "uuid",
      "scriptTitle": "月见庭院：狐神的新娘",
      "canSend": true,
      "lastMessage": "你好，白藏（截断至100字符）",
      "updatedAt": "2026-07-14T10:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20
}
```

- `canSend`: 角色 `status=active` 且（无剧本或剧本 `status=active`）时为 `true`。剧本下架或被停用时 `canSend=false`。
- `lastMessage`: 最近一条 user/assistant 消息预览，最大 100 字符 + 省略号 `…`（U+2026）。不暴露 system 消息。

### `GET /api/chat/sessions/:id/messages`

查询参数：

- `page` / `limit`：分页（默认 `page=1, limit=50`，`limit` 上限 100）。

响应：

```json
{
  "session": {
    "id": "uuid",
    "characterId": "uuid",
    "characterName": "白藏",
    "characterAvatarUrl": "...",
    "characterIdentity": "月见庭院的狐神",
    "mode": "script",
    "scriptId": "uuid",
    "scriptTitle": "月见庭院：狐神的新娘",
    "canSend": true,
    "hasSuccessfulTurn": true
  },
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "你好",
      "mood": null,
      "createdAt": "2026-07-14T10:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 50
}
```

- `hasSuccessfulTurn`: 会话中至少有一次成功（未被过滤/越界）的 assistant 回复时为 `true`。由 `model_usage_logs.status='success'` 判定，兼容旧数据中未标记 `outOfScope`/`excludedFromContext` 的 assistant 消息。
- `canSend`: 规则同上。
- 消息列表不返回 system 角色消息。
- 会话不属于当前用户时返回 `403`。
- 已归档（`status=archived`）会话仍可读取消息。

### `GET /api/memory`

返回当前用户所有启用记忆，按角色分组：

```json
{
  "groups": [
    {
      "characterId": "uuid",
      "characterName": "白藏",
      "memories": [
        { "id": "uuid", "type": "user_info", "content": "玩家今年20岁" },
        { "id": "uuid", "type": "story", "content": "发现了密室的暗门" }
      ]
    }
  ]
}
```

记忆类型（`type`）：`user_info`、`relationship`、`story`。

后端记忆检索时按 `scope` 隔离：free 模式仅检索 `scope=shared` 的记忆；script 模式检索 `scope=shared` 加当前剧本 `scope=script` 的记忆。

### `GET /api/achievements`

返回当前用户已解锁成就和称号列表：

```json
{
  "achievements": [
    {
      "id": "uuid",
      "name": "初来乍到",
      "description": "发送第一条消息",
      "condition": { "code": "first_message" },
      "iconUrl": null,
      "unlockedAt": "2026-07-14T10:00:00.000Z"
    }
  ],
  "titles": [
    {
      "id": "uuid",
      "name": "探案新星",
      "description": "解锁第一个成就",
      "iconUrl": null,
      "unlockedAt": "2026-07-14T10:00:00.000Z"
    }
  ]
}
```

### `GET /api/models`

响应字段包含 `tier`、`displayName`、`pointsPerCall`、`description`、`modelName`（底层模型标识，如 `DeepSeek-V4-Flash`）和 `provider`（模型供应商，如 `siliconflow`）。

### `GET /api/chat/messages/by-client-id`

按 `clientMessageId` 查询当前登录用户的一轮消息，用于流失败后的对账。

请求：

```http
GET /api/chat/messages/by-client-id?clientMessageId=miniapp-generated-id
```

响应：

```json
{
  "sessionId": "uuid",
  "clientMessageId": "miniapp-generated-id",
  "mode": "script",
  "scriptId": "uuid",
  "userMessage": {
    "id": "uuid",
    "content": "你好",
    "createdAt": "2026-07-08T12:00:00.000Z",
    "outOfScope": false,
    "excludedFromContext": false
  },
  "assistantMessage": {
    "id": "uuid",
    "content": "最终审核后的回复",
    "mood": "neutral",
    "createdAt": "2026-07-08T12:00:02.000Z",
    "outOfScope": false,
    "excludedFromContext": false
  }
}
```

`mode` 为会话聊天模式（`"script"` 或 `"free"`）；`scriptId` 在 free 模式下为 `null`。

找不到当前用户记录返回 `404`。只找到 user 消息但 assistant 尚未完成时返回 `200` 且 `assistantMessage: null`。同一用户多个 session 命中同一 `clientMessageId` 时返回 `409`（`error: "client_message_id_collision"`）。

#### 聊天速度约束

V1 业务聊天只优化 `/api/chat/stream`，不改变 FastClaw 通用 API 语义，不做逐 token 展示。聊天 Agent 配置必须限制 `maxTokens <= 768`、`maxToolIterations = 0`，FastClaw runtime 默认模型使用 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`；业务 prompt 明确要求默认回复 80-180 个中文字符，必要时最多 300 个中文字符。

`FASTCLAW_TIMEOUT_MS` 默认 `120000`，用于避免 30 秒外层 abort 打断长回复。`CHAT_EFFECTS_ASYNC_ENABLED` 默认 `false`：

- `false`：记忆、羁绊、成就/称号 effects 同步完成后再返回 `delta/done`，保持完整效果字段。
- `true`：`runChatCompletionEffects` 使用 `sessionId`、`userMessageId`、`assistantMessageId` 作为幂等上下文在后台执行，不阻塞 `delta/done` 返回。此时 `bondLevel`、`bondExp`、`bondDelta`、`leveledUp`、`unlockedAchievements`、`unlockedTitles` 允许缺省，小程序端必须容忍字段不存在。

异步 effects 是最终一致性：记忆、羁绊、成就/称号可能晚于当前响应落库；V1 不自动重试，失败只写结构化日志。

### `POST /api/return-messages/check`

（需登录）检查并补齐当前用户的回访留言，无请求体。先按候选规则（最近成功聊过 + 羁绊最高）为每个候选角色补齐当前 UTC+8 自然日窗口的留言（该角色未读 < 3 且当日尚无留言时）；留言作为 `excludedFromContext=true` 的 assistant 消息写入该角色自由模式会话（无则新建），并写入投递元数据。再返回未读留言与各角色未读数。

请求：

```http
POST /api/return-messages/check
Authorization: Bearer <jwt>
```

响应：

```json
{
  "messages": [
    {
      "id": "uuid",
      "characterId": "uuid",
      "characterName": "白藏",
      "characterAvatarUrl": "/avatars/baizang.jpg",
      "content": "小新娘，庭院的月色又圆了，红线铃铛在风里响了一夜。回来吧，我还在廊下等你。",
      "reason": "recent",
      "createdAt": "2026-08-04T00:00:00.000Z",
      "readAt": null
    }
  ],
  "characterUnread": {
    "uuid": 1
  }
}
```

- `reason`: `"recent"`（最近成功聊天候选）或 `"bond"`（羁绊最高候选）。
- `readAt`: `null` 表示未读；返回的 `messages` 均为未读留言。
- `characterUnread`: 以 `characterId` 为 key 的未读条数统计，仅包含当前有未读留言的角色。

### `POST /api/return-messages/read`

（需登录）将当前用户指定角色的全部未读回访留言标记为已读（用户在聊天列表进入该角色会话时自动调用），返回本次更新的条数。重复调用幂等：无未读可更新时返回 `updated: 0`。

请求：

```http
POST /api/return-messages/read
Authorization: Bearer <jwt>

{ "characterId": "uuid" }
```

响应：

```json
{ "updated": 1 }
```

请求体不是合法 JSON、缺失，或 `characterId` 为空/超过 64 字符时返回 `400`，`error: "Invalid characterId"`。

## 运维 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Health | GET | `/api/health` | 进程存活检查，返回 `status: "ok"` |
| Readiness | GET | `/api/ready` | 检查 FastClaw 配置、`${FASTCLAW_BASE_URL}/readyz` 和 `FASTCLAW_AGENT_ID` 对应 agent 的 runtime spec；未 ready 返回 `503` |

## 支付回调 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Aggregate Notify | POST | `/api/payments/aggregate/notify` | 第三方聚合支付服务端回调，不走用户 JWT，必须 provider 验签 |

回调处理必须保持验签、订单状态机、订单行锁、订单级幂等 key 和钱包事务入账。

## Admin API

所有 admin API 必须使用 `verifyAdminAuth`，且 `/api/admin/**` 请求须先通过 Basic Auth middleware 校验。

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Stats | GET | `/api/admin/stats` | 基础统计：用户、会话、消息、订单、支付金额、钱包余额、模型调用、过滤次数 |
| Sessions | GET | `/api/admin/sessions` | 会话列表，可按 `userId`、`status` 筛选 |
| Sessions | GET | `/api/admin/sessions/:id` | 会话详情，包含消息和 review logs |
| Messages | GET | `/api/admin/messages` | 消息列表，按 `sessionId` 分页 |
| Review | POST | `/api/admin/review` | 创建审核记录 |
| Review Logs | GET | `/api/admin/review-logs` | 审核记录列表 |
| Orders | GET | `/api/admin/orders` | 订单列表，可按 `userId`、`status` 筛选 |
| Orders | GET | `/api/admin/orders/:id` | 订单详情，包含支付记录和关联钱包流水 |
| Payments | GET | `/api/admin/payments` | 支付记录列表，可按 `orderId`、`status` 筛选 |
| Payments | GET | `/api/admin/payments/:id` | 支付详情，包含订单摘要 |
| Wallet | GET | `/api/admin/wallet-accounts` | 用户点数账户列表 |
| Wallet | GET | `/api/admin/wallet-transactions` | 钱包流水列表 |
| Quota Packages | GET | `/api/admin/quota-packages` | 额度包配置列表 |
| Quota Packages | POST | `/api/admin/quota-packages` | 创建额度包配置 |
| Quota Packages | PATCH | `/api/admin/quota-packages/:id` | 更新额度包价格、点数、上下架等 |
| Model Usage | GET | `/api/admin/model-usage-logs` | 模型调用日志 |
| Memories | GET | `/api/admin/memories` | 记忆列表，可按 `userId`、`characterId`、`type`、`enabled` 筛选 |
| Memories | PATCH | `/api/admin/memories/:id` | 禁用/启用或覆盖记忆内容 |
| Blocked Keywords | GET | `/api/admin/blocked-keywords` | 敏感词列表 |
| Blocked Keywords | POST | `/api/admin/blocked-keywords` | 新增敏感词 |
| Return Messages | POST | `/api/admin/return-messages/sweep` | 触发回访留言补发清扫（需 admin） |

### `GET /api/admin/stats`

响应体：

```json
{
  "users": { "total": 8, "today": 2 },
  "sessions": { "total": 5 },
  "messages": { "total": 21, "today": 6 },
  "orders": { "total": 4, "credited": 3 },
  "payments": { "paidAmountCents": 1800 },
  "wallet": { "balancePoints": 240 },
  "modelUsage": { "total": 9 },
  "moderation": { "filtered": 2 },
  "generatedAt": "2026-06-14T12:00:00.000Z"
}
```

### `PATCH /api/admin/memories/:id`

请求体至少包含一个字段：

```json
{
  "content": "修正后的记忆内容",
  "enabled": false
}
```

`content` 会 trim 并限制为 500 字符；空内容会返回错误。

### `POST /api/admin/return-messages/sweep`

（需 admin）触发一次回访留言补发清扫，无请求体。遍历所有 active 用户，对每个候选角色补齐最近 3 个缺失的 UTC+8 自然日窗口（当前日、昨日、前日）的留言；未读 >= 3 的角色跳过；AI 生成并发上限 4；单用户/单角色/单窗口失败只记日志，不中断整体。

请求：

```http
POST /api/admin/return-messages/sweep
Authorization: Bearer <jwt>
```

响应：

```json
{ "swept": true }
```

另有进程内调度器自动执行：Node.js runtime 启动时立即执行一次，之后每 60 分钟执行一次（timer 已 `unref()`，不阻止进程退出）。

## 回访留言数据模型与规则

留言本体是写入消息流的 assistant 消息；`character_return_messages` 只作为**投递元数据**记录未读/已读与窗口去重。

表 `messages`（留言本体，复用聊天消息表）：

- 新增一行：`role='assistant'`、`outOfScope=false`、`excludedFromContext=true`、`generationStatus='completed'`；不计费字段（model tier / tokens 为空）。
- 该行属于该角色最近活跃的**自由模式**会话；无自由会话时先创建再写入。
- 在可见历史（**Visible History**）中显示，但不进入生成上下文（**Generation Context**），不触发任何聊天完成副作用。

表 `character_return_messages`（投递元数据）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `userId` | uuid | 所属用户，外键 `users.id` |
| `characterId` | uuid | 所属角色，外键 `characters.id` |
| `messageId` | uuid | 可空，外键 `messages.id`，指向写入消息流的留言本体 |
| `content` | text | 留言内容（冗余，便于列表页直接展示） |
| `reason` | varchar(16) | 生成原因：`recent`（最近成功聊天）或 `bond`（羁绊最高） |
| `windowStart` | timestamp with timezone | UTC+8 自然日零点，参与去重 |
| `createdAt` | timestamp with timezone | 创建时间 |
| `readAt` | timestamp with timezone | 已读时间，`null` 表示未读 |

索引：

- 唯一索引 `character_return_messages_window_unique`（`userId`, `characterId`, `windowStart`）：同一角色同一 UTC+8 自然日最多 1 条留言；插入命中冲突时静默跳过（幂等）。
- 普通索引 `character_return_messages_unread_idx`（`userId`, `readAt`）：支撑未读查询。

规则：

- `windowStart` 是 UTC+8 自然日零点：`date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')`，即北京时间所在日的零点。
- 候选角色：① 最近成功聊过的 active 角色（存在成功 assistant 消息的会话，按该会话**用户最后一条消息时间**倒序取第一个）；② 羁绊最高的 active 角色（按 `bondLevel`、`bondExp`、`updatedAt` 倒序取第一个）。两个候选合并时同一角色只保留一条，`recent` 优先。
- 未读上限 3：某角色未读（`readAt IS NULL`）达到 3 条时不再生成，直到已读后才可能继续生成。
- 窗口去重：`check` 只补当前 UTC+8 自然日窗口；`sweep` 补齐最近 3 个缺失窗口。窗口已有留言时不重复生成。
- 投递：生成留言内容后，先写 `messages`（自由会话，`excludedFromContext=true`），再写投递元数据并回填 `messageId`。
- AI 生成：复用 FastClaw `streamChat` 非流式收集，专用短超时 15 秒，内容按 Unicode 码点截断至 200 字符。失败、超时、空内容，或 adapter 兜底流均视为失败，改用运营模板兜底（角色模板优先，无则用通用兜底模板）。生成永不抛错、永不返回空字符串。
- 副作用边界：留言不进入 Generation Context，不影响点数、羁绊、成就，不计入模块 6 成功轮数；「最近」排序按用户最后一条消息时间，不因注入留言前移。
- 已读幂等：只更新 `readAt IS NULL` 的行，重复调用返回 `updated: 0`。
