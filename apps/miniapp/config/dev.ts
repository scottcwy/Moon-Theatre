import type { UserConfigExport } from '@tarojs/cli';

const apiBaseUrl = process.env.API_BASE_URL?.trim() || 'http://localhost:3000';

export default {
  env: {
    NODE_ENV: '"development"',
  },
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
    DEV_AUTH_BYPASS: JSON.stringify(process.env.DEV_AUTH_BYPASS === 'true'),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;
