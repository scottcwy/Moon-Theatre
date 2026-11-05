# Miniapp Tab 页面生命周期与底部导航统一重构 Spec

> 状态：`FROZEN / IMPLEMENTED / VERIFIED`
> revision 1 · 2026-11-04 · 基线提交 `f49f0ce`
> 适用范围：`apps/miniapp` 的首页、聊天列表、社区、我的四个 Tab 页面，`StageTabBar`、`custom-tab-bar`、Tab 页面数据加载与认证预检。
> 上游依据：本 Spec 部分取代 [`2026-10-31-个人页设计系统与组件复用Spec.md`](./2026-10-31-个人页设计系统与组件复用Spec.md) 中“由页面自行挂载 footer”的导航位置条款；该 Spec 的组件复用、个人页视觉和业务行为约束继续有效。

## 1. 目标

把四个主页面统一到一套 Tab 导航和页面生命周期契约：footer 只保留一份实现，由应用级 TabBar 外壳托管；页面首次加载显示 skeleton，后续切回时保留现有内容并静默刷新；认证校验收敛为会话级能力，不在每次 Tab 切换时重复阻塞页面。

验收目标是消除以下用户可见现象：

1. 切回“我的”页时，整页被 `ProfileLoadingCard` 替换后再次恢复。
2. footer 在页面状态切换时随内容子树重新挂载或闪烁。
3. 已登录 Tab 页面每次显示都重复请求 `/api/me` 等非必要数据。
4. 返回页面后滚动位置、可见内容和底部选中态出现短暂丢失。

## 2. 当前事实

- `app.config.ts` 已设置 `tabBar.custom = true`，但 `apps/miniapp/src/custom-tab-bar/index.tsx` 当前只渲染空占位。
- `StageTabBar` 当前由首页、聊天列表、社区、我的四个页面分别渲染；实现本身共享，挂载位置和选中态来源没有统一。
- “我的”页每次 `useDidShow` 都执行 `setLoading(true)`，随后整页进入 loading 分支；加载完成后恢复完整页面。
- “我的”页先调用 `verifyAuth()` 请求 `/api/me`，资料加载阶段又请求一次 `/api/me`，同一页面显示周期存在重复请求。
- 聊天列表已采用“缓存优先、随后静默刷新”的模式；该行为是正确的参考范式，但尚未成为四个 Tab 页面的统一规则。
- 首页通过额外 `skipFirstShowRef` 避免挂载时的重复加载；该补丁说明 Tab 页显示入口尚未统一。
- 本地 API 热请求实测约 15–35ms，不能单独解释明显的整页闪烁；根因主要是页面状态树被主动替换和重新挂载。

## 3. 范围与边界

### 3.1 REQUIRED

- **唯一 footer 实现**：`StageTabBar` 继续作为唯一可见底部导航实现和唯一视觉来源；微信小程序由 `custom-tab-bar` 托管，不在四个页面内重复渲染。
- **单一 Tab 配置**：Tab 路径、标签、图标、选中图标只保留一份语义来源；`app.config.ts` 与运行时 footer 不得各自维护一套不一致的列表。
- **统一选中态**：当前页切换后，footer 选中态必须在页面 `useDidShow` 阶段同步；未读红点继续由现有聊天红点服务驱动。
- **平台适配**：微信小程序使用真实 `custom-tab-bar`；H5 playground 保留同一 `StageTabBar` 的可见 footer，不得另写第二套视觉实现。
- **稳定页面树**：每个 Tab 页面只有一个稳定根布局；首次加载、已加载、静默刷新、非阻塞错误和终态错误都在同一布局树内变化，不得在多个根 `PageShell` 之间切换。
- **首次加载语义**：只有当前页面没有可用数据时显示全屏 loading/skeleton；已有数据时的刷新不得清空内容或遮挡页面。
- **静默刷新语义**：再次 `useDidShow` 必须先在原位置保留现有内容，再后台刷新；刷新失败时保留旧内容并提供非阻塞提示，除非数据从未成功加载。
- **统一数据入口**：首页、聊天列表、我的采用同一套 Tab 页面数据生命周期；社区为静态页面，不为了形式统一新增请求。
- **页面状态保留**：正常 `switchTab` 返回时保留滚动位置、已加载内容和用户尚未提交的局部交互状态；页面被系统回收时允许回落到首次 skeleton。
- **认证收敛**：会话状态由应用级入口或共享认证服务维护；Tab 页面不得在每个 `useDidShow` 周期重复做同一次 `/api/me` 认证预检。认证失效仍由统一 `401` 处理，不改变 token 清理和登录跳转语义。
- **视觉不回退**：footer 的 106rpx 本体、123rpx 选中态、底部安全区、图标、字号、未读点、浮起效果和 `$tabbar-reserve` 保持现有规范；迁移不得用近似样式重画。
- **行为不回退**：登录、退出、资料编辑、点数续灯、聊天红点、四个 Tab 的 `switchTab` 路由和 H5 开发入口必须保持可用。

### 3.2 DECIDED

- 不引入 TanStack Query 或其他请求缓存依赖。
- 不建立全局业务数据仓库；Tab 页面正常由小程序保留实例，数据状态留在页内更简单。
- 不把认证、热门角色、聊天列表或个人资料放进同一个全局 store。
- 社区页不增加模拟请求或 loading 状态。
- 不使用人为延迟 skeleton、淡入遮罩或动画来掩盖页面重刷。
- 不改用原生 tabBar；原生样式无法满足当前视觉契约。
- 不通过 `reLaunch` 替代 `switchTab`，不改变四个主页面路由结构。

### 3.3 非目标

- 不重做首页、聊天、社区、我的页面信息架构或视觉方向。
- 不修改业务 API 路径、响应结构、计费、聊天协议或数据库模型。
- 不修改登录页交互、token 生命周期、用户状态判定规则，除非是为了消除重复校验而不改变语义。
- 不处理非 Tab 页面之间的普通导航性能。
- 不顺手重写 `PageShell`、共享 UI tokens 或其他页面组件。

## 4. 目标架构

```text
App
├─ 当前 Tab 页面
│  └─ 稳定的 PageShell / 页面内容状态
└─ custom-tab-bar（微信）
   └─ StageTabBar
```

### 4.1 导航责任

| 层 | 责任 | 禁止事项 |
| --- | --- | --- |
| `tab-bar.model.ts` | Tab 路径、标签、图标和类型单一来源 | 页面内硬编码第二份 Tab 列表 |
| `StageTabBar` | 渲染视觉、处理 `switchTab`、显示当前选中态和聊天红点 | 自行维护业务页数据或复制页面样式 |
| `custom-tab-bar` | 微信应用级挂载 `StageTabBar`，同步当前路由选中态 | 继续保留空占位或承载页面内容 |
| Tab 页面 | 只渲染页面内容，并在 `useDidShow` 通知当前 Tab | 在页面内重复渲染 `StageTabBar` |
| H5 适配 | 在 H5 不具备微信 `custom-tab-bar` 时，由统一平台适配层渲染同一个 `StageTabBar` | 为 H5 维护第二套导航视觉 |

Tab 选中态以当前页面路径为唯一事实，不以各页面传入的静态字符串作为长期状态来源。实现可使用现有“外部订阅 + 页面 `useDidShow`”模式；如使用 Taro `getTabBar`，必须保留 H5 降级路径。

### 4.2 页面状态

所有异步 Tab 页面遵守以下状态机：

| 状态 | 进入条件 | UI 契约 |
| --- | --- | --- |
| `initial-loading` | 没有上一次成功数据，首次请求进行中 | 显示页面自己的 skeleton/loading 卡 |
| `ready` | 已有可用数据 | 完整内容可见，不因后台刷新退回 loading |
| `refreshing` | 已有可用数据，后台请求进行中 | 内容保持在原位；只允许局部、非阻塞刷新提示 |
| `stale-error` | 已有可用数据，后台刷新失败 | 保留旧数据并提示；不得清空页面 |
| `terminal-error` | 从未成功加载且请求失败 | 显示可重试错误状态 |
| `unauthenticated` | 会话明确失效 | 进入既有未登录状态或登录跳转 |

刷新采用 stale-while-revalidate：先展示已有状态，再请求最新数据，最新请求成功后在原位替换。必须使用请求序号或取消机制防止旧响应覆盖新响应。

### 4.3 认证责任

- 冷启动、重新回到前台或登录成功后，会话校验最多执行一次。
- 页面数据请求收到认证失效时，统一清理登录态并复用现有登录跳转/未登录分支。
- “我的”页的 `/api/me` 结果同时承担资料加载与会话确认时，不得紧随其后再次请求一次 `/api/me`。
- 退出登录必须立即清除当前页面的用户敏感数据，下一次进入按未登录状态重新加载。
- 网络不可达时的认证降级语义必须与当前实现一致，不得因为收敛请求而擅自登出。

## 5. 页面覆盖

| 页面 | 首次加载 | 再次显示 | 备注 |
| --- | --- | --- | --- |
| 首页 | 允许现有骨架/默认内容 | 保留角色与剧本内容，静默刷新推荐/常聊 | 删除 `useEffect` 与 `useDidShow` 的双入口和 skip-first 补丁 |
| 聊天列表 | 显示列表 loading | 使用页内已有数据先渲染，再静默刷新列表与未读数 | 保留按搜索词缓存；不再存在第二套页面级 loading 规则 |
| 社区 | 无请求 | 直接显示 | 不新增 loading |
| 我的 | 显示 `ProfileLoadingCard` | 保持完整资料页可见，静默刷新资料、点数和成长记录 | 不得每次显示重置为 `loading=true` |

## 6. 改动归属

以下文件属于本 Spec 的允许改动面；实际实现可以合并模块，但必须满足第 4 节职责：

- `apps/miniapp/src/components/StageTabBar.tsx`
- `apps/miniapp/src/components/StageTabBar.scss`
- `apps/miniapp/src/custom-tab-bar/**`
- `apps/miniapp/src/app.config.ts`
- 新增 Tab 配置、当前 Tab 状态和 Tab 页面数据生命周期模块
- `apps/miniapp/src/pages/home/index.tsx`
- `apps/miniapp/src/pages/chat/list.tsx`
- `apps/miniapp/src/pages/community/index.tsx`
- `apps/miniapp/src/pages/profile/index.tsx`
- `apps/miniapp/src/hooks/useAuthGuard.ts` 和认证服务中消除重复预检所需的最小改动
- 对应单元测试、静态边界测试、E2E runner 与 H5/微信构建验证

不得借本 Spec 修改 `apps/api/**`、数据库、支付、聊天协议或无关页面。

## 7. 实施阶段

### S0：基线与门禁

- 记录当前四个 Tab 的切换路径、footer 可见性、首次/再次进入 loading 行为、API 请求次数和滚动位置。
- 增加可重复的切换检查，至少覆盖“我的 → 首页 → 我的 → 社区 → 我的”三轮。
- 保留当前 390×844 视觉基线作为 footer 几何回归依据。

完成判据：改动前能够稳定复现“我的”页再次进入出现整页 loading，且能观察到 footer 与页面子树重建。

### S1：统一页面数据生命周期

- 先改“我的”页：首次无数据时 loading；后续显示保留内容并静默刷新。
- 提取或收敛共享状态规则，再迁移首页和聊天列表。
- 消除首页重复挂载请求，保留聊天搜索缓存语义。
- 所有页面统一使用一个稳定根布局，状态在内容区域切换。

完成判据：首次成功后反复切回“我的”不再出现 `.profile__loading-stage`；后台刷新失败不清空已有内容。

### S2：认证预检收敛

- 建立会话级校验入口；页面不再独立做重复 `/api/me` 预检。
- “我的”页资料加载与会话确认复用同一结果。
- 保留 401、网络降级、token 清理和登录跳转的现有语义。

完成判据：一次“我的”页显示周期最多请求一次 `/api/me`；认证失效路径测试通过。

### S3：应用级 TabBar 迁移

- 将 `StageTabBar` 接入真实 `custom-tab-bar`。
- 建立单一 Tab 配置和当前选中态同步。
- 四个页面移除各自的 `StageTabBar` 挂载，但保留统一底部避让。
- 为 H5 提供同一组件的可见降级，不复制导航视觉。

完成判据：微信小程序任意 Tab 切换只存在一套应用级 footer；选中态、未读点和点击路由正确；H5 footer 仍可见。

### S4：验收与文档收口

- 跑 Tab 切换行为检查、H5/微信构建、视觉几何检查和相关单元测试。
- 更新本 Spec 状态为 `IMPLEMENTED`，全部门禁通过后改为 `VERIFIED`。
- 同步 `docs/specs/README.md` 和 `docs/README.md`；若实现偏离契约，先修改本 Spec 再继续。

## 8. 验收标准

### 8.1 功能与状态

- 首次进入“我的”显示 loading；成功加载后切到任意 Tab 再返回，不再显示整页 loading。
- 首次进入首页、聊天列表仍能正确加载；再次返回期间旧内容保持可见。
- 后台刷新失败时保留旧内容，并出现非阻塞错误提示。
- 从未成功加载时显示完整错误态和重试入口。
- 退出后重新登录不会显示上一用户的资料、点数、称号或成就。
- 社区页切换不产生额外网络请求。

### 8.2 导航

- 四个 Tab 的路径、标签、图标和排列顺序与 `app.config.ts` 一致。
- `StageTabBar` 只有一份运行时实现；四个页面源码不再直接挂载它。
- 页面 `useDidShow` 后当前 footer 选中态正确，聊天未读红点继续更新。
- 任意 Tab 反复切换不出现 footer 缺失、双份 footer 或选中态错位。
- H5 playground 仍显示相同底部导航，微信与 H5 不产生两套视觉实现。

### 8.3 请求与性能证据

- 首次加载完成后，每轮 Tab 再次显示不再触发整页 skeleton；用自动化截图或状态断言证明 `.profile__loading-stage` 不重新出现。
- 一次“我的”页显示周期不超过一次 `/api/me`；认证失效返回 401 时仍正确退出。
- “我的 → 首页 → 我的 → 社区 → 我的”至少连续三轮，页面内容、scroll position 和选中态稳定。
- 保存微信开发者工具 performance trace 或等价的页面显示/请求时间线，记录改前改后；不得只以主观“感觉更快”作为通过证据。
- 若性能 trace 仍显示 page-level chrome 在切换时重建，必须继续定位；不得把“内容不再 loading”冒充“切页完全不卡顿”。

### 8.4 视觉

- 390×844 下 footer 位置、宽高、选中态、图标、字号、未读点和安全区不劣化。
- 四个 Tab 的首屏内容位置不因 footer 宿主迁移发生跳动。
- 若视觉门禁受既有 `BLOCKED` 或基线失败影响，本 Spec 结果必须记录为对应状态的局部验证，不得声称整套视觉门禁通过。

### 8.5 验证命令

```bash
pnpm --filter @juben-sha/miniapp test
pnpm --filter @juben-sha/miniapp typecheck
pnpm --filter @juben-sha/miniapp build:h5
pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp
pnpm test:e2e:miniapp:ui
pnpm test:e2e:miniapp:ui:auth
pnpm run test:dev-script
pnpm run test:deploy-config
```

视觉用例按现有 `apps/miniapp/e2e/README.md` 执行；若微信开发者工具会话不可用，必须记录 `BLOCKED` 和已完成的替代证据。

## 9. 风险与回撤

| 风险 | 控制措施 |
| --- | --- |
| `custom-tab-bar` 容器裁切选中态浮起部分 | 宿主容器不得 `overflow: hidden` 裁切；390×844 截图验证 |
| 安全区或固定定位变化导致内容遮挡 | 保留 `$tabbar-reserve`；四个 Tab 均做底部可达性检查 |
| H5 不支持微信 `getTabBar` | 使用平台分支渲染同一 `StageTabBar`；构建和 H5 截图验证 |
| 静默刷新保留过期内容 | `useDidShow` 必须刷新；401、退出登录和首次失败有明确状态 |
| 认证收敛导致失效 token 未被识别 | 所有受保护请求继续统一处理 401；网络错误不得误判登出 |
| 页面保留状态导致数据泄露 | 退出登录主动清除页内用户数据；切用户场景回归 |
| 并行请求乱序覆盖新数据 | 保持请求序号/取消语义，旧响应不得提交 |
| 视觉门禁既有失败掩盖回归 | 单独记录 footer 区域和四页截图，不以整套门禁结果替代 |

回撤只逆向撤销本 Spec 对应改动：恢复四个页面各自挂载 `StageTabBar`、恢复页面级数据 loading 与认证预检、删除新增 Tab 状态/数据生命周期模块。禁止使用 `git reset --hard`、`git checkout --` 或宽泛清理。

## 10. 数据与接口

本 Spec 不新增或修改 API。资料、余额、成长记录、聊天列表和认证状态继续遵守 [`docs/api-v1.md`](../api-v1.md) 及现有服务层契约。

本 Spec 只改变请求时机、去重和页面状态呈现；不得改变请求路径、响应字段、业务错误码或服务端权限判定。

## 11. 变更规则

- 修改 Tab 路由、footer 视觉几何、首次/静默刷新语义或认证失效策略，必须先更新本 Spec。
- 若实现发现 H5 无法复用同一 `StageTabBar`，必须在本 Spec 增加平台适配决策和视觉证据后再继续。
- 每完成一个阶段，在本 Spec 追加“实施记录”，只记录实际 diff、请求次数、测试命令、结果和 `BLOCKED` 原因。

## 12. 实施记录

### S0 基线与门禁

- worktree：`/Users/macbookpro/.codex/worktrees/tab-navigation-lifecycle/剧本杀角色扮演小程序`；分支 `codex/tab-navigation-lifecycle`；基线提交 `f49f0ce`。
- 改前事实：四个页面分别挂载 `StageTabBar`；`custom-tab-bar` 只渲染空宿主；“我的”每次 `useDidShow` 都执行 `setLoading(true)`，先 `verifyAuth()` 再请求 `/api/me`；首页同时存在挂载 `useEffect`、`useDidShow` 和 `skipFirstShowRef`。
- 改前可执行证据：`pnpm --filter @juben-sha/miniapp typecheck` 通过；weapp 构建与 `verify:weapp` 通过；单测为 240 passed、1 failed、1 skipped，失败来自既有 `ui-boundary.test.ts` 仍要求已移除的 `PointsBadge`。
- 微信切换 runner 已创建为 `apps/miniapp/e2e/tab-lifecycle.mjs`，覆盖“我的 → 首页 → 我的 → 社区 → 我的”三轮、footer 数量、选中态、`/api/me` 次数与滚动位置。改前和改后运行均因既有开发者工具会话占用 automator 协议而未进入页面，记为 `BLOCKED`；未终止用户会话。

### S1 统一页面数据生命周期

- 新增 `useTabPageLifecycle`，首次显示调用 `initial`，成功加载后的再次显示固定调用 `refresh`；退出登录时 `reset` 已加载状态。
- 首页删除 `skipFirstShowRef` 和挂载/显示双加载入口，剧本搜索仍保留 250ms 防抖；聊天列表保留按搜索词缓存；三个异步 Tab 页均保持单一根 `PageShell`。
- “我的”仅首次无资料时显示 `ProfileLoadingCard`；后台刷新不清空资料，失败保留旧内容；从未成功加载时提供可重试终态错误。
- 静默刷新失败不再写入阻塞错误或空数组：首页保留已有剧本结果，“我的”保留已有称号和成就；页面隐藏时清除搜索 debounce，并作废未完成请求的状态提交。

### S2 认证预检收敛

- `loadCurrentUser()` 成为 `/api/me` 的唯一会话资料入口，同 token 的并发请求共享同一个 Promise；`verifyStoredAuth()` 复用该入口。
- “我的”使用同一次 `/api/me` 同时完成会话确认与资料加载，删除页面级 `verifyAuth()`；“聊天”删除列表与未读两条重复预检。
- 401 仍由 API 层清理 token，页面复用 `handleAuthError()` 进入未登录态；网络降级语义与既有测试保持一致。新增并发去重单测。
- H5 三轮切换中，每次“我的”显示周期观测到 1 次 `/api/me`。
- 新增 auth session version 与订阅：`setToken`、`clearAuth` 统一通知隐藏 Tab 清理账号相关数据；所有普通请求和聊天流响应提交前校验会话版本。
- 首页清理常聊角色，聊天清理列表、搜索缓存、未读与红点，“我的”清理资料、点数、成长记录和编辑草稿；账号 A 的晚到 `/api/me` 不得覆盖账号 B 或清掉 B 的新 token。

### S3 应用级 TabBar

- 新增 `tab-bar.model.ts` 作为路径、标签、图标和顺序的唯一来源，`app.config.ts` 与运行时 `StageTabBar` 共同消费。
- 微信 `custom-tab-bar` 挂载唯一 `StageTabBar`；宿主移除 `overflow: hidden`，避免裁切 123rpx 选中态。
- 四个 Tab 页面不再挂载 footer，仅通过生命周期同步当前 Tab；H5 由 `App` 级 `TabBarHost.h5.tsx` 渲染同一 `StageTabBar`，并按 history 路由只对四个 Tab 页显示。
- H5 补 `onClick` 平台点击路径，微信继续使用 `onTap`；修复 H5 footer 可见但不可切页，以及页面级 host 在路由缓存下产生双 footer 的问题。
- `useDidShow` 只从当前路由同步选中态；页面不再传入硬编码 Tab 路径。微信 runner 从当前页面 `getTabBar()` 的组件查询域读取 footer 和选中项，footer 缺失不能降级为成功。

### S4 验收与文档收口

- 通过：`pnpm --filter @juben-sha/miniapp test`（40 files，266 passed，1 skipped）、`pnpm --filter @juben-sha/miniapp typecheck`、weapp 与 H5 构建、`verify:weapp`、`pnpm run test:dev-script`、`pnpm run test:deploy-config`。
- 新增行为测试覆盖首次/刷新/reset 生命周期、同 token 请求去重、token 切换后的旧响应拒绝、新账号请求不被旧请求清除、auth 事件与聊天红点清理。
- H5 390×844 实际视觉：单 footer，106rpx 本体、123rpx 选中态、安全区和未读点保持；首屏出现 skeleton，随后 6 次“我的”显示均无 skeleton，`/api/me` 每次显示新增恰好 1 次；真实页面滚动 `360 -> 360`，内容高度 1336、可视高度 844。报告源码指纹 `sha256:b5d772e...`，构建产物指纹 `sha256:66cdb01...`。
- 微信 runner 通过：首次 Profile 显示 skeleton，随后 6 次显示均无 skeleton；首页、聊天、社区、我的 footer 均从 `custom-tab-bar` 读到且各只有 1 份；每次 Profile 显示新增 GET `/api/me` 均为 1。
- 静默失败证据：注入 `/api/scripts` 失败后首页旧剧本仍在；注入 `/api/achievements` 失败后旧称号和成就仍在。
- 最终微信 runner 在独占开发者工具会话下通过：滚动 `360 -> 360`；Profile 保存竞态在 900ms 旧 GET 延迟下最终显示“复核称呼”；账号 A→B 后只显示 B 的聊天与“账号B用户”。源码指纹 `sha256:6bbf507f...`，`app.json` 指纹 `sha256:a14b4149...`。此前一次 automator 未就绪按 watchdog 记为 `BLOCKED`，正常退出本任务启动的开发者工具后复跑通过。
- 证据目录：[`2026-11-04-tab-navigation`](./evidence/2026-11-04-tab-navigation/)；包含 [H5 Profile](./evidence/2026-11-04-tab-navigation/h5-profile-390x844.png)、[H5 三轮结果](./evidence/2026-11-04-tab-navigation/h5-after-three-rounds.png)、[H5 报告](./evidence/2026-11-04-tab-navigation/h5-report.json)、微信 [首页](./evidence/2026-11-04-tab-navigation/weapp-home.png)/[聊天](./evidence/2026-11-04-tab-navigation/weapp-chat.png)/[社区](./evidence/2026-11-04-tab-navigation/weapp-community.png)/[我的](./evidence/2026-11-04-tab-navigation/weapp-profile.png)与 [runner 报告](./evidence/2026-11-04-tab-navigation/weapp-report.json)。
- 微信 smoke 与主页面真实数据 UI：分别通过；2026-11-05 记忆页退役后的主页面 runner 在真实构建、真实剧本/角色 UUID 和真实 API 下为 12/12，聊天页为真实会话而非错误态。
- 认证 UI：2026-11-05 当前报告 21/21，`auth-character-detail` 与 `auth-moon-tower-character-detail` 的自动化 spread 错误已由 E2E P1-5 修复消除；报告见 [`runtime-ui-authenticated/report.json`](../../apps/miniapp/e2e/artifacts/runtime-ui-authenticated/report.json)。
- 最终状态：本 Spec 为 `FROZEN / IMPLEMENTED / VERIFIED`；仓库级认证 UI 已全绿，整屏视觉矩阵仍有独立视觉口径阻塞。Tab 生命周期、footer、认证生命周期和 H5 降级目标均有端到端证据。
