import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { adminJsonError as jsonError, adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import {
  getTurnVersionAttributions,
} from '@/server/modules/chat/index.js';
import { listMessages, recordAdminAudit } from '@/server/modules/admin/index.js';
import { HttpError } from '@/server/http/errors.js';
import { parseAdminQuery } from '@/server/modules/admin/query.js';
import { actorOf, requestIdOf, requireUuid } from '../../../shared.js';

/** Bounded page window; the full transcript is never downloaded in one request. */
const transcriptQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

interface TranscriptMessage {
  id: string;
  role: string;
  content: string;
  mood: string | null;
  modelTier: string | null;
  tokensUsed: number | null;
  pointsConsumed: number | null;
  createdAt: Date;
}

/**
 * Paginated chat transcript with per-turn version attribution. The original text is returned only
 * after the access audit is committed; an audit failure answers 503 without any message body.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const id = requireUuid((await params).id);
    const query = parseAdminQuery(transcriptQuerySchema, new URL(request.url).searchParams);
    const result = await listMessages({ sessionId: id, page: query.page, pageSize: query.pageSize });
    const items = result.items as TranscriptMessage[];
    // Snapshots are keyed by the accepted user message, so only those can carry a version; a
    // message without one stays explicitly `versionUnknown` (版本未知) and is never inferred.
    const attributions = await getTurnVersionAttributions(
      items.filter(message => message.role === 'user').map(message => message.id),
    );
    try {
      await recordAdminAudit({
        actor: actorOf(admin.auth),
        action: 'admin.chat_session.read',
        objectType: 'chat_session',
        objectId: id,
        requestId: requestIdOf(request),
        result: 'committed',
        summary: { page: result.page, pageSize: result.pageSize, messageCount: items.length },
      });
    } catch {
      return jsonError(new HttpError('admin_audit_unavailable', 503));
    }
    return successResponse({ ...result, attributions });
  } catch (error) {
    return jsonError(error);
  }
}
