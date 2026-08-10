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

域名统一配置在 `apps/miniapp/config/hosts.json`（`dev` 本地调试 / `lan` 真机预览 / `prod` 生产域名），当前生产域名：`https://api.offergo.xz.cn`。

推荐入口：

```bash
rtk pnpm build:miniapp:prod
```

该命令读取 `hosts.json` 的 `prod` 注入构建，并在构建后自动运行 `verify:weapp` 扫描产物。

- 开发环境用 `rtk pnpm dev:miniapp`（默认 `http://127.0.0.1:3000`，配合微信开发者工具"不校验合法域名"）。
- 真机预览用 `rtk pnpm dev:miniapp:lan`（先在本机 `hosts.json` 的 `lan` 填入电脑局域网 IP）。
- 等价旧方式：`rtk API_BASE_URL="https://api.offergo.xz.cn" pnpm --filter @juben-sha/miniapp build:weapp` + `verify:weapp`；`API_BASE_URL` 环境变量仍可临时覆盖 `hosts.json`（供 CI 或紧急切换使用），优先级高于配置文件。
- 生产域名变更时，只改 `hosts.json` 的 `prod` 后重新构建上传即可；后端镜像域名由服务器 `.env` 的 `CADDY_API_SITE_ADDRESS` 控制，与此无关。
- 构建前确认域名已加入微信 request 合法域名；`verify:weapp` 会继续挡住占位 API 主机和 localhost。

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

当前部署只使用 FastClaw Go 后端能力。`fastclaw/Dockerfile.minimal` 不执行 Web UI 构建；它使用仓库内已提交的最小嵌入页（`fastclaw/internal/setup/web/index.html`）以满足 Go `embed` 编译约束（全量 Web UI 构建走 `fastclaw/Dockerfile` / `make build-web`，产物同样落到 `internal/setup/web/`）。FastClaw API key、agent 和模型 provider 仍需要在真实环境中完成初始化和联调。业务 API 调用 FastClaw 的 OpenAI-compatible `/v1/chat/completions` 时，角色上下文通过 `system` message 作为 request-scoped system prompt 传入。

业务聊天 Agent 需要按 V1 速度目标配置：`model = siliconflow/deepseek-ai/DeepSeek-V4-Flash`、`maxTokens <= 768`、`maxToolIterations = 0`。API 侧 `FASTCLAW_TIMEOUT_MS` 默认 120 秒，业务 prompt 默认约束回复 80-180 个中文字符，必要时最多 300 个中文字符。`/api/ready` 会通过 FastClaw `GET /v1/agents/{FASTCLAW_AGENT_ID}/runtime-spec` 验证这些运行参数；超过 `maxTokens=768` 或启用任何工具迭代都不能通过 readiness。若开启 `CHAT_EFFECTS_ASYNC_ENABLED=true`，出现异常时可直接改回 `false` 回到同步 effects 路径。

## 8. v1.1 上线检查清单

v1.1（聊天体验：剧本/自由模式、剧本目录、记忆作用域、回访留言）上线时按序执行。镜像 tag **由发布负责人填写**，仓库不预设具体值。

1. 构建并推送 `api` / `api-tools` / `fastclaw` 新镜像（`linux/amd64`）：登录腾讯云 CCR 后，按仓库构建流程产出三个新镜像并推送（tag 由发布负责人填写，例如日期 + 提交短哈希，但不得沿用 07-06 快照 tag）。
2. 在服务器根 `.env` 更新 `API_IMAGE` / `API_TOOLS_IMAGE` / `FASTCLAW_IMAGE` 为步骤 1 的新 tag。
3. 拉取并启动：

```bash
rtk docker compose pull
rtk docker compose up -d
```

4. 确认数据库迁移 `0004`–`0009` 已应用（`api-migrate` 执行后核对迁移记录；`0007` / `0008` / `0009` 幂等可重放）。
5. 小程序生产构建 + 产物校验：

```bash
rtk pnpm build:miniapp:prod
```

   `build:miniapp:prod` 内部执行 `build:weapp:prod` 并自动运行 `verify:weapp`；等价旧方式为 `rtk pnpm --filter @juben-sha/miniapp build:weapp:prod`（同样含 verify）。
6. 上线后执行第 4 节健康检查（`/api/health`、`/api/ready`）与小程序关键链路联调。

> 注：v1.1 对应 `origin/main` 的迁移 `0004`–`0009`；当前已推送镜像仍为 07-06 快照（见第 3 节）。`docs/版本说明-dev.md` 只引用本节与第 3 节，不复制镜像信息。
