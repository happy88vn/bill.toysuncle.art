export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { totalImages } = body;

    const transaction = await prisma.transaction.create({
      data: {
        totalImages: totalImages || 0,
        status: 'processing'
      }
    });

    return NextResponse.json(transaction);
  } catch (error: any) {
    console.error('Transaction creation error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo transaction' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const transactions = await prisma.transaction.findMany({
      include: { extractedData: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return NextResponse.json(transactions);
  } catch (error: any) {
    console.error('Transaction fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi lấy transactions' }, { status: 500 });
  }
}
