# Deploy Bill Tracker → bill.toysuncle.art

App **Next.js 14 full-stack** (server + DB). Da go khoi nen tang Abacus, chuyen sang:
**Vercel** (host) + **Neon** (Postgres) + **Cloudflare R2** (luu anh bill).

> Thu tu lam: **Neon → R2 → push GitHub → Vercel → DNS + Google OAuth**. Lam dung thu tu nay se khong vap.

---

## 0. Chuan bi (lay san truoc khi bat dau)
Tu file `.env` cu (KHONG commit) Sep can copy lai cac gia tri sau de nhap vao Vercel o Buoc 4:
- `ABACUSAI_API_KEY` (AI doc bill — endpoint public van dung)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_DRIVE_BILL_FOLDER_ID`, `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `ALLOWED_EMAILS`, `NEXTAUTH_SECRET`

Danh sach day du + giai thich: xem `.env.example`.

---

## 1. Neon Postgres (database)
1. Vao https://neon.tech → dang nhap (Google) → **New Project**.
2. Ten: `bill-toysuncle`, region gan VN (Singapore). Tao xong.
3. Vao **Dashboard → Connection string** → chon ban **Pooled connection**, bat **sslmode=require**. Copy chuoi → day la `DATABASE_URL`.
4. Tao bang + tai khoan dang nhap dau tien (chay tu may Sep, trong thu muc app):
   ```
   # tao file .env tam co dong: DATABASE_URL="...chuoi Neon..."
   npm install
   npx prisma db push          # tao toan bo bang theo schema
   npx prisma db seed          # tao tai khoan dang nhap mac dinh (xem scripts/seed.ts)
   ```
   > `db push` dung cho lan dau (chua co migration). Sau nay doi schema thi dung `prisma migrate`.

---

## 2. Cloudflare R2 (luu anh bill)
1. Cloudflare Dashboard → **R2** → **Create bucket** → ten `bill-toysuncle` → region Auto.
2. **Manage R2 API Tokens** → **Create API token** → quyen **Object Read & Write**, gioi han dung bucket `bill-toysuncle`. Luu lai:
   - **Access Key ID** → `S3_ACCESS_KEY_ID`
   - **Secret Access Key** → `S3_SECRET_ACCESS_KEY`
   - **Account ID** (o trang R2) → ghep thanh `S3_ENDPOINT = https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
3. **CORS (BAT BUOC)** — vi trinh duyet upload thang anh len R2 bang presigned URL. Vao bucket → **Settings → CORS Policy** → dan:
   ```json
   [
     {
       "AllowedOrigins": ["https://bill.toysuncle.art", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   > Thieu CORS = upload anh tu trinh duyet se loi. Day la loi hay gap nhat.

---

## 3. Push code len GitHub
Da co repo `https://github.com/happy88vn/bill.toysuncle.art`. Code da san sang (Claude da init + commit).
Neu chua push: trong thu muc app chay `git push -u origin main`.
**`.env` da bi `.gitignore` chan** — secret khong len GitHub. Yen tam.

---

## 4. Vercel (host app)
1. https://vercel.com → dang nhap bang GitHub → **Add New Project** → chon repo `bill.toysuncle.art` → **Import**.
2. Framework: Vercel tu nhan **Next.js**. Root Directory: de mac dinh (`./`).
3. **Build command**: de mac dinh (`next build`). Vercel tu chay `prisma generate` neu thay prisma — neu khong, dat Build Command = `prisma generate && next build`.
4. **Environment Variables** → nhap TOAN BO bien tu `.env.example` voi gia tri that:
   - `DATABASE_URL` (Neon, ban Pooled)
   - `NEXTAUTH_URL = https://bill.toysuncle.art`
   - `NEXTAUTH_SECRET`
   - `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AWS_REGION=auto`, `AWS_BUCKET_NAME=bill-toysuncle`
   - `ABACUSAI_API_KEY`
   - cac bien `GOOGLE_*` va `ALLOWED_EMAILS`
   > `GOOGLE_PRIVATE_KEY`: dan nguyen ca khoi `-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----`, giu \n.
5. **Deploy**. Cho build xong.

---

## 5. DNS + domain bill.toysuncle.art
1. Trong Vercel project → **Settings → Domains** → them `bill.toysuncle.art`. Vercel se bao ban 1 ban ghi CNAME (vd `cname.vercel-dns.com`).
2. Cloudflare → DNS cua `toysuncle.art` → them **CNAME**: name `bill`, target = gia tri Vercel cho, **Proxy status: DNS only** (tat dam may cam — de Vercel cap SSL). Sau khi Vercel xac nhan co the bat lai proxy neu muon.
3. Cho SSL cap xong (vai phut) → vao https://bill.toysuncle.art.

---

## 6. Google OAuth (dang nhap + Drive)
Vao **Google Cloud Console → APIs & Services → Credentials** → mo OAuth client dang dung:
- **Authorized redirect URIs** them DU CA HAI:
  - `https://bill.toysuncle.art/api/auth/callback/google`  (dang nhap NextAuth)
  - `https://bill.toysuncle.art/api/auth/google-drive/callback`  (cap quyen Google Drive de upload bill)
- Luu lai. Khong co dong nay thi se loi `redirect_uri_mismatch`.

> **Tai khoan dang nhap mac dinh** (tu seed): email `john@doe.com`. Sep nen doi mat khau/email nay
> bang cach sua `scripts/seed.ts` truoc khi chay `prisma db seed`, hoac tao user moi sau khi vao app.

---

## 7. QA sau deploy (tu lai thu het)
- [ ] Vao bill.toysuncle.art → dang nhap duoc (Google SSO + tai khoan credentials).
- [ ] Upload 1 anh bill → AI doc ra du lieu (test ABACUSAI_API_KEY + R2 upload).
- [ ] Sua/duyet 1 record → Sync Google Sheets → kiem tra dong moi trong sheet.
- [ ] Kiem tra anh bill mo duoc tu link (presigned R2).
- [ ] Xem ti gia VCB tu dong (`/api/exchange-rate`).

Neu upload anh loi → 90% la **CORS R2** (Buoc 2.3) hoac sai `S3_ENDPOINT/keys`.
Neu dang nhap Google loi → **redirect URI** (Buoc 6) hoac `NEXTAUTH_URL` sai.
