import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { listWalletAccounts } from '@/server/modules/admin/index.js';
import { listWalletAccountsQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';

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
    const query = parseAdminQuery(listWalletAccountsQuerySchema, url.searchParams);
    const result = await listWalletAccounts(query);
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
