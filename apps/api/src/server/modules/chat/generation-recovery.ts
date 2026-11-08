import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  chatGenerationAttempts,
  chatSessions,
  chatTurnSnapshots,
  messages,
  walletTransactions,
} from '../../db/schema.js';
import { refundConsumedPointsInTransaction } from '../wallet/index.js';

type RecoveryTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface GenerationRecoveryItem {
  id: string;
  userMessageId: string | null;
  attempt: number | null;
  userId: string;
  sessionId: string;
  clientMessageId: string | null;
  generationStatus: string | null;
  generationAttempt: number;
  generationLeaseExpiresAt: Date | null;
  pointsPerCall: number | null;
  chargeStatus: string | null;
  chargeWalletTransactionId: string | null;
  refundStatus: string | null;
  refundWalletTransactionId: string | null;
  /** The content version pinned when the turn was accepted; `null` + `versionUnknown` for legacy
   *  turns that carry no snapshot (never inferred from the current character card). */
  contentVersionId: string | null;
  versionUnknown: boolean;
  updatedAt: Date;
}

export interface GenerationRecoveryResult {
  scanned: number;
  recovered: number;
  failed: number;
}

function unresolvedAttemptCondition() {
  const now = new Date();
  const recoveryWindowReached = or(
    eq(messages.generationStatus, 'failed'),
    and(
      eq(messages.generationStatus, 'generating'),
      or(
        lte(messages.generationLeaseExpiresAt, now),
        lt(chatGenerationAttempts.attempt, messages.generationAttempt),
      ),
    ),
  );
  return and(
    recoveryWindowReached,
    or(
      inArray(chatGenerationAttempts.chargeStatus, ['pending', 'unknown']),
      and(
        eq(chatGenerationAttempts.chargeStatus, 'succeeded'),
        inArray(chatGenerationAttempts.refundStatus, ['not_required', 'pending', 'unknown']),
      ),
      inArray(chatGenerationAttempts.refundStatus, ['pending', 'unknown']),
    ),
  );
}

export async function listUnresolvedGenerationAttempts(limit = 100): Promise<GenerationRecoveryItem[]> {
  const rows = await db
    .select({
      id: chatGenerationAttempts.id,
      userMessageId: chatGenerationAttempts.userMessageId,
      attempt: chatGenerationAttempts.attempt,
      userId: chatSessions.userId,
      sessionId: messages.sessionId,
      clientMessageId: messages.clientMessageId,
      generationStatus: messages.generationStatus,
      generationAttempt: messages.generationAttempt,
      generationLeaseExpiresAt: messages.generationLeaseExpiresAt,
      pointsPerCall: chatGenerationAttempts.pointsPerCall,
      chargeStatus: chatGenerationAttempts.chargeStatus,
      chargeWalletTransactionId: chatGenerationAttempts.chargeWalletTransactionId,
      refundStatus: chatGenerationAttempts.refundStatus,
      refundWalletTransactionId: chatGenerationAttempts.refundWalletTransactionId,
      contentVersionId: chatTurnSnapshots.contentVersionId,
      updatedAt: chatGenerationAttempts.updatedAt,
    })
    .from(chatGenerationAttempts)
    .innerJoin(messages, eq(chatGenerationAttempts.userMessageId, messages.id))
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .leftJoin(chatTurnSnapshots, eq(chatTurnSnapshots.userMessageId, chatGenerationAttempts.userMessageId))
    .where(unresolvedAttemptCondition())
    .limit(limit);
  return rows.map(({ contentVersionId, ...row }) => ({
    ...row,
    contentVersionId: contentVersionId ?? null,
    versionUnknown: contentVersionId == null,
  }));
}

/**
 * Reconciles every ambiguous attempt behind a per-attempt advisory lock.
 * Pending charges are considered only after the generation lease is no longer
 * active; committed turns keep their charge, while uncommitted turns use the
 * same deterministic refund key as the request path.
 */
export async function recoverGenerationAttempts(limit = 50): Promise<GenerationRecoveryResult> {
  const rows = await listUnresolvedGenerationAttempts(limit);
  let recovered = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.userMessageId === null || row.attempt === null) {
      failed += 1;
      continue;
    }

    try {
      const changed = await db.transaction(async (tx) => {
        const lockKey = `chat_attempt:${row.id}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const [current] = await tx
          .select({
            userMessageId: chatGenerationAttempts.userMessageId,
            attempt: chatGenerationAttempts.attempt,
            pointsPerCall: chatGenerationAttempts.pointsPerCall,
            chargeStatus: chatGenerationAttempts.chargeStatus,
            chargeWalletTransactionId: chatGenerationAttempts.chargeWalletTransactionId,
            refundStatus: chatGenerationAttempts.refundStatus,
            refundWalletTransactionId: chatGenerationAttempts.refundWalletTransactionId,
            userId: chatSessions.userId,
            sessionId: messages.sessionId,
            clientMessageId: messages.clientMessageId,
            generationStatus: messages.generationStatus,
            generationAttempt: messages.generationAttempt,
            generationLeaseExpiresAt: messages.generationLeaseExpiresAt,
          })
          .from(chatGenerationAttempts)
          .innerJoin(messages, eq(chatGenerationAttempts.userMessageId, messages.id))
          .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
          .where(eq(chatGenerationAttempts.id, row.id))
          .limit(1)
          .for('update');

        if (!current || current.userMessageId === null || current.attempt === null) {
          return false;
        }
        const currentAttemptIsActive =
          current.attempt === current.generationAttempt
          && current.generationStatus === 'generating'
          && current.generationLeaseExpiresAt
          && current.generationLeaseExpiresAt > new Date();
        if (currentAttemptIsActive) {
          return false;
        }

        const consumeKey = `consume_${current.userMessageId}_${current.attempt}`;
        const refundKey = `refund_${current.userMessageId}_${current.attempt}`;
        let chargeStatus = current.chargeStatus;

        if (chargeStatus === 'pending' || chargeStatus === 'unknown') {
          const consume = await findWalletTransaction(tx, consumeKey);
          if (consume) {
            chargeStatus = 'succeeded';
            await tx.update(chatGenerationAttempts).set({
              chargeStatus: 'succeeded',
              chargeWalletTransactionId: consume.id,
              lastError: null,
              updatedAt: new Date(),
            }).where(eq(chatGenerationAttempts.id, row.id));
          } else {
            chargeStatus = 'failed';
            await tx.update(chatGenerationAttempts).set({
              chargeStatus: 'failed',
              lastError: 'consume_not_committed',
              updatedAt: new Date(),
            }).where(eq(chatGenerationAttempts.id, row.id));
          }
        }

        const assistant = current.clientMessageId
          ? await tx
              .select({ id: messages.id })
              .from(messages)
              .where(and(
                eq(messages.sessionId, current.sessionId),
                eq(messages.role, 'assistant'),
                eq(messages.clientMessageId, current.clientMessageId),
              ))
              .limit(1)
          : [];
        const turnCommitted =
          assistant.length > 0;

        if (turnCommitted) {
          await tx.update(messages).set({
            generationStatus: 'completed',
            generationLeaseExpiresAt: null,
          }).where(eq(messages.id, current.userMessageId));
          return false;
        }

        if (chargeStatus !== 'succeeded' || !current.pointsPerCall || current.pointsPerCall <= 0) {
          await tx.update(chatGenerationAttempts).set({
            refundStatus: 'not_required',
            lastError: null,
            updatedAt: new Date(),
          }).where(eq(chatGenerationAttempts.id, row.id));
          return false;
        }

        const existingRefund = await findWalletTransaction(tx, refundKey);
        if (existingRefund) {
          await tx.update(chatGenerationAttempts).set({
            refundStatus: 'succeeded',
            refundWalletTransactionId: existingRefund.id,
            lastError: null,
            updatedAt: new Date(),
          }).where(eq(chatGenerationAttempts.id, row.id));
          return true;
        }

        const refund = await refundConsumedPointsInTransaction(
          tx,
          current.userId,
          current.pointsPerCall,
          refundKey,
        );
        await tx.update(chatGenerationAttempts).set({
          refundStatus: 'succeeded',
          refundWalletTransactionId: refund.transactionId,
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(chatGenerationAttempts.id, row.id));
        return true;
      });

      if (changed) recovered += 1;
    } catch (error) {
      failed += 1;
      await db.update(chatGenerationAttempts).set({
        refundStatus: 'unknown',
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      }).where(eq(chatGenerationAttempts.id, row.id)).catch(() => undefined);
      console.error({
        event: 'chat_generation_attempt_recovery_failed',
        attemptId: row.id,
        userMessageId: row.userMessageId,
        attempt: row.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: rows.length, recovered, failed };
}

async function findWalletTransaction(
  tx: RecoveryTransactionClient,
  idempotencyKey: string,
) {
  const [row] = await tx
    .select({
      id: walletTransactions.id,
      balanceAfter: walletTransactions.balanceAfter,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}
