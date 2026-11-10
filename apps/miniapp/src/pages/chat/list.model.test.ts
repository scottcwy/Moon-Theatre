import { describe, expect, it, vi } from 'vitest';
import {
  RETURN_MESSAGES_CHECK_PATH,
  RETURN_MESSAGES_READ_PATH,
  buildCharacterChatsUrl,
  buildReturnMessagesReadBody,
  getChatPreviewText,
  getCharacterChatUrl,
  getSessionTimeLabel,
} from './list.model';

/** 时间标签按设备本地时区渲染，用本地日历构造输入，任何 TZ 下结果一致。 */
function localIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe('chat list display helpers', () => {
  it('formats recent, yesterday, weekday, and fallback timestamps like the chat mock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 14, 22, 23));

    expect(getSessionTimeLabel(localIso(2026, 6, 14, 0, 42))).toBe('0:42');
    expect(getSessionTimeLabel(localIso(2026, 6, 13, 17, 10))).toBe('昨天');
    expect(getSessionTimeLabel(localIso(2026, 6, 9, 12, 0))).toBe('星期二');
    expect(getSessionTimeLabel(localIso(2026, 5, 29, 12, 0))).toBe('5月29日');

    vi.useRealTimers();
  });

  it('uses a quiet empty preview', () => {
    expect(getChatPreviewText('  ')).toBe('还没有新的剧场消息');
    expect(getChatPreviewText('今晚的月色很好，要一起出去走走吗？')).toBe('今晚的月色很好，要一起出去走走吗？');
  });

  it('builds the server-side character search URL', () => {
    expect(buildCharacterChatsUrl('')).toBe('/api/chat/characters?page=1&limit=20');
    expect(buildCharacterChatsUrl(' 白藏 ')).toBe('/api/chat/characters?page=1&limit=20&q=%E7%99%BD%E8%97%8F');
    expect(buildCharacterChatsUrl('月 光', 2, 10)).toBe('/api/chat/characters?page=2&limit=10&q=%E6%9C%88%20%E5%85%89');
  });

  it('opens the free-mode chat entry from a character id', () => {
    expect(getCharacterChatUrl('character-id')).toBe('/pages/chat/index?characterId=character-id&mode=free');
    expect(getCharacterChatUrl('character/id with space')).toBe('/pages/chat/index?characterId=character%2Fid%20with%20space&mode=free');
  });
});

describe('return message helpers', () => {
  it('exposes the check and read endpoint paths', () => {
    expect(RETURN_MESSAGES_CHECK_PATH).toBe('/api/return-messages/check');
    expect(RETURN_MESSAGES_READ_PATH).toBe('/api/return-messages/read');
  });

  it('builds the read body for a character', () => {
    expect(buildReturnMessagesReadBody('char-1')).toEqual({ characterId: 'char-1' });
  });

});
