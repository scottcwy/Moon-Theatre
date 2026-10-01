# H5 视觉迁移验收报告

## 基线与集成

- H5 基线：`cd7afac`
- 冻结 Spec：`72faf65`
- 阶段 A 集成：`bff6933`
- 页面与资源集成：`1aeaa49`
- E2E 工具集成：`36f2b7e`
- 验收工作区：独立 worktree；主 `H5` 工作区已有修改未触碰。

## 已通过门禁

- `pnpm run typecheck`
- `pnpm test`：miniapp 211 tests，其他 workspace 测试通过
- `pnpm run test:dev-script`
- `pnpm run test:deploy-config`
- `pnpm --filter @juben-sha/miniapp typecheck`
- `pnpm --filter @juben-sha/miniapp build:weapp:prod`
- `pnpm --filter @juben-sha/miniapp verify:weapp`
- `pnpm --filter @juben-sha/miniapp verify:visual-assets`
- `pnpm --filter @juben-sha/miniapp test:e2e:smoke`
- `MOCK_API_PORT=3001 pnpm --filter @juben-sha/miniapp test:e2e:ui:auth`

资源校验报告：14 项资源，源资源 `1,340,317 B`，构建资源 `1,336,482 B`，主包上限 `2 MiB`，首屏资源上限 `800 KiB` 均通过。微信开发者工具版本 `2.01.2510260`，SDK `3.15.2`。

## 未通过或未完成门禁

- `pnpm --filter @juben-sha/miniapp test:e2e:visual-frames`：执行器已启动独立 fixture API 并连接微信开发者工具，但工具报告 `windowWidth=390`、`windowHeight=762`，与冻结的 `375x812` 不一致，按 Spec 直接失败；未生成 13 帧视觉通过结论。
- `pnpm --filter @juben-sha/miniapp test:e2e:ui`：login、home、chat-list、community、profile、memory、chat 通过；quota-buy、quota-result、share-preview 在 `App.captureScreenshot` 协议调用超时。
- 未完成真机、真实登录和 CDN 验证。

## 产物

- 视觉执行器：`apps/miniapp/e2e/visual-frames.mjs`
- 帧矩阵：`apps/miniapp/e2e/visual-frame-matrix.json`
- 比较器：`scripts/compare-visual-frames.mjs`
- 认证 UI 报告：`apps/miniapp/e2e/artifacts/runtime-ui-authenticated/report.json`
- 普通 UI 报告：`apps/miniapp/e2e/artifacts/runtime-ui/report.json`
- 视觉运行报告：`apps/miniapp/e2e/artifacts/visual-frames/`

## 结论

生产页面、资源接线、构建和确定性 E2E 工具已集成。冻结 Spec 要求的 13 帧视觉门禁和完整 UI E2E 仍需在可配置为 `375x812` 且 DevTools 截图协议稳定的环境中复验；本提交不宣称最终视觉验收完成。
