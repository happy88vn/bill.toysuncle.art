export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'GOOGLE_SPREADSHEET_ID chưa được cấu hình' }, { status: 500 });
    }

    const body = await request.json();
    const sheetName = body.sheetName || 'DuLieuChiPhiTongQuat';
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=1921846281#gid=1921846281`;

    const existing = await prisma.googleSheetConfig.findFirst({
      where: { sheetId: spreadsheetId }
    });

    if (existing) {
      return NextResponse.json({ sheet: existing });
    }

    const saved = await prisma.googleSheetConfig.create({
      data: {
        sheetId: spreadsheetId,
        sheetName: sheetName,
        sheetUrl: sheetUrl,
      }
    });

    return NextResponse.json({ sheet: saved });
  } catch (error: any) {
    console.error('Create sheet config error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo cấu hình Google Sheet' }, { status: 500 });
  }
}
