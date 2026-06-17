import { eq, desc, asc, and, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { orders, payments, walletAccounts, walletTransactions, quotaPackages, users } from '../../db/schema.js';
import { NotFoundError } from '../../http/errors.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';

type OrderStatus = 'created' | 'prepay_created' | 'paid' | 'credited' | 'closed' | 'failed' | 'refunded';
type PaymentStatus = 'pending' | 'success' | 'failed' | 'cancelled';
type WalletTransactionType = 'recharge' | 'consume' | 'adjust';

export async function listOrders(params: PaginationParams & { userId?: string; status?: OrderStatus }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(orders.userId, params.userId));
  if (params.status) conditions.push(eq(orders.status, params.status));

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

export async function getOrderDetail(id: string) {
  const [order] = await db
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
      updatedAt: orders.updatedAt,
      userName: users.nickname,
      quotaPackageName: quotaPackages.name,
      quotaPackagePoints: quotaPackages.points,
    })
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .leftJoin(quotaPackages, eq(orders.quotaPackageId, quotaPackages.id))
    .where(eq(orders.id, id))
    .limit(1);

  if (!order) {
    throw new NotFoundError('Order');
  }

  const paymentRows = await db
    .select({
      id: payments.id,
      provider: payments.provider,
      providerTransactionId: payments.providerTransactionId,
      verifyResult: payments.verifyResult,
      status: payments.status,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .where(eq(payments.orderId, id))
    .orderBy(desc(payments.createdAt));

  const walletTransactionRows = await db
    .select({
      id: walletTransactions.id,
      type: walletTransactions.type,
      amount: walletTransactions.amount,
      balanceAfter: walletTransactions.balanceAfter,
      idempotencyKey: walletTransactions.idempotencyKey,
      description: walletTransactions.description,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.orderId, id))
    .orderBy(desc(walletTransactions.createdAt));

  return {
    ...order,
    payments: paymentRows,
    walletTransactions: walletTransactionRows,
  };
}

export async function listPayments(params: PaginationParams & { orderId?: string; status?: PaymentStatus }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.orderId) conditions.push(eq(payments.orderId, params.orderId));
  if (params.status) conditions.push(eq(payments.status, params.status));

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

export async function getPaymentDetail(id: string) {
  const [payment] = await db
    .select({
      id: payments.id,
      orderId: payments.orderId,
      provider: payments.provider,
      providerTransactionId: payments.providerTransactionId,
      prepayParams: payments.prepayParams,
      callbackRawDigest: payments.callbackRawDigest,
      verifyResult: payments.verifyResult,
      status: payments.status,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
      orderMerchantOrderNo: orders.merchantOrderNo,
      orderAmountCents: orders.amountCents,
      orderStatus: orders.status,
      userId: orders.userId,
      userName: users.nickname,
    })
    .from(payments)
    .leftJoin(orders, eq(payments.orderId, orders.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .where(eq(payments.id, id))
    .limit(1);

  if (!payment) {
    throw new NotFoundError('Payment');
  }

  return payment;
}

export async function listWalletTransactions(params: PaginationParams & { userId?: string; type?: WalletTransactionType }): Promise<PaginatedResult<unknown>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  if (params.userId) conditions.push(eq(walletTransactions.userId, params.userId));
  if (params.type) conditions.push(eq(walletTransactions.type, params.type));

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
    throw new NotFoundError('Quota package');
  }
  return row;
}
