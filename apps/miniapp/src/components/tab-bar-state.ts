import Taro, { useDidShow } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getTabPath, TAB_BAR_ITEMS } from './tab-bar.model';
import type { TabPath } from './tab-bar.model';

let currentTabPath: TabPath = getCurrentRouteTabPath() ?? TAB_BAR_ITEMS[0].path;
const listeners = new Set<(path: TabPath) => void>();

function getCurrentRouteTabPath(): TabPath | null {
  return getTabPath(Taro.getCurrentInstance()?.router?.path);
}

export function syncTabBarSelection(route: string): void {
  const path = getTabPath(route);
  if (!path || path === currentTabPath) return;
  currentTabPath = path;
  for (const listener of listeners) listener(path);
}

export function syncTabBarFromRoute(): void {
  const path = getCurrentRouteTabPath();
  if (path) syncTabBarSelection(path);
}

export function useCurrentTabPath(): TabPath {
  const [path, setPath] = useState(currentTabPath);
  useEffect(() => {
    setPath(currentTabPath);
    listeners.add(setPath);
    return () => {
      listeners.delete(setPath);
    };
  }, []);
  return path;
}

export function useTabBarSelection(): void {
  useEffect(() => {
    syncTabBarFromRoute();
  }, []);

  useDidShow(() => {
    syncTabBarFromRoute();
  });
}
