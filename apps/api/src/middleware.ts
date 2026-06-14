import { NextRequest, NextResponse } from 'next/server';
import { config as serverConfig } from './server/config/index.js';

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  if (!serverConfig.adminBasicAuthUser || !serverConfig.adminBasicAuthPassword) {
    return new NextResponse('Admin access is not configured', { status: 503 });
  }

  const header = request.headers.get('authorization');
  const expected = `Basic ${btoa(`${serverConfig.adminBasicAuthUser}:${serverConfig.adminBasicAuthPassword}`)}`;

  if (header !== expected) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
