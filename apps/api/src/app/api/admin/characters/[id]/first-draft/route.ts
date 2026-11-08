import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { createFirstCharacterDraft } from '@/server/modules/admin/index.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

const emptyBodySchema = z.object({}).strict();

/**
 * Creates the first draft version of an *existing* character that has no content version at all
 * (inactive legacy rows the §5.3 capture never tamed, rows created before versioning). It is an
 * explicit operator action, never a write on page load: without it such a character can never be
 * edited, completed or published, and its one-time agent assignment stays unreachable.
 *
 * The body is empty on purpose — the seed comes from the stored row and prompts on the server.
 * Concurrent calls answer the documented 409 (`character_first_draft_exists`) for the loser, so
 * only one version 1 can ever be created; afterwards the normal draft/publish routes take over.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    emptyBodySchema.parse(await request.json().catch(() => ({})));
    return successResponse(await createFirstCharacterDraft(actorOf(admin.auth), id, requestIdOf(request)));
  } catch (error) {
    return jsonError(error);
  }
}
