import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { getOrderDetail } from '@/server/modules/admin/index.js';
import { jsonError } from '@/server/http/errors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  try {
    const { id } = await params;
    const detail = await getOrderDetail(id);
    return successResponse(detail);
  } catch (err) {
    return jsonError(err);
  }
}
