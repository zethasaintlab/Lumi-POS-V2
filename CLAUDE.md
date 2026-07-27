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

**Fase: F0 — Fondasi.** Belum ada kode aplikasi.

Gate F0 untuk lanjut ke F1:
- [ ] Skema PostgreSQL + RLS berjalan
- [ ] **Test isolasi lintas-tenant hijau untuk setiap tabel** ← gate utama, belum tertutup
- [ ] Skema SQLite lokal berjalan (`prototypes/01-sqlite-sizing/schema.sql` sebagai titik awal)
- [ ] Font Inter di-self-host (mengganti `@import` Google Fonts — prasyarat offline)
- [ ] Header COOP/COEP di-set (prasyarat OPFS)
- [ ] `_adherence.oxlintrc.json` masuk CI
- [ ] Aplikasi kosong berjalan di Tauri dengan token design system terpasang

Urutan fase F0→F6 ada di `product/ARCH-lumi-pos-v1.md` § 14. Estimasi v1: ±18–24 minggu penuh waktu.

---

## Open question yang masih terbuka

Jangan menebak jawabannya — tanyakan atau catat sebagai asumsi bertanda.

| # | Pertanyaan | Memblokir |
|---|---|---|
| OQ-08 | Batas kredensial offline vs janji offline tak terbatas | F2 |
| OQ-09 | `VerticalProfile` per tenant atau outlet? **Diasumsikan per outlet** | F1 |
| OQ-14 | Prototipe Tauri Android — printer Bluetooth + scanner HID | Rencana mobile |
| OQ-15 | QRIS statis konfirmasi manual — didukung? **Diasumsikan ya** | F1 |
| — | Ambang otorisasi default (diskon >20%/Rp50k, selisih kas >Rp20k) | F1 — konfigurasi, tidak memblokir |
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
