import { describe, expect, it, vi } from 'vitest';
import { filterChatSessions, getChatPreviewText, getSessionLevelLabel, getSessionTimeLabel } from './list.model';

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

  it('uses relationship wording for level chips and a quiet empty preview', () => {
    expect(getSessionLevelLabel(3)).toBe('羁绊 3');
    expect(getSessionLevelLabel('immersive')).toBe('羁绊 5');
    expect(getChatPreviewText('  ')).toBe('还没有新的剧场消息');
    expect(getChatPreviewText('今晚的月色很好，要一起出去走走吗？')).toBe('今晚的月色很好，要一起出去走走吗？');
  });

  it('filters sessions by character name and latest preview text', () => {
    const sessions = [
      {
        id: 's1',
        characterId: 'hakuzo',
        characterName: '白藏',
        modelTier: 'standard' as const,
        lastMessage: '第一重鸟居外有人等你。',
        updatedAt: '2026-06-14T00:42:00+08:00',
      },
      {
        id: 's2',
        characterId: 'mio',
        characterName: '月岛澪',
        modelTier: 'immersive' as const,
        lastMessage: '屏风上的桥又出现了。',
        updatedAt: '2026-06-09T12:00:00+08:00',
      },
    ];

    expect(filterChatSessions(sessions, ' 白 ')).toEqual([sessions[0]]);
    expect(filterChatSessions(sessions, '屏风')).toEqual([sessions[1]]);
    expect(filterChatSessions(sessions, '')).toEqual(sessions);
  });
});
