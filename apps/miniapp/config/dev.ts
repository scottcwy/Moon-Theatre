import type { UserConfigExport } from '@tarojs/cli';

export default {
  env: {
    NODE_ENV: '"development"',
  },
  defineConstants: {
    API_BASE_URL: '"http://localhost:3000"',
    DEV_AUTH_BYPASS: 'true',
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;
