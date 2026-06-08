export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedUploadUrl } from '@/lib/s3';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, contentType, transactionId, isPublic } = body;

    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'fileName và contentType là bắt buộc' }, { status: 400 });
    }

    const makePublic = isPublic === true;
    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(fileName, contentType, makePublic);

    // Build public URL for public files
    let publicUrl: string | undefined;
    if (makePublic) {
      const region = process.env.AWS_REGION ?? 'us-east-1';
      const bucket = process.env.AWS_BUCKET_NAME ?? '';
      publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${cloud_storage_path}`;
    }

    return NextResponse.json({ uploadUrl, cloud_storage_path, transactionId, isPublic: makePublic, publicUrl });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo upload URL' }, { status: 500 });
  }
}
