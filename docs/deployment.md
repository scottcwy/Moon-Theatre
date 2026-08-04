# 部署手册

本文记录服务器部署所需的最小闭环：服务器从腾讯云 CCR 拉取 Postgres、API、API tools、FastClaw Go 后端和 Caddy 镜像，由 Docker Compose 启动服务；小程序 API 域名统一配置在 `apps/miniapp/config/hosts.json`，生产构建自动读取。

## 1. 域名和服务器前置条件

1. 准备一个 API 子域名，例如 `api.your-domain.com`。
2. 在 DNS 服务商添加 `A` 记录，指向服务器公网 IP。
3. 服务器安全组或防火墙开放 `80` 和 `443`。
4. 微信公众平台后台把 `https://api.your-domain.com` 加入 request 合法域名。
5. 等 DNS 生效后再启动 Caddy，Caddy 会自动申请 HTTPS 证书。

## 2. 环境变量

从模板创建服务器上的根 `.env`：

```bash
rtk cp .env.example .env
```

必须替换的值：

- `POSTGRES_IMAGE`, `API_IMAGE`, `API_TOOLS_IMAGE`, `FASTCLAW_IMAGE`, `CADDY_IMAGE`: 服务器拉取的生产镜像。当前模板指向 `ccr.ccs.tencentyun.com/juben-sha/*`。
- `CADDY_API_SITE_ADDRESS`: API 域名，不带协议。
- `POSTGRES_PASSWORD`: Postgres 密码。
- `DATABASE_URL`: API 使用的数据库连接串，密码必须和 `POSTGRES_PASSWORD` 一致。
- `JWT_SECRET`: 长随机字符串。
- `WECHAT_APP_ID`, `WECHAT_APP_SECRET`: 小程序登录使用。
- `FASTCLAW_API_KEY`, `FASTCLAW_AGENT_ID`: API 调 FastClaw 使用。`FASTCLAW_AGENT_ID` 必须指向专用业务聊天 Agent，且 `FASTCLAW_API_KEY` 必须有访问该 Agent 的权限。
- `FASTCLAW_TIMEOUT_MS`: API 调 FastClaw 的超时，默认 `120000`。
- `CHAT_EFFECTS_ASYNC_ENABLED`: 聊天 effects 异步开关，默认 `false`。设为 `true` 后，记忆、羁绊、成就/称号后台执行，聊天 `done` 只同步保证核心字段。
- `PAYMENT_PROVIDER` 和支付服务商参数。
- `ADMIN_USER_IDS`, `ADMIN_BASIC_AUTH_USER`, `ADMIN_BASIC_AUTH_PASSWORD`。
- `TEST_USER_INITIAL_POINTS`: 测试版体验赠点。正式版保持 `0`；只发测试版时可临时设为 `1000`，每个微信用户首次成功登录后按用户维度幂等入账一次。

不要把真实 `.env` 提交到仓库。

## 3. 镜像和启动

服务器部署前先登录腾讯云 CCR：

```bash
rtk docker login ccr.ccs.tencentyun.com --username=<腾讯云账号 ID>
```

当前已推送的 `linux/amd64` 镜像：

```bash
POSTGRES_IMAGE=ccr.ccs.tencentyun.com/juben-sha/postgres:16-alpine
API_IMAGE=ccr.ccs.tencentyun.com/juben-sha/api:20260706-58cf7ce-deployfix
API_TOOLS_IMAGE=ccr.ccs.tencentyun.com/juben-sha/api-tools:20260706-58cf7ce-deployfix
FASTCLAW_IMAGE=ccr.ccs.tencentyun.com/juben-sha/fastclaw:20260706-58cf7ce-dirty
CADDY_IMAGE=ccr.ccs.tencentyun.com/juben-sha/caddy:2-alpine
```

服务器只拉镜像，不执行业务镜像构建：

```bash
rtk docker compose pull
rtk docker compose up -d postgres fastclaw
rtk docker compose --profile tools run --rm api-migrate
rtk docker compose --profile tools run --rm api-seed
rtk docker compose up -d api caddy
```

`api-migrate` 和 `api-seed` 使用 `API_TOOLS_IMAGE`，避免服务器为迁移/种子任务拉 Docker Hub 基础镜像或现场构建。

## 4. 健康检查

```bash
rtk curl -fsS https://api.your-domain.com/api/health
rtk curl -fsS https://api.your-domain.com/api/ready
```

`/api/health` 只表示 API 进程存活。`/api/ready` 当前检查 FastClaw 配置、FastClaw `/readyz`，以及 `FASTCLAW_AGENT_ID` 对应 Agent 的 runtime spec。业务聊天 Agent 若超过 `maxTokens=768` 或 `maxToolIterations` 不等于 `0`，readiness 会返回 `503`。后续还应补数据库连接和关键生产配置完整性检查。

## 5. 小程序生产构建

API 域名统一配置在 `apps/miniapp/config/hosts.json`（`dev` 本地调试 / `prod` 生产域名），生产构建自动读取 `prod`，无需手动传参：

```bash
rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

- 构建前确认 `hosts.json` 的 `prod` 是真实 HTTPS API 域名，并且已加入微信 request 合法域名。
- `API_BASE_URL` 环境变量仍可临时覆盖 `hosts.json`（供 CI 或紧急切换使用），优先级高于配置文件。
- 构建后必须运行 `verify:weapp`，让产物扫描继续挡住占位 API 主机和 localhost。

## 6. 回滚

1. 保留上一个可用镜像 tag。
2. 把 `.env` 中的 `API_IMAGE`、`API_TOOLS_IMAGE` 和 `FASTCLAW_IMAGE` 改回上一个可用 tag：

```bash
rtk docker compose pull api api-migrate api-seed fastclaw
rtk docker compose up -d api fastclaw caddy
```

3. 数据库迁移不做自动回滚。涉及破坏性迁移前必须先备份 Postgres volume 或线上数据库。
4. 回滚后重新执行健康检查和小程序关键链路联调。

## 7. FastClaw 说明

当前部署只使用 FastClaw Go 后端能力。`fastclaw/Dockerfile.go` 不执行 Web UI 构建；它只放入最小嵌入页面以满足 Go `embed` 编译约束。FastClaw API key、agent 和模型 provider 仍需要在真实环境中完成初始化和联调。业务 API 调用 FastClaw 的 OpenAI-compatible `/v1/chat/completions` 时，角色上下文通过 `system` message 作为 request-scoped system prompt 传入。

业务聊天 Agent 需要按 V1 速度目标配置：`model = siliconflow/deepseek-ai/DeepSeek-V4-Flash`、`maxTokens <= 768`、`maxToolIterations = 0`。API 侧 `FASTCLAW_TIMEOUT_MS` 默认 120 秒，业务 prompt 默认约束回复 80-180 个中文字符，必要时最多 300 个中文字符。`/api/ready` 会通过 FastClaw `GET /v1/agents/{FASTCLAW_AGENT_ID}/runtime-spec` 验证这些运行参数；超过 `maxTokens=768` 或启用任何工具迭代都不能通过 readiness。若开启 `CHAT_EFFECTS_ASYNC_ENABLED=true`，出现异常时可直接改回 `false` 回到同步 effects 路径。
