# V1.1 聊天体验迭代技术 SPEC

日期：2026-07-14
状态：frozen（已实现）
修订号：2
适用版本：V1.1 内测修复版
变更标识：chat-experience-iteration-v1-1

## 1. 文档目的与冻结边界

本文档将产品 SPEC 中已经确认的 V1.1 用户行为映射为当前代码库可实施的技术设计，覆盖 P0 和 P1 两个交付阶段。

本文档冻结：

- 会话模式和剧本作用域；
- 用户对话称呼；
- 历史、Prompt、记忆和剧情状态的隔离规则；
- 羁绊更新的一致性边界；
- 剧本目录、搜索和角色选择的数据来源；
- 首次聊天推荐问题；
- 数据迁移、兼容、错误恢复、发布和回滚规则；
- 稳定验收标准与验证矩阵。

本文档不冻结具体实现批次、提交拆分和开发排期；这些内容应在后续 Implementation Plan 中定义。

冻结后，任何改变用户行为、模式边界、数据不变量或验收标准的修改都必须形成修订说明并重新评审，不能在实现过程中静默改变。

## 2. 上下文清单

### 2.1 产品来源

- docs/specs/2026-07-14-chat-experience-iteration-product-spec.md
- docs/prd-v1.md

产品行为以 V1.1 产品 SPEC 当前修订为准，对应基线提交 5b86055；本文档负责选择符合现有系统的技术实现。产品 SPEC 后续如改变冻结行为，必须修订本文档。

### 2.2 既有技术约束

- docs/technical-spec-v1.md
- docs/api-v1.md
- docs/adr/0001-api-owned-chat-context-and-client-message-id.md
- docs/adr/0002-character-chat-mode-boundary.md

### 2.3 关键代码入口

- apps/api/src/server/db/schema.ts
- apps/api/src/server/modules/chat/service.ts
- apps/api/src/server/modules/chat/stream-runner.ts
- apps/api/src/server/modules/chat/prompt-builder.ts
- apps/api/src/server/modules/chat/workflow.ts
- apps/api/src/server/modules/memory/service.ts
- apps/api/src/server/modules/relationships/service.ts
- apps/api/src/app/api/chat/stream/route.ts
- apps/api/src/app/api/chat/sessions/route.ts
- apps/api/src/app/api/me/route.ts
- apps/miniapp/src/pages/character/detail.tsx
- apps/miniapp/src/pages/chat/index.tsx
- apps/miniapp/src/pages/chat/list.tsx
- apps/miniapp/src/pages/profile/index.tsx
- apps/miniapp/src/pages/home/index.tsx
- apps/miniapp/src/services/api.ts

## 3. 既有设计的继承与修订

以下既有决策继续有效：

1. API 是产品聊天上下文的唯一事实源。
2. FastClaw 是无状态生成执行器，不持有产品会话真相。
3. Client Message ID 是一次发送尝试的幂等与恢复标识。
4. clean history 只包含已完成且未被排除的消息。
5. 钱包扣点和退款继续使用独立幂等键。
6. ~~输出审核继续采用 moderated-buffered，不恢复逐 token 展示~~（已被 `2026-08-12-chat-streaming-incremental-output-spec.md` 冻结修订：改为 incremental-buffered，边生成边按行净化下发 delta，生成结束后对已发送全文复核输出过滤；逐 token 展示仍未恢复，但首字/首段提前到生成早期）。
7. 关系数据继续以 userId + characterId 为唯一边界。

本 SPEC 对既有设计作出两项明确修订：

1. 剧情越界分类只适用于 Script Mode。Free Conversation Mode 不再把普通闲聊判定为超出剧情范围。
2. 成功回复的羁绊更新从普通异步副作用提升为聊天完成事务的一部分。记忆和成就仍可异步处理。

不新增 chat_turns 表，不引入新的会话状态管理、消息队列、WebSocket 或 FastClaw 持久会话。

## 4. 当前基线与真实缺口

当前系统已经具备：

- 按 userId + characterId 查找或创建 active 会话；
- Client Message ID 重放、生成租约和失败重试；
- API 侧 clean history；
- ~~moderated-buffered 输出~~（2026-08-12 已被 `chat-streaming-incremental-output-spec` 冻结修订为 incremental-buffered 增量放行）；
- 输入与输出审核；
- 预扣、退款和模型调用日志；
- assistantMessageId 维度的羁绊幂等事件；
- 角色详情和聊天页的羁绊展示；
- 首页静态剧本卡片和月见庭院专用角色选择页；
- 社区占位页。

当前缺口是：

- chat_sessions 没有 mode 和 scriptId，无法可靠隔离两类会话；
- Prompt 总是注入剧本世界观和 scenarioPrompt；
- 剧情越界分类会把自由闲聊拉回剧情；
- memories 只按用户和角色分组，剧情信息可能跨模式泄漏；
- users 没有独立的对话称呼字段；
- 剧本目录由小程序静态维护，与后端 scripts 表形成双源；
- 羁绊在异步副作用开启时可能不随 done 事件稳定返回；
- 推荐问题和首次有效聊天状态没有正式数据契约；
- “流氓叙事”仍存在于小程序本地首页目录。

## 5. 目标与非目标

### 5.1 目标

- 同一角色的剧本模式和自由对话模式拥有独立会话、历史和剧情上下文。
- 用户称呼和关系状态能够跨模式连续使用。
- 自由对话保持角色人格，但不强制推进剧情。
- 成功回复与羁绊变化保持一致且只发生一次。
- 网络中断、页面退出和重复发送能够恢复，不制造重复消息或副作用。
- 剧本列表、搜索和角色选择由 API 持有统一数据源。
- 首次聊天推荐问题不调用模型、不扣点、不污染历史。
- P0 和 P1 可以分阶段发布，不需要大重构。

### 5.2 非目标

- 通用 AI 聊天或无角色聊天；
- 多人会话、语音、图片输入；
- 复杂剧情编辑器或完整 Galgame 状态机；
- Redis、Elasticsearch、队列服务或新状态管理库；
- 用户可编辑的完整记忆管理面板；
- 社区发帖、评论、关注、通知和搜索；
- 重构现有支付、钱包或 FastClaw 协议；
- 为未来多剧本共享角色预建完整 Agent Instance 领域模型。

## 6. 核心不变量

1. 用户必须先选择角色，才能进入任一聊天模式。
2. 每个 Chat Session 只属于一个 mode。
3. Script Mode 会话必须绑定一个 scriptId。
4. Free Conversation Mode 会话不得绑定 scriptId。
5. 服务端持久化的会话作用域优先于客户端参数。
6. 提供 sessionId 时，用户、角色、mode 和 scriptId 必须全部匹配。
7. 两种模式不得共享消息历史、剧情状态或剧情记忆。
8. 用户称呼、shared 记忆和 relationships 可以跨模式共享。
9. Free Conversation Mode 不读取或写入剧情状态。
10. 只有成功、未被过滤且已持久化的 assistant reply 可以增加羁绊。
11. 同一个 assistantMessageId 最多产生一次羁绊增量。
12. 同一个 Client Message ID 的重试不得重复插入用户消息、扣点或增加羁绊。
13. retired 剧本及其所属角色不得通过任一模式创建新会话或继续发送，但历史消息必须可读。
14. 推荐问题不得自动发送、调用模型、扣点或写入消息表。
15. API、日志和用户界面不得暴露系统提示、内部推理或 FastClaw 原始错误。
16. 现有 AI 生成内容提示必须在两种模式和新增页面中继续保留。

## 7. 总体架构

~~~text
Taro 微信小程序
  -> Next.js API
    -> Postgres
    -> FastClaw 内网生成服务
      -> LLM Provider
~~~

职责保持不变：

- 小程序负责页面、输入、状态展示和恢复触发。
- Next.js API 负责身份、会话作用域、上下文、Prompt、幂等、计费、审核和最终业务状态。
- Postgres 保存所有可恢复业务事实。
- FastClaw 只执行当前请求携带的 system message 和 clean history。

不允许小程序直接决定已有会话属于哪个模式，也不允许 FastClaw 的内部 session history 参与产品上下文。

## 8. 数据模型

### 8.1 用户对话称呼

users 增加：

~~~text
preferred_name varchar(20) null
~~~

规则：

- API 字段名统一为 preferredName。
- 保存前 trim。
- trim 后长度必须为 1—20 个 Unicode 字符。
- 空值、纯空白或超长输入不得覆盖旧值。
- 不从 nickname 自动回填。
- preferredName 不改变登录身份、微信昵称或角色身份。

### 8.2 会话模式

新增 chat_mode：

~~~text
script
free
~~~

chat_sessions 增加：

~~~text
mode chat_mode not null
script_id uuid null references scripts(id)
~~~

检查约束：

~~~text
mode = script -> script_id is not null
mode = free   -> script_id is null
~~~

active 会话唯一性：

~~~text
unique(user_id, character_id)
where status = active and mode = free

unique(user_id, character_id, script_id)
where status = active and mode = script
~~~

该规则延续现有“每个作用域复用一个 active 会话”的行为，不扩展为任意创建多条平行会话。

chat_sessions.scriptId 是该历史会话的权威剧本作用域快照。角色后续如果改变所属剧本，不得据此重写既有会话的 scriptId。

lastUsedMode 不单独存储。角色详情接口根据该角色最近更新的 active 会话计算；没有历史时返回 null，由客户端默认突出 Script Mode。

### 8.3 记忆作用域

新增 memory_scope：

~~~text
shared
script
~~~

memories 增加：

~~~text
scope memory_scope not null
script_id uuid null references scripts(id)
~~~

检查约束：

~~~text
scope = shared -> script_id is null
scope = script -> script_id is not null
~~~

读写规则：

| 记忆类型 | 写入作用域 | Free Mode 读取 | Script Mode 读取 |
| --- | --- | --- | --- |
| user_info | shared | 是 | 是 |
| relationship | shared | 是 | 是 |
| story | 当前 script | 否 | 仅当前 script |

现有 extractor 的“没有匹配项就把用户原文兜底保存为 story”规则在 Free Mode 禁用，避免普通闲聊污染剧情记忆。

抽取规则修订（2026-08-12，`chat-memory-fact-persistence-spec` 冻结）：

- story 只从用户消息提取，不再回灌助手回复；每轮候选上限 2 条；
- user_info/过往经历落具体事实模板（如「用户喜欢「草莓」」），不再落「用户表达了偏好/情感倾向。」等无实体泛化固定串；
- meta 指令（命中「回复/输出/回答/格式/协议」且「不要/去掉/移除/请用/以后」的组合）不落 story；
- service 对旧泛化条目/措辞变体执行删除+替换（保留新值），避免新旧并存。

### 8.4 剧本目录元数据

P1 为 scripts 增加：

~~~text
slug varchar(128) unique not null
genre varchar(128) not null
search_keywords text not null default ''
cover_url varchar(512) null
sort_order integer not null default 0
~~~

scripts.status 本期使用：

~~~text
active
retired
~~~

不引入全文搜索引擎。当前规模使用 Postgres 大小写不敏感包含查询。

数据库 UUID 继续用于会话外键和 API 主标识；slug 用于稳定内容身份、种子数据对齐和分析标识，不替代 chat_sessions.scriptId。

### 8.5 推荐问题

P1 为 characters 增加：

~~~text
starter_questions jsonb not null
default {"script":[],"free":[]}
~~~

逻辑结构：

~~~json
{
  "script": ["问题一", "问题二"],
  "free": ["问题一", "问题二"]
}
~~~

每种模式最多 3 条，每条 1—100 个字符。该字段属于用户可见角色元数据，不放入模型 Prompt，也不新建运营表。

> 实现说明（修订 2，2026-08-10）：schema 层未强制“最多 3 条 / 每条 1—100 字符”校验，仅种子数据保证合规；如需硬约束需另行在服务端校验或数据库约束层补充。

## 9. API 契约

### 9.1 用户资料

GET /api/me 增加：

~~~json
{
  "id": "uuid",
  "nickname": null,
  "avatarUrl": null,
  "preferredName": null,
  "status": "active"
}
~~~

新增 PATCH /api/me：

~~~json
{
  "preferredName": "小岚"
}
~~~

成功后返回更新后的用户资料。非法输入返回 invalid_preferred_name，数据库保持原值。

### 9.2 角色详情

GET /api/characters/:id 增加：

~~~json
{
  "lastUsedMode": "script",
  "availableModes": ["script", "free"],
  "starterQuestions": {
    "script": [],
    "free": []
  }
}
~~~

availableModes 根据角色和剧本可用状态计算。角色没有 active 剧本时不得提供新的 Script Mode 入口。

用于新入口的角色详情必须满足角色 active 且其所属剧本 active；角色没有所属剧本时只能提供 Free Conversation Mode。retired 历史页不依赖该 active-only 接口恢复角色展示信息。

### 9.3 会话列表与作用域查询

新增 GET /api/chat/characters，返回当前用户按角色聚合的聊天入口。聚合必须在服务端完成，不能由客户端对分页后的 Chat Session 结果去重：

~~~json
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
~~~

约束：

- 每个 `userId + characterId` 最多返回一项；
- 摘要字段来自该角色最近更新的 Chat Session；
- `latestSessionId` 是点击入口时的默认目标；
- 搜索参数 `q` 匹配角色名和最近消息，分页发生在角色聚合之后；
- retired 历史角色不进入聊天列表（见 11.4 与前端 SPEC 6.4，产品行为为列表排除、不展示只读入口）；其历史会话仍可通过 `GET /api/chat/sessions/:id/messages` 只读访问（`canSend=false`）；
- 接口不合并消息、Generation Context 或 memory。

GET /api/chat/sessions 保留为聊天页的模式作用域查询，并支持可选过滤：

~~~text
characterId
mode
scriptId
page
limit
~~~

会话项增加：

~~~json
{
  "mode": "script",
  "scriptId": "uuid",
  "scriptTitle": "月见庭院：狐神的新娘",
  "canSend": true
}
~~~

retired 剧本的历史会话继续返回，但 canSend 为 false。

### 9.4 会话消息

GET /api/chat/sessions/:id/messages 返回会话元数据和消息：

~~~json
{
  "session": {
    "id": "uuid",
    "characterId": "uuid",
    "characterName": "白藏",
    "characterAvatarUrl": "/assets/characters/hakuzo.jpg",
    "characterIdentity": "月见庭院的狐神",
    "mode": "script",
    "scriptId": "uuid",
    "scriptTitle": "月见庭院：狐神的新娘",
    "canSend": true,
    "hasSuccessfulTurn": true
  },
  "messages": []
}
~~~

hasSuccessfulTurn 优先由该会话是否存在 model_usage_logs.status = success 的有效回复计算；兼容历史数据时，也可由已完成、未拦截、未过滤且未排除上下文的 assistant turn 推断。不以消息数组是否为空代替。

消息接口必须返回历史展示需要的角色元数据，确保 retired 会话不需要调用 active-only 的角色详情接口。

### 9.5 聊天发送

POST /api/chat/stream 请求体扩展为：

~~~json
{
  "characterId": "uuid",
  "sessionId": "uuid",
  "mode": "script",
  "scriptId": "uuid",
  "message": "你好",
  "modelTier": "standard",
  "clientMessageId": "client-generated-id"
}
~~~

规则：

- 新版客户端必须发送 mode。
- Script Mode 必须发送 scriptId。
- Free Conversation Mode 不得发送 scriptId。
- 提供 sessionId 时仍必须发送 mode 和对应 scriptId，服务端执行一致性校验。
- Client Message ID 继续作为一次发送尝试的稳定标识。

成功 done 事件稳定包含：

~~~json
{
  "type": "done",
  "messageId": "uuid",
  "sessionId": "uuid",
  "clientMessageId": "client-generated-id",
  "mode": "script",
  "bondLevel": 2,
  "bondExp": 110,
  "balanceAfter": 90
}
~~~

replay 响应同样返回当前关系状态，使重连后的页面不依赖本地旧值。

### 9.6 剧本目录

P1 新增：

~~~text
GET /api/scripts?q=<keyword>
GET /api/scripts/:id
~~~

GET /api/scripts：

- 只返回 active 剧本；
- 空查询返回完整列表；
- 查询 title、genre、searchKeywords；
- 无结果返回空数组；
- 不自动选择第一个结果。

GET /api/scripts/:id 返回 active 剧本详情和其 active 角色。历史下架剧本不通过该接口重新开放入口。

## 10. 服务端主流程

### 10.1 会话解析

发送前按以下顺序校验：

1. 验证 JWT、模型档位和请求结构。
2. 读取 active 角色。
3. 校验 mode。
4. 校验角色所属剧本的可用状态；所属剧本 retired 时，两种模式都不得新建或继续发送。
5. Script Mode 校验剧本 active 且角色属于该剧本。
6. 提供 sessionId 时读取持久化会话。
7. 校验会话用户、角色、mode 和 scriptId。
8. 解析 Client Message ID 的 replay、in-progress、retry 或 collision 状态。
9. 完成上述步骤后才能保存新用户消息、扣点或调用 FastClaw。

作用域不匹配返回 session_scope_mismatch，不允许通过修改请求参数把一条现有会话变成另一种模式。

### 10.2 Prompt 组装

两种模式共同注入：

- 生产安全规则；
- 角色基础身份；
- personalityPrompt；
- safetyPrompt；
- outputFormatPrompt；
- preferredName；
- shared memories；
- 羁绊等级；
- 当前会话 clean history。

preferredName 的 Prompt 规则必须明确：自然使用即可，不得在每条回复中机械重复。

Script Mode 额外注入：

- 剧本标题和 worldSetting；
- scenarioPrompt；
- 当前 script memories；
- 当前剧情状态；
- 剧情越界分类所需上下文。

Free Conversation Mode：

- 不注入 worldSetting；
- 不注入 scenarioPrompt；
- 不读取 story memories；
- 不读取或更新 userStoryState；
- 跳过剧情越界分类；
- 增加“保留角色身份，但不主动拉回剧情、不强制推进任务”的模式规则。

角色的 systemPrompt 可能包含身份来源和背景秘密；Free Mode 不需要抹掉角色背景，但模式规则优先禁止主动推进剧情。

### 10.3 成功回复与羁绊完成事务

成功且未被过滤的回复在一个数据库事务内完成：

1. 插入 assistant message。
2. 插入 model_usage_logs.status = success。
3. 标记 user message completed 并清除生成租约。
   - 若 sanitizer 剥离/删除了 JSON 块（output_sanitizer_hit / output_sanitizer_parse_fail），该行额外记录 errorCode=output_json_block（success/filtered 均适用）。
4. 插入 relationship_bond_exp_events，键为 assistantMessageId。
5. 更新或创建 relationships。
6. 更新 chat_sessions.updatedAt 和最新 modelTier。
7. 返回 assistantMessageId、bondLevel 和 bondExp。

钱包预扣仍发生在生成前，钱包退款继续使用独立幂等事务，不并入该事务。

以下路径不得增加羁绊：

- 输入拦截；
- 改协议预检（输出协议变更请求的角色化引导，done.outOfScope=true、不扣点）；
- 输出过滤；
- Script Mode 剧情越界；
- FastClaw 失败；
- 超时或主动中断；
- replay 已完成的旧请求。

记忆和成就继续由 chat effect workflow 处理，可异步执行。bond 不再由普通异步 effect 调度。

输入拦截、改协议预检、输出过滤和剧情越界产生的用户消息及系统替代消息必须标记 excludedFromContext，避免安全提示或不完整回合进入后续角色上下文。

### 10.4 失败、重试与恢复

~~~text
客户端发送
  -> 使用 Client Message ID
  -> 请求中断
  -> GET /api/chat/messages/by-client-id
    -> completed: 合并服务端最终结果
    -> generating: 保持生成中状态
    -> failed: 使用相同 Client Message ID 重试
    -> missing: 保留原输入并允许重新发送
~~~

相同 Client Message ID 的重试：

- 不重复插入用户消息；
- 不重复渲染用户气泡；
- 已完成时直接 replay；
- 失败或租约过期时重新获取生成租约；
- 扣点、退款和羁绊继续使用既有幂等键。

### 10.5 retired 剧本

新建或继续发送前必须校验角色及其所属剧本可用：

- 角色有 scriptId 时，characters.status 和 scripts.status 都必须为 active；
- 角色没有 scriptId 时，只允许新建 Free Conversation Mode；
- 不能通过 Free Conversation Mode 绕过所属剧本 retired 状态。

历史读取不按 active 过滤：

- 会话列表仍显示；
- 消息接口仍可读取；
- 消息接口提供历史角色元数据；
- canSend 为 false；
- 页面展示只读提示；
- 不允许通过旧路由或手工参数继续调用模型。

用于首页、剧本详情和新角色入口的角色查询必须排除 retired 剧本所属角色；历史会话查询不得复用该过滤条件。

## 11. 小程序交互流程

### 11.1 用户称呼

我的页增加“对话称呼”入口：

~~~text
我的
  -> 对话称呼
  -> 输入
  -> 本地校验
  -> PATCH /api/me
  -> 更新页面资料
~~~

输入非法时不发送或不覆盖原值。保存成功只影响后续回复。

### 11.2 角色详情与模式入口

角色详情页展示两个明确入口：

- 进入剧本
- 自由聊天

lastUsedMode 只影响默认视觉优先级，不隐藏另一入口。

当页面提供未指定模式的“继续聊天”主操作时，必须打开 lastUsedMode；没有历史时打开 Script Mode。两个明确模式入口始终可以覆盖该默认选择。

进入聊天页后，顶部必须展示当前持久化 mode。客户端不得仅根据路由参数渲染模式标识，应以会话元数据或首次创建结果为准。

### 11.3 模式切换

模式切换是打开另一个作用域，不修改当前会话：

~~~text
当前 Script Mode
  -> 选择 Free Conversation Mode
  -> 查询 user + character + free active session
  -> 有会话则加载历史
  -> 无会话则保持空页，首次发送时创建
~~~

生成中禁用模式切换。本期不新增服务端取消生成协议。

### 11.4 会话列表

会话列表消费 GET /api/chat/characters，每个角色只显示一条 Character Chat Entry。服务端根据 `characters.scriptId` 判断角色所属剧本状态，在搜索和分页前排除 inactive 角色及非 active 剧本角色，不返回只读列表入口。列表不显示模式筛选或模式标签；入口展示最近消息和更新时间，点击 `latestSessionId` 后由聊天页恢复最近模式。模式切换继续发生在聊天页，并通过 GET /api/chat/sessions 按 `characterId + mode + scriptId` 查询独立 Chat Session。

从 Free Session 恢复聊天页时，客户端必须在允许模式切换前完成 active 角色详情加载，并保留角色所属剧本元数据。目标 Script Session 不存在时，客户端进入 Script Mode 空历史；不存在历史不是“剧本不可用”。

### 11.5 剧本搜索与通用角色选择

P1 使用参数化页面：

~~~text
剧本列表或搜索
  -> pages/script/select?scriptId=<id>
  -> GET /api/scripts/:id
  -> 展示剧本与角色
  -> 角色详情
  -> 选择聊天模式
~~~

复用现有 CharacterPosterCard、CharacterDetailHero、PageSection 和 BottomAction，不建立平行设计系统。

只有一个剧本或搜索结果很少时仍保持同一页面结构，不增加虚假推荐、占位模块或自动跳转。

### 11.6 推荐问题

展示条件：

- 当前模式有 1—3 条 starterQuestions；
- 当前会话不存在成功回复；
- 用户本次没有手动收起。

点击行为：

- 输入框为空时填入问题；
- 输入框已有内容时不覆盖并给出轻提示；
- 不自动发送；
- 不创建消息；
- 不调用模型；
- 不扣点；
- 不写入聊天历史。

第一条成功回复完成后立即收起。拦截、过滤、越界和失败不算首次有效发送。

## 12. P0 与 P1 交付边界

### 12.1 P0

- users.preferredName 和资料接口；
- chat_sessions.mode 与 scriptId；
- memories.scope 与 scriptId；
- 服务端会话作用域校验；
- 模式化 Prompt、历史、记忆和剧情状态；
- Free Mode 跳过剧情越界分类；
- 角色详情双入口和聊天模式标识；
- 服务端角色级聊天摘要和唯一列表入口；
- 成功回复与羁绊强一致；
- 网络失败恢复和重复发送保护；
- 移除“流氓叙事”新入口；
- retired 历史只读。

### 12.2 P1

- scripts 目录元数据；
- GET /api/scripts 和 GET /api/scripts/:id；
- 首页改为 API 剧本数据源；
- 剧本搜索和空状态；
- 通用角色选择页；
- starterQuestions；
- 首次有效聊天判断和推荐问题交互。

社区继续保持现有占位体验，不产生后端工作。

## 13. 数据迁移

### 13.1 P0 迁移

迁移顺序：

1. 新增 enum、nullable 字段和外键。
2. 回填 chat_sessions。
3. 处理重复 active 会话。
4. 回填 memories。
5. 增加检查约束、非空约束和唯一索引。
6. 部署兼容新旧请求的 API。
7. 发布新版小程序。

chat_sessions 回填：

- characters.scriptId 非空：mode = script，scriptId = character.scriptId。
- characters.scriptId 为空：mode = free，scriptId = null。

重复 active 会话处理：

- 按同一目标作用域分组；
- 按 updatedAt、createdAt、id 依次倒序，保留第一条 active；
- 其他会话改为 archived；
- 不删除消息。

memories 回填：

- user_info、relationship：scope = shared，scriptId = null。
- story 且角色有 scriptId：scope = script，scriptId = character.scriptId。
- story 且无法确认剧本：enabled = false；保留记录供后台审查。

preferredName 初始为 null，不复制 nickname。

### 13.2 P1 迁移

- 先以 nullable 形式增加 slug、genre、searchKeywords、coverUrl 和 sortOrder。
- 为现有 active 剧本补齐这些字段。
- 校验不存在空 slug 或重复 slug 后，再增加 not-null、默认值和唯一约束。
- 月见庭院使用稳定 slug moon-garden。
- 将历史下架剧本《夜色围城》设置 `status = retired`（旧版小程序本地静态首页卡片曾以“流氓叙事”展示该入口；若数据库中仍存在名为“流氓叙事”的记录同样置 `retired`）。
- 为现有角色补齐 starterQuestions；缺少内容时使用空数组，不生成占位问题。

### 13.3 旧客户端兼容窗口

兼容一个小程序版本周期：

- 旧请求未传 mode 且提供 sessionId：从持久化会话读取作用域。
- 旧请求未传 mode 且未提供 sessionId：临时推断为 Script Mode，并使用角色当前 active scriptId。
- 角色不存在 active scriptId 时，旧请求返回 script_unavailable，不猜测为 Free Conversation Mode。
- 每次推断记录 chat_mode_inferred_legacy。
- 新客户端必须显式传 mode。
- 兼容窗口结束后，mode 改为接口必填。

推断逻辑只用于迁移，不作为长期行为。

## 14. 错误处理

API 返回稳定错误码，小程序集中映射中文文案。不得把 FastClaw、数据库、网络库或英文异常直接显示给用户。

| 错误码 | HTTP/流语义 | 数据副作用 | 用户行为 |
| --- | --- | --- | --- |
| invalid_preferred_name | 400 | 不更新资料 | 保留原称呼 |
| session_scope_mismatch | 409 | 不保存、不扣点 | 重新进入正确会话 |
| script_unavailable | 409 | 不调用模型 | 历史只读 |
| client_message_id_collision | 409 | 不继续处理 | 生成新的 Client Message ID |
| in_progress | 可恢复业务错误 | 不重复生成 | 保持生成状态并查询 |
| insufficient_points | 402 | 不调用模型 | 展示购买入口 |
| timeout | 流错误 | 退款、turn failed | 原消息可重试 |
| generation_failed | 流错误 | 退款、turn failed | 原消息可重试 |
| out_of_scope | Script Mode 终态 | 退款、排除上下文 | 展示剧情边界提示 |
| input_blocked | 终态 | 不扣点、不增加羁绊 | 展示安全提示 |
| output_filtered | 终态 | 退款、不增加羁绊 | 展示替换提示 |

统一文案至少包括：

- 超时：这次回应准备得太久了，或换个更具体的问题再试一次吧
- 剧情越界：这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。
- 点数不足：点数不足，请先补充点数后再试。
- 作用域冲突：会话模式已变化，请重新进入对应聊天。
- 剧本下架：该剧本已下架，历史对话仍可查看。

## 15. 可观测性

新增或补充结构化事件：

- chat_session_scope_resolved
- chat_session_scope_mismatch
- chat_mode_inferred_legacy
- chat_turn_finalized
- chat_turn_replayed
- chat_turn_reconciled
- preferred_name_updated
- script_search_completed
- retired_script_send_rejected
- scope_classifier_grace_expired（Spec 1：script 模式宽限期放弃等待分类结果时记录，按 in_scope 放行）
- output_sanitizer_hit（剥离 JSON 块，kind=json-block，带 characterId/modelName/sessionId/userMessageId）
- output_sanitizer_parse_fail（疑似 JSON 块解析失败，整块删除）

model_usage_logs.errorCode 新增取值 output_json_block：sanitizer 剥离/删除 JSON 块时写入（与 output_sanitizer_hit / output_sanitizer_parse_fail 对应，可按模型/角色聚合）。

聊天事件至少包含：

- sessionId；
- characterId；
- scriptId，可空；
- mode；
- clientMessageId；
- generationAttempt；
- terminalStatus；
- generationMs、moderationMs、saveMs、totalUntilDoneMs；
- bondUpdated；
- replayed。

日志不得记录：

- 用户消息正文；
- assistant 完整正文；
- preferredName 明文；
- systemPrompt；
- FastClaw token、模型密钥或支付密钥。

内测统计可基于事件聚合首次进入、首次发送、成功率、超时率、模式使用量、称呼更新是否生效和羁绊同步结果。

## 16. 安全与隐私

- 所有用户资料、会话、消息和恢复接口必须验证 JWT。
- sessionId 必须校验归属，不能只校验 UUID 格式。
- mode 和 scriptId 必须与数据库会话一致。
- retired 剧本校验必须在扣点和模型调用前完成。
- preferredName 作为用户资料处理，不进入结构化日志。
- Prompt 继续禁止输出系统提示、内部标签、推理过程和界面元数据。
- 输出继续经过 sanitizer 和 moderation。
- 小程序不得直接访问 FastClaw。
- 不得把 api.example.com 写入小程序源代码、配置或构建产物。
- 千万不要为了验证本变更而编译出包含 api.example.com 的小程序产物。

## 17. 发布与回滚

### 17.1 P0 发布

1. 在测试数据库验证迁移和回填。
2. 部署支持 mode 的 API，并保持旧客户端兼容。
3. 验证旧版小程序仍只能进入 Script Mode。
4. 发布新版小程序双模式入口。
5. 验证真实对话、重试、扣点、羁绊和历史隔离。
6. 移除“流氓叙事”本地入口并将数据库内容设为 retired。
7. P0 验收通过后再进入下一轮内测。

### 17.2 P1 发布

1. 补齐 scripts 元数据。
2. 上线剧本目录 API。
3. 首页切换到 API 数据源。
4. 上线搜索和通用角色选择。
5. 上线推荐问题。
6. 验证少剧本、无搜索结果和下架内容边界。

### 17.3 回滚

数据库迁移不做 destructive rollback。新增字段、enum 和历史回填保留。

Free Mode 已产生数据后，禁止回滚到不识别 mode 的旧 session resolver，否则旧代码可能把两种历史混合。

故障处理顺序：

1. 回滚或隐藏小程序 Free Mode 入口。
2. 保留支持新 schema 的 API。
3. 旧客户端继续通过兼容路径进入 Script Mode。
4. 服务端采用前向修复。

P1 故障可独立回滚首页和搜索页面到静态月见庭院入口，但不得重新展示“流氓叙事”。

## 18. 风险与缓解

| 风险 | 严重度 | 缓解 |
| --- | --- | --- |
| 两种模式历史混用 | 高 | 会话持久化 mode/scriptId，服务端强校验 |
| 旧客户端未传 mode | 中 | 一个版本兼容窗口和推断日志 |
| 历史 story 记忆错误共享 | 高 | 按 script 回填，无法判断时禁用 |
| Free Mode 被剧情分类器拦截 | 高 | 代码路径显式跳过 classifier |
| 重试重复增加羁绊 | 高 | assistantMessageId 唯一事件和完成事务 |
| 关系事务失败导致回复半完成 | 高 | assistant、usage、turn、bond、session 同事务 |
| retired 剧本历史被误删 | 中 | 聚合列表排除 retired 入口，但历史接口不按 active 过滤并用 canSend 控制只读 |
| 剧本目录双源 | 中 | P1 后首页和搜索统一读取 API |
| 推荐问题覆盖用户输入 | 低 | 输入非空时禁止覆盖 |
| 回滚到旧 resolver 混合新数据 | 高 | 禁止服务端 destructive rollback，隐藏入口并前向修复 |

## 19. 验收标准

### 19.1 P0

- AC-P0-01：用户可保存 1—20 字符的 preferredName；非法输入不覆盖旧值，下一轮成功对话可以使用新称呼。
- AC-P0-02：角色详情明确提供 Script Mode 和 Free Conversation Mode；聊天列表每个 active 剧本角色只有一个入口并默认打开最近模式，聊天页展示当前持久化模式且可切换到另一套独立历史；目标模式没有会话时显示空历史。
- AC-P0-03：同一角色两种模式的消息、clean history、剧情状态和 story memories 互不混用。
- AC-P0-04：Free Conversation Mode 保持角色人格，不注入剧情场景，不执行剧情越界分类。
- AC-P0-05：Script Mode 继续注入剧本和剧情上下文，并保留剧情边界处理。
- AC-P0-06：一次成功回复只增加一次羁绊，done 返回最新 bondLevel 和 bondExp。
- AC-P0-07：输入拦截、输出过滤、剧情越界、模型失败和超时不增加羁绊。
- AC-P0-08：相同 Client Message ID 重试不重复消息、扣点或羁绊。
- AC-P0-09：网络中断或页面重进后可以通过服务端状态恢复最终消息。
- AC-P0-10：“流氓叙事”不出现在首页、新入口或可用搜索结果中。
- AC-P0-11：retired 剧本角色不出现在聊天聚合列表；已知历史仍可读，但不能创建新会话或继续发送。
- AC-P0-12：生成中有明确状态，模式切换被禁用；失败后原消息可恢复重试。

### 19.2 P1

- AC-P1-01：剧本目录只返回 active 剧本，支持名称、类型和关键词搜索。
- AC-P1-02：清空搜索恢复完整列表；无结果不自动进入第一项。
- AC-P1-03：搜索结果可以进入通用角色选择、角色详情和聊天模式选择。
- AC-P1-04：切换剧本不混用上一剧本的历史、剧情状态或 story memories。
- AC-P1-05：首次有效聊天前展示 2—3 个可用推荐问题；缺少配置时不展示空壳。
- AC-P1-06：点击推荐问题只填输入框，不覆盖已有输入，不调用模型、不扣点、不写历史。
- AC-P1-07：第一条成功回复后推荐问题收起；失败、拦截、过滤和越界不算成功。
- AC-P1-08：社区继续是占位页，不出现发帖、评论、关注或假订阅能力。

### 19.3 非功能

- AC-NF-01：任何模式都不显示系统提示、推理过程、内部标签或原始 FastClaw 错误。
- AC-NF-02：所有作用域校验在扣点和模型调用前完成。
- AC-NF-03：用户可见错误使用稳定中文文案。
- AC-NF-04：日志不记录消息正文、preferredName 明文或密钥。
- AC-NF-05：小程序构建产物不包含 api.example.com。
- AC-NF-06：不引入 Redis、队列、WebSocket、新状态管理或 chat_turns。
- AC-NF-07：剧本和自由对话页面继续展示产品既有 AI 生成内容提示。

## 20. 验证矩阵

| 验收标准 | 验证层级 | 主要证据 |
| --- | --- | --- |
| AC-P0-01 | API route + miniapp | PATCH /api/me 校验测试、我的页交互测试、Prompt 测试 |
| AC-P0-02—05 | service + route + miniapp | session resolver、Prompt builder、history、页面模式标识测试 |
| AC-P0-06—08 | transaction + workflow | finalization、bond event、replay、钱包幂等测试 |
| AC-P0-09、12 | route + miniapp | by-client-id、失败恢复、生成状态测试 |
| AC-P0-10—11 | seed/API/miniapp | retired 过滤、历史只读、首页边界测试 |
| AC-P1-01—04 | API + miniapp | scripts 查询、搜索模型、通用角色选择测试 |
| AC-P1-05—07 | miniapp + API read model | hasSuccessfulTurn、推荐问题交互测试 |
| AC-P1-08 | miniapp | 社区占位边界测试 |
| AC-NF-01—04、07 | service + miniapp + logging review | sanitizer、错误映射、AI 内容提示和结构化日志测试 |
| AC-NF-05 | production build verification | verify:weapp 扫描 |
| AC-NF-06 | diff review | 依赖、目录、schema 审查 |

实现后至少运行：

~~~bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
~~~

在一次性测试数据库中验证：

~~~bash
rtk pnpm --filter @juben-sha/api db:migrate
~~~

端到端重点场景：

1. 同一角色分别完成一轮 Script Mode 和 Free Conversation Mode 对话，交叉检查历史和 Prompt。
2. Free Mode 发送日常问题，确认不产生 out_of_scope。
3. 修改 preferredName 后发送下一轮，确认新称呼进入 Prompt，历史内容不变。
4. 人为中断请求后使用同一 Client Message ID 恢复，确认无重复消息、扣点和羁绊。
5. 确认 retired 剧本角色不出现在聊天列表，并通过已知历史会话确认可读且不可发送。
6. 搜索存在、不存在和清空关键词，确认导航不误选。
7. 点击推荐问题，确认输入可编辑且没有网络调用。

执行任何小程序构建前，必须确认 API_BASE_URL 是真实安全地址，且不会回退到 api.example.com。只有满足该前置条件时才允许运行：

~~~bash
rtk pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
~~~

verify:weapp 必须成功，并明确证明构建产物不存在 api.example.com。

## 21. 文档同步要求

实现涉及公共接口、数据模型、配置和关键业务流程，完成时必须同步：

- docs/api-v1.md
- docs/technical-spec-v1.md
- 与实际迁移对应的 Drizzle schema 和 migration

CONTEXT.md 和 ADR 0002 已记录模式词汇和边界；只有 canonical 术语或架构决策改变时才需要再次修改，避免重复文档噪音。

## 22. 冻结结论

V1.1 采用“后端持有会话边界”的方案：

- 在现有 chat_sessions、messages、memories、relationships 和聊天生命周期上做有界扩展；
- 不推倒现有幂等、计费和 FastClaw 集成；
- P0 先解决模式、称呼、羁绊、恢复和下架边界；
- P1 再统一剧本目录、搜索、角色选择和推荐问题；
- 任何实现不得削弱模式隔离、羁绊幂等、历史可恢复性或构建安全红线。

本文档 revision 1 已冻结，可进入 Implementation Plan 阶段。

## 23. 修订记录（revision 2 · 2026-08-10 实现确认）

本修订不改变任何冻结的用户行为、模式边界、数据不变量或验收标准，仅澄清与代码现实不一致处并记录实现状态：

- V1.1 P0/P1 已全部实现并验证通过（API 524 用例、miniapp 134 用例、miniapp-ui 26 用例，typecheck 全绿；验证矩阵见第 20 节）。
- 9.3 澄清：聊天列表不返回 retired 角色的只读入口，历史会话通过消息接口只读访问（与 11.4 / 前端 SPEC 6.4 一致）。
- 13.2 澄清：历史下架剧本为《夜色围城》（seed `legacyScriptTitle`）；“流氓叙事”仅为旧版小程序本地静态首页卡片名，前端入口已删除。
- 8.5 实现说明：`starterQuestions` 的数量/长度约束未在 schema 层强制，仅 seed 数据合规。
- 羁绊展示层采用 2026-08 确认的 6 级名称：檐下 → 灯前 → 杯沿 → 留盏 → 不言 → 入念；`bondLevel`（1–10）/`bondExp` 数值模型与 done 事件字段不变，前端按 6 级累计经验门槛（0/200/700/2700/10700/26700）重算展示层级与升级提示。
- 第 4 节“当前基线与真实缺口”中关于“流氓叙事仍存在于小程序本地首页目录”的表述为 2026-07-14 冻结时的基线事实，该缺口已随实现关闭。
