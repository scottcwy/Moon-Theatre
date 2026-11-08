import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { accountFixture } from './account-fixture.js';
const fixture = await accountFixture();
const { db, closeDb } = fixture;
vi.doMock('../../../db/index.js', () => fixture);
import { adminAccounts, adminSessions, adminAuditLogs, adminLoginLimits } from '../../../db/schema.js';
import type * as accountsTypes from '../accounts.js';
const accounts = await import('../accounts.js');
import type * as authTypes from '../authentication.js';
const auth = await import('../authentication.js');

const password = 'Amber river lanterns 847!';
const changed = 'Violet mountain compass 942!';
const ids: string[] = [];
let owner: authTypes.AdminIdentity;
let ownerId: string;
const email = () => `${randomUUID()}@example.test`;
async function login(email: string, secret = password) { return auth.loginAdmin({ email, password: secret, clientIp: 'local' }); }
async function full(id: string, mail: string) {
  const restricted = await login(mail);
  const identity = (await auth.resolveAdminToken(restricted.token, { allowRestricted: true }))!;
  await accounts.changeOwnPassword(identity, { currentPassword: password, newPassword: changed });
  const session = await login(mail, changed);
  return (await auth.resolveAdminToken(session.token))!;
}
beforeAll(async () => {
  const broken = randomUUID();
  await db.insert(adminAccounts).values({ id: broken, email: email(), passwordHash: 'historical' });
  await expect(accounts.bootstrapAdminAccount(email(), password)).rejects.toMatchObject({ status: 409, message: 'admin_bootstrap_broken_state' });
  await db.delete(adminAccounts).where(eq(adminAccounts.id, broken));
  const results = await Promise.allSettled([accounts.bootstrapAdminAccount(email(), password), accounts.bootstrapAdminAccount(email(), password)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const result = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<accountsTypes.SafeAdminAccount>;
  ownerId = result.value.id; ids.push(ownerId);
  const again = await accounts.bootstrapAdminAccount(result.value.email.toUpperCase(), changed);
  expect(again.id).toBe(ownerId);
  owner = await full(ownerId, result.value.email);
});
afterAll(async () => {
  if (ids.length) {
    await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, ids));
    await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.objectId, ids));
    await db.delete(adminSessions).where(inArray(adminSessions.adminAccountId, ids));
    await db.delete(adminAccounts).where(inArray(adminAccounts.id, ids));
  }
  await db.delete(adminLoginLimits);
  await closeDb();
});
it('normalizes unique email under concurrent creates and never accepts privileged fields', async () => {
  const mail = email();
  const results = await Promise.allSettled([accounts.createAdminAccount(owner, { email: ` ${mail.toUpperCase()} `, password }), accounts.createAdminAccount(owner, { email: mail, password })]);
  const success = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<accountsTypes.SafeAdminAccount>[];
  ids.push(...success.map(r => r.value.id));
  expect(success).toHaveLength(1);
  expect(success[0]!.value).toMatchObject({ email: mail, active: true, mustChangePassword: true, isProtected: false });
  await expect(accounts.createAdminAccount(owner, { email: email(), password, isProtected: true } as never)).rejects.toMatchObject({ status: 400 });
});
it('restricted identities cannot read business or list accounts, but can change own password', async () => {
  const ordinary = await accounts.createAdminAccount(owner, { email: email(), password }); ids.push(ordinary.id);
  const session = await login(ordinary.email);
  await expect(auth.resolveAdminToken(session.token)).rejects.toMatchObject({ status: 403, message: 'admin_password_change_required' });
  const restricted = (await auth.resolveAdminToken(session.token, { allowRestricted: true }))!;
  await expect(accounts.listAdminAccounts(restricted)).rejects.toMatchObject({ status: 403 });
  await accounts.changeOwnPassword(restricted, { currentPassword: password, newPassword: changed });
  expect(await auth.resolveAdminToken(session.token, { allowRestricted: true })).toBeNull();
});
it('protects owner from other accounts; prevents self-disable and ordinary email changes', async () => {
  const ordinary = await accounts.createAdminAccount(owner, { email: email(), password }); ids.push(ordinary.id);
  const actor = await full(ordinary.id, ordinary.email);
  await expect(accounts.disableAdminAccount(actor, ownerId)).rejects.toMatchObject({ status: 403 });
  await expect(accounts.resetAdminPassword(actor, ownerId, password)).rejects.toMatchObject({ status: 403 });
  await expect(accounts.disableAdminAccount(actor, ordinary.id)).rejects.toMatchObject({ status: 403 });
  await expect(accounts.changeOwnEmail(actor, { email: email(), currentPassword: changed })).rejects.toMatchObject({ status: 403 });
});
it('persists hashed distinct sessions, logout never revives and reset invalidates guard snapshots', async () => {
  const ordinary = await accounts.createAdminAccount(owner, { email: email(), password }); ids.push(ordinary.id);
  const actor = await full(ordinary.id, ordinary.email);
  const a = await login(ordinary.email, changed), b = await login(ordinary.email, changed);
  const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, a.identity.sessionId));
  expect(row!.tokenHash).not.toBe(a.token); expect(row!.id).not.toBe(a.token); expect(a.token).not.toBe(b.token);
  expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBeLessThanOrEqual(8 * 3600000);
  await auth.logoutAdmin(a.identity);
  expect(await auth.resolveAdminToken(a.token)).toBeNull();
  expect(await auth.resolveAdminToken(b.token)).not.toBeNull();
  const afterLogout = await login(ordinary.email, changed);
  expect(afterLogout.token).not.toBe(a.token);
  expect(await auth.resolveAdminToken(a.token)).toBeNull();
  await accounts.resetAdminPassword(owner, ordinary.id, password);
  expect(await auth.resolveAdminToken(b.token)).toBeNull();
  await expect(accounts.createAdminAccount(actor, { email: email(), password })).rejects.toMatchObject({ status: 401 });
  await accounts.recoverAdminAccount(ordinary.id, changed);
  expect(await auth.resolveAdminToken(b.token)).toBeNull();
  // This test covers session lifecycle; start a fresh budget for its recovery scenario.
  // The limiter's strict fifth/sixth-attempt behavior has its own concurrent PG tests.
  await db.delete(adminLoginLimits);
  const recovery = await login(ordinary.email, changed);
  expect(recovery.identity.account.mustChangePassword).toBe(true);
});
it('audit errors roll back account and session mutations as one transaction', async () => {
  const ordinary = await accounts.createAdminAccount(owner, { email: email(), password }); ids.push(ordinary.id);
  const session = await login(ordinary.email);
  await db.execute(sql`CREATE OR REPLACE FUNCTION step2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'admin.account.disable' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
  await db.execute(sql`CREATE TRIGGER step2_fail_audit BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION step2_fail_audit()`);
  try {
    await expect(accounts.disableAdminAccount(owner, ordinary.id)).rejects.toMatchObject({ status: 503 });
    const [row] = await db.select().from(adminAccounts).where(eq(adminAccounts.id, ordinary.id));
    expect(row!.active).toBe(true); expect(row!.credentialVersion).toBe(1);
    expect(await auth.resolveAdminToken(session.token, { allowRestricted: true })).not.toBeNull();
  } finally {
    await db.execute(sql`DROP TRIGGER step2_fail_audit ON admin_audit_logs`);
    await db.execute(sql`DROP FUNCTION step2_fail_audit()`);
  }
});
it('protected self email change requires password and revokes all sessions; recovery keeps protected marker', async () => {
  await expect(accounts.changeOwnEmail(owner, { email: email(), currentPassword: password })).rejects.toMatchObject({ status: 403 });
  const mail = email();
  await accounts.changeOwnEmail(owner, { email: mail, currentPassword: changed });
  await expect(accounts.listAdminAccounts(owner)).rejects.toMatchObject({ status: 401 });
  await accounts.recoverAdminAccount(ownerId, password);
  const [row] = await db.select().from(adminAccounts).where(eq(adminAccounts.id, ownerId));
  expect(row).toMatchObject({ email: mail, isProtected: true, active: true, mustChangePassword: true });
});
