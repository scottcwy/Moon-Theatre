import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  characters,
  characterPrompts,
  characterReturnMessages,
  chatSessions,
  messages,
  relationships,
  users,
} from '../../db/schema';
import { generateReturnMessageContent } from './generator.js';

const DAY_MS = 86_400_000;
const UNREAD_CAP = 3;
const SWEEP_AI_CONCURRENCY = 4;
const SWEEP_WINDOW_COUNT = 3;

export type CandidateReason = 'recent' | 'bond';

export interface CandidateCharacter {
  characterId: string;
  reason: CandidateReason;
}

export interface ReturnMessageRecord {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatarUrl: string;
  content: string;
  reason: string;
  createdAt: Date;
  readAt: Date | null;
}

/** UTC 24h 桶：floor(now / 86400000) * 86400000，返回 UTC 零点。 */
export function getWindowStart(now: Date | number): Date {
  const time = typeof now === 'number' ? now : now.getTime();
  return new Date(Math.floor(time / DAY_MS) * DAY_MS);
}

/** 候选①：最近成功聊过的 active 角色（有成功 assistant 消息的会话，按会话 updatedAt 倒序取第一个）。 */
export async function getRecentChatCharacterId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ characterId: chatSessions.characterId })
    .from(chatSessions)
    .innerJoin(
      characters,
      and(eq(characters.id, chatSessions.characterId), eq(characters.status, 'active')),
    )
    .innerJoin(messages, eq(messages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(messages.role, 'assistant'),
        eq(messages.outOfScope, false),
        eq(messages.excludedFromContext, false),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(1);

  return row?.characterId ?? null;
}

/** 候选②：羁绊最高的 active 角色（bondLevel/bondExp/updatedAt 倒序取第一个）。 */
export async function getTopBondCharacterId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ characterId: relationships.characterId })
    .from(relationships)
    .innerJoin(
      characters,
      and(eq(characters.id, relationships.characterId), eq(characters.status, 'active')),
    )
    .where(eq(relationships.userId, userId))
    .orderBy(
      desc(relationships.bondLevel),
      desc(relationships.bondExp),
      desc(relationships.updatedAt),
    )
    .limit(1);

  return row?.characterId ?? null;
}

/** 合并两个候选，同一角色只保留一条，'recent' 优先。 */
export async function selectCandidateCharacters(
  userId: string,
): Promise<CandidateCharacter[]> {
  const [recentId, bondId] = await Promise.all([
    getRecentChatCharacterId(userId),
    getTopBondCharacterId(userId),
  ]);

  const candidates: CandidateCharacter[] = [];
  if (recentId) {
    candidates.push({ characterId: recentId, reason: 'recent' });
  }
  if (bondId && bondId !== recentId) {
    candidates.push({ characterId: bondId, reason: 'bond' });
  }
  return candidates;
}

/** 该角色未读（readAt IS NULL）留言条数。 */
export async function getUnreadCount(userId: string, characterId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(characterReturnMessages)
    .where(
      and(
        eq(characterReturnMessages.userId, userId),
        eq(characterReturnMessages.characterId, characterId),
        isNull(characterReturnMessages.readAt),
      ),
    );

  return row?.count ?? 0;
}

/** 该窗口是否已有留言。 */
export async function hasMessageInWindow(
  userId: string,
  characterId: string,
  windowStart: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: characterReturnMessages.id })
    .from(characterReturnMessages)
    .where(
      and(
        eq(characterReturnMessages.userId, userId),
        eq(characterReturnMessages.characterId, characterId),
        eq(characterReturnMessages.windowStart, windowStart),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * 插入留言，命中窗口唯一索引（userId, characterId, windowStart）时静默跳过，
 * 返回是否新建（幂等）。
 */
export async function insertReturnMessage(
  userId: string,
  characterId: string,
  content: string,
  reason: CandidateReason,
  windowStart: Date,
): Promise<boolean> {
  const [row] = await db
    .insert(characterReturnMessages)
    .values({ userId, characterId, content, reason, windowStart })
    .onConflictDoNothing({
      target: [
        characterReturnMessages.userId,
        characterReturnMessages.characterId,
        characterReturnMessages.windowStart,
      ],
    })
    .returning({ id: characterReturnMessages.id });

  return Boolean(row);
}

/** 为一个窗口生成并插入留言；角色不存在返回 false；冲突时静默返回未新建。 */
export async function generateForWindow(
  userId: string,
  characterId: string,
  reason: CandidateReason,
  windowStart: Date,
): Promise<boolean> {
  const [character] = await db
    .select({
      name: characters.name,
      systemPrompt: characterPrompts.systemPrompt,
      personalityPrompt: characterPrompts.personalityPrompt,
    })
    .from(characters)
    .leftJoin(characterPrompts, eq(characterPrompts.characterId, characters.id))
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!character) {
    return false;
  }

  const content = await generateReturnMessageContent({
    name: character.name,
    systemPrompt: character.systemPrompt,
    personalityPrompt: character.personalityPrompt,
  });

  return insertReturnMessage(userId, characterId, content, reason, windowStart);
}

/**
 * 用户回访时补齐当前窗口：每个候选角色未读 < 3 且当前窗口无留言时生成一条
 * （多个候选并行，最多 2 次生成调用）。返回全部未读留言与各角色未读数。
 */
export async function checkReturnMessages(userId: string): Promise<{
  messages: ReturnMessageRecord[];
  characterUnread: Record<string, number>;
}> {
  const candidates = await selectCandidateCharacters(userId);
  const windowStart = getWindowStart(new Date());

  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const unread = await getUnreadCount(userId, candidate.characterId);
        if (unread >= UNREAD_CAP) return;
        if (await hasMessageInWindow(userId, candidate.characterId, windowStart)) return;
        await generateForWindow(userId, candidate.characterId, candidate.reason, windowStart);
      } catch (error) {
        console.warn({
          event: 'return_message_check_character_failed',
          userId,
          characterId: candidate.characterId,
          error,
        });
      }
    }),
  );

  const messages = await db
    .select({
      id: characterReturnMessages.id,
      characterId: characterReturnMessages.characterId,
      characterName: characters.name,
      characterAvatarUrl: characters.avatarUrl,
      content: characterReturnMessages.content,
      reason: characterReturnMessages.reason,
      createdAt: characterReturnMessages.createdAt,
      readAt: characterReturnMessages.readAt,
    })
    .from(characterReturnMessages)
    .innerJoin(characters, eq(characters.id, characterReturnMessages.characterId))
    .where(
      and(
        eq(characterReturnMessages.userId, userId),
        isNull(characterReturnMessages.readAt),
      ),
    )
    .orderBy(desc(characterReturnMessages.createdAt));

  const characterUnread: Record<string, number> = {};
  for (const message of messages) {
    characterUnread[message.characterId] = (characterUnread[message.characterId] ?? 0) + 1;
  }

  return { messages, characterUnread };
}

/** 将该用户该角色全部未读留言置为已读，返回更新的条数；重复调用幂等。 */
export async function markCharacterMessagesRead(
  userId: string,
  characterId: string,
): Promise<number> {
  const rows = await db
    .update(characterReturnMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(characterReturnMessages.userId, userId),
        eq(characterReturnMessages.characterId, characterId),
        isNull(characterReturnMessages.readAt),
      ),
    )
    .returning({ id: characterReturnMessages.id });

  return rows.length;
}

function getSweepWindows(now: Date): Date[] {
  return Array.from(
    { length: SWEEP_WINDOW_COUNT },
    (_, offset) => getWindowStart(now.getTime() - offset * DAY_MS),
  );
}

/** 简单并发池：最多 concurrency 个任务同时执行，单任务失败只记录不中断。 */
async function runWithConcurrency(tasks: Array<() => Promise<boolean>>, concurrency: number): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      try {
        await tasks[index]!();
      } catch (error) {
        console.warn({ event: 'return_message_generation_failed', index, error });
      }
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/**
 * 每小时回访补发：遍历 active 用户，对每个候选角色补齐最近 3 个缺失窗口
 * （当前窗口、now-1d、now-2d），AI 生成并发上限 4，插入幂等。
 * 单用户/单窗口失败不中断整体。
 */
export async function sweepReturnMessages(): Promise<void> {
  const activeUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.status, 'active'));

  const windows = getSweepWindows(new Date());
  const tasks: Array<() => Promise<boolean>> = [];

  for (const user of activeUsers) {
    try {
      const candidates = await selectCandidateCharacters(user.id);
      for (const candidate of candidates) {
        try {
          const unread = await getUnreadCount(user.id, candidate.characterId);
          if (unread >= UNREAD_CAP) continue;
          for (const windowStart of windows) {
            if (await hasMessageInWindow(user.id, candidate.characterId, windowStart)) {
              continue;
            }
            tasks.push(() =>
              generateForWindow(user.id, candidate.characterId, candidate.reason, windowStart),
            );
          }
        } catch (error) {
          console.warn({
            event: 'return_message_sweep_character_failed',
            userId: user.id,
            characterId: candidate.characterId,
            error,
          });
        }
      }
    } catch (error) {
      console.warn({
        event: 'return_message_sweep_user_failed',
        userId: user.id,
        error,
      });
    }
  }

  await runWithConcurrency(tasks, SWEEP_AI_CONCURRENCY);
}
