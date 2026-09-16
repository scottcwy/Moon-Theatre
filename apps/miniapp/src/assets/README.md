# assets 资源目录

本目录是微信小程序本地运行图片的唯一入口。`config/index.ts` 只复制这里的运行资源，并排除 `**/*.md` 与 `**/.DS_Store`；不要在这里放源文件、视觉稿、设计证据或未接入素材。

## 目录职责

| 目录 | 数量 | 用途 | 引用方 |
|---|---:|---|---|
| `icons/` | 8 | 底部 tabBar 图标 | `src/app.config.ts` |
| `characters/` | 21 | 角色立绘/头像 | `src/pages/home/index.model.ts` |
| `home/` | 3 | 首页剧本封面 | `src/pages/home/index.model.ts`、`src/pages/chat/list.tsx` |
| `login/` | 1 | 登录页背景 | `src/pages/login/index.scss` |
| `logo/` | 1 | 聊天列表页品牌头像 | `src/pages/chat/list.tsx` |

## 当前运行资产索引

- `characters/`：`archie.jpg`、`cenyilan.jpg`、`chengyuhuai-female.jpg`、`chengyuhuai.jpg`、`chengzouliu.jpg`、`delilah.jpg`、`fuxiao.jpg`、`hakuzo.jpg`、`isaac.jpg`、`jiangbojia.jpg`、`jicanghai.jpg`、`kiyoharu.jpg`、`kuon.jpg`、`miaohongmo.jpg`、`mio.jpg`、`nanchuang.jpg`、`odin.jpg`、`qiangqingci-male.jpg`、`qiangqingci.jpg`、`yeshangqiu.jpg`、`zhihe.jpg`
- `home/`：`moon-garden-cover.jpg`、`moon-tower-cover.jpg`、`yunyun-cover.jpg`
- `icons/`：`chat-active.png`、`chat.png`、`community-active.png`、`community.png`、`home-active.png`、`home.png`、`profile-active.png`、`profile.png`
- `login/`：`login-theater-bg.jpg`
- `logo/`：`logo-icon-480.png`

角色与封面来源、尺寸和压缩说明：

- `characters/` 以 600×600 JPG 方形头像为主，源图来自官方角色海报或本地占位图；程聿怀、羌青瓷的性别变体按选角结果切换。
- `home/moon-tower-cover.jpg` 来自《流氓叙事》主海报；`home/yunyun-cover.jpg` 来自 `芸芸素材/00_主视觉封面_沧海浮尘.png`。
- `logo/logo-icon-480.png` 是聊天列表页运行文件。

## 图标规范（`icons/`）

- 微信 tabBar 只支持本地 PNG/JPG，不支持 SVG/网络图片；本项目统一用 **PNG**。
- 建议尺寸 **81×81px**，单文件不超过 **40KB**（微信限制）。
- 双色约定：未选中用次级色 `#5A4A4E`，选中用品牌酒红 `#8B4258`，与 `app.config.ts` 的 `color` / `selectedColor` 一致。
- 命名：`<name>.png` / `<name>-active.png`，与 `app.config.ts` 的 `pagePath` 语义对应。

## 规则

- 新增运行图片放入对应目录，并同步更新本索引中的数量、文件名和引用方；不放死文件。
- 本目录只放会进入微信主包的运行图片。视觉稿、证据和源文件不得放入。
- 删除资源前先全仓 grep 引用，确认无引用再删。
- 与视觉 token 相关的颜色走 `styles/tokens.scss`，不要在资源里硬编码业务色。
- 占位图统一用品牌酒红底 + 角色名文字（本目录 `characters/`、`home/` 内标注「占位」的 JPG）；正式美术图到位后整体替换，替换前先全仓 grep 确认引用。
- 头像源图是竖版海报，显示端统一 `aspectFill` 裁切；替换图源时抽查圆形小头像与详情页 hero 的裁切效果。
- 成就图标当前使用 `AchievementIcon` 的本地兜底字形；接入 Lordicon 等真实动画资源时再新建目录，并保留所需署名。
