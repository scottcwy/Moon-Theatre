const DEFAULT_JWT_SECRET = 'dev-secret-change-in-production';

const rawConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/juben_sha',
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  wechatAppId: process.env.WECHAT_APP_ID || '',
  wechatAppSecret: process.env.WECHAT_APP_SECRET || '',
  fastclawBaseUrl: process.env.FASTCLAW_BASE_URL || 'http://localhost:18953',
  fastclawApiKey: process.env.FASTCLAW_API_KEY || '',
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  paymentMerchantId: process.env.PAYMENT_MERCHANT_ID || '',
  paymentAppId: process.env.PAYMENT_APP_ID || '',
  paymentSecret: process.env.PAYMENT_SECRET || '',
  paymentPublicKey: process.env.PAYMENT_PUBLIC_KEY || '',
  paymentPrivateKey: process.env.PAYMENT_PRIVATE_KEY || '',
  paymentNotifyUrl: process.env.PAYMENT_NOTIFY_URL || '',
  paymentReturnUrl: process.env.PAYMENT_RETURN_URL || '',
  adminUserIds: parseCsv(process.env.ADMIN_USER_IDS || ''),
  adminBasicAuthUser: process.env.ADMIN_BASIC_AUTH_USER || '',
  adminBasicAuthPassword: process.env.ADMIN_BASIC_AUTH_PASSWORD || '',
} as const;

validateProductionConfig(rawConfig);

export const config = rawConfig;

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateProductionConfig(cfg: typeof rawConfig): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production');
  }

  if (!process.env.JWT_SECRET || cfg.jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a non-default value in production');
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

  if (cfg.adminUserIds.length === 0) {
    throw new Error('ADMIN_USER_IDS must contain at least one user id in production');
  }

  if (!cfg.adminBasicAuthUser || !cfg.adminBasicAuthPassword) {
    throw new Error('ADMIN_BASIC_AUTH_USER and ADMIN_BASIC_AUTH_PASSWORD must be set in production');
  }
}
