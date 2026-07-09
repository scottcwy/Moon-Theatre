import { beforeEach, describe, expect, it, vi } from 'vitest';

const effectRunState = new Map<string, 'running' | 'completed' | 'failed'>();
const insertMock = vi.fn();
const valuesMock = vi.fn();
const onConflictDoUpdateMock = vi.fn();
const returningMock = vi.fn();
const updateMock = vi.fn();
const setMock = vi.fn();
const whereMock = vi.fn();

vi.mock('../../../db/index.js', () => ({
  db: {
    insert: insertMock,
    update: updateMock,
  },
}));

vi.mock('../../../db/schema.js', () => ({
  chatEffectRuns: {
    id: 'chatEffectRuns.id',
    assistantMessageId: 'chatEffectRuns.assistantMessageId',
    effectName: 'chatEffectRuns.effectName',
    status: 'chatEffectRuns.status',
    leaseExpiresAt: 'chatEffectRuns.leaseExpiresAt',
    error: 'chatEffectRuns.error',
    updatedAt: 'chatEffectRuns.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
  or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
}));

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
    effectRunState.clear();
    insertMock.mockReturnValue({ values: valuesMock });
    valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    onConflictDoUpdateMock.mockReturnValue({ returning: returningMock });
    returningMock.mockImplementation(() => {
      const values = valuesMock.mock.calls.at(-1)?.[0] as { assistantMessageId?: string; effectName?: string };
      const key = `${values.assistantMessageId}:${values.effectName}`;
      if (effectRunState.get(key) === 'completed' || effectRunState.get(key) === 'running') {
        return Promise.resolve([]);
      }
      effectRunState.set(key, 'running');
      return Promise.resolve([{ id: key }]);
    });
    updateMock.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: whereMock });
    whereMock.mockImplementation((condition: unknown) => {
      const text = JSON.stringify(condition);
      const assistantMatch = text.match(/assistant-message-\d+/);
      const effectMatch = text.match(/memory|bond|achievement/);
      const setValues = setMock.mock.calls.at(-1)?.[0] as { status?: 'running' | 'completed' | 'failed' };
      if (assistantMatch && effectMatch && setValues.status) {
        effectRunState.set(`${assistantMatch[0]}:${effectMatch[0]}`, setValues.status);
      }
      return Promise.resolve(undefined);
    });
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

  it('uses assistant message id as an idempotency context', async () => {
    const { incrementBondExp } = await import('../../relationships/index.js');
    const { extractAndUpsertMemories } = await import('../../memory/index.js');
    const { unlockAchievementsForChat } = await import('../../achievements/index.js');
    const { runChatCompletionEffects } = await import('../workflow.js');

    vi.mocked(incrementBondExp).mockResolvedValue({
      relationship: { bondLevel: 1, bondExp: 10 },
      leveledUp: false,
    } as Awaited<ReturnType<typeof incrementBondExp>>);
    vi.mocked(extractAndUpsertMemories).mockResolvedValue([]);
    vi.mocked(unlockAchievementsForChat).mockResolvedValue({
      unlockedAchievements: [],
      unlockedTitles: [],
    });

    const input = {
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '你好',
      assistantMessage: '你好。',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
    };

    await runChatCompletionEffects(input);
    await runChatCompletionEffects(input);

    expect(incrementBondExp).toHaveBeenCalledTimes(1);
    expect(incrementBondExp).toHaveBeenCalledWith('user-1', 'character-1', 10, 'assistant-message-1');
    expect(extractAndUpsertMemories).toHaveBeenCalledTimes(1);
    expect(unlockAchievementsForChat).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(6);
  });

  it('does not mark failed effects as completed and retries them on the next call', async () => {
    const { incrementBondExp } = await import('../../relationships/index.js');
    const { extractAndUpsertMemories } = await import('../../memory/index.js');
    const { unlockAchievementsForChat } = await import('../../achievements/index.js');
    const { runChatCompletionEffects } = await import('../workflow.js');

    vi.mocked(incrementBondExp)
      .mockRejectedValueOnce(new Error('bond failed once'))
      .mockResolvedValueOnce({
        relationship: { bondLevel: 1, bondExp: 10 },
        leveledUp: false,
      } as Awaited<ReturnType<typeof incrementBondExp>>);
    vi.mocked(extractAndUpsertMemories).mockResolvedValue([]);
    vi.mocked(unlockAchievementsForChat).mockResolvedValue({
      unlockedAchievements: [],
      unlockedTitles: [],
    });

    const input = {
      userId: 'user-1',
      characterId: 'character-1',
      userMessage: '你好',
      assistantMessage: '你好。',
      sessionId: 'session-1',
      userMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
    };

    await expect(runChatCompletionEffects(input)).resolves.toMatchObject({ bond: null });
    await expect(runChatCompletionEffects(input)).resolves.toMatchObject({
      bond: {
        relationship: { bondLevel: 1, bondExp: 10 },
        leveledUp: false,
      },
    });

    expect(incrementBondExp).toHaveBeenCalledTimes(2);
    expect(incrementBondExp).toHaveBeenLastCalledWith('user-1', 'character-1', 10, 'assistant-message-1');
    expect(extractAndUpsertMemories).toHaveBeenCalledTimes(1);
    expect(unlockAchievementsForChat).toHaveBeenCalledTimes(1);
  });
});
