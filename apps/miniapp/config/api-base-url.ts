export const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000';
export const PLACEHOLDER_API_HOST = ['api', 'example', 'com'].join('.');
const INVALID_TEST_DOMAIN_SUFFIX = '.invalid';

type BuildMode = 'development' | 'production';

function parseApiBaseUrl(apiBaseUrl: string): URL {
  try {
    return new URL(apiBaseUrl);
  } catch {
    throw new Error('API_BASE_URL must be a valid URL');
  }
}

function isPlaceholderApiUrl(apiBaseUrl: string): boolean {
  return apiBaseUrl.includes(PLACEHOLDER_API_HOST);
}

function isLocalApiUrl(apiBaseUrl: string): boolean {
  const hostname = parseApiBaseUrl(apiBaseUrl).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isInvalidTestDomain(apiBaseUrl: string): boolean {
  return parseApiBaseUrl(apiBaseUrl).hostname.endsWith(INVALID_TEST_DOMAIN_SUFFIX);
}

export function getApiBaseUrlForMode(mode: BuildMode, rawApiBaseUrl = process.env.API_BASE_URL): string {
  const apiBaseUrl = rawApiBaseUrl?.trim();

  if (mode === 'development') {
    if (!apiBaseUrl || isPlaceholderApiUrl(apiBaseUrl) || isInvalidTestDomain(apiBaseUrl)) {
      return LOCAL_API_BASE_URL;
    }
    parseApiBaseUrl(apiBaseUrl);
    return apiBaseUrl;
  }

  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required for miniapp production builds');
  }
  if (isPlaceholderApiUrl(apiBaseUrl)) {
    throw new Error(`API_BASE_URL must not use the placeholder ${PLACEHOLDER_API_HOST}`);
  }
  if (isInvalidTestDomain(apiBaseUrl)) {
    throw new Error('API_BASE_URL must not use a .invalid test domain');
  }
  if (isLocalApiUrl(apiBaseUrl)) {
    throw new Error('API_BASE_URL must not point to localhost for miniapp production builds');
  }

  return apiBaseUrl;
}
