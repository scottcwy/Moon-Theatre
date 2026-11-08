import { NextRequest } from 'next/server';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { listAdminModelVersions } from '@/server/modules/admin/index.js';
import { requireUuid } from '../../../shared.js';

/**
 * Append-only version history of one tier (AC-15 / AC-17).
 *
 * Newest first, with the current version flagged by the same rule the chat runtime uses (highest
 * `version_no` with `status='published'`). Each row carries creator email (or none, for a capture),
 * time, `configHash` and the allowlisted declared parameters — never a credential, a provider row or a
 * raw stored JSON blob. There is deliberately no handler that rewrites or deletes a version.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    return successResponse({ versions: await listAdminModelVersions(id) });
  } catch (error) {
    return jsonError(error);
  }
}
