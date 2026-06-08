export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isDriveConnected } from '@/lib/google-auth';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ connected: false, error: 'Unauthorized' }, { status: 401 });
    }

    const connected = await isDriveConnected();
    return NextResponse.json({ connected });
  } catch (error: any) {
    console.error('Drive status check error:', error);
    return NextResponse.json({ connected: false, error: error.message }, { status: 500 });
  }
}
