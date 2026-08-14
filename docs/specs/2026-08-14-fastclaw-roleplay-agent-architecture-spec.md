# 聊天架构重构 Spec：FastClaw 角色 Agent 多租户（一个角色一个 Agent，记忆/会话下沉 FastClaw）

日期：2026-08-14
状态：frozen（2026-08-14 意图对齐完成；revision 1 修正 P0/P1；revision 2 依据复审修正 P1-A/B/C 与 P2；revision 3 依据第三方复审修正 P1-1..P1-4 与 P2-1..P2-10；revision 4 依据第四轮复审修正 P1-A/B 与 P2-1..P2-9，待复审）
修订号：4
适用版本：聊天体验迭代 V1.1 之后（下一架构版本）
变更标识：fastclaw-roleplay-agent-architecture

## 1. 文档目的与冻结边界

本文档冻结「一个角色对应一个 FastClaw Agent，由 Agent 扮演角色并持有记忆；FastClaw 会话持有生成上下文；API 保留业务外壳与消息持久化」的架构边界。它推翻 `docs/adr/0001-api-owned-chat-context-and-client-message-id.md` 的决策依据（依赖 FastClaw session history 会让 excluded 草稿泄漏回上下文 → 改为「excluded 消息（越界/OOS、改协议预检、回访留言；checkInput.blocked 硬安全拦截除外）由 agent 角色化吸收，进入生成上下文」），并修订 `docs/technical-spec-v1.md` §7.4「记忆由业务后端结构化管理」等既有表述（清单见第 11 节）。

冻结：
- 19 个 FastClaw Agent（一角色一 Agent）与角色卡同步方式（脚本化，不用 FastClaw UI）；
- 记忆唯一事实源迁移到 FastClaw `agent_files`（per-user 多租户隔离 + scope 分文件）；
- FastClaw 会话持有生成上下文（历史 + compaction），API 保留消息持久化（UI/审计/计费/回放）；
- **越界/OOS、改协议预检、重放、回访留言进入 FastClaw 会话，agent 角色化处理**（重放不重复入会话，该回合首轮已入）；**硬安全拦截（`checkInput.blocked`，色情/违法/自伤等命中）维持短接：不进模型、不扣点、保留 `blocked` 状态与 `excludedFromContext` 标记（现状不变，合规边界）**；
- 请求头契约：`x-fastclaw-agent-id`、`x-fastclaw-user-id`、`x-fastclaw-session-key`（产品 chat_sessions.id）、`x-fastclaw-scope`（`free` | `script:<scriptId>`）、`x-fastclaw-message-id`（= clientMessageId，会话级去重）、`x-fastclaw-no-persist`（**可选**，回访生成不落库，见 F10）；
- 回访留言进 FastClaw 会话（append 端点，幂等、不触发副作用）；
- 存量会话纯重置（A 方案：不补种、不迁存量记忆）；
- 护栏走动态上下文（API 每轮发送），不进角色卡；
- 记忆页与 admin 记忆管理后台下线；
- 模型配置不动（roleplay + thinking=off + 无工具；maxTokens/temperature 保持现状）。

不冻结：模型/temperature/maxTokens 的后续调整；记忆展示与管理后台的后续重新实现；FastClaw 上游合并（PR）策略；角色卡文件内部排版细节；`excludedFromContext` 在 UI 层的展示口径微调；roleplay 真流式（TTFT 优化，见 §12）。

## 2. 现状与证据

### 2.1 当前生成链路（代码现实）

- `apps/api/src/server/modules/chat/stream-runner.ts` 每次请求：查角色 + prompts、取 clean history、取 memories、取羁绊/称呼，`prompt-builder.ts` 拼一个大 system prompt（生产护栏 + 模式规则 + 剧本世界观 + 羁绊 + 称呼 + 角色 5 个 prompt 字段 + 记忆 + 回查摘要），连同 clean history 发给 FastClaw。
- `apps/api/src/server/modules/fastclaw/adapter.ts` 只带单一 `FASTCLAW_AGENT_ID`（env），**不传 `x-fastclaw-session-key`**。
- 19 个角色 prompt 存于 `apps/api/src/server/db/schema.ts` 的 `character_prompts` 表（seed：`apps/api/src/server/seed/story-data.ts`）。

### 2.2 关键证据：FastClaw 从未看到 API 发送的历史

- `fastclaw/internal/api/openai.go` 对请求 `messages` 只取**最后一条 user 消息**与**最后一条 system 消息**（作为 `SystemPromptOverride`），其余消息全部丢弃；`msg.UserID` 硬编码为 `"api-user"`。
- 会话 key 来自 `x-fastclaw-session-key`，缺失时生成随机 `api-<nanos>` → 每轮空会话。
- `fastclaw/internal/agent/loop.go` `selectSystemPrompt` 用 `SystemPromptOverride` **整体替换** agent 自身构建的 system prompt（身份文件 + 记忆不参与）。
- 结论：**当前模型每轮上下文 = system prompt + 当前用户消息，历史从未进入模型**。API 计算的 clean history（20 条/6000 字）被发送但被 FastClaw 丢弃。客户「记不住」的根因首先是模型无历史，其次才是记忆抽取弱。

### 2.3 FastClaw 多租户底子（半成品，且模板范式与直觉相反）

- `agent_files` 主键 `(agent_id, user_id, filename)`；schema 注释声明「per-user 覆盖行 + `user_id=''` 模板行回退」语义，但**同一仓库的迁移 `migrateAgentFilesDropTemplate`（`internal/store/database.go` L110-170）已把 `user_id=''` 模板行全部重挂给 agent owner 后删除**，注释明确「任何跨用户共享 SOUL.md 的场景应放本地 FS 文件，运行时回退」——**`user_id=''` 模板行已被主动清退，Spec 不得再写入该范式**。
- 当前模板范式 = **agent owner 行**：setup server `PUT /api/agents/{id}/system-files/{name}`（`internal/setup/handlers_agents.go` L324-347）写 `SaveAgentFile(..., systemFileUserScope=effectiveUserID, ...)`，即身份文件（SOUL/IDENTITY/USER 模板）落在 owner 行；`agent_files` 其余读写（GetAgentFile/SaveAgentFile/ListAgentFiles/DeleteAgentFile，database.go L1119-1210）**全部拒绝 `userID=""`**。
- `sessions` 主键 `(user_id, agent_id, session_key)`，天然按用户隔离；但 `session.Manager` / `Memory` 目前按 **agent 所有者** 构造（`manager.go` `WithUserID` / `NewMemoryWithStoreForUser(..., m.uid, ...)`），且 `msg.UserID` 在 agent 循环（loop.go / sdkbridge.go / slash.go）**零消费**（hooks 全用 `a.ownerUserID`）——per-user 接线完全未打通。
- 流式真相：roleplay 恒走 `maxToolIterations=0`，`HandleMessageStream` 返回 `stringStream(handleMessageWithoutTools(...))`（loop.go L1027/L1141）——`handleMessageWithoutTools` 同步 `provider.Chat` 拿完整回复再包装，**假流**：首字延迟 = 全量生成时间；`handleMessageWithoutTools` 内部 `sess.Append(assistantMsg)` + `runPostTurn`（L573-576），会话与 AutoPersist 在 roleplay 路径均正常触发。
- AutoPersist 现状：`AutoPersistMemory`（`internal/agent/memory.go` L238-330）只跳过 system，**user/assistant 都喂给抽取器**；API 侧 extractor 的 RELATIONSHIP 规则使用 `combined = userText + assistantText`（`apps/api/src/server/modules/memory/extractor.ts` L86-88）——「只从用户消息抽取」是**新口径**，不是延续现有行为。
- 部署拓扑：FastClaw 使用独立 SQLite（`docker-compose.yml` `fastclaw-data` volume），**不与 API Postgres 同库**；API 无法直读 FastClaw 存储。
- 既有文档漂移：`docs/technical-spec-v1.md` §7.3 声称「当前 adapter 支持 x-fastclaw-session-key 请求头」，与 adapter 实际不发送该头不符（本 Spec §11 顺带修正）。

### 2.4 决策记录（2026-08-14 多轮对齐 + 独立审查）

- 全走 FastClaw：聊天上下文组装/记忆/历史迁到 FastClaw；API 保留业务外壳与消息持久化。
- 记忆唯一事实源 = FastClaw；API `memories` 表退役（不迁移存量数据）。
- 记忆隔离 = 一个 Agent 多租户 + scope 分文件（长期形态，不做过渡态）。
- 越界/OOS/改协议预检/重放/回访留言进入 FastClaw 会话，agent 角色化处理；重放不重复入会话；硬安全拦截（`checkInput.blocked`）维持短接不进模型（合规边界，见 §6）。
- 存量会话：纯重置（A 方案）。
- 角色卡：`character_prompts` 为编辑源，脚本合成同步（不用 FastClaw UI）。
- 模型配置本次不动。
- revision 1 依据独立审查修正：模板行范式、scope 信号、会话级去重、F8 路由与幂等、return-messages 接线、验证矩阵补 Go 侧命令等（见第 13 节）。
- revision 2 依据复审修正：USER.md per-user 注入路径（F2）、F1 按 roleplay 门控校验与回滚顺序（F1/§9.2）、F8 所有权规则与 F8/F9 ID 空间区分、P2 清单（ownerID 注入、AppendIfAbsent 同锁、F5 措辞、message-id 可选、Turn Context role、race 范围、回访生成器 scope）。
- revision 3 依据第三方复审：回滚顺序更正为「先 apps/api 再 FastClaw」（deployment.md L198）；硬安全拦截维持短接不进模型；AutoPersist 输出 schema 与 F7 路由表冻结；F2 补 per-chatter 会话注入与 ReloadWorkspaceFiles userID 重设。
- revision 4 依据第四轮复审：更正 revision 3 的「404」表述（resolveAgent 静默回退默认/首个 agent，见 §9.2）；新增 F10 回访生成不落库；补 P2-1..P2-9（旧 agent 保留、user_info 判别规则、assistant-first 验收、403 纵深防御定位、USER.md 写串行化、行号与措辞修正）。

## 3. 目标与非目标

### 3.1 目标

- 19 个 FastClaw Agent，一角色一 Agent，由 Agent 扮演并记忆；
- 记忆唯一事实源 = FastClaw `agent_files`：per-user 隔离 + `shared` / `script_<id>` 分文件；
- FastClaw 会话持有生成上下文（含历史 + compaction），模型首次真正看到对话历史；
- API 保留：微信登录、钱包/计费、输入安全预检、输出净化、幂等（clientMessageId）、消息持久化（UI/审计/回放）、聊天列表/会话入口、羁绊/成就/回访留言调度；
- 回访留言进 FastClaw 会话（F8 append，幂等、不触发副作用）；
- 存量会话纯重置。

### 3.2 非目标

- 不迁移存量 `memories` 表数据；
- 不做记忆展示页 / admin 记忆管理后台（后续单独安排）；
- 不改模型、temperature、maxTokens；
- 不做 FastClaw 会话 seed / rewrite 端点；
- 不做 roleplay 真流式（TTFT 优化）——本 Spec 明确 roleplay 为缓冲式输出；
- 不改造登录、支付、钱包、成就等业务模块。

## 4. 总体架构

~~~text
小程序
  -> apps/api（业务外壳：登录/钱包/计费/审核/消息持久化/幂等/羁绊/回访）
       -> Postgres（消息账本：UI 历史/审计/回放）
       -> FastClaw（每轮仅发：动态上下文 system + 当前用户消息；头：agentId/userId/sessionKey/scope/messageId）
            -> FastClaw Agent（角色卡 SOUL/IDENTITY(owner 行) + per-user MEMORY.md/USER.md(chatter 行) + 会话 + compaction）
                 -> FastClaw DB（agents / agent_files / sessions）
                 -> LLM（DeepSeek-V4-Flash）
~~~

职责边界：

| 归属 | 内容 |
|---|---|
| FastClaw | 角色卡（身份，owner 行）、per-user 记忆（chatter 行，shared/script 分文件）、会话/历史/compaction、生成、越界/OOS/改协议预检/重放/回访留言的角色化上下文（硬安全拦截不进入） |
| apps/api | 微信登录、钱包/计费、输入安全预检、输出净化、clientMessageId 幂等、消息持久化（UI/审计/回放）、聊天列表/会话入口、羁绊/成就、回访留言生成与投递（生成走角色 agent + 投递走 F8 append） |
| 双写 | 每轮用户/助手消息同时进 API Postgres（业务账本）与 FastClaw 会话（生成上下文）；双写失败边角靠幂等与重试兜底（见 §12） |

## 5. FastClaw 改动清单

### F1 请求头契约（`internal/api/openai.go` + `server.go`）

- 新增 `x-fastclaw-user-id` → `msg.UserID`（替代硬编码 `"api-user"`），校验：非空、长度 ≤64、字符集 `[A-Za-z0-9_-]`；**校验按 agent 的 roleplay 配置生效**：roleplay agent 缺失/非法返回 400；非 roleplay agent 缺失时回退 owner（保持旧行为，兼容上线/回滚窗口）。
- 新增 `x-fastclaw-scope` → 本次请求的记忆 scope（`free` | `script:<scriptId>`）；**roleplay agent 缺失返回 400，非 roleplay agent 缺失回退「无 scope」**。**scope 不得从 session key 推导**（chat_sessions.id 为 UUID，FastClaw 侧无法反推 mode/scriptId）。**scope 校验：`free` 或 `script:<[A-Za-z0-9_-]{1,64}>`，否则 400**（scriptId 会进入 `script_<id>/MEMORY.md` 文件名，正则防路径注入与跨 script 串扰）。
- 新增 `x-fastclaw-message-id`（= 产品 clientMessageId）→ 会话级去重（F9）；**可选**（产品 clientMessageId 非必填，缺失时 F9 跳过去重）；**映射到 `msg.MessageID`**（`bus.InboundMessage` L10 已有该字段，复用不新增字段）；F9 去重键仍需写入 `userMsg.Metadata.clientMessageId`（`MessageID` 本身不入库）。
- `server.go` `handleCORS` 允许头列表补 `x-fastclaw-user-id`、`x-fastclaw-scope`、`x-fastclaw-message-id`、`x-fastclaw-no-persist`。
- 说明：`msg.UserID` 目前在 agent 循环是死字段，F1 只负责把值接进来，**真正生效在 F2**。

### F2 per-(userID, scopeKey) 上下文（`internal/agent/loop.go` + `manager.go`）

- Agent 内维护 `sync.Map`，key = `(userID, scopeKey)`，value = `{memory, sessions, turnCount}`，懒加载；
- `HandleMessage` / `HandleMessageStream` 开头按 `msg.UserID` + `msg.Scope`（InboundMessage 增加 `Scope string` 字段）解析 per-user 上下文；
- `ContextBuilder` 浅拷贝：**`cb.userID = chatter`**（身份与记忆统一走 chatter 行，SOUL/IDENTITY/USER 经 F3 回退链取 owner 模板）——同时打通 per-user USER.md 注入：bootstrapFiles 含 USER.md、`loadFile` 按 `cb.userID` 读，chatter 行优先、owner 模板兜底；`scopeKey` 换当前 scope；
- **per-chatter 会话注入点**：`internal/gateway/userspace.go` L427 `session.NewStoreAdapter(st, userID)` 现按 owner（UserSpace.UserID）注入——改为 per-(userID, scopeKey) 懒加载构造（store userID = chatter），使 `sessions.user_id` 落 chatter（F8 所有权检查依赖此，见 F8）；
- `turnCount`（AutoPersist 触发）改 per-user；
- **并发安全为 P0**：`refreshSkillsFromStore` / `ReloadWorkspaceFiles`（loop.go L1196-1217）会替换 `a.memory`/`ctxBuilder`，per-user 缓存必须与这些共享 setter 的一致性一并处理（缓存副本 vs 热更新）；`runPostTurn` L926 的 turnCount 自增无锁本身有 data race，F2 一并解决；**`ReloadWorkspaceFiles`（loop.go L1211）重建 `ctxBuilder = NewContextBuilder(...)` 后不会重设 userID**（`NewContextBuilder` 不设 userID，`manager.go` L153 仅在 buildAgent 设一次）——F2 必须在该处重设 `cb.userID = chatter`，否则热更新后身份/记忆读取回到 owner/空。

### F3 模板回退语义落地（`MemoryStoreAdapter` / `store`）

- 读路径（`GetMemory`/`GetWorkspaceFile`）实现回退链：**chatter 行 → owner 行（模板）**；绝不引入 `user_id=''` 行（`migrateAgentFilesDropTemplate` 已清退，禁止回写）；
- `MemoryStoreAdapter` 构造增加 ownerID：`NewMemoryStoreAdapter(st, ownerID)`（唯一构造点在 `internal/gateway/userspace.go` L428，传入该 UserSpace 的 owner uid）；`GetMemory`/`GetWorkspaceFile` 先查 chatter 行，`ErrNotFound` 时查 owner 行；
- 写路径保持 per-user（chatter 行），只写当前用户；
- 角色卡（SOUL/IDENTITY/USER 模板）由 provisioning 写 **owner 行**（复用 setup system-files API，见 §7）；
- 效果：角色卡全用户共享，MEMORY.md/USER.md 每用户独立，模板行由 owner 行承担。

### F4 Roleplay 模式（`internal/agent/context.go` + `loop.go` + `internal/config/config.go`）

- `AgentEntry` / `AgentDefaults` 增加 `roleplay bool`（走现有 agents.config 机制）；
- `BuildSystemPrompt` 在 roleplay 下：跳过 runtime 前言、sandbox、skills、workspace self-update、group chat；只保留 bootstrap files（SOUL.md / IDENTITY.md / USER.md）+ Long-term Memory + 可选 thinking 段；
- `selectSystemPrompt` 在 roleplay 下：`SystemPromptOverride` 由「替换」改为「**追加为 Turn Context**」——**以 system role 消息插在 systemPrompt 之后、历史之前**（不得用 user role，避免污染用户侧语义）；
- roleplay agent 配置要求：`maxToolIterations=0`（纯文本路径，无工具）、tools 空、heartbeat 关、skills learner 关；**输出为缓冲式（假流），首字延迟 = 全量生成时间**（见 §12）。

### F5 AutoPersist 剧本杀化 + per-user（`internal/agent/memory.go`）

- 抽取 prompt 改为中文剧本杀口径，输出三类（与现有 API extractor 的 `MemoryType` 对齐：`user_info` / `relationship` / `story`）；**冻结输出 JSON schema（单条 JSON，无 markdown 围栏）**：`{"user_info": [...], "relationship": [...], "story": [...]}`；
- **`user_info` 子路由判别规则（冻结）**：命中「称呼/名字/喜欢/讨厌/偏好/最爱/习惯/职业/年龄」等用户画像关键词的条目 → `USER.md`（chatter 行）；其余 `user_info` 与 `relationship` → `shared/MEMORY.md`（判别函数与 API `extractor.ts` USER_INFO_PATTERNS 口径对齐，F5/F7 共用同一规则函数落地）；
- **新口径（非延续）**：只从用户消息提取事实，助手消息不回灌——需同时修改 AutoPersist 的输入过滤（现状 user/assistant 都喂）与 API extractor 口径（现状 RELATIONSHIP 用 combined）；
- 按 scope 路由写入（见 F7）；`turnCount` 按 per-user；
- 触发位置：`runPostTurn` 在非流式工具路径也会触发；准确表述是「**流式路径仅 no-tools 分支触发**；roleplay 恒走 no-tools，成立」；抽取失败静默降级（不阻塞主回复）。

### F7 记忆按 scope 分文件（`internal/agent/memory.go` + adapter）

- 文件名带 scope：`shared/MEMORY.md`、`script_<id>/MEMORY.md`（`agent_files.filename` 为 TEXT，路径式文件名兼容）；
- scope 由 `x-fastclaw-scope` 决定（F1），**不依赖 session key 推导**；
- free 模式：读写 `shared/MEMORY.md` + `USER.md`；
- script 模式：读 `shared/MEMORY.md` + `script_<id>/MEMORY.md` + `USER.md`；写入路由表（冻结）：
  - 称呼/偏好类 `user_info` → `USER.md`（chatter 行，跨模式全局）；
  - 其余 `user_info` / `relationship` → `shared/MEMORY.md`；
  - `story` → `script_<id>/MEMORY.md`（script 模式）；
  - **free 模式无 script 文件，`story` 候选丢弃**（沿用现有 API extractor 的 `canWriteStory` 门：`apps/api/src/server/modules/memory/service.ts` L81-84 仅 script 模式写 story；避免自由剧情事实经 shared 串入剧本模式，守住 AC-P0-03）；
- `USER.md` 保持 per-user 全局（称呼/偏好跨模式）。
- **`USER.md` 写路径串行化（P0 并发项）**：F2 后 free/script 各持独立 Memory 实例，AutoPersist 对同一 `(agent, chatter, USER.md)` 行 read-modify-write 无跨 scope 锁，双模式并发写会丢更新——随 F2 一并实现 per-user 写锁（或重读合并）；`-race` 测试覆盖双 scope 并发 AutoPersist。

### F8 回访留言 append 端点（`internal/api/` 新增）

- `POST /v1/sessions/{key}/messages`：入参 `{role, content, messageId}`；**必须携带 `x-fastclaw-agent-id`**（会话按 (user_id, agent_id, session_key) 隔离，session.Manager 是 per-agent 构造，路由层必须知道 agent）**与 `x-fastclaw-scope`**（与目标会话 mode/scriptId 一致；回访留言目标为自由会话 → `free`；校验同 F1）；`messageId` = 产品 `messages.id`（UUID），**与 F9 的 clientMessageId 是两个 ID 空间，语义不同**；
- 语义：只写入会话，**不触发生成、不触发 AutoPersist、不扣点、不加羁绊**；
- 幂等：`messageId` 写入该会话消息的 `provider.Message.Metadata`（随 `sessions.messages` JSON 落库，多副本/重启安全）；去重只匹配 `role=assistant` 且 Metadata.messageId 相同的消息，**避免与 F9（role=user + clientMessageId）交叉误判**；同 id 重复 append 静默跳过；
- 会话不存在时自动创建空会话再追加，**但先执行所有权检查**：`SELECT 1 FROM sessions WHERE agent_id=? AND session_key=? AND user_id != ?` 存在则返回 403（他人已占用的会话）；不存在才按当前 `x-fastclaw-user-id` 创建/追加；**check 与 create 非原子**（无事务/锁；PK `(user_id, agent_id, session_key)` 跨 user 不冲突，并发异 user 同 key 会各自建行）——FastClaw 侧 403 定位为**纵深防御、不承诺原子性**，主防线是 API 层 `chat_sessions.userId` 契约；
- **所有权检查依赖 F2 的 per-chatter 会话注入**：sessions Manager 必须以 chatter 为 store userID 构造（`userspace.go` L427 由 owner 注入改为 per-(userID, scopeKey) 懒加载，见 F2）；否则所有会话落在 owner 行，`user_id != chatter` 恒真 → 403 全拒；
- API 层契约：只对 `chat_sessions.userId == 当前用户` 的会话调用 append（chat_sessions 有 userId 列，`apps/api/src/server/db/schema.ts` L109-113）；
- 负向用例：他人 `x-fastclaw-user-id` 不得 append 进非本人会话（上述 403 规则）。
- **空会话 append 后首轮生成（assistant-first 历史）**：新会话历史为 `[system, assistant(留言), user]`，DeepSeek/SiliconFlow 对 assistant 开头历史的接受度未验证——§10 加验收；若 provider 拒绝，则限制 append 目标为非空会话或先补占位 user 消息。

### F9 chat completion 会话级去重（`internal/agent/loop.go`）

- 现状缺口：API 重试（generationAttempt+1）时 FastClaw 会话会重复 append 同一用户消息 → 模型上下文重复；
- 方案：新增 `Session.AppendIfAbsent`（持有 `s.mu` 的 check-then-append，`internal/session/manager.go` Append 同锁）——**check 与 append 必须在同一把锁内**，否则同进程并发重复调用仍可能双写；跨副本并发可接受（API 侧由 clientMessageId 串行）；
- 去重条件：`role=user` 且 Metadata.clientMessageId 相同；`x-fastclaw-message-id` 缺失时跳过 append 去重；
- 幂等存储与 F8 同机制（Metadata 随会话 JSON 落库）。

### F10 回访生成不落库（`internal/api/` + `internal/agent/loop.go`）

- 现状缺口：回访生成走 chat completion（`HandleMessageStream`），`loop.go` L1010 恒 `sess.Append(userMsg)`、L1054 append assistant、L576 `runPostTurn` → AutoPersist（L949-955）——**无 dry-run/只读模式**；带目标 session key 会把固定指令 append 进用户真实自由会话，缺 key 时 `openai.go` L105-108 生成随机 `api-<nanos>` 建孤儿会话，且 per-(user, scope) turnCount 推进到阈值会触发 AutoPersist 把固定指令抽成 `user_info`——违反 return-message spec「不触发记忆」与 F8「不触发 AutoPersist」不变量；
- 方案：为回访生成提供**不落库模式**——请求头 `x-fastclaw-no-persist: true`（或专用端点）：`HandleMessageStream` 在该模式下**不 append 会话、不触发 AutoPersist、不计 turnCount**；带目标 session key 时仅**只读加载**该会话历史作为生成上下文（读取不改写）；结束不建孤儿会话行；
- 语义：不扣点、不加羁绊（API 侧维持）；失败/超时仍走运营模板兜底（§6 generator 行）；
- 验收见 §10。

### 取消项

- ~~F6 会话 seed / rewrite 端点~~：存量会话纯重置（A 方案）+ 所有轮次都进上下文，不需要 seed 与排除重写。

## 6. apps/api 改动清单（瘦身）

| 模块 | 动作 |
|---|---|
| `db/schema.ts` | `characters` 增加 `agent_id varchar(64)`；seed 映射 19 角色 → 稳定 agent slug（如 `role-baizang`） |
| `chat/prompt-builder.ts` | 拆掉角色静态 prompt 组装；动态上下文 = 生产护栏 + 模式规则 + 剧本世界观 + 羁绊 + 称呼，作为每轮唯一 system 消息；删除 `extractUserRecap` 回查摘要逻辑 |
| `modules/memory/*`（extractor.ts / service.ts）与 `modules/chat/workflow.ts`（runChatCompletionEffects 中的记忆 effect） | 记忆 effect 退役；`memories` 表不再写入（验收断言增量=0） |
| `fastclaw/adapter.ts` | 传 `x-fastclaw-agent-id`（characters.agentId）+ `x-fastclaw-user-id`（userId）+ `x-fastclaw-session-key`（chat_sessions.id）+ `x-fastclaw-scope`（free \| script:<scriptId>）+ `x-fastclaw-message-id`（clientMessageId）；messages = [system(动态上下文), user(当前消息)]，**不再传 history** |
| `chat/stream-runner.ts` | 删除 clean history 组装；**硬安全拦截（`checkInput.blocked`）维持短接：不进模型、不扣点、保留 `blocked` 状态与 `excludedFromContext` 标记（现状不变）**；**改协议预检（`isProtocolProbe`）与越界/OOS 改为放行 agent 角色化处理**（agent 依 SOUL.md safety 指引化解；预检语义修订见 §11 output-protocol-sanitization spec），API 保留状态标记与审计；输出净化保留；重放（createReplayResponse）不调 FastClaw、不 append |
| `modules/return-messages/generator.ts` | 生成改用角色 agent：传 agentId + userId + **显式 `x-fastclaw-scope=free`** + **`x-fastclaw-no-persist: true`（F10 不落库：不 append、不触发 AutoPersist、不计 turnCount）**（回访只进自由会话）（+ 可选目标会话 session key **只读**获取上下文），不再走旧「角色 prompt + 固定指令直拼」路径；失败/超时仍走运营模板兜底 |
| `modules/return-messages/service.ts` | `deliverReturnMessage` 写库后调用 F8 append 到目标自由会话（messageId = messages.id），幂等重试 |
| `scripts/` | 新增 provisioning 脚本：`character_prompts` 5 字段 → `SOUL.md` / `IDENTITY.md` 渲染 → 幂等同步 FastClaw owner 行（见 §7） |
| `apps/api/src/app/api/ready/route.ts` | 校验 19 agent 存在 + roleplay/thinking=off 配置 |
| 下线 | miniapp 记忆页（`/api/memory`）、admin 记忆审核页（admin memories 路由） |
| 计费 | 硬安全拦截不扣点（现状）；越界/OOS 放行后平台承担（不扣点，记录 `out_of_scope`）；正常轮次照旧 |

## 7. 角色卡 provisioning 契约

- 编辑源：`character_prompts`（5 字段：system/personality/scenario/safety/outputFormat）；
- 脚本合成：
  - `SOUL.md` = 人格 + 剧情（scenario）+ 安全 + 输出风格；
  - `IDENTITY.md` = 身份/名字/关系起点；
  - `USER.md` = 初始为空模板（运行时由 AutoPersist 写入 per-user 称呼/偏好）；
- 目标：FastClaw `agent_files` **owner 行**（复用 setup server `PUT /api/agents/{id}/system-files/{name}`，或直连 DB 写 owner 行）；**禁止写 `user_id=''` 模板行**（`migrateAgentFilesDropTemplate` 会删除）；
- 要求：幂等（重复执行不产生重复/漂移）、可版本化、可 diff、可回滚（先备份 FastClaw volume）；不用 FastClaw UI。

## 8. 配置契约

- agent id：稳定 slug（如 `role-baizang`），写入 `characters.agent_id`；
- agent config：`roleplay:true`、`thinking:"off"`、`maxToolIterations:0`、tools 空、heartbeat 关、skills learner 关、`memory.autoPersist` 开启（every N turns，N 取默认 5 或实现时定）；model/maxTokens/temperature **不动**；
- `model_tier`（`chat_sessions.modelTier`，`apps/api/src/server/db/schema.ts` L114）保留为**纯计费/展示字段，不再参与模型选择**（roleplay agent 统一用角色 agent 的 model 配置；`modelProfiles` 仅用于计费口径）；
- 请求头契约：`x-fastclaw-agent-id` = characters.agentId；`x-fastclaw-user-id` = 产品 userId；`x-fastclaw-session-key` = 产品 `chat_sessions.id`；`x-fastclaw-scope` = `free` | `script:<scriptId>`；`x-fastclaw-message-id` = clientMessageId（**可选**）；`x-fastclaw-no-persist` = 回访生成不落库标记（**可选**，见 F10）。roleplay agent 下 user-id/scope 必填；非 roleplay agent 缺失时回退 owner/无 scope（F1）
- API key：apps/api 使用的 FastClaw API key 需可访问全部 19 个 agent。

## 9. 上线顺序与回滚

### 9.1 上线顺序

1. FastClaw 本地补丁（F1–F5/F7/F8/F9/F10）→ 单角色两用户端到端验证（记忆隔离 + 上下文连续 + 越界角色化 + 重试去重）；
2. provisioning 脚本创建/更新 19 个 agent + 角色卡同步（owner 行）；**旧默认 agent（`FASTCLAW_AGENT_ID`，当前 `agt_7c8acb3dde163e04bb`）在 API 切换完成前必须保留且保持非 roleplay**（provisioning 不得将其覆盖为 roleplay）——否则 `USE_ROLEPLAY_AGENTS=false` 回退与「新 FastClaw + 旧 API 兼容」（F1 门控下 roleplay 缺 user-id/scope → 400）均不成立；
3. apps/api 切换（保留旧路径开关 `USE_ROLEPLAY_AGENTS=false` 可一键回退）；
4. 生产小流量 → 全量；跑验收矩阵。

### 9.2 回滚

- 代码：apps/api 开关回退到旧路径（单 agent + API 组装 system prompt）并确认旧链路 smoke 通过；随后 FastClaw 镜像/配置回退到上一 tag。**回滚顺序：先 apps/api，再 FastClaw**（与 `docs/deployment.md` L198「回滚顺序相反（先回 apps/api 再回 FastClaw 镜像与配置）」一致）。理由：**新 FastClaw + 旧 apps/api 兼容**（F1 校验按 roleplay 门控，非 roleplay 请求缺 user-id/scope 时回退 owner/无 scope）；**旧 FastClaw + 新 apps/api 不兼容**：新 API 请求 19 个 roleplay agent，而旧 FastClaw `internal/api/openai.go` `resolveAgent`（L250-265）对未知 `x-fastclaw-agent-id` **不会 404**——回退 `DefaultAgent()`/`All()[0]`，静默用默认/首个 agent（现存单 agent `agt_7c8acb3dde163e04bb`）应答 → 角色错乱、会话/记忆落错 agent，属隐蔽故障；**回滚窗口以 `/api/ready` 的 19-agent 校验为哨兵**（新 API + 旧 FastClaw 时 ready 必失败，禁止停留），故 API 必须先回；
- 数据：无破坏性迁移（memories 表退役但不删除；agent_files/sessions 为 FastClaw 侧新数据）；
- 备份：部署前备份 FastClaw `fastclaw-data` volume；回滚后重跑健康检查与关键链路联调。

## 10. 验证矩阵

| 验收标准 | 验证方式 |
|---|---|
| FastClaw Go 侧构建与静态检查 | `cd fastclaw && go build ./... && go vet ./...` |
| 跨用户隔离：同 agent 两用户并发，A 的记忆不进 B 的上下文 | `go test -race ./internal/...`（覆盖 agent 与 api handler）+ 真实链路交叉验证 |
| scope 隔离：剧本剧情记忆自由模式不可见；**自由模式剧情候选（story）不进入剧本**（free 的 user_info/relationship 经 shared 双模式可见属设计内） | 单测（scope 头契约）+ 真实链路 |
| 记忆回查：`你还记得我喜欢什么吗` ≥80% 答出注入事实 | phase-a harness（恢复/重建，见下） |
| 上下文连续：同一产品会话跨多轮能引用早期对话 | 真实链路 A/B（对比改造前） |
| roleplay 缓冲式/TTFT：首字延迟 = 全量生成；API 超时（`FASTCLAW_TIMEOUT_MS`，默认 120s）按缓冲式验收 | 联调压测（firstDeltaAtMs 口径）+ 超时注入 |
| 重试去重：generationAttempt+1 重试不产生重复用户消息 | F9 单测（同 messageId 二次 append 跳过） |
| 越界/改协议预检角色化：meta 指令、越界输入由 agent 角色化化解，协议泄漏 = 0；硬安全拦截负向用例：`checkInput.blocked` 不调 FastClaw、保持 `excludedFromContext` | phase-a + leak 检查 |
| 回访留言：F8 append 幂等、按 agent+user 鉴权、不触发记忆/扣点/羁绊 | 单测（含负向：他人 user-id 拒绝） |
| 回访生成不落库：生成后目标会话消息数不变、USER.md/MEMORY.md 无固定指令残留、无新增孤儿会话行 | F10 单测（x-fastclaw-no-persist 模式）+ 真实链路 |
| 空会话 append 后首轮生成成功（assistant-first 历史兼容） | F8 单测 + 真实链路（provider 拒绝则按 F8 回退策略：限制非空会话或补占位 user 消息） |
| 无回归：幂等/计费/羁绊/审核仍走 API；memories 表增量 = 0；characters.agent_id 19/19；/api/ready 校验 19 agent | `pnpm --filter @juben-sha/api test`、typecheck + DB 断言 |
| provisioning 幂等/回滚 | 重复执行不漂移（diff 为空）；备份后回滚演练 |
| 回滚：`USE_ROLEPLAY_AGENTS` 开关两侧链路 smoke | 发布演练 |

> phase-a harness 说明：`scripts/phase-a-quality.mjs` 在主仓 `scripts/` 与 git 历史中均不存在（未跟踪），仅 `.worktrees/overnight-audit/apps/miniapp/e2e/artifacts/overnight/scripts/phase-a-quality.mjs` 存在审计快照；实现前将该 harness 恢复/重建到 `scripts/`（按旧 Spec 场景：6 角色 × 2 模型越界矩阵 / protocolLeaks / 记忆注入→回查对），记忆回查与越界/泄漏两行验收依赖它。

## 11. 文档同步

- `CONTEXT.md`：修订 `Excluded From Context` 语义（降级为 UI/审计标记，不再从生成上下文剔除）、`Return Message` 进 `Generation Context`（经 F8 append）、`Shared/Script Memory` 迁移 FastClaw（API `memories` 退役）、删除「API-owned」相关表述或改为「FastClaw Agent 实例」。
- `docs/adr/0001-api-owned-chat-context-and-client-message-id.md`：**推翻决策依据**——「依赖 FastClaw session history 会让 excluded 草稿泄漏回上下文」改为「excluded 消息由 agent 角色化吸收、进入生成上下文；API 仍是业务消息账本」；需新增 ADR 记录本架构。
- `docs/specs/2026-08-10-return-message-spec.md`（frozen）：**修订「留言永远不进入模型生成上下文」**（L25-27/L54）为「留言进入生成上下文（经 F8），仍不扣点/不加羁绊/不触发记忆与成就/不算成功回合」。
- `docs/specs/2026-08-12-chat-memory-fact-persistence-spec.md`（frozen）：**整条记忆管线退役**，标注被本 Spec 取代。
- `docs/specs/2026-08-12-chat-latency-scope-classifier-spec.md`（draft）：OOS 拦截语义变化（agent 角色化回复替代 OOS fallback + excluded），OOS 拦截率承诺需按新口径重评。
- `docs/specs/2026-08-12-chat-streaming-incremental-output-spec.md`（draft）：TTFT≤1.5s（P50）目标与 roleplay 假流（TTFT=全量生成）冲突——本 Spec §3.2/§12 明确 roleplay 为缓冲式输出，该 spec 的目标口径不适用于 roleplay agent；后续真流式另开 Spec 时重评。
- `docs/specs/2026-08-12-chat-output-protocol-sanitization-spec.md`（draft）：`isProtocolProbe` 预检短路被本 Spec 修订为「放行 agent 角色化处理」（硬安全拦截 `checkInput.blocked` 除外）；泄漏验收（protocolLeaks=0）保留。
- `docs/specs/2026-08-12-chat-p2-2-first-token-parallelization-spec.md`（PLANNED/draft）：其 API 侧首 token 并行化链路基于旧「API 组装 system prompt + clean history」链路——随本 Spec 链路变化需按新链路重评/部分被取代。
- `docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md`（frozen）：§7「FastClaw 只执行请求携带的 system message 和 clean history」被本 Spec 修订；§10「输入拦截/预检/越界消息必须 excludedFromContext 避免进入后续角色上下文」**部分修订**——**输入拦截（`checkInput.blocked`）维持短接与 excluded 不变；改协议预检与越界改为放行（不再 excluded）**。
- `docs/technical-spec-v1.md`：§7.3 修正「adapter 支持 x-fastclaw-session-key」漂移（实际未发送）；§7.4「记忆由业务后端结构化管理，不依赖 Agent 内部 Markdown 记忆作为唯一来源」被推翻。
- `docs/deployment.md`：FastClaw `fastclaw-data` 备份、agent 配置与发布顺序、**补 CORS 头清单**（新增请求头；代码在 `fastclaw/internal/api/server.go` `handleCORS`）。
- 产品不变量：AC-P0-03（两模式消息/clean history/剧情状态/story 记忆互不混用）依赖 `x-fastclaw-scope` 头契约成立；AC-P0-07（拦截/过滤/越界不加羁绊）维持（API 侧）。

## 12. 风险与取舍

- **双写一致性边角**：用户消息 API 先落库再调 FastClaw（失败可幂等重试，F9 防会话重复）；助手消息 FastClaw 生成后 API 落库失败则会话有/账本缺（UI 缺一条，下一轮模型记得，重试兜底）；回访留言 append 幂等（F8）。不引入对账任务（先记风险）。
- **回访生成副作用（P1）**：生成默认走 chat completion 会 append 进真实会话/触发 AutoPersist/建孤儿会话；F10 `x-fastclaw-no-persist` 不落库模式封堵，验收见 §10。
- **并发串台（P0）**：F2 per-user context 锁与 `-race` 测试钉死；`ReloadWorkspaceFiles`/`refreshSkillsFromStore` 热更新与缓存副本一致性一并处理。
- **假流 / TTFT**：roleplay（maxToolIterations=0）为缓冲式输出，首字延迟 = 全量生成时间；apps/api 流式协议（done 语义）不受影响，但 TTFT 验收与超时设计按缓冲式理解；真流式后续另开 Spec。
- **FastClaw vendored 维护**：改动集中、逐点补丁 + 文档；评估提上游 PR。
- **AutoPersist 抽取质量**：依赖 LLM，prompt 剧本杀化 + 只抽用户消息 + 回查验收兜底；抽取失败静默降级。
- **scope 头契约**：free/script 隔离依赖 `x-fastclaw-scope` 正确传递，API 侧必须按会话 mode/scriptId 生成；错误 scope 会导致记忆串模式（验收覆盖）。
- **compaction 阈值 80K** 对角色扮演偏高（长对话可能长期不触发）；本次不动，后续按角色调整。
- **存量会话纯重置**：老用户对角色失忆（已接受）；无存量记忆迁移。
- **phase-a harness 缺失**：验收依赖的 harness 不在主仓，需实现前恢复/重建。

## 13. 修订记录

- revision 0：draft → frozen（2026-08-14 意图对齐完成；用户确认：A 纯重置、API 保持消息持久化、回访留言进 FastClaw 会话、记忆页/管理后台下线、角色卡脚本同步、模型配置不动）。
- revision 1（2026-08-14，依据独立审查）：
  - P0-1：修正模板行范式——`migrateAgentFilesDropTemplate` 已清退 `user_id=''` 行，角色卡改走 **owner 行**（system-files API），F3 回退链改为 chatter → owner，禁止回写 '' 行；
  - P0-2：新增 `x-fastclaw-scope` 头契约（free | script:<scriptId>），F2/F7 的 scope 路由不再依赖 session key 推导；
  - P1-1：新增 F9 会话级去重（`x-fastclaw-message-id`），覆盖 API 重试导致用户消息双写；
  - P1-2：F8 补 `x-fastclaw-agent-id` 路由与幂等存储（Metadata 随会话 JSON 落库）+ 负向鉴权用例；
  - P1-3：§6 补 return-messages 模块接线（generator 走角色 agent、deliver 走 F8 append）；
  - P1-4：§2.3 修正 F5 口径（只抽用户消息为新口径，非延续）与假流事实（TTFT=全量）；
  - P1-5：§11 补全被推翻文档清单（return-message spec、memory-fact spec、latency spec、technical-spec §7.3/§7.4、2026-07-14 §10、AC-P0-03/AC-P0-07、ADR 0001 决策依据）；
  - P1-6：§10 验证矩阵补 Go 侧命令（go build/vet/test -race）、provisioning 幂等、F8 负向、memories 停写断言、agent_id 19/19、phase-a harness 恢复说明。
- revision 2（2026-08-14，依据复审）：
  - P1-A：F2 改 `cb.userID = chatter`（身份与记忆统一走 chatter 行 + F3 回退链），打通 per-user USER.md 注入（bootstrapFiles/loadFile 证据）；
  - P1-B：F1 校验按 agent roleplay 配置生效（非 roleplay 保持旧行为），§9.2 明确回滚顺序「先 FastClaw 后 apps/api」；
  - P1-C：F8 增加所有权可执行规则（session key 占用检查 403 + API 层 chat_sessions.userId 契约）；F8/F9 幂等按 role 区分 ID 空间；
  - P2：F3 写 NewMemoryStoreAdapter(st, ownerID) 注入点；F9 改 Session.AppendIfAbsent 同锁；F5 触发措辞修正；x-fastclaw-message-id 标注可选；F4 Turn Context 明确 system role；§10 race 范围扩到 ./internal/...；回访生成器补 scope=free。
- revision 3（2026-08-14，依据第三方复审）：
  - P1-1：**更正 revision 2 P1-B 的回滚顺序结论**——以 `docs/deployment.md` L198 为准，回滚顺序为**先 apps/api 再 FastClaw**（新 FastClaw + 旧 apps/api 兼容；旧 FastClaw + 新 apps/api 因角色 agent 不存在 → 404 不兼容）；§9.2 同步修订；
  - P1-2：F8 补 `x-fastclaw-scope` 必带（回访为 free）；F2 补 per-chatter 会话构造点（`userspace.go` L427 `NewStoreAdapter(st, userID)` 由 owner 注入改为 per-(userID, scopeKey) 懒加载），使 F8 所有权检查（sessions.user_id = chatter）成立；
  - P1-3：硬安全拦截（`checkInput.blocked`）维持短接不进模型（合规边界冻结）；越界/OOS/改协议预检放行 agent 角色化；§1/§2.4/§4/§6/§10 同步修订；
  - P1-4：F5 冻结输出 JSON schema（`user_info`/`relationship`/`story` 三类）；F7 补路由表——称呼/偏好 → USER.md、其余 user_info/relationship → shared、story → script（script 模式）；**free 模式 story 丢弃**（沿用 API extractor `canWriteStory` 门，守 AC-P0-03）；
  - P2：§2.3 行号修正（loop.go L1027、extractor.ts L86-88）；§6 路径修正（workflow.ts 在 chat/、ready 在 `apps/api/src/app/api/ready/route.ts`）；F2 补 ReloadWorkspaceFiles 重设 cb.userID（loop.go L1211）；F1 补 message-id → `msg.MessageID`（复用现有字段）与 scope 正则校验；§8 补 model_tier 纯计费口径；§10 补 TTFT/超时验收行；§11 补 3 个 draft/PLANNED spec 与 deployment.md CORS 表述；§2.3 phase-a 快照位置精确化。
- revision 4（2026-08-15，依据第四轮复审）：
  - P1-A：更正 revision 3 P1-1 的「404」表述——`resolveAgent`（openai.go L250-265）对未知 agent-id 回退 `DefaultAgent()`/`All()[0]`，不会 404 而是静默用默认/首个 agent 应答（角色错乱、会话/记忆落错 agent）；§9.2 补 `/api/ready` 19-agent 哨兵；
  - P1-B：新增 F10 回访生成不落库（`x-fastclaw-no-persist`：不 append、不触发 AutoPersist、不计 turnCount、目标会话只读）；§6 generator 行与 §10 验收同步；
  - P2-1：§9.1 补旧默认 agent 保留且非 roleplay 要求；
  - P2-2：F5 冻结 `user_info` 称呼/偏好判别规则；
  - P2-3：F8/§10 补空会话 assistant-first 首轮生成验收；
  - P2-4：F8 明确 check-create 非原子、403 为纵深防御；
  - P2-5：F7 补 USER.md 跨 scope 写串行化（P0 并发项）；
  - P2-6：F7 行号修正 service.ts L81-84；
  - P2-7：§8 行号修正 schema.ts L114；
  - P2-8：§1 限定语补硬安全例外；
  - P2-9：§10 scope 隔离措辞修正。
  - 收口（2026-08-15）：`x-fastclaw-no-persist` 登记进 §1/§8 请求头契约与 F1 CORS 允许头清单（F10 引入的新头，保持头契约单一事实源）。
