# Handoff Checklist

Status per 16 Agustus 2026. Centang saat selesai.

Bagian F0–F4 di bawah adalah catatan fase kasir; **G1 (back-office) ada di
bagian terakhir berkas ini.** Beberapa baris utang di bagian F3/F4 sudah
ditutup oleh G1 dan ditandai coret di tempatnya — dicoret, bukan dihapus,
supaya alasan aslinya tetap dapat dibaca.

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
- [x] ~~**Kepemilikan database lokal belum diputuskan**~~ **Diputuskan user 7 Agustus 2026: PowerSync memegang DB lokal, 20 tabel kami sebagai raw table.** Dibuktikan dengan menjalankan kode di `prototypes/04-powersync-raw-tables/FINDINGS.md` — invariant #1 (T3: rollback sungguhan), koeksistensi (T1: 20/20 tabel dan 15/15 index selamat, 0 view, 0 tabel `ps_data__*`), jalur naik tetap milik `outbox_local` (T4), dua tab menulis bersamaan (T7). Syarat mengikat: tabel kami HARUS raw table — mendeklarasikannya sebagai tabel PowerSync biasa membuat core mencoba `CREATE VIEW` bernama sama dan bertabrakan
- [ ] **`product/ERD-lumi-pos-v1.md` menyimpan bentuk LAMA `item_modifier_list`** — PK komposit `(item_id, modifier_list_id)`, tanpa kolom `id`. Kode, migrasi `0018`, dan skema lokal sudah pindah; dokumen belum. **Penyuntingan dokumen produk bukan kewenangan agent** — kamu yang melakukannya. Sampai itu terjadi, ERD dan database tidak sepakat, dan ERD-lah yang salah
- [ ] **Seluruh tabel lain di `db/local/001-initial.sql` memakai `id TEXT PRIMARY KEY` tanpa `NOT NULL` eksplisit.** Ditemukan saat mengerjakan `0018`: pada tabel rowid, **SQLite menerima NULL di kolom PRIMARY KEY** — bug lama yang dipertahankan demi kompatibilitas. `item_modifier_list` sudah diperbaiki; ~15 tabel lain belum. Akibatnya baris ber-id NULL diterima di perangkat sementara PostgreSQL menolaknya, dan selisihnya baru terlihat saat sync. Bukan cacat hari ini (semua penulis mengisi `id`), tapi ia jaring pengaman yang tidak ada di tempat yang paling membutuhkannya
- [x] ~~**`item_modifier_list` perlu kolom `id` — diputuskan user 7 Agustus 2026, BELUM dikerjakan.**~~ **Selesai 7 Agustus 2026** (`docs/superpowers/plans/PLAN-item-modifier-list-id.md`): migrasi `0018` expand-contract, PK pindah ke `id`, `ux_item_modifier_list_pair` menggantikan jaminan pasangan, skema lokal menyusul, handler men-generate `randomUUID()` dan mempertahankan `id` yang sama saat attach ulang, OpenAPI menyertakan `id`, prototipe 04 memindahkan T1g ke `stock_snapshot`. Sabotase membuktikan constraint uniknya yang menahan: dilepas → pasangan ganda benar-benar tersimpan dan `ON CONFLICT` handler patah. Konteks aslinya: PowerSync mewajibkan kolom `id` untuk raw table (`Table item_modifier_list has no id column.`); primary key tabel ini komposit `(item_id, modifier_list_id)`. Ia katalog, jadi ia harus turun, jadi ini MEMBLOKIR replikasi turun relasi item↔modifier. Yang harus dikerjakan: migrasi PostgreSQL **baru** `0018` (expand-contract — JANGAN sunting `0004_catalog.sql`), PK pindah ke `id` dengan **unique constraint** atas pasangan lama supaya relasi ganda tetap mustahil, `db/local/001-initial.sql` menyusul, handler `item-modifier-lists.ts` + `tests/catalog/` + `tests/isolation/helpers/` menyesuaikan, dan `item_modifier_list` naik ke `TABEL_RAW` di prototipe 04 (T1g lalu diarahkan ke `stock_snapshot`). **`product/ERD-lumi-pos-v1.md` §15 menyimpan bentuk lama dan harus kamu sunting sendiri** — dokumen produk bukan kewenangan agent
- [x] ~~**`worker: { format: 'es' }` belum tercatat**~~ **Dipasang di `apps/kasir/vite.config.ts` 7 Agustus 2026**, sebelum PowerSync masuk ke sana. `vite dev` berjalan hijau tanpanya; hanya `vite build` yang gagal (`Invalid value "iife" for option "worker.format"`). Jebakannya bukan kegagalannya melainkan waktunya — ia muncul saat build rilis. Komentar penjelasnya ikut dipasang supaya baris itu tidak dikira tidak terpakai lalu dihapus
- [ ] **Latensi tulis lewat PowerSync 3,8× lebih lambat, dan ~6–7 ms-nya tidak terjelaskan.** 12,33 ms vs 3,25 ms untuk penjualan yang sama. Terbukti BUKAN karena raw table (T5e), bukan RPC per pernyataan (T5b), bukan SharedWorker sendirian (T5d, ~2,3 ms). Masih jauh di bawah ambang yang terlihat kasir, tapi angka ini dari mesin pengembangan — 3,8× dari basis tablet Rp 1,5 juta belum diukur
- [x] ~~**Jalur turun PowerSync belum pernah dijalankan.**~~ **Dijalankan 8 Agustus 2026** terhadap PowerSync Open Edition self-hosted (`prototypes/05-powersync-jalur-turun/FINDINGS.md`): 7/7 tabel katalog turun ke raw table KAMI, nol tabel `ps_data__*`, `item_modifier_list` utuh beserta `id`-nya, isolasi tenant menahan, perubahan berjalan sampai tanpa reload. Sinkronisasi pertama 76–178 ms — **untuk 7 baris; jangan dikutip sebagai angka katalog sungguhan**
- [ ] ⛔ **Pada jalur turun, sync rules adalah SATU-SATUNYA batas tenant — invariant #8 tidak menjaga apa pun di sana.** Role replikasi PowerSync wajib `BYPASSRLS` (replikasi logis membaca WAL, dan RLS tidak berlaku pada WAL). Dibuktikan dengan sabotase: satu klausa `WHERE tenant_id = auth.parameter('tenant_id')` dilepas dari SATU baris, dan katalog tenant lain mendarat di perangkat yang salah tanpa satu pun error. **Yang lebih berbahaya:** pemeriksaan isolasi pada tabel LAIN tetap hijau selama kebocoran itu — jadi pemeriksaan jalur turun harus menyentuh SETIAP tabel, bukan satu sebagai wakil. **Penjaganya ada sejak F4:** `tests/kasir/sync-rules.test.js` membaca `sync-config.yaml` dan menuntut SETIAP query atas tabel ber-`tenant_id` menyaring tenant — daftar tabel ber-tenant diturunkan dari `db/migrations/*.sql`, bukan ditulis tangan. Yang TETAP tidak dijaga otomatis adalah stack yang berjalan: penjaga itu membaca berkas konfigurasi, bukan baris yang benar-benar mendarat di perangkat
- [ ] ⛔ **Menghapus/membangun ulang raw table lokal TIDAK memicu unduh ulang.** Checkpoint PowerSync hidup di tabel `ps_*`, terpisah dari tabel kami; `waitForFirstSync()` selesai dalam **0 ms dan melaporkan sukses** sementara katalog kosong permanen. Layar kasir kosong, sinkronisasi mengaku sehat. Setiap migrasi skema lokal yang menyentuh raw table **wajib** diikuti `disconnectAndClear()`, dan itu harus masuk prosedur migrasi klien — bukan diingat-ingat
- [ ] **Healthcheck container PowerSync HIJAU sementara replikasi GAGAL.** Saat publication belum ada, `/probes/liveness` tetap 200 dan Compose melaporkan `healthy`. Jangan pakai liveness sebagai sinyal kesiapan replikasi
- [x] ~~**`tax_rate.rate` turun sebagai `numeric` ke kolom `INTEGER` lokal — belum diperiksa.**~~ **Diuji 8 Agustus 2026, dan CACAT** (`prototypes/05-powersync-jalur-turun/FINDINGS.md` §5b). `put` yang disimpulkan PowerSync menyalin nilai apa adanya: `0.1100` mendarat sebagai `0.11`, bukan `1100` — 10.000× terlalu kecil — **dan tersimpan sebagai `real` di kolom yang dideklarasikan `INTEGER`**, tanpa satu pun error, karena affinity SQLite hanya mengubah nilai bila lossless. Diperbaiki dengan `put` yang ditulis sendiri: `CAST(ROUND(? * 10000) AS INTEGER)`. Diuji pada empat tarif termasuk 0,0001
- [ ] ⛔ **Aturan yang berlaku ke depan: setiap kolom yang tipenya BERBEDA antara PostgreSQL dan skema lokal wajib punya `put` raw table yang ditulis sendiri.** `put` yang disimpulkan hanya benar bila kedua sisi sepakat, dan ketidaksepakatannya **tidak memunculkan error** — kolomnya tetap terlihat `INTEGER` di skema dan `typeof` JavaScript tetap `number`. Hanya `typeof()` SQLite yang membedakannya. Yang belum ikut turun dan harus diperiksa dengan mata yang sama saat jalur turun diperluas: `item_variation.conversion_factor`, setiap `quantity` (×1000), dan `outlet.service_charge_rate` (×10000)
- [x] ~~**FR-H1 antrean upload belum dibangun.**~~ **Selesai 8 Agustus 2026** sebagai modul murni `packages/sync-client` (`docs/superpowers/plans/PLAN-fr-h1-outbox-relay.md`), 45 test. Enqueue dalam transaksi pemanggil, klasifikasi respons, backoff 2/4/8/16/32/60, batas 20 percobaan, dependensi lewat `depends_on`, pemulihan `sending` → `pending`, adapter REST di belakang port. Property test 1.000 item dengan **respons yang hilang setelah server memproses** — sabotase membuktikan gigi-nya: key per-percobaan → "penjualan ganda"; respons hilang dibaca gagal-permanen → 432/1.000 jadi `failed`
- [x] ~~**`packages/sync-client` BELUM tersambung ke apa pun.**~~ **Tersambung 8 Agustus 2026** (`docs/superpowers/plans/PLAN-pondasi-kasir.md`). Port `DbLokal` diisi `PowerSyncDatabase` sungguhan lewat `apps/kasir/src/lokal/adapter.ts`, dan **kecocokannya dibuktikan dengan menjalankan kode**: harness browser T8a–T8d menjalankan `enqueue` + `kirimBatch` di atas `writeTransaction` PowerSync, termasuk rollback sungguhan. Penjadwal (`buatPenjadwal`, interval 15 detik) ada dan diuji, tapi **belum dinyalakan di aplikasi** — lihat butir berikutnya
- [ ] **FR-H4 belum dibangun** (blokir logout / resync / hapus data / ganti outlet saat antrean tidak kosong). Ia butuh sesi dan tombol logout, yaitu Modul F. `spec-h:295` menuntut blokirnya "ditegakkan di lapisan domain, bukan hanya menyembunyikan tombol" — `ringkasanAntrean` sudah menyediakan angkanya, yang belum ada adalah operasi yang perlu diblokir
- [x] ~~**Token PowerSync harus dicetak server dengan kunci asimetris.**~~ **Selesai 8 Agustus 2026** — FR-F12 ditarik ke F2 (`docs/superpowers/plans/PLAN-fr-f12-token-perangkat.md`). `POST /devices/{id}/credentials`, `POST /devices/{id}/sync-token`, dan `GET /.well-known/jwks.json` hidup; RS256 lewat `node:crypto`, nol dependensi baru. **Yang belum: klien memakainya.** Belum ada yang menyimpan kredensial perangkat di sisi klien maupun memanggil `ps.connect()`
- [x] ~~**Aktor per-baris di outbox belum ada.**~~ **Selesai 8 Agustus 2026**: kolom `outbox_local.actor_id`, diisi saat enqueue dan dihormati `buatPengirimHttp`. Aktor konfigurasi hanya jadi cadangan, dan bentuknya `device:<kode>` supaya tidak terbaca sebagai orang. Sebelumnya: `buatPengirimHttp` menerima satu `actorId` saat dibuat, jadi antrean yang terkuras berjam-jam kemudian akan menisbatkan SELURUH item ke siapa pun yang sedang masuk saat itu — bukan ke kasir yang membuat tiap penjualan. Perbaikannya kolom `actor_id` di `outbox_local`, diisi saat enqueue. Belum dikerjakan karena belum ada sesi orang yang membuatnya dapat diuji ujung ke ujung
- [x] ~~**Tombol "Coba kirim sekarang" di K-14 nonaktif**~~ **Aktif 8 Agustus 2026** begitu perangkat dihubungkan; ia memicu penjadwal yang SAMA, bukan putaran kedua. Sebelumnya:, dengan alasan tertulis di layar. `buatPengirimHttp` menuntut baseUrl, tenantId, dan actorId; ketiganya lahir dari pendaftaran perangkat (Modul F). Ekspor darurat sengaja TETAP aktif — `spec-h:256` menyebutnya jaring pengaman terakhir
- [x] ~~**Penjadwal relay ADA tapi tidak dinyalakan.**~~ **Menyala 8 Agustus 2026** lewat `apps/kasir/src/sync/jalankan.ts`, begitu perangkat punya identitas lengkap. Sebelumnya: `buatPengirimHttp` menuntut `baseUrl`, `tenantId`, dan `actorId`; ketiganya lahir dari pendaftaran perangkat, yaitu Modul F. Menyalakannya sekarang berarti memukul endpoint tanpa identitas, 15 detik sekali, sepanjang hari. Yang perlu dilakukan saat Modul F ada: panggil `buatPenjadwal(...).mulai()` di `DbLokalProvider`, dan sambungkan pemicunya ke peristiwa `online` serta ke setiap penulisan lokal
- [x] ~~**PowerSync menyimpan database lokal di IndexedDB, BUKAN OPFS.**~~ **Diukur dan diputuskan 8 Agustus 2026: `OPFSWriteAheadVFS`, di-set eksplisit** (`PLAN-pondasi-kasir.md` §11.1). Default paket `IDBBatchAtomicVFS` ternyata yang **paling lambat, ~5,5×** — dan ia yang diam-diam berlaku selama prototipe 04 dan 05, jadi 12,33 ms serta perbandingan 3,8× itu adalah angka IndexedDB. Dua tab diuji terpisah di atas OPFS dan tetap aman. Harness melaporkan penyimpanan yang dipakai di setiap run
- [ ] **Angka prototipe 04 dan 05 perlu dibaca ulang dengan konteks VFS.** Keduanya berjalan di IndexedDB tanpa disadari. Kesimpulan "PowerSync 3,8× lebih lambat daripada driver mentah" karena itu **mencampur dua sebab** — lapisan PowerSync dan VFS yang lambat. Pengukuran baru (p50 4,5–5,1 ms lewat PowerSync di `OPFSWriteAheadVFS`, versus 3,25 ms driver mentah di prototipe 03) menyiratkan selisihnya jauh lebih kecil, tapi keduanya dari **run yang berbeda di mesin yang berbeda bebannya** dan tidak boleh dibandingkan langsung. Kalau angka itu penting, ia harus diukur ulang berdampingan
- [ ] ⛔ **`watch()` PowerSync ~1.000 ms untuk raw table** — diukur sembilan kali (997/1013/1004/1004/998 lewat `execute`; 1014/1001/1013/999 lewat `writeTransaction`), dan `throttleMs` tidak berpengaruh. `spec-h:224` menuntut indikator diperbarui **< 1 detik**. Mekanismenya **tidak berhasil ditemukan** di kode paket; yang mengikat angkanya. FR-H2 karena itu tidak boleh bersandar pada `watch()` sendirian — `buatPemberitahu()` mengirim isyarat baca-ulang dari jalur tulis kita. Yang belum diperiksa: apakah versi `@powersync/web` yang lebih baru mengubah angka ini
- [ ] **Test React ditunda, sengaja** (keputusan user §3.1 PLAN-pondasi-kasir). Seluruh logika ditulis sebagai modul murni yang diuji `node --test`; komponen React dijaga tipis dan **tidak ada satu pun test yang merendernya**. Yang menjaga "tipis" hanya disiplin. Keputusan ini **ditinjau ulang saat layar kasir sungguhan pertama** (K-03/K-06) dibangun — di sana ada logika yang tidak dapat dipindahkan keluar dari komponen
- [x] ~~**Interval relay 15 detik membuat tiga anak tangga backoff terbawah efektif jadi 15 detik.**~~ **Diperbaiki 8 Agustus 2026**: 15 detik kini BATAS ATAS, bukan denyut. Jeda berikutnya = waktu jatuh tempo terdekat menurut tangga `spec-h:62`, dipotong di 15 detik, lantai 250 ms. Batas atasnya tetap perlu untuk item yang tertahan dependensi — ia tidak punya waktu jatuh tempo sama sekali. **Reset backoff saat `online` DITOLAK**: spec tidak menyebutnya, dan perangkat yang baru tersambung akan menembakkan 50 item ke server yang mungkin belum pulih
- [ ] **`apps/kasir` tidak lagi memakai `AppShell`.** `AppShell` adalah kerangka back-office (sidebar + breadcrumb) dan IA §2.1 melarangnya di kasir: "Kasir tidak punya sidebar." Aplikasi kosong F0 memakainya karena belum ada layar sama sekali. Penggantinya `ShellKasir` + `apps/kasir/src/kasir.css` — dua kelas layout, token saja, untuk elemen yang design system memang tidak punya
- [x] ~~**Jalur naik belum diuji ujung-ke-ujung terhadap server sungguhan.**~~ **Diuji 8 Agustus 2026** — `tests/dst-server/relay-server.test.js` menjalankan `packages/sync-client` apa adanya (enqueue, kirimBatch, pulihkanSetelahMati, buatPengirimHttp) terhadap Fastify+PostgreSQL sungguhan, dengan cacat disuntikkan di lapisan transport. Satu-satunya tiruan yang tersisa adalah `fetch` di atas `app.inject`
- [ ] ⛔ **"Tepat sekali" untuk `order` TIDAK membuktikan idempotency key bekerja — dan itu ditemukan lewat sabotase.** Mengganti key setiap percobaan tidak menjatuhkan test order mana pun: `order` punya DUA lapisan (Idempotency-Key + PK `order.id` dari klien), dan duplikat tertangkap lapisan kedua sebagai `409 ID_ALREADY_EXISTS` yang dibaca relay sebagai berhasil. Menghitung baris `idempotency_key` juga tidak membedakan, karena klaim key berada di dalam transaksi yang sama dan ikut ter-rollback. **Yang menggigit hanya test `payment`** — satu-satunya entitas yang key-nya berdiri sendiri (PK-nya `(id, occurred_at)`, dan `occurred_at` dari jam database). Kalau kelak ada entitas baru yang key-nya sendirian, ia butuh test seperti itu; menyandarkan diri pada test order akan menyesatkan
- [ ] **Klaim "payload dikirim apa adanya" tidak teruji.** Mengganti `body: baris.payload` dengan `JSON.stringify(JSON.parse(...))` tidak menjatuhkan satu pun test, termasuk yang menembak server sungguhan — perjalanan bolak-balik JSON deterministik untuk bentuk payload kami. Dipertahankan sebagai pertahanan (V8 mengurutkan ulang kunci yang menyerupai integer saat parse), bukan sebagai sesuatu yang dijaga test. Dicatat juga di `http.ts`
- [ ] **`openShift` tidak menuntut `Idempotency-Key`** — tiga endpoint lain menuntutnya. Yang melindunginya hanya PK dari klien, dan relay membaca `409 ID_ALREADY_EXISTS` sebagai berhasil. Benar, tapi satu lapisan lebih sedikit (sejajar catatan `payment` di `CLAUDE.md`). Menambahkannya adalah perubahan server — **keputusan pemilik produk**
- [ ] **`cash_movement` berdiri sendiri (kas masuk/keluar, no-sale) tidak dapat naik.** `enqueue` menolaknya keras karena tidak ada endpoint Modul D untuknya. spec-h:46 menyebutnya sebagai `entity_type` yang sah, jadi spec dan kode berbeda di sini sampai endpoint itu ada
- [ ] ~~Kepemilikan DB: kekhawatiran performa~~ Diverifikasi 7 Agu 2026: `@powersync/web@2.1.1` bergantung pada `@journeyapps/wa-sqlite@2.0.1`, **bukan** `@sqlite.org/sqlite-wasm` yang dipakai prototipe 03. Ini bukan sekadar dua build WASM dalam satu bundle: pengukuran prototipe 03 membuktikan dua koneksi independen ke berkas OPFS yang sama **mustahil** (`NoModificationAllowedError`). Konsekuensinya salah satu harus MEMILIKI database lokal — PowerSync, atau kode kita. Angka 3,97 ms/penjualan yang terukur berlaku untuk `opfs-sahpool` di `@sqlite.org/sqlite-wasm`; bila PowerSync yang memiliki DB-nya, angka itu **harus diukur ulang** dengan VFS wa-sqlite. Keputusan pemilik produk — ia menyentuh stack yang terkunci
- [ ] **`navigator.storage.persist()` belum dipanggil, dan perilaku saat DITOLAK belum didefinisikan.** Terukur `persisted = false`: browser boleh menghapus OPFS saat ruang disk menipis, dan yang terhapus adalah antrean upload yang belum terkirim. Tidak ada spec yang menyebutkan ini
- [x] ~~**Pola satu-penulis (SharedWorker) belum dibangun.**~~ **Tidak perlu dibangun** — dibuktikan 7 Agustus 2026 (prototipe 04 §7): dengan `enableMultiTabs: true`, dua tab menulis bersamaan dan saling melihat barisnya, tempat prototipe 03 mendapat `NoModificationAllowedError`. Yang harus dipastikan tinggal satu: **`enableMultiTabs` di-set eksplisit**, tidak diandalkan pada default — dokumentasinya menyebut ia mati di Safari
- [ ] **Angka OPFS baru berlaku untuk desktop Chromium.** Android, iOS/Safari, dan perangkat kelas bawah belum diukur, dan butuh perangkat nyata — langkah manual, sejajar dengan verifikasi webhook Midtrans
- [ ] **I8 (higienis idempotency) tidak dapat menyala terhadap server ini.** Klaim key yang gagal ikut ter-rollback bersama transaksinya, jadi tabel `idempotency_key` tidak pernah membengkak — cacat `regen_idem_on_retry` yang menggembungkannya di prototipe tidak berlaku di sini. Perilaku itu **dipaku** assertion di `tests/dst-server/`, tapi aku **tidak berhasil menyusun sabotase yang mematahkannya** tanpa merestrukturisasi handler jadi dua transaksi. Ia benar, tapi belum terbukti dapat gagal.
- [ ] **DST server sungguhan hanya 3 seed × 12 langkah.** `tests/dst/` mengejar kedalaman ruang keadaan (gate 10.000 iterasi, tanpa I/O); `tests/dst-server/` mengejar ikatan ke implementasi dan karena itu jauh lebih dangkal — setiap langkah menyentuh PostgreSQL. Menaikkannya berarti menaikkan waktu CI, dan angkanya belum pernah ditimbang terhadap itu.
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
- [x] ~~Tambahkan clock skew + HLC ke harness DST — FR-H5 belum divalidasi sama sekali~~ **Selesai 8 Agustus 2026** (`docs/superpowers/plans/PLAN-fr-h5-hlc.md`). Tiap perangkat kini punya jamnya sendiri, saling geser mengelilingi ambang 5 menit `spec-h:173`, dan sesekali mundur (1 detik sampai satu hari). Server mengembalikan HLC tertingginya; perangkat menggabungkannya (`spec-h:157`). Dua invariant baru: **I9 urutan kausal** dan **I10 monotonisitas per perangkat**, plus dua mode cacat permanen (`hlc_dari_jam`, `abaikan_hlc_server`). Gate 10.000 iterasi tetap hijau setelah kelencengan ditambahkan
- [ ] **`spec-h:336` masih menandai "Urutan kausal — HLC menjaga urutan meskipun jam melenceng" sebagai *belum divalidasi prototipe*, dan daftar invariant H.5 belum memuat I9/I10.** Kodenya sudah, dokumennya belum — dan **penyuntingan `product/specs/` bukan kewenangan agent**
- [ ] **AC ketiga FR-H5 belum tertutup**: "Selisih jam > 5 menit menghasilkan audit event" menunjuk Modul F (FR-F8). Skew-nya sudah diinjeksikan di harness; yang belum ada adalah tempat audit event itu ditulis

## Validasi pasar — sebelum F2 dimulai

- [ ] Wawancara 10 merchant target: seberapa sering outage, dan apa yang mereka lakukan sekarang
- [ ] 30–50 percakapan penjualan dengan harga disebutkan (Rp349.000 / Rp699.000)
- [ ] Validasi ambang otorisasi ke 3 merchant

Asumsi terbesar yang belum diuji ada di [`product/PRD-lumi-pos-v1.md`](product/PRD-lumi-pos-v1.md) § 11.2. Kalau A1 (frekuensi outage) runtuh, posisi produk berubah — sebaiknya diuji **sebelum** F2, bukan sesudah.

## F2 tertutup, 14 Agustus 2026 — dan apa yang TIDAK ikut tertutup

Seluruh isi F2 di `ARCH:§14` ada, dan alur kasir berjalan penuh tanpa
jaringan. Gate-nya (`npm run test:dst`, 10.000 iterasi) hijau.

**Utang yang dibawa ke F3, semuanya keputusan sadar:**

| Utang | Kenapa belum |
|---|---|
| FR-H8 — notifikasi antrean menua | P1 |
| Enkripsi at-rest SQLite lokal | Butuh keystore OS lewat Tauri (F4). Sampai itu ada, siapa pun yang dapat membaca berkas database perangkat dapat menyamar jadi perangkat itu |
| ~~FR-F5 — `cost` tidak boleh sampai ke Kasir~~ | **Jalur turun ditutup 14 Agustus 2026.** Pertanyaan yang memblokirnya terjawab oleh kode, bukan tebakan: klien menulis `order_line.cost_at_sale = 0` dan SERVER menghitungnya lewat `getVariationSnapshot` — perangkat tidak pernah membutuhkan `cost`. Kolomnya dibuang dari skema lokal dan sync rules, dan `tests/kasir/sync-rules.test.js` menjaganya. **Sisanya menunggu Modul G**: penyaringan `cost`/margin di respons laporan, yang baru punya konsumen setelah laporan ada |
| K-16 buka laci · K-17 scanner | Belum digarap; keduanya kecil dan tidak memblokir apa pun |
| Modul C-3 rekonsiliasi & ekspor | P1 |
| Refund parsial dengan pemilihan baris di UI | `batalkan()` sudah menerima `lines`; yang belum ada layar pemilihnya. Sampai itu ada, refund mengirim `lines: []` — uang kembali tanpa barang kembali, dan layar MENYATAKANNYA |
| Percobaan hitungan tidak masuk `audit_event` terpisah | Riwayatnya tersimpan di `cash_drawer_shift.count_attempts` dan tampil di laporan. AC FR-D2 ketiga menyebut "audit"; ini pembacaan yang lebih sempit dan perlu dikonfirmasi |

**Batas yang harus dibaca sebelum menyebut F2 "aman":**

- ⛔ `X-Actor-Id` adalah atribusi yang **dijamin perangkat**, bukan identitas
  yang diverifikasi server. Konsekuensi offline-first, bukan kelalaian —
  order yang antre enam jam tidak dapat membawa sesi hidup. Yang menahan
  perangkat yang di-root adalah pencabutan token (FR-F12), bukan RBAC.
- ⛔ Kontrol FR-D2 ("angka terhitung tidak dikirim ke klien") **tidak dapat
  berlaku offline** — datanya sudah di perangkat. Yang berlaku adalah kontrol
  audit: setiap hitungan tercatat sebagai percobaan, dan riwayatnya tidak
  dapat ditimpa.
- Penguncian PIN memakai resolusi dual-layer yang disetujui user 11 Agustus
  2026, dan ia memperlambat penebakan — tidak menutupnya bagi orang yang
  sudah tahu satu PIN sah. Sesuai `spec-f:118`: PIN adalah atribusi.

---

## F3 tertutup, 15 Agustus 2026 — dan apa yang TIDAK ikut tertutup

Gate F3 (`ARCH:§14`) — *"buka toko → jual → tutup buku dengan angka konsisten
antar laporan"* — terpenuhi isinya. Buku kas menjadi sumber tunggal saldo laci,
satu fungsi mendefinisikan omzet untuk seluruh laporan, dan stok akhirnya
bergerak dua arah.

**Yang paling penting untuk dibaca pengganti saya:** F3 hampir seluruhnya
berisi perbaikan cacat di kode yang sudah lolos gate sebelumnya. Empat cacat,
semuanya di jalur uang atau stok, semuanya **tanpa satu pun error**, dan
semuanya di balik test hijau. Rinciannya ada di tabel `CLAUDE.md` § Status.

Yang menyatukan keempatnya: **test yang memeriksa keadaan yang tidak dapat
terjadi**. Fake diberi baris yang query sungguhannya tidak dapat hasilkan;
assertion menghitung nol untuk sesuatu yang tidak pernah ditulis; test menguji
pembuatan tarif alih-alih penerapannya. Coverage tidak melihatnya, review tidak
melihatnya. Yang melihatnya: membangun potongan berikutnya di atasnya.

**Utang yang dibawa ke F4, semuanya keputusan sadar:**

| Utang | Kenapa belum |
|---|---|
| ~~Endpoint REST `sold_out_flag` + relay~~ | **Ditutup 21 Agustus 2026** — `POST /inventory/sold-out`. Lihat § FR-E5 di bawah |
| Tekan-tahan kartu produk + penimpaan manajer (FR-E5) | Blokirnya sudah berlaku; jalur menandai dan menimpanya belum ada di layar |
| Notifikasi manajer untuk oversell (FR-E6) | `spec-e:195` menuntut "notifikasi, bukan hanya entri di laporan yang mungkin tidak dibuka". Eventnya sudah lengkap dan dapat diselidiki; yang belum ada jalur pemberitahuannya dan layar penyelesaiannya |
| ~~Opname (FR-E7)~~ | **Keputusan dibalik dan dikerjakan 16 Agustus 2026** (PR #43, B-14). Yang membuka blokirnya: pertanyaan `spec-e:343` ternyata tentang *kapan* delta dihitung, bukan tentang apakah opname perlu ada — dan jawabannya ada di spec, bukan pada merchant. Lihat § G1 |
| ~~Laporan back-office B-16/B-17~~ | **Berlayar.** Daftar layar yang sudah punya isi hidup di `LAYAR_SIAP` (`apps/backoffice/src/navigasi.ts`) dan dijaga test — bukan di berkas ini, yang akan basi |
| Laporan exception FR-G5 (8 laporan) · ringkasan owner FR-G6 · ekspor G.5 | Semuanya P1 |
| FR-F5 sisi laporan | Tertutup untuk perangkat: tidak ada field `cost`/`margin` di laporan mana pun, dan `Object.keys` diperiksa test. Penyaringan per-peran di respons SERVER menunggu laporan server ada |

**Batas yang harus dibaca sebelum menyebut F3 "aman":**

- ⛔ **K-13 belum pernah dilihat di layar sungguhan.** Ia hanya tercapai
  setelah buka shift, dan buka shift menuntut konfigurasi outlet yang turun
  lewat PowerSync. Aplikasinya dijalankan (boot bersih, nol error konsol,
  alur sampai layar Buka Shift benar) lalu berhenti di "Konfigurasi outlet
  belum sampai ke perangkat ini." Menyalakan stack itu menuntut Docker
  berjalan dan `wal_level = logical` — keduanya bukan kewenangan agent.
- ⛔ **Angka performa Modul E belum diukur ulang di perangkat target.**
  1,1 ms lewat snapshot datang dari `prototypes/01-sqlite-sizing`, bukan dari
  tablet. `spec-e:333` menuntut pengukuran ulang setelah prototipe Tauri
  (OQ-14).
- ⛔ **`allow_negative_stock = true` untuk F&B adalah `[ASUMSI]`.**
  `spec-e:341` menuntut validasi ke tiga merchant. Yang divalidasi NILAINYA;
  strukturnya sudah benar dan tidak menunggu apa pun.
- **Definisi "terlibat" di `OversellEvent`** — setiap penjualan sejak saldo
  terakhir kali masih positif — memenuhi contoh `spec-e:173-185` dan belum
  divalidasi terhadap pola nyata. Ia dapat memasukkan penjualan yang
  sebenarnya tidak bersaing bila stok lama sudah nol berhari-hari.
- `research/00` dan `research/03` masih menulis "Node.js 22+" sementara lantai
  sebenarnya 24.7. Penyuntingan dokumen riset bukan kewenangan agent.

---

## F4 — separuh tertutup, 15 Agustus 2026

⛔ **Gate F4 punya DUA bagian, dan hanya satu yang tertutup.** `ARCH:398`:
*"Cetak berhasil di ≥5 model; penjualan tetap tersimpan saat cetak gagal."*

Bagian kedua terbukti lewat test. Bagian pertama menuntut perangkat fisik.
**Jangan menandai F4 selesai sampai lima model benar-benar dicoba.**

Yang ada dan teruji: renderer ESC/POS, `ReceiptDocument` FR-C10 yang
mereproduksi contoh spec persis, `PeripheralPort` + adapter Noop, penegakan
invariant #3, K-15 uji cetak (dijalankan di layar), profil printer sebagai
data, dan cetak ulang FR-B11.

**Utang yang dibawa ke F5, semuanya keputusan sadar:**

| Utang | Kenapa belum |
|---|---|
| Adapter Network (TCP 9100), Tauri/Rust, WebUSB | `ARCH:235`: WebUSB gagal di Windows, jadi jalur universalnya Rust atau printer network. Keduanya menuntut shell Tauri, yang belum ada |
| ~~Tombol cetak ulang di K-09~~ | **Ditutup 21 Agustus 2026** — lihat § F4 antrean cetak di bawah |
| ~~Retry antrean `print_job`~~ | **Separuh ditutup 21 Agustus 2026** — antreannya kini benar-benar ditulis dan dapat dicoba ulang dari K-15. Penjadwal OTOMATIS sengaja belum ada: ia tidak dapat diamati sama sekali sampai adapter printer ada |
| Nama tarif pajak di cetak ulang | Baris pajak berbunyi "Pajak" tanpa nama tarif — meresolusinya menuntut query ke `tax_rate`, yang `spec-b:145` larang. **DIPUTUSKAN 15 Agustus 2026: denormalisasi di F5** — nama tarif disalin ke `order_line` saat checkout. Larangan query katalog tidak dilonggarkan; yang berubah adalah apa yang tersimpan sebagai snapshot. Struk adalah rekaman historis, dan snapshot-nya harus lengkap sejak ditulis |
| ~~Endpoint REST `sold_out_flag` + relay (dari F3)~~ | **Ditutup 21 Agustus 2026** — `POST /inventory/sold-out`, lihat § FR-E5 di bawah |
| Notifikasi manajer untuk oversell (dari F3) | `spec-e:195` menuntut lebih dari entri laporan. **Separuh tertutup di G1**: B-15 "Perlu diperiksa" memberi layar penyelesaiannya; yang belum ada jalur pemberitahuan aktifnya |
| ~~Laporan back-office B-16/B-17 (dari F3)~~ | **Berlayar sejak G1** — lihat § G1 di bawah |

**Batas yang harus dibaca sebelum menyebut F4 aman:**

- ⛔ **Tidak satu byte pun pernah sampai ke printer sungguhan.** Yang
  dibuktikan adalah byte yang KELUAR dari renderer. Codepage, perilaku
  pemotong, dan lebar sebenarnya per model belum diverifikasi sama sekali.
- ⛔ **Profil baseline adalah TEBAKAN yang masuk akal, bukan pengukuran.**
  58 mm → 32 karakter dan 80 mm → 48 karakter adalah angka yang lazim, dan
  `has_cutter: false` pada baseline 58 mm adalah tebakan ke arah aman.
  Model nyata dapat berbeda; itu sebabnya tabelnya diturunkan.
- **Transliterasi menutup sepuluh karakter** yang design system pakai.
  Karakter lain di luar ASCII tetap menjadi `?`. Nama produk beraksara non-
  Latin akan tercetak sebagai tanda tanya, dan itu belum pernah dibicarakan
  dengan merchant mana pun.
- **Uji cetak K-15 memakai `noopPeripheral`.** Ia membuktikan dokumen dan
  byte-nya terbentuk, bukan bahwa perangkat menjawab.

---

## G1 — back-office, milestone ditutup 16 Agustus 2026

`apps/backoffice` bukan lagi kerangka. Empat epik selesai dan ter-merge,
semuanya lewat PR ber-CI dan semuanya diverifikasi di browser terhadap
PostgreSQL sungguhan — bukan hanya lewat test.

| Epik | Layar | Status | PR |
|---|---|---|---|
| **Dasbor** | B-01 beranda | ✅ MERGED | #44 |
| **Penjualan** | B-02 riwayat · B-03 detail transaksi | ✅ MERGED | #34, #35, #36 |
| **Penjualan** | B-04 daftar shift · B-05 detail shift | ✅ MERGED | #41 |
| **Inventori** | B-12 stok · B-13 penyesuaian | ✅ MERGED | #38, #39, #40 |
| **Inventori** | B-14 opname · B-15 perlu diperiksa | ✅ MERGED | #42, #43 |
| **Pengawasan** | B-21 laporan exception (8 laporan) | ✅ MERGED | #32, #33 |

**Epik Inventori selesai 100%** — keempat layarnya ada, dan penjaga
`tests/backoffice/navigasi.test.js` menolak grup Inventori yang punya layar
tanpa isi. Penjaga yang sama kini berlaku untuk grup Ringkasan.

### B-01 sebagai beranda, dan kenapa itu penting

`Terlindungi` sudah memulai `aktif` di `'B-01'` sejak `apps/backoffice`
berdiri. Selama ini itu berarti layar **pertama** setiap pembukaan
back-office adalah "Dashboard belum dibangun" — keadaan kosong yang jujur di
menu mana pun, tapi di beranda ia terbaca sebagai aplikasi yang rusak, dan
yang membukanya pertama kali adalah merchant yang baru mendaftar tanpa
siapa pun untuk ditanyai.

`GET /reports/dashboard/summary` menutup itu **tanpa memperkenalkan satu pun
definisi angka baru**. Rinciannya di `CLAUDE.md` § G1.

### ⛔ Utang PostgreSQL yang dibersihkan (PR #45)

`Promise.all` atas **satu `PoolClient`** dihapus dari ketiga tempat yang
punya: `reporting/handlers/dasbor.ts` (Dasbor), `identity/handlers/users.ts`
(Identity), `reporting/index.ts` (Reporting).

`node-postgres` tidak memparalelkan query pada satu koneksi — ia
mengantrekannya — jadi polanya tidak pernah membeli apa pun. Yang didapat
hanya `DeprecationWarning: Calling client.query() when the client is already
executing a query`, perilaku yang **dihapus di pg@9**: silent break yang
menunggu upgrade. Terlihat di **log server saat E2E**, bukan di test —
ketiganya menjawab benar.

Alasan untuk tidak memparalelkannya dengan sungguh-sungguh ditulis sebagai
komentar di ketiga berkas: koneksi tambahan berarti transaksi tambahan, dan
`SET LOCAL app.tenant_id` berlaku per transaksi (invariant #8).

`grep 'Promise.all' apps/server/src/modules` kini menemukan 4 kemunculan,
**keempatnya di dalam komentar**.

### Utang yang dibawa keluar dari G1

| Utang | Kenapa belum |
|---|---|
| ~~Paginasi + pencarian sisi server untuk Katalog~~ | **Sisi SERVER ditutup 21 Agustus 2026** — `GET /items` menerima `q`, `limit`, `after`, dan N+1 varian dihapus. ⛔ **B-06 masih menyaring di klien**; lihat § katalog di bawah |
| Modul C-3 — rekonsiliasi & ekspor | P1, dan tidak berubah oleh G1 |
| Cron `POST /orders/cleanup-abandoned` | Endpointnya ada dan teruji; **sengaja tanpa tombol UI** (keputusan user) — ia dijalankan sebagai cron job dari luar aplikasi. Sampai cron itu dipasang, keranjang `open` yang ditinggalkan tetap mengunci stok |
| Notifikasi aktif untuk oversell | B-15 memberi layar penyelesaiannya; jalur pemberitahuannya belum ada |

### Batas yang harus dibaca sebelum menyebut G1 aman

- ⛔ **`stock_snapshot` diabaikan; stok dihitung `SUM(delta)`** (keputusan
  user). Benar dan konsisten dengan invariant, tapi biayanya tumbuh bersama
  jumlah `stock_movement` dan **belum diukur pada katalog besar**.
- ⛔ **Keranjang `open` yang ditinggalkan mengunci stok selamanya** sampai
  cron cleanup benar-benar dipasang. Endpointnya ada; penjadwalnya di luar
  repo ini.
- **Angka dasbor hanya mencakup perangkat yang sudah tersinkronisasi.**
  Layarnya menyatakan itu; yang belum ada adalah indikator seberapa jauh
  tertinggalnya.
- **Tidak satu pun komponen React di-render oleh test.** Keputusan §3.1
  `PLAN-pondasi-kasir` masih berlaku di back-office: seluruh logika hidup
  sebagai modul murni (`b01.ts`, `b16.ts`, `b12.ts`, …) yang diuji
  `node --test`, dan komponennya dijaga tipis oleh disiplin. Verifikasi
  layarnya dilakukan **di browser**, manual, dan tercatat di tiap PR.


---

## F5 — kenaikan paket self-serve, 21 Agustus 2026

Sampai sekarang **tidak ada satu pun cara mengubah `tenant.plan`**, sementara
pesan penolakan kuota berbunyi *"Naikkan paket atau kurangi … yang ada"* —
kalimat yang menunjuk ke jalan yang belum dibangun. Jalannya kini ada:

```
POST /tenants/subscription/invoices   → tagihan + QRIS
POST /tenants/subscription/invoices/{id}/check-status
POST /webhooks/midtrans               → notifikasi ber-prefiks `sub-`
GET  /tenants/subscription/invoices   → riwayat (B-29)
```

**Keputusan yang mengikat kode langganan:**

- ⛔ **Tagihan langganan TIDAK DAPAT masuk tabel `payment`, secara
  struktural.** Empat kolom NOT NULL (`order_id`, `outlet_id`, `device_id`,
  `check_id`) yang tagihan langganan tidak punya. Itu kabar baik: kalau
  keempatnya nullable, jalan termudah membuat **biaya langganan merchant
  muncul sebagai omzet kafenya sendiri** di `posisi-penjualan.ts` dan B-19.
- ⛔ **Prefiks `sub-` pada id yang dititipkan ke gateway.** Midtrans mengirim
  seluruh notifikasi ke satu URL dan **mengirim ulang yang tidak dijawab
  200**; tanpa prefiks, notifikasi langganan pertama dijawab
  `404 PAYMENT_NOT_FOUND` lalu diulang selamanya. Rutenya diputuskan dari
  string, sebelum satu query pun jalan.
- ⛔ **Paket naik HANYA lewat `terapkanStatusTagihan`, dan hanya setelah
  gateway mengonfirmasi** (`spec-c:320`). Fake provider selalu menjawab
  `pending` lebih dulu, jadi test yang lupa mengonfirmasi merah — bukan hijau
  karena kebetulan.
- ⛔ **Keempat kolom `tenant.max_*` ikut ditulis, bukan hanya `plan`.**
  `batasKuota` membaca kolomnya. Menaikkan `plan` saja menghasilkan merchant
  yang **membayar paket pro dan tetap ditolak pada kuota free** — tanpa satu
  pun error, dengan layar yang menyebut paket baru sambil menampilkan batas
  lama.
- **Port `SubscriptionProvider` adalah port KEDUA, bukan `PaymentProvider`
  yang dilonggarkan.** Pipa HTTP-nya (`createMidtransHttp`) dipakai ulang,
  termasuk `fetch` yang di-inject — nol test menyentuh jaringan.
- **DUA transaksi**, alasan yang sama persis dengan QRIS dinamis: tagihan
  di-commit sebelum gateway dipanggil, dan Idempotency-Key diselesaikan hanya
  bila gateway menjawab.
- **`periksaPerpindahanPaket` SENGAJA belum dipanggil di jalur mana pun.** Ia
  dibangun untuk penurunan paket, satu-satunya arah yang dapat melanggar
  kuota, dan penurunan belum punya endpoint. Yang membuat itu aman adalah
  property test `tests/domain/kenaikan-paket.test.js`: untuk setiap kenaikan
  yang diizinkan, pemakaian yang muat di paket asal selalu muat di tujuan —
  jadi merchant tidak pernah membayar lalu ditolak.

### ⛔ Batas yang harus dibaca sebelum menyebut F5 aman

- ⛔ **Membayar satu tagihan menaikkan paket SECARA PERMANEN.** Tidak ada
  periode tagihan di skema dan tidak ada penanganan langganan berakhir
  (keputusan user: di luar scope epik ini). Tidak ada apa pun yang menurunkan
  paket kembali.
- ⛔ **Turun paket tidak dapat dilakukan sendiri sama sekali** — dijawab
  `409 PLAN_NOT_AN_UPGRADE` dengan kalimat "hubungi tim Lumi". Jalur manualnya
  belum ada.
- ⛔ **`enterprise` tidak dapat dibeli** (`HARGA_PAKET.enterprise = null`).
  Ia negosiasi; harga angka untuknya berarti seseorang dapat membelinya
  sendiri dengan harga yang tidak pernah disepakati siapa pun.
- **Harga Rp349.000 / Rp699.000 per outlet per bulan tetap `[ASUMSI]`**
  (KEP-39: rekomendasi posisi kompetitif, bukan riset kemauan bayar). Belum
  divalidasi ke satu merchant pun.
- **B-29 belum menampilkan tombol upgrade.** Layarnya masih "pemakaian versus
  kuota" saja; ketiga endpoint di atas belum punya konsumen UI.
- **Jabat tangan sungguhan dengan Midtrans belum pernah terjadi** — batas yang
  sama dengan webhook pembayaran, dan alasannya sama (butuh URL publik).
- **Audit `subscription_plan_upgraded` dilewati bila peminta sudah
  dinonaktifkan.** `recordAuditEvent` melempar untuk aktor tidak aktif, dan di
  jalur webhook lemparan itu berarti Midtrans mengulang selamanya sementara
  kenaikan yang sudah dibayar tidak pernah mendarat. Catatan yang tidak pernah
  hilang adalah baris `subscription_invoice` sendiri.
- **Notifikasi langganan yang tagihannya tidak ditemukan dijawab 404**
  (`SUBSCRIPTION_INVOICE_NOT_FOUND`), sama seperti jalur payment. Midtrans akan
  mengulangnya; itu disengaja supaya keadaan itu terlihat, bukan tertelan —
  tapi ia belum punya alarm.

---

## FR-H8 — antrean menua, 21 Agustus 2026

Utang F2 yang paling lama tercatat. `spec-h:304`: *"Antrean yang tua berarti
uang merchant belum tercatat — metrik kesehatan #1."*

⛔ **Server TIDAK DAPAT melihat antrean yang menua, dan itu menentukan bentuk
fitur ini.** Antrean yang menua adalah penjualan yang **belum pernah sampai**
ke server — tidak ada baris untuk dihitung. Yang server lihat adalah perangkat
yang **berhenti menyapa** (`device.last_seen_at`).

Keduanya bukan hal yang sama, dan menyamakannya berbohong dua arah: perangkat
yang **mati** terlihat seperti antrean menua meski tidak ada penjualan
tertahan, dan perangkat yang **online tapi selalu ditolak** server terlihat
sehat. Karena itu keduanya dinamai berbeda di UI — "penjualan belum tercatat"
di kasir, "perangkat belum terhubung" di B-01 — dan hanya **ambangnya** yang
dibagi lewat `packages/domain/src/antrean-menua.ts` (pola `AMBANG_SELISIH`).

| Sisi | Sumber data | Layar |
|---|---|---|
| Kasir | `outbox_local` tertua yang belum terkirim | pita di `ShellKasir` |
| Owner | `device.last_seen_at` | kartu di B-01 |

**Keputusan yang mengikat kode:**

- ⛔ **Pita, bukan dialog, dan TANPA tombol tutup.** AC FR-H8 kedua menuliskan
  yang pertama sebagai aturan; yang kedua diturunkan darinya. Yang menutup
  pita adalah antrean yang terkuras — peringatan yang dapat ditutup akan
  ditutup, dan uang yang belum tercatat tidak berhenti belum tercatat karena
  kasir menekan silang.
- ⛔ **Detak satu menit di `PitaAntrean`.** Umur berubah karena WAKTU
  BERJALAN, bukan karena data berubah. Komponen yang menghitungnya saat render
  menyeberangi ambang 4 jam tanpa merender ulang, dan pitanya baru muncul saat
  ada penjualan berikutnya — tepat saat kasir sedang sibuk.
- ⛔ **Ambang `>=`, bukan `>`.** `spec-h:308` menulis "> 4 jam". Yang dipilih
  memperingatkan lebih dulu.
- **Ambang dikonfigurasi lewat `VITE_AMBANG_ANTREAN_JAM`** (`"4,24,72"`), satu
  variabel karena ketiganya hanya berarti bersama-sama. Apa pun yang cacat —
  termasuk tiga angka sah yang **tidak menaik** — jatuh ke bawaan secara utuh.
- ⛔ **Umur perangkat dihitung di DATABASE**, bukan di Node. Aturan repo yang
  lahir dari bug nyata (skew ±2 ms, 4 dari 12 run gagal).
- ⛔ **Perangkat tanpa kredensial tidak pernah dilaporkan menua.**

### ⛔ Batas yang harus dibaca sebelum menyebut FR-H8 selesai

- ⛔ **Tidak ada kanal notifikasi.** `spec-h:311` menulis "notifikasi ke
  owner"; yang ada adalah **keadaan layar**. Push, email, atau SMS adalah
  layanan baru dan biaya baru — keputusan pemilik produk, bukan agent.
- ⛔ **AC ketiga tidak dibangun** — "dashboard internal menampilkan merchant
  dengan antrean tua". Ia perkakas operasional **lintas-tenant**; 52 layar
  `IA` tidak memuatnya, dan query lintas-tenant menabrak invariant #8.
- **Pita kasir belum pernah dilihat di browser.** Logikanya teruji penuh dan
  `vite build` hijau; tampilannya menunggu perangkat ber-kredensial +
  PowerSync berjalan.


---

## FR-E5 — jalur naik penandaan habis, 21 Agustus 2026

`POST /inventory/sold-out`. Penandaan sudah berjalan di perangkat sejak F3 tapi
**lokal saja**; jalur turunnya sudah ada sejak F2 (`sold_out_flag` adalah raw
table yang direplikasi). Yang hilang hanya jalur naiknya — dan akibatnya
barista menandai kopi habis di terminal 1 sementara kasir di terminal 2 tetap
menerima pesanannya.

**Keputusan yang mengikat kode:**

- **Jalur PERANGKAT.** Ia di `RUTE_TERBUKA` bersama `/orders` dan `/shifts`:
  relay outbox tidak mengirim `Authorization` sama sekali.
- ⛔ **`ON CONFLICT (id) DO NOTHING`, bukan `DO UPDATE`.** Menimpanya berarti
  server menulis ulang penanda yang mungkin sudah kalah dari penanda perangkat
  lain yang tiba di antaranya — retry penanda lama menghidupkan kembali
  keadaan yang sudah dibatalkan.
- ⛔ **`entity_id` outbox adalah id BARIS penandaan, bukan variation.** Satu
  produk ditandai berkali-kali, dan `statusRecordBanyak` memakai aturan
  terburuk-menang per entitas.
- ⛔ **Satu transaksi di klien: penanda + `hlc_teks` + outbox.**
- **Server tidak menyimpulkan apa pun** — tidak menyentuh `stock_movement`
  (`spec-e:220`), dan siapa yang menang dijawab saat DIBACA.
- **`variation_id` dan `set_by` sama-sama tanpa FK.** Keduanya divalidasi lewat
  SELECT yang tunduk RLS; sabotase membuktikan penjaganya menyala.

**Batas:** belum ada layar kasir yang memanggil `tandaiHabis`. Modul dan jalur
naiknya lengkap dan teruji; tombolnya milik K-03/K-04.


---

## F4 — antrean cetak, 21 Agustus 2026

⛔ **Tabel `print_job` ada sejak F0 dan tidak pernah ditulis siapa pun.**
Skemanya bahkan memuat komentar yang menjelaskan kenapa `document` disimpan apa
adanya — untuk retry yang mencetak persis yang gagal. Tidak ada satu baris kode
pun yang mengisinya, jadi struk yang gagal dicetak hilang seketika.

**Keputusan yang mengikat kode:**

- **`cetakDanCatat` adalah satu-satunya pintu cetak** (`cetak/antrean.ts`),
  dipakai jalur penjualan dan cetak ulang. Jalur yang lupa mencatat adalah
  jalur yang struknya hilang saat gagal.
- ⛔ **`tanpa_printer` tidak menulis apa pun.** Merchant tanpa printer adalah
  kasus sah; menuliskan setiap penjualan sebagai job menghasilkan antrean yang
  tumbuh tanpa batas dan tidak pernah dapat terkuras.
- ⛔ **Retry mencetak dokumen yang TERSIMPAN**, bukan hasil render kedua
  (FR-B11: cetak ulang identik dengan cetakan pertama).
- ⛔ **`MAKS_PERCOBAAN_CETAK` = 5**, lalu berhenti dicoba otomatis — job yang
  dicoba tanpa batas akan mencetak struk kemarin saat printer akhirnya menyala.
  Barisnya **tetap tersimpan** dan masih dapat dicetak manual dari K-09.
- ⛔ **`peripheralAktif()` mengembalikan `null`, BUKAN `noopPeripheral()`.**
  Noop selalu "berhasil": dipakai di jalur penjualan, setiap struk dilaporkan
  "tercetak" kepada kasir sementara tidak ada satu byte pun yang meninggalkan
  perangkat. K-15 tetap memakai noop dengan sengaja — yang dibuktikannya adalah
  byte-nya terbentuk, dan layarnya menyatakan itu. **Saat adapter sungguhan
  lahir, yang berubah adalah satu baris di `cetak/aktif.ts`.**
- **Cetak ulang K-09 membangun ulang dokumen dari database**, bukan dari
  `print_job` — transaksi yang dicetak di perangkat lain tidak punya baris di
  sana sama sekali.

### ⛔ Batas

- **Tidak ada penjadwal otomatis.** Retry dipicu manual dari K-15; penjadwal
  yang berjalan sendiri tidak dapat diamati sampai adapter printer ada, dan
  `prosesAntreanCetak` adalah fungsi yang akan dipanggilnya.
- **Tidak satu byte pun pernah sampai ke printer sungguhan.** Gate F4 bagian
  pertama tetap terbuka; ia menuntut perangkat fisik.


---

## Katalog — paginasi & pencarian sisi server, 21 Agustus 2026

Sebelum ini `GET /items` mengembalikan **seluruh** item tenant dan menjalankan
satu query varian **per item**: katalog 5.000 produk = 5.001 query dalam satu
transaksi.

**Keputusan yang mengikat kode:**

- ⛔ **Tanpa `limit`, seluruh baris dikembalikan.** Bawaan yang memotong
  membuat klien N-1 menampilkan katalog terpotong tanpa satu pun error.
- ⛔ **Keyset atas `(sort_order, id)`**, bukan `sort_order` saja — `sort_order`
  DEFAULT 0 membuat seri menjadi keadaan normal, dan perbandingan satu kolom
  melompati sisa baris bernilai sama.
- ⛔ **Alasan keyset di sini BUKAN alasan riwayat.** Riwayat memakai keyset
  karena perangkat offline menyisipkan baris di tengah urutan; katalog memakai
  keyset karena `OFFSET n` memindai lalu membuang `n` baris. Konsekuensi:
  tidak dapat melompat ke halaman tertentu.
- ⛔ **Pencarian mencakup nama/SKU/barcode VARIAN**, bukan hanya nama item.
  `saringProduk` di B-06 sudah begitu sejak layar itu lahir; server yang tidak
  menyamainya membuat layar yang berpindah ke pencarian sisi server diam-diam
  berhenti menemukan barcode.
- ⛔ **`%` dan `_` di masukan di-escape.**
- **`ILIKE`, bukan full-text.** `[ASUMSI]`: sequential scan atas satu tenant
  cukup cepat — belum diukur. `pg_trgm` adalah jawaban bila kelak tidak cukup.
- **Kursor `sortOrder:id` tidak di-base64** — ia tidak membawa kewenangan;
  hasilnya tetap tunduk RLS.

### ⛔ Batas

**B-06 masih menyaring di klien.** Kemampuan servernya ada dan teruji; layarnya
belum memakainya. Berpindah menukar penyaringan seketika dengan perjalanan
pulang-pergi dan menuntut UX yang dirancang (debounce, keadaan memuat, kalimat
untuk katalog terpotong). **Menyetengahinya berbahaya**: memuat satu halaman
lalu tetap menyaring di klien menghasilkan pencarian yang hanya menemukan apa
yang kebetulan sudah dimuat.

`GET /categories` dan `GET /modifier-lists` belum menerima `q` — keduanya jauh
lebih kecil dan tidak punya kuota.


---

## F6 — runbook, observability & alat koreksi, 21 Agustus 2026

Gate F6 (`ARCH:400`): *"Runbook lengkap; alat koreksi ada **sebelum** insiden
pertama."* **Kedua bagiannya tertutup** sejauh yang dapat dibuktikan tanpa
deployment; yang tersisa terdaftar di § "Yang MASIH TERBUKA" di bawah.

### `docs/RUNBOOK.md`

Sebelas bagian, dipetakan dari kalimat yang merchant ucapkan ke prosedurnya.
Ditulis dari kode yang benar-benar ada.

⛔ **Runbook yang salah lebih berbahaya daripada yang tidak ada** — karena itu
`tests/domain/runbook.test.js` menuntut setiap kode error, environment
variable, endpoint, dan angka ambang yang runbook sebut benar-benar ada di
kode. Angka ambang **diimpor**, bukan diketik ulang.

### `GET /metrics`

Teks Prometheus, tanpa sesi, nol dependensi baru.

- ⛔ **Lima dari delapan metrik `ARCH:296` tidak dapat dihasilkan server ini.**
  Umur antrean dan item gagal sinkron hidup di perangkat; latensi keranjang,
  crash rate, dan rasio offline adalah klien. Kelimanya menuntut telemetri
  klien — yang kini **ada** (di bawah), dan mendarat di `device_telemetry`,
  bukan di `/metrics`. Test yang menolak nama-nama itu muncul di `/metrics`
  tetap berlaku: metrik bernama benar yang selalu nol lebih buruk daripada
  metrik yang tidak ada, dan `/metrics` masih tidak membaca satu tabel pun.
- ⛔ **Nol data merchant** (`ARCH:309`, batas etis). Agregasi lintas-tenant
  menuntut pembaca ber-`BYPASSRLS` — keputusan deployment, bukan kode.
- ⛔ **Label rute memakai POLA**, bukan URL mentah: kardinalitas yang meledak
  baru terlihat berminggu kemudian.
- ⛔ Ember histogram **milidetik bilangan bulat**. Ditulis sebagai detik, ia
  ditandai penjaga invariant #7 sebagai angka tarif pajak — dan penjaganya
  benar. Yang diperbaiki kodenya, bukan penjaganya.

### Alat koreksi: ekspor pemulihan + `tools/pulihkan-antrean.mjs`

Lubang yang ditutupnya: perangkat rusak, hilang, atau di-reset dengan penjualan
yang belum terkirim. Ekspor darurat K-14 hanya dapat **dibaca orang** — jalan
masuknya kembali ke server adalah mengetik ulang dari kertas.

K-14 kini punya tombol kedua, **"Ekspor pemulihan (JSON)"**
(`buatEksporPemulihan` di `packages/sync-client/src/status.ts`), dan alatnya
memutar ulang berkas itu lewat endpoint REST yang sama dengan relay outbox.
Prosedurnya di runbook §10.1.

- ⛔ **Tidak melanggar invariant #2.** Tidak ada `UPDATE`; yang dikirim adalah
  penjualan yang **belum pernah sampai**, dengan id aslinya. Server
  memperlakukannya seperti perangkat yang akhirnya online.
- ⛔ **Idempotency key ASLI, payload APA ADANYA.** Key yang di-generate ulang
  menghasilkan penjualan **ganda** pada setiap item yang sudah sampai; payload
  yang diurai lalu dirangkai ulang mengubah urutan kunci dan spasi, dan server
  mem-*hash* body untuk mendeteksi `IDEMPOTENCY_KEY_REUSED` — retry yang sah
  akan terbaca sebagai isi yang berubah.
- ⛔ **HANYA `ID_ALREADY_EXISTS` yang dihitung "sudah ada".** Versi pertama
  memperlakukan setiap 409 begitu, dan itu ditemukan **hanya** dengan
  menjalankannya terhadap server sungguhan: `POST /shifts` menjawab
  `409 SHIFT_ALREADY_OPEN` — perangkat punya shift LAIN yang terbuka — dan
  alatnya melaporkan keberhasilan yang tidak pernah terjadi. Sukses karena
  alasan yang salah adalah bentuk kegagalan terburuk untuk alat pemulihan:
  operator menutup insiden dengan penjualan yang masih hilang. Fake tidak
  dapat menghasilkan kode itu.
- **Aman dijalankan dua kali**, punya `--kering`, mengirim **berurutan**, dan
  memeriksa jenis entitas tanpa rute **sebelum satu permintaan pun dikirim**.
- Penjaga dua arah: setiap jenis di `RUTE_DIDUKUNG` wajib punya rute di alat,
  jadi jenis entitas baru tidak diam-diam kehilangan jalur pemulihannya. Dan
  setiap `tools/*.mjs` yang runbook sebut wajib ada di repo.

### Telemetri klien — 21 Agustus 2026

Rantainya: `catat()` → buffer `telemetry_local` → penjadwal →
`POST /devices/{id}/telemetry` → `device_telemetry` (migrasi `0029`) →
`GET /devices/{id}/telemetry`. Tujuh event, daftar TERTUTUP, semuanya angka.

- ⛔ **`ARCH:309` ditegakkan di TIGA lapisan, dan yang ketiga membaca KODE.**
  Daftar tertutup + nilai wajib angka menjaga datanya; yang tidak dijaga
  keduanya adalah slot `tipe` — ia memang string, dan string apa pun lolos.
  `tests/kasir/telemetri-batas-etis.test.js` memindai setiap pemanggilan
  `catat()` dan menolak `.message`, template literal, dan properti selain
  `.name`.
- ⛔ **`VITE_TELEMETRY` yang tidak diset berarti `off`.** `ARCH:262` tetap
  berlaku — yang menetapkan `full` adalah konfigurasi deployment SaaS, bukan
  ketiadaannya. On-premise yang lupa menyetelnya tidak boleh MENGUMPULKAN
  tanpa persetujuan; SaaS yang lupa hanya menghasilkan metrik kosong, dan
  kosong itu terlihat.
- ⛔ **`mode === 'off'` tidak memasang apa pun** — bukan sink yang membuang.
- ⛔ **Koersi AJV mengubah `null` menjadi `0`** sebelum handler melihatnya,
  dan `typeof === 'number'` tidak melihat apa pun. Yang menangkapnya
  aritmetika: `total` wajib ada di `[min × count, max × count]`. Ditemukan
  lewat test, bukan review.
- ⛔ **Percobaan ulang mengirim BATCH yang SAMA**, kunci idempotensi
  diturunkan dari daftar id. Batch yang melebar di antara dua percobaan
  menghitung ganda bila yang pertama sebenarnya sampai.
- ⛔ **`401` dipertahankan, `400` dibuang.** Metrik dari masa perangkat tidak
  terhubung justru yang menjelaskan kenapa ia tidak terhubung.
- ⛔ **Pemangkasan buffer membuang yang TERLAMA**, dan jaminan itu hidup di
  `ORDER BY` — jadi diuji di atas SQLite sungguhan, bukan fake.
- **Utang yang ditemukan sambil jalan:** migrasi lokal tidak pernah membuat
  tabel murni-lokal yang BARU (sidik jari skema hanya menghitung raw table).
  Diperbaiki `rencanaBuatLokalHilang`; tanpa itu setiap tabel lokal baru
  adalah `no such table` di setiap perangkat yang sudah terpasang.

### Staged rollout — 21 Agustus 2026

Aturannya di `packages/domain/src/rilis.ts`, keadaannya di `app_release`
(migrasi `0030`), keputusannya lewat `GET /devices/{id}/update`.

⛔ **Yang ADA adalah keputusan, bukan pemasangan.** Mengunduh dan memasang
versi menuntut shell Tauri — utang F4. Jangan menandai "staged rollout"
selesai sebagai fitur merchant sampai updater itu ada; yang selesai adalah
separuh yang tidak menuntut perangkat keras.

- ⛔ **Kohort per MERCHANT dan wajib SUBSET** (5% ⊂ 25% ⊂ 100%). Merchant yang
  keluar dari cakupan saat tahap naik harus turun versi, dan rollback skema
  lokal "hampir mustahil" (KEP-36). Diuji sebagai property atas 2.000 tenant.
- ⛔ **Kanari adalah pilihan (`tenant.is_canary`), bukan undian.**
- ⛔ **Jendela boleh melewati tengah malam**; `mulai = selesai` adalah jendela
  KOSONG dan ditolak CHECK constraint, bukan ditafsirkan 24 jam penuh.
- ⛔ **Belum-giliran mendahului wajib-segera.** Yang menaikkan tahap adalah
  orang, bukan tingkat kegentingan rilis.
- ⛔ **Penundaan per VERSI**, maksimal 2×; jatah habis membuat update wajib,
  bukan batal.
- ⛔ **Gate crash rate menahan saat datanya belum ada**, dan angkanya diketik
  operator: agregasi lintas-tenant menuntut pembaca ber-`BYPASSRLS`. Angka
  yang dipakai disimpan di `app_release.gate_crash_*` — kalau tahap ternyata
  dinaikkan atas angka yang salah, angkanya masih ada untuk dibaca.
- **Tidak ada endpoint menaikkan tahap.** Seluruh peran di `spec-f` adalah
  peran merchant; endpoint operator menuntut otentikasi staf yang tidak ada di
  sistem ini. `tools/naikkan-tahap.mjs` memakai kredensial database.

### ⛔ Yang MASIH TERBUKA di F6

| Bagian | Keadaan |
|---|---|
| Updater perangkat (Tauri) | Belum ada — separuh kedua staged rollout |
| Feature flag & kill switch per merchant | `ARCH:358` menyebutnya "kebutuhan operasional, bukan kemewahan". Belum ada |
| Metrik lintas-tenant | Menunggu keputusan deployment (pembaca ber-`BYPASSRLS`) |
| Koreksi langganan | Menurunkan paket, membatalkan tagihan yang terlanjur dibuat — runbook §10 mendaftarnya sebagai yang belum ada |

---

## Modul C-3 — rekonsiliasi & ekspor rekapitulasi, 21 Agustus 2026

FR-C12 dan FR-C13, keduanya P1, dan sisa terakhir Modul C. `IA:§3.3` menamai
B-19 "Laporan Pembayaran **& Rekonsiliasi**" sejak awal; sampai sekarang kata
kedua itu tidak punya kode di baliknya.

### FR-C12 — perkiraan potongan MDR

Masalahnya (`spec-c:422`): kasir mencatat QRIS Rp 100.000, rekening menerima
Rp 99.300, dan tanpa satu baris pun yang menjelaskan selisihnya merchant
menyimpulkan POS-nya salah — atau kasirnya mencuri.

- **`packages/domain/src/mdr.ts`** — tarif `spec-c:426` sebagai `bigint`
  berskala 10.000 (0,3% → `30n`). ⛔ **Ini BUKAN pajak** dan tidak boleh
  tersesat ke `tax.ts`: ia biaya jasa akuisisi, tidak masuk `order.tax_amount`,
  tidak muncul di struk, tidak mengubah satu pun angka di `order`.
- ⛔ **`null` BERBEDA dari `0`.** `0` = diperkirakan tidak ada potongan (UMI di
  bawah ambang Rp 500.000); `null` = metode itu tidak punya perkiraan sama
  sekali. Kartu EDC masuk yang kedua — tarifnya per-acquirer dan `spec-c` tidak
  memberikan satu pun angkanya. "Rp 0" untuk kartu adalah pernyataan yang
  SALAH, bukan sekadar kosong; layar dan CSV menampilkan tanda hubung / sel
  kosong.
- ⛔ **`<=` pada ambang UMI**, bukan `<`. `spec-c:427` menulis "≤ Rp 500.000",
  dan `<` memotong transaksi tepat 500.000 — nilai bulat yang paling sering
  terjadi.
- ⛔ **`payment.mdr_estimated` adalah SNAPSHOT**, ditulis di transaksi
  pembayaran. Menghitungnya ulang saat laporan dibuat membuat dua ekspor untuk
  periode yang sama berbeda begitu kategori atau tarif regulator berubah, dan
  yang kedua akan dibaca sebagai koreksi meski tidak ada transaksi yang
  berubah. **Konsekuensinya dinyatakan**: memperbaiki kategori yang salah
  tidak mengubah baris lama (runbook §5.5).
- **`tenant.merchant_category`** (migrasi `0028`), bawaan **`umi`** —
  `[ASUMSI]`, belum divalidasi ke merchant. Yang membuat bawaan salah tidak
  berbahaya: seluruh angka turunannya berlabel PERKIRAAN dan tidak satu pun
  masuk `order`, struk, atau omzet. Disetel di B-29 lewat
  `PATCH /tenants/settings` (`billing`, owner-only).

### FR-C13 — rekapitulasi penjualan

`GET /reports/recap` + `GET /reports/export?type=recap`.

- ⛔ **Angka kepalanya dari `rekapPenjualan`**, yang memanggil
  `posisiPenjualan`. AC FR-C13 kedua menuntut totalnya cocok dengan laporan
  penjualan; memakai fungsi yang sama membuat itu benar menurut KONSTRUKSI.
  Testnya `assert.deepEqual` terhadap respons `GET /reports/sales`, bukan
  terhadap angka tulisan tangan.
- ⛔ **Rincian per metode DIPANGGIL dari `ambilPembayaran`, bukan disalin.**
  Query kedua akan menyimpang pada tiga aturan sekaligus: hanya `confirmed`,
  order berpembatal dikeluarkan, dan `null` yang dibedakan dari `0`.
- ⛔ **Pajak dipisah dari SNAPSHOT** `order_line.tax_rate_name` (0022) dan
  `order_line.tax_jurisdiction` (0028), bukan JOIN ke `tax_rate`. Tarif yang
  di-rename setelah pelaporan tidak boleh mengubah rekapitulasi periode yang
  sudah dilaporkan. Baris lama dikelompokkan "(tidak tercatat)" — jujur.
- **Periode dan tanggal dibuat ADA DI DALAM berkas** (AC ketiga). Nama berkas
  hilang begitu seseorang menyimpannya ulang. `dibuatPada` dari jam
  **database**, tidak pernah `new Date()` di Node.
- **Bentuk PANJANG** (`bagian,keterangan,rincian,nilai`), bukan satu baris
  lebar: kolom pajak dinamis akan membuat berkas dua periode punya jumlah
  kolom berbeda, dan akuntan yang menumpuknya mendapat kolom yang bergeser.

### ⛔ Batas yang harus dibaca sebelum menyebut C-3 selesai

| Batas | Keadaan |
|---|---|
| `totalDiskonOrder` dan `totalServiceCharge` | **Selalu nol hari ini.** `POST /orders` menulis nol ke `order.order_discount` dan `order.service_charge_amount`; diskon tingkat order belum ada di jalur itu. Keduanya tetap dilaporkan karena `spec-c:444` menyebutnya dan skemanya sudah ada. ⛔ Test integrasi untuk keduanya akan hijau karena HAMPA — aturannya diuji di `tests/domain/posisi-penjualan.test.js` |
| MDR kartu EDC | Tidak ada perkiraan. `spec-c` tidak memberikan tarifnya, dan menebak satu tarif untuk semua acquirer menghasilkan perkiraan yang salah dengan percaya diri |
| Tarif MDR | `[FAKTA]` per 15 Maret 2025 (`spec-c:424`). Ditetapkan regulator dan **dapat berubah**; satu-satunya tempat yang perlu disunting `packages/domain/src/mdr.ts` |
| XLSX | **Tidak dibuat.** `spec-c:444` menulis "CSV + XLSX"; XLSX menuntut dependensi baru, dan CSV terbuka apa adanya di Excel dan Google Sheets. Batas yang dinyatakan, bukan kelalaian |
| `order_line.tax_jurisdiction` di perangkat | **Sengaja tidak turun.** Menambah kolom raw table mengubah sidik jari skema lokal, dan itu menuntut `disconnectAndClear()` + unduh ulang katalog di setiap perangkat — biaya nyata untuk kolom yang tidak satu pun layar kasir baca |
| Kategori merchant bawaan `umi` | `[ASUMSI]`, belum divalidasi ke merchant |

### Penjaga baru

- **`tests/oxlint-ds-adherence/kelas-tipografi.test.js`** — setiap kelas `t-*`
  yang dipakai aplikasi harus ADA di `/ds-bundle`. Lahir dari cacat nyata:
  `t-body-lg` ditulis di B-19 dan tidak ada di `tokens/typography.css`. Kelas
  yang tidak cocok apa pun tidak menghasilkan error — teksnya dirender pada
  ukuran warisan, dan hasilnya terlihat *hampir* benar. Lint dan typecheck
  tidak tahu apa pun tentang nama kelas CSS di dalam string.

---

## FR-B7 — refund parsial dengan pemilihan baris, 21 Agustus 2026

Utang F2 terakhir yang menyentuh jalur uang. `spec-b:237` menuntutnya sejak
awal; sampai sekarang K-10 selalu mengirim `lines: []`.

### Keputusan yang mengikat kode

- ⛔ **Nilai refund BUKAN jumlah `order_line.line_total`.** `line_total` belum
  kena pajak eksklusif sementara `order.total` sudah — menjumlahkannya
  mengembalikan uang **lebih sedikit** daripada yang pelanggan bayar, dan
  salahnya diam. Untuk pajak inklusif ia justru sudah termasuk; tidak ada satu
  rumus penjumlahan yang benar untuk keduanya.

  Yang dipakai: `allocateProportionally(order.total, line_total[])`
  (`packages/domain/src/pilihan-refund.ts`). Memilih seluruh baris
  mengembalikan **tepat** `order.total` — diuji sebagai **property**, bukan
  contoh, dan sabotase yang menggantinya dengan penjumlahan `line_total`
  menghasilkan 3 merah.

- ⛔ **Batas per baris diturunkan per VARIASI, bukan per baris.** Itu aturan
  server (`planRestock` → `RESTOCK_EXCEEDS_SOLD`), ditiru persis:
  `stock_movement` tidak menyimpan `line_id`, jadi kebenaran per baris tidak
  ada di mana pun. Yang dijamin adalah jumlahnya per variasi tidak melebihi
  yang server izinkan. Dua baris dapat menunjuk variasi yang sama — modifier
  memisahkan baris, stoknya satu.

- **Ditegakkan di KLIEN juga.** Kalau hanya server yang memeriksanya, kasir
  baru tahu berjam-jam kemudian saat antrean terkuras.

- ⛔ **Pilihan bermula KOSONG.** `lines: []` sah — pelanggan yang kopinya
  tumpah tidak mengembalikan kopinya. Memulai penuh membuat restock menjadi
  bawaan diam-diam.

- **Barang dan uang tetap dua keputusan.** Tombol "Sesuai barang" menyalin
  nilai ke nominal alih-alih mengunci keduanya.

### ⛔ Kosakata `stock_movement.type` yang berbeda antara klien dan server

Klien menulis `void_return`/`refund_return`; `0010_inventory.sql` punya
`CHECK (type IN ('sale','void','refund',…))` yang **menolak keduanya**.

Ia tidak pernah gagal karena baris `stock_movement` klien murni lokal, dan
skema lokal tidak punya CHECK. Yang membuatnya berbahaya: `stock_movement`
**sudah** terdaftar sebagai raw table — hari ia masuk sync rules, dua kosakata
untuk satu peristiwa menjadi laporan yang menghitung sebagian pengembalian dan
melewatkan sisanya, tanpa satu pun error.

Disamakan ke kosakata server, dan dijaga
`tests/kasir/kosakata-stock-movement.test.js` (membaca CHECK constraint dari
migrasi, bukan dari daftar tulis tangan).

### Modul domain baru

| Modul | Isi | Kenapa dibagi |
|---|---|---|
| `packages/domain/src/alokasi.ts` | `allocateProportionally`, diangkat dari `tax.ts` | Dua salinan = dua aturan pembulatan sisa |
| `packages/domain/src/pilihan-refund.ts` | `sisaPerBaris` · `periksaPilihan` · `nilaiRefundBaris` | Klien dan server harus menjawab sama, atau kasir menjanjikan angka yang lalu ditolak |
| `packages/domain/src/kuantitas.ts` | `tampilkanKuantitas`, diangkat dari handler laporan | Layar kasir menulis `quantityMilli / 1000` — float, kelas `0.30000000000000004` |

### ⛔ Batas yang harus dibaca

| Batas | Keadaan |
|---|---|
| Picker di alur perangkat sungguhan | **Belum dijalankan** (login → shift → jual → refund parsial). Menuntut PowerSync tersambung dan katalog tersinkron |
| Bentuk SQL baru | **Sudah** diverifikasi di browser: harness T14, `SUM(...) WHERE type IN (...) GROUP BY` di atas wa-sqlite + OPFS |
| Sisa per baris | **Perkiraan yang aman**, bukan kebenaran per baris — `stock_movement` tidak menyimpan `line_id`. Pengembalian sebelumnya dibagi baris-pertama-lebih-dulu, deterministik dan sama di klien dan server |
| Baris ber-`type` lama (`refund_return`) di perangkat yang sudah ada | Dibiarkan. Tidak ada yang membacanya, dan `UPDATE` massal pada jejak stok bukan koreksi yang sah |

---

## K-16 no-sale (FR-D7) dan K-17 scanner, 21 Agustus 2026

Dua utang F2 terakhir yang tidak menuntut perangkat keras.

### K-16 — no-sale

`POST /shifts/{shiftId}/no-sale` + `apps/kasir/src/kasir/no-sale.ts` +
`DialogNoSale`. Tanpa migrasi: `audit_event.event_type` adalah `text` bebas.

- ⛔ **Yang dicatat adalah PERINTAH sistem, bukan bukti laci terbuka.**
  `spec-d:231`: sinyalnya satu arah — sistem tidak tahu apakah laci
  benar-benar terbuka, dan tidak dapat mendeteksi laci yang dibuka manual
  dengan kunci. AC FR-D7 kelima menuntut ini **dinyatakan ke merchant**; ia
  ada di layar K-16, di runbook §8.4, dan di kontrak endpoint.
- ⛔ **Ambang dari `audit_event`, bukan kolom hitungan.** Kolom hitungan
  adalah angka kedua yang harus dijaga sepakat dengan jejaknya; yang
  menyimpang di antaranya tidak dapat diputuskan. Diuji dengan menyisipkan
  baris audit langsung — ambangnya ikut bergerak.
- ⛔ **Pembukaan KEEMPAT yang menuntut PIN** (`spec-d:239`), bukan ketiga.
  `AMBANG_NO_SALE = 3` berarti **tiga yang bebas**. Sabotase `>=` → `>`
  menghasilkan merah di kedua sisi.
- ⛔ **TIDAK menulis `cash_movement`.** No-sale tidak memindahkan uang.
- **Catatan ditulis meski laci gagal dibuka**, dan `laciTerbuka` dikembalikan
  ke layar. v1 belum punya printer sama sekali; "laci tidak terbuka" adalah
  keadaan NORMAL, dan kontrol yang tersisa adalah catatannya.

**⛔ RBAC-nya di `DIKECUALIKAN`, bukan `PETA_PERAN`.** Setiap entri
`PETA_PERAN` diuji MENOLAK kasir, sementara kasir justru BOLEH membuka laci
(`IA:66`, "Kasir + alasan"). Yang menjaganya:
`assertBoleh(shift_open_close)` di handler — menutup akuntan (`spec-f:82`) —
plus ambang frekuensi. Keduanya diuji.

### K-17 — scanner

`packages/domain/src/pemindai.ts` (heuristik, murni, waktu di-inject) +
`usePemindaiGlobal` + `cariBarcode`.

- ⛔ **Heuristik, bukan kepastian.** Tidak ada cara membedakan scanner dari
  keyboard di web. Salah dua arah pasti terjadi, dan keduanya dibuat tidak
  berbahaya; yang tidak boleh terjadi — scan yang menambahkan produk salah —
  dijaga oleh pencocokan barcode PERSIS dan penolakan barcode ganda.
- ⛔ **`cariBarcode` ≠ `cariItem`.** Pencarian menyaring daftar untuk dilihat;
  scan memutuskan SATU produk tanpa kasir melihat apa pun.
- ⛔ **Listener global TIDAK menangkap ketukan di `<input>`/`<textarea>`.**
  PIN diketik cepat dan diakhiri Enter — bentuk yang persis sama dengan scan.

### ⛔ Batas yang harus dibaca

| Batas | Keadaan |
|---|---|
| Perintah fisik ke laci | **Belum ada.** `peripheralAktif()` mengembalikan `null` di v1; laci di-kick lewat printer. Layar menyatakannya apa adanya |
| `JEDA_MAKS_MS = 50` | `[ASUMSI]` — belum diukur terhadap scanner sungguhan. `research/07` menyebut < 30 ms; angka di sini lebih longgar untuk Bluetooth. Menunggu OQ-14 |
| Scanner 2D untuk QRIS | Tidak didukung. `research/07` §4 menyebutnya alur berbeda (POS memindai pelanggan) yang harus diputuskan tersendiri |
| Deteksi pembukaan manual | **Mustahil**, permanen. Sinyalnya satu arah |

---

## B-06 memakai pencarian sisi server, 21 Agustus 2026

Menutup batas yang dinyatakan bersama paginasi katalog: kemampuan servernya
ada dan teruji, layarnya belum memakainya.

- ⛔ **Seluruh saringan dikirim ke server** — `q`, `categoryId`,
  `includeArchived`. Memuat satu halaman lalu menyaring di klien menghasilkan
  pencarian yang hanya menemukan apa yang **kebetulan sudah dimuat**: merchant
  mengetik barcode produk ke-300, tidak ada yang muncul, tanpa satu pun error.
- ⛔ **`saringProduk` DIHAPUS.** Dua tempat yang memutuskan "produk mana yang
  cocok" akan menyimpang. Aturannya dipindah, bukan hilang; testnya kini di
  `tests/catalog/items-paginasi.test.js`.
- ⛔ **Server mendapat saringan `category_id IS NULL`.** Tanpa itu,
  `categoryId=__tanpa__` mengembalikan **nol produk** alih-alih produk tanpa
  kategori — dan nol terlihat persis seperti "memang tidak ada". Kelas regresi
  yang sama dengan barcode, ditemukan dengan cara yang sama: membaca kode
  klien sebelum menggantinya.
- **Konstanta `TANPA_KATEGORI` diangkat ke
  `packages/domain/src/katalog-saringan.ts`.** Ia dikirim sebagai query string
  dan dibaca sebagai cabang `WHERE`; dua salinan yang menyimpang tidak
  menghasilkan error.
- **Jeda ketik 300 ms**, dan `q` yang dikirim terpisah dari yang diketik:
  urutan kembalinya respons tidak dijamin, jadi hasil untuk "kop" dapat
  mendarat sesudah "kopi susu" dan menimpanya.
- **Katalog terpotong dinyatakan**, beserta kalimat bahwa pencariannya
  mencakup seluruh katalog — bukan hanya yang tampil.

### ⛔ Batas

| Batas | Keadaan |
|---|---|
| Ukuran halaman 50 | `[ASUMSI]`. Server membatasi `limit` ke 200 (`BATAS_MAKS_ITEM`) |
| B-10 Harga | Masih memuat `/items` tanpa paginasi. Layar itu memilih varian untuk diberi harga per outlet; ia akan terpotong pada katalog besar dengan cara yang sama, dan belum diperbaiki |
| Verifikasi browser | **Belum dijalankan** untuk alur pencarian + muat-lebih-banyak |

---

## FR-B8 di layar kasir — K-03 diskon + K-11 (22 Agustus 2026)

Task 16 menutup server dan domain; FR-B8 tetap **tidak dapat dicapai
merchant** sampai ini — satu-satunya jalan memberi diskon adalah memanggil
REST langsung. Yang ditambahkan: `DialogDiskon` (K-03) yang merantai ke
`DialogOtorisasi` (K-11), baris diskon di keranjang dan layar bayar, dan
baris diskon **di struk**.

### ⛔ Persetujuan berlaku untuk ANGKA, bukan untuk persentase

Cacat yang ditemukan saat menulis alurnya, bukan dari spec. Manajer menyetujui
30% dari Rp 100.000 — Rp 30.000 — lalu kasir menambahkan barang senilai
Rp 900.000 dan potongannya menjadi Rp 300.000 dengan persetujuan yang sama.
Persetujuan yang menempel pada persen adalah cek kosong yang ditandatangani di
depan antrean.

`DiskonKeranjang.nominalDisetujui` membekukan angka yang penyetuju lihat.
Potongan yang **tumbuh** melewatinya menuntut persetujuan baru; yang
**mengecil** tidak — meminta PIN untuk potongan yang lebih kecil hanya melatih
manajer mengetik tanpa membaca. `approverId` tanpa `nominalDisetujui` tidak
menutup apa pun: satu field yang hilang tidak boleh mematikan aturannya
diam-diam.

### ⛔ Struk sempat mencetak Diskon nol

`penjualan.ts` memaku `diskon: 0` ke `bangunDokumenStruk`. `computeOrderTotals`
**tidak** mengurangi `subtotal`, jadi struk mencetak Subtotal 20.000 lalu TOTAL
20.900 dengan potongan Rp 1.000 yang tidak muncul di mana pun — selisih yang
tidak dapat dijelaskan pelanggan mana pun, dan keluhan yang berakhir di kasir.

### Yang tidak dibangun, dan kenapa

| Batas | Keadaan |
|---|---|
| Diskon per BARIS | `spec-b:267` menyebutnya dan `order_line.discount_amount` ada di skema, tapi `POST /orders` hanya menerima diskon tingkat order. Membangun setengahnya di klien menghasilkan angka yang tidak dapat dikirim ke mana pun |
| Verifikasi browser | **Belum dijalankan.** Seluruh alur diuji lewat `node --test` di atas fake `DbLokal` dan `node:sqlite`; dialog dan rantai ke K-11 belum dijalankan di browser sungguhan |
| Angka ambang | Tetap `[ASUMSI]` — `spec-b:462` menuntut validasi tiga merchant untuk NILAINYA. Yang tidak dapat diubah adalah keberadaan ambangnya |

### ⛔ Lubang pemindai yang ikut ditemukan

Pemindai global dimatikan saat dialog terbuka. Kolom teksnya memang sudah
diabaikan `usePemindaiGlobal`, tapi fokus yang berada di **radio button** tidak
— dan scan di sana menambahkan produk ke keranjang **di belakang dialog**,
perubahan yang tidak terlihat siapa pun sampai struk tercetak. `DialogNoSale`
punya lubang yang sama dan ikut ditutup.

---

## FR-A3 — aturan pemilihan modifier di kasir (22 Agustus 2026)

`max_selections` dan `allow_duplicate` ada di skema sejak F0, turun ke
perangkat, dan dibaca `bacaModifier` — lalu **diabaikan**. Kasir dapat memilih
enam topping pada list bermaksimal tiga; pesanannya tersimpan, barista tidak
dapat membuatnya, dan tidak ada satu pun error di jalan.

Aturannya kini di `packages/domain/src/modifier-pilihan.ts` sebagai fungsi
murni, dan `DialogModifier.tsx` hanya bentuk layarnya.

### ⛔ Batas menghitung UNIT, bukan baris — `[ASUMSI]`

`spec-a:120` menulis batasnya sebagai "pilihan ke-4 dinonaktifkan" dan tidak
menyatakan apa pun tentang interaksinya dengan `allow_duplicate`. Yang dipakai:
`Extra Shot ×2` dihitung **dua**, karena pelanggan membayarnya dan barista
membuatnya. Menghitung baris saja membuat `max_selections = 3` meloloskan enam
shot lewat tiga baris ber-qty 2.

### ⛔ Snapshot modifier lokal BERBEDA bentuk dari snapshot server

Klien menulis `[{nama, qtyMilli}]`; server menulis
`[{id, modifierId, name, price, quantityMilli}]`. Keduanya mengisi kolom yang
sama (`order_line.modifier_snapshot`).

Tidak berbahaya **hari ini**: `order_line` tidak ada di sync rules jalur turun,
jadi baris server tidak pernah mendarat di perangkat. Ia menjadi berbahaya pada
hari `order_line` masuk ke sana — `uraikanModifier` akan membaca `name` sebagai
`undefined` dan menampilkan "undefined" di layar riwayat. Kelas yang sama
dengan `tax_rate.rate`: bentuk yang berbeda antara dua sisi, tanpa satu pun
error yang menunjukkannya.

### Yang tidak dibangun

| Batas | Keadaan |
|---|---|
| Penegakan di server | `POST /orders` menerima modifier apa adanya. Menegakkannya menuntut server membaca `modifier_list` pada setiap penjualan, dan aturannya dapat berubah setelah order antre offline berjam-jam |
| Verifikasi browser | **Belum dijalankan** untuk stepper `allow_duplicate` dan pilihan yang dinonaktifkan |

---

## K-06 QRIS statis + EDC (22 Agustus 2026)

Server menerima keempat metode sejak Modul C sub-project 2. Yang tidak ada
adalah jalan bagi **kasir** memakainya — `MetodeBayar` di klien secara harfiah
`'cash'`. Merchant yang pelanggannya membayar QRIS harus mencatatnya sebagai
tunai, dan saldo laci lalu berbohong sebesar seluruh omzet QRIS.

### ⛔ Cacat yang ikut lahir bila non-tunai menyentuh laci

Bentuknya PERSIS sama dengan yang F3 temukan pada refund tunai, arahnya
terbalik: `cash_movement` untuk QRIS membuat saldo laci naik pada penjualan
yang tidak memindahkan satu lembar pun, dan tutup kas lalu menuntut otorisasi
manajer untuk selisih yang tidak pernah ada. Klien dan server sama-sama
menulisnya hanya untuk `cash`, dan ada test relay yang membuktikan keduanya
sepakat.

### Yang masih terbuka di Modul C

| Batas | Kenapa |
|---|---|
| **QRIS dinamis di kasir** | Menuntut gateway menjawab sebelum lunas (`spec-c:320`), jadi ordernya harus sudah ada di server — sementara jalur penjualan perangkat menulis lokal lebih dulu lalu me-relay. Ia menuntut jalur penjualan **online-first** yang belum ada, dan itu keputusan arsitektur, bukan penambahan layar |
| **FR-C3** | "Nonaktifkan metode online saat offline" menuntut metode online ADA lebih dulu. Ketiga metode yang kini ada semuanya berfungsi tanpa jaringan |
| **Pembayaran campuran** | Satu penjualan = satu payment di jalur perangkat. Server sudah mengembalikan `outstanding`; layarnya belum memakainya |
| Verifikasi browser | **Belum dijalankan** untuk pemilih metode dan kedua form |

---

## Pembayaran campuran di perangkat (FR-C1, 22 Agustus 2026)

### ⛔ Urutan kedatangan bagian pembayaran adalah bagian dari kebenarannya

Server menghitung nominal pembayaran tunai dari `total − SUM(payment
confirmed)` lalu **membulatkannya** (`spec-c:181`). Konsekuensinya: bagian
tunai yang mendarat sebelum bagian non-tunai menagih **seluruh total**, menutup
ordernya, dan membuat bagian berikutnya ditolak — untuk penjualan yang
sempurna, hanya karena urutan kedatangannya.

Urutan antar-baris `outbox_local` tidak dijamin apa pun kecuali `depends_on`,
jadi perangkat menyusun rantainya sendiri: seluruh bagian non-tunai lebih dulu,
tunai terakhir, masing-masing bergantung pada yang sebelumnya. Ada test yang
membalik urutannya terhadap server sungguhan dan membuktikan penolakannya —
serta membuktikan uangnya berpisah: laci menerima seluruh total sementara
pelanggan membayar sebagian lewat QRIS.

### ⛔ Kemunculan KETIGA cacat "laci menerima uang yang tidak pernah masuk"

1. F3: saldo laci dihitung dari `payment`, bukan `cash_movement`.
2. K-06 non-tunai: `cash_movement` ditulis untuk QRIS.
3. Pembayaran campuran: `delta` memakai `amount_due`, yang memuat bagian bank.

Ketiganya menghasilkan gejala yang sama — tutup kas menuntut otorisasi manajer
untuk selisih yang tidak pernah ada — dan tidak satu pun menghasilkan error.

### Yang tidak dibangun

| Batas | Kenapa |
|---|---|
| Order `open` parsial di perangkat | Penjualan ditulis hanya saat LUNAS. Order `open` yang tidak pernah dibayar akan muncul di laporan dan belum punya jalan penutupan (KEP-21) |
| Lebih dari satu bagian tunai | Uang tunai tidak punya identitas yang membedakan; dua baris membuat "berapa kembaliannya" punya lebih dari satu jawaban yang sama benarnya |
| Verifikasi browser | **Belum dijalankan** untuk daftar bagian dan sisa tagihan |

---

## FR-H4 dan kill switch (23 Agustus 2026)

### FR-H4 — blokir operasi destruktif

Dari empat operasi `spec-h:274`, hanya **logout** yang benar-benar diblokir.
Layar Perangkat menerima perubahan `tenantId`/`outletId`/`deviceId` tanpa
memeriksa antrean sama sekali.

⛔ **Yang TIDAK diblokir adalah bagian terpenting aturannya.** Alamat server
dan kredensial perangkat tidak pernah diblokir — keduanya adalah jalan
**memperbaiki** antrean yang macet, dan memblokirnya mengunci merchant di
dalam keadaan itu selamanya. `deviceCode` juga lolos.

**Pelajaran metodologis:** versi pertama menaruh blokirnya di dalam komponen
React, dijaga penjaga yang memindai kode. Sabotase membuktikan penjaga itu
**lolos** ketika pemanggilnya dihapus dan import-nya tertinggal. Pemeriksaan
yang dapat dipalsukan oleh satu baris import bukan pemeriksaan — aturannya
dipindah ke `perangkat/simpan-identitas.ts` supaya dapat dijalankan test, dan
penjaganya diubah jadi "hanya ADA SATU penulis `device_config`".

**Belum ada jalurnya:** `resync` dan `hapus_data` tidak punya tombol di mana
pun. Aturannya sudah ada dan diuji; ada penjaga yang menandai bila keduanya
mulai punya pemanggil. `uninstall` tidak dapat dicegah aplikasi mana pun
(`spec-h:280`); mitigasinya — ekspor darurat — sudah ada di K-14.

### Kill switch — batas yang dinyatakan

| Batas | Keadaan |
|---|---|
| Perangkat yang **belum pernah** terhubung | Memakai bawaan kode, yaitu MENYALA. Kill switch tidak dapat mendahului perangkat yang tidak pernah menyegarkan. Runbook §13.5 |
| Jeda sampai berlaku | Boot + tiap 15 menit. Bukan langsung, dan tidak ada jalur push |
| Cakupan | Tiga fitur (`pembayaran_qris_statis`, `diskon_kasir`, `buka_laci_no_sale`). Menambah fitur keempat menuntut baris di `packages/domain/src/fitur.ts` dan pembacaannya di layar yang bersangkutan |
| Verifikasi browser | **Belum dijalankan** untuk tombol yang hilang saat fitur dimatikan |

---

## FR-G5 — tujuh dari delapan laporan exception (23 Agustus 2026)

X1 sudah ada sejak B-21. X8 ditutup bersama FR-F8. X2, X3, X4, X5, dan X7
ditutup di sini. **X6 tidak dapat dibangun** — lihat di bawah.

### ⛔ X6: keranjang tidak meninggalkan jejak

`spec-g:162`: *"item yang ditambah lalu dihapus berkali-kali pada satu order —
manipulasi keranjang sebelum pembayaran"*.

Keranjang K-03 hidup di `apps/kasir/src/kasir/simpanan.ts`, **di memori
saja**. Ia tidak pernah ditulis ke SQLite lokal, tidak pernah masuk
`outbox_local`, tidak pernah dikirim. Penambahan dan penghapusan sebelum
pembayaran karena itu tidak meninggalkan jejak di tabel mana pun, audit mana
pun, atau metrik mana pun.

Dua jalan yang mungkin, keduanya keputusan yang lebih besar daripada satu
laporan:

| Jalan | Konsekuensinya |
|---|---|
| Persistensi keranjang (KEP-21) | Order `open` yang tidak pernah dibayar muncul di laporan dan belum punya jalan penutupan. Skema sudah menyiapkannya (`order.status = 'open'` + `owned_by_device_id`); yang belum ada adalah jalan penutupannya |
| Telemetri peristiwa keranjang | `ARCH:309` melarang telemetri memuat nama produk, dan X6 menuntut TEPAT itu untuk berguna — "produk mana yang berulang dibatalkan" |

Jangan menandai FR-G5 selesai penuh sampai salah satunya diputuskan.

### Batas lain

| Batas | Keadaan |
|---|---|
| X7 memakai `closed_by` | Shift yang ditutup manajer atas nama kasir ternisbat ke manajer. Itu benar untuk "siapa yang menghitung", dan mungkin bukan yang owner cari |
| Verifikasi browser | **Belum dijalankan** — layarnya ada dan ter-build, tapi belum dibuka terhadap data sungguhan |

### Layar B-21 menampung kedelapan laporan (23 Agustus 2026)

`IA:200` menamainya "Laporan Exception (8 laporan)". Yang dibangun satu layar
dengan penyeleksi tab, bukan delapan entri menu — `IA:173` menjelaskan kenapa
PENGAWASAN dipisah dari LAPORAN sama sekali, dan memecahnya delapan
mengembalikan masalah yang pemisahan itu selesaikan.

Daftar laporan hidup sebagai DATA di
`apps/backoffice/src/pengawasan/b21-daftar.ts` (judul, deskripsi, endpoint,
kunci baris, catatan kaki, kosakata keadaan kosong). Penjaga bahasa menuduh
membaca data itu, bukan berkasnya — laporan kesembilan yang lahir kelak
diperiksa tanpa siapa pun mengingat penjaganya ada.

X6 tetap punya tabnya, dan tabnya menampilkan alasan di atas untuk **setiap**
keadaan layar. Menghilangkannya membuat merchant yang membaca spec
menyimpulkan laporannya rusak, atau bahwa ia salah mencari.

⛔ **Utang yang tersisa dari layar ini:** `pesanKeadaan` lama dihapus dari
`b21.ts` dan diganti `pesanLaporan` yang menerima definisi laporan. Kalau
laporan berikutnya ditambahkan, ia WAJIB punya `kosong.{judul,benda,simpul}` —
tanpanya keadaan kosongnya berbunyi "Tidak ada  yang tercatat" dan kalimat
sinkronisasinya kehilangan penutup. Ada test yang menuntutnya untuk setiap
laporan ber-endpoint.

---

## B-22 Audit & Aktivitas, dan lubang FR-F6 (23 Agustus 2026)

`GET /audit-events` + layar B-22. Rantainya: `audit_event` → `reporting/handlers/audit.ts`
→ `apps/backoffice/src/pengawasan/{b22.ts,Audit.tsx}`.

### ⛔ FR-F6 BELUM tertutup, dan jaraknya sekarang terukur

AC pertamanya: *"Setiap event dalam daftar menghasilkan record."* Saat
ditemukan, **24 dari 35** nama di tabel `spec-f:288` belum dipancarkan sama
sekali. Ditutup 23 Agustus 2026 dalam dua putaran — katalog/harga/stok/pajak,
lalu sesi/shift/perangkat/ekspor. **9 tersisa, dan tidak satu pun punya
endpoint hari ini:**

| Kelompok | Yang belum ada | Kenapa |
|---|---|---|
| Shift | `shift_count_attempt` | Server hanya mencatat percobaan hitungan yang **berhasil** menutup shift. Yang ditolak dilempar SEBELUM `UPDATE` dan ikut ter-rollback — dan percobaan yang gagal itulah yang `spec-d` ingin buktikan tidak dapat diulang diam-diam. Menuntut jalur tulis yang bertahan melewati rollback: perubahan rancangan |
| Identitas | `user_role_changed` | **Tidak ada endpointnya.** `updateUser` hanya menerima `name`/`email`/`isActive`; peran hanya dapat diberikan saat `createUser`. Merchant tidak dapat menaikkan kasir menjadi manajer outlet sama sekali — gap PRODUK, bukan gap audit |
| Kas | `cash_paid_in` · `cash_paid_out` | Setoran/penarikan kas di luar penjualan belum dibangun |
| Konfigurasi | `threshold_changed` | B-26 (Ambang Otorisasi) belum ada |
| Konfigurasi | `vertical_profile_changed` | B-24 (Profil Vertikal) belum ada |
| Perangkat | `peripheral_configured` | `printer_profile` belum punya endpoint mutasi |
| Data | `support_session_started` · `support_session_ended` | Akses support belum dibangun |

**Jangan menandai FR-F6 selesai sampai daftar ini kosong.** Ia tidak perlu
diingat: `PERISTIWA_BELUM_DIPANCARKAN` di `packages/domain/src/audit-peristiwa.ts`
**diturunkan** dari selisih daftar spec dan daftar kode, ikut di respons
endpoint, dan disebutkan di layar B-22. Menambah pemanggilan `recordAuditEvent`
untuk salah satunya memangkasnya sendiri.

### Apa yang mengikat kode

- ⛔ **`recordAuditEvent` menerima `PeristiwaAudit`, bukan `string`.** Nama baru
  wajib didaftarkan di domain lebih dulu; typecheck yang menahannya. Sabotase
  membuktikannya: `'shift_closed'` diubah jadi `'shift_ditutup'` → typecheck
  merah dengan seluruh daftar sah tercetak.
- ⛔ **Ejaan kode dibekukan, ejaan spec dipetakan.** `order.voided` vs
  `order_voided`. Baris lama ada di database merchant dan tidak dapat ditulis
  ulang (invariant #2).
- ⛔ **Keyset `(occurred_at, id)`, perbandingan baris utuh.** Beberapa baris
  audit pada timestamp identik adalah keadaan normal.
- ⛔ **Kelompok `tenant` adalah `[ASUMSI]`** — tabel `spec-f:288` tidak
  punya kelompok untuk pendaftaran merchant, pembuatan outlet, dan perubahan
  paket. Kelompoknya ditambahkan alih-alih peristiwanya diselundupkan ke
  kelompok yang salah.
- ⛔ **RBAC `report_exception` untuk B-22 adalah `[ASUMSI]`** yang mengubah
  keputusan sebelumnya (`navigasi.ts` mencatat bahwa B-22 sengaja tidak punya
  operasi). Alasannya di `reporting/index.ts`. Kalau merchant pertama
  memutuskan lain, yang berubah satu baris di `navigasi.ts` dan satu
  `assertBoleh`.

### Batas yang dinyatakan

| Batas | Keadaan |
|---|---|
| `before`/`after` | Tidak dikembalikan sama sekali (FR-F5). Detail perubahan punya layarnya sendiri — B-03 untuk transaksi, B-13 untuk stok |
| Saringan pelaku | Endpoint menerima `actor_user_id`, layar belum menyediakan pemilihnya (butuh daftar pengguna) |
| Ekspor | Tidak ada. `data_exported` sendiri belum dipancarkan |
| Verifikasi browser | **Belum dijalankan** — layarnya ter-build, belum dibuka terhadap data sungguhan |

### Mutasi katalog/harga/stok/pajak menulis audit (23 Agustus 2026)

Satu pembungkus, `catatPerubahanServer` di modul `audit`: tanpa perangkat,
tanpa penyetuju, tanpa alasan, `hlc: 0n`. Dua belas endpoint memakainya.

⛔ **Kalau kamu menambah endpoint mutasi katalog/konfigurasi baru, panggil
`catatPerubahanServer` di dalam transaksinya.** Tidak ada penjaga struktural
yang menahan yang lupa — `PERISTIWA_BELUM_DIPANCARKAN` hanya melihat daftar
spec, dan endpoint baru yang bukan bagian dari daftar itu tidak muncul di mana
pun. Yang ada adalah `tests/server/audit-perubahan.test.js`, yang memanggil
endpoint sungguhan lewat `app.inject` dan membaca `audit_event` dari database;
tambahkan satu test di sana untuk setiap endpoint baru.

⛔ **Assertion `audit_event` di test lama sekarang WAJIB menyaring
`event_type`.** Sepuluh assertion di `tests/ordering/` menghitung seluruh baris
tabel, dan nol adalah jawaban benar karena alasan yang salah — sampai katalog
mulai menulis audit dan setup test-nya sendiri menghasilkan baris. Bentuk yang
sama dengan 18 test `stock_movement` yang F3 temukan.

### Sesi, shift, perangkat, dan ekspor menulis audit (23 Agustus 2026)

`login` · `logout` · `shift_opened` · `cash_variance_approved` ·
`device_provisioned` · `device_revoked` · `data_exported`.

⛔ **`shift_opened` sama sekali tidak ada sebelum ini** — pasangannya
(`shift_closed`) sudah punya sejak F3, sementara `cash/handlers/shifts.ts` tidak
menyentuh `recordAuditEvent`.

⛔ **`data_exported` ditulis pada endpoint GET.** Satu-satunya PEMBACAAN di
seluruh sistem yang meninggalkan jejak, dan itu disengaja: ekspor tidak
mengubah apa pun, yang berubah adalah di mana datanya berada. Yang dicatat
lingkupnya (jenis, rentang, outlet), tidak pernah isinya.

⛔ **Batas yang dinyatakan: tidak ada `login_failed`.**
`audit_event.actor_user_id` adalah `NOT NULL` ber-FK ke `"user"`, dan login
gagal sering memakai email yang tidak menunjuk siapa pun. `spec-f:290` sendiri
tidak memuatnya. Kalau kelak dibutuhkan, ia menuntut kolom aktor yang boleh
NULL — perubahan skema.
