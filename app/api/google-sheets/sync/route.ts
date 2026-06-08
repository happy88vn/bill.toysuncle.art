export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { appendToChungTuLog } from '@/lib/chungtu-log';

const SHEET_TAB = 'DuLieuChiPhiTongQuat';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = await getGoogleAccessToken();

    const body = await request.json();
    const { sheetId, editedRows } = body;

    if (!sheetId || !editedRows || editedRows.length === 0) {
      return NextResponse.json({ error: 'sheetId và editedRows là bắt buộc' }, { status: 400 });
    }

    const rows: string[][] = [];
    const errors: string[] = [];

    for (const row of editedRows) {
      const { id, ngayChi, phanBo, chungTuChi, moTaThuongDung, dienGiai, vnd, soTienGoc, loaiTien, nguonChiPhi, soLuongHang, donGia, ngayNhanHang, nguoiChi, phanLoai, maChiPhi, linkChungTu, trangThai, recordId } = row;

      // Update DB — wrapped in try/catch so one failure doesn't block others
      try {
        await prisma.extractedData.update({
          where: { id },
          data: {
            ngayChi: ngayChi || null,
            phanBo: phanBo || null,
            chungTuChi: chungTuChi || null,
            dienGiai: dienGiai || null,
            vnd: vnd || '0',
            soTienGoc: soTienGoc || null,
            loaiTien: loaiTien || 'VND',
            nguonChiPhi: nguonChiPhi || 'External',
            soLuongHang: soLuongHang || null,
            donGia: donGia || null,
            ngayNhanHang: ngayNhanHang || null,
            nguoiChi: nguoiChi || null,
            phanLoai: phanLoai || null,
            maChiPhi: maChiPhi || null,
            linkChungTu: linkChungTu || null,
            trangThai: trangThai || 'Chờ duyệt',
            recordId: recordId || null,
            status: 'synced',
          }
        });
      } catch (dbErr: any) {
        console.error(`DB update failed for row id=${id}:`, dbErr?.message);
        errors.push(`Row ${recordId || id}: ${dbErr?.message || 'DB update failed'}`);
      }

      // Prefix chungTuChi with ' for text format in Google Sheets
      const chungTuChiSheet = chungTuChi ? `'${chungTuChi}` : '';

      // V7.1: Use moTaThuongDung or dienGiai as effective description for the sheet
      const effectiveDienGiai = moTaThuongDung || dienGiai || '';

      // 18-column row: Ngày chi, Phân bổ, Chứng từ mua hàng, Mô tả thường dùng, Mô Tả Mới, Tổng Bill (VNĐ),
      //   Số tiền gốc, Loại tiền, Số lượng hàng, Đơn giá, Ngày nhận hàng,
      //   Nguồn chi phí, Người chi, Phân loại chi phí, Loại chứng từ, Link Chứng từ,
      //   Trạng thái duyệt, Record ID
      rows.push([
        ngayChi || '',
        phanBo || '',
        chungTuChiSheet,
        moTaThuongDung || '',
        dienGiai || '',
        vnd || '0',
        soTienGoc || '',
        loaiTien || 'VND',
        soLuongHang || '',
        donGia || '',
        ngayNhanHang || '',
        nguonChiPhi || 'External',
        nguoiChi || '',
        phanLoai || '',
        maChiPhi || '',
        linkChungTu || '',
        trangThai || 'Chờ duyệt',
        recordId || '',
      ]);
    }

    // ===== AUTO-HEADER: Check if row 1 is empty, insert header if needed =====
    // V7.1: 18-column header
    const HEADER_ROW = [
      'Ngày chi', 'Phân bổ', 'Chứng từ mua hàng', 'Mô tả thường dùng', 'Mô Tả Mới',
      'Tổng Bill (VNĐ)', 'Số tiền gốc', 'Loại tiền', 'Số lượng hàng', 'Đơn giá', 'Ngày nhận hàng',
      'Nguồn chi phí', 'Người chi', 'Phân loại chi phí', 'Loại chứng từ',
      'Link Chứng từ', 'Trạng thái duyệt', 'Record ID'
    ];

    try {
      const headerCheckRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:R1`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );

      let needsHeader = true;
      if (headerCheckRes.ok) {
        const headerData = await headerCheckRes.json();
        const existingRow = headerData?.values?.[0];
        // If row 1 has any data, assume header exists
        if (existingRow && existingRow.length > 0 && existingRow.some((c: string) => c && c.trim())) {
          needsHeader = false;
        }
      }

      if (needsHeader) {
        console.log('Sheet header missing — inserting header row');
        const headerRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:R1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [HEADER_ROW] })
          }
        );
        if (!headerRes.ok) {
          console.error('Failed to insert header row:', await headerRes.text());
        }
      }
    } catch (headerErr: any) {
      console.error('Header check/insert error (non-fatal):', headerErr?.message);
    }

    // Append all data rows (raw data only, no summary rows)
    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: rows })
      }
    );

    if (!appendResponse.ok) {
      const errorText = await appendResponse.text();
      throw new Error(`Google Sheets API error: ${errorText}`);
    }

    const result = await appendResponse.json();

    // V8.5: Also append to ChungTuMuaHang_Log for dropdown data
    const chungTuEntries = editedRows
      .filter((r: any) => r.chungTuChi && r.chungTuChi !== 'Không có')
      .map((r: any) => ({
        chungTuChi: r.chungTuChi,
        dienGiai: r.moTaThuongDung || r.dienGiai || '',
        ngayChi: r.ngayChi || '',
      }));
    await appendToChungTuLog(chungTuEntries);

    return NextResponse.json({ success: true, result, syncedCount: rows.length, errors: errors.length > 0 ? errors : undefined });
  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi đồng bộ dữ liệu' }, { status: 500 });
  }
}