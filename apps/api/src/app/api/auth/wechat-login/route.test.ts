import { afterEach, describe, expect, it, vi } from 'vitest';

function makeRequest(body: unknown) {
  return new Request('https://api.example.com/api/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/wechat-login', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 400 for invalid WeChat login codes without exposing upstream details', async () => {
    vi.doMock('@/server/modules/auth/index.js', () => ({
      WeChatCode2SessionError: class WeChatCode2SessionError extends Error {},
      exchangeWeChatCode: vi.fn(async () => {
        throw new Error('WeChat code2session failed: 40029 invalid code');
      }),
      findOrCreateUser: vi.fn(),
      signJwt: vi.fn(),
    }));

    const { POST } = await import('./route.js');
    const response = await POST(makeRequest({ code: 'bad-code' }) as never);

    await expect(response.json()).resolves.toEqual({ error: '微信登录凭证无效，请重试' });
    expect(response.status).toBe(400);
  });

  it('returns 503 when WeChat login is not configured', async () => {
    vi.doMock('@/server/modules/auth/index.js', () => ({
      WeChatCode2SessionError: class WeChatCode2SessionError extends Error {},
      exchangeWeChatCode: vi.fn(async () => {
        throw new Error('WeChat login is not configured');
      }),
      findOrCreateUser: vi.fn(),
      signJwt: vi.fn(),
    }));

    const { POST } = await import('./route.js');
    const response = await POST(makeRequest({ code: 'code' }) as never);

    await expect(response.json()).resolves.toEqual({ error: '微信登录暂不可用，请稍后再试' });
    expect(response.status).toBe(503);
  });

  it('grants test user points after a successful WeChat login', async () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      nickname: null,
      avatarUrl: null,
    };
    const grantTestUserInitialPoints = vi.fn(async () => undefined);

    vi.doMock('@/server/modules/auth/index.js', () => ({
      WeChatCode2SessionError: class WeChatCode2SessionError extends Error {},
      exchangeWeChatCode: vi.fn(async () => ({ openid: 'openid-1', sessionKey: 'session-key' })),
      findOrCreateUser: vi.fn(async () => user),
      grantTestUserInitialPoints,
      signJwt: vi.fn(async () => 'jwt-token'),
    }));

    const { POST } = await import('./route.js');
    const response = await POST(makeRequest({ code: 'valid-code' }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: 'jwt-token',
      user,
    });
    expect(grantTestUserInitialPoints).toHaveBeenCalledWith(user.id);
  });
});
