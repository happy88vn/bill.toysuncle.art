export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDriveUserToken } from '@/lib/google-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Mutex map to prevent concurrent creation of the same month folder
const folderLocks = new Map<string, Promise<string>>();

async function findOrCreateFolder(accessToken: string, folderName: string, parentId: string): Promise<string> {
  // Use lock key to prevent race condition creating duplicate folders
  const lockKey = `${parentId}/${folderName}`;

  if (folderLocks.has(lockKey)) {
    // Another request is already creating this folder — wait for it
    return folderLocks.get(lockKey)!;
  }

  const promise = (async () => {
    try {
      const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&supportsAllDrives=true`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      const searchData = await searchRes.json();

      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id as string;
      }

      const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(`Failed to create folder: ${JSON.stringify(createData)}`);
      return createData.id as string;
    } finally {
      // Release the lock after a short delay to handle near-simultaneous requests
      setTimeout(() => folderLocks.delete(lockKey), 2000);
    }
  })();

  folderLocks.set(lockKey, promise);
  return promise;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use OAuth2 user token (personal Google account)
    let accessToken: string;
    try {
      accessToken = await getDriveUserToken();
    } catch (err: any) {
      if (err.message === 'DRIVE_NOT_CONNECTED') {
        return NextResponse.json(
          { error: 'Google Drive chưa được kết nối. Vui lòng kết nối Google Drive trước.' },
          { status: 403 }
        );
      }
      throw err;
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const month = formData.get('month') as string;
    const year = formData.get('year') as string;
    const fileName = formData.get('fileName') as string;

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    // Use GOOGLE_DRIVE_PARENT_FOLDER_ID as the root parent folder
    const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '';
    if (!parentFolderId) {
      return NextResponse.json({ error: 'GOOGLE_DRIVE_PARENT_FOLDER_ID chưa được cấu hình' }, { status: 500 });
    }

    // Generate MM_YYYY folder name
    const mm = month || String(new Date().getMonth() + 1).padStart(2, '0');
    const yyyy = year || String(new Date().getFullYear());
    const monthYearFolder = `${mm}_${yyyy}`;

    // Find or create MM_YYYY subfolder inside the parent folder
    const monthFolderId = await findOrCreateFolder(accessToken, monthYearFolder, parentFolderId);

    const ext = file.name.split('.').pop() || 'jpg';
    const finalName = fileName ? `${fileName}.${ext}` : `${Date.now()}_${file.name}`;

    // Upload file into the MM_YYYY subfolder (NOT the parent folder)
    const fileBuffer = await file.arrayBuffer();
    const boundary = '-------314159265358979323846';
    const metadata = JSON.stringify({ name: finalName, parents: [monthFolderId] });

    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`),
      Buffer.from(fileBuffer),
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    // Retry logic: 3 attempts, 2s delay for timeout/50x errors
    let uploadData: any;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const uploadController = new AbortController();
        const uploadTimeout = setTimeout(() => uploadController.abort(), 60000); // 60s timeout

        const uploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
            signal: uploadController.signal,
          }
        );
        clearTimeout(uploadTimeout);

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          const status = uploadRes.status;
          // Retry on 5xx errors or 408 timeout
          if ((status >= 500 || status === 408) && attempt < MAX_RETRIES) {
            console.warn(`Drive upload attempt ${attempt} failed (${status}), retrying in ${RETRY_DELAY_MS}ms...`, errText.substring(0, 200));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          }
          console.error('Drive upload API error:', errText);
          throw new Error(`Drive upload failed: ${errText}`);
        }

        uploadData = await uploadRes.json();
        break; // Success — exit retry loop
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.message?.includes('abort')) {
          if (attempt < MAX_RETRIES) {
            console.warn(`Drive upload attempt ${attempt} timed out, retrying in ${RETRY_DELAY_MS}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          }
          throw new Error('Drive upload timed out after 3 attempts');
        }
        // Re-throw non-retryable errors
        if (attempt >= MAX_RETRIES) throw err;
        console.warn(`Drive upload attempt ${attempt} error: ${err?.message}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (!uploadData) {
      throw new Error('Drive upload failed after all retry attempts');
    }

    // Make viewable by anyone with link
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    const viewLink = `https://drive.google.com/file/d/${uploadData.id}/view`;

    return NextResponse.json({ fileId: uploadData.id, viewLink, webViewLink: uploadData.webViewLink });
  } catch (error: any) {
    console.error('Drive upload error:', error);
    return NextResponse.json({ error: error?.message || 'Upload failed' }, { status: 500 });
  }
}

/** V7.8: DELETE - Remove files from Google Drive by fileIds or Drive links */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileIds, driveLinks } = body as { fileIds?: string[]; driveLinks?: string[] };

    // Collect all fileIds — from direct IDs or extracted from Drive links
    const allFileIds = new Set<string>();
    if (fileIds) {
      for (const id of fileIds) {
        if (id && id.trim()) allFileIds.add(id.trim());
      }
    }
    if (driveLinks) {
      for (const link of driveLinks) {
        // Extract fileId from: https://drive.google.com/file/d/{fileId}/view
        const match = link?.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) allFileIds.add(match[1]);
      }
    }

    if (allFileIds.size === 0) {
      return NextResponse.json({ message: 'No file IDs to delete', deleted: 0 });
    }

    let accessToken: string;
    try {
      accessToken = await getDriveUserToken();
    } catch {
      // Drive not connected — skip silently
      console.warn('Drive not connected, skipping file deletion');
      return NextResponse.json({ message: 'Drive not connected, skipped', deleted: 0 });
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const fileId of allFileIds) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
          { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (res.ok || res.status === 204) {
          deletedCount++;
        } else if (res.status === 404) {
          // File already gone — not an error
          deletedCount++;
        } else {
          const errText = await res.text().catch(() => '');
          errors.push(`${fileId}: ${res.status} ${errText.substring(0, 100)}`);
        }
      } catch (err: any) {
        errors.push(`${fileId}: ${err?.message || 'Unknown error'}`);
      }
    }

    if (errors.length > 0) {
      console.warn('Drive delete partial errors:', errors);
    }

    return NextResponse.json({ deleted: deletedCount, total: allFileIds.size, errors: errors.length > 0 ? errors : undefined });
  } catch (error: any) {
    console.error('Drive delete error:', error);
    return NextResponse.json({ error: error?.message || 'Delete failed' }, { status: 500 });
  }
}