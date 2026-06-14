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

describe('findOrCreateUser', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('uses an upsert so concurrent first requests return the same user instead of racing inserts', async () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      openid: 'dev-auth-bypass',
      nickname: null,
      avatarUrl: null,
    };
    const returning = vi.fn(async () => [user]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    vi.doMock('../../../db/index.js', () => ({
      db: { insert },
    }));

    const { findOrCreateUser } = await import('../wechat.service.js');

    await expect(findOrCreateUser('dev-auth-bypass')).resolves.toEqual(user);
    expect(values).toHaveBeenCalledWith({
      openid: 'dev-auth-bypass',
      nickname: null,
      avatarUrl: null,
      status: 'active',
    });
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
  });
});
