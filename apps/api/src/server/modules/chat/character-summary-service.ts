import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, chatSessions, messages, scripts } from '../../db/schema';

export interface CharacterChatEntry {
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  latestSessionId: string;
  lastUsedMode: 'free' | 'script';
  lastMessage: string | null;
  updatedAt: Date;
  canSend: boolean;
}

/** 常聊角色条目：聊天列表条目 + 成功对话轮数 + 角色身份（首页卡片副标题需要）。 */
export interface FrequentCharacterEntry extends CharacterChatEntry {
  successfulTurnCount: number;
  identity: string;
}

interface LatestSessionRow {
  id: string;
  characterId: string;
  mode: 'free' | 'script';
  scriptId: string | null;
  updatedAt: Date;
  createdAt: Date;
  characterName: string;
  characterAvatarUrl: string | null;
  characterStatus: string;
  scriptStatus: string | null;
}

/**
 * 「用户最后一条消息时间」共享 SQL 片段（相关子查询）：
 * 某会话 role='user' 消息的最大 createdAt。
 * 模块 6 排序的 latestUpdatedAt tiebreaker 与模块 7 的「最近成功聊过」候选、
 * 活跃自由会话落点共用，避免口径漂移（不得改用会话 updatedAt）。
 */
export function latestUserMessageAtSql(): SQL {
  return sql`(
    select max(${messages.createdAt})
    from ${messages}
    where ${messages.sessionId} = ${chatSessions.id}
      and ${messages.role} = 'user'
  )`;
}

/** 该用户按角色聚合的最新模式会话（selectDistinctOn 每角色一行，最新 updatedAt 优先）。 */
async function getLatestSessionRows(
  userId: string,
  characterIds?: string[],
): Promise<LatestSessionRow[]> {
  const conditions = [eq(chatSessions.userId, userId)];
  if (characterIds && characterIds.length > 0) {
    conditions.push(inArray(chatSessions.characterId, characterIds));
  }

  return db
    .selectDistinctOn([chatSessions.characterId], {
      id: chatSessions.id,
      characterId: chatSessions.characterId,
      mode: chatSessions.mode,
      scriptId: chatSessions.scriptId,
      updatedAt: chatSessions.updatedAt,
      createdAt: chatSessions.createdAt,
      characterName: characters.name,
      characterAvatarUrl: characters.avatarUrl,
      characterStatus: characters.status,
      scriptStatus: scripts.status,
    })
    .from(chatSessions)
    .innerJoin(characters, eq(chatSessions.characterId, characters.id))
    .leftJoin(scripts, eq(characters.scriptId, scripts.id))
    .where(and(...conditions))
    .orderBy(
      asc(chatSessions.characterId),
      desc(chatSessions.updatedAt),
      desc(chatSessions.createdAt),
    );
}

/** 每个会话最近一条 user/assistant 消息内容（预览用，不暴露 system 消息）。 */
async function getLatestMessagePreviewBySession(sessionIds: string[]): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  if (sessionIds.length === 0) return previews;

  // DISTINCT ON (session_id)：每会话只取最近一条 user/assistant 消息，避免为预览拉全量消息。
  const messageRows = await db
    .selectDistinctOn([messages.sessionId], {
      sessionId: messages.sessionId,
      content: messages.content,
      role: messages.role,
    })
    .from(messages)
    .where(and(
      inArray(messages.sessionId, sessionIds),
      or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
    ))
    .orderBy(asc(messages.sessionId), desc(messages.createdAt));

  for (const message of messageRows) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    // DISTINCT ON 在 PostgreSQL 是权威的；该去重保证测试替身/旧适配器下每会话仅一项。
    if (!previews.has(message.sessionId)) {
      previews.set(message.sessionId, message.content);
    }
  }
  return previews;
}

function toCharacterChatEntry(
  row: LatestSessionRow,
  previews: Map<string, string>,
): CharacterChatEntry {
  const preview = previews.get(row.id) ?? null;
  return {
    characterId: row.characterId,
    characterName: row.characterName,
    characterAvatarUrl: row.characterAvatarUrl,
    latestSessionId: row.id,
    lastUsedMode: row.mode,
    lastMessage: preview
      ? (preview.length > 100 ? `${preview.slice(0, 100)}\u2026` : preview)
      : null,
    updatedAt: row.updatedAt,
    canSend: true,
  };
}

/**
 * 聊天列表：按角色聚合的默认入口（无 sort 语义）。
 * 每角色最多一项；只返回角色 active 且所属剧本 active 的角色；
 * 搜索匹配角色名与最近消息；聚合后分页。
 */
export async function getCharacterChatEntries(
  userId: string,
  page: number,
  limit: number,
  keyword: string,
): Promise<{ entries: CharacterChatEntry[]; hasMore: boolean }> {
  const rows = await getLatestSessionRows(userId);

  // DISTINCT ON 在 PostgreSQL 是权威的；额外一遍保证测试替身/旧适配器下每角色仅一项。
  const latestRows = [...rows]
    .sort((left, right) => {
      const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .filter((row, index, sorted) =>
      sorted.findIndex((candidate) => candidate.characterId === row.characterId) === index,
    );

  const visibleRows = latestRows.filter((row) =>
    row.characterStatus === 'active' && row.scriptStatus === 'active',
  );

  const previews = await getLatestMessagePreviewBySession(visibleRows.map((row) => row.id));

  const matchingRows = keyword
    ? visibleRows.filter((row) => {
      const lastMessage = previews.get(row.id) ?? '';
      return `${row.characterName} ${lastMessage}`.toLowerCase().includes(keyword);
    })
    : visibleRows;

  const offset = (page - 1) * limit;
  const pageRows = matchingRows.slice(offset, offset + limit);
  return {
    entries: pageRows.map((row) => toCharacterChatEntry(row, previews)),
    hasMore: offset + limit < matchingRows.length,
  };
}

export interface FrequentCharacterSummary {
  characterId: string;
  characterName: string;
  characterAvatarUrl: string | null;
  identity: string;
  successfulTurnCount: number;
}

/**
 * 常聊角色聚合：数据库内按用户+角色分组计数。
 * 只计 role='assistant'、outOfScope=false、excludedFromContext=false 的消息；
 * 剧本模式与自由对话合计排序，但只聚合不合并历史。
 * 排序：成功轮数 DESC，latestUpdatedAt（用户最后一条消息时间）DESC NULLS LAST，
 *       character.sortOrder ASC。可互动口径与公共角色列表一致（角色 active，
 *       且无剧本或所属剧本 active）。
 */
export async function getFrequentCharacterSummaries(
  userId: string,
  limit: number,
  offset: number,
): Promise<{ summaries: FrequentCharacterSummary[]; hasMore: boolean }> {
  const rows = await db
    .select({
      characterId: chatSessions.characterId,
      characterName: characters.name,
      characterAvatarUrl: characters.avatarUrl,
      identity: characters.identity,
      successfulTurnCount: sql<number>`count(distinct ${messages.id})::int`,
    })
    .from(chatSessions)
    .innerJoin(characters, and(
      eq(characters.id, chatSessions.characterId),
      eq(characters.status, 'active'),
    ))
    .leftJoin(scripts, eq(scripts.id, characters.scriptId))
    .leftJoin(messages, and(
      eq(messages.sessionId, chatSessions.id),
      eq(messages.role, 'assistant'),
      eq(messages.outOfScope, false),
      eq(messages.excludedFromContext, false),
    ))
    .where(and(
      eq(chatSessions.userId, userId),
      or(isNull(characters.scriptId), eq(scripts.status, 'active')),
    ))
    .groupBy(
      chatSessions.characterId,
      characters.name,
      characters.avatarUrl,
      characters.identity,
      characters.sortOrder,
    )
    .having(sql`count(distinct ${messages.id}) > 0`)
    .orderBy(
      desc(sql`count(distinct ${messages.id})`),
      sql`max(${latestUserMessageAtSql()}) desc nulls last`,
      asc(characters.sortOrder),
    )
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return {
    summaries: rows.slice(0, limit),
    hasMore,
  };
}

/**
 * 常聊角色条目：按成功轮数聚合排序，补上每角色最新会话摘要（复用聊天列表口径）。
 * 点击进角色详情，不合并剧本/自由历史。
 */
export async function getFrequentCharacterEntries(
  userId: string,
  page: number,
  limit: number,
): Promise<{ entries: FrequentCharacterEntry[]; hasMore: boolean }> {
  const offset = (page - 1) * limit;
  const { summaries, hasMore } = await getFrequentCharacterSummaries(userId, limit, offset);
  if (summaries.length === 0) {
    return { entries: [], hasMore: false };
  }

  const rows = await getLatestSessionRows(
    userId,
    summaries.map((summary) => summary.characterId),
  );
  const latestRowByCharacter = new Map(rows.map((row) => [row.characterId, row]));
  const previews = await getLatestMessagePreviewBySession(rows.map((row) => row.id));

  const entries = summaries.flatMap((summary) => {
    const row = latestRowByCharacter.get(summary.characterId);
    if (!row) return [];
    return [{
      ...toCharacterChatEntry(row, previews),
      successfulTurnCount: summary.successfulTurnCount,
      identity: summary.identity,
    }];
  });

  return { entries, hasMore };
}
