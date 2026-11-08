import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConflictError } from '@/server/http/errors.js';
const { guard, finalize } = vi.hoisted(() => ({ guard: vi.fn(), finalize: vi.fn() }));
vi.mock('@/server/middleware/auth.js', () => ({ verifyAdminAuth: guard, successResponse: (data: unknown) => Response.json(data) }));
vi.mock('@/server/modules/admin/billing.js', () => ({ finalizeWalletAdjustmentAudit: finalize }));
import { POST } from './route.js';
const request = () => new NextRequest('http://localhost/api/admin/wallet/adjustments/key/finalize-audit', { method: 'POST', headers: { 'x-request-id': 'request-1' } });
const context = { params: Promise.resolve({ idempotencyKey: 'key' }) };
beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ ok: true, auth: { adminAccountId: 'independent-admin' } }); finalize.mockResolvedValue({ transactionId: 'tx', balanceAfter: 5, alreadyFinalized: false }); });
it('uses current guard identity, not client actor or monetary inputs', async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(finalize).toHaveBeenCalledWith('key', { kind: 'admin_account', adminAccountId: 'independent-admin' }, 'request-1');
});
it('denies before service and returns verification conflicts as 409', async () => {
  guard.mockResolvedValueOnce({ ok: false, response: Response.json({ error: 'unauthorized' }, { status: 401 }) });
  expect((await POST(request(), context)).status).toBe(401);
  expect(finalize).not.toHaveBeenCalled();
  finalize.mockRejectedValueOnce(new ConflictError('wallet_adjustment_audit_conflict'));
  expect((await POST(request(), context)).status).toBe(409);
});
