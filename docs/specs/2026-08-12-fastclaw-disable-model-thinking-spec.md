# FastClaw 模型级 Thinking 关闭能力 Spec

日期：2026-08-12
状态：frozen（2026-08-12 依据外部评审结论修订后冻结）
实现状态：IMPLEMENTED + VERIFIED（2026-08-12，代码与文档在同一 commit 落地，本地 harness 验证全部通过，见修订记录 revision 4）
修订号：1
适用版本：仓库内 FastClaw vendored 快照（`fastclaw/`，module `github.com/fastclaw-ai/fastclaw`）
变更标识：fastclaw-disable-model-thinking

## 1. 文档目的与冻结边界

本文档冻结「给 FastClaw 增加关闭**模型级** thinking（推理链）的能力」的实现边界。目标不是调整 FastClaw 现有的**提示词级** Thinking Mode（`off/low/medium/high/adaptive` 注入 `# Thinking Mode` 段落），而是让 `thinking: "off"` 同时向模型上游下发关闭推理链的请求参数，使 DeepSeek-V4-Flash（SiliconFlow）真正以非思考模式生成，降低 TTFT/延迟。

冻结：
- `thinking` 配置字段的语义扩展（`off` = 提示词级 + 模型级同时关闭）；
- FastClaw Provider 接口与两个实现的请求体改动；
- runtime-spec 新增 `thinking` 字段与 `/api/ready` 校验口径；
- 部署配置（helm / k8s / 生产 FastClaw agent）默认 `thinking: "off"`。

不冻结：未来把 `low/medium/high/adaptive` 映射为 API 思考强度（`enable_thinking: true` + `thinking_budget`）的决策（需新 Spec）；模型供应商切换（当前唯一上游 SiliconFlow，切换需重审参数口径）。

## 2. 现状与证据

### 2.1 模型层：DeepSeek-V4-Flash 支持关闭思考（官方文档已核实）

> **事实来源（2026-08-12 官方文档核实）**：
> - SiliconFlow API 参考（`https://api-docs.siliconflow.cn/docs/api/chat-completions-post`）：`enable_thinking`（boolean，`false|true`）「Switches between thinking and non-thinking modes」，为官方支持的请求参数；`reasoning_effort`（`high|max`）**仅适用于 `deepseek-ai/DeepSeek-V4-Flash`**，在思考模式下控制强度（low/medium 映射为 high、xhigh 映射为 max）；`thinking_budget`（128-32768）适用于多数推理模型。
> - SiliconFlow 模型页（`siliconflow.com/zh-tw/models/deepseek-v4-flash`）：V4-Flash 支持 Non-Think / Think High / Think Max 三种可切换推理模式。
> - DeepSeek 官方集成文档（`api-docs.deepseek.com/quick_start/agent_integrations/deepcode/`）：deepseek-v4 系列 `thinkingEnabled` 默认 `true`（即**默认思考开启**，需显式关闭）。
> - DeepSeek 官方 Thinking Mode 文档：OpenAI 兼容接口的关闭口径为 `thinking: {"type": "disabled"}`（需放 `extra_body`）；Anthropic 兼容接口（`/v1/messages`）同样为 `thinking: {"type": "disabled"}`。
> - 社区实测（CherryHQ cherry-studio#14782 等）：SiliconFlow 上关闭 DeepSeek 思考使用 `enable_thinking: false`，**不是** Anthropic 风格 `thinking: {type: disabled}`。

结论：
- **能确定关闭**：SiliconFlow 官方 API 对 DeepSeek-V4-Flash 支持 `enable_thinking: false` 切换到非思考模式；关闭后响应不再产出 `reasoning_content`（推理内容），直接输出 `content`（SiliconFlow 推理模型文档 3.1.2 的返回参数语义）。
- **Spec 口径成立**：OpenAI 兼容 provider（本项目唯一生产链路）发送 `enable_thinking: false`；Anthropic 兼容路径（非生产链路，仅单测）发送 `thinking: {"type": "disabled"}`。
- 注意事项：DeepSeek 官方文档声明「开启思考 + 携带 `tools` 的请求必须回传 `reasoning_content`，否则 400」。本项目业务链路 `maxToolIterations=0`（不传 tools），且关闭思考后无 `reasoning_content` 需回传，均不受影响；FastClaw 其他带工具场景若开启思考需自行满足回传要求。
- **2026-08-12 直连冒烟实测（本项目执行，两轮）**：直连 `https://api.siliconflow.cn/v1/chat/completions`，`model=deepseek-ai/DeepSeek-V4-Flash`、stream=true、`max_tokens=768`、`temperature=0.7`：

  **口径 1（自定义短消息，各参数 n=3，中位数）**

  | 参数 | 整轮耗时 | TTFT | reasoning_content |
  |---|---|---|---|
  | 默认（无参数） | 16.86s | 1.23s | 有（~2000-2400 tokens） |
  | `enable_thinking: false` | **2.28s** | **0.72s** | 无 |
  | `thinking: {"type": "disabled"}` | 2.92s | 1.04s | 无 |

  **口径 2（项目真实口径：白藏角色卡 system prompt 614 字 + 真实用户消息「你觉得勇气和温柔，哪个更难？」，各参数 n=5，中位数）**

  | 参数 | 整轮耗时 | TTFT | reasoning_content |
  |---|---|---|---|
  | 默认（无参数） | 5.01s（min 3.81 / max 19.49，有长尾） | 1.03s | 有（~230-300 tokens） |
  | `enable_thinking: false` | **2.42s**（min 1.80 / max 4.28，无长尾） | **0.93s** | 无 |
  | `thinking: {"type": "disabled"}` | 7.33s（n=3，TTFT 0.75-7.32s 波动大，不可靠） | — | 无 |

  结论：**SiliconFlow 上 `enable_thinking: false` 在两个口径下均真实关闭思考（响应无 `reasoning_content`）、整轮耗时降幅约 50%（项目口径 5.01s→2.42s）且消除长尾，为实测最优参数**，Spec 参数口径不变。`thinking: {"type": "disabled"}` 亦被 SiliconFlow 接受并能关闭思考，但实测波动大、无证据更快。与个别第三方实测（`thinking:disabled` 更快）存在出入，可能源于上游平台差异（DeepSeek 官方 vs SiliconFlow）或样本波动；本项目上游已确认为 SiliconFlow，最终仍以 FastClaw 真实链路 A/B 压测为准（见 §5 验证矩阵）。
- 实现时仍以真实链路冒烟为准（请求带参 + 响应无推理块），确认后铺开样本。

### 2.2 FastClaw 现状：thinking 只作用于提示词，不进入请求体

- 配置链路已完整：`fastclaw/internal/config/config.go:330`（`AgentDefaults.Thinking`）→ `:368-369`（Marshal）→ `:400`（`AgentEntry.Thinking`）→ `:589`（`ResolvedAgent.Thinking`）→ `:698` / `:712-713`（defaults 与 agent 级 merge）；`fastclaw/internal/gateway/userspace.go:309-310` / `:397-398`（agent-scope `agents.defaults` 覆盖）→ `fastclaw/internal/agent/loop.go:42,251`（Agent.thinking）。
- 提示词级行为：`fastclaw/internal/agent/context.go:228`（`if cb.thinking != "" && cb.thinking != "off"` 才注入 `# Thinking Mode` 段落）；`buildThinkingPrompt`（`:267-284`）只生成低/中/高/自适应四种措辞，未知值 `default: return ""` 静默不注入。
- Provider 请求体：`fastclaw/internal/provider/openai.go:48` `chatRequest` 仅有 `model/messages/tools/max_tokens/temperature/stream`，**无任何 thinking 字段**；`fastclaw/internal/provider/anthropic.go:47` `anthropicRequest` 同样无请求侧 thinking 字段（Anthropic provider 的 thinking 处理只在响应侧：`anthropic.go:193-216` 回放 thinking block）。
- Provider 接口：`fastclaw/internal/provider/provider.go:171-173`，`Chat/ChatStream` 平铺 `model, maxTokens, temperature` 参数，无 thinking。
- 调用点：`loop.go:552,697,1041` 三处 `a.provider.Chat`；另有 3 处内部调用经自由函数/结构体间接调用：`CompactMessages`/`compressOlderMessages`（compaction.go:47,120，调用方 slash.go:167、loop.go:642,1011）、`AutoPersistMemory`（memory.go:238，调用方 loop.go:952）、`SkillsLearner.extractSkill`（skills_learner.go:120，构造点 loop.go:170）；`ChatStream` 无生产调用点（接口保留）。
- 测试 mock：实现 Provider 接口的测试 mock 共 **3 处**（`runtime_spec_test.go:35,46`、`loop_stream_test.go:18,30`、`system_override_test.go:17,30`）；`internal/provider/` 下**无任何 provider 单测**。
- runtime-spec：`fastclaw/internal/agent/loop.go:500` `RuntimeSpec` 仅含 `id/model/maxTokens/temperature/maxToolIterations`，无 thinking。
- 项目 ready 校验：`apps/api/src/app/api/ready/route.ts` `checkFastClaw` 只校验 `maxTokens<=768` 且 `maxToolIterations=0`，不校验 thinking。
- 部署配置现状：`fastclaw/deploy/helm/fastclaw/templates/configmap.yaml` 与 `fastclaw/deploy/k8s/gateway.yml` 的 `agents.defaults` 均**未配置** `thinking`（空 = 提示词级不注入，但模型级思考按上游默认开启）。
- 生产网关端点事实：`fastclaw/internal/api/server.go:63-79` 仅注册 `/ws`、`POST /v1/chat/completions`、`GET /v1/agents`、`GET /v1/agents/{id}/runtime-spec`；`RegisterAdminRoutes`（`:85-87`）是 no-op——**生产网关没有 `/api/config` 端点**（`/api/config` 只存在于 setup server，`fastclaw/internal/setup/server.go:170-171`，不在生产链路）。

### 2.3 真实链路调用

`apps/api/src/server/modules/fastclaw/adapter.ts` 请求 `/v1/chat/completions` 只携带 `messages` + `stream`，模型与运行时参数完全由 FastClaw agent 配置决定（`x-fastclaw-agent-id`）。因此**关闭能力只需改 FastClaw 侧，apps/api 无需透传**。

## 3. 目标与非目标

目标：
- `thinking: "off"` 时，FastClaw 向模型上游请求体下发关闭推理链参数，模型不再产出 reasoning/thinking 块；
- 该能力可被 `/api/ready` 与 FastClaw 日志验证；
- 对未显式配置 `thinking` 的 agent 行为保持向后兼容（默认不改变现状）。

非目标（DECIDED）：
- 不把 `low/medium/high/adaptive` 映射为 API 思考强度参数（保持现状：仅提示词级）；
- 不改 apps/api 的 `/v1/chat/completions` 请求透传（agent 配置即可，YAGNI）；
- 不做请求级（per-request）thinking 覆盖；
- 不新增独立配置字段（复用 `thinking`，避免重复开关）；
- 不新增 thinking 配置值校验（YAGNI；`/api/ready` 严格 `off` 已兜底）。

## 4. 设计

### 4.1 语义决策（冻结）

| `thinking` 值 | 提示词级（现状） | 模型级（新增） |
|---|---|---|
| 空 / 未配置 | 不注入 | **不发送参数**（保持现状，向后兼容） |
| `off` | 不注入 | **发送关闭参数** |
| `low/medium/high/adaptive` | 注入对应段落 | **不发送参数**（本期不映射） |
| 其他 / 未知值 | 不注入（现状，context.go 静默返回空） | **不发送参数**；不新增配置校验（YAGNI，ready 严格 `off` 已兜底） |

### 4.2 FastClaw 改动清单（代码，REQUIRED）

1. **`internal/provider/provider.go`**：`Provider` 接口的 `Chat/ChatStream` 增加平铺参数 `thinking string`（与现有 `model/maxTokens/temperature` 平铺风格一致，不引入 options 结构体）。
2. **`internal/provider/openai.go`**：
   - `chatRequest` 增加 `EnableThinking *bool json:"enable_thinking,omitempty"`（指针以区分未设置，保持向后兼容；`thinking=="off"` 时置 `false`，其余值不设置）；
   - `buildRequest` 按上述规则填充；
   - `openai request` 日志增加 `enableThinking` 字段，且**每次请求都输出 `enableThinking=<bool>`**（无论是否 off，避免「没发参数」与「日志没打」歧义，作为线上审计主证据）。
3. **`internal/provider/anthropic.go`**：`anthropicRequest` 增加 `Thinking map[string]any json:"thinking,omitempty"`，`thinking=="off"` 时置 `{"type":"disabled"}`（DeepSeek /anthropic 兼容口径）；日志同步。**注意：当前生产链路 `apiType` 走 OpenAI provider（`manager.go:28` + `provider.go:187-188`），anthropic 请求体变更只能以 provider 单测验证，无真实链路证据，验收时不得误以为两条路径都有线上证据。**
4. **调用点与签名变更**（内部调用口径 DECIDED：与 agent 一致传 `a.thinking`，`off` 即全部关闭；若实现后发现质量退化，另开 Spec 调整，本 Spec 不留「可传空」的逃生口）：
   - `loop.go:552,697,1041` 三处 `a.provider.Chat` 直接传 `a.thinking`；
   - `CompactMessages`（compaction.go:47）与 `compressOlderMessages`（:120）为自由函数，需增加 `thinking string` 参数；调用方 `slash.go:167`、`loop.go:642,1011` 传 `a.thinking`；
   - `AutoPersistMemory`（memory.go:238）为自由函数，需增加 `thinking string` 参数；调用方 `loop.go:952` 传 `a.thinking`；
   - `SkillsLearner` 结构体（skills_learner.go:16）新增 `thinking` 字段，`NewSkillsLearner`（:25）增加参数；构造点 `loop.go:170` 传 `rc.Thinking`。
5. **`internal/agent/loop.go` `RuntimeSpec`**：增加 `Thinking string json:"thinking,omitempty"`，返回 `a.thinking`。
6. **测试（REQUIRED）**：
   - 新增 `internal/provider/openai_test.go`：httptest 捕获请求体，断言 `thinking=off` 时含 `enable_thinking:false`，空/`medium`/未知值时不含该字段；
   - 新增 `internal/provider/anthropic_test.go`：断言 `thinking=off` 时含 `thinking:{"type":"disabled"}`，其余不含；
   - 同步更新 3 处 Provider mock（`runtime_spec_test.go`、`loop_stream_test.go`、`system_override_test.go`）；
   - `internal/config/config_test.go` 补充 thinking 默认与 merge 用例（当前无覆盖）；
   - `internal/api/runtime_spec_test.go` 断言 runtime-spec 含 thinking。

### 4.3 项目侧改动清单（REQUIRED）

1. **`apps/api/src/app/api/ready/route.ts`**：`checkFastClaw` 增加 `thinking` 校验——要求 runtime-spec 的 `thinking === "off"`（显式）；缺失或非 `off` 视为不通过，错误信息标明 `required thinking="off"`。同步更新 `route.test.ts`（新增通过/失败用例）。
2. **部署配置**：
   - `fastclaw/deploy/helm/fastclaw/templates/configmap.yaml` 与 `fastclaw/deploy/k8s/gateway.yml` 的 `agents.defaults` 增加 `"thinking": "off"`；
   - 生产 FastClaw：**生产网关无 `/api/config` 端点**（见 §2.2），agent 配置更新按部署实况执行——更新 configmap / 数据卷 `fastclaw.json` 的 `agents.defaults.thinking="off"`，确保 `FASTCLAW_AGENT_ID` 对应 agent 生效；随后用 `GET /v1/agents/{id}/runtime-spec` 确认返回 `thinking=off`。
3. **验证脚本**：`scripts/deploy-config.test.mjs` 增加断言（helm/k8s configmap 含 `"thinking": "off"`），纳入 `pnpm run test:deploy-config`。

### 4.4 明确不做

- 不改 `fastclaw/internal/api/openai.go` 的 `chatCompletionRequest`（不透传，agent 配置即闭环）；
- 不改 `apps/api/src/server/modules/fastclaw/adapter.ts`；
- 不做 thinking 强度映射（见第 3 节非目标）；
- 不把关闭行为设为默认（空 = 不发送参数，避免 FastClaw 通用行为突变）；
- 不新增 thinking 值校验（见第 3 节非目标）。

## 5. 验证矩阵

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| `thinking=off` 时请求体带关闭参数 | FastClaw 单测（httptest 断言请求体）+ 真实链路 FastClaw 日志 `openai request ... enableThinking=false`；日志采集：本地审计为 `/tmp/fastclaw-console*.log`，生产按部署日志方案采集 | provider 单测；FastClaw 日志 |
| `thinking=off` 时模型不再产出推理块 | 真实 `/api/chat/stream` 响应无 `reasoning_content`/thinking 块；**先做 1 次冒烟确认后铺开 ≥10 次样本**（发 ≥10 次 `/api/chat/stream`，记录请求时间与 session id 以便对照日志） | 真实链路样本 ≥10 |
| 未配置/其他值不发送参数（向后兼容） | provider 单测断言空/`medium`/未知值请求体无 `enable_thinking` | provider 单测 |
| `/api/ready` 校验 thinking=off | `pnpm --filter @juben-sha/api test`（route.test.ts 新用例）；部署后 `GET /api/ready` 200 | 单测；部署检查 |
| 部署配置含 thinking=off | harness 行为验证：本地执行 `pnpm run test:deploy-config` 通过（根仓库无 CI，`docs/deployment.md:47`；命令即 AGENTS.md harness 验证命令） | 本地验证 |
| 无回归 | harness 行为验证：本地执行 `cd fastclaw && go test ./...`、`pnpm run test:dev-script`、`pnpm run test:deploy-config`、`pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/api typecheck` 全部通过（根仓库当前无 CI，不引用 CI 作为证据） | 本地验证 |
| 延迟不劣化 | 复用审计脚本对比 2026-08-12 基线（上游主生成 p50 3.10s）；关闭后预期下降，至少不劣化 | 审计报告 |
| anthropic 路径请求体正确 | provider 单测（当前生产链路不可达，无真实链路证据，见 §4.2 第 3 条） | provider 单测 |

## 6. 并行边界与合并顺序

- FastClaw 代码改动（4.2）与项目侧代码改动（4.3.1）无文件重叠，可并行开发，但**发布必须按序**：
  1. 先发 FastClaw 新镜像（`docs/deployment.md` 第 3 节 buildx 命令，tag `YYYYMMDD-<7位哈希>`，禁 `-dirty`）并完成 agent 配置 `thinking=off`；
  2. 再发 apps/api（含新 ready 校验）。回滚顺序相反：先回 apps/api，再回 FastClaw 镜像与配置；
  3. 旧 FastClaw（runtime-spec 无 thinking）遇到新 ready 校验应**失败**（安全失败，防止未配置上线），验收时按此预期处理；
  4. 新 FastClaw + 旧 apps/api：旧 ready 不识别 `thinking` 字段、直接通过，属可接受（旧版无此要求），**非回归**，实现时不得误判。
- 与 `2026-08-12-production-readiness-local-prep-spec.md` 的共存：该 Spec 已落地 `checkDatabase`（5s 超时）与 `route.test.ts` 的 DB mock 用例（现 `route.ts:13-44`）。本 Spec 唯一触碰共享文件为 `apps/api/src/app/api/ready/route.ts` 与 `route.test.ts`，**只扩展 `checkFastClaw`，不触碰 `checkDatabase`**，并保留其既有用例。
- 本 Spec 与 2026-08-12 并行会话其他 Spec（Spec 1-5）无重叠（后者不改 FastClaw 代码）。

## 7. 文档同步

- `docs/technical-spec-v1.md`：FastClaw agent 运行配置约束节补充 `thinking=off` 要求；
- `docs/deployment.md`：agent 配置要求与发布顺序补充；
- 根 `.env.example` 与 `apps/api/.env.example`（FASTCLAW_AGENT_ID 注释两处都有）：说明模型级思考默认关闭（如适用）；
- 本 Spec 状态随实现推进：实现完成后按修订记录更新（`IMPLEMENTED` / `VERIFIED` 标注），代码变更与文档更新在同一 commit。

## 8. 风险与取舍

- **质量影响**：关闭推理链可能改变角色扮演输出风格（更"直给"）。上线后需观察质量/泄漏/长度指标，若劣化明显，回滚=把 `thinking` 改回空/`adaptive` 并重发配置（代码无需回滚）。
- **参数口径耦合（外部事实）**：`enable_thinking: false` 是 SiliconFlow 官方口径（§2.1 已核实）；实现时先冒烟确认，若真实链路参数不同，以真实链路为准并修订本节。若未来切 DeepSeek 官方 API，需按 `thinking:{"type":"disabled"}` 调整（OpenAI provider 的字段构造集中在一处，切换成本低）。
- **空值兼容**：选择「空 = 不发送参数」而非「空 = 关闭」，避免 FastClaw 未配置 agent 行为突变；本项目通过显式 `thinking=off` + ready 校验保证闭环。
- **内部调用口径**：已 DECIDED 为与 agent 一致（§4.2 第 4 条），不留逃生口；若内部调用关闭后质量退化，另开 Spec 调整。
- **发布顺序**：违反 §6 顺序会导致 ready 误报或配置未生效即上线，发布负责人需按序执行。

## 9. 修订记录

- revision 0：draft，基于 2026-08-12 代码勘察（provider 请求体、配置链路、runtime-spec、ready 路由、部署配置）与用户决策（关闭模型级 thinking，先落 Spec 后推进改动）。
- revision 1（2026-08-12，依据外部评审结论修订后冻结）：
  - P1-1：§4.3.2 删除 `POST /api/config` 途径（生产网关无此端点），改为按部署实况更新 configmap/数据卷 + runtime-spec 验证；§2.2 补充网关路由事实；
  - P1-2：Provider mock 数量 4→3（§2.2、§4.2 第 6 条）；
  - P1-3：§4.2 第 4 条列出自由函数/结构体签名变更（CompactMessages/compressOlderMessages/AutoPersistMemory/SkillsLearner），内部调用口径定死为「与 agent 一致」，删除「可传空」逃生口；
  - P1-4：§5 验证矩阵 CI 主证据改为 harness 本地执行（根仓库无 CI）；
  - P2-1：§2.1 标注外部事实待确认，修正 Anthropic 兼容句自指问题；
  - P2-2：§4.1 语义表补充未知值行为；
  - P2-3：§4.2 日志字段定死为每次请求输出 `enableThinking=<bool>`；
  - P2-4：§5 补充日志采集路径与样本触发方式（先冒烟后铺开 ≥10 次）；
  - P2-5：§6 明确与 production-readiness Spec 共存（保留 checkDatabase，只扩展 checkFastClaw）；
  - P2-6：§7 明确根 `.env.example` 与 `apps/api/.env.example` 双处同步；
  - P2-7：§4.2 第 3 条与 §5 注明 anthropic 路径仅单测验证（生产链路不可达）；
  - P2-8：§6 补充「新 FastClaw + 旧 apps/api 正常通过，非回归」。
- revision 4（2026-08-12，实现落地）：§4.2/4.3 全部实现并完成本地验证——`cd fastclaw && go test ./...`、`rtk pnpm run test:dev-script`、`rtk pnpm run test:deploy-config`、`rtk pnpm --filter @juben-sha/api test`（ready route 7/7）、`rtk pnpm --filter @juben-sha/api typecheck`、`git diff --check` 全部通过；`cd fastclaw && go build -o bin/fastclaw ./cmd/fastclaw` 成功（产物被 git 忽略，未提交）。Spec 文件随实现分支一并提交（实现前未跟踪）。
  - 本地真实链路 A/B（新编译二进制 + `~/.fastclaw/fastclaw.db`，`agents.defaults.thinking=off`，白藏角色卡 + 12 条真实用户消息，n=12/臂，经 FastClaw `/v1/chat/completions`）：上游生成中位（provider elapsed）3.67s→1.49s（−59%，P50 落到 1.5s 级）；客户端整轮中位 5.81s→3.87s（−33%）；断流率 0/12（两臂）；响应均无 reasoning/thinking；off 臂 FastClaw 日志每次请求 `enableThinking=true`，基线臂每次 `enableThinking=false`。单次上游抖动异常（off 臂 #11 上游 10.88s）已记录，非参数口径问题。分类器失败率（apps/api `/api/chat/stream` 链路）与生产发布环境压测见任务 handoff 交接清单。
- revision 3（2026-08-12，参数冒烟后修订，仍 frozen）：§2.1 补充本项目两轮直连冒烟实测——(1) 自定义消息口径：`enable_thinking: false` 16.86s→2.28s、TTFT 1.23s→0.72s、无 reasoning；(2) 项目真实角色卡口径（白藏 + 真实用户消息，n=5）：默认 5.01s（有长尾 19.49s）→ `enable_thinking: false` 2.42s（无长尾）、无 reasoning，为三者最优；`thinking:{"type":"disabled"}` 亦被接受并能关闭思考，但实测波动大（7.33s 中位）无证据更快。参数口径不变，仍为 OpenAI 路径发 `enable_thinking: false`。
- revision 2（2026-08-12，官方文档核实后修订，仍 frozen）：§2.1「外部事实待确认」→「官方文档已核实」——SiliconFlow API 参考确认 `enable_thinking`（false|true）为官方参数、`reasoning_effort` 仅适用于 DeepSeek-V4-Flash；确认 V4 系默认思考开启、`enable_thinking: false` 后无 `reasoning_content`；补充「开启思考 + tools 需回传 reasoning_content 否则 400」的注意事项（本项目不传 tools、关闭思考，不受影响）。参数口径不变。
