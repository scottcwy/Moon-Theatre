# Aggregate the chat list by character

The user-facing chat list contains exactly one Character Chat Entry for each user and character, backed by a server-produced character summary whose default target is the most recently updated mode session. Script and free Chat Sessions, Visible History, Generation Context, and Script Memory remain separate; aggregation is only a navigation and summary concern, because deduplicating paginated session rows in the client would make uniqueness and pagination incorrect.


## 模块 6：常聊角色排序聚合

- `GET /api/chat/characters?sort=turn_count` 是同一聚合入口的排序视图，不改变默认聊天列表语义。
- 成功轮数在数据库内按用户+角色分组计数，只计 `role='assistant'`、`outOfScope=false`、`excludedFromContext=false` 的消息；失败/过滤/越界/system/预告角色不计。
- 排序：`successfulTurnCount DESC, latestUpdatedAt DESC, character.sortOrder ASC`。`latestUpdatedAt` 用该角色所有会话 `role='user'` 消息的最大 `createdAt`（与模块 7 候选共用同一口径），不用会话 `updatedAt`。
- 剧本模式与自由对话轮数合计，但只用于排序；点击仍进角色详情，不合并两种模式历史。
