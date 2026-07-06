import { SignJWT } from 'jose';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { config } from '../../config/index.js';
import { creditWallet } from '../wallet/index.js';

interface WeChatCode2SessionResponse {
  openid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export class WeChatCode2SessionError extends Error {
  constructor(
    public readonly code: number,
    public readonly upstreamMessage: string
  ) {
    super(`WeChat code2session failed: ${code} ${upstreamMessage}`);
    this.name = 'WeChatCode2SessionError';
  }
}

export async function exchangeWeChatCode(code: string): Promise<{ openid: string; sessionKey: string }> {
  if (!config.wechatAppId || !config.wechatAppSecret) {
    throw new Error('WeChat login is not configured');
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wechatAppId}&secret=${config.wechatAppSecret}&js_code=${code}&grant_type=authorization_code`;

  const response = await fetch(url);
  const data: WeChatCode2SessionResponse = await response.json() as WeChatCode2SessionResponse;

  if (data.errcode || !data.openid) {
    throw new WeChatCode2SessionError(data.errcode ?? -1, data.errmsg ?? 'unknown');
  }

  return {
    openid: data.openid,
    sessionKey: data.session_key ?? '',
  };
}

export async function findOrCreateUser(openid: string): Promise<{ id: string; openid: string; nickname: string | null; avatarUrl: string | null }> {
  const [user] = await db.insert(users).values({
    openid,
    nickname: null,
    avatarUrl: null,
    status: 'active',
  }).onConflictDoUpdate({
    target: users.openid,
    set: { updatedAt: new Date() },
  }).returning({
    id: users.id,
    openid: users.openid,
    nickname: users.nickname,
    avatarUrl: users.avatarUrl,
  });

  if (!user) {
    throw new Error('Failed to find or create user');
  }

  return user;
}

export async function grantTestUserInitialPoints(userId: string): Promise<void> {
  const points = config.testUserInitialPoints;
  if (!Number.isInteger(points) || points <= 0) {
    return;
  }

  await creditWallet(
    userId,
    points,
    `test_user_initial_points_${userId}`,
  );
}

export async function signJwt(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  return token;
}
