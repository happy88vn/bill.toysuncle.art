export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDriveOAuth2Client } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

/** Build the correct public base URL from headers (not request.url which is internal container) */
function getPublicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }
  // Fallback to NEXTAUTH_URL or request.url
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

    const code = request.nextUrl.searchParams.get('code');
    if (!code) {
      return NextResponse.redirect(`${baseUrl}/?drive_error=no_code`);
    }

    // Recover the redirect URI from state param
    const stateRedirectUri = request.nextUrl.searchParams.get('state');
    const redirectUri = stateRedirectUri || `${baseUrl}/api/auth/google-drive/callback`;

    const oauth2Client = getDriveOAuth2Client(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.error('No refresh_token received. User may have already granted access.');
      return NextResponse.redirect(`${baseUrl}/?drive_error=no_refresh_token`);
    }

    // Save refresh token to DATABASE (persistent across deployments)
    await prisma.appConfig.upsert({
      where: { key: 'GOOGLE_DRIVE_REFRESH_TOKEN' },
      update: { value: tokens.refresh_token },
      create: { key: 'GOOGLE_DRIVE_REFRESH_TOKEN', value: tokens.refresh_token },
    });

    // Also save to .env file for backward compatibility
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch { /* file may not exist */ }

    if (envContent.includes('GOOGLE_OAUTH_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /GOOGLE_OAUTH_REFRESH_TOKEN=.*/,
        `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`
      );
    } else {
      envContent += `\nGOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`;
    }
    fs.writeFileSync(envPath, envContent, 'utf-8');

    // Also set in process.env for immediate use
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = tokens.refresh_token;

    console.log('Drive OAuth refresh token saved to DB + .env successfully');
    return NextResponse.redirect(`${baseUrl}/?drive_connected=true`);
  } catch (error: any) {
    console.error('Drive OAuth callback error:', error);
    const baseUrl = getPublicBaseUrl(request);
    return NextResponse.redirect(`${baseUrl}/?drive_error=callback_failed`);
  }
}