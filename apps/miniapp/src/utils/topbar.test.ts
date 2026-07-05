import { describe, expect, it } from 'vitest';
import { calculateTopBarMetrics, getTopBarStyle } from './topbar';

describe('topbar metrics', () => {
  it('calculates top bar space from status bar and WeChat capsule geometry', () => {
    expect(
      calculateTopBarMetrics(
        { windowWidth: 390, statusBarHeight: 47 },
        { top: 59, left: 287, width: 87, height: 32 },
      ),
    ).toEqual({
      statusBarHeight: 47,
      contentHeight: 56,
      totalHeight: 103,
      menuReserveWidth: 115,
    });
  });

  it('falls back to stable default metrics when capsule data is unavailable', () => {
    expect(calculateTopBarMetrics()).toEqual({
      statusBarHeight: 44,
      contentHeight: 48,
      totalHeight: 92,
      menuReserveWidth: 0,
    });
  });

  it('builds CSS variables for positioning content below the custom top bar', () => {
    expect(getTopBarStyle({ statusBarHeight: 47, contentHeight: 56, totalHeight: 103, menuReserveWidth: 115 })).toEqual({
      '--topbar-status-height': '47px',
      '--topbar-content-height': '56px',
      '--topbar-total-height': '103px',
      '--topbar-menu-reserve': '115px',
    });
  });
});
