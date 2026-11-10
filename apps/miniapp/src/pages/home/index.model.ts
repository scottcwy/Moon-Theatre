import type { CharacterGender } from '../../types';

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

export const localHomeScripts = [
  {
    id: 'local-moon-garden',
    title: '月见庭院：狐神的新娘',
    description: '你因家族旧债被送入一座只在满月出现的庭院。',
    slug: 'moon-garden',
    genre: '古风悬疑',
    coverUrl: '/assets/home/moon-garden-cover.jpg',
    sortOrder: 1,
    supportsScriptMode: true,
  },
  {
    id: 'local-moon-tower',
    title: '月下高塔',
    description: '在月色与秘密交错的剧本中选择你的角色。',
    slug: 'moon-tower',
    genre: '情感推理',
    coverUrl: '/assets/home/moon-tower-cover.jpg',
    sortOrder: 2,
    supportsScriptMode: true,
  },
] as const;

export const localHomeCharacters = [
  { id: 'local-bai-cang', name: '白藏', identity: '月见庭院的狐神', avatarUrl: null },
  { id: 'local-kiyoharu', name: '贺茂清玄', identity: '京都阴阳师', avatarUrl: null },
  { id: 'local-mio', name: '月岛澪', identity: '沉默的旅人', avatarUrl: null },
  { id: 'local-kuon', name: '久远', identity: '守夜人', avatarUrl: null },
] as const;

/** 剧本搜索防抖：输入停止后延迟多少毫秒发起请求。 */
export const SCRIPT_SEARCH_DEBOUNCE_MS = 250;

/** 剧本模式开关：点击后展示开启态动画，延迟多少毫秒后进入剧本目录。 */
export const SCRIPT_MODE_ENTRY_DELAY_MS = 260;

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
  'moon-tower': '/assets/home/moon-tower-cover.jpg',
  'yunyun': '/assets/home/yunyun-cover.jpg',
};

/**
 * 角色头像不在小程序包内：由 API 静态目录托管（`apps/api/public/assets/characters`）。
 * 相对路径拼上构建期注入的 API 基地址；已是绝对地址（CDN / 已托管图）则原样返回。
 */
function withAssetBase(url: string | null | undefined): string {
  const value = url?.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const base = typeof API_BASE_URL === 'string' ? API_BASE_URL : '';
  return `${base}${value}`;
}

/** 有男女双版本海报的角色：选角时按性别切换头像。 */
const CHARACTER_GENDER_VARIANTS: Record<string, Partial<Record<CharacterGender, string>>> = {
  程聿怀: {
    male: '/assets/characters/chengyuhuai.jpg',
    female: '/assets/characters/chengyuhuai-female.jpg',
  },
  羌青瓷: {
    male: '/assets/characters/qiangqingci-male.jpg',
    female: '/assets/characters/qiangqingci.jpg',
  },
};

/** 角色卡片决策建议徽标的通用文案；差异化建议后续由后端字段数据驱动。 */
export const CHARACTER_DECISION_BADGE = '可选角色';

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

export function shouldFallbackToPublicCharacters(silent: boolean, characterCount: number): boolean {
  return !silent || characterCount === 0;
}

export function getScriptCoverUrl(script: ScriptCoverInput): string {
  const explicitUrl = script.coverUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_SCRIPT_COVERS[script.slug] || '';
}

export function getCharacterAvatarUrl(name: string, avatarUrl?: string | null, gender?: CharacterGender | null): string {
  const variantUrl = gender ? CHARACTER_GENDER_VARIANTS[name]?.[gender] : undefined;
  return withAssetBase(variantUrl ?? avatarUrl);
}

/** 返回角色可选的性别变体；无男女双版本的角色返回空数组。 */
export function getCharacterGenderVariants(name: string): CharacterGender[] {
  const variants = CHARACTER_GENDER_VARIANTS[name];
  return variants ? (Object.keys(variants) as CharacterGender[]) : [];
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
