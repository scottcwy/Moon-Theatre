import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { getAdminUser, setAdminUserStatus } from '@/server/modules/admin/index.js';
import { actorOf, requestIdOf, requireUuid } from '../../shared.js';

/**
 * One player's profile and the ban/unban switch (AC-11).
 *
 * GET   — account fields, wallet summary, session/message totals, last activity and the recent
 *         sessions (ids only; links are the UI's job). No persona text, no chat bodies, no raw
 *         openid, no credentials.
 * PATCH — `{status:'active'|'banned'}` only, strict: an `actor`, a wallet field or any other key is
 *         refused. The actor is always the authenticated administrator, never the client. Banning
 *         changes `users.status` only: the player's already-issued JWT stops authorizing new business
 *         requests through `verifyAuth`, and unban restores it. Wallet balances, wallet transactions,
 *         sessions, messages and the user row itself are never touched.
 */
const statusBodySchema = z.object({ status: z.enum(['active', 'banned']) }).strict();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    return successResponse(await getAdminUser(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const body = statusBodySchema.parse(await request.json().catch(() => ({})));
    return successResponse(await setAdminUserStatus(actorOf(admin.auth), id, body.status, requestIdOf(request)));
  } catch (error) {
    return jsonError(error);
  }
}
