import { beforeEach, describe, expect, it, vi } from 'vitest';

type AppConfig = typeof import('./app.config').default;

describe('V1 tab bar configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('defineAppConfig', (config: AppConfig) => config);
  });

  it('exposes community as the third tab', async () => {
    const { default: appConfig } = await import('./app.config');
    const tabPaths = appConfig.tabBar?.list.map((item) => item.pagePath);
    const tabTexts = appConfig.tabBar?.list.map((item) => item.text);

    expect(tabPaths).toEqual([
      'pages/home/index',
      'pages/chat/list',
      'pages/community/index',
      'pages/profile/index',
    ]);
    expect(tabTexts).toEqual(['首页', '聊天', '社区', '我的']);
  });

  it('gives the community tab its own icon instead of reusing the memory glyph', async () => {
    const { default: appConfig } = await import('./app.config');
    const communityTab = appConfig.tabBar?.list.find((item) => item.pagePath === 'pages/community/index');

    expect(communityTab?.iconPath).toBe('assets/icons/community.png');
    expect(communityTab?.selectedIconPath).toBe('assets/icons/community-active.png');
  });

  it('registers the API-driven generic script role selection page', async () => {
    const { default: appConfig } = await import('./app.config');

    expect(appConfig.pages).toContain('pages/script/select');
  });

  it('keeps rubber-band overscroll on the app background instead of black or white edges', async () => {
    const { default: appConfig } = await import('./app.config');

    expect(appConfig.window?.backgroundColor).toBe('#FFFBF8');
    expect(appConfig.window?.backgroundTextStyle).toBe('dark');
    expect(appConfig.tabBar?.borderStyle).toBe('white');
  });
});
