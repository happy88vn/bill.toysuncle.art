import { getGoogleAccessToken } from '@/lib/google-auth';

const SPREADSHEET_ID = '1AQuUFd1CtEC6nRS8tGBMRdmuZ6TuR_jLNEUmjXt135c';
const LOG_TAB = 'ChungTuMuaHang_Log';

/**
 * V8.5: Append chungTuChi entries to ChungTuMuaHang_Log tab.
 * Columns: A=chungTuChi, B=dienGiai (moTaThuongDung or dienGiai), C=ngayChi
 * This feeds the "Chứng từ mua hàng" dropdown in the UI.
 */
export async function appendToChungTuLog(
  entries: { chungTuChi: string; dienGiai: string; ngayChi: string }[]
): Promise<void> {
  if (entries.length === 0) return;

  try {
    const accessToken = await getGoogleAccessToken();

    // Ensure header exists
    const headerCheckRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_TAB)}!A1:C1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }, cache: 'no-store' }
    );
    if (headerCheckRes.ok) {
      const headerData = await headerCheckRes.json();
      const existing = headerData?.values?.[0];
      if (!existing || existing.length === 0 || !existing.some((c: string) => c && c.trim())) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_TAB)}!A1:C1?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['Chứng từ mua hàng', 'Mô tả', 'Ngày chi']] }),
          }
        );
      }
    }

    // Append entries
    const rows = entries
      .filter(e => e.chungTuChi && e.chungTuChi !== 'Không có')
      .map(e => [e.chungTuChi, e.dienGiai, e.ngayChi]);

    if (rows.length === 0) return;

    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_TAB)}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );

    if (!appendRes.ok) {
      console.error('ChungTuMuaHang_Log append error:', await appendRes.text().catch(() => ''));
    } else {
      console.log(`ChungTuMuaHang_Log: appended ${rows.length} entries`);
    }
  } catch (err: any) {
    // Non-fatal — don't block the main sync flow
    console.error('ChungTuMuaHang_Log error (non-fatal):', err?.message);
  }
}
