import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
