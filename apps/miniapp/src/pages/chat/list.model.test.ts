import { describe, expect, it, vi } from 'vitest';
import { getChatPreviewText, getSessionLevelLabel, getSessionTimeLabel } from './list.model';

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

  it('uses compact level chips and a quiet empty preview', () => {
    expect(getSessionLevelLabel(3)).toBe('Lv.3');
    expect(getSessionLevelLabel('immersive')).toBe('Lv.5');
    expect(getChatPreviewText('  ')).toBe('还没有新的剧场消息');
    expect(getChatPreviewText('今晚的月色很好，要一起出去走走吗？')).toBe('今晚的月色很好，要一起出去走走吗？');
  });
});
