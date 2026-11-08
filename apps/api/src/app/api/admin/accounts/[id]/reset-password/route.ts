import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { readJsonBody } from '@/server/http/errors.js';
import { adminJsonError, adminSuccessResponse } from '@/server/modules/admin/security.js';
import { z } from 'zod';
import { resetAdminPassword } from '@/server/modules/admin/accounts.js';
const schema = z.object({ password: z.string() }).strict();
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await verifyAdminAuth(request);
  if (!result.ok) return result.response;
  try {
    const data = schema.parse(await readJsonBody(request));
    return adminSuccessResponse({ account: await resetAdminPassword(result.auth, (await params).id, data.password) });
  } catch (error) { return adminJsonError(error); }
}
