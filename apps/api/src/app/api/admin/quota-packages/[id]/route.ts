import { NextRequest } from 'next/server';
import { quotaPackageUpdateSchema, updateQuotaPackage } from '@/server/modules/admin/index.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { actorOf, requestIdOf, requireUuid } from '../../shared.js';

/**
 * Edits one quota package (AC-13): name, integer-cent price, points, sort order, recommendation and
 * availability. `active:false` is the archive action — there is no hard delete and no route that
 * rewrites existing orders. The strict body refuses a client actor or any undeclared field. A patch
 * equal to the stored row is an explicit no-op (`changed:false`, no audit row); a real change and its
 * audit event commit together under the authenticated administrator, and only affect later orders.
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const body = quotaPackageUpdateSchema.parse(await request.json());
    const result = await updateQuotaPackage(id, body, { actor: actorOf(admin.auth), requestId: requestIdOf(request) });
    return successResponse(result);
  } catch (error) {
    return jsonError(error);
  }
}
