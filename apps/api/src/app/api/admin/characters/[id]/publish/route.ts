import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { publishCharacter } from '@/server/modules/admin/index.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/** The bound version and the idempotency key are the whole input; everything else is server state. */
const publishBodySchema = z.object({
  versionId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const body = publishBodySchema.parse(await request.json());
    const result = await publishCharacter(
      actorOf(admin.auth),
      id,
      body.versionId,
      body.idempotencyKey,
      requestIdOf(request),
    );
    // 202 while the audit intent is still pending: the publish is not presented as complete success.
    return successResponse(result, result.auditStatus === 'pending' ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}
