import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const requestMock = vi.fn();

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => storage.get(key) || ''),
    setStorageSync: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeStorageSync: vi.fn((key: string) => {
      storage.delete(key);
    }),
    request: requestMock,
  },
}));

describe('miniapp api client', () => {
  beforeEach(() => {
    vi.resetModules();
    requestMock.mockReset();
    storage.clear();
    vi.stubGlobal('API_BASE_URL', 'http://localhost:3000');
    vi.stubGlobal('DEV_AUTH_BYPASS', false);
  });

  it('treats the user as logged in when dev auth bypass is enabled', async () => {
    vi.stubGlobal('DEV_AUTH_BYPASS', true);
    const { getToken, getUser, isLoggedIn } = await import('./api');

    expect(isLoggedIn()).toBe(true);
    expect(getToken()).toBe('dev-auth-bypass-token');
    expect(getUser()).toEqual({
      id: 'dev-user',
      nickname: '开发调试用户',
      avatarUrl: null,
    });
  });

  it('stores the dev auth bypass user when requested', async () => {
    vi.stubGlobal('DEV_AUTH_BYPASS', true);
    const { applyDevAuthBypass, getToken, getUser } = await import('./api');

    expect(applyDevAuthBypass()).toBe(true);
    expect(getToken()).toBe('dev-auth-bypass-token');
    expect(getUser()).toEqual({
      id: 'dev-user',
      nickname: '开发调试用户',
      avatarUrl: null,
    });
  });

  it('throws a typed auth error and clears auth storage on 401', async () => {
    const { api, ApiError, setToken, setUser, isAuthExpiredError, getToken, getUser } = await import('./api');
    setToken('expired-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null });
    requestMock.mockResolvedValue({ statusCode: 401, data: { error: 'Unauthorized' } });

    await expect(api.get('/api/me')).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
      statusCode: 401,
    });

    await expect(api.get('/api/me')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/api/me')).rejects.toSatisfy(isAuthExpiredError);
    expect(getToken()).toBe('');
    expect(getUser()).toBeNull();
  });

  it('includes request details when the network request fails', async () => {
    const { api } = await import('./api');
    requestMock.mockRejectedValue({ errMsg: 'request:fail timeout' });

    await expect(api.get('/api/me')).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 0,
      message: '网络请求失败: GET http://localhost:3000/api/me (request:fail timeout)',
    });
  });

  it('passes balanceAfter through chat stream done events', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let chunkHandler: ((res: { data: string }) => void) | undefined;
    requestMock.mockReturnValue({
      onChunkReceived: vi.fn((handler: (res: { data: string }) => void) => {
        chunkHandler = handler;
      }),
      abort: vi.fn(),
    });

    const onDone = vi.fn();
    streamChat(
      {
        characterId: 'character-id',
        message: '你好',
        modelTier: 'standard',
      },
      {
        onDelta: vi.fn(),
        onDone,
        onError: vi.fn(),
      },
    );

    chunkHandler?.({
      data: JSON.stringify({
        type: 'done',
        messageId: 'message-id',
        sessionId: 'session-id',
        balanceAfter: 7,
      }) + '\n',
    });

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ balanceAfter: 7 }));
  });
});
