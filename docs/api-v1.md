# API v1 初版

本文档记录 V1 联调所需的主要 HTTP API。除支付回调和 health/ready 外，用户端 API 使用 `Authorization: Bearer <jwt>`；admin API 使用同样 JWT，并额外要求用户 ID 在 `ADMIN_USER_IDS` 白名单内。`/admin/**` 页面另有 Basic Auth middleware 保护，生产环境必须配置 `ADMIN_BASIC_AUTH_USER` 和 `ADMIN_BASIC_AUTH_PASSWORD`。

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
| Sessions | GET | `/api/chat/sessions` | 当前用户会话列表，支持分页/筛选，含 canSend |
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
{"type":"done","messageId":"uuid","sessionId":"uuid","mode":"script","mood":"neutral","bondLevel":1,"bondExp":10,"balanceAfter":97,"clientMessageId":"miniapp-generated-id"}
{"type":"error","code":"upstream_error","message":"diagnostic only"}
```

`done` 事件始终包含 `mode` 字段。

`clientMessageId` 由小程序每次发送生成，服务端写入同一轮 user/assistant 消息，用于失败对账、幂等重试和分析。相同 `clientMessageId` 的已完成重试会重放已保存 assistant；仍在生成且 lease 未过期时返回 `error.code="in_progress"`；失败或 lease 过期后允许同 ID 重新获取生成 lease。

`done` 事件同步保证 `messageId`、`sessionId`、`mode`、`mood`（如可解析）、`balanceAfter` 和 `clientMessageId`（如请求提供）。还可能包含 `fallback`、`blocked`、`outOfScope`、`replayed`、`bondLevel`、`bondExp`、`unlockedAchievements`、`unlockedTitles`。点数不足返回 `error.code="insufficient_points"` 或 `402`。输入安全拦截不会预扣点数。模型失败、输出过滤、越界兜底会退款。模型原始回复进入输出审核前会先移除 `<think>`、`analysis` 等内部语言；泛化"作为 AI 模型"式拒答会被替换为角色内兜底回复。

当角色绑定的剧本已下架（`script.status != 'active'`）时，禁止在该角色上创建新对话；已有 session 的 `canSend` 字段会变为 `false`；stream 请求返回 `error.code="script_unavailable"`（`409`）。

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

### `GET /api/chat/sessions`

会话列表支持查询参数：

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
- `true`：`runChatCompletionEffects` 使用 `sessionId`、`userMessageId`、`assistantMessageId` 作为幂等上下文在后台执行，不阻塞 `delta/done` 返回。此时 `bondLevel`、`bondExp`、`unlockedAchievements`、`unlockedTitles` 允许缺省，小程序端必须容忍字段不存在。

异步 effects 是最终一致性：记忆、羁绊、成就/称号可能晚于当前响应落库；V1 不自动重试，失败只写结构化日志。

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

所有 admin API 必须使用 `verifyAdminAuth`。

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
