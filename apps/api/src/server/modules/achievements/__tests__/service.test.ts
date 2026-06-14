import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  db: {},
}));

import { evaluateAchievementRules } from '../rules.js';
import { mergeUnlockedAchievementCodes } from '../service.js';

describe('achievement rules', () => {
  it('unlocks first chat, bond level 2, and message threshold rules', () => {
    expect(
      evaluateAchievementRules({
        userMessageCount: 10,
        assistantMessageCount: 1,
        maxBondLevel: 2,
      }).map((rule) => rule.code),
    ).toEqual(['first_chat', 'bond_level_2', 'message_count_10']);
  });

  it('does not unlock rules before thresholds are met', () => {
    expect(
      evaluateAchievementRules({
        userMessageCount: 9,
        assistantMessageCount: 0,
        maxBondLevel: 1,
      }),
    ).toEqual([]);
  });
});

describe('achievement service helpers', () => {
  it('keeps newly unlocked achievement codes idempotent', () => {
    expect(mergeUnlockedAchievementCodes(['first_chat'], ['first_chat', 'message_count_10'])).toEqual(['message_count_10']);
  });
});
