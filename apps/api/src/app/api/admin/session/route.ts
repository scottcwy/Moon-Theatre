import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminLoginSchema, loginAdmin, logoutAdmin } from '@/server/modules/admin/authentication.js';
import { adminClientIp, adminJsonError, adminSuccessResponse, expireAdminCookie, setAdminCookie, validateAdminWrite } from '@/server/modules/admin/security.js';

export async function POST(request: NextRequest) {
  try {
    validateAdminWrite(request);
    const data = adminLoginSchema.parse(await readJsonBody(request));
    const { token, identity } = await loginAdmin({ ...data, clientIp: adminClientIp(request.headers) });
    const response = adminSuccessResponse({ authenticated: true, account: identity.account, mustChangePassword: identity.account.mustChangePassword, expiresAt: identity.expiresAt });
    setAdminCookie(response, token, identity.expiresAt);
    return response;
  } catch (error) { return adminJsonError(error); }
}
export async function GET(request: NextRequest) {
  const result = await verifyAdminAuth(request, { allowRestricted: true });
  if (!result.ok) return result.response;
  const { account, expiresAt } = result.auth;
  return adminSuccessResponse({ authenticated: true, account, mustChangePassword: account.mustChangePassword, expiresAt });
}
export async function DELETE(request: NextRequest) {
  const result = await verifyAdminAuth(request, { allowRestricted: true });
  if (!result.ok) return result.response;
  try {
    await logoutAdmin(result.auth);
    return expireAdminCookie(adminSuccessResponse({ authenticated: false }));
  } catch (error) { return adminJsonError(error); }
}
