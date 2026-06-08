export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { appendToChungTuLog } from '@/lib/chungtu-log';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ngayChi, phanBo, chungTuChi, dienGiai, vnd, usd, rmb, soLuongHang, donGia, ngayNhanHang, nguoiChi, phanLoai, maChiPhi, recordId, soTienGoc, loaiTien, nguonChiPhi } = body;

    if (!dienGiai) {
      return NextResponse.json({ error: 'Diễn giải là bắt buộc' }, { status: 400 });
    }

    // Create a transaction for this manual entry
    const transaction = await prisma.transaction.create({
      data: {
        totalImages: 0,
        processedImages: 0,
        status: 'completed',
      },
    });

    // Create the ExtractedData record
    const savedData = await prisma.extractedData.create({
      data: {
        transactionId: transaction.id,
        imageUrl: '',
        cloudStoragePath: '',
        isPublic: false,
        ngayChi: ngayChi || null,
        phanBo: phanBo || null,
        chungTuChi: chungTuChi || null,
        dienGiai: dienGiai || null,
        vnd: vnd || '0',
        usd: usd || '0',
        rmb: rmb || null,
        soTienGoc: soTienGoc || null,
        loaiTien: loaiTien || 'VND',
        nguonChiPhi: nguonChiPhi || 'Internal',
        soLuongHang: soLuongHang || null,
        donGia: donGia || null,
        ngayNhanHang: ngayNhanHang || null,
        nguoiChi: nguoiChi || null,
        phanLoai: phanLoai || 'SX',
        maChiPhi: maChiPhi || 'NY',
        linkChungTu: '',
        trangThai: 'Chờ duyệt',
        recordId: recordId || null,
        rawData: JSON.stringify({ source: 'manual_entry' }),
        status: 'pending',
      },
    });

    // V8.5: Also append to ChungTuMuaHang_Log for dropdown data
    if (chungTuChi && chungTuChi !== 'Không có') {
      await appendToChungTuLog([{
        chungTuChi,
        dienGiai: dienGiai || '',
        ngayChi: ngayChi || '',
      }]);
    }

    return NextResponse.json(savedData);
  } catch (error: any) {
    console.error('Manual entry error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi tạo dữ liệu thủ công' }, { status: 500 });
  }
}
