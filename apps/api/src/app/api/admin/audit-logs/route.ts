import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { listAdminAuditLogs } from '@/server/modules/admin/index.js';

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;

  try {
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    return successResponse({
      items: await listAdminAuditLogs({
        ...(url.searchParams.get('dedupeKey') ? { dedupeKey: url.searchParams.get('dedupeKey')! } : {}),
        ...(url.searchParams.get('result') ? { result: url.searchParams.get('result')! } : {}),
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
