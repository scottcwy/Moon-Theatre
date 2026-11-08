import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { updateCharacterDraft } from '@/server/modules/admin/index.js';
import type { CharacterDraftBaseline } from '@/server/modules/admin/index.js';
import { ContentValidationError, type CharacterDraft } from '@/server/modules/content/validation.js';
import { ValidationError } from '@/server/http/errors.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/** Strict body: the edit baseline plus the changed fields. A client actor or protected flag is a 400. */
const draftBodySchema = z.object({
  versionId: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().min(1).max(64).optional(),
  patch: z.record(z.unknown()),
}).strict();

/**
 * Saves one immutable draft version on top of the caller's edit baseline. A stale baseline is a
 * 409 the operator has to resolve by reloading or merging; nothing is silently overwritten.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const body = draftBodySchema.parse(await request.json());
    if (Boolean(body.versionId) === Boolean(body.expectedUpdatedAt)) {
      throw new ValidationError('admin_input_invalid');
    }
    const baseline: CharacterDraftBaseline = body.versionId
      ? { versionId: body.versionId }
      : { expectedUpdatedAt: body.expectedUpdatedAt! };
    const record = await updateCharacterDraft(
      actorOf(admin.auth),
      id,
      baseline,
      body.patch as Partial<CharacterDraft>,
      requestIdOf(request),
    );
    return successResponse({
      versionId: record.versionId,
      versionNo: record.versionNo,
      updatedAt: record.updatedAt,
      status: record.status,
      publishedVersionId: record.publishedVersionId,
    });
  } catch (error) {
    // Field-level messages come from the shared content contract, not from a generic failure code.
    if (error instanceof ContentValidationError) {
      return successResponse({ error: 'character_draft_invalid', issues: error.issues }, 400);
    }
    return jsonError(error);
  }
}
