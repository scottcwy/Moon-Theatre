import { useEffect, useState } from 'react';
import { StageTabBar } from './StageTabBar';
import { getTabPath } from './tab-bar.model';
import { syncTabBarSelection } from './tab-bar-state';

interface BrowserRuntime {
  location?: { hash?: string };
  history?: {
    pushState: (data: unknown, unused: string, url?: string | null) => void;
    replaceState: (data: unknown, unused: string, url?: string | null) => void;
  };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

const browserRuntime = globalThis as unknown as BrowserRuntime;

function getHashRoute(): string {
  return browserRuntime.location?.hash?.replace(/^#\/?/, '') ?? '';
}

export function TabBarHost() {
  const [visible, setVisible] = useState(() => Boolean(getTabPath(getHashRoute())));

  useEffect(() => {
    const sync = () => {
      const route = getHashRoute();
      const tabPath = getTabPath(route);
      setVisible(Boolean(tabPath));
      if (tabPath) syncTabBarSelection(tabPath);
    };
    sync();

    const browserHistory = browserRuntime.history;
    const originalPushState = browserHistory?.pushState;
    const originalReplaceState = browserHistory?.replaceState;
    if (browserHistory && originalPushState && originalReplaceState) {
      browserHistory.pushState = function (...args: [unknown, string, (string | null)?]) {
        originalPushState.apply(browserHistory, args);
        sync();
      };
      browserHistory.replaceState = function (...args: [unknown, string, (string | null)?]) {
        originalReplaceState.apply(browserHistory, args);
        sync();
      };
    }

    browserRuntime.addEventListener?.('hashchange', sync);
    browserRuntime.addEventListener?.('popstate', sync);
    return () => {
      browserRuntime.removeEventListener?.('hashchange', sync);
      browserRuntime.removeEventListener?.('popstate', sync);
      if (browserHistory && originalPushState && originalReplaceState) {
        browserHistory.pushState = originalPushState;
        browserHistory.replaceState = originalReplaceState;
      }
    };
  }, []);

  return visible ? <StageTabBar /> : null;
}
