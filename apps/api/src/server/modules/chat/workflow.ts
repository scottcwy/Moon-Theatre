import { and, eq, lte, or } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { chatEffectRuns } from '../../db/schema.js';
import { extractAndUpsertMemories } from '../memory/index.js';
import { unlockAchievementsForChat } from '../achievements/index.js';

export interface ChatCompletionEffectsResult {
  bond: null;
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
  mode?: 'script' | 'free';
  scriptId?: string | null;
}): Promise<ChatCompletionEffectsResult> {
  // 角色 Agent 架构：记忆唯一事实源在 FastClaw，API memories 表不再写入（增量=0）。
  // 关闭开关时保持现状：照常抽取并 upsert memories。
  const memoryResultPromise = config.useRoleplayAgents
    ? Promise.resolve({ status: 'skipped' as const })
    : runEffect(
        'memory',
        input,
        () => extractAndUpsertMemories(
          input.userId,
          input.characterId,
          input.userMessage,
          input.assistantMessage,
          input.mode,
          input.scriptId,
        ),
      );
  const [, achievementResult] = await Promise.all([
    memoryResultPromise,
    runEffect('achievement', input, () => unlockAchievementsForChat(input.userId)),
  ]);

  const achievementValue = achievementResult.status === 'fulfilled'
    ? achievementResult.value
    : { unlockedAchievements: [], unlockedTitles: [] };

  return {
    bond: null,
    unlockedAchievements: achievementValue.unlockedAchievements,
    unlockedTitles: achievementValue.unlockedTitles,
  };
}

type ChatEffectName = 'memory' | 'achievement';

async function runEffect<T>(
  effect: ChatEffectName,
  context: {
    sessionId?: string;
    userMessageId?: string;
    assistantMessageId?: string;
  },
  run: () => Promise<T>,
): Promise<PromiseSettledResult<T> | { status: 'skipped' }> {
  const startedAt = Date.now();
  const claimed = await claimEffectRun(context.assistantMessageId, effect);
  if (!claimed) {
    console.info({
      event: 'chat_completion_effect',
      effect,
      sessionId: context.sessionId,
      userMessageId: context.userMessageId,
      assistantMessageId: context.assistantMessageId,
      effectDurationMs: Date.now() - startedAt,
      skipped: true,
    });
    return { status: 'skipped' };
  }

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
    await markEffectRunFailed(context.assistantMessageId, effect, readErrorMessage(result.reason));
    console.error(event);
  } else {
    await markEffectRunCompleted(context.assistantMessageId, effect);
    console.info(event);
  }
  return result;
}

const EFFECT_LEASE_MS = 5 * 60 * 1000;

async function claimEffectRun(assistantMessageId: string | undefined, effectName: ChatEffectName): Promise<boolean> {
  if (!assistantMessageId) return true;

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + EFFECT_LEASE_MS);
  const [claimed] = await db
    .insert(chatEffectRuns)
    .values({
      assistantMessageId,
      effectName,
      status: 'running',
      leaseExpiresAt,
      error: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [chatEffectRuns.assistantMessageId, chatEffectRuns.effectName],
      set: {
        status: 'running',
        leaseExpiresAt,
        error: null,
        updatedAt: now,
      },
      where: or(
        eq(chatEffectRuns.status, 'failed'),
        and(
          eq(chatEffectRuns.status, 'running'),
          lte(chatEffectRuns.leaseExpiresAt, now),
        ),
      ),
    })
    .returning({ id: chatEffectRuns.id });

  return Boolean(claimed);
}

async function markEffectRunCompleted(assistantMessageId: string | undefined, effectName: ChatEffectName): Promise<void> {
  if (!assistantMessageId) return;

  await db
    .update(chatEffectRuns)
    .set({
      status: 'completed',
      leaseExpiresAt: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(chatEffectRuns.assistantMessageId, assistantMessageId),
      eq(chatEffectRuns.effectName, effectName),
    ));
}

async function markEffectRunFailed(
  assistantMessageId: string | undefined,
  effectName: ChatEffectName,
  error: string,
): Promise<void> {
  if (!assistantMessageId) return;

  await db
    .update(chatEffectRuns)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      error: error.slice(0, 512),
      updatedAt: new Date(),
    })
    .where(and(
      eq(chatEffectRuns.assistantMessageId, assistantMessageId),
      eq(chatEffectRuns.effectName, effectName),
    ));
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
