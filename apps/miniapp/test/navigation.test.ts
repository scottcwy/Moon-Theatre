import Taro from '@tarojs/taro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateBackMock, switchTabMock } = vi.hoisted(() => ({
  navigateBackMock: vi.fn(),
  switchTabMock: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    navigateBack: navigateBackMock,
    switchTab: switchTabMock,
  },
}));

describe('navigation helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    navigateBackMock.mockReset();
    switchTabMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('navigates back when there is a previous page', async () => {
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }, { route: 'pages/character/detail' }]);
    const { navigateBackOrHome } = await import('../src/utils/navigation');

    navigateBackOrHome();

    expect(Taro.navigateBack).toHaveBeenCalledWith({ delta: 1 });
    expect(Taro.switchTab).not.toHaveBeenCalled();
  });

  it('falls back to the home tab when no previous page exists', async () => {
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/character/detail' }]);
    const { navigateBackOrHome } = await import('../src/utils/navigation');

    navigateBackOrHome();

    expect(Taro.navigateBack).not.toHaveBeenCalled();
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/home/index' });
  });
});
