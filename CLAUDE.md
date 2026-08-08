# Lumi POS — Memori Proyek

Point-of-sale untuk kafe takeaway **2–20 outlet di Indonesia**. Nilai jualnya: tetap berfungsi penuh tanpa internet — termasuk buka shift, refund, dan tutup kas — dengan batas kemampuan yang **tertulis eksplisit**, bukan ditemukan merchant saat outage.

Bahasa dokumen dan antarmuka: **Indonesia**. Istilah teknis tetap Inggris.

---

## ⛔ Delapan invariant — tidak dapat dinegosiasikan

Pelanggaran = cacat, bukan preferensi gaya. Tolak di review.

1. **Satu penjualan = satu transaksi database.** Order + line + modifier + payment + stock movement + cash movement + audit event + outbox + idempotency key, semuanya dalam satu transaksi. Tidak pernah dipecah jadi event asinkron.
2. **Transaksi selesai tidak pernah di-`UPDATE`.** Void dan refund adalah record baru. Katalog tidak pernah di-`DELETE`, hanya `archived_at`.
3. **Simpan sebelum cetak, selalu.** Cetak dan buka laci adalah efek samping yang boleh gagal. Struk bisa dicetak ulang; penjualan yang hilang tidak bisa dipulihkan.
4. **Tidak ada akses database lintas modul.** Modul berkomunikasi hanya lewat `index.ts` publik. Kepemilikan tabel ada di `product/ARCH-lumi-pos-v1.md` § 3.
5. **Tidak ada `if (isOnPrem)` di kode aplikasi.** Perbedaan lingkungan hanya lewat environment variable.
6. **Tidak ada `if (vertical === 'fnb')` di luar lapisan yang membaca `VerticalProfile`.**
7. **Tidak ada angka pajak di luar `TaxCalculator`.** Kemunculan `0.11`, `* 0.1`, `10%` di jalur perhitungan mana pun adalah cacat arsitektur.
8. **Aplikasi connect ke PostgreSQL sebagai user yang tunduk RLS.** Bukan superuser, bukan owner tabel. `FORCE ROW LEVEL SECURITY` aktif. `app.tenant_id` di-`SET LOCAL` **per transaksi**, bukan per koneksi.

---

## Stack — terkunci, bukan untuk diperdebatkan

| Lapisan | Pilihan |
|---|---|
| Backend | Node.js 22+ · TypeScript · **Fastify** |
| API | **REST + OpenAPI spec-first** (bukan tRPC — klien POS tidak bisa dipaksa update) |
| Database | **PostgreSQL 17+** · RLS · queue via `SKIP LOCKED` (**tanpa Redis di v1**) |
| Frontend | **React 19 + Vite (SPA)** — terkunci oleh `/ds-bundle` |
| Styling | **CSS custom properties + `components.css`** apa adanya. Tailwind hanya utilitas layout, **tanpa nilai arbitrer** |
| Desktop | **Tauri 2** (bukan Electron) |
| DB lokal | **SQLite** — WASM+OPFS di web, native di Tauri |
| Sync | **Hybrid**: PowerSync Open Edition untuk jalur turun · outbox lokal + REST idempoten untuk jalur naik |
| Auth | Buatan sendiri, modul terisolasi (alur POS tidak dilayani IAM generik) |

Alasan tiap pilihan ada di `research/03-TECH-STACK-EVALUATION.md`. **Jangan mengusulkan alternatif kecuali diminta.**

---

## Konvensi data

| Hal | Aturan |
|---|---|
| **Uang** | `bigint` rupiah utuh. **Tidak pernah float.** Design system menetapkan tanpa desimal |
| **Kuantitas** | `INTEGER ×1000`. `0.5 kg` → `500`. **Terbukti lewat pengukuran**: `REAL` membuat `WHERE stok = 0` gagal diam-diam |
| **ID** | ULID/UUIDv7 **di-generate klien**. Auto-increment mustahil untuk penulisan offline |
| **Waktu** | `occurred_at` (device) + `recorded_at` (server) + `hlc`. Simpan UTC, tampilkan zona outlet |
| **Tanggal bisnis** | Berakhir saat **tutup shift**, bukan tengah malam. Default `04:00` |
| **Stok** | `SUM(stock_movement.delta)`. **Tidak ada kolom `quantity`** |
| **Enum** | `text` + CHECK constraint, bukan integer |
| **Nomor struk** | `K1-20260726-0007` — prefiks device + tanggal + urutan. Counter **lokal**, tidak pernah minta ke server |
| **Tenant** | Setiap tabel punya `tenant_id` + kebijakan RLS untuk keempat operasi |
| **Larangan** | Tidak ada kolom untuk PAN, CVV, PIN kartu, data track. Selamanya |

---

## Aturan design system — `/ds-bundle` final, jangan diubah

1. Tepat **4 ukuran teks**: 32/20/15/12. KDS membesar lewat `--scale`, bukan token baru.
2. Satu aksen teal `#0D5C63`, < 5% area, **satu aksi utama per layar**.
3. Target sentuh ≥ **44px**; aksi menyangkut uang **56px**.
4. Angka uang selalu `tabular-nums` (kelas `.num`).
5. Status **tidak pernah warna saja** — selalu ada teks.
6. Semua styling lewat token; **tidak ada nilai warna/ukuran hardcoded** di komponen.
7. Bahasa Indonesia. Setiap komponen punya keadaan **kosong** dan **error**.
8. Tanpa emoji, tanpa gambar/gradien/tekstur, tanpa dark mode.
9. Tanpa onboarding in-app, tanpa wizard, tanpa tooltip.

`_adherence.oxlintrc.json` dari `/ds-bundle` **wajib masuk CI sejak commit pertama**.

Format Indonesia: `Rp 1.847.000` (titik ribuan, tanpa desimal) · `− Rp 8.000` · `11%` · `14:32` · `26 Jul 2026` · `2×`

---

## ⛔ Jangan bangun ini

Coding agent cenderung "membantu" dengan membangun hal yang tidak diminta. Daftar lengkap beserta alasan ada di `product/PRD-lumi-pos-v1.md` § 4.

**Ditunda ke v1.1+:** KDS · table management · berbagi order antar device saat offline · paket on-premise · UI vertikal retail · resep/BOM · purchasing · loyalty · promo lanjutan · transfer stok antar outlet · integrasi GoFood/GrabFood/ShopeeFood · integrasi EDC (ECR) · timbangan · customer display · mobile native · integrasi API Coretax.

**Tidak akan pernah dibangun:** pemrosesan data kartu di dalam POS · pembayaran QRIS saat offline (mustahil secara teknis) · **pencegahan** oversell saat offline (konsekuensi CAP — yang dibangun adalah deteksi & pelaporan) · dukungan Firefox untuk aplikasi kasir (OPFS).

---

## Definition of Done — fitur yang menyentuh uang

- [ ] Invariant finansial diuji sebagai **property**, bukan hanya contoh
- [ ] Perilaku offline didefinisikan dan diuji, termasuk perangkat mati di tengah operasi
- [ ] Idempotensi diuji dengan retry berulang **dan respons yang hilang**
- [ ] Isolasi tenant diuji
- [ ] Audit event dipancarkan dengan aktor, penyetuju, dan alasan
- [ ] Migrasi mengikuti expand-contract dengan `lock_timeout`
- [ ] Kompatibilitas dengan klien versi N-1 diverifikasi
- [ ] Perilaku saat kuota terlampaui didefinisikan — **dan tidak menghentikan penjualan**
- [ ] Metrik dan alarm ditambahkan
- [ ] Empty state dan error state ada
- [ ] Entri runbook dibuat bila fitur bisa gagal dengan cara yang terlihat merchant

---

## Peta dokumen — urutan baca

**Mulai di sini:**
1. `product/PRD-lumi-pos-v1.md` — problem, goals, non-goals, 77 FR
2. `product/ARCH-lumi-pos-v1.md` — batas modul, port, deployment
3. `product/ERD-lumi-pos-v1.md` — skema, RLS, index
4. `product/IA-lumi-pos-v1.md` — 52 layar, offline vs online-only

**Saat mengerjakan modul tertentu** — `product/specs/spec-{a…h}-*.md`, 414 acceptance criteria:

| Modul | File |
|---|---|
| A Katalog · B Kasir & Order · C Pembayaran & Pajak · D Kas & Shift | `spec-a…d` |
| E Inventori · F Identitas/RBAC/Audit · G Laporan · H Sinkronisasi | `spec-e…h` |

**Saat butuh alasan di balik keputusan** — `research/` (15 dokumen, 39 keputusan KEP-01…KEP-39). Mulai dari `research/00-EXECUTIVE-BRIEF.md`.

**Keputusan yang sudah diambil** — `research/13-DECISION-LOG.md` (OQ-01…OQ-06).

**Hasil pengukuran** — `prototypes/*/FINDINGS.md`. Angka di sini **mengalahkan** estimasi di dokumen lain.

---

## Status & fase saat ini

**Fase: F1 — Inti transaksi, Modul B (Kasir & Order), sub-project 1 (fondasi order).** Gate F0 tertutup — rincian per item ada di `HANDOFF.md`.

Gate F0 (lihat `HANDOFF.md` untuk bukti per item):
- [x] Skema PostgreSQL + RLS berjalan (`db/migrations/0001–0014`)
- [x] **Test isolasi lintas-tenant hijau untuk setiap tabel** — `npm run test:isolation`, 189/189
- [x] Skema SQLite lokal berjalan (`db/local/001-initial.sql`) — `npm run test:sqlite-local` hijau
- [x] Font Inter di-self-host (mengganti `@import` Google Fonts)
- [x] Header COOP/COEP di-set (`apps/kasir/vite.config.ts` + `tauri.conf.json`)
- [x] `_adherence.oxlintrc.json` masuk CI — `npm run lint:ds` hijau, `.github/workflows/lint-ds.yml`
- [x] Aplikasi kosong berjalan di Tauri dengan token design system terpasang
- [x] **DST menembak server sungguhan juga** — `npm run test:dst-server`: Fastify + PostgreSQL lewat transport yang sama cacatnya, invariant diperiksa terhadap baris database. Iterasinya jauh lebih sedikit; yang dicari ikatan ke implementasi, bukan kedalaman ruang keadaan
- [x] **Harness DST ada dan gate-nya hijau** — `npm run test:dst`, 10.000 iterasi fault injection, nol pelanggaran. Delapan invariant (I1–I8) dari `prototypes/02-dst-sinkronisasi/FINDINGS.md`; kelima mode cacat tinggal permanen sebagai bukti invariantnya tidak kosong
- [x] **SQLite WASM+OPFS berjalan di browser — diukur 7 Agustus 2026** (`prototypes/03-sqlite-opfs/FINDINGS.md`). Paket `@sqlite.org/sqlite-wasm`. **Temuan yang membalik asumsi: VFS `opfs-sahpool` 71× lebih cepat menulis daripada VFS `opfs`, dan tidak butuh COOP/COEP.** Dua tab tidak dapat sama-sama menulis (`NoModificationAllowedError`) — pola satu-penulis WAJIB. `storage.persisted()` = `false`: data lokal dapat dihapus browser. Belum diukur di Android/iOS

Status F1 sekarang:

- **Sub-project 1 — endpoint REST inti: selesai.** 28 operasi REST atas `category`, `item`/`item_variation`, `modifier_list`/`modifier`, `item_modifier_list` (`docs/superpowers/plans/PLAN-katalog-rest-inti.md`). Menutup FR-A1/A2/A4/A6/A9 di sisi backend.
- **Sub-project 2 — FR-A7 harga per outlet dan riwayatnya: selesai sebagian** (`docs/superpowers/plans/PLAN-katalog-harga-riwayat.md`). 4 operasi REST atas `price_history`, resolver tangga tiga tingkat diekspor lewat `catalog/index.ts` untuk dipakai Modul B, migrasi `0016` (index resolusi).

**FR-A7 belum tertutup penuh, dan itu disengaja.** Dua dari empat acceptance criteria-nya tidak bisa diuji sekarang: `cost_at_sale` butuh `order_line` (Modul B), dan "device mana yang belum menerima perubahan harga" butuh sync (F2) + laporan (Modul G). Jangan tandai FR-A7 selesai sampai keduanya ada.

Sengaja belum digarap: FR-A3/A5 (aturan pemilihan modifier — UI kasir), FR-A8 (import katalog, P1).

Sisa Modul B, belum digarap: **FR-B8/B9** (otorisasi step-up — butuh PIN, Modul F), FR-B11 (cetak ulang struk, P1, butuh printer F4).

**Modul C sub-project 1 selesai** (`docs/superpowers/plans/PLAN-pembayaran-pajak.md`): `TaxCalculator`, REST `tax_rate`, dan pembayaran tunai. `OPEN` → `PAID` → `CLOSED` kini hidup. Menutup FR-C6, C7, C8, C9, C11, dan FR-C1/C2 untuk tunai.

**Modul C sub-project 2 — gateway: selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md` §5.7). QRIS dinamis lewat port `PaymentProvider`, QRIS statis, EDC, endpoint cek status, dan webhook Midtrans. Menutup sisa FR-C2, FR-C4, FR-C5, dan FR-C14.

**Keputusan yang mengikat kode gateway:**

- **Port `PaymentProvider` wajib, bukan pilihan gaya.** CI mengisi `MIDTRANS_SERVER_KEY` dengan string kosong, jadi **tidak ada satu pun test yang boleh menyentuh jaringan**. Adapter dipilih di `buildApp` lewat `PAYMENT_PROVIDER` (invariant #5); `midtrans` dengan kunci kosong **gagal saat boot**, bukan saat pelanggan pertama membayar.
- **Status gateway tak dikenal → `pending`, tidak pernah `confirmed`.** `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi; menebak ke arah lain berarti menandai lunas berdasarkan kata yang tidak dimengerti.
- **QRIS dinamis memakai DUA transaksi** — satu-satunya jalur di repo ini yang begitu. Payment `pending_confirmation` ditulis dan di-commit **sebelum** gateway dipanggil, karena kegagalan gateway di dalam transaksi akan me-rollback satu-satunya jejak bahwa QR pernah diminta — sementara pelanggan mungkin sudah membayar (FR-C14). Ini tidak melanggar invariant #1: inisiasi QRIS bukan penjualan yang selesai, dan `sumConfirmed` mengabaikan payment `pending_confirmation` sepenuhnya.
- **Idempotency key gateway hanya diselesaikan bila gateway menjawab.** Kalau ia diselesaikan juga saat gateway gagal, retry dengan key yang sama menerima respons "tanpa QR" dari cache selamanya. Ini yang membuat `IdempotencyRecord.completed` perlu ada — `response_status ?? 200` membuat klaim yang belum selesai tidak dapat dibedakan dari sukses ber-body kosong.
- **QRIS statis dan EDC langsung `confirmed`, dan itu bukan pelanggaran `spec-c:320`** — aturan itu berbunyi "tanpa konfirmasi dari **gateway**" dan berlaku untuk pembayaran yang punya gateway. Yang mengonfirmasi keduanya adalah orang. `confirmed_manually` menandai bahwa tidak ada sistem yang memverifikasi (FR-G5 memakainya), dan diisi `true` hanya untuk `qris_static`.
- **Webhook adalah satu-satunya endpoint tanpa `X-Tenant-Id`.** Signature diverifikasi sebelum satu query pun jalan; tenant dibaca dari `custom_field1` lalu dipakai sebagai `app.tenant_id`, sehingga pencariannya tetap tunduk RLS. Kunci kosong → `503`, bukan diterima apa adanya.
- **Redaksi log dipasang di lapisan logging** (`logMethod` pino), bukan dipanggil dari tiap handler — AC FR-C5 ketiga menuntut kata itu. Ia menyaring bentuk nomor kartu **dan** nilai rahasia yang didaftarkan saat boot; penyaringan berbasis nama field saja tidak menangkap kunci yang menyelinap ke pesan error.

Sisa Modul C: **C-3** — rekonsiliasi dan ekspor (keduanya P1). FR-C3 (nonaktifkan metode online saat offline) tidak bisa ditegakkan server dan menunggu klien + F2.

**Keputusan produk yang mengikat kode katalog:**

- `item_variation.price` **beku setelah variation dibuat** — ia adalah harga awal, anak tangga paling bawah resolusi. Semua perubahan harga lewat `price_history`. `updateItemVariation` tidak menerima `price`, dan itu permanen, bukan penundaan.
- **Harga terjadwal masa depan diizinkan.** `effective_from` boleh di masa depan; resolusi `effective_from <= at` yang menentukan kapan ia berlaku.
- Aktor perubahan dibaca dari header **`X-Actor-Id`** (`getActorId`), divalidasi ke tabel `"user"` lewat SELECT yang tunduk RLS. Placeholder sampai modul identity ada — satu titik yang nanti diganti ekstraksi token, sejajar dengan `X-Tenant-Id`.

**Modul B (Kasir & Order) sub-project 1 — fondasi order: selesai** (`docs/superpowers/plans/PLAN-ordering-fondasi.md`). `POST /orders` menulis order + check + line + modifier + outbox + idempotency_key dalam **satu transaksi** (invariant #1). Menutup FR-B2, B3, B4, B5, B6, B10, B12 dan sebagian B1.

`packages/domain` akhirnya berisi kode: state machine order, aritmetika uang, generator HLC — semuanya **fungsi murni tanpa I/O**, dibagi server dan klien supaya keduanya tidak pernah menghitung total yang berbeda.

**Delapan modul kini punya kode**: `catalog`, `ordering`, `identity`, `cash`, `tenancy`, `sync`, `inventory`, `audit`. Peta lengkapnya di `apps/server/src/modules/README.md`. Modul-modul kecil itu lahir karena invariant #4 — jalur penjualan menunjuk ke lima modul lain, dan alternatifnya adalah `ordering` meng-query tabel milik semuanya.

**Keputusan yang mengikat kode ordering:**

- **Harga diresolusi pada `occurred_at`, bukan `now()`** (FR-H6, `spec-h:77`). Order yang antre offline berjam-jam dihitung dengan harga saat penjualan terjadi. Klien yang tidak mengirim `occurredAt` tetap memakai jam database, persis seperti sebelumnya. Ini memperkenalkan **jam ketiga** — jam perangkat klien — dan risikonya dicatat di `HANDOFF.md`.
- **Selisih hitungan klien TIDAK PERNAH menolak transaksi** (`spec-h:95`). Yang tersimpan selalu hitungan server; selisihnya ditandai `has_calculation_variance` + `variance_amount` + `audit_event` bertipe `calculation_variance`. Menolak berarti kehilangan penjualan yang uangnya sudah diterima merchant.
- **Selisih dianggap terjelaskan hanya bila DUA syarat terpenuhi**: setiap harga yang dipakai klien pernah benar-benar berlaku pada-atau-sebelum `occurred_at`, **dan** total klien konsisten dengan harga-harganya sendiri. Memeriksa syarat pertama saja meloloskan klien yang aritmetikanya salah — ditemukan lewat sabotase, bukan review.

- **`item_variation.price` beku setelah dibuat** — lihat bagian katalog di atas; `order_line.unit_price` adalah snapshot hasil `resolvePrice`, bukan pembacaan langsung.
- **Waktu selalu dari jam database, tidak pernah `new Date()` di Node.** Dipelajari dari bug nyata: resolusi harga menstempel `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node — skew ±2 ms cukup membuat harga yang baru ditulis dianggap belum berlaku, 4 dari 12 run gagal. Di produksi keduanya mesin terpisah. Berlaku juga untuk `occurred_at`, `expires_at`, dan seterusnya.
- **HLC**: satu instance dibuat di `buildApp` dengan clock di-inject di batas itu; domain tetap murni. Klien mengirim `hlc` → `update()`, tidak mengirim → `tick()`.
- **Idempotency**: key di-*claim* lebih dulu (INSERT `response_status = NULL`), order ditulis, lalu key di-*complete*. Urutan ini penting — kalau key ditulis terakhir, PK milik `order` sendiri yang memenangkan balapan dan klien menerima `ID_ALREADY_EXISTS`, bukan `409` idempotency dengan instruksi retry.
- **Cache hit mengembalikan `response_status` yang tersimpan** (jadi `201`), bukan `200`. `spec-b:336` menulis "status 200" sementara `spec-b:325` menulis "mengembalikan respons asli" dan skema menyediakan kolom `response_status` justru untuk itu. **`[ASUMSI]` — belum kamu putuskan.**

**Keputusan yang mengikat kode pajak dan pembayaran:**

- **Tarif tidak pernah float.** `tax_rate.rate` dan `outlet.service_charge_rate` adalah `numeric(6,4)`; di domain keduanya `bigint` berskala 10.000 (10% → `1000n`). Konversinya di `packages/domain/src/numeric.ts`, dibagi server dan klien. Float **terbukti aman** di skala ini — diuji atas seluruh 1.000.000 nilai — jadi alasannya bukan presisi, melainkan agar aturan "jalur uang tidak menyentuh float" tidak punya pengecualian yang akan disalin ke kolom lain.
- **`total` tidak pernah dibulatkan.** Yang dibulatkan `amount_due`, dan hanya **saat ada pembayaran tunai** (FR-C9). Pembulatan karena itu mustahil dihitung saat order dibuat, dan `computeOrderTotals` tidak menerima `roundingIncrement` sama sekali.
- **Pembulatan uang dilakukan per langkah** FR-C8, bukan sekali di akhir.
- **`order.tax_amount` = `totalTax`** (seluruh pajak, untuk struk); yang **menambah** total hanya `totalTaxExclusive`. Menukar keduanya menggandakan pajak inklusif.
- **`payment` PK-nya `(id, occurred_at)`**, bukan `id` saja — tabelnya dipartisi. Berbeda dari `order`. Yang melindungi retry pembayaran adalah **Idempotency-Key**, bukan primary key: satu lapisan lebih sedikit daripada yang dimiliki order.

**Modul B sub-project 3 — void & refund (FR-B7): selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md`). Satu endpoint `POST /orders/{id}/cancel`; **server** yang memilih operasi dari status order, bukan kasir (`spec-b:235`). Void dan refund menulis order pembatal / baris `refund` + `stock_movement` + `audit_event` + outbox + idempotency_key dalam **satu transaksi**.

`inventory` dan `audit` lahir sebagai irisan minimal, masing-masing satu fungsi — keputusan 1 Agustus menghapus PIN dari void, jadi restock dan audit adalah kontrol yang tersisa untuknya, bukan pelengkap.

**Keputusan yang mengikat kode void & refund:**

- **`voided_by_order_id` ada di order PEMBATAL**, menunjuk order yang dibatalkan. Arahnya **dipaksa** AC FR-B7 pertama ("tidak ada `UPDATE` pada order asli") — pembatalnya belum ada saat order asli ditulis, jadi tidak ada arah lain yang mungkin. Namanya terbaca terbalik; itu utang yang dicatat di `HANDOFF.md`, bukan kekeliruan implementasi.
- **Order yang sudah di-void tetap berstatus `open`.** Konsekuensi langsung dari aturan di atas. Yang menolak void kedua adalah `SELECT` di aplikasi **dan** index unik `ux_order_voided_by` (migrasi `0017`). Jangan pernah menyimpulkan "order ini sah" dari `status = 'open'` saja.
- **Refund tidak membuat `payment` negatif** (keputusan user 7 Agustus 2026). `payment.amount` punya `CHECK (amount > 0)` dan itu dipertahankan; arah berlawanan dinyatakan lewat baris `refund`. `spec-b:230` yang menulis "payment negatif" karena itu tidak akurat terhadap kode.
- **Refund sebagian wajib menyebut `lines`.** Tanpa itu server harus menebak apakah barang fisik kembali ke rak. `lines: []` berarti uang kembali tanpa barang kembali.
- **Void berjalan tanpa `X-Approver-Id`; refund selalu menuntutnya.** Header itu diabaikan pada jalur void. Bahwa penyetuju berbeda dari aktor ditegakkan `CHECK` di `audit_event` — **database**, bukan aplikasi.

**Exit criteria F1 terpenuhi.** Satu penjualan tersimpan atomik dengan pajak benar, dapat dibayar tunai/QRIS/EDC, dan dapat dikoreksi lewat void & refund. `ARCH:395` menuntut modul `payment` — ia ada, beserta port gateway-nya. Yang tersisa di Modul C adalah C-3 (rekonsiliasi dan ekspor, keduanya P1).

---

## F2 — kepemilikan database lokal, diputuskan 7 Agustus 2026

**PowerSync memegang database lokal. Seluruh tabel kami yang direplikasi didaftarkan sebagai `withRawTables`, bukan tabel PowerSync biasa.** Ini memperjelas baris "DB lokal" di tabel stack; ia bukan pilihan baru, melainkan jawaban atas siapa yang memegang koneksinya.

Dibuktikan dengan menjalankan kode, bukan membaca dokumentasi — `prototypes/04-powersync-raw-tables/FINDINGS.md`.

**Yang mengikat kode klien:**

- **Tabel kami WAJIB raw table.** Mendeklarasikannya sebagai tabel PowerSync biasa membuat core membuat VIEW bernama sama di atas `ps_data__<nama>`, dan ia bertabrakan dengan tabel nyata kami. Tabrakannya gagal keras saat boot — bukan diam-diam.
- **Raw table wajib punya kolom `id`.** Bukan konvensi kami; core menolaknya (`Table X has no id column.`). PK komposit tidak cukup.
- **Tabel murni lokal TIDAK didaftarkan sama sekali.** `outbox_local`, `stock_snapshot`, `device_config` aman justru karena PowerSync tidak tahu keduanya ada — `powersync_replace_schema` hanya menyentuh objek yang cocok `GLOB 'ps_data_*'` atau view bertanda `-- powersync-auto-generated`.
- **Jangan pasang trigger CRUD PowerSync.** Penulisan lokal ke raw table ditangkap **hanya** lewat `powersync_create_raw_table_crud_trigger`. Tidak memasangnya adalah yang membuat `outbox_local` + REST idempoten tetap satu-satunya jalur naik. Memasangnya berarti membangun jalur naik kedua yang diam-diam.
- **Satu penjualan tetap satu `writeTransaction`** — `BEGIN IMMEDIATE`/`COMMIT` sungguhan dengan kunci global. Invariant #1 tidak berubah bentuknya.
- **`enableMultiTabs` di-set eksplisit**, tidak diandalkan pada default. Ia yang memenuhi pola satu-penulis; tanpanya tab kedua mematikan aplikasi (prototipe 03 §3).
- **`worker: { format: 'es' }` di setiap Vite config yang memuat PowerSync.** Sudah dipasang di `apps/kasir`. `vite dev` hijau tanpanya; hanya build rilis yang gagal.

**Harganya terukur, dan bukan nol:** 12,33 ms per penjualan versus 3,25 ms lewat driver mentah — 3,8×. Terbukti **bukan** karena raw table. Masih jauh di bawah ambang yang terlihat kasir, tapi angka itu dari mesin pengembangan.

**Jalur turun sudah dijalankan** terhadap PowerSync Open Edition self-hosted — `prototypes/05-powersync-jalur-turun/FINDINGS.md`. Katalog turun ke raw table kami, `item_modifier_list` utuh, perubahan berjalan sampai tanpa reload. Dua hal dari sana **mengikat kode klien**, dan keduanya tidak terlihat sampai diuji:

- ⛔ **Sync rules adalah SATU-SATUNYA batas tenant pada jalur turun.** Role replikasi wajib `BYPASSRLS` — replikasi logis membaca WAL, dan RLS tidak berlaku di sana. Invariant #8 tidak menjaga apa pun pada jalur ini. Sabotase membuktikannya: satu `WHERE tenant_id = auth.parameter('tenant_id')` dilepas dari satu baris, dan katalog merchant lain mendarat di perangkat yang salah tanpa satu pun error. Pemeriksaan isolasi karena itu harus menyentuh **setiap tabel** — kebocoran satu tabel tidak terlihat oleh pemeriksaan pada tabel lain.
- ⛔ **Membangun ulang raw table lokal TIDAK memicu unduh ulang.** Checkpoint PowerSync hidup di tabel `ps_*`, terpisah dari tabel kami; `waitForFirstSync()` selesai dalam 0 ms dan **melaporkan sukses** sementara katalog kosong permanen. Setiap migrasi skema lokal yang menyentuh raw table wajib diikuti `disconnectAndClear()`.

Bucket storage boleh PostgreSQL — MongoDB tidak wajib. `client_auth.jwks` menerima kunci inline; di produksi ia harus **asimetris** dan dicetak server kami.

Urutan fase F0→F6 ada di `product/ARCH-lumi-pos-v1.md` § 14. Estimasi v1: ±18–24 minggu penuh waktu.

---

## Temuan F1: FK PostgreSQL tidak tunduk RLS

Ditemukan empiris saat membangun modul Katalog, bukan dari dokumentasi: sebelum diperbaiki, `createItem` menerima dan **benar-benar menyimpan** item yang mereferensi `category` milik tenant lain, lalu mengembalikan `201`. Foreign key constraint PostgreSQL dicek dengan privilese owner tabel yang direferensikan — **tidak tunduk `FORCE ROW LEVEL SECURITY`**. Constraint FK hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

**Konsekuensi:** setiap FK yang nilainya disuplai klien ke tabel ber-`tenant_id` wajib divalidasi lewat `SELECT` yang tunduk RLS sebelum dipercaya. Modul Katalog menegakkannya lewat `assertCategoryVisible` (`apps/server/src/modules/catalog/handlers/items.ts`), `fetchModifierListOrThrow` (`modifier-lists.ts`), kedua guard di `item-modifier-lists.ts`, dan `assertOutletVisible`/`assertUserVisible` di `prices.ts`. Modul B, C, dan E akan punya paparan yang sama (`order_line.variation_id`, `payment.order_id`, `stock_movement.variation_id`, dst) — cek ini di setiap FK klien-suplai baru.

**Dikonfirmasi ulang 2 Agustus 2026 di `price_history.outlet_id`,** lewat sabotase yang disengaja: `assertOutletVisible` dinonaktifkan, request yang menunjuk outlet tenant lain mengembalikan `201` dan barisnya benar-benar tersimpan. FK ke `outlet(id)` tidak menghentikannya. Ini bukan pengulangan bug yang sama — ini FK yang berbeda, di tabel yang berbeda, di modul yang berbeda. Polanya berulang setiap kali FK klien-suplai baru muncul.

**Dikonfirmasi keempat kalinya di `order.shift_id`** (Modul B): `assertShiftOpen` dinonaktifkan, dan satu order **utuh** — order + check + seluruh baris — tersimpan menunjuk shift milik tenant lain, `201`. Empat kali, empat FK berbeda, empat modul berbeda. Berhenti menganggap ini kejadian; ini sifat PostgreSQL. **Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya lewat sabotase.**

**Bentuk kelima, ditemukan 7 Agustus 2026 saat membangun refund: guard yang tidak dapat DIBEDAKAN dari luar adalah guard yang tidak teruji.** Penyetuju refund divalidasi dua kali — sekali eksplisit di jalur refund, sekali lagi di dalam `recordAuditEvent`. Karena keduanya menjawab dengan status dan kode yang sama persis, guard pertama bisa **dimatikan sepenuhnya** tanpa satu test pun merah. Perbaikannya bukan menghapus salah satunya (`refund.approved_by` ditulis sebelum audit berjalan, dan kolom itu tanpa FK), melainkan memisahkan pesannya: `assertApproverVisible` dengan kode `APPROVER_NOT_FOUND`. Itu sekaligus menutup cacat yang lebih nyata — manajer yang penyetujuannya ditolak sebelumnya diberi tahu bahwa **kasir**-nya yang tidak ditemukan.

**Kasus yang lebih buruk: kolom tanpa FK sama sekali.** `price_history.changed_by` adalah `text NOT NULL` tanpa FK ke `"user"` — database tidak akan menangkap id karangan apa pun. Kolom audit finansial yang isinya tidak dijamin siapa-siapa lebih berbahaya daripada FK yang tidak tunduk RLS, karena tidak ada apa pun yang terlihat menjaganya. `assertUserVisible` adalah satu-satunya yang berdiri di sana.

**Batas temuan ini:** suite isolasi 189 test (invariant #8) menguji akses tabel langsung dan itu tetap benar dan hijau — RLS bekerja sesuai spesifikasi. Yang tidak diuji suite itu adalah kelas ini: aplikasi menulis ke tabelnya sendiri, dengan `tenant_id` sendiri, lewat RLS yang berjalan benar, sambil menunjuk baris tenant lain lewat FK. RLS tidak pernah dilanggar di sini — FK-lah pintunya.

---

## Open question yang masih terbuka

Jangan menebak jawabannya — tanyakan atau catat sebagai asumsi bertanda.

| # | Pertanyaan | Memblokir |
|---|---|---|
| OQ-14 | Prototipe Tauri Android — printer Bluetooth + scanner HID | Rencana mobile |

**Sudah diputuskan 1 Agustus 2026 — jangan tanyakan ulang, jangan perlakukan sebagai asumsi:**

| # | Keputusan |
|---|---|
| OQ-09 | `VerticalProfile` **per outlet, mewarisi default tenant**. Pusat menetapkan standar, cabang boleh override. `vertical_profile.is_tenant_default` + partial unique index (`db/migrations/0015`); resolusi = `COALESCE(profil_outlet, profil_default_tenant)` |
| OQ-08 | **Batas kredensial offline: 30 hari** (keputusan 7 Agustus 2026, memakai kompromi `research/12` § OQ-08). Perangkat yang melewati batas tetap dapat **menyelesaikan transaksi berjalan dan menutup shift**, tapi **tidak dapat membuka shift baru** sampai terhubung. Angkanya belum divalidasi ke merchant. `research/12` dan `research/13` belum disamakan — itu penyuntingan dokumen riset, bukan kewenangan agent |
| OQ-15 | QRIS statis **dan** dinamis sama-sama didukung. Dinamis lewat API Midtrans + webhook (online-only); statis lewat QR cetak merchant + konfirmasi manual (**berfungsi offline**, wajib disertai kontrol anti-fraud di `spec-c`) |
| — | Ambang otorisasi: diskon >20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale wajib alasan, PIN di atas 3×/shift · refund PIN manajer (tidak dapat diubah) · **void TANPA PIN manajer** — cukup alasan daftar tertutup + audit + restock otomatis. Baris void adalah **override eksplisit** terhadap `research/08` §3; konsekuensinya laporan exception FR-G5 naik jadi wajib. Angkanya `[ASUMSI]`, belum divalidasi ke merchant |
| — | MFA wajib Owner v1 atau v1.1? | F5 |
| OQ-04/05 | Kewajiban fiskal & pajak dine-in vs takeaway | **Merchant berbayar pertama**, bukan kode |

Daftar lengkap: `research/12-OPEN-QUESTIONS.md`.

---

## Cara kerja yang diharapkan

- **Baca spec modul sebelum menulis kode modul itu.** Acceptance criteria di sana adalah kontrak.
- **Jangan memperluas scope.** Kalau sesuatu terasa perlu tapi ada di daftar "jangan bangun", angkat sebagai pertanyaan, jangan bangun.
- **Angka hasil pengukuran mengalahkan estimasi.** Kalau `prototypes/*/FINDINGS.md` bertentangan dengan dokumen lain, FINDINGS yang benar.
- **Tandai asumsi.** Pakai `[ASUMSI]` seperti di dokumen riset, jangan selundupkan sebagai fakta.
- **Lapisan sync ditulis dengan waktu, keacakan, dan I/O di-inject** sebagai dependensi — prasyarat DST, dan retrofitnya mahal. Harness referensi ada di `prototypes/02-dst-sinkronisasi/sim.py`.
