import { NextRequest } from 'next/server';
import { z } from 'zod';
import { exchangeWeChatCode, findOrCreateUser, signJwt } from '@/server/modules/auth/index.js';
import { errorResponse, successResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse, withCors } from '@/server/middleware/cors.js';

const wechatLoginSchema = z.object({
  code: z.string().min(1),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = wechatLoginSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse('Invalid request: code is required', 400);
    }

    const { openid } = await exchangeWeChatCode(parsed.data.code);
    const user = await findOrCreateUser(openid);
    const token = await signJwt(user.id);

    return successResponse({
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}