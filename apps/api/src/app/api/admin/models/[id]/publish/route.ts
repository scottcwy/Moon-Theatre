import { NextRequest } from 'next/server';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { publishAdminModel } from '@/server/modules/admin/index.js';
import { modelPublishSchema } from '@/server/modules/admin/model-schemas.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/**
 * Publish / restore one tier (AC-15 / AC-17).
 *
 *  - no `versionId`: publish the stored configuration as the current version. Already current → an
 *    explicit no-op (`created:false`), not a fabricated new version.
 *  - with `versionId`: RESTORE. The named version's payload is copied into a NEW version that becomes
 *    current. No existing version is rewritten, deactivated or deleted, and the audit summary records
 *    both the source version and the new one.
 *
 * Either way the tier row is updated in the same transaction, the audit intent is written with it and
 * finalized after commit (`202` while it is still pending, recoverable through `finalize-audit`).
 * A disabled tier can still be published/restored — it simply stays unusable for new turns, which the
 * console states instead of hiding.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const body = modelPublishSchema.parse(await request.json());
    const result = await publishAdminModel(
      actorOf(admin.auth),
      id,
      body.idempotencyKey,
      body.expectedUpdatedAt,
      body.versionId ? { versionId: body.versionId } : {},
      requestIdOf(request),
    );
    return successResponse(result, result.auditStatus === 'pending' ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}
