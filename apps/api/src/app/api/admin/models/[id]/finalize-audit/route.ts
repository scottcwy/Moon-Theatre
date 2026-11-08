import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { finalizeModelPublishAudit, listAdminAuditLogs } from '@/server/modules/admin/index.js';
import { ConflictError } from '@/server/http/errors.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

const AUDIT_KEY_PREFIX = 'model_profile_publish:';
const PENDING_AUDIT_SCAN_LIMIT = 100;

/**
 * Finalize-only recovery for a model publish audit intent that is still pending. The route path
 * identifies the model profile; the pending intent is resolved from the audit log and must be
 * unambiguous. No model configuration is re-published and no business result is recomputed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const pending = (await listAdminAuditLogs({ result: 'audit_pending', limit: PENDING_AUDIT_SCAN_LIMIT }))
      .filter(audit => audit.action === 'admin.model.publish' && audit.objectId === id &&
        typeof audit.dedupeKey === 'string' && audit.dedupeKey.startsWith(AUDIT_KEY_PREFIX));
    const intent = pending.length === 1 ? pending[0] : null;
    // No pending intent, or more than one: the intent cannot be confirmed, so nothing is finalized.
    if (!intent) throw new ConflictError('model_publish_audit_conflict');
    return successResponse(await finalizeModelPublishAudit(
      actorOf(admin.auth),
      intent.dedupeKey!.slice(AUDIT_KEY_PREFIX.length),
      requestIdOf(request),
    ));
  } catch (error) {
    return jsonError(error);
  }
}
