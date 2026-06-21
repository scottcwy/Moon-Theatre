import type { UserConfigExport } from '@tarojs/cli';
import { getApiBaseUrlForMode } from './api-base-url';

const apiBaseUrl = getApiBaseUrlForMode('production');

export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
    DEV_AUTH_BYPASS: 'false',
    API_DEBUG_LOGS: 'false',
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;
