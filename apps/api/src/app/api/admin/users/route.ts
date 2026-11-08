import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import {
  adminJsonError as jsonError,
  adminPreflightResponse as corsPreflightResponse,
  adminSuccessResponse as successResponse,
} from '@/server/modules/admin/security.js';
import { listAdminUsers } from '@/server/modules/admin/index.js';
import { listAdminUsersQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';

/**
 * User search (AC-11 / §6). Read-only: `q` matches nickname substring, openid prefix or user-id
 * prefix and combines with the status filter and pagination. The term is trimmed and bounded, and an
 * unknown status is a `400` with Chinese copy rather than a silently ignored filter.
 */
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
    const query = parseAdminQuery(listAdminUsersQuerySchema, url.searchParams);
    const result = await listAdminUsers({ page: query.page, pageSize: query.pageSize, ...(query.q ? { query: query.q } : {}), ...(query.status ? { status: query.status } : {}) });
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
