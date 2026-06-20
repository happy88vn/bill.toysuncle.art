export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { appendToChungTuLog } from '@/lib/chungtu-log';
import { buildSheetRow, SHEET_HEADER, SHEET_TAB } from '@/lib/sheet-row';

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
      const { id, ngayChi, phanBo, chungTuChi, moTaThuongDung, dienGiai, vnd, soTienGoc, loaiTien, nguonChiPhi, soLuongHang, donGia, ngayNhanHang, nguoiChi, phanLoai, maChiPhi, linkChungTu, anhVanDon, trangThai, recordId } = row;

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
            nguonChiPhi: nguonChiPhi || 'Internal',
            soLuongHang: soLuongHang || null,
            donGia: donGia || null,
            ngayNhanHang: ngayNhanHang || null,
            nguoiChi: nguoiChi || null,
            phanLoai: phanLoai || null,
            maChiPhi: maChiPhi || null,
            linkChungTu: linkChungTu || null,
            anhVanDon: anhVanDon || null,
            trangThai: trangThai || 'Chờ duyệt',
            recordId: recordId || null,
            status: 'synced',
          }
        });
      } catch (dbErr: any) {
        console.error(`DB update failed for row id=${id}:`, dbErr?.message);
        errors.push(`Row ${recordId || id}: ${dbErr?.message || 'DB update failed'}`);
      }

      // 1 dong 19 cot dung dinh dang (helper dung chung voi update-row).
      rows.push(buildSheetRow({ ngayChi, phanBo, chungTuChi, moTaThuongDung, dienGiai, vnd, soTienGoc, loaiTien, soLuongHang, donGia, ngayNhanHang, nguonChiPhi, nguoiChi, phanLoai, maChiPhi, linkChungTu, trangThai, recordId, anhVanDon }));
    }

    // ===== AUTO-HEADER: Check if row 1 is empty, insert header if needed =====
    const HEADER_ROW = SHEET_HEADER;

    try {
      const headerCheckRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S1`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );

      let needsHeader = true;
      let existingHeader: string[] | undefined;
      if (headerCheckRes.ok) {
        const headerData = await headerCheckRes.json();
        existingHeader = headerData?.values?.[0];
        // If row 1 has any data, assume header exists
        if (existingHeader && existingHeader.length > 0 && existingHeader.some((c: string) => c && c.trim())) {
          needsHeader = false;
        }
      }

      if (needsHeader) {
        console.log('Sheet header missing — inserting header row');
        const headerRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S1?valueInputOption=RAW`,
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
      } else if (!existingHeader || existingHeader.length < 19 || !(existingHeader[18] && existingHeader[18].trim())) {
        // Sheet co san header 18 cot tu sync truoc -> bo sung nhan cot S "Link Vận đơn (GH)".
        const s1Res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!S1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Link Vận đơn (GH)']] })
          }
        );
        if (!s1Res.ok) console.error('Failed to add S1 header:', await s1Res.text());
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