import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { getCharacterPreview } from '@/server/modules/admin/index.js';
import { requireUuid } from '../../../shared.js';

/**
 * Display-only preview of one immutable version (published by default, a draft on request):
 * script card, character detail and starter questions plus the validity marker. The stored persona
 * payload stays server-side and is never part of this response.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const requested = new URL(request.url).searchParams.get('versionId');
    return successResponse(await getCharacterPreview(id, requested ? requireUuid(requested) : undefined));
  } catch (error) {
    return jsonError(error);
  }
}
