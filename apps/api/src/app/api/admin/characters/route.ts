import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import {
  adminJsonError as jsonError,
  adminSuccessResponse as successResponse,
} from '@/server/modules/admin/security.js';
import { createCharacterDraft, listAdminCharacters } from '@/server/modules/admin/index.js';
import { listAdminCharactersQuerySchema, parseAdminQuery } from '@/server/modules/admin/query.js';
import { ContentValidationError } from '@/server/modules/content/validation.js';
import { actorOf, requestIdOf } from '../shared.js';

/**
 * Bounded, searchable character list (AC-18). `q` matches the character name, the agent id or the
 * bound script title; `status` filters the publish state; `page`/`pageSize` bound the page (max 100).
 * An unusable term or an unknown status is a `400` with Chinese copy instead of a silently ignored
 * filter, and the response carries the page facts so the caller never counts rows to page.
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const query = parseAdminQuery(listAdminCharactersQuerySchema, new URL(request.url).searchParams);
    const result = await listAdminCharacters({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.q ? { query: query.q } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
    return successResponse(result);
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Strict creation body: every display field, the persona and the agent id are explicit. A client
 * actor, status or script snapshot is a 400 before any service call. The service validates the
 * content contract and refuses an agent id outside the versioned roleplay agent contract.
 */
const createBodySchema = z.object({
  name: z.string(),
  avatarUrl: z.string(),
  identity: z.string(),
  description: z.string(),
  initialRelationship: z.string(),
  agentId: z.string(),
  scriptId: z.string().uuid().nullable(),
  sortOrder: z.number().int().min(0).max(100000),
  starterQuestions: z.object({ script: z.array(z.string()), free: z.array(z.string()) }),
  prompt: z.object({
    systemPrompt: z.string(),
    personalityPrompt: z.string(),
    scenarioPrompt: z.string(),
    safetyPrompt: z.string(),
    outputFormatPrompt: z.string(),
  }),
}).strict();

/** Creates one inactive character with draft version 1 and no published pointer (§3 新建角色). */
export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request);
  if (!admin.ok) return admin.response;
  try {
    const body = createBodySchema.parse(await request.json());
    const record = await createCharacterDraft(actorOf(admin.auth), body, requestIdOf(request));
    return successResponse({
      id: record.id,
      versionId: record.versionId,
      versionNo: record.versionNo,
      updatedAt: record.updatedAt,
      status: record.status,
      publishedVersionId: record.publishedVersionId,
    });
  } catch (error) {
    // Field-level messages come from the shared content contract, not from a generic failure code.
    if (error instanceof ContentValidationError) {
      return successResponse({ error: 'character_draft_invalid', issues: error.issues }, 400);
    }
    return jsonError(error);
  }
}
