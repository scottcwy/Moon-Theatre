# assets 资源目录

本目录是小程序端全部本地资源的唯一入口（`config/index.ts` 的 `copy` 会把 `src/assets` 原样拷贝进构建产物）。新增、删除、替换资源前先读这里。

## 目录职责

| 目录 | 用途 | 引用方 | 说明 |
|---|---|---|---|
| `icons/` | 底部 tabBar 图标 | `src/app.config.ts` | 每 tab 两张：`name.png`（未选中）+ `name-active.png`（选中） |
| `characters/` | 角色立绘/头像 | `src/pages/home/index.model.ts` | 900×900 JPG，`LOCAL_CHARACTER_AVATARS` 按角色名映射；流氓叙事 9 角色头像为占位图（chengyuhuai/jiangbojia/chengzouliu/miaohongmo/delilah/isaac/qiangqingci/odin/archie），正式图到位后替换 |
| `home/` | 首页脚本封面 | `src/pages/home/index.model.ts`、`src/pages/chat/list.tsx` | `LOCAL_SCRIPT_COVERS` 按 slug 映射；`moon-tower-cover.jpg` 为占位封面，正式图到位后替换 |
| `login/` | 登录页背景 | `src/pages/login/index.scss` | 通过 CSS `url()` 引用 |
| `lordicon/` | 成就动画图标（WebP） | `AchievementIcon`（`packages/miniapp-ui`） | 详见目录内 `README.md`，注意保留 Lordicon 署名 |

## 图标规范（`icons/`）

- 微信 tabBar 只支持本地 PNG/JPG，不支持 SVG/网络图片；本项目统一用 **PNG**。
- 建议尺寸 **81×81px**，单文件不超过 **40KB**（微信限制）。
- 双色约定：未选中用次级色 `#5A4A4E`，选中用品牌酒红 `#8B4258`，与 `app.config.ts` 的 `color` / `selectedColor` 一致。
- 命名：`<name>.png` / `<name>-active.png`，与 `app.config.ts` 的 `pagePath` 语义对应。

## 规则

- 新增资源放入对应目录并在此登记用途与引用方；不放死文件。
- 图片统一放 `assets/`，不散落在页面目录下。
- 删除资源前先全仓 grep 引用，确认无引用再删。
- 与视觉 token 相关的颜色走 `styles/tokens.scss`，不要在资源里硬编码业务色。
- 占位图统一用品牌酒红底 + 角色名文字（本目录 `characters/`、`home/` 内标注「占位」的 JPG）；正式美术图到位后整体替换，替换前先全仓 grep 确认引用。
