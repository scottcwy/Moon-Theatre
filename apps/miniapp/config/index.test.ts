import { afterEach, describe, expect, it, vi } from 'vitest';

const placeholderApiHost = ['api', 'example', 'com'].join('.');
const placeholderApiBaseUrl = `https://${placeholderApiHost}`;
const placeholderError = `API_BASE_URL must not use the placeholder ${placeholderApiHost}`;

describe('miniapp config auth constants', () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    vi.resetModules();
  });

  it('does not enable dev auth bypass merely because the build is in watch mode', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_AUTH_BYPASS;
    process.argv = ['node', 'taro', '--watch'];

    const config = await import('./index');

    expect(config.default.defineConstants.DEV_AUTH_BYPASS).toBe('false');
  });

  it('enables dev auth bypass only when explicitly requested', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_BYPASS = 'true';
    process.argv = ['node', 'taro', '--watch'];

    const config = await import('./index');

    expect(config.default.defineConstants.DEV_AUTH_BYPASS).toBe('true');
  });

  it('keeps the development override aligned with the explicit bypass flag', async () => {
    process.env.DEV_AUTH_BYPASS = 'false';

    const config = await import('./dev');

    expect(config.default.defineConstants?.DEV_AUTH_BYPASS).toBe('false');
  });

  it('enables API debug logs only when explicitly requested in development', async () => {
    process.env.API_DEBUG_LOGS = 'true';

    const config = await import('./dev');

    expect(config.default.defineConstants?.API_DEBUG_LOGS).toBe('true');
  });

  it('keeps API debug logs disabled for production builds', async () => {
    process.env.API_BASE_URL = 'https://api.real.example';
    process.env.API_DEBUG_LOGS = 'true';

    const config = await import('./prod');

    expect(config.default.defineConstants?.API_DEBUG_LOGS).toBe('false');
  });

  it('lets the development override use an explicit API base URL', async () => {
    process.env.API_BASE_URL = 'http://127.0.0.1:3000';

    const config = await import('./dev');

    expect(config.default.defineConstants?.API_BASE_URL).toBe('"http://127.0.0.1:3000"');
  });

  it('lets the development override replace the placeholder API URL with the local API', async () => {
    process.env.API_BASE_URL = placeholderApiBaseUrl;

    const config = await import('./dev');

    expect(config.default.defineConstants?.API_BASE_URL).toBe('"http://127.0.0.1:3000"');
  });

  it('uses the local API when a development watch build receives the placeholder API URL', async () => {
    process.env.NODE_ENV = 'development';
    process.env.API_BASE_URL = placeholderApiBaseUrl;
    process.argv = ['node', 'taro', '--watch'];

    const config = await import('./index');

    expect(config.default.defineConstants.API_BASE_URL).toBe('"http://127.0.0.1:3000"');
  });

  it('uses the local API when a development watch build receives any URL containing the placeholder API host', async () => {
    process.env.NODE_ENV = 'development';
    process.env.API_BASE_URL = `https://debug.local/proxy?target=${placeholderApiBaseUrl}`;
    process.argv = ['node', 'taro', '--watch'];

    const config = await import('./index');

    expect(config.default.defineConstants.API_BASE_URL).toBe('"http://127.0.0.1:3000"');
  });

  it('rejects the placeholder API URL for non-development builds', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_BASE_URL = placeholderApiBaseUrl;
    process.argv = ['node', 'taro', 'build'];

    await expect(import('./index')).rejects.toThrow(placeholderError);
  });

  it('rejects the placeholder API URL in the production override', async () => {
    process.env.API_BASE_URL = placeholderApiBaseUrl;

    await expect(import('./prod')).rejects.toThrow(placeholderError);
  });

  it('rejects production API URLs that contain the placeholder API host anywhere', async () => {
    process.env.API_BASE_URL = `https://real.example/proxy?target=${placeholderApiBaseUrl}`;

    await expect(import('./prod')).rejects.toThrow(placeholderError);
  });
});
