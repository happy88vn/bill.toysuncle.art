export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { extractDriveFileId } from '@/lib/drive-files';

const SHEET_TAB = 'DuLieuChiPhiTongQuat';
// Cot S = cot thu 19 = "Link Van Don (Chung tu GH)" (sync ghi 19 cot A..S).
const VANDON_COL = 'S';
// Cot C (index 2) = Ma don hang trong sheet.
const MADON_COL_INDEX = 2;

function norm(s: any): string {
  return String(s || '').trim().replace(/^'/, '').toUpperCase();
}

/**
 * Gan anh van don (chung tu giao hang) vao hoa don da nhap, KHOA theo Ma don hang.
 * - Cap nhat cot anhVanDon trong DB cho moi dong cung Ma don hang.
 * - Cap nhat cot S (Link Van Don) tren Google Sheet cho cac dong khop Ma don (neu da sync).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const driveLink: string = (body?.driveLink || '').trim();
    const maDonHangRaw: string = (body?.maDonHang || '').trim();
    let sheetId: string = (body?.sheetId || '').trim();

    if (!driveLink) return NextResponse.json({ error: 'Thiếu link ảnh vận đơn' }, { status: 400 });
    if (!extractDriveFileId(driveLink)) {
      return NextResponse.json({ error: 'Link ảnh vận đơn không hợp lệ (phải là link Google Drive)' }, { status: 400 });
    }
    if (!maDonHangRaw) return NextResponse.json({ error: 'Thiếu Mã đơn hàng để khớp hóa đơn' }, { status: 400 });

    const maDonHang = norm(maDonHangRaw);

    // ===== B1: GOOGLE SHEET LA CHUAN. Phai doc duoc sheet de kiem tra. =====
    if (!sheetId) {
      const cfg = await prisma.googleSheetConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
      sheetId = cfg?.sheetId || '';
    }
    if (!sheetId) {
      return NextResponse.json({ success: false, message: 'Chưa cấu hình Google Sheet — không thể kiểm tra hóa đơn. Hãy đồng bộ hóa đơn lên Sheet trước.' });
    }

    const accessToken = await getGoogleAccessToken();
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S?majorDimension=ROWS`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      const t = (await readRes.text().catch(() => '')).substring(0, 200);
      console.error('attach-vandon read sheet error:', t);
      return NextResponse.json({ success: false, message: `Không đọc được Google Sheet để kiểm tra (lỗi ${readRes.status}). Thử lại.` });
    }
    const readData = await readRes.json();
    const values: string[][] = readData?.values || [];

    // ===== B2: Tim cac dong khop Ma don hang (cot C). =====
    const matchedRowNums: number[] = [];
    let alreadyAttached = false;
    for (let i = 1; i < values.length; i++) {
      const cell = values[i]?.[MADON_COL_INDEX];
      if (cell && norm(cell) === maDonHang) {
        matchedRowNums.push(i + 1); // so dong tren sheet = index + 1
        const sCell = values[i]?.[18]; // cot S (Link Van Don)
        if (sCell && String(sCell).trim()) alreadyAttached = true;
      }
    }

    // CHOT CHAN 1: ma don KHONG co trong Sheet -> chan (tranh nhap nham hang khong co bill).
    if (matchedRowNums.length === 0) {
      return NextResponse.json({
        success: false,
        code: 'NOT_FOUND',
        message: `Mã đơn hàng "${maDonHangRaw}" KHÔNG có trong Google Sheets — chưa có hóa đơn. Không thể gắn (tránh nhập nhầm hàng không có bill).`,
      });
    }

    // CHOT CHAN 2: da gan van don roi -> chan, bao da nhap roi.
    if (alreadyAttached) {
      return NextResponse.json({
        success: false,
        code: 'ALREADY_ATTACHED',
        message: `Mã đơn hàng "${maDonHangRaw}" ĐÃ gắn ảnh vận đơn trước đó rồi — không gắn lại.`,
      });
    }

    // ===== B3: Ghi cot S cho cac dong khop + dam bao nhan cot S. =====
    const updates: { range: string; values: string[][] }[] = [];
    const headerRow = values[0] || [];
    if (!(headerRow[18] && String(headerRow[18]).trim())) {
      updates.push({ range: `${SHEET_TAB}!${VANDON_COL}1`, values: [['Link Vận đơn (GH)']] });
    }
    for (const rowNum of matchedRowNums) {
      updates.push({ range: `${SHEET_TAB}!${VANDON_COL}${rowNum}`, values: [[driveLink]] });
    }
    const upRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
      }
    );
    if (!upRes.ok) {
      const t = (await upRes.text().catch(() => '')).substring(0, 200);
      console.error('attach-vandon batchUpdate error:', t);
      return NextResponse.json({ success: false, message: `Lỗi ghi Google Sheet: ${t}` });
    }

    // ===== B4: Cap nhat DB cho dong bo (best-effort, khong chan neu loi). =====
    let dbUpdated = 0;
    try {
      const r = await prisma.extractedData.updateMany({
        where: { chungTuChi: { equals: maDonHangRaw, mode: 'insensitive' } },
        data: { anhVanDon: driveLink },
      });
      dbUpdated = r.count;
    } catch (e: any) {
      console.error('attach-vandon DB update error:', e?.message);
    }

    return NextResponse.json({
      success: true,
      sheetUpdated: matchedRowNums.length,
      dbUpdated,
      message: `Đã gắn ảnh vận đơn vào ${matchedRowNums.length} dòng trên Google Sheets.`,
    });
  } catch (error: any) {
    console.error('attach-vandon error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi gắn vận đơn' }, { status: 500 });
  }
}
