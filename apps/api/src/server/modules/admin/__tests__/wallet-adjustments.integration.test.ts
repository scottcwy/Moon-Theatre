import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  adminAuditLogs,
  adminSessions,
  users,
  walletAccounts,
  walletTransactions,
} from '../../../db/schema.js';
import { adminTokenHash } from '../authentication.js';
import { adjustWalletPoints, consumePoints } from '../../wallet/service.js';

// Fail closed: this suite writes through the ambient db (and injects a trigger), so refuse any
// target that is not the guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  users: [] as string[],
  admins: [] as string[],
  keys: [] as string[],
};

async function newAdminAccount(input: { mustChangePassword?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(adminAccounts).values({
    id, email: `${id}@example.test`, passwordHash: 'hash', mustChangePassword: input.mustChangePassword ?? false,
  });
  registry.admins.push(id);
  return id;
}

/** A real password-provider session row, so the guard itself is exercised (no scrypt). */
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

async function newPlayer(balance: number) {
  const id = randomUUID();
  await db.insert(users).values({ id, openid: `openid_${id}`, nickname: '调账玩家' });
  await db.insert(walletAccounts).values({ userId: id, balancePoints: balance });
  registry.users.push(id);
  return id;
}

const key = () => {
  const value = `adj-${randomUUID()}`;
  registry.keys.push(value);
  return value;
};

const actorOf = (adminAccountId: string) => ({ kind: 'admin_account' as const, adminAccountId });

const writeHeaders = (token: string) => ({
  cookie: `admin_session_v2=${token}`,
  origin: 'http://localhost:3000',
  'content-type': 'application/json',
  'x-admin-request': '1',
  'x-request-id': 'request-adjust',
});

const adjustment = (idempotencyKey: string, overrides: Record<string, unknown> = {}) => ({
  userId: '', delta: 5, reason: '客服补偿', idempotencyKey, ...overrides,
});

async function postAdjustment(token: string, body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/wallet/adjustments/route.js');
  return POST(new NextRequest('http://localhost:3000/api/admin/wallet/adjustments', {
    method: 'POST', headers: writeHeaders(token), body: JSON.stringify(body),
  }));
}

async function walletOf(userId: string) {
  const [row] = await db.select().from(walletAccounts).where(inArray(walletAccounts.userId, [userId]));
  return row!;
}

async function transactionsOf(userId: string) {
  return db.select().from(walletTransactions).where(inArray(walletTransactions.userId, [userId]));
}

/**
 * Consume rows store a positive amount with `type='consume'`; an adjustment row stores its signed
 * delta. Reconstructing the balance from the ledger keeps the invariant honest for both kinds.
 */
function ledgerBalance(start: number, rows: Array<{ type: string; amount: number }>): number {
  return rows.reduce((sum, row) => sum + (row.type === 'consume' ? -row.amount : row.amount), start);
}

afterEach(async () => {
  const userIds = registry.users.splice(0);
  const adminIds = registry.admins.splice(0);
  const keys = registry.keys.splice(0);
  if (userIds.length > 0) await db.delete(walletTransactions).where(inArray(walletTransactions.userId, userIds));
  if (keys.length > 0) await db.delete(walletTransactions).where(inArray(walletTransactions.idempotencyKey, keys));
  if (userIds.length > 0) await db.delete(walletAccounts).where(inArray(walletAccounts.userId, userIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  if (adminIds.length > 0) await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminSessions).where(inArray(adminSessions.adminAccountId, adminIds));
  if (adminIds.length > 0) await db.delete(adminAccounts).where(inArray(adminAccounts.id, adminIds));
});

afterAll(closeDb);

describe('wallet adjustment over HTTP (AC-14)', () => {
  async function fixture(balance = 10) {
    const adminAccountId = await newAdminAccount();
    const token = await newAdminSession(adminAccountId);
    const otherAdminAccountId = await newAdminAccount();
    const otherToken = await newAdminSession(otherAdminAccountId);
    const player = await newPlayer(balance);
    return { adminAccountId, token, otherAdminAccountId, otherToken, player };
  }

  it('records the adjustment with the session actor, the reason and a committed audit', async () => {
    const { adminAccountId, token, player } = await fixture(10);
    const idempotencyKey = key();
    const response = await postAdjustment(token, adjustment(idempotencyKey, { userId: player, delta: 10, reason: '客服补偿' }));
    expect(response.status).toBe(201);
    const body = await response.json() as { transactionId: string; balanceAfter: number; alreadyAdjusted: boolean };
    expect(body).toMatchObject({ balanceAfter: 20, alreadyAdjusted: false });

    expect(await walletOf(player)).toMatchObject({ balancePoints: 20 });
    const [transaction] = await db.select().from(walletTransactions)
      .where(inArray(walletTransactions.idempotencyKey, [idempotencyKey]));
    expect(transaction).toMatchObject({
      id: body.transactionId, userId: player, type: 'adjust', amount: 10, balanceAfter: 20,
      adjustmentReason: '客服补偿', description: '客服补偿', adminUserId: null, adminAccountId: adminAccountId,
    });

    const audits = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.objectId, [body.transactionId]));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'admin.wallet.adjust', objectType: 'wallet_transaction', objectId: body.transactionId,
      actorSource: 'admin_account', actorUserId: null, actorAdminAccountId: adminAccountId,
      dedupeKey: `wallet_adjustment:${idempotencyKey}`, requestId: 'request-adjust', result: 'committed',
    });
    expect(audits[0]!.summary).toMatchObject({
      idempotencyKey, userId: player, delta: 10, reason: '客服补偿', balanceAfter: 20, alreadyApplied: false,
    });
  });

  it('returns the original result for an identical replay and writes no second transaction', async () => {
    const { token, player } = await fixture(10);
    const idempotencyKey = key();
    const body = adjustment(idempotencyKey, { userId: player, delta: 10 });
    const first = await postAdjustment(token, body);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { transactionId: string; balanceAfter: number };

    const replay = await postAdjustment(token, body);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ transactionId: firstBody.transactionId, balanceAfter: 20, alreadyAdjusted: true });
    expect(await transactionsOf(player)).toHaveLength(1);
    expect(await walletOf(player)).toMatchObject({ balancePoints: 20 });
  });

  it('rejects a reused key when actor, user, direction, amount or reason changes, leaving one transaction', async () => {
    const { token, otherToken, player } = await fixture(10);
    const otherPlayer = await newPlayer(10);
    const idempotencyKey = key();
    const baseline = adjustment(idempotencyKey, { userId: player, delta: 5, reason: '客服补偿' });
    expect((await postAdjustment(token, baseline)).status).toBe(201);

    const changed: Array<[string, string, Record<string, unknown>]> = [
      ['user', token, { ...baseline, userId: otherPlayer }],
      ['actor', otherToken, baseline],
      ['direction', token, { ...baseline, delta: -5 }],
      ['amount', token, { ...baseline, delta: 6 }],
      ['reason', token, { ...baseline, reason: '另一种原因' }],
    ];
    for (const [parameter, session, body] of changed) {
      const response = await postAdjustment(session, body);
      expect(response.status, parameter).toBe(409);
      expect(await response.json(), parameter).toEqual({ error: 'wallet_adjustment_idempotency_conflict' });
    }

    const transactions = await db.select().from(walletTransactions)
      .where(inArray(walletTransactions.idempotencyKey, [idempotencyKey]));
    expect(transactions).toHaveLength(1);
    expect(await walletOf(player)).toMatchObject({ balancePoints: 15 });
    expect(await walletOf(otherPlayer)).toMatchObject({ balancePoints: 10 });
  });

  it('refuses a would-be negative balance without a transaction row', async () => {
    const { token, player } = await fixture(2);
    const before = await walletOf(player);
    const response = await postAdjustment(token, adjustment(key(), { userId: player, delta: -3, reason: '扣回' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'insufficient_wallet_balance' });
    expect(await walletOf(player)).toEqual(before);
    expect(await transactionsOf(player)).toEqual([]);
  });

  it('rejects a missing reason, zero/fractional delta, non-UUID user and extra body fields', async () => {
    const { token, player } = await fixture(10);
    for (const body of [
      adjustment(key(), { userId: player, reason: '   ' }),
      adjustment(key(), { userId: player, delta: 0 }),
      adjustment(key(), { userId: player, delta: 1.5 }),
      adjustment(key(), { userId: 'not-a-uuid' }),
      adjustment(key(), { userId: player, actor: { kind: 'admin_account', adminAccountId: 'forged' } }),
      adjustment(key(), { userId: player, balanceAfter: 999 }),
      { userId: player, delta: 1, reason: '缺少幂等标识' },
    ]) {
      const response = await postAdjustment(token, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await transactionsOf(player)).toEqual([]);
    expect(await walletOf(player)).toMatchObject({ balancePoints: 10 });
  });

  it('refuses an unknown target user before creating a wallet row', async () => {
    const { token } = await fixture(10);
    const response = await postAdjustment(token, adjustment(key(), { userId: randomUUID(), delta: 5 }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'admin_user_not_found' });
  });

  it('keeps the balance non-negative when adjustments race each other', async () => {
    const { adminAccountId, player } = await fixture(10);
    const actor = actorOf(adminAccountId);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
      adjustWalletPoints(player, -5, key(), '并发扣回', actor)));

    const succeeded = results.filter(result => result.status === 'fulfilled');
    expect(succeeded).toHaveLength(2);
    const wallet = await walletOf(player);
    expect(wallet.balancePoints).toBe(0);
    const transactions = await transactionsOf(player);
    expect(transactions).toHaveLength(2);
    for (const transaction of transactions) expect(transaction.balanceAfter).toBeGreaterThanOrEqual(0);
    expect(ledgerBalance(10, transactions)).toBe(wallet.balancePoints);
  });

  it('never goes negative when an adjustment races consumption', async () => {
    const { adminAccountId, player } = await fixture(10);
    const actor = actorOf(adminAccountId);
    const results = await Promise.allSettled([
      adjustWalletPoints(player, 7, key(), '并发补偿', actor),
      adjustWalletPoints(player, -9, key(), '并发扣回', actor),
      consumePoints(player, 3, key()),
      consumePoints(player, 3, key()),
      consumePoints(player, 3, key()),
      consumePoints(player, 3, key()),
    ]);

    const wallet = await walletOf(player);
    expect(wallet.balancePoints).toBeGreaterThanOrEqual(0);
    const transactions = await transactionsOf(player);
    expect(ledgerBalance(10, transactions)).toBe(wallet.balancePoints);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value.balanceAfter).toBeGreaterThanOrEqual(0);
    }
    // Every consume either landed at a non-negative balance or was refused; nothing is silently dropped.
    expect(transactions.filter(transaction => transaction.type === 'consume')).toHaveLength(
      results.slice(2).filter(result => result.status === 'fulfilled').length,
    );
  });

  it('reports audit-pending truthfully and finalizes the audit without touching money', async () => {
    const { adminAccountId, token, player } = await fixture(0);
    const idempotencyKey = key();
    const dedupeKey = `wallet_adjustment:${idempotencyKey}`;
    const trigger = `wallet_finalize_fail_${randomUUID().replace(/-/g, '')}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.dedupe_key = '${dedupeKey}' AND NEW.result = 'committed' THEN
        RAISE EXCEPTION 'injected audit finalize failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER "${trigger}" BEFORE UPDATE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION "${trigger}"();`));
    let pending: Response | undefined;
    try {
      pending = await postAdjustment(token, adjustment(idempotencyKey, { userId: player, delta: 10 }));
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER "${trigger}" ON admin_audit_logs; DROP FUNCTION "${trigger}"();`));
    }
    expect(pending!.status).toBe(503);
    const pendingBody = await pending!.json() as { error: string; transactionId: string; balanceAfter: number; dedupeKey: string };
    expect(pendingBody).toEqual({
      error: 'admin_audit_pending', dedupeKey, transactionId: expect.any(String), balanceAfter: 10,
    });

    const walletBefore = await walletOf(player);
    const transactionsBefore = await transactionsOf(player);
    const [pendingAudit] = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.dedupeKey, [dedupeKey]));
    expect(pendingAudit!.result).toBe('audit_pending');

    const { GET: statusRoute } = await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/route.js');
    const status = await statusRoute(new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}`, {
      headers: { cookie: `admin_session_v2=${token}` },
    }), { params: Promise.resolve({ idempotencyKey }) });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ complete: false, audit: { result: 'audit_pending' } });

    const { POST: finalizeRoute } = await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/finalize-audit/route.js');
    const finalized = await finalizeRoute(new NextRequest(
      `http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}/finalize-audit`,
      { method: 'POST', headers: writeHeaders(token), body: '{}' },
    ), { params: Promise.resolve({ idempotencyKey }) });
    expect(finalized.status).toBe(200);
    expect(await finalized.json()).toMatchObject({ transactionId: pendingBody.transactionId, balanceAfter: 10, alreadyFinalized: false });

    expect(await walletOf(player)).toEqual(walletBefore);
    expect(await transactionsOf(player)).toEqual(transactionsBefore);
    const [audit] = await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.dedupeKey, [dedupeKey]));
    expect(audit!.result).toBe('committed');
    const recovery = await db.select().from(adminAuditLogs)
      .where(inArray(adminAuditLogs.dedupeKey, [`wallet_adjustment_recovery:${pendingAudit!.id}`]));
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      action: 'admin.wallet.adjust.finalize_audit', actorSource: 'admin_account',
      actorAdminAccountId: adminAccountId, result: 'committed',
    });

    // A completed replay returns the stored result and still does not add a transaction.
    const replay = await postAdjustment(token, adjustment(idempotencyKey, { userId: player, delta: 10 }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ transactionId: pendingBody.transactionId, alreadyAdjusted: true });
    expect(await transactionsOf(player)).toHaveLength(1);

    const completed = await statusRoute(new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}`, {
      headers: { cookie: `admin_session_v2=${token}` },
    }), { params: Promise.resolve({ idempotencyKey }) });
    expect(await completed.json()).toMatchObject({ complete: true });
  });

  it('answers a missing adjustment key with 404 and an unrecoverable audit with 409', async () => {
    const { token, player } = await fixture(0);
    const missingKey = key();
    const missing = await (await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/route.js')).GET(
      new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${missingKey}`, { headers: { cookie: `admin_session_v2=${token}` } }),
      { params: Promise.resolve({ idempotencyKey: missingKey }) },
    );
    expect(missing.status).toBe(404);

    const idempotencyKey = key();
    expect((await postAdjustment(token, adjustment(idempotencyKey, { userId: player, delta: 5 }))).status).toBe(201);
    const [audit] = await db.select().from(adminAuditLogs)
      .where(inArray(adminAuditLogs.dedupeKey, [`wallet_adjustment:${idempotencyKey}`]));
    await db.update(adminAuditLogs).set({ summary: { idempotencyKey, mismatched: true } })
      .where(inArray(adminAuditLogs.id, [audit!.id]));
    const { POST: finalizeRoute } = await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/finalize-audit/route.js');
    const conflicted = await finalizeRoute(new NextRequest(
      `http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}/finalize-audit`,
      { method: 'POST', headers: writeHeaders(token), body: '{}' },
    ), { params: Promise.resolve({ idempotencyKey }) });
    expect(conflicted.status).toBe(409);
    expect(await conflicted.json()).toEqual({ error: 'wallet_adjustment_audit_conflict' });
    expect(await transactionsOf(player)).toHaveLength(1);
  });
});

describe('wallet adjustment routes behind the real guard (AC-14)', () => {
  it('rejects an absent identity, a restricted account and missing CSRF material without writing', async () => {
    const adminAccountId = await newAdminAccount();
    const token = await newAdminSession(adminAccountId);
    const restrictedToken = await newAdminSession(await newAdminAccount({ mustChangePassword: true }));
    const player = await newPlayer(10);
    const idempotencyKey = key();
    const body = JSON.stringify(adjustment(idempotencyKey, { userId: player }));
    const context = { params: Promise.resolve({ idempotencyKey }) };
    const collection = await import('@/app/api/admin/wallet/adjustments/route.js');
    const statusRoute = await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/route.js');
    const finalizeRoute = await import('@/app/api/admin/wallet/adjustments/[idempotencyKey]/finalize-audit/route.js');

    const absentPost = await collection.POST(new NextRequest('http://localhost:3000/api/admin/wallet/adjustments', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' }, body,
    }));
    expect(absentPost.status).toBe(401);
    expect(absentPost.headers.get('cache-control')).toBe('private, no-store');
    expect((await statusRoute.GET(new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}`), context)).status).toBe(401);
    expect((await finalizeRoute.POST(new NextRequest(
      `http://localhost:3000/api/admin/wallet/adjustments/${idempotencyKey}/finalize-audit`,
      { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' }, body: '{}' },
    ), context)).status).toBe(401);

    const restricted = await collection.POST(new NextRequest('http://localhost:3000/api/admin/wallet/adjustments', {
      method: 'POST', headers: { ...writeHeaders(restrictedToken) }, body,
    }));
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toEqual({ error: 'admin_password_change_required' });

    for (const headers of [
      { cookie: `admin_session_v2=${token}`, 'content-type': 'application/json', 'x-admin-request': '1' },
      { cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      { cookie: `admin_session_v2=${token}`, origin: 'http://localhost:3000', 'x-admin-request': '1' },
    ] as Array<Record<string, string>>) {
      const response = await collection.POST(new NextRequest('http://localhost:3000/api/admin/wallet/adjustments', {
        method: 'POST', headers, body,
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'admin_csrf_failed' });
    }

    expect(await transactionsOf(player)).toEqual([]);
    expect(await walletOf(player)).toMatchObject({ balancePoints: 10 });
    expect(await db.select().from(adminAuditLogs).where(inArray(adminAuditLogs.actorAdminAccountId, [adminAccountId]))).toEqual([]);
  });
});
