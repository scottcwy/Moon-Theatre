import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { getSessionDetail, recordAdminAudit } from '@/server/modules/admin/index.js';
import { HttpError, jsonError } from '@/server/http/errors.js';

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
    const detail = await getSessionDetail(id);
    try {
      await recordAdminAudit({
        actorUserId: admin.auth.userId,
        action: 'admin.chat_session.read',
        objectType: 'chat_session',
        objectId: id,
        requestId: request.headers.get('x-request-id') ?? undefined,
        result: 'committed',
        summary: { messageCount: detail.messages.length },
      });
    } catch {
      return jsonError(new HttpError('admin_audit_unavailable', 503));
    }
    return successResponse(detail);
  } catch (err) {
    return jsonError(err);
  }
}
