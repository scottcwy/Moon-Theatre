export interface FeaturedScript {
  id: string;
  title: string;
  genre: string;
  tag: string;
  description: string;
  cover: string;
}

export const featuredScripts: FeaturedScript[] = [
  {
    id: 'moon-garden',
    title: '月见庭院：狐神的新娘',
    genre: '和风幻想 / 前世今生',
    tag: '满月开启',
    description: '踏入只在满月出现的庭院，在狐嫁试炼中找回前世记忆与未完成的契约。',
    cover: '/assets/home/moon-garden-cover.jpg',
  },
  {
    id: 'liumang',
    title: '流氓叙事',
    genre: '赛博悬疑 / 街巷群像',
    tag: '沉浸式体验',
    description: '在迷离的霓虹街巷中，扮演边缘人物，于帮派纷争与暗影交易中寻找自我。',
    cover: '/assets/home/liumang-cover.jpg',
  },
];

export const homeSections = {
  scriptKicker: '今日开演',
  scriptTitle: '热门剧本',
  scriptPrimaryAction: '选择角色',
  characterKicker: '选择一位角色开始',
  characterTitle: '最近角色',
} as const;

const LOCAL_CHARACTER_AVATARS: Record<string, string> = {
  白藏: '/assets/characters/hakuzo.jpg',
  贺茂清玄: '/assets/characters/kiyoharu.jpg',
  月岛澪: '/assets/characters/mio.jpg',
  久远: '/assets/characters/kuon.jpg',
};

const CHARACTER_DECISION_BADGES: Record<string, string> = {
  白藏: '新手友好',
  贺茂清玄: '隐藏线多',
  月岛澪: '高戏剧张力',
  久远: '守护线',
};

const DEFAULT_STATUS_BAR_HEIGHT = 44;
const DEFAULT_TOPBAR_CONTENT_HEIGHT = 48;
const CAPSULE_CLEARANCE = 12;

export interface HomeWindowMetrics {
  windowWidth?: number;
  statusBarHeight?: number;
}

export interface HomeCapsuleMetrics {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

export interface HomeTopBarMetrics {
  statusBarHeight: number;
  contentHeight: number;
  totalHeight: number;
  menuReserveWidth: number;
}

export function getCharacterDetailUrl(characterId: string): string {
  const id = characterId.trim();
  if (!id) {
    throw new Error('characterId is required');
  }
  return `/pages/character/detail?characterId=${encodeURIComponent(id)}`;
}

export function getCharacterAvatarUrl(name: string, avatarUrl?: string | null): string {
  const explicitUrl = avatarUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_CHARACTER_AVATARS[name] ?? '';
}

export function getCharacterDecisionBadge(name: string): string {
  return CHARACTER_DECISION_BADGES[name] ?? '可选角色';
}

export function calculateTopBarMetrics(
  windowMetrics: HomeWindowMetrics = {},
  capsuleMetrics: HomeCapsuleMetrics | null = null,
): HomeTopBarMetrics {
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

export function getHomeTopBarStyle(metrics: HomeTopBarMetrics): Record<string, string> {
  return {
    '--topbar-status-height': `${metrics.statusBarHeight}px`,
    '--topbar-content-height': `${metrics.contentHeight}px`,
    '--topbar-total-height': `${metrics.totalHeight}px`,
    '--topbar-menu-reserve': `${metrics.menuReserveWidth}px`,
  };
}
