import { eq, desc, asc, and, count, gte, lt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { chatSessions, messages, reviewLogs, users, characters } from '../../db/schema.js';
import { NotFoundError } from '../../http/errors.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';

type SessionStatus = 'active' | 'archived';
export type ChatMode = 'script' | 'free';

const DAY_MS = 86_400_000;

/**
 * `from`/`to` are inclusive UTC calendar days (`YYYY-MM-DD`). The service compares `created_at`
 * against `[from 00:00:00Z, to 24:00:00Z)`, so both bounds include the whole day they name. No new
 * index is assumed: the identity filters still lead on the existing unique indexes and the range
 * narrows the rows that survive them.
 */
export function sessionCreatedFrom(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function sessionCreatedToExclusive(day: string): Date {
  return new Date(sessionCreatedFrom(day).getTime() + DAY_MS);
}

/**
 * Admin session search (§6 / AC-04): user, character, chat mode, status and created-date range
 * combine as AND filters. `characterId`/`mode` are the character → player-sessions entry, not
 * post-filtering; `from`/`to` are what lets an operator locate a complaint's day instead of paging
 * through every session of a busy character.
 */
export async function listSessions(
  params: PaginationParams & {
    userId?: string;
    status?: SessionStatus;
    characterId?: string;
    mode?: ChatMode;
    from?: string;
    to?: string;
  },
): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(chatSessions.userId, params.userId));
  if (params.status) conditions.push(eq(chatSessions.status, params.status));
  if (params.characterId) conditions.push(eq(chatSessions.characterId, params.characterId));
  if (params.mode) conditions.push(eq(chatSessions.mode, params.mode));
  if (params.from) conditions.push(gte(chatSessions.createdAt, sessionCreatedFrom(params.from)));
  // Exclusive upper bound at the next midnight: the `to` day itself stays fully included.
  if (params.to) conditions.push(lt(chatSessions.createdAt, sessionCreatedToExclusive(params.to)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        characterId: chatSessions.characterId,
        title: chatSessions.title,
        modelTier: chatSessions.modelTier,
        mode: chatSessions.mode,
        status: chatSessions.status,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
        characterName: characters.name,
        userName: users.nickname,
      })
      .from(chatSessions)
      .leftJoin(characters, eq(chatSessions.characterId, characters.id))
      .leftJoin(users, eq(chatSessions.userId, users.id))
      .where(where)
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(chatSessions)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function listMessages(params: PaginationParams & { sessionId: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const where = eq(messages.sessionId, params.sessionId);

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: messages.id,
        sessionId: messages.sessionId,
        role: messages.role,
        content: messages.content,
        mood: messages.mood,
        modelTier: messages.modelTier,
        tokensUsed: messages.tokensUsed,
        pointsConsumed: messages.pointsConsumed,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(where)
      // Stable within one page: equal timestamps are ordered by id, so a bounded page never
      // reorders between two reads. Messages are append-only (ascending createdAt), so an offset
      // page already read cannot shift; new arrivals land after the page the operator saw.
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(messages)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

/**
 * Session header only: metadata for the history page without loading the transcript. The page
 * reads the messages page by page through `listMessages`, never wholesale (§6).
 */
export async function getSessionMetadata(id: string) {
  const [session] = await db
    .select({
      id: chatSessions.id,
      userId: chatSessions.userId,
      characterId: chatSessions.characterId,
      title: chatSessions.title,
      modelTier: chatSessions.modelTier,
      mode: chatSessions.mode,
      status: chatSessions.status,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
      characterName: characters.name,
      userName: users.nickname,
    })
    .from(chatSessions)
    .leftJoin(characters, eq(chatSessions.characterId, characters.id))
    .leftJoin(users, eq(chatSessions.userId, users.id))
    .where(eq(chatSessions.id, id))
    .limit(1);

  if (!session) {
    throw new NotFoundError('Session');
  }

  return session;
}

/** Metadata plus the whole transcript: only for callers that explicitly need both. */
export async function getSessionDetail(id: string) {
  const session = await getSessionMetadata(id);
  const [messageRows, reviewRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        mood: messages.mood,
        modelTier: messages.modelTier,
        tokensUsed: messages.tokensUsed,
        pointsConsumed: messages.pointsConsumed,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.sessionId, id))
      .orderBy(asc(messages.createdAt)),
    db
      .select({
        id: reviewLogs.id,
        messageId: reviewLogs.messageId,
        reviewerId: reviewLogs.reviewerId,
        reviewerAdminAccountId: reviewLogs.reviewerAdminAccountId,
        status: reviewLogs.status,
        note: reviewLogs.note,
        createdAt: reviewLogs.createdAt,
        updatedAt: reviewLogs.updatedAt,
      })
      .from(reviewLogs)
      .where(eq(reviewLogs.sessionId, id))
      .orderBy(desc(reviewLogs.createdAt)),
  ]);

  return {
    ...session,
    messages: messageRows,
    reviewLogs: reviewRows,
  };
}
