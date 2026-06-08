import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function upsertUser(email: string, password: string, name: string, role: string) {
  const e = email.trim().toLowerCase();
  if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(e)) {
    console.warn(`  ! Bo qua ${e} — KHONG nam trong ALLOWED_EMAILS (se bi chan dang nhap).`);
    return;
  }
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email: e },
    update: { password: hashed, name, role },
    create: { email: e, password: hashed, name, role },
  });
  console.log(`  + ${role}: ${e}`);
}

async function main() {
  // 1) Admin chinh tu SEED_EMAIL / SEED_PASSWORD.
  const adminEmail = (process.env.SEED_EMAIL || 'john@doe.com').trim().toLowerCase();
  const adminPass = process.env.SEED_PASSWORD || 'johndoe123';
  const adminName = process.env.SEED_NAME || adminEmail.split('@')[0];
  await upsertUser(adminEmail, adminPass, adminName, 'admin');

  // 2) Tai khoan mat khau backup (cho ai KHONG dung duoc dang nhap Google,
  //    vd email Yahoo, hoac domain khong chay Google Workspace).
  //    EXTRA_USERS = "email1:matkhau1,email2:matkhau2"  (moi cap cach nhau dau phay).
  //    Email phai nam trong ALLOWED_EMAILS. De trong neu chi dung Google login.
  const extra = (process.env.EXTRA_USERS || '').trim();
  if (extra) {
    for (const pair of extra.split(',')) {
      const idx = pair.indexOf(':');
      if (idx < 0) { console.warn(`  ! Bo qua "${pair}" — sai dinh dang email:matkhau`); continue; }
      const em = pair.slice(0, idx).trim();
      const pw = pair.slice(idx + 1).trim();
      if (!em || !pw) { console.warn(`  ! Bo qua "${pair}" — thieu email hoac matkhau`); continue; }
      await upsertUser(em, pw, em.split('@')[0], 'user');
    }
  }

  console.log('Seed completed.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
