# Spec 状态矩阵

> 最后更新：2026-10-20 · 基线提交 `1047c5b`
> 维护规则：新增或修改 Spec 时，同一提交更新本表；状态词见下。

状态词：

- `IMPLEMENTED`：代码已存在（已实现）。
- `VERIFIED`：实现已通过对应验证（已验证）。
- `PARTIAL`：部分实现或验收未闭环（部分实现）。
- `SUPERSEDED`：已被更新 Spec 取代（已取代），保留追溯。
- `SUPERSEDED_IN_PART`：部分状态/条款被新 Spec 取代，其余仍有效（部分取代）。
- `NOT_IMPLEMENTED`：未实现或未批准（未实现）。
- `BLOCKED`：实现存在但验收受环境阻塞（验收阻塞）。

## 1. 产品与聊天体验

| Spec | 状态 | 实现 / 验收 | 备注 |
| --- | --- | --- | --- |
| [V1.1 聊天体验产品 Spec](./2026-07-14-chat-experience-iteration-product-spec.md) | `VERIFIED` | 已实现 | V1.1 历史基线，后续以更新 Spec 为准 |
| [V1.1 聊天体验前端 Spec](./2026-07-14-chat-experience-iteration-frontend-spec.md) | `VERIFIED` | 已实现 | P0/P1 已落地 |
| [V1.1 聊天体验技术 Spec](./2026-07-14-chat-experience-iteration-technical-spec.md) | `FROZEN / IMPLEMENTED` | 已实现 | revision 2 |
| [回访留言 Module 7](./2026-08-10-return-message-spec.md) | `FROZEN / IMPLEMENTED` | API、调度器与测试已存在 | 词表见 `CONTEXT.md` |
| [聊天审计非冲突修复](./2026-08-12-chat-audit-nonconflicting-fixes-spec.md) | `IMPLEMENTED` | A-E 审计批次已合入 | 逐项状态按当前代码复核 |
| [聊天入口统一与历史一致性](./2026-08-12-chat-entry-unification-spec.md) | `IMPLEMENTED` | 聊天列表进 free、按 scope 加载历史 | Logo/红点细节按当前代码复核 |
| [Scope classifier 去阻塞](./2026-08-12-chat-latency-scope-classifier-spec.md) | `IMPLEMENTED` | `scope-classifier` 与测试已存在 | OOS 语义被 2026-08-14 架构 Spec 修订 |
| [协议输出加固](./2026-08-12-chat-output-protocol-sanitization-spec.md) | `IMPLEMENTED` | `output-sanitizer` 与测试已存在 | `isProtocolProbe` 语义被 2026-08-14 修订 |
| [增量放行流式输出](./2026-08-12-chat-streaming-incremental-output-spec.md) | `IMPLEMENTED` | `incremental-buffered` 与测试已存在 | TTFT 目标不适用于 roleplay agent |
| [模型路由收敛 DeepSeek](./2026-08-12-chat-model-routing-deepseek-only-spec.md) | `FROZEN / IMPLEMENTED` | 模型路由已按 DeepSeek-only 落地 | Qwen 已停用 |
| [FastClaw 模型级 Thinking 关闭](./2026-08-12-fastclaw-disable-model-thinking-spec.md) | `VERIFIED` | 已实现并验证 | revision 4 |
| [记忆管线具体事实 + 去污染](./2026-08-12-chat-memory-fact-persistence-spec.md) | `FROZEN / IMPLEMENTED` | 记忆模块与测试已存在 | 与 2026-08-14 架构兼容 |
| [生产就绪本地准备](./2026-08-12-production-readiness-local-prep-spec.md) | `IMPLEMENTED` | 本地准备已落地；`test:deploy-config` 通过 | 服务器发布状态另行确认 |
| [FastClaw 角色 Agent 架构](./2026-08-14-fastclaw-roleplay-agent-architecture-spec.md) | `FROZEN / IMPLEMENTED` | 代码与测试已落地；ADR 0004 已接受 | revision 4 |
| [首 token 并行化 P2-2](./2026-08-12-chat-p2-2-first-token-parallelization-spec.md) | `SUPERSEDED / NOT_IMPLEMENTED` | 未实现 | 基于旧 API 组装链，已被 2026-08-14 架构 Spec 取代 |

## 2. H5 视觉与生产迁移

| Spec | 状态 | 实现 / 验收 | 备注 |
| --- | --- | --- | --- |
| [Miniapp H5 Playground](./2026-09-15-miniapp-h5-playground-spec.md) | `VERIFIED` | 本地设计工具已实现 | 不是生产交付物 |
| [H5 全帧复刻与组件化验证](./2026-09-16-新视觉H5全帧复刻与组件化验证.md) | `VERIFIED / IMPLEMENTED` | H5 13 帧已验证；生产迁移已落地 | 生产状态见 2026-10-01 Spec；第二份合同部分取代 |
| [H5 视觉到 Taro 生产前端](./2026-10-01-H5视觉到Taro生产前端-多Agent实施冻结Spec.md) | `IMPLEMENTED / PARTIAL / SUPERSEDED_IN_PART` | 功能 E2E 通过；13 帧视觉 `BLOCKED` | §2.1 列出的 5 个状态由第二份合同 Spec 取代；其余帧仍有效 |
| [UI 细节打磨](./2026-10-19-月满楼小程序UI细节打磨Spec.md) | `IMPLEMENTED / PARTIAL / SUPERSEDED_IN_PART` | smoke、UI、认证 UI 通过；视觉门禁 `BLOCKED` | 功能结论仍有效；被取代帧的视觉细节以第二份合同 Spec 为准 |
| [第二份合同 UI 前端更新](./2026-10-19-第二份合同UI前端更新Spec.md) | `FROZEN / IMPLEMENTED / VISUAL_BLOCKED` | 12 帧代码与 harness 已落地；smoke/UI/auth 通过 | revision 3；支付只读真实数据；8/9 整屏 `BLOCKED`；5/6/7 键盘未弹出；开发者工具 `390×844` |

### 2.1 第二份合同逐帧取代矩阵

只标真正被替换的状态；`KEEP` 表示旧帧仍是当前基线。

| 旧帧/状态 | 新帧 | 状态 |
| --- | --- | --- |
| `1-773` 登录页 | — | `KEEP` |
| `1-863` 首页默认 | `1030:2153` | `SUPERSEDED` |
| `1-1164` 首页搜索 | `1030:2580` + `1030:2752` | `SUPERSEDED` |
| `1-387` 聊天空态 | `1030:1731` | `SUPERSEDED` |
| `1-494` 聊天输入聚焦 | — | `KEEP` |
| `1-626` 聊天已有回复 | — | `KEEP` |
| `1-1657` 角色详情首屏 | — | `KEEP` |
| `1-2325` 角色详情长页 | — | `KEEP` |
| `1-1766` 个人页已登录 | — | `KEEP` |
| `1-1892` 个人页未登录 | — | `KEEP` |
| `1-1987` 个人页 loading | `1030:2331` | `SUPERSEDED` |
| `1-2080` 聊天列表未登录拦截 | — | `KEEP`（不被 4/5 替换） |
| `1-2180` 社区空态 | — | `KEEP` |
| 现有聊天列表搜索 | `1030:2424` + `1030:2514` | `NEW_STATE` |
| 现有分享预览 | `1030:3028` | `NEW_VISUAL`（无旧 H5 帧） |
| 现有 quota buy/result | `1030:2823` / `2932` / `3196` / `3331` | `NEW_VISUAL`（支付逻辑不变） |

## 3. 已删除/待归档

- 单帧 Pilot `2026-09-16-新视觉pilot-1:863-效果验证.md`：已删除，由 H5 全帧文档取代。
- `docs/minipowers/plans/2026-08-03-p0-seven-module-alignment.md`：已完成的一次性执行 Plan，已删除，历史版本保留在 git 历史中。
- `docs/工作流/公共规范/` 三篇：角色卡工作流占位文件，不属于工程 Spec；保留给内容工作流，不纳入本矩阵。
- `2026-09-15-月满楼新视觉-设计事实层口径与资产账本.md`：Figma 设计事实层计数、取数口径与资产账本；数字由 `scripts/design-facts.mjs` 产出。

## 4. 证据入口

- 视觉截图与像素对比：`docs/specs/evidence/`
- E2E 截图：`apps/miniapp/e2e/artifacts/`
- H5 迁移验收快照：`docs/reports/2026-10-01-h5-visual-migration-acceptance.md`
