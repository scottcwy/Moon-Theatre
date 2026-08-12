import { buildCharacterChatUrl } from '../character/detail.model';

/** 聊天搜索防抖：输入停止后延迟多少毫秒发起请求。 */
export const CHAT_SEARCH_DEBOUNCE_MS = 250;

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

/**
 * 聊天列表点击角色 → 一律进入自由聊天（mode=free）。
 * 留言（红点正文）写入该角色 active 自由会话，自由入口保证红点正文在历史流可见；
 * 不再用 latestSessionId 直达「最近会话」（可能落在剧本模式导致红点正文不可见）。
 */
export function getCharacterChatUrl(characterId: string): string {
  return buildCharacterChatUrl(characterId, 'free');
}

// 回访留言契约已上移至 services/return-messages（tab 红点轮询也要用），此处 re-export 保持旧引用不断。
export {
  RETURN_MESSAGES_CHECK_PATH,
  RETURN_MESSAGES_READ_PATH,
  buildReturnMessagesReadBody,
} from '../../services/return-messages';
export type { ReturnMessage, ReturnMessagesCheckResponse } from '../../services/return-messages';
