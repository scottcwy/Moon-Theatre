import { NextRequest } from 'next/server';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { listAdminModels, updateAdminModel } from '@/server/modules/admin/index.js';
import { modelProfileUpdateSchema } from '@/server/modules/admin/model-schemas.js';
import { actorOf, requestIdOf } from '../shared.js';

/**
 * Model tier console (AC-15 / AC-17).
 *
 * GET  — every tier with its live configuration. Registered agents can read this; nothing secret is in
 *        it (no key, no `credentialRef`, no chat text).
 * POST — not implemented: tiers are created by migration/seed, not by the console.
 * PATCH — one accepted configuration change (`enabled`, `pointsPerCall`, `displayName`, `description`,
 *        `provider`, `modelName`, declared `runtimeParams`). The body is strict: a credential field, a
 *        `tier` change or an undeclared key is a 400 before any write; `expectedUpdatedAt` guards
 *        against overwriting another operator's save (409 `model_edit_conflict`, never a silent write);
 *        the change writes exactly one immutable version + one recoverable audit intent.
 */
export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    return successResponse({ models: await listAdminModels() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const body = modelProfileUpdateSchema.parse(await request.json());
    const { id, idempotencyKey, expectedUpdatedAt, ...update } = body;
    const result = await updateAdminModel(
      actorOf(admin.auth),
      id,
      idempotencyKey,
      expectedUpdatedAt,
      update,
      requestIdOf(request),
    );
    return successResponse(result, result.auditStatus === 'pending' ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}
