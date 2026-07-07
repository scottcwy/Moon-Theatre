import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('../index.js');
}

describe('server config production validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects the default JWT secret in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'dev-secret-change-in-production');
    vi.stubEnv('WECHAT_APP_ID', 'wx-app');
    vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
    vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
    vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
    vi.stubEnv('PAYMENT_APP_ID', 'app');
    vi.stubEnv('PAYMENT_SECRET', 'secret');
    vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://api.example.com/notify');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
    vi.stubEnv('ADMIN_BASIC_AUTH_USER', 'admin');
    vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', 'password');

    await expect(loadConfig()).rejects.toThrow('JWT_SECRET must be set to a non-default value in production');
  });

  it('rejects mock payments in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'production-secret');
    vi.stubEnv('WECHAT_APP_ID', 'wx-app');
    vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
    vi.stubEnv('ADMIN_BASIC_AUTH_USER', 'admin');
    vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', 'password');

    await expect(loadConfig()).rejects.toThrow('PAYMENT_PROVIDER must not be mock in production');
  });

  it('requires WeChat credentials in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'production-secret');
    vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
    vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
    vi.stubEnv('PAYMENT_APP_ID', 'app');
    vi.stubEnv('PAYMENT_SECRET', 'secret');
    vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://api.example.com/notify');
    vi.stubEnv('ADMIN_USER_IDS', 'admin-user');
    vi.stubEnv('ADMIN_BASIC_AUTH_USER', 'admin');
    vi.stubEnv('ADMIN_BASIC_AUTH_PASSWORD', 'password');

    await expect(loadConfig()).rejects.toThrow('WECHAT_APP_ID and WECHAT_APP_SECRET must be set in production');
  });

  it('skips production runtime validation during the Next build lifecycle', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('npm_lifecycle_event', 'build');

    const { config } = await loadConfig();

    expect(config.databaseUrl).toBe('postgres://postgres:postgres@localhost:5432/juben_sha');
    expect(config.jwtSecret).toBe('dev-secret-change-in-production');
  });

  it('allows development defaults', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('PAYMENT_PROVIDER', '');

    const { config } = await loadConfig();

    expect(config.jwtSecret).toBe('dev-secret-change-in-production');
    expect(config.paymentProvider).toBe('mock');
    expect(config.fastclawTimeoutMs).toBe(120000);
    expect(config.chatEffectsAsyncEnabled).toBe(false);
  });

  it('enables async chat effects only when the env flag is true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CHAT_EFFECTS_ASYNC_ENABLED', 'true');

    const { config } = await loadConfig();

    expect(config.chatEffectsAsyncEnabled).toBe(true);
  });
});
