# 版本说明：v1.1 聊天体验（origin/main 合并后现状）

> 生成日期：2026-08-10 · 依据：`git log` / `rg` 对照代码实测 + 全量测试结果，非愿景文档。
> 主线：`origin/main`（HEAD `c2fb863`，2026-08-10），已含 dev 与 module 3~7 合入。

> **2026-08-10 事实更新（本文件为快照文档，以下为最新状态）**
> - `origin/main` HEAD 已推进至 `7d54a96`（merge: audit batches A–E into main），已包含 V1.1 聊天体验、回访留言、脚本目录、稳定用户错误码等全部功能线；本文档第 1/4 节关于 dev vs main 的“合入冲突清单”已随 A–E 合入解决，不再作为待办。
> - 本地 `main` 分支为 `79ac49b`（在 `7d54a96` 之上叠加 review P1-1/P2-1..4 修复：`Dockerfile.go → Dockerfile.minimal`、`internal/setup/web/index.html` 落盘、`0008` 迁移 `ADD COLUMN IF NOT EXISTS`、用户分页 NaN 修复、admin/stream 稳定错误码收敛、`character-summary-service` 查询优化），领先 `origin/main` 尚未推送。
> - 第 6 节验证命令中 `rtk go test ./...` 已在当前 main 上可执行（P1-1 修复后）。
> - 第 5 节部署现状仍成立：服务器跑的是 07-06 快照，`0004`–`0009` 迁移与镜像更新均未上线，仓库无 CI。

## 1. 分支关系与定位

- `origin/main` 当前 HEAD：`c2fb863`（fix: align main tree to dev after merge sync，2026-08-10）；其父提交 `123940c`（merge: sync dev into main，P0 modules 3-7 + spec re-freeze）把 dev 线合入 main。
- `47bcbd5`（PR #3「Codex/miniapp UI source consolidation」，2026-07-09）仍在 main 历史中，是 `123940c` 的第一父分支，不再是 dev 线外的平行提交。
- 原 dev 分支 HEAD `9f73cf6`（2026-08-05）与 module 3~7 合入提交（`0f53c7f`/`0793713`/`0764891`/`cbbf1e2`，2026-08-10）均为 main 祖先；dev 不再作为独立功能主线维护。
- 结论：合并后主线的文件树 = dev（含 module 3-7）+ PR #3，v1.1 聊天体验是当前产品的功能主线。

## 2. v1.1 核心能力（合并后落地形态）

### 2.1 聊天模式：剧本模式 / 自由模式

- `chat_mode` 枚举（`script` / `free`），`chat_sessions` 带 `mode` + `scriptId`，数据库级 CHECK：剧本模式必须绑定剧本，自由模式必须不绑定剧本。
- 部分唯一索引：每个用户/角色在每种模式下最多一个 active 会话（自由模式按 user+character+mode；剧本模式额外按 scriptId）。
- 前端聊天页支持模式选择、`availableModes` / `lastUsedMode` / 开场问题（`starterQuestions` 按模式区分）。
- 会话作用域防护：`getChatSessionScope` + `SessionScopeMismatchError` + `ScriptUnavailableError`，stream 层 `resolveRequestScope` 防止跨会话串扰。

### 2.2 剧本目录（module 5）

- `scripts` 表与 `apps/api/src/server/modules/scripts` 模块：`slug`、`genre`、`searchKeywords`、`coverUrl`、`sortOrder`、`starterQuestions`（角色侧）。
- 种子数据：第一个剧本《月见庭院：狐神的新娘》（slug `moon-garden`），含四位角色（狐神白藏、阴阳师贺茂清玄、画师月岛澪、武士久远）。
- API：`GET /api/scripts`（支持关键词搜索，无需认证）、`GET /api/scripts/:id`（需认证，含角色列表）。
- 小程序：`pages/script/catalog`（剧本目录 + 搜索）、`pages/script/select`（按 `scriptId` 打开的单剧本选角页）。

### 2.3 记忆作用域

- `memory_scope` 枚举（`shared` / `script`），`memories` 带 `scope` + `scriptId` 与 CHECK 约束。
- 记忆分「共享记忆」（两种模式都可用）与「剧本记忆」（仅对应剧本的剧本模式可用）。
- `workflow.ts`：聊天完成副作用中移除 bond 即时加分（`bond: null`），记忆抽取按 `mode`/`scriptId` 作用域执行。

### 2.4 聊天回合生命周期（协议层）

- `by-client-id` 查询路由扩展：返回 `mode` / `scriptId`，并加 userId 防御性校验。
- `shared/types.ts` 的 `Message` 增加：`clientMessageId`、`outOfScope`、`excludedFromContext`、`generationStatus`、`generationLeaseExpiresAt`、`generationAttempt`。
- 错误码闭环（前端有中文文案）：`session_scope_mismatch` / `script_unavailable` / `client_message_id_collision` / `input_blocked` / `output_filtered` / `generation_failed`。

### 2.5 回访留言（module 7，最终口径）

- 新表 `character_return_messages` 只作**投递元数据**（user + character + 内容 + 原因 + 时间窗，唯一索引防重复）；迁移 `0008` 增加 `message_id` 把留言本体接回 `messages` 表（free 模式会话 Visible History，`excludedFromContext=true`），旧卡片式留言元数据已清空（生产无 module 7 存量数据）。
- 新模块 `apps/api/src/server/modules/return-messages`：`generator` / `scheduler` / `service`，模板种子；API：`POST /api/return-messages/check`、`POST /api/return-messages/read`、`POST /api/admin/return-messages/sweep`。
- 小程序不再有 `ReturnMessageCard` 卡片组件：聊天列表按 `characterUnread` 显示未读红点，点击聊天列表项或进入会话时自动调用 `read` 标记已读。
- 未读上限 3 对 `check` 与 `sweep` 均生效（`UNREAD_CAP = 3`，代码 `unread >= UNREAD_CAP` 即跳过生成）。

### 2.6 模块 3 / 4 / 6 落地形态

- **module 3（羁绊 6 级化）**：`done` 事件透传 `bondLevel` / `bondExp` / `bondDelta` / `leveledUp`；成功轮 `+10` 经验、服务端 1–10 数值模型不变（每 `100` 经验升 1 级、封顶 `10`、经验继续累计）；前端按 6 级累计经验门槛（0/200/700/2700/10700/26700）重算展示层级与名称（檐下 → 灯前 → 杯沿 → 留盏 → 不言 → 入念），升级提示只在实际名称档位变化时出现，满级「入念」后不再提示升级。
- **module 4（首页横滑）**：首页「热门剧本」横向 ScrollView 展示 `GET /api/scripts` 结果，随滚动同步圆点指示（`getActiveScriptIndex`），支持关键词搜索。
- **module 6（常聊角色）**：`GET /api/chat/characters?sort=turn_count` 按成功对话轮数倒序返回常聊角色，首页 `limit=4` 卡片使用；默认语义仍是按角色聚合的聊天列表（每个 `characterId` 最多一项）。

### 2.7 安全与运维

- Admin Basic Auth 强制：middleware matcher 覆盖 `/admin/:path*` 与 `/api/admin/:path*`；401 返回 JSON、未配置返回 503、OPTIONS 预检放行；`auth.ts` 支持逗号分隔多认证头。
- FK 约束名缩短：`0007_rename_truncated_fk_constraints.sql`（带 IF EXISTS 保护），另修正 `0000` / `0003` 历史迁移中的两处长名。

### 2.8 fastclaw（Go 运行时）

- `config.go`：`maxToolIterations` 显式配置追踪（自定义 JSON 序列化，保留「未设置」与「0」的语义区别）。
- `agent/loop.go`：新增 `handleMessageWithoutTools`（支持 no-tool agent）与 AfterModelCall hook。
- `store/factory.go`：sqlite 默认 DSN 增加 `busy_timeout(5000)`。
- 新增 `config_test.go`、`factory_test.go`，扩展 `loop_stream_test` / `system_override_test` / `runtime_spec_test`。

### 2.9 工程

- 根 `package.json`：新增 `test:e2e:miniapp` / `test:e2e:miniapp:ui` / `test:e2e:miniapp:ui:auth`。
- `scripts/dev.mjs`：支持 `apps/api/.env.local` 覆盖 + 测试性入口判断修复。
- E2E mock 升级：月之花园剧本、模式、剧本搜索进入 mock 数据。
- `apps/miniapp/config/hosts.json` 已纳入版本管理（dev / lan / prod 三档域名）。

## 3. 数据模型与迁移（0000–0009 一览）

| 迁移 | 内容 |
|---|---|
| `0000_blushing_silverclaw` | 初始 schema（角色/会话/消息/记忆/羁绊/订单/支付/模型档位等，含 `character_status`、`memory_type`、`model_tier` 等枚举） |
| `0001_dazzling_satana` | 去重归一：`achievements`/`titles` 按 `name`、`user_achievements`/`user_titles` 按 user+id、`relationships` 按 user+character 去重（羁绊取最大值），并补唯一索引 |
| `0002_lowly_microchip` | 聊天回合生命周期：`messages` 增加 `clientMessageId` / `outOfScope` / `excludedFromContext` / `generationStatus` / `generationLeaseExpiresAt` / `generationAttempt`，`model_usage_logs` 增加 `clientMessageId` / `errorCode`，`model_usage_status` 增加 `out_of_scope`，`messages` 用户消息按 (session, role, clientMessageId) 唯一索引 |
| `0003_chat_effect_runs` | `chat_effect_runs` 表（记忆/羁绊/成就/称号 effects 幂等与租约） |
| `0004_chat_modes_and_memory_scopes` | `chat_mode` / `memory_scope` 枚举、`chat_sessions.mode`/`scriptId`、`memories.scope`/`scriptId`、CHECK 与部分唯一索引、存量回填 |
| `0005_scripts_catalog_and_starter_questions` | `scripts` 目录字段（slug/genre/searchKeywords/coverUrl/sortOrder）+ 角色 `starterQuestions`，slug 回填（`moon-garden`） |
| `0006_character_return_messages` | 回访留言投递元数据表（唯一索引防重复 + 未读索引） |
| `0007_rename_truncated_fk_constraints` | 重命名两个超长 FK 约束（IF EXISTS 保护，幂等安全） |
| `0008_return_messages_into_sessions` | 回访留言进会话流：`character_return_messages.message_id` 外键接回 `messages`，清空旧卡片式元数据 |
| `0009_chief_wallflower` | `messages` 增加 `(session_id, created_at)` 会话内时间序索引（CREATE INDEX IF NOT EXISTS，幂等可重放） |

## 4. 验证命令与当前状态

```bash
rtk pnpm run test:dev-script
rtk pnpm run test:deploy-config
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm -r typecheck
rtk go test ./...   # fastclaw 目录下
rtk pnpm build:miniapp:prod   # 小程序生产构建 + verify:weapp
```

当前实测状态（2026-08-10，`codex/audit-merge-batches` 合并工作树：origin/main `c2fb863` + 审计批次 A–E）：

- `test:dev-script`（6 用例）、`test:deploy-config`（7 用例）通过。
- `@juben-sha/api` test：54 个文件 / 562 用例通过（接入真实 PG 后共 55 个文件 / 563 用例）；`@juben-sha/miniapp` test：26 个文件 / 157 用例通过；`@juben-sha/miniapp-ui` test：5 个文件 / 29 用例通过。
- `api` / `miniapp` / `miniapp-ui` / `shared` typecheck（tsc --noEmit）全部通过。
- `fastclaw` 目录下 `go test ./...`：31 个包全部通过（干净 checkout 可直接编译；`Dockerfile.minimal` 不再被 Go 当源码，`internal/setup/web/index.html` 占位页已提交满足 embed）。

## 5. 部署现状（v1.1）

- **镜像仍为 07-06 快照**：具体 tag 以 `docs/deployment.md` 第 3 节为单一事实源，此处只引用不复制。
- 服务器当前跑的既不是 v1.1 代码：v1.1 上线需要**构建并推送 api / api-tools / fastclaw 新镜像**（tag 由发布负责人填写），服务器 `.env` 更新镜像 tag 后 `rtk docker compose pull && up -d`，并**确认迁移 0004–0009 已应用**。
- 上线检查清单见 `docs/deployment.md` 新增的「v1.1 上线检查清单」一节。
- 小程序生产域名 `https://api.yuemanlou.xyz`（`apps/miniapp/config/hosts.json` 已跟踪），生产构建直接读取 `prod`。

## 6. 已知边界

- 仓库无 CI（无 `.github`），git push 不会触发部署；上线需人工执行构建、推送、服务器更新与小程序重新构建上传。
- 线上数据库迁移执行情况需在服务器确认（`0004`–`0009` 是否已应用）。
