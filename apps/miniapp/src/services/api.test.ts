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
    vi.stubGlobal('API_BASE_URL', 'http://127.0.0.1:3000');
    vi.stubGlobal('DEV_AUTH_BYPASS', false);
    vi.stubGlobal('API_DEBUG_LOGS', false);
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

  it('clears the stored user session on logout', async () => {
    const { clearAuth, getToken, getUser, setToken, setUser } = await import('./api');
    setToken('auth-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null });

    clearAuth();

    expect(getToken()).toBe('');
    expect(getUser()).toBeNull();
  });

  it('verifies and refreshes a stored user session with /api/me', async () => {
    const { getUser, setToken, verifyStoredAuth } = await import('./api');
    setToken('auth-token');
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { id: 'user-id', nickname: '旅人', avatarUrl: null, status: 'active' },
    });

    await expect(verifyStoredAuth()).resolves.toBe(true);

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3000/api/me',
      method: 'GET',
    }));
    expect(getUser()).toEqual({ id: 'user-id', nickname: '旅人', avatarUrl: null });
  });

  it('keeps the stored user session when verification hits a transient network failure', async () => {
    const { getToken, getUser, setToken, setUser, verifyStoredAuth } = await import('./api');
    setToken('auth-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null });
    requestMock.mockRejectedValue({ errMsg: 'request:fail timeout' });

    await expect(verifyStoredAuth()).resolves.toBe(true);

    expect(getToken()).toBe('auth-token');
    expect(getUser()).toEqual({ id: 'user-id', nickname: '旅人', avatarUrl: null });
  });

  it('clears a stored user session when verification fails', async () => {
    const { getToken, getUser, setToken, setUser, verifyStoredAuth } = await import('./api');
    setToken('expired-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null });
    requestMock.mockResolvedValue({ statusCode: 401, data: { error: 'Unauthorized' } });

    await expect(verifyStoredAuth()).resolves.toBe(false);

    expect(getToken()).toBe('');
    expect(getUser()).toBeNull();
  });

  it('includes request details when the network request fails', async () => {
    const { api } = await import('./api');
    requestMock.mockRejectedValue({ errMsg: 'request:fail timeout' });

    await expect(api.get('/api/me')).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 0,
      message: '网络请求失败: GET http://127.0.0.1:3000/api/me (request:fail timeout)',
    });
  });

  it('sets an explicit timeout for regular API requests', async () => {
    const { api } = await import('./api');
    requestMock.mockResolvedValue({ statusCode: 200, data: { ok: true } });

    await api.get('/api/me');

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      timeout: 30000,
    }));
  });

  it('retries idempotent GET requests once after a transient timeout', async () => {
    const { api } = await import('./api');
    requestMock
      .mockRejectedValueOnce({ errMsg: 'request:fail timeout' })
      .mockResolvedValueOnce({ statusCode: 200, data: { ok: true } });

    await expect(api.get('/api/characters')).resolves.toEqual({ ok: true });

    expect(requestMock).toHaveBeenCalledTimes(2);
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

  it('decodes utf-8 arraybuffer chat chunks when TextDecoder is unavailable', async () => {
    const originalTextDecoder = globalThis.TextDecoder;
    vi.stubGlobal('TextDecoder', undefined);

    try {
      const { setToken, streamChat } = await import('./api');
      setToken('auth-token');

      let chunkHandler: ((res: { data: unknown }) => void) | undefined;
      requestMock.mockReturnValue({
        onChunkReceived: vi.fn((handler: (res: { data: unknown }) => void) => {
          chunkHandler = handler;
        }),
        abort: vi.fn(),
      });

      const onDelta = vi.fn();
      streamChat(
        {
          characterId: 'character-id',
          message: '你好',
          modelTier: 'standard',
        },
        {
          onDelta,
          onDone: vi.fn(),
          onError: vi.fn(),
        },
      );

      const line = JSON.stringify({ type: 'delta', content: '你好，铃音。' }) + '\n';
      const bytes = new TextEncoder().encode(line);
      const splitAt = bytes.findIndex((byte) => byte > 0x7f) + 1;

      chunkHandler?.({ data: bytes.slice(0, splitAt).buffer });
      chunkHandler?.({ data: bytes.slice(splitAt).buffer });

      expect(onDelta).toHaveBeenCalledWith('你好，铃音。');
    } finally {
      vi.stubGlobal('TextDecoder', originalTextDecoder);
    }
  });

  it('parses completed chat stream responses when chunk events are not delivered', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let requestOptions: {
      success?: (res: { statusCode: number; data: string }) => void;
    } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return {
        onChunkReceived: vi.fn(),
        abort: vi.fn(),
      };
    });

    const onDelta = vi.fn();
    const onDone = vi.fn();
    streamChat(
      {
        characterId: 'character-id',
        message: '你好',
        modelTier: 'standard',
      },
      {
        onDelta,
        onDone,
        onError: vi.fn(),
      },
    );

    requestOptions.success?.({
      statusCode: 200,
      data:
        JSON.stringify({ type: 'delta', content: '你好，铃音。' }) +
        '\n' +
        JSON.stringify({ type: 'done', messageId: 'message-id', sessionId: 'session-id' }) +
        '\n',
    });

    expect(onDelta).toHaveBeenCalledWith('你好，铃音。');
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-id',
      sessionId: 'session-id',
    }));
  });

  it('leaves cleanup headroom beyond the server FastClaw timeout', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let requestOptions: {
      timeout?: number;
    } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return {
        onChunkReceived: vi.fn(),
        abort: vi.fn(),
      };
    });

    streamChat(
      {
        characterId: 'character-id',
        message: '你好',
        modelTier: 'casual',
      },
      {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(requestOptions.timeout).toBe(130000);
  });
});
