import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { unpublishCharacter } from '@/server/modules/admin/index.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

const emptyBodySchema = z.object({}).strict();

/** Removes public visibility and new-session eligibility only; history, versions and audits stay. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    emptyBodySchema.parse(await request.json().catch(() => ({})));
    return successResponse(await unpublishCharacter(actorOf(admin.auth), id, requestIdOf(request)));
  } catch (error) {
    return jsonError(error);
  }
}
