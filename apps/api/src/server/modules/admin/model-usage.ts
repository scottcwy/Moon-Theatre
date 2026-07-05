import { eq, desc, and, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { modelUsageLogs, users, characters } from '../../db/schema.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';

type ModelTier = 'casual' | 'standard' | 'immersive';

export async function listModelUsageLogs(params: PaginationParams & { userId?: string; sessionId?: string; modelTier?: ModelTier }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(modelUsageLogs.userId, params.userId));
  if (params.sessionId) conditions.push(eq(modelUsageLogs.sessionId, params.sessionId));
  if (params.modelTier) conditions.push(eq(modelUsageLogs.modelTier, params.modelTier));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: modelUsageLogs.id,
        userId: modelUsageLogs.userId,
        characterId: modelUsageLogs.characterId,
        sessionId: modelUsageLogs.sessionId,
        modelTier: modelUsageLogs.modelTier,
        modelName: modelUsageLogs.modelName,
        inputTokens: modelUsageLogs.inputTokens,
        outputTokens: modelUsageLogs.outputTokens,
        costEstimateCents: modelUsageLogs.costEstimateCents,
        pointsConsumed: modelUsageLogs.pointsConsumed,
        walletTransactionId: modelUsageLogs.walletTransactionId,
        status: modelUsageLogs.status,
        createdAt: modelUsageLogs.createdAt,
        userName: users.nickname,
        characterName: characters.name,
      })
      .from(modelUsageLogs)
      .leftJoin(users, eq(modelUsageLogs.userId, users.id))
      .leftJoin(characters, eq(modelUsageLogs.characterId, characters.id))
      .where(where)
      .orderBy(desc(modelUsageLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(modelUsageLogs)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}
