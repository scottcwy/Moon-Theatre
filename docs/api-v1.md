# API v1 初版

本文档记录 V1 联调所需的主要 HTTP API。除支付回调和 health/ready 外，用户端 API 使用 `Authorization: Bearer <jwt>`；其中 `GET /api/characters`、`GET /api/scripts`、`GET /api/models`、`GET /api/quota/packages` 为公开只读接口，无需认证。admin API 使用独立管理员邮箱密码账号与 `admin_session_v2` HttpOnly cookie；普通用户 JWT、旧 `admin_session`/`x-admin-session`、`ADMIN_USER_IDS` 白名单、Basic Auth 和开发绕过都不再授予管理身份。页面与 API 共用同一 cookie 解析器，所有管理写入（含登录与退出）强制同源 Origin、JSON 类型及 `X-Admin-Request: 1`；完整身份、会话、密码与限速契约见 [admin 模块契约](../apps/api/src/server/modules/admin/SPEC.md)。

聊天接口当前是 `incremental-buffered`（`X-Stream-Mode: incremental-buffered`）：响应为 NDJSON streaming 形态，服务端边生成边按行净化并下发 `delta`（不做整段缓冲），生成结束后对已发送全文复核输出过滤；命中过滤时追加修正提示 delta，并在 `done` 携带 `blocked:true` 与可选 `content`（= 落库 finalContent）；当落库 finalContent 与已下发增量不一致（blocked / outOfScope / JSON 块被剥离等文本修正场景）时 `done` 同样携带 `content` 供客户端以落库内容覆盖气泡。客户端在首个 delta 后断开只关闭下游输出，不撤销已提交回合；服务端继续持久化 assistant、usage、关系和 turn completed，不会退款或追加 failed usage。

管理后台接口沿用 `/api/admin` 的统一身份边界：批 3 新增用户（`/api/admin/users`）、充值套餐（`POST/PATCH /api/admin/quota-packages`）、模型档位（`PATCH /api/admin/models`、`/models/:id/{versions,publish,check}`）、素材（`POST /api/admin/media`、`GET /api/media/:id`）与基础上下文（`/characters/:id/base-context`）接口，全部沿用同一守卫、严格请求体与 `private, no-store`。素材上传是唯一非 JSON 的写入 body（`media_upload`），且该例外只在上传路径生效。`GET/POST /api/admin/scripts` 用于脚本草稿列表和新建草稿，`PATCH/POST /api/admin/scripts/:id` 分别按 `expectedUpdatedAt` 原子保存草稿和按 `idempotencyKey` 发布；角色侧有 `GET/POST /api/admin/characters`、`POST /api/admin/characters/:id/{first-draft,draft,publish,unpublish}` 与 `GET /api/admin/characters/:id/preview`，见下文“角色内容版本与发布”。草稿只写 `content_versions`，不修改公开接口读取的 `characters`/`scripts` 线上行；发布事务锁定所选 draft，将 payload 原子应用到线上行并提交 `publish_tasks`，同时把 `characters.published_version_id` 指向该不可变版本。同 key 重放返回首次任务结果，同 key 不同目标返回 `409`。`GET /api/admin/messages`、`GET /api/admin/sessions/:id` 和 `GET /api/admin/sessions/:id/messages` 返回聊天原文前必须先成功写入管理员访问审计，审计不可用时返回 `503 admin_audit_unavailable`。

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
| Models | GET | `/api/models` | 可用计费档位；`modelName` / `provider` 是历史计费配置字段，不等于 FastClaw 实际运行模型 |
| Quota | GET | `/api/quota/packages` | 上架额度包（无需认证） |
| Quota | GET | `/api/quota/balance` | 当前用户点数余额 |
| Orders | POST | `/api/orders` | 创建额度包订单 |
| Orders | GET | `/api/orders/:id` | 当前用户订单详情 |
| Payments | POST | `/api/orders/:id/prepay` | 创建或复用订单唯一活动支付凭证；创建中可返回 `202 prepay_in_progress` |
| Payments | POST | `/api/orders/:id/mock-confirm` | 本地 mock 支付确认，仅 mock provider 使用 |
| Return Messages | POST | `/api/return-messages/check` | 检查并补齐当前用户的回访留言，返回未读留言与各角色未读数（需登录） |
| Return Messages | POST | `/api/return-messages/read` | 将指定角色全部未读回访留言标记为已读（需登录） |

### `POST /api/orders/:id/prepay`

每个订单最多有一条 active payment。服务端在事务中锁订单并创建/复用支付占位，渠道凭证生成完成后返回：

```json
{
  "orderId": "uuid",
  "paymentId": "uuid",
  "providerOrderId": "provider-order-id",
  "prepayParams": { "package": "prepay_id=..." }
}
```

另一个并发请求看到同一支付仍在创建时返回 `202 { "status": "prepay_in_progress", "retryable": true }`，不会创建新 payment。已 `credited`、`failed`、`closed`、`refunded` 的订单不能再新开支付凭证。支付占位的 `paymentId` 和 payment `createdAt` 作为稳定 provider 幂等输入传给渠道；nonce、时间戳和签名等字段由这些输入稳定派生。渠道调用结果未知时保留该 payment，重试必须提交同一幂等输入，不得创建第二份有效凭证。

### `GET /api/scripts`

（无需认证）按排序返回所有上架剧本，支持可选搜索关键词 `q`。

`supportsScriptMode` 表示该剧本是否存在至少一个 `active` 状态且绑定该剧本的角色，只有为 `true` 时前端才允许进入该剧本的选角/聊天流程。`availability` 为预留字段，本期仅返回 `available`。

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
      "sortOrder": 1,
      "supportsScriptMode": true,
      "availability": "available"
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

受理回合必须固定版本：服务端在受理该轮的同一事务内解析角色 `published_version_id` 指向的不可变发布快照与所选档位的已发布模型档位版本，写入 `chat_turn_snapshots`（每个 user message 唯一）。任一前置不成立时，接口在预扣点数之前返回 `409` 和 `{ "error": "<code>" }`：

- `character_version_unavailable`：角色不是 `active`、没有 `published_version_id`，或指针指向的不是该角色的已发布版本（角色本身不存在时仍是 `404`）。
- `character_content_incomplete`：已发布版本无法再通过内容校验（例如纳管的旧内容缺人设），需要先保存完整草稿并发布。
- `model_profile_unavailable`：所选档位已启用但没有已发布模型档位版本（档位不存在或未启用是预检阶段的 `400`）。

被拒绝时不扣点、不写快照、不落消息，`reason` 只写服务端日志。已受理回合在重试、租约接管和进程重启后沿用首次快照的内容版本、档位与单价；旧回合没有快照时保持「版本未知」，任何重试都不会改用当前或更新的版本（无快照的重试直接 `409 character_version_unavailable`）。

响应事件示例：

```json
{"type":"status","mode":"incremental_buffered","stage":"generating"}
{"type":"delta","content":"逐段增量下发的 AI 回复（可能多个）"}
{"type":"delta","content":"（内容已按安全规则调整）"}  // 仅输出过滤命中时追加
{"type":"done","messageId":"uuid","sessionId":"uuid","mode":"script","mood":"neutral","blocked":true,"content":"修正后全文（= 落库 finalContent；blocked/outOfScope/JSON 剥离等文本修正场景携带）","bondLevel":1,"bondExp":10,"bondDelta":10,"leveledUp":false,"balanceAfter":97,"clientMessageId":"miniapp-generated-id"}
{"type":"done","messageId":"uuid","sessionId":"uuid","mode":"script","mood":"neutral","bondLevel":1,"bondExp":10,"bondDelta":10,"leveledUp":false,"balanceAfter":97,"clientMessageId":"miniapp-generated-id"}
{"type":"error","code":"upstream_error","message":"diagnostic only"}
```

`done` 事件始终包含 `mode` 字段。

`clientMessageId` 由小程序每次发送生成。服务端按 `userId + clientMessageId` 建立跨 free/script 模式的原子幂等边界，再写入同一轮 user/assistant 消息。相同 ID 并发最多一个请求 accepted，其余返回 replay、`in_progress` 或明确冲突；已完成重试会重放已保存 assistant；仍在生成且 lease 未过期时返回 `error.code="in_progress"`；失败或 lease 过期后允许同 ID 重新获取生成 lease。

`done` 事件同步保证 `messageId`、`sessionId`、`mode`、`mood`（如可解析）、`balanceAfter` 和 `clientMessageId`（如请求提供）。还可能包含 `fallback`、`blocked`、`outOfScope`、`replayed`、`bondLevel`、`bondExp`、`bondDelta`、`leveledUp`、`unlockedAchievements`、`unlockedTitles`。当落库 `finalContent` 与已下发增量不一致时（**blocked** 输出过滤命中、**outOfScope** 越界兜底、**JSON 块剥离**等文本修正场景）`done` 携带可选 `content`：等于落库 `finalContent`（修正后全文，不含修正提示句），客户端 `onDone` 收到后以 `content` 为准覆盖气泡。点数不足返回 `error.code="insufficient_points"` 或 `402`。输入安全拦截不会预扣点数。模型失败、输出过滤、越界兜底会退款。模型原始回复进入输出审核前会先移除 `<think>`、`analysis` 等内部语言；泛化"作为 AI 模型"式拒答会被替换为角色内兜底回复。输出审核剥离/删除 JSON 块时（`output_sanitizer_hit` / `output_sanitizer_parse_fail`），该轮 `model_usage_logs` 额外记录 `errorCode=output_json_block`（success/filtered 均适用），用于按模型/角色聚合观测。

当角色绑定的剧本已下架（`script.status != 'active'`）时，禁止在该角色上创建新对话；已有 session 的 `canSend` 字段会变为 `false`；stream 请求返回 `error.code="script_unavailable"`（`409`）。

#### 羁绊反馈（bondDelta / leveledUp）

产品端统一使用「羁绊」，数值规则：成功轮 `+10` 经验、服务端 `bondLevel` 每 `100` 经验升 1 级、上限 `10` 级（经验继续累计）；展示层由前端按 6 级累计经验门槛（0/200/700/2700/10700/26700）映射名称档位（檐下 → 灯前 → 杯沿 → 留盏 → 不言 → 入念）。

- **成功轮**：`done` 事件携带最新 `bondLevel`/`bondExp`，并携带 `bondDelta: 10`；该轮跨过 100 经验阈值时 `leveledUp: true`，否则 `false`。
- **幂等重放**：相同 `clientMessageId` 的已完成重试返回 `replayed: true`，同时返回当前关系值与 `bondDelta: 0`、`leveledUp: false`，不伪造再次增长。
- **输出过滤（`blocked: true`）**、**越界（`outOfScope: true`）**、**模型失败/发送失败**：不增加羁绊；`done` 事件不包含 `bondLevel`、`bondExp`、`bondDelta`、`leveledUp`（失败轮返回 `error` 事件）。
- **前端约定**：聊天页以服务端 `bondDelta`/`bondExp` 为准展示「羁绊 +10」或「羁绊提升至「名称」」；升级提示按前端 6 级门槛重算名称档位（与 `leveledUp` 一致时才会出现），不直接展示服务端 1–10 数字等级；满级「入念」后不再提示升级。

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

客户端心跳错误码（非服务端事件）：`stream_stalled`——15s 内无任何 chunk 且未收到 `done` 时客户端触发 `onError('stream_stalled')` 并中止请求（`requestTask.abort()`），stall 后不再送达 delta/done，客户端忽略迟到回调。

角色 Agent 架构（`USE_ROLEPLAY_AGENTS=true`）下，FastClaw session 持有生成上下文与历史（含 compaction）；API 每轮只发动态上下文（system 动态 + 当前 user 消息），clean history 为 `[]`。API 发送完整请求头契约：`x-fastclaw-agent-id` / `x-fastclaw-user-id` / `x-fastclaw-session-key`（映射 `chat_sessions.id`）/ `x-fastclaw-scope` / `x-fastclaw-message-id`；回访留言另发 `x-fastclaw-no-persist: true`（`adapter.ts` L61-76）。关闭开关时保持旧链路：API 从数据库选取 `excluded_from_context=false` 的近期干净历史并组装 system prompt。

### `GET /api/chat/characters`

聊天列表的唯一数据源。服务端先按角色聚合当前用户的底层会话，再执行搜索和分页；每个 `characterId` 最多返回一项。

查询参数：

- `sort`：可选；`turn_count` 时返回常聊角色（按成功对话轮数倒序，模块 6）；缺省或其它值时保持默认聊天列表语义。
- `q`：可选，匹配角色名和该角色最近一条 user/assistant 消息（仅在默认聊天列表语义下生效）。
- `page` / `limit`：聚合后分页（默认 `page=1, limit=20`，`limit` 上限 50）。

默认响应：

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

`sort=turn_count` 时（常聊角色，首页使用 `limit=4`），每条额外返回：

- `successfulTurnCount`：该用户与该角色的成功对话轮数，数据库内按角色聚合计数，只计 `role='assistant'`、`outOfScope=false`、`excludedFromContext=false` 的消息；失败、过滤、越界、system 与预告角色不计。
- `identity`：角色身份（首页卡片副标题）。
- 排序：`successfulTurnCount DESC` → 用户最后一条消息时间（该角色所有会话 `role='user'` 消息的最大 `createdAt`）`DESC` → `character.sortOrder ASC`，保证相同轮数时结果稳定。排序口径与模块 7「最近成功聊过」候选共用，不因注入留言前移。
- 剧本模式与自由对话轮数合计，但只用于排序；点击进入角色详情，不合并两种模式历史。

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

> 2026-11-05：小程序记忆页面已退役；该只读接口保留给内部诊断与后续产品化评估，不再作为小程序主导航页面依赖。

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

（无需认证）响应字段包含 `tier`、`displayName`、`pointsPerCall`、`description`、`modelName` 和 `provider`。后两者是历史兼容的计费配置展示字段，不是 FastClaw 实际运行模型。实际运行模型由 FastClaw Agent 的 runtime-spec 决定，并写入 `model_usage_logs.modelName`；生产唯一允许值为 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`。

聊天回合在生成期间收到客户端断线时，服务端不会把已提交回合改成失败。恢复 worker 仅在当前 attempt 的租约过期、turn failed 或旧 attempt 时对账；活动租约不处理。assistant 已存在时先归一化 turn completed，不退款。未提交的失败和“已扣费但尚未登记退款”都按同一 refund key 幂等退款。FastClaw fallback 回复不计作成功模型调用，不扣用户点数。上游失败且没有实际 `model` 时，usage 明确记录 `modelName="unknown"`，不会回退到计费配置字段；首个合法 model 确认前内容不会下发为 delta。

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

（需登录）将当前用户指定角色的全部未读回访留言标记为已读（仅聊天列表点击该角色、进入该角色会话时自动调用，首页/详情等其它入口不触发），返回本次更新的条数。重复调用幂等：无未读可更新时返回 `updated: 0`。

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
| Readiness | GET | `/api/ready` | 检查 Postgres、FastClaw 配置/`readyz`/runtime-spec 实际模型，以及版本化角色 Agent 映射；合法 inactive 角色不影响 ready，缺失/空/重复/未知映射和错误模型返回 `503` |

roleplay readiness 的 `checks.db.roleplayAgents` 包含 `expectedCount`、`foundCount` 及失败时的 `missingAgentIds`、`duplicateAgentIds`、`unknownAgentIds`、`emptyAgentIdCount`。映射按全部角色行校验，不要求所有角色都必须 active；下架角色保留稳定 `agent_id`。`checks.fastclaw` 同时返回 runtime-spec `model`，非 `siliconflow/deepseek-ai/DeepSeek-V4-Flash` 时 fail closed。`USE_ROLEPLAY_AGENTS=false` 时默认 Agent 也必须是非 roleplay。

## 支付回调 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Aggregate Notify | POST | `/api/payments/aggregate/notify` | 第三方聚合支付服务端回调，不走用户 JWT，必须 provider 验签 |

回调处理必须保持验签、订单行锁、订单级幂等 key 和钱包事务入账。渠道 `out_trade_no` 只按 `orders.merchant_order_no` 查询，不得与 UUID `orders.id` 混入同一 SQL；通知还必须匹配本地 provider/payment。失败通知后收到同订单的已签名成功通知可继续入账，`credited` 或 `refunded` 不重复入账。

## Admin API

所有 admin API 必须通过 `verifyAdminAuth`，`/admin/**` 页面必须通过 `requireAdminPageAuth`；两者使用同一个 `admin_session_v2` cookie 解析器，并在每次请求重新校验账号有效、凭据版本、会话未撤销/未过期。未登录或已失效返回 `401`；强制改密的受限会话只允许会话自查、本人改密和退出，业务读取返回 `403 admin_password_change_required`。管理 API 与管理页面响应一律 `Cache-Control: private, no-store`；`apps/api/src/middleware.ts` 仅对 `/admin/**`、`/api/admin/**` 追加安全/缓存响应头，不做授权判定，每个页面和 handler 仍须自行守卫。

所有 POST/PATCH/PUT/DELETE（含登录与退出，含无请求体的操作，也含批 2/批 3 新增的角色、发布、审计收尾、用户、套餐、调账与模型写入）必须发送 `Origin: <ADMIN_ORIGIN>`、`Content-Type: application/json` 和 `X-Admin-Request: 1`，否则 `403 admin_csrf_failed`。唯一例外是 `POST /api/admin/media` 的原始图片 body：它仍要求同源 Origin 与 `X-Admin-Request: 1`，内容类型为 `application/octet-stream` / `image/png` / `image/jpeg` / `image/webp`，且该例外只在上传路径生效。

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Stats | GET | `/api/admin/stats` | 基础统计：用户、会话、消息、订单、支付金额、钱包余额、模型调用、过滤次数 |
| Session | POST | `/api/admin/session` | 邮箱 + 密码登录，返回安全账号信息并设置 8 小时绝对过期的 `admin_session_v2` cookie |
| Session | GET/DELETE | `/api/admin/session` | 查询当前管理会话（受限会话可用）；退出仅撤销当前会话并清除 cookie |
| Accounts | GET | `/api/admin/accounts` | 管理员账号列表，仅安全字段 |
| Accounts | POST | `/api/admin/accounts` | 创建普通管理员 `{email,password}`，`201`；首次登录强制改密 |
| Accounts | PATCH | `/api/admin/accounts/:id` | 停用普通管理员 `{active:false}`；不能停用自己或受保护账号，无启用/删除接口 |
| Accounts | POST | `/api/admin/accounts/:id/reset-password` | 重置普通管理员密码 `{password}`，撤销其全部会话并要求下次登录改密 |
| Account | POST | `/api/admin/account/password` | 本人改密 `{currentPassword,newPassword}`，受限会话可用；成功后清 cookie，需重新登录 |
| Account | PATCH | `/api/admin/account/email` | 仅受保护账号本人改邮箱 `{email,currentPassword}`；成功后清 cookie，需重新登录 |
| Sessions | GET | `/api/admin/sessions` | 会话列表；`userId`/`characterId`/`mode`（`script`/`free`）/`status`（`active`/`archived`）/`from`/`to`（UTC 日历日 `YYYY-MM-DD`，两端含全天）以 AND 组合，分页 `page`/`pageSize`（默认 `1`/`20`，上限 `100`），返回 `{items,total,page,pageSize}` |
| Sessions | GET | `/api/admin/sessions/:id` | 聊天详情（元数据 + 完整正文 + 审核记录）；返回正文前写入访问审计，审计失败返回 `503 admin_audit_unavailable`；页面不再用它读正文 |
| Sessions | GET | `/api/admin/sessions/:id/messages` | 分页正文；`page`/`pageSize`（默认 `1`/`20`，上限 `100`），返回 `{items,total,page,pageSize,attributions}`，每轮关联接受时的内容版本 |
| Characters | GET | `/api/admin/characters` | 角色分页列表；`q`（名称/agent id/剧本标题子串）、`status`、`page`/`pageSize`（上限 100），返回 `{items,total,page,pageSize}`，发布状态、草稿差异与最近发布任务分列，见下文 |
| Characters | POST | `/api/admin/characters` | 仅创建草稿：`inactive` 角色 + 草稿 v1，无发布指针 |
| Characters | GET | `/api/admin/characters/:id` | 单个角色：`publishState`、`draftState`、`lastPublishTask`、最多 5 条 `publishTasks`、当前可编辑基准 `editable` 与默认预览 `preview` |
| Characters | POST | `/api/admin/characters/:id/first-draft` | 为没有任何内容版本的存量角色创建首个草稿 |
| Characters | POST | `/api/admin/characters/:id/draft` | 基于指定基准保存新的不可变草稿；过期基准 `409` |
| Characters | POST | `/api/admin/characters/:id/publish` | 发布选定草稿版本；审计未完成时 `202` |
| Characters | POST | `/api/admin/characters/:id/unpublish` | 下架：只改公开可见性与新会话资格，不删版本/指针/审计 |
| Characters | GET | `/api/admin/characters/:id/preview?versionId=` | 展示预览；默认最新草稿，其次已发布版本；不含人设文本 |
| Messages | GET | `/api/admin/messages` | 消息列表，按 `sessionId` 分页 |
| Review | POST | `/api/admin/review` | 创建审核记录 |
| Review Logs | GET | `/api/admin/review-logs` | 审核记录列表 |
| Orders | GET | `/api/admin/orders` | 订单列表，可按 `userId`、`status` 筛选 |
| Orders | GET | `/api/admin/orders/:id` | 订单详情，包含支付记录和关联钱包流水 |
| Payments | GET | `/api/admin/payments` | 支付记录列表，可按 `orderId`、`status` 筛选 |
| Payments | GET | `/api/admin/payments/:id` | 支付详情，包含订单摘要 |
| Wallet | GET | `/api/admin/wallet-accounts` | 用户点数账户列表 |
| Wallet | GET | `/api/admin/wallet-transactions` | 钱包流水列表 |
| Quota Packages | GET | `/api/admin/quota-packages` | 全部套餐（含已下架），按 `sortOrder, id` 排序 |
| Quota Packages | POST | `/api/admin/quota-packages` | 创建套餐，`201 {package,changed,auditId}`；无删除接口，见下文 |
| Quota Packages | PATCH | `/api/admin/quota-packages/:id` | 更新名称/整数分价格/点数/排序/推荐/上下架，返回 `{package,changed,auditId}`；相同提交为 no-op；`409 quota_package_name_conflict` |
| Users | GET | `/api/admin/users` | 用户搜索与分页；`q`、`status`、`page`/`pageSize`，返回 `{items,total,page,pageSize}`，见下文 |
| Users | GET | `/api/admin/users/:id` | 用户概况：脱敏 openid、钱包汇总、使用概况、最近会话 |
| Users | PATCH | `/api/admin/users/:id` | 仅 `{status}`（`active` 或 `banned`）；单事务行锁、幂等、真实操作者审计，不动钱包、不删除 |
| Media | POST | `/api/admin/media` | 原始字节上传（PNG/JPEG/WebP），返回 `{id,url,mime,byteSize,width,height,reused}`，见下文 |
| Media | GET | `/api/media/:id` | 公开只读投递：不可变缓存、强 `ETag`、`304`/`404`/`503`，见下文 |
| Model Usage | GET | `/api/admin/model-usage-logs` | 模型调用日志 |
| Models | GET/PATCH | `/api/admin/models` | 三档配置查询与保存；PATCH 需 `idempotencyKey`、`expectedUpdatedAt`，接受 `enabled`/`pointsPerCall`/`displayName`/`description`/`provider`/`modelName`/允许清单内 `runtimeParams`，拒绝 `tier` 与凭据字段，写一条不可变版本和可恢复审计；实际运行模型仍由 FastClaw Agent 决定 |
| Models | GET | `/api/admin/models/:id/versions` | 追加式版本历史 + 该档位最新发布审计状态 `publishAudit` |
| Models | POST | `/api/admin/models/:id/publish` | 发布当前保存配置，或按 `versionId` 恢复（复制为新版本后发布），`200`/审计未完成 `202` |
| Models | POST | `/api/admin/models/:id/check` | 只读配置一致性检查，返回 `match` / `mismatch` / `unavailable`；不是发布闸门 |
| Memories | GET/PATCH | `/api/admin/memories[/:id]` | 已退场；直接请求返回 `410 admin_memories_removed` 且无副作用 |
| Payments | POST | `/api/admin/orders/:id/verify` | 向真实支付渠道查单；渠道不可用、金额不符或结果未知均不会伪造成功 |
| Wallet | POST | `/api/admin/wallet/adjustments` | 管理员人工调账；同 key 同五参数返回首次结果，参数不同 `409 wallet_adjustment_idempotency_conflict`，负余额 `409 insufficient_wallet_balance`，目标不存在 `404 admin_user_not_found`，审计未收尾 `503 admin_audit_pending` |
| Wallet | GET | `/api/admin/wallet/adjustments/:idempotencyKey` | 查询调账流水与审计完成状态；未知 key `404`，超 128 字符 `400` |
| Wallet | POST | `/api/admin/wallet/adjustments/:idempotencyKey/finalize-audit` | 仅收尾既有调账的待恢复审计；不写余额、不新增流水，见下文 |
| Publish Tasks | GET | `/api/admin/publish-tasks/:id` | 查询发布任务、激活结果和关联审计 |
| Publish Tasks | POST | `/api/admin/publish-tasks/:id/finalize-audit` | 仅收尾既有角色/剧本发布任务的待恢复审计；不重跑发布，不写业务行 |
| Models | POST | `/api/admin/models/:id/finalize-audit` | 仅收尾该档位唯一的待恢复模型发布审计；页面入口在 `/admin/models` |
| Chat Recovery | GET/POST | `/api/admin/chat-recovery` | 查询 unknown/pending 扣退 attempt，或手动执行幂等对账 |
| Audit Logs | GET | `/api/admin/audit-logs` | 按 `dedupeKey` / `result` 查询审计和恢复状态 |
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

旧 Memories 页面和接口已退场。任何直接 `PATCH /api/admin/memories/:id` 请求均返回 `410`，不会修改记忆。

### 管理会话与管理账号

`POST /api/admin/session` 只接受严格请求体 `{ "email": "admin@example.test", "password": "..." }`（邮箱 trim + 小写规范化后唯一）。成功返回 `200` 并设置 `admin_session_v2` cookie：

```json
{
  "authenticated": true,
  "account": { "id": "uuid", "email": "admin@example.test", "active": true, "mustChangePassword": true, "isProtected": true, "createdAt": "2026-11-07T12:00:00.000Z", "updatedAt": "2026-11-07T12:00:00.000Z" },
  "mustChangePassword": true,
  "expiresAt": "2026-11-07T20:00:00.000Z"
}
```

`GET /api/admin/session` 返回同一安全 JSON（受限会话可用）；`DELETE /api/admin/session` 请求体为 `{}`（仍须 CSRF 头），只撤销当前会话，返回 `{ "authenticated": false }` 与过期 cookie。cookie 为 HttpOnly、SameSite=Strict、Path=/、不设 Domain，生产 Secure；令牌是 32 字节随机值的 64 位十六进制串，数据库只保存其 SHA256，8 小时绝对过期且不续期。

账号接口只返回 `SafeAdminAccount` 安全字段（`id`、`email`、`active`、`mustChangePassword`、`isProtected`、`createdAt`、`updatedAt`），不含密码哈希、凭据版本或会话令牌；日期为 ISO 字符串。改密、重置、停用和邮箱变更都递增凭据版本并撤销该账号全部会话；账号/会话变更与成功审计在同一事务提交。受保护首个账号不能被其他管理员停用、重置或改邮箱；普通账号邮箱创建后不可修改；没有删除或 Web 启用接口，停用账号与受保护账号只能经服务器命令恢复。密码为 15–128 个 Unicode 码点、不 trim/不归一化；哈希、并发上限与登录限速见模块契约。

错误体为 `{ "error": string }`：

- `400`：`admin_input_invalid`（严格 schema/邮箱/UUID/模型更新参数）、`admin_password_invalid`（共享密码策略）。既有业务路由的 `readJsonBody` 沿用自己的中文无关错误体 `{ "error": "Invalid JSON body" }`，本批未统一它们。
- `401`：`admin_unauthenticated`、`admin_login_failed`（未知邮箱、错误密码、停用账号不可区分）。
- `403`：`admin_csrf_failed`、`admin_password_change_required`、`admin_account_forbidden`、`admin_current_password_invalid`。
- `404`：`admin_account_not_found`。
- `409`：`admin_account_conflict`（邮箱唯一）、`admin_bootstrap_conflict`、`admin_bootstrap_broken_state`、`admin_credentials_changed`。
- `429`：`admin_login_limited`，带正整数 `Retry-After` 秒。
- `503`：`admin_dependency_unavailable`、`admin_login_limit_unavailable`、`admin_password_capacity`、`admin_password_unavailable`、`admin_client_address_unavailable`、`admin_audit_unavailable`。

登录在密码哈希前原子占用邮箱 5 次/15 分钟、可信 IP 30 次/15 分钟、全局 60 次/分钟预算；未知邮箱同样计数。生产只信任 Caddy 覆盖写入的单个合法 `X-Admin-Client-IP`，缺失或非法返回 `503`，不回退 `X-Forwarded-For`；本地开发固定使用 `local` 预算，不采信客户端伪造地址。

### `POST /api/admin/orders/:id/verify`

服务端使用订单记录的支付 provider 和 merchant order 查询真实渠道。渠道明确返回已支付且金额匹配时才推进订单；渠道不可用返回 `503`，金额不符返回 `409`，未完成或结果未知保持可恢复状态，不显示完整成功。

**AC-12 现状：`BLOCKED`。** 当前生产唯一的聚合支付 provider 明确没有主动查单能力（`queryPayment` 抛出 `PaymentProviderUnavailableError`，本接口因此返回 `503 {error, code:'payment_provider_unavailable', verified:false}`）。因此“可信渠道结果 → 幂等补发/对账”没有实现：控制台只读展示本服务自己记录过的订单/支付/退款行（`GET /api/admin/orders`、`/orders/:id`、`/payments`、`/payments/:id`），没有任何伪查单、手工置为已支付、任意改单状态或发起退款的入口。**本地状态不是渠道证据**：没有可信渠道结果时，订单/退款只能显示为未确认/无法核对，未知永不当作成功。关闭 AC-12 需要真实的渠道查单契约（商户订单号、交易身份、金额、成功状态与超时/未知处理）。

### `POST /api/admin/wallet/adjustments`

请求体为严格对象 `{ "userId": "uuid", "delta": 10, "reason": "补偿", "idempotencyKey": "case-1" }`：`userId` 必须是完整 UUID 且用户存在（否则 `404 admin_user_not_found`，在任何资金写入之前），`delta` 为 ±1000000 内的非零整数，`reason` 必填且 ≤256 字符，`idempotencyKey` 为 1–128 字符；任何额外键（含客户端 `actor`、`balanceAfter`）为 `400`。事务内按 key 串行化、锁钱包行、拒绝负余额，并写入 `audit_pending` 审计意图，流水记录管理员和原因。

成功 `201`（新写入）/`200`（重放）：`{ transactionId, balanceAfter, alreadyAdjusted }`。`alreadyAdjusted:true` 表示同 key 同操作者/目标用户/方向/金额/原因的重放，返回首次结果且没有第二笔流水。稳定错误语义：

- `409 { "error": "wallet_adjustment_idempotency_conflict" }`：同 key 但操作者、目标用户、方向、金额或原因任一不同；不写第二笔流水。
- `409 { "error": "insufficient_wallet_balance" }`：扣减会导致负余额；钱包行与流水集合不变。
- `503 { "error": "admin_audit_pending", dedupeKey, transactionId, balanceAfter }`：业务已提交但审计收尾失败；不是完整成功。

`GET /api/admin/wallet/adjustments/:idempotencyKey` 返回 `{ transaction, audit, complete }`，未知 key 为 `404`，超 128 字符为 `400`。

控制台（`/admin/wallet`）在表单上显示客户端生成的幂等标识（`adj-<uuid>`，可显式重新生成），提交后展示 `balanceAfter`、是否重放、交易流水 ID、跳转筛选流水的链接，并支持按同一标识重新查询；`409` 按 code 显示不同中文句子（参数冲突 / 负余额），`503 admin_audit_pending` 时提供「仅收尾审计」动作并说明不动资金。钱包账户/流水读取失败时页面不渲染任何余额或流水数字，绝不编造。

身份切换前已提交、审计仍为 `audit_pending` 的旧调账，可用 `POST /api/admin/wallet/adjustments/:idempotencyKey/finalize-audit`（无请求体，仍须 CSRF 头）收尾：事务锁定既有流水与 `wallet_adjustment:<key>` 审计意图，核对动作、目标用户、金额/方向、原因、余额快照及原操作者身份后，只把原意图改为 `committed` 并追加独立恢复事件（关联原审计 ID 与流水 ID，按原审计 ID 去重），原操作者与业务摘要不变。该接口不写余额、不新增钱包流水、不更换幂等 key；已完整完成返回既有结果，意图缺失/未知/不匹配返回 `409 wallet_adjustment_audit_conflict`。它只是身份迁移的审计兼容，不授权重新调账或资金纠错。

### `POST /api/admin/scripts/:id`

发布请求体为 `{ "action": "publish", "idempotencyKey": "release-1" }`。服务端锁定脚本和草稿版本，创建 `publish_tasks`、激活版本并关联审计。同 key 同脚本重放返回首次 `taskId` / `versionId`；同 key 不同脚本返回 `409 publish_idempotency_conflict`。审计尚未完成时返回 `202`，任务 `recoveryState=audit_pending`，可通过 `GET /api/admin/publish-tasks/:id` 查询并用同 key 重试。

### 角色内容版本与发布

角色的内容版本存于 `content_versions`（`entityType='character'`），每次保存都是新的不可变草稿，`characters.published_version_id` 是唯一的已发布指针；同一 `(entity_type, entity_id)` 最多一条 `published` 行（部分唯一索引）。草稿对公开接口与新回合不可见；发布只激活选定草稿，下架只改 `characters.status`，版本、指针、任务和审计历史均保留。没有一个删除角色的接口：已发布对象只能下架。

`GET /api/admin/characters` 返回 `{ items, total, page, pageSize }`（`q`/`status`/`page`/`pageSize`，上限 100），每项把发布状态（`publishState`）、草稿差异（`draftState.hasDraft`/`changedFields`/`draftVersionNo`）和最近发布任务（`lastPublishTask`）作为三个独立事实，另有 `publishedValidity`（已发布内容是否仍通过校验）。列表是 count + 分页 + 三条按页键读取，不做整表装配：1000 角色基线实测每页 5 条语句（页内无已发布指针时 4 条，空页 2 条）。`q` 是单个 trim 词（≤128 字符），按子串匹配角色名、agent id 或绑定剧本标题（`%`/`_`/`\` 按字面匹配），`status` 只接受 `active`/`inactive`；未知 `status` 与超长关键词返回带中文提示的 `400`，`page<1`/`pageSize>100` 同样是 `400`，都不会静默放宽筛选。因实测执行计划约 1 ms，本版**没有新增索引**；记录的可复测触发条件是 `publish_tasks` 数量再涨一个数量级后，必要时添加 `publish_tasks (entity_type, entity_id, created_at DESC, id DESC)`。

`POST /api/admin/characters` 创建草稿：请求体为严格对象，含 `name`、`avatarUrl`、`identity`、`description`、`initialRelationship`、`agentId`、`scriptId`（可 `null`）、`sortOrder`、`starterQuestions`（`{script,free}`）和五字段 `prompt`。`agentId` 必须来自版本化角色 Agent 清单（`packages/shared/src/roleplay-agents.json`），由界面下拉选择而非手填。成功返回：

```json
{ "id": "uuid", "versionId": "uuid", "versionNo": 1, "updatedAt": "2026-11-07T10:00:00.000Z", "status": "inactive", "publishedVersionId": null }
```

新角色永远是未上架、不能聊天的草稿；只创建内容版本，不写公开读取的线上行。`POST /api/admin/characters/:id/first-draft` 针对没有任何内容版本的存量角色：空请求体，服务端用角色行与最新 `character_prompts` 生成首个草稿并返回 `{characterId,versionId,versionNo,updatedAt,validity}`；已经存在草稿或已发布版本时返回 `409 character_first_draft_exists`。

`POST /api/admin/characters/:id/draft` 保存草稿：`{ versionId?, expectedUpdatedAt?, patch }`，`versionId` 与 `expectedUpdatedAt` 必须恰好提供一个（都传或都不传为 `400 admin_input_invalid`），`patch` 只接受角色草稿字段（未知字段 `400 character_patch_unknown_field`）。成功返回新的 `{versionId,versionNo,updatedAt,status,publishedVersionId}`，旧草稿转 `superseded`。过期基准返回 `409 character_draft_conflict`，不静默覆盖；`agentId` 已存在时不可改（`409 character_agent_id_system_owned`）；已发布角色改归属剧本 `409 character_script_change_requires_new_character`。

`POST /api/admin/characters/:id/publish` 请求体为 `{ versionId, idempotencyKey }`，发布该草稿并原子切换展示行与指针（同时冻结服务端生成的 `scriptSnapshot`）。同 key 同目标重放返回首个任务结果；同 key 不同目标或不同操作者返回 `409 character_publish_conflict`。成功返回 `{id,versionId,taskId,idempotencyKey,status,replayed,auditStatus}`；审计未完成时 `202`。其他冲突：`409 character_version_already_published`、`409 character_version_not_publishable`、`409 character_version_hash_mismatch`；`400 character_agent_unavailable`（Agent 不在已发布清单）、`400 character_script_unavailable`/`character_script_not_found`（剧本未上架或不存在）。没有已发布模型档位版本**不阻止**发布，只在界面提示新回合会被拒绝。

`POST /api/admin/characters/:id/unpublish` 空请求体，返回 `{id,status:'inactive',publishedVersionId,changed,auditStatus}`；已下架时 `changed:false`（`auditStatus:'not_required'`）。

`GET /api/admin/characters/:id/preview?versionId=` 是只展示的预览：默认取最新草稿（即将发布的版本），无草稿时取已发布版本；显式 `versionId` 只读该版本，不属于该角色时 `404`。响应含剧本卡片、角色详情、开场引导、`validity` 校验结论与 `preflight`，不含人设提示词、不建立聊天。角色没有任何版本时返回 `404`（不同于列表/详情仍会返回该角色）。

移动端：390 px 下角色列表首列（无需横向滚动即可见）对在架角色提供 `下架（需确认）` 入口，指向 `/admin/characters/:id/preview#emergency-unpublish`；预览页的“发布与下架”区块是该锚点目标，页头另有快捷链接。确认文案如实说明下架只停止公开展示与新会话、已接受在途请求按原版本结束、历史/版本/发布记录保留，确认框未勾选不能提交。

### 用户管理（AC-11）

`GET /api/admin/users` 查询参数：`q`（trim 后 ≤128 字符，匹配昵称子串、openid 前缀或用户 ID 前缀，`%`/`_` 按字面匹配）、`status`（`active`/`banned`）、`page`/`pageSize`（默认 `1`/`20`，上限 `100`）。按 `created_at DESC, id DESC` 排序，返回：

```json
{
  "items": [{ "id": "uuid", "nickname": "玩家", "status": "active", "createdAt": "2026-11-07T10:00:00.000Z", "balancePoints": 10, "sessionCount": 3, "lastMessageAt": "2026-11-07T09:00:00.000Z" }],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

每页一条 page 语句 + 一条 count 语句（聚合是同一语句内的关联子查询，无 N+1）；没有钱包行的用户 `balancePoints` 为 `0`。未知 `status` 与超长关键词返回带中文提示的 `400`；`page<1`/`pageSize>100` 同样为 `400`，都不会静默忽略筛选。

`GET /api/admin/users/:id` 返回 `{user,wallet,stats,recentSessions}`：`user` 为 `id`/`nickname`/`avatarUrl`/`status`/`openidPreview`（脱敏前缀，原始 openid 不返回）/`createdAt`/`updatedAt`；`wallet` 为 `exists`/`balancePoints`/`totalRechargedPoints`/`totalConsumedPoints`；`stats` 为 `sessionCount`/`messageCount`/`lastMessageAt`/`lastSessionAt`；`recentSessions` 为最多 10 条会话摘要（`id`、`characterId`、`characterName`、`title`、`mode`、`status`、`messageCount`、`createdAt`、`updatedAt`），用于跳转既有聊天历史。不返回人设提示词、聊天正文或任何凭据。用户不存在为 `404`，ID 非法为 `400`。

`PATCH /api/admin/users/:id` 只接受严格请求体 `{ "status": "active" | "banned" }`（客户端 `actor`、钱包字段或其他键都是 `400 admin_input_invalid`）。服务端在同一事务内 `SELECT … FOR UPDATE` 锁用户行：已处于目标状态返回 `changed:false` 且不写任何行；真实变更更新 `users.status`/`updated_at` 并同事务写入 `admin.user.ban` / `admin.user.unban` 审计（操作者为当前管理员、`objectType='user'`、`objectId` 为该玩家、摘要 `{from,to}`），审计失败回滚状态。响应：

```json
{ "user": { "id": "uuid", "nickname": "玩家", "status": "banned", "updatedAt": "2026-11-07T10:00:00.000Z" }, "previousStatus": "active", "changed": true, "auditId": "uuid" }
```

封禁只改 `users.status`：不改钱包余额/流水，不删除用户、会话或消息；生效沿用既有 `verifyAuth`（非 `active` 用户的 JWT 立即无法调用新的用户业务请求），解封恢复。管理员身份与小程序用户身份相互独立，UUID 相同也不互相影响。

### 充值套餐维护（AC-13）

`GET /api/admin/quota-packages` 返回 `{packages:[…]}`，按 `sortOrder, id` 确定性排序。`POST` 请求体为严格对象 `{name,priceCents,points,description?,recommended?,active?,sortOrder?}`：`name` trim 后 1–64、`priceCents` 为整数分且 ≥0、`points` 为整数且 ≥1、`description` ≤256 且可为 `null`（`null`/`''` 表示清空）、`recommended`/`active` 为布尔、`sortOrder` 为 ≥0 整数；未知字段（例如客户端 `actor`、订单字段或元为单位的小数）为 `400`。成功 `201 {package,changed:true,auditId}`。

`PATCH /api/admin/quota-packages/:id` 接受上述字段的任意子集（同样严格），返回 `{package,changed,auditId}`；与存储行相同的提交是显式 no-op（`changed:false`、`auditId:null`，不写库、不写审计）。真实变更只写变化的列，并与 `admin.quota_package.update` 审计同事务提交（摘要 `{changedFields,from,to}`）；审计失败回滚套餐写入。

- 金额一律整数分；价格/点数变更只影响之后创建的订单，`orders.amountCents`/`pointsAmount` 是下单时快照，已有订单不会被重算。
- 上下架用 `active:false`（下架），**没有删除接口/服务**：订单仍引用该行。下架套餐不出现在公开 `GET /api/quota/packages`，`POST /api/orders` 对它返回 `404 Quota package not found`。
- 名称唯一性是应用层规则：在变更事务内对 `lower(name)` 取 `pg_advisory_xact_lock` 后比较，重复为 `409 quota_package_name_conflict`，并发创建/改名同名只会成功一个；**数据库没有 `name` 唯一索引**，直接 SQL 写入仍可绕过。
- 公开列表 `GET /api/quota/packages` 只返回 `active=true`，排序同为 `sortOrder, id`。

### 本地素材上传与读取（AC-01/03/09 素材部分）

素材是**本地文件、内容寻址**，不引入对象存储或 CDN。`media_assets(id, content_hash unique, mime, byte_size, width, height, original_name, created_by_admin_account_id, created_at)` 记录元数据，字节存放在 `<MEDIA_ROOT>/<hash[0:2]>/<hash>.<png|jpg|webp>`；`MEDIA_ROOT` 默认 `./data/media`，部署时必须是持久化卷。`original_name` 恒为 `NULL`（上传是原始字节，没有文件名），不参与路径、响应或审计。行不可变：相同字节只保留一行，替换图片等于上传新素材并改指向新 URL，任何素材都不会被删除或覆盖，因此已发布版本引用的旧 URL 继续可用。

`POST /api/admin/media` 是管理写入，但 body 是原始图片字节（`Content-Type` 为 `application/octet-stream`、`image/png`、`image/jpeg` 或 `image/webp`）。这是唯一允许的非 JSON body：CSRF 校验把它作为受约束的 `media_upload` 类型，只在上传路径生效，其他管理写入请求该类型得到 `403 admin_csrf_failed`。处理顺序固定为：鉴权/CSRF → 有界读取（≤5 MiB，超限立即取消，不会先缓冲整个 body）→ 空 body 检查 → magic bytes 判型（声明的 `Content-Type` 只作为 CSRF 材料，存储类型以字节为准）→ 仅解析图片头的尺寸（每边 1–4096 px，长宽比 ≤20:1）→ sha256 → 按哈希复用 → 临时文件 + `fsync` + `rename` → 同事务插入行与 `admin.media.upload` 审计。成功 `200`：

```json
{ "id": "3f2c9a1e-5b7d-4c8a-9e10-2a6b4c8d0e11", "url": "https://api.yuemanlou.xyz/api/media/3f2c9a1e-5b7d-4c8a-9e10-2a6b4c8d0e11", "mime": "image/png", "byteSize": 12345, "width": 800, "height": 600, "reused": false }
```

相同字节再次上传返回同一 `id`/`url` 且 `reused:true`，不重复写审计。稳定错误码：`415 media_type_unsupported`（非 PNG/JPEG/WebP 或声明与字节不符）、`413 media_too_large`、`400 media_dimensions_invalid`、`503 media_store_unavailable`；未登录 `401`、CSRF 失败 `403`。审计摘要只含内容哈希与解析出的事实，不含字节、文件名或路径。写入顺序是“先文件后行”，因此不会出现有行无文件；插入失败会留下一个孤立文件（不会被访问，下次相同字节上传会复用它），而不是删掉可能已被并发上传引用的文件。

`GET /api/media/:id` 是公开只读投递（小程序跨域加载；`id` 是素材 UUID，没有路径参数、目录列表或内容协商）。`200` 返回存储 mime、`Content-Length`、强 `ETag: "<sha256>"`、`Cache-Control: public, max-age=31536000, immutable`、`X-Content-Type-Options: nosniff` 与 `Content-Disposition: inline`；匹配 `If-None-Match`（或 `*`）返回 `304`（同样的缓存/ETag 头，无 body）；未知或损坏的 id、文件缺失、非法存储路径为 `404 {error:'media_not_found'}`，存储故障为 `503 {error:'media_store_unavailable'}`（两者 `no-store`）。返回的 URL 是绝对地址 `${ADMIN_ORIGIN}/api/media/<id>`（origin 来自校验过的配置，永不取自请求 `Host`），因为小程序从不同 origin 加载图片。

### 派生基础上下文：SOUL / IDENTITY / USER（方案 W）

PG 已发布版本是唯一人设真源；FastClaw 的运行上下文组装**完全不变**（一个角色回合仍然读取 SOUL.md + IDENTITY.md + USER.md + 记忆 + 输出守卫）。因此这三个文件是**派生缓存**：角色发布成功后，服务端用与 provisioning 相同的渲染器（字节级 parity 测试）从刚激活的版本生成它们，经 setup API（`GET`/`PUT /api/agents/{id}/system-files/{name}`、`Authorization: Bearer`、路径带 agent id、每次 5 秒上限、不重试）写回，并在写入后回读三个文件校验字节，成功才记录一个 `agent_context_versions` 版本（`(agent_id, content_hash)` 唯一、不可变历史，记录来源 `publish|manual|startup`、原内容版本与操作者）。相同内容不新增版本；`agent_current_context` 是指向“当前版本”的显式指针（`0017`），漂移判断、界面 `b#` 与回合归属都读它，而不是按 `created_at` 猜测。

**边界（不得写成已同步一致）**：回读只能证明“当前凭据可见的字节”一致——FastClaw setup API 的 GET 与 PUT 都按认证用户作用域，非 owner 凭据会读写同一错误的行而比较相等；`FASTCLAW_API_KEY` 必须解析到该 Agent 的 `agents.user_id`，这是**部署要求**，服务端无法检测。运行时仍按控制台文件实时组装上下文：PG 版本只决定按回合追加的人设段，记录的基础上下文是采集时刻的派生缓存；控制台手改会在下次发布或手动重建时被覆盖，在此之前如实显示为漂移。发布/同步失败**不会**让发布失败或回滚：`POST /api/admin/characters/:id/publish` 的响应多出 `baseContext: {status, reason, written, version}`，`status` 为 `synced|unchanged|pending|failed`（`pending` = FastClaw 不可读、未写未记录、保留上一个记录；`failed` 带 `write_not_verified[:<文件>]` / `record_failed` 等原因），`written:true` 只表示三次 PUT 全部落地。

`GET /api/admin/characters/:id/base-context` 返回 `{baseContext:{characterId, agentId, status, recorded, live, published, matchesPublished, checkedAt}}`，`status` 为 `in-sync|drifted|unavailable|unrecorded`（`unavailable` 永不显示为已同步；`unrecorded` 表示从未记录），只含哈希与序号、不含文件内容。`POST /api/admin/characters/:id/base-context`（空 body，仍须 CSRF 头）按已发布版本手动重建并覆盖控制台手改，返回 `{sync, baseContext}`，审计动作 `admin.character.base_context.rebuild`。回合受理时 `chat_turn_snapshots.agent_context_version_id` 固定当前的记录版本（一次本地读取，不跨服务）；无记录则为 `NULL` 且界面显示「基础上下文未记录」，不倒推、不回填。

### 会话检索、分页正文与版本归属

`GET /api/admin/sessions` 的筛选条件全部在服务端生效并以 AND 组合：`userId`、`characterId`、`mode`（`script`/`free`）、`status`（`active`/`archived`）、`from`/`to`（UTC 日历日 `YYYY-MM-DD`，两端都含整日；`from > to` 为 `400`）。返回 `{items,total,page,pageSize}`，按 `updatedAt` 倒序。页面 `/admin/sessions` 使用同一组参数并在分页链接中保留筛选。

`GET /api/admin/sessions/:id/messages` 分页读取正文（`page`/`pageSize`，默认 `1`/`20`，上限 `100`），返回：

```json
{
  "items": [{ "id": "uuid", "role": "user", "content": "你好", "mood": null, "createdAt": "2026-11-07T10:00:00.000Z" }],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "attributions": [{ "userMessageId": "uuid", "contentVersionId": "uuid", "contentVersionNo": 3, "modelProfileVersionId": "uuid", "agentContextVersionId": "uuid", "agentContextVersionNo": 2, "versionUnknown": false }]
}
```

`attributions` 只覆盖本页的 `role='user'` 消息；没有快照的回合返回 `versionUnknown: true` 且版本字段为 `null`，不会按时间或当前版本倒推。`agentContextVersionId`/`agentContextVersionNo` 是受理时记录的**当前**派生基础上下文版本；受理时没有记录则为 `null`（界面显示「基础上下文未记录」），历史回合不回填。正文只在访问审计成功后返回，审计失败是 `503 admin_audit_unavailable` 且不包含正文。旧接口 `GET /api/admin/sessions/:id` 仍返回完整正文，供需要一次性读取的调用方使用；页面改用分页读，不一次加载全部消息。

### 发布任务与模型发布审计收尾

`POST /api/admin/publish-tasks/:id/finalize-audit` 以任务 ID 定位既有 `audit_pending` 审计意图：`character` 与 `script` 任务分别收尾。它核对持久化的任务/版本、`desiredHash` 与业务摘要，只把原意图改成 `committed`、清空任务的 `recoveryState`，并追加独立恢复事件（记录当前操作者）；不重跑发布、不改写版本或线上行。已完整完成返回 `alreadyFinalized:true`；意图缺失、重复或不匹配返回 `409 character_publish_audit_conflict` / `script_publish_audit_conflict`，未知 `entityType` 返回 `409 audit_recovery_conflict`。

`POST /api/admin/models/:id/finalize-audit` 对模型档位做同样的事：从审计日志中解析该档位唯一待恢复的 `model_profile_publish:<key>` 意图，核对版本、档位与 `configHash` 后收尾；没有唯一意图返回 `409 model_publish_audit_conflict`。

四个 finalize-only 入口共享同一动作与文案：钱包调账、角色/剧本发布任务（`/publish-tasks/:id/finalize-audit`）与模型发布（`/models/:id/finalize-audit`）都只锁定并核对既有意图与已持久化业务结果，把 `audit_pending` 改为 `committed` 并追加一条独立去重的恢复事件（记录真实恢复者，保留原操作者与摘要）；不重跑发布/调账、不改金额或内容、不授予纠错权限，并发重复点击只产生一条恢复事件。`committed` 或不存在的意图只显示事实、不提供动作；任何一个 `409`（`character_publish_audit_conflict`、`script_publish_audit_conflict`、`model_publish_audit_conflict`、`wallet_adjustment_audit_conflict`、`audit_recovery_conflict`）都表示意图无法确认、本次没有收尾。页面入口：角色编辑页（每条待恢复发布任务）、`/admin/scripts/[id]`（封面发布任务）、`/admin/models`（档位最新发布审计为待恢复/未知时）与 `/admin/wallet`（调账 `503` 之后）。尚无通用审计恢复控制台。

### 模型档位配置、发布与一致性检查（AC-15/AC-17）

`PATCH /api/admin/models` 是严格请求体：`{ id, idempotencyKey, expectedUpdatedAt, enabled?, pointsPerCall?, displayName?, description?, provider?, modelName?, runtimeParams? }`。`pointsPerCall` 为 ≥0 整数；`provider`/`modelName` 为 trim 后的非空短字符串；`runtimeParams` 只接受运行时会读取的声明值 `maxTokens`（1–768）、`temperature`（≤2）、`maxToolIterations`（≤20）、`thinking`（只允许 `off`），未声明的键（如 `model`、`topP`）与任何疑似凭据字段（`apiKey`、`credentialRef` 等）都被拒绝。`tier` 不可变，客户端传入是未知字段（`400 admin_input_invalid`；服务层对 `tier` 返回 `409 model_tier_immutable`）。`expectedUpdatedAt` 是操作者载入的 `model_profiles.updated_at`，不一致返回 `409 model_edit_conflict`，不静默覆盖。

被接受的变更在同一事务内更新档位行并写入一条不可变 `model_profile_versions`（`versionNo+1`、`status='published'`、创建者列、规范化 `configHash`），同时写 `admin.model.publish` 审计意图并在提交后收尾。值与当前配置相同且已有已发布版本时是显式 no-op（不写版本、不写审计）。同 key 重放返回同一版本；同 key 不同请求体或不同操作者返回 `409 model_publish_idempotency_conflict`。成功响应为 `{model, version, replayed, changed, changedFields, auditStatus, dedupeKey}`（`version` 是新增或复用的版本快照）；审计未完成时状态为 `202`、`auditStatus:'pending'`。该接口修改的是声明配置；FastClaw 实际运行模型仍由 Agent 配置决定。

`GET /api/admin/models/:id/versions` 返回 `{versions, publishAudit}`（ID 非法 `400`、档位不存在 `404`）：版本按最新在前，含 `versionNo`、`status`、`provider`、`modelName`、`pointsPerCall`、允许清单投影后的 `runtimeParams`、`configHash`、创建人邮箱/时间、`isCurrent`（最高 `version_no` 且 `status='published'`，与聊天固定版本的规则一致）与不含凭据的字段；`publishAudit` 是该档位最新 `admin.model.publish` 审计的有界状态（`none|audit_pending|committed|unknown` + `dedupeKey` + 时间）。

`POST /api/admin/models/:id/publish` 请求体 `{idempotencyKey, expectedUpdatedAt, versionId?}`（严格）：不带 `versionId` 时发布当前保存配置（已是当前版本则显式 no-op `created:false`）；带 `versionId` 时是**恢复**——把该版本内容**复制成一个新版本**（新 `version_no`）并因为它是最新已发布版本而成为当前版本，历史版本不被改写、停用或删除，审计摘要同时记录源版本与新版本。不属于该档位的 `versionId` 为 `404`。响应 `{model, version, sourceVersion, created, replayed, changedFields, auditStatus, dedupeKey}`；`202` 表示审计未完成，可由 finalize-only 入口收尾。禁用档位仍可发布/恢复，但新回合会被拒绝。

`POST /api/admin/models/:id/check` 是无写入、无凭据的只读检查：读取档位声明（当前版本的 `configHash`/参数）与该档位映射到的 Agent（去重后的 `characters.agent_id` 与 `FASTCLAW_AGENT_ID`，按 agent id 截断到 20 个）的 `GET /v1/agents/{id}/runtime-spec`，比较 `model` 与声明运行参数，返回：

```json
{ "check": { "status": "match", "reason": null, "checkedAt": "2026-11-07T10:00:00.000Z", "expected": { "provider": "siliconflow", "modelName": "deepseek-ai/DeepSeek-V4-Flash", "modelId": "siliconflow/deepseek-ai/DeepSeek-V4-Flash", "runtimeParams": { "maxTokens": 768, "thinking": "off" } }, "agents": [{ "agentId": "role-baizang", "status": "match", "model": "siliconflow/deepseek-ai/DeepSeek-V4-Flash", "differences": [] }] } }
```

- `status`：任一处真实差异为 `mismatch`；否则任一 Agent 读不到为 `unavailable`；否则 `match`。`unavailable` 的 `reason` 可为 `no_published_version`、`no_agent_mapped`、`fastclaw_not_configured`、`agents_unavailable`，并且**永远不当作通过**。
- **它不调用 `POST /api/test-provider`**（该接口要求在请求体里携带服务商凭据，控制台不持有也不接受凭据），不读取、不保存、不回显任何密钥，也不做真实 provider 往返；`match` 只表示“声明与 FastClaw 报告一致”。
- **「错误测试阻止发布」（AC-15）未实现**：`publish`/restore 从不查询这个检查结果，`mismatch` 或从未检查过的档位与 `match` 一样可以发布。本版没有把检查做成发布闸门。

### `GET/POST /api/admin/chat-recovery`

`GET` 列出 `chargeStatus=unknown` 或 `refundStatus=pending|unknown` 的 attempt；`POST` 立即执行幂等对账并返回 `{ scanned, recovered, failed }`。worker 也会在 Node runtime 启动后每 5 分钟执行一次。

### `POST /api/admin/return-messages/sweep`

（需 admin）触发一次回访留言补发清扫，无请求体。遍历所有 active 用户，对每个候选角色在最近 3 个缺失的 UTC+8 自然日窗口（当前日、昨日、前日）中最多补 `3 - 当前未读` 条留言（未读 >= 3 的角色跳过）；AI 生成并发上限 4；单用户/单角色/单窗口失败只记日志，不中断整体。

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
- 窗口去重：`check` 只补当前 UTC+8 自然日窗口；`sweep` 在最近 3 个缺失窗口中最多补 `3 - 当前未读` 条（未读 >= 3 跳过）。窗口已有留言时不重复生成。
- 投递：生成留言内容后，在单个事务内先插入投递元数据（`messageId` 为空；命中 `(userId, characterId, windowStart)` 唯一索引冲突即中止且不写消息），再查/建自由会话、写 `messages`（`excludedFromContext=true`），最后回填 `messageId`。并发同窗口只会落 1 条消息 + 1 条元数据，不残留孤儿消息。
- AI 生成：复用 FastClaw `streamChat` 非流式收集，专用短超时 15 秒，内容按 Unicode 码点截断至 200 字符。失败、超时、空内容，或 adapter 兜底流均视为失败，改用运营模板兜底（角色模板优先，无则用通用兜底模板）。生成永不抛错、永不返回空字符串。
- 副作用边界：留言不进入 Generation Context，不影响点数、羁绊、成就，不计入模块 6 成功轮数；「最近」排序按用户最后一条消息时间，不因注入留言前移。
- 已读幂等：只更新 `readAt IS NULL` 的行，重复调用返回 `updated: 0`。
