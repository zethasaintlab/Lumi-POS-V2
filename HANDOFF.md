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

## Setiap suite ber-database WAJIB `--test-concurrency=1`

Bukan preferensi. Setiap file test yang menyentuh database memanggil `resetAll` (`TRUNCATE`) di `beforeEach`. Dua file dalam satu suite yang berjalan bersamaan akan saling menghapus data di tengah jalan, sama seperti dua suite yang berjalan bersamaan.

Gejalanya sama menipunya: `violates foreign key constraint "..._tenant_id_fkey"` diikuti rentetan `current transaction is aborted`. Terlihat seperti bug skema atau bug produk. Bukan.

`test:isolation` dan `test:server` sempat tidak punya flag ini dan lolos berbulan-bulan karena keberuntungan timing — lalu gagal di runner CI 2-core, 7 Agu 2026. **Suite baru yang menyentuh database harus menyalin flag ini.** `test:domain` tidak butuh (murni, tanpa I/O) dan justru lebih cepat tanpa.

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
- [ ] **Alokasi service charge ke dasar pajak `[ASUMSI]`**: AC FR-C8 kelima mewajibkan **diskon order** didistribusikan proporsional ke baris. `calculateTax` menerapkan prinsip yang sama ke **service charge**, karena langkah 10 menetapkan service charge masuk dasar pajak dan proporsional adalah satu-satunya pembagian yang menjaga langkah itu benar saat satu order punya beberapa tarif. Spec tidak menyatakannya eksplisit. Ditandai di `packages/domain/src/tax.ts`.
- [ ] **`payment` PK `(id, occurred_at)`, bukan `id`**: tabelnya dipartisi, jadi id yang sama dengan `occurred_at` berbeda menghasilkan baris kedua. Yang melindungi retry pembayaran adalah Idempotency-Key, bukan primary key — satu lapisan lebih sedikit daripada `order`. Perilakunya didokumentasikan test; kalau ini perlu diperketat, itu keputusan produk.
- [ ] **Status cache hit idempotency `[ASUMSI]`**: `spec-b:336` menulis "status 200", `spec-b:325` menulis "mengembalikan respons asli", dan skema menyediakan kolom `response_status`. Diimplementasikan sebagai "kembalikan status tersimpan" (`201`). Perlu keputusan; kalau `200` yang benar, `spec-b` dan kode harus disamakan.
- [ ] **`voided_by_order_id` terbaca terbalik**: kolomnya ada di baris order **pembatal** dan menunjuk order yang dibatalkan. Arah itu **dipaksa**, bukan dipilih — AC FR-B7 pertama melarang `UPDATE` pada order asli, dan pembatalnya belum ada saat order asli ditulis, jadi tidak ada arah lain yang mungkin. Namanya menyarankan sebaliknya. Kalau nanti diganti (`voids_order_id`), itu rename kolom + migrasi expand-contract, dan itu keputusan produk.
- [ ] **Order yang sudah di-void tetap berstatus `open`**: konsekuensi langsung dari "tidak ada UPDATE pada order asli". Tidak ada apa pun di status order yang menolak void kedua; yang menolaknya adalah `SELECT` di aplikasi **dan** index unik `ux_order_voided_by` (migrasi `0017`). Laporan mana pun yang menyimpulkan "order ini sah" dari `status = 'open'` akan salah — yang benar adalah memeriksa apakah ada order pembatal yang menunjuknya.
- [ ] **Refund tanpa payment negatif `[ASUMSI ditutup — keputusan user 7 Agu 2026]`**: `spec-b:230` menulis refund membuat "payment negatif", tapi `payment.amount` punya `CHECK (amount > 0)`. Keputusan: pakai baris `refund` saja, skema payment tidak disentuh. `spec-b:230` karena itu **tidak akurat** terhadap kode; kalau spec ingin disamakan, itu penyuntingan dokumen dan bukan kewenanganku.
- [ ] **Batas restock refund adalah per (order, variation), bukan per baris order**: `stock_movement` tidak punya kolom `line_id`. Untuk order dengan dua baris atas variation yang sama, keduanya berbagi satu jatah pengembalian. Itu batas yang lebih benar untuk stok, tapi berarti laporan tidak dapat menjawab "baris mana yang dikembalikan" dari `stock_movement` saja.
- [ ] **Refund sebagian menuntut `lines` eksplisit**: tanpa itu server harus menebak apakah barang fisik kembali ke rak, dan tebakannya baru ketahuan saat stock opname. `lines: []` berarti uang kembali tanpa barang kembali. Tidak ada AC yang menyatakan ini — ia muncul dari test yang menyingkap bahwa refund uang parsial akan mengembalikan seluruh stok order.

- [ ] **Produksi belum menyalakan log**: `LOG_LEVEL` default `silent`, meneruskan perilaku yang sudah ada — sampai C-2, aplikasi ini memang tidak pernah punya logger sama sekali (`Fastify()` dipanggil tanpa opsi, jadi `req.log.error` menulis ke logger no-op). Redaksinya sudah terpasang dan teruji; yang belum diputuskan adalah level dan tujuan log di produksi.
- [ ] **`expired` gateway disimpan sebagai payment `failed` `[ASUMSI]`**: kolom `payment.status` hanya mengenal empat nilai, dan `voided` di sana berarti dibatalkan oleh tindakan orang. Sebab aslinya tidak hilang — respons memuat `gatewayStatus` apa adanya. `spec-c:293-316` hanya menulis "Batalkan payment" untuk `failed` maupun `expired` tanpa menyebut status simpanannya.
- [ ] **Perbandingan signature timing-safe tidak dapat diuji**: `verifyMidtransSignature` memakai `timingSafeEqual`, tapi menggantinya dengan `===` **tidak** membuat satu test pun merah — saluran samping waktu tidak terlihat dari test fungsional. Ia benar karena alasannya benar, bukan karena ada yang menjaganya.
- [ ] **Idempotency key gateway pada balapan dua request bersamaan belum diuji**: pada jalur berurutan, yang mencegah transaksi gateway kedua adalah baris `idempotency_key` dan baris `payment` yang dipakai ulang. Key yang diteruskan ke gateway penting untuk dua request yang berbarengan, dan untuk itu belum ada test. Bahwa header `X-Idempotency-Key` sungguh dikirim diuji di tingkat adapter, bukan ujung ke ujung.
- [ ] **`navigator.storage.persist()` belum dipanggil, dan perilaku saat DITOLAK belum didefinisikan.** Terukur `persisted = false`: browser boleh menghapus OPFS saat ruang disk menipis, dan yang terhapus adalah antrean upload yang belum terkirim. Tidak ada spec yang menyebutkan ini
- [ ] **Pola satu-penulis (SharedWorker) belum dibangun.** Terbukti wajib, bukan opsional: tab kedua gagal membuka database sama sekali (`NoModificationAllowedError`). Tanpa pola ini, kasir yang tidak sengaja membuka tab kedua mematikan aplikasi
- [ ] **Angka OPFS baru berlaku untuk desktop Chromium.** Android, iOS/Safari, dan perangkat kelas bawah belum diukur, dan butuh perangkat nyata — langkah manual, sejajar dengan verifikasi webhook Midtrans
- [ ] **Jam ketiga: jam perangkat klien**. FR-H6 menuntut harga diresolusi pada `occurred_at`, dan `occurred_at` datang dari perangkat. Perangkat yang jamnya salah sehari akan memilih harga yang salah — dan tidak ada apa pun di sistem ini yang menangkapnya, karena order seperti itu terlihat sah dari segala sisi. `CLAUDE.md` sudah mencatat dua jam (PostgreSQL dan Node) beserta bug nyata yang ditimbulkannya; ini yang ketiga, dan yang paling sulit dipercaya. Batas kewajaran skew jam perangkat belum diputuskan.
- [ ] **Drift `quantity` `[ASUMSI]`**: `spec-b:151,159` menulis `numeric`; skema dan `CLAUDE.md` memakai `bigint ×1000` dengan alasan hasil pengukuran. Maksudnya terpenuhi (`0.5` disimpan sebagai `500`, diuji), tapi AC-nya tidak bisa dicentang apa adanya.

## Proses eksternal — mulai sekarang, lead time di luar kendali

- [ ] Konsultasi pajak: kewajiban penyedia POS pasca-Coretax (OQ-04) + pajak dine-in vs takeaway (OQ-05)
- [ ] Email konfirmasi lisensi ke hello@powersync.com untuk redistribusi on-premise (OQ-03b)
- [ ] Cek persyaratan program partner GoFood & GrabFood (OQ-06) — menentukan tanggal v1.1
- [x] Daftar akun sandbox Midtrans — key ada di `.env` lokal (tidak pernah ter-commit)
- [ ] **Verifikasi webhook Midtrans end-to-end**: butuh URL publik (tunnel). Jalur kodenya **sudah** diuji penuh dengan payload buatan — signature, tenant, idempotensi, dan penolakan saat kunci kosong (`tests/payment/webhook.test.js`). Yang belum dibuktikan adalah jabat tangan sungguhannya: bahwa Midtrans benar-benar mengirim `custom_field1` kembali apa adanya, dan bahwa rumus signature-nya cocok dengan yang dikirim server produksi. Itu langkah manual, dan sampai dijalankan, integrasi ini **belum boleh disebut terbukti**
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
