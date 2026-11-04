import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { jsonError } from '@/server/http/errors.js';
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
      return jsonError(new Error('Invalid model update'));
    }
    const result = await updateAdminModel(
      auth.auth.userId,
      body.id,
      body.idempotencyKey,
      body.expectedUpdatedAt,
      body,
      request.headers.get('x-request-id') ?? undefined,
    );
    return successResponse(result, result.auditStatus === 'pending' ? 202 : 200);
  } catch (e) { return jsonError(e); }
}
