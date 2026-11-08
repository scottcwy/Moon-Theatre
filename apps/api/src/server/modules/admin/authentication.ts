import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { adminAccounts, adminSessions } from '../../db/schema.js';
import { HttpError } from '../../http/errors.js';
import { recordAdminAudit, recordAdminAuditInTransaction } from './audit.js';
import { adminEmailSchema, adminTransaction, lockAdminAccounts, safeAdminAccount, validateAdminActor } from './accounts.js';
import type { SafeAdminAccount } from './accounts.js';
import { DUMMY_PASSWORD_HASH, verifyAdminPassword } from './passwords.js';
import { budgetDigest, consumeAdminLoginBudget } from './security.js';

export type AdminIdentity = {
  adminAccountId: string;
  credentialVersion: number;
  sessionId: string;
  expiresAt: Date;
  account: SafeAdminAccount;
};
export const adminLoginSchema = z.object({ email: adminEmailSchema, password: z.string().max(512) }).strict();
export function adminTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export async function loginAdmin(input: { email: string; password: string; clientIp: string }): Promise<{ token: string; identity: AdminIdentity }> {
  const parsed = adminLoginSchema.safeParse({ email: input.email, password: input.password });
  if (!parsed.success) throw new HttpError('admin_input_invalid', 400);
  const { email, password } = parsed.data;
  await consumeAdminLoginBudget(email, input.clientIp);
  let snapshot: typeof adminAccounts.$inferSelect | undefined;
  try { [snapshot] = await db.select().from(adminAccounts).where(eq(adminAccounts.email, email)).limit(1); }
  catch { throw new HttpError('admin_dependency_unavailable', 503); }
  const valid = await verifyAdminPassword(password, snapshot?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!snapshot || !valid || !snapshot.active) {
    try { await recordAdminAudit({ actor: { kind: 'unauthenticated_request' }, action: 'admin.session.login_denied',
      objectType: 'admin_session', result: 'denied', summary: { emailDigest: budgetDigest(email) } }); }
    catch { throw new HttpError('admin_audit_unavailable', 503); }
    throw new HttpError('admin_login_failed', 401);
  }
  return adminTransaction(async tx => {
    const [row] = await lockAdminAccounts(tx, [snapshot.id]);
    if (!row?.active || row.credentialVersion !== snapshot.credentialVersion || row.passwordHash !== snapshot.passwordHash || row.email !== email)
      throw new HttpError('admin_login_failed', 401);
    const token = randomBytes(32).toString('hex');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 8 * 3600000);
    const [session] = await tx.insert(adminSessions).values({ adminAccountId: row.id, credentialVersion: row.credentialVersion,
      createdAt, provider: 'password', externalSubject: randomUUID(), tokenHash: adminTokenHash(token), expiresAt }).returning();
    await recordAdminAuditInTransaction(tx, { actor: { kind: 'admin_account', adminAccountId: row.id }, action: 'admin.session.login',
      objectType: 'admin_session', objectId: session!.id, result: 'committed' });
    return { token, identity: { adminAccountId: row.id, credentialVersion: row.credentialVersion, sessionId: session!.id, expiresAt, account: safeAdminAccount(row) } };
  });
}
export async function resolveAdminToken(token: string | undefined, options: { allowRestricted?: boolean } = {}): Promise<AdminIdentity | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  try {
    const [result] = await db.select({ account: adminAccounts, session: adminSessions }).from(adminSessions)
      .innerJoin(adminAccounts, eq(adminAccounts.id, adminSessions.adminAccountId)).where(eq(adminSessions.tokenHash, adminTokenHash(token))).limit(1);
    if (!result) return null;
    const { account, session } = result;
    if (!account.active || session.revokedAt || session.expiresAt <= new Date() || session.credentialVersion !== account.credentialVersion) return null;
    if (account.mustChangePassword && !options.allowRestricted) throw new HttpError('admin_password_change_required', 403);
    return { adminAccountId: account.id, credentialVersion: account.credentialVersion, sessionId: session.id, expiresAt: session.expiresAt, account: safeAdminAccount(account) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('admin_dependency_unavailable', 503);
  }
}
export async function logoutAdmin(identity: AdminIdentity): Promise<void> {
  await adminTransaction(async tx => {
    const rows = await lockAdminAccounts(tx, [identity.adminAccountId]);
    await validateAdminActor(tx, identity, rows, true);
    await tx.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.id, identity.sessionId), eq(adminSessions.adminAccountId, identity.adminAccountId)));
    await recordAdminAuditInTransaction(tx, { actor: { kind: 'admin_account', adminAccountId: identity.adminAccountId },
      action: 'admin.session.logout', objectType: 'admin_session', objectId: identity.sessionId, result: 'committed' });
  });
}
