import type { UserConfigExport } from '@tarojs/cli';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;
