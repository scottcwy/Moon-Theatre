import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { adminAuditLogs, adminSessions, users } from '../../db/schema.js';

export type AdminAuditInput = {
  actorUserId: string;
  action: string;
  objectType: string;
  objectId?: string;
  requestId?: string;
  taskId?: string;
  dedupeKey?: string;
  result: 'committed' | 'audit_pending' | 'failed' | 'unknown' | 'denied';
  summary?: Record<string, unknown>;
};

type AuditTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

function auditValues(input: AdminAuditInput) {
  return {
    actorUserId: input.actorUserId,
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
        revokedAt: null,
        lastSeenAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('admin_session_create_failed');
  return row;
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, sessionId));
}

export async function resolveAdminSession(sessionId: string): Promise<{ userId: string } | null> {
  const [row] = await db.select({
    userId: adminSessions.userId,
    userStatus: users.status,
    expiresAt: adminSessions.expiresAt,
    revokedAt: adminSessions.revokedAt,
  }).from(adminSessions).innerJoin(users, eq(users.id, adminSessions.userId))
    .where(eq(adminSessions.id, sessionId)).limit(1);
  if (!row || row.revokedAt || row.expiresAt <= new Date() || row.userStatus !== 'active') return null;
  await db.update(adminSessions).set({ lastSeenAt: new Date() }).where(eq(adminSessions.id, sessionId));
  return { userId: row.userId };
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
