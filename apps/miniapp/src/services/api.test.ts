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
      preferredName: null,
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
      preferredName: null,
    });
  });

  it('throws a typed auth error and clears auth storage on 401', async () => {
    const { api, ApiError, setToken, setUser, isAuthExpiredError, getToken, getUser } = await import('./api');
    setToken('expired-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: null });
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
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: null });

    clearAuth();

    expect(getToken()).toBe('');
    expect(getUser()).toBeNull();
  });

  it('verifies and refreshes a stored user session with /api/me', async () => {
    const { getUser, setToken, verifyStoredAuth } = await import('./api');
    setToken('auth-token');
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: '小岚', status: 'active' },
    });

    await expect(verifyStoredAuth()).resolves.toBe(true);

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3000/api/me',
      method: 'GET',
    }));
    expect(getUser()).toEqual({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: '小岚' });
  });

  it('keeps the stored user session when verification hits a transient network failure', async () => {
    const { getToken, getUser, setToken, setUser, verifyStoredAuth } = await import('./api');
    setToken('auth-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: null });
    requestMock.mockRejectedValue({ errMsg: 'request:fail timeout' });

    await expect(verifyStoredAuth()).resolves.toBe(true);

    expect(getToken()).toBe('auth-token');
    expect(getUser()).toEqual({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: null });
  });

  it('clears a stored user session when verification fails', async () => {
    const { getToken, getUser, setToken, setUser, verifyStoredAuth } = await import('./api');
    setToken('expired-token');
    setUser({ id: 'user-id', nickname: '旅人', avatarUrl: null, preferredName: null });
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

  it('passes chat stream done metadata through to callers', async () => {
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
        mode: 'free',
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
        clientMessageId: 'client-message-id',
        replayed: true,
        blocked: false,
        outOfScope: true,
        bondLevel: 2,
        bondExp: 10,
        bondDelta: 10,
        leveledUp: true,
        unlockedAchievements: [{ code: 'first_chat', name: '初次相逢' }],
        unlockedTitles: [{ code: 'moon_walker', name: '月下行者' }],
        balanceAfter: 7,
      }) + '\n',
    });

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      clientMessageId: 'client-message-id',
      replayed: true,
      blocked: false,
      outOfScope: true,
      bondLevel: 2,
      bondExp: 10,
      bondDelta: 10,
      leveledUp: true,
      unlockedAchievements: [{ code: 'first_chat', name: '初次相逢' }],
      unlockedTitles: [{ code: 'moon_walker', name: '月下行者' }],
      balanceAfter: 7,
    }));
  });

  it('sends clientMessageId with chat stream requests and returns error codes before raw messages', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let chunkHandler: ((res: { data: string }) => void) | undefined;
    let requestOptions: { data?: Record<string, unknown> } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return {
        onChunkReceived: vi.fn((handler: (res: { data: string }) => void) => {
          chunkHandler = handler;
        }),
        abort: vi.fn(),
      };
    });

    const onError = vi.fn();
    streamChat(
      {
        characterId: 'character-id',
        message: '你好',
        modelTier: 'standard',
        clientMessageId: 'client-message-1',
        mode: 'script',
        scriptId: 'script-id',
      },
      {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError,
      },
    );

    expect(requestOptions.data).toMatchObject({
      clientMessageId: 'client-message-1',
      mode: 'script',
      scriptId: 'script-id',
    });

    chunkHandler?.({
      data: JSON.stringify({
        type: 'error',
        code: 'upstream_error',
        message: 'FastClaw responded with status 500',
      }) + '\n',
    });

    expect(onError).toHaveBeenCalledWith('upstream_error');
  });

  it('sends free chat scope without a script id', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let requestOptions: { data?: Record<string, unknown> } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return { onChunkReceived: vi.fn(), abort: vi.fn() };
    });

    streamChat(
      {
        characterId: 'character-id',
        message: '聊聊今天吧',
        modelTier: 'casual',
        clientMessageId: 'client-message-free',
        mode: 'free',
      },
      { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    );

    expect(requestOptions.data).toMatchObject({ mode: 'free' });
    expect(requestOptions.data).not.toHaveProperty('scriptId');
  });

  it('passes the persisted mode from done events through to callers', async () => {
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
        mode: 'free',
      },
      { onDelta: vi.fn(), onDone, onError: vi.fn() },
    );

    chunkHandler?.({
      data: JSON.stringify({
        type: 'done',
        messageId: 'message-id',
        sessionId: 'session-id',
        mode: 'free',
      }) + '\n',
    });

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ mode: 'free' }));
  });

  it('uses stable stream error codes from non-2xx responses', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let requestOptions: { success?: (res: { statusCode: number; data: unknown }) => void } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return { onChunkReceived: vi.fn(), abort: vi.fn() };
    });

    const onError = vi.fn();
    streamChat(
      {
        characterId: 'character-id',
        message: '继续',
        modelTier: 'standard',
        mode: 'script',
        scriptId: 'retired-script',
      },
      { onDelta: vi.fn(), onDone: vi.fn(), onError },
    );

    requestOptions.success?.({ statusCode: 409, data: { error: 'script_unavailable' } });

    expect(onError).toHaveBeenCalledWith('script_unavailable');
  });

  it('stops stream error recovery after authentication expires', async () => {
    const { setToken, streamChat } = await import('./api');
    setToken('auth-token');

    let requestOptions: { success?: (res: { statusCode: number; data: unknown }) => void } = {};
    requestMock.mockImplementation((options) => {
      requestOptions = options;
      return { onChunkReceived: vi.fn(), abort: vi.fn() };
    });

    const onAuthExpired = vi.fn();
    const onError = vi.fn();
    streamChat(
      { characterId: 'character-id', message: '你好', modelTier: 'standard', mode: 'free' },
      { onDelta: vi.fn(), onDone: vi.fn(), onError, onAuthExpired },
    );

    requestOptions.success?.({ statusCode: 401, data: { error: 'Unauthorized' } });

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
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
          mode: 'free',
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
        mode: 'free',
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
        mode: 'free',
      },
      {
        onDelta: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      },
    );

    expect(requestOptions.timeout).toBe(150000);
  });

  it('emits stream_stalled and aborts after 30s without any chunk and ignores late callbacks', async () => {
    vi.useFakeTimers();
    try {
      const { setToken, streamChat } = await import('./api');
      setToken('auth-token');

      let chunkHandler: ((res: { data: string }) => void) | undefined;
      const abortMock = vi.fn();
      requestMock.mockReturnValue({
        onChunkReceived: vi.fn((handler: (res: { data: string }) => void) => {
          chunkHandler = handler;
        }),
        abort: abortMock,
      });

      const onDelta = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      streamChat(
        {
          characterId: 'character-id',
          message: '你好',
          modelTier: 'standard',
          mode: 'free',
        },
        { onDelta, onDone, onError },
      );

      await vi.advanceTimersByTimeAsync(30000);
      expect(onError).toHaveBeenCalledWith('stream_stalled');
      expect(abortMock).toHaveBeenCalledTimes(1);

      // 迟到回调（stall 后 mock 仍写 delta/done）必须被忽略
      chunkHandler?.({
        data: JSON.stringify({ type: 'delta', content: '迟到的内容' }) + '\n',
      });
      chunkHandler?.({
        data: JSON.stringify({ type: 'done', messageId: 'message-id', sessionId: 'session-id' }) + '\n',
      });
      expect(onDelta).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the stall heartbeat whenever any chunk arrives', async () => {
    vi.useFakeTimers();
    try {
      const { setToken, streamChat } = await import('./api');
      setToken('auth-token');

      let chunkHandler: ((res: { data: string }) => void) | undefined;
      requestMock.mockReturnValue({
        onChunkReceived: vi.fn((handler: (res: { data: string }) => void) => {
          chunkHandler = handler;
        }),
        abort: vi.fn(),
      });

      const onDelta = vi.fn();
      const onError = vi.fn();
      streamChat(
        {
          characterId: 'character-id',
          message: '你好',
          modelTier: 'standard',
          mode: 'free',
        },
        { onDelta, onDone: vi.fn(), onError },
      );

      chunkHandler?.({ data: JSON.stringify({ type: 'delta', content: '第一段' }) + '\n' });
      await vi.advanceTimersByTimeAsync(29000);
      chunkHandler?.({ data: JSON.stringify({ type: 'delta', content: '第二段' }) + '\n' });
      await vi.advanceTimersByTimeAsync(29000);
      expect(onError).not.toHaveBeenCalled();
      expect(onDelta).toHaveBeenCalledWith('第一段');
      expect(onDelta).toHaveBeenCalledWith('第二段');

      await vi.advanceTimersByTimeAsync(30000);
      expect(onError).toHaveBeenCalledWith('stream_stalled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes done.content through for blocked outputs', async () => {
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
        mode: 'free',
      },
      { onDelta: vi.fn(), onDone, onError: vi.fn() },
    );

    chunkHandler?.({
      data: JSON.stringify({
        type: 'done',
        messageId: 'message-id',
        sessionId: 'session-id',
        blocked: true,
        content: '回复触发了安全机制，该消息已被替换。',
        someFutureField: { nested: true },
      }) + '\n',
    });

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      blocked: true,
      content: '回复触发了安全机制，该消息已被替换。',
    }));
    // 老客户端兼容：未知字段不进入回调、不报错（Spec 2 §5 老版本客户端兼容）。
    expect(onDone.mock.calls[0]![0]).not.toHaveProperty('someFutureField');
  });
});
