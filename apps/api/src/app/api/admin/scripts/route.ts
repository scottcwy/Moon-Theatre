import { adminJsonError as jsonError } from '@/server/modules/admin/security.js';
import { adminSuccessResponse as successResponse } from '@/server/modules/admin/security.js';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import { createScriptDraft, listAdminScripts } from '@/server/modules/admin/index.js';
import { formatZodIssues, readJsonBody, ValidationError } from '@/server/http/errors.js';

const schema = z.object({ title: z.string().min(1).max(128), description: z.string().min(1), worldSetting: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/).max(128), genre: z.string().min(1).max(128), searchKeywords: z.string().max(1000).optional(), coverUrl: z.string().url().max(512).nullable().optional(), sortOrder: z.number().int().optional() });
export async function GET(request: NextRequest) { const auth = await verifyAdminAuth(request); if (!auth.ok) return auth.response; try { return successResponse({ items: await listAdminScripts() }); } catch (e) { return jsonError(e); } }
export async function POST(request: NextRequest) { const auth = await verifyAdminAuth(request); if (!auth.ok) return auth.response; try { const parsed = schema.safeParse(await readJsonBody(request)); if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues)); return successResponse(await createScriptDraft({ kind: 'admin_account', adminAccountId: auth.auth.adminAccountId }, parsed.data), 201); } catch (e) { return jsonError(e); } }
