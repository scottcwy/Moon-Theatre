import type { ModelTier } from '../../types';

export interface SessionDisplayItem {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  modelTier: ModelTier;
  lastMessage: string | null;
  updatedAt: string;
  level?: number | string | null;
  unreadCount?: number;
}

const TIER_LEVELS: Record<ModelTier, string> = {
  casual: '羁绊 1',
  standard: '羁绊 3',
  immersive: '羁绊 5',
};

const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function getSessionTimeLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const dayDiff = Math.floor((startOfDay(now) - startOfDay(date)) / 86400000);
  if (dayDiff <= 0) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (dayDiff === 1) return '昨天';
  if (dayDiff < 7) return WEEKDAY_LABELS[date.getDay()] ?? '';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function getSessionLevelLabel(levelOrTier: number | string | ModelTier | null | undefined): string {
  if (typeof levelOrTier === 'number' && Number.isFinite(levelOrTier)) {
    return `羁绊 ${Math.max(1, Math.trunc(levelOrTier))}`;
  }

  if (levelOrTier && typeof levelOrTier === 'string') {
    if (levelOrTier in TIER_LEVELS) {
      return TIER_LEVELS[levelOrTier as ModelTier];
    }
    if (/^lv\.?\s*\d+$/i.test(levelOrTier)) {
      const level = levelOrTier.replace(/^lv\.?\s*/i, '');
      return `羁绊 ${level}`;
    }
  }

  return TIER_LEVELS.standard;
}

export function getChatPreviewText(message: string | null | undefined): string {
  const text = message?.trim();
  return text || '还没有新的剧场消息';
}

export function filterChatSessions<T extends SessionDisplayItem>(sessions: T[], query: string): T[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return sessions;

  return sessions.filter((session) => {
    const searchable = [
      session.characterName,
      session.characterId,
      getChatPreviewText(session.lastMessage),
    ].join(' ').toLowerCase();
    return searchable.includes(keyword);
  });
}
