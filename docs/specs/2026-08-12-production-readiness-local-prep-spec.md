# 生产就绪本地准备 SPEC（小程序测试阶段）

日期：2026-08-12
状态：draft（rev 2，已吸收审查结论；待评审冻结）
修订号：2
适用版本：小程序测试阶段（本地 `main`，HEAD `e791f6e`）
变更标识：production-readiness-local-prep

修订记录：

- rev 1（2026-08-12）：初稿，基线 HEAD `629507b`。
- rev 2（2026-08-12）：吸收独立审查结论——补 `ready/route.test.ts` 与 DB mock 策略（P1-1）、构建命令加 `--platform linux/amd64`（P1-2）、备份验证改容器内 `pg_restore`（P2-1）、ready DB 检查加 5s 超时（P2-2）、`backups/` 进 `.dockerignore`（P2-3）、基线 HEAD 更新（P3-1）、TZ 生效口径与 tzdata（P3-2）、主包体积表述修正（P3-3）、override 文件说明（P3-4）、TZ/healthcheck 锚点与 depends_on 语义（P3-5）、资源上限去条件化（P3-6）。

## 1. 文档目的与冻结边界

本文档把生产审计收敛出的缺口转化为**可在本地执行的最小生产准备改动集**，统一配置口径、文件改动、验证方式与回撤方式。当前阶段为小程序测试阶段，CI/CD 明确今天不配置；真实支付联调不在本地执行。

本文档冻结：

- 镜像 tag 口径（禁止 07-06 快照与 `-dirty`，改为发布负责人显式填写）；
- FastClaw 数据持久化（命名卷）；
- Postgres 备份脚本与流程；
- `/api/ready` 数据库连通检查（含测试与超时）；
- Compose 运维参数（healthcheck / 日志轮转 / 资源上限 / TZ）；
- Caddy 访问日志与基础安全响应头；
- Next.js 响应头与遥测开关；
- 小程序上传 sourcemap 关闭；
- `.env.example` / `scripts/deploy-config.test.mjs` / `.dockerignore` / `docs/deployment.md` 口径同步；
- 微信后台非仓库操作上线清单（附录，人工执行）。

本文档不冻结（后置项，见 §9）：CI/CD（GitHub Actions）、真实支付服务商联调、限流防刷、监控告警、结构化日志与请求 ID、回访调度器多副本、DB 连接池显式参数、基础镜像 pin digest、小程序体积自动断言。

冲突口径：本 spec 冻结后，`docs/deployment.md` 与 `.env.example` 中与本文档冲突的旧口径以本文档为准；实施完成后须反向同步文档，禁止愿景式文档。

## 2. 术语

- **生产基线**：服务器实际运行的镜像与配置（当前为 07-06 快照，见 `docs/版本说明-dev.md` §5）。
- **RELEASE_TAG**：发布负责人构建推送后填写的镜像 tag，规范 `YYYYMMDD-<git短哈希7位>`；禁止 `-dirty`。
- **匿名卷**：Dockerfile `VOLUME` 未映射命名卷时 Docker 自动创建的卷，`docker compose down -v` 会删除，且不在 `docker compose` 配置中显式可见。
- **readiness**：`/api/ready`，当前只检查 FastClaw；本 spec 增加 DB 检查（带 5s 超时）与对应单测。

## 3. 问题清单与目标

| 编号 | 问题 | 现状证据 | 目标 |
|---|---|---|---|
| P0-1 | 镜像 tag 仍钉 07-06 快照且含 `-dirty` | `.env.example`、`scripts/deploy-config.test.mjs` 锁死 `20260706-58cf7ce-deployfix` / `-dirty`；`docs/deployment.md` §8 写明"不得沿用 07-06 tag" | 模板改为 `RELEASE_TAG` 占位；测试断言禁止 07-06 与 `-dirty`；文档给出手工构建推送命令（显式 `--platform linux/amd64`） |
| P0-2 | FastClaw 数据无持久化卷 | 根 `docker-compose.yml` fastclaw 服务无 `volumes`，`FASTCLAW_STORAGE_DSN` 默认空 → sqlite 落匿名卷（`fastclaw/internal/store/factory.go` 空 DSN 落 `$FASTCLAW_HOME/fastclaw.db`） | fastclaw 挂载命名卷 `fastclaw-data:/data/.fastclaw`；文档写明服务器旧数据迁移注意 |
| P0-3 | Postgres 无备份机制 | `docs/deployment.md` 仅一句"手动备份"；无脚本、无恢复演练 | 新增 `scripts/backup-postgres.mjs`；`backups/` 进 `.gitignore` 与 `.dockerignore`；文档给出备份/恢复/定时建议 |
| P0-4 | 支付仍未接真实服务商 | 生产校验强制 `PAYMENT_PROVIDER != mock`；`aggregate` 未联调 | 本 spec 不改代码；标注为上线阻断项，写入文档与 `.env.example` 注释 |
| P1-1 | `/api/ready` 不查数据库，且加检查会破坏既有单测 | `apps/api/src/app/api/ready/route.ts` 只查 FastClaw；`route.test.ts` 末用例断言 200 且未 stub DB（DB 不可达会变 503）；`docs/deployment.md` 自认待补 | ready 增加 `db` 检查（`select 1`，5s 超时）；`route.test.ts` 增加 DB mock 与失败用例 |
| P1-2 | 容器无健康检查/日志轮转/资源上限/TZ | compose 仅 postgres 有 healthcheck；api/fastclaw/caddy 均无 | api/fastclaw 加 healthcheck；全部服务加日志轮转与 `TZ`（tools 服务经锚点继承）；资源上限用 `mem_limit`/`cpus`（全版本生效，去条件化） |
| P1-3 | Caddy 无访问日志、无安全头 | `infra/caddy/Caddyfile` 仅 `encode gzip` + `reverse_proxy` | 加 `log` 与 `X-Content-Type-Options` / `Referrer-Policy` / `X-Frame-Options` / `-Server` |
| P1-4 | Next.js 暴露 `X-Powered-By`、遥测未关 | `apps/api/next.config.ts` 无 `poweredByHeader`；`Dockerfile` runner 无遥测开关 | `poweredByHeader: false`；runner 加 `NEXT_TELEMETRY_DISABLED=1` |
| P1-5 | 小程序上传带 sourcemap | `apps/miniapp/project.config.json` `uploadWithSourceMap: true` | 改为 `false`；`urlCheck: false` 保留并说明（仅开发者工具行为） |
| P1-6 | `.env.example` 与测试/文档口径不一致 | tag 三处口径打架；备份/卷/健康检查无对应断言 | 统一：占位 tag + 测试断言 + `docs/deployment.md` 同步 |

## 4. 配置方案

### 4.1 P0-1 镜像 tag 口径

- 现状证据：见 §3。
- 目标口径：业务镜像（api / api-tools / fastclaw）由发布负责人构建推送后显式填写 `YYYYMMDD-<sha7>`；postgres / caddy 保持官方镜像 tag。
- 最小改法：
  1. `.env.example` 三个业务镜像改为：
     ```
     API_IMAGE=ccr.ccs.tencentyun.com/juben-sha/api:RELEASE_TAG
     API_TOOLS_IMAGE=ccr.ccs.tencentyun.com/juben-sha/api-tools:RELEASE_TAG
     FASTCLAW_IMAGE=ccr.ccs.tencentyun.com/juben-sha/fastclaw:RELEASE_TAG
     ```
     并在镜像节加注释：发布负责人按 `YYYYMMDD-<sha7>` 构建推送后填写，禁止 `-dirty`、禁止沿用 07-06 快照。
  2. `scripts/deploy-config.test.mjs` 的 `env example points server deployment at Tencent CCR images` 用例改为断言：
     - 三个业务镜像仍指向 `ccr.ccs.tencentyun.com/juben-sha/*`；
     - `doesNotMatch(/20260706/)`、`doesNotMatch(/-dirty/)`；
     - tag 为 `RELEASE_TAG` 或匹配 `^\d{8}-[0-9a-f]{7}$`；
     - postgres / caddy 断言保持。
  3. `docs/deployment.md` §2/§3 补手工构建推送命令（无 CI 阶段）。**本机为 arm64（`uname -m`），服务器为 amd64，构建必须显式指定平台**，用 buildx 一步构建+推送（与 `fastclaw/.github/workflows/docker.yml` 同范式）：
     ```
     docker buildx build --platform linux/amd64 --push \
       -t ccr.ccs.tencentyun.com/juben-sha/api:<tag> -f apps/api/Dockerfile .
     docker buildx build --platform linux/amd64 --push \
       -t ccr.ccs.tencentyun.com/juben-sha/api-tools:<tag> -f apps/api/Dockerfile.tools .
     docker buildx build --platform linux/amd64 --push \
       -t ccr.ccs.tencentyun.com/juben-sha/fastclaw:<tag> -f fastclaw/Dockerfile.minimal fastclaw/
     ```
     等价替代：`docker build --platform linux/amd64 ... && docker push ...`（需本机 buildx/qemu，Docker Desktop 自带）。
- 验收：`test:deploy-config` 通过；`grep -n "20260706\|-dirty" .env.example` 无命中；未填 tag 时 `docker compose pull` 失败（有意为之）。
- 风险/回撤：模板不可直接 `compose pull` 直到填 tag——这是本项目的（旧镜像不该再用）；回撤即恢复旧 tag 与旧断言。

### 4.2 P0-2 FastClaw 持久化

- 最小改法：`docker-compose.yml` fastclaw 服务加
  ```yaml
  volumes:
    - fastclaw-data:/data/.fastclaw
  ```
  根 `volumes:` 节加 `fastclaw-data:`。
- `docs/deployment.md` §7 补迁移注意：服务器旧容器若已有匿名卷数据，先 `docker inspect juben-sha-fastclaw` 找到卷 `Source` 路径，`docker cp` 或临时挂载导出备份后再切换命名卷；本地测试阶段无业务数据可直接切换。
- 验收：`docker compose config` 输出含 `fastclaw-data`；`docker compose up -d fastclaw` 后 `docker volume ls` 可见。
- 风险/回撤：切换卷后旧匿名卷数据不再挂载（未删除但"不可见"），须先备份；回撤即删除 volumes 行。

### 4.3 P0-3 Postgres 备份

- 最小改法：
  1. 新增 `scripts/backup-postgres.mjs`：
     - 复用 `scripts/dev.mjs` 已导出的 `parseDotEnv` 读根 `.env` 的 `POSTGRES_PASSWORD`；
     - 自动创建 `backups/` 目录；
     - 执行 `docker compose exec -T -e PGPASSWORD=<pwd> postgres pg_dump -U postgres -d juben_sha -Fc > backups/juben-sha-<UTC时间戳>.dump`；
     - 输出文件路径与大小；子进程非 0 退出即失败退出。
  2. `.gitignore` 加 `backups/`；**`.dockerignore` 同样加 `backups/`**（防止备份文件进 Docker 构建上下文，`apps/api/Dockerfile` builder 阶段有 `COPY . .`）。
  3. `docs/deployment.md` 新增「备份与恢复」章节：备份命令、cron 建议（每日 03:00）、保留策略（如 14 天）、恢复步骤、上线与破坏性迁移前强制备份。
- 验收：本地 postgres 容器运行时 `node scripts/backup-postgres.mjs` 产出 `.dump`；验证命令用**容器内** `pg_restore`（宿主机未装 libpq 工具，见 §6）；`test:deploy-config` 断言 `.gitignore` 与 `.dockerignore` 含 `backups/`。
- 风险/回撤：pg_dump 二进制经 exec 管道仅适用于 Unix 环境（Mac/Linux，服务器为 Linux，无碍）；回撤即删脚本与 ignore 行。

### 4.4 P0-4 支付（上线阻断标注，不改代码）

- `docs/deployment.md` 上线清单顶部加醒目行：**真实支付服务商联调未完成，`PAYMENT_PROVIDER` 必须为 `aggregate` 且四参数（merchant/app/secret/notify）齐全方可上线**；`.env.example` 支付节注释同样标注。
- 验收：文档与 `.env.example` 出现该标注。
- 风险/回撤：无代码改动。

### 4.5 P1-1 `/api/ready` 数据库检查（含测试）

- 最小改法：
  1. `apps/api/src/app/api/ready/route.ts` 增加
     ```ts
     const checks = {
       api: { ok: true },
       db: await checkDatabase(),
       fastclaw: await checkFastClaw(),
     };
     ```
     `checkDatabase()` 用 `await db.execute(sql\`select 1\`)`（`db` 来自 `@/server/db/index.js`），**整体包 5s 超时**（`Promise.race`，与现有 FastClaw 检查 5s 口径一致；postgres.js 默认 `connect_timeout: 30`，不包超时会让 ready 在 DB 抖动时卡 30s）；catch 返回 `{ ok: false, error }`；响应结构 `status/checks/timestamp` 不变，任一 check 失败仍 503。
  2. `apps/api/src/app/api/ready/route.test.ts` 修改：`loadRoute()` 前 `vi.mock('@/server/db/index.js', () => ({ db: { execute: vi.fn() } }))`（DB mock 为默认通过），保证既有 4 个用例不依赖真实 DB；**新增用例「DB 不可达 → 503 且 `db.ok=false`」**（mock `db.execute` reject）。
- 验收：`pnpm --filter @juben-sha/api test` 通过（含 ready 新增用例）；本地起 postgres 时 `/api/ready` 返回 `db.ok=true`；停 postgres（或 mock 失败）时 503 且 `db.ok=false`，且 5s 内返回。
- 风险/回撤：低；DB 不可用时 ready 转 503 是正确语义；若 mock 策略与既有测试范式冲突，以不破坏既有 4 用例为底线；回撤即删除该块与测试改动。

### 4.6 P1-2 Compose 运维参数

- 最小改法（`docker-compose.yml`）：
  1. 顶部加日志锚点：
     ```yaml
     x-logging: &default-logging
       driver: json-file
       options:
         max-size: "10m"
         max-file: "5"
     ```
     每个服务加 `logging: *default-logging`。
  2. api healthcheck（node:20-alpine，`node -e` fetch，start_period 30s / interval 15s / retries 5）。
  3. fastclaw healthcheck（alpine busybox `wget -q -O /dev/null http://127.0.0.1:18953/readyz`）；**api 对 fastclaw 的 `depends_on` 由 `service_started` 升级为 `service_healthy`**（healthcheck 就绪后再启动 api，语义完整）。
  4. `TZ=Asia/Shanghai` 加在 `x-api-environment` 锚点（api 与 api-migrate/api-seed tools 服务自动继承），postgres/fastclaw/caddy 各自 environment 同样加。**生效口径**：fastclaw（alpine 已装 tzdata）与 postgres（官方镜像自带 tzdata）确定生效；api 镜像需在 `apps/api/Dockerfile` base 阶段把 `apk add libc6-compat` 追加 `tzdata`；caddy 以容器内 `date` 实测为准，若镜像缺 tzdata 则不设（该项不阻塞）。
  5. 资源上限：**直接采用 `mem_limit` / `cpus` legacy 字段**（`docker compose up` 全版本生效、无 swarm 依赖），建议 api memory 1g、fastclaw 1g、postgres 1g，cpus 各 1；执行阶段按实测调整。
- 验收：`docker compose config` 通过；`docker compose up -d` 后 `docker inspect` 可见 Health / LogConfig / 资源限制；api 容器内 `date` 输出 Asia/Shanghai。
- 风险/回撤：低；limits 过小会 OOMKill（值在执行阶段按实测调）；回撤即删除对应块。

### 4.7 P1-3 Caddy 日志与安全头

- 最小改法：`infra/caddy/Caddyfile` 改为
  ```
  {$CADDY_API_SITE_ADDRESS} {
      encode gzip
      log
      header {
          X-Content-Type-Options "nosniff"
          Referrer-Policy "no-referrer"
          X-Frame-Options "DENY"
          -Server
      }
      reverse_proxy api:3000
  }
  ```
- 验收：`test:deploy-config` 仍通过（既有断言只查 gzip / reverse_proxy / 环境域名）；`curl -I` 可见新响应头且无 `Server`。
- 风险/回撤：低；`-Server` 对小程序客户端无兼容影响。

### 4.8 P1-4 Next.js 响应头与遥测

- `apps/api/next.config.ts` 加 `poweredByHeader: false`。
- `apps/api/Dockerfile`：base 阶段 `apk add --no-cache libc6-compat tzdata`（P1-2 需要），runner 阶段加 `ENV NEXT_TELEMETRY_DISABLED=1`。
- 验收：`pnpm --filter @juben-sha/api build` 通过；镜像运行时响应无 `X-Powered-By`。
- 风险/回撤：低。

### 4.9 P1-5 小程序 sourcemap

- `apps/miniapp/project.config.json`：`uploadWithSourceMap: false`。
- `urlCheck: false` 保留：它只影响微信开发者工具请求校验，不影响发布包；如需严格，走 `project.private.config.json`（不入库）。
- 验收：`pnpm build:miniapp:prod` 通过（verify 不查此项）；开发者工具上传包不再含 `.map`。
- 风险/回撤：低。

### 4.10 P1-6 文档与测试口径同步

- `docs/deployment.md` 更新：§2/§3 镜像 tag 口径与手工构建推送命令（4.1）、§4 健康检查补 DB（4.5）、新增备份章节（4.3）、§7 FastClaw 卷说明（4.2）、上线清单支付阻断标注（4.4）、小程序测试阶段上线清单（附录 A）。
- `scripts/deploy-config.test.mjs` 追加/更新断言：compose 含 `fastclaw-data` 卷、api/fastclaw 有 healthcheck、日志轮转存在、`.gitignore` 与 `.dockerignore` 含 `backups/`、`.env.example` 无 07-06 / `-dirty`。
- 验收：`test:deploy-config` 全绿；文档与代码现实人工核对一致。

## 5. 文件改动清单

| 文件 | 动作 | 关联项 |
|---|---|---|
| `docker-compose.yml` | 修改 | P0-2、P1-2 |
| `infra/caddy/Caddyfile` | 修改 | P1-3 |
| `apps/api/src/app/api/ready/route.ts` | 修改 | P1-1 |
| `apps/api/src/app/api/ready/route.test.ts` | 修改（DB mock + 失败用例） | P1-1 |
| `apps/api/next.config.ts` | 修改 | P1-4 |
| `apps/api/Dockerfile` | 修改（tzdata + 遥测） | P1-2、P1-4 |
| `apps/miniapp/project.config.json` | 修改 | P1-5 |
| `.env.example` | 修改 | P0-1、P0-4 |
| `scripts/deploy-config.test.mjs` | 修改 | P0-1、P1-6 |
| `scripts/backup-postgres.mjs` | 新增 | P0-3 |
| `.gitignore` | 修改 | P0-3 |
| `.dockerignore` | 修改（`backups/`） | P0-3 |
| `docs/deployment.md` | 修改 | P0-1、P0-3、P0-4、P1-1、P1-5、P1-6、附录 A |

不触碰：业务代码逻辑、`apps/miniapp/src/**`、`packages/**`、已有未提交改动。**本地存在未跟踪 `docker-compose.override.yml`（仅映射 postgres 127.0.0.1:5433:5432），不触碰；本地验证 compose 时其端口拓扑与服务器（无 override）不同，需知悉。**

## 6. 验证矩阵

| 命令 | 预期 |
|---|---|
| `rtk pnpm run test:dev-script` | 6/6 通过 |
| `rtk pnpm run test:deploy-config` | 全量通过（含新断言） |
| `rtk pnpm -r typecheck` | 通过 |
| `rtk pnpm --filter @juben-sha/api test` | 通过（含 ready 新增 DB mock 与失败用例；DB 集成用例无 DATABASE_URL 时跳过） |
| `rtk pnpm build:miniapp:prod` | 构建 + verify 通过 |
| `rtk docker compose config` | 解析通过，含 fastclaw-data / healthcheck / logging / TZ |
| 本地 `docker compose up -d` + `curl /api/health` `/api/ready` + `docker inspect` | health 200；ready 含 `db.ok=true`；healthcheck/logging/limits 生效；api 容器 `date` 为 Asia/Shanghai |
| `node scripts/backup-postgres.mjs` | 产出 `.dump` |
| `docker compose exec -T postgres pg_restore --list - < backups/<file>.dump` | 可列出归档内容（容器内自带 pg_restore，宿主机无需装 libpq） |
| `grep -n "20260706\|-dirty" .env.example` | 无命中 |

> 注意：本地 `docker compose up -d` 会从 CCR 拉取 api/fastclaw/caddy/postgres 镜像，需先 `docker login ccr.ccs.tencentyun.com` 且可访问 CCR（或本地已缓存镜像）；本地 compose 会加载未跟踪的 `docker-compose.override.yml`（见 §5）。

## 7. 落地顺序与门禁

1. 本 spec 为 draft；实施须用户明确批准（按仓库三态门禁，`execute` 以批准范围为限，「好的/继续」不计为批准）。
2. 建议顺序：P0-1（口径）→ P0-2（卷）→ P0-3（备份）→ P1-1..P1-5（代码/配置）→ P1-6（文档与测试收口）→ §6 全量验证。
3. 收口时记录 `baseline`、`finalStatus`、`diffCheck`、`taskDiff`、`handoff` 实况；缺项不得声称完成。

## 8. 风险与回撤

| 风险 | 应对/回撤 |
|---|---|
| `.env.example` 占位 tag 导致 `compose pull` 失败 | 有意为之；发布时填写真实 tag |
| fastclaw 命名卷切换使旧匿名卷数据"不可见" | 服务器切换前先备份旧卷；本地测试阶段无影响 |
| 本机（arm64）按旧命令构建产出 amd64 服务器不可用镜像 | 构建命令已统一为 `buildx --platform linux/amd64 --push`（§4.1） |
| ready 加 DB 检查破坏既有单测 | 已纳入 `route.test.ts` 修改与 DB mock 策略（§4.5），属批准范围 |
| ready DB 检查无超时导致卡 30s | 已加 5s `Promise.race` 超时（§4.5） |
| 资源上限过小触发 OOMKill | 执行阶段实测调参；回撤即删除 limits 块 |
| 备份文件进 Docker 构建上下文 | `backups/` 已进 `.dockerignore`（§4.3） |
| 宿主机无 `pg_restore` | 验证改用容器内 `pg_restore`（§6） |
| 本地 compose 拓扑与服务器不同（override 文件） | §5/§6 已注明，不触碰该文件 |
| 与既有未提交改动混在同一工作树 | 只改 §5 列出的文件，其余保持用户基线 |
| 全部改动回撤 | 各文件 `git revert` 或手工还原；备份脚本/ignore 行删除即可 |

## 9. 后置项（本 spec 不冻结）

- CI/CD（GitHub Actions，用户明确今天不配置）；
- 真实支付服务商联调（上线阻断，见 4.4）；
- 限流/防刷（登录、聊天、支付/钱包接口）；
- 监控告警、结构化日志与请求 ID、Caddy access log 汇聚；
- 回访调度器多副本说明（进程内单点）；
- DB 连接池显式参数（`apps/api/src/server/db/index.ts` 默认值）；
- 基础镜像 pin digest（postgres:16-alpine、caddy:2-alpine 浮动 tag）；
- 小程序主包体积自动断言（当前无护栏，仅人工核对，见附录 A.6）；
- Next.js runtime 遥测（P1-4 已含）之外的安全加固（CSP 等，按小程序客户端需要评估）。

## 附录 A：微信后台上线清单（非仓库操作，人工执行）

1. request 合法域名 `https://api.offergo.xz.cn` 已配置（`hosts.json` prod 已入库）。
2. 用户隐私保护指引：收集 openid、聊天内容、头像昵称等，须在微信公众平台提交。
3. 小程序类目与资质（AI 聊天 / 角色扮演类目要求以平台审核为准）。
4. UGC 内容安全：项目已有本地 blocked-keywords + 输出过滤；确认是否需接 `msgSecCheck` 或用户协议兜底。
5. 体验版真机验证：`urlCheck: false` 仅开发者工具生效，体验版/正式版必须走合法域名。
6. 主包体积：当前 <2MB（历史提交 `bf01332`），**无自动断言**，上线前在开发者工具人工核对；如需自动护栏另开条目（范围外）。
7. `TEST_USER_INITIAL_POINTS`：测试版可临时赠点，正式版必须为 `0`。
