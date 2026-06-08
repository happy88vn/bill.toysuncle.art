export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDriveUserToken } from '@/lib/google-auth';

/**
 * Proxy anh bill tu Google Drive de hien thi tren UI.
 * Anh trong folder bill la private -> khong the dat thang link Drive vao <img>.
 * Route nay: server tai bytes tu Drive (bang token nguoi da ket noi) roi tra ve,
 * nen <img src="/api/drive-image?id=FILEID"> hien duoc ma anh van rieng tu.
 */
function extractFileId(s: string): string | null {
  if (!s) return null;
  const byPath = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (byQuery) return byQuery[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const raw = request.nextUrl.searchParams.get('id') || request.nextUrl.searchParams.get('link') || '';
  const fileId = extractFileId(raw);
  if (!fileId) return new Response('Bad request', { status: 400 });

  try {
    const token = await getDriveUserToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return new Response('Not found', { status: res.status });

    const contentType = res.headers.get('content-type') || '';
    // Chi phuc vu ANH (chong dung proxy de doc file khac qua token dung chung).
    if (!contentType.startsWith('image/')) return new Response('Not an image', { status: 403 });

    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e: any) {
    console.error('drive-image proxy error:', e?.message);
    return new Response('Error', { status: 500 });
  }
}
