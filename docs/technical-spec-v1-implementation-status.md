# 剧本杀角色扮演小程序技术 SPEC v1 实现状态与偏差说明

> 版本日期：2026-06-14
> 当前基线提交：`6993b7d fix: unify miniapp auth state and chat balance`
> 适用对象：后续新窗口 / opencode / Codex 接手开发前的项目状态对齐

## 1. 文档用途

本文档是 `docs/technical-spec-v1.md` 的实现状态补充，不替代正式技术 SPEC。

正式 SPEC 仍用于定义 V1 的产品和技术目标；本文用于说明当前代码已经实现到哪一步、哪些实现和原 SPEC 存在偏差、后续开发应该优先补什么。

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
- 之前几个发布阻断风险已经有代码修复：生产配置强校验、小程序生产构建防 localhost、admin 白名单、支付回调行锁和订单级幂等、本地 mock 支付确认闭环。
- 当前最大问题不是“没写”，而是“正式 SPEC 的口径没有完全同步当前实现”，尤其是聊天流式、扣点时机、admin API 细项、OpenAPI、成就/称号。

后续开发可以继续推进，但要避免把已经修过的底层闭环推倒重来。

## 3. 当前代码结构快照

### 3.1 后端主要目录

```text
apps/api/src/app/api/
  auth/wechat-login/
  me/
  characters/
  chat/
  memory/
  models/
  quota/
  orders/
  payments/aggregate/notify/
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
| 工程基础 | 基本完成 | Monorepo、Next.js API、Taro miniapp、Drizzle、Vitest、Docker Compose 已有 | 需要继续补 OpenAPI 和部署验收文档 |
| 配置安全 | 基本完成 | 生产环境强制校验 `DATABASE_URL`、`JWT_SECRET`、支付 provider、admin 配置 | 部署模板仍需和真实环境变量对齐 |
| 小程序构建配置 | 基本完成 | 生产构建缺少 `API_BASE_URL` 或指向 localhost 会失败 | 需要 CI 中固定执行构建校验 |
| 微信登录/JWT | 基本完成 | `POST /api/auth/wechat-login`、`GET /api/me`、JWT middleware 已有 | 没有 refresh token，符合 V1 当前口径 |
| 角色/剧本 | 基本完成 | 角色列表、详情、Prompt、script 查询已有 | 内容运营、素材和更复杂剧情节点仍待补 |
| 聊天会话 | 可用但有 SPEC 偏差 | 会话创建、用户消息保存、调用 FastClaw、保存 assistant 消息已有 | 当前不是真正逐 token 展示，见第 5 节 |
| FastClaw 集成 | 基本完成 | `server/modules/fastclaw` 适配层已有，支持 fallback | 真实 FastClaw 服务联调和稳定性 POC 还需要做 |
| 输入/输出审核 | 基本完成 | 输入关键词拦截、输出审核替换、review log 基础能力已有 | 审核策略仍偏简单，缺少更细的运营规则 |
| 点数扣减 | 基本完成 | 发送前余额检查，生成前预扣，失败/过滤退款，返回 `balanceAfter` | 需要更多并发和异常测试 |
| 记忆 | 基础完成 | 对话后抽取/upsert，下次对话前检索并注入 Prompt | admin 禁用/覆盖错误记忆还没完整实现 |
| 羁绊 | 基础完成 | 对话后增加经验并返回等级/经验 | 规则仍简单，缺少更丰富事件体系 |
| 称号/成就 | 仅 schema 预留 | 表存在 | 缺规则服务、API、解锁逻辑、前端闭环 |
| 额度包 | 基本完成 | package 列表、admin 配置、购买页调用真实订单流程 | 真实价格和运营文案待最终确认 |
| 订单/支付 | 核心闭环完成 | 创建订单、prepay、mock-confirm、aggregate notify、支付记录 | 真实聚合支付平台参数需最终落地 |
| 支付回调幂等 | 已修关键风险 | 事务内 `select ... for update`，订单级 `credit_order_${order.id}` 幂等 key | 需要保留并补充更多重复回调测试 |
| 钱包 | 基本完成 | 充值、消费、退款、余额流水均有事务处理 | 需要覆盖更多边界：并发扣点、负余额保护 |
| admin API | 基础完成 | sessions/messages/orders/payments/wallet/quota/model usage/review/keywords | 缺 `/api/admin/stats`、详情 API、部分编辑能力 |
| admin 页面 | 基础完成 | 多个简单页面已存在 | 后台体验和鉴权入口仍粗糙，服务端页面读取也要继续收紧 |
| OpenAPI | 未完成 | 未看到实际 OpenAPI 文件 | 需要新增首版接口文档或生成流程 |
| 测试 | 有基础覆盖 | auth、config、chat、fastclaw、memory、moderation、payments、wallet、miniapp api 有测试 | 缺更完整 route 级和端到端支付/聊天测试 |

## 5. 与正式 SPEC 的关键偏差

### 5.1 聊天流式：当前是审核后缓冲返回，不是真正实时流式

正式 SPEC 写的是：

```text
聊天必须流式输出，采用 HTTP Streaming。
```

当前实现位置：

- `apps/api/src/app/api/chat/stream/route.ts`

当前响应头包含：

```text
X-Stream-Mode: moderated-buffered
```

实际行为：

1. 后端调用 `streamChat(systemPrompt, message)`。
2. 后端累积 FastClaw 的 delta 到 `fullContent`。
3. 等模型完成后做 mood 解析和输出审核。
4. 审核后一次性发送最终 `delta`。
5. 再发送 `done`。

这不是严格意义上的“边生成边展示”。它更像“服务端流式接收，审核后一次性返回给小程序”。

后续必须二选一：

- 如果继续坚持输出审核优先：正式 SPEC 应改成“V1 采用审核后缓冲返回，接口保持 NDJSON streaming 形态，但前端不承诺逐 token 展示”。
- 如果坚持真实流式体验：需要重新设计安全策略，例如延迟审核、分段审核、风险中断、敏感替换、客户端已显示内容回收策略。

当前建议：V1 先承认 `moderated-buffered`，等核心产品闭环稳定后再做真实流式 POC。

### 5.2 扣点时机：当前实现优于旧 SPEC，但文档未更新

正式 SPEC 写的是：

```text
模型调用完成后按实际使用档位扣减点数。
```

当前实现已经改为：

1. 发送前检查余额。
2. 调用模型前预扣点数。
3. 模型失败、异常、输出过滤时退款。
4. 成功后写入 `model_usage_logs`，`done` payload 返回 `balanceAfter`。

当前实现位置：

- `apps/api/src/app/api/chat/stream/route.ts`
- `apps/api/src/server/modules/wallet/service.ts`

这个方向更适合控制并发成本，建议更新正式 SPEC，不建议回退到“生成后才扣点”。

### 5.3 admin：权限边界已修，但 SPEC API 范围仍未完全实现

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

仍需补：

- admin stats 汇总接口和页面数据源。
- 订单详情、支付详情、会话详情等详情 API。
- 后台页面访问入口的完整体验，包括登录/无权限状态。
- 生产部署层面的二次保护，例如 Basic Auth、网关 IP 白名单或独立后台域名。

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

### 5.5 记忆：基础链路有了，运营纠错能力不足

正式 SPEC 写 admin 需要支持禁用或覆盖错误记忆。

当前已有：

- 记忆抽取
- 记忆 upsert
- 按用户 + 角色检索启用记忆
- 对话 Prompt 注入
- 我的/记忆页相关 API 基础

仍需补：

- admin 记忆列表。
- 禁用记忆。
- 覆盖或编辑错误记忆。
- 记忆抽取失败时的观测和审计。

### 5.6 成就/称号：属于“表已预留，功能未成型”

当前 schema 中已有：

- `titles`
- `user_titles`
- `achievements`
- `user_achievements`

但缺：

- 事件规则服务。
- 解锁判定。
- API。
- 前端展示和解锁反馈。
- admin 配置或种子数据。

如果新窗口要推进后端，应把它视为未完成模块，不要误判为已实现。

### 5.7 OpenAPI：正式 SPEC 承诺了，但当前没有产物

正式 SPEC 选择了 OpenAPI，用于联调和交付文档。

当前仓库未看到明确的 OpenAPI 文件或生成流程。

建议后续新增：

```text
apps/api/src/server/openapi/
docs/openapi-v1.yaml
```

或先人工维护 `docs/api-v1.md`，等接口稳定后再转 OpenAPI。

## 6. 后续开发优先级

### P0：先保持现有闭环稳定

不要先重构大架构。当前后端已经有可运行闭环，下一步应围绕风险和验收补洞。

优先事项：

1. 补充并固定当前实现口径：聊天 `moderated-buffered`、预扣/退款、admin 白名单、mock-confirm。
2. 给支付、钱包、聊天扣点加更强的并发/重复请求测试。
3. 给小程序生产构建和 API 生产配置加入 CI 或固定验证命令。
4. 清理正式 SPEC 中已经过时的“生成后扣点”和“真实逐 token 流式”表述。

### P1：补后端缺失模块

建议按下面顺序推进：

1. Admin stats：补 `/api/admin/stats`，让后台首页真实展示核心指标。
2. Admin 详情 API：订单详情、支付详情、会话详情。
3. Memory admin：记忆列表、禁用、覆盖。
4. Achievements/titles：规则服务、种子数据、查询 API、解锁事件。
5. OpenAPI 或 API 文档：至少覆盖小程序端和 admin 端主接口。

### P2：联调和产品体验增强

1. FastClaw 真实服务联调。
2. 真实支付服务商联调。
3. 反向代理和微信开发者工具下的 streaming 行为验证。
4. admin 登录/无权限/过期状态体验。
5. 模型调用日志补 token、耗时、fallback、错误原因等字段。

## 7. 建议给新窗口的任务边界

如果新窗口专注后端，建议不要同时做大规模前端视觉改造。更合适的任务边界是：

```text
目标：补齐 V1 后端 spec 偏差，优先 admin stats / details、memory admin、achievement/title、OpenAPI。

约束：
- 保留当前支付、钱包、聊天预扣退款闭环。
- 不把聊天改回生成后扣点。
- 不在未设计安全策略前强行做真实逐 token 输出。
- 新增接口必须有基本测试。
- 修改生产配置、小程序构建配置、支付回调、钱包事务时必须跑全量测试。
```

## 8. 推荐执行顺序

### 8.1 更新正式 SPEC

修改 `docs/technical-spec-v1.md`：

- 将聊天描述从“必须真实流式输出”改为“V1 接口采用 NDJSON streaming 形态；当前安全策略为审核后缓冲返回”。
- 将扣点描述改为“模型调用前预扣，失败/过滤退款，成功写日志和流水”。
- 标注 admin stats、详情 API、OpenAPI、成就/称号仍待完成。

### 8.2 补 admin stats

建议新增：

```text
apps/api/src/app/api/admin/stats/route.ts
apps/api/src/server/modules/admin/stats.ts
apps/api/src/server/modules/admin/__tests__/stats.test.ts
```

指标建议：

- 用户总数
- 今日新增用户
- 会话总数
- 今日消息数
- 订单总数
- 已入账订单数
- 支付成功金额
- 总钱包余额
- 模型调用次数
- 输出过滤次数

### 8.3 补 admin 详情 API

建议新增：

```text
apps/api/src/app/api/admin/orders/[id]/route.ts
apps/api/src/app/api/admin/payments/[id]/route.ts
apps/api/src/app/api/admin/sessions/[id]/route.ts
```

每个详情 API 都必须走 `verifyAdminAuth`。

### 8.4 补 memory admin

建议新增：

```text
apps/api/src/app/api/admin/memories/route.ts
apps/api/src/app/api/admin/memories/[id]/route.ts
apps/api/src/server/modules/memory/admin-service.ts
apps/api/src/server/modules/memory/__tests__/admin-service.test.ts
```

最小能力：

- 列表查询。
- 按用户/角色/类型筛选。
- 禁用记忆。
- 覆盖内容。
- 记录更新时间。

### 8.5 补 achievement/title 后端闭环

建议新增：

```text
apps/api/src/app/api/achievements/route.ts
apps/api/src/server/modules/achievements/service.ts
apps/api/src/server/modules/achievements/rules.ts
apps/api/src/server/modules/achievements/__tests__/service.test.ts
```

最小规则：

- 首次对话解锁。
- 与任意角色羁绊达到 2 级解锁。
- 累计发送消息数达到阈值解锁。

这部分要接入聊天完成后的事件，但先保持规则简单，不要引入复杂事件总线。

### 8.6 补 API 文档

如果短期不做自动 OpenAPI，先新增：

```text
docs/api-v1.md
```

至少覆盖：

- Auth
- Me
- Characters
- Chat
- Sessions
- Memory
- Models
- Quota
- Orders
- Payments notify
- Admin

## 9. 接手前必须知道的验证命令

常用验证：

```bash
rtk pnpm -r --if-present test
rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit
rtk pnpm exec tsc -p apps/miniapp/tsconfig.json --noEmit
```

小程序生产构建校验：

```bash
rtk API_BASE_URL=https://api.example.com pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

本地开发：

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

当前目标：专注后端，根据 technical-spec-v1-implementation-status.md 补齐 V1 后端 spec 偏差。

优先顺序：
1. 更新 docs/technical-spec-v1.md 中已经过时的实现口径：聊天 moderated-buffered、预扣/退款、admin/API 待完成项。
2. 补 /api/admin/stats，并给 admin 首页接真实统计数据。
3. 补 admin 订单/支付/会话详情 API。
4. 补 memory admin：列表、筛选、禁用、覆盖。
5. 补 achievement/title 后端最小闭环。
6. 补 docs/api-v1.md 或 OpenAPI 初版。

开发约束：
- 所有 shell 命令使用 rtk 前缀。
- 不要推翻当前支付、钱包、聊天预扣退款闭环。
- 不要把聊天改回生成后扣点。
- 不要在没有安全策略前强行做真实逐 token 输出。
- admin API 必须使用 verifyAdminAuth。
- 支付和钱包相关改动必须保留事务、行锁和幂等 key。
- 新增接口必须补测试。

验证至少运行：
- rtk pnpm -r --if-present test
- rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit

如果触碰小程序构建配置，再运行：
- rtk API_BASE_URL=https://api.example.com pnpm --filter @juben-sha/miniapp build:weapp
- rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

## 11. 当前工作区注意事项

`docs/v1-freeze-and-todo.md` 已按用户要求删除。当前如果尚未提交，这个删除会显示在 git working tree 中。

不要恢复该文件，除非用户明确要求。
