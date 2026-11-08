import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { adminAccounts, adminSessions } from '../../db/schema.js';
import { HttpError } from '../../http/error-types.js';
import { recordAdminAuditInTransaction } from './audit.js';
import { hashAdminPassword, verifyAdminPassword } from './passwords.js';
import type { AdminIdentity } from './authentication.js';

export const adminEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const createAdminAccountSchema = z.object({ email: adminEmailSchema, password: z.string() }).strict();
export const ownPasswordSchema = z.object({ currentPassword: z.string().max(512), newPassword: z.string() }).strict();
export const ownEmailSchema = z.object({ email: adminEmailSchema, currentPassword: z.string().max(512) }).strict();
type Account = typeof adminAccounts.$inferSelect;
export type SafeAdminAccount = Omit<Account, 'passwordHash' | 'credentialVersion'>;
export type AdminTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function safeAdminAccount(row: Account): SafeAdminAccount {
  const { id, email, active, mustChangePassword, isProtected, createdAt, updatedAt } = row;
  return { id, email, active, mustChangePassword, isProtected, createdAt, updatedAt };
}

// Never log driver exceptions: constraint details may contain email/hash/credential material.
export async function adminTransaction<T>(fn: (tx: AdminTransaction) => Promise<T>): Promise<T> {
  try { return await db.transaction(fn); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof z.ZodError) throw new HttpError('admin_input_invalid', 400);
    if ((error as { code?: string }).code === '23505') throw new HttpError('admin_account_conflict', 409);
    throw new HttpError('admin_dependency_unavailable', 503);
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError('admin_input_invalid', 400);
  return result.data;
}
export async function lockAdminAccounts(tx: AdminTransaction, ids: string[]) {
  return tx.select().from(adminAccounts).where(inArray(adminAccounts.id, [...new Set(ids)].sort())).orderBy(asc(adminAccounts.id)).for('update');
}
export async function validateAdminActor(tx: AdminTransaction, identity: AdminIdentity, rows: Account[], allowRestricted = false) {
  const actor = rows.find(row => row.id === identity.adminAccountId);
  const [session] = await tx.select().from(adminSessions).where(and(eq(adminSessions.id, identity.sessionId), eq(adminSessions.adminAccountId, identity.adminAccountId))).limit(1);
  if (!actor?.active || actor.credentialVersion !== identity.credentialVersion || !session || session.revokedAt ||
      session.expiresAt <= new Date() || session.credentialVersion !== actor.credentialVersion)
    throw new HttpError('admin_unauthenticated', 401);
  if (actor.mustChangePassword && !allowRestricted) throw new HttpError('admin_password_change_required', 403);
  return actor;
}
export async function revokeAllAdminSessions(tx: AdminTransaction, id: string) {
  await tx.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.adminAccountId, id), isNull(adminSessions.revokedAt)));
}
async function accountAudit(tx: AdminTransaction, identity: AdminIdentity | null, action: string, id: string, requestId?: string) {
  await recordAdminAuditInTransaction(tx, {
    actor: identity ? { kind: 'admin_account', adminAccountId: identity.adminAccountId } : { kind: 'server_command' },
    action, objectType: 'admin_account', objectId: id, result: 'committed', requestId: requestId ?? randomUUID(),
  });
}
export async function bootstrapAdminAccount(email: string, password: string, requestId?: string): Promise<SafeAdminAccount> {
  const normalized = parse(adminEmailSchema, email);
  const hash = await hashAdminPassword(password);
  return adminTransaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(719321, 2)`);
    const rows = await tx.select().from(adminAccounts).orderBy(asc(adminAccounts.id)).for('update');
    const protectedAccount = rows.find(row => row.isProtected);
    if (protectedAccount) {
      if (protectedAccount.email !== normalized) throw new HttpError('admin_bootstrap_conflict', 409);
      return safeAdminAccount(protectedAccount);
    }
    if (rows.length) throw new HttpError('admin_bootstrap_broken_state', 409);
    const [row] = await tx.insert(adminAccounts).values({ email: normalized, passwordHash: hash, isProtected: true }).returning();
    await accountAudit(tx, null, 'admin.account.bootstrap', row!.id, requestId);
    return safeAdminAccount(row!);
  });
}
export async function recoverAdminAccount(id: string, password: string, requestId?: string): Promise<SafeAdminAccount> {
  parse(z.string().uuid(), id);
  const hash = await hashAdminPassword(password);
  return adminTransaction(async tx => {
    const [row] = await lockAdminAccounts(tx, [id]);
    if (!row) throw new HttpError('admin_account_not_found', 404);
    const [updated] = await tx.update(adminAccounts).set({ active: true, mustChangePassword: true, passwordHash: hash,
      credentialVersion: row.credentialVersion + 1, updatedAt: new Date() }).where(eq(adminAccounts.id, id)).returning();
    await revokeAllAdminSessions(tx, id);
    await accountAudit(tx, null, 'admin.account.recover', id, requestId);
    return safeAdminAccount(updated!);
  });
}
export async function listAdminAccounts(identity: AdminIdentity): Promise<SafeAdminAccount[]> {
  return adminTransaction(async tx => {
    const rows = await lockAdminAccounts(tx, [identity.adminAccountId]);
    await validateAdminActor(tx, identity, rows);
    return (await tx.select().from(adminAccounts).orderBy(asc(adminAccounts.createdAt))).map(safeAdminAccount);
  });
}
export async function createAdminAccount(identity: AdminIdentity, input: { email: string; password: string }): Promise<SafeAdminAccount> {
  const data = parse(createAdminAccountSchema, input);
  const hash = await hashAdminPassword(data.password);
  return adminTransaction(async tx => {
    const rows = await lockAdminAccounts(tx, [identity.adminAccountId]);
    await validateAdminActor(tx, identity, rows);
    const [row] = await tx.insert(adminAccounts).values({ email: data.email, passwordHash: hash }).returning();
    await accountAudit(tx, identity, 'admin.account.create', row!.id);
    return safeAdminAccount(row!);
  });
}
async function mutateOther(identity: AdminIdentity, id: string, hash?: string) {
  parse(z.string().uuid(), id);
  return adminTransaction(async tx => {
    const rows = await lockAdminAccounts(tx, [identity.adminAccountId, id]);
    await validateAdminActor(tx, identity, rows);
    const target = rows.find(row => row.id === id);
    if (!target) throw new HttpError('admin_account_not_found', 404);
    if (target.isProtected || id === identity.adminAccountId) throw new HttpError('admin_account_forbidden', 403);
    const [updated] = await tx.update(adminAccounts).set({ credentialVersion: target.credentialVersion + 1, updatedAt: new Date(),
      ...(hash ? { passwordHash: hash, mustChangePassword: true } : { active: false }) }).where(eq(adminAccounts.id, id)).returning();
    await revokeAllAdminSessions(tx, id);
    await accountAudit(tx, identity, hash ? 'admin.account.reset_password' : 'admin.account.disable', id);
    return safeAdminAccount(updated!);
  });
}
export async function disableAdminAccount(identity: AdminIdentity, id: string) { return mutateOther(identity, id); }
export async function resetAdminPassword(identity: AdminIdentity, id: string, password: string) {
  const hash = await hashAdminPassword(password);
  return mutateOther(identity, id, hash);
}
async function ownSnapshot(identity: AdminIdentity, currentPassword: string) {
  let row: Account | undefined;
  try { [row] = await db.select().from(adminAccounts).where(eq(adminAccounts.id, identity.adminAccountId)).limit(1); }
  catch { throw new HttpError('admin_dependency_unavailable', 503); }
  if (!row || !await verifyAdminPassword(currentPassword, row.passwordHash)) throw new HttpError('admin_current_password_invalid', 403);
  return row;
}
async function mutateOwn(identity: AdminIdentity, snapshot: Account, update: Partial<Account>, action: string, restricted: boolean) {
  return adminTransaction(async tx => {
    const rows = await lockAdminAccounts(tx, [identity.adminAccountId]);
    const actor = await validateAdminActor(tx, identity, rows, restricted);
    if (actor.credentialVersion !== snapshot.credentialVersion || actor.passwordHash !== snapshot.passwordHash)
      throw new HttpError('admin_credentials_changed', 409);
    if (action === 'admin.account.email' && !actor.isProtected) throw new HttpError('admin_account_forbidden', 403);
    const [updated] = await tx.update(adminAccounts).set({ ...update, credentialVersion: actor.credentialVersion + 1, updatedAt: new Date() })
      .where(eq(adminAccounts.id, actor.id)).returning();
    await revokeAllAdminSessions(tx, actor.id);
    await accountAudit(tx, identity, action, actor.id);
    return safeAdminAccount(updated!);
  });
}
export async function changeOwnPassword(identity: AdminIdentity, input: { currentPassword: string; newPassword: string }) {
  const data = parse(ownPasswordSchema, input);
  const snapshot = await ownSnapshot(identity, data.currentPassword);
  const hash = await hashAdminPassword(data.newPassword);
  return mutateOwn(identity, snapshot, { passwordHash: hash, mustChangePassword: false }, 'admin.account.password', true);
}
export async function changeOwnEmail(identity: AdminIdentity, input: { email: string; currentPassword: string }) {
  const data = parse(ownEmailSchema, input);
  const snapshot = await ownSnapshot(identity, data.currentPassword);
  return mutateOwn(identity, snapshot, { email: data.email }, 'admin.account.email', false);
}
