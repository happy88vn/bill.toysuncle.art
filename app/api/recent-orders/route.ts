export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Google Sheets source for "Chứng từ mua hàng" dropdown
const SPREADSHEET_ID = '1AQuUFd1CtEC6nRS8tGBMRdmuZ6TuR_jLNEUmjXt135c';
const SHEET_TAB = 'ChungTuMuaHang_Log';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = await getGoogleAccessToken();

    // Read columns A, B, C from row 2 onwards (skip header)
    // Expected columns: A=chungTuChi, B=dienGiai, C=ngayChi
    const range = `${SHEET_TAB}!A2:C5000`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      console.error('Google Sheets error:', res.status, await res.text().catch(() => ''));
      // Sheet error → return empty, never stale data
      return NextResponse.json({ orders: [] }, {
        headers: noCacheHeaders(),
      });
    }

    const data = await res.json();
    const rows = data.values || [];

    // V8.4: Group by chungTuChi → aggregate ALL product names
    const groupMap = new Map<string, { descriptions: string[]; ngayChi: string }>();

    for (const row of rows) {
      const chungTuChi = (row[0] || '').toString().trim();
      const dienGiai = (row[1] || '').toString().trim();
      const ngayChi = (row[2] || '').toString().trim();

      if (!chungTuChi || chungTuChi === 'Không có') continue;

      if (!groupMap.has(chungTuChi)) {
        groupMap.set(chungTuChi, { descriptions: [], ngayChi });
      }
      const group = groupMap.get(chungTuChi)!;
      if (dienGiai && !group.descriptions.includes(dienGiai)) {
        group.descriptions.push(dienGiai);
      }
    }

    // Format aggregated descriptions
    const orders: { chungTuChi: string; dienGiai: string; ngayChi: string }[] = [];
    for (const [chungTuChi, group] of groupMap) {
      let dienGiai = '';
      const descs = group.descriptions;
      if (descs.length === 1) {
        dienGiai = descs[0];
      } else if (descs.length === 2) {
        dienGiai = descs.join(', ');
      } else if (descs.length >= 3) {
        dienGiai = `${descs[0]}, ${descs[1]} và ${descs.length - 2} SP khác`;
      }
      orders.push({ chungTuChi, dienGiai, ngayChi: group.ngayChi });
    }

    return NextResponse.json({ orders, source: 'google-sheets' }, {
      headers: noCacheHeaders(),
    });
  } catch (error: any) {
    console.error('Recent orders error:', error);
    return NextResponse.json({ orders: [], error: error?.message || 'Lỗi lấy dữ liệu' }, {
      status: 200, // Still return 200 with empty orders so frontend clears dropdown
      headers: noCacheHeaders(),
    });
  }
}

function noCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
}