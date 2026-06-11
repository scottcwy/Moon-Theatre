import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { config } from '../config/index.js';

export interface AuthenticatedRequest extends NextRequest {
  userId: string;
}

const JWT_SECRET = new TextEncoder().encode(config.jwtSecret);

export async function verifyAuth(request: NextRequest): Promise<{ userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub === 'string' && payload.sub) {
      return { userId: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}

export function unauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function successResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}