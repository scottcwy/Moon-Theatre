import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const requestMock = vi.fn();
const showTabBarRedDotMock = vi.fn(() => Promise.resolve());
const hideTabBarRedDotMock = vi.fn(() => Promise.resolve());

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
    showTabBarRedDot: showTabBarRedDotMock,
    hideTabBarRedDot: hideTabBarRedDotMock,
  },
}));

async function login() {
  const { setToken } = await import('./api');
  setToken('auth-token');
}

describe('chat tab red dot', () => {
  beforeEach(() => {
    vi.resetModules();
    requestMock.mockReset();
    showTabBarRedDotMock.mockReset().mockResolvedValue(undefined);
    hideTabBarRedDotMock.mockReset().mockResolvedValue(undefined);
    storage.clear();
    vi.stubGlobal('API_BASE_URL', 'http://127.0.0.1:3000');
    vi.stubGlobal('DEV_AUTH_BYPASS', false);
    vi.stubGlobal('API_DEBUG_LOGS', false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the tab red dot when logged out without hitting the network', async () => {
    const { refreshChatTabRedDot } = await import('./chat-red-dot');

    await refreshChatTabRedDot();

    expect(hideTabBarRedDotMock).toHaveBeenCalledWith({ index: 1 });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('shows the tab red dot when any character has unread return messages', async () => {
    await login();
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { messages: [], characterUnread: { 'char-1': 2 } },
    });
    const { refreshChatTabRedDot } = await import('./chat-red-dot');

    await refreshChatTabRedDot();

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3000/api/return-messages/check',
      method: 'POST',
    }));
    expect(showTabBarRedDotMock).toHaveBeenCalledWith({ index: 1 });
    expect(hideTabBarRedDotMock).not.toHaveBeenCalled();
  });

  it('hides the tab red dot once every return message is read', async () => {
    await login();
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { messages: [], characterUnread: {} },
    });
    const { refreshChatTabRedDot } = await import('./chat-red-dot');

    await refreshChatTabRedDot();

    expect(hideTabBarRedDotMock).toHaveBeenCalledWith({ index: 1 });
    expect(showTabBarRedDotMock).not.toHaveBeenCalled();
  });

  it('keeps the current dot state when the check request fails', async () => {
    await login();
    requestMock.mockRejectedValue({ errMsg: 'request:fail timeout' });
    const { refreshChatTabRedDot } = await import('./chat-red-dot');

    await expect(refreshChatTabRedDot()).resolves.toBeUndefined();

    expect(showTabBarRedDotMock).not.toHaveBeenCalled();
    expect(hideTabBarRedDotMock).not.toHaveBeenCalled();
  });

  it('swallows tab-API failures so polling never crashes', async () => {
    showTabBarRedDotMock.mockRejectedValueOnce(new Error('not on a tab page'));
    const { syncChatTabRedDot } = await import('./chat-red-dot');

    syncChatTabRedDot({ 'char-1': 1 });

    await vi.waitFor(() => {
      expect(showTabBarRedDotMock).toHaveBeenCalledWith({ index: 1 });
    });
  });

  it('polls immediately and on each interval until stopped', async () => {
    vi.useFakeTimers();
    await login();
    requestMock.mockResolvedValue({
      statusCode: 200,
      data: { messages: [], characterUnread: {} },
    });
    const { CHAT_UNREAD_POLL_INTERVAL_MS, startChatUnreadPolling } = await import('./chat-red-dot');

    const stop = startChatUnreadPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(requestMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_INTERVAL_MS);
    expect(requestMock).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(CHAT_UNREAD_POLL_INTERVAL_MS);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
