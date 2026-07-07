# API v1 初版

本文档记录 V1 联调所需的主要 HTTP API。除支付回调和 health/ready 外，用户端 API 使用 `Authorization: Bearer <jwt>`；admin API 使用同样 JWT，并额外要求用户 ID 在 `ADMIN_USER_IDS` 白名单内。`/admin/**` 页面另有 Basic Auth middleware 保护，生产环境必须配置 `ADMIN_BASIC_AUTH_USER` 和 `ADMIN_BASIC_AUTH_PASSWORD`。

聊天接口当前是 `moderated-buffered`：响应为 NDJSON streaming 形态，但服务端会先完成模型回复缓冲、内部语言净化和输出审核，再发送最终内容。

## 小程序 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Auth | POST | `/api/auth/wechat-login` | 使用微信 `code` 登录，返回 JWT |
| Me | GET | `/api/me` | 当前用户信息 |
| Characters | GET | `/api/characters` | 角色列表 |
| Characters | GET | `/api/characters/:id` | 角色详情，包含关系信息 |
| Chat | POST | `/api/chat/stream` | 单角色聊天，NDJSON，生成前预扣点数，失败/过滤退款 |
| Sessions | GET | `/api/chat/sessions` | 当前用户会话列表 |
| Sessions | GET | `/api/chat/sessions/:id/messages` | 当前用户会话消息 |
| Memory | GET | `/api/memory` | 当前用户启用记忆分组 |
| Achievements | GET | `/api/achievements` | 当前用户已解锁成就和称号 |
| Models | GET | `/api/models` | 可用模型档位 |
| Quota | GET | `/api/quota/packages` | 上架额度包 |
| Quota | GET | `/api/quota/balance` | 当前用户点数余额 |
| Orders | POST | `/api/orders` | 创建额度包订单 |
| Orders | GET | `/api/orders/:id` | 当前用户订单详情 |
| Payments | POST | `/api/orders/:id/prepay` | 创建预支付参数 |
| Payments | POST | `/api/orders/:id/mock-confirm` | 本地 mock 支付确认，仅 mock provider 使用 |

### `POST /api/chat/stream`

请求体：

```json
{
  "characterId": "uuid",
  "sessionId": "uuid",
  "message": "你好",
  "modelTier": "standard"
}
```

响应事件示例：

```json
{"type":"status","mode":"moderated_buffered","stage":"generating"}
{"type":"delta","content":"最终审核后的 AI 回复"}
{"type":"done","messageId":"uuid","sessionId":"uuid","mood":"neutral","bondLevel":1,"bondExp":10,"balanceAfter":97}
```

`done` 事件还可能包含 `fallback`、`blocked`、`unlockedAchievements`、`unlockedTitles`。点数不足返回 `402`。输入安全拦截不会预扣点数。模型失败或输出过滤会退款。模型原始回复进入输出审核前会先移除 `<think>`、`analysis` 等内部语言；泛化“作为 AI 模型”式拒答会被替换为角色内兜底回复。

## 运维 API

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Health | GET | `/api/health` | 进程存活检查，返回 `status: "ok"` |
| Readiness | GET | `/api/ready` | 当前检查 FastClaw 配置和 `${FASTCLAW_BASE_URL}/readyz`；未 ready 返回 `503` |

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
