# 月满楼 H5 视觉到 Taro 生产前端实施冻结 Spec

> 状态：`FROZEN`
> 实现状态：`PLANNED`
> 基线：`H5` 分支 `cd7afac`

## 1. 目标

以已经确认的 H5 `design-pilot` 视觉为事实基线，用 Taro 生产前端重新实现同一套页面视觉、页面状态和交互，并通过微信开发者工具完成视觉与功能验收。

## 2. 已冻结的意图

- H5 `design-pilot` 是视觉参考和验收基线。
- 微信小程序运行 Taro 生产页面，不直接运行 `PilotFrame`。
- 生产页面必须使用真实路由、真实控制器、真实接口和现有业务状态模型。
- `PilotFrame`、`design-frames.json`、Figma 坐标和 H5 专用渲染器只用于设计验证、资产核对和截图对照。
- 本阶段的完成标准是视觉复刻，不是先建立一套与 H5 无关的通用组件风格。
- 页面视觉未达到 H5 基线时，不得以“组件已生成”或“功能可访问”标记完成。

## 3. 视觉事实源

视觉事实按以下优先级解释：

1. `docs/specs/evidence/2026-09-16-h5-all-frames/browser/` 中的已确认截图。
2. `apps/miniapp/playground/design-frames.json` 中的帧节点、文本、颜色、尺寸和状态数据。
3. `apps/miniapp/playground/assets/` 与 `apps/miniapp/playground/assets-manifest.json` 中的设计资产。
4. 本 Spec 与对应路由的现有业务契约。

H5 运行入口仍用于对照：

```text
pnpm --filter @juben-sha/miniapp dev:h5
http://localhost:10086/?frame=1-863
```

## 4. 视觉覆盖范围

| 帧 | 生产路由 / 状态 | 实现阶段 |
| --- | --- | --- |
| `1-773` | 登录页 | `PLANNED` |
| `1-863` | 首页默认态 | `PLANNED` |
| `1-1164` | 首页搜索激活态 | `PLANNED` |
| `1-387`、`1-494`、`1-626` | 聊天不同消息状态 | `PLANNED` |
| `1-1657`、`1-2325` | 角色详情首屏与长页 | `PLANNED` |
| `1-1766`、`1-1892`、`1-1987`、`1-2080` | 个人页登录、未登录和加载状态 | `PLANNED` |
| `1-2180` | 社区页 | `PLANNED` |

配额、分享、脚本选择等已有业务路由继续保持功能，不在没有对应 H5 帧的情况下自行扩展视觉范围；如后续增加设计帧，先更新本 Spec 再拆分任务。

## 5. Taro 实现边界

### 5.1 生产运行时

- 生产页面位于 `apps/miniapp/src/pages/`，共享视觉组件位于 `packages/miniapp-ui/src/`。
- 页面组件负责布局和渲染，控制器负责请求、状态和导航。
- 组件不得直接调用 API、storage 或路由。
- 视觉数值应沉淀为 tokens、布局组件或页面样式；不得在多个页面复制同一组魔法数字。
- 生产代码不得 import `design-pilot`、`design-frames.json` 或 H5 专用 frame renderer。
- 生产资源必须通过小程序可用的资源清单和路径加载，不依赖 H5 `location.search` 或 H5 copy 目录。

### 5.2 视觉复刻要求

每个页面至少复刻以下内容：

- 首屏布局层级、容器宽度、间距和安全区。
- 背景、主次文字、边框、圆角、阴影和状态颜色。
- 字体、字号、字重、行高和文本截断。
- 设计帧中出现的图片、图标、装饰和底部导航。
- loading、empty、error、unauthenticated、default 等已确认状态。
- 页面之间的入口、返回、tab 切换和 CTA 行为。

## 6. 多 Agent 开发拓扑

所有会话都从 `H5` 基线创建独立 worktree。页面 Agent 不直接修改主工作区，不互相 cherry-pick；由收口会话统一合并。

### 阶段 A：基础层会话

职责：建立复刻所需的最小基础能力。

允许修改：

- `packages/miniapp-ui/src/styles/`
- `packages/miniapp-ui/src/components/layout/`
- `packages/miniapp-ui/src/components/ui/`
- 资源解析和截图断言的公共测试工具

交付：

- 页面容器、顶部安全区、底部导航、基础文本、按钮、表面、图标和图片容器。
- H5 与 weapp 共用的颜色、字体、间距、圆角和阴影 tokens。
- 基础组件测试和一条可运行的 weapp 构建链。

门禁：基础组件测试、miniapp-ui 类型检查、`build:weapp:prod`、`verify:weapp`。

### 阶段 B：页面会话并行

页面会话必须基于阶段 A 的提交创建，并严格遵守文件所有权。

| 会话 | 页面范围 | 主要文件边界 |
| --- | --- | --- |
| Home | 首页默认态、搜索态 | `apps/miniapp/src/pages/home/**` |
| Auth/Profile | 登录、个人页及登录状态 | `apps/miniapp/src/pages/login/**`、`apps/miniapp/src/pages/profile/**` |
| Chat | 聊天列表、聊天消息状态 | `apps/miniapp/src/pages/chat/**` |
| Character | 角色详情首屏、长页和角色入口 | `apps/miniapp/src/pages/character/**` |
| Community | 社区页 | `apps/miniapp/src/pages/community/**` |

页面会话可以读取基础层，但不得修改其他页面目录、公共 tokens 或路由配置；发现公共缺口时写回收口清单，由基础层或收口会话处理。

每个页面会话必须交付：

- 对应 H5 帧到生产路由的映射。
- 真实状态驱动的 Taro 页面。
- 页面级 fixture / layout 测试。
- 开发者工具截图和 H5 对照记录。
- 页面自身的 typecheck、测试和构建结果。

### 阶段 C：路由与集成会话

职责：

- 在干净集成 worktree 合并基础层和所有页面提交。
- 处理 `app.config.ts`、自定义 tabbar、导航和跨页面状态的冲突。
- 检查页面间真实入口是否与 H5 帧映射一致。
- 不借集成阶段重写页面视觉，不新增未批准的设计。

### 阶段 D：验收会话

职责：

- 用微信开发者工具 CLI 构建并运行完整功能 E2E。
- 对每个 H5 映射帧截取 weapp 截图，与 H5 基线逐帧检查。
- 记录视觉偏差、功能失败、资源缺失和包体积。
- 只有视觉、功能和构建门禁全部通过，才生成验收提交。

## 7. 会话 Prompt 固定前缀

每个 Agent 的任务必须包含以下约束：

```text
阅读并遵守 docs/specs/2026-10-01-H5视觉到Taro生产前端-多Agent实施冻结Spec.md。
H5 design-pilot 是视觉基线；生产端必须用 Taro 页面复刻，不得直接把 PilotFrame 当生产页面运行。
只修改任务表中允许的文件范围；公共缺口写回，不跨页面目录修改。
完成后运行任务级测试、typecheck 和必要的 weapp 构建，提交真实验证结果。
不要把“功能可访问”当作“视觉完成”。
```

## 8. 合并顺序

1. 基础层会话先完成并通过门禁。
2. 从基础层提交创建 Home、Auth/Profile、Chat、Character、Community 页面 worktree。
3. 页面会话并行实现并各自提交。
4. 收口会话在干净 worktree 合并所有页面提交。
5. 集成会话完成路由、资源、构建和跨页面回归。
6. 验收会话执行微信开发者工具 E2E 和逐帧视觉检查。
7. 验收通过后，才把集成提交合并回 `H5`。

## 9. 验收门禁

必须全部满足：

- `pnpm run typecheck` 通过。
- `pnpm test` 通过。
- `pnpm run test:dev-script` 和 `pnpm run test:deploy-config` 通过。
- `pnpm --filter @juben-sha/miniapp build:weapp:prod` 与 `verify:weapp` 通过。
- 微信开发者工具 smoke、主路由 UI E2E 和认证错误路径 E2E 通过。
- 13 个 H5 帧均有对应生产路由或明确状态，截图对照无未解释的结构性偏差。
- 生产包不依赖 `PilotFrame`、`design-frames.json` 或 H5 专用 `location.search`。
- 验收报告记录基线提交、测试命令、截图路径、包体积和残余风险。

## 10. 变更规则

- 任何人不得单独改变本 Spec 的视觉源、生产边界、页面范围或合并顺序。
- 新增页面、设计帧、公共组件或资源策略，必须先更新本 Spec，再创建对应 Agent 任务。
- 旧的“直接把 H5 页面复制到 weapp”或“先做通用生产组件、视觉后补”的口径不适用于本任务。
