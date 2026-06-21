import { describe, expect, it } from 'vitest';
import { LORDICON_ATTRIBUTION, getAchievementIconMeta } from './AchievementIcon.model';

describe('achievement icon metadata', () => {
  it('maps known achievement codes to project-styled icon fallbacks', () => {
    expect(getAchievementIconMeta('first_chat')).toMatchObject({
      asset: null,
      fallback: '幕',
      tone: 'moon',
    });
    expect(getAchievementIconMeta('bond_level_2')).toMatchObject({
      asset: null,
      fallback: '绊',
      tone: 'red',
    });
    expect(getAchievementIconMeta('message_count_10')).toMatchObject({
      asset: null,
      fallback: '信',
      tone: 'gold',
    });
  });

  it('falls back to a project-styled default for unknown achievements', () => {
    expect(getAchievementIconMeta('unknown')).toEqual({
      asset: null,
      fallback: '成',
      tone: 'gold',
      label: '成就',
    });
  });

  it('keeps required free Lordicon attribution text centralized', () => {
    expect(LORDICON_ATTRIBUTION).toBe('Animated icons by Lordicon.com');
  });
});
