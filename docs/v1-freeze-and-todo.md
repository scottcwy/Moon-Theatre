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

- [ ] 实现 `POST /api/chat/stream`。
- [ ] 实现 FastClaw adapter。
- [ ] 实现 PromptBuilder。
- [ ] 保存 user message。
- [ ] 流式返回 assistant reply。
- [ ] 保存 assistant 完整回复。
- [ ] 小程序聊天页接入真实流式。
- [ ] 实现基础失败提示。

验收：

- [ ] 用户能向任一角色发送文本。
- [ ] AI 能流式回复。
- [ ] 数据库可查到用户消息和 AI 完整回复。
- [ ] 连续 20 轮基础对话不崩溃。

### Phase 3：历史、记忆和羁绊

目标：让聊天变成可持续体验。

To Do：

- [ ] 会话列表 API。
- [ ] 会话消息分页 API。
- [ ] 对话列表页接入真实数据。
- [ ] 聊天页恢复历史消息。
- [ ] 记忆抽取和写入。
- [ ] 记忆检索和 Prompt 注入。
- [ ] 羁绊经验和等级。
- [ ] mood 解析、保存和展示。

验收：

- [ ] 退出再进可以恢复历史会话。
- [ ] 记忆页展示真实记忆。
- [ ] 聊天后羁绊值发生变化。
- [ ] AI 回复 mood 可展示。

### Phase 4：点数、模型档位和支付

目标：打通商业化和计费闭环。

To Do：

- [ ] 模型档位 API。
- [ ] 模型档位后端映射。
- [ ] 点数余额 API。
- [ ] 模型调用前余额校验。
- [ ] 模型调用后扣点和流水。
- [ ] 额度包 API。
- [ ] 下单 API。
- [ ] 预支付 API。
- [ ] 接入真实支付 provider。
- [ ] 支付回调验签。
- [ ] 幂等入账。

验收：

- [ ] 不同模型档位消耗不同点数。
- [ ] 点数不足时不会调用模型。
- [ ] 用户可购买额度包。
- [ ] 支付成功后点数到账。
- [ ] 重复回调不会重复入账。

### Phase 5：admin 与审核

目标：满足 V1 内部运营和验收要求。

To Do：

- [ ] admin 页面壳。
- [ ] 会话和消息查看。
- [ ] 异常标记和备注。
- [ ] 订单、支付记录、余额流水查看。
- [ ] 额度包配置。
- [ ] 模型调用日志。
- [ ] blocked keywords 管理或初始配置。
- [ ] 内容安全命中记录。

验收：

- [ ] admin 可查看会话和消息。
- [ ] admin 可标记异常。
- [ ] admin 可查看订单、支付、流水。
- [ ] admin 可配置 3 个额度包。
- [ ] admin 可查看模型调用日志。

### Phase 6：V1 验收与真机验证

目标：从“功能可跑”推进到“可验收演示”。

To Do：

- [ ] 微信开发者工具完整编译无错误。
- [ ] 真机登录验证。
- [ ] 真机 HTTP Streaming POC。
- [ ] 真机支付流程验证。
- [ ] 分享图保存到相册验证。
- [ ] 敏感词拦截验证。
- [ ] 长对话性能验证。
- [ ] 生产环境 Docker Compose 验证。

验收：

- [ ] PRD 第 8 节整体通过标准逐项通过。
- [ ] 技术 SPEC 第 9 节 API 范围完成。
- [ ] 支付、钱包、模型调用日志可审计。
- [ ] 关键错误路径有用户可理解提示。

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
