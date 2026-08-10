# P0 七模块需求对齐与实施 Plan（已确认 · 模块 7 已重新冻结）

 > **For agentic workers:** 模块 3/4/5/6 与模块 7 修订已确认（2026-08-10），可按下方批次在独立工作树实施。执行时 REQUIRED SUB-SKILL: Use `minipowers:subagent-driven-development` (recommended) or `minipowers:executing-plans` task-by-task.
>
> **当前状态（2026-08-10）**
> - 模块 1（预告角色）：**暂缓**，待与客户确认后再做新角色。
> - 模块 2（内测基线）：**已完成**，由负责人搞定，不再展开。
> - 模块 3（羁绊）：**已确认**——只改展示；产品语言统一「羁绊」，文案已定。
> - 模块 4（首页热门剧本）：**已确认**——ScrollView 横滑 + 页码点 + 截图验收。
> - 模块 5（剧本目录页）：**已确认**——完整目录页；本期仅「可用」状态。
> - 模块 6（常聊角色）：**已确认**——成功回复轮数排序 + 前 4 网格 + 点击进详情；卡片不展示次数。
> - 模块 7（回访留言）：**Spec 已重新冻结（2026-08-10）**——留言改为写入自由会话消息流（`excludedFromContext=true`），投递元数据 + 红点已读，窗口 UTC+8，「最近」按用户最后消息时间。

**Goal:** 在不改变现有角色和旧客户端核心行为的前提下，完成新角色预告、内测版本隔离、羁绊更新、首页展示优化、剧本模式导流、常聊角色排序和回访留言七个模块。

**Architecture:** 继续由 API 拥有角色可用性、会话、羁绊和回访留言状态，小程序只消费服务端事实。所有 API 和数据库变更保持向后兼容，旧内测客户端在 P0 开发期间继续使用已发布基线。回访留言本体写入自由模式会话消息流（`excludedFromContext=true`），投递元数据（`character_return_messages`）独立记录未读/已读。

**Tech Stack:** Taro 4 + React 18 + SCSS 小程序，Next.js 15 Route Handlers，PostgreSQL + Drizzle ORM，Vitest，微信开发者工具。

## 全局约束

- 现有角色、剧本、剧本模式和自由对话行为不因新角色预告而改变。
- 旧小程序客户端不传新参数时，现有 API 路径和字段语义必须保持可用。
- 预告角色必须同时在 UI 和 API 层禁止进入对话，不得只靠卡片置灰。
- 剧本模式和自由对话的可见历史、生成上下文和剧本记忆继续隔离。
- 回访留言不消耗点数，不增加羁绊，不触发记忆和成就。
- 不引入新状态管理、新请求封装或平行 UI 体系；复用现有 `api`、`PageShell`、`PageSection`、`Badge` 和角色卡片。
- 小程序构建前必须确认真实 HTTPS API 配置，构建后必须运行 `verify:weapp`，严禁占位 API 主机进入产物。
- 用户现有工作树是脏的；执行时不回滚、不覆盖与本 P0 无关的改动。

---

## 候选词表（待双方确认）

| 候选标准词 | 本 Plan 中的精确含义 | 避免使用 |
| --- | --- | --- |
| **预告角色** | 用户可在剧本目录/选角页看到，但不能打开详情或发起聊天的新角色 | 灰色角色、未上架角色、剧情角色 |
| **剧本模式入口** | 首页上导航到剧本目录页的按钮，不改变当前聊天模式 | 开关、模式切换器 |
| **剧本目录页** | 展示可搜索剧本列表的一级页面，点击后进入某个剧本选角页 | 二级剧本展示页、剧本选择页（易与单剧本选角页混淆） |
| **常聊角色** | 按用户与角色的成功对话轮数倒序展示的角色 | 最近角色、聊天次数最多（未定义“次数”） |
| **羁绊** | 用户与某个角色的累计关系等级和经验 | 亲密度、好感度、默契度混用 |
| **回访留言** | 角色面向长时间未访问用户的主动消息：作为真实 assistant 消息写入自由会话可见历史（`excludedFromContext=true`），不进生成上下文；投递元数据（`character_return_messages`）记录未读/已读，每角色每 UTC+8 自然日最多 1 条，未读最多累计 3 条，满 3 停止生成直到已读 | 聊天消息、系统通知、离线消息、微信推送 |
| **关系等级名** | 羁绊共 6 级：檐下→灯前→杯沿→留盏→不言→入念（顺序与数值规则待客户确认） | Lv.1–10、默契度等级混用 |
| **旧内测基线** | P0 开发前已验证并继续供内测用户使用的小程序体验版及其兼容 API | 旧版、线上版、测试版混用 |

词表已确认（2026-08-10）并同步到 `CONTEXT.md`；回访留言词条随模块 7 重新冻结（2026-08-10）更新。

---

## 模块 1：上新剧本和预告角色

**工作量：L**（数据模型 + API 可用性 + UI 状态 + 新内容/素材）

### 1.1 目前的实现情况

- `scripts.status` 是字符串，当前业务只把 `active` 当成可见/可用，历史下架值为 `retired`。
- `characters.status` 枚举只有 `active | inactive`；`inactive` 角色会被角色列表和剧本选角页完全过滤，无法实现“看得到但不能玩”。
- 角色只要绑定一个 `active` 剧本，`GET /api/characters/:id` 就会返回 `availableModes: ['script', 'free']`。当前没有“绑定剧本但禁止互动”的第三种状态。
- `GET /api/scripts/:id` 只返回 `active` 角色；前端 `pages/script/select` 默认每张角色卡都可点击进入详情。
- 剧本与角色主数据由 `apps/api/src/server/seed/story-data.ts` 提供，当前只有月见庭院剧本和四个角色。

### 1.2 需要新增的功能

- 新剧本可在剧本目录中展示，包含封面、名称、类型、简介和排序。
- 新角色可在新剧本的选角页中置灰展示，标记“即将上线”，不进入详情、不进入自由对话、不进入剧本模式。
- 绕过前端直接请求角色详情或聊天 API 时，服务端仍必须拒绝预告角色。
- 现有 `active` 角色的列表、详情、自由对话和剧本模式完全保持现状。

### 1.3 具体的改动方案

**推荐数据契约**

```ts
type CharacterStatus = 'active' | 'preview' | 'inactive';

interface CatalogCharacter {
  id: string;
  name: string;
  avatarUrl: string;
  identity: string;
  description: string;
  availability: 'available' | 'preview';
}
```

- 新增 Drizzle 迁移，将 `character_status` 扩展为 `active | preview | inactive`。不改现有数据的 `active` 值。
- `listCharacters()` 仍只返回 `active`，避免预告角色进入首页常聊区和公共可互动角色列表。
- `getScriptById()` 改为返回 `active + preview` 角色，并显式映射 `availability`；`inactive` 继续隐藏。
- `getCharacterById()`、`findOrCreateSession()` 和聊天准备逻辑仍只接受 `active`；预告角色直达请求返回稳定错误 `character_unavailable`。
- `CharacterPosterCard` 扩展 `disabled` 与无障碍标识，禁止触发 `onTap`，同时保证文字对比度；置灰不能只用降低透明度。
- 在种子数据中增加新剧本和预告角色。预告角色本期不需要 Prompt、starter questions、剧情节点或用户剧情状态。
- 更新 `docs/api-v1.md`、产品规格与词表，明确 `preview` 只是目录可见性，不是聊天模式。

**预计文件**

- Modify: `apps/api/src/server/db/schema.ts`
- Create: `apps/api/drizzle/0006_character_preview_status.sql`
- Modify: `apps/api/src/server/modules/scripts/service.ts`
- Modify: `apps/api/src/server/modules/characters/service.ts`
- Modify: `apps/api/src/server/modules/chat/service.ts`
- Modify: `apps/api/src/server/seed/story-data.ts`
- Modify: `apps/miniapp/src/pages/script/select.tsx`
- Modify: `apps/miniapp/src/pages/script/select.scss`
- Modify: `packages/miniapp-ui/src/components/character/CharacterPosterCard.tsx`
- Modify: `packages/miniapp-ui/src/components/character/CharacterPosterCard.scss`
- Test: `apps/api/src/server/modules/scripts/__tests__/service.test.ts`
- Test: `apps/api/src/server/modules/characters/__tests__/service.test.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/service.test.ts`
- Test: `apps/miniapp/src/pages/script/select.model.test.ts`
- Test: `packages/miniapp-ui/src/components/playbook-functional.test.tsx`

**验收与测试**

- 新剧本可搜索、可打开，预告角色可见且置灰。
- 预告角色卡片不跳转，直达详情和聊天 API 均被拒绝。
- 现有四个角色的入口和两种聊天模式回归通过。

---

## 模块 2：旧版本继续内测与 P0 开发隔离

**工作量：M**（主要是发布流程、环境和向后兼容，不是单纯建分支）

### 2.1 目前的实现情况

- 仓库当前版本号仍为 `1.0.0`，没有对应微信体验版的发布基线文档。
- 部署文档已要求保留上一个 API/FastClaw 镜像 tag，可以做服务端回滚；小程序体验版的锁定流程尚未文档化。
- 现有 API 已经为旧客户端保留 `mode/scriptId` 缺省推断，说明项目已采用“一个客户端兼容窗口”的方式。
- 当前工作树存在用户未提交改动，不适合直接在当前状态上标记内测基线。

### 2.2 需要新增的功能/流程

- 明确一个可追溯的“旧内测基线”：小程序体验版版本、Git commit、API 镜像 tag、FastClaw 镜像 tag、数据库迁移版本。
- P0 开发在独立分支/工作树和独立开发数据库中进行，不覆盖微信体验版。
- P0 未验收前，不向旧内测环境 seed 预告剧本/角色，不部署不兼容 API。
- 如必须先部署 P0 API，只允许新表、新枚举值、新字段和新路由等加法变更；旧客户端不传新参数时行为不变。

### 2.3 具体的改动方案

- 新增 `docs/internal-testing-release.md`，记录基线建立、体验版上传、P0 开发环境、切换条件和回滚步骤。
- 基线必须从干净、已验证的 commit 建立；不从当前脏工作树猜基线。
- 内测期间保留两套明确状态：
  - 基线体验版：内测用户继续使用。
  - P0 开发/验收版：只给开发和指定验收人员。
- 将“旧客户端兼容测试”加入 API 变更的验收清单：旧 payload 仍可创建/恢复原有会话，旧字段仍存在，新字段不影响旧解析。
- 更新 `docs/deployment.md` 只引用新的内测发布清单，不把业务流程重复写入部署文档。

**预计文件**

- Create: `docs/internal-testing-release.md`
- Modify: `docs/deployment.md`
- Modify: `scripts/deploy-config.test.mjs`（仅当新增可机械校验的基线配置时）
- Test: 各 P0 API 路由的 legacy request 回归用例

**验收与测试**

- 能精确回答“现在内测用的是哪个小程序版本和哪组服务端镜像”。
- P0 开发不改变现有体验版，旧版核心链路可继续内测。
- P0 上线前可一次性切换，失败时可回到已记录基线。

---

## 模块 3：羁绊（客户原话“亲密度”）更新

**工作量：M；如改成动态规则则为 L**

### 3.1 目前的实现情况

- 数据库已有 `relationships`，按 `userId + characterId` 唯一保存 `bondLevel` 和累计 `bondExp`。
- 每次成功保存的 AI 回复在 `finalizeAssistantTurn()` 事务中增加 10 经验；经验事件按 `assistantMessageId` 幂等，重试不重复增加。
- 输出过滤、越界、失败发送不增加羁绊。
- 等级规则为每 100 累计经验升 1 级，服务端上限 10 级。
- 角色详情页在 `useDidShow` 时刷新关系；聊天页优先使用 `done.bondLevel/bondExp`，缺失时重新请求角色详情。
- UI 同时使用“羁绊”和“默契度”文案，客户又使用“亲密度”，当前产品语言不统一。
- 前端 `createBondViewModel()` 从累计经验重算等级，但没有将显示等级限制为 10；达到 1000 经验后存在显示超过服务端上限的风险。

### 3.2 需要新增的功能

本项需要先从下列三种范围中选一个，不能把“更新”当成验收标准：

1. **只更新展示（推荐 P0）**：统一名称，修复 10 级封顶显示，聊天成功后显示 `+10` 和升级反馈，不改后端规则。
2. **更新数值规则**：改变每轮增量、每级阈值或封顶，必须定义旧数据如何迁移。
3. **增加行为权重**：根据模式、文本质量或连续天数计分，这会引入新的反刷和解释性问题，不建议放进本 P0。

### 3.3 具体的改动方案（按推荐的“只更新展示”）

**推荐契约**

```ts
interface BondUpdate {
  bondLevel: number;
  bondExp: number;
  bondDelta: number;
  leveledUp: boolean;
}
```

- 产品端统一使用“羁绊”；将“距下一等级还需 X 默契度”改为“距下一级羁绊还需 X”。如客户坚持“亲密度”，则前端一次性整体替换，不保留三套名称。
- 服务端在现有事务结果中返回 `bondDelta: 10` 和 `leveledUp`；幂等重放返回 `bondDelta: 0`，不伪造再次增长。
- 聊天页比较旧值与服务端结果：普通成功显示轻量 `羁绊 +10`，升级显示 `羁绊提升至 Lv.N`。反馈不能推动消息列表跳动。
- `createBondViewModel()` 将等级限制为 10；满级时进度显示为已满级，不再显示下一级剩余值。
- 保留累计经验作为 API 事实源，前端不本地猜测增量。
- 文档明确成功、过滤、越界、失败、重放五类轮次对羁绊的影响。

**预计文件**

- Modify: `apps/api/src/server/modules/chat/service.ts`
- Modify: `apps/api/src/server/modules/chat/stream-runner.ts`
- Modify: `apps/miniapp/src/services/api.ts`
- Modify: `apps/miniapp/src/pages/chat/index.tsx`
- Modify: `packages/miniapp-ui/src/components/character/bond.model.ts`
- Modify: `packages/miniapp-ui/src/components/character/BondProgress.tsx`
- Test: `apps/api/src/server/modules/chat/__tests__/service.test.ts`
- Test: `apps/api/src/server/modules/chat/__tests__/stream-runner.test.ts`
- Test: `packages/miniapp-ui/src/components/character/bond.model.test.ts`
- Test: `apps/miniapp/src/pages/chat/index.model.test.ts`
- Modify: `docs/api-v1.md`
- Modify: `CONTEXT.md`（词汇确认后）

**验收与测试**

- 普通成功轮只增加一次，重放、越界、过滤和失败不增加。
- 聊天页和详情页显示一致，返回详情后不出现旧值。
- 10 级封顶不显示 11 级，不显示虚假的“距下一级”。

---

## 模块 4：首页热门剧本展示优化

**工作量：M**（响应式布局 + 小程序滑动交互 + 真机视觉回归）

### 4.1 目前的实现情况

- 首页已通过 `GET /api/scripts` 加载全部上架剧本，支持 250ms 防抖搜索和旧请求结果丢弃。
- 热门剧本容器已设为横向 `flex + overflow-x: auto`，但每张卡片占 100% 宽度且高 668rpx，首屏看不出后面还有剧本，并严重挤压下方角色区。
- 当前用普通 `View` 承载 CSS 横向滚动，没有小程序 `ScrollView` 的滑动属性、吸附效果或页码反馈。
- 剧本标题、简介和“选择角色”全部叠在封面上，缩小时需重新约束文字行数，不能只改高度。

### 4.2 需要新增的功能

- 热门剧本卡片缩小，首屏至少能看到下方“常聊角色”标题和部分角色卡。
- 多剧本时可左右滑动，当前卡右侧露出下一张卡片，让用户直接感知“还有内容”。
- 单剧本、搜索结果为 1 个、无结果、加载失败继续有稳定布局。

### 4.3 具体的改动方案

- 将剧本列表容器改为 Taro `ScrollView scrollX enhanced showScrollbar={false}`，保留现有 API 加载和搜索逻辑。
- 卡片宽度使用稳定比例（建议首张占可用宽度 86%-90%），高度使用固定的响应式约束，不用字体大小随视口缩放。
- 剧本标题最多 2 行，简介最多 3 行；超出截断，主按钮尺寸保持稳定。
- 根据滑动位置显示轻量页码点，仅在剧本数量 > 1 时渲染；搜索后重置到第一张。
- 不将这一区改成自动轮播；自动轮播会影响阅读和减少动效设置，客户只要求“增加滑动页”。

**预计文件**

- Modify: `apps/miniapp/src/pages/home/index.tsx`
- Modify: `apps/miniapp/src/pages/home/index.scss`
- Modify: `apps/miniapp/src/pages/home/index.model.ts`
- Test: `apps/miniapp/src/pages/home/index.model.test.ts`
- Create: `apps/miniapp/src/pages/home/index.layout.test.tsx`
- Modify: `apps/miniapp/e2e/runtime-ui.mjs`
- Modify: `apps/miniapp/e2e/runtime-ui-authenticated.mjs`

**验收与测试**

- iPhone 窄屏和常见 Android 视口下文字、按钮和卡片不重叠。
- 两个以上剧本可手势滑动，布局不因标题长度跳动。
- 首屏能露出下一区内容，并通过微信开发者工具截图验收。

---

## 模块 5：剧本模式入口与剧本目录页

**工作量：M-L**（新页面 + 可用性字段 + 路由 + 搜索/空状态）

### 5.1 目前的实现情况

- 首页每张剧本卡已能直接跳到 `/pages/script/select?scriptId=...`。
- `pages/script/select` 是“单个剧本详情 + 选角”页，不是截图线框图所表达的“全部剧本列表”。
- 当前没有 `/pages/script/catalog` 路由，也没有一个只展示“支持剧本模式”剧本的页面。
- `GET /api/scripts` 返回基础目录数据，不告诉前端该剧本是否有可玩的剧本模式角色。

### 5.2 需要新增的功能

- 首页标题区增加一个紧凑的“剧本模式”入口按钮，点击后导航，不在首页切换数据状态。
- 新增剧本目录页：上方为搜索/推荐，下方为纵向剧本列表。
- 每个剧本显示“剧本模式”或“即将上线”等明确状态；只有支持剧本模式的剧本可进入可玩选角流程。
- 未登录用户可浏览目录，打开单剧本选角页时沿用现有登录拦截。

### 5.3 具体的改动方案

**推荐 API 契约**

```ts
interface ScriptCatalogItem {
  id: string;
  title: string;
  description: string;
  slug: string;
  genre: string;
  coverUrl: string | null;
  sortOrder: number;
  supportsScriptMode: boolean;
  availability: 'available' | 'preview';
}
```

- `listScripts()` 计算 `supportsScriptMode`：至少存在一个 `active` 且绑定该剧本的角色时为 `true`；只有 `preview` 角色时为 `false`。
- 新增 `buildScriptCatalogUrl(query)` 和目录页模型，复用首页的封面 URL 规则、`SearchBar`、`Badge` 和空/错误状态。
- 在 `app.config.ts` 注册 `pages/script/catalog`；首页入口路由固定为 `/pages/script/catalog`。
- 目录页点击可用剧本时，进入现有 `/pages/script/select?scriptId=...`，不新建第二套选角页。
- 预告剧本卡片保持可浏览，但不导航到聊天；具体是否允许打开详情需在讨论中拍板。
- 降级方案不单独造平行实现：如砍掉目录页，只在现有剧本卡和单剧本选角页增加“剧本模式”标签，不同时维护两套入口逻辑。

**预计文件**

- Modify: `apps/api/src/server/modules/scripts/service.ts`
- Modify: `apps/api/src/app/api/scripts/route.ts`
- Test: `apps/api/src/server/modules/scripts/__tests__/service.test.ts`
- Test: `apps/api/src/app/api/scripts/route.test.ts`
- Create: `apps/miniapp/src/pages/script/catalog.tsx`
- Create: `apps/miniapp/src/pages/script/catalog.scss`
- Create: `apps/miniapp/src/pages/script/catalog.model.ts`
- Create: `apps/miniapp/src/pages/script/catalog.model.test.ts`
- Modify: `apps/miniapp/src/app.config.ts`
- Modify: `apps/miniapp/src/pages/home/index.tsx`
- Modify: `apps/miniapp/src/pages/home/index.model.ts`
- Test: `apps/miniapp/src/pages/home/index.model.test.ts`
- Modify: `docs/api-v1.md`

**验收与测试**

- 首页入口一次点击进入目录，不会改变当前任何聊天会话。
- 剧本目录搜索、空状态、错误重试和长列表滚动正常。
- 可用剧本进入现有选角页；预告剧本不能通过直达路由开启预告角色聊天。

---

## 模块 6：“最近角色”改为“常聊角色”

**工作量：L**（用户维度聚合查询 + 登录/未登录分支 + 首页集成）

### 6.1 目前的实现情况

- 首页“最近角色”实际调用无需登录的 `GET /api/characters`，展示所有可用角色，按运营 `sortOrder` 排序。
- 该区域既不是“最近”，也不是“聊天次数最多”，当前标题与数据语义不一致。
- `GET /api/chat/characters` 已按角色聚合用户会话，但只返回最新会话、最新消息和更新时间，没有成功对话轮数，默认语义是聊天列表而非排行。
- 首页当前不检查登录态；如直接请求必须登录的聚合接口，401 会清理本地登录信息，不能把这个请求无条件放到首页。

### 6.2 需要新增的功能

- 已登录用户看到按“成功对话轮数”倒序的前 N 个可互动角色。
- 计数只包含有效 assistant 回复：`role=assistant`、`outOfScope=false`、`excludedFromContext=false`。失败、过滤、越界、system 消息和预告角色不计数。
- 计数同时覆盖同一角色的剧本模式和自由对话，但只聚合排序，不合并两种模式的消息历史。
- 未登录或已登录但无历史时，显示运营推荐角色，区域标题不能误称为“常聊角色”。

### 6.3 具体的改动方案

**推荐 API 扩展**

```http
GET /api/chat/characters?sort=turn_count&page=1&limit=4
```

```ts
interface FrequentCharacterEntry extends CharacterChatEntry {
  successfulTurnCount: number;
}
```

- 保留 `GET /api/chat/characters` 不带 `sort` 时的现有聊天列表语义和返回字段。
- 为 `sort=turn_count` 增加专用聚合查询，在数据库内按用户、角色分组和排序，不把所有消息拉到 Node.js 内存后计数。
- 排序为 `successfulTurnCount DESC, latestUpdatedAt DESC, character.sortOrder ASC`，保证相同轮数时结果稳定。
- 首页先用 `isLoggedIn()` 判断：
  - 有 token：请求常聊角色；返回空时使用公共角色推荐。
  - 无 token：不发起认证请求，直接使用现有 `GET /api/characters`。
- 已有历史时区域标题为“常聊角色”，无历史/未登录时为“推荐角色”。
- 卡片点击仍进入角色详情，不直接恢复最新会话；如客户期望直达聊天，需另行确认。

**预计文件**

- Create: `apps/api/src/server/modules/chat/character-summary-service.ts`
- Create: `apps/api/src/server/modules/chat/__tests__/character-summary-service.test.ts`
- Modify: `apps/api/src/app/api/chat/characters/route.ts`
- Modify: `apps/api/src/app/api/chat/characters/route.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.tsx`
- Modify: `apps/miniapp/src/pages/home/index.model.ts`
- Test: `apps/miniapp/src/pages/home/index.model.test.ts`
- Test: `apps/miniapp/src/pages/home/index.layout.test.tsx`
- Modify: `docs/api-v1.md`
- Modify: `docs/adr/0003-aggregate-chat-list-by-character.md`（仅补充排序聚合不合并历史）

**验收与测试**

- 成功聊天轮数最多的角色排在前面，相同轮数排序稳定。
- 剧本模式与自由对话轮数可合计，但点击后不混合历史。
- 未登录用户首页不发起必然 401 的请求，仍能看到推荐角色。

---

## 模块 7：角色回访留言（Spec 已重新冻结）

**工作量：XL**（数据落点改造 + 投递元数据 + 窗口口径 + 排序口径）

> **冻结范围（2026-08-10 重开并重新冻结）**
> 1. 留言 = **真实 assistant 消息**写入 `messages`（`role='assistant'`、`outOfScope=false`、`excludedFromContext=true`）：在会话可见历史中显示，但**不进入生成上下文**；刷新/换设备后仍存在，复用现有消息展示与排序。
> 2. 落点：该角色最近活跃的**自由模式会话**；不存在（或只有剧本模式会话）则**新建自由会话**写入；不复用已关闭会话。剧本模式会话不插入。
> 3. **零副作用**：不计点数、不加羁绊、不触发记忆/成就、不计入模块 6 成功轮数（`excludedFromContext=true` 天然排除）。
> 4. `character_return_messages` 改为**投递元数据**：新增可空 `message_id`（外键 `messages.id`），保留 `readAt`；聊天列表该角色行显示红点，用户打开该角色会话时**幂等标记已读**。
> 5. 窗口：**UTC+8 自然日**（`date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')`），每角色每自然日最多 1 条；未读累计上限 3 条，满 3 停止生成直到已读。
> 6. 「最近成功聊过」候选按**用户最后一条消息时间**（该会话 `role='user'` 消息的最大 `createdAt`）倒序取第一个；不再用会话 `updatedAt`。模块 6 排序的 `latestUpdatedAt` tiebreaker 同步改为此口径。
> 7. 其余机制全保留：候选 2 角色（最近成功聊过 + 羁绊最高，同一角色只发 1 条，`recent` 优先）、每小时 sweep + 打开聊天列表补当前窗口、AI 生成 15s 短超时 / 200 字符截断 / 失败模板兜底。
> 8. 存量：清空开发数据 + 加可空 `message_id` 列；**不写数据迁移转换**（生产无 module 7 存量数据）。

### 7.1 与旧冻结版（2026-08-04）的差异

| 维度 | 旧冻结版 | 新冻结版（2026-08-10） |
| --- | --- | --- |
| 展示位置 | 聊天列表页顶部「角色留言」卡片区 | 写入自由会话消息流（真实 assistant 消息） |
| 上下文 | 不进 Visible History、不进 Generation Context | 进 Visible History，但 `excludedFromContext=true` 不进 Generation Context |
| 未读/已读 | 表 `readAt` + 列表卡片 + 角色行红点 | 表 `readAt` + 聊天列表角色行红点；打开该角色会话即已读 |
| 窗口口径 | UTC 24h 桶（UTC 零点） | UTC+8 自然日（北京时间零点） |
| 「最近」排序 | 会话 `updatedAt` | 用户最后一条消息时间 |
| 存量数据 | — | 清空开发数据，不加迁移 |

### 7.2 数据模型变更

- `messages`：新增一行（`role='assistant'`、`outOfScope=false`、`excludedFromContext=true`、`generationStatus='completed'`，不计费字段）。
- `character_return_messages`（投递元数据）：
  - 新增可空 `message_id` uuid，外键 `messages.id`；
  - 保留 `userId`、`characterId`、`content`、`reason`、`windowStart`、`readAt`；
  - `windowStart` 改为 UTC+8 自然日零点；唯一索引 `(userId, characterId, windowStart)` 保持窗口去重。
- 新增 drizzle 迁移（如 `0008_return_messages_into_sessions.sql`）。

### 7.3 投递流程（拟）

1. `check` / `sweep` 触发时：按候选规则选 2 个角色；对每个候选校验「UTC+8 当日无记录 && 未读 < 3」。
2. 生成留言内容（AI 15s 超时 / 模板兜底）。
3. 落点：查该角色最近活跃自由会话（`status='active'`、`mode='free'`，按用户最后消息时间倒序）；无则创建自由会话。
4. 写 `messages`（`excludedFromContext=true`）+ 写 `character_return_messages`（`message_id` 回填、`readAt=null`）。
5. 打开该角色会话：幂等更新 `readAt`；聊天列表红点随未读消失。

### 7.4 预计文件

- Modify: `apps/api/src/server/modules/return-messages/service.ts`（落点、窗口、最近口径）
- Modify: `apps/api/src/server/modules/return-messages/scheduler.ts`
- Modify: `apps/api/src/server/db/schema.ts` + drizzle 迁移（`message_id`、窗口口径）
- Modify: `apps/api/src/app/api/return-messages/check/route.ts`、`read/route.ts`、`admin/return-messages/sweep/route.ts`
- Modify: `apps/api/src/server/modules/chat/character-summary-service.ts`（模块 6 同口径）
- Modify: `apps/miniapp/src/pages/chat/list.tsx` / `list.model.ts`（红点改为元数据驱动，去掉硬编码 unread）
- Test: 对应 service/route/model 测试
- Modify: `docs/api-v1.md`、`CONTEXT.md`

### 7.5 验收与测试

- 用户打开自由会话能看到角色主动发的一条消息；该消息不出现在生成上下文中（对话后可验证角色不会引用它）。
- 聊天列表该角色行红点出现，打开会话后消失；重复打开幂等。
- 每角色每北京时间自然日最多 1 条；未读达到 3 条后停止生成，已读后恢复。
- 注入留言后，「最近成功聊过」候选与模块 6 排序**不**因注入消息而前移（按用户最后消息时间）。
- 不产生点数/羁绊/成就变化；不增加成功轮数。


## 模块依赖与推荐执行顺序

```text
模块 2 旧内测基线（已完成）
  └─> 所有 P0 开发的安全前提

模块 1 预告角色状态（暂缓，待客户确认）
  ├─> 模块 5 剧本目录的可用性标签
  ├─> 模块 6 常聊角色排除预告角色
  └─> 模块 7 回访留言排除预告角色（模块 7 通过 active 过滤即可排除，不依赖模块 1 先行）

模块 7 回访留言（Spec 已冻结）
  └─> 独立验收，不等待其他模块

模块 4 首页布局
  ├─> 模块 5 剧本模式入口落位
  ├─> 模块 6 常聊角色区落位
  └─> 模块 7 回访留言展示落位

模块 3 羁绊更新
  └─> 可独立开发，但需与旧客户端兼容验收一起发布
```

**推荐批次（更新 2026-08-04）**

1. 批次 A：旧内测基线（模块 2）— ✅ 已完成
2. 批次 B：羁绊展示（模块 3）— ✅ Spec 已确认（2026-08-10）
3. 批次 C：首页热门剧本（模块 4）— ✅ Spec 已确认（2026-08-10）
4. 批次 D：剧本目录页（模块 5）— ✅ Spec 已确认（2026-08-10）
5. 批次 E：常聊角色（模块 6）— ✅ Spec 已确认（2026-08-10）
6. 批次 F：回访留言重开修复（模块 7）— ✅ Spec 已重新冻结（2026-08-10）
7. 模块 1（预告角色）待客户确认后插入批次

模块 7 建议独立验收，不应为了赶“七个需求同一次上线”而将留言塞入聊天表或省掉幂等/已读状态。

---

## 需要双方拍板的问题

> 状态标记：✅ 已确认 / ⏸️ 暂缓 / 🧭 待拍板

### A. 预告角色（⏸️ 暂缓，待与客户确认后恢复）

1. “灰色展示”是否确认为：可见、不可点击、不可聊天？ — 🧭
2. 新剧本本身是否可打开查看简介/世界观，还是整张剧本卡也不可点击？ — 🧭
3. 新剧本和角色的名称、文案、封面、头像、排序和“即将上线”文案由谁提供？ — 🧭

### B. 内测版本（✅ 已完成，负责人已搞定）

4. “旧版本”对应的微信体验版、Git commit 和服务端镜像分别是什么？ — ✅ 已解决
5. P0 开发期间，旧内测客户端是继续连现有共享 API，还是锁定一套独立内测 API？ — ✅ 按已定基线执行

### C. 羁绊（✅ 已确认 2026-08-10）

6. 用户界面最终使用「羁绊」、「亲密度」还是「好感度」？ — ✅ 使用「羁绊」，文案已定（2026-08-10）
7. 本期是只改展示/反馈，还是修改数值规则？ — ✅ 只改展示（统一文案、10 级封顶、+10/升级反馈、幂等不伪造）；数值规则保持 +10 / 100 一级 / 10 级封顶，待与客户另行 check

### D. 首页和剧本目录（✅ 已确认 2026-08-10）

8. 剧本模式入口是否为导航按钮？ — ✅ 是，首页标题区按钮，导航到 `/pages/script/catalog`，不在首页切换数据
9. 完整剧本目录页还是降级标签？ — ✅ 完整目录页（新建 `pages/script/catalog`）；本期仅「可用」状态，`availability` 字段预留、不写预告交互
10. 首页热门卡片高度与首屏露出量是否以截图比例验收？ — ✅ 以微信开发者工具截图验收；页码点在剧本 >1 时显示（新增确认）

### E. 常聊角色（✅ 已确认 2026-08-10）

11. “聊天次数”是否确认为成功 AI 回复轮数？ — ✅ 是（`role='assistant'`、`outOfScope=false`、`excludedFromContext=false`），与模块 7 成功回复定义一致
12. 常聊区展示前 2 / 前 4 / 横滑全部？ — ✅ 前 4 网格
13. 点击进角色详情还是直达聊天？ — ✅ 进角色详情页
14. 卡片是否展示聊天次数文案？ — ✅ 不展示
15. “最近”排序口径（tiebreaker / 模块 7 候选）？ — ✅ 用户最后一条消息时间（该会话 `role='user'` 消息最大 `createdAt`），不因注入留言前移

### F. 回访留言（✅ Spec 已重新冻结，2026-08-10）

16. 留言形态？ — ✅ 真实 assistant 消息写入自由会话消息流（`excludedFromContext=true`），可见但不进生成上下文
17. 落点？ — ✅ 最近活跃自由会话，无则新建；不复用已关闭会话；不插入剧本模式会话
18. 副作用？ — ✅ 不计点数/羁绊/成就/成功轮数
19. 未读/已读？ — ✅ 聊天列表角色行红点，打开该角色会话幂等已读（`character_return_messages` 投递元数据）
20. 窗口？ — ✅ UTC+8 自然日，每角色每日 1 条；未读累计上限 3 条
21. 其余机制？ — ✅ 全保留：候选 2 角色、每小时 sweep + 打开列表补窗口、AI 15s / 200 字符 / 模板兜底
22. 存量？ — ✅ 清空开发数据 + 可空 `message_id` 列，不加迁移


## 冻结后的验证命令

以下命令是每个批次的最低验证集，具体任务还需运行对应的定向测试：

```bash
rtk pnpm --filter @juben-sha/api test
rtk pnpm --filter @juben-sha/api typecheck
rtk pnpm --filter @juben-sha/miniapp-ui test
rtk pnpm --filter @juben-sha/miniapp-ui typecheck
rtk pnpm --filter @juben-sha/miniapp test
rtk pnpm --filter @juben-sha/miniapp typecheck
rtk pnpm test:deploy-config
rtk API_BASE_URL="https://<real-api-host>" pnpm --filter @juben-sha/miniapp build:weapp
rtk pnpm --filter @juben-sha/miniapp verify:weapp
```

最终还必须在微信开发者工具中验收：首页窄屏/宽屏布局、横向滑动、剧本目录跳转、预告角色禁用、常聊排序、羁绊刷新和回访留言已读闭环。

---

## 讨论结论的落档规则

- 上述 19 个问题确认后，将确认的领域词汇同步到 `CONTEXT.md`。
- 只有“回访留言独立于聊天消息”等难逆、不自明且经过真实权衡的决策，才需要新 ADR；视觉尺寸、按钮位置和文案不写 ADR。
- 模块 3/4/5/6 与模块 7 修订已于 2026-08-10 确认；本文档由「讨论稿」转为「已确认」，可按独立验收批次拆成执行任务。
