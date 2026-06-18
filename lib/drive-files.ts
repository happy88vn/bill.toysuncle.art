import { getDriveUserToken } from '@/lib/google-auth';

/**
 * Helper dung chung cho viec tai anh tu Google Drive (bill, tem van don...).
 * Gom o 1 cho de process-images / read-madon dung chung, tranh lech logic bao mat.
 */

/** Lay Google Drive fileId — CHI chap nhan link Drive chuan (chong truyen fileId bua bai). */
export function extractDriveFileId(link: string): string | null {
  if (!link) return null;
  const byPath = link.match(/^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = link.match(/^https:\/\/drive\.google\.com\/[^?]*\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (byQuery) return byQuery[1];
  return null;
}

async function driveMeta(fileId: string, accessToken: string, fields: string): Promise<any> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive metadata loi (${res.status})`);
  return res.json();
}

/**
 * Chong IDOR: chi cho tai file la ANH va nam TRONG cay thu muc bill cua app
 * (GOOGLE_DRIVE_PARENT_FOLDER_ID -> thu muc thang -> file). Khong cho doc file
 * Drive bat ky chi vi token dung chung co quyen.
 */
export async function assertBillFile(fileId: string, accessToken: string): Promise<string> {
  const billRoot = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '';
  const meta = await driveMeta(fileId, accessToken, 'mimeType,parents');
  const mime: string = meta?.mimeType || '';
  if (!mime.startsWith('image/')) throw new Error('File khong phai anh — tu choi');

  if (billRoot) {
    const parents: string[] = meta?.parents || [];
    let inTree = parents.includes(billRoot);
    // Bill nam trong thu muc thang -> kiem parent cua parent 1 cap.
    for (const p of parents) {
      if (inTree) break;
      try {
        const pm = await driveMeta(p, accessToken, 'parents');
        if ((pm?.parents || []).includes(billRoot)) inTree = true;
      } catch { /* bo qua parent loi */ }
    }
    if (!inTree) throw new Error('File khong nam trong thu muc bill — tu choi');
  }
  return mime;
}

/** Tai bytes anh tu Google Drive (sau khi da xac minh la anh trong thu muc bill). */
export async function downloadDriveImage(driveLink: string): Promise<{ base64: string; mime: string }> {
  const fileId = extractDriveFileId(driveLink);
  if (!fileId) throw new Error('driveLink khong hop le');
  const accessToken = await getDriveUserToken();
  const mime = await assertBillFile(fileId, accessToken);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Tai anh tu Drive that bai (${res.status}): ${t.substring(0, 150)}`);
  }
  const buf = await res.arrayBuffer();
  return { base64: Buffer.from(buf).toString('base64'), mime };
}
