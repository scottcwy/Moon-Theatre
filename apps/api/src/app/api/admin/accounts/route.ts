import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminJsonError, adminSuccessResponse } from '@/server/modules/admin/security.js';
import { createAdminAccount, listAdminAccounts, createAdminAccountSchema } from '@/server/modules/admin/accounts.js';
export async function GET(request: NextRequest) {
  const result = await verifyAdminAuth(request);
  if (!result.ok) return result.response;
  try { return adminSuccessResponse({ accounts: await listAdminAccounts(result.auth) }); }
  catch (error) { return adminJsonError(error); }
}
export async function POST(request: NextRequest) {
  const result = await verifyAdminAuth(request);
  if (!result.ok) return result.response;
  try {
    const data = createAdminAccountSchema.parse(await readJsonBody(request));
    return adminSuccessResponse({ account: await createAdminAccount(result.auth, data) }, 201);
  } catch (error) { return adminJsonError(error); }
}
