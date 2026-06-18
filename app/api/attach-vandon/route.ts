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

    // ===== 1) Cap nhat DB: moi dong cung Ma don hang (chungTuChi) =====
    let dbUpdated = 0;
    try {
      // Khop khong phan biet hoa/thuong cho chac (ma don tu OCR/go tay).
      const r = await prisma.extractedData.updateMany({
        where: { chungTuChi: { equals: maDonHangRaw, mode: 'insensitive' } },
        data: { anhVanDon: driveLink },
      });
      dbUpdated = r.count;
    } catch (e: any) {
      console.error('attach-vandon DB update error:', e?.message);
    }

    // ===== 2) Cap nhat Google Sheet (neu hoa don da sync) =====
    let sheetUpdated = 0;
    let sheetError: string | undefined;
    try {
      if (!sheetId) {
        const cfg = await prisma.googleSheetConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
        sheetId = cfg?.sheetId || '';
      }
      if (sheetId) {
        const accessToken = await getGoogleAccessToken();
        // Doc toan bo vung A:S de tim dong khop Ma don hang (cot C).
        const readRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S?majorDimension=ROWS`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (readRes.ok) {
          const readData = await readRes.json();
          const values: string[][] = readData?.values || [];
          const updates: { range: string; values: string[][] }[] = [];
          // Dam bao nhan cot S co san (truong hop sheet chua tung sync 19 cot).
          const headerRow = values[0] || [];
          if (!(headerRow[18] && String(headerRow[18]).trim())) {
            updates.push({ range: `${SHEET_TAB}!${VANDON_COL}1`, values: [['Link Vận đơn (GH)']] });
          }
          // Bo qua dong 1 (header). So dong tren sheet = index + 1.
          let matched = 0;
          for (let i = 1; i < values.length; i++) {
            const cell = values[i]?.[MADON_COL_INDEX];
            if (cell && norm(cell) === maDonHang) {
              const rowNum = i + 1;
              updates.push({ range: `${SHEET_TAB}!${VANDON_COL}${rowNum}`, values: [[driveLink]] });
              matched++;
            }
          }
          if (updates.length > 0) {
            const upRes = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
              }
            );
            if (upRes.ok) {
              sheetUpdated = matched; // chi dem dong hoa don khop, khong tinh o header
            } else {
              sheetError = (await upRes.text().catch(() => '')).substring(0, 200);
              console.error('attach-vandon sheet batchUpdate error:', sheetError);
            }
          }
        } else {
          sheetError = `Đọc sheet lỗi ${readRes.status}`;
        }
      }
    } catch (e: any) {
      sheetError = e?.message;
      console.error('attach-vandon sheet update error:', e?.message);
    }

    if (dbUpdated === 0 && sheetUpdated === 0) {
      return NextResponse.json({
        success: false,
        dbUpdated,
        sheetUpdated,
        message: `Không tìm thấy hóa đơn nào có Mã đơn hàng "${maDonHangRaw}". Kiểm tra lại mã hoặc nhập hóa đơn trước.`,
        sheetError,
      });
    }

    return NextResponse.json({
      success: true,
      dbUpdated,
      sheetUpdated,
      message: `Đã gắn ảnh vận đơn vào ${dbUpdated} dòng (DB)${sheetUpdated ? ` + ${sheetUpdated} dòng trên Sheet` : ''}.`,
      sheetError,
    });
  } catch (error: any) {
    console.error('attach-vandon error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi gắn vận đơn' }, { status: 500 });
  }
}
