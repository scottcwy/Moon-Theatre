import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { readCharacterBaseContext, rebuildCharacterBaseContext } from '@/server/modules/admin/index.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/**
 * Base context (SOUL.md / IDENTITY.md / USER.md) of a roleplay agent.
 *
 * GET  — the drift state: the latest recorded `agent_context_version` versus the live FastClaw files.
 *        `in-sync | drifted | unavailable | unrecorded`; an unreadable FastClaw is `unavailable`, never
 *        a claimed sync.
 * POST — the explicit manual rebuild from the published version (overwrites a FastClaw-console hand
 *        edit, retries a `pending`/`failed` publish sync). Idempotent by content: identical output
 *        never records a second version.
 *
 * Both are read/repair actions on a derived cache: nothing here changes the published version or the
 * runtime prompt assembly.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    return successResponse({ baseContext: await readCharacterBaseContext(id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const result = await rebuildCharacterBaseContext({
      actor: actorOf(admin.auth),
      characterId: id,
      requestId: requestIdOf(request),
    });
    return successResponse(result);
  } catch (error) {
    return jsonError(error);
  }
}
