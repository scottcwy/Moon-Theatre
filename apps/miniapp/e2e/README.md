# Miniapp E2E Smoke

This directory contains the first WeChat DevTools automation smoke test.

Run order:

```bash
NODE_ENV=development API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp
pnpm test:e2e:miniapp:ui
```

Authenticated/mock API runtime UI checks use the fixed local mock server port compiled into the miniapp bundle:

```bash
NODE_ENV=development DEV_AUTH_BYPASS=true API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @juben-sha/miniapp build:weapp
pnpm --filter @juben-sha/miniapp verify:weapp
pnpm test:e2e:miniapp:ui:auth
```

The smoke test uses `@weapp-vite/miniprogram-automator` and launches the built Taro project through WeChat DevTools.
The runtime UI test visits the primary miniapp pages, saves screenshots, and fails on hard runtime layout problems.
The authenticated runtime UI test starts a local mock API, drives logged-in page states, and covers chat failure, insufficient points, quota buy/result, and checkout navigation.

CLI resolution order:

1. `WECHAT_DEVTOOLS_CLI`
2. `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
3. `/Applications/微信开发者工具.app/Contents/MacOS/cli`

Do not run a production miniapp build with placeholder API hosts. `verify:weapp` must keep blocking placeholder and invalid test domains.
