# Handoff Checklist

Status per 27 Juli 2026. Centang saat selesai.

## Sebelum baris kode pertama

- [ ] Baca [`CLAUDE.md`](CLAUDE.md) — delapan invariant, stack terkunci, daftar "jangan bangun"
- [ ] `git init` dan commit pertama berisi seluruh dokumentasi
- [ ] PostgreSQL 17+ berjalan lokal
- [ ] Buat **dua** role database: `lumi_owner` (migrasi) dan `lumi_app` (aplikasi, **tanpa** `BYPASSRLS`, **bukan** owner tabel)

## Gate F0 — semua harus hijau sebelum F1

- [x] Skema PostgreSQL berjalan dari `db/migrations/` (0001–0014, diverifikasi 31 Juli 2026)
- [x] **Test isolasi lintas-tenant hijau untuk setiap tabel** ← gate utama — `npm run test:isolation`, 189/189 hijau, stabil di 3× run berturut-turut
- [x] `FORCE ROW LEVEL SECURITY` aktif di setiap tabel — dibuktikan `tests/isolation/roles-and-force-rls.test.js`
- [x] `app.tenant_id` di-`SET LOCAL` per transaksi, terbukti tidak bocor antar request — dibuktikan `tests/isolation/set-local-per-transaction.test.js` (termasuk kontrol negatif)

  Open item (bukan lupa, dikonfirmasi 31 Juli 2026): ERD §11 menyebut tabel
  `subscription`, `usage_metric` (modul `tenancy`) dan `support_session`
  (modul `identity`) tanpa daftar kolom — hanya "sesuai spec modul komersial
  dan operasional". Tidak ada spec lain yang mendefinisikan kolomnya, jadi
  ketiganya **sengaja tidak dibuat di F0** untuk menghindari menebak skema.
  Ditunda ke F1 setelah spec modul terkait ditulis — menambah tabel baru
  nanti murah, tidak seperti menambah kolom ke tabel besar yang sudah berisi
  data.

- [x] Skema SQLite lokal berjalan (`db/local/001-initial.sql` + `stock_snapshot` + `ix_mv_hlc`) — `npm run test:sqlite-local` hijau
- [x] Font Inter di-self-host, `@import` Google Fonts dihapus — lewat `packages/ds` (wrapper, `ds-bundle` tidak diubah), `@fontsource/inter` subset latin saja (400/500/600), diverifikasi tidak ada request ke `fonts.googleapis.com` di build output
- [x] Header COOP/COEP di-set — `apps/kasir/vite.config.ts` (server + preview) dan `apps/kasir/src-tauri/tauri.conf.json`, diverifikasi benar-benar terkirim (`vite preview` + `curl`)
- [ ] SQLite WASM+OPFS berjalan di browser — belum dibangun/diuji (COOP/COEP baru jadi prasyarat, jalur OPFS sendiri belum ada kode)
- [x] `npm run lint:ds` hijau dan masuk CI — diperbaiki lewat plugin oxlint kustom (`tools/oxlint-plugins/ds-adherence.mjs`) yang membaca `ds-bundle/_adherence.oxlintrc.json` asli (termasuk `x-omelette`) dan menerjemahkannya ke config yang oxlint 1.76 terima (`tools/generate-oxlint-config.mjs` → `.oxlintrc.generated.json`), tanpa mengubah config sumber. `npm run lint:ds` exit 0 pada `apps/`+`packages/`, exit 1 pada pelanggaran nyata (hex/px mentah, prop tak dikenal, enum salah, deep import termasuk `export ... from`) — diverifikasi termasuk oleh review akhir yang menstres-test plugin secara adversarial. Workflow `.github/workflows/lint-ds.yml` sudah dibuat dan menjalankan `npm run lint:ds` di setiap push/PR.

  Satu gap tersisa (bukan lupa): workflow ini **belum pernah benar-benar berjalan di GitHub** karena repo ini belum punya git remote — tidak bisa diverifikasi end-to-end di lingkungan ini. Langkah manual untuk user: push ke remote, lalu konfirmasi run `lint-ds` hijau di tab Actions. Sama seperti gap `cargo tauri dev` yang dicatat untuk sub-project Tauri sebelumnya — dicatat eksplisit di sini, bukan dilewati diam-diam.
- [x] Aplikasi kosong berjalan di Tauri dengan token design system terpasang — `npm run tauri dev` dari `apps/kasir` dikonfirmasi jalan lancar 31 Juli 2026 (window "Lumi POS — Kasir" + AppShell dari design system)

## Keputusan produk yang perlu dikonfirmasi sebelum F1

Semuanya menyentuh skema — murah sekarang, mahal nanti.

- [ ] Tanggal bisnis berakhir saat tutup shift (default 04:00), bukan tengah malam
- [x] `VerticalProfile` per **outlet** dengan default dari tenant (OQ-09) — diputuskan 1 Agu 2026, diterapkan `db/migrations/0015` (`is_tenant_default` + partial unique index). Test: `npm run test:schema`
- [x] QRIS statis konfirmasi manual didukung (OQ-15) — diputuskan 1 Agu 2026: **ya**, bersama QRIS dinamis lewat Midtrans. Statis berfungsi offline dan wajib disertai kontrol anti-fraud di `spec-c`
- [x] Ambang otorisasi default: diskon >20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale >3×/shift — diputuskan 1 Agu 2026. **Ditambah:** void **tanpa** PIN manajer (alasan + audit + restock otomatis), refund tetap PIN manajer. Angkanya `[ASUMSI]`, belum divalidasi ke merchant
- [ ] Batas kredensial offline (OQ-08)

## Menjalankan test — satu database, satu suite pada satu waktu

**Seluruh suite berbagi satu database dan setiap `beforeEach` menjalankan
`TRUNCATE` lewat `resetAll`.** Menjalankan dua suite bersamaan — dua terminal,
atau satu suite di latar belakang sambil menjalankan yang lain — membuat suite
saling menghapus data di tengah jalan.

Gejalanya menipu: kegagalan berpindah-pindah setiap run, menyentuh test lama
yang tidak disentuh perubahan apa pun, dan errornya berbunyi
`UNKNOWN_TENANT: Tenant ... tidak dikenal` atau `404` di jalur yang jelas-jelas
benar. Terlihat seperti bug produk atau race condition di kode. Bukan.

Diamati 2 Agustus 2026: `npm run test:catalog` dijalankan bersamaan dengan
dirinya sendiri menghasilkan 15 kegagalan; dijalankan sendirian, 137/137 hijau
dua kali berturut-turut.

CI aman — `.github/workflows/test.yml` menjalankan suite secara berurutan.
Batasan ini hanya menggigit di mesin lokal.

## Dua hal yang hijau lokal tapi merah di CI

Keduanya terbukti nyata, bukan hipotetis — dan keduanya lolos justru karena verifikasi lokal terasa lengkap.

**`npm run` bukan pengganti `npm ci`.** Membuat paket baru di `packages/` menjadikannya workspace, dan `package-lock.json` harus ikut diperbarui. Lokal tidak pernah gagal karena `npm run` memakai `node_modules` yang sudah ada; hanya `npm ci` yang menuntut lock sinkron. Terjadi 7 Agu 2026, tersembunyi 6 commit karena insiden GitHub Actions. Setiap kali menambah paket: `npm install --package-lock-only`, lalu commit lock-nya.

**`npm run lint:ds` tidak menjalankan `tsc`.** Ia hanya menjalankan oxlint. Pemeriksaan tipe adalah step terpisah di `.github/workflows/lint-ds.yml`, dan seluruh suite bisa hijau dengan type error di dalamnya — JavaScript runtime tidak peduli pada interface TypeScript. Terjadi 7 Agu 2026: `VariationSnapshotRow` kehilangan dua field sementara 522 test tetap lolos.

Karena itu ada `npm run typecheck`. **Jalankan sebelum menyatakan apa pun selesai**, bersama suite dan lint.

## Utang yang diketahui, bukan lupa

- [ ] **AC keempat FR-B2 tidak bisa dipenuhi**: "kill -9 di tengah commit tidak menghasilkan data rusak (test dengan SQLite lokal)". Jalur SQLite WASM+OPFS belum dibangun — item F0 terakhir yang masih terbuka. Atomisitas sisi server sudah diuji lewat injeksi kegagalan di empat tahap penulisan; yang belum diuji adalah sisi klien.
- [ ] **Status cache hit idempotency `[ASUMSI]`**: `spec-b:336` menulis "status 200", `spec-b:325` menulis "mengembalikan respons asli", dan skema menyediakan kolom `response_status`. Diimplementasikan sebagai "kembalikan status tersimpan" (`201`). Perlu keputusan; kalau `200` yang benar, `spec-b` dan kode harus disamakan.
- [ ] **Drift `quantity` `[ASUMSI]`**: `spec-b:151,159` menulis `numeric`; skema dan `CLAUDE.md` memakai `bigint ×1000` dengan alasan hasil pengukuran. Maksudnya terpenuhi (`0.5` disimpan sebagai `500`, diuji), tapi AC-nya tidak bisa dicentang apa adanya.

## Proses eksternal — mulai sekarang, lead time di luar kendali

- [ ] Konsultasi pajak: kewajiban penyedia POS pasca-Coretax (OQ-04) + pajak dine-in vs takeaway (OQ-05)
- [ ] Email konfirmasi lisensi ke hello@powersync.com untuk redistribusi on-premise (OQ-03b)
- [ ] Cek persyaratan program partner GoFood & GrabFood (OQ-06) — menentukan tanggal v1.1
- [ ] Daftar akun sandbox Midtrans
- [ ] Beli 5–8 model printer thermal paling umum untuk program "Diuji dengan Lumi POS" (< Rp5 juta)

## Prototipe yang masih perlu dijalankan

- [ ] **OQ-14** — Tauri Android: printer Bluetooth + scanner HID (1–2 minggu). Menentukan apakah rencana mobile bertahan
- [ ] Ukur ulang performa query pada perangkat kasir nyata — faktor tablet 3–5× masih asumsi
- [ ] Tambahkan clock skew + HLC ke harness DST — FR-H5 belum divalidasi sama sekali

## Validasi pasar — sebelum F2 dimulai

- [ ] Wawancara 10 merchant target: seberapa sering outage, dan apa yang mereka lakukan sekarang
- [ ] 30–50 percakapan penjualan dengan harga disebutkan (Rp349.000 / Rp699.000)
- [ ] Validasi ambang otorisasi ke 3 merchant

Asumsi terbesar yang belum diuji ada di [`product/PRD-lumi-pos-v1.md`](product/PRD-lumi-pos-v1.md) § 11.2. Kalau A1 (frekuensi outage) runtuh, posisi produk berubah — sebaiknya diuji **sebelum** F2, bukan sesudah.
