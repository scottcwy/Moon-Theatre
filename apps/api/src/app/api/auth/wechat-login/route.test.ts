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
});
