# 部署手册

本文记录服务器部署所需的最小闭环：服务器从腾讯云 CCR 拉取 Postgres、API、API tools、FastClaw Go 后端和 Caddy 镜像，由 Docker Compose 启动服务；小程序构建时把真实 HTTPS API 域名写入 `API_BASE_URL`。

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
- `FASTCLAW_API_KEY`, `FASTCLAW_AGENT_ID`: API 调 FastClaw 使用。
- `PAYMENT_PROVIDER` 和支付服务商参数。
- `ADMIN_USER_IDS`, `ADMIN_BASIC_AUTH_USER`, `ADMIN_BASIC_AUTH_PASSWORD`。

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

`/api/health` 只表示 API 进程存活。`/api/ready` 当前检查 FastClaw 配置和 FastClaw `/readyz`，后续还应补数据库连接和关键生产配置完整性检查。

## 5. 小程序生产构建

```bash
rtk API_BASE_URL="https://api.your-domain.com" pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

构建前确认 `API_BASE_URL` 是真实 HTTPS API 域名，并且已加入微信 request 合法域名。构建后必须运行 `verify:weapp`，让产物扫描继续挡住占位 API 主机和 localhost。

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

当前部署只使用 FastClaw Go 后端能力。`fastclaw/Dockerfile.go` 不执行 Web UI 构建；它只放入最小嵌入页面以满足 Go `embed` 编译约束。FastClaw API key、agent 和模型 provider 仍需要在真实环境中完成初始化和联调。
