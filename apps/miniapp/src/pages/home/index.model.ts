export interface ScriptCoverInput {
  slug: string;
  coverUrl?: string | null;
}

export const homeSections = {
  scriptKicker: '今日开演',
  scriptTitle: '热门剧本',
  scriptPrimaryAction: '选择角色',
  scriptModeEntry: '剧本模式',
  characterKicker: '选择一位角色开始',
  characterTitle: '最近角色',
} as const;

const LOCAL_SCRIPT_COVERS: Record<string, string> = {
  'moon-garden': '/assets/home/moon-garden-cover.jpg',
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
