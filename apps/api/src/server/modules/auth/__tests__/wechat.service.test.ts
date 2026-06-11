import { afterEach, describe, expect, it, vi } from 'vitest';

describe('exchangeWeChatCode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses a deterministic dev session when WeChat credentials are not configured', async () => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('fetch should not be called without WeChat credentials');
    }));

    const { exchangeWeChatCode } = await import('../wechat.service.js');

    await expect(exchangeWeChatCode('dev-code-123')).resolves.toEqual({
      openid: 'dev-openid-dev-code-123',
      sessionKey: 'dev-session-key',
    });
  });
});
