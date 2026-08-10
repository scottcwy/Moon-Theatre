import { NextRequest } from 'next/server';
import { verifyAuth, unauthorizedResponse, errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { getCharacterChatEntries, getFrequentCharacterEntries } from '@/server/modules/chat/character-summary-service.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get('page'), DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    parsePositiveInteger(url.searchParams.get('limit'), DEFAULT_LIMIT),
  );
  const keyword = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const sort = (url.searchParams.get('sort') ?? '').trim().toLowerCase();

  try {
    if (sort === 'turn_count') {
      // 常聊角色：按成功轮数倒序的前 N 个可互动角色（模块 6）。
      const { entries, hasMore } = await getFrequentCharacterEntries(auth.userId, page, limit);
      return successResponse({ characters: entries, page, limit, hasMore });
    }

    // 默认：按角色聚合的聊天列表（模块 7 依赖该语义与字段，保持不变）。
    const { entries, hasMore } = await getCharacterChatEntries(auth.userId, page, limit, keyword);
    return successResponse({ characters: entries, page, limit, hasMore });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
