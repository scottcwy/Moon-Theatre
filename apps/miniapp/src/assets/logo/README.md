# 月满楼 Logo

品牌视觉资产（矢量源文件 + 按小程序实际使用尺寸导出的位图）。

## 设计概念

满月 + 双层楼阁 + 檐下灯笼：呼应「月满楼」品牌名与「营业到天亮的酒楼」设定；
暖白圆盘、莓果深棕楼体、琥珀灯火，对齐 DESIGN.md 的 Material Soft Roleplay 色板。
v2 针对小尺寸可读性优化：月亮加大、楼阁加宽、灯笼放大、精简杂点。

## 使用场景与导出尺寸（rpx→px 按 375pt 屏 @3x 换算）

| 场景 | 渲染尺寸 | 使用文件 |
|---|---|---|
| 聊天列表页头部头像（80rpx 圆形） | 40pt ≈ 120px@3x | `logo-icon-480.png`（4× 余量） |
| 微信小程序头像（后台） | 144×144 最小 / 1024 推荐 | `logo-icon-144.png` / `logo-icon-1024.png` |
| 登录页品牌（深色底，金色） | 约 26rpx 字高 | `logo-wordmark-dark-600.png` |
| 分享海报底部角标（深色底） | 画布 600×840，约 100×32px | `logo-badge-dark-360.png` |
| 通用横版字标（浅色底） | — | `logo-wordmark-780.png` |
| 首页 TopBar / 原生导航栏 | 34rpx / 文字 | 空间过小，维持文字，不放图片 |

## 文件说明

| 文件 | 用途 |
|---|---|
| `logo-icon.svg` | 主图标矢量源（v2，透明背景 + 暖白圆盘） |
| `logo-icon-1024.png` / `-512.png` | 主图 / 通用图标 |
| `logo-icon-480.png` / `-240.png` | 圆形头像专用（大/小余量） |
| `logo-icon-144.png` | 微信头像最小尺寸 |
| `logo-icon-light.svg` / `-1024.png` | 深色背景用浅色版（透明背景） |
| `logo-wordmark.svg` | 图标 + 楷体字标矢量源（深棕，浅底用） |
| `logo-wordmark-780.png` / `-1560.png` | 浅底横版字标 |
| `logo-wordmark-dark.svg` / `-780.png` / `-600.png` | 深底横版字标（金色，登录页用） |
| `logo-wordmark-primary.svg` / `-780.png` | 主色横版字标（浅底强调用） |
| `logo-badge-dark.svg` / `-360.png` | 分享海报小角标（深底用） |

## 色板

- 圆盘 `#FFF7F1` / 环 `#E5CFC2`
- 满月 `#FDF0C8 → #EFC576`
- 楼体 `#3E222E` / 台基 `#54303E`
- 窗灯 / 灯笼 `#FFE7AE → #F0AE55`、`#E2732E`
- 深底字标金 `#F1C88F` / 副标 `#E9B87F`
