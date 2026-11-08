import { NextRequest } from 'next/server';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { checkAdminModelConsistency } from '@/server/modules/admin/index.js';
import { requireUuid } from '../../../shared.js';

/**
 * Configuration consistency check (AC-15 / AC-17 / AC-27) — read-only, credential-free.
 *
 * Reads the tier's declared provider/model/parameters and what FastClaw reports for the mapped agents
 * (`GET /v1/agents/{id}/runtime-spec`) and answers `match | mismatch | unavailable`. It does NOT call
 * `POST /api/test-provider`: that endpoint requires provider credentials in the request body and the
 * console must never hold one. There is no write here — the tier row and its version chain are
 * untouched, asserted by tests.
 *
 * `unavailable` is a first-class answer, not an error and not success: the console renders it as
 * "无法核对" and never as a passed check.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    return successResponse({ check: await checkAdminModelConsistency(id) });
  } catch (error) {
    return jsonError(error);
  }
}
