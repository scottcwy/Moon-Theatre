import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, expect, it, vi } from 'vitest';
import { accountFixture } from '@/server/modules/admin/__tests__/account-fixture.js';
import { adminAccounts, adminAuditLogs } from '@/server/db/schema.js';
import { eq } from 'drizzle-orm';
const fixture = await accountFixture();
vi.doMock('@/server/db/index.js', () => fixture);
const { hashAdminPassword } = await import('@/server/modules/admin/passwords.js');
const { loginAdmin } = await import('@/server/modules/admin/authentication.js');
const { GET, POST } = await import('./route.js');
const { PATCH: disable } = await import('./[id]/route.js');
const { POST: reset } = await import('./[id]/reset-password/route.js');
const { PATCH: emailChange } = await import('../account/email/route.js');
const password = 'Amber river lanterns 847!';
const id = randomUUID();
let cookie: string;
function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/accounts', { method,
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', cookie },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
afterAll(fixture.closeDb);
it('full admin account routes reject protection and actor injection, use only current account actor and safe JSON', async () => {
  await fixture.db.insert(adminAccounts).values({ id, email: `${id}@example.test`, passwordHash: await hashAdminPassword(password), isProtected: true, mustChangePassword: false });
  const session = await loginAdmin({ email: `${id}@example.test`, password, clientIp: 'local' });
  cookie = `admin_session_v2=${session.token}`;
  const ordinaryEmail = `${randomUUID()}@example.test`;
  for (const unsafe of [{ isProtected: true }, { adminAccountId: id }, { active: false }, { credentialVersion: 1 }, { actor: { kind: 'legacy_user', userId: id } }])
    expect((await POST(request('POST', { email: ordinaryEmail, password, ...unsafe }))).status).toBe(400);
  const response = await POST(request('POST', { email: ` ${ordinaryEmail.toUpperCase()} `, password }));
  expect(response.status).toBe(201);
  const data = await response.json() as { account: { id: string; email: string } };
  expect(data.account.email).toBe(ordinaryEmail);
  expect(JSON.stringify(data)).not.toMatch(/passwordHash|tokenHash|credentialVersion|Amber/);
  const context = { params: Promise.resolve({ id: data.account.id }) };
  expect((await disable(request('PATCH', { active: true }), context)).status).toBe(400);
  expect((await disable(request('PATCH', { active: false, email: 'tamper@example.test' }), context)).status).toBe(400);
  expect((await reset(request('POST', { password, isProtected: true }), context)).status).toBe(400);
  expect((await reset(request('POST', { password }), context)).status).toBe(200);
  expect((await disable(request('PATCH', { active: false }), context)).status).toBe(200);
  expect((await GET(request('GET'))).status).toBe(200);
  const audits = await fixture.db.select().from(adminAuditLogs).where(eq(adminAuditLogs.objectId, data.account.id));
  expect(audits).toHaveLength(3);
  expect(audits.every(a => a.actorSource === 'admin_account' && a.actorAdminAccountId === id && a.actorUserId === null)).toBe(true);
});
it('protected self email PATCH requires current password and clears exact cookie on success', async () => {
  expect((await emailChange(request('PATCH', { email: 'new@example.test', currentPassword: 'wrong' }))).status).toBe(403);
  const response = await emailChange(request('PATCH', { email: 'new@example.test', currentPassword: password }));
  expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('admin_session_v2=;');
  expect((await GET(request('GET'))).status).toBe(401);
});
