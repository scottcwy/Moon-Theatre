import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('auth session events', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('notifies subscribers for each session change and unsubscribes cleanly', async () => {
    const {
      getAuthSessionVersion,
      notifyAuthSessionChanged,
      subscribeAuthSessionChanged,
    } = await import('./auth-session');
    const listener = vi.fn();
    const unsubscribe = subscribeAuthSessionChanged(listener);
    const initialVersion = getAuthSessionVersion();

    notifyAuthSessionChanged();
    notifyAuthSessionChanged();
    unsubscribe();
    notifyAuthSessionChanged();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getAuthSessionVersion()).toBe(initialVersion + 3);
  });
});
