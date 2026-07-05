const DEFAULT_STATUS_BAR_HEIGHT = 44;
const DEFAULT_TOPBAR_CONTENT_HEIGHT = 48;
const CAPSULE_CLEARANCE = 12;

export interface WindowMetrics {
  windowWidth?: number;
  statusBarHeight?: number;
}

export interface CapsuleMetrics {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

export interface TopBarMetrics {
  statusBarHeight: number;
  contentHeight: number;
  totalHeight: number;
  menuReserveWidth: number;
}

export function calculateTopBarMetrics(
  windowMetrics: WindowMetrics = {},
  capsuleMetrics: CapsuleMetrics | null = null,
): TopBarMetrics {
  const statusBarHeight = windowMetrics.statusBarHeight ?? DEFAULT_STATUS_BAR_HEIGHT;
  const capsuleTop = capsuleMetrics?.top;
  const capsuleLeft = capsuleMetrics?.left;
  const capsuleHeight = capsuleMetrics?.height;
  const hasCapsule = typeof capsuleTop === 'number' && typeof capsuleLeft === 'number' && typeof capsuleHeight === 'number' && capsuleHeight > 0;

  if (!hasCapsule) {
    return {
      statusBarHeight,
      contentHeight: DEFAULT_TOPBAR_CONTENT_HEIGHT,
      totalHeight: statusBarHeight + DEFAULT_TOPBAR_CONTENT_HEIGHT,
      menuReserveWidth: 0,
    };
  }

  const capsuleGap = Math.max(capsuleTop - statusBarHeight, 0);
  const contentHeight = capsuleHeight + capsuleGap * 2;
  const menuReserveWidth = Math.max((windowMetrics.windowWidth ?? 0) - capsuleLeft + CAPSULE_CLEARANCE, 0);

  return {
    statusBarHeight,
    contentHeight,
    totalHeight: statusBarHeight + contentHeight,
    menuReserveWidth,
  };
}

export function getTopBarStyle(metrics: TopBarMetrics): Record<string, string> {
  return {
    '--topbar-status-height': `${metrics.statusBarHeight}px`,
    '--topbar-content-height': `${metrics.contentHeight}px`,
    '--topbar-total-height': `${metrics.totalHeight}px`,
    '--topbar-menu-reserve': `${metrics.menuReserveWidth}px`,
  };
}
