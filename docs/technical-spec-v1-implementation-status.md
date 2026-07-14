# 剧本杀角色扮演小程序技术 SPEC v1 实现状态与剩余缺口

> 版本日期：2026-07-14
> 当前基线：本地工作区，已按当前代码重新核对 API 路由、数据库 schema、聊天扣点、FastClaw adapter、health/ready、admin 鉴权、小程序构建校验、API 文档、Scripts API、mode/scriptId/canSend/hasSuccessfulTurn 会话元数据、角色双模式字段、PATCH /api/me、memory scope 隔离和 clientMessageId 幂等
> 适用对象：后续新窗口 / opencode / Codex 接手开发前的项目状态对齐

## 1. 文档用途

本文档是 `docs/technical-spec-v1.md` 的实现状态补充，不替代正式技术 SPEC。

正式 SPEC 仍用于定义 V1 的产品和技术目标；本文用于说明当前代码已经实现到哪一步、哪些实现已经同步进正式 SPEC、后续开发应该优先补什么。

新窗口接手时建议先读：

1. `docs/prd-v1.md`
2. `docs/technical-spec-v1.md`
3. `docs/technical-spec-v1-implementation-status.md`
4. `DESIGN.md`
5. 本地 `AGENTS.md` 引用的 `/Users/macbookpro/.codex/RTK.md`

本项目当前要求 shell 命令通过 `rtk` 前缀执行，例如：

```bash
rtk pnpm -r test
```

## 2. 当前总体判断

项目已经不是空壳阶段。V1 后端主链路已经进入“核心闭环可继续打磨”的状态：

- 工程架构、数据库 schema、API 分层、服务模块已经成型。
- 用户登录、角色、聊天、记忆、羁绊、点数、订单、支付回调、钱包流水、admin 基础页均已有实现。
- 之前几个发布阻断风险已经有代码修复：生产配置强校验、小程序生产构建防 localhost 和 `api.example.com`、admin 白名单、admin 页面 Basic Auth、支付回调行锁和订单级幂等、本地 mock 支付确认闭环。
- 当前最大问题不是“没写”，而是“真实服务联调和产品化硬化还没完成”，尤其是 FastClaw 生产接入、模型调用失败可观测性、readiness 覆盖面、部署验收、支付服务商实参联调和更完整的端到端测试。

后续开发可以继续推进，但要避免把已经修过的底层闭环推倒重来。

## 3. 当前代码结构快照

### 3.1 后端主要目录

```text
apps/api/src/app/api/
  auth/wechat-login/
  me/
  characters/
  chat/
  health/
  memory/
  models/
  quota/
  orders/
  payments/aggregate/notify/
  ready/
  scripts/
  admin/

apps/api/src/app/admin/
  page.tsx
  layout.tsx
  orders/
  payments/
  wallet/
  quota-packages/
  model-usage/
  sessions/
  review-logs/
  blocked-keywords/

apps/api/src/server/modules/
  auth/
  characters/
  chat/
  fastclaw/
  memory/
  moderation/
  payments/
  relationships/
  wallet/
  admin/

apps/api/src/server/db/
  schema.ts
  index.ts
```

### 3.2 主要数据表

`apps/api/src/server/db/schema.ts` 已包含 V1 主体表：

- 用户与身份：`users`
- 角色与剧本：`scripts`、`characters`、`character_prompts`、`scenes`、`story_nodes`、`user_story_state`
- 对话：`chat_sessions`、`messages`
- 记忆与关系：`memories`、`relationships`
- 称号/成就：`titles`、`user_titles`、`achievements`、`user_achievements`
- 模型与计费：`model_profiles`、`model_usage_logs`
- 支付与钱包：`quota_packages`、`orders`、`payments`、`wallet_accounts`、`wallet_transactions`
- 审核：`review_logs`、`blocked_keywords`

整体 schema 覆盖了正式 SPEC 的 V1 主体范围。

## 4. 模块实现状态

| 模块 | 状态 | 当前实现 | 主要缺口 |
| --- | --- | --- | --- |
| 工程基础 | 基本完成 | Monorepo、Next.js API、Taro miniapp、Drizzle、Vitest、Docker Compose、腾讯云 CCR 镜像部署手册已有 | CI 固化和真实服务器演练仍需补 |
| 配置安全 | 基本完成 | 生产环境强制校验 `DATABASE_URL`、`JWT_SECRET`、支付 provider、admin 配置；Next 构建期不需要注入运行时密钥 | 真实环境变量仍需按部署手册落地 |
| 小程序构建配置 | 基本完成 | 生产构建缺少 `API_BASE_URL`、指向 localhost 或使用 `api.example.com` 会失败；`verify:weapp` 会扫描构建产物；部署手册固定真实域名构建步骤 | 需要 CI 中固定执行构建校验，且不得用 `api.example.com` 做验证构建 |
| 微信登录/JWT | 基本完成 | `POST /api/auth/wechat-login`、`GET /api/me`、JWT middleware 已有 | 没有 refresh token，符合 V1 当前口径 |
| 角色/剧本 | 基本完成 | 角色列表（含 starterQuestions）、详情（含 availableModes/lastUsedMode/starterQuestions/relationship）、Prompt、Scripts 列表和详情 API（GET /api/scripts, GET /api/scripts/:id）已有 | 内容运营、素材和更复杂剧情节点仍待补 |
| 聊天会话 | 基本完成 | `moderated-buffered` 已同步；stream 支持 mode/scriptId 参数和脚本下架拦截；会话列表/消息含 canSend/hasSuccessfulTurn/mode/scriptId 元数据；clientMessageId 幂等重试/重放/碰撞检测；预扣/退款/done payload 已有 | 当前不是真正逐 token 展示；`model_usage_logs` 仍缺耗时、fallback、错误码、错误消息、上游 request id 等持久化可观测字段 |
| FastClaw 集成 | 基础完成 | `server/modules/fastclaw` 适配层已有，调用 `/v1/chat/completions`，支持超时、fallback；FastClaw 暴露 runtime spec，`/api/ready` 会检查 `/readyz` 和业务 Agent `maxTokens/maxToolIterations` | 需要真实 FastClaw contract test、错误分类、生产 fallback 策略验收和更完整错误日志 |
| 输入/输出审核 | 基本完成 | 输入关键词拦截、输出审核替换、review log 基础能力已有 | 审核策略仍偏简单，缺少更细的运营规则 |
| 点数扣减 | 基本完成 | 发送前余额检查，生成前预扣，失败/过滤退款，返回 `balanceAfter` | 需要更多并发和异常测试 |
| 记忆 | 基本完成 | 对话后抽取/upsert，下次对话前检索并注入 Prompt；admin 列表、筛选、禁用/覆盖已有 | 需要记忆抽取失败观测、审计和运营流程打磨 |
| 羁绊 | 基础完成 | 对话后增加经验并返回等级/经验 | 规则仍简单，缺少更丰富事件体系 |
| 称号/成就 | 基础完成 | 表、规则服务、查询 API、聊天完成后解锁链路和服务测试已有 | 需要产品规则验收、种子数据和前端反馈继续打磨 |
| 额度包 | 基本完成 | package 列表、admin 配置、购买页调用真实订单流程 | 真实价格和运营文案待最终确认 |
| 订单/支付 | 核心闭环完成 | 创建订单、prepay、mock-confirm、aggregate notify、支付记录 | 真实聚合支付平台参数需最终落地 |
| 支付回调幂等 | 已修关键风险 | 事务内 `select ... for update`，订单级 `credit_order_${order.id}` 幂等 key | 需要保留并补充更多重复回调测试 |
| 钱包 | 基本完成 | 充值、消费、退款、余额流水均有事务处理 | 需要覆盖更多边界：并发扣点、负余额保护 |
| admin API | 基本完成 | stats、sessions/messages/orders/payments/wallet/quota/model usage/review/keywords/memories/detail API 已有，统一使用 `verifyAdminAuth` | 后台体验、登录/无权限状态和更细编辑能力仍粗糙 |
| admin 页面 | 基础完成 | 多个简单页面已存在，`/admin/**` 已加 Basic Auth middleware | 后台体验和无权限/过期状态仍粗糙，服务端页面读取也要继续收紧 |
| health/ready | 部分完成 | `/api/health` 返回进程存活；`/api/ready` 检查 FastClaw 配置、`/readyz`、`FASTCLAW_AGENT_ID` 和业务 Agent runtime spec | readiness 尚未检查数据库连接和其他生产关键配置完整性 |
| API 文档 | 基础完成 | `docs/api-v1.md` 已覆盖主要小程序、支付回调和 admin API | 如需要对外联调，可再补机器可读 OpenAPI |
| 测试 | 有基础覆盖 | auth、config、chat、fastclaw、memory、moderation、payments、wallet、miniapp api 有测试 | 缺更完整 route 级和端到端支付/聊天测试 |

## 5. 当前实现口径与剩余缺口

### 5.1 聊天流式：正式 SPEC 已同步为 moderated-buffered

当前实现位置：

- `apps/api/src/app/api/chat/stream/route.ts`
- `apps/api/src/server/modules/chat/stream-runner.ts`

当前新增参数：`mode`（`"script"` | `"free"`）和 `scriptId`（可选，向后兼容旧客户端）。`mode=script` 时 `scriptId` 必填；`mode=free` 时不可传 `scriptId`。`mode`/`scriptId` 与已有 session 不匹配时返回 `session_scope_mismatch`（409）。`scriptId` 对应剧本已下架时返回 `script_unavailable`（409）。`done` 事件始终包含 `mode` 字段。

当前响应头包含：

```text
X-Stream-Mode: moderated-buffered
```

实际行为：

1. 路由校验 JWT 和请求体。
2. `runChatStream` 创建或复用 active 会话并保存用户消息。
3. 输入关键词拦截发生在预扣前；被拦截时保存安全提示 assistant message，不扣点，不调用 FastClaw。
4. 余额足够后按模型档位预扣点数，幂等 key 为 `consume_${userMsg.id}`。
5. 后端调用 `streamChat(systemPrompt, message)`，累积 FastClaw delta 到 `fullContent`。
6. 模型结束后解析 mood，做输出审核。
7. 审核通过时保存最终 assistant message，写入 `model_usage_logs(status=success)`；`CHAT_EFFECTS_ASYNC_ENABLED=false` 时同步触发记忆、羁绊、成就/称号，`true` 时后台触发。
8. 输出被过滤时保存替换文案，退款，写入 `model_usage_logs(status=filtered)`。
9. FastClaw 返回 error 或流处理异常时退款，并向客户端返回 error 事件。

剩余缺口：

- 当前仍不是逐 token 实时展示，正式 SPEC 已承认该口径。
- 聊天链路已有结构化 latency 日志，但 `model_usage_logs` 还缺耗时、fallback、错误码、错误消息、上游 request id 等持久化可观测字段。

### 5.2 扣点时机：正式 SPEC 已同步为预扣/退款

当前实现位置：

- `apps/api/src/server/modules/chat/stream-runner.ts`
- `apps/api/src/server/modules/wallet/service.ts`

当前实现：

1. 发送前检查余额。
2. 调用模型前预扣点数。
3. 模型失败、异常、输出过滤时退款。
4. 成功后写入 `model_usage_logs`，`done` payload 返回 `balanceAfter`。

该方向更适合控制并发成本，不建议回退到“生成后才扣点”。

### 5.3 admin：接口骨架和 Basic Auth 已补齐，产品体验仍偏工程化

正式 SPEC 中 admin API 包含：

- `GET /api/admin/stats`
- `GET /api/admin/orders/:id`
- `GET /api/admin/payments/:id`
- 多项列表、审核、额度包配置能力

当前已有：

- `GET /api/admin/sessions`
- `GET /api/admin/messages`
- `POST /api/admin/review`
- `GET /api/admin/review-logs`
- `GET /api/admin/orders`
- `GET /api/admin/payments`
- `GET /api/admin/wallet-accounts`
- `GET /api/admin/wallet-transactions`
- `GET /api/admin/quota-packages`
- `POST /api/admin/quota-packages`
- `PATCH /api/admin/quota-packages/:id`
- `GET /api/admin/model-usage-logs`
- `GET/POST /api/admin/blocked-keywords`

所有 admin API 当前已使用 `verifyAdminAuth`，会校验普通 JWT 后再检查 `ADMIN_USER_IDS` 白名单。

`/admin/**` 页面当前已通过 `apps/api/src/middleware.ts` 增加 Basic Auth 二次保护；生产环境启动时要求设置 `ADMIN_BASIC_AUTH_USER` 和 `ADMIN_BASIC_AUTH_PASSWORD`。

当前已看到：

- `GET /api/admin/stats`
- `GET /api/admin/orders/:id`
- `GET /api/admin/payments/:id`
- `GET /api/admin/sessions/:id`
- `GET /api/admin/memories`
- `PATCH /api/admin/memories/:id`
- `docs/api-v1.md`

仍需补：

- 后台页面访问入口的完整体验，包括登录/无权限/过期状态。
- 生产部署层面的更强保护，例如网关 IP 白名单或独立后台域名。
- admin 页面与 API 字段的产品验收，避免只有接口可用但运营不可用。
- 关键操作的审计日志和导出能力，后续按运营需要补。

### 5.4 支付：业务闭环已成型，但真实服务商仍待最终确认

正式 SPEC 要求：

- 真实第三方聚合支付
- 微信小程序支付拉起
- 服务端回调验签
- 订单状态机
- 幂等入账

当前实现已经具备：

- `PaymentProvider` 接口
- mock provider
- aggregate provider
- 创建订单
- 创建 prepay
- 小程序 mock provider 下调用 `mock-confirm`
- aggregate notify 入口
- 回调验签后推进订单
- 事务内锁订单行
- 订单级入账幂等 key：`credit_order_${order.id}`
- 钱包入账和流水

仍需补：

- 根据最终支付服务商补齐真实 adapter 细节。
- 用真实小程序支付参数验证 `wx.requestPayment`。
- 补支付回调生产环境验签样例和联调文档。
- 增加更多支付状态机测试：重复成功回调、失败后成功、金额不一致、交易号不一致、并发回调。

### 5.5 记忆：基础链路和 admin 纠错能力已有，下一步补观测

正式 SPEC 写 admin 需要支持禁用或覆盖错误记忆。

当前已有：

- 记忆抽取
- 记忆 upsert
- 按用户 + 角色检索启用记忆
- 对话 Prompt 注入
- 我的/记忆页相关 API 基础

仍需补：

- 记忆抽取失败时的观测和审计。
- 运营纠错流程文档，例如什么情况下禁用、什么时候覆盖。
- 如果未来记忆量增长，需要检索质量、分页和筛选体验验收。

### 5.6 成就/称号：后端最小闭环已有，仍需产品规则验收

当前 schema 中已有：

- `titles`
- `user_titles`
- `achievements`
- `user_achievements`

当前已看到服务、规则、查询 API 和测试，聊天完成后也会返回解锁结果。

仍需补：

- 正式种子数据和产品文案。
- 解锁规则是否符合玩法节奏的验收。
- 前端展示和解锁反馈。
- 后续如运营频繁调整，再考虑 admin 配置能力。

### 5.7 API 文档：已有人工版，OpenAPI 可后置

正式 SPEC 选择了 OpenAPI，用于联调和交付文档。

当前仓库已有 `docs/api-v1.md`，足以支撑首轮内部联调。

建议后续新增：

```text
apps/api/src/server/openapi/
docs/openapi-v1.yaml
```

如果短期只有内部协作，继续人工维护 `docs/api-v1.md` 即可；等接口稳定或需要外部交付时再转 OpenAPI。

### 5.8 FastClaw 和 readiness：当前是适配层可用，不是生产接入完成

当前已有：

- `apps/api/src/server/modules/fastclaw/adapter.ts`
- OpenAI SSE 兼容形式的 `/v1/chat/completions` 调用假设
- `Authorization: Bearer <FASTCLAW_API_KEY>`
- 可选 `x-fastclaw-agent-id` 和 `x-fastclaw-session-key`
- fallback 文案流
- fallback 单元测试
- `/api/health` 进程存活检查
- `/api/ready` 检查 FastClaw 配置、`${FASTCLAW_BASE_URL}/readyz` 和业务 Agent runtime spec
- Docker Compose 中的 `fastclaw` 服务声明
- `FASTCLAW_TIMEOUT_MS` 默认值已调整为 `120000`
- `CHAT_EFFECTS_ASYNC_ENABLED` 默认 `false`，支持将业务聊天 effects 切到后台最终一致性
- V1 业务聊天 Agent 限制已由 `/api/ready` runtime spec 校验：`maxTokens <= 768`、`maxToolIterations = 0`，FastClaw runtime 默认模型为 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`，prompt 默认 80-180 个中文字符，必要时最多 300 个中文字符

仍需补：

- 与真实 FastClaw 服务的 contract test 或联调脚本，覆盖鉴权、SSE 格式、错误格式和 runtime spec。
- 生产环境 fallback 策略：默认关闭静默 fallback，失败走退款和错误响应；如要降级，必须显式配置并在响应/日志中标识。
- readiness 检查：当前覆盖 FastClaw 配置、`/readyz` 和业务 Agent 速度约束，还需补数据库连接和其他关键生产配置状态。
- 模型调用日志补耗时、fallback、错误原因、token、上游 request id 等字段。

### 5.9 Scripts API：已实现

当前实现位置：

- `apps/api/src/app/api/scripts/route.ts` — `GET /api/scripts`（无需认证，支持可选 `?q=` 搜索）
- `apps/api/src/app/api/scripts/[id]/route.ts` — `GET /api/scripts/:id`（需认证）
- `apps/api/src/server/modules/scripts/service.ts`

`GET /api/scripts/:id` 返回剧本详情 + 角色列表（含 `starterQuestions`），不暴露系统 Prompt。已下架剧本返回 `404`。

### 5.10 角色详情双模式字段：已实现

`GET /api/characters/:id` 返回扩展字段：

- `availableModes`: `string[]` — 有剧本角色为 `["script", "free"]`，无剧本角色为 `["free"]`
- `lastUsedMode`: `string | null` — 当前用户上次与该角色的聊天模式
- `starterQuestions`: `{ script: string[], free: string[] }`
- `relationship`: `{ bondLevel: number, bondExp: number } | null`

`prompts` 字段在路由层剥离，不返回给客户端。

### 5.11 会话元数据：canSend / hasSuccessfulTurn / mode / scriptId

`GET /api/chat/sessions` 支持查询参数 `page`、`limit`、`characterId`、`mode`、`scriptId`；每条 session 返回 `mode`、`scriptId`、`scriptTitle`、`canSend`、`lastMessage`。

`GET /api/chat/sessions/:id/messages` 支持分页（默认 `limit=50` 上限 100）；返回 `session` 元数据对象含 `mode`、`scriptId`、`scriptTitle`、`characterIdentity`、`canSend`、`hasSuccessfulTurn`。消息列表永不返回 system 角色消息。

`canSend` 规则：角色 `status=active` 且（无剧本或剧本 `status=active`）时为 `true`。剧本下架后 `canSend=false`。

`hasSuccessfulTurn`：由 `model_usage_logs.status='success'` 判定；兼容旧数据中未标记 `outOfScope`/`excludedFromContext` 的 assistant 消息。

### 5.12 PATCH /api/me

`PATCH /api/me` 允许更新 `preferredName`（玩家被 AI 称呼的名字）。限制 1-20 个 Unicode 码点；空字符串/空白返回 `400`，`error: "invalid_preferred_name"`。

### 5.13 Memory scope 隔离

记忆表包含 `scope`（`"shared"` | `"script"`）和 `scriptId` 字段，带 CHECK 约束确保 scope 一致性。

- free 模式：仅检索 `scope=shared` 的记忆。
- script 模式：检索 `scope=shared` + 当前剧本 `scope=script` 的记忆。
- `story` 类型记忆仅在有明确 `scriptId` 时写入，free/旧版调用不写 story 行。

`GET /api/memory` 返回按角色分组的启用记忆，含 `type` 字段。

### 5.14 clientMessageId 幂等与 retired 禁止发送

`POST /api/chat/stream` 的 `clientMessageId` 实现完整幂等逻辑：

- 已完成 turn 重放已保存 assistant（`done.replayed=true`）。
- 仍在生成且 lease 未过期返回 `in_progress`。
- 失败或 lease 过期后允许重新获取生成 lease（`acquired_existing`）。
- 同一 `clientMessageId` 在多个 session 中出现时返回 `409`（`client_message_id_collision`）。

`GET /api/chat/messages/by-client-id` 返回 `mode` 和 `scriptId` 字段。

角色绑定的剧本状态非 `active` 时，stream 请求返回 `script_unavailable`（409），session 的 `canSend` 变为 `false`。无绑定角色的剧本不受影响。

## 6. 后续开发优先级

### P0：先保持现有闭环稳定

不要先重构大架构。当前后端已经有可运行闭环，下一步应围绕风险和验收补洞。

优先事项：

1. 固定当前实现口径：聊天 `moderated-buffered`、预扣/退款、admin 白名单、admin Basic Auth、mock-confirm。
2. 给 FastClaw adapter 补真实 contract test、错误分类和生产 fallback 策略验收。
3. 给支付、钱包、聊天扣点加更强的并发/重复请求测试。
4. 给小程序生产构建和 API 生产配置加入 CI 或固定验证命令，禁止使用 `api.example.com` 做验证构建。

### P1：补后端缺失模块

建议按下面顺序推进：

1. FastClaw 生产化：真实服务联调、错误/超时/降级策略、ready check。
2. 可观测性：模型调用日志、支付回调日志、关键业务错误分类。
3. Admin 产品化：登录/无权限/过期状态、操作审计、关键页面验收。
4. Achievements/titles：正式种子数据、规则节奏和前端反馈。
5. API 文档：继续维护 `docs/api-v1.md`；需要外部交付时补 OpenAPI。

### P2：联调和产品体验增强

1. 真实支付服务商联调。
2. FastClaw 模型质量、成本和延迟压测。
3. 反向代理和微信开发者工具下的 streaming 行为验证。
4. admin 登录/无权限/过期状态体验。
5. 部署验收手册已有基础版，后续需要在真实服务器按 env、migration、seed、health/ready、回滚流程演练。

## 7. 建议给新窗口的任务边界

如果新窗口专注后端，建议不要同时做大规模前端视觉改造。更合适的任务边界是：

```text
目标：推进 V1 后端产品化，优先 FastClaw 真实服务接入、可观测性、部署验收和关键链路测试。

约束：
- 保留当前支付、钱包、聊天预扣退款闭环。
- 不把聊天改回生成后扣点。
- 不在未设计安全策略前强行做真实逐 token 输出。
- 不推翻已经落地的 admin stats/detail、memory admin、achievements 和 `docs/api-v1.md`。
- FastClaw 失败不能在生产环境静默伪装成正常成功。
- 不要为了测试或验证而编译出包含 `api.example.com` 的小程序产物。
- 新增接口、配置和关键分支必须有基本测试。
- 修改生产配置、小程序构建配置、支付回调、钱包事务时必须跑全量测试。
```

## 8. 推荐执行顺序

### 8.1 FastClaw 生产化接入

建议先固定真实 FastClaw contract：

- 请求路径、鉴权方式、请求体字段。
- SSE/NDJSON 流事件格式和 `[DONE]`/结束事件。
- 错误码、错误体和限流/超时表现。
- token/耗时/request id 是否可返回。

然后修改：

```text
apps/api/src/server/modules/fastclaw/adapter.ts
apps/api/src/server/modules/fastclaw/__tests__/adapter.test.ts
```

最小验收：

- 配置缺失时开发 fallback 仍可用。
- 生产环境缺配置应 fail fast 或在 readiness 中失败。
- FastClaw 5xx、超时、断流、坏 JSON 都能走明确失败路径。
- 失败时不保留扣点；如果已经预扣，必须退款。
- 日志能看出是否 fallback、耗时、错误原因。

### 8.2 补可观测性字段

建议优先补 `model_usage_logs` 或配套日志中的字段：

- `latencyMs`
- `usedFallback`
- `errorCode`
- `errorMessage`
- `upstreamRequestId`
- `inputTokens`
- `outputTokens`
- `costEstimateCents`

不要先做复杂监控平台；先让数据库/admin 能回答“哪次调用失败了，为什么，扣没扣点，是否 fallback”。

### 8.3 补 health/readiness

建议拆分：

- `/api/health`：进程存活。
- `/api/ready`：当前已检查 FastClaw 配置和 `/readyz`；还需补数据库、必要生产配置。

readiness 失败应返回可读的组件状态，但不能泄露密钥。

### 8.4 固化 CI/验收命令

至少固定：

- API 测试。
- API TypeScript 编译。
- 小程序生产构建和 `verify:weapp`，使用真实安全 API 域名或非占位测试域名，不得使用 `api.example.com`。
- Docker Compose 部署前 dry-run；服务器部署默认拉取腾讯云 CCR 镜像，不在服务器现场构建业务镜像。

### 8.5 支付真实服务商联调

FastClaw 接入链路稳定后，再推进真实聚合支付参数：

- `PaymentProvider` adapter 实参。
- 真实 prepay 参数和 `wx.requestPayment`。
- 回调验签样例。
- 重复回调、金额不一致、失败后成功等状态机测试。

## 9. 接手前必须知道的验证命令

常用验证：

```bash
rtk pnpm -r --if-present test
rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit
rtk pnpm exec tsc -p apps/miniapp/tsconfig.json --noEmit
```

小程序生产构建校验：

```bash
rtk API_BASE_URL="$REAL_API_BASE_URL" pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

注意：`REAL_API_BASE_URL` 必须是真实 HTTPS API 域名或明确允许进入测试产物的非占位域名。禁止用 `api.example.com` 执行小程序构建验证。

本地开发：

```bash
rtk pnpm dev
```

`pnpm dev` 会先启动 Postgres，然后并发启动后端 API、FastClaw 和小程序 watch 构建。若需要单独启动，可继续使用：

```bash
rtk pnpm dev:api
rtk pnpm dev:miniapp
```

数据库：

```bash
rtk pnpm db:generate
rtk pnpm db:migrate
rtk pnpm --filter @juben-sha/api seed
```

## 10. 新窗口推荐 Prompt

可以直接把下面这段给新窗口：

```text
你在 /Users/macbookpro/Desktop/Codex/剧本杀角色扮演小程序 继续推进项目。

先阅读：
- AGENTS.md
- /Users/macbookpro/.codex/RTK.md
- docs/prd-v1.md
- docs/technical-spec-v1.md
- docs/technical-spec-v1-implementation-status.md
- DESIGN.md

当前目标：专注后端产品化，根据 technical-spec-v1-implementation-status.md 推进 FastClaw 真实服务接入、可观测性、readiness、CI/部署验收和关键链路测试。

优先顺序：
1. 固定真实 FastClaw contract：请求、鉴权、流格式、错误格式、健康检查。
2. 硬化 apps/api/src/server/modules/fastclaw/adapter.ts：超时、错误分类、生产 fallback 策略、contract test。
3. 补模型调用日志/可观测字段：耗时、fallback、错误原因、token、上游 request id。
4. 补强 /api/ready：在当前 FastClaw /readyz 检查基础上增加数据库和生产关键配置状态。
5. 固化 CI/部署验收：API test/typecheck、小程序生产构建、Docker/Compose 验证；当前已有腾讯云 CCR 镜像部署版 `docs/deployment.md` 和部署配置测试基础。
6. 再推进真实支付服务商联调和支付状态机测试。

开发约束：
- 所有 shell 命令使用 rtk 前缀。
- 不要推翻当前支付、钱包、聊天预扣退款闭环。
- 不要把聊天改回生成后扣点。
- 不要在没有安全策略前强行做真实逐 token 输出。
- 不要重复实现已经存在的 admin stats/detail、memory admin、achievements 和 docs/api-v1.md。
- FastClaw 生产环境不要静默 fallback 后伪装为正常成功。
- admin API 必须使用 verifyAdminAuth。
- admin 页面当前已有 Basic Auth middleware，生产环境必须配置 ADMIN_BASIC_AUTH_USER 和 ADMIN_BASIC_AUTH_PASSWORD。
- 支付和钱包相关改动必须保留事务、行锁和幂等 key。
- 新增接口必须补测试。
- 杜绝 api.example.com 进入小程序产物；不要为了测试或验证而编译出包含 api.example.com 的小程序产物。

验证至少运行：
- rtk pnpm -r --if-present test
- rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit

如果触碰小程序构建配置，再运行：
- rtk API_BASE_URL="$REAL_API_BASE_URL" pnpm --filter @juben-sha/miniapp build:weapp
- rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

## 11. 当前工作区注意事项

`docs/v1-freeze-and-todo.md` 已按用户要求删除。当前如果尚未提交，这个删除会显示在 git working tree 中。

不要恢复该文件，除非用户明确要求。
