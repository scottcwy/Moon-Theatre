import Taro, { useDidHide, useDidShow, usePageScroll } from '@tarojs/taro';
import { useCallback, useEffect, useRef } from 'react';
import { syncTabBarFromRoute } from '../components/tab-bar-state';
import { subscribeAuthSessionChanged } from '../services/auth-session';
import { restorePageScrollTop, subscribePageScroll } from '../utils/page-scroll';

export type TabPageLoadMode = 'initial' | 'refresh';

interface TabPageLifecycleOptions {
  onSessionReset?: () => void;
}

/**
 * Tab 页唯一显示入口：首次显示走 initial，成功加载后再次显示走 refresh。
 * reset 用于退出登录或身份切换，避免新用户复用到上一会话的已加载状态。
 */
export function useTabPageLifecycle(
  load: (mode: TabPageLoadMode) => Promise<boolean>,
  { onSessionReset }: TabPageLifecycleOptions = {},
) {
  const hasLoadedRef = useRef(false);
  const savedScrollTopRef = useRef(0);
  const visibleRef = useRef(false);
  const restoringScrollRef = useRef(false);
  const loadRef = useRef(load);
  const onSessionResetRef = useRef(onSessionReset);
  loadRef.current = load;
  onSessionResetRef.current = onSessionReset;

  usePageScroll(({ scrollTop }) => {
    if (!visibleRef.current || restoringScrollRef.current) return;
    savedScrollTopRef.current = scrollTop;
  });

  useEffect(() => subscribePageScroll((scrollTop) => {
    if (!visibleRef.current || restoringScrollRef.current) return;
    savedScrollTopRef.current = scrollTop;
  }), []);

  useDidShow(() => {
    visibleRef.current = true;
    syncTabBarFromRoute();
    const mode: TabPageLoadMode = hasLoadedRef.current ? 'refresh' : 'initial';
    void loadRef.current(mode).then((loaded) => {
      if (loaded) hasLoadedRef.current = true;
    }).catch(() => {});
    const savedScrollTop = savedScrollTopRef.current;
    if (savedScrollTop > 0) {
      restoringScrollRef.current = true;
      Taro.nextTick(() => {
        restorePageScrollTop(savedScrollTop);
        Taro.nextTick(() => {
          restoringScrollRef.current = false;
        });
      });
    }
  });

  useDidHide(() => {
    visibleRef.current = false;
    restoringScrollRef.current = false;
  });

  useEffect(() => subscribeAuthSessionChanged(() => {
    hasLoadedRef.current = false;
    savedScrollTopRef.current = 0;
    restorePageScrollTop(0);
    onSessionResetRef.current?.();
  }), []);

  const reset = useCallback(() => {
    hasLoadedRef.current = false;
  }, []);

  return { reset };
}
