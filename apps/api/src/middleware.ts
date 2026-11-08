import { NextRequest, NextResponse } from 'next/server';

// Edge-safe headers only. Every API handler and SSR query retains its own identity guard.
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const response = NextResponse.next();
  if (path === '/admin' || path.startsWith('/admin/') || path === '/api/admin' || path.startsWith('/api/admin/')) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('X-Frame-Options', 'DENY');
  }
  return response;
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
