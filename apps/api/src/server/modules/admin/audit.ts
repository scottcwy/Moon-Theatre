import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { adminAuditLogs, adminSessions, users } from '../../db/schema.js';

export type AdminAuditInput = {
  actorUserId: string;
  action: string;
  objectType: string;
  objectId?: string;
  requestId?: string;
  taskId?: string;
  result: 'committed' | 'audit_pending' | 'failed' | 'unknown' | 'denied';
  summary?: Record<string, unknown>;
};

export async function recordAdminAudit(input: AdminAuditInput): Promise<string> {
  const [row] = await db.insert(adminAuditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    requestId: input.requestId ?? null,
    taskId: input.taskId ?? null,
    result: input.result,
    summary: input.summary ?? null,
  }).returning({ id: adminAuditLogs.id });
  if (!row) throw new Error('admin_audit_write_failed');
  return row.id;
}

export async function createAdminSession(input: {
  userId: string;
  provider: string;
  externalSubject: string;
  expiresAt: Date;
  stateHash?: string;
}) {
  const [row] = await db.insert(adminSessions).values({
    userId: input.userId,
    provider: input.provider,
    externalSubject: input.externalSubject,
    expiresAt: input.expiresAt,
    stateHash: input.stateHash ?? null,
  }).returning();
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
