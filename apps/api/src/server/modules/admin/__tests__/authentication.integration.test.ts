import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../../db/schema.js';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { accountFixture } from './account-fixture.js';
const fixture = await accountFixture();
const { db, closeDb } = fixture;
vi.doMock('../../../db/index.js', () => fixture);
import { adminAccounts, adminAuditLogs, adminLoginLimits, adminSessions, users } from '../../../db/schema.js';
const auth = await import('../authentication.js');
const accounts = await import('../accounts.js');
const passwords = await import('../passwords.js');
const { consumeAdminLoginBudget } = await import('../security.js');
const secret = 'Amber river lanterns 847!';
const ids: string[] = [];
beforeEach(async () => { await db.delete(adminLoginLimits); });
afterAll(async () => {
  if (ids.length) {
    await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, ids));
    await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.objectId, ids));
    await db.delete(adminSessions).where(inArray(adminSessions.adminAccountId, ids));
    await db.delete(adminAccounts).where(inArray(adminAccounts.id, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await db.delete(adminLoginLimits); await closeDb();
});
it('atomic budgets admit five concurrent same-email attempts across module instances and expire', async () => {
  const email = `${randomUUID()}@example.test`;
  const secondClient = postgres(fixture.url);
  vi.resetModules();
  vi.doMock('../../../db/index.js', () => ({ db: drizzle(secondClient, { schema }) }));
  const second = await import('../security.js');
  vi.doMock('../../../db/index.js', () => fixture);
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? second : { consumeAdminLoginBudget }).consumeAdminLoginBudget(email, 'budget-test')));
  await secondClient.end();
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
  for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 429, retryAfter: expect.any(Number) });
  const now = new Date(Date.now() + 16 * 60000);
  await expect(consumeAdminLoginBudget(email, 'budget-test', now)).resolves.toBeUndefined();
});
it('limiter denies before hashing and unknown/inactive/wrong passwords are indistinguishable', async () => {
  const email = `${randomUUID()}@example.test`;
  for (let i = 0; i < 5; i++) await consumeAdminLoginBudget(email, 'local');
  const spy = vi.spyOn(passwords, 'verifyAdminPassword');
  try {
    await expect(auth.loginAdmin({ email, password: secret, clientIp: 'local' })).rejects.toMatchObject({ status: 429 });
    expect(spy).not.toHaveBeenCalled();
    await expect(auth.loginAdmin({ email: `${randomUUID()}@example.test`, password: secret, clientIp: 'local' })).rejects.toMatchObject({ status: 401, message: 'admin_login_failed' });
    expect(spy).toHaveBeenLastCalledWith(secret, passwords.DUMMY_PASSWORD_HASH);
  } finally { spy.mockRestore(); }
});
it('login rechecks snapshot after hashing when recovery races; user bans are independent', async () => {
  const id = randomUUID(), email = `${id}@example.test`; ids.push(id);
  await db.insert(adminAccounts).values({ id, email, passwordHash: await passwords.hashAdminPassword(secret), mustChangePassword: false });
  await db.insert(users).values({ id, openid: id, status: 'banned' });
  const session = await auth.loginAdmin({ email, password: secret, clientIp: 'local' });
  expect(await auth.resolveAdminToken(session.token)).not.toBeNull();
  const original = passwords.verifyAdminPassword;
  let arrived!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { arrived = r; });
  const wait = new Promise<void>(r => { release = r; });
  const spy = vi.spyOn(passwords, 'verifyAdminPassword').mockImplementation(async (...args) => { const result = await original(...args); arrived(); await wait; return result; });
  try {
    const pending = auth.loginAdmin({ email, password: secret, clientIp: 'local' });
    await ready;
    await accounts.recoverAdminAccount(id, 'Violet mountain compass 942!');
    release();
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(await auth.resolveAdminToken(session.token)).toBeNull();
  } finally { release(); spy.mockRestore(); }
});
it('sign-in audit failure rolls back session issuance and never logs credentials', async () => {
  const id = randomUUID(), email = `${id}@example.test`; ids.push(id);
  await db.insert(adminAccounts).values({ id, email, passwordHash: await passwords.hashAdminPassword(secret) });
  await db.execute(sql`CREATE OR REPLACE FUNCTION step2_fail_login() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'admin.session.login' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
  await db.execute(sql`CREATE TRIGGER step2_fail_login BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION step2_fail_login()`);
  try {
    await expect(auth.loginAdmin({ email, password: secret, clientIp: 'local' })).rejects.toMatchObject({ status: 503 });
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminAccountId, id))).toHaveLength(0);
  } finally {
    await db.execute(sql`DROP TRIGGER step2_fail_login ON admin_audit_logs`); await db.execute(sql`DROP FUNCTION step2_fail_login()`);
  }
});

it('persistent IP and global caps resist distinct-email concurrency; expired cleanup is bounded', async () => {
  const first = await Promise.allSettled(Array.from({ length: 35 }, () => consumeAdminLoginBudget(`${randomUUID()}@example.test`, 'shared-ip')));
  expect(first.filter(r => r.status === 'fulfilled')).toHaveLength(30);
  await db.delete(adminLoginLimits);
  const second = await Promise.allSettled(Array.from({ length: 65 }, (_, i) => consumeAdminLoginBudget(`${randomUUID()}@example.test`, `trusted-${i}`)));
  expect(second.filter(r => r.status === 'fulfilled')).toHaveLength(60);
  await db.insert(adminLoginLimits).values(Array.from({ length: 250 }, (_, i) => ({ key: `stale-${i}`, windowStart: new Date(0), expiresAt: new Date(1), attempts: 1 })));
  await expect(consumeAdminLoginBudget('cleanup@example.test', 'cleanup')).rejects.toMatchObject({ status: 429 });
  const stale = await db.select().from(adminLoginLimits).where(sql`key like 'stale-%'`);
  expect(stale).toHaveLength(150);
});
it('limiter storage failure is closed before any hash work', async () => {
  await db.execute(sql`ALTER TABLE admin_login_limits RENAME TO step2_hidden_limits`);
  const spy = vi.spyOn(passwords, 'verifyAdminPassword');
  try {
    await expect(auth.loginAdmin({ email: `${randomUUID()}@example.test`, password: secret, clientIp: 'local' })).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  } finally { await db.execute(sql`ALTER TABLE step2_hidden_limits RENAME TO admin_login_limits`); spy.mockRestore(); }
});
it('inactive, unknown and incorrect secrets have the same result, and absolute/revoked sessions never renew', async () => {
  const id = randomUUID(), email = `${id}@example.test`; ids.push(id);
  await db.insert(adminAccounts).values({ id, email, passwordHash: await passwords.hashAdminPassword(secret), active: false, mustChangePassword: false });
  for (const input of [{ email, password: secret }, { email, password: 'incorrect' }, { email: `${randomUUID()}@example.test`, password: secret }])
    await expect(auth.loginAdmin({ ...input, clientIp: 'local' })).rejects.toMatchObject({ status: 401, message: 'admin_login_failed' });
  await db.update(adminAccounts).set({ active: true }).where(eq(adminAccounts.id, id));
  const session = await auth.loginAdmin({ email, password: secret, clientIp: 'local' });
  const before = session.identity.expiresAt;
  expect((await auth.resolveAdminToken(session.token))!.expiresAt).toEqual(before);
  await db.update(adminSessions).set({ expiresAt: new Date(0) }).where(eq(adminSessions.id, session.identity.sessionId));
  expect(await auth.resolveAdminToken(session.token)).toBeNull();
});
it.each(['reset', 'disable'] as const)('login-%s race cannot issue a stale session', async mode => {
  const actorId = randomUUID(), id = randomUUID(), email = `${id}@example.test`; ids.push(actorId, id);
  const hash = await passwords.hashAdminPassword(secret);
  await db.insert(adminAccounts).values([{ id: actorId, email: `${actorId}@example.test`, passwordHash: hash, mustChangePassword: false }, { id, email, passwordHash: hash, mustChangePassword: false }]);
  const actor = (await auth.loginAdmin({ email: `${actorId}@example.test`, password: secret, clientIp: 'local' })).identity;
  const original = passwords.verifyAdminPassword;
  let arrived!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { arrived = r; });
  const wait = new Promise<void>(r => { release = r; });
  const spy = vi.spyOn(passwords, 'verifyAdminPassword').mockImplementation(async (...args) => { const result = await original(...args); arrived(); await wait; return result; });
  try {
    const pending = auth.loginAdmin({ email, password: secret, clientIp: 'local' });
    await ready;
    if (mode === 'reset') await accounts.resetAdminPassword(actor, id, 'Violet mountain compass 942!');
    else await accounts.disableAdminAccount(actor, id);
    release(); await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminAccountId, id))).toHaveLength(0);
  } finally { release(); spy.mockRestore(); }
});

it('revocation survives a new module instance and independent database connection', async () => {
  const id = randomUUID(), email = `${id}@example.test`; ids.push(id);
  await db.insert(adminAccounts).values({ id, email, passwordHash: await passwords.hashAdminPassword(secret), mustChangePassword: false });
  const session = await auth.loginAdmin({ email, password: secret, clientIp: 'local' });
  await accounts.recoverAdminAccount(id, secret);
  const client = postgres(fixture.url);
  vi.resetModules(); vi.doMock('../../../db/index.js', () => ({ db: drizzle(client, { schema }) }));
  try {
    const restarted = await import('../authentication.js');
    expect(await restarted.resolveAdminToken(session.token, { allowRestricted: true })).toBeNull();
  } finally { await client.end(); vi.doMock('../../../db/index.js', () => fixture); }
});

it('admin disable and user auth remain independent even with the same UUID', async () => {
  const id = randomUUID(); ids.push(id);
  await db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: await passwords.hashAdminPassword(secret), active: false });
  await db.insert(users).values({ id, openid: id, status: 'active' });
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id).sign(new TextEncoder().encode(process.env.JWT_SECRET));
  vi.resetModules(); vi.doMock('../../../db/index.js', () => fixture);
  const { verifyAuth } = await import('../../../middleware/auth.js');
  expect(await verifyAuth(new NextRequest('http://localhost:3000/api/me', { headers: { authorization: `Bearer ${token}` } }))).toEqual({ userId: id });
});
