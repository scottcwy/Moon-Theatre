const DEFAULT_JWT_SECRET = 'dev-secret-change-in-production';
const isProduction = process.env.NODE_ENV === 'production';
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;
const SUPPORTED_PAYMENT_PROVIDERS = new Set(['mock', 'aggregate']);
export function validateAdminOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password)
      throw new Error();
    return value;
  } catch { throw new Error('ADMIN_ORIGIN must be a canonical http(s) origin'); }
}

const rawConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/juben_sha',
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  wechatAppId: process.env.WECHAT_APP_ID || '',
  wechatAppSecret: process.env.WECHAT_APP_SECRET || '',
  fastclawBaseUrl: process.env.FASTCLAW_BASE_URL || 'http://localhost:18953',
  fastclawApiKey: process.env.FASTCLAW_API_KEY || '',
  fastclawAgentId: process.env.FASTCLAW_AGENT_ID || '',
  fastclawTimeoutMs: parseInt(process.env.FASTCLAW_TIMEOUT_MS || '120000', 10),
  fastclawFallbackEnabled: process.env.FASTCLAW_FALLBACK_ENABLED === 'true',
  // 角色 Agent 架构总开关：默认 false 保持现状（单 agent + API 组装 system prompt）。
  useRoleplayAgents: process.env.USE_ROLEPLAY_AGENTS === 'true',
  chatEffectsAsyncEnabled: process.env.CHAT_EFFECTS_ASYNC_ENABLED === 'true',
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  paymentMerchantId: process.env.PAYMENT_MERCHANT_ID || '',
  paymentAppId: process.env.PAYMENT_APP_ID || '',
  paymentSecret: process.env.PAYMENT_SECRET || '',
  paymentPublicKey: process.env.PAYMENT_PUBLIC_KEY || '',
  paymentPrivateKey: process.env.PAYMENT_PRIVATE_KEY || '',
  paymentNotifyUrl: process.env.PAYMENT_NOTIFY_URL || '',
  paymentReturnUrl: process.env.PAYMENT_RETURN_URL || '',
  adminOrigin: validateAdminOrigin(process.env.ADMIN_ORIGIN || 'http://localhost:3000'),
  // Local file storage only (no object storage, no CDN): content-addressed bytes live under this
  // directory. The delivery route never accepts a path, so this root is the only filesystem input.
  mediaRoot: process.env.MEDIA_ROOT || './data/media',
  devAuthBypass: !isProduction && process.env.DEV_AUTH_BYPASS === 'true',
  testUserInitialPoints: parseInt(process.env.TEST_USER_INITIAL_POINTS || '0', 10),
} as const;

validateProductionConfig(rawConfig);

export const config = rawConfig;

function validateProductionConfig(cfg: typeof rawConfig): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // During Next.js build lifecycle, the config module is loaded but
  // environment secrets are not yet available. Skip validation here;
  // runtime (docker entrypoint) will re-validate with real secrets.
  if (process.env.npm_lifecycle_event === 'build') {
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production');
  }

  if (!cfg.wechatAppId || !cfg.wechatAppSecret) {
    throw new Error('WECHAT_APP_ID and WECHAT_APP_SECRET must be set in production');
  }

  if (!process.env.JWT_SECRET || cfg.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a non-default value in production');
  }
  if (cfg.jwtSecret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`);
  }

  if (!SUPPORTED_PAYMENT_PROVIDERS.has(cfg.paymentProvider)) {
    throw new Error(`PAYMENT_PROVIDER is not supported: ${cfg.paymentProvider}`);
  }
  if (cfg.paymentProvider === 'mock') {
    throw new Error('PAYMENT_PROVIDER must not be mock in production');
  }

  if (cfg.paymentProvider === 'aggregate') {
    const missing = [
      ['PAYMENT_MERCHANT_ID', cfg.paymentMerchantId],
      ['PAYMENT_APP_ID', cfg.paymentAppId],
      ['PAYMENT_SECRET', cfg.paymentSecret],
      ['PAYMENT_NOTIFY_URL', cfg.paymentNotifyUrl],
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
      throw new Error(`Aggregate payment provider is not configured: ${missing.map(([key]) => key).join(', ')}`);
    }
  }

  if (!process.env.ADMIN_ORIGIN || cfg.adminOrigin !== 'https://api.yuemanlou.xyz') {
    throw new Error('ADMIN_ORIGIN must be explicitly set to https://api.yuemanlou.xyz in production');
  }
  if (cfg.fastclawFallbackEnabled) {
    throw new Error('FASTCLAW_FALLBACK_ENABLED must be false in production');
  }
  if (!Number.isInteger(cfg.testUserInitialPoints) || cfg.testUserInitialPoints !== 0) {
    throw new Error('TEST_USER_INITIAL_POINTS must be 0 in production');
  }
}
