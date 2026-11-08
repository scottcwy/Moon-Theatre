import { eq, ne, desc, asc, and, count, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { orders, payments, walletAccounts, walletTransactions, quotaPackages, users } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError, formatZodIssues } from '../../http/errors.js';
import { QUOTA_PACKAGE_DESCRIPTION_MAX, QUOTA_PACKAGE_NAME_MAX } from './quota-package-limits.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';
import { findAdminAuditByDedupeKey, finalizePendingAdminAudit, recordAdminAuditInTransaction, matchesIdentityActor, type IdentityAdminActor } from './audit.js';

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
      active: payments.active,
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
        active: payments.active,
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
      active: payments.active,
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
        adminUserId: walletTransactions.adminUserId,
        adminAccountId: walletTransactions.adminAccountId,
        adjustmentReason: walletTransactions.adjustmentReason,
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

export const QUOTA_PACKAGE_NAME_CONFLICT = 'quota_package_name_conflict';
export { QUOTA_PACKAGE_NAME_MAX, QUOTA_PACKAGE_DESCRIPTION_MAX } from './quota-package-limits.js';

/**
 * Package maintenance bodies (AC-13). The schema column is `price_cents`, so the API keeps the
 * existing `priceCents` name: integer cents, never a yuan float. Points are positive integers and a
 * zero price is allowed (a free package). Unknown keys are refused — a client `actor` or an
 * order-shaped field is a 400 before any write. `description` is nullable because the console's
 * "clear 说明" path sends `null`; `null` and `''` both clear the column. The DB has no unique index on
 * `name`, so the naming rule is checked case-insensitively inside the mutation transaction, under an
 * advisory lock, and reported as a conflict.
 */
export const quotaPackageInputSchema = z.object({
  name: z.string().trim()
    .min(1, '套餐名称不能为空')
    .max(QUOTA_PACKAGE_NAME_MAX, `套餐名称最多 ${QUOTA_PACKAGE_NAME_MAX} 个字符`),
  priceCents: z.number().int('价格须为整数分').min(0, '价格不能为负数'),
  points: z.number().int('点数须为整数').min(1, '点数须为正整数'),
  description: z.string().trim()
    .max(QUOTA_PACKAGE_DESCRIPTION_MAX, `说明最多 ${QUOTA_PACKAGE_DESCRIPTION_MAX} 个字符`)
    .nullable()
    .optional(),
  recommended: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int('排序须为整数').min(0, '排序不能为负数').optional(),
}).strict();

export const quotaPackageUpdateSchema = quotaPackageInputSchema.partial().strict();

export type QuotaPackageInput = z.infer<typeof quotaPackageInputSchema>;
export type QuotaPackageUpdate = z.infer<typeof quotaPackageUpdateSchema>;
export type AdminQuotaPackage = typeof quotaPackages.$inferSelect;

export interface QuotaPackageMutation {
  package: AdminQuotaPackage;
  /** False when the patch equalled the stored row: nothing was written and no audit row was added. */
  changed: boolean;
  auditId: string | null;
}

type BillingClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const QUOTA_PACKAGE_FIELDS = ['name', 'priceCents', 'points', 'description', 'recommended', 'active', 'sortOrder'] as const;
type QuotaPackageField = typeof QUOTA_PACKAGE_FIELDS[number];

function parseQuotaPackageInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues));
  return parsed.data;
}

function requireQuotaPackageId(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new ValidationError('admin_input_invalid');
  return id;
}

async function assertQuotaPackageNameAvailable(tx: BillingClient, name: string, exceptId?: string): Promise<void> {
  // The check is a read-then-write under READ COMMITTED, so without serialisation two concurrent
  // creates (or renames) of the same free name both see nothing and both commit. The transaction-scoped
  // advisory lock on the lower-cased name closes that window; the loser then sees the committed row.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${name})))`);
  const [row] = await tx
    .select({ id: quotaPackages.id })
    .from(quotaPackages)
    .where(and(
      sql`lower(${quotaPackages.name}) = lower(${name})`,
      exceptId ? ne(quotaPackages.id, exceptId) : undefined,
    ))
    .limit(1);
  if (row) throw new ConflictError(QUOTA_PACKAGE_NAME_CONFLICT);
}

/** Deterministic order for the console and the public list: `sort_order`, then the row id. */
export async function listQuotaPackages(): Promise<AdminQuotaPackage[]> {
  return db
    .select()
    .from(quotaPackages)
    .orderBy(asc(quotaPackages.sortOrder), asc(quotaPackages.id));
}

/** Creates one package and appends its audit event in the same transaction. There is no hard delete. */
export async function createQuotaPackage(
  input: QuotaPackageInput,
  audit: { actor: IdentityAdminActor; requestId?: string },
): Promise<QuotaPackageMutation> {
  const values = parseQuotaPackageInput(quotaPackageInputSchema, input);
  return db.transaction(async (tx) => {
    await assertQuotaPackageNameAvailable(tx, values.name);
    const [row] = await tx.insert(quotaPackages).values({
      name: values.name,
      priceCents: values.priceCents,
      points: values.points,
      description: values.description ? values.description : null,
      recommended: values.recommended ?? false,
      active: values.active ?? true,
      sortOrder: values.sortOrder ?? 0,
    }).returning();
    if (!row) throw new Error('Failed to create quota package');

    const auditId = await recordAdminAuditInTransaction(tx, {
      actor: audit.actor,
      action: 'admin.quota_package.create',
      objectType: 'quota_package',
      objectId: row.id,
      requestId: audit.requestId,
      result: 'committed',
      summary: {
        name: row.name, priceCents: row.priceCents, points: row.points,
        recommended: row.recommended, active: row.active, sortOrder: row.sortOrder,
      },
    });
    return { package: row, changed: true, auditId };
  });
}

/**
 * Updates the editable fields (availability included — "archive" is `active:false`, never a delete).
 * A patch that equals the stored row writes nothing and adds no audit row. The audit summary records
 * the changed field names plus their previous and new values, under the real authenticated actor.
 */
export async function updateQuotaPackage(
  id: string,
  updates: QuotaPackageUpdate,
  audit?: { actor: IdentityAdminActor; requestId?: string },
): Promise<QuotaPackageMutation> {
  const packageId = requireQuotaPackageId(id);
  const values = parseQuotaPackageInput(quotaPackageUpdateSchema, updates);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(quotaPackages)
      .where(eq(quotaPackages.id, packageId))
      .limit(1)
      .for('update');
    if (!existing) throw new NotFoundError('Quota package');
    if (values.name !== undefined) await assertQuotaPackageNameAvailable(tx, values.name, packageId);

    const description = values.description === undefined ? undefined : (values.description || null);
    const next: Record<QuotaPackageField, unknown> = {
      name: values.name,
      priceCents: values.priceCents,
      points: values.points,
      description,
      recommended: values.recommended,
      active: values.active,
      sortOrder: values.sortOrder,
    };
    const changedFields = QUOTA_PACKAGE_FIELDS.filter((field) => next[field] !== undefined && next[field] !== existing[field]);
    if (changedFields.length === 0) {
      return { package: existing, changed: false, auditId: null };
    }

    const patch: Record<string, unknown> = {};
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    for (const field of changedFields) {
      patch[field] = next[field];
      from[field] = existing[field];
      to[field] = next[field];
    }
    const [row] = await tx
      .update(quotaPackages)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(quotaPackages.id, packageId))
      .returning();
    if (!row) throw new NotFoundError('Quota package');

    let auditId: string | null = null;
    if (audit) {
      auditId = await recordAdminAuditInTransaction(tx, {
        actor: audit.actor,
        action: 'admin.quota_package.update',
        objectType: 'quota_package',
        objectId: packageId,
        requestId: audit.requestId,
        result: 'committed',
        summary: { changedFields, from, to },
      });
    }
    return { package: row, changed: true, auditId };
  });
}

export async function getWalletAdjustmentStatus(idempotencyKey: string) {
  const [transaction] = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!transaction) {
    throw new NotFoundError('Wallet adjustment');
  }
  const audit = await findAdminAuditByDedupeKey(`wallet_adjustment:${idempotencyKey}`);
  return {
    transaction,
    audit,
    complete: audit?.result === 'committed',
  };
}

/** Finalizes an existing administrator intent only. Never changes wallet state. */
export async function finalizeWalletAdjustmentAudit(
  idempotencyKey: string,
  actor: IdentityAdminActor,
  requestId?: string,
): Promise<{ transactionId: string; balanceAfter: number; alreadyFinalized: boolean }> {
  let result: { transactionId: string; balanceAfter: number } | undefined;
  const outcome = await finalizePendingAdminAudit(actor, {
    dedupeKey: `wallet_adjustment:${idempotencyKey}`,
    action: 'admin.wallet.adjust',
    objectType: 'wallet_transaction',
    requestId,
    recovery: {
      action: 'admin.wallet.adjust.finalize_audit',
      objectType: 'wallet_transaction',
      dedupeKeyPrefix: 'wallet_adjustment_recovery',
    },
    verify: async (tx, audit) => {
      const conflict = () => new ConflictError('wallet_adjustment_audit_conflict');
      const [transaction] = await tx.select().from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey)).limit(1).for('update');
      if (!transaction || transaction.type !== 'adjust' ||
          (!transaction.adminUserId && !transaction.adminAccountId)) throw conflict();
      const originalActor: IdentityAdminActor = transaction.adminAccountId
        ? { kind: 'admin_account', adminAccountId: transaction.adminAccountId }
        : { kind: 'legacy_user', userId: transaction.adminUserId! };
      const summary = audit.summary as Record<string, unknown> | null;
      if (audit.actorSource !== originalActor.kind ||
          !matchesIdentityActor(originalActor, audit.actorUserId, audit.actorAdminAccountId) ||
          !summary || summary.idempotencyKey !== idempotencyKey || summary.userId !== transaction.userId ||
          summary.delta !== transaction.amount || transaction.amount === 0 ||
          !transaction.adjustmentReason || summary.reason !== transaction.adjustmentReason ||
          summary.balanceAfter !== transaction.balanceAfter) throw conflict();
      result = { transactionId: transaction.id, balanceAfter: transaction.balanceAfter };
      return { objectId: transaction.id, summary: { originalAuditId: audit.id, transactionId: transaction.id } };
    },
  });
  if (!result) throw new ConflictError('wallet_adjustment_audit_conflict');
  return { ...result, alreadyFinalized: outcome.alreadyFinalized };
}
