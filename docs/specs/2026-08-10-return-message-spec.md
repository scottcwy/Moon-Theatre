# 回访留言（Module 7）产品与技术 SPEC

日期：2026-08-10
状态：frozen（2026-08-10 重新冻结）
修订号：1
适用版本：P0 七模块 Module 7
变更标识：return-message-module-7

> **修订标注（2026-08-14）**：本文档「留言永远不进入模型生成上下文」的边界被 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）修订——留言经 F8 append 进入目标自由会话的生成上下文（agent 角色化吸收），仍不扣点/不加羁绊/不触发记忆与成就/不算成功回合。

## 1. 文档目的与冻结边界

本文档是**回访留言功能的唯一权威规格**，统一产品行为、数据模型、API、生成规则、前端表现与验收标准。此前该功能的规格散落在 `CONTEXT.md` 词表、`docs/api-v1.md` 回访留言节与 P0 七模块 Plan 中；本文件冻结后，以上来源与本文档冲突处**以本文档为准**，词表以 `CONTEXT.md` 为准。

本文档冻结：

- 回访留言的产品定义与用户可见行为；
- 数据模型与迁移；
- 投递、生成、频控、未读/已读与清扫规则；
- API 契约；
- 前端表现与验收标准。

本文档不冻结：模型供应商、运营模板的具体文案（种子数据可迭代）、调度器部署形态（当前为进程内定时器，可替换为独立任务而不改变行为）。

## 2. 术语（与 CONTEXT.md 词表一致）

- **Return Message (回访留言)**：API 写入的主动 assistant 消息，投递进自由模式 Chat Session 的 **Visible History**，经 FastClaw F8 append 进入该会话生成上下文，并标记 **Excluded From Context**（UI/审计标记，不再从生成上下文剔除）；未读/已读状态记录在独立投递元数据 `character_return_messages` 中。
- **投递元数据**：`character_return_messages` 表，记录一次投递的内容、原因、UTC+8 自然日窗口、关联消息 `message_id` 与已读时间。
- **Excluded From Context**：留言对用户可见，标记为 UI/审计用途；经 F8 append 进入模型生成上下文（agent 角色化吸收），但不算成功回合、不扣点、不加羁绊、不触发记忆与成就。

## 3. 产品行为

### 3.1 一句话目标

让长时间未回访的用户回到聊天列表时，能收到角色主动表达的惦记与邀请，制造“角色还在等你”的回归体验，且不打扰正常对话语义。

### 3.2 功能规则

- 留言作为真实 assistant 消息写入该角色**最近活跃的自由模式会话**的可见历史（无自由会话时先创建一个，`mode=free`）。
- 留言必须标记 `excludedFromContext=true`、`outOfScope=false`、`generationStatus='completed'`。
- 留言**不消耗点数、不增加羁绊、不触发记忆抽取与成就、不视为成功回合**。
- **频控**：每个角色每个 UTC+8 自然日最多投递 1 条（按窗口唯一索引保证）。
- **未读上限**：每个用户对每个角色最多累计 3 条未读；达到上限后停止为该角色生成，直到用户已读。
- **候选角色**：每个用户最多 2 个候选——①最近成功聊过的 active 角色（按该角色会话中用户最后一条消息时间倒序）；②羁绊最高的 active 角色；同一角色只保留一条，`recent` 优先。
- **触发时机**：
  - 用户回访（`POST /api/return-messages/check`）：补齐当前窗口缺失的留言；
  - 每小时清扫（`POST /api/admin/return-messages/sweep` 或进程内调度器）：为最近 3 个缺失窗口（当前日、昨日、前日）补发，预算为 `3 - 当前未读` 条。
- **生成**：复用 FastClaw 非流式调用，专用短超时 15 秒，内容按 Unicode 码点截断至 200 字符；失败、超时、空内容或 adapter 兜底流均视为失败，改用运营模板兜底（角色模板优先，无则通用兜底）。生成永不抛错、永不返回空字符串。
- **并发与幂等**：投递在事务内以 `pg_advisory_xact_lock(userId, characterId)` 串行化；未读上限校验与插入之间不会被并发投递穿插；同一窗口命中唯一索引时静默跳过；任何路径都不会把未读推到 3 以上。
- **“最近”口径**：用户与角色的最近活跃按该角色会话中用户消息（role=user）的最大 `createdAt` 计算；无用户消息的会话排在最后（NULLS LAST）。

### 3.3 验收标准

- 每个角色每 UTC+8 自然日最多收到 1 条留言，重复触发不重复投递。
- 未读留言累计不超过 3 条；满 3 后不再生成，已读后恢复。
- 留言出现在自由模式会话的可见历史中，经 F8 append 进入该自由会话的生成上下文（agent 角色化吸收）；剧本模式与其它会话不受影响（scope 隔离）。
- 留言不扣点、不加羁绊、不触发成就/记忆。
- 并发触发（check 与 sweep 同时）不会产生重复消息或孤儿元数据。
- 生成失败时用户仍能看到模板兜底留言，接口不报错。
- 已读接口重复调用幂等；已读后未读数归零。

## 4. 数据模型

### 4.1 `character_return_messages`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK users | 所属用户 |
| `character_id` | uuid FK characters | 所属角色 |
| `content` | text | 留言正文 |
| `reason` | varchar | `recent` 或 `bond`（候选原因） |
| `window_start` | timestamptz | UTC+8 自然日零点（UTC 时刻） |
| `message_id` | uuid FK messages（可空） | 关联的可见 assistant 消息；旧卡片式存量数据为空 |
| `read_at` | timestamptz（可空） | 已读时间；`NULL` 表示未读 |
| `created_at` / `updated_at` | timestamptz | |

约束与索引：

- 唯一索引 `character_return_messages_window_unique(user_id, character_id, window_start)`：每角色每窗口至多一条。
- 索引 `character_return_messages_unread_idx(user_id, read_at)`：未读查询。
- `message_id` 外键关联 `messages(id)`（迁移 0008 增加；存量卡片式数据直接清空，不做转换）。

### 4.2 迁移

- `0006_character_return_messages.sql`：建表。
- `0008_return_messages_into_sessions.sql`：增加 `message_id` 列（`IF NOT EXISTS` 幂等）与外键，清空无 `message_id` 的存量数据。

## 5. API 契约

### 5.1 `POST /api/return-messages/check`（需登录）

检查并补齐当前用户的回访留言：

- 对每个候选角色，若未读 < 3 且当前窗口无留言，则生成并投递 1 条（多个候选并行，最多 2 次生成调用）。
- 返回：

```json
{
  "messages": [
    {
      "id": "uuid",
      "characterId": "uuid",
      "characterName": "白藏",
      "characterAvatarUrl": "/assets/characters/hakuzo.jpg",
      "content": "回来吧，庭院的花开了一夜。",
      "reason": "recent",
      "createdAt": "2026-08-10T02:00:00.000Z",
      "readAt": null
    }
  ],
  "characterUnread": { "characterId": 1 }
}
```

`messages` 只返回未读留言（`readAt IS NULL`），按创建时间倒序；`characterUnread` 为各角色未读数。

### 5.2 `POST /api/return-messages/read`（需登录）

请求：`{ "characterId": "uuid" }`。将该用户该角色全部未读留言置为已读，返回 `{ "updated": <条数> }`；重复调用幂等（第二次返回 0）。

### 5.3 `POST /api/admin/return-messages/sweep`（admin + Basic Auth）

手动触发一次全局补发清扫，返回 `{ "swept": true }`。遍历所有 active 用户，对每个候选角色按 `3 - 当前未读` 预算在最近 3 个缺失窗口补发；AI 生成并发上限 4；单用户/单窗口失败只记日志，不中断整体。

## 6. 服务端实现约束

- 投递必须整体原子：advisory lock → 事务内未读计数 → 幂等插入元数据 → 查/建自由会话 → 写 assistant 消息 → 回填 `message_id`。
- 留言消息固定为 `role='assistant'`、`outOfScope=false`、`excludedFromContext=true`（UI/审计标记）、`generationStatus='completed'`；经 F8 append 进入目标自由会话的生成上下文（agent 角色化吸收），不再依赖 clean history 排除语义（2026-08-14 架构 Spec 修订）。
- 候选角色必须满足角色 `status='active'`。
- 日志不记录留言正文明文之外的敏感内容；结构化事件：`return_message_check_character_failed`、`return_message_generation_failed`、`return_message_sweep_failed`。

## 7. 前端表现

回访留言在用户侧的呈现遵循「**消息流 + 未读红点**」语义，**不渲染独立留言卡片**（早期卡片式留言展示为已废弃设计，见迁移 0008 注释）：

- 聊天列表页消费 `POST /api/return-messages/check`，在各角色聊天入口（Character Chat Entry）上以未读红点提示该角色存在未读留言；红点只表达"有未读留言"，不展示正文摘要。
- 用户点击该角色聊天入口时，先调用 `POST /api/return-messages/read` 将该角色全部未读留言置为已读（fire-and-forget，失败不阻断导航，`useDidShow` 重拉兜底），红点消失。
- 留言正文已作为普通 assistant 消息写入该角色自由模式会话（`excludedFromContext=true`），用户进入会话后可在消息历史中直接看到留言；无需在列表层额外展示正文。
- 不引入新的全局状态管理；沿用 `PageShell`、`ChatSessionRow` 等既有组件体系。

## 8. 验证矩阵

| 验收标准 | 验证层级 | 主要证据 |
| --- | --- | --- |
| 窗口唯一/频控 | service + migration | `window_unique` 唯一索引、`hasMessageInWindow`/`insertReturnMessage` 测试 |
| 未读上限 3 与原子性 | service + route | `deliverReturnMessage` advisory lock + 事务内二次校验测试 |
| 生成兜底 | generator | 失败/超时/空/兜底流走模板、永不抛错测试 |
| 已读幂等 | route | `markCharacterMessagesRead` 重复调用测试 |
| sweep 预算与并发 | service | `sweepReturnMessages` 预算 `3 - 未读`、并发上限 4 测试 |
| 前端红点与已读闭环 | miniapp | chat/list 未读红点渲染、点击已读、进会话可见留言的集成测试 |

## 9. 文档同步

- 词表：`CONTEXT.md`「Return Message (回访留言)」。
- API：`docs/api-v1.md`「Return Messages」节。
- 实施计划：`docs/minipowers/plans/2026-08-03-p0-seven-module-alignment.md` Module 7。
