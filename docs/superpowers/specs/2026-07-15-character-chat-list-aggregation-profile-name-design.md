# 角色级聊天入口与档案称呼原位编辑设计

日期：2026-07-15  
状态：已实现
关联：V1.1 聊天体验迭代

## 1. 目标

聊天列表对用户表达“我与这个角色的对话入口”，而不是底层模式会话。每个角色只出现一次，默认打开最近使用的模式；进入聊天页后，用户仍可在剧本模式与自由聊天之间切换并分别查看两套历史。

“我的”页不再把对话称呼做成独立表单卡片。称呼成为玩家档案头部的主名称，并通过原位编辑完成修改。

## 2. 不变量

- 一个用户和一个角色在聊天列表中最多有一个 Character Chat Entry。
- 一个 Chat Session 只属于 `script` 或 `free`，两种模式的消息和 Generation Context 不混合。
- Shared Memory、用户称呼和关系状态允许跨模式使用。
- Script Memory 必须绑定具体 `scriptId`，Free Conversation Mode 不读取或写入 Script Memory。
- 列表聚合只是读取模型和导航行为，不改变底层 Chat Session 数据模型。
- 角色或其所属剧本下架后，不再出现在聊天列表聚合入口；已知的历史会话仍可通过历史接口读取，且 `canSend=false`。

## 3. 服务端读取模型

新增 `GET /api/chat/characters`。服务端按当前用户的 `characterId` 聚合 Chat Session，在聚合结果中选择 `updatedAt` 最新的一条作为摘要来源。接口根据 `characters.scriptId` 关联角色所属剧本，在搜索和分页前排除 inactive 角色及非 active 剧本角色。

响应：

```json
{
  "characters": [
    {
      "characterId": "uuid",
      "characterName": "白藏",
      "characterAvatarUrl": "/assets/characters/hakuzo.jpg",
      "latestSessionId": "uuid",
      "lastUsedMode": "free",
      "lastMessage": "下次也来找我。",
      "updatedAt": "2026-07-15T02:30:00.000Z",
      "canSend": true
    }
  ],
  "page": 1,
  "limit": 20,
  "hasMore": false
}
```

`GET /api/chat/sessions` 保持模式会话查询职责。聊天页切换模式时按 `characterId + mode` 查询目标 Chat Session；Script Mode 在需要时附加 `scriptId`。如果没有目标会话，页面保持该模式的空历史，首次发送由现有接口创建会话。

## 4. 聊天列表

聊天列表只消费 `/api/chat/characters`，不再展示“全部 / 剧本模式 / 自由聊天”筛选，也不展示模式标签。搜索框保留，搜索由服务端在聚合后对角色名和最近消息执行。

每一行展示角色头像、角色名、最近消息和更新时间。点击行后携带 `latestSessionId` 进入聊天页，聊天页从会话元数据恢复 `mode`、`scriptId` 和 Visible History。下架剧本角色不生成列表行。

前端不得对 `/api/chat/sessions` 的分页结果去重。客户端去重无法保证跨页唯一，并会造成每页数量和 `hasMore` 语义错误。

## 5. 聊天页模式切换

聊天页顶部保留模式切换控件。默认模式来自 `latestSessionId` 对应的持久化会话；没有会话时使用角色详情的 `lastUsedMode`，仍为空则默认 Script Mode（仅在可用时）。

切换模式时：

1. 生成中禁止切换。
2. 查询目标模式的 Chat Session。
3. 有会话则加载该会话的 Visible History。
4. 无会话则展示目标模式空历史。
5. 清理当前模式的临时 assistant 占位，不修改原模式消息。

从 Free Session 恢复页面时，历史元数据不得把角色详情中的 active `scriptId` 和剧本标题覆盖为空。页面在开放模式切换前必须完成角色详情加载；目标 Script Session 不存在时直接进入 Script Mode 空历史，不显示“当前没有可用剧本”。

## 6. 档案称呼原位编辑

档案头部主名称按 `preferredName -> nickname -> 我的` 回退。展示态在名称旁使用小编辑图标；点击后同一位置切换为输入框和保存按钮，不新增卡片或持续展示表单。

编辑态只编辑 `preferredName`。保存前沿用现有 1—20 Unicode 字符校验和 `trim` 规则，调用 `PATCH /api/me`。保存成功后同步页面资料和本地用户缓存；失败时保留原值并显示稳定中文错误。微信昵称只参与展示回退，不会被自动写入 `preferredName`。

## 7. 错误与边界

- 角色摘要请求失败：保留列表错误态和重试入口，不回退到模式会话列表。
- 最近会话所属剧本已下架：该角色从聊天列表消失；已知历史链接仍可按 `canSend=false` 打开只读历史。
- 最近会话在点击后失效：聊天页以历史接口返回为准并显示可恢复错误，不在列表端猜测模式。
- 名称保存失败：退出保存中状态，保留编辑内容和已保存展示名。
- 空昵称且未设置 `preferredName`：稳定展示“我的”，不展示空白标题。

## 8. 测试与验收

- API 测试证明每个角色最多一项、最近模式选择正确、聚合后搜索和分页正确、inactive/retired 角色在搜索分页前被排除。
- 列表模型测试证明不含模式筛选，点击使用 `latestSessionId`，同一角色不会由客户端逻辑产生重复展示。
- 聊天页测试证明默认打开最近模式，Free Session 恢复不擦除 Script 元数据，无 Script Session 时切换后打开空历史，发送参数和上下文不跨模式。
- 档案页测试证明展示名回退、原位编辑、合法保存和失败保留行为。
- 小程序测试、类型检查、构建和 `api.example.com` 产物扫描全部通过。

## 9. 非目标

- 不合并两种模式的消息时间线。
- 不把 mode 或 scriptId 从 Chat Session 移到 Character Chat Entry。
- 不新增全局状态管理、WebSocket、缓存层或新的记忆表。
- 不改造记忆页展示，也不增加用户手动管理记忆的能力。
