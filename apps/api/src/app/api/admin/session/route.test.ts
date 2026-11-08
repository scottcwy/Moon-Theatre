import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, expect, it, vi } from 'vitest';
import { accountFixture } from '@/server/modules/admin/__tests__/account-fixture.js';
const fixture = await accountFixture();
const { db, closeDb } = fixture;
vi.doMock('@/server/db/index.js', () => fixture);
import { adminAccounts, adminAuditLogs, adminSessions } from '@/server/db/schema.js';
import { hashAdminPassword } from '@/server/modules/admin/passwords.js';
const { GET, POST, DELETE } = await import('./route.js');
const { POST: changePassword } = await import('../account/password/route.js');
const { GET: listAccounts, POST: createAccount } = await import('../accounts/route.js');
const id = randomUUID(), email = `${id}@example.test`, password = 'Amber river lanterns 847!';
const headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' };
function request(method: string, body?: unknown, cookie?: string, custom = headers) {
  return new NextRequest('http://localhost:3000/api/admin/session', { method, headers: { ...custom, ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
afterAll(async () => {
  await db.delete(adminAuditLogs).where(eq(adminAuditLogs.actorAdminAccountId, id));
  await db.delete(adminSessions).where(eq(adminSessions.adminAccountId, id));
  await db.delete(adminAccounts).where(eq(adminAccounts.id, id)); await closeDb();
});
it('all session writes reject CSRF before auth/hashing, and strict login rejects injected actors/privilege', async () => {
  for (const handler of [POST, DELETE]) {
    const response = await handler(request(handler === POST ? 'POST' : 'DELETE', {}, undefined, {} as typeof headers));
    expect(response.status).toBe(403); expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
  const injected = await POST(request('POST', { email, password, isProtected: true, actor: { adminAccountId: id } }));
  expect(injected.status).toBe(400);
});
it('login JSON exposes safe account only; token is HttpOnly Strict cookie; restricted API and password change force relogin', async () => {
  await db.insert(adminAccounts).values({ id, email, passwordHash: await hashAdminPassword(password) });
  const response = await POST(request('POST', { email, password }));
  expect(response.status).toBe(200);
  const data = await response.json() as { account: Record<string, unknown> };
  expect(Object.keys(data).sort()).toEqual(['account', 'authenticated', 'expiresAt', 'mustChangePassword']);
  expect(Object.keys(data.account).sort()).toEqual(['active', 'createdAt', 'email', 'id', 'isProtected', 'mustChangePassword', 'updatedAt']);
  expect(JSON.stringify(data)).not.toMatch(/token|passwordHash|credentialVersion|userId/);
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toMatch(/admin_session_v2=[a-f0-9]{64}/); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=strict');
  const sessionCookie = cookie.split(';')[0]!;
  expect((await GET(request('GET', undefined, sessionCookie))).status).toBe(200);
  expect((await listAccounts(request('GET', undefined, sessionCookie))).status).toBe(403);
  expect((await createAccount(request('POST', { email, password, isProtected: true }, sessionCookie))).status).toBe(403);
  const changed = await changePassword(request('POST', { currentPassword: password, newPassword: 'Violet mountain compass 942!' }, sessionCookie));
  expect(changed.status).toBe(200); expect(changed.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await GET(request('GET', undefined, sessionCookie))).status).toBe(401);
});
