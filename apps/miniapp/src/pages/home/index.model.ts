export interface ScriptCoverInput {
  slug: string;
  coverUrl?: string | null;
}

export const homeSections = {
  scriptKicker: '今日开演',
  scriptTitle: '热门剧本',
  scriptModeEntry: '剧本模式',
  characterKicker: '选择一位角色开始',
  frequentCharacterTitle: '常聊角色',
  recommendedCharacterTitle: '推荐角色',
} as const;

/** 常聊角色区域固定取前 4 个（2 列网格 × 2 行）。 */
export const FREQUENT_CHARACTERS_LIMIT = 4;

/** 区域标题：有常聊历史时叫「常聊角色」，否则叫「推荐角色」，不误导。 */
export function getCharacterSectionTitle(hasFrequentCharacters: boolean): string {
  return hasFrequentCharacters
    ? homeSections.frequentCharacterTitle
    : homeSections.recommendedCharacterTitle;
}

/** 常聊角色聚合接口：按成功对话轮数倒序取前 N 个。 */
export function buildFrequentCharactersUrl(limit = FREQUENT_CHARACTERS_LIMIT): string {
  return `/api/chat/characters?sort=turn_count&limit=${limit}`;
}

const LOCAL_SCRIPT_COVERS: Record<string, string> = {
  'moon-garden': '/assets/home/moon-garden-cover.jpg',
};

const LOCAL_CHARACTER_AVATARS: Record<string, string> = {
  白藏: '/assets/characters/hakuzo.jpg',
  贺茂清玄: '/assets/characters/kiyoharu.jpg',
  月岛澪: '/assets/characters/mio.jpg',
  久远: '/assets/characters/kuon.jpg',
  程聿怀: '/assets/characters/chengyuhuai.jpg',
  蒋伯驾: '/assets/characters/jiangbojia.jpg',
  程走柳: '/assets/characters/chengzouliu.jpg',
  缪宏谟: '/assets/characters/miaohongmo.jpg',
  黛利拉: '/assets/characters/delilah.jpg',
  以撒: '/assets/characters/isaac.jpg',
  羌青瓷: '/assets/characters/qiangqingci.jpg',
  奥丁: '/assets/characters/odin.jpg',
  阿奇: '/assets/characters/archie.jpg',
};

const CHARACTER_DECISION_BADGES: Record<string, string> = {
  白藏: '新手友好',
  贺茂清玄: '隐藏线多',
  月岛澪: '高戏剧张力',
  久远: '守护线',
};

export function getCharacterDetailUrl(characterId: string): string {
  const id = characterId.trim();
  if (!id) throw new Error('characterId is required');
  return `/pages/character/detail?characterId=${encodeURIComponent(id)}`;
}

export function getScriptRoleSelectUrl(scriptId: string): string {
  const id = scriptId.trim();
  if (!id) throw new Error('scriptId is required');
  return `/pages/script/select?scriptId=${encodeURIComponent(id)}`;
}

export function getScriptCatalogUrl(): string {
  return '/pages/script/catalog';
}

export function buildScriptsUrl(query: string): string {
  const keyword = query.trim();
  return keyword ? `/api/scripts?q=${encodeURIComponent(keyword)}` : '/api/scripts';
}

export function shouldApplyScriptResponse(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function getScriptCoverUrl(script: ScriptCoverInput): string {
  const explicitUrl = script.coverUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_SCRIPT_COVERS[script.slug] || '';
}

export function getCharacterAvatarUrl(name: string, avatarUrl?: string | null): string {
  const explicitUrl = avatarUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_CHARACTER_AVATARS[name] ?? '';
}

export function getCharacterDecisionBadge(name: string): string {
  return CHARACTER_DECISION_BADGES[name] ?? '可选角色';
}

/**
 * Maps the horizontal scroll position to the nearest script card index.
 * Uses the full scroll width divided by card count so the math stays
 * independent of exact card width and gap values.
 */
export function getActiveScriptIndex(scrollLeft: number, scrollWidth: number, scriptCount: number): number {
  if (scriptCount <= 1) return 0;
  const step = Math.max(1, scrollWidth / scriptCount);
  const index = Math.round(scrollLeft / step);
  return Math.min(scriptCount - 1, Math.max(0, index));
}
