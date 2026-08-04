import { describe, expect, it, vi } from 'vitest';
import {
  RETURN_MESSAGES_CHECK_PATH,
  RETURN_MESSAGES_READ_PATH,
  buildCharacterChatsUrl,
  buildReturnMessagesReadBody,
  getChatPreviewText,
  getCharacterChatUrl,
  getReturnMessageTimeLabel,
  getSessionTimeLabel,
} from './list.model';

describe('chat list display helpers', () => {
  it('formats recent, yesterday, weekday, and fallback timestamps like the chat mock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T22:23:00+08:00'));

    expect(getSessionTimeLabel('2026-06-14T00:42:00+08:00')).toBe('0:42');
    expect(getSessionTimeLabel('2026-06-13T17:10:00+08:00')).toBe('昨天');
    expect(getSessionTimeLabel('2026-06-09T12:00:00+08:00')).toBe('星期二');
    expect(getSessionTimeLabel('2026-05-29T12:00:00+08:00')).toBe('5月29日');

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

  it('opens the latest persisted mode session from a character entry', () => {
    expect(getCharacterChatUrl('session-free')).toBe('/pages/chat/index?sessionId=session-free');
    expect(getCharacterChatUrl('session/with space')).toBe('/pages/chat/index?sessionId=session%2Fwith%20space');
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

  it('reuses the session time label for return messages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T22:23:00+08:00'));

    expect(getReturnMessageTimeLabel('2026-06-14T00:42:00+08:00')).toBe('0:42');
    expect(getReturnMessageTimeLabel('2026-06-13T17:10:00+08:00')).toBe('昨天');

    vi.useRealTimers();
  });
});
