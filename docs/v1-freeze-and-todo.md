# V1 当前冻结基线与后续 To Do

## 1. 冻结口径

本文档用于冻结当前已经完成的 V1 开发基线，并把未完成的 V1 工作拆成后续会话可继续执行的 To Do list。

当前冻结基线：

| 项目 | 内容 |
| --- | --- |
| 版本口径 | V1 工程基线 |
| 冻结 commit | `faab7c8 fix: add miniapp tab bar icons` |
| 分支 | `main` |
| 远程 | `origin/main` |
| 范围依据 | `docs/prd-v1.md`、`docs/technical-spec-v1.md`、`DESIGN.md` |

当前版本不是 V1 完整交付版。它冻结为“可继续开发的稳定工程基线”：工程、构建、小程序基础页面、基础 API、数据库 schema 和共享类型已经具备，核心业务闭环仍需继续开发。

## 2. 当前已完成并冻结的内容

### 2.1 工程基础

- Monorepo 结构已建立：`apps/miniapp`、`apps/api`、`packages/shared`。
- 根目录脚本已可用于开发、构建、校验：
  - `pnpm dev:api`
  - `pnpm dev:miniapp`
  - `pnpm build:api`
  - `pnpm build:miniapp`
  - `pnpm -r lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`
- ESLint 9 flat config 已建立。
- Taro 小程序 Babel 配置已补齐。
- workspace shared 源码在 Taro 和 Next 构建中的 `.js -> .ts` 解析已处理。
- 小程序 tabBar 图标资源已补齐，并通过 Taro copy 输出到 `dist/assets/icons`。

### 2.2 小程序 C 端页面

已完成基础静态页面和主要导航结构：

- 首页 / 角色列表
- 角色详情页
- 聊天页
- 对话列表页
- 记忆页
- 我的页
- 购买点数页
- 支付结果页
- 分享预览页

已完成的体验层能力：

- 四个底部 tab：`首页`、`对话`、`记忆`、`我的`。
- 三个角色的静态展示。
- 模型档位 UI 展示与切换控件雏形。
- 点数余额、羁绊、mood、记忆、额度包等 UI 占位。
- Material Soft Roleplay 视觉方向的基础样式和 design tokens。

冻结说明：这些页面目前以静态数据和占位交互为主，后续需要接入真实 API。

### 2.3 API 与后端基础

已完成基础服务能力：

- Next.js API 工程可启动、可构建。
- 健康检查 API：`GET /api/health`。
- 微信登录 API 骨架：`POST /api/auth/wechat-login`。
- 当前用户 API：`GET /api/me`。
- 角色列表与详情 API：
  - `GET /api/characters`
  - `GET /api/characters/:id`
- JWT 鉴权 middleware 基础能力。
- CORS preflight 基础能力。
- 微信 code 换 openid、用户创建、JWT 签发的服务骨架。

冻结说明：登录 API 已有服务端骨架，但小程序端尚未完成真实登录态闭环。

### 2.4 数据模型与 shared 包

已完成 V1 主要数据模型定义，包括：

- 用户与身份：`users`
- 剧本与角色：`scripts`、`characters`、`character_prompts`、`scenes`、`story_nodes`
- 对话：`chat_sessions`、`messages`
- 记忆与关系：`memories`、`relationships`
- 成就与称号：`titles`、`user_titles`、`achievements`、`user_achievements`
- 模型档位与调用日志：`model_profiles`、`model_usage_logs`
- 支付与钱包：`quota_packages`、`orders`、`payments`、`wallet_accounts`、`wallet_transactions`
- 审核：`review_logs`、`blocked_keywords`

已完成 shared 类型和常量：

- 模型档位枚举
- mood 枚举
- 订单、支付、钱包流水状态
- 支付 provider contract 类型

冻结说明：schema 覆盖面较完整，但多数业务写入流程尚未实现。

### 2.5 支付抽象

已完成：

- `PaymentProvider` 接口。
- `MockPaymentProvider`。
- payment provider contract test。

冻结说明：真实第三方聚合支付 provider、微信支付拉起、回调验签、幂等入账仍未实现。

## 3. 当前未完成的 V1 核心内容

以下内容仍属于 V1 必做范围，不能视为后续版本扩展。

### 3.1 登录与用户态

- 小程序端调用 `wx.login`。
- 小程序端调用 `POST /api/auth/wechat-login`。
- 保存 JWT token。
- API 请求自动携带 `Authorization`。
- 未登录访问核心功能时触发登录。
- 重新进入小程序后恢复登录态。

### 3.2 真实角色数据接入

- seed 一个正式剧本世界观和 3 个角色。
- 首页从 `GET /api/characters` 获取角色列表。
- 角色详情从 `GET /api/characters/:id` 获取数据。
- 前端移除角色静态常量。
- 角色头像素材接入。

### 3.3 单 Agent 流式聊天闭环

- 新增 `POST /api/chat/stream`。
- 创建或恢复单 Agent 会话。
- 用户消息入库。
- 拼接角色、剧本、记忆、羁绊和安全规则上下文。
- 接入 FastClaw adapter。
- HTTP Streaming 返回给小程序。
- AI 完整回复入库。
- 失败状态和重试提示。
- 小程序端真实流式展示。
- 连续对话历史恢复。

### 3.4 会话历史

- 新增会话列表 API：`GET /api/chat/sessions`。
- 新增消息列表 API：`GET /api/chat/sessions/:id/messages`。
- 支持分页。
- 对话列表页接入真实数据。
- 聊天页从历史会话恢复消息。

### 3.5 长期记忆

- 对话完成后抽取候选记忆。
- 写入 `memories`。
- 下次对话前按用户和角色检索相关记忆。
- 将记忆注入 Prompt 上下文。
- 记忆页接入真实数据。
- admin 支持禁用或覆盖错误记忆。

### 3.6 羁绊、mood、成就

- 对话完成后增加羁绊经验。
- 羁绊等级和进度计算。
- 角色详情页和聊天页接入真实羁绊数据。
- AI 回复 mood 字段解析与保存。
- 成就/称号规则。
- 我的页展示已获得成就/称号。
- 防止重复解锁。

### 3.7 模型档位与点数扣减

- 模型档位配置 API：`GET /api/models`。
- 后端按档位选择模型配置。
- 点数余额校验。
- 点数不足时不调用 FastClaw。
- 调用成功后扣点。
- 写入 `model_usage_logs`。
- 写入 `wallet_transactions`。
- 小程序端展示真实余额。

### 3.8 额度包与真实支付

- 额度包 API：
  - `GET /api/quota/packages`
  - `GET /api/quota/balance`
- 订单 API：
  - `POST /api/orders`
  - `GET /api/orders/:id`
- 预支付 API：`POST /api/orders/:id/prepay`。
- 接入真实第三方聚合支付 provider。
- 小程序端拉起微信支付。
- 支付回调 API：`POST /api/payments/aggregate/notify`。
- 回调验签。
- 订单状态机推进。
- 幂等点数入账。
- 防重复到账。
- 支付结果页接入真实订单状态。

### 3.9 内容安全与 AI 标识

- 输入关键词过滤。
- 输出关键词过滤。
- 命中后返回安全提示。
- 主要页面展示 AI 内容标识。
- 分享图包含 AI 内容水印。
- 异常消息进入 admin 审核范围。

### 3.10 轻量分享图

- 聊天页选择或截取对话片段。
- 生成分享图。
- 包含角色头像、昵称、精选对话和 AI 水印。
- 支持保存到相册。
- 长文本截断和换行。

### 3.11 简单 admin

- admin 页面壳。
- 会话列表。
- 消息详情。
- 异常标记和备注。
- 基础统计。
- 订单列表和详情。
- 支付记录列表和详情。
- 钱包账户和余额流水。
- 额度包配置。
- 模型调用日志。

### 3.12 部署与环境

- Docker Compose 跑通 API、Postgres、FastClaw。
- 数据库 migration 验证。
- 环境变量模板补全。
- 微信小程序合法域名配置说明。
- FastClaw 内网访问验证。
- HTTP Streaming 真机 POC。

## 4. 后续开发节奏

### Phase 1：登录与数据接入（已完成）

目标：小程序不再只跑静态数据，用户态和角色数据可以真实走 API。

To Do：

- [x] 完成小程序登录态闭环。
- [x] 完成 API 请求 token 注入。
- [x] 完成角色 seed 数据。
- [x] 首页接入角色列表 API。
- [x] 角色详情接入详情 API。
- [x] 我的页接入 `GET /api/me`。
- [x] Seed 幂等化：重复执行不会重复插入数据。

验收：

- [x] 用户能登录。login 页面调用 `Taro.login` → `POST /api/auth/wechat-login`，成功保存 token 并跳转首页。
- [x] 重新进入后 token 可恢复。token 持久化到 storage，`api.ts` 在每次请求时自动注入 `Authorization` header。
- [x] 首页展示数据库中的 3 个角色。首页从 `GET /api/characters` 获取数据，替换了静态常量，含 loading / error / empty 状态。
- [x] 角色详情来自 API。详情页从 `GET /api/characters/:id` 获取数据，展示 script 世界观信息（标题、描述、世界设定），替换了静态常量。
- [x] 我的页展示真实用户信息。`GET /api/me` 获取头像、昵称等数据，未登录时展示登录引导。
- [x] 401 全局拦截。`api.ts` 在收到 401 时自动清除 auth 并重定向到登录页（非登录页时）。

本地 vs 真机边界：

| 功能 | 本地可验证 | 外部依赖 |
| --- | --- | --- |
| 登录页面调用链 | 已接入 `Taro.login`、`POST /api/auth/wechat-login`、token/user storage 和跳转 | 微信 `code2session` 需要真实小程序环境与 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` |
| Token 持久化与恢复 | 已使用 `Taro.getStorageSync` / `setStorageSync` | 无 |
| 401 拦截与重定向 | 已在 API service 中统一处理 | 无 |
| 角色列表/详情 API | 已接入，需先 seed 数据库并携带 Bearer token | 无 |
| 用户信息 API | 已接入 `GET /api/me` | 无 |
| 角色头像图片加载 | 小程序页面已使用 API 返回路径 | 头像资源和真机加载效果待 Phase 6 设备验证 |

### Phase 2：聊天最小闭环

目标：打通 V1 最核心体验。

To Do：

- [x] 实现 `POST /api/chat/stream`。
- [x] 实现 FastClaw adapter。
- [x] 实现 PromptBuilder。
- [x] 保存 user message。
- [x] 流式返回 assistant reply。
- [x] 保存 assistant 完整回复。
- [x] 小程序聊天页接入真实流式。
- [x] 实现基础失败提示。

验收：

- [x] 用户能向任一角色发送文本。
- [x] AI 能流式回复。
- [x] 数据库可查到用户消息和 AI 完整回复。
- [ ] 连续 20 轮基础对话不崩溃（需真机/POC 环境验证）。

本地 vs FastClaw 边界：

| 场景 | 行为 | 说明 |
| --- | --- | --- |
| `FASTCLAW_BASE_URL` + `FASTCLAW_API_KEY` 均已配置 | 调用 FastClaw `/v1/chat/completions` 流式端点 | 生产路径 |
| 上述配置缺失任意一项 | 使用本地确定性回退流（`fallbackStream`） | 开发/本地路径；done 事件携带 `fallback: true` |
| FastClaw 已配置但 fetch 失败 | 自动降级到本地回退流 | 容错；done 事件携带 `fallback: true` |
| 本地回退流 | 基于关键词匹配的确定性角色回复，包含 mood 标签 | 仅用于本地开发验证，非生产行为 |

核心实现文件：

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/server/modules/chat/service.ts` | 会话管理、消息持久化 |
| `apps/api/src/server/modules/chat/prompt-builder.ts` | 拼接角色+剧本+prompt 行（无记忆/羁绊注入） |
| `apps/api/src/server/modules/chat/mood-parser.ts` | 解析 `[情绪: X]` 标签到 mood 枚举 |
| `apps/api/src/server/modules/fastclaw/adapter.ts` | FastClaw 调用 + 本地回退流 |
| `apps/api/src/app/api/chat/stream/route.ts` | NDJSON 流式 HTTP 入口 |
| `apps/miniapp/src/pages/chat/index.tsx` | 小程序聊天页：真实流式消费 |
| `apps/miniapp/src/services/api.ts` | 新增 `streamChat` 方法（`enableChunked` + `onChunkReceived`） |

测试覆盖：

| 文件 | 覆盖范围 |
| --- | --- |
| `apps/api/src/server/modules/chat/__tests__/mood-parser.test.ts` | mood 标签解析：所有枚举值、大小写、空白、无标签、无效值 |
| `apps/api/src/server/modules/chat/__tests__/prompt-builder.test.ts` | prompt 拼接：全字段、null script、缺失字段、空 prompts |
| `apps/api/src/server/modules/fastclaw/__tests__/adapter.test.ts` | fallback 流：delta 事件产出、mood 标签、done 事件、isFastClawConfigured 检测 |

### Phase 3：历史、记忆和羁绊

目标：让聊天变成可持续体验。

To Do：

- [x] 会话列表 API。
- [x] 会话消息分页 API。
- [x] 对话列表页接入真实数据。
- [x] 聊天页恢复历史消息。
- [x] 记忆抽取和写入。
- [x] 记忆检索和 Prompt 注入。
- [x] 羁绊经验和等级。
- [x] mood 解析、保存和展示。

验收：

- [x] 退出再进可以恢复历史会话。
- [x] 记忆页展示真实记忆。
- [x] 聊天后羁绊值发生变化。
- [x] AI 回复 mood 可展示。

实现说明：

- 记忆模块使用确定性规则抽取（无 LLM 依赖），基于中文关键词/句式匹配 `user_info`、`relationship`、`story` 三类候选记忆，每轮最多 3 条，按 (userId, characterId, type, content) 去重写入。
- 记忆在流式完成后、done 事件发送前写入；下一轮同角色对话可被 Prompt builder 检索注入。
- 羁绊经验每轮固定 +10 递增，等级按 `floor(exp / 100) + 1` 计算，上限 Lv.10，无随机性，无重复跳变。
- 会话列表 API 返回 characterName/avatar/lastMessage/modelTier/updatedAt，支持分页。
- 会话消息 API 返回 role/content/mood/createdAt，按时间升序，验证会话归属。
- 角色详情 API 新增 `relationship` 字段（bondLevel, bondExp）。
- 流式 done 事件新增 `bondLevel` 和 `bondExp` 字段。
- Prompt builder 支持注入记忆和羁绊上下文。

### Phase 4：点数、模型档位和支付

目标：打通商业化和计费闭环。

To Do：

- [x] 模型档位 API。
- [x] 模型档位后端映射。
- [x] 点数余额 API。
- [x] 模型调用前余额校验。
- [x] 模型调用后扣点和流水。
- [x] 额度包 API。
- [x] 下单 API。
- [x] 预支付 API。
- [x] 接入真实支付 provider。
- [x] 支付回调验签。
- [x] 幂等入账。

验收：

- [x] 不同模型档位消耗不同点数。
- [x] 点数不足时不会调用模型。
- [x] 用户可购买额度包。
- [x] 支付成功后点数到账。
- [x] 重复回调不会重复入账。

本地 vs 外部支付边界：

| 功能 | 本地可验证 | 外部依赖 |
| --- | --- | --- |
| 模型档位查询 | `GET /api/models` 返回 seed 中的 3 个档位配置 | 无 |
| 点数余额查询 | `GET /api/quota/balance` 自动创建钱包并返回余额 | 无 |
| 额度包查询 | `GET /api/quota/packages` 返回 active 额度包 | 无 |
| 下单 | `POST /api/orders` 创建订单，merchantOrderNo 唯一 | 无 |
| 预支付（mock） | `POST /api/orders/:id/prepay` 使用 MockPaymentProvider 返回测试参数 | 无 |
| 预支付（aggregate） | `POST /api/orders/:id/prepay` 使用 AggregatePaymentProvider 返回签名的预支付参数 | `PAYMENT_MERCHANT_ID`, `PAYMENT_APP_ID`, `PAYMENT_SECRET` 等聚合支付商户凭证 |
| 支付回调验签 | `POST /api/payments/aggregate/notify` HMAC-SHA256 签名验证 | 真实第三方回调 |
| 幂等入账 | `wallet_transactions.idempotency_key` unique 约束保障 | 无 |
| 小程序支付拉起 | `Taro.requestPayment` 调用 | 微信真实环境（appId、商户号需实配） |
| 点数扣减 | `POST /api/chat/stream` 成功后扣点 + wallet_transactions + model_usage_logs | 无 |
| 余额不足 402 | 流式路由返回 402 错误，不调用模型 | 无 |

### Phase 5：admin 与审核

目标：满足 V1 内部运营和验收要求。

To Do：

- [x] admin 页面壳。
- [x] 会话和消息查看。
- [x] 异常标记和备注。
- [x] 订单、支付记录、余额流水查看。
- [x] 额度包配置。
- [x] 模型调用日志。
- [x] blocked keywords 管理或初始配置。
- [x] 内容安全命中记录。

验收：

- [x] admin 可查看会话和消息。
- [x] admin 可标记异常。
- [x] admin 可查看订单、支付、流水。
- [x] admin 可配置 3 个额度包。
- [x] admin 可查看模型调用日志。

#### Implementation Summary

**Admin pages** (`apps/api/src/app/admin/`):
- Dashboard with section links (`/admin` → `page.tsx`)
- Sidebar navigation layout (`layout.tsx`)
- Server-rendered list pages for: sessions, orders, payments, wallet (accounts + transactions), model usage logs, quota packages, blocked keywords, review logs

**Admin API routes** (`apps/api/src/app/api/admin/`):
- `GET /api/admin/sessions` — paginated session list (filterable by userId, status)
- `GET /api/admin/messages` — paginated messages by sessionId
- `POST /api/admin/review` — create review log (status: normal/flagged/resolved, with note)
- `GET /api/admin/orders` — paginated orders list (filterable by userId, status)
- `GET /api/admin/payments` — paginated payments list (filterable by orderId, status)
- `GET /api/admin/wallet-accounts` — paginated wallet accounts (filterable by userId)
- `GET /api/admin/wallet-transactions` — paginated wallet transactions (filterable by userId, type)
- `GET /api/admin/quota-packages` — list all quota packages
- `PATCH /api/admin/quota-packages/[id]` — update quota package (price, points, active, recommended, sort)
- `GET /api/admin/model-usage-logs` — paginated model usage logs (filterable by userId, sessionId, modelTier)
- `GET /api/admin/blocked-keywords` — list all blocked keywords
- `POST /api/admin/blocked-keywords` — add blocked keyword
- `GET /api/admin/review-logs` — paginated review logs (filterable by sessionId, status)
All admin API routes require JWT authentication.

**Moderation module** (`apps/api/src/server/modules/moderation/`):
- `checkInput(message, sessionId, userId, messageId?)` — checks user input against `blocked_keywords` table; creates `review_log` on hit
- `checkOutput(content, sessionId, messageId?)` — checks AI output against `blocked_keywords` table; creates `review_log` on hit
- Case-insensitive substring matching against all enabled keywords

**Chat stream moderation** (`apps/api/src/app/api/chat/stream/route.ts`):
- Input check: runs before FastClaw call; on hit, saves user message, creates review_log, returns safety response without invoking model or deducting points
- Output check: buffers the AI response, checks it before sending any assistant delta to the client, and only streams the safe final content. On hit, creates review_log, saves a safe replacement message, writes a filtered model_usage_log, and does NOT deduct points

**Seed data** (`apps/api/src/server/seed/index.ts`):
- 15 initial blocked keywords in categories: profanity, adult, violence, self_harm, drugs, gambling, fraud, extremism
- Blocked keyword seed is independently idempotent and still runs when the main story seed already exists

#### V1 Admin Auth Limitation

V1 admin does NOT have a separate admin authentication system. Admin API routes require the same JWT authentication as C-end users, but the server-rendered admin pages currently read from the database directly and do not enforce an admin role. Any authenticated user can call admin API endpoints. For production, a proper admin role/authorization system should be added. The `reviewerId` field in `review_logs` records the authenticated user's ID for API-created reviews.

### Phase 6：V1 验收与真机验证

目标：从“功能可跑”推进到“可验收演示”。

To Do：

- [ ] 微信开发者工具完整编译无错误。
- [ ] 真机登录验证。
- [ ] 真机 HTTP Streaming POC。
- [ ] 真机支付流程验证。
- [ ] 分享图保存到相册验证。
- [x] 敏感词拦截验证。
- [ ] 长对话性能验证。
- [ ] 生产环境 Docker Compose 验证。

验收：

- [ ] PRD 第 8 节整体通过标准逐项通过。
- [x] 技术 SPEC 第 9 节 API 范围完成。
- [x] 支付、钱包、模型调用日志可审计。
- [x] 关键错误路径有用户可理解提示。

Phase 6 本地验收记录：

| 项目 | 本地结果 | 仍需外部条件 |
| --- | --- | --- |
| 小程序编译 | `pnpm build:miniapp` 通过，Taro weapp 产物可生成；仍有既有 Sass `@import` deprecation warning | 微信开发者工具导入项目并完整编译 |
| 分享图保存 | 分享预览页已接入 canvas 绘制、`Taro.canvasToTempFilePath`、`Taro.saveImageToPhotosAlbum`，`pnpm -r typecheck` 与 `pnpm build:miniapp` 已通过 | 真机相册权限、保存成功 toast、生成图片视觉效果 |
| 敏感词拦截 | `apps/api/src/server/modules/moderation/__tests__/service.test.ts` 覆盖输入命中写 review log、输出未命中不写；`pnpm --filter @juben-sha/api test` 60/60 通过 | 结合真实聊天链路做人工 smoke test |
| API 与 admin | `pnpm build:api` 通过；admin 页面为动态 server-rendered，admin API 覆盖会话、消息、审核、订单、支付、钱包、额度包、模型日志、关键词 | admin 独立角色权限仍未实现，当前只做 V1 内部演示边界 |
| Docker Compose | `docker compose config` 通过 | 完整 `docker compose up` 仍等待 `fastclaw/Dockerfile` 或外部 FastClaw 镜像/服务 |
| FastClaw | Adapter 与 fallback tests 通过 | `FASTCLAW_BASE_URL`、`FASTCLAW_API_KEY`、可访问 FastClaw 服务 |
| 微信登录 | API 与小程序登录链路已实现并可编译 | 微信小程序 appId/appSecret、开发者工具/真机 code2session 验证 |
| 真机 HTTP Streaming | 小程序端 `enableChunked`/chunk callback 代码路径已实现并可编译 | 目标微信基础库、HTTPS 合法域名、真机 POC |
| 真机支付 | mock/aggregate provider、预支付、回调验签、幂等入账、微信支付拉起代码路径已实现并可编译 | 聚合支付商户凭证、微信支付商户绑定、真实回调 |
| 长对话性能 | FastClaw fallback 单元测试通过 | 20 轮真机/真实 API 连续对话压测 |

Phase 6 未关闭项：

- PRD 第 8 节整体通过仍未勾选，因为真机登录、真机 streaming、真机支付、相册保存和完整 Docker stack 均依赖外部环境。
- `docker-compose.yml` 仍引用 `./fastclaw/Dockerfile`，但当前仓库没有 `fastclaw/Dockerfile`。完整生产 compose 启动需要补齐 FastClaw 镜像来源或改为外部服务地址。
- V1 admin 尚无独立 admin role/权限系统，当前 API 只要求普通 JWT；页面为内部演示用 server-rendered 页面。

## 5. 后续会话交接建议

后续会话开始时，建议直接引用本文件，并选择一个 Phase 作为目标。

推荐下一个会话目标：

```text
从 docs/v1-freeze-and-todo.md 的 Phase 1 开始，完成登录态闭环和角色 API 接入。
```

执行约束：

- 不要一次同时推进多个 Phase。
- 每个 Phase 完成后都要更新本文件的 checkbox。
- 每个 Phase 至少跑：
  - `pnpm -r lint`
  - `pnpm -r typecheck`
  - 相关测试或构建命令
- 涉及小程序页面时，必须跑 `pnpm build:miniapp`。
- 涉及 API 或 Next 配置时，必须跑 `pnpm build:api`。
