import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { walletAccounts, walletTransactions } from '../../db/schema.js';
import { recordAdminAuditInTransaction, matchesIdentityActor, type IdentityAdminActor } from '../admin/audit.js';

type WalletTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WalletAccount {
  id: string;
  userId: string;
  balancePoints: number;
  totalRechargedPoints: number;
  totalConsumedPoints: number;
}

async function getOrCreateWalletForUpdate(
  tx: WalletTransactionClient,
  userId: string,
): Promise<WalletAccount> {
  const [created] = await tx
    .insert(walletAccounts)
    .values({ userId })
    .onConflictDoNothing({ target: walletAccounts.userId })
    .returning();

  if (created) {
    return created;
  }

  const [existing] = await tx
    .select()
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId))
    .limit(1)
    .for('update');

  if (!existing) {
    throw new Error('Failed to create wallet account');
  }
  return existing;
}

export async function getOrCreateWallet(userId: string): Promise<WalletAccount> {
  return db.transaction((tx) => getOrCreateWalletForUpdate(tx, userId));
}

export async function getBalance(userId: string): Promise<number> {
  const wallet = await getOrCreateWallet(userId);
  return wallet.balancePoints;
}

export interface CreditResult {
  transactionId: string;
  balanceAfter: number;
  alreadyCredited: boolean;
}

/**
 * Credits points to the user's wallet with idempotency protection.
 * If a transaction with the same idempotencyKey already exists, returns the existing result.
 */
export async function creditWallet(
  userId: string,
  amount: number,
  idempotencyKey: string,
  orderId?: string,
): Promise<CreditResult> {
  if (amount <= 0) {
    throw new Error('Credit amount must be positive');
  }

  return db.transaction((tx) => creditWalletInTransaction(tx, userId, amount, idempotencyKey, orderId));
}

export async function creditWalletInTransaction(
  tx: WalletTransactionClient,
  userId: string,
  amount: number,
  idempotencyKey: string,
  orderId?: string,
): Promise<CreditResult> {
  if (amount <= 0) {
    throw new Error('Credit amount must be positive');
  }

  const [existingTx] = await tx
    .select({ id: walletTransactions.id, balanceAfter: walletTransactions.balanceAfter })
    .from(walletTransactions)
    .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingTx) {
    return {
      transactionId: existingTx.id,
      balanceAfter: existingTx.balanceAfter,
      alreadyCredited: true,
    };
  }

  const account = await getOrCreateWalletForUpdate(tx, userId);

  const newBalance = account.balancePoints + amount;
  const newRecharged = account.totalRechargedPoints + amount;

  await tx
    .update(walletAccounts)
    .set({
      balancePoints: newBalance,
      totalRechargedPoints: newRecharged,
      updatedAt: new Date(),
    })
    .where(eq(walletAccounts.id, account.id));

  const [txRow] = await tx
    .insert(walletTransactions)
    .values({
      userId,
      type: 'recharge',
      amount,
      balanceAfter: newBalance,
      orderId: orderId ?? null,
      idempotencyKey,
      description: `Recharged ${amount} points`,
    })
    .returning({ id: walletTransactions.id });

  if (!txRow) {
    throw new Error('Failed to create wallet transaction');
  }

  return {
    transactionId: txRow.id,
    balanceAfter: newBalance,
    alreadyCredited: false,
  };
}

export interface ConsumeResult {
  transactionId: string;
  balanceAfter: number;
  alreadyConsumed: boolean;
}

export interface RefundResult {
  transactionId: string;
  balanceAfter: number;
  alreadyRefunded: boolean;
}

export interface AdjustmentResult {
  transactionId: string;
  balanceAfter: number;
  alreadyAdjusted: boolean;
}

export class WalletAdjustmentConflictError extends Error {
  readonly code = 'idempotency_conflict';

  constructor() {
    super('Idempotency key was already used with different adjustment parameters');
    this.name = 'WalletAdjustmentConflictError';
  }
}

/**
 * Applies a signed administrator adjustment as one atomic wallet transaction.
 * The idempotency key is global to wallet transactions; a matching replay returns
 * the original result, while reusing it with any changed parameter is rejected.
 */
export async function adjustWalletPoints(
  userId: string,
  delta: number,
  idempotencyKey: string,
  reason: string,
  actor: IdentityAdminActor,
  audit?: {
    requestId?: string;
    dedupeKey: string;
  },
): Promise<AdjustmentResult> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('Adjustment delta must be a non-zero integer');
  }
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('Adjustment reason is required');
  }
  if (!idempotencyKey.trim()) {
    throw new Error('Idempotency key is required');
  }

  return db.transaction(async (tx) => {
    const recordIntent = async (result: AdjustmentResult) => {
      if (!audit) return;
      await recordAdminAuditInTransaction(tx, {
        actor,
        action: 'admin.wallet.adjust',
        objectType: 'wallet_transaction',
        objectId: result.transactionId,
        requestId: audit.requestId,
        dedupeKey: audit.dedupeKey,
        result: 'audit_pending',
        summary: {
          idempotencyKey,
          userId,
          delta,
          reason: normalizedReason,
          balanceAfter: result.balanceAfter,
          alreadyApplied: result.alreadyAdjusted,
        },
      });
    };
    const execute = (tx as unknown as { execute?: (query: unknown) => Promise<unknown> }).execute;
    if (execute) {
      await execute.call(tx, sql`select pg_advisory_xact_lock(hashtext(${idempotencyKey}))`);
    }

    const findExisting = async () => {
      const [row] = await tx
        .select({
          id: walletTransactions.id,
          userId: walletTransactions.userId,
          amount: walletTransactions.amount,
          balanceAfter: walletTransactions.balanceAfter,
          adminUserId: walletTransactions.adminUserId,
          adminAccountId: walletTransactions.adminAccountId,
          adjustmentReason: walletTransactions.adjustmentReason,
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
        .limit(1);
      return row;
    };

    const existing = await findExisting();
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.amount !== delta ||
        !matchesIdentityActor(actor, existing.adminUserId, existing.adminAccountId) ||
        existing.adjustmentReason !== normalizedReason
      ) {
        throw new WalletAdjustmentConflictError();
      }
      const result = {
        transactionId: existing.id,
        balanceAfter: existing.balanceAfter,
        alreadyAdjusted: true,
      };
      await recordIntent(result);
      return result;
    }

    const walletRows = await tx
      .select()
      .from(walletAccounts)
      .where(eq(walletAccounts.userId, userId))
      .limit(1)
      .for('update');

    let account = walletRows[0];
    if (!account) {
      if (delta < 0) {
        throw new Error('Wallet account not found');
      }
      const [created] = await tx
        .insert(walletAccounts)
        .values({ userId })
        .onConflictDoNothing({ target: walletAccounts.userId })
        .returning();
      if (created) {
        account = created;
      } else {
        // Another transaction created the account while this one was waiting
        // on the unique key. Lock and read its current balance before applying.
        const [existingAccount] = await tx
          .select()
          .from(walletAccounts)
          .where(eq(walletAccounts.userId, userId))
          .limit(1)
          .for('update');
        if (!existingAccount) throw new Error('Failed to create wallet account');
        account = existingAccount;
      }
    }

    // Recheck after locking the account so a concurrent replay on the same
    // user cannot create a second adjustment.
    const concurrent = await findExisting();
    if (concurrent) {
      if (
        concurrent.userId !== userId ||
        concurrent.amount !== delta ||
        !matchesIdentityActor(actor, concurrent.adminUserId, concurrent.adminAccountId) ||
        concurrent.adjustmentReason !== normalizedReason
      ) {
        throw new WalletAdjustmentConflictError();
      }
      const result = {
        transactionId: concurrent.id,
        balanceAfter: concurrent.balanceAfter,
        alreadyAdjusted: true,
      };
      await recordIntent(result);
      return result;
    }

    const newBalance = account.balancePoints + delta;
    if (newBalance < 0) {
      throw new Error('Insufficient balance');
    }

    const now = new Date();
    await tx
      .update(walletAccounts)
      .set({ balancePoints: newBalance, updatedAt: now })
      .where(eq(walletAccounts.id, account.id));

    const [txRow] = await tx
      .insert(walletTransactions)
      .values({
        userId,
        type: 'adjust',
        amount: delta,
        balanceAfter: newBalance,
        idempotencyKey,
        description: normalizedReason,
        adminUserId: actor.kind === 'legacy_user' ? actor.userId : null,
        adminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
        adjustmentReason: normalizedReason,
      })
      .returning({ id: walletTransactions.id });

    if (!txRow) throw new Error('Failed to create wallet adjustment transaction');
    const result = { transactionId: txRow.id, balanceAfter: newBalance, alreadyAdjusted: false };
    await recordIntent(result);
    return result;
  });
}

/**
 * Deducts points from the user's wallet with idempotency protection.
 * If a transaction with the same idempotencyKey already exists, returns the existing result.
 */
export async function consumePoints(
  userId: string,
  amount: number,
  idempotencyKey: string,
  modelUsageLogId?: string,
): Promise<ConsumeResult> {
  if (amount <= 0) {
    throw new Error('Consume amount must be positive');
  }

  return db.transaction(async (tx) => {
    const [existingTx] = await tx
      .select({ id: walletTransactions.id, balanceAfter: walletTransactions.balanceAfter })
      .from(walletTransactions)
      .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existingTx) {
      return {
        transactionId: existingTx.id,
        balanceAfter: existingTx.balanceAfter,
        alreadyConsumed: true,
      };
    }

    const wallet = await tx
      .select()
      .from(walletAccounts)
      .where(eq(walletAccounts.userId, userId))
      .limit(1)
      .for('update');

    const account = wallet[0];
    if (!account) {
      throw new Error('Wallet account not found');
    }

    if (account.balancePoints < amount) {
      throw new Error('Insufficient balance');
    }

    const newBalance = account.balancePoints - amount;
    const newConsumed = account.totalConsumedPoints + amount;

    await tx
      .update(walletAccounts)
      .set({
        balancePoints: newBalance,
        totalConsumedPoints: newConsumed,
        updatedAt: new Date(),
      })
      .where(eq(walletAccounts.id, account.id));

    const [txRow] = await tx
      .insert(walletTransactions)
      .values({
        userId,
        type: 'consume',
        amount,
        balanceAfter: newBalance,
        modelUsageLogId: modelUsageLogId ?? null,
        idempotencyKey,
        description: `Consumed ${amount} points`,
      })
      .returning({ id: walletTransactions.id });

    if (!txRow) {
      throw new Error('Failed to create wallet transaction');
    }

    return {
      transactionId: txRow.id,
      balanceAfter: newBalance,
      alreadyConsumed: false,
    };
  });
}

export async function refundConsumedPoints(
  userId: string,
  amount: number,
  idempotencyKey: string,
  modelUsageLogId?: string,
): Promise<RefundResult> {
  return db.transaction((tx) =>
    refundConsumedPointsInTransaction(tx, userId, amount, idempotencyKey, modelUsageLogId));
}

export async function refundConsumedPointsInTransaction(
  tx: WalletTransactionClient,
  userId: string,
  amount: number,
  idempotencyKey: string,
  modelUsageLogId?: string,
): Promise<RefundResult> {
  if (amount <= 0) {
    throw new Error('Refund amount must be positive');
  }

  const [existingTx] = await tx
    .select({ id: walletTransactions.id, balanceAfter: walletTransactions.balanceAfter })
    .from(walletTransactions)
    .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingTx) {
    return {
      transactionId: existingTx.id,
      balanceAfter: existingTx.balanceAfter,
      alreadyRefunded: true,
    };
  }

  const wallet = await tx
    .select()
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId))
    .limit(1)
    .for('update');

  const account = wallet[0];
  if (!account) {
    throw new Error('Wallet account not found');
  }

  const newBalance = account.balancePoints + amount;
  const newConsumed = Math.max(0, account.totalConsumedPoints - amount);

  await tx
    .update(walletAccounts)
    .set({
      balancePoints: newBalance,
      totalConsumedPoints: newConsumed,
      updatedAt: new Date(),
    })
    .where(eq(walletAccounts.id, account.id));

  const [txRow] = await tx
    .insert(walletTransactions)
    .values({
      userId,
      type: 'adjust',
      amount,
      balanceAfter: newBalance,
      modelUsageLogId: modelUsageLogId ?? null,
      idempotencyKey,
      description: `Refunded ${amount} consumed points`,
    })
    .returning({ id: walletTransactions.id });

  if (!txRow) {
    throw new Error('Failed to create wallet refund transaction');
  }

  return {
    transactionId: txRow.id,
    balanceAfter: newBalance,
    alreadyRefunded: false,
  };
}
