import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { walletAccounts, walletTransactions } from '../../db/schema.js';

type WalletTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WalletAccount {
  id: string;
  userId: string;
  balancePoints: number;
  totalRechargedPoints: number;
  totalConsumedPoints: number;
}

export async function getOrCreateWallet(userId: string): Promise<WalletAccount> {
  const [existing] = await db
    .select()
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(walletAccounts)
    .values({ userId })
    .returning();

  if (!created) {
    throw new Error('Failed to create wallet account');
  }
  return created;
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

  const wallet = await tx
    .select()
    .from(walletAccounts)
    .where(eq(walletAccounts.userId, userId))
    .limit(1)
    .for('update');

  let account = wallet[0];
  if (!account) {
    const [created] = await tx
      .insert(walletAccounts)
      .values({ userId })
      .returning();

    if (!created) {
      throw new Error('Failed to create wallet account');
    }
    account = created;
  }

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
