import { eq, desc, asc, and, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  chatSessions,
  messages,
  reviewLogs,
  orders,
  payments,
  walletAccounts,
  walletTransactions,
  quotaPackages,
  modelUsageLogs,
  blockedKeywords,
  users,
  characters,
} from '../../db/schema.js';

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizePagination(params: PaginationParams): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

export async function listSessions(params: PaginationParams & { userId?: string; status?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(chatSessions.userId, params.userId));
  if (params.status) conditions.push(eq(chatSessions.status, params.status as 'active' | 'archived'));

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

export async function createReview(input: {
  sessionId: string;
  messageId?: string;
  reviewerId?: string;
  status: 'normal' | 'flagged' | 'resolved';
  note?: string;
}) {
  const [row] = await db
    .insert(reviewLogs)
    .values({
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      reviewerId: input.reviewerId ?? 'admin',
      status: input.status,
      note: input.note ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create review log');
  }
  return row;
}

export async function listOrders(params: PaginationParams & { userId?: string; status?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(orders.userId, params.userId));
  if (params.status) conditions.push(eq(orders.status, params.status as 'created' | 'prepay_created' | 'paid' | 'credited' | 'closed' | 'failed' | 'refunded'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: orders.id,
        userId: orders.userId,
        quotaPackageId: orders.quotaPackageId,
        amountCents: orders.amountCents,
        pointsAmount: orders.pointsAmount,
        status: orders.status,
        merchantOrderNo: orders.merchantOrderNo,
        providerTransactionId: orders.providerTransactionId,
        paidAt: orders.paidAt,
        creditedAt: orders.creditedAt,
        createdAt: orders.createdAt,
        userName: users.nickname,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(orders)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function listPayments(params: PaginationParams & { orderId?: string; status?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.orderId) conditions.push(eq(payments.orderId, params.orderId));
  if (params.status) conditions.push(eq(payments.status, params.status as 'pending' | 'success' | 'failed' | 'cancelled'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        provider: payments.provider,
        providerTransactionId: payments.providerTransactionId,
        prepayParams: payments.prepayParams,
        verifyResult: payments.verifyResult,
        status: payments.status,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(payments)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function listWalletTransactions(params: PaginationParams & { userId?: string; type?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(walletTransactions.userId, params.userId));
  if (params.type) conditions.push(eq(walletTransactions.type, params.type as 'recharge' | 'consume' | 'adjust'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: walletTransactions.id,
        userId: walletTransactions.userId,
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
        orderId: walletTransactions.orderId,
        modelUsageLogId: walletTransactions.modelUsageLogId,
        idempotencyKey: walletTransactions.idempotencyKey,
        description: walletTransactions.description,
        createdAt: walletTransactions.createdAt,
        userName: users.nickname,
      })
      .from(walletTransactions)
      .leftJoin(users, eq(walletTransactions.userId, users.id))
      .where(where)
      .orderBy(desc(walletTransactions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(walletTransactions)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function listWalletAccounts(params: PaginationParams & { userId?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const where = params.userId ? eq(walletAccounts.userId, params.userId) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: walletAccounts.id,
        userId: walletAccounts.userId,
        balancePoints: walletAccounts.balancePoints,
        totalRechargedPoints: walletAccounts.totalRechargedPoints,
        totalConsumedPoints: walletAccounts.totalConsumedPoints,
        createdAt: walletAccounts.createdAt,
        updatedAt: walletAccounts.updatedAt,
        userName: users.nickname,
      })
      .from(walletAccounts)
      .leftJoin(users, eq(walletAccounts.userId, users.id))
      .where(where)
      .orderBy(desc(walletAccounts.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(walletAccounts)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}

export async function listQuotaPackages(): Promise<unknown[]> {
  return db
    .select()
    .from(quotaPackages)
    .orderBy(asc(quotaPackages.sortOrder));
}

export async function updateQuotaPackage(id: string, updates: {
  name?: string;
  priceCents?: number;
  points?: number;
  description?: string;
  recommended?: boolean;
  active?: boolean;
  sortOrder?: number;
}) {
  const [row] = await db
    .update(quotaPackages)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(quotaPackages.id, id))
    .returning();

  if (!row) {
    throw new Error('Quota package not found');
  }
  return row;
}

export async function listModelUsageLogs(params: PaginationParams & { userId?: string; sessionId?: string; modelTier?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(modelUsageLogs.userId, params.userId));
  if (params.sessionId) conditions.push(eq(modelUsageLogs.sessionId, params.sessionId));
  if (params.modelTier) conditions.push(eq(modelUsageLogs.modelTier, params.modelTier as 'casual' | 'standard' | 'immersive'));

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

export async function listBlockedKeywords(): Promise<unknown[]> {
  return db
    .select()
    .from(blockedKeywords)
    .orderBy(desc(blockedKeywords.createdAt));
}

export async function createBlockedKeyword(input: { keyword: string; category?: string }) {
  const [row] = await db
    .insert(blockedKeywords)
    .values({
      keyword: input.keyword,
      category: input.category ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create blocked keyword');
  }
  return row;
}

export async function listReviewLogs(params: PaginationParams & { sessionId?: string; status?: string }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.sessionId) conditions.push(eq(reviewLogs.sessionId, params.sessionId));
  if (params.status) conditions.push(eq(reviewLogs.status, params.status as 'normal' | 'flagged' | 'resolved'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(reviewLogs)
      .where(where)
      .orderBy(desc(reviewLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(reviewLogs)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.total ?? 0, page, pageSize };
}
