export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken, getDriveUserToken } from '@/lib/google-auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { extractDriveFileId } from '@/lib/drive-files';
import { SHEET_TAB } from '@/lib/sheet-row';

const RECORDID_COL_INDEX = 17; // cot R = Record ID

/**
 * XOA 1 dong da gui (tim theo Record ID): xoa han dong tren Sheet + DB + anh Drive (neu khong con dong nao dung).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const id: string = (body?.id || '').trim();
    const recordId: string = (body?.recordId || '').trim();
    const linkChungTu: string = (body?.linkChungTu || '').trim();
    let sheetId: string = (body?.sheetId || '').trim();
    if (!recordId) return NextResponse.json({ error: 'Thiếu recordId' }, { status: 400 });

    if (!sheetId) {
      const cfg = await prisma.googleSheetConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
      sheetId = cfg?.sheetId || '';
    }
    if (!sheetId) return NextResponse.json({ error: 'Chưa cấu hình Google Sheet' }, { status: 400 });

    const accessToken = await getGoogleAccessToken();

    // 1) Lay gid (sheetId so) cua tab.
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) return NextResponse.json({ error: `Không đọc được metadata sheet (${metaRes.status})` }, { status: 502 });
    const meta = await metaRes.json();
    const tab = (meta?.sheets || []).find((s: any) => s?.properties?.title === SHEET_TAB);
    const gid = tab?.properties?.sheetId;
    if (gid === undefined || gid === null) return NextResponse.json({ error: `Không tìm thấy tab ${SHEET_TAB}` }, { status: 404 });

    // 2) Tim grid index cua dong theo Record ID.
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_TAB)}!A1:S?majorDimension=ROWS`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) return NextResponse.json({ error: `Không đọc được Google Sheet (${readRes.status})` }, { status: 502 });
    const values: string[][] = (await readRes.json())?.values || [];
    let gridIndex = -1; // 0-based: dong header = 0
    for (let i = 1; i < values.length; i++) {
      if (String(values[i]?.[RECORDID_COL_INDEX] || '').trim() === recordId) { gridIndex = i; break; }
    }

    let sheetDeleted = false;
    if (gridIndex !== -1) {
      const delRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: gridIndex, endIndex: gridIndex + 1 } } }] }),
        }
      );
      if (delRes.ok) sheetDeleted = true;
      else console.error('delete-row sheet error:', (await delRes.text().catch(() => '')).substring(0, 200));
    }

    // 3) Xoa DB record (khop theo Record ID; id chi de tham khao).
    try {
      if (recordId) await prisma.extractedData.deleteMany({ where: { recordId } });
      else if (id) await prisma.extractedData.delete({ where: { id } });
    } catch (e: any) { console.error('delete-row DB error:', e?.message); }

    // 4) Xoa anh Drive neu KHONG con dong NAO tren Sheet dung link nay (cot P, index 15).
    let driveDeleted = false;
    const fileId = extractDriveFileId(linkChungTu);
    if (fileId) {
      let stillUsed = 0;
      for (let i = 1; i < values.length; i++) {
        if (i === gridIndex) continue; // bo dong vua xoa
        if (String(values[i]?.[15] || '').trim() === linkChungTu) stillUsed++;
      }
      if (stillUsed === 0) {
        try {
          const dt = await getDriveUserToken();
          const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${dt}` } });
          if (dr.ok || dr.status === 204 || dr.status === 404) driveDeleted = true;
        } catch (e: any) { console.error('delete-row Drive error:', e?.message); }
      }
    }

    return NextResponse.json({
      success: true,
      sheetDeleted,
      driveDeleted,
      message: sheetDeleted ? 'Đã xoá dòng khỏi Google Sheets + DB' + (driveDeleted ? ' + ảnh Drive' : '') : 'Đã xoá khỏi DB (dòng không còn trên Sheet)',
    });
  } catch (error: any) {
    console.error('delete-row error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi xoá dòng' }, { status: 500 });
  }
}
