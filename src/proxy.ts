import { NextResponse, type NextRequest } from 'next/server';
import { DEMO, DEMO_MESSAGE } from '@/lib/demo';

/** In the public demo, the API is read-only. One gate, so no route can slip past it. */
export function proxy(request: NextRequest) {
  if (DEMO && request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.json({ error: DEMO_MESSAGE }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
