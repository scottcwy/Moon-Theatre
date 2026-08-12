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

- `POSTGRES_IMAGE`, `API_IMAGE`, `API_TOOLS_IMAGE`, `FASTCLAW_IMAGE`, `CADDY_IMAGE`: 服务器拉取的生产镜像，指向 `ccr.ccs.tencentyun.com/juben-sha/*`。postgres / caddy 保持官方镜像 tag（`postgres:16-alpine` / `caddy:2-alpine`）；api / api-tools / fastclaw 三个业务镜像 tag 由发布负责人按 `YYYYMMDD-<git 短哈希 7 位>` 构建推送后填写（模板为 `RELEASE_TAG` 占位），禁止 `-dirty`、禁止沿用 07-06 快照；构建推送命令见第 3 节。
- `CADDY_API_SITE_ADDRESS`: API 域名，不带协议。
- `POSTGRES_PASSWORD`: Postgres 密码。
- `DATABASE_URL`: API 使用的数据库连接串，密码必须和 `POSTGRES_PASSWORD` 一致。
- `JWT_SECRET`: 长随机字符串。
- `WECHAT_APP_ID`, `WECHAT_APP_SECRET`: 小程序登录使用。
- `FASTCLAW_API_KEY`, `FASTCLAW_AGENT_ID`: API 调 FastClaw 使用。`FASTCLAW_AGENT_ID` 必须指向专用业务聊天 Agent，且 `FASTCLAW_API_KEY` 必须有访问该 Agent 的权限。对话生成仅支持 DeepSeek agent（`model = siliconflow/deepseek-ai/DeepSeek-V4-Flash`）；Qwen agent 已停用，不配置降级（Spec 5）。该 Agent 的 `thinking` 必须为 `"off"`（模型级思考关闭，`2026-08-12-fastclaw-disable-model-thinking` Spec），缺失或非 off 时 `/api/ready` 不通过。
- `FASTCLAW_TIMEOUT_MS`: API 调 FastClaw 的超时，默认 `120000`。
- `FASTCLAW_FALLBACK_ENABLED`: 必须保持 `false`（Spec 5：Qwen 停用，不配置降级）。
- `CHAT_EFFECTS_ASYNC_ENABLED`: 聊天 effects 异步开关，默认 `false`。设为 `true` 后，记忆、羁绊、成就/称号后台执行，聊天 `done` 只同步保证核心字段。
- `PAYMENT_PROVIDER` 和支付服务商参数。
- `ADMIN_USER_IDS`, `ADMIN_BASIC_AUTH_USER`, `ADMIN_BASIC_AUTH_PASSWORD`。
- `TEST_USER_INITIAL_POINTS`: 测试版体验赠点。正式版保持 `0`；只发测试版时可临时设为 `1000`，每个微信用户首次成功登录后按用户维度幂等入账一次。

不要把真实 `.env` 提交到仓库。

## 3. 镜像构建、推送和启动

服务器部署前先登录腾讯云 CCR：

```bash
rtk docker login ccr.ccs.tencentyun.com --username=<腾讯云账号 ID>
```

本机为 arm64（`uname -m`），服务器为 amd64，业务镜像构建必须显式指定 `--platform linux/amd64`。当前无 CI，由发布负责人按 `YYYYMMDD-<git 短哈希 7 位>` 命名 tag 手工构建推送（禁止 `-dirty`、禁止沿用 07-06 快照；与 `fastclaw/.github/workflows/docker.yml` 同范式，buildx 一步构建+推送）：

```bash
docker buildx build --platform linux/amd64 --push \
  -t ccr.ccs.tencentyun.com/juben-sha/api:<tag> -f apps/api/Dockerfile .
docker buildx build --platform linux/amd64 --push \
  -t ccr.ccs.tencentyun.com/juben-sha/api-tools:<tag> -f apps/api/Dockerfile.tools .
docker buildx build --platform linux/amd64 --push \
  -t ccr.ccs.tencentyun.com/juben-sha/fastclaw:<tag> -f fastclaw/Dockerfile.minimal fastclaw/
```

等价替代：`docker build --platform linux/amd64 ... && docker push ...`（需本机 buildx/qemu，Docker Desktop 自带）。

postgres / caddy 使用官方镜像 tag，不构建推送：

```bash
POSTGRES_IMAGE=ccr.ccs.tencentyun.com/juben-sha/postgres:16-alpine
CADDY_IMAGE=ccr.ccs.tencentyun.com/juben-sha/caddy:2-alpine
```

> 历史遗留：CCR 上已推送的 07-06 快照（`api:20260706-58cf7ce-deployfix`、`api-tools:20260706-58cf7ce-deployfix`、`fastclaw:20260706-58cf7ce-dirty`）**禁止继续使用**。`.env.example` 模板业务镜像 tag 已改为 `RELEASE_TAG` 占位，发布时由负责人填写真实 tag；未填真实 tag 时 `docker compose pull` 会失败，这是有意为之。

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

`/api/health` 只表示 API 进程存活。`/api/ready` 检查 API 进程、Postgres 连通（`select 1`，5 秒超时）、FastClaw 配置与 `/readyz`，以及 `FASTCLAW_AGENT_ID` 对应 Agent 的 runtime spec；任一检查失败返回 `503` 且 `status=not_ready`。业务聊天 Agent 若超过 `maxTokens=768`、`maxToolIterations` 不等于 `0` 或 `thinking` 不等于 `"off"`，readiness 会返回 `503`。

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
- `apps/miniapp/project.config.json` 的 `urlCheck: false` 只影响微信开发者工具内的本地请求校验，不影响发布包（体验版/正式版仍必须走合法域名）；如需工具内严格校验，改 `project.private.config.json`（不入库）。`uploadWithSourceMap: false` 保证上传包不带 sourcemap。

## 6. 回滚

1. 保留上一个可用镜像 tag。
2. 把 `.env` 中的 `API_IMAGE`、`API_TOOLS_IMAGE` 和 `FASTCLAW_IMAGE` 改回上一个可用 tag：

```bash
rtk docker compose pull api api-migrate api-seed fastclaw
rtk docker compose up -d api fastclaw caddy
```

3. 数据库迁移不做自动回滚。涉及破坏性迁移前必须先备份 Postgres（见第 8 节）。
4. 回滚后重新执行健康检查和小程序关键链路联调。

## 7. FastClaw 说明

当前部署只使用 FastClaw Go 后端能力。`fastclaw/Dockerfile.minimal` 不执行 Web UI 构建；它使用仓库内已提交的最小嵌入页（`fastclaw/internal/setup/web/index.html`）以满足 Go `embed` 编译约束（全量 Web UI 构建走 `fastclaw/Dockerfile` / `make build-web`，产物同样落到 `internal/setup/web/`）。FastClaw API key、agent 和模型 provider 仍需要在真实环境中完成初始化和联调。业务 API 调用 FastClaw 的 OpenAI-compatible `/v1/chat/completions` 时，角色上下文通过 `system` message 作为 request-scoped system prompt 传入。

业务聊天 Agent 需要按 V1 速度目标配置：`model = siliconflow/deepseek-ai/DeepSeek-V4-Flash`、`maxTokens <= 768`、`maxToolIterations = 0`、`thinking = "off"`（模型级思考关闭，向 SiliconFlow 下发 `enable_thinking: false`，降低 TTFT/整轮延迟）。对话生成仅支持 DeepSeek agent：Qwen agent 必须停用/删除，`FASTCLAW_FALLBACK_ENABLED` 保持 `false`（不配置降级）。API 侧 `FASTCLAW_TIMEOUT_MS` 默认 120 秒，业务 prompt 默认约束回复 80-180 个中文字符，必要时最多 300 个中文字符。`/api/ready` 会通过 FastClaw `GET /v1/agents/{FASTCLAW_AGENT_ID}/runtime-spec` 验证这些运行参数；超过 `maxTokens=768`、启用任何工具迭代或 `thinking` 不等于 `"off"`（缺失/非 off）都不能通过 readiness。若开启 `CHAT_EFFECTS_ASYNC_ENABLED=true`，出现异常时可直接改回 `false` 回到同步 effects 路径。

**数据持久化**：FastClaw 已挂载命名卷 `fastclaw-data`（容器内 `/data/.fastclaw`，sqlite 数据落该目录）。服务器旧容器若已有匿名卷数据，切换前必须先备份：`docker inspect juben-sha-fastclaw` 找到匿名卷 `Source` 路径，用 `docker cp` 或临时挂载导出备份后再切换命名卷；本地测试阶段无业务数据可直接切换。匿名卷在 `docker compose down -v` 时会被删除，切换命名卷后旧匿名卷数据不再挂载（未删除但不可见）。

## 8. 备份与恢复

### 8.1 备份

仓库提供 `scripts/backup-postgres.mjs`：读取根 `.env` 的 `POSTGRES_PASSWORD`，通过 `docker compose exec -T` 在 postgres 容器内执行 `pg_dump -Fc`，输出到 `backups/juben-sha-<UTC时间戳>.dump`。`backups/` 已加入 `.gitignore` 与 `.dockerignore`，备份文件不会进 Docker 构建上下文，也不会被提交。

```bash
rtk node scripts/backup-postgres.mjs
```

前提：postgres 容器在运行（`rtk docker compose up -d postgres`），且根 `.env` 已配置 `POSTGRES_PASSWORD`。

建议：

- 每日 03:00 定时备份（服务器时区 Asia/Shanghai），例如 cron：

  ```cron
  0 3 * * * cd /opt/juben-sha && /usr/bin/node scripts/backup-postgres.mjs >> backups/backup.log 2>&1
  ```

- 保留策略：本地保留 14 天，超期清理（例如 `find backups -name '*.dump' -mtime +14 -delete`）。
- 上线前、破坏性迁移前必须强制备份。

### 8.2 恢复

宿主机无需安装 libpq：直接用 postgres 容器内自带的 `pg_restore` 列档或还原。

列档检查：

```bash
rtk docker compose exec -T postgres pg_restore --list < backups/juben-sha-<时间戳>.dump
```

还原（覆盖式，谨慎执行）：

```bash
rtk docker compose exec -T postgres pg_restore -U postgres -d juben_sha --clean --if-exists < backups/juben-sha-<时间戳>.dump
```

恢复后重启 api 并执行第 4 节健康检查。

## 9. v1.1 上线检查清单

> **上线阻断：真实支付服务商联调未完成。`PAYMENT_PROVIDER` 必须为 `aggregate` 且四参数（`PAYMENT_MERCHANT_ID` / `PAYMENT_APP_ID` / `PAYMENT_SECRET` / `PAYMENT_NOTIFY_URL`）齐全方可上线。**

v1.1（聊天体验：剧本/自由模式、剧本目录、记忆作用域、回访留言）上线时按序执行。镜像 tag **由发布负责人填写**，仓库不预设具体值。

1. 构建并推送 `api` / `api-tools` / `fastclaw` 新镜像（`linux/amd64`）：按第 3 节 buildx 命令产出三个新镜像并推送（tag 由发布负责人填写，例如日期 + 提交短哈希，但不得沿用 07-06 快照 tag）。
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

> 注（fastclaw-disable-model-thinking 发布顺序）：FastClaw 新镜像（含 `thinking=off` 请求参数）必须先于 apps/api（含新 ready 校验）发布，并确认 agent 配置 `thinking="off"` 已生效（`GET /v1/agents/{id}/runtime-spec` 返回 `thinking=off`）；回滚顺序相反（先回 apps/api 再回 FastClaw 镜像与配置）。旧 FastClaw（runtime-spec 无 `thinking`）遇新 ready 校验会失败，属安全失败；新 FastClaw + 旧 apps/api 直接通过，属可接受（旧版无此要求），非回归。

## 10. 附录 A：微信后台上线清单（非仓库操作，人工执行）

1. request 合法域名 `https://api.offergo.xz.cn` 已配置（`apps/miniapp/config/hosts.json` 的 `prod` 已入库）。
2. 用户隐私保护指引：收集 openid、聊天内容、头像昵称等，须在微信公众平台提交。
3. 小程序类目与资质（AI 聊天 / 角色扮演类目要求以平台审核为准）。
4. UGC 内容安全：项目已有本地 blocked-keywords + 输出过滤；确认是否需接 `msgSecCheck` 或用户协议兜底。
5. 体验版真机验证：`urlCheck: false` 仅开发者工具生效，体验版/正式版必须走合法域名。
6. 主包体积：当前 <2MB（历史提交 `bf01332`），无自动断言，上线前在开发者工具人工核对；如需自动护栏另开条目。
7. `TEST_USER_INITIAL_POINTS`：测试版可临时赠点，正式版必须为 `0`。
