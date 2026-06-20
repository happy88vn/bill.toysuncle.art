'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, FileText, Check, ExternalLink, Edit3, Trash2, ChevronDown, ChevronUp, StickyNote, LogOut, Loader2, PenLine, Search, Plus, AlertTriangle, RefreshCw } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import Fuse from 'fuse.js';

// ===== V7.1: New 5-group category system =====
const PHAN_LOAI_OPTIONS = ['SX', 'LOG', 'MKT', 'QLDN', 'DT'];
const PHAN_LOAI_LABELS: Record<string, string> = {
  'SX': 'SX - Sản xuất',
  'LOG': 'LOG - Logistics',
  'MKT': 'MKT - Marketing',
  'QLDN': 'QLDN - Quản lý DN',
  'DT': 'DT - Đầu tư',
};
const NGUON_CHI_PHI_OPTIONS = ['Internal', 'External'];
const CURRENCY_OPTIONS = [
  'VND', 'USD', 'CNY', 'AUD', 'CAD', 'CHF', 'DKK', 'EUR', 'GBP', 'HKD',
  'INR', 'JPY', 'KRW', 'KWD', 'MYR', 'NOK', 'RUB', 'SAR', 'SEK', 'SGD', 'THB'
];

// "Loại chứng từ" mapped by PhanLoai group — V9 Standard Taxonomy
const MA_CHI_PHI_MAP: Record<string, { label: string; options: { value: string; label: string }[] }[]> = {
  'SX': [
    { label: 'Sản xuất', options: [
      { value: 'NI', label: 'NI - NVL Nhựa in 3D' },
      { value: 'MK', label: 'MK - NVL Phụ kiện' },
      { value: 'LKDT', label: 'LKDT - NVL Điện tử' },
      { value: 'HM', label: 'HM - NVL Thủ công' },
      { value: 'VTK', label: 'VTK - NVL Phụ trợ sản xuất' },
      { value: 'TN', label: 'TN - Tem nhãn dán lên SP' },
      { value: 'BQ', label: 'BQ - Chi phí bản quyền IP Model' },
      { value: 'RD', label: 'RD - Chi phí R&D mẫu mới' },
    ]},
  ],
  'LOG': [
    { label: 'Logistics', options: [
      { value: 'BB', label: 'BB - Vật liệu đóng gói' },
      { value: 'BK', label: 'BK - Vật liệu chống sốc' },
      { value: 'TN', label: 'TN - Tem nhãn & Thẻ cám ơn bao bì' },
      { value: 'SNV', label: 'SNV - Cước VC Nhập vật tư' },
      { value: 'SKH', label: 'SKH - Cước VC Giao khách hàng' },
      { value: 'SDT', label: 'SDT - Cước VC Đối tác gia công' },
    ]},
  ],
  'MKT': [
    { label: 'Marketing', options: [
      { value: 'ADS', label: 'ADS - Ngân sách Quảng cáo' },
      { value: 'GH', label: 'GH - Thuê mặt bằng sự kiện' },
      { value: 'POSM', label: 'POSM - Vật phẩm trưng bày & In ấn' },
      { value: 'VCSK', label: 'VCSK - Cước VC Hội chợ/Sự kiện' },
      { value: 'AU', label: 'AU - Tiếp khách & Ngoại giao' },
    ]},
  ],
  'QLDN': [
    { label: 'Quản lý DN', options: [
      { value: 'TLNV', label: 'TLNV - Quỹ lương & Thưởng nhân sự' },
      { value: 'TMB', label: 'TMB - Thuê mặt bằng/Văn phòng' },
      { value: 'DNI', label: 'DNI - Chi phí Tiện ích' },
      { value: 'PM', label: 'PM - Nền tảng & Phần mềm' },
      { value: 'VPP', label: 'VPP - Hành chính & VPP' },
      { value: 'DVKT', label: 'DVKT - Pháp lý & Kế toán DV' },
      { value: 'THUE', label: 'THUE - Thuế & Lệ phí' },
      { value: 'BHXH', label: 'BHXH - Phúc lợi & Bảo hiểm' },
      { value: 'CPK', label: 'CPK - Chi phí Quản lý khác' },
    ]},
  ],
  'DT': [
    { label: 'Đầu tư', options: [
      { value: 'TTM', label: 'TTM - Đầu tư Máy móc thiết bị mới' },
      { value: 'BTMM', label: 'BTMM - Sửa chữa & Bảo trì máy móc' },
      { value: 'SC', label: 'SC - Cải tạo & Sửa chữa CSVC' },
    ]},
  ],
};

// Helper: get default maChiPhi for a phanLoai
const getDefaultMaChiPhi = (phanLoai: string): string => {
  const groups = MA_CHI_PHI_MAP[phanLoai];
  return groups?.[0]?.options?.[0]?.value || 'NY';
};

interface SkuItem {
  sku: string;
  description: string;
}

interface RowData {
  id: string;
  imageUrl: string;
  ngayChi: string;
  phanBo: string;
  chungTuChi: string;
  moTaThuongDung: string;
  dienGiai: string;
  vnd: string;
  usd: string;
  rmb: string;
  soTienGoc: string;
  loaiTien: string;
  nguonChiPhi: string;
  soLuongHang: string;
  donGia: string;
  ngayNhanHang: string;
  nguoiChi: string;
  phanLoai: string;
  maChiPhi: string;
  linkChungTu: string;
  anhVanDon: string;
  trangThai: string;
  recordId: string;
}

interface RecentOrder {
  chungTuChi: string | null;
  dienGiai: string | null;
  ngayChi: string | null;
}

interface FileWithNote {
  file: File;
  note: string;
  previewUrl: string;
}

// V11: 1 anh van don trong panel "Gan theo Ma don hang"
interface VanDonItem {
  id: string;
  previewUrl: string;
  driveLink: string;
  maDonHang: string;
  status: 'uploading' | 'reading' | 'ready' | 'attaching' | 'done' | 'error';
  message: string;
}

export default function ExpenseTrackerApp() {
  const { data: session, status } = useSession() || {};
  const [filesWithNotes, setFilesWithNotes] = useState<FileWithNote[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [rows, setRows] = useState<RowData[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  // V7.1: SKU Master data + "Upload thêm ảnh" state
  const [skuMasterList, setSkuMasterList] = useState<SkuItem[]>([]);
  const [skuMasterLoaded, setSkuMasterLoaded] = useState(false);
  const [moreFiles, setMoreFiles] = useState<FileWithNote[]>([]);
  const [isProcessingMore, setIsProcessingMore] = useState(false);
  const [driveUploadFailed, setDriveUploadFailed] = useState(false);
  const [moreProgress, setMoreProgress] = useState({ current: 0, total: 0, message: '' });

  // V11: Anh van don (chung tu giao hang)
  const [vanDonUploading, setVanDonUploading] = useState<string | null>(null); // rowId dang upload tren man review
  const [vanDonItems, setVanDonItems] = useState<VanDonItem[]>([]); // panel "gan theo Ma don hang"

  // V12: Che do Ship Quoc Te (cong thuc phi ship phan bo theo trong luong)
  const [internationalMode, setInternationalMode] = useState(false);
  const [repImageIndex, setRepImageIndex] = useState<number | null>(null); // anh dai dien (chi luu 1 anh)

  // V13: Sua lenh da gui (tim tren Sheet -> nap vao review -> ghi de / xoa theo Record ID)
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [showFinder, setShowFinder] = useState(false);
  const [finderQuery, setFinderQuery] = useState('');
  const [finderResults, setFinderResults] = useState<any[]>([]);
  const [finderLoading, setFinderLoading] = useState(false);
  const [finderSelected, setFinderSelected] = useState<Set<string>>(new Set());

  // Helper: compute donGia safely (no NaN/Infinity)
  const computeDonGia = (vnd: string, soLuongHang: string): string => {
    const total = parseFloat(vnd) || 0;
    const qty = parseFloat(soLuongHang) || 0;
    if (qty > 0 && total > 0) return Math.round(total / qty).toString();
    if (total > 0) return total.toString();
    return '0';
  };

  // V8.2: Aggressive cache-busting — timestamp query string forces browser to treat as new request
  const fetchRecentOrders = async () => {
    try {
      const res = await fetch(`/api/recent-orders?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' },
      });
      if (res.ok) {
        const data = await res.json();
        // If API returns empty array → clear dropdown immediately (kill ghost data)
        setRecentOrders(Array.isArray(data.orders) ? data.orders : []);
      } else {
        // API error → force empty, never keep stale state
        setRecentOrders([]);
      }
    } catch {
      setRecentOrders([]);
    }
  };

  // V7.6: Helper to remove Vietnamese diacritics for fuzzy matching
  const unaccent = (str: string): string =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

  // V7.6: Fetch SKU master — ALWAYS fresh (bypass cache), then dedup
  const fetchSkuMaster = async () => {
    try {
      const res = await fetch('/api/sku-master?refresh=true');
      if (res.ok) {
        const data = await res.json();
        const rawItems: SkuItem[] = data.items || [];
        // Dedup by description (case-insensitive) — keep first occurrence
        const seen = new Set<string>();
        const uniqueItems: SkuItem[] = [];
        for (const item of rawItems) {
          const key = item.description.trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            uniqueItems.push(item);
          }
        }
        setSkuMasterList(uniqueItems);
      }
    } catch { /* silent */ }
    setSkuMasterLoaded(true);
  };

  // V8.1.1: Bilingual Color Mapping — comprehensive bidirectional Vietnamese ↔ English
  // Based on full product color palette from Master Data images
  const BILINGUAL_COLOR_MAP: Record<string, string[]> = {
    // === Vietnamese → English (basic) ===
    'den': ['black'], 'trang': ['white'], 'do': ['red'], 'vang': ['yellow'],
    'xam': ['grey', 'gray'], 'hong': ['pink'], 'tim': ['purple'], 'cam': ['orange'],
    'nau': ['brown'], 'bac': ['silver'], 'trong suot': ['clear', 'transparent'],
    // === Vietnamese compound → English ===
    'xanh': ['blue', 'green'], 'xanh la': ['green'], 'xanh duong': ['blue'],
    'xanh dam': ['dark blue', 'navy', 'space blue'],
    'xanh nhat': ['light blue', 'baby blue', 'soft blue'],
    'xanh ngoc': ['jade', 'aqua', 'mint green'],
    'xanh reu': ['olive', 'olive green'],
    'xanh la cay': ['green', 'grass green'],
    'xanh bac ha': ['mint', 'mint green'],
    'xanh matcha': ['matcha', 'matcha green'],
    'do tuoi': ['magenta', 'fire engine red'],
    'do gach': ['brick red', 'brick'],
    'hong nhat': ['peach pink', 'baby pink', 'soft pink'],
    'hong dao': ['peach', 'peach pink'],
    'nau nhat': ['light brown'],
    'trang sua': ['milky white', 'milky'],
    'trang xuong': ['bone white', 'bone'],
    'trang lanh': ['cold white', 'cold'],
    'vang dong': ['gold'],
    'vang hanh nhan': ['almond', 'almond yellow'],
    'vang mu tat': ['mustard', 'mustard green'],
    'tim nhat': ['lilac'],
    'be': ['beige', 'skin'],
    'ka ki': ['khaki', 'light khaki'],
    'mo': ['apricot'],
    'san ho': ['coral', 'coral orange'],
    'da cam': ['orange'],
    // === English → Vietnamese (reverse mapping for AI outputs in English) ===
    'black': ['den'], 'white': ['trang'], 'red': ['do'], 'yellow': ['vang'],
    'grey': ['xam'], 'gray': ['xam'], 'pink': ['hong'], 'purple': ['tim'],
    'orange': ['cam'], 'brown': ['nau'], 'silver': ['bac'], 'blue': ['xanh duong', 'xanh'],
    'green': ['xanh la', 'xanh'], 'gold': ['vang dong'],
    'magenta': ['do tuoi'], 'beige': ['be', 'skin'], 'skin': ['be', 'beige'],
    'khaki': ['ka ki'], 'lilac': ['tim nhat'], 'apricot': ['mo'],
    'coral': ['san ho'], 'aqua': ['xanh ngoc'], 'jade': ['xanh ngoc'],
    'mint': ['xanh bac ha', 'xanh ngoc'], 'olive': ['xanh reu'],
    'navy': ['xanh dam'], 'brick': ['do gach'], 'peach': ['hong dao', 'dao'],
    'bone': ['xuong', 'trang xuong'], 'mustard': ['mu tat', 'vang mu tat'],
    'almond': ['hanh nhan'], 'milky': ['sua', 'trang sua'],
    'matcha': ['xanh matcha'], 'grass': ['co', 'xanh la cay'],
    'holly': ['xanh dam'], 'pine': ['thong', 'xanh'],
    'space': ['xanh dam'], 'cold': ['lanh', 'trang lanh'],
    'peri': ['very peri'], 'fire': ['do tuoi', 'lua'],
  };

  // V8.1: Tokenize — unaccent, strip special chars, split, keep ALL tokens ≥2 chars
  const tokenize = (str: string): string[] => {
    return unaccent(str.trim().toLowerCase())
      .replace(/[()+=|/\\,.:;!?'"#@&\[\]{}<>]/g, ' ')
      .split(/[\s_\-]+/)
      .filter(w => w.length >= 2);
  };

  // V8.1: Enrich AI text with bilingual color equivalents before tokenizing
  const enrichBilingual = (text: string): string => {
    const lower = unaccent(text.trim().toLowerCase());
    let enriched = text;
    // Check multi-word colors first, then single-word
    const sortedKeys = Object.keys(BILINGUAL_COLOR_MAP).sort((a, b) => b.length - a.length);
    for (const viColor of sortedKeys) {
      if (lower.includes(viColor)) {
        const enColors = BILINGUAL_COLOR_MAP[viColor];
        enriched += ' ' + enColors.join(' ');
      }
    }
    return enriched;
  };

  // V8.1: Full-text Bilingual Token Intersection
  // Step 1: Keep 100% of AI text (no truncation)
  // Step 2: Enrich with bilingual color mapping
  // Step 3: Tokenize both AI and Master Data
  // Step 4: Match if ≥2 core tokens (len>2) intersect → force select
  // Step 5: Fallback to "Mô Tả Mới" only if 0-1 matches
  const fuzzyMatchSku = (text: string, skuList: SkuItem[]): SkuItem | null => {
    if (!text || skuList.length === 0) return null;

    // Enrich AI text with bilingual color equivalents, then tokenize
    const enrichedText = enrichBilingual(text);
    const aiTokens = tokenize(enrichedText);
    if (aiTokens.length === 0) return null;

    // Core tokens = tokens with length > 2 (prioritize brand/code/color like "esun", "pla", "black")
    const aiCoreTokens = aiTokens.filter(t => t.length > 2);

    // Bo tu MAU + tu chung chung ra khoi tieu chi khop:
    // tranh "Son lot trang/den" khop nham "No den / tui zip xam" chi vi trung mau.
    const colorWords = new Set<string>(['mau']);
    for (const [k, vals] of Object.entries(BILINGUAL_COLOR_MAP)) {
      for (const w of tokenize(k)) colorWords.add(w);
      for (const v of vals) for (const w of tokenize(v)) colorWords.add(w);
    }

    let bestMatch: SkuItem | null = null;
    let bestScore = 0;

    for (const item of skuList) {
      // Also enrich master data item with bilingual colors for symmetric matching
      const enrichedItem = enrichBilingual(item.description);
      const itemTokens = tokenize(enrichedItem);
      if (itemTokens.length === 0) continue;

      const itemTokenSet = new Set(itemTokens);

      // Chi dem token SAN PHAM (khong phai mau) trung nhau.
      let productMatchCount = 0;
      for (const ct of aiCoreTokens) {
        if (colorWords.has(ct)) continue; // mau khong tinh la khop san pham
        for (const it of itemTokenSet) {
          if (ct === it || it.includes(ct) || ct.includes(it)) {
            productMatchCount++;
            break;
          }
        }
      }

      // CAN >=2 token SAN PHAM trung (mau khong du de khop). Ko du -> de trong,
      // makeRowFromData se tu lay ten AI lam "Mo Ta Moi".
      if (productMatchCount >= 2 && productMatchCount > bestScore) {
        bestScore = productMatchCount;
        bestMatch = item;
      }
    }

    return bestMatch;
  };

  // Check Drive connection status on mount
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const res = await fetch('/api/auth/google-drive/status');
        if (res.ok) {
          const data = await res.json();
          setDriveConnected(data.connected);
        }
      } catch { setDriveConnected(false); }
    };
    checkDrive();
    fetchSkuMaster();

    // Check URL params for drive connection result
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('drive_connected') === 'true') {
        setDriveConnected(true);
        toast.success('Google Drive đã được kết nối thành công!');
        window.history.replaceState({}, '', '/');
      }
      if (params.get('drive_error')) {
        const err = params.get('drive_error');
        toast.error(`Lỗi kết nối Drive: ${err}`);
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      note: '',
      previewUrl: URL.createObjectURL(file),
    }));
    setFilesWithNotes(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFilesWithNotes(prev => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].previewUrl);
      copy.splice(index, 1);
      return copy;
    });
  };

  const updateNote = (index: number, note: string) => {
    setFilesWithNotes(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], note };
      return copy;
    });
  };

  const generateRecordId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const uploadToDrive = async (file: File, driveFileName: string): Promise<string> => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());

    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', mm);
    formData.append('year', yyyy);
    formData.append('fileName', driveFileName);

    const res = await fetch('/api/drive-upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Drive upload failed');
    }
    const data = await res.json();
    return data.viewLink || '';
  };

  // ===== V11: Anh van don / chung tu giao hang =====
  // (A) Dinh kem tren man review: upload + gan cho dong nay + moi dong cung Ma don.
  const attachVanDonToRow = async (row: RowData, file: File) => {
    if (!file) return;
    setVanDonUploading(row.id);
    const oldLink = row.anhVanDon; // neu day la "Doi anh khac" -> co link cu can don
    try {
      const baseId = getBaseRecordId(row.recordId);
      const safe = (row.chungTuChi || row.recordId || 'vandon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      const link = await uploadToDrive(file, `${safe}_vandon_${Date.now()}`);
      setRows(prev => prev.map(r => {
        const sameRow = r.id === row.id;
        const sameOrder = !!baseId && getBaseRecordId(r.recordId) === baseId;
        return (sameRow || sameOrder) ? { ...r, anhVanDon: link } : r;
      }));
      // Thay anh: xoa file Drive cu de tranh rac (chi khi dong CHUA sync — neu da sync
      // thi sheet con tro vao link cu nen giu lai).
      if (oldLink && oldLink !== link && row.trangThai !== 'Đã duyệt') {
        await deleteDriveFiles([oldLink]);
      }
      toast.success('Đã đính kèm ảnh vận đơn vào hóa đơn');
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi tải ảnh vận đơn');
    } finally {
      setVanDonUploading(null);
    }
  };

  const updateVanDonItem = (id: string, patch: Partial<VanDonItem>) => {
    setVanDonItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeVanDonItem = async (id: string) => {
    const it = vanDonItems.find(x => x.id === id);
    if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
    setVanDonItems(prev => prev.filter(x => x.id !== id));
    // Da upload len Drive NHUNG CHUA gan vao bill (status != 'done') -> xoa file Drive tranh rac.
    // Neu da 'done' (da gan vao hoa don) -> GIU lai vi anh dang la chung tu cua bill do.
    if (it?.driveLink && it.status !== 'done') {
      const ok = await deleteDriveFiles([it.driveLink]);
      if (ok) toast.success('Đã xoá ảnh khỏi Drive');
    }
  };

  // (B) Panel "Gan theo Ma don hang": upload anh -> OCR doc Ma don -> Sep xac nhan -> gan.
  const onPickVanDonFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    for (const file of files) {
      const id = generateRecordId();
      const previewUrl = URL.createObjectURL(file);
      setVanDonItems(prev => [...prev, { id, previewUrl, driveLink: '', maDonHang: '', status: 'uploading', message: 'Đang tải ảnh lên Drive...' }]);
      try {
        const link = await uploadToDrive(file, `vandon_${Date.now()}_${id}`);
        updateVanDonItem(id, { driveLink: link, status: 'reading', message: 'Đang đọc Mã đơn hàng...' });
        let ma = '';
        try {
          const res = await fetch('/api/read-madon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driveLink: link }),
          });
          const data = await res.json().catch(() => ({}));
          ma = data?.maDonHang || '';
        } catch { /* OCR loi -> nhap tay */ }
        updateVanDonItem(id, {
          maDonHang: ma,
          status: 'ready',
          message: ma ? 'Đã đọc mã — kiểm tra rồi bấm Gắn' : 'Không đọc được mã — nhập tay rồi bấm Gắn',
        });
      } catch (e: any) {
        updateVanDonItem(id, { status: 'error', message: e?.message || 'Lỗi tải ảnh lên Drive' });
      }
    }
  };

  const attachVanDonByOrder = async (item: VanDonItem) => {
    const ma = (item.maDonHang || '').trim();
    if (!item.driveLink) { toast.error('Ảnh chưa tải lên xong'); return; }
    if (!ma) { toast.error('Chưa có Mã đơn hàng để gắn'); return; }
    updateVanDonItem(item.id, { status: 'attaching', message: 'Đang gắn vào hóa đơn...' });
    try {
      const res = await fetch('/api/attach-vandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveLink: item.driveLink, maDonHang: ma }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Lỗi gắn vận đơn');
      if (data.success) {
        updateVanDonItem(item.id, { status: 'done', message: data.message || 'Đã gắn xong' });
        toast.success(data.message || 'Đã gắn ảnh vận đơn');
        // Neu hoa don dang hien tren man review -> cap nhat luon
        setRows(prev => prev.map(r => (r.chungTuChi && r.chungTuChi.trim().toUpperCase() === ma.toUpperCase() ? { ...r, anhVanDon: item.driveLink } : r)));
      } else {
        updateVanDonItem(item.id, { status: 'ready', message: data.message || 'Không tìm thấy hóa đơn khớp mã' });
        toast.error(data.message || 'Không tìm thấy hóa đơn khớp mã này');
      }
    } catch (e: any) {
      updateVanDonItem(item.id, { status: 'ready', message: e?.message || 'Lỗi gắn vận đơn' });
      toast.error(e?.message || 'Lỗi gắn vận đơn');
    }
  };

  // Anh bill luu link Drive (private) -> hien qua proxy /api/drive-image.
  // blob:/data: (preview luc moi chon anh) thi giu nguyen.
  const driveImgSrc = (url: string | null | undefined): string => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (url.includes('drive.google.com') || /^[a-zA-Z0-9_-]{20,}$/.test(url)) {
      const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const id = m ? m[1] : url;
      return `/api/drive-image?id=${encodeURIComponent(id)}`;
    }
    return url;
  };

  // Helper: create RowData from SSE data
  const makeRowFromData = (d: any, localPreview: string, currentSkuList: SkuItem[]): RowData => {
    const dienGiai = d.dienGiai || '';
    // Fuzzy match against SKU master
    const match = fuzzyMatchSku(dienGiai, currentSkuList);
    return {
      id: d.id,
      imageUrl: d.imageUrl || localPreview || '',
      // YC3: Fallback — if ngayChi empty but ngayNhanHang exists, copy it
      ngayChi: d.ngayChi || d.ngayNhanHang || '',
      phanBo: d.phanBo || ((!d.ngayChi && d.ngayNhanHang) ? (() => { const p = d.ngayNhanHang.split('/'); return p.length === 3 ? `T${p[1]}/${p[2]}` : ''; })() : ''),
      chungTuChi: d.chungTuChi || '',
      moTaThuongDung: match ? match.description : '',
      dienGiai: match ? '' : dienGiai,
      vnd: d.vnd || '0',
      usd: d.usd || '0',
      rmb: d.rmb || '0',
      soTienGoc: d.soTienGoc || '0',
      loaiTien: d.loaiTien || 'VND',
      nguonChiPhi: d.nguonChiPhi || 'Internal',
      soLuongHang: d.soLuongHang || '',
      donGia: d.donGia || computeDonGia(d.vnd || '0', d.soLuongHang || ''),
      ngayNhanHang: d.ngayNhanHang || '',
      nguoiChi: d.nguoiChi || '',
      phanLoai: PHAN_LOAI_OPTIONS.includes(d.phanLoai) ? d.phanLoai : 'SX',
      maChiPhi: d.maChiPhi || getDefaultMaChiPhi(d.phanLoai || 'SX'),
      linkChungTu: d.linkChungTu || '',
      anhVanDon: d.anhVanDon || '',
      trangThai: 'Chờ duyệt',
      recordId: d.recordId || '',
    };
  };

  // Shared SSE reader logic
  const handleSSEStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    filesList: FileWithNote[],
    appendMode: boolean,
    setProgressFn: (p: { current: number; total: number; message: string }) => void,
    setProcessingFn: (v: boolean) => void,
  ) => {
    const decoder = new TextDecoder();
    let partialRead = '';
    // Use latest skuMasterList
    const currentSkuList = skuMasterList;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      partialRead += decoder.decode(value, { stream: true });
      let lines = partialRead.split('\n');
      partialRead = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            toast.success('Hoàn thành xử lý tất cả hình ảnh!');
            setStep('review');
            setProcessingFn(false);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === 'processing') {
              setProgressFn({ current: parsed.current || 0, total: parsed.total || filesList.length, message: parsed.message || 'Đang xử lý...' });
            } else if (parsed.status === 'completed_items') {
              const items: any[] = parsed.data || [];
              const imgIdx = (parsed.current || 1) - 1;
              const localPreview = filesList[imgIdx]?.previewUrl || '';
              const newRows: RowData[] = items.map((d: any) => makeRowFromData(d, localPreview, currentSkuList));
              setRows(prev => [...prev, ...newRows]);
              setSelectedIds(prev => {
                const s = new Set(prev);
                newRows.forEach(r => s.add(r.id));
                return s;
              });
              setProgressFn({ current: parsed.current, total: parsed.total || filesList.length, message: `AI đã xử lý ${parsed.current}/${parsed.total || filesList.length} ảnh (${newRows.length} dòng)` });
            } else if (parsed.status === 'completed_image') {
              const d = parsed.data;
              const singleImgIdx = (parsed.current || 1) - 1;
              const singleLocalPreview = filesList[singleImgIdx]?.previewUrl || '';
              const newRow = makeRowFromData(d, singleLocalPreview, currentSkuList);
              setRows(prev => [...prev, newRow]);
              setSelectedIds(prev => new Set([...prev, d.id]));
              setProgressFn({ current: parsed.current, total: parsed.total || filesList.length, message: `AI đã xử lý ${parsed.current}/${parsed.total || filesList.length} ảnh` });
            } else if (parsed.status === 'batch_update') {
              const batchVal = parsed.chungTuMuaHang;
              if (batchVal) {
                setRows(prev => prev.map((r, idx) => idx > 0 ? { ...r, chungTuChi: batchVal } : r));
              }
            } else if (parsed.status === 'error_image') {
              toast.error(`Lỗi ảnh ${parsed.current}: ${parsed.message}`);
            } else if (parsed.status === 'error') {
              toast.error(parsed.message || 'Lỗi xử lý');
            }
          } catch (e) { /* skip */ }
        }
      }
    }
  };

  // Shared upload+process pipeline
  const uploadAndProcess = async (
    filesList: FileWithNote[],
    appendMode: boolean,
    setProgressFn: (p: { current: number; total: number; message: string }) => void,
    setProcessingFn: (v: boolean) => void,
  ) => {
    setProcessingFn(true);
    setProgressFn({ current: 0, total: filesList.length, message: 'Đang chuẩn bị...' });
    if (!appendMode) setRows([]);

    try {
      const batchId = generateRecordId();
      const recordIds: string[] = filesList.map((_, i) =>
        filesList.length > 1 ? `${batchId}_${i + 1}` : batchId
      );

      // Step 1: Upload to Google Drive — BLOCK if any upload fails
      setDriveUploadFailed(false);
      setProgressFn({ current: 0, total: filesList.length, message: 'Đang upload lên Google Drive...' });
      const driveLinks: string[] = [];
      let driveFailCount = 0;
      for (let i = 0; i < filesList.length; i++) {
        setProgressFn({ current: i + 1, total: filesList.length, message: `Đang upload ảnh ${i + 1}/${filesList.length} lên Drive...` });
        try {
          const link = await uploadToDrive(filesList[i].file, recordIds[i]);
          driveLinks.push(link);
        } catch (err: any) {
          console.error('Drive upload error:', err);
          driveLinks.push('');
          driveFailCount++;
          toast.error(`Lỗi upload ảnh ${i + 1}: ${err.message}`);
        }
      }

      // V8.3: If ANY Drive upload failed → block, show error, allow retry
      if (driveFailCount > 0) {
        setDriveUploadFailed(true);
        setProcessingFn(false);
        setProgressFn({ current: 0, total: 0, message: '' });
        toast.error(`${driveFailCount}/${filesList.length} ảnh không upload được lên Drive. Vui lòng thử lại!`);
        return; // STOP — do not proceed to AI processing
      }

      // Step 2: Create transaction
      const transactionRes = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalImages: filesList.length }),
      });
      if (!transactionRes.ok) throw new Error('Không thể tạo transaction');
      const transaction = await transactionRes.json();

      // Step 3: AI doc anh THANG TU GOOGLE DRIVE (anh da upload o Step 1).
      // Bo han khau S3 trung gian — Drive vua la kho luu vua la nguon cho AI.
      const uploadedImages: { driveLink: string }[] = driveLinks.map((link) => ({ driveLink: link }));

      // Step 4: Process with AI
      setProgressFn({ current: 0, total: filesList.length, message: 'AI đang phân tích ảnh...' });
      const processRes = await fetch('/api/process-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          images: uploadedImages,
          userNotes: filesList.map(f => f.note),
          recordIds,
        }),
      });

      if (!processRes.ok) throw new Error('Không thể xử lý hình ảnh');

      const reader = processRes.body?.getReader();
      if (!reader) throw new Error('No response body');

      await handleSSEStream(reader, filesList, appendMode, setProgressFn, setProcessingFn);
    } catch (error: any) {
      console.error('Processing error:', error);
      toast.error(error?.message || 'Lỗi khi xử lý hình ảnh');
    } finally {
      setProcessingFn(false);
    }
  };

  const processImages = async () => {
    if (filesWithNotes.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 hình ảnh');
      return;
    }
    await uploadAndProcess(filesWithNotes, false, setProgress, setIsProcessing);
  };

  // V12: Ship Quoc Te — KHONG upload het anh, gui base64 cho AI tinh phi ship phan bo theo kg.
  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const processShipQuocte = async () => {
    if (filesWithNotes.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 hình ảnh (ảnh tổng tiền + ảnh chi tiết trọng lượng)');
      return;
    }
    setIsProcessing(true);
    setRows([]);
    setProgress({ current: 0, total: filesWithNotes.length, message: 'AI đang đọc tổng tiền + trọng lượng...' });
    try {
      const txRes = await fetch('/api/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalImages: filesWithNotes.length }),
      });
      if (!txRes.ok) throw new Error('Không thể tạo transaction');
      const tx = await txRes.json();

      const images = await Promise.all(filesWithNotes.map(async f => ({ base64: await fileToBase64(f.file), mime: f.file.type || 'image/jpeg' })));

      const res = await fetch('/api/ship-quocte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx.id, images }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Không xử lý được ship quốc tế');

      const newRows: RowData[] = (data.rows || []).map((d: any) => ({
        id: d.id,
        imageUrl: '',
        ngayChi: d.ngayChi || '', phanBo: d.phanBo || '',
        chungTuChi: d.chungTuChi || '',
        moTaThuongDung: '', dienGiai: d.dienGiai || 'Dịch vụ logistics quốc tế',
        vnd: d.vnd || '0', usd: d.usd || '0', rmb: d.rmb || '0',
        soTienGoc: d.soTienGoc || '', loaiTien: d.loaiTien || 'CNY',
        nguonChiPhi: d.nguonChiPhi || 'Internal',
        soLuongHang: '', donGia: '',
        ngayNhanHang: '', nguoiChi: '',
        phanLoai: d.phanLoai || 'LOG', maChiPhi: d.maChiPhi || 'SNV',
        linkChungTu: '', anhVanDon: '',
        trangThai: 'Chờ duyệt', recordId: d.recordId || '',
      }));
      if (newRows.length === 0) throw new Error('Không tạo được dòng phí ship');

      setRows(newRows);
      setSelectedIds(new Set(newRows.map(r => r.id)));
      setRepImageIndex(filesWithNotes.length === 1 ? 0 : null);
      setStep('review');
      const sm = data.summary?.map((s: any) => `${s.maVanDon}: ${s.fee}`).join(' · ') || '';
      toast.success(`Đã tính phí ship cho ${newRows.length} mã vận đơn ${sm ? `(${sm})` : ''}`);
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi xử lý ship quốc tế');
    } finally {
      setIsProcessing(false);
    }
  };

  // V7.1: "Upload thêm ảnh" — appends new rows to existing ones
  const processMoreImages = async () => {
    if (moreFiles.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 hình ảnh');
      return;
    }
    await uploadAndProcess(moreFiles, true, setMoreProgress, setIsProcessingMore);
    // Clear the "more files" list after processing
    moreFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
    setMoreFiles([]);
  };

  // Dropzone for "Upload thêm ảnh"
  const onDropMore = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      note: '',
      previewUrl: URL.createObjectURL(file),
    }));
    setMoreFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps: getMoreRootProps, getInputProps: getMoreInputProps, isDragActive: isMoreDragActive } = useDropzone({
    onDrop: onDropMore,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
    multiple: true,
  });

  // Auto-convert currency when soTienGoc or loaiTien changes
  const convertCurrency = async (id: string, soTienGoc: string, loaiTien: string) => {
    if (!soTienGoc || loaiTien === 'VND') {
      setRows(prev => prev.map(r => {
        if (r.id !== id) return r;
        const vnd = soTienGoc || '0';
        return { ...r, vnd, donGia: computeDonGia(vnd, r.soLuongHang) };
      }));
      return;
    }
    try {
      const amount = parseFloat(soTienGoc) || 0;
      if (amount === 0) return;
      const res = await fetch(`/api/exchange-rate?currency=${loaiTien}&amount=${amount}`);
      if (res.ok) {
        const data = await res.json();
        const tongBillVnd = (data.tongBillVnd || 0).toString();
        setRows(prev => prev.map(r => {
          if (r.id !== id) return r;
          return { ...r, vnd: tongBillVnd, donGia: computeDonGia(tongBillVnd, r.soLuongHang) };
        }));
      }
    } catch { /* silent */ }
  };

  // Các dòng tách từ CÙNG 1 bill -> auto áp giá trị sang nhau khi sửa:
  //  - FILL_EMPTY: chỉ điền vào dòng cùng bill đang TRỐNG (không ghi đè).
  //  - OVERWRITE: ghi đè tất cả dòng cùng bill.
  const FILL_EMPTY_FIELDS: (keyof RowData)[] = ['ngayChi', 'ngayNhanHang', 'nguoiChi'];
  const OVERWRITE_FIELDS: (keyof RowData)[] = ['phanLoai', 'maChiPhi', 'nguonChiPhi'];

  const updateRow = (id: string, field: keyof RowData, value: string) => {
    setRows(prev => {
      const editedRow = prev.find(r => r.id === id);
      const baseId = editedRow ? getBaseRecordId(editedRow.recordId) : '';
      const doFillEmpty = FILL_EMPTY_FIELDS.includes(field);
      const doOverwrite = OVERWRITE_FIELDS.includes(field);

      return prev.map(r => {
        // 1) Dòng đang sửa
        if (r.id === id) {
          const updated = { ...r, [field]: value };
          if (field === 'ngayChi' && value) {
            const parts = value.split('/');
            if (parts.length === 3) updated.phanBo = `T${parts[1]}/${parts[2]}`;
          }
          if (field === 'vnd' || field === 'soLuongHang') {
            const vndVal = field === 'vnd' ? value : updated.vnd;
            const qtyVal = field === 'soLuongHang' ? value : updated.soLuongHang;
            updated.donGia = computeDonGia(vndVal, qtyVal);
          }
          return updated;
        }
        // 2) Dòng cùng bill (cùng mã gốc, mã không rỗng) -> propagate
        if (baseId && getBaseRecordId(r.recordId) === baseId) {
          if (doOverwrite) {
            return { ...r, [field]: value };
          }
          if (doFillEmpty) {
            const oldVal = (editedRow ? (editedRow[field] as string) : '') || '';
            const cur = (r[field] as string) || '';
            // Mirror: điền nếu dòng đang TRỐNG, hoặc đang khớp giá trị CŨ của dòng
            // nguồn (đang soi gương, chưa bị sửa tay khác) -> bám tới giá trị cuối,
            // tránh kẹt ở ký tự đầu khi gõ từng phím.
            if (cur === '' || cur === oldVal) {
              const sib = { ...r, [field]: value };
              if (field === 'ngayChi' && value) {
                const parts = value.split('/');
                if (parts.length === 3) sib.phanBo = `T${parts[1]}/${parts[2]}`;
              }
              return sib;
            }
          }
        }
        return r;
      });
    });

    // Trigger currency conversion when soTienGoc or loaiTien changes
    if (field === 'soTienGoc' || field === 'loaiTien') {
      const row = rows.find(r => r.id === id);
      if (row) {
        const newSoTienGoc = field === 'soTienGoc' ? value : row.soTienGoc;
        const newLoaiTien = field === 'loaiTien' ? value : row.loaiTien;
        convertCurrency(id, newSoTienGoc, newLoaiTien);
      }
    }
  };

  // V7.8: Helper to extract base Record ID (before last "-" suffix from backend line-item split)
  const getBaseRecordId = (recordId: string): string => {
    if (!recordId) return '';
    // Backend appends "-1", "-2" etc. for multi-line items from same image
    const lastDash = recordId.lastIndexOf('-');
    if (lastDash > 0) {
      const suffix = recordId.substring(lastDash + 1);
      // Only strip if suffix is a pure number (the line-item index)
      if (/^\d+$/.test(suffix)) return recordId.substring(0, lastDash);
    }
    return recordId;
  };

  // V7.9: Delete Drive files — AWAIT result, log confirmation
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [hasSyncedToSheets, setHasSyncedToSheets] = useState(false);

  const deleteDriveFiles = async (driveLinks: string[], baseRecordId?: string): Promise<boolean> => {
    const validLinks = driveLinks.filter(l => l && l.includes('drive.google.com'));
    if (validLinks.length === 0) return true;
    try {
      const res = await fetch('/api/drive-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveLinks: validLinks }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log('Deleted Drive File:', baseRecordId || 'batch', '— deleted:', data.deleted, '/', data.total);
        return true;
      } else {
        console.error('Drive DELETE failed:', res.status);
        return false;
      }
    } catch (err) {
      console.error('Drive GC error:', err);
      return false;
    }
  };

  const removeRow = async (id: string) => {
    const rowToDelete = rows.find(r => r.id === id);
    if (!rowToDelete) return;

    // V13: Che do sua lenh da gui -> XOA HAN tren Sheet + DB + Drive (qua route).
    if (editingSubmitted) {
      if (!window.confirm(`Xoá hẳn lệnh "${rowToDelete.chungTuChi || rowToDelete.dienGiai || rowToDelete.recordId}" khỏi Google Sheets? Không hoàn tác được.`)) return;
      setDeletingRowId(id);
      try {
        const res = await fetch('/api/google-sheets/delete-row', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: rowToDelete.id, recordId: rowToDelete.recordId, linkChungTu: rowToDelete.linkChungTu }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          toast.success(data.message || 'Đã xoá lệnh');
          setRows(prev => prev.filter(r => r.id !== id));
          setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        } else {
          toast.error(data?.error || 'Lỗi xoá lệnh');
        }
      } catch (e: any) {
        toast.error(e?.message || 'Lỗi xoá lệnh');
      } finally {
        setDeletingRowId(null);
      }
      return;
    }

    const remaining = rows.filter(r => r.id !== id);

    // V7.9: Check if last row with this base Record ID — if so, AWAIT Drive delete
    if (rowToDelete.recordId && rowToDelete.linkChungTu) {
      const baseId = getBaseRecordId(rowToDelete.recordId);
      const stillHasSiblings = remaining.some(r => getBaseRecordId(r.recordId) === baseId);
      if (!stillHasSiblings) {
        setDeletingRowId(id); // show spinner
        await deleteDriveFiles([rowToDelete.linkChungTu], baseId);
        setDeletingRowId(null);
      }
    }

    // Only remove from UI AFTER Drive delete completes
    setRows(remaining);
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.id)));
  };

  // ===== V13: SUA LENH DA GUI =====
  const loadSyncedEntries = async (q: string) => {
    setFinderLoading(true);
    try {
      const res = await fetch(`/api/synced-entries?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Lỗi tải danh sách');
      setFinderResults(data.rows || []);
    } catch (e: any) {
      toast.error(e?.message || 'Lỗi tải danh sách lệnh đã gửi');
      setFinderResults([]);
    } finally {
      setFinderLoading(false);
    }
  };

  const openFinder = () => {
    setShowFinder(true);
    setFinderQuery('');
    setFinderSelected(new Set());
    loadSyncedEntries('');
  };

  const toggleFinderSelect = (recordId: string) => {
    setFinderSelected(prev => { const n = new Set(prev); n.has(recordId) ? n.delete(recordId) : n.add(recordId); return n; });
  };

  const openSelectedForEdit = () => {
    const chosen = finderResults.filter(r => finderSelected.has(r.recordId));
    if (chosen.length === 0) { toast.error('Chọn ít nhất 1 lệnh để sửa'); return; }
    const newRows: RowData[] = chosen.map((d: any) => ({
      id: d.recordId,
      imageUrl: d.linkChungTu || '',
      ngayChi: d.ngayChi || '', phanBo: d.phanBo || '',
      chungTuChi: d.chungTuChi || '', moTaThuongDung: d.moTaThuongDung || '', dienGiai: d.dienGiai || '',
      vnd: d.vnd || '0', usd: '0', rmb: '0',
      soTienGoc: d.soTienGoc || '', loaiTien: d.loaiTien || 'VND',
      nguonChiPhi: d.nguonChiPhi || 'Internal',
      soLuongHang: d.soLuongHang || '', donGia: d.donGia || '',
      ngayNhanHang: d.ngayNhanHang || '', nguoiChi: d.nguoiChi || '',
      phanLoai: PHAN_LOAI_OPTIONS.includes(d.phanLoai) ? d.phanLoai : 'SX',
      maChiPhi: d.maChiPhi || 'NY',
      linkChungTu: d.linkChungTu || '', anhVanDon: d.anhVanDon || '',
      trangThai: d.trangThai || 'Chờ duyệt', recordId: d.recordId || '',
    }));
    setInternationalMode(false);
    setRows(newRows);
    setSelectedIds(new Set(newRows.map(r => r.id)));
    setEditingSubmitted(true);
    setStep('review');
    setShowFinder(false);
    toast.success(`Đã nạp ${newRows.length} lệnh để sửa — chỉnh xong bấm "Cập nhật lên Sheet"`);
  };

  const updateSubmittedRows = async () => {
    const selectedRows = rows.filter(r => selectedIds.has(r.id));
    if (selectedRows.length === 0) { toast.error('Chọn ít nhất 1 dòng'); return; }
    setIsSyncing(true);
    let ok = 0; let fail = 0; const failMsgs: string[] = [];
    for (const row of selectedRows) {
      try {
        const res = await fetch('/api/google-sheets/update-row', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) ok++; else { fail++; failMsgs.push(data?.error || 'lỗi'); }
      } catch (e: any) { fail++; failMsgs.push(e?.message || 'lỗi'); }
    }
    setIsSyncing(false);
    if (fail === 0) {
      toast.success(`Đã cập nhật ${ok} dòng lên Google Sheets`);
      exitEditMode();
    } else {
      toast.error(`Cập nhật: ${ok} OK, ${fail} lỗi (${failMsgs[0]}). Kiểm tra Record ID còn trên Sheet không.`);
    }
  };

  const exitEditMode = () => {
    setRows([]);
    setSelectedIds(new Set());
    setEditingSubmitted(false);
    setStep('upload');
  };

  const syncToGoogleSheets = async () => {
    let selectedRows = rows.filter(r => selectedIds.has(r.id));
    if (selectedRows.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 dòng');
      return;
    }

    // V9: NY fallback is allowed for all categories (safe default per taxonomy rules)

    // V12: Ship Quoc Te — chua upload anh. Bat User chon 1 anh dai dien -> upload -> gan link cho moi dong.
    if (internationalMode && selectedRows.some(r => !r.linkChungTu)) {
      if (repImageIndex == null || !filesWithNotes[repImageIndex]) {
        toast.error('Chọn 1 ảnh đại diện để lưu trước khi gửi');
        return;
      }
      setIsSyncing(true);
      let repLink = '';
      try {
        repLink = await uploadToDrive(filesWithNotes[repImageIndex].file, `shipQT_${Date.now()}`);
      } catch (e: any) {
        toast.error(e?.message || 'Lỗi upload ảnh đại diện');
        setIsSyncing(false);
        return;
      }
      setRows(prev => prev.map(r => (!r.linkChungTu ? { ...r, linkChungTu: repLink, imageUrl: repLink } : r)));
      selectedRows = selectedRows.map(r => (!r.linkChungTu ? { ...r, linkChungTu: repLink, imageUrl: repLink } : r));
    }

    setIsSyncing(true);
    try {
      // V9: Save new "Mô Tả Mới" entries to SKU master — whenever dienGiai has text
      const newDescriptions: string[] = [];
      for (const row of selectedRows) {
        if (row.dienGiai && row.dienGiai.trim()) {
          const trimmed = row.dienGiai.trim();
          const exists = skuMasterList.some(s => s.description.toLowerCase() === trimmed.toLowerCase());
          if (!exists && !newDescriptions.includes(trimmed)) {
            newDescriptions.push(trimmed);
          }
        }
      }
      if (newDescriptions.length > 0) {
        try {
          await fetch('/api/sku-master', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newDescriptions }),
          });
          // Refresh SKU master after adding
          setSkuMasterLoaded(false);
          fetchSkuMaster();
        } catch (skuErr) {
          console.error('SKU master append error:', skuErr);
        }
      }

      let targetSheetId: string | null = null;
      const listRes = await fetch('/api/google-sheets/list');
      if (listRes.ok) {
        const { sheets } = await listRes.json();
        if (sheets && sheets.length > 0) {
          targetSheetId = sheets[0].sheetId;
          setSheetUrl(sheets[0].sheetUrl);
        }
      }

      if (!targetSheetId) {
        const createRes = await fetch('/api/google-sheets/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetName: 'DuLieuChiPhiTongQuat' }),
        });
        if (!createRes.ok) throw new Error('Không thể tạo Google Sheet');
        const { sheet } = await createRes.json();
        targetSheetId = sheet.sheetId;
        setSheetUrl(sheet.sheetUrl);
      }

      const syncRes = await fetch('/api/google-sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: targetSheetId, editedRows: selectedRows }),
      });

      if (!syncRes.ok) {
        const errData = await syncRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể đồng bộ dữ liệu');
      }

      const result = await syncRes.json();
      toast.success(`Đã đồng bộ ${result.syncedCount} dòng lên Google Sheets!`);

      setHasSyncedToSheets(true);
      setRows(prev => prev.map(r => selectedIds.has(r.id) ? { ...r, trangThai: 'Đã duyệt' } : r));
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error(error?.message || 'Lỗi khi đồng bộ');
    } finally {
      setIsSyncing(false);
    }
  };

  const resetAll = async () => {
    // V8.3: Only delete Drive files if user has NOT synced to Google Sheets yet
    // If already synced → bill is finalized, keep Drive images intact
    if (!hasSyncedToSheets) {
      const uniqueDriveLinks = new Set<string>();
      for (const row of rows) {
        if (row.linkChungTu && row.linkChungTu.includes('drive.google.com')) {
          uniqueDriveLinks.add(row.linkChungTu);
        }
      }
      if (uniqueDriveLinks.size > 0) {
        setIsResetting(true);
        await deleteDriveFiles(Array.from(uniqueDriveLinks), 'RESET_ALL');
        setIsResetting(false);
      }
    }

    filesWithNotes.forEach(f => URL.revokeObjectURL(f.previewUrl));
    moreFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
    setFilesWithNotes([]);
    setMoreFiles([]);
    setRows([]);
    setSelectedIds(new Set());
    setStep('upload');
    setSheetUrl(null);
    setHasSyncedToSheets(false);
    setProgress({ current: 0, total: 0, message: '' });
    setMoreProgress({ current: 0, total: 0, message: '' });
    setRepImageIndex(null);
  };

  // ====== Manual Entry State ======
  const emptyManualForm = {
    ngayChi: '',
    chungTuChi: '',
    moTaThuongDung: '',
    dienGiai: '',
    vnd: '',
    soTienGoc: '',
    loaiTien: 'VND',
    nguonChiPhi: 'Internal',
    soLuongHang: '',
    donGia: '',
    ngayNhanHang: '',
    nguoiChi: '',
    phanLoai: 'SX',
    maChiPhi: 'NI',
  };
  const [manualForm, setManualForm] = useState(emptyManualForm);

  const updateManualField = (field: string, value: string) => {
    setManualForm(prev => {
      const updated = { ...prev, [field]: value };
      // Reset maChiPhi when phanLoai changes
      if (field === 'phanLoai') {
        updated.maChiPhi = getDefaultMaChiPhi(value);
      }
      // When soTienGoc changes and loaiTien is VND, sync to vnd
      if (field === 'soTienGoc' && updated.loaiTien === 'VND') {
        updated.vnd = value || '0';
        updated.donGia = computeDonGia(updated.vnd, updated.soLuongHang);
      }
      // When vnd changes directly (unlocked field), recalc donGia
      if (field === 'vnd') {
        updated.donGia = computeDonGia(value, updated.soLuongHang);
      }
      // Auto-calculate donGia when soLuongHang changes
      if (field === 'soLuongHang') {
        updated.donGia = computeDonGia(updated.vnd, value);
      }
      return updated;
    });

    // Trigger API conversion for foreign currencies
    if (field === 'soTienGoc' || field === 'loaiTien') {
      const newForm = { ...manualForm, [field]: value };
      const amt = parseFloat(field === 'soTienGoc' ? value : newForm.soTienGoc) || 0;
      const cur = field === 'loaiTien' ? value : newForm.loaiTien;
      if (cur !== 'VND' && amt > 0) {
        fetch(`/api/exchange-rate?currency=${cur}&amount=${amt}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.tongBillVnd) {
              setManualForm(prev => ({
                ...prev,
                vnd: data.tongBillVnd.toString(),
                donGia: computeDonGia(data.tongBillVnd.toString(), prev.soLuongHang),
              }));
            }
          })
          .catch(() => {});
      } else if (cur === 'VND') {
        setManualForm(prev => ({
          ...prev,
          vnd: prev.soTienGoc || '0',
          donGia: computeDonGia(prev.soTienGoc || '0', prev.soLuongHang),
        }));
      }
    }
  };

  const [isAddingManual, setIsAddingManual] = useState(false);

  const addManualEntry = async () => {
    // V7.1: Use moTaThuongDung or dienGiai
    const effectiveDienGiai = manualForm.moTaThuongDung || manualForm.dienGiai;
    if (!effectiveDienGiai.trim()) {
      toast.error('Vui lòng chọn mô tả thường dùng hoặc nhập mô tả mới');
      return;
    }
    if (!manualForm.soTienGoc && !manualForm.vnd) {
      toast.error('Vui lòng nhập số tiền gốc');
      return;
    }
    // V9: NY fallback is allowed for all categories

    let phanBo = '';
    if (manualForm.ngayChi) {
      const parts = manualForm.ngayChi.split('-');
      if (parts.length === 3) {
        phanBo = `T${parts[1]}/${parts[0]}`;
      }
    }

    let ngayChiFormatted = '';
    if (manualForm.ngayChi) {
      const parts = manualForm.ngayChi.split('-');
      if (parts.length === 3) {
        ngayChiFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    setIsAddingManual(true);
    try {
      // Step 1: Save to database
      const res = await fetch('/api/manual-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngayChi: ngayChiFormatted,
          phanBo,
          chungTuChi: manualForm.chungTuChi || 'Không có',
          dienGiai: effectiveDienGiai,
          vnd: manualForm.vnd || '0',
          usd: '0',
          rmb: null,
          soTienGoc: manualForm.soTienGoc || manualForm.vnd || '0',
          loaiTien: manualForm.loaiTien || 'VND',
          nguonChiPhi: manualForm.nguonChiPhi || 'Internal',
          soLuongHang: manualForm.soLuongHang || '',
          donGia: manualForm.donGia || computeDonGia(manualForm.vnd, manualForm.soLuongHang),
          ngayNhanHang: manualForm.ngayNhanHang || '',
          nguoiChi: manualForm.nguoiChi,
          phanLoai: manualForm.phanLoai,
          maChiPhi: manualForm.maChiPhi,
          recordId: generateRecordId(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Lỗi tạo dữ liệu');
      }

      const savedData = await res.json();

      const newRow: RowData = {
        id: savedData.id,
        imageUrl: '',
        ngayChi: savedData.ngayChi || '',
        phanBo: savedData.phanBo || '',
        chungTuChi: savedData.chungTuChi || '',
        moTaThuongDung: manualForm.moTaThuongDung || '',
        dienGiai: manualForm.dienGiai || '',
        vnd: savedData.vnd || '0',
        usd: savedData.usd || '0',
        rmb: savedData.rmb || '0',
        soTienGoc: savedData.soTienGoc || '0',
        loaiTien: savedData.loaiTien || 'VND',
        nguonChiPhi: savedData.nguonChiPhi || 'Internal',
        soLuongHang: savedData.soLuongHang || '',
        donGia: savedData.donGia || computeDonGia(savedData.vnd || '0', savedData.soLuongHang || ''),
        ngayNhanHang: savedData.ngayNhanHang || '',
        nguoiChi: savedData.nguoiChi || '',
        phanLoai: savedData.phanLoai || 'SX',
        maChiPhi: savedData.maChiPhi || 'NY',
        linkChungTu: savedData.linkChungTu || '',
        anhVanDon: savedData.anhVanDon || '',
        trangThai: 'Đã duyệt',
        recordId: savedData.recordId || '',
      };

      // Step 2: Sync directly to Google Sheets
      let targetSheetId: string | null = null;
      const listRes = await fetch('/api/google-sheets/list');
      if (listRes.ok) {
        const { sheets } = await listRes.json();
        if (sheets && sheets.length > 0) {
          targetSheetId = sheets[0].sheetId;
          setSheetUrl(sheets[0].sheetUrl);
        }
      }
      if (!targetSheetId) {
        const createRes = await fetch('/api/google-sheets/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetName: 'DuLieuChiPhiTongQuat' }),
        });
        if (!createRes.ok) throw new Error('Không thể tạo Google Sheet');
        const { sheet } = await createRes.json();
        targetSheetId = sheet.sheetId;
        setSheetUrl(sheet.sheetUrl);
      }

      const syncRes = await fetch('/api/google-sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: targetSheetId, editedRows: [newRow] }),
      });

      if (!syncRes.ok) {
        const errData = await syncRes.json().catch(() => ({}));
        // DB saved but sync failed — add to rows for manual retry
        newRow.trangThai = 'Chờ duyệt';
        setRows(prev => [...prev, newRow]);
        setSelectedIds(prev => new Set([...prev, newRow.id]));
        throw new Error(errData.error || 'Đã lưu DB nhưng lỗi đồng bộ Google Sheets');
      }

      // Step 3: Save new description to SKU master if dienGiai has text
      if (manualForm.dienGiai && manualForm.dienGiai.trim()) {
        const trimmed = manualForm.dienGiai.trim();
        const exists = skuMasterList.some(s => s.description.toLowerCase() === trimmed.toLowerCase());
        if (!exists) {
          try {
            await fetch('/api/sku-master', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newDescriptions: [trimmed] }),
            });
            setSkuMasterLoaded(false);
            fetchSkuMaster();
          } catch (skuErr) {
            console.error('SKU master append error:', skuErr);
          }
        }
      }

      // Success — don't add to review list, just reset form
      setManualForm(emptyManualForm);
      toast.success('Đã lưu và gửi lên Google Sheets!');
    } catch (error: any) {
      console.error('Manual entry error:', error);
      toast.error(error?.message || 'Lỗi khi thêm dữ liệu thủ công');
    } finally {
      setIsAddingManual(false);
    }
  };

  const getManualMaOptions = () => {
    const groups = MA_CHI_PHI_MAP[manualForm.phanLoai];
    if (groups) return groups;
    return [{ label: 'Khác', options: [{ value: 'NY', label: 'NY - Chưa biết' }] }];
  };

  const getMaOptions = (phanLoai: string) => {
    const groups = MA_CHI_PHI_MAP[phanLoai];
    if (groups) return groups;
    return [{ label: 'Khác', options: [{ value: 'NY', label: 'NY - Chưa biết' }] }];
  };

  // Get the display description: prefer moTaThuongDung, fallback to dienGiai
  const getDisplayDescription = (row: RowData): string => {
    return row.moTaThuongDung || row.dienGiai || '—';
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ====== NAVBAR ====== */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="w-24 flex items-center">
            <button
              onClick={openFinder}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors text-xs font-medium"
              title="Sửa / Xoá lệnh đã gửi lên Sheet"
            >
              <PenLine className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Sửa lệnh đã gửi</span>
            </button>
          </div>
          <img src="/logo.png" alt="Toys Uncle" className="h-10 object-contain" />
          <div className="flex items-center gap-3 w-24 justify-end">
            {session?.user?.image ? (
              <div className="relative w-9 h-9 rounded-full overflow-hidden ring-2 ring-orange-200">
                <Image src={session.user.image} alt={session.user.name || 'User'} fill className="object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm">
                {(session?.user?.name || session?.user?.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* V13: Finder — Sua/Xoa lenh da gui */}
      {showFinder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowFinder(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><PenLine className="w-5 h-5 text-orange-500" /> Sửa / Xoá lệnh đã gửi</h2>
              <button onClick={() => setShowFinder(false)} className="text-gray-400 hover:text-gray-700 p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="p-5">
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input value={finderQuery} onChange={e => setFinderQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') loadSyncedEntries(finderQuery); }} placeholder="Tìm theo Mã đơn hàng / mô tả..." className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none" />
                </div>
                <button onClick={() => loadSyncedEntries(finderQuery)} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">Tìm</button>
              </div>
              <p className="text-xs text-gray-400 mb-2">{finderQuery ? 'Kết quả tìm' : 'Các lệnh gửi gần đây nhất'} — tích chọn dòng cần sửa/xoá rồi bấm Mở.</p>
              <div className="max-h-[50vh] overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-100">
                {finderLoading ? (
                  <div className="p-8 text-center text-gray-400 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Đang tải...</div>
                ) : finderResults.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">Không có lệnh nào khớp.</div>
                ) : finderResults.map((r: any) => (
                  <label key={r.recordId} className="flex items-center gap-3 p-3 hover:bg-orange-50/40 cursor-pointer">
                    <input type="checkbox" checked={finderSelected.has(r.recordId)} onChange={() => toggleFinderSelect(r.recordId)} className="w-4 h-4 accent-orange-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-gray-700 shrink-0">{r.chungTuChi || '—'}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-600 truncate">{r.moTaThuongDung || r.dienGiai || '—'}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{r.ngayChi || 'chưa có ngày'} · {Number(r.vnd || 0).toLocaleString('vi-VN')}đ · {r.trangThai || '—'}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-500">Đã chọn {finderSelected.size}</span>
              <div className="flex gap-2">
                <button onClick={() => setShowFinder(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Đóng</button>
                <button onClick={openSelectedForEdit} disabled={finderSelected.size === 0} className="px-5 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed">Mở để sửa ({finderSelected.size})</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drive Connection Banner */}
      {driveConnected === false && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800 text-sm">
              <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span>Google Drive chưa được kết nối. Bạn cần kết nối để upload hình bill.</span>
            </div>
            <a
              href="/api/auth/google-drive"
              className="px-4 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors whitespace-nowrap"
            >
              Kết nối Drive
            </a>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            step === 'upload' ? 'bg-orange-500 text-white shadow-md' : 'bg-gray-200 text-gray-500'
          }`}>
            <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">1</span>
            Upload &amp; AI
          </div>
          <div className="w-8 h-0.5 bg-gray-300" />
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            (step === 'review' || rows.length > 0) ? 'bg-orange-500 text-white shadow-md' : 'bg-gray-200 text-gray-500'
          }`}>
            <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">2</span>
            Kiểm tra &amp; Gửi
          </div>
        </div>

        {/* ====== STEP 1: Upload ====== */}
        {step === 'upload' && (<>
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-orange-500" />
              Tải lên hình ảnh hóa đơn / biên lai
            </h2>

            {/* V12: Chon che do xu ly */}
            <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-xl">
              <button type="button" onClick={() => setInternationalMode(false)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!internationalMode ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Hoá đơn thường</button>
              <button type="button" onClick={() => setInternationalMode(true)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${internationalMode ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>🌍 Ship Quốc Tế</button>
            </div>
            {internationalMode && (
              <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 leading-relaxed">
                <b>Chế độ Ship Quốc Tế:</b> tải ảnh tổng tiền + ảnh chi tiết gói hàng (có dòng &quot;Trọng lượng thực tế&quot;). Hệ thống tính phí ship phân bổ theo kg cho từng mã vận đơn. Cuối cùng bạn chọn <b>1 ảnh đại diện</b> để lưu (không lưu hết ảnh).
              </div>
            )}

            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                isDragActive
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-gray-300 hover:border-orange-300 hover:bg-orange-50/30'
              }`}
            >
              <input {...getInputProps()} />
              <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-orange-500" />
              </div>
              {isDragActive ? (
                <p className="text-orange-600 font-medium">Thả hình ảnh vào đây...</p>
              ) : (
                <>
                  <p className="text-gray-600 mb-1 font-medium">Kéo thả hình ảnh vào đây</p>
                  <p className="text-sm text-gray-400">hoặc click để chọn &mdash; PNG, JPG, JPEG, WEBP</p>
                </>
              )}
            </div>

            {filesWithNotes.length > 0 && (
              <div className="mt-6 space-y-4">
                <h3 className="font-semibold text-gray-700 text-sm">
                  Đã chọn {filesWithNotes.length} ảnh &mdash; Thêm ghi chú cho từng ảnh (tuỳ chọn)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filesWithNotes.map((item, index) => (
                    <div key={index} className="flex gap-3 border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                        <Image src={item.previewUrl} alt={item.file.name} fill className="object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-600 truncate mb-1.5">{item.file.name}</p>
                        <div className="relative">
                          <StickyNote className="absolute left-2 top-2.5 w-3.5 h-3.5 text-gray-400" />
                          <input
                            type="text"
                            value={item.note}
                            onChange={(e) => updateNote(index, e.target.value)}
                            placeholder="VD: TM, mua nhựa eSun, ship Grab..."
                            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                          />
                        </div>
                      </div>
                      <button onClick={() => removeFile(index)} className="text-gray-300 hover:text-red-500 flex-shrink-0 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing progress */}
            {isProcessing && (
              <div className="mt-6 p-4 bg-orange-50 rounded-xl border border-orange-100">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 text-orange-600 animate-spin" />
                  <span className="text-orange-800 font-medium text-sm">{progress.message}</span>
                </div>
                <div className="w-full bg-orange-200 rounded-full h-2">
                  <div
                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-orange-500 mt-1">{progress.current}/{progress.total}</p>
              </div>
            )}

            {/* V8.3: Drive upload error banner with retry */}
            {driveUploadFailed && !isProcessing && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <span className="text-red-700 font-semibold text-sm">Lỗi upload hình lên Google Drive!</span>
                </div>
                <p className="text-red-600 text-xs mb-3">Hình ảnh chưa được lưu lên Drive. Không thể tiếp tục xử lý. Vui lòng nhấn &quot;Thử lại&quot; để gửi lại từ đầu.</p>
                <button
                  onClick={() => { setDriveUploadFailed(false); processImages(); }}
                  className="px-5 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all text-sm font-medium flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Thử lại
                </button>
              </div>
            )}

            {!driveUploadFailed && (
              <button
                onClick={internationalMode ? processShipQuocte : processImages}
                disabled={isProcessing || filesWithNotes.length === 0}
                className="mt-6 w-full bg-orange-500 text-white py-4 rounded-xl font-semibold text-lg hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Đang xử lý...</>
                ) : internationalMode ? (
                  `Tính phí ship quốc tế (${filesWithNotes.length} ảnh)`
                ) : (
                  `Bắt đầu xử lý (${filesWithNotes.length} ảnh)`
                )}
              </button>
            )}
          </div>

          {/* ====== DIVIDER + MANUAL ENTRY ====== */}
          <div className="relative flex items-center justify-center my-8">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <span className="relative bg-gray-50 px-4 py-1.5 text-xs font-bold text-gray-500 tracking-wider uppercase rounded-full border border-gray-200">
              <PenLine className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
              Nhập chi phí thủ công
            </span>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Ngày chi */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Ngày chi</label>
                <input
                  type="date"
                  value={manualForm.ngayChi}
                  onChange={(e) => updateManualField('ngayChi', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                />
              </div>

              {/* Chứng từ mua hàng — Smart Combobox */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Chứng từ mua hàng</label>
                <SmartCombobox
                  value={manualForm.chungTuChi}
                  onChange={(v) => updateManualField('chungTuChi', v)}
                  recentOrders={recentOrders}
                  rows={rows}
                  onFocus={fetchRecentOrders}
                  placeholder="Nhập hoặc chọn mã giao dịch..."
                />
              </div>

              {/* V7.1: Mô tả thường dùng dropdown */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Mô tả thường dùng</label>
                <SkuDropdown
                  value={manualForm.moTaThuongDung}
                  onChange={(v) => updateManualField('moTaThuongDung', v)}
                  skuList={skuMasterList}
                  onFocus={fetchSkuMaster}
                />
              </div>

              {/* V7.1: Mô Tả Mới (was Diễn giải) */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Mô Tả Mới</label>
                <input
                  type="text"
                  value={manualForm.dienGiai}
                  onChange={(e) => updateManualField('dienGiai', e.target.value)}
                  placeholder="Nhập mô tả mới nếu không có trong danh sách..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Số tiền gốc */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Số tiền gốc <span className="text-red-400">*</span></label>
                <input
                  type="number"
                  value={manualForm.soTienGoc}
                  onChange={(e) => updateManualField('soTienGoc', e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Loại tiền */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Loại tiền</label>
                <select
                  value={manualForm.loaiTien}
                  onChange={(e) => updateManualField('loaiTien', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                >
                  {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* V7.1: Tổng Bill (VNĐ) — UNLOCKED */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Tổng Bill (VNĐ)</label>
                <input
                  type="number"
                  value={manualForm.vnd}
                  onChange={(e) => updateManualField('vnd', e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Số lượng hàng */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Số lượng hàng</label>
                <input
                  type="number"
                  value={manualForm.soLuongHang}
                  onChange={(e) => updateManualField('soLuongHang', e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* V7.1: Đơn giá — UNLOCKED */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Đơn giá</label>
                <input
                  type="number"
                  value={manualForm.donGia}
                  onChange={(e) => updateManualField('donGia', e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Ngày nhận hàng */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Ngày nhận hàng</label>
                <input
                  type="text"
                  value={manualForm.ngayNhanHang}
                  onChange={(e) => updateManualField('ngayNhanHang', e.target.value)}
                  placeholder="DD/MM/YYYY"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* Người chi */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Người chi</label>
                <input
                  type="text"
                  value={manualForm.nguoiChi}
                  onChange={(e) => updateManualField('nguoiChi', e.target.value)}
                  placeholder="Tên hoặc TM..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white placeholder:text-gray-300"
                />
              </div>

              {/* V7.1: Phân loại chi phí */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Phân loại chi phí</label>
                <select
                  value={manualForm.phanLoai}
                  onChange={(e) => updateManualField('phanLoai', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                >
                  {PHAN_LOAI_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{PHAN_LOAI_LABELS[opt] || opt}</option>
                  ))}
                </select>
              </div>

              {/* V7.1: Loại chứng từ (was Mã chi phí) */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Loại chứng từ
                </label>
                <select
                  value={manualForm.maChiPhi}
                  onChange={(e) => updateManualField('maChiPhi', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                >
                  {getManualMaOptions().map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="NY">NY - Chưa biết</option>
                </select>
              </div>

              {/* Nguồn chi phí */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Nguồn chi phí</label>
                <select
                  value={manualForm.nguonChiPhi}
                  onChange={(e) => updateManualField('nguonChiPhi', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none bg-white"
                >
                  {NGUON_CHI_PHI_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Action button */}
            <div className="flex justify-end mt-6">
              <button
                onClick={addManualEntry}
                disabled={isAddingManual}
                className="px-5 py-2.5 border-2 border-orange-400 text-orange-600 rounded-xl text-sm font-semibold hover:bg-orange-500 hover:text-white hover:border-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
              >
                {isAddingManual ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Đang gửi lên Sheets...</>
                ) : (
                  <><Check className="w-4 h-4" /> Lưu &amp; Gửi lên Google Sheets</>
                )}
              </button>
            </div>
          </div>

          {/* V11: Panel gan anh van don theo Ma don hang (hoa don da nhap truoc do) */}
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 mt-6">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2 mb-1">
              <span>📦</span> Gắn ảnh vận đơn vào hóa đơn đã nhập
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Tải tem giao hàng (SPX, GHTK...) — hệ thống tự đọc <b>Mã đơn hàng</b> trên tem rồi gắn ảnh vào đúng hóa đơn (khớp theo mã, cập nhật cả Google Sheets). Dùng khi bill đã lưu trước đó.
            </p>

            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-600 hover:border-orange-400 hover:text-orange-600 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" /> Chọn ảnh tem vận đơn
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fl = e.target.files; const el = e.currentTarget; onPickVanDonFiles(fl); el.value = ''; }} />
            </label>

            {vanDonItems.length > 0 && (
              <div className="mt-4 space-y-3">
                {vanDonItems.map(item => {
                  const busy = item.status === 'uploading' || item.status === 'reading' || item.status === 'attaching';
                  return (
                    <div key={item.id} className="p-3 rounded-xl border border-gray-200 bg-gray-50">
                      <div className="flex items-start gap-3">
                        <button type="button" onClick={() => item.driveLink && setLightboxUrl(driveImgSrc(item.driveLink))} className="shrink-0">
                          <img src={item.driveLink ? driveImgSrc(item.driveLink) : item.previewUrl} alt="Tem vận đơn" className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Mã đơn hàng</label>
                          <input
                            type="text"
                            list="recent-madon-list"
                            value={item.maDonHang}
                            disabled={busy || item.status === 'done'}
                            onChange={(e) => updateVanDonItem(item.id, { maDonHang: e.target.value })}
                            placeholder="VD: 2606169D8SAA8U"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100"
                          />
                          <p className={`text-xs mt-1 ${item.status === 'error' ? 'text-red-500' : item.status === 'done' ? 'text-green-600' : 'text-gray-400'}`}>{item.message}</p>
                        </div>
                        <div className="shrink-0">
                          {item.status === 'done' ? (
                            <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium"><Check className="w-4 h-4" /> Xong</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => attachVanDonByOrder(item)}
                              disabled={busy || !item.driveLink || !item.maDonHang}
                              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                              {item.status === 'attaching' ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang gắn</>) : busy ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang đọc</>) : 'Gắn'}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Nut Xoa tach han xuong duoi cung, cach xa nut Gan de tranh bam nham */}
                      <div className="flex justify-end mt-3 pt-2.5 border-t border-gray-200">
                        <button type="button" onClick={() => removeVanDonItem(item.id)} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 px-2 py-1">
                          <Trash2 className="w-3.5 h-3.5" /> Xoá ảnh này
                        </button>
                      </div>
                    </div>
                  );
                })}
                <datalist id="recent-madon-list">
                  {recentOrders.filter(o => o.chungTuChi).map((o, i) => <option key={i} value={o.chungTuChi || ''} />)}
                </datalist>
              </div>
            )}
          </div>
        </>)}

        {/* ====== STEP 2: Review & Edit ====== */}
        {rows.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
            {/* V12: Ship Quoc Te — chon 1 anh dai dien truoc khi gui */}
            {internationalMode && rows.some(r => !r.linkChungTu) && filesWithNotes.length > 0 && (
              <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-800 mb-1">📸 Chọn 1 ảnh đại diện để lưu</p>
                <p className="text-xs text-amber-700 mb-3">Phí ship đã tính xong. Chọn 1 ảnh làm chứng từ — chỉ ảnh này được đẩy lên Drive khi bấm Gửi (không lưu hết).</p>
                <div className="flex flex-wrap gap-3">
                  {filesWithNotes.map((f, i) => (
                    <button type="button" key={i} onClick={() => setRepImageIndex(i)} className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${repImageIndex === i ? 'border-orange-500 ring-2 ring-orange-300' : 'border-gray-200 hover:border-orange-300'}`}>
                      <img src={f.previewUrl} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover" />
                      {repImageIndex === i && <span className="absolute top-1 right-1 bg-orange-500 text-white rounded-full w-5 h-5 flex items-center justify-center"><Check className="w-3 h-3" /></span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {editingSubmitted && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-2">
                <PenLine className="w-4 h-4 shrink-0" />
                <span>Đang <b>sửa lệnh đã gửi</b> — chỉnh xong bấm <b>Cập nhật lên Sheet</b> (ghi đè đúng dòng), hoặc bấm 🗑 trên dòng để <b>xoá hẳn</b> khỏi Sheet.</span>
              </div>
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-orange-500" />
                {editingSubmitted ? `Sửa lệnh đã gửi (${rows.length} dòng)` : `Kiểm tra & Chỉnh sửa (${rows.length} dòng)`}
              </h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={selectAll} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition-all text-gray-600">
                  {selectedIds.size === rows.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
                <button
                  onClick={editingSubmitted ? updateSubmittedRows : syncToGoogleSheets}
                  disabled={isSyncing || selectedIds.size === 0}
                  className="px-5 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2 text-sm font-medium shadow-sm"
                >
                  {isSyncing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {editingSubmitted ? 'Đang cập nhật...' : 'Đang đồng bộ...'}</>
                  ) : editingSubmitted ? (
                    <><Check className="w-4 h-4" /> Cập nhật lên Sheet ({selectedIds.size})</>
                  ) : (
                    <><Check className="w-4 h-4" /> Gửi lên Google Sheets ({selectedIds.size})</>
                  )}
                </button>
                {editingSubmitted ? (
                  <button onClick={exitEditMode} disabled={isSyncing} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition-all text-gray-600 disabled:opacity-50">
                    Thoát
                  </button>
                ) : (
                  <button onClick={resetAll} disabled={isResetting} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm transition-all text-gray-600 disabled:opacity-50 flex items-center gap-1.5">
                    {isResetting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang xóa Drive...</> : hasSyncedToSheets ? 'Nhập bill mới' : 'Làm mới'}
                  </button>
                )}
              </div>
            </div>

            {sheetUrl && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="text-green-800 font-medium text-sm">Đã đồng bộ thành công!</span>
                </div>
                <a href="https://docs.google.com/spreadsheets/d/1AQuUFd1CtEC6nRS8tGBMRdmuZ6TuR_jLNEUmjXt135c/edit?gid=1921846281#gid=1921846281" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-green-700 hover:text-green-900 font-medium text-sm">
                  Mở Google Sheet <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}

            {/* V7.1: Upload thêm ảnh section */}
            <div className="mb-6 p-4 border border-dashed border-orange-300 rounded-xl bg-orange-50/30">
              <h3 className="text-sm font-semibold text-orange-700 mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4" /> Upload thêm ảnh (bổ sung vào danh sách)
              </h3>
              <div
                {...getMoreRootProps()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
                  isMoreDragActive ? 'border-orange-400 bg-orange-50' : 'border-gray-300 hover:border-orange-300'
                }`}
              >
                <input {...getMoreInputProps()} />
                <Upload className="w-6 h-6 text-orange-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Kéo thả hoặc click để chọn thêm ảnh</p>
              </div>

              {moreFiles.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-2">{moreFiles.length} ảnh mới sẵn sàng</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {moreFiles.map((f, i) => (
                      <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-200">
                        <img src={f.previewUrl} alt={f.file.name} className="w-full h-full object-cover" />
                        <button
                          onClick={() => {
                            URL.revokeObjectURL(f.previewUrl);
                            setMoreFiles(prev => prev.filter((_, idx) => idx !== i));
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  {isProcessingMore && (
                    <div className="p-3 bg-orange-50 rounded-lg border border-orange-100 mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Loader2 className="w-4 h-4 text-orange-600 animate-spin" />
                        <span className="text-orange-800 text-xs">{moreProgress.message}</span>
                      </div>
                      <div className="w-full bg-orange-200 rounded-full h-1.5">
                        <div className="bg-orange-500 h-1.5 rounded-full transition-all" style={{ width: `${moreProgress.total > 0 ? (moreProgress.current / moreProgress.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={processMoreImages}
                    disabled={isProcessingMore}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                  >
                    {isProcessingMore ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Đang xử lý...</>
                    ) : (
                      <><Upload className="w-4 h-4" /> Xử lý {moreFiles.length} ảnh mới</>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Rows as cards */}
            <div className="space-y-3">
              {rows.map((row) => {
                const isExpanded = expandedRow === row.id;
                const isSelected = selectedIds.has(row.id);
                const isSynced = row.trangThai === 'Đã duyệt';

                return (
                  <div key={row.id} className={`border rounded-xl overflow-hidden transition-all ${
                    isSelected ? 'border-orange-300 bg-orange-50/30' : 'border-gray-100'
                  } ${isSynced ? 'opacity-60' : ''}`}>
                    {/* Summary row */}
                    <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpandedRow(isExpanded ? null : row.id)}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(row.id); }}
                        className="w-4 h-4 flex-shrink-0 accent-orange-500"
                        disabled={isSynced}
                      />
                      <div
                        className={`relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200 flex items-center justify-center ${row.imageUrl ? 'cursor-zoom-in' : ''}`}
                        onClick={(e) => { if (row.imageUrl) { e.stopPropagation(); setLightboxUrl(row.imageUrl); } }}
                      >
                        {row.imageUrl ? (
                          <img src={driveImgSrc(row.imageUrl)} alt="Ảnh chứng từ" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <PenLine className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto_auto_auto] md:grid-cols-[80px_1fr_100px_60px_120px] gap-x-3 gap-y-1 items-center text-sm">
                        <div className="min-w-0">
                          <span className="text-gray-400 text-xs">Ngày chi</span>
                          <p className="font-medium text-gray-800 truncate">{row.ngayChi || '—'}</p>
                        </div>
                        <div className="min-w-0">
                          <span className="text-gray-400 text-xs">Mô tả</span>
                          <p className="font-medium text-gray-800 truncate" title={getDisplayDescription(row)}>{getDisplayDescription(row)}</p>
                        </div>
                        <div className="min-w-0 text-right">
                          <span className="text-gray-400 text-xs">Tổng Bill</span>
                          <p className="font-semibold text-red-600 truncate">{row.vnd !== '0' ? Number(row.vnd).toLocaleString('vi-VN') : '—'}</p>
                        </div>
                        <div className="min-w-0 text-center">
                          <span className="text-gray-400 text-xs">Phân loại</span>
                          <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">{row.phanLoai}</span>
                        </div>
                        <div className="hidden md:block min-w-0">
                          <span className="text-gray-400 text-xs">Record</span>
                          <p className="font-mono text-xs text-gray-500 truncate">{row.recordId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isSynced && (
                          deletingRowId === row.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); removeRow(row.id); }} disabled={!!deletingRowId} className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-30">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </div>

                    {/* Expanded edit form */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 p-4 bg-gray-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Record ID</label>
                            <input type="text" value={row.recordId} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-100 font-mono" />
                          </div>
                          <FieldInput label="Ngày chi (DD/MM/YYYY)" value={row.ngayChi} onChange={(v) => updateRow(row.id, 'ngayChi', v)} disabled={isSynced} />
                          <FieldInput label="Phân bổ" value={row.phanBo} onChange={(v) => updateRow(row.id, 'phanBo', v)} disabled={isSynced} />
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Chứng từ mua hàng</label>
                            <SmartCombobox
                              value={row.chungTuChi}
                              onChange={(v) => updateRow(row.id, 'chungTuChi', v)}
                              recentOrders={recentOrders}
                              rows={rows}
                              onFocus={fetchRecentOrders}
                              placeholder="Nhập hoặc chọn mã..."
                              disabled={isSynced}
                            />
                          </div>

                          {/* V7.1: Mô tả thường dùng dropdown */}
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Mô tả thường dùng</label>
                            <SkuDropdown
                              value={row.moTaThuongDung}
                              onChange={(v) => updateRow(row.id, 'moTaThuongDung', v)}
                              skuList={skuMasterList}
                              onFocus={fetchSkuMaster}
                              disabled={isSynced}
                            />
                          </div>

                          {/* V7.1: Mô Tả Mới (was Diễn giải) */}
                          <FieldInput label="Mô Tả Mới" value={row.dienGiai} onChange={(v) => updateRow(row.id, 'dienGiai', v)} disabled={isSynced} />

                          <FieldInput label="Số tiền gốc" value={row.soTienGoc} onChange={(v) => updateRow(row.id, 'soTienGoc', v)} disabled={isSynced} type="number" />
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Loại tiền</label>
                            <select
                              value={row.loaiTien}
                              onChange={(e) => updateRow(row.id, 'loaiTien', e.target.value)}
                              disabled={isSynced}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
                            >
                              {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          {/* V7.1: Tổng Bill (VNĐ) — UNLOCKED */}
                          <FieldInput label="Tổng Bill (VNĐ)" value={row.vnd} onChange={(v) => updateRow(row.id, 'vnd', v)} disabled={isSynced} type="number" />
                          <FieldInput label="Số lượng hàng" value={row.soLuongHang} onChange={(v) => updateRow(row.id, 'soLuongHang', v)} disabled={isSynced} />
                          {/* V7.1: Đơn giá — UNLOCKED */}
                          <FieldInput label="Đơn giá" value={row.donGia} onChange={(v) => updateRow(row.id, 'donGia', v)} disabled={isSynced} type="number" />
                          <FieldInput label="Ngày nhận hàng" value={row.ngayNhanHang} onChange={(v) => updateRow(row.id, 'ngayNhanHang', v)} disabled={isSynced} />
                          <FieldInput label="Người chi" value={row.nguoiChi} onChange={(v) => updateRow(row.id, 'nguoiChi', v)} disabled={isSynced} />

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Phân loại chi phí</label>
                            <select
                              value={row.phanLoai}
                              onChange={(e) => { updateRow(row.id, 'phanLoai', e.target.value); updateRow(row.id, 'maChiPhi', getDefaultMaChiPhi(e.target.value)); }}
                              disabled={isSynced}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
                            >
                              {PHAN_LOAI_OPTIONS.map(opt => <option key={opt} value={opt}>{PHAN_LOAI_LABELS[opt] || opt}</option>)}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Loại chứng từ
                            </label>
                            <select
                              value={row.maChiPhi}
                              onChange={(e) => updateRow(row.id, 'maChiPhi', e.target.value)}
                              disabled={isSynced}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
                            >
                              {getMaOptions(row.phanLoai).map(group => (
                                <optgroup key={group.label} label={group.label}>
                                  {group.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </optgroup>
                              ))}
                              <option value="NY">NY - Chưa biết</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Nguồn chi phí</label>
                            <select
                              value={row.nguonChiPhi}
                              onChange={(e) => updateRow(row.id, 'nguonChiPhi', e.target.value)}
                              disabled={isSynced}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
                            >
                              {NGUON_CHI_PHI_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>

                          <FieldInput label="Link chứng từ gốc" value={row.linkChungTu} onChange={(v) => updateRow(row.id, 'linkChungTu', v)} disabled={isSynced} />

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Trạng thái duyệt</label>
                            <select
                              value={row.trangThai}
                              onChange={(e) => updateRow(row.id, 'trangThai', e.target.value)}
                              disabled={isSynced}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
                            >
                              <option value="Chờ duyệt">Chờ duyệt</option>
                              <option value="Đã duyệt">Đã duyệt</option>
                            </select>
                          </div>
                        </div>

                        {row.linkChungTu && (
                          <div className="mt-3">
                            <a href={row.linkChungTu} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3.5 h-3.5" /> Xem ảnh gốc trên Drive
                            </a>
                          </div>
                        )}

                        {/* V11: Anh van don / chung tu giao hang (cung dong hoa don) */}
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Ảnh vận đơn / Chứng từ giao hàng</label>
                          {row.anhVanDon ? (
                            <div className="flex items-center gap-3">
                              <button type="button" onClick={() => setLightboxUrl(driveImgSrc(row.anhVanDon))} className="shrink-0">
                                <img src={driveImgSrc(row.anhVanDon)} alt="Ảnh vận đơn" className="w-14 h-14 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                              </button>
                              <div className="flex flex-col gap-1">
                                <a href={row.anhVanDon} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:underline flex items-center gap-1">
                                  <ExternalLink className="w-3.5 h-3.5" /> Xem ảnh vận đơn
                                </a>
                                <label className="text-xs text-gray-400 hover:text-orange-600 cursor-pointer">
                                  Đổi ảnh khác
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; const el = e.currentTarget; if (f) attachVanDonToRow(row, f); el.value = ''; }} />
                                </label>
                              </div>
                            </div>
                          ) : (
                            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed text-sm transition-colors ${vanDonUploading === row.id ? 'opacity-60 pointer-events-none border-gray-300 text-gray-500' : 'border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 cursor-pointer'}`}>
                              {vanDonUploading === row.id ? (<><Loader2 className="w-4 h-4 animate-spin" /> Đang tải lên...</>) : (<>📎 Đính kèm ảnh vận đơn</>)}
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; const el = e.currentTarget; if (f) attachVanDonToRow(row, f); el.value = ''; }} />
                            </label>
                          )}
                          <p className="text-[11px] text-gray-400 mt-1.5">Ảnh tem giao hàng (SPX, GHTK...) lưu làm chứng từ thuế — tự gắn cho mọi dòng cùng đơn.</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {step === 'review' && rows.length === 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <p className="text-gray-500 mb-4">Không có dữ liệu nào được trích xuất.</p>
            <button onClick={resetAll} className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
              Quay lại
            </button>
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-50"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative max-w-4xl max-h-[90vh] w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={driveImgSrc(lightboxUrl)}
              alt="Xem ảnh chứng từ"
              className="max-w-full max-h-[90vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({ label, value, onChange, disabled, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white"
      />
    </div>
  );
}

// V7.1: SmartCombobox — re-fetches on EVERY focus + merges screen values
function SmartCombobox({ value, onChange, recentOrders, rows, onFocus, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  recentOrders: RecentOrder[];
  rows: RowData[];
  onFocus: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // V8.4: Merge recentOrders + screen values — aggregate ALL product names per chungTuChi
  const allOptions = (() => {
    const groupMap = new Map<string, { descriptions: string[]; ngayChi: string }>();

    // Collect screen row descriptions first
    for (const r of rows) {
      if (!r.chungTuChi) continue;
      if (!groupMap.has(r.chungTuChi)) {
        groupMap.set(r.chungTuChi, { descriptions: [], ngayChi: r.ngayChi });
      }
      const g = groupMap.get(r.chungTuChi)!;
      const desc = r.moTaThuongDung || r.dienGiai;
      if (desc && !g.descriptions.includes(desc)) {
        g.descriptions.push(desc);
      }
    }

    // Then add recentOrders (only if chungTuChi not already from screen)
    for (const o of recentOrders) {
      if (!o.chungTuChi) continue;
      if (!groupMap.has(o.chungTuChi)) {
        // recentOrders already have aggregated dienGiai from API
        groupMap.set(o.chungTuChi, { descriptions: o.dienGiai ? [o.dienGiai] : [], ngayChi: o.ngayChi || '' });
      }
    }

    // Format into options
    const opts: RecentOrder[] = [];
    for (const [chungTuChi, group] of groupMap) {
      const descs = group.descriptions;
      let dienGiai = '';
      if (descs.length === 1) {
        dienGiai = descs[0];
      } else if (descs.length === 2) {
        dienGiai = descs.join(', ');
      } else if (descs.length >= 3) {
        dienGiai = `${descs[0]}, ${descs[1]} và ${descs.length - 2} SP khác`;
      }
      opts.push({ chungTuChi, dienGiai, ngayChi: group.ngayChi });
    }
    return opts;
  })();

  const filtered = allOptions.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (o.chungTuChi || '').toLowerCase().includes(q) ||
      (o.dienGiai || '').toLowerCase().includes(q)
    );
  });

  const handleInputChange = (v: string) => {
    setSearch(v);
    onChange(v);
    if (!isOpen) setIsOpen(true);
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setSearch('');
    setIsOpen(false);
  };

  const handleFocus = () => {
    onFocus(); // Always re-fetch
    setIsOpen(true);
    setSearch('');
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Nhập hoặc chọn...'}
          disabled={disabled}
          className="w-full px-3 py-2 pr-8 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white placeholder:text-gray-300"
        />
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none" />
      </div>

      {isOpen && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.map((o, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(o.chungTuChi || '')}
              className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 transition-colors border-b border-gray-50 last:border-b-0"
            >
              <span className="font-medium text-gray-800">{o.chungTuChi}</span>
              {o.dienGiai && <span className="text-gray-400 ml-1.5">— {o.dienGiai}</span>}
              {o.ngayChi && <span className="text-gray-300 ml-1.5 text-xs">{o.ngayChi}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// V7.8: SKU Dropdown (searchable) — fully separated inputValue vs selectedValue
function SkuDropdown({ value, onChange, skuList, onFocus, disabled }: {
  value: string;
  onChange: (v: string) => void;
  skuList: SkuItem[];
  onFocus: () => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // inputText is the live text in the input — completely independent of `value`
  const [inputText, setInputText] = useState('');
  // Track whether user is actively typing/searching
  const [isSearching, setIsSearching] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsSearching(false);
        setInputText('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Display: when searching, show inputText; otherwise show selected value
  const displayText = isSearching ? inputText : value;

  const filtered = skuList.filter(s => {
    if (!isSearching || !inputText) return true;
    const q = inputText.toLowerCase();
    return s.description.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q);
  });

  const handleInputChange = (v: string) => {
    setInputText(v);
    setIsSearching(true);
    if (!isOpen) setIsOpen(true);
    // If user clears the input completely while searching → reset value to empty
    if (v === '' && value) {
      onChange('');
    }
  };

  const handleSelect = (desc: string) => {
    onChange(desc);
    setInputText('');
    setIsSearching(false);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setInputText('');
    setIsSearching(false);
    setIsOpen(false);
  };

  const handleFocus = () => {
    onFocus(); // Always re-fetch
    setIsOpen(true);
    // When focusing, if there's a selected value, let user see it and start fresh search
    setInputText('');
    setIsSearching(false);
  };

  const handleBlur = () => {
    // Small delay to allow click events on dropdown items to fire
    setTimeout(() => {
      setIsSearching(false);
      setInputText('');
    }, 200);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={displayText}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Tìm mô tả thường dùng..."
          disabled={disabled}
          className="w-full px-3 py-2 pr-8 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none disabled:bg-gray-100 bg-white placeholder:text-gray-300"
        />
        {value ? (
          <button onClick={handleClear} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500" type="button">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        ) : (
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none" />
        )}
      </div>

      {isOpen && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s.description)}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-orange-50 transition-colors border-b border-gray-50 last:border-b-0 ${s.description === value ? 'bg-orange-50 font-medium' : ''}`}
            >
              <span className="font-mono text-xs text-orange-500 mr-2">{s.sku}</span>
              <span className="text-gray-800">{s.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
