import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listWalletTransactions } from '@/server/modules/admin/index.js';
import { listWalletTransactionsQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';
import { jsonError } from '@/server/http/errors.js';

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
    const query = parseAdminQuery(listWalletTransactionsQuerySchema, url.searchParams);
    const result = await listWalletTransactions(query);
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
