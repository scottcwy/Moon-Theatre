import { and, desc, eq, exists, isNull, sql } from 'drizzle-orm';
import { config } from '../../config/index.js';
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
import { appendSessionMessage } from '../fastclaw/adapter.js';
import { generateReturnMessageContent, RETURN_MESSAGE_TIMEOUT_MS } from './generator.js';
import { latestUserMessageAtSql } from '../chat/character-summary-service.js';

const DAY_MS = 86_400_000;
/** UTC+8 与 UTC 的固定时差（毫秒），用于计算北京时间自然日零点。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const UNREAD_CAP = 3;
const SWEEP_AI_CONCURRENCY = 4;
const SWEEP_WINDOW_COUNT = 3;

/** 查询客户端最小契约：裸 db 与事务回调均满足，只声明本模块实际用到的方法。 */
type TransactionClient = Pick<typeof db, 'insert' | 'update' | 'select' | 'execute'>;

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

/**
 * UTC+8 自然日零点（北京时间所在日的零点，返回对应 UTC 时刻）：
 * date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') 的 JS 等价实现。
 */
export function getWindowStart(now: Date | number): Date {
  const time = typeof now === 'number' ? now : now.getTime();
  const beijingDayStart = Math.floor((time + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(beijingDayStart - BEIJING_OFFSET_MS);
}

/**
 * 候选①：最近成功聊过的 active 角色。
 * 存在成功 assistant 消息（role='assistant'、outOfScope=false、excludedFromContext=false）的会话中，
 * 按该会话用户最后一条消息时间（role='user' 消息最大 createdAt）倒序取第一个角色。
 */
export async function getRecentChatCharacterId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ characterId: chatSessions.characterId })
    .from(chatSessions)
    .innerJoin(
      characters,
      and(eq(characters.id, chatSessions.characterId), eq(characters.status, 'active')),
    )
    .where(and(
      eq(chatSessions.userId, userId),
      exists(
        db
          .select({ id: messages.id })
          .from(messages)
          .where(and(
            eq(messages.sessionId, chatSessions.id),
            eq(messages.role, 'assistant'),
            eq(messages.outOfScope, false),
            eq(messages.excludedFromContext, false),
          )),
      ),
      exists(
        db
          .select({ id: messages.id })
          .from(messages)
          .where(and(
            eq(messages.sessionId, chatSessions.id),
            eq(messages.role, 'user'),
          )),
      ),
    ))
    .orderBy(desc(latestUserMessageAtSql()))
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

/** 该角色未读（readAt IS NULL）留言条数；传入 client 时在事务内统计。 */
export async function getUnreadCount(
  userId: string,
  characterId: string,
  client: TransactionClient = db,
): Promise<number> {
  const [row] = await client
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
 * 插入投递元数据，命中窗口唯一索引（userId, characterId, windowStart）时静默跳过，
 * 返回是否新建（幂等）。
 */
export async function insertReturnMessage(
  userId: string,
  characterId: string,
  content: string,
  reason: CandidateReason,
  windowStart: Date,
  messageId: string | null,
  client: TransactionClient = db,
): Promise<boolean> {
  const [row] = await client
    .insert(characterReturnMessages)
    .values({ userId, characterId, content, reason, windowStart, messageId })
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

/**
 * 该角色最近活跃的自由会话（status='active'、mode='free'），
 * 按用户最后一条消息时间（role='user' 消息最大 createdAt）倒序取第一个；
 * 无用户消息的会话排在最后（NULLS LAST）。
 */
async function getActiveFreeSessionId(
  userId: string,
  characterId: string,
  client: TransactionClient,
): Promise<string | null> {
  const [row] = await client
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(
      eq(chatSessions.userId, userId),
      eq(chatSessions.characterId, characterId),
      eq(chatSessions.status, 'active'),
      eq(chatSessions.mode, 'free'),
    ))
    .orderBy(sql`${latestUserMessageAtSql()} desc nulls last`);

  return row?.id ?? null;
}

/** 为该角色新建一个自由模式会话（status='active'、mode='free'）。 */
async function createFreeSession(
  userId: string,
  characterId: string,
  client: TransactionClient,
): Promise<string> {
  const [created] = await client
    .insert(chatSessions)
    .values({ userId, characterId, status: 'active', mode: 'free' })
    .returning({ id: chatSessions.id });

  if (!created) {
    throw new Error('Failed to create free chat session');
  }
  return created.id;
}

/**
 * 按 (userId, characterId) 串行化回访投递：事务级 advisory lock，
 * 保证「未读 < UNREAD_CAP」的 count 校验与插入之间不会被并发投递穿插
 * （含该角色尚无任何留言的零行场景）。锁随事务提交/回滚自动释放。
 */
async function lockReturnMessagesForCharacter(
  client: TransactionClient,
  userId: string,
  characterId: string,
): Promise<void> {
  await client.execute(
    sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${characterId}))`,
  );
}

/**
 * 投递一条留言（整体原子）：先按 (userId, characterId) 加 advisory lock，
 * 在事务内统计未读数，未达上限且未命中窗口唯一索引冲突才写投递元数据（messageId 为空）；
 * 随后查/建自由会话、写真实 assistant 消息（可见但 excludedFromContext=true，不计费），
 * 最后回填 message_id。并发同窗口只会落 1 条消息 + 1 条元数据，不残留孤儿消息；
 * 任何路径都不会把未读推到 UNREAD_CAP 以上。
 */
async function deliverReturnMessage(
  userId: string,
  characterId: string,
  content: string,
  reason: CandidateReason,
  windowStart: Date,
  agentId: string | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockReturnMessagesForCharacter(tx, userId, characterId);
    const unread = await getUnreadCount(userId, characterId, tx);
    if (unread >= UNREAD_CAP) {
      return false;
    }

    const created = await insertReturnMessage(
      userId,
      characterId,
      content,
      reason,
      windowStart,
      null,
      tx,
    );
    if (!created) {
      return false;
    }

    const existingSessionId = await getActiveFreeSessionId(userId, characterId, tx);
    const sessionId = existingSessionId ?? await createFreeSession(userId, characterId, tx);

    const [message] = await tx
      .insert(messages)
      .values({
        sessionId,
        role: 'assistant',
        content,
        outOfScope: false,
        excludedFromContext: true,
        generationStatus: 'completed',
      })
      .returning({ id: messages.id });

    if (!message) {
      throw new Error('Failed to write return message');
    }

    await tx
      .update(characterReturnMessages)
      .set({ messageId: message.id })
      .where(and(
        eq(characterReturnMessages.userId, userId),
        eq(characterReturnMessages.characterId, characterId),
        eq(characterReturnMessages.windowStart, windowStart),
      ));

    // 角色 Agent 架构：写库后调用 F8 append 到目标自由会话（messageId = messages.id）。
    // FastClaw 端按 messageId 幂等（重复 append 静默跳过）；失败抛错回滚整笔投递，
    // 下次 sweep/check 重试（窗口记录未提交，不会出现「账本有、会话无」的孤儿留言）。
    if (config.useRoleplayAgents) {
      if (!agentId) {
        // seed 契约保证 characters.agent_id 19/19；缺失属于数据问题，显式告警而非静默。
        console.warn({
          event: 'return_message_append_skipped_no_agent_id',
          userId,
          characterId,
          sessionId,
        });
      } else {
        await appendSessionMessage({
          agentId,
          userId,
          scope: 'free',
          sessionKey: sessionId,
          role: 'assistant',
          content,
          messageId: message.id,
          timeoutMs: RETURN_MESSAGE_TIMEOUT_MS,
        });
      }
    }

    return true;
  });
}

/** 为一个窗口生成并投递留言；角色不存在返回 false；冲突时静默返回未新建。 */
export async function generateForWindow(
  userId: string,
  characterId: string,
  reason: CandidateReason,
  windowStart: Date,
): Promise<boolean> {
  const [character] = await db
    .select({
      name: characters.name,
      agentId: characters.agentId,
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

  // 目标自由会话 key（可选，仅角色 Agent 架构）：F10 只读获取上下文；无会话时不传（不建孤儿会话）。
  // 关闭开关不发起该查询，保持现状路径零额外 DB 访问。
  const existingSessionId = config.useRoleplayAgents
    ? await getActiveFreeSessionId(userId, characterId, db)
    : null;

  const content = await generateReturnMessageContent({
    characterName: character.name,
    systemPrompt: character.systemPrompt,
    personalityPrompt: character.personalityPrompt,
    agentId: character.agentId ?? null,
    userId,
    sessionKey: existingSessionId,
  });

  return deliverReturnMessage(userId, characterId, content, reason, windowStart, character.agentId ?? null);
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
 * 每小时回访补发：遍历 active 用户，对每个候选角色按「未读 < UNREAD_CAP」预算，
 * 在最近 3 个缺失窗口（当前窗口、now-1d、now-2d）中最多补 UNREAD_CAP - 当前未读 条，
 * AI 生成并发上限 4，插入幂等；投递事务内再次原子校验未读上限。
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
          const budget = UNREAD_CAP - unread;
          if (budget <= 0) continue;
          let added = 0;
          for (const windowStart of windows) {
            if (added >= budget) break;
            if (await hasMessageInWindow(user.id, candidate.characterId, windowStart)) {
              continue;
            }
            tasks.push(() =>
              generateForWindow(user.id, candidate.characterId, candidate.reason, windowStart),
            );
            added += 1;
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
