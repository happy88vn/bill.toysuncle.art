export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SHEET_TAB } from '@/lib/sheet-row';

/**
 * Liet ke cac LENH DA GUI doc THANG TU GOOGLE SHEET (nguon chuan — co du ca cot
 * "Mo ta thuong dung" ma DB khong luu). Moi dong gan voi Record ID.
 * - Khong q: 50 dong moi nhat (cuoi sheet).
 * - Co q: loc theo Ma don / mo ta / Record ID.
 */
function parseRow(r: string[]) {
  const g = (i: number) => (r[i] != null ? String(r[i]) : '');
  return {
    id: g(17),                              // Record ID lam khoa (duy nhat)
    recordId: g(17),
    ngayChi: g(0), phanBo: g(1),
    chungTuChi: g(2).replace(/^'/, ''),     // bo dau ' text-format
    moTaThuongDung: g(3), dienGiai: g(4),
    vnd: g(5), soTienGoc: g(6), loaiTien: g(7) || 'VND',
    soLuongHang: g(8), donGia: g(9), ngayNhanHang: g(10),
    nguonChiPhi: g(11) || 'Internal', nguoiChi: g(12),
    phanLoai: g(13), maChiPhi: g(14),
    linkChungTu: g(15), trangThai: g(16) || 'Chờ duyệt',
    anhVanDon: g(18),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

    const cfg = await prisma.googleSheetConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
    const sheetId = cfg?.sheetId || '';
    if (!sheetId) return NextResponse.json({ rows: [], message: 'Chưa có Google Sheet nào.' });

    const accessToken = await getGoogleAccessToken();
    // UNFORMATTED_VALUE: tien ve so sach (khong kem "₫"/dau phay), ngay van la text "DD/MM/YYYY".
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A2:S?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) return NextResponse.json({ error: `Không đọc được Google Sheet (${readRes.status})` }, { status: 502 });
    const values: string[][] = (await readRes.json())?.values || [];

    let parsed = values
      .filter(r => r && (r[17] || '').toString().trim()) // chi dong co Record ID
      .map(parseRow);

    if (q) {
      parsed = parsed.filter(p =>
        p.chungTuChi.toLowerCase().includes(q) ||
        p.dienGiai.toLowerCase().includes(q) ||
        p.moTaThuongDung.toLowerCase().includes(q) ||
        p.recordId.toLowerCase().includes(q)
      );
    }

    // Moi nhat o cuoi sheet -> dao nguoc, lay toi da 80.
    parsed.reverse();
    return NextResponse.json({ rows: parsed.slice(0, 80) });
  } catch (error: any) {
    console.error('synced-entries error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi tải danh sách' }, { status: 500 });
  }
}
