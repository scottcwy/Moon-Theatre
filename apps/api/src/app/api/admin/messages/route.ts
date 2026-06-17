import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { listMessages } from '@/server/modules/admin/index.js';
import { listMessagesQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';
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
    const query = parseAdminQuery(listMessagesQuerySchema, url.searchParams);
    const result = await listMessages(query);
    return successResponse(result);
  } catch (err) {
    return jsonError(err);
  }
}
