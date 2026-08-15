# PLAN — B-00b Pendaftaran & B-27 Pengguna & Peran

**Branch:** `f5-onboarding` · **Gate:** F5 (`ARCH:399` — *"Merchant dapat mendaftar → impor → bertransaksi tanpa bantuan"*)

Keduanya digabung dalam satu branch karena masing-masing sendirian **tidak menyelesaikan apa pun yang dapat dibuktikan**. Pendaftaran tanpa B-27 menghasilkan tenant yang owner-nya tidak dapat membuat kasir; B-27 tanpa pendaftaran menuntut merchant yang sudah ada. Yang dibuktikan adalah satu perjalanan utuh:

```
Daftar → resolusi tenant → login back-office (tanpa UUID) → buat kasir + set PIN → kasir masuk
```

---

## Sub-project 1 — login mengembalikan `tenantId`

⛔ **Gap yang ditemukan saat merencanakan, bukan saat mengetik.** Migrasi `0023` membuat login dapat meresolusi tenant dari email, tapi responsnya (`token`, `expiresAt`, `userId`, `roles`) **tidak menyebut tenant yang diresolusi**. Klien yang tidak mengirim `X-Tenant-Id` karena itu berhasil masuk lalu tidak punya nilai untuk header di permintaan berikutnya — setiap layar menjawab 400.

Resolusi di server jadi tidak berguna tanpa ini. Bukan penambahan opsional.

- [x] `login` mengembalikan `tenantId`
- [x] OpenAPI `/auth/login` menyebutkannya sebagai `required`
- [x] Test: login tanpa header mengembalikan tenant yang benar, dan token itu benar-benar dapat dipakai di endpoint lain

**Bukan kebocoran:** ia hanya dikembalikan pada login yang BERHASIL, dan pemanggilnya sudah membuktikan password. Id tenant juga bukan rahasia — ia dikirim di header setiap permintaan.

## Sub-project 2 — B-00b Pendaftaran

- [x] `tenant-terakhir.ts` — kunci `localStorage` diangkat dari `Masuk.tsx` (sekarang ada dua penulis)
- [x] `daftar/pendaftaran.ts` — murni: form → muatan `POST /tenants`, memakai `periksaPassword` domain
- [x] `daftar/Daftar.tsx`
- [x] `App.tsx` — pintu publik: Masuk ⇄ Daftar
- [x] `Masuk.tsx` — ID Tenant menjadi **opsional**
- [x] `sesi.tsx` — `Sesi.tenantId` dari RESPONS server, bukan dari isian form
- [x] Test: `tests/backoffice/pendaftaran.test.js`, `tests/backoffice/tenant-terakhir.test.js`

## Sub-project 3 — B-27 Pengguna & Peran

- [x] `http.ts` — `PUT` (endpoint PIN memakainya; tipe `metode` belum mengizinkannya)
- [x] `pengguna/muatan.ts` — murni: form → muatan `POST /users`, pra-periksa PIN lewat `packages/domain/src/pin.ts`
- [x] `pengguna/Pengguna.tsx` — daftar + form + aksi baris (pola B-28)
- [x] `navigasi.ts` — `LAYAR_SIAP += 'B-27'`
- [x] Test: `tests/backoffice/pengguna-muatan.test.js` + penjaga navigasi

## Sub-project 4 — bukti E2E

- [x] Server + back-office dijalankan sungguhan; perjalanan penuh di browser
- [x] Kasir masuk dengan PIN yang disetel dari back-office

### ⛔ Yang HANYA ditemukan dengan menjalankannya

**CORS tidak mengizinkan `PUT`.** Daftar metode di `app.ts` adalah string tulis
tangan `'GET, POST, PATCH, DELETE, OPTIONS'`, dan `PUT /users/{userId}/pin`
sudah ada sejak Modul F — ia hanya tidak pernah dipanggil dari browser sampai
B-27 dibangun. Gejalanya *"Method PUT is not allowed by
Access-Control-Allow-Methods"*, dan **satu-satunya jalur menyetel PIN kasir
mati di browser**. `HEAD` juga hilang.

Tidak ada test yang DAPAT menangkapnya: `app.inject()` memanggil handler
langsung dan tidak menegakkan CORS sama sekali. Perbaikannya bukan menambahkan
`PUT` ke string itu melainkan **menurunkan daftarnya dari rute yang benar-benar
terdaftar** (`onRoute`) — daftar tulis tangan akan tertinggal lagi pada metode
berikutnya, dan gejalanya muncul di browser merchant, bukan di CI.

### Batas bukti kaki terakhir

Docker tidak berjalan di mesin ini, jadi stack PowerSync jalur turun tidak
dapat dinyalakan. Yang dijalankan: `pin_hash` sungguhan dari PostgreSQL →
skema SQLite lokal sungguhan (`db/local/001-initial.sql`) → `masuk()` sungguhan
dari `apps/kasir/src/identitas/login.ts` → Argon2id sungguhan. Yang disalin
tangan hanya baris `user`; kolomnya `text` dan tidak berskala, dan jalur
turunnya sendiri sudah dibuktikan terpisah (prototipe 05). **Dinyatakan, bukan
didiamkan.**

---

## Batas yang dinyatakan

- **Tanpa captcha dan tanpa verifikasi email** pada pendaftaran. Rate limit in-memory sudah ada (PR #13). Keduanya utang yang tercatat, bukan yang didiamkan.
- **Peran yang dapat dibuat B-27 mengikuti `bolehKelolaPengguna`** — server yang menolak, layar yang menjelaskan. Layar tidak menyembunyikan pilihan berdasarkan peran aktor; kalau ditolak, pesannya menyebut peran mana.
