import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
  didShow: null as null | (() => void),
  didHide: null as null | (() => void),
  pageScroll: null as null | ((payload: { scrollTop: number }) => void),
  sessionChanged: null as null | (() => void),
  syncTabBarFromRoute: vi.fn(),
  pageScrollTo: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    nextTick: (callback: () => void) => callback(),
    pageScrollTo: lifecycleMocks.pageScrollTo,
  },
  useDidShow: (listener: () => void) => {
    lifecycleMocks.didShow = listener;
  },
  useDidHide: (listener: () => void) => {
    lifecycleMocks.didHide = listener;
  },
  usePageScroll: (listener: (payload: { scrollTop: number }) => void) => {
    lifecycleMocks.pageScroll = listener;
  },
}));

vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
}));

vi.mock('../components/tab-bar-state', () => ({
  syncTabBarFromRoute: lifecycleMocks.syncTabBarFromRoute,
}));

vi.mock('../services/auth-session', () => ({
  subscribeAuthSessionChanged: (listener: () => void) => {
    lifecycleMocks.sessionChanged = listener;
    return () => {};
  },
}));

async function flushLifecycleLoad(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useTabPageLifecycle', () => {
  beforeEach(() => {
    lifecycleMocks.didShow = null;
    lifecycleMocks.didHide = null;
    lifecycleMocks.pageScroll = null;
    lifecycleMocks.sessionChanged = null;
    vi.clearAllMocks();
  });

  it('uses initial once, refresh after success, and resets on auth session change', async () => {
    const { useTabPageLifecycle } = await import('./useTabPageLifecycle');
    const load = vi.fn().mockResolvedValue(true);
    const onSessionReset = vi.fn();

    useTabPageLifecycle(load, { onSessionReset });
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();

    expect(load.mock.calls.map(([mode]) => mode)).toEqual(['initial', 'refresh']);
    expect(lifecycleMocks.syncTabBarFromRoute).toHaveBeenCalledTimes(2);

    lifecycleMocks.sessionChanged?.();
    expect(onSessionReset).toHaveBeenCalledTimes(1);
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();

    expect(load.mock.calls.at(-1)?.[0]).toBe('initial');
  });

  it('keeps the next show initial when the previous load did not commit', async () => {
    const { useTabPageLifecycle } = await import('./useTabPageLifecycle');
    const load = vi.fn().mockResolvedValue(false);

    useTabPageLifecycle(load);
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();

    expect(load.mock.calls.map(([mode]) => mode)).toEqual(['initial', 'initial']);
  });

  it('restores the page scroll position after hiding and showing', async () => {
    const { useTabPageLifecycle } = await import('./useTabPageLifecycle');
    useTabPageLifecycle(vi.fn().mockResolvedValue(true));

    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();
    lifecycleMocks.pageScroll?.({ scrollTop: 360 });
    lifecycleMocks.didHide?.();
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();

    expect(lifecycleMocks.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 360, duration: 0 });
    lifecycleMocks.sessionChanged?.();
    lifecycleMocks.didShow?.();
    await flushLifecycleLoad();
    expect(lifecycleMocks.pageScrollTo).toHaveBeenNthCalledWith(2, { scrollTop: 0, duration: 0 });
    expect(lifecycleMocks.pageScrollTo).toHaveBeenCalledTimes(2);
  });
});
