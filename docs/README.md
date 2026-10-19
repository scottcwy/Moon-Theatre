# 文档索引与权威地图

> 最后更新：2026-10-20 · 基线提交 `1047c5b`
> 原则：代码现实优先；同一主题只保留一个权威来源；历史快照必须明确标注。

## 1. 按主题查文档

| 主题 | 权威文档 | 说明 |
| --- | --- | --- |
| 仓库协作与验证 | `AGENTS.md` | 命令、门禁、变更控制、handoff 规则 |
| 聊天领域词表 | `CONTEXT.md` | Client Message ID、Script/Free Mode、Bond、Return Message 等 |
| 当前技术架构 | `docs/技术开发架构与前后端文档.md` | 仓库结构、页面、模块、部署总览；不定义视觉权威 |
| V1 历史技术基线 | `docs/technical-spec-v1.md` | 仅供追溯 V1 方案；当前实现以代码和当前架构文档为准 |
| API 契约 | `docs/api-v1.md` | 45 个 API 路径的请求/响应说明；路径覆盖与代码对齐 |
| 部署与回滚 | `docs/deployment.md` | Docker Compose、镜像、域名、迁移、回滚 |
| 当前视觉系统 | `DESIGN.md` | 视觉摘要与实现状态；不定义逐帧验收 |
| H5 13 帧契约 | `docs/specs/2026-10-01-H5视觉到Taro生产前端-多Agent实施冻结Spec.md` | 未被第二份合同取代的帧仍是权威；被取代状态见 `docs/specs/README.md` §2.1 |
| UI 细节收口 | `docs/specs/2026-10-19-月满楼小程序UI细节打磨Spec.md` | tabbar、深色状态、E2E 结果、阻塞项 |
| 第二份合同 UI 前端更新 | `docs/specs/2026-10-19-第二份合同UI前端更新Spec.md` | 12 帧：8 非支付 + 4 支付 UI-only；覆盖范围内的视觉权威 |
| E2E 运行方式 | `apps/miniapp/e2e/README.md` | 构建、端口、`cli quit`、visual frames |
| 架构决策 | `docs/adr/` | 已接受/被取代的 ADR；0001 已被 0004 取代 |
| Spec 状态 | `docs/specs/README.md` | 所有 Spec 的状态、实现/验收状态和取代关系 |
| 证据与报告 | `docs/specs/evidence/`、`docs/reports/` | 截图、对比、验收报告；不是契约 |
| 角色卡内容资产 | `docs/工作流/角色卡产出/` | 内容生产工作流，不等同于工程契约 |

## 2. 文档生命周期

- **当前契约**：`AGENTS.md`、`CONTEXT.md`、`docs/api-v1.md`、`docs/deployment.md`、当前架构文档、第二份合同 UI Spec、H5 Spec（未取代部分）、UI 打磨 Spec（未取代部分）、`DESIGN.md`、E2E README。
- **历史基线**：`docs/prd-v1.md`、`docs/technical-spec-v1.md`、`docs/版本说明-dev.md`、2026-07-14 三个 Spec。历史文档保留追溯价值，但不得被当作当前实现状态。
- **H5 事实源**：`docs/specs/2026-09-16-新视觉H5全帧复刻与组件化验证.md` 保留 13 帧与截图事实；生产迁移状态以 2026-10-01 H5 Spec、2026-10-19 UI Spec 和 2026-10-19 第二份合同 Spec 为准。
- **执行层**：已完成的一次性 Plan 应删除或归档；不要把执行步骤长期留在 `docs/specs/`。
- **证据层**：`docs/specs/evidence/`、`docs/reports/`、`docs/assets/`。证据必须带日期、生成方式和对应 Spec。
- **内容层**：`docs/工作流/角色卡产出/`。按内容工作流维护，不参与代码双向同步。`docs/工作流/公共规范/` 三篇是内容工作流的占位规范，当前被多份角色卡文档引用，暂不作为工程契约删除；如要清理，需先统一更新内容侧引用。

## 3. 冲突处理

1. 同一主题有多份文档时，以本索引标注的权威文档为准。
2. 视觉冲突：第二份合同 UI Spec 覆盖的 12 个状态 > H5 13 帧 Spec / UI 打磨 Spec > `packages/miniapp-ui` tokens > `DESIGN.md`。未被第二份合同覆盖的帧仍以 H5 Spec 为准。
3. API 冲突：以代码路由和 `docs/api-v1.md` 为准；代码变更必须同步更新 API 文档。
4. 状态冲突：以 `docs/specs/README.md` 的状态矩阵和各 Spec 顶部状态为准；发现不一致时先修文档，不隐瞒。

## 4. 当前验证状态

- `test:e2e:smoke`：通过。
- `test:e2e:ui`：10/10 通过。
- `test:e2e:ui:auth`：22/22 通过。
- `test:e2e:visual-frames`：`BLOCKED`，开发者工具固定 `390×844`，要求 `375×812`。
- `test:e2e:visual-frames:second-contract`：已实现；整屏视觉门禁受开发者工具 `390×844` 阻塞，证据见 `apps/miniapp/e2e/artifacts/visual-frames-second-contract/`。
- 未完成：真机、真实登录、CDN、3x 资源复验。
