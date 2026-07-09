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

const SCRIPT_ROLE_SELECT_URLS: Record<string, string> = {
  'moon-garden': '/pages/role-select/moon-garden',
};

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

export function getCharacterDetailUrl(characterId: string): string {
  const id = characterId.trim();
  if (!id) {
    throw new Error('characterId is required');
  }
  return `/pages/character/detail?characterId=${encodeURIComponent(id)}`;
}

export function getScriptRoleSelectUrl(scriptId: string): string {
  const url = SCRIPT_ROLE_SELECT_URLS[scriptId.trim()];
  if (!url) {
    throw new Error('unsupported script id');
  }
  return url;
}

export function getCharacterAvatarUrl(name: string, avatarUrl?: string | null): string {
  const explicitUrl = avatarUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_CHARACTER_AVATARS[name] ?? '';
}

export function getCharacterDecisionBadge(name: string): string {
  return CHARACTER_DECISION_BADGES[name] ?? '可选角色';
}
