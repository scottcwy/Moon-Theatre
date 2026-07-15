# 聊天可用性、模式切换与剧本页细节修订 SPEC

日期：2026-07-15
状态：已实现
关联：V1.1 聊天体验迭代

## 1. 目标

本修订解决四个已确认问题：下架剧本角色仍出现在聊天列表、Free Session 恢复后切换 Script Mode 误报剧本不存在、月见庭院封面与世界观区域视觉割裂、我的页显示第三方动画图标声明。

## 2. 行为约束

### 2.1 聊天列表可用性

- `GET /api/chat/characters` 必须使用 `characters.scriptId` 判断角色所属剧本状态，不能使用最近 Chat Session 的 `scriptId` 代替。
- 角色 inactive 或所属剧本非 active 时，在搜索、分页和最近消息查询前排除。
- Free Session 的 `scriptId=null` 不得绕过上述过滤。
- 下架只影响 Character Chat Entry 可见性，不删除 Chat Session 或消息；已知历史接口继续返回只读数据。

### 2.2 模式切换

- 从 `sessionId` 恢复可发送会话时，聊天页必须等待角色详情加载完成后再结束首屏加载。
- Free Session 历史不得把角色详情中的 active `scriptId`、剧本标题或可用模式覆盖为空。
- 切换到 Script Mode 时，有目标会话则加载其历史；没有目标会话则进入 Script Mode 空历史并允许首次发送。
- 只有角色详情确实不提供 Script Mode 或 active 剧本时，才判定剧本不可用。
- Script Mode 与 Free Conversation Mode 的消息、Generation Context 和 Script Memory 继续隔离。

### 2.3 剧本页封面

- 保留现有 Hero 高度、遮罩、文案和世界观圆角结构。
- 仅在 `.script-select__cover` 内调整封面取景，使画面主体向下衔接内容区。
- 不新增页面卡片、替换素材或改变内容层级。

### 2.4 我的页声明

- 删除 `Animated icons by Lordicon.com` 可见声明及其页面样式。
- 不删除既有成就图标组件，不改变 AI 生成内容提示。

## 3. 接口与数据边界

- 不新增接口、数据库字段、迁移或状态管理。
- `/api/chat/characters` 仍按角色唯一聚合；`/api/chat/sessions` 仍负责模式会话查询。
- 历史只读能力继续由 `GET /api/chat/sessions/:id/messages` 的 `canSend` 表达。
- 小程序不得回退到本地剧本数据补齐缺失 `scriptId`。

## 4. 验收标准

- retired 剧本角色即使最近会话为 Free Session，也不出现在聊天列表和搜索结果中。
- 从白藏 Free Session 进入后立即切换剧本模式，不出现“当前没有可用剧本”；没有 Script Session 时显示空历史。
- 月见庭院封面主体相对原版本下移，Hero 与世界观圆角连接自然，文案无遮挡。
- 我的页不再出现 Lordicon 声明，AI 内容提示仍存在。
- API/miniapp 测试、类型检查、小程序安全构建和开发者工具运行验证通过。

## 5. 非目标

- 不改变下架历史的底层保留策略。
- 不合并两种聊天模式的历史或记忆。
- 不重做月见庭院页面布局。
- 不替换 Playbook 图标系统。
