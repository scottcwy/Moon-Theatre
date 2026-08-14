# 聊天质量优化 Spec 3：记忆管线落地具体事实 + 去污染

日期：2026-08-12
状态：frozen（2026-08-12 复审通过；revision 1 附 1 处勘误，见修订记录）
修订号：1
适用版本：聊天体验迭代 V1.1 之后
变更标识：chat-memory-fact-persistence

> **取代标注（2026-08-14）**：本文档冻结的整条记忆管线（`extractor.ts`/`service.ts` 抽取、`memories` 表持久化、回查摘要注入）被 `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md`（revision 4，冻结）取代——记忆唯一事实源迁移到 FastClaw `agent_files`（per-user 多租户 + scope 分文件），API `memories` 表退役（不迁移存量数据）；本 Spec 不再实施。

## 1. 文档目的与冻结边界

本文档冻结「记忆抽取保留具体事实、story 记忆去污染、回查可召回」的实现边界。它改变记忆抽取/去重规则与回查上下文注入，**不改变 memories 表结构、不改变记忆作用域（shared/script）语义、不改变记忆注入 Prompt 的格式**。

冻结：
- USER_INFO/RELATIONSHIP/STORY 抽取规则与去重策略；
- 每轮写入上限；
- 回查摘要注入。

不冻结：具体记忆文案模板（可迭代）、记忆管理 UI（不在本 Spec）。

## 2. 现状与证据

- 代码：`apps/api/src/server/modules/memory/extractor.ts`（正则抽取 + `extract()` 返回固定串 + 兜底 `用户说：「…」`）；`apps/api/src/server/modules/memory/service.ts`（`extractAndUpsertMemories`，去重按 `type::scope::scriptId::content` 全等）。
- 审计证据（真实链路，DB `memories` 表）：
  - `我喜欢吃草莓，最喜欢下雨天。记住这一点。` → 存为 `user_info`「用户表达了偏好/情感倾向。」（**事实丢失**）。
  - story 垃圾条目：`地点「在北门下那具无名尸骨身旁断」被提及。`、`月见庭院中的事件被讨论。`（白藏 7 条、月岛澪 8 条，内容随回复变化无限增长）。
  - 用户 meta 指令「以后回复不要带情绪标签…」被兜底存为 story `用户说：「…」`（scope=script），进入后续剧本上下文。
  - 「注入→回查」14/14 失败：忘记（白藏/月岛澪/贺茂清玄）或编造（久远「红豆糕」、月岛澪「樱桃/糯米团子」、Qwen 白藏「蜜渍梅子/桂花糕」）。
  - 历史截断（`getCleanHistoryMessages` 20 条/6000 字）使早期事实只能靠记忆，而记忆又丢事实——系统性召回短板。

## 3. 目标与非目标

目标：
- 用户自述具体偏好/事实能落到记忆（如 `用户喜欢「草莓」`）；
- story 记忆不再产生重复垃圾；meta 指令不进 story；
- 回查（「你还记得…」）在真实链路下 ≥80% 可答出注入事实。

非目标：
- 不做语义向量检索/LLM 抽取（保持正则轻量）；
- 不改 memories 表结构/作用域；
- 不做记忆管理 UI。

## 4. 设计

### 4.1 抽取规则修订（`extractor.ts`）

1. `USER_INFO_PATTERNS` 的 `extract()` 返回**匹配内容**而不是固定串：
   - `(?:我喜欢|我讨厌|我害怕|我担心|我期待)(.{2,30}?)(?:。|，|$)` → `用户喜欢「草莓」`（取捕获组 1，按标点截断，最长 30 字）。
   - `(?:我的过去|我以前|我曾经)(.{2,40}?)` → `用户提及过往「…」`。
   - 名称/来源/职业规则同理保留捕获内容。
2. `STORY_PATTERNS` 收紧：
   - 丢弃「无实体内容」的固定串（`月见庭院中的事件被讨论。`、`关键剧情元素被提及。`、`地点「…」被提及。` 这类把**助手回复**当 story 的规则删除或要求必须包含用户消息片段）。
   - 只从**用户消息**中提取 story（剧情事实应由用户主动提供，不能把模型回复回灌成记忆）；`combined` 仅用于 RELATIONSHIP 判定。
3. 兜底规则：`用户说：「…」` 仅当用户消息命中剧情关键词（庭院/红线/契约等）才落 story；meta 指令不落库。meta 判定用**组合规则**而非单词命中：`（回复|输出|回答|格式|协议）` 且 `（不要|去掉|移除|请用|以后）` 同时命中才算（避免「你不要走」「请用茶」等正常剧情对话误判）。
4. 去重与替换（revision 1 澄清）：
   - 同 `(type, scope, scriptId)` 下**内容相同**去重（现状全等去重保留）；
   - **前缀/包含相似**去重仅覆盖「同一条事实的措辞变体」（如 `用户喜欢「草莓」` 与 `用户喜欢「草莓」和雨天` 视为同一事实，保留新值）；
   - **泛化固定串替换**：`extractor` 固定输出的泛化条目（以「用户表达了偏好/情感倾向」「用户提及过往经历」等开头）视为**过时条目**；写入新的具体事实时，对同 `(type, scope, scriptId)` 的过时条目执行 **delete + insert（或 `enabled=false`）**，避免新旧并存。该替换在 `service.ts` 现有 insert 基础上扩展（现 `service.ts:116` 仅 insert）。
   - 每轮写入上限 3 → 2。
5. 兼容：对已污染的旧数据提供一次性清理脚本（按内容正则删除上述垃圾 story 条目），作为迁移步骤（可选，数据量小可直接 DELETE）。

### 4.2 回查摘要注入（`prompt-builder.ts` + `stream-runner.ts`）

- 在 `buildSystemPrompt` 的 memories 注入前，从 clean history 中提取最近 1–2 条**用户自述偏好类**消息（`我喜欢/我讨厌/我来自/我是…`），生成 `已知信息：用户最近提到「…」` 追加进 Prompt（有去重，不重复注入）。
- 该摘要与 memories 注入共用同一个「已知信息」块，保持 Prompt 格式稳定。
- **实现路径（revision 1 澄清）**：`buildSystemPrompt` 目前**没有 history 参数**（`prompt-builder.ts:27-31` 只接收 character/script/context）；摘要必须在 `stream-runner.ts` 侧拼好再传入。具体二选一：
  a) `buildPromptContext`（`stream-runner.ts:361-392`）增加 `cleanHistory` 提取逻辑，把摘要并入返回的 `systemPrompt`；
  b) 在 `createPreparedGenerationResponse`（L329-333）拼装 messages 时注入摘要消息。
  推荐 (a)，与 memories 注入同一处组装。该改动使本 Spec **必然触碰 `stream-runner.ts`**（见第 6 节并行边界修订）。

### 4.3 代码位置

- `apps/api/src/server/modules/memory/extractor.ts`
- `apps/api/src/server/modules/memory/service.ts`
- `apps/api/src/server/modules/memory/__tests__/*`（extractor/service 测试）
- `apps/api/src/server/modules/chat/prompt-builder.ts`（回查摘要）
- `apps/api/src/server/modules/chat/stream-runner.ts`（`buildPromptContext` 或 `createPreparedGenerationResponse` 注入摘要，revision 1）
- 可选：`apps/api/src/server/modules/chat/__tests__/prompt-builder.test.ts`

## 5. 验证矩阵

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| `我喜欢吃草莓…` 落库为含「草莓」的 user_info | 单元测试 + DB 查询 | memories 表内容 |
| story 无重复垃圾（同一会话连续 10 轮新增 story ≤2 条） | 复用 `phase-a-quality.mjs` 长对话 + DB 查询 | memories 表增量 |
| **story 剧情事实仍可回查（正向）** | 用户主动提供地点/线索（如「北门的结界裂了」）后回查，角色能引用该地点/线索 | 单测 + phase-a 剧情注入→回查 |
| meta 指令不落 story | 单测 + DB 查询（`以后回复不要带情绪标签`） | memories 表 |
| 回查 ≥80% 答出草莓/雨天 | 复用审计「记忆-注入→记忆-回查」对（6 角色 × 2 模型） | phase-a 结果 |
| 记忆注入格式不变（`[记忆-…]` 不进正文） | 既有 leak 检查 | protocol-leak=0 |
| 无回归 | `pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/api typecheck` | CI |

## 6. 并行边界与合并顺序

- 改动文件：`memory/extractor.ts`、`memory/service.ts`、`memory/__tests__/*`、`chat/prompt-builder.ts`、`chat/__tests__/prompt-builder.test.ts`，以及 `chat/stream-runner.ts`（回查摘要注入，revision 1）。
- **与 Spec 1/2/4 存在 `stream-runner.ts` 重叠**（revision 1 修订：不再声明「无重叠」）：本 Spec 只动 `buildPromptContext`/`createPreparedGenerationResponse`（上下文组装段，L329-392），与 Spec 1（分类调用段 L556-577）、Spec 2（输出段 L511/703-720，内部为 `createGenerationResponse`，**非** `createPreparedGenerationResponse`，revision 1.1 勘误）、Spec 4（输入预检段 L116/154/204）**函数级不重叠**；合并顺序建议排在 Spec 2 之后，理由是**同文件多段并发 rebase 成本**的保守选择。
- 与 Spec 5 无重叠；`memory/*`、`prompt-builder.ts` 无其他并行 Spec 触碰。

## 6.1 发布与回滚

- 发布：随 API 常规发版；行为变化是「后续写入的记忆更具体、更少垃圾」，存量数据不受影响。
- 一次性清理脚本（4.1-5）为 **destructive DELETE**：执行前对 `memories` 表做 pg_dump 备份；脚本须幂等（重复执行不报错、不误删新数据），只删 `content` 命中垃圾模板的行；失败即中止并恢复备份。
- 回滚：代码回滚到 revision 0 行为（恢复旧 extract 固定串与旧 story 规则）；已写入的具体记忆保留（不回退数据，数据回滚仅当清理脚本误删时用备份恢复）。

## 7. 文档同步

- 实现后更新 `docs/technical-spec-v1.md` 记忆节（若行为口径变化：story 只取用户消息、每轮上限 2）；`docs/specs/2026-07-14-chat-experience-iteration-technical-spec.md` 8.3 记忆作用域节补充抽取规则修订说明。

## 8. 风险与取舍

- 收紧 story 抽取可能降低「剧情事实记忆」覆盖（模型不再自回灌）；因历史截断仍会保留最近 10 轮对话，短期影响有限。
- 回查摘要来自 clean history，超长对话早于截断窗口的事实仍需靠记忆表；与 Spec 2 无关，需长对话专项复测。

## 9. 修订记录

- revision 0：draft，基于 2026-08-12 夜间审计（`ai-chat-report.md` 1.5）。
- revision 1.1（2026-08-12，依据复审）：6 节理由措辞勘误——Spec 2 改的是 `createGenerationResponse` 内部输出段而非 `createPreparedGenerationResponse`；排序结论不变（Spec 3 在 Spec 2 之后），理由改为「同文件多段并发 rebase 成本」。复审结论：**可冻结**。
- revision 1（2026-08-12，依据 `/tmp/chat-spec-audit-2026-08-12.md` 审核）：
  - 修正第 6 节「无重叠」声明：回查摘要必经 `stream-runner.ts`（`buildPromptContext`/`createPreparedGenerationResponse`），合并顺序改为 Spec 2 之后；
  - 明确去重/替换语义：全等去重保留、前缀/包含仅覆盖措辞变体、**泛化固定串按 delete+insert（或 enabled=false）替换**；
  - meta 指令判定改为组合规则（回复/输出/格式 + 不要/去掉/请用），避免误伤正常对话；
  - 验证矩阵增加 story 剧情事实正向回查用例；
  - 新增 6.1 发布/回滚节（清理脚本备份/幂等/回滚）；验证命令改用 `pnpm --filter`。
