import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { listMessages, recordAdminAudit } from '@/server/modules/admin/index.js';
import { listMessagesQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';
import { HttpError } from '@/server/http/errors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }
  try {
    const url = new URL(request.url);
    const query = parseAdminQuery(listMessagesQuerySchema, url.searchParams);
    const result = await listMessages(query);
    try {
      await recordAdminAudit({
        actor: { kind: 'admin_account', adminAccountId: admin.auth.adminAccountId },
        action: 'admin.messages.read',
        objectType: 'chat_session',
        objectId: query.sessionId,
        requestId: request.headers.get('x-request-id') ?? undefined,
        result: 'committed',
        summary: { page: query.page, pageSize: query.pageSize, count: result.items.length },
      });
    } catch {
      return jsonError(new HttpError('admin_audit_unavailable', 503));
    }
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
