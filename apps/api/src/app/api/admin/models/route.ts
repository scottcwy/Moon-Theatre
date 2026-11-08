import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { ValidationError } from '@/server/http/error-types.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { listAdminModels, updateAdminModel } from '@/server/modules/admin/models.js';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request); if (!auth.ok) return auth.response;
  try { return successResponse({ models: await listAdminModels() }); } catch (e) { return jsonError(e); }
}

export async function PATCH(request: NextRequest) {
  const auth = await verifyAdminAuth(request); if (!auth.ok) return auth.response;
  try {
    const body = await request.json() as {
      id?: string;
      idempotencyKey?: string;
      expectedUpdatedAt?: string;
      enabled?: boolean;
      pointsPerCall?: number;
      displayName?: string;
      description?: string | null;
    };
    if (
      !body.id ||
      !body.idempotencyKey ||
      !body.expectedUpdatedAt ||
      (body.pointsPerCall !== undefined && (!Number.isInteger(body.pointsPerCall) || body.pointsPerCall < 0))
    ) {
      return jsonError(new ValidationError('admin_input_invalid'));
    }
    const result = await updateAdminModel(
      { kind: 'admin_account', adminAccountId: auth.auth.adminAccountId },
      body.id,
      body.idempotencyKey,
      body.expectedUpdatedAt,
      body,
      request.headers.get('x-request-id') ?? undefined,
    );
    return successResponse(result, result.auditStatus === 'pending' ? 202 : 200);
  } catch (e) { return jsonError(e); }
}
