export type AchievementIconTone = 'moon' | 'red' | 'gold';

export interface AchievementIconMeta {
  asset: string | null;
  fallback: string;
  tone: AchievementIconTone;
  label: string;
}

export const LORDICON_ATTRIBUTION = 'Animated icons by Lordicon.com';

const ACHIEVEMENT_ICON_META: Record<string, AchievementIconMeta> = {
  first_chat: {
    asset: null,
    fallback: '幕',
    tone: 'moon',
    label: '初次入戏',
  },
  bond_level_2: {
    asset: null,
    fallback: '绊',
    tone: 'red',
    label: '关系升温',
  },
  message_count_10: {
    asset: null,
    fallback: '信',
    tone: 'gold',
    label: '雾中来信',
  },
};

const DEFAULT_META: AchievementIconMeta = {
  asset: null,
  fallback: '成',
  tone: 'gold',
  label: '成就',
};

export function getAchievementIconMeta(code?: string | null): AchievementIconMeta {
  if (!code) return DEFAULT_META;
  return ACHIEVEMENT_ICON_META[code] ?? DEFAULT_META;
}
