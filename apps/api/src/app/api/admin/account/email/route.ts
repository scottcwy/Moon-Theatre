import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminJsonError, adminSuccessResponse, expireAdminCookie } from '@/server/modules/admin/security.js';
import { changeOwnEmail, ownEmailSchema } from '@/server/modules/admin/accounts.js';
export async function PATCH(request: NextRequest) {
  const result = await verifyAdminAuth(request);
  if (!result.ok) return result.response;
  try {
    const data = ownEmailSchema.parse(await readJsonBody(request));
    const account = await changeOwnEmail(result.auth, data);
    return expireAdminCookie(adminSuccessResponse({ account, authenticated: false }));
  } catch (error) { return adminJsonError(error); }
}
