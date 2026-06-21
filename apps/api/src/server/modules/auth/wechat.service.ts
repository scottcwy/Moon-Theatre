import { SignJWT } from 'jose';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { config } from '../../config/index.js';

interface WeChatCode2SessionResponse {
  openid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export async function exchangeWeChatCode(code: string): Promise<{ openid: string; sessionKey: string }> {
  if (!config.wechatAppId || !config.wechatAppSecret) {
    throw new Error('WeChat login is not configured');
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wechatAppId}&secret=${config.wechatAppSecret}&js_code=${code}&grant_type=authorization_code`;

  const response = await fetch(url);
  const data: WeChatCode2SessionResponse = await response.json() as WeChatCode2SessionResponse;

  if (data.errcode || !data.openid) {
    throw new Error(`WeChat code2session failed: ${data.errcode ?? -1} ${data.errmsg ?? 'unknown'}`);
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

export async function signJwt(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  return token;
}
