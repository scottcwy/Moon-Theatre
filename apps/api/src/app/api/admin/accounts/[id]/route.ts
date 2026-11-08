import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminJsonError, adminSuccessResponse } from '@/server/modules/admin/security.js';
import { z } from 'zod';
import { disableAdminAccount } from '@/server/modules/admin/accounts.js';
const schema = z.object({ active: z.literal(false) }).strict();
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await verifyAdminAuth(request);
  if (!result.ok) return result.response;
  try {
    schema.parse(await readJsonBody(request));
    return adminSuccessResponse({ account: await disableAdminAccount(result.auth, (await params).id) });
  } catch (error) { return adminJsonError(error); }
}
