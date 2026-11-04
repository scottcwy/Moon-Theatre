import { NextRequest } from 'next/server';
import { verifyAdminAuth, successResponse } from '@/server/middleware/auth.js';
import { listAdminCharacters } from '@/server/modules/admin/index.js';
import { jsonError } from '@/server/http/errors.js';
export async function GET(request: NextRequest) { const auth = await verifyAdminAuth(request); if (!auth.ok) return auth.response; try { return successResponse({ items: await listAdminCharacters() }); } catch (e) { return jsonError(e); } }
