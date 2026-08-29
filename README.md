# Lumi POS

Point-of-sale untuk kafe takeaway 2–20 outlet di Indonesia. Offline-first, multi-vertikal, dijual sebagai lisensi berlangganan per outlet.

**Status:** F0 (fondasi) selesai · **Fase berjalan:** F1 (inti transaksi) — Modul A, B, dan C selesai: **penjualan tersimpan atomik dengan pajak benar, dibayar tunai/QRIS/EDC, dan dapat dibatalkan atau direfund**. Sisa Modul C hanya rekonsiliasi dan ekspor (P1). 686 test hijau

> 🤖 **Coding agent mulai dari [`CLAUDE.md`](CLAUDE.md)**, bukan dari file ini.

---

## Apa yang sudah ada

| | Isi | Ukuran |
|---|---|---|
| [`research/`](research/) | Riset pra-produksi 12 fase · 39 keputusan bernomor (KEP) · 16 open question · seluruh sumber tersitasi | 15 dok · 64k kata |
| [`product/`](product/) | PRD · IA · ERD · Technical Architecture · 8 spec modul · 414 acceptance criteria | 12 dok · 38k kata |
| [`prototypes/`](prototypes/) | Pengukuran yang mengoreksi asumsi: ukuran DB lokal, presisi kuantitas, harness DST sinkronisasi | 2 prototipe |
| [`ds-bundle/`](ds-bundle/) | Design system — **final, tidak diriset ulang, tidak diubah** | 21 komponen React |

---

## Urutan baca

### Kalau kamu ingin MENJALANKANNYA
[`docs/UJI-COBA-V1.md`](docs/UJI-COBA-V1.md) — instalasi bersih sampai uji coba per peran: prasyarat, reset database, seed data eksplorasi (`The Cafe by ORIGEN`), menjalankan keempat proses, matriks kredensial, dan delapan skenario uji. Termasuk daftar tegas tentang apa yang **belum** dapat diuji dan kenapa.

### Kalau kamu punya 10 menit
[`research/00-EXECUTIVE-BRIEF.md`](research/00-EXECUTIVE-BRIEF.md) — sintesis, arsitektur satu halaman, lima risiko terbesar, urutan build.

### Kalau kamu akan menulis kode
1. [`CLAUDE.md`](CLAUDE.md) — invariant, stack, konvensi, apa yang **tidak** boleh dibangun
2. [`product/PRD-lumi-pos-v1.md`](product/PRD-lumi-pos-v1.md) — 77 functional requirement
3. [`product/ARCH-lumi-pos-v1.md`](product/ARCH-lumi-pos-v1.md) — batas modul, port, deployment
4. [`product/ERD-lumi-pos-v1.md`](product/ERD-lumi-pos-v1.md) — skema, RLS, index
5. Spec modul yang sedang dikerjakan

### Kalau kamu perlu tahu *kenapa* sebuah keputusan diambil
Cari nomor **KEP** di [`research/`](research/). Setiap keputusan besar punya minimal tiga opsi, tabel trade-off, alasan, kondisi peninjauan ulang, dan sumber.

---

## Peta dokumen

### `product/` — spesifikasi

| Dokumen | Isi |
|---|---|
| [PRD](product/PRD-lumi-pos-v1.md) | Problem · goals & metrik · non-goals · persona · alur · 77 FR · NFR · edge case · risiko · release plan |
| [IA](product/IA-lumi-pos-v1.md) | 52 layar (17 kasir · 30 back-office · 5 mobile) · penandaan offline vs online-only · struktur URL |
| [ERD](product/ERD-lumi-pos-v1.md) | ~35 entitas · kebijakan RLS · index · partitioning · pemetaan PostgreSQL↔SQLite |
| [ARCH](product/ARCH-lumi-pos-v1.md) | 8 prinsip mengikat · batas modul · 5 port · arsitektur sync · deployment · testing · rilis · insiden |

**Spec modul** — `product/specs/`, masing-masing dengan behavior given/when/then dan acceptance criteria:

| | Modul | Fokus |
|---|---|---|
| [A](product/specs/spec-a-katalog.md) | Katalog | Item → Variation → Modifier; aturan pemisah yang menentukan apakah stok bisa dilacak |
| [B](product/specs/spec-b-kasir-order.md) | Kasir & Order | State machine · snapshot order line · penomoran offline · void vs refund · idempotency |
| [C](product/specs/spec-c-pembayaran-pajak.md) | Pembayaran & Pajak | PBJT vs PPN · urutan perhitungan dengan contoh bernomor · multi-payment · pembulatan |
| [D](product/specs/spec-d-kas-shift.md) | Kas & Shift | Buka shift offline · urutan input tutup kas sebagai kontrol anti-fraud · cash ledger |
| [E](product/specs/spec-e-inventori.md) | Inventori | Stok sebagai ledger · deteksi oversell · snapshot |
| [F](product/specs/spec-f-rbac-audit.md) | Identitas, RBAC & Audit | PIN vs email+password per permukaan · audit dua identitas · manajemen secret |
| [G](product/specs/spec-g-laporan.md) | Laporan & Exception | Sumber kebenaran tunggal · 8 laporan exception anti-fraud |
| [H](product/specs/spec-h-sinkronisasi.md) | Sinkronisasi | Dua jalur · HLC · 8 invariant · DST |

### `research/` — dasar faktual

| | Dokumen |
|---|---|
| 00 | [Executive brief](research/00-EXECUTIVE-BRIEF.md) — bisa dibaca berdiri sendiri |
| 01 | [Lanskap & kompetitor](research/01-COMPETITIVE-LANDSCAPE.md) — batas offline kompetitor, table stakes, celah pasar |
| 02 | [Domain & fitur](research/02-DOMAIN-FEATURE-MAP.md) — 17 area, pola multi-vertikal |
| 03 | [Tech stack](research/03-TECH-STACK-EVALUATION.md) — evaluasi per lapisan, ≥3 kandidat |
| 04 | [Pola arsitektur](research/04-ARCHITECTURE-PATTERNS.md) — idempotency, append-only, versioning katalog |
| 05 | [Offline & sinkronisasi](research/05-OFFLINE-SYNC-STRATEGY.md) — **area risiko tertinggi** |
| 06 | [Payment & fiskal](research/06-PAYMENTS-AND-FISCAL.md) — QRIS, PBJT, Coretax, kesiapan global |
| 07 | [Hardware](research/07-HARDWARE-INTEGRATION.md) — ESC/POS, batasan cetak per platform, harga pasar |
| 08 | [Keamanan & compliance](research/08-SECURITY-AND-COMPLIANCE.md) — PCI scope, threat model, UU PDP |
| 09 | [Multi-tenancy & deployment](research/09-MULTITENANCY-DEPLOYMENT.md) — RLS, biaya dualisme SaaS/on-prem |
| 10 | [Operasi & kualitas](research/10-OPERATIONS-AND-QUALITY.md) — DST, observability, rilis, insiden |
| 11 | [Model bisnis](research/11-BUSINESS-MODEL.md) — pricing, harga pasar Indonesia, model biaya |
| 12 | [Open questions](research/12-OPEN-QUESTIONS.md) — 16 pertanyaan, 6 sudah diputuskan |
| 13 | [Decision log](research/13-DECISION-LOG.md) — keputusan OQ-01…OQ-06 beserta konsekuensinya |
| — | [Sources](research/SOURCES.md) — seluruh sumber per topik, dengan tanggal akses |

### `prototypes/` — pengukuran

Angka di sini **mengalahkan** estimasi di dokumen lain.

| | Menjawab | Temuan utama |
|---|---|---|
| [01 SQLite sizing](prototypes/01-sqlite-sizing/FINDINGS.md) | OQ-07, tipe kuantitas | ≈3,0 KB/order · 90 hari = 39–130 MB · `REAL` gagal untuk kuantitas · ambang snapshot di ERD terlalu lambat |
| [02 DST sinkronisasi](prototypes/02-dst-sinkronisasi/FINDINGS.md) | R1 (risiko fatal) | Protokol lolos 2.000 iterasi · **daftar invariant awal hanya menangkap 1 dari 5 cacat** |

---

## Keputusan yang membentuk produk ini

| | Keputusan | Konsekuensi |
|---|---|---|
| KEP-01 | Posisi: keandalan saat jaringan buruk + multi-vertikal | Bukan POS termurah, bukan POS terlengkap |
| KEP-02 | Segmen: kafe takeaway 2–20 outlet | Bukan warung mikro, bukan resto dine-in multi-terminal, bukan enterprise |
| KEP-17 | Penjualan append-only | Audit trail gratis; konflik sinkronisasi hilang secara struktural |
| KEP-07 | Stok sebagai ledger | Konvergen offline; ~32% ukuran DB |
| KEP-19 | Order line sebagai snapshot | Struk historis kebal perubahan katalog |
| KEP-16 | Idempotency key + ULID client-generated, **keduanya** | Terbukti lewat DST: masing-masing menutup lubang yang tidak ditutup yang lain |
| KEP-32 | Isolasi tenant lewat RLS | Query aplikasi yang bermasalah pun tidak bisa membocorkan data |
| KEP-33 | On-premise ditunda | Menghemat 8–14 minggu + 15–25% overhead permanen |
| OQ-01 | Terima batas offline yang dipilih Toast | KDS/table management/hub lokal keluar dari v1 |

---

## Yang belum selesai

**F0 tertutup:** seluruh gate hijau, termasuk test isolasi lintas-tenant (`npm run test:isolation`, 189/189) — rincian per item di [`HANDOFF.md`](HANDOFF.md). Satu item tersisa yang tidak memblokir F0/F1: SQLite WASM+OPFS di browser belum dibangun — memblokir F2.

**Memblokir F1:** — ✅ tidak ada lagi. Ketiganya diputuskan 1 Agustus 2026: OQ-09 (profil vertikal **per outlet, mewarisi default tenant**) · OQ-15 (QRIS statis **dan** dinamis, keduanya didukung) · ambang otorisasi default (termasuk **void tanpa PIN manajer**). Rinciannya di [`CLAUDE.md`](CLAUDE.md) dan [PRD § 14](product/PRD-lumi-pos-v1.md).

**Tidak memblokir kode, tapi lead time-nya panjang — mulai sekarang:**
- Konsultasi pajak (OQ-04, OQ-05) · konfirmasi lisensi PowerSync · program partner GoFood/GrabFood · beli 5–8 model printer uji · daftar akun Midtrans

---

## Catatan kejujuran

Seluruh paket ini **desk research** — belum divalidasi dengan merchant. Tiga asumsi terbesar yang belum diuji:

1. Merchant target mengalami outage cukup sering sehingga offline bernilai bayar
2. Merchant bersedia bayar premium ~17% di atas Moka
3. Kafe takeaway tanpa integrasi aggregator masih dapat dijual

Kalau salah satu runtuh, posisi produk berubah. Detail dan konsekuensinya di [PRD § 11.2](product/PRD-lumi-pos-v1.md).

Interpretasi peraturan perpajakan dan keamanan di dokumen ini **bukan nasihat hukum** dan harus diverifikasi profesional sebelum rilis komersial.
