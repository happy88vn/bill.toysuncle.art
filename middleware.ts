import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login
     * - /api/auth (NextAuth routes)
     * - /api/signup
     * - /_next (Next.js static)
     * - /favicon.svg, /logo.png, /og-image.png (public assets)
     */
    '/((?!login|api/auth|api/signup|_next|favicon\\.svg|logo\\.png|og-image\\.png).*)',
  ],
};
