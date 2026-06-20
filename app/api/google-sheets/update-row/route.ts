export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildSheetRow, SHEET_TAB } from '@/lib/sheet-row';

const RECORDID_COL_INDEX = 17; // cot R = Record ID

/**
 * GHI DE 1 dong da gui (tim theo Record ID) — Sheet + DB. KHONG noi them dong moi.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const row = body?.row;
    let sheetId: string = (body?.sheetId || '').trim();
    if (!row?.recordId) {
      return NextResponse.json({ error: 'Thiếu recordId của dòng cần sửa' }, { status: 400 });
    }

    // Cap nhat DB (khop theo Record ID — co the 0 dong neu DB khong co, khong sao).
    try {
      await prisma.extractedData.updateMany({
        where: { recordId: row.recordId },
        data: {
          ngayChi: row.ngayChi || null,
          phanBo: row.phanBo || null,
          chungTuChi: row.chungTuChi || null,
          dienGiai: row.dienGiai || null,
          vnd: row.vnd || '0',
          soTienGoc: row.soTienGoc || null,
          loaiTien: row.loaiTien || 'VND',
          nguonChiPhi: row.nguonChiPhi || 'Internal',
          soLuongHang: row.soLuongHang || null,
          donGia: row.donGia || null,
          ngayNhanHang: row.ngayNhanHang || null,
          nguoiChi: row.nguoiChi || null,
          phanLoai: row.phanLoai || null,
          maChiPhi: row.maChiPhi || null,
          linkChungTu: row.linkChungTu || null,
          anhVanDon: row.anhVanDon || null,
          trangThai: row.trangThai || 'Chờ duyệt',
        },
      });
    } catch (e: any) {
      console.error('update-row DB error:', e?.message);
    }

    // Tim dong tren Sheet theo Record ID.
    if (!sheetId) {
      const cfg = await prisma.googleSheetConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
      sheetId = cfg?.sheetId || '';
    }
    if (!sheetId) return NextResponse.json({ error: 'Chưa cấu hình Google Sheet' }, { status: 400 });

    const accessToken = await getGoogleAccessToken();
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S?majorDimension=ROWS`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      return NextResponse.json({ error: `Không đọc được Google Sheet (lỗi ${readRes.status})` }, { status: 502 });
    }
    const values: string[][] = (await readRes.json())?.values || [];

    let rowNum = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i]?.[RECORDID_COL_INDEX] || '').trim() === String(row.recordId).trim()) {
        rowNum = i + 1; // so dong tren sheet = index + 1
        break;
      }
    }
    if (rowNum === -1) {
      return NextResponse.json({ error: `Không tìm thấy dòng có Record ID "${row.recordId}" trên Sheet (có thể đã bị xoá). DB đã cập nhật.` }, { status: 404 });
    }

    const newRow = buildSheetRow(row);
    const upRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A${rowNum}:S${rowNum}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [newRow] }),
      }
    );
    if (!upRes.ok) {
      const t = (await upRes.text().catch(() => '')).substring(0, 200);
      return NextResponse.json({ error: `Lỗi ghi Google Sheet: ${t}` }, { status: 502 });
    }

    return NextResponse.json({ success: true, rowNum, message: `Đã cập nhật dòng ${rowNum} trên Google Sheets.` });
  } catch (error: any) {
    console.error('update-row error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi cập nhật dòng' }, { status: 500 });
  }
}
