import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { getWalletAdjustmentStatus } from '@/server/modules/admin/index.js';
import { jsonError } from '@/server/http/errors.js';

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
