import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { getCharacterPreview, listPublishTasks, loadCharacterListItem } from '@/server/modules/admin/index.js';
import { NotFoundError } from '@/server/http/errors.js';
import { requireUuid } from '../../shared.js';

/**
 * Current published display data, the latest draft, the draft-versus-published changed field names
 * and the last publish task — reported separately, never collapsed into one status. The `preview`
 * follows the same default as the preview page (newest draft, then published).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const item = await loadCharacterListItem(id);
    if (!item) throw new NotFoundError('Character');
    const editable = item.draftState.hasDraft && item.draftState.draftVersionId
      ? { versionId: item.draftState.draftVersionId, versionNo: item.draftState.draftVersionNo, source: 'draft' as const }
      : item.publishState.publishedVersionId
        ? { versionId: item.publishState.publishedVersionId, versionNo: item.publishState.publishedVersionNo, source: 'published' as const }
        : null;
    return successResponse({
      character: {
        id: item.character.id,
        name: item.character.name,
        status: item.character.status,
        agentId: item.character.agentId,
        scriptId: item.character.scriptId,
        sortOrder: item.character.sortOrder,
        updatedAt: item.character.updatedAt,
      },
      publishState: item.publishState,
      draftState: item.draftState,
      lastPublishTask: item.lastPublishTask,
      // Bounded, newest first: the persisted attempt history the operator can trace (§5.2).
      publishTasks: await listPublishTasks('character', id, 5),
      editable,
      // Same default as the preview page: newest draft, else the published version. A character with
      // no version at all is still reported (with `preview: null`), never as a 404.
      preview: await getCharacterPreview(id).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
