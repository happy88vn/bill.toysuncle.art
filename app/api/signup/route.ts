export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// Allowlist of emails permitted to use the app (same source as lib/auth.ts).
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Khoa chan: chi cho phep dang ky email nam trong allowlist.
    // Khong co dong nay thi bat ky ai tren internet cung tao duoc tai khoan
    // va dang nhap thang vao cong cu chi phi noi bo.
    const normalizedEmail = String(email).trim().toLowerCase();
    if (ALLOWED_EMAILS.length === 0 || !ALLOWED_EMAILS.includes(normalizedEmail)) {
      return NextResponse.json({ error: 'Email khong duoc phep dang ky' }, { status: 403 });
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, password: hashedPassword, name: name || normalizedEmail.split('@')[0] },
    });
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
