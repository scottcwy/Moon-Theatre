import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adjustWalletPoints, InsufficientBalanceError, WalletAdjustmentConflictError } from '@/server/modules/wallet/index.js';
import { adminUserExists, finalizeAdminAudit } from '@/server/modules/admin/index.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { ConflictError, HttpError, readJsonBody } from '@/server/http/errors.js';

/**
 * Manual adjustment (AC-14). The actor is always the authenticated administrator; the strict body
 * carries exactly the target user, the signed delta, the required reason and the operator-visible
 * idempotency key. The five parameters that make a replay identical are compared by the ledger
 * service, which serializes on the key and refuses a negative balance.
 */
const adjustmentSchema = z.object({
  userId: z.string().uuid('目标用户 ID 需为完整 UUID'),
  delta: z.number().int('调整量须为整数')
    .min(-1_000_000, '调整量绝对值不能超过 1000000')
    .max(1_000_000, '调整量绝对值不能超过 1000000')
    .refine((value) => value !== 0, '调整量不能为 0，正数为增加、负数为扣减'),
  idempotencyKey: z.string().trim().min(1, '幂等标识不能为空').max(128, '幂等标识最多 128 个字符'),
  reason: z.string().trim().min(1, '必须填写调整原因').max(256, '调整原因最多 256 个字符'),
}).strict();

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const parsed = adjustmentSchema.parse(await readJsonBody(request));
    if (!await adminUserExists(parsed.userId)) throw new HttpError('admin_user_not_found', 404);

    const dedupeKey = `wallet_adjustment:${parsed.idempotencyKey}`;
    const result = await adjustWalletPoints(
      parsed.userId,
      parsed.delta,
      parsed.idempotencyKey,
      parsed.reason,
      { kind: 'admin_account', adminAccountId: admin.auth.adminAccountId },
      {
        dedupeKey,
        requestId: request.headers.get('x-request-id') ?? undefined,
      },
    );
    try {
      await finalizeAdminAudit(dedupeKey);
    } catch {
      return successResponse({
        error: 'admin_audit_pending',
        dedupeKey,
        transactionId: result.transactionId,
        balanceAfter: result.balanceAfter,
      }, 503);
    }
    return successResponse(result, result.alreadyAdjusted ? 200 : 201);
  } catch (error) {
    if (error instanceof WalletAdjustmentConflictError) {
      // Same key, different actor/user/direction/amount/reason: one stable code the console can map.
      return successResponse({ error: error.code }, 409);
    }
    if (error instanceof InsufficientBalanceError) {
      return jsonError(new ConflictError(error.code));
    }
    return jsonError(error);
  }
}
