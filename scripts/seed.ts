import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Lay tai khoan admin tu env de KHONG bi allowlist khoa.
  // Dat SEED_EMAIL = 1 email nam trong ALLOWED_EMAILS, va SEED_PASSWORD.
  // Fallback ve john@doe.com chi de chay thu local (se bi chan dang nhap neu
  // khong co trong ALLOWED_EMAILS — co tinh, de tranh admin mac dinh tren prod).
  const email = (process.env.SEED_EMAIL || 'john@doe.com').trim().toLowerCase();
  const password = process.env.SEED_PASSWORD || 'johndoe123';
  const name = process.env.SEED_NAME || email.split('@')[0];

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { password: hashedPassword, name, role: 'admin' },
    create: { email, password: hashedPassword, name, role: 'admin' },
  });
  console.log(`Seed completed for admin: ${email}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
