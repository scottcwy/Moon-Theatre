# 版本说明：dev（v1.1 聊天体验）

> 生成日期：2026-08-10 · 依据：`git log` / `git diff` / `git merge-tree` 实测，非愿景文档。
> 关联分支：`origin/dev`（HEAD `9f73cf6`） vs `origin/main`（HEAD `47bcbd5`）。

## 1. 分支关系与定位

- 共同祖先：`65b15a6`（2026-07-08，fix chat timeout fallback handling）。
- `dev` 领先 `main`：31 个提交（2026-07-09 ~ 2026-08-04），176 个文件差异（76 新增 / 100 修改 / 0 删除），即 **dev 的文件树是 main 的超集**。
- `main` 独有 1 个提交：`47bcbd5`（PR #3「Codex/miniapp UI source consolidation」，2026-07-09），**不是 dev 的祖先**。
- 结论：两条线各自独立实现了「聊天回合生命周期」；dev 在其上叠加了完整 v1.1 聊天体验，是当前产品的**功能主线**。

## 2. dev 的核心能力（相对 main 的增量）

### 2.1 聊天模式：剧本模式 / 自由模式

- 新增 `chat_mode` 枚举（`script` / `free`），`chat_sessions` 增加 `mode` + `scriptId`。
- 数据库级 CHECK：剧本模式必须绑定剧本，自由模式必须不绑定剧本。
- 部分唯一索引：每个用户/角色在每种模式下最多一个 active 会话（自由模式按 user+character+mode；剧本模式额外按 scriptId）。
- 前端聊天页支持模式选择、`availableModes` / `lastUsedMode` / 开场问题（`starterQuestions` 按模式区分）。
- 会话作用域防护：`getChatSessionScope` + `SessionScopeMismatchError` + `ScriptUnavailableError`，stream 层 `resolveRequestScope` 防止跨会话串扰。

### 2.2 剧本目录

- 新增 `scripts` 表与 `apps/api/src/server/modules/scripts` 模块：`slug`、`genre`、`searchKeywords`、`coverUrl`、`sortOrder`、`starterQuestions`。
- 种子数据：第一个剧本《月见庭院：狐神的新娘》（slug `moon-garden`），含四位角色（狐神白藏、阴阳师贺茂清玄、画师月岛澪、武士久远）。
- API：`GET /api/scripts`（支持关键词搜索）、`GET /api/scripts/:id`。
- 小程序：`pages/script/select`（剧本列表 + 搜索）、`pages/role-select/moon-garden`（月之花园选角流程）。

### 2.3 记忆作用域

- 新增 `memory_scope` 枚举（`shared` / `script`），`memories` 增加 `scope` + `scriptId`，带 CHECK 约束。
- 记忆分「共享记忆」（两种模式都可用）与「剧本记忆」（仅对应剧本的剧本模式可用）。
- `workflow.ts`：聊天完成副作用中移除 bond 即时加分（`bond: null`），记忆抽取按 `mode`/`scriptId` 作用域执行。

### 2.4 聊天回合生命周期（协议层）

- `by-client-id` 查询路由扩展：返回 `mode` / `scriptId`，并加 userId 防御性校验。
- `shared/types.ts` 的 `Message` 增加：`clientMessageId`、`outOfScope`、`excludedFromContext`、`generationStatus`、`generationLeaseExpiresAt`、`generationAttempt`（main 上没有）。
- 错误码闭环（前端有中文文案）：`session_scope_mismatch` / `script_unavailable` / `client_message_id_collision` / `input_blocked` / `output_filtered` / `generation_failed`。

### 2.5 回访留言（module 7，PR #4）

- 新表 `character_return_messages`（user + character + 内容 + 原因 + 时间窗，唯一索引防重复）。
- 新模块 `apps/api/src/server/modules/return-messages`：`generator` / `scheduler` / `service`（+354 行），模板种子。
- API：`POST /api/return-messages/check`、`POST /api/return-messages/read`、`POST /api/admin/return-messages/sweep`。
- 小程序：`ReturnMessageCard` 组件。

### 2.6 安全与运维

- Admin Basic Auth 强制：middleware matcher 覆盖 `/admin/:path*` 与 `/api/admin/:path*`；401 返回 JSON、未配置返回 503、OPTIONS 预检放行；`auth.ts` 支持逗号分隔多认证头。
- FK 约束名缩短：`0007_rename_truncated_fk_constraints.sql`（带 IF EXISTS 保护），另修正 `0000` / `0003` 历史迁移中的两处长名。
- `docs/api-v1.md` 相对 main +440 行（全部新端点与回访留言数据模型/规则）。

### 2.7 fastclaw（Go 运行时）

- `config.go`：`maxToolIterations` 显式配置追踪（自定义 JSON 序列化，保留「未设置」与「0」的语义区别）。
- `agent/loop.go`：新增 `handleMessageWithoutTools`（支持 no-tool agent）与 AfterModelCall hook。
- `store/factory.go`：sqlite 默认 DSN 增加 `busy_timeout(5000)`。
- 新增 `config_test.go`、`factory_test.go`，扩展 `loop_stream_test` / `system_override_test` / `runtime_spec_test`。

### 2.8 工程

- 根 `package.json`：新增 `test:e2e:miniapp` / `test:e2e:miniapp:ui` / `test:e2e:miniapp:ui:auth`。
- `scripts/dev.mjs`：支持 `apps/api/.env.local` 覆盖 + 测试性入口判断修复。
- E2E mock 升级：月之花园剧本、模式、剧本搜索进入 mock 数据。

## 3. 数据模型与迁移

| 迁移 | 内容 |
|---|---|
| `0000`–`0003` | 与 main 共有基线（`0000`/`0003` 各有 1 行 FK 名差异，dev 已缩短） |
| `0004_chat_modes_and_memory_scopes` | `chat_mode` / `memory_scope` 枚举、会话/记忆作用域字段与 CHECK、部分唯一索引 |
| `0005_scripts_catalog_and_starter_questions` | `scripts` 目录字段 + slug 回填（`moon-garden`） |
| `0006_character_return_messages` | 回访留言表 |
| `0007_rename_truncated_fk_constraints` | 重命名两个超长 FK 约束（IF EXISTS 保护，幂等安全） |

## 4. 与 main 的差异与合入冲突清单

`git merge-tree --write-tree origin/main origin/dev` 实测：**26 个冲突文件**（14 content + 12 add/add），全部集中在：

- 聊天核心：`chat/service.ts`、`stream-runner.ts`、`workflow.ts`、`index.ts`、`by-client-id/route.ts`、`stream/route.ts`、chat 三份测试
- 数据层：`db/schema.ts`、`drizzle/0000`、`0003`、`meta/_journal.json`
- 前端：`pages/chat/index.tsx`、`index.model.ts`、`index.model.test.ts`、`services/api.ts`、E2E mock 三份
- 文档：`CONTEXT.md`、`docs/api-v1.md`

其余（fastclaw、middleware、return-messages、scripts、miniapp 新页面、ADR、规格文档）为 dev 独有，取 dev 即可。

## 5. 部署现状（重要）

- 仓库部署文档记录的当前镜像：`api:20260706-58cf7ce-deployfix`、`api-tools:20260706-58cf7ce-deployfix`、`fastclaw:20260706-58cf7ce-dirty`。
- `58cf7ce`（2026-07-05）是 main 与 dev 的共同祖先之前的提交 → **服务器跑的是 07-06 快照，既不是当前 main 也不是 dev**。
- 小程序生产构建域名 `https://api.offergo.xz.cn`（`apps/miniapp/config/hosts.json`，当前未跟踪/未提交）。
- 仓库无 CI（无 `.github`），git push 不会触发部署；上线需要：构建并推送新镜像 → 服务器 `.env` 更新镜像 tag → `docker compose pull && up -d` → 小程序重新构建上传。

## 6. 验证命令

```bash
rtk pnpm run test:dev-script
rtk pnpm run test:deploy-config
rtk pnpm run test:e2e:miniapp
rtk pnpm run typecheck
rtk pnpm --filter @juben-sha/miniapp test
rtk go test ./...   # fastclaw 目录下
rtk pnpm build:miniapp:prod
```

## 7. 已知边界

- `main` 的 PR #3 与 dev 的聊天实现是平行开发，合入必须逐文件对账，不能依赖自动 merge。
- 工作区仍有大量未提交改动（`build-with-host.mjs`、`hosts.json`、`database_test.go` 等未跟踪），dev 合入前需先收口。
- 线上数据库迁移执行情况需在服务器确认（`0004`–`0007` 是否已应用）。
