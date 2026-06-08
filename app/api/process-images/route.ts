export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDriveUserToken } from '@/lib/google-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { XMLParser } from 'fast-xml-parser';

// OpenRouter (OpenAI-compatible). Model doc bill mac dinh: Gemini Pro
// (OCR goc tot nhat cho anh chup hoa don + da ngon ngu + chi phi thap).
// Doi 1 dong env OPENROUTER_MODEL la sang Claude/GPT neu muon.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-pro';

/** Lay Google Drive fileId — CHI chap nhan link Drive chuan (chong truyen fileId bua bai). */
function extractDriveFileId(link: string): string | null {
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
async function assertBillFile(fileId: string, accessToken: string): Promise<string> {
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
async function downloadDriveImage(driveLink: string): Promise<{ base64: string; mime: string }> {
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

const SYSTEM_PROMPT = `Bạn là một Kế toán viên AI cao cấp. Nhiệm vụ của bạn là đọc hình ảnh hóa đơn, biên lai, bill điện tử và ghi chú để trích xuất dữ liệu tài chính.

BẮT BUỘC: Kết quả đầu ra phải là một JSON **Array** (mảng). Mỗi phần tử trong mảng là một object đại diện cho MỘT dòng sản phẩm/chi phí riêng biệt.

=== QUAN TRỌNG: LOGIC TÁCH DÒNG THEO LOẠI TIỀN ===

**KỊCH BẢN 1: HÓA ĐƠN VND / NỘI ĐỊA** (Shopee, Lazada, Tiki, hóa đơn Việt Nam):
- Mỗi sản phẩm KHÁC NHAU → MỘT Object riêng. Chỉ có 1 sản phẩm → 1 Object. KHÔNG tạo dòng riêng cho voucher/giảm giá/phí ship.
- **SoTienGoc của MỖI Object = GIÁ LISTING RIÊNG của dòng đó** (số tiền hiển thị NGAY CẠNH sản phẩm đó). TUYỆT ĐỐI KHÔNG chia đều, KHÔNG dùng tổng bill — giá mỗi sản phẩm THƯỜNG KHÁC NHAU.
- **TongThanhToan = số tiền THỰC TRẢ cuối cùng của cả hóa đơn** (dòng "Thành tiền"/"Tổng thanh toán"), GHI GIỐNG NHAU cho MỌI Object. Backend tự phân bổ phần giảm giá theo TỶ LỆ giá trị từng dòng. Nếu không có giảm giá → TongThanhToan = tổng các dòng.
- SoLuongHang = số lượng riêng của dòng đó. DienGiai = tên sản phẩm CỤ THỂ (đọc đúng tên trên bill).
- Dùng TÊN CỬA HÀNG + hình ảnh sản phẩm để hiểu đúng mặt hàng rồi đặt DienGiai cho chuẩn. VD cửa hàng "Sơn Duy Auto Win" + hình các hộp/lọ sơn → đây là SƠN nhiều loại/màu → "Sơn lót 2K trắng", "Sơn lót 2K đen"...
- Ví dụ: Bill "Sơn Duy Auto Win", Thành tiền 340.300đ, gồm Sơn lót trắng x1 (150.000đ), Sơn lót đen x1 (150.000đ), Sơn DD75 x1 (60.000đ), Sơn mờ x1 (50.000đ) → 4 Object: SoTienGoc lần lượt "150000","150000","60000","50000", TongThanhToan="340300" cho cả 4. (Backend tự ra đơn giá sau giảm 124500/124500/49800/41500.)

**KỊCH BẢN 2: HÓA ĐƠN NGOẠI TỆ** (1688, Taobao, Alibaba, Amazon, eBay, invoice USD/CNY/EUR...):
- Mỗi sản phẩm/dịch vụ trên hóa đơn = MỘT object riêng trong mảng.
- Phí ship/vận chuyển = MỘT object riêng (MaChiPhi = tương ứng theo Logistics).
- Phí thanh toán ngoại tệ / phí dịch vụ = MỘT object riêng.
- Voucher/giảm giá = MỘT object riêng với SoTienGoc là SỐ ÂM (ví dụ: -50000).
- QUAN TRỌNG: SoTienGoc của MỖI dòng phải là SỐ TIỀN RIÊNG của dòng đó, KHÔNG phải tổng bill.
  + Dòng sản phẩm: SoTienGoc = giá sản phẩm (原价总计/Subtotal), KHÔNG phải tổng thanh toán (总实付/Grand Total).
  + Dòng ship: SoTienGoc = phí ship riêng (运费).
  + Dòng phí dịch vụ: SoTienGoc = phí dịch vụ riêng.
  + Tổng tất cả các dòng cộng lại = tổng thanh toán cuối cùng.
- Ví dụ: Bill 1688 tổng ¥52.52 gồm SP ¥44, Ship ¥7, Phí ngoại tệ ¥1.52 → 3 Object:
  [{DienGiai:"Túi ziplock", SoTienGoc:"44", SoLuongHang:"10", LoaiTien:"CNY"},
   {DienGiai:"Dịch vụ logistics", SoTienGoc:"7", LoaiTien:"CNY", PhanLoai:"LOG", MaChiPhi:"SNV"},
   {DienGiai:"Phí thanh toán ngoại tệ", SoTienGoc:"1.52", LoaiTien:"CNY", PhanLoai:"QLDN", MaChiPhi:"CPK"}]
- Nếu hóa đơn chỉ có 1 sản phẩm duy nhất và không có phí khác, vẫn trả về mảng có 1 phần tử.

=== QUY TẮC SỐ TIỀN VND ===
- Tiền VND luôn là SỐ NGUYÊN, KHÔNG có phần thập phân.
- Dấu chấm (.) và dấu phẩy (,) trong tiền VND là dấu PHÂN CÁCH HÀNG NGHÌN, KHÔNG phải thập phân.
- Ví dụ: "46.420đ" = 46420, "1,250,000₫" = 1250000, "3.500.000 VNĐ" = 3500000.
- TUYỆT ĐỐI KHÔNG viết 46.42 hay 3500.0 cho VND.

Mỗi object trong mảng phải có chính xác các key sau:

"NgayChi": Ngày mua hàng/giao dịch (DD/MM/YYYY). Nếu HOÀN TOÀN KHÔNG TÌM THẤY ngày, trả về "". TUYỆT ĐỐI KHÔNG bịa ngày.

"PhanBo": Nếu NgayChi có giá trị → TMM/YYYY (ví dụ T04/2026). Nếu NgayChi rỗng → "".

"ChungTuMuaHang": Mã đơn hàng, Mã giao dịch, Mã vận đơn. Nếu không có → "".

"DienGiai": Tên sản phẩm/dịch vụ CỤ THỂ cho dòng này. Dưới 15 chữ.

"SoTienGoc": Số tiền GỐC của dòng này theo đơn vị tiền tệ trên hóa đơn. (Chỉ ghi số, có thể âm cho voucher). Nếu là VND → ghi số nguyên (46420, KHÔNG phải 46.42).

"TongThanhToan": (CHỈ cho hóa đơn VND) Tổng số tiền THỰC TRẢ cuối cùng của cả hóa đơn (dòng "Thành tiền"/"Tổng thanh toán"). Ghi số nguyên, GIỐNG NHAU cho mọi object trong bill. Nếu không tìm thấy → "".

"LoaiTien": Mã tiền tệ ISO 3 chữ cái: VND, USD, CNY, EUR, GBP, JPY, AUD, CAD, CHF, DKK, HKD, INR, KRW, KWD, MYR, NOK, RUB, SAR, SEK, SGD, THB. Mặc định "VND" nếu là tiền Việt (₫, đ, VNĐ). USD nếu có $. CNY nếu có ¥, 元, Tệ.

"SoLuongHang": Số lượng của dòng sản phẩm này. LƯU Ý: Nếu tên dạng combo (Ví dụ: "Set 10 kẹp" x3) → tính 10*3=30. (Chỉ ghi số). Nếu không có → "".

"NgayNhanHang": Ngày nhận hàng dự kiến (DD/MM/YYYY). Nếu không có → "".

"NguoiChi": Lấy TÊN GỌI (từ cuối cùng trong phần tên tiếng Việt) của người nhận/trả tiền. Quy tắc: Tên tiếng Việt có Họ đầu + Tên cuối → lấy TÊN CUỐI. Ví dụ: "Nguyen Van HAI" → "HAI", "LE MINH THANH HA" → "HA", "Hai Nguyen" → "HAI" (Hai là tên gọi vì đứng trước họ Nguyen). Tên 1 từ → giữ nguyên. Luôn viết HOA. Nếu text có "TM" → "Tiền mặt".

"PhanLoai": Chỉ 1 trong 5: "SX", "LOG", "MKT", "QLDN", "DT". Mặc định "SX".
- SX = Sản xuất (chi phí trực tiếp tạo ra sản phẩm: NVL, linh kiện, nhựa, phụ kiện)
- LOG = Logistics (kho vận, đóng gói, giao nhận, ship)
- MKT = Marketing (quảng cáo, sự kiện, hội chợ, tiếp khách)
- QLDN = Quản lý DN (lương, thuê mặt bằng, tiện ích, phần mềm, thuế, kế toán, BHXH)
- DT = Đầu tư (mua máy mới, bảo trì máy, sửa chữa cơ sở vật chất)

"MaChiPhi": Map theo nội dung (Loại chứng từ). QUAN TRỌNG: Tuân thủ đúng từ khóa bên dưới.

[SX - Sản xuất]
- "NI": NVL Nhựa in 3D (nhựa, resin, filament, esun, pla, pla+, pla+ silk, petg, tpu, abs, huti, r3d, vietluz, cuộn nhựa)
- "MK": NVL Phụ kiện (móc khóa, khoen, nam châm, dây treo điện thoại, giá đỡ, mắt, tai, sừng, tăm bông)
- "LKDT": NVL Điện tử (đèn, led, pin, mạch, dây điện, chuôi đèn, E27, E14, chip, bo mạch)
- "HM": NVL Thủ công (đất sét, màu, cọ, sơn, bóng 1k, bóng 2k, sơn 2k, sơn gốc dầu, sơn gốc nước, chà nhám, bông gòn, cồn, blu tack)
- "VTK": NVL Phụ trợ sản xuất (keo, giấy nhám, hóa chất, súng phun, airbrush, máy nén khí, kẹp, kim, bulong, tán, thẻ nhớ)
- "TN": Tem nhãn dán lên SP (CHỈ khi có chữ "tem sản phẩm", "tem sp", "tem dán sp", "tem uv dán sp")
- "BQ": Chi phí bản quyền IP Model (bản quyền, ip model, model, patreon, cults3d, 3d model)
- "RD": Chi phí R&D mẫu mới (r&d, nghiên cứu, mẫu, test mẫu, thiết bị test)

[LOG - Logistics]
- "BB": Vật liệu đóng gói (thùng, hộp, túi, bao bì, kraft, túi opp, thùng carton, giấy tổ ong)
- "BK": Vật liệu chống sốc (băng keo, xốp, bubble, mút, bọc, xốp nổ, giấy chống sốc)
- "TN": Tem nhãn & Thẻ cám ơn bao bì (tem, nhãn, decal, thẻ cám ơn, uv dtf, in uv, holo — MẶC ĐỊNH nếu chỉ ghi "tem", "nhãn" chung chung)
- "SNV": Cước VC Nhập vật tư (nhập, vật tư, ship nhập, giao hàng, vận chuyển, cod, gửi hàng về kho)
- "SKH": Cước VC Giao khách hàng (ship khách, giao khách, phí ship đơn)
- "SDT": Cước VC Đối tác gia công (đối tác, gia công, vesta, dinh, ký gửi, hạc)

[MKT - Marketing]
- "ADS": Ngân sách Quảng cáo (ads, quảng cáo, facebook, fb, tiktok, media, google ads, influencer)
- "GH": Thuê mặt bằng sự kiện (gian hàng, đặt cọc, emasi, booth, mặt bằng sự kiện)
- "POSM": Vật phẩm trưng bày & In ấn (posm, trang trí, standee, poster, in ấn event, banner, backdrop)
- "VCSK": Cước VC Hội chợ/Sự kiện (sự kiện + ship, hội chợ + vận chuyển)
- "AU": Tiếp khách & Ngoại giao (ăn uống, tiếp khách, bánh, nước suối, đồ ăn, cà phê, tiệc)

[QLDN - Quản lý DN]
- "TLNV": Quỹ lương & Thưởng nhân sự (lương, nhân sự, freelance, phụ cấp, thưởng)
- "TMB": Thuê mặt bằng/Văn phòng (mặt bằng, thuê nhà, thuê kho, thuê VP)
- "DNI": Chi phí Tiện ích (tiền điện, đóng điện, tiền nước, internet, wifi, mạng, điện thoại)
- "PM": Nền tảng & Phần mềm (phần mềm, app, airtable, n8n, abacus, claude code, gemini, gia hạn, SaaS, license, hosting, domain)
- "VPP": Hành chính & VPP (văn phòng phẩm, giấy, bút, mực in)
- "DVKT": Pháp lý & Kế toán DV (kế toán, tây nam á, dịch vụ kế toán)
- "THUE": Thuế & Lệ phí (thuế, thuế GTGT, thuế TNDN, thuế môn bài, lệ phí)
- "BHXH": Phúc lợi & Bảo hiểm (bhxh, bảo hiểm, bảo hiểm xã hội, bảo hiểm y tế)
- "CPK": Chi phí Quản lý khác (vệ sinh văn phòng, rác, chi phí VP khác)

[DT - Đầu tư]
- "TTM": Đầu tư Máy móc thiết bị mới (máy in, máy tính, tiền máy, máy móc mới, bambulab, máy in 3D, thiết bị mới)
- "BTMM": Sửa chữa & Bảo trì máy móc (bảo trì, sửa chữa máy, linh kiện máy, nozzle, mâm in, mực in, bed, đầu in, phụ tùng)
- "SC": Cải tạo & Sửa chữa CSVC (sửa văn phòng, sửa chữa cơ sở, cải tạo)

QUY TẮC TN (Tem Nhãn): Nếu chỉ ghi "tem", "nhãn", "decal" chung chung → LOG/TN. Chỉ gán SX/TN khi rõ ràng "tem sản phẩm" hoặc "tem sp".
QUY TẮC SHIP: Gặp "ship", "giao" → LOG. Ngoại trừ có "sự kiện"/"hội chợ" → MKT/VCSK.
- "NY": Chưa biết phân bổ
Mặc định "NI" cho SX, "BB" cho LOG, "ADS" cho MKT, "TLNV" cho QLDN, "TTM" cho DT, "NY" nếu không rõ.

Quy tắc:
- NgayChi: Không tìm thấy → "". KHÔNG bịa ngày.
- PhanBo: NgayChi rỗng → PhanBo rỗng.
- "TM" trong text → NguoiChi = "Tiền mặt".
- VND: tách theo sản phẩm; SoTienGoc = giá RIÊNG của từng dòng (số nguyên, KHÔNG chia đều tổng bill). Voucher/ship rõ ràng → tách dòng riêng (voucher âm).
- Ngoại tệ: tách line item, ship/phí dịch vụ = dòng riêng. SoTienGoc mỗi dòng = số tiền RIÊNG của dòng đó (KHÔNG phải tổng bill).
- CHỈ trả về JSON Array, KHÔNG text khác.

Respond with raw JSON Array only. No code blocks, no markdown.`;

// ===== HELPER: Sanitize numeric string from AI output =====
function sanitizeNumericStr(val: any): string {
  if (val === null || val === undefined || val === '') return '0';
  const str = String(val).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const num = parseFloat(str);
  if (isNaN(num) || !isFinite(num)) return '0';
  return num.toString();
}

// ===== HELPER: Sanitize VND amount — dots/commas are thousands separators =====
function sanitizeVndInteger(val: any): string {
  if (val === null || val === undefined || val === '') return '0';
  // Strip everything except digits, minus sign
  const str = String(val).replace(/[^0-9\-]/g, '');
  const num = parseInt(str, 10);
  if (isNaN(num) || !isFinite(num)) return '0';
  return num.toString();
}

// ===== HELPER: Sanitize nullable numeric string =====
function sanitizeNullableNumericStr(val: any): string | null {
  if (val === null || val === undefined || val === '' || val === '0' || val === 0) return null;
  const str = String(val).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const num = parseFloat(str);
  if (isNaN(num) || !isFinite(num) || num === 0) return null;
  return num.toString();
}

// ===== HELPER: Sanitize date string (DD/MM/YYYY) =====
function sanitizeDateStr(val: any): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed === 'Không có' || trimmed === 'N/A' || trimmed === '""') return null;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return trimmed;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
  return null;
}

// ===== HELPER: Sanitize nullable string =====
function sanitizeNullableStr(val: any): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str || str === 'Không có' || str === 'N/A' || str === '""' || str === "''") return null;
  return str;
}

// ===== Vietcombank Exchange Rates (reuse logic from exchange-rate API) =====
const VCB_URL = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx';
let cachedRates: Record<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000;

const FALLBACK_RATES: Record<string, number> = {
  VND: 1, USD: 25500, CNY: 3500, EUR: 27500, GBP: 32000, JPY: 170,
  AUD: 16500, CAD: 18500, CHF: 28000, DKK: 3700, HKD: 3250,
  INR: 305, KRW: 18.5, KWD: 82500, MYR: 5700, NOK: 2400,
  RUB: 280, SAR: 6800, SEK: 2450, SGD: 19000, THB: 720,
};

async function getExchangeRates(): Promise<{ rates: Record<string, number>; source: string }> {
  const now = Date.now();
  if (cachedRates && (now - cacheTimestamp) < CACHE_TTL) {
    return { rates: cachedRates, source: 'vietcombank_cached' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(VCB_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`VCB API returned ${res.status}`);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const json = parser.parse(xml);
    const exrateList = json?.ExrateList?.Exrate;
    if (!exrateList) throw new Error('Invalid VCB XML structure');
    const rates: Record<string, number> = { VND: 1 };
    const items = Array.isArray(exrateList) ? exrateList : [exrateList];
    for (const item of items) {
      const code = (item.CurrencyCode || '').trim();
      const transferStr = (item.Transfer || item.Sell || '').toString().replace(/,/g, '');
      const rate = parseFloat(transferStr);
      if (code && !isNaN(rate) && rate > 0) {
        rates[code] = rate;
      }
    }
    cachedRates = rates;
    cacheTimestamp = now;
    return { rates, source: 'vietcombank' };
  } catch (e: any) {
    console.error('VCB rate fetch error (using fallback):', e?.message);
    return { rates: FALLBACK_RATES, source: 'fallback' };
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json();
        const { transactionId, images, userNotes, recordIds } = body;

        if (!transactionId || !images || images.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', message: 'transactionId và images là bắt buộc' })}\n\n`));
          controller.close();
          return;
        }

        // Pre-fetch exchange rates once for the whole batch
        const { rates, source: rateSource } = await getExchangeRates();
        console.log('Exchange rates fetched from:', rateSource);

        // Collect saved data IDs for batch logic
        const allSavedItems: any[] = [];
        let firstChungTuMuaHang: string | null = null;

        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const { driveLink } = image;
          const noteForImage = userNotes?.[i] || '';
          const recordId = recordIds?.[i] || `REC${Date.now()}`;

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'processing', current: i + 1, total: images.length, message: `Đang xử lý ảnh ${i + 1}/${images.length}...` })}\n\n`));

          try {
            // Tai anh tu Google Drive (anh da duoc upload len Drive o buoc truoc).
            const { base64: base64Image, mime: imageMime } = await downloadDriveImage(driveLink);

            const userMessage = noteForImage
              ? `Ghi chú từ người dùng: "${noteForImage}"\n\nHãy phân tích hình ảnh kết hợp với ghi chú trên để trích xuất dữ liệu tài chính. Trả về JSON Array.`
              : 'Hãy phân tích hình ảnh này để trích xuất dữ liệu tài chính. Trả về JSON Array.';

            const apiResponse = await fetch(OPENROUTER_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': process.env.NEXTAUTH_URL || 'https://bill.toysuncle.art',
                'X-Title': 'Toys Uncle Bill Tracker'
              },
              body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: userMessage },
                      {
                        type: 'image_url',
                        image_url: { url: `data:${imageMime};base64,${base64Image}` }
                      }
                    ]
                  }
                ],
                stream: true,
                max_tokens: 4000
              })
            });

            if (!apiResponse.ok) {
              const errorText = await apiResponse.text();
              console.error('LLM API error:', errorText);
              let errorDetail = `LLM API error ${apiResponse.status}`;
              try {
                const errJson = JSON.parse(errorText);
                errorDetail = errJson?.error || errJson?.message || errorDetail;
              } catch { errorDetail = errorText?.substring(0, 200) || errorDetail; }
              throw new Error(errorDetail);
            }

            const reader = apiResponse.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';
            let partialRead = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              partialRead += decoder.decode(value, { stream: true });
              let lines = partialRead.split('\n');
              partialRead = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (data === '[DONE]') break;
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || '';
                    buffer += content;
                  } catch (e) { /* skip */ }
                }
              }
            }

            console.log('AI result:', buffer.substring(0, 500));

            if (!buffer || buffer.trim().length === 0) {
              throw new Error('AI không trả về kết quả');
            }

            let cleanBuffer = buffer.trim();
            if (cleanBuffer.startsWith('```json')) cleanBuffer = cleanBuffer.slice(7);
            else if (cleanBuffer.startsWith('```')) cleanBuffer = cleanBuffer.slice(3);
            if (cleanBuffer.endsWith('```')) cleanBuffer = cleanBuffer.slice(0, -3);
            cleanBuffer = cleanBuffer.trim();

            let parsedResult: any;
            try {
              parsedResult = JSON.parse(cleanBuffer);
            } catch (parseErr: any) {
              console.error('JSON parse error:', parseErr?.message, 'Raw:', cleanBuffer.substring(0, 300));
              throw new Error(`AI trả về JSON không hợp lệ: ${parseErr?.message}`);
            }

            // Ensure result is always an array
            const lineItems: any[] = Array.isArray(parsedResult) ? parsedResult : [parsedResult];

            // Process each line item and create separate DB records
            const savedItemsForThisImage: any[] = [];

            // V10: VND multi-item -> phan bo GIAM GIA theo TI LE GIA TRI tung dong.
            // Moi dong co GIA LISTING rieng (SoTienGoc); neu tong listing > TongThanhToan
            // (tuc co giam gia) thi nhan moi dong voi ti le = TongThanhToan / tong listing,
            // de tong cac dong = dung so tien thuc tra. Khong co giam gia -> giu nguyen listing.
            const firstLoaiTien = sanitizeNullableStr(lineItems[0]?.LoaiTien) || 'VND';
            let vndAllocMap: Map<number, number> | null = null;
            if (firstLoaiTien === 'VND' && lineItems.length > 1) {
              const paidTotal = parseInt(sanitizeVndInteger(lineItems[0]?.TongThanhToan || '0'), 10) || 0;
              const listed: number[] = lineItems.map((li: any) => parseInt(sanitizeVndInteger(li?.SoTienGoc), 10) || 0);
              const subtotal = listed.reduce((a, b) => a + b, 0);
              const ratio = subtotal > 0 ? paidTotal / subtotal : 0;
              // Chi ap khi co TongThanhToan hop le va ti le trong khoang an toan (0.2..2).
              if (paidTotal > 0 && subtotal > 0 && ratio >= 0.2 && ratio <= 2) {
                vndAllocMap = new Map();
                let allocated = 0;
                for (let k = 0; k < listed.length; k++) {
                  if (k === listed.length - 1) {
                    vndAllocMap.set(k, paidTotal - allocated); // dong cuoi lay phan du -> tong khop tuyet doi
                  } else {
                    const share = Math.round(listed[k] * ratio);
                    vndAllocMap.set(k, share);
                    allocated += share;
                  }
                }
              }
            }

            for (let j = 0; j < lineItems.length; j++) {
              const item = lineItems[j];

              let ngayChi = sanitizeDateStr(item?.NgayChi);
              const ngayNhanHangRaw = sanitizeDateStr(item?.NgayNhanHang);
              // YC3: Fallback — if ngayChi empty but ngayNhanHang exists, copy it
              if (!ngayChi && ngayNhanHangRaw) {
                ngayChi = ngayNhanHangRaw;
              }
              let phanBo = sanitizeNullableStr(item?.PhanBo);
              if (ngayChi && !phanBo) {
                const parts = ngayChi.split('/');
                if (parts.length === 3) phanBo = `T${parts[1]}/${parts[2]}`;
              }

              const chungTuMuaHangVal = sanitizeNullableStr(item?.ChungTuMuaHang)
                || sanitizeNullableStr(item?.ChungTuChi)
                || 'Không có';

              if (i === 0 && j === 0) {
                firstChungTuMuaHang = chungTuMuaHangVal;
              }

              // New currency fields
              const loaiTien = sanitizeNullableStr(item?.LoaiTien) || 'VND';
              // YC1: For VND, treat dots/commas as thousands separators → integer
              const soTienGocRaw = loaiTien === 'VND'
                ? sanitizeVndInteger(item?.SoTienGoc)
                : sanitizeNumericStr(item?.SoTienGoc);
              const soTienGocNum = parseFloat(soTienGocRaw) || 0;
              const soLuongHangRaw = sanitizeNullableNumericStr(item?.SoLuongHang);

              // Convert to VND using Vietcombank rates
              let tongBillVnd = '0';
              let storedSoTienGoc: string | null = soTienGocRaw;
              try {
                if (loaiTien === 'VND') {
                  // V10: gia tung dong sau khi phan bo giam gia theo ti le (neu co),
                  // neu khong thi dung gia listing rieng cua dong.
                  if (vndAllocMap && vndAllocMap.has(j)) {
                    tongBillVnd = vndAllocMap.get(j)!.toString();
                  } else {
                    tongBillVnd = soTienGocRaw;
                  }
                  storedSoTienGoc = null; // VND: no separate "số tiền gốc"
                } else {
                  const rate = rates[loaiTien];
                  if (rate && soTienGocNum !== 0) {
                    tongBillVnd = Math.round(soTienGocNum * rate).toString();
                  } else {
                    tongBillVnd = soTienGocRaw; // fallback: keep original
                  }
                }
              } catch { tongBillVnd = soTienGocRaw; }

              // Backward compat: populate old usd/rmb fields from soTienGoc + loaiTien
              let usdVal = '0';
              let rmbVal: string | null = null;
              if (loaiTien === 'USD') usdVal = soTienGocRaw;
              else if (loaiTien === 'CNY') rmbVal = soTienGocRaw;

              // Auto-calculate donGia from proportional VND
              let donGiaVal: string | null = null;
              try {
                const totalBill = parseFloat(tongBillVnd) || 0;
                const qty = parseFloat(soLuongHangRaw || '0') || 0;
                if (qty > 0 && totalBill > 0) {
                  donGiaVal = Math.round(totalBill / qty).toString();
                } else if (totalBill > 0) {
                  donGiaVal = Math.abs(totalBill).toString();
                }
              } catch { /* non-fatal */ }

              const dienGiai = sanitizeNullableStr(item?.DienGiai);
              const nguoiChi = sanitizeNullableStr(item?.NguoiChi);
              // V9: New 5-group taxonomy
              const validPhanLoai = ['SX', 'LOG', 'MKT', 'QLDN', 'DT'];
              const rawPhanLoai = sanitizeNullableStr(item?.PhanLoai) || 'SX';
              const phanLoai = validPhanLoai.includes(rawPhanLoai) ? rawPhanLoai : 'SX';
              const maChiPhi = sanitizeNullableStr(item?.MaChiPhi) || 'NY';
              // ngayNhanHangRaw already declared above (YC3 fallback)

              // Record ID: append suffix for multi-line items from same image
              const itemRecordId = lineItems.length > 1 ? `${recordId}-${j + 1}` : recordId;

              console.log('Saving line item:', { itemRecordId, dienGiai, soTienGoc: soTienGocRaw, loaiTien, tongBillVnd });

              let savedData;
              try {
                savedData = await prisma.extractedData.create({
                  data: {
                    transactionId,
                    imageUrl: driveLink,
                    cloudStoragePath: '',
                    isPublic: false,
                    ngayChi,
                    phanBo,
                    chungTuChi: chungTuMuaHangVal,
                    dienGiai,
                    vnd: tongBillVnd || '0',
                    usd: usdVal,
                    rmb: rmbVal,
                    soTienGoc: storedSoTienGoc,
                    loaiTien,
                    nguonChiPhi: 'External',
                    soLuongHang: soLuongHangRaw,
                    donGia: donGiaVal,
                    ngayNhanHang: ngayNhanHangRaw,
                    nguoiChi,
                    phanLoai,
                    maChiPhi,
                    linkChungTu: driveLink || null,
                    trangThai: 'Chờ duyệt',
                    recordId: itemRecordId,
                    rawData: JSON.stringify(item),
                    status: 'pending'
                  }
                });
              } catch (prismaErr: any) {
                console.error('Prisma create error:', prismaErr?.message, prismaErr?.meta || '');
                throw new Error(`Lỗi lưu DB: ${prismaErr?.message?.substring(0, 150) || 'Prisma validation error'}`);
              }

              savedItemsForThisImage.push(savedData);
              allSavedItems.push(savedData);
            }

            // Increment processedImages by 1 per image (not per line item)
            await prisma.transaction.update({
              where: { id: transactionId },
              data: { processedImages: { increment: 1 } }
            });

            // Send completed_items (array) for this image
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              status: 'completed_items',
              current: i + 1,
              total: images.length,
              data: savedItemsForThisImage.map(d => ({
                ...d,
                exchangeRates: { rates, source: rateSource },
              }))
            })}\n\n`));

          } catch (error: any) {
            const errMsg = error?.message || 'Unknown error';
            console.error(`Error processing image ${i + 1}:`, errMsg);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              status: 'error_image',
              current: i + 1,
              message: `Ảnh ${i + 1}: ${errMsg}`
            })}\n\n`));
          }
        }

        // Batch logic: apply first image's ChungTuMuaHang to all subsequent items
        if (images.length > 1 && firstChungTuMuaHang && firstChungTuMuaHang !== 'Không có') {
          for (let k = 0; k < allSavedItems.length; k++) {
            const item = allSavedItems[k];
            if (k > 0 && item?.id) {
              try {
                await prisma.extractedData.update({
                  where: { id: item.id },
                  data: { chungTuChi: firstChungTuMuaHang }
                });
              } catch (e) {
                console.error(`Batch update ChungTuMuaHang for id=${item.id} failed:`, e);
              }
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            status: 'batch_update',
            chungTuMuaHang: firstChungTuMuaHang,
            message: `Đã áp dụng Chứng từ mua hàng "${firstChungTuMuaHang}" cho tất cả items trong batch`
          })}\n\n`));
        }

        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'completed' }
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'completed', message: 'Hoàn thành xử lý tất cả ảnh' })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error: any) {
        console.error('Process images error:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'error', message: error?.message || 'Lỗi xử lý' })}\n\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}