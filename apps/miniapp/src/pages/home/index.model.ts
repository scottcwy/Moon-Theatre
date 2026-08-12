import type { CharacterGender } from '../../types';

export interface ScriptCoverInput {
  slug: string;
  coverUrl?: string | null;
}

export const homeSections = {
  scriptKicker: '今日开演',
  scriptTitle: '热门剧本',
  scriptModeEntry: '剧本',
  characterKicker: '选择一位角色开始',
  frequentCharacterTitle: '常聊角色',
  recommendedCharacterTitle: '推荐角色',
} as const;

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
  南窗: '/assets/characters/nanchuang.jpg',
  赋霄: '/assets/characters/fuxiao.jpg',
  岑奕岚: '/assets/characters/cenyilan.jpg',
  季沧海: '/assets/characters/jicanghai.jpg',
  知何: '/assets/characters/zhihe.jpg',
  叶上秋: '/assets/characters/yeshangqiu.jpg',
};

/** 有男女双版本海报的角色：选角时按性别切换头像。默认版本与 LOCAL_CHARACTER_AVATARS 一致。 */
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

export function getScriptCoverUrl(script: ScriptCoverInput): string {
  const explicitUrl = script.coverUrl?.trim();
  if (explicitUrl) return explicitUrl;
  return LOCAL_SCRIPT_COVERS[script.slug] || '';
}

export function getCharacterAvatarUrl(name: string, avatarUrl?: string | null, gender?: CharacterGender | null): string {
  const explicitUrl = avatarUrl?.trim();
  const variantUrl = gender ? CHARACTER_GENDER_VARIANTS[name]?.[gender] : undefined;
  if (variantUrl) return variantUrl;
  if (explicitUrl) return explicitUrl;
  return LOCAL_CHARACTER_AVATARS[name] ?? '';
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
