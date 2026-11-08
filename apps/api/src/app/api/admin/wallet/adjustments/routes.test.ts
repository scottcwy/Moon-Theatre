import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class WalletAdjustmentConflictError extends Error {
    readonly code = 'wallet_adjustment_idempotency_conflict';
    constructor() { super('Idempotency key was already used with different adjustment parameters'); }
  }
  class InsufficientBalanceError extends Error {
    readonly code = 'insufficient_wallet_balance';
    constructor() { super('Insufficient balance'); }
  }
  return {
    guard: vi.fn(),
    adjust: vi.fn(),
    finalize: vi.fn(),
    adminUserExists: vi.fn(),
    getStatus: vi.fn(),
    WalletAdjustmentConflictError,
    InsufficientBalanceError,
  };
});

vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: mocks.guard }));
vi.mock('@/server/modules/wallet/index.js', () => ({
  adjustWalletPoints: mocks.adjust,
  WalletAdjustmentConflictError: mocks.WalletAdjustmentConflictError,
  InsufficientBalanceError: mocks.InsufficientBalanceError,
}));
vi.mock('@/server/modules/admin/index.js', () => ({
  finalizeAdminAudit: mocks.finalize,
  adminUserExists: mocks.adminUserExists,
  getWalletAdjustmentStatus: mocks.getStatus,
}));

const collection = await import('./route.js');
const status = await import('./[idempotencyKey]/route.js');

const userId = '11111111-1111-4111-8111-111111111111';
const key = 'adj-key-1';
const body = { userId, delta: 10, reason: '客服补偿', idempotencyKey: key };

function allowed(adminAccountId = 'admin-1') {
  mocks.guard.mockResolvedValue({
    ok: true,
    auth: { adminAccountId, credentialVersion: 1, sessionId: 'SECRET', expiresAt: new Date(), account: {} },
  });
}

function post(payload: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/admin/wallet/adjustments', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000', 'content-type': 'application/json',
      'x-admin-request': '1', 'x-request-id': 'request-1', ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  allowed();
  mocks.adjust.mockResolvedValue({ transactionId: 'tx-1', balanceAfter: 15, alreadyAdjusted: false });
  mocks.finalize.mockResolvedValue(undefined);
  mocks.adminUserExists.mockResolvedValue(true);
  mocks.getStatus.mockResolvedValue({ transaction: { id: 'tx-1', balanceAfter: 15 }, audit: { result: 'committed' }, complete: true });
});

describe('POST /api/admin/wallet/adjustments', () => {
  it('never adjusts without an admin identity and stays private/no-store', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await collection.POST(post(body));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('sends exactly the documented parameters with the actor from the session', async () => {
    const response = await collection.POST(post(body));
    expect(response.status).toBe(201);
    expect(mocks.adjust).toHaveBeenCalledWith(userId, 10, key, '客服补偿',
      { kind: 'admin_account', adminAccountId: 'admin-1' },
      { dedupeKey: `wallet_adjustment:${key}`, requestId: 'request-1' });
    expect(mocks.finalize).toHaveBeenCalledWith(`wallet_adjustment:${key}`);
    expect(await response.json()).toEqual({ transactionId: 'tx-1', balanceAfter: 15, alreadyAdjusted: false });
  });

  it('answers a replay with 200 and the original result without a second adjustment', async () => {
    mocks.adjust.mockResolvedValue({ transactionId: 'tx-1', balanceAfter: 15, alreadyAdjusted: true });
    const response = await collection.POST(post(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transactionId: 'tx-1', alreadyAdjusted: true });
  });

  it('rejects missing reason, zero delta, a non-integer delta, a non-UUID user and any extra field', async () => {
    for (const payload of [
      { ...body, reason: '   ' },
      { ...body, reason: undefined },
      { ...body, delta: 0 },
      { ...body, delta: 1.5 },
      { ...body, delta: -1_000_001 },
      { ...body, userId: 'not-a-uuid' },
      { ...body, idempotencyKey: '  ' },
      { ...body, actor: { kind: 'admin_account', adminAccountId: 'forged' } },
      { ...body, balanceAfter: 999 },
    ]) {
      const response = await collection.POST(post(payload));
      expect(response.status, JSON.stringify(payload)).toBe(400);
    }
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('reports a reused key with different parameters as a precise 409 and does not finalize', async () => {
    mocks.adjust.mockRejectedValue(new mocks.WalletAdjustmentConflictError());
    const response = await collection.POST(post(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'wallet_adjustment_idempotency_conflict' });
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('reports a would-be negative balance as 409 instead of a dependency outage', async () => {
    mocks.adjust.mockRejectedValue(new mocks.InsufficientBalanceError());
    const response = await collection.POST(post({ ...body, delta: -99 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'insufficient_wallet_balance' });
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('refuses an unknown target user before touching the ledger', async () => {
    mocks.adminUserExists.mockResolvedValue(false);
    const response = await collection.POST(post(body));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'admin_user_not_found' });
    expect(mocks.adjust).not.toHaveBeenCalled();
  });

  it('returns the audit-pending shape when the post-commit audit settle fails, never claiming full success', async () => {
    mocks.finalize.mockRejectedValue(new Error('admin_audit_write_failed'));
    const response = await collection.POST(post(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'admin_audit_pending',
      dedupeKey: `wallet_adjustment:${key}`,
      transactionId: 'tx-1',
      balanceAfter: 15,
    });
  });
});

describe('GET /api/admin/wallet/adjustments/:idempotencyKey', () => {
  const context = { params: Promise.resolve({ idempotencyKey: key }) };

  it('never reads without an admin identity', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'admin_unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } }),
    });
    const response = await status.GET(new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${key}`), context);
    expect(response.status).toBe(401);
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it('returns the stored result and audit completion for the operator to re-query', async () => {
    const response = await status.GET(new NextRequest(`http://localhost:3000/api/admin/wallet/adjustments/${key}`, {
      headers: { cookie: 'admin_session_v2=token' },
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.getStatus).toHaveBeenCalledWith(key);
    expect(await response.json()).toMatchObject({ complete: true, transaction: { id: 'tx-1', balanceAfter: 15 } });
  });

  it('refuses an over-long key instead of querying with it', async () => {
    const response = await status.GET(
      new NextRequest('http://localhost:3000/api/admin/wallet/adjustments/long'),
      { params: Promise.resolve({ idempotencyKey: 'k'.repeat(129) }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });
});
