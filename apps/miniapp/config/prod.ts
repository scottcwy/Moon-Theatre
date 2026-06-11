import type { UserConfigExport } from '@tarojs/cli';

export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    API_BASE_URL: '"https://api.example.com"',
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;