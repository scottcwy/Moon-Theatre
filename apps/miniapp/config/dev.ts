import type { UserConfigExport } from '@tarojs/cli';
import { getApiBaseUrlForMode } from './api-base-url';

const apiBaseUrl = getApiBaseUrlForMode('development');

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
