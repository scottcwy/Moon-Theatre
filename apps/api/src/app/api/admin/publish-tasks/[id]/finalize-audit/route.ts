import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import {
  finalizeCharacterPublishAudit,
  finalizeScriptPublishAudit,
  getPublishTask,
} from '@/server/modules/admin/index.js';
import { ConflictError } from '@/server/http/errors.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/**
 * Finalize-only recovery for an existing publish-task audit intent. The task identifies the entity
 * type; only the persisted business result is verified, no publish is re-run, and the current admin
 * is recorded as the recoverer.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const { task } = await getPublishTask(id);
    const actor = actorOf(admin.auth);
    const requestId = requestIdOf(request);
    if (task.entityType === 'character') {
      return successResponse(await finalizeCharacterPublishAudit(actor, task.idempotencyKey, requestId));
    }
    if (task.entityType === 'script') {
      return successResponse(await finalizeScriptPublishAudit(actor, task.idempotencyKey, requestId));
    }
    throw new ConflictError('audit_recovery_conflict');
  } catch (error) {
    return jsonError(error);
  }
}
