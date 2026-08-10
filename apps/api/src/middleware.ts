import { NextRequest, NextResponse } from 'next/server';
import { config as serverConfig } from './server/config/index.js';

const ADMIN_PAGE_PATH = '/admin';
const ADMIN_API_PATH = '/api/admin';

function isAdminPath(pathname: string): boolean {
  return (
    pathname === ADMIN_PAGE_PATH ||
    pathname.startsWith(`${ADMIN_PAGE_PATH}/`) ||
    pathname === ADMIN_API_PATH ||
    pathname.startsWith(`${ADMIN_API_PATH}/`)
  );
}

function matchesBasicAuth(authHeader: string | null, expected: string): boolean {
  if (!authHeader) {
    return false;
  }
  return authHeader
    .split(',')
    .map((part) => part.trim())
    .includes(expected);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname === ADMIN_API_PATH || pathname.startsWith(`${ADMIN_API_PATH}/`);

  // 只保护 admin 页面与 admin API；OPTIONS 预检直接放行，由路由层处理 CORS。
  if (!isAdminPath(pathname) || request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  if (!serverConfig.adminBasicAuthUser || !serverConfig.adminBasicAuthPassword) {
    if (isApi) {
      return NextResponse.json({ error: 'Admin access is not configured' }, { status: 503 });
    }
    return new NextResponse('Admin access is not configured', { status: 503 });
  }

  const header = request.headers.get('authorization');
  const expected = `Basic ${btoa(`${serverConfig.adminBasicAuthUser}:${serverConfig.adminBasicAuthPassword}`)}`;

  if (!matchesBasicAuth(header, expected)) {
    const headers = { 'WWW-Authenticate': 'Basic realm="Admin"' };
    if (isApi) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers });
    }
    return new NextResponse('Authentication required', { status: 401, headers });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
