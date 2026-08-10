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

export function getChatPreviewText(message: string | null | undefined): string {
  const text = message?.trim();
  return text || '还没有新的剧场消息';
}

export function buildCharacterChatsUrl(query: string, page = 1, limit = 20): string {
  const params = [`page=${page}`, `limit=${limit}`];
  const keyword = query.trim();
  if (keyword) params.push(`q=${encodeURIComponent(keyword)}`);
  return `/api/chat/characters?${params.join('&')}`;
}

export function getCharacterChatUrl(latestSessionId: string): string {
  return `/pages/chat/index?sessionId=${encodeURIComponent(latestSessionId)}`;
}

export interface ReturnMessage {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl?: string | null;
  content: string;
  reason: string;
  createdAt: string;
  readAt?: string | null;
}

export interface ReturnMessagesCheckResponse {
  messages: ReturnMessage[];
  characterUnread: Record<string, number>;
}

export const RETURN_MESSAGES_CHECK_PATH = '/api/return-messages/check';
export const RETURN_MESSAGES_READ_PATH = '/api/return-messages/read';

export function buildReturnMessagesReadBody(characterId: string): { characterId: string } {
  return { characterId };
}
