import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { finalizeWalletAdjustmentAudit } from '@/server/modules/admin/billing.js';

export async function POST(request: NextRequest, { params }: { params: Promise<{ idempotencyKey: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const { idempotencyKey } = await params;
    return successResponse(await finalizeWalletAdjustmentAudit(
      idempotencyKey,
      { kind: 'admin_account', adminAccountId: admin.auth.adminAccountId },
      request.headers.get('x-request-id') ?? undefined,
    ));
  } catch (error) {
    return jsonError(error);
  }
}
