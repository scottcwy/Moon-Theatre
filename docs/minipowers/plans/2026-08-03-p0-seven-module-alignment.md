# P0 七模块需求对齐与实施 Plan（讨论稿 · 模块 7 已冻结）

> **For agentic workers:** 本文档尚未冻结，不得直接开始实施。待“需要双方拍板的问题”全部确认后，再转为可执行任务。执行时 REQUIRED SUB-SKILL: Use `minipowers:subagent-driven-development` (recommended) or `minipowers:executing-plans` task-by-task.
>
> **当前状态（2026-08-04）**
> - 模块 1（预告角色）：**暂缓**，待与客户确认后再做新角色。
> - 模块 2（内测基线）：**已完成**，由负责人搞定，不再展开。
> - 模块 3（羁绊）：等级名已定 6 级（檐下/灯前/杯沿/留盏/不言/入念），数值规则待重想并与客户 check。
> - 模块 7（回访留言）：**Spec 已冻结**（见下方模块 7），可进入实施拆分。
> - 模块 7 开发基线（2026-08-04 确认）：commit `caa414c`（含 drizzle/0005 与全部前置文件）；工作树 `.worktrees/return-messages`，分支 `codex/return-messages`。
> - 模块 4/5/6：仍为讨论稿，待拍板后冻结。

**Goal:** 在不改变现有角色和旧客户端核心行为的前提下，完成新角色预告、内测版本隔离、羁绊更新、首页展示优化、剧本模式导流、常聊角色排序和回访留言七个模块。

**Architecture:** 继续由 API 拥有角色可用性、会话、羁绊和回访留言状态，小程序只消费服务端事实。所有 API 和数据库变更保持向后兼容，旧内测客户端在 P0 开发期间继续使用已发布基线。回访留言使用独立数据模型，不写入聊天消息、不进入模型上下文。

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
| **回访留言** | 角色面向长时间未访问用户的独立未读消息，不属于聊天历史；每角色每 24h 最多 1 条，未读最多累计 3 条，满 3 停止生成直到已读 | 聊天消息、离线消息、微信推送 |
| **关系等级名** | 羁绊共 6 级：檐下→灯前→杯沿→留盏→不言→入念（顺序与数值规则待客户确认） | Lv.1–10、默契度等级混用 |
| **旧内测基线** | P0 开发前已验证并继续供内测用户使用的小程序体验版及其兼容 API | 旧版、线上版、测试版混用 |

词表确认后再同步到 `CONTEXT.md`；回访留言相关词条已随模块 7 Spec 冻结（2026-08-04），其余仍为讨论稿。

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

## 模块 7：角色回访留言（Spec 已冻结）

**工作量：XL**（新数据模型 + 后台定时生成 + 返回时补发 + 已读状态 + 聊天列表 UI 打通 + 幂等/防打扰）

> **冻结范围（2026-08-04 已确认，落档后不再讨论）**
> 1. 采用“提前写好存着”+“返回时补当前窗口”双机制（C+）。
> 2. 候选角色两个：最近成功聊过的 active 角色 + 羁绊最高角色；同一角色只发 1 条，不找替补。
> 3. 点留言 → 直接进入该角色的聊天页。
> 4. 进入该角色（点留言或点聊天列表行）即视为已读，红点消失。
> 5. AI 失败/超时用运营预置模板兜底，功能永不空白。

### 7.1 目前的实现情况

- 项目只有聊天 `messages`，没有角色留言、收件箱、通知、未读或用户最后访问时间数据模型。
- 小程序 `App` 目前没有 `onShow` 业务逻辑，也没有全局留言检查。
- 聊天列表中的 `unread` 只是 UI 组件演示能力（`ChatSessionRow` 已支持 `unread` prop），业务 API 没有未读数据。
- 微信订阅消息/站外推送尚未实现，客户原话只要求“重新上线之后看到”，不等于要求微信推送。

### 7.2 需要新增的功能

- 每个用户每 24h 窗口最多收到 1 条留言/角色；未读最多累计 3 条/角色，满 3 条后停止生成，直到用户已读。
- 留言角色固定两个：最近成功聊过的 active 角色 + 羁绊最高角色；同一角色只发 1 条。
- 留言由 AI 生成（服务器后台定时预写 + 用户返回时补当前窗口），失败用运营预置模板兜底。
- 留言显示在聊天列表页（顶部“角色留言”区 + 对应角色行未读红点），点击后直接进入该角色聊天页。
- 进入该角色（点留言或点聊天列表行）即视为已读；已读幂等。
- 留言与 `messages` 完全分离：不进可见历史、不进模型上下文、不改变点数/羁绊/成就。

### 7.3 具体的改动方案（已冻结）

**数据模型（仅一张表，`user_return_states` 不需要）**

```ts
export const characterReturnMessages = pgTable('character_return_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  characterId: uuid('character_id').references(() => characters.id).notNull(),
  content: text('content').notNull(),
  reason: varchar('reason', { length: 16 }).notNull(),   // 'recent' | 'bond'
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => ({
  // 每用户每角色每 24h 窗口最多 1 条 → 幂等核心
  windowUnique: uniqueIndex('character_return_messages_window_unique')
    .on(table.userId, table.characterId, table.windowStart),
  // 查未读列表 / 数未读数量
  unreadIdx: index('character_return_messages_unread_idx').on(table.userId, table.readAt),
}));
```

- `windowStart = floor(now / 86400000) * 86400000`（UTC 24h 桶）。节流、幂等、补发窗口全部由它承担，不需要 `user_return_states` 表。
- 3 条未读上限：查询 `count(readAt is null) >= 3` 即跳过该角色，无需额外字段。

**候选角色选择（两个都发，同一角色只发 1 条）**

- ① 最近聊过：`characters.status='active'` 的角色中，按 `chatSessions.updatedAt` 倒序取第一个，且该角色至少存在一条成功回复（`role='assistant'`、`outOfScope=false`、`excludedFromContext=false`——与模块 6 常聊聚合定义一致，不另造标准）。
- ② 羁绊最高：`relationships` 按 `bondLevel DESC, bondExp DESC, updatedAt DESC` 取第一个；角色必须 active。
- ①②为同一角色 → 只保留 1 条（不找替补）。无成功聊天/无羁绊 → 不生成、不报错。

**生成机制（提前写好 + 返回时补当前窗口）**

1. **后台定时生成（sweep）**：
   - `sweepReturnMessages()` 补齐“用户 × 候选角色 × 最近 3 个缺失窗口”且未读 < 3 的组合；AI 并发上限 4；插入走窗口唯一索引，幂等（重复运行/多实例最多浪费几次调用，不产生重复留言）。
   - 调度：API 进程内 `setInterval`（每 1 小时，`unref()`），启动时先跑一次兜底；不引入外部 cron/调度器。
   - 管理员手动触发：`POST /api/admin/return-messages/sweep`（复用现有 admin 鉴权）。
   - 从不回来的用户：未读满 3 条后永久跳过，成本封顶（每人最多 6 条）。
2. **返回时补当前窗口（check）**：
   - 聊天列表页 `useDidShow` 调 `POST /api/return-messages/check`（需登录）。
   - 对每个候选角色：未读已满 3 条或当前窗口已有留言 → 跳过；否则现场并行生成 1 条（最多 2 次调用，短超时 10–15s，失败模板兜底）。
   - 保证“重新上线一定会看到一条新的”，同时不等待历史窗口（历史由 sweep 提前写好）。
3. **AI 生成（generator）**：
   - 复用 FastClaw `streamChat`，非流式收集；prompt 用角色 `systemPrompt/personalityPrompt` + 固定指令（以角色口吻写 1–2 句话的回访留言，表达惦记/邀请回来，不提及具体剧情、不剧透、不用表情符号/Markdown）。
   - 内容截断 200 字符；超时 10–15s（聊天是 120s，留言绝不能拖住列表加载）。
   - 兜底：每个角色 seed 1–2 句运营审核过的模板，AI 失败/超时/空内容时使用。

**已读（幂等）**

- `POST /api/return-messages/read`，body `{ characterId }` → 将该用户该角色全部未读留言 `readAt=now`。
- 触发时机：点留言卡（导航到聊天页前）或点聊天列表该角色行，任一即已读；失败不阻断导航。

**客户端**

- 聊天列表页顶部新增“角色留言”区（展示全部未读，未读卡片带红点）；对应角色行 `ChatSessionRow` 传 `unread`（组件已支持）。
- 点留言卡 → `POST read` → 直接 `navigateTo` 该角色聊天页（`getCharacterChatUrl(latestSessionId)`，冻结决策 3B）。
- 数据流：`useDidShow` → `POST /api/return-messages/check` → 返回 `{ messages, characterUnread }`，与列表并行渲染；不改 `/api/chat/characters` 接口。

**推荐 API**

```http
POST /api/return-messages/check            # 用户返回时：返回未读 + 补当前窗口
POST /api/return-messages/read             # 按角色标记已读（幂等）
POST /api/admin/return-messages/sweep      # 管理员手动触发后台补发
```

**预计文件**

- Modify: `apps/api/src/server/db/schema.ts`
- Create: `apps/api/drizzle/0006_character_return_messages.sql`（编号按实际实施顺序分配；若模块 1 先实施则顺延）
- Create: `apps/api/src/server/modules/return-messages/service.ts`
- Create: `apps/api/src/server/modules/return-messages/generator.ts`
- Create: `apps/api/src/server/modules/return-messages/index.ts`
- Create: `apps/api/src/server/modules/return-messages/__tests__/service.test.ts`
- Create: `apps/api/src/server/modules/return-messages/__tests__/generator.test.ts`
- Create: `apps/api/src/app/api/return-messages/check/route.ts`
- Create: `apps/api/src/app/api/return-messages/check/route.test.ts`
- Create: `apps/api/src/app/api/return-messages/read/route.ts`
- Create: `apps/api/src/app/api/return-messages/read/route.test.ts`
- Create: `apps/api/src/app/api/admin/return-messages/sweep/route.ts`
- Create: `apps/api/src/app/api/admin/return-messages/sweep/route.test.ts`
- Modify: `apps/api/src/server/seed/story-data.ts`（或创建独立的留言模板 seed 文件）
- Create: `apps/miniapp/src/components/ReturnMessageCard.tsx`
- Create: `apps/miniapp/src/components/ReturnMessageCard.scss`
- Create: `apps/miniapp/src/components/ReturnMessageCard.test.tsx`
- Modify: `apps/miniapp/src/pages/chat/list.tsx`
- Modify: `apps/miniapp/src/pages/chat/list.model.ts`
- Test: `apps/miniapp/src/pages/chat/list.model.test.ts`
- Modify: `docs/api-v1.md`
- Modify: `CONTEXT.md`（词汇确认后）

**验收与测试**

- 同一角色同一 24h 窗口并发请求只创建一条留言（唯一索引幂等）。
- 用户离开 3 天回来：聊天列表秒开显示历史留言 + 今天的 1 条（若未满 3 条未读），红点正确。
- 未读满 3 条后不再生成；已读后恢复生成。
- 点留言 → 直接进该角色聊天页；点角色行 → 恢复会话且该角色留言全部已读；重复已读幂等。
- AI 失败/超时 → 模板兜底，接口仍成功；两个角色都失败 → 本次不新增，下次 check/sweep 重试。
- 留言不出现在聊天历史、不进入生成上下文、不改变点数/羁绊/成就。
- 无成功聊天、无羁绊、未登录、角色下架/预告 → 不生成、不报错、不阻断列表。
- sweep 重复运行/多实例 → 无重复留言，最多浪费几次 AI 调用。

---

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
2. 批次 B：回访留言（模块 7）— Spec 已冻结，优先实施
3. 批次 C：首页视觉结构 + 剧本目录/入口（模块 4、5）
4. 批次 D：常聊角色聚合（模块 6）
5. 批次 E：羁绊更新（模块 3）
6. 模块 1（预告角色）待客户确认后插入批次

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

### C. 羁绊（🧭 部分待定）

6. 用户界面最终使用“羁绊”、“亲密度”还是“好感度”？必须三选一。 — 🧭 等级名已定 6 级，主词与数值规则待确认
7. 本期是只改展示/反馈，还是修改 +10、100 经验一级、10 级封顶的数值规则？ — 🧭 待重想并和客户 check

### D. 首页和剧本目录（🧭 待拍板）

8. 剧本模式入口是否确认为导航按钮，而不是切换首页数据的开关？ — 🧭（默认：按钮）
9. 是实施完整剧本目录页，还是采用降级方案只加“剧本模式”标签？ — 🧭
10. 首页热门卡片的最终高度和首屏露出多少常聊角色，是否以截图比例为视觉验收？ — 🧭（默认：截图验收）

### E. 常聊角色（🧭 待拍板）

11. “聊天次数”是否确认为成功 AI 回复轮数，而不是打开会话次数或会话数？ — 🧭（默认：成功 AI 回复轮数，与模块 7 成功回复定义一致）
12. 常聊区展示前 2 个、前 4 个，还是可横向滑动全部？ — 🧭（默认：前 4 个网格）
13. 点击常聊角色后进角色详情，还是直接恢复最近聊天？ — 🧭（默认：进角色详情）

### F. 回访留言（✅ Spec 已冻结，2026-08-04）

14. 用户离开多久后才触发 — ✅ 不设“离开多久”阈值；采用“提前写好存着 + 返回时补当前窗口”，每 24h 窗口每角色最多 1 条
15. 留言用哪个角色 — ✅ 最近成功聊过的 active 角色 + 羁绊最高角色；同一角色只发 1 条
16. 留言内容怎么生成 — ✅ AI 生成（后台预写 + 返回时补当前窗口），失败用运营预置模板兜底
17. 留言显示在哪 — ✅ 聊天列表页顶部“角色留言”区 + 对应角色行未读红点
18. 点击留言后去哪 — ✅ 直接进入该角色聊天页
19. 留言频率上限 — ✅ 每角色每 24h 最多 1 条；未读最多累计 3 条，满 3 停止生成直到已读

---

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
- 模块 7 已冻结（2026-08-04）；其余模块拍板确认后，再将本文档“讨论稿”标记改为“已确认”，并按可独立验收批次拆成执行任务。
