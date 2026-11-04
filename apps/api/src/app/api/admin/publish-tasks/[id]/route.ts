import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { getPublishTask } from '@/server/modules/admin/index.js';
import { jsonError } from '@/server/http/errors.js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    return successResponse(await getPublishTask(id));
  } catch (error) {
    return jsonError(error);
  }
}
