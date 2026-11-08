import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { getWalletAdjustmentStatus } from '@/server/modules/admin/index.js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ idempotencyKey: string }> },
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const { idempotencyKey } = await params;
    return successResponse(await getWalletAdjustmentStatus(idempotencyKey));
  } catch (error) {
    return jsonError(error);
  }
}
