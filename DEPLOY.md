# Deploy Bill Tracker → bill.toysuncle.art

App **Next.js 14 full-stack** (server + DB). Da **go sach 100% Abacus**, chuyen sang:
**Vercel** (host) + **Neon** (Postgres) + **Google Drive** (luu anh bill, kiem luon cho AI doc) + **OpenRouter** (AI doc bill).

> Khong con S3/R2. Anh bill luu thang tren Google Drive; AI tai anh tu Drive de doc.

> Thu tu lam: **Neon → push GitHub → Vercel → DNS → Google OAuth**. Lam dung thu tu nay se khong vap.

---

## 0. Chuan bi (lay san truoc khi bat dau)
Can copy lai cac gia tri sau de nhap vao Vercel o Buoc 3:
- `OPENROUTER_API_KEY` (tao moi tai https://openrouter.ai/keys — nap it tien hoac dung credit free)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID` (tu `.env` cu)
- `GOOGLE_DRIVE_BILL_FOLDER_ID`, `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ALLOWED_EMAILS`
- `NEXTAUTH_SECRET` (Claude da sinh san: xem ben duoi / chat)

Danh sach day du + giai thich: xem `.env.example`.

---

## 1. Neon Postgres (database)
1. Vao https://neon.tech → dang nhap (Google) → **New Project**. Ten `bill-toysuncle`, region Singapore.
2. **Dashboard → Connection string** → ban **Pooled connection**, co `?sslmode=require`. Copy → day la `DATABASE_URL`.
3. Tao bang + tai khoan admin (chay tu may, trong thu muc app):
   ```
   # tao file .env tam co cac dong:
   #   DATABASE_URL="...chuoi Neon..."
   #   SEED_EMAIL="email-cua-sep@gmail.com"   (phai nam trong ALLOWED_EMAILS)
   #   SEED_PASSWORD="mat-khau-admin-manh"
   npm install
   npx prisma db push          # tao toan bo bang theo schema
   npx prisma db seed          # tao admin theo SEED_EMAIL/SEED_PASSWORD
   ```

---

## 2. OpenRouter (AI doc bill)
1. https://openrouter.ai → dang nhap → **Keys** → **Create Key**. Luu lai → `OPENROUTER_API_KEY`.
2. Nap credit (vai USD du chay rat lau vi Gemini re). Model mac dinh da chon: `google/gemini-2.5-pro`
   (OCR goc tot cho anh hoa don + tieng Viet). Doi model bang env `OPENROUTER_MODEL` neu muon.

---

## 3. Push code len GitHub
Da co repo `https://github.com/happy88vn/bill.toysuncle.art`, code da push san.
**`.env` + `data/` da bi `.gitignore` chan** — secret khong len GitHub.

---

## 4. Vercel (host app)
1. https://vercel.com → dang nhap GitHub → **Add New Project** → chon repo `bill.toysuncle.art` → **Import**.
2. Framework: tu nhan **Next.js**. Root Directory mac dinh. Build command mac dinh
   (postinstall da co `prisma generate`).
3. **Environment Variables** → nhap voi gia tri that:
   - `DATABASE_URL` (Neon, ban Pooled)
   - `NEXTAUTH_URL = https://bill.toysuncle.art`
   - `NEXTAUTH_SECRET`
   - `OPENROUTER_API_KEY`, `OPENROUTER_MODEL = google/gemini-2.5-pro`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID`
   - `GOOGLE_DRIVE_BILL_FOLDER_ID`, `GOOGLE_DRIVE_PARENT_FOLDER_ID`
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `ALLOWED_EMAILS`
   > `GOOGLE_PRIVATE_KEY`: dan nguyen ca khoi `-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----`, giu \n.
4. **Deploy**.

---

## 5. DNS + domain bill.toysuncle.art
1. Vercel → **Settings → Domains** → them `bill.toysuncle.art` → Vercel cho target CNAME.
2. Cloudflare → DNS cua `toysuncle.art` → them **CNAME**: name `bill`, target Vercel cho,
   **Proxy = DNS only** (de Vercel cap SSL).
3. Cho SSL cap (vai phut) → vao https://bill.toysuncle.art.

---

## 6. Google OAuth (dang nhap + Drive)
**Google Cloud Console → APIs & Services → Credentials** → OAuth client → **Authorized redirect URIs** them DU CA HAI:
- `https://bill.toysuncle.art/api/auth/callback/google`  (dang nhap NextAuth)
- `https://bill.toysuncle.art/api/auth/google-drive/callback`  (cap quyen Drive)

> **Allowlist ap dung cho MOI cach dang nhap.** Email dang nhap (ke ca tai khoan mat khau) BAT BUOC
> nam trong `ALLOWED_EMAILS`. Dat `SEED_EMAIL` = email that trong allowlist khi seed (Buoc 1).

---

## 7. QA sau deploy (tu lai thu het)
- [ ] Dang nhap duoc (Google SSO + tai khoan mat khau).
- [ ] **Ket noi Google Drive** (nut trong app) — BAT BUOC truoc khi xu ly anh.
- [ ] Upload 1 anh bill → anh len Drive → AI (OpenRouter/Gemini) doc ra du lieu.
- [ ] Sua/duyet 1 record → Sync Google Sheets → kiem tra dong moi.
- [ ] Mo lai anh bill tu link Drive trong record.
- [ ] Ti gia VCB tu dong (`/api/exchange-rate`).

Loi hay gap:
- AI khong doc duoc anh → kiem `OPENROUTER_API_KEY` (con credit?), va **Drive da ket noi chua**
  (AI tai anh tu Drive nen Drive phai connect truoc).
- Dang nhap Google loi → **redirect URI** (Buoc 6) hoac `NEXTAUTH_URL` sai.
