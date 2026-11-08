import { adminSuccessResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function PATCH(
  request: NextRequest,
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  return adminSuccessResponse({ error: 'Memory administration is retired; memories are immutable from admin APIs' }, 410);
}
