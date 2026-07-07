import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOWED_ORIGIN = 'https://servicewechat.com';
const ALLOWED_ORIGINS = [
  DEFAULT_ALLOWED_ORIGIN,
];

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
    (process.env.NODE_ENV === 'development' && DEVELOPMENT_ORIGINS.includes(origin));

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : DEFAULT_ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function corsPreflightResponse(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function withCors(response: NextResponse, request: NextRequest): NextResponse {
  const headers = corsHeaders(request);
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}
