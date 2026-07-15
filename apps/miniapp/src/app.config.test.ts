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

  it('keeps the placeholder community tab on the original icon until the tab is built', async () => {
    const { default: appConfig } = await import('./app.config');
    const communityTab = appConfig.tabBar?.list.find((item) => item.pagePath === 'pages/community/index');

    expect(communityTab?.iconPath).toBe('assets/icons/memory.png');
    expect(communityTab?.selectedIconPath).toBe('assets/icons/memory-active.png');
  });

  it('registers Moon Garden role selection as a first-class page', async () => {
    const { default: appConfig } = await import('./app.config');

    expect(appConfig.pages).toContain('pages/role-select/moon-garden');
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
