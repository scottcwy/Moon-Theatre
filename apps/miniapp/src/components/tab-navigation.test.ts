import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAB_BAR_ITEMS } from './tab-bar.model';

const miniappRoot = path.resolve(__dirname, '../..');
const pagesRoot = path.join(miniappRoot, 'src/pages');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(miniappRoot, relativePath), 'utf8');
}

describe('miniapp tab navigation contract', () => {
  it('keeps one ordered source for all four tab routes', () => {
    expect(TAB_BAR_ITEMS.map((tab) => tab.path)).toEqual([
      '/pages/home/index',
      '/pages/chat/list',
      '/pages/community/index',
      '/pages/profile/index',
    ]);
  });

  it('uses the WeChat application shell and the same H5 component for the visible footer', () => {
    const customTabBar = read('src/custom-tab-bar/index.tsx');
    const h5Host = read('src/components/TabBarHost.h5.tsx');
    const weappHost = read('src/components/TabBarHost.tsx');

    expect(customTabBar).toContain('<StageTabBar />');
    expect(customTabBar).toContain('syncTabBarFromRoute');
    expect(h5Host).toContain('<StageTabBar />');
    expect(h5Host).toContain('pushState');
    expect(h5Host).toContain('replaceState');
    expect(weappHost).not.toContain('<StageTabBar');
  });

  it('keeps tab pages free of every footer mount', () => {
    for (const page of [
      'home/index.tsx',
      'chat/list.tsx',
      'community/index.tsx',
      'profile/index.tsx',
    ]) {
      const source = fs.readFileSync(path.join(pagesRoot, page), 'utf8');
      expect(source).not.toContain('<StageTabBar');
      expect(source).not.toContain('<TabBarHost');
    }
  });

  it('clears page-owned account data when the auth session changes', () => {
    const home = read('src/pages/home/index.tsx');
    const chat = read('src/pages/chat/list.tsx');
    const profile = read('src/pages/profile/index.tsx');

    expect(home).toContain('onSessionReset: resetSessionData');
    expect(home).toContain('setCharacters([])');
    expect(chat).toContain('onSessionReset: resetSessionData');
    expect(chat).toContain('chatListCacheRef.current.clear()');
    expect(profile).toContain('onSessionReset: clearProfileData');
    expect(profile).toContain('loadIdRef.current += 1');
  });

  it('derives tab selection from the current route on page show', () => {
    const lifecycle = read('src/hooks/useTabPageLifecycle.ts');
    const state = read('src/components/tab-bar-state.ts');

    expect(lifecycle).toContain('syncTabBarFromRoute()');
    expect(state).not.toContain('useTabBarSelection(path');
  });

  it('provides an H5 click path without changing the WeChat tap path', () => {
    const stage = read('src/components/StageTabBar.tsx');
    expect(stage).toContain('onTap={switchToTab}');
    expect(stage).toContain("onClick={process.env.TARO_ENV === 'h5' ? switchToTab : undefined}");
  });

  it('does not clip the selected footer decoration in the custom-tab-bar host', () => {
    const hostStyle = read('src/custom-tab-bar/index.scss');
    const stageStyle = read('src/components/StageTabBar.scss');

    expect(hostStyle).not.toContain('overflow: hidden');
    expect(stageStyle).toContain('height: 106rpx');
    expect(stageStyle).toContain('height: 123rpx');
    expect(stageStyle).toContain('env(safe-area-inset-bottom');
  });
});
