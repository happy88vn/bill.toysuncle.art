// Dinh nghia 1 cho duy nhat cho cau truc 19 cot cua tab DuLieuChiPhiTongQuat.
// Dung chung: sync (append) + update-row (ghi de) -> KHONG bao gio lech format.

export const SHEET_TAB = 'DuLieuChiPhiTongQuat';

export const SHEET_HEADER: string[] = [
  'Ngày chi', 'Phân bổ', 'Chứng từ mua hàng', 'Mô tả thường dùng', 'Mô Tả Mới',
  'Tổng Bill (VNĐ)', 'Số tiền gốc', 'Loại tiền', 'Số lượng hàng', 'Đơn giá', 'Ngày nhận hàng',
  'Nguồn chi phí', 'Người chi', 'Phân loại chi phí', 'Loại chứng từ',
  'Link Chứng từ', 'Trạng thái duyệt', 'Record ID', 'Link Vận đơn (GH)',
];

export interface SheetRowInput {
  ngayChi?: string | null;
  phanBo?: string | null;
  chungTuChi?: string | null;
  moTaThuongDung?: string | null;
  dienGiai?: string | null;
  vnd?: string | null;
  soTienGoc?: string | null;
  loaiTien?: string | null;
  soLuongHang?: string | null;
  donGia?: string | null;
  ngayNhanHang?: string | null;
  nguonChiPhi?: string | null;
  nguoiChi?: string | null;
  phanLoai?: string | null;
  maChiPhi?: string | null;
  linkChungTu?: string | null;
  trangThai?: string | null;
  recordId?: string | null;
  anhVanDon?: string | null;
}

/** 1 dong 19 cot (A..S) dung dinh dang. chungTuChi them dau ' de Sheet hieu la text. */
export function buildSheetRow(r: SheetRowInput): string[] {
  const chungTuChiSheet = r.chungTuChi ? `'${r.chungTuChi}` : '';
  return [
    r.ngayChi || '',
    r.phanBo || '',
    chungTuChiSheet,
    r.moTaThuongDung || '',
    r.dienGiai || '',
    r.vnd || '0',
    r.soTienGoc || '',
    r.loaiTien || 'VND',
    r.soLuongHang || '',
    r.donGia || '',
    r.ngayNhanHang || '',
    r.nguonChiPhi || 'Internal',
    r.nguoiChi || '',
    r.phanLoai || '',
    r.maChiPhi || '',
    r.linkChungTu || '',
    r.trangThai || 'Chờ duyệt',
    r.recordId || '',
    r.anhVanDon || '',
  ];
}
