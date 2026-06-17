import { eq, desc, asc, and, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { chatSessions, messages, reviewLogs, users, characters } from '../../db/schema.js';
import { NotFoundError } from '../../http/errors.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';

type SessionStatus = 'active' | 'archived';

export async function listSessions(params: PaginationParams & { userId?: string; status?: SessionStatus }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(chatSessions.userId, params.userId));
  if (params.status) conditions.push(eq(chatSessions.status, params.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        characterId: chatSessions.characterId,
        title: chatSessions.title,
        modelTier: chatSessions.modelTier,
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
      .orderBy(desc(chatSessions.updatedAt))
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
      .orderBy(asc(messages.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(messages)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function getSessionDetail(id: string) {
  const [session] = await db
    .select({
      id: chatSessions.id,
      userId: chatSessions.userId,
      characterId: chatSessions.characterId,
      title: chatSessions.title,
      modelTier: chatSessions.modelTier,
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
