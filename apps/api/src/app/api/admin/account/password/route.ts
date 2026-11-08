import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminJsonError, adminSuccessResponse, expireAdminCookie } from '@/server/modules/admin/security.js';
import { changeOwnPassword, ownPasswordSchema } from '@/server/modules/admin/accounts.js';
export async function POST(request: NextRequest) {
  const result = await verifyAdminAuth(request, { allowRestricted: true });
  if (!result.ok) return result.response;
  try {
    const data = ownPasswordSchema.parse(await readJsonBody(request));
    const account = await changeOwnPassword(result.auth, data);
    return expireAdminCookie(adminSuccessResponse({ account, authenticated: false }));
  } catch (error) { return adminJsonError(error); }
}
