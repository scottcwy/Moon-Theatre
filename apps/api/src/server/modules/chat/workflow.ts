import { extractAndUpsertMemories } from '../memory/index.js';
import { incrementBondExp } from '../relationships/index.js';
import { unlockAchievementsForChat } from '../achievements/index.js';

export interface ChatCompletionEffectsResult {
  bond: Awaited<ReturnType<typeof incrementBondExp>> | null;
  unlockedAchievements: string[];
  unlockedTitles: string[];
}

export async function runChatCompletionEffects(input: {
  userId: string;
  characterId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<ChatCompletionEffectsResult> {
  const memoryResultPromise = settle(
    extractAndUpsertMemories(input.userId, input.characterId, input.userMessage, input.assistantMessage),
  );
  const bondResult = await settle(incrementBondExp(input.userId, input.characterId));
  const [, achievementResult] = await Promise.all([
    memoryResultPromise,
    settle(unlockAchievementsForChat(input.userId)),
  ]);

  const achievementValue = achievementResult.status === 'fulfilled'
    ? achievementResult.value
    : { unlockedAchievements: [], unlockedTitles: [] };

  return {
    bond: bondResult.status === 'fulfilled' ? bondResult.value : null,
    unlockedAchievements: achievementValue.unlockedAchievements,
    unlockedTitles: achievementValue.unlockedTitles,
  };
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}
