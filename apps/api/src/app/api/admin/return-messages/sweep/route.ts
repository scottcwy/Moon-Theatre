import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { sweepReturnMessages } from '@/server/modules/return-messages/index.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) {
    return admin.response;
  }

  try {
    await sweepReturnMessages();
    return successResponse({ swept: true });
  } catch (err) {
    return jsonError(err);
  }
}
