# PLAN — F5: pendaftaran merchant & penegakan kuota

**Status:** SELESAI 15 Agustus 2026 — pendaftaran dan penegakan kuota keduanya tertutup
**Gate:** `ARCH:399` — *"Merchant dapat mendaftar → impor → bertransaksi tanpa bantuan"*
**Spec:** ⛔ **tidak ada spec modul untuk tenancy.** Lihat § 2.

---

## 1. Masalahnya

Gate F5 punya tiga kata kerja berurutan. Yang tengah sudah ada sejak `e105563` (impor katalog), yang terakhir sudah ada sejak F1–F3. **Yang pertama tidak ada sama sekali.**

Hari ini satu-satunya cara sebuah tenant lahir adalah `tools/dev-seed.mjs` — skrip yang menulis `INSERT` langsung ke database dengan `DATABASE_URL`. Konsekuensinya bukan sekadar ketidaknyamanan:

| | |
|---|---|
| Merchant tidak dapat mendaftar | Gate F5 tidak dapat ditutup, apa pun yang dibangun sesudahnya |
| Owner pertama tidak punya password | `POST /auth/login` sudah ada sejak F3 dan **tidak punya siapa pun untuk dilayani** |
| Kuota `max_*` diisi tangan di skrip dev | Kolomnya ada sejak F0 (`0002_tenancy.sql`) dan **tidak pernah dibaca satu baris kode pun** |

Yang ketiga adalah lubang yang paling mudah terlewat: skemanya terlihat lengkap, jadi kuota terbaca seolah sudah ditegakkan.

---

## 2. ⛔ Batas dokumen — dinyatakan, bukan didiamkan

Delapan spec modul (`spec-a` … `spec-h`) memuat 414 acceptance criteria. **Tidak satu pun menyangkut tenancy, paket, kuota, lisensi, atau pendaftaran.** 77 FR di PRD berhenti di FR-H8.

Yang ada hanyalah:

| Sumber | Isi |
|---|---|
| `research/09` § 6 | Tabel dimensi kuota + titik penegakan + perilaku saat terlampaui |
| `research/09` § "Implikasi untuk ERD" | Kolom `max_outlets`/`max_devices`/`max_users`/`max_products` pada `tenant` |
| `research/11` § 3 | Lever tier pasar Indonesia adalah kuota, bukan fitur |
| `spec-a:370` | **Pertanyaan terbuka**: batas produk per tier — "tier Gratis 200, Standar 5.000" ditulis sebagai pertanyaan, bukan keputusan |
| `IA:169`, `IA:208` | Layar B-29 "Langganan & Batas" |

Rencana ini karena itu diturunkan dari `research/09` § 6, dan **setiap angka kuota ditandai `[ASUMSI]`**. Angkanya belum kamu putuskan; mekanismenya tidak menunggu angkanya.

---

## 3. Sub-project 1 — `POST /tenants`, pendaftaran mandiri

### 3.1 Yang ditulis, dalam SATU transaksi

```
tenant  →  vertical_profile (is_tenant_default)  →  outlet
        →  user (owner, password_hash)  →  user_role  →  user_outlet
        →  audit_event
```

Semuanya atau tidak sama sekali. Tenant yang lahir tanpa outlet adalah tenant yang tidak dapat berjualan; tenant yang lahir tanpa owner adalah tenant yang **tidak dapat dimasuki siapa pun selamanya** — tidak ada jalur pemulihan, karena setiap endpoint lain menuntut `X-Actor-Id` yang sah.

### 3.2 `[KEPUTUSAN]` Endpoint KEDUA tanpa `X-Tenant-Id`

Sampai hari ini webhook Midtrans adalah satu-satunya. Sekarang ada dua, dan alasannya berbeda:

- Webhook: Midtrans tidak tahu apa-apa soal tenant kami → dibaca dari `custom_field1`.
- Pendaftaran: **tenant-nya belum ada.** Tidak ada nilai yang benar untuk header itu.

`X-Actor-Id` juga tidak diminta, dan alasannya sejenis: aktor pertama adalah owner yang baru saja dibuat request ini.

Yang **tidak** berubah: seluruh penulisan tetap terjadi di dalam `withTenantTransaction(pool, idTenantBaru, …)`. `SET LOCAL app.tenant_id` dijalankan dengan id yang belum punya baris, lalu `tenant` — satu-satunya tabel yang dikecualikan RLS — ditulis di dalamnya. Setiap tabel berikutnya sudah tunduk RLS seperti biasa. **Invariant #8 tidak dilonggarkan sedikit pun.**

### 3.3 `[KEPUTUSAN]` `plan` TIDAK diterima dari klien

Endpoint ini tidak terautentikasi. Menerima `plan` dari body berarti siapa pun dapat memberi dirinya `enterprise` beserta kuota tak terbatas, lewat satu field JSON.

Pendaftaran mandiri selalu menghasilkan `plan = 'free'`. Perpindahan paket adalah operasi billing, dan billing bukan bagian dari rencana ini.

### 3.4 `[ASUMSI]` Kuota tier gratis

`spec-a:370` menulis "tier Gratis 200, Standar 5.000" sebagai pertanyaan terbuka. Angkanya dipakai sebagai titik awal dan **ditandai**, di **satu** tempat (`packages/domain/src/paket.ts`) supaya menggantinya adalah satu edit, bukan perburuan.

| | free | standard | pro | enterprise |
|---|---|---|---|---|
| `max_outlets` | 1 | 5 | 20 | `null` |
| `max_devices` | 2 | 10 | 50 | `null` |
| `max_users` | 3 | 15 | 60 | `null` |
| `max_products` | 200 | 5.000 | 20.000 | `null` |

`null` = tanpa batas. Bukan angka besar — angka besar adalah batas yang berpura-pura tidak ada.

### 3.5 `[KEPUTUSAN]` Aturan password dibagi, tidak disalin

`PANJANG_MINIMUM` dan `PASSWORD_BOCOR` hari ini adalah konstanta privat di `identity/handlers/auth.ts`. Pendaftaran menetapkan password pertama dan tunduk pada aturan yang sama (FR-F2b).

Menyalinnya berarti dua daftar yang akan menyimpang. Keduanya dipindahkan ke `packages/domain/src/password.ts` sebagai fungsi murni `periksaPassword`, lalu `auth.ts` memanggilnya. **Ini refactor terhadap kode yang sudah ada, dan karena itu ditulis di sini supaya masuk scope.**

### 3.6 `[KEPUTUSAN]` `user` ditulis oleh `identity`, bukan `tenancy`

Invariant #4: `"user"`, `user_role`, `user_outlet` milik modul `identity`. Modul `tenancy` tidak boleh menyentuhnya.

`identity/index.ts` mengekspor `buatPemilikPertama(client, input)` — pola yang sama dengan `recordAuditEvent` dan `recordStockMovements`: satu fungsi yang menerima `client` dari transaksi pemanggil, sehingga invariant #1 tetap utuh sementara batas modul tetap nyata.

### 3.7 Batas yang dinyatakan

| Batas | Kenapa dibiarkan |
|---|---|
| ~~Tanpa rate limit~~ | **DITUTUP 15 Agustus 2026.** `@fastify/rate-limit` dengan store in-memory, `global: false`, hanya pada `POST /tenants`. Angkanya dari `TENANT_REGISTRATION_RATE_MAX` / `_WINDOW` (invariant #5), bawaan 5 per 15 menit. **Tanpa captcha**, dan hitungannya per-proses — ia menahan penyalahgunaan kasar, bukan penyerang terdistribusi |
| **Tanpa verifikasi email** | Email owner tidak dibuktikan miliknya. Pemulihan password belum ada sama sekali |
| ~~Unggah-ulang berkas yang sudah diimpor dapat ditolak~~ | **DITUTUP 15 Agustus 2026.** Rumus pertama menilai kuota terhadap seluruh baris berkas dan menabrak `spec-a:288`. Direvisi: yang dihitung hanya baris yang akan menjadi produk BARU — `dilewati`, `valid.perbarui`, dan `masalah` semuanya gratis |
| **Retry dengan id BARU membuat tenant kedua** | Idempotensi datang dari PK `tenant.id` yang di-generate klien. Respons yang hilang lalu diulang dengan id sama → `409`. Diulang dengan id baru → tenant kedua. Tidak ada `UNIQUE` lintas-tenant pada email, dan tidak dapat ada tanpa query yang melewati RLS |

---

## 4. Sub-project 2 — penegakan kuota

### 4.1 Titik penegakan (`research/09` § 6)

| Dimensi | Ditegakkan di | Modul |
|---|---|---|
| `max_outlets` | pembuatan outlet | tenancy |
| `max_devices` | `POST /devices` | identity |
| `max_users` | `POST /users` | identity |
| `max_products` | `POST /items` **dan `POST /catalog/import`** | catalog |

Impor adalah yang paling penting dan paling mudah terlewat: ia menambah ribuan baris dalam satu request. Kuota yang hanya diperiksa di `POST /items` akan dilewati sepenuhnya oleh jalur yang justru dirancang untuk volume.

### 4.2 ⛔ Aturan mutlak: kuota TIDAK PERNAH menghentikan penjualan

`research/09` § 6 dan Definition of Done `CLAUDE.md` menyatakannya. Penegakan hanya pada operasi administratif.

Ini diuji sebagai **penjaga**, bukan sebagai kepercayaan: ada test yang memindai jalur kasir (`ordering`, `payment`, `cash`) untuk pemanggilan fungsi kuota, dan gagal bila menemukannya. Volume transaksi **tidak pernah** menjadi dimensi kuota.

### 4.3 `[KEPUTUSAN]` Setiap modul menghitung pemakaiannya sendiri

`tenancy` mengekspor `batasKuota(client)` → membaca kolom `max_*` dari `tenant`. `packages/domain/src/kuota.ts` memegang aturan murninya.

Yang **tidak** dilakukan: `tenancy` menghitung `COUNT(*) FROM item`. Itu melanggar invariant #4, dan konsekuensinya nyata — modul tenancy akan perlu tahu bahwa produk yang diarsipkan tidak dihitung, aturan yang dimiliki catalog.

---

## 5. Checklist

### Sub-project 1 — pendaftaran

- [x] T1 `packages/domain/src/password.ts` — `periksaPassword` murni + test
- [x] T2 `auth.ts` memanggilnya; konstanta lama dihapus; test lama tetap hijau
- [x] T3 `packages/domain/src/paket.ts` — kuota per paket `[ASUMSI]` + test
- [x] T4 `identity/index.ts` — `buatPemilikPertama` + test
- [x] T5 Kontrak OpenAPI `POST /tenants`
- [x] T6 `tenancy/handlers/register.ts` + wiring `buildApp`
- [x] T7 Test: satu transaksi, semua-atau-tidak-sama-sekali
- [x] T8 Test: `plan` dari klien diabaikan
- [x] T9 Test: owner hasil pendaftaran dapat `POST /auth/login`
- [x] T10 Test: id yang sama diulang → `409`
- [x] T11 Sabotase tiap penjaga; suite penuh + typecheck + lint

### Sub-project 2 — kuota

- [x] T12 `packages/domain/src/kuota.ts` + test
- [x] T13 `tenancy` — `batasKuota`
- [x] T14 Penegakan di `POST /users`, `POST /devices`
- [x] T15 Penegakan di `POST /items` **dan** `POST /catalog/import`
- [x] T16 Penjaga: jalur kasir tidak menyentuh kuota
- [x] T17 Sabotase + suite penuh
