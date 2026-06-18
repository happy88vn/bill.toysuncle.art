export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { downloadDriveImage } from '@/lib/drive-files';

// OCR nhe: doc DUY NHAT Ma don hang / Ma van don tren anh tem giao hang.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro';

const MADON_PROMPT = `Bạn là OCR chuyên đọc tem vận đơn / phiếu giao hàng (Shopee SPX, GHTK, GHN, J&T, Viettel Post, Lazada...).
Nhiệm vụ: tìm và trả về DUY NHẤT "Mã đơn hàng" (hoặc "Mã vận đơn" / "Order code" / "Tracking" / "Mã đơn") in trên tem.
- Mã thường là chuỗi CHỮ IN HOA + SỐ liền nhau (ví dụ: 2606169D8SAA8U, VN269676440989P, SPXVN0123456789).
- Nếu có cả "Mã đơn hàng" và "Mã vận đơn" → ưu tiên "MÃ ĐƠN HÀNG".
- CHỈ trả về đúng chuỗi mã đó. KHÔNG thêm chữ, KHÔNG giải thích, KHÔNG dấu cách, KHÔNG xuống dòng.
- Nếu thực sự không tìm thấy mã nào → trả về chuỗi rỗng "".`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const driveLink: string = body?.driveLink || '';
    if (!driveLink) return NextResponse.json({ error: 'driveLink là bắt buộc' }, { status: 400 });

    const { base64, mime } = await downloadDriveImage(driveLink);

    const apiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.NEXTAUTH_URL || 'https://bill.toysuncle.art',
        'X-Title': 'Toys Uncle Bill Tracker',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: MADON_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Đọc Mã đơn hàng trên tem này. Chỉ trả về đúng chuỗi mã.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 60,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      console.error('read-madon LLM error:', errText.substring(0, 200));
      return NextResponse.json({ error: 'AI đọc mã thất bại', maDonHang: '' }, { status: 200 });
    }

    const data = await apiRes.json();
    let raw: string = data?.choices?.[0]?.message?.content || '';
    // Lam sach: giu chu+so, bo khoang trang/ky tu thua (ma don hang khong co dau cach).
    const maDonHang = String(raw).trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    return NextResponse.json({ maDonHang });
  } catch (error: any) {
    console.error('read-madon error:', error?.message);
    return NextResponse.json({ error: error?.message || 'Lỗi đọc mã', maDonHang: '' }, { status: 200 });
  }
}
