import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('../index.js');
}

function stubValidProductionEnv() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
  vi.stubEnv('JWT_SECRET', 'production-secret-0123456789abcdef');
  vi.stubEnv('WECHAT_APP_ID', 'wx-app');
  vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
  vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
  vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
  vi.stubEnv('PAYMENT_APP_ID', 'app');
  vi.stubEnv('PAYMENT_SECRET', 'payment-secret');
  vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://api.example.com/notify');
  vi.stubEnv('ADMIN_ORIGIN', 'https://api.yuemanlou.xyz');
  vi.stubEnv('FASTCLAW_FALLBACK_ENABLED', 'false');
  vi.stubEnv('TEST_USER_INITIAL_POINTS', '0');
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

    await expect(loadConfig()).rejects.toThrow('JWT_SECRET must be set to a non-default value in production');
  });

  it('rejects mock payments in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'production-secret-0123456789abcdef');
    vi.stubEnv('WECHAT_APP_ID', 'wx-app');
    vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');

    await expect(loadConfig()).rejects.toThrow('PAYMENT_PROVIDER must not be mock in production');
  });

  it('rejects short JWT secrets in production', async () => {
    stubValidProductionEnv();
    vi.stubEnv('JWT_SECRET', 'short-secret');

    await expect(loadConfig()).rejects.toThrow('JWT_SECRET must be at least 32 characters in production');
  });

  it('rejects unknown payment providers in production', async () => {
    stubValidProductionEnv();
    vi.stubEnv('PAYMENT_PROVIDER', 'stripe');

    await expect(loadConfig()).rejects.toThrow('PAYMENT_PROVIDER is not supported: stripe');
  });

  it('rejects FastClaw fallback and non-zero test points in production', async () => {
    stubValidProductionEnv();
    vi.stubEnv('FASTCLAW_FALLBACK_ENABLED', 'true');
    await expect(loadConfig()).rejects.toThrow('FASTCLAW_FALLBACK_ENABLED must be false in production');

    vi.unstubAllEnvs();
    stubValidProductionEnv();
    vi.stubEnv('TEST_USER_INITIAL_POINTS', '100');
    await expect(loadConfig()).rejects.toThrow('TEST_USER_INITIAL_POINTS must be 0 in production');
  });

  it('requires explicit production canonical origin, not obsolete Basic/whitelist settings', async () => {
    stubValidProductionEnv();
    vi.stubEnv('ADMIN_ORIGIN', '');
    await expect(loadConfig()).rejects.toThrow('ADMIN_ORIGIN');
    vi.stubEnv('ADMIN_ORIGIN', 'https://api.yuemanlou.xyz');
    const { config } = await loadConfig();
    expect(config.adminOrigin).toBe('https://api.yuemanlou.xyz');
    expect(config).not.toHaveProperty('adminUserIds');
    expect(config).not.toHaveProperty('adminBasicAuthPassword');
  });
  it('rejects noncanonical origins in every environment', async () => {
    for (const origin of ['https://api.test/', 'https://a:b@api.test', 'https://api.test/path', 'https://api.test?x', 'https://api.test#x', 'https://a.test https://b.test', 'file:///tmp', 'HTTPS://api.test', 'https://api.test:443']) {
      vi.stubEnv('ADMIN_ORIGIN', origin);
      await expect(loadConfig()).rejects.toThrow('ADMIN_ORIGIN');
    }
  });

  it('requires WeChat credentials in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/juben_sha');
    vi.stubEnv('JWT_SECRET', 'production-secret-0123456789abcdef');
    vi.stubEnv('PAYMENT_PROVIDER', 'aggregate');
    vi.stubEnv('PAYMENT_MERCHANT_ID', 'merchant');
    vi.stubEnv('PAYMENT_APP_ID', 'app');
    vi.stubEnv('PAYMENT_SECRET', 'secret');
    vi.stubEnv('PAYMENT_NOTIFY_URL', 'https://api.example.com/notify');

    await expect(loadConfig()).rejects.toThrow('WECHAT_APP_ID and WECHAT_APP_SECRET must be set in production');
  });

  it('skips production runtime validation during the Next build lifecycle', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('npm_lifecycle_event', 'build');
    // 与外部环境解耦：build 阶段应回退默认配置，不受外层 DATABASE_URL 影响。
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('JWT_SECRET', '');

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

  it('disables roleplay agents by default (USE_ROLEPLAY_AGENTS unset → false)', async () => {
    const { config } = await loadConfig();

    expect(config.useRoleplayAgents).toBe(false);
  });

  it('enables roleplay agents only when USE_ROLEPLAY_AGENTS=true', async () => {
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');

    const { config } = await loadConfig();

    expect(config.useRoleplayAgents).toBe(true);
  });
});
