export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sheets = await prisma.googleSheetConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ sheets });
  } catch (error: any) {
    console.error('List sheets error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi lấy danh sách sheets' }, { status: 500 });
  }
}
