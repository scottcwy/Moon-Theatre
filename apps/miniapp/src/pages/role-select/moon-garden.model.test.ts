import { describe, expect, it } from 'vitest';
import {
  MOON_GARDEN_SCRIPT,
  getMoonGardenRoleCards,
  moonGardenRoleNames,
} from './moon-garden.model';

describe('Moon Garden role selection model', () => {
  it('describes the dedicated Moon Garden role selection surface', () => {
    expect(MOON_GARDEN_SCRIPT.title).toBe('月见庭院：狐神的新娘');
    expect(MOON_GARDEN_SCRIPT.primaryAction).toBe('选择角色');
  });

  it('lists the current Moon Garden cast in script order without defaulting to Hakuzo only', () => {
    expect(moonGardenRoleNames).toEqual(['白藏', '贺茂清玄', '月岛澪', '久远']);
  });

  it('merges API character ids by name while preserving the local script order', () => {
    const cards = getMoonGardenRoleCards([
      { id: 'char-kuon', name: '久远', avatarUrl: '', identity: '服务端身份' },
      { id: 'char-hakuzo', name: '白藏', avatarUrl: '', identity: '服务端狐神' },
    ]);

    expect(cards.map((card) => card.name)).toEqual(['白藏', '贺茂清玄', '月岛澪', '久远']);
    expect(cards[0]?.characterId).toBe('char-hakuzo');
    expect(cards[0]?.identity).toBe('服务端狐神');
    expect(cards[3]?.characterId).toBe('char-kuon');
    expect(cards[3]?.identity).toBe('服务端身份');
  });
});
