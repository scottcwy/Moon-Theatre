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
});
