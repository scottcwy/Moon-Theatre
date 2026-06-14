import type { UserConfigExport } from '@tarojs/cli';

function getRequiredApiBaseUrl(): string {
  const apiBaseUrl = process.env.API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required for miniapp production builds');
  }
  if (apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')) {
    throw new Error('API_BASE_URL must not point to localhost for miniapp production builds');
  }
  return apiBaseUrl;
}

const apiBaseUrl = getRequiredApiBaseUrl();

export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
    DEV_AUTH_BYPASS: 'false',
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport;
