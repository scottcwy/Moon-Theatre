import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../memory/index.js', () => ({
  extractAndUpsertMemories: vi.fn(),
}));

vi.mock('../../relationships/index.js', () => ({
  incrementBondExp: vi.fn(),
}));

vi.mock('../../achievements/index.js', () => ({
  unlockAchievementsForChat: vi.fn(),
}));

describe('chat completion workflow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns bond and unlock results when all side effects succeed', async () => {
    const { incrementBondExp } = await import('../../relationships/index.js');
    const { extractAndUpsertMemories } = await import('../../memory/index.js');
    const { unlockAchievementsForChat } = await import('../../achievements/index.js');
    const { runChatCompletionEffects } = await import('../workflow.js');

    vi.mocked(incrementBondExp).mockResolvedValue({
      relationship: { bondLevel: 2, bondExp: 10 },
      leveledUp: true,
    } as Awaited<ReturnType<typeof incrementBondExp>>);
    vi.mocked(extractAndUpsertMemories).mockResolvedValue([]);
    vi.mocked(unlockAchievementsForChat).mockResolvedValue({
      unlockedAchievements: ['first_chat'],
      unlockedTitles: ['入戏者'],
    });

    await expect(runChatCompletionEffects({
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '你好',
      assistantMessage: '你好。',
    })).resolves.toEqual({
      bond: {
        relationship: { bondLevel: 2, bondExp: 10 },
        leveledUp: true,
      },
      unlockedAchievements: ['first_chat'],
      unlockedTitles: ['入戏者'],
    });
  });

  it('evaluates achievements after bond updates complete', async () => {
    const { incrementBondExp } = await import('../../relationships/index.js');
    const { extractAndUpsertMemories } = await import('../../memory/index.js');
    const { unlockAchievementsForChat } = await import('../../achievements/index.js');
    const { runChatCompletionEffects } = await import('../workflow.js');
    const calls: string[] = [];

    vi.mocked(incrementBondExp).mockImplementation(async () => {
      calls.push('bond:start');
      await Promise.resolve();
      calls.push('bond:done');
      return {
        relationship: { bondLevel: 2, bondExp: 100 },
        leveledUp: true,
      } as Awaited<ReturnType<typeof incrementBondExp>>;
    });
    vi.mocked(extractAndUpsertMemories).mockResolvedValue([]);
    vi.mocked(unlockAchievementsForChat).mockImplementation(async () => {
      calls.push('achievements:start');
      return { unlockedAchievements: ['bond_level_2'], unlockedTitles: [] };
    });

    await runChatCompletionEffects({
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '继续',
      assistantMessage: '羁绊加深了。',
    });

    expect(calls).toEqual(['bond:start', 'bond:done', 'achievements:start']);
  });

  it('keeps chat completion resilient when optional side effects fail', async () => {
    const { incrementBondExp } = await import('../../relationships/index.js');
    const { extractAndUpsertMemories } = await import('../../memory/index.js');
    const { unlockAchievementsForChat } = await import('../../achievements/index.js');
    const { runChatCompletionEffects } = await import('../workflow.js');

    vi.mocked(incrementBondExp).mockRejectedValue(new Error('bond failed'));
    vi.mocked(extractAndUpsertMemories).mockRejectedValue(new Error('memory failed'));
    vi.mocked(unlockAchievementsForChat).mockRejectedValue(new Error('achievement failed'));

    await expect(runChatCompletionEffects({
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '你好',
      assistantMessage: '你好。',
    })).resolves.toEqual({
      bond: null,
      unlockedAchievements: [],
      unlockedTitles: [],
    });
  });
});
