import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { adminAuditLogs, adminSessions } from '../../db/schema.js';
import { ConflictError } from '../../http/error-types.js';

export type IdentityAdminActor =
  | { kind: 'admin_account'; adminAccountId: string }
  | { kind: 'legacy_user'; userId: string };
export type AdminActor = IdentityAdminActor
  | { kind: 'server_command' }
  | { kind: 'unauthenticated_request' };

export function auditActorColumns(actor: AdminActor) {
  return {
    actorSource: actor.kind,
    actorUserId: actor.kind === 'legacy_user' ? actor.userId : null,
    actorAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
  };
}

export function creatorColumns(actor: IdentityAdminActor) {
  return {
    createdBy: actor.kind === 'legacy_user' ? actor.userId : null,
    createdByAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
  };
}

export function matchesIdentityActor(actor: IdentityAdminActor, legacyId: string | null, accountId: string | null) {
  return actor.kind === 'legacy_user'
    ? actor.userId === legacyId && accountId === null
    : actor.adminAccountId === accountId && legacyId === null;
}

export type AdminAuditInput = {
  actor: AdminActor;
  action: string;
  objectType: string;
  objectId?: string;
  requestId?: string;
  taskId?: string;
  dedupeKey?: string;
  result: 'committed' | 'audit_pending' | 'failed' | 'unknown' | 'denied';
  summary?: Record<string, unknown>;
};

export type AuditTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AdminAuditRow = typeof adminAuditLogs.$inferSelect;

function auditValues(input: AdminAuditInput) {
  return {
    ...auditActorColumns(input.actor),
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    requestId: input.requestId ?? null,
    taskId: input.taskId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    result: input.result,
    summary: input.summary ?? null,
  };
}

export async function recordAdminAudit(input: AdminAuditInput): Promise<string> {
  return insertAdminAudit(db, input);
}

export async function recordAdminAuditInTransaction(
  tx: AuditTransactionClient,
  input: AdminAuditInput,
): Promise<string> {
  return insertAdminAudit(tx, input);
}

async function insertAdminAudit(
  client: Pick<AuditTransactionClient, 'insert' | 'select'>,
  input: AdminAuditInput,
): Promise<string> {
  if (input.dedupeKey) {
    const [row] = await client
      .insert(adminAuditLogs)
      .values(auditValues(input))
      .onConflictDoNothing({ target: adminAuditLogs.dedupeKey })
      .returning({ id: adminAuditLogs.id });
    if (row) return row.id;

    const existing = await findAdminAuditByDedupeKeyWith(client, input.dedupeKey);
    if (existing) return existing.id;
  } else {
    const [row] = await client
      .insert(adminAuditLogs)
      .values(auditValues(input))
      .returning({ id: adminAuditLogs.id });
    if (row) return row.id;
  }

  throw new Error('admin_audit_write_failed');
}

export async function finalizeAdminAudit(
  dedupeKey: string,
  input: { result?: 'committed' | 'failed' | 'unknown'; summary?: Record<string, unknown> } = {},
): Promise<void> {
  await finalizeAdminAuditInTransaction(db, dedupeKey, input);
}

export async function finalizeAdminAuditInTransaction(
  client: Pick<AuditTransactionClient, 'update'>,
  dedupeKey: string,
  input: { result?: 'committed' | 'failed' | 'unknown'; summary?: Record<string, unknown> } = {},
): Promise<void> {
  const [row] = await client
    .update(adminAuditLogs)
    .set({
      result: input.result ?? 'committed',
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
    })
    .where(eq(adminAuditLogs.dedupeKey, dedupeKey))
    .returning({ id: adminAuditLogs.id });
  if (!row) throw new Error('admin_audit_write_failed');
}

/**
 * Finalize-only recovery for an audit intent that was persisted before its business result could be
 * confirmed. It locks and validates the ORIGINAL intent against the persisted business result, flips
 * only that row to `committed`, and appends a recovery event under the actual current actor. The
 * original actor and summary are never rewritten and no business logic is re-run. Wallet adjustments,
 * script publishes and model publishes share this one implementation.
 */
export interface PendingAuditFinalization {
  dedupeKey: string;
  action: string;
  objectType: string;
  requestId?: string;
  recovery: { action: string; objectType: string; dedupeKeyPrefix: string };
  /** Runs under the original intent's lock; must lock the persisted result and refuse mismatches. */
  verify: (tx: AuditTransactionClient, audit: AdminAuditRow) => Promise<{ objectId: string; summary: Record<string, unknown> }>;
}

export interface PendingAuditFinalizeResult {
  auditId: string;
  alreadyFinalized: boolean;
}

export async function finalizePendingAdminAudit(
  actor: IdentityAdminActor,
  input: PendingAuditFinalization,
): Promise<PendingAuditFinalizeResult> {
  return db.transaction(async (tx) => {
    const conflict = () => new ConflictError('audit_recovery_conflict');
    const [audit] = await tx
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.dedupeKey, input.dedupeKey))
      .limit(1)
      .for('update');
    if (!audit || audit.action !== input.action || audit.objectType !== input.objectType) throw conflict();
    const verified = await input.verify(tx, audit);
    if (verified.objectId !== audit.objectId) throw conflict();
    if (audit.result !== 'audit_pending' && audit.result !== 'committed') throw conflict();
    if (audit.result === 'committed') return { auditId: audit.id, alreadyFinalized: true };

    const recoveryKey = `${input.recovery.dedupeKeyPrefix}:${audit.id}`;
    const [existingRecovery] = await tx
      .select({ id: adminAuditLogs.id })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.dedupeKey, recoveryKey))
      .limit(1);
    if (existingRecovery) throw conflict();
    // Original actor and business summary stay untouched; event + transition are atomic.
    await tx.update(adminAuditLogs).set({ result: 'committed' }).where(eq(adminAuditLogs.id, audit.id));
    await recordAdminAuditInTransaction(tx, {
      actor,
      action: input.recovery.action,
      objectType: input.recovery.objectType,
      objectId: verified.objectId,
      requestId: input.requestId,
      taskId: audit.taskId ?? undefined,
      dedupeKey: recoveryKey,
      result: 'committed',
      summary: verified.summary,
    });
    return { auditId: audit.id, alreadyFinalized: false };
  });
}

// Historical migration regression only; never an authentication mechanism.
export async function createAdminSession(input: {
  userId: string;
  provider: string;
  externalSubject: string;
  expiresAt: Date;
  stateHash?: string;
}) {
  const [row] = await db
    .insert(adminSessions)
    .values({
      userId: input.userId,
      provider: input.provider,
      externalSubject: input.externalSubject,
      expiresAt: input.expiresAt,
      stateHash: input.stateHash ?? null,
    })
    .onConflictDoUpdate({
      target: [adminSessions.provider, adminSessions.externalSubject],
      set: {
        userId: input.userId,
        expiresAt: input.expiresAt,
        stateHash: input.stateHash ?? null,
        lastSeenAt: new Date(),
      },
      setWhere: isNull(adminSessions.revokedAt),
    })
    .returning();
  if (!row) throw new Error('admin_session_revoked');
  return row;
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, sessionId));
}

export async function findAdminAuditByDedupeKey(dedupeKey: string) {
  return findAdminAuditByDedupeKeyWith(db, dedupeKey);
}

export async function listAdminAuditLogs(input: {
  dedupeKey?: string;
  result?: string;
  limit?: number;
}) {
  const conditions = [];
  if (input.dedupeKey) conditions.push(eq(adminAuditLogs.dedupeKey, input.dedupeKey));
  if (input.result) conditions.push(eq(adminAuditLogs.result, input.result));
  return db
    .select()
    .from(adminAuditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
}

async function findAdminAuditByDedupeKeyWith(
  client: Pick<AuditTransactionClient, 'select'>,
  dedupeKey: string,
) {
  const [row] = await client
    .select()
    .from(adminAuditLogs)
    .where(eq(adminAuditLogs.dedupeKey, dedupeKey))
    .limit(1);
  return row ?? null;
}
