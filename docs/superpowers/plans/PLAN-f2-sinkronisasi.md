# PLAN — F2: sinkronisasi

Status: **FR-H6 disetujui, dalam pengerjaan.** Tiga keputusan sudah dijawab user — lihat §5.0.

---

## 1. Di mana kita berdiri

F1 tutup. Exit criteria-nya terpenuhi: satu penjualan tersimpan atomik dengan pajak benar, dibayar tunai/QRIS/EDC, dan dapat dikoreksi lewat void & refund. 686 test hijau, PR #8 menunggu merge.

Gate F2 (`ARCH` § 14): **0 transaksi hilang atau duplikat di bawah fault injection, 10.000 iterasi.**

---

## 2. Apa yang sudah ada, dan apa yang belum

| Hal | Status | Bukti |
|---|---|---|
| `idempotency_key` + `outbox` (tabel) | **ada** | `db/migrations/0013_server_only.sql`, dipakai seluruh jalur tulis |
| `findIdempotencyKey` · `claimIdempotencyKey` · `completeIdempotencyKey` · `insertOutboxEvent` | **ada** | `modules/sync/index.ts` |
| HLC | **ada**, murni, clock di-inject di `buildApp` | `packages/domain/src/hlc.ts` |
| ULID/UUIDv7 client-generated sebagai PK | **ada** di seluruh tabel transaksional | `CLAUDE.md` § Konvensi data |
| `order.has_calculation_variance` + `variance_amount` | **kolomnya ada, tidak pernah diisi** | `0007_ordering.sql:24-25` |
| Protokol sinkronisasi tervalidasi | **ada**, di Python | `prototypes/02-dst-sinkronisasi/FINDINGS.md` — 2.000 iterasi, 5 mode cacat |
| Worker relay `outbox` | **belum** | `modules/README.md` |
| Harness DST di repo | **belum** | `npm run test:dst` → `exit 1` |
| SQLite WASM+OPFS di browser | **belum dibangun, belum diuji** | tidak ada satu pun rujukan di `apps/kasir/` maupun `package.json` |

**Yang paling penting dari tabel itu:** prototipe Python sudah membuktikan protokolnya benar dan sekaligus menemukan bahwa daftar invariant awal **tidak lengkap** — I1–I5 hanya menangkap 1 dari 5 cacat yang disuntikkan; I6 (offline), I7 (immutabilitas), dan I8 (higienis idempotency) lahir dari situ. Harness di repo harus membawa kedelapan invariant itu, bukan mengulang lima yang pertama.

---

## 3. Dua hal yang memblokir, dan apa persisnya yang mereka blokir

### SQLite WASM+OPFS — memblokir sisi KLIEN saja

`CLAUDE.md` menandainya sebagai item F0 terakhir yang masih terbuka. Ia memblokir apa pun yang butuh database lokal di browser: antrean upload persisten (FR-H1), jendela riwayat lokal (FR-H7), refund offline, buka shift offline.

Ia **tidak** memblokir: FR-H6, worker relay, maupun harness DST — ketiganya server dan domain.

Catatan yang belum terverifikasi: `CLAUDE.md` menyebut Firefox tidak didukung untuk aplikasi kasir justru karena OPFS. Itu keputusan yang sudah diambil, tapi dukungan OPFS di Safari/iOS **belum pernah diukur di proyek ini**, dan itu risiko yang belum punya angka.

### OQ-08 — memblokir modul identitas, bukan seluruh F2

> Berapa batas kredensial offline, dan apa yang terjadi saat terlampaui?

`research/12` menandainya sebagai keputusan pemilik produk yang memblokir "PRD (spesifikasi offline), modul identitas". Kompromi yang direkomendasikan riset: perangkat yang melewati batas tetap bisa **menyelesaikan transaksi berjalan dan menutup shift**, tapi tidak bisa membuka shift baru sampai terhubung.

Ia tidak memblokir FR-H6, relay, maupun DST.

---

## 4. Yang bisa dikerjakan sekarang, tanpa keputusan apa pun

### (a) FR-H6 — validasi ulang di server

Server menghitung ulang total dari `order_line` yang dikirim, memakai katalog dan tarif yang berlaku pada `occurred_at`.

Aturan intinya berlawanan dengan naluri, dan itu yang membuatnya layak ditulis hati-hati: **transaksi yang selisih TETAP DITERIMA.** Menolaknya berarti kehilangan penjualan yang sudah terjadi dan uangnya sudah diterima merchant. Yang benar adalah menerima, menandai, dan melaporkan.

Kolomnya sudah ada sejak F0 dan tidak pernah diisi. Seluruhnya server-side.

Satu bagian yang menuntut kehati-hatian: AC kedua menuntut selisih akibat **harga yang berubah setelah sinkronisasi terakhir tidak ditandai**. Itu berarti server harus membandingkan harga pada `occurred_at`, bukan harga sekarang — dan `resolvePrice` sudah menerima `at`, jadi bahannya ada.

### (b) Harness DST

Gate F2 sendiri. Waktu, keacakan, dan I/O di-inject sebagai dependensi — `ARCH` § 11 menuntutnya **sebelum** kode sinkronisasi ditulis, dan `CLAUDE.md` mencatat retrofitnya mahal.

`packages/domain` sudah murni. HLC sudah menerima clock. Yang belum ada adalah harness yang menjalankan protokol lengkap di bawah cacat yang disuntikkan, dengan seed yang mereproduksi kegagalan persis.

### (c) Prototipe SQLite WASM+OPFS

Bukan fitur, melainkan pengukuran: apakah OPFS berjalan di browser target, berapa cepat, dan apa yang terjadi saat tab kedua dibuka. Menutup item F0 terakhir dan membuka seluruh sisi klien F2.

Risikonya paling tinggi justru karena hasilnya belum diketahui — dan itu argumen untuk mengerjakannya lebih awal, bukan nanti.

---

## 5.0 Keputusan user (7 Agustus 2026)

| # | Keputusan | Konsekuensi |
|---|---|---|
| **Q1** | **FR-H6 lebih dulu** | Validasi ulang di server. Seluruhnya server-side; tidak menunggu OPFS maupun OQ-08 |
| **Q2** | **OQ-08 memakai kompromi riset** | 30 hari. Perangkat yang lewat batas tetap boleh **menyelesaikan transaksi berjalan dan menutup shift**, tapi **tidak boleh membuka shift baru** sampai terhubung. Bukan lagi asumsi — ini keputusan |
| **Q3** | **FR-B8/B9 menunggu F3** | Otorisasi step-up digarap bersama PIN, sesi, dan RBAC di modul identitas utuh |

**Catatan Q2:** angkanya kucatat di `CLAUDE.md`. `research/13-DECISION-LOG.md` dan `research/12-OPEN-QUESTIONS.md` **tidak** kusentuh — keduanya di `/research/`, dan menyamakannya adalah keputusanmu, bukan kewenanganku.

---

## 5.1 Task breakdown FR-H6 — urutan TDD

Setiap task: test merah dulu → konfirmasi merah karena alasan yang benar → implementasi minimum → suite penuh hijau → `npm run typecheck` → `npm run lint:ds`. Setiap aturan disabotase, dan **anchor sabotasenya diverifikasi lebih dulu** — pelajaran C-2, di mana satu sabotase terlihat hijau padahal tidak pernah menempel.

- [x] **H1** — Resolusi harga memakai `occurred_at`, bukan `now()`. Ini **perubahan perilaku pada jalur yang sudah hidup**, dan ia dituntut spec: `spec-h:97` menulis server memeriksa "harga pada `occurred_at`". Order yang antre offline berjam-jam harus dihitung dengan harga saat penjualan terjadi, bukan harga saat paketnya sampai. Test: order ber-`occurredAt` sebelum kenaikan harga memakai harga lama.
- [x] **H2** — `POST /orders` menerima `total` dan `lines[].unitPrice` **opsional** dari klien. Tanpa keduanya, perilaku tidak berubah sama sekali — klien lama (N-1) tidak boleh patah.
- [x] **H3** — Selisih **tetap diterima `201`**, ditandai `has_calculation_variance = true`, selisihnya disimpan di `variance_amount`. Yang disimpan sebagai angka transaksi adalah **hitungan server**, bukan hitungan klien.
- [x] **H4** — Selisih yang **dapat dijelaskan riwayat harga tidak ditandai** (AC kedua). Klien yang memakai harga yang pernah berlaku untuk variation itu pada-atau-sebelum `occurred_at` adalah klien yang belum tersinkron — bukan anomali, dan tidak boleh membanjiri laporan.
- [x] **H5** — `audit_event` bertipe `calculation_variance` dengan konteks yang dituntut AC keempat: device, waktu, selisih.
- [x] **H6** — Property test: apa pun yang dikirim klien, **angka yang tersimpan selalu angka server**. Klien tidak dipercaya, dan itu harus jadi invariant yang diuji, bukan slogan.
- [x] **H7** — Kontrak OpenAPI + dokumen.

**Yang TIDAK dibangun di sini:** laporan "Perlu diperiksa" (Modul G — datanya tersedia, laporannya tidak), dan tiga FR lain yang menuntutnya tetap menunggu modul itu.

---

## 5.2 Risiko H1 — jam kedua, lagi

`CLAUDE.md` mencatat bug nyata di repo ini: resolusi harga menstempel `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node; skew ±2 ms menggagalkan 4 dari 12 run.

H1 memperkenalkan jam ketiga: **jam perangkat klien**, lewat `occurred_at`. Perangkat yang jamnya salah sehari akan memilih harga yang salah. Ini bukan alasan untuk tidak melakukannya — spec menuntutnya, dan harga saat penjualan terjadi memang yang benar — tapi ia menuntut test yang menyebut skenario itu, dan catatan di `HANDOFF.md`.

---

## 5. Keputusan yang kubutuhkan (sudah dijawab — lihat §5.0)

Ketiganya masuk akal, dan urutannya mengubah banyak hal. Aku tidak memilih sendiri.

### Q1 — Mana yang dikerjakan lebih dulu?

**(a) FR-H6 — validasi ulang di server.** Menutup satu P0 penuh, seluruhnya server-side, kolomnya sudah ada. Paling kecil risikonya dan langsung menambah nilai: ia satu-satunya yang membuat "klien tidak dipercaya" berhenti jadi slogan. **Rekomendasi saya**, karena ia juga memaksa kita memutuskan bentuk laporan "Perlu diperiksa" yang sudah dituntut tiga FR berbeda.

**(b) Harness DST.** Gate F2 sendiri, dan `ARCH` § 11 menuntutnya sebelum kode sinkronisasi ditulis. Argumen terkuatnya: setiap baris sync yang ditulis tanpa harness adalah baris yang nanti harus di-retrofit.

**(c) Prototipe SQLite WASM+OPFS.** Menutup item F0 terakhir dan membuka seluruh sisi klien. Hasilnya belum diketahui — kalau OPFS bermasalah di perangkat target, itu mengubah rencana F2 seluruhnya, dan lebih baik tahu sekarang daripada setelah tiga minggu kode sync.

### Q2 — OQ-08: berapa batas kredensial offline? **MEMBLOKIR modul identitas.**

Belum perlu dijawab untuk (a), (b), maupun (c). Tapi ia akan memblokir begitu shift offline digarap, dan riset sudah menyiapkan komprominya (§ 3). Kalau kamu ingin menjawabnya sekarang, aku catat; kalau tidak, aku angkat lagi saat benar-benar menghalangi.

### Q3 — FR-B8/B9 masih terbuka dan berstatus P0

Otorisasi step-up (diskon di atas ambang, void item) butuh PIN, dan PIN ada di modul identitas — `ARCH` menempatkannya di F3. Ia satu-satunya P0 Modul B yang belum tertutup. Apakah ia ikut dipertimbangkan sekarang, atau tetap menunggu F3?

---

## 6. Non-scope, apa pun yang dipilih

| Hal | Alasan |
|---|---|
| C-3 (rekonsiliasi, ekspor) | P1 |
| PowerSync jalur turun | Butuh keputusan deployment; belum |
| UI apa pun | Tidak ada UI di proyek ini |
| FR-H2/H3/H4 (indikator, layar status, blokir destruktif) | Perilaku klien |
