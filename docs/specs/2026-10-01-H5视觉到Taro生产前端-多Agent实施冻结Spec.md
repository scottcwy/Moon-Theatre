# 月满楼 H5 视觉到 Taro 生产前端实施冻结 Spec

> 状态：`FROZEN`
> 实现状态：`PLANNED`
> 实施基线：`H5` 分支 `cd7afac`（H5 design-pilot 已完成的基线）
> 冻结日期：2026-10-01

## 1. 文档口径与基线

本 Spec 以 `cd7afac` 重新开始生产端迁移。当前工作不从历史生产组件迁移提交继续，也不把 H5 Playground 当作生产页面。

| 材料 | 本轮取舍 |
| --- | --- |
| `docs/specs/2026-09-16-新视觉H5全帧复刻与组件化验证.md` | 保留为 H5 事实源、截图证据和“有意偏差”来源；其中关于生产迁移边界、Agent 所有权和验收流程的旧口径由本 Spec supersede。 |
| `refs/backup/H5-pre-design-pilot-reset` | 仅作历史参考，不纳入本轮任务，不 cherry-pick、不合并。 |
| 历史生产组件迁移提交（包括 `2688f28` 链） | 视为已废弃的尝试；不作为本轮基线。 |
| 历史提交 `acb7357` 中的 H5 生产组件 E2E 验收记录 | 仅记录历史尝试。其“视觉对比、真机、真实登录未完成”和认证 mock 被端口阻塞的结论仍有效，不得当作本轮验收通过。 |

H5 设计已验证只代表 13 帧 Playground 的渲染完成；生产 Taro 页面、真实路由、资源策略、真实登录和微信开发者工具验收仍处于 `PLANNED`。

## 2. 目标与不可变边界

- 以已经确认的 H5 `design-pilot` 视觉作为生产端的事实基线，用 Taro 页面复刻同一套布局、状态和交互。
- 微信小程序运行 `apps/miniapp/src/pages/` 下的生产页面，不直接运行 `PilotFrame`。
- 生产页面使用现有真实路由、控制器、接口和业务状态模型；视觉验收可以使用确定性 fixture，但 fixture 不得进入生产业务分支。
- `PilotFrame`、`design-frames.json`、Figma 坐标和 H5 专用渲染器只用于设计核对、资源核对和截图对照。
- 生产代码不得 import `design-pilot`、`design-frames.json` 或依赖 H5 的 `location.search`、H5 copy 目录。
- 没有通过逐帧视觉验收的页面，不得以“组件已生成”或“功能可访问”标记完成。

## 3. 视觉事实源与允许偏差

视觉事实按以下优先级解释：

1. `docs/specs/evidence/2026-09-16-h5-all-frames/browser/` 的 13 张已确认 H5 截图。
2. `apps/miniapp/playground/design-frames.json` 的帧节点、文本、颜色、尺寸和状态。
3. `apps/miniapp/playground/assets/` 与 `apps/miniapp/playground/assets-manifest.json` 的设计资产。
4. 本 Spec 定义的生产路由、状态和业务契约。

必须复刻：首屏层级、容器宽度、间距、安全区、背景、文字层级、边框、圆角、阴影、字体参数、设计帧内的图片/图标/装饰、底部导航，以及已确认的 loading、empty、error 和 unauthenticated 状态。

以下偏差已经批准，不能在验收中判为失败，也不能由 Agent 自行扩展：

| H5 事实 | 生产口径 |
| --- | --- |
| 状态栏、微信胶囊、Home Indicator | 不重建，由微信系统提供；视觉 diff 使用批准遮罩排除。 |
| `使用微信登陆` | 生产显示 `登录`。 |
| `CONVERATION ARCHIVE / SEALED` | 生产显示 `CONVERSATION`。 |
| `灯时` | 生产显示 `点数`。 |
| `999`、`1`、`89/200` | 不渲染这些占位数字；使用真实字段，缺少字段时留空或走已批准空态。 |
| `文本内容…`、`玩家文本…`、`文字文字…`、`回应白藏...`、`YUE MANLOU` | 不渲染这些占位文本；不得用新的随机文案替代。 |
| H5 的本地 mock 数据 | 只在 H5 和视觉验收 fixture 中使用；生产页面仍走真实控制器和接口。 |
| H5 默认字体 | 使用现有系统字体栈；MiSans 只保留为 H5 `&font=misans` 对照，不新增生产字体依赖。 |

## 4. 13 帧生产映射

`1-2080` 明确属于聊天列表的未登录拦截状态，不属于个人页。

| 帧 | 生产路由 / 状态 | 登录态 | 实现阶段 |
| --- | --- | --- | --- |
| `1-773` | `pages/login/index` / 登录页 | logged-out | `PLANNED` |
| `1-863` | `pages/home/index` / 首页默认 | anonymous，使用公开剧本 fixture | `PLANNED` |
| `1-1164` | `pages/home/index` / 首页搜索激活 | anonymous，使用公开剧本 fixture | `PLANNED` |
| `1-387` | `pages/chat/index` / 空聊天态 | logged-in | `PLANNED` |
| `1-494` | `pages/chat/index` / 输入框聚焦态 | logged-in | `PLANNED` |
| `1-626` | `pages/chat/index` / 已有回复态 | logged-in | `PLANNED` |
| `1-1657` | `pages/character/detail` / 角色详情首屏 | logged-in | `PLANNED` |
| `1-2325` | `pages/character/detail` / 角色详情完整长页 | logged-in | `PLANNED` |
| `1-1766` | `pages/profile/index` / 个人页已登录 | logged-in | `PLANNED` |
| `1-1892` | `pages/profile/index` / 个人页未登录 | logged-out | `PLANNED` |
| `1-1987` | `pages/profile/index` / 个人页 loading | logged-in，接口 pending | `PLANNED` |
| `1-2080` | `pages/chat/list` / 登录拦截、登录转跳 | logged-out | `PLANNED` |
| `1-2180` | `pages/community/index` / 社区空态 | anonymous | `PLANNED` |

配额、分享、脚本选择等已有业务路由保持功能，不在没有对应 H5 帧时自行扩展视觉范围。新增设计帧必须先更新本 Spec。

## 5. 可直接执行的 13 帧验收矩阵

### 5.1 统一执行契约

视觉验收由 `apps/miniapp/e2e/visual-frames.mjs` 执行，矩阵数据固定在 `apps/miniapp/e2e/visual-frame-matrix.json`，由验收 Agent 在实现阶段提交。执行命令为：

```bash
pnpm --filter @juben-sha/miniapp build:weapp:visual-fixture
pnpm --filter @juben-sha/miniapp test:e2e:visual-frames
```

脚本必须：

- 启动确定性 fixture API，再通过微信开发者工具 CLI 加载 `apps/miniapp/dist/`；不得复用用户机器上未知的 `127.0.0.1:3000` 进程。
- 每条用例先清空 storage，再按矩阵设置登录态、路由参数和 fixture；等待指定 selector 与布局稳定后再截图。
- 默认视口固定为 `375x812` 逻辑像素；`1-2325` 使用 `375x951` 的滚动拼接图。脚本报告实际 `systemInfo`，尺寸不一致直接失败，不允许事后拉伸。
- 截图写入 `apps/miniapp/e2e/artifacts/visual-frames/<run-id>/actual/<frame>.png`。
- 以 `docs/specs/evidence/2026-09-16-h5-all-frames/browser/<frame>.png` 为 baseline，写入 `diff/<frame>.png`、`report.json` 和 `summary.md`。
- 使用仓库内确定性像素比较器 `scripts/compare-visual-frames.mjs`（允许使用已锁定依赖 `sharp`；不得依赖人工肉眼判定）。比较前只应用 `approved-masks.json` 中的系统 UI 和批准文案区域遮罩。

通过阈值：

- 图片尺寸必须完全一致；关键节点几何位置偏差不得超过 4px。
- 非长页帧：未遮罩像素 `MAE <= 16` 且 `|delta| > 10` 的像素比例 `<= 18%`。
- `1-2325` 长页：未遮罩像素 `MAE <= 20` 且 `|delta| > 10` 的像素比例 `<= 25%`。
- 任何必需资源缺失、路由错误、状态错误、键盘/滚动状态错误或结构性节点缺失均直接失败，不得用平均像素差抵销。

### 5.2 帧到操作、fixture 和截图定义

| 帧 | 路由与参数 | fixture / 内容 | 操作步骤与稳定状态 | 滚动 / 键盘 | 输出 |
| --- | --- | --- | --- | --- | --- |
| `1-773` | `/pages/login/index` | `login-basic`，无 token | `reLaunch`；等待 `.login-page__content` | `scrollTop=0`；键盘隐藏 | `375x812` |
| `1-863` | `/pages/home/index` | `home-default`：`moon-garden`、`moon-tower`、白藏角色卡 | `switchTab`；等待脚本和角色卡请求完成 | 页面顶端；键盘隐藏 | `375x812` |
| `1-1164` | `/pages/home/index` | `home-search-empty`：输入值 `不存在剧本`，搜索响应为空 | 进入首页后点击 `.theater-home__script-search`，输入 `不存在剧本`，等待至少 `SCRIPT_SEARCH_DEBOUNCE_MS`，收起键盘后截图 | 页面顶端；键盘隐藏 | `375x812` |
| `1-387` | `/pages/chat/index?characterId=hakuzo&mode=free` | `chat-1-empty`：角色白藏，无消息 | `reLaunch`；等待 `.chat-page` 和角色头图 | 消息区在顶端；键盘隐藏；输入框未聚焦 | `375x812` |
| `1-494` | `/pages/chat/index?characterId=hakuzo&mode=free` | `chat-2-focused`：同一角色，无消息、无输入文本 | 点击输入框；等待键盘出现；在输入内容为空时截图 | 消息区 `scrollTop=0`；键盘显示 | `375x812` |
| `1-626` | `/pages/chat/index?sessionId=visual-chat-626` | `chat-3-reply`：白藏 assistant 回复固定为“我等了太久,久到\n连自己的呼吸都染上了庭院的雾气。\n但有些答案,要在七个满月夜里慢慢揭开。\n今夜你问,明日风会替我回答。你怕吗?怕被这庭院记住,\n还是怕 …… 被我选择?”；用户占位气泡留空 | `reLaunch`；等待消息列表稳定；聚焦输入框但不输入 | 消息区贴底；键盘显示；空用户气泡按批准偏差保留 | `375x812` |
| `1-1657` | `/pages/character/detail?characterId=hakuzo` | `character-hakuzo`：白藏、月见庭院、关系 `初识于白藏` | `reLaunch`；等待角色详情请求和 `.character-detail` | `scrollTop=0`，只截首屏；键盘隐藏 | `375x812` |
| `1-2325` | `/pages/character/detail?characterId=hakuzo` | 同 `character-hakuzo` | 同首屏用例；等待所有长页节点；按 `0` 和内容底部之间的稳定滚动位置分段截图并拼接 | 从 `scrollTop=0` 生成完整长页；键盘隐藏 | `375x951` 拼接图 |
| `1-1766` | `/pages/profile/index` | `profile-logged-in`：用户 `开发调试用户`，成就 fixture 含 `入戏者`；占位数字不渲染 | 设置 token；`switchTab`；等待 profile、balance、achievement 请求完成 | `scrollTop=0`；键盘隐藏 | `375x812` |
| `1-1892` | `/pages/profile/index` | `profile-logged-out`：无 token，认证返回 401/未登录 | 清空 token；`switchTab`；等待登录提示 | `scrollTop=0`；键盘隐藏 | `375x812` |
| `1-1987` | `/pages/profile/index` | `profile-loading`：保留 token，`/api/me` 和 profile 依赖请求 pending，截图后释放 | `switchTab`；等待 `正在叩响梦境之门` loading 节点出现后立即截图；截图完成才释放请求 | `scrollTop=0`；键盘隐藏 | `375x812` |
| `1-2080` | `/pages/chat/list` | `chat-list-logged-out`：无 token，认证返回 401/未登录 | 清空 token；`switchTab /pages/chat/list`；等待登录拦截卡片 | `scrollTop=0`；键盘隐藏 | `375x812` |
| `1-2180` | `/pages/community/index` | `community-empty`：固定社区占位列表 | `switchTab`；等待 `.community__body` 和预览项 | `scrollTop=0`；键盘隐藏 | `375x812` |

矩阵中引用的 fixture 必须由 E2E Agent 固定响应体和请求记录；不得用随机时间、随机角色、实时 LLM 或真实生产数据替代。

## 6. 生产资源与构建所有权

当前事实：`apps/miniapp/playground/assets/` 约 27 MiB、约 448 个 PNG；`apps/miniapp/src/assets/` 约 1.3 MiB、约 35 个文件；weapp copy 目前只复制 `src/assets`，H5 才复制 `playground/assets`。因此不能让页面 Agent 直接引用 Playground 路径。

资源策略冻结为：

- 只迁移 13 帧实际使用的资源；不把整个 `playground/assets` 复制进生产包。
- 生产默认使用本地资源；首屏和公共 tabbar 资源进入 `src/assets`，非首屏大图按页面分包；本轮不引入 CDN 依赖。若单图或页面资源必须走 CDN，需另开 Spec，不得在本轮临时改协议。
- 资源 Agent 必须生成 `apps/miniapp/src/assets/design/manifest.json`，每项记录语义名、来源帧/节点、原始路径、生产路径、格式、像素尺寸、压缩后字节数、所属路由/分包、fallback 和版权状态。
- PNG/JPEG 统一做无损或视觉无损压缩；超过 `300 KiB` 的单图必须压缩、降采样或移入页面分包并在 manifest 记录原因。
- 生产主包总大小不得超过 `2 MiB`；每个首屏帧新增资源不得超过 `800 KiB`；构建报告必须同时记录主包、各分包和首屏资源大小。
- `verify:weapp` 或视觉资源校验发现 manifest 缺失、路径不存在、运行时请求 `/playground/`、未批准远程 URL 或资源加载失败时直接失败。

资源与构建 Agent 唯一拥有：

```text
apps/miniapp/src/assets/**
apps/miniapp/config/index.ts（仅 copy/build 资源配置）
apps/miniapp/scripts/verify-visual-assets.mjs
apps/miniapp/src/assets/design/manifest.json
```

页面 Agent 只读 manifest 和资源路径，不复制资源、不修改 copy 配置。

## 7. Taro 实现边界与共享契约

### 7.1 生产运行时

- 页面组件负责布局和渲染，控制器负责请求、状态和导航；组件不得直接调用 API、storage 或路由。
- 视觉数值沉淀为 tokens、布局组件或页面样式；不得在多个页面复制同一组魔法数字。
- 页面之间的入口、返回、tab 切换和 CTA 必须走现有真实路由。

### 7.2 跨页面模型契约

`apps/miniapp/src/pages/home/index.model.ts` 被 Chat、Chat List、Character、Script Select、Script Catalog 共同使用。本轮先冻结其公共契约：

- Home Agent 不得修改该文件；其他页面 Agent 也只能读取。
- 现有导出（资源 URL 解析、剧本/角色路由 URL、搜索 URL、搜索响应竞态判断、角色区标题、卡片上限和滚动索引）保持函数名、参数和返回值语义不变。
- 新需求优先放入对应页面的 `index.model.ts`；确需共享能力时提交给唯一集成会话，由其在合并前统一修改并补测试。
- 任何公共模型变更必须在集成提交中记录影响页面和回归测试，页面 Agent 不得在自己的提交里顺带改共享模型。

## 8. 多 Agent 所有权

所有会话从 `H5` 的 `cd7afac` 创建独立 worktree；页面会话不互相 cherry-pick，由唯一集成/收口会话统一合并。

| 会话 | 唯一写入边界 | 交付 |
| --- | --- | --- |
| 基础层 Agent | `packages/miniapp-ui/src/**`、`apps/miniapp/src/styles/tokens.scss` | 生产布局、文本、按钮、表面、导航和 tokens；类型检查与基础组件测试。 |
| 资源与构建 Agent | 第 6 节资源边界 | 语义 manifest、压缩资源、copy/分包策略、体积报告和资源校验。 |
| Home Agent | `apps/miniapp/src/pages/home/**`，但 `index.model.ts` 只读 | 首页默认和搜索帧，页面测试和截图记录。 |
| Auth/Profile Agent | `apps/miniapp/src/pages/login/**`、`apps/miniapp/src/pages/profile/**` | 登录、个人页三态，页面测试和截图记录。 |
| Chat Agent | `apps/miniapp/src/pages/chat/**` | 聊天列表含 `1-2080`、聊天三态，页面测试和截图记录。 |
| Character Agent | `apps/miniapp/src/pages/character/**` | 角色详情首屏/长页和入口，页面测试和截图记录。 |
| Community Agent | `apps/miniapp/src/pages/community/**` | 社区帧，页面测试和截图记录。 |
| E2E 验收工具 Agent | `apps/miniapp/e2e/visual-frames.mjs`、`visual-frame-matrix.json`、`visual-fixtures/**`、`approved-masks.json`、`scripts/compare-visual-frames.mjs` 及对应 package scripts | 可直接执行的 13 帧截图、拼接、diff 和报告工具。 |
| 唯一集成/收口 Agent | `apps/miniapp/src/app.ts`、`app.scss`、`app.config.ts`、`custom-tab-bar/**`、`fonts.ts`、`global.d.ts`、`apps/miniapp/project.config.json`、跨页面模型和合并冲突 | 合并所有提交，完成路由、tabbar、全局样式、资源引用和构建接线。 |
| 最终验收 Agent | 验收阶段只读生产代码；可写 `docs/reports/**` 与验收产物 | 运行全部门禁，生成最终验收报告，不再创建第二个集成分支。 |

页面 Agent 不得修改以下公共文件：`apps/miniapp/src/app.ts`、`apps/miniapp/src/app.scss`、`apps/miniapp/src/app.config.ts`、`apps/miniapp/src/custom-tab-bar/**`、`apps/miniapp/src/fonts.ts`、`apps/miniapp/src/global.d.ts`、`apps/miniapp/src/styles/tokens.scss`、`apps/miniapp/src/assets/**`、E2E 公共工具和 `apps/miniapp/src/pages/home/index.model.ts`。缺口写入收口清单。

## 9. 唯一合并顺序

职责只有一个集成/收口会话，取消“集成会话”和“收口会话”两个重复角色：

1. 基础层 Agent 与资源与构建 Agent 从 `cd7afac` 并行工作，各自通过门禁并提交。
2. 页面 Agent 从基础层和资源提交创建 worktree，并行实现各自页面；E2E 工具 Agent 在页面路由和 selector 冻结后实现视觉验收工具。
3. 唯一集成/收口 Agent 在干净 worktree 依次合并：基础层 → 资源与构建 → Home/Auth-Profile/Chat/Character/Community → E2E 工具。
4. 唯一集成/收口 Agent 处理 `app.config.ts`、自定义 tabbar、公共模型、资源配置、构建和跨页面回归，不能借集成阶段重写已验收页面视觉。
5. 最终验收 Agent 在集成提交上执行功能 E2E、13 帧视觉 E2E、资源体积和微信开发者工具 CLI 验证。
6. 所有门禁通过后，才把唯一集成提交合并回 `H5`；验收 Agent 不再产生第二个集成提交。

每个 Agent 的固定 Prompt 前缀：

```text
阅读并遵守 docs/specs/2026-10-01-H5视觉到Taro生产前端-多Agent实施冻结Spec.md。
H5 design-pilot 是视觉基线；生产端必须用 Taro 页面复刻，不得直接把 PilotFrame 当生产页面运行。
只修改任务表中允许的文件范围；公共缺口写回收口清单，不跨页面目录修改。
必须执行任务级测试、typecheck 和必要的 weapp 构建，并提交真实验证结果。
不要把“功能可访问”当作“视觉完成”。
```

## 10. 功能、构建和视觉门禁

最终验收必须全部满足：

- `pnpm run typecheck`、`pnpm test`、`pnpm run test:dev-script`、`pnpm run test:deploy-config` 通过。
- `pnpm --filter @juben-sha/miniapp build:weapp:prod` 与 `pnpm --filter @juben-sha/miniapp verify:weapp` 通过。
- `test:e2e:smoke`、`test:e2e:ui`、`test:e2e:ui:auth` 通过；认证 mock 必须由脚本自己启动并使用可用端口，不能把外部占用记为通过。
- `pnpm --filter @juben-sha/miniapp test:e2e:visual-frames` 通过，13 帧均生成 actual、diff、report，且满足第 5 节阈值。
- 13 帧生产路由、登录态、fixture、操作、滚动和键盘状态与第 4、5 节完全一致；`1-2080` 必须走 `pages/chat/list` 未登录分支。
- 生产包不依赖 `PilotFrame`、`design-frames.json`、`playground` 或 H5 `location.search`；资源 manifest、主包/分包体积和首屏资源门禁通过。
- 报告记录基线提交 `cd7afac`、集成提交、每条命令、截图路径、diff 指标、包体积、开发者工具版本和未解决风险。真机、真实登录或 CDN 未验证时必须明确标记为未完成。

## 11. 变更规则

- 不得单独改变视觉事实源、13 帧映射、允许偏差、资源策略、所有权或合并顺序。
- 新增页面、设计帧、公共组件、共享模型或资源策略，必须先更新本 Spec，再创建 Agent 任务。
- 任何与旧 H5 文档冲突的生产迁移口径，以本 Spec 为准；旧文档的 H5 截图、偏差清单和事实数据仍可作为证据引用。
