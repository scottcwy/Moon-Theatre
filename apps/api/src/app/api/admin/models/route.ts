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
    const body = await request.json() as { id?: string; enabled?: boolean; pointsPerCall?: number; displayName?: string; description?: string | null };
    if (!body.id || (body.pointsPerCall !== undefined && (!Number.isInteger(body.pointsPerCall) || body.pointsPerCall < 0))) return jsonError(new Error('Invalid model update'));
    return successResponse({ model: await updateAdminModel(body.id, body) });
  } catch (e) { return jsonError(e); }
}
