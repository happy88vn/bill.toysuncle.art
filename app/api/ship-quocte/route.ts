export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getExchangeRates } from '@/lib/exchange-rate';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro';

const SHIP_PROMPT = `Bạn là trợ lý đọc đơn vận chuyển quốc tế (1688/Taobao/logistics TQ -> VN). Nhiệm vụ: từ CÁC ảnh được cung cấp, trích xuất dữ liệu để tính PHÍ SHIP QUỐC TẾ phân bổ theo trọng lượng.

Cần lấy 2 thứ:
1. TongTien = TỔNG SỐ TIỀN của cả đơn vận chuyển (dòng "Tổng số tiền"/"Tổng thanh toán"/"总实付"/"Total"). Chỉ ghi SỐ (vd "80" cho ¥80.00).
2. LoaiTien = mã tiền tệ: CNY nếu ¥/元/tệ, USD nếu $, ISO 3 chữ. Mặc định "CNY".
3. DanhSach = MẢNG mỗi phần tử là MỘT MÃ VẬN ĐƠN có "Trọng lượng thực tế":
   - Trong ảnh "Chi tiết gói hàng", mỗi khối bắt đầu bằng tiêu đề "Mã vận đơn: XXXX" và bên dưới có dòng "Trọng lượng thực tế: <số>kg；<kích thước>". GHÉP CẶP mã vận đơn (tiêu đề khối) với trọng lượng (trong khối đó).
   - MaVanDon = chuỗi mã ở tiêu đề khối (vd "435222459769166", "YT7627004776119"). KHÔNG lấy mã đơn tổng/master nếu nó KHÔNG có dòng trọng lượng thực tế riêng.
   - TrongLuongKg = CHỈ phần SỐ kg ngay trước chữ "kg" ở dòng "Trọng lượng thực tế" (vd "Trọng lượng thực tế: 4.55kg；52.00×24.00×10.00cm" → "4.55"). BỎ phần kích thước phía sau dấu ；hoặc ;.

QUY TẮC:
- CHỈ đưa vào DanhSach những mã vận đơn CÓ trọng lượng thực tế. Mỗi mã 1 phần tử, KHÔNG trùng.
- Đọc gộp TẤT CẢ ảnh: ảnh tổng tiền (lấy TongTien) + ảnh chi tiết gói hàng (lấy mã + trọng lượng). Thông tin có thể nằm ở các ảnh khác nhau.
- Nhãn trọng lượng có thể là "Trọng lượng thực tế" hoặc "实际重量". Số thập phân dùng dấu chấm. KHÔNG bịa số; không thấy thì để rỗng.

Trả về DUY NHẤT 1 JSON object (không markdown, không giải thích):
{"TongTien":"80","LoaiTien":"CNY","DanhSach":[{"MaVanDon":"435222459769166","TrongLuongKg":"4.55"},{"MaVanDon":"YT7627004776119","TrongLuongKg":"4.8"}]}`;

function num(v: any): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { transactionId, images } = body as { transactionId: string; images: { base64: string; mime: string }[] };
    if (!transactionId || !images || images.length === 0) {
      return NextResponse.json({ error: 'transactionId và images là bắt buộc' }, { status: 400 });
    }

    // 1) Goi AI doc gop tat ca anh
    const content: any[] = [{ type: 'text', text: 'Đọc các ảnh này để lấy tổng tiền và trọng lượng thực tế từng mã vận đơn. Trả về JSON object.' }];
    for (const img of images) {
      if (img?.base64) content.push({ type: 'image_url', image_url: { url: `data:${img.mime || 'image/jpeg'};base64,${img.base64}` } });
    }

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
          { role: 'system', content: SHIP_PROMPT },
          { role: 'user', content },
        ],
        // gemini-2.5-pro la model thinking -> token rong + giam reasoning (xem bai hoc).
        max_tokens: 8000,
        reasoning: { effort: 'low' },
      }),
    });
    if (!apiRes.ok) {
      const t = await apiRes.text().catch(() => '');
      console.error('ship-quocte LLM error:', t.substring(0, 300));
      return NextResponse.json({ error: `AI lỗi (${apiRes.status})` }, { status: 502 });
    }
    const aiData = await apiRes.json();
    let raw: string = aiData?.choices?.[0]?.message?.content || '';
    let cb = raw.trim();
    if (cb.startsWith('```json')) cb = cb.slice(7); else if (cb.startsWith('```')) cb = cb.slice(3);
    if (cb.endsWith('```')) cb = cb.slice(0, -3);
    cb = cb.trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cb);
    } catch {
      const s = cb.indexOf('{'); const e = cb.lastIndexOf('}');
      if (s !== -1 && e > s) { try { parsed = JSON.parse(cb.slice(s, e + 1)); } catch {} }
    }
    if (!parsed) return NextResponse.json({ error: 'AI trả về dữ liệu không hợp lệ — thử lại' }, { status: 422 });

    const totalAmount = num(parsed.TongTien);
    const currency = (parsed.LoaiTien || 'CNY').toString().trim().toUpperCase() || 'CNY';
    const list: { MaVanDon: string; TrongLuongKg: any }[] = Array.isArray(parsed.DanhSach) ? parsed.DanhSach : [];
    const pkgs = list
      .map(p => ({ maVanDon: String(p?.MaVanDon || '').trim(), kg: num(p?.TrongLuongKg) }))
      .filter(p => p.maVanDon && p.kg > 0);

    if (totalAmount <= 0 || pkgs.length === 0) {
      return NextResponse.json({ error: 'Không đọc được tổng tiền hoặc trọng lượng mã vận đơn. Kiểm tra lại ảnh (cần ảnh tổng tiền + ảnh chi tiết gói hàng có trọng lượng).' }, { status: 422 });
    }

    // 2) Tinh phi ship phan bo theo kg (dong cuoi lay phan du de tong khop tuyet doi)
    const totalKg = pkgs.reduce((a, b) => a + b.kg, 0);
    const fees: number[] = [];
    let allocated = 0;
    for (let i = 0; i < pkgs.length; i++) {
      if (i === pkgs.length - 1) {
        fees.push(Math.round((totalAmount - allocated) * 100) / 100);
      } else {
        const f = Math.round((totalAmount / totalKg * pkgs[i].kg) * 100) / 100;
        fees.push(f);
        allocated += f;
      }
    }

    // 3) Ti gia -> quy doi VND
    const { rates } = await getExchangeRates();
    const rate = rates[currency] || rates['CNY'] || 3500;

    // 4) Tao dong DB (chua co anh — anh dai dien upload sau khi user chon)
    const batchId = `SQT${Date.now().toString(36).toUpperCase()}`;
    const created: any[] = [];
    for (let i = 0; i < pkgs.length; i++) {
      const feeOrig = fees[i];
      const vnd = Math.round(feeOrig * rate);
      const rec = await prisma.extractedData.create({
        data: {
          transactionId,
          imageUrl: '',
          cloudStoragePath: '',
          isPublic: false,
          chungTuChi: pkgs[i].maVanDon,
          dienGiai: 'Dịch vụ logistics quốc tế',
          vnd: vnd.toString(),
          usd: currency === 'USD' ? feeOrig.toString() : '0',
          rmb: currency === 'CNY' ? feeOrig.toString() : null,
          soTienGoc: feeOrig.toString(),
          loaiTien: currency,
          nguonChiPhi: 'Internal',
          soLuongHang: null,
          donGia: null,
          nguoiChi: null,
          phanLoai: 'LOG',
          maChiPhi: 'SNV',
          linkChungTu: null,
          trangThai: 'Chờ duyệt',
          recordId: pkgs.length > 1 ? `${batchId}_${i + 1}` : batchId,
          rawData: JSON.stringify({ shipQuocte: true, totalAmount, totalKg, kg: pkgs[i].kg, currency, rate }),
          status: 'pending',
        },
      });
      created.push(rec);
    }

    await prisma.transaction.update({ where: { id: transactionId }, data: { processedImages: images.length, status: 'completed' } }).catch(() => {});

    return NextResponse.json({
      success: true,
      totalAmount, currency, totalKg,
      rows: created,
      summary: pkgs.map((p, i) => ({ maVanDon: p.maVanDon, kg: p.kg, fee: fees[i] })),
    });
  } catch (error: any) {
    console.error('ship-quocte error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi xử lý ship quốc tế' }, { status: 500 });
  }
}
