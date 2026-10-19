# 第二份合同 UI 证据

> 来源：`/Users/macbookpro/Desktop/ui第二份合同第一期第二期全部内容0.zip`
> 设计导出：2026-10-08
> Figma 文件：`月满楼交付本地文件 (Copy).fig`（Page 1 · 画板 `1030:1730` · 113 个图片资源）
> PNG：12 张，`1500×3247`；Figma 节点高度 `3246.15`；渲染目标 `375×812`
> 转换规则：PNG 统一 resize 到 `375×812`（`fit: fill`）生成 baseline；禁止直接拿 1500×3247 与 375×812 比较

| PNG | 语义名 | Figma 节点 | 页面/状态 | 本轮 |
| --- | --- | --- | --- | --- |
| `1.png` | `home-default` | `1030:2153` | Home 默认 | 包含（非支付） |
| `2.png` | `chat-empty` | `1030:1731` | Chat 空态/自由对话 | 包含（非支付） |
| `3.png` | `profile-loading` | `1030:2331` | Profile loading | 包含（非支付） |
| `4.png` | `chat-list-search-empty` | `1030:2424` | Chat list 搜索无结果 | 包含（非支付；fixture query 非空） |
| `5.png` | `chat-list-search-results` | `1030:2514` | Chat list 搜索命中 + 键盘 | 包含（非支付；keepKeyboard） |
| `6.png` | `home-search-results` | `1030:2580` | Home 搜索“月见” | 包含（非支付；keepKeyboard） |
| `7.png` | `home-search-empty` | `1030:2752` | Home 搜索无结果 | 包含（非支付；keepKeyboard） |
| `8.png` | `payment-confirm-sheet` | `1030:2823` | 确认支付 sheet | 包含（支付 UI-only；仅 overlay；整屏 `BLOCKED`） |
| `9.png` | `payment-result-failed` | `1030:2932` | 支付未完成 | 包含（支付 UI-only；仅 overlay；整屏 `BLOCKED`） |
| `10.png` | `share-preview` | `1030:3028` | 分享预览 + QR | 包含（非支付；QR fixture-only） |
| `11.png` | `quota-package-list` | `1030:3196` | 额度套餐列表 | 包含（支付 UI-only；视觉壳） |
| `12.png` | `payment-result-success` | `1030:3331` | 支付成功 | 包含（支付 UI-only；fixture） |

## 证据有效性

- `8.png`/`9.png` 同时包含成功态背景和确认/失败 overlay，**不是干净整屏基线**；整屏视觉验收记 `BLOCKED`。
- `8-confirm-overlay.png` / `9-failure-overlay.png` 只保留底部 sheet / 失败面板：源图从 `y=1739` 起裁，输出 `1500×1508`，圆角外区域置透明；不再包含“灯火已续，故事待启 / 60 点已到账”成功态文案。校验值：`8-confirm-overlay.png` 为 `4f4dc34d…4234e4`，`9-failure-overlay.png` 为 `c76f3397…5fc2ab`。
- 组件参考基线在 `component-375x812/`：overlay 等比缩到 `375×377`，贴到 `375×812` 画布的 `y=435`；`8` 用中性灰底 `#8A837B`，`9` 用米纸底 `#F3E9D8`。这是组件基线，不是整屏设计基线。
- `12.png` 是完整成功页，可作为整屏基线；`11.png` 是完整套餐列表页。
- `1030:1975`（`9317`）和 `1030:1843`（`9316`）是 `1173×2538` 的缩放/重复帧，不作为生产基线。
- `.fig` 与 `总览.jpg` 暂不复制进仓库（约 89MB），源文件仍在上述 zip；如需要可放入本目录 `source/`。

## Baseline

- `baseline-375x812/`：10 张整屏基线（1–7、10–12），由 PNG 直接 resize 到 `375×812`。
- `component-375x812/`：2 张组件基线（8、9），只用于 sheet / 结果面板比对。
- `baseline-manifest.json`：记录源文件、源尺寸、目标尺寸、组件基线贴图位置和 sha256。
- 生成规则：`1500×3247 → 375×812`（`fit: fill`）；overlay `1500×1508 → 375×377`，`y=435`。
