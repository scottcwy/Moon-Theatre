# provision-roleplay-agents.mjs

按 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md` §6/§7/§8/§9.1
把已发布角色 agent 与角色卡（SOUL.md / IDENTITY.md / USER.md）幂等同步进 FastClaw。

## 契约要点

- 19 个稳定 slug 为冻结名单（与轨道 C 共用，一字不差）：见脚本内
  `ROLE_AGENT_BY_NAME` / `ROLE_AGENT_SLUGS`（`role-baizang` … `role-yeshangqiu`）。
- 编辑源：后台发布读模型导出的 JSON（`--published-file` 或
  `CONTENT_PUBLISHED_FILE`），每个角色必须携带稳定 `agentId` 和 `prompt` 五字段。
  seed 仅用于首次空库 bootstrap；设置发布文件后不会再读 seed，因此部署/初始化不会覆盖运营修改。
- 渲染（Spec §7）：
  - `SOUL.md` = 核心人设（systemPrompt）+ 人格 + 剧情（scenario）+ 安全 + 输出风格；
  - `IDENTITY.md` = 名字 + 身份 + 关系起点；
  - `USER.md` = 空模板（运行时由 AutoPersist 写 per-user 称呼/偏好）。
- 落点：FastClaw `agents`（id=role-*，user_id=owner）+ `agent_files`
  **owner 行**（user_id = agents.user_id）+ `configs` 表 agent 级
  `agents.defaults` 行（只写 `roleplay/thinking/maxToolIterations`；
  **model/maxTokens/temperature 不动**，Spec §8）。
- **禁止写 `user_id=''` 模板行**（`migrateAgentFilesDropTemplate` 会清退）。
- 幂等：重复执行 diff 为空（先 dry-run 看 diff，`--apply` 后再跑一次应输出
  `no changes (diff is empty)`）。
- 旧默认 agent（`FASTCLAW_AGENT_ID`，当前 `agt_7c8acb3dde163e04bb`）保留且
  保持非 roleplay；脚本对默认 agent 做守卫（roleplay=true 时拒绝执行）。

## 用法

```bash
# dry-run：只打印 diff，不写库（退出码 0）；生产使用发布读模型
node scripts/provision-roleplay-agents.mjs \
  --db /path/to/fastclaw.db --owner-user-id u_xxx \
  --published-file /path/to/published-characters.json

# 应用（幂等）
node scripts/provision-roleplay-agents.mjs \
  --db /path/to/fastclaw.db --owner-user-id u_xxx --published-file /path/to/published-characters.json --apply
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `--apply` | 应用 diff；缺省为 dry-run | 无 |
| `--db` | sqlite 文件路径或 postgres DSN（`postgres://…`） | `FASTCLAW_STORAGE_DSN` 或 `~/.fastclaw/fastclaw.db` |
| `--owner-user-id` | 拥有 role agent 的 FastClaw 用户 id | `FASTCLAW_OWNER_USER_ID`，否则自动取 super_admin / 首个用户 |
| `--default-agent-id` | 旧默认 agent 守卫目标 | `FASTCLAW_AGENT_ID` |
| `--published-file` | 已发布角色 JSON（数组或 `{characters: []}`） | `CONTENT_PUBLISHED_FILE` |

环境变量从仓库根 `.env`（`parseDotEnv`）读取，进程环境变量优先。

## DB 访问

脚本沿用仓库现有 shell-out 范式（同 `scripts/backup-postgres.mjs`），不引入新依赖：

- sqlite：`sqlite3` CLI（macOS 自带；本地/测试路径，已验证）。
- postgres：`psql` CLI（生产路径；SQL 与 sqlite 同构，均使用
  `ON CONFLICT … DO UPDATE … excluded.`）。postgres 模式需操作机安装 `psql`，
  部署前请先对目标 FastClaw DB 做备份（Spec §7「可回滚」：先备份
  `fastclaw-data` volume）。

## 生产前置（Spec §8）

- `apps/api` 使用的 FastClaw API key 必须可访问发布读模型中的每个 agent
  （`apikey_agents` ACL；`/api/ready` 会对每个 agent 调 runtime-spec，
  403 会判失败）。
- FastClaw 镜像需含 roleplay 内核（F1–F5/F7/F8/F9/F10 补丁）。`/api/ready`
  动态读取 active/published 角色集合；合法增减角色不会因固定数量失败，缺失、重复、
  无效 agent id 或 runtime-spec 不可访问仍会 fail-closed。
- 先跑 FastClaw 一次完成 AutoMigrate，再执行本脚本。

## 测试

```bash
node --test scripts/provision-roleplay-agents.test.mjs
# 或随 harness：pnpm run test:dev-script
```

覆盖：冻结 slug 名单、seed 19 角色、SOUL/IDENTITY/USER 渲染、计划/diff 幂等、
model 配置不动、默认 agent 守卫、sqlite 临时库 dry-run→apply→空 diff 全链路
（`sqlite3` 不可用时集成用例自动跳过）。
