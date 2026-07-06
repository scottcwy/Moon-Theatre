import { afterEach, describe, expect, it, vi } from 'vitest';

describe('exchangeWeChatCode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('rejects login when WeChat credentials are not configured', async () => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('fetch should not be called without WeChat credentials');
    }));

    const { exchangeWeChatCode } = await import('../wechat.service.js');

    await expect(exchangeWeChatCode('dev-code-123')).rejects.toThrow(
      'WeChat login is not configured',
    );
  });

  it('keeps WeChat error code and message for server-side diagnostics', async () => {
    vi.stubEnv('WECHAT_APP_ID', 'wx-app');
    vi.stubEnv('WECHAT_APP_SECRET', 'wx-secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      errcode: 40163,
      errmsg: 'code been used',
    }))));

    const { exchangeWeChatCode, WeChatCode2SessionError } = await import('../wechat.service.js');
    const error = await exchangeWeChatCode('used-code').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(WeChatCode2SessionError);
    expect(error).toMatchObject({
      code: 40163,
      message: 'WeChat code2session failed: 40163 code been used',
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

describe('grantTestUserInitialPoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('does nothing when test user initial points are not configured', async () => {
    vi.stubEnv('TEST_USER_INITIAL_POINTS', '');
    const creditWallet = vi.fn();
    vi.doMock('../../wallet/index.js', () => ({
      creditWallet,
    }));

    const { grantTestUserInitialPoints } = await import('../wechat.service.js');

    await expect(grantTestUserInitialPoints('user-1')).resolves.toBeUndefined();
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('does nothing when test user initial points are not a positive integer', async () => {
    vi.stubEnv('TEST_USER_INITIAL_POINTS', 'abc');
    const creditWallet = vi.fn();
    vi.doMock('../../wallet/index.js', () => ({
      creditWallet,
    }));

    const { grantTestUserInitialPoints } = await import('../wechat.service.js');

    await expect(grantTestUserInitialPoints('user-1')).resolves.toBeUndefined();
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('credits configured test points once per user with a stable idempotency key', async () => {
    vi.stubEnv('TEST_USER_INITIAL_POINTS', '1000');
    const creditWallet = vi.fn(async () => ({
      transactionId: 'wallet-tx',
      balanceAfter: 1000,
      alreadyCredited: false,
    }));
    vi.doMock('../../wallet/index.js', () => ({
      creditWallet,
    }));

    const { grantTestUserInitialPoints } = await import('../wechat.service.js');

    await expect(grantTestUserInitialPoints('00000000-0000-4000-8000-000000000001')).resolves.toBeUndefined();
    expect(creditWallet).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      1000,
      'test_user_initial_points_00000000-0000-4000-8000-000000000001',
    );
  });
});
