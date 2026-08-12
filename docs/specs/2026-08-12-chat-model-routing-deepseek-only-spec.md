# 聊天质量/延迟优化 Spec 5：模型路由收敛为 DeepSeek（Qwen 停用）

日期：2026-08-12
状态：frozen（2026-08-12 审核通过，见 `/tmp/chat-spec-audit-2026-08-12.md`）
修订号：1
适用版本：聊天体验迭代 V1.1 之后
变更标识：chat-model-routing-deepseek-only

## 1. 文档目的与冻结边界

本文档冻结「对话生成只使用 DeepSeek-V4-Flash，Qwen 停用且暂不配置降级」的实现边界。它收敛模型路由为单一模型，**不改变 model_tier（casual/standard/immersive）的对外契约与计费语义**。

冻结：
- 生产可用的模型集合（仅 DeepSeek-V4-Flash）；
- model_profiles 三档映射；
- FastClaw agent 配置要求（仅 DS agent）；
- 验证口径（model_usage_logs 只出现 DeepSeek）。

不冻结：未来重新引入第二模型的决策（需新 Spec）；模型供应商切换（SiliconFlow 可替换，不改本 Spec 结论）。

## 2. 现状与证据

- 代码现实：`apps/api/src/server/db/schema.ts` 的 `model_tier` 枚举与 `model_profiles` 表（casual/standard/immersive 三档，全部 `modelName=deepseek-ai/DeepSeek-V4-Flash`，seed `apps/api/src/server/seed/index.ts:45,55,65`）；`stream-runner.ts` 按 tier 查 `model_profiles` 取 `modelName` 与 `pointsPerCall`——**生产代码层无 Qwen 引用**（grep 确认；测试夹具 `chat/__tests__/service.test.ts:218,240,1009…` 仍以 `Qwen/Qwen3.5-32B` 作任意字符串，不构成风险，revision 1 注明以免误判）。
- 模型实际由 FastClaw agent（`x-fastclaw-agent-id` + agent 内 model 配置）决定；Qwen 仅存在于 FastClaw agent 运行时配置（本地审计环境为演示该问题而临时配置，生产若存在 Qwen agent 需停用）。
- 审计证据（真实链路对比，`ai-chat-report.md` 2.3）：
  - 服务端总时长：DeepSeek p50 4.7s / p90 8.3s / max 20.1s / mean 5.1s（n=460）；Qwen p50 6.0s / p90 20.2s / max 24.1s / mean 8.0s（n=58）。
  - 上游主生成：DS p50 3.10s / p90 4.34s；Qwen p50 3.45s / p90 10.86s / max 42.1s。
  - scope classifier：DS p50 2.13s / p90 3.80s；Qwen p50 3.35s / p90 10.0s（触顶）。
  - 质量：两模型泄漏/长度/记忆表现接近，Qwen 无优势（泄漏率还略高：1.4% vs 0.7%）。
- 用户决策（2026-08-12）：默认 DeepSeek，Qwen 直接不使用，降级暂不配置。

## 3. 目标与非目标

目标：
- 生产对话只调用 DeepSeek-V4-Flash；
- model_usage_logs / 请求日志可证明无 Qwen 调用；
- 移除/停用 Qwen agent 配置，避免误路由。

非目标：
- 不删除 `model_tier` 三档（计费与请求契约保留，三档仍映射到 DS）；
- 不做自动降级/故障转移（用户明确暂不配置）；
- 不改 FastClaw vendored 代码（若生产 FastClaw 有多 agent 需求，另开 Spec）。

## 4. 设计

### 4.1 改动清单

1. **DB/seed**（代码）：确认 `model_profiles` 三档 `modelName` 均为 `deepseek-ai/DeepSeek-V4-Flash` 且 `enabled=true`（现状已满足，无需迁移；若发现非 DS 行，更新 seed 并在 dev/prod 执行一次 UPDATE，不做结构性迁移）。
2. **FastClaw agent 配置**（部署/配置，非代码）：
   - 删除/停用 Qwen agent（或确保 `FASTCLAW_AGENT_ID` 只指向 DS agent）；
   - 确认 agent model 为 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`；
   - `FASTCLAW_FALLBACK_ENABLED` 保持 `false`（用户决策：不配置降级）。
3. **可观测**：确认 `model_usage_logs.modelName` 只出现 DeepSeek；新增告警规则：FastClaw 日志出现 `model=Qwen` 或 `model_usage_logs.modelName` 出现非 DeepSeek 时告警（后者仅配置级，前者为实际调用证据）。可选增强：`/api/ready` 健康检查校验 FastClaw agent model 为 DS（不阻塞本 Spec）。
4. **文档**：`docs/deployment.md` / `.env.example` 注明「仅支持 DeepSeek agent；Qwen 停用」。

### 4.2 明确不做

- 不新增 `enabled=false` 的 Qwen 行占位（YAGNI；真正停用 = 不配置）；
- 不改客户端 modelTier 逻辑；
- 不改 `@juben-sha/shared` 的 MODEL_TIER_COSTS。
- 回滚说明（revision 1）：本 Spec 的「改动」是配置/部署操作，回滚 = 重新启用 Qwen agent 并恢复 `FASTCLAW_AGENT_ID` 指向，无代码回滚。

## 5. 验证矩阵

| 验收标准 | 验证方式 | 主要证据 |
|---|---|---|
| 真实链路请求全部走 DeepSeek | 发 ≥30 次 `/api/chat/stream`；**主证据 = FastClaw 日志 `openai request ... model=deepseek-ai/DeepSeek-V4-Flash`**（唯一能证明实际调用模型的证据）；`model_usage_logs.modelName` 仅证明配置标签一致，降为配置检查 | FastClaw 日志采集（本地审计为 `/tmp/fastclaw-console*.log`，生产按部署日志方案采集） |
| Qwen agent 不存在/禁用 | 查询 FastClaw agent 列表（`GET /api/agents`） | 部署检查 |
| model_profiles 三档均 DS | SQL 查询 | DB |
| 延迟基线不劣化 | 复用审计 `parse-api-logs.mjs` 对比 2026-08-12 基线 | p50/p90 |
| 无回归 | `pnpm --filter @juben-sha/api test`、`pnpm --filter @juben-sha/api typecheck` | CI |

## 6. 并行边界与合并顺序

- 代码改动极小（seed 校验/文档），**与 Spec 1–4 完全无重叠**，可任意并行；
- FastClaw 配置停用 Qwen 属部署操作，与代码 PR 独立执行，验收项不阻塞代码合并。

## 7. 文档同步

- `docs/deployment.md`、`apps/api/.env.example`、`docs/technical-spec-v1.md` 模型节。

## 8. 风险与取舍

- 单模型无降级：若 SiliconFlow/DS 故障，对话直接失败（用户已确认暂不配置降级；后续如需降级，建议 Qwen 作为 fallback 并单独设定超时，另开 Spec）。
- 审计环境切换模型的临时配置已还原为 DS（`switch-model.mjs ds`），与生产一致。

## 9. 修订记录

- revision 0：draft，基于 2026-08-12 夜间审计（`ai-chat-report.md` 2.3）与用户 2026-08-12 决策。
- revision 1（2026-08-12，依据 `/tmp/chat-spec-audit-2026-08-12.md` 审核，状态 → frozen）：
  - 验收主证据改为 FastClaw 日志 `model=`（实际调用证据），`model_usage_logs` 降为配置检查；
  - 注明测试夹具 `service.test.ts` 的 Qwen 残留为无害任意字符串；
  - 补充 `/api/ready` 可选校验与回滚说明（配置级）；
  - 验证命令改用 `pnpm --filter`。
