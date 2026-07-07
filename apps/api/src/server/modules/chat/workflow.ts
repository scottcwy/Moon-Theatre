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
  sessionId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}): Promise<ChatCompletionEffectsResult> {
  if (input.assistantMessageId && completedEffectMessageIds.has(input.assistantMessageId)) {
    return { bond: null, unlockedAchievements: [], unlockedTitles: [] };
  }
  if (input.assistantMessageId) {
    rememberEffectMessageId(input.assistantMessageId);
  }

  const memoryResultPromise = runEffect(
    'memory',
    input,
    () => extractAndUpsertMemories(input.userId, input.characterId, input.userMessage, input.assistantMessage),
  );
  const bondResult = await runEffect('bond', input, () => incrementBondExp(input.userId, input.characterId));
  const [, achievementResult] = await Promise.all([
    memoryResultPromise,
    runEffect('achievement', input, () => unlockAchievementsForChat(input.userId)),
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

const MAX_REMEMBERED_EFFECT_MESSAGES = 10000;
const completedEffectMessageIds = new Set<string>();
const completedEffectMessageOrder: string[] = [];

function rememberEffectMessageId(assistantMessageId: string): void {
  completedEffectMessageIds.add(assistantMessageId);
  completedEffectMessageOrder.push(assistantMessageId);

  if (completedEffectMessageOrder.length <= MAX_REMEMBERED_EFFECT_MESSAGES) return;

  const expired = completedEffectMessageOrder.shift();
  if (expired) {
    completedEffectMessageIds.delete(expired);
  }
}

async function runEffect<T>(
  effect: 'memory' | 'bond' | 'achievement',
  context: {
    sessionId?: string;
    userMessageId?: string;
    assistantMessageId?: string;
  },
  run: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  const startedAt = Date.now();
  const result = await settle(run());
  const event = {
    event: 'chat_completion_effect',
    effect,
    sessionId: context.sessionId,
    userMessageId: context.userMessageId,
    assistantMessageId: context.assistantMessageId,
    effectDurationMs: Date.now() - startedAt,
    ...(result.status === 'rejected' ? { error: readErrorMessage(result.reason) } : {}),
  };

  if (result.status === 'rejected') {
    console.error(event);
  } else {
    console.info(event);
  }
  return result;
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function readErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
