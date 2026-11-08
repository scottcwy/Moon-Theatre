import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  adminSessions,
  characters,
  chatSessions,
  messages,
  users,
  walletAccounts,
  walletTransactions,
} from '../../../db/schema.js';
import { adminTokenHash } from '../authentication.js';
import { getAdminUser, listAdminUsers, setAdminUserStatus } from '../users.js';
import { verifyAuth, verifyAdminAuth } from '../../../middleware/auth.js';
import { signJwt } from '../../auth/wechat.service.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  users: [] as string[],
  characters: [] as string[],
  sessions: [] as string[],
  adminAccounts: [] as string[],
};

async function newUser(input: { nickname?: string; openid?: string } = {}) {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    openid: input.openid ?? `openid_${id}`,
    nickname: input.nickname ?? `玩家${id.slice(0, 4)}`,
  });
  registry.users.push(id);
  return id;
}

async function newAdminAccount(input: { mustChangePassword?: boolean; id?: string } = {}) {
  const id = input.id ?? randomUUID();
  await db.insert(adminAccounts).values({
    id,
    email: `${id}@example.test`,
    passwordHash: 'hash',
    mustChangePassword: input.mustChangePassword ?? false,
  });
  if (!registry.adminAccounts.includes(id)) registry.adminAccounts.push(id);
  return id;
}

/** A real password-provider session row (no scrypt) so the guard itself can be exercised. */
async function newAdminSession(accountId: string) {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await db.insert(adminSessions).values({
    adminAccountId: accountId,
    credentialVersion: 1,
    provider: 'password',
    externalSubject: randomUUID(),
    tokenHash: adminTokenHash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return token;
}

async function newCharacter(name = '顾青梧') {
  const id = randomUUID();
  await db.insert(characters).values({
    id,
    name,
    avatarUrl: 'https://cdn.example.test/a.png',
    identity: '冷面刀客',
    description: '简介',
    initialRelationship: '初识',
    agentId: 'role-qingwu',
    status: 'active',
  });
  registry.characters.push(id);
  return id;
}

async function newSession(input: { userId: string; characterId: string; updatedAt?: Date }) {
  const id = randomUUID();
  await db.insert(chatSessions).values({
    id,
    userId: input.userId,
    characterId: input.characterId,
    mode: 'free',
    status: 'active',
    ...(input.updatedAt ? { createdAt: input.updatedAt, updatedAt: input.updatedAt } : {}),
  });
  registry.sessions.push(id);
  return id;
}

async function newMessage(input: { sessionId: string; createdAt: Date; role?: 'user' | 'assistant'; content?: string }) {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    sessionId: input.sessionId,
    role: input.role ?? 'user',
    content: input.content ?? '这段正文绝不能出现在管理页面或接口里',
    createdAt: input.createdAt,
  });
  return id;
}

async function newWallet(userId: string, input: { balance: number; recharged?: number; consumed?: number }) {
  await db.insert(walletAccounts).values({
    userId,
    balancePoints: input.balance,
    totalRechargedPoints: input.recharged ?? 0,
    totalConsumedPoints: input.consumed ?? 0,
  });
}

function idsOf(result: { items: unknown[] }): string[] {
  return (result.items as Array<{ id: string }>).map(item => item.id);
}

const actorFor = (adminAccountId: string) => ({ kind: 'admin_account' as const, adminAccountId });

afterEach(async () => {
  const sessionIds = registry.sessions.splice(0);
  const characterIds = registry.characters.splice(0);
  const userIds = registry.users.splice(0);
  const adminIds = registry.adminAccounts.splice(0);
  if (sessionIds.length > 0) await db.delete(messages).where(inArray(messages.sessionId, sessionIds));
  if (sessionIds.length > 0) await db.delete(chatSessions).where(inArray(chatSessions.id, sessionIds));
  if (characterIds.length > 0) await db.delete(characters).where(inArray(characters.id, characterIds));
  if (userIds.length > 0) await db.delete(walletTransactions).where(inArray(walletTransactions.userId, userIds));
  if (userIds.length > 0) await db.delete(walletAccounts).where(inArray(walletAccounts.userId, userIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.objectId, userIds));
  if (userIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorUserId, userIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  if (adminIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminSessions).where(inArray(adminSessions.adminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, adminIds));
});

afterAll(closeDb);

describe('listAdminUsers search (AC-11)', () => {
  it('matches nickname substring, openid prefix and user-id prefix, and combines with the status filter', async () => {
    const actor = actorFor(await newAdminAccount());
    // The shared disposable database holds other suites' users, so every term carries a unique token.
    const token = randomUUID().slice(0, 8);
    const xiaoman = await newUser({ nickname: `${token}小满`, openid: `openid_${token}_abc123` });
    const ayue = await newUser({ nickname: `${token}阿月`, openid: `wxzzz_${token}` });
    const jianke = await newUser({ nickname: `${token}剑客`, openid: `openid_${token}_abc999` });

    expect(idsOf(await listAdminUsers({ query: `  ${token}小满  ` }))).toEqual([xiaoman]);
    expect(new Set(idsOf(await listAdminUsers({ query: `openid_${token}_abc` })))).toEqual(new Set([xiaoman, jianke]));
    expect(idsOf(await listAdminUsers({ query: ayue.slice(0, 8) }))).toEqual([ayue]);
    expect(idsOf(await listAdminUsers({ query: ayue }))).toEqual([ayue]);
    expect(idsOf(await listAdminUsers({ query: `nothing-${token}` }))).toEqual([]);

    await setAdminUserStatus(actor, xiaoman, 'banned');
    expect(idsOf(await listAdminUsers({ query: `openid_${token}_abc`, status: 'banned' }))).toEqual([xiaoman]);
    expect(idsOf(await listAdminUsers({ query: `openid_${token}_abc`, status: 'active' }))).toEqual([jianke]);
    // An empty query is "no filter", not "match nothing": all three token rows stay visible.
    const unfiltered = idsOf(await listAdminUsers({ query: '   ', pageSize: 100 }));
    for (const id of [xiaoman, ayue, jianke]) expect(unfiltered).toContain(id);
  });

  it('treats LIKE wildcards in the term as literal characters', async () => {
    const literal = await newUser({ nickname: '100%_real', openid: 'openid_percent' });
    const other = await newUser({ nickname: '100Xreal', openid: 'openid_other' });
    expect(idsOf(await listAdminUsers({ query: '100%_' }))).toEqual([literal]);
    expect(idsOf(await listAdminUsers({ query: '%' }))).toEqual([literal]);
    expect(idsOf(await listAdminUsers({ query: '100X' }))).toEqual([other]);
  });

  it('adds wallet balance, session count and last message time in a constant number of statements', async () => {
    const rich = await newUser({ nickname: '有余额' });
    const quiet = await newUser({ nickname: '没记录' });
    const characterA = await newCharacter('顾青梧');
    const characterB = await newCharacter('白藏');
    await newWallet(rich, { balance: 42, recharged: 100, consumed: 58 });
    const first = await newSession({ userId: rich, characterId: characterA, updatedAt: new Date('2026-11-01T00:00:00Z') });
    const second = await newSession({ userId: rich, characterId: characterB, updatedAt: new Date('2026-11-02T00:00:00Z') });
    await newMessage({ sessionId: first, createdAt: new Date('2026-11-01T01:00:00Z') });
    await newMessage({ sessionId: second, createdAt: new Date('2026-11-02T05:30:00Z'), role: 'assistant' });

    const selectSpy = vi.spyOn(db, 'select');
    const page = await listAdminUsers({ page: 1, pageSize: 50 });
    expect(selectSpy).toHaveBeenCalledTimes(2); // one page statement + one count statement, no N+1
    selectSpy.mockRestore();

    const richRow = page.items.find(row => row.id === rich)!;
    expect(richRow).toMatchObject({ balancePoints: 42, sessionCount: 2 });
    expect(richRow.lastMessageAt!.toISOString()).toBe('2026-11-02T05:30:00.000Z');
    const quietRow = page.items.find(row => row.id === quiet)!;
    expect(quietRow).toMatchObject({ balancePoints: 0, sessionCount: 0, lastMessageAt: null });
  });

  it('orders deterministically and clamps pagination to the documented bounds', async () => {
    const token = randomUUID().slice(0, 8);
    const sameMoment = new Date('2026-10-10T00:00:00Z');
    const created: string[] = [];
    for (const nickname of ['甲', '乙', '丙']) {
      const id = await newUser({ nickname: `${token}${nickname}` });
      await db.update(users).set({ createdAt: sameMoment }).where(inArray(users.id, [id]));
      created.push(id);
    }
    await db.update(users).set({ createdAt: new Date('2026-10-11T00:00:00Z') }).where(inArray(users.id, [created[1]!]));

    const page = await listAdminUsers({ query: token, page: 1, pageSize: 500 });
    expect(page).toMatchObject({ page: 1, pageSize: 100, total: 3 }); // bounded page size
    const pageOne = await listAdminUsers({ query: token, page: 1, pageSize: 2 });
    const pageTwo = await listAdminUsers({ query: token, page: 2, pageSize: 2 });
    // Newest first; equal timestamps break ties on id, so the pages are stable and never overlap.
    expect([...idsOf(pageOne), ...idsOf(pageTwo)]).toEqual([created[1]!, ...[created[0]!, created[2]!].sort().reverse()]);
    expect(await listAdminUsers({ query: token, page: 3, pageSize: 2 })).toMatchObject({ items: [], total: 3 });
    const clamped = await listAdminUsers({ query: token, page: 0, pageSize: 0 });
    expect(clamped).toMatchObject({ page: 1, pageSize: 1 });
  });
});

describe('getAdminUser profile (AC-11)', () => {
  it('returns account, wallet summary, usage totals and recent sessions without persona or credential data', async () => {
    const userId = await newUser({ nickname: '小满', openid: 'openid_full_profile' });
    await newWallet(userId, { balance: 7, recharged: 100, consumed: 93 });
    const characterA = await newCharacter('顾青梧');
    const characterB = await newCharacter('白藏');
    const older = await newSession({ userId, characterId: characterA, updatedAt: new Date('2026-11-01T00:00:00Z') });
    const newer = await newSession({ userId, characterId: characterB, updatedAt: new Date('2026-11-03T00:00:00Z') });
    await newMessage({ sessionId: older, createdAt: new Date('2026-11-01T01:00:00Z') });
    await newMessage({ sessionId: newer, createdAt: new Date('2026-11-03T02:00:00Z') });
    await newMessage({ sessionId: newer, createdAt: new Date('2026-11-03T03:00:00Z'), role: 'assistant' });

    const profile = await getAdminUser(userId);
    expect(profile.user).toMatchObject({ id: userId, nickname: '小满', status: 'active' });
    expect(profile.wallet).toEqual({ exists: true, balancePoints: 7, totalRechargedPoints: 100, totalConsumedPoints: 93 });
    expect(profile.stats).toMatchObject({ sessionCount: 2, messageCount: 3 });
    expect(profile.stats.lastMessageAt?.toISOString()).toBe('2026-11-03T03:00:00.000Z');
    expect(profile.recentSessions.map(row => row.id)).toEqual([newer, older]);
    expect(profile.recentSessions[0]).toMatchObject({ characterName: '白藏', mode: 'free', messageCount: 2 });

    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain('openid_full_profile'); // masked, never the raw identifier
    expect(profile.user.openidPreview).toBe('openid_f…');
    expect(serialized).not.toContain('这段正文绝不能出现在管理页面');
    expect(serialized).not.toContain('prompt');
  });

  it('reports an empty wallet and no sessions for a brand-new user', async () => {
    const userId = await newUser({ nickname: '新人' });
    const profile = await getAdminUser(userId);
    expect(profile.wallet).toEqual({ exists: false, balancePoints: 0, totalRechargedPoints: 0, totalConsumedPoints: 0 });
    expect(profile.stats).toMatchObject({ sessionCount: 0, messageCount: 0, lastMessageAt: null, lastSessionAt: null });
    expect(profile.recentSessions).toEqual([]);
  });

  it('refuses a missing user with 404 and a malformed id with 400', async () => {
    await expect(getAdminUser(randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(getAdminUser('not-a-uuid')).rejects.toMatchObject({ status: 400 });
  });
});

describe('setAdminUserStatus ban/unban (AC-11)', () => {
  it('bans with a same-transaction audit naming the real actor, and never touches wallet rows', async () => {
    const adminAccountId = await newAdminAccount();
    const userId = await newUser({ nickname: '待封禁' });
    await newWallet(userId, { balance: 55, recharged: 60, consumed: 5 });
    const [walletBefore] = await db.select().from(walletAccounts).where(inArray(walletAccounts.userId, [userId]));
    const transactionsBefore = await db.select().from(walletTransactions).where(inArray(walletTransactions.userId, [userId]));

    const result = await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned', 'request-ban');
    expect(result).toMatchObject({ changed: true, previousStatus: 'active' });
    expect(result.user).toMatchObject({ id: userId, status: 'banned' });

    const [row] = await db.select().from(users).where(inArray(users.id, [userId]));
    expect(row).toMatchObject({ id: userId, nickname: '待封禁', status: 'banned' }); // still there, never deleted

    const [audit] = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]));
    expect(audit).toMatchObject({
      action: 'admin.user.ban',
      objectType: 'user',
      objectId: userId,
      actorSource: 'admin_account',
      actorAdminAccountId: adminAccountId,
      actorUserId: null,
      requestId: 'request-ban',
      result: 'committed',
    });
    expect(audit!.summary).toEqual({ from: 'active', to: 'banned' });

    const [walletAfter] = await db.select().from(walletAccounts).where(inArray(walletAccounts.userId, [userId]));
    expect(walletAfter!.balancePoints).toBe(walletBefore!.balancePoints);
    expect(walletAfter!.totalRechargedPoints).toBe(walletBefore!.totalRechargedPoints);
    expect(walletAfter!.totalConsumedPoints).toBe(walletBefore!.totalConsumedPoints);
    expect(await db.select().from(walletTransactions).where(inArray(walletTransactions.userId, [userId]))).toEqual(transactionsBefore);
  });

  it('is idempotent: repeating the same call changes nothing and adds no second audit row', async () => {
    const adminAccountId = await newAdminAccount();
    const userId = await newUser();
    const first = await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned');
    expect(first.changed).toBe(true);
    const second = await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned');
    expect(second).toMatchObject({ changed: false, previousStatus: 'banned', auditId: null });
    expect(second.user).toMatchObject({ id: userId, status: 'banned' });
    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]));
    expect(audits).toHaveLength(1);
  });

  it('unbans with its own audited event and a later re-ban is a new event, not a replayed one', async () => {
    const adminAccountId = await newAdminAccount();
    const userId = await newUser();
    await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned');
    const unban = await setAdminUserStatus(actorFor(adminAccountId), userId, 'active');
    expect(unban).toMatchObject({ changed: true, previousStatus: 'banned' });
    expect(unban.user).toMatchObject({ status: 'active' });
    await new Promise(resolve => setTimeout(resolve, 5)); // updated_at is the transition discriminator
    await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned');

    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]));
    expect(audits).toHaveLength(3);
    expect(audits.filter(row => row.action === 'admin.user.ban')).toHaveLength(2);
    expect(audits.filter(row => row.action === 'admin.user.unban')).toHaveLength(1);
    // Every event names the real actor and its own transition, and none is a placeholder.
    for (const row of audits) expect(row).toMatchObject({ actorAdminAccountId: adminAccountId, actorSource: 'admin_account', result: 'committed', objectType: 'user', objectId: userId });
    expect(audits.map(row => row.summary)).toEqual(expect.arrayContaining([
      { from: 'active', to: 'banned' },
      { from: 'banned', to: 'active' },
    ]));
  });

  it('refuses a missing target (404), a malformed id (400) and an unknown status (400)', async () => {
    const actor = actorFor(await newAdminAccount());
    await expect(setAdminUserStatus(actor, randomUUID(), 'banned')).rejects.toMatchObject({ status: 404 });
    await expect(setAdminUserStatus(actor, 'nope', 'banned')).rejects.toMatchObject({ status: 400 });
    await expect(setAdminUserStatus(actor, randomUUID(), 'deleted' as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('banned credentials stop authorizing user requests (AC-11)', () => {
  it('rejects a previously issued JWT through the real verifyAuth path and restores it on unban', async () => {
    const adminAccountId = await newAdminAccount();
    const userId = await newUser({ nickname: '玩家甲' });
    const token = await signJwt(userId);
    const meRequest = () => new NextRequest('http://localhost:3000/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const { GET: meGet } = await import('@/app/api/me/route.js');

    expect(await verifyAuth(meRequest())).toEqual({ userId });
    const before = await meGet(meRequest());
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ id: userId, status: 'active' });

    await setAdminUserStatus(actorFor(adminAccountId), userId, 'banned');
    expect(await verifyAuth(meRequest())).toBeNull();
    const during = await meGet(meRequest());
    expect(during.status).toBe(401);

    await setAdminUserStatus(actorFor(adminAccountId), userId, 'active');
    expect(await verifyAuth(meRequest())).toEqual({ userId });
    const after = await meGet(meRequest());
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ id: userId, status: 'active' });
  });
});

describe('admin identity stays independent of user identity (AC-11)', () => {
  it('banning a user whose UUID equals an admin account id leaves that administrator working', async () => {
    const sharedId = randomUUID();
    await newAdminAccount({ id: sharedId });
    await db.insert(users).values({ id: sharedId, openid: `openid_${sharedId}`, nickname: '与管理员同 UUID' });
    registry.users.push(sharedId);
    const token = await newAdminSession(sharedId);
    const adminRequest = () => new NextRequest('http://localhost:3000/api/admin/users', {
      headers: { cookie: `admin_session_v2=${token}` },
    });

    const before = await verifyAdminAuth(adminRequest());
    expect(before.ok).toBe(true);

    const result = await setAdminUserStatus(actorFor(sharedId), sharedId, 'banned');
    expect(result.user.status).toBe('banned');

    const after = await verifyAdminAuth(adminRequest());
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.auth.adminAccountId).toBe(sharedId);
    const [account] = await db.select().from(adminAccounts).where(inArray(adminAccounts.id, [sharedId]));
    expect(account).toMatchObject({ id: sharedId, active: true });
    const [user] = await db.select().from(users).where(inArray(users.id, [sharedId]));
    expect(user).toMatchObject({ id: sharedId, status: 'banned' });
  });
});

describe('the user routes behind the real guard (AC-11)', () => {
  async function fixture() {
    const adminAccountId = await newAdminAccount();
    const token = await newAdminSession(adminAccountId);
    const restrictedAccountId = await newAdminAccount({ mustChangePassword: true });
    const restrictedToken = await newAdminSession(restrictedAccountId);
    const userId = await newUser({ nickname: '接口玩家' });
    return { adminAccountId, token, restrictedToken, userId };
  }
  it('rejects an absent identity, a restricted account, missing CSRF material and a valid identity missing the request flag', async () => {
    const { token, restrictedToken, userId } = await fixture();
    const { GET: listRoute } = await import('@/app/api/admin/users/route.js');
    const { GET: detailRoute, PATCH: patchRoute } = await import('@/app/api/admin/users/[id]/route.js');
    const context = { params: Promise.resolve({ id: userId }) };
    const patch = (headers: Record<string, string>) => new NextRequest(`http://localhost:3000/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'banned' }),
    });

    const absentList = await listRoute(new NextRequest('http://localhost:3000/api/admin/users'));
    expect(absentList.status).toBe(401);
    expect(absentList.headers.get('cache-control')).toBe('private, no-store');
    expect((await detailRoute(new NextRequest(`http://localhost:3000/api/admin/users/${userId}`), context)).status).toBe(401);

    const restricted = await listRoute(new NextRequest('http://localhost:3000/api/admin/users', {
      headers: { cookie: `admin_session_v2=${restrictedToken}` },
    }));
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toEqual({ error: 'admin_password_change_required' });

    const noOrigin = await patchRoute(patch({ cookie: `admin_session_v2=${token}`, 'content-type': 'application/json', 'x-admin-request': '1' }), context);
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: 'admin_csrf_failed' });
    const noFlag = await patchRoute(patch({ cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json' }), context);
    expect(noFlag.status).toBe(403);
    expect(await noFlag.json()).toEqual({ error: 'admin_csrf_failed' });
    const noJson = await patchRoute(patch({ cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'x-admin-request': '1' }), context);
    expect(noJson.status).toBe(403);

    const [row] = await db.select().from(users).where(inArray(users.id, [userId]));
    expect(row!.status).toBe('active'); // nothing was written by any rejected call
    expect(await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]))).toEqual([]);
  });

  it('lists, reads and bans over HTTP with the actor taken from the session', async () => {
    const { token, userId, adminAccountId } = await fixture();
    const { GET: listRoute } = await import('@/app/api/admin/users/route.js');
    const { GET: detailRoute, PATCH: patchRoute } = await import('@/app/api/admin/users/[id]/route.js');
    const context = { params: Promise.resolve({ id: userId }) };

    const list = await listRoute(new NextRequest(`http://localhost:3000/api/admin/users?q=${encodeURIComponent('接口玩家')}`, {
      headers: { cookie: `admin_session_v2=${token}` },
    }));
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    const listBody = await list.json() as { items: Array<{ id: string }>; total: number };
    expect(listBody.items.map(item => item.id)).toEqual([userId]);

    const badFilter = await listRoute(new NextRequest('http://localhost:3000/api/admin/users?status=deleted', {
      headers: { cookie: `admin_session_v2=${token}` },
    }));
    expect(badFilter.status).toBe(400);
    const badFilterBody = await badFilter.json() as { error: string };
    expect(badFilterBody.error).toContain('用户状态只能是正常或已封禁');

    const detail = await detailRoute(new NextRequest(`http://localhost:3000/api/admin/users/${userId}`, {
      headers: { cookie: `admin_session_v2=${token}` },
    }), context);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ user: { id: userId, status: 'active' } });

    const banned = await patchRoute(new NextRequest(`http://localhost:3000/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1', 'x-request-id': 'req-1' },
      body: JSON.stringify({ status: 'banned' }),
    }), context);
    expect(banned.status).toBe(200);
    expect(await banned.json()).toMatchObject({ user: { id: userId, status: 'banned' }, changed: true });
    const [audit] = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]));
    expect(audit).toMatchObject({ action: 'admin.user.ban', actorAdminAccountId: adminAccountId, requestId: 'req-1' });

    // Idempotent replay over HTTP: same answer shape, still one audit event.
    const replay = await patchRoute(new NextRequest(`http://localhost:3000/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' },
      body: JSON.stringify({ status: 'banned' }),
    }), context);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ changed: false });
    expect(await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [userId]))).toHaveLength(1);
  });
});
