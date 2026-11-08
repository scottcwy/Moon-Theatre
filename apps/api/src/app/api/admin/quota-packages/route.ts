import { NextRequest } from 'next/server';
import { createQuotaPackage, listQuotaPackages, quotaPackageInputSchema } from '@/server/modules/admin/index.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminPreflightResponse as corsPreflightResponse } from '@/server/modules/admin/security.js';
import { actorOf, requestIdOf } from '../shared.js';

/**
 * Quota package maintenance (AC-13).
 *
 * GET  — every package in deterministic `sortOrder, id` order. Inactive packages stay visible so the
 *        operator can re-enable them; the public list/purchase path filters on `active`.
 * POST — creates one package. Body is strict: a client `actor`, an order field or a yuan float price
 *        is a 400 before any write. The real administrator is the audit actor and the audit row is
 *        written in the same transaction as the package. There is deliberately no DELETE handler:
 *        "archive" is `PATCH {active:false}`, and history (orders) keeps referencing the row.
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    return successResponse({ packages: await listQuotaPackages() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const body = quotaPackageInputSchema.parse(await request.json());
    const result = await createQuotaPackage(body, { actor: actorOf(admin.auth), requestId: requestIdOf(request) });
    return successResponse(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}
