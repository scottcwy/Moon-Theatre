# 月满楼小程序设计系统（当前 H5 剧场视觉）

> 状态：`FROZEN`（当前视觉契约）
> 实现状态：`IMPLEMENTED`
> 验收状态：`PARTIAL / VISUAL_BLOCKED`（功能 E2E 通过；13 帧视觉门禁受开发者工具 `390×844` 阻塞，要求 `375×812`）
> 最后更新：2026-10-19 · 基线提交 `1047c5b`

## 1. 权威与边界

当前视觉事实源的优先级：

1. `docs/specs/2026-10-01-H5视觉到Taro生产前端-多Agent实施冻结Spec.md`（H5 13 帧生产复刻契约）
2. `docs/specs/2026-10-19-月满楼小程序UI细节打磨Spec.md`（生产端细节与 E2E 收口）
3. `packages/miniapp-ui/src/styles/tokens.scss`、各页面 SCSS 和 `apps/miniapp/src/assets/design/manifest.json`（代码事实）
4. 本文档（设计系统摘要与实现状态）

如果本文档与上述 H5 Spec、UI 打磨 Spec 或 tokens 冲突，以 H5 Spec / UI 打磨 Spec / tokens 为准。

本文档不再描述旧版 Material Soft Roleplay 暖白体系；旧 `DESIGN.md` 内容保留在 git 历史中，仅用于追溯，不再作为视觉依据。H5 Playground 是本地设计核对工具，不是 C 端 H5 交付物。

## 2. 实现状态

### 2.1 已实现

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| H5 剧场视觉（登录、首页、聊天、聊天列表、角色详情、个人页、社区、分享预览） | 已实现 | 暗色舞台、金铜描边、米纸色信息面、全幅人物图 |
| 13 帧生产路由映射 | 已实现 | 对应 H5 Spec §4 / §5；视觉门禁仍受开发者工具视口阻塞 |
| 悬浮 tabbar 与选中态 | 已实现 | 106rpx bar、123rpx 选中态、统一 `$tabbar-reserve: 160rpx`，无顶部灰条 |
| 暗色状态卡 | 已实现 | `StatusStateCard surface="dark"`，聊天页 loading/未登录/错误/空态统一 |
| 角色图数据驱动 | 已实现 | 聊天头图使用 `backgroundImage`；角色详情恢复动态 hero，不再写死角色图 |
| 分享图片分享 | 已实现 | `Taro.showShareImageMenu`；不支持时降级为保存 |
| 聊天列表全量搜索 | 已实现 | 角色名 + 全部消息正文；空态与清空恢复全量通过 E2E |
| 登录 / 个人页 / 分享预览 custom navigation | 已实现 | 深色页不再出现浅色原生导航栏；个人页无双标题 |
| 触控与可读性收口 | 已实现 | 关键按钮/返回/搜索清理命中区补足；聊天列表深底文字已修正 |
| 点数空态、未读点、分享关闭、发送图标 | 已实现 | 点数 null 显示“点数 —”；未读点 16rpx 珊瑚色；图标改为 CSS 形状 |
| 配额、记忆等非 13 帧页面 | 已实现 | 保持 V1 浅色业务壳层，未纳入 H5 舞台视觉 |

### 2.2 未实现 / 未批准

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 完整社区信息流、发帖、评论、举报 | 未实现 | 当前为“社区正在布景”占位页；未批准本轮扩展 |
| 设置页 / 首页设置入口 | 未实现 | 无可用的设置页，首页齿轮已移除；需要另开 Spec |
| 真实在线状态 | 未实现 | 没有在线状态字段；固定“在线”badge 与头像在线点已删除 |
| 语音/图片消息输入 | 未实现 | 不在 V1 范围 |
| 宿舍、正式实名、防沉迷 | 未实现 | 不在 V1 范围 |
| 用户可切换主题（深/浅） | 未实现 | 当前固定 H5 暗色舞台；没有主题切换契约 |
| 角色专属 tint / 多套主题 | 未实现 | 当前统一舞台色，不做角色专属配色 |
| 书法标题、人物照片 3x 资源 | 未实现 | 当前 2x 源；DPR3 有轻微放大，待补 3x 源 |
| 管理后台视觉系统 | 未实现 | 仅有简单 admin，不在 H5 视觉范围 |
| C 端 H5 产品 | 未实现 | H5 仅用于设计 Playground 对照，不发布 C 端 H5 |

## 3. 视觉语言

### 3.1 色板

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| 舞台底 | `#170E12` | 首页、聊天、角色详情、聊天列表暗部 |
| 最深黑 | `#0D0708` | 登录页 |
| 酒红 | `#8B4258` / `#8D294A` | 主按钮、tabbar、资料卡 |
| 金铜 | `#E0BF94` / `#D9A36D` | 标题、描边、选中态、强调 |
| 米纸 | `#DECDBD` / `#DFCFBF` | 个人页、社区、聊天列表下半屏 |
| 原浅底 | `#FFFBF8` | 非舞台页/旧页面基础背景，不作为舞台页主背景 |

### 3.2 字体

- 标题、角色名、tabbar label、关键数字：`Georgia, 'Songti SC', serif`。
- 正文与输入：系统无衬线字体栈（`-apple-system`, `PingFang SC`, `Microsoft YaHei`）。
- 不新增生产字体依赖；MiSans 只保留在 H5 `&font=misans` 对照。

### 3.3 形体与布局

- 舞台页：全幅场景图/人物图 + 上下渐变遮罩；不使用整页 PNG 当 UI。
- 信息面：1rpx 金色细线、8–10rpx 小圆角画框；操作按钮用 pill。
- tabbar：`106rpx` 本体 + `123rpx` 选中态；内容在胶囊内居中；`$tabbar-reserve: 160rpx` 统一避让；不在 bar 上方加灰色遮罩。
- 触控：可交互元素命中区不小于 `88rpx`；视觉尺寸可小于命中区。
- 状态：`loading`、`empty`、`error`、`unauthenticated` 必须有明确状态；舞台页使用暗色状态卡，纸面页使用浅色卡。

## 4. 组件契约

- `StageTabBar`：CSS/矢量底，选中态宽度 `min(100%, 149rpx)`，未读点 16rpx 珊瑚色 + 深色描边。
- `PageShell` / `PageContainer`：tab 页只消费统一 `$tabbar-reserve`；非 tab 页不预留 tabbar 高度。
- `StatusStateCard`：支持 `surface="light" | "dark"`；聊天页全部使用 dark。
- `CharacterHeader`：必须使用数据驱动 `backgroundImage`；不再渲染固定在线点。
- `CharacterDetailHero`：使用角色动态 hero；返回键使用 `--topbar-status-height`；不写死角色图或在线 badge。
- `ChatInputBar`：安全区使用 `$safe-bottom` fallback；placeholder 用深色主题类；发送按钮用 CSS 图标。
- `SearchBar`：清除按钮用 CSS 标记；清空后恢复全量列表。
- `SharePreviewCard`：关闭按钮用 CSS 标记；“立即分享”走分享菜单，失败/不支持时降级保存。
- `Badge` / `PointsBadge`：可点 badge 命中区补足；`points=null` 显示 `点数 —`，不显示假 0。

## 5. 页面映射

| 帧 | 生产路由 | 状态 |
| --- | --- | --- |
| `1-773` | `pages/login/index` | 已实现 |
| `1-863` / `1-1164` | `pages/home/index` | 已实现 |
| `1-387` / `1-494` / `1-626` | `pages/chat/index` | 已实现 |
| `1-1657` / `1-2325` | `pages/character/detail` | 已实现 |
| `1-1766` / `1-1892` / `1-1987` | `pages/profile/index` | 已实现 |
| `1-2080` | `pages/chat/list` | 已实现 |
| `1-2180` | `pages/community/index` | 已实现 |

配额、记忆、分享预览等已有业务路由保持功能；没有对应 H5 帧的页面不自行扩展视觉范围。

## 6. 允许偏差

- 微信状态栏、胶囊、Home Indicator 不重建，由系统提供。
- 生产文案按已批准偏差：`使用微信登陆` → `登录`；`CONVERATION ARCHIVE / SEALED` → `CONVERSATION`；`灯时` → `点数`。
- H5 占位数字和占位文本不进入生产；缺数据走空态或 `—`。
- 生产使用系统字体栈；不新增 MiSans 生产依赖。
- H5 Playground、`PilotFrame`、`design-frames.json` 不进入生产包。

## 7. 验证

- `test:e2e:smoke`：通过。
- `test:e2e:ui`：10/10 页面通过。
- `test:e2e:ui:auth`：22/22 页面通过。
- `test:e2e:visual-frames`：阻塞于开发者工具 `390×844`，要求 `375×812`；不得宣称 13 帧视觉完全通过。
- 证据：`apps/miniapp/e2e/artifacts/`、`docs/specs/evidence/`、`docs/reports/2026-10-01-h5-visual-migration-acceptance.md`（快照 + 2026-10-19 更新）。
