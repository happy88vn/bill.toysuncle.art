export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDriveOAuth2Client } from '@/lib/google-auth';

/** Build the correct public base URL from headers (not request.url which is internal container) */
function getPublicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  return new URL('/', request.url).origin;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const baseUrl = getPublicBaseUrl(request);

    if (!session) {
      return NextResponse.redirect(`${baseUrl}/login`);
    }

    const redirectUri = `${baseUrl}/api/auth/google-drive/callback`;
    const oauth2Client = getDriveOAuth2Client(redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      // Full Drive scope: can de ghi vao folder CO SAN (vd BILL_TOYS_UNCLE).
      // drive.file chi thay file do app tao -> khong tro vao folder san co duoc.
      scope: ['https://www.googleapis.com/auth/drive'],
      state: redirectUri,
    });

    return NextResponse.redirect(authUrl);
  } catch (error: any) {
    console.error('Drive OAuth initiate error:', error);
    const baseUrl = getPublicBaseUrl(request);
    return NextResponse.redirect(`${baseUrl}/?drive_error=init_failed`);
  }
}