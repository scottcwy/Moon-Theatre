# 角色头像由 API 静态目录托管，不进小程序包

Status: accepted

背景：`ee8d3c4` 为压主包体积把所有角色头像从 jpg 转成 webp q72（19 张 ≈ 616 KB），seed 里的 `avatarUrl` 仍是 `/assets/characters/*.jpg`，前端靠一张 `.jpg → .webp` 重定向表兜底。2026-11-10 交付验收在 iPhone 上发现：**包内只有 `hakuzo.jpg`、`chengyuhuai.jpg` 两张 jpg 能显示，其余 19 张 webp 全部空白**，首页 hero（`/assets/second-contract/hero.webp`）同样空白 —— 规律与「jpg 显示 / webp 不显示」完全一致，属目标平台（iOS 微信）渲染 webp 失败。这是发布阻断问题。

决定：

- 角色头像移出小程序包，由 API 静态目录托管：`apps/api/public/assets/characters/*.jpg`，线上即 `https://api.yuemanlou.xyz/assets/characters/*.jpg`（Caddy 已把该域名反代到 api，因此不新增 Caddy 路由）。源图取 `ee8d3c4^` 的原始 600×600 jpg，避免从 webp 二次有损转码。
- **DB 不迁移**：`characters.avatarUrl` 继续存相对路径 `/assets/characters/*.jpg`，存量行无需改写。
- 小程序侧统一在一处拼基址：`getCharacterAvatarUrl` → `withAssetBase()`，相对路径拼构建期注入的 `API_BASE_URL`，绝对地址原样返回；包内不再有角色图与 `.jpg → .webp` 重定向表。
- 首页「月见庭院」hero 只是装饰背景、且在首屏，改为包内 `.jpg`（+43 KB），不走网络。
- 设计资产账本 `assets/design/manifest.json` 保留这些条目的版权与尺寸信息，新增 `"hosting": "api"`；`verify-visual-assets` 对 `hosting=api` 的资源改为校验 `apps/api/public` 下的文件，且**不计入首屏包体预算**。
- `apps/api/Dockerfile` 必须 `COPY public`（standalone 输出默认不带 `public/`），否则线上 404 —— 该改动与镜像发布必须同批。

后果：

- 主包从 2,026,419 B 降到 1,404,616 B（-621,803 B），首屏包体预算重新有富余。
- 角色头像改为网络加载：首屏多一次图片请求（单张 30–70 KB），失败时走 `ChatSessionRow`/`CharacterPosterCard` 既有的首字或占位分支。
- 视觉帧基线里角色头像像素会变（visual-fixture 的 mock 不再提供本地图），基线需按 `prepare-visual-baseline.mjs` 重导，且此后视觉门禁不再覆盖真实头像像素。
- `image` 组件的网络 `src` 不受微信「request 合法域名」限制，但**受「downloadFile 合法域名」约束**：上线前必须把 `https://api.yuemanlou.xyz` 加进 downloadFile 白名单，否则 iOS 真机报 `Load failed`、头像全空（2026-11-11 实测）。
