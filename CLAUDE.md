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
- [ ] **SQLite WASM+OPFS berjalan di browser — belum dibangun/diuji.** Server-side saja, jadi tidak memblokir F1. **Memblokir F2.**

Status F1 sekarang:

- **Sub-project 1 — endpoint REST inti: selesai.** 28 operasi REST atas `category`, `item`/`item_variation`, `modifier_list`/`modifier`, `item_modifier_list` (`docs/superpowers/plans/PLAN-katalog-rest-inti.md`). Menutup FR-A1/A2/A4/A6/A9 di sisi backend.
- **Sub-project 2 — FR-A7 harga per outlet dan riwayatnya: selesai sebagian** (`docs/superpowers/plans/PLAN-katalog-harga-riwayat.md`). 4 operasi REST atas `price_history`, resolver tangga tiga tingkat diekspor lewat `catalog/index.ts` untuk dipakai Modul B, migrasi `0016` (index resolusi).

**FR-A7 belum tertutup penuh, dan itu disengaja.** Dua dari empat acceptance criteria-nya tidak bisa diuji sekarang: `cost_at_sale` butuh `order_line` (Modul B), dan "device mana yang belum menerima perubahan harga" butuh sync (F2) + laporan (Modul G). Jangan tandai FR-A7 selesai sampai keduanya ada.

Sengaja belum digarap: FR-A3/A5 (aturan pemilihan modifier — UI kasir), FR-A8 (import katalog, P1).

Sisa Modul B, belum digarap: **FR-B7** (void & refund), **FR-B8/B9** (otorisasi step-up — butuh PIN, Modul F), FR-B11 (cetak ulang struk, P1, butuh printer F4). Separuh state machine (`OPEN` → `PAID` → `CLOSED`) menunggu pembayaran. **Modul C (Pembayaran & Pajak) belum disentuh.**

**Keputusan produk yang mengikat kode katalog:**

- `item_variation.price` **beku setelah variation dibuat** — ia adalah harga awal, anak tangga paling bawah resolusi. Semua perubahan harga lewat `price_history`. `updateItemVariation` tidak menerima `price`, dan itu permanen, bukan penundaan.
- **Harga terjadwal masa depan diizinkan.** `effective_from` boleh di masa depan; resolusi `effective_from <= at` yang menentukan kapan ia berlaku.
- Aktor perubahan dibaca dari header **`X-Actor-Id`** (`getActorId`), divalidasi ke tabel `"user"` lewat SELECT yang tunduk RLS. Placeholder sampai modul identity ada — satu titik yang nanti diganti ekstraksi token, sejajar dengan `X-Tenant-Id`.

**Modul B (Kasir & Order) sub-project 1 — fondasi order: selesai** (`docs/superpowers/plans/PLAN-ordering-fondasi.md`). `POST /orders` menulis order + check + line + modifier + outbox + idempotency_key dalam **satu transaksi** (invariant #1). Menutup FR-B2, B3, B4, B5, B6, B10, B12 dan sebagian B1.

`packages/domain` akhirnya berisi kode: state machine order, aritmetika uang, generator HLC — semuanya **fungsi murni tanpa I/O**, dibagi server dan klien supaya keduanya tidak pernah menghitung total yang berbeda.

**Enam modul kini punya kode**: `catalog`, `ordering`, `identity`, `cash`, `tenancy`, `sync`. Peta lengkapnya di `apps/server/src/modules/README.md`. Modul-modul kecil itu lahir karena invariant #4 — jalur penjualan menunjuk ke lima modul lain, dan alternatifnya adalah `ordering` meng-query tabel milik semuanya.

**Keputusan yang mengikat kode ordering:**

- **`item_variation.price` beku setelah dibuat** — lihat bagian katalog di atas; `order_line.unit_price` adalah snapshot hasil `resolvePrice`, bukan pembacaan langsung.
- **Waktu selalu dari jam database, tidak pernah `new Date()` di Node.** Dipelajari dari bug nyata: resolusi harga menstempel `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node — skew ±2 ms cukup membuat harga yang baru ditulis dianggap belum berlaku, 4 dari 12 run gagal. Di produksi keduanya mesin terpisah. Berlaku juga untuk `occurred_at`, `expires_at`, dan seterusnya.
- **HLC**: satu instance dibuat di `buildApp` dengan clock di-inject di batas itu; domain tetap murni. Klien mengirim `hlc` → `update()`, tidak mengirim → `tick()`.
- **Idempotency**: key di-*claim* lebih dulu (INSERT `response_status = NULL`), order ditulis, lalu key di-*complete*. Urutan ini penting — kalau key ditulis terakhir, PK milik `order` sendiri yang memenangkan balapan dan klien menerima `ID_ALREADY_EXISTS`, bukan `409` idempotency dengan instruksi retry.
- **Cache hit mengembalikan `response_status` yang tersimpan** (jadi `201`), bukan `200`. `spec-b:336` menulis "status 200" sementara `spec-b:325` menulis "mengembalikan respons asli" dan skema menyediakan kolom `response_status` justru untuk itu. **`[ASUMSI]` — belum kamu putuskan.**

**Pajak ditulis nol di seluruh kolom order.** Exit criteria F1 menuntut "pajak benar"; `TaxCalculator` adalah Modul C dan belum dibangun. **F1 belum tertutup.**

Urutan fase F0→F6 ada di `product/ARCH-lumi-pos-v1.md` § 14. Estimasi v1: ±18–24 minggu penuh waktu.

---

## Temuan F1: FK PostgreSQL tidak tunduk RLS

Ditemukan empiris saat membangun modul Katalog, bukan dari dokumentasi: sebelum diperbaiki, `createItem` menerima dan **benar-benar menyimpan** item yang mereferensi `category` milik tenant lain, lalu mengembalikan `201`. Foreign key constraint PostgreSQL dicek dengan privilese owner tabel yang direferensikan — **tidak tunduk `FORCE ROW LEVEL SECURITY`**. Constraint FK hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

**Konsekuensi:** setiap FK yang nilainya disuplai klien ke tabel ber-`tenant_id` wajib divalidasi lewat `SELECT` yang tunduk RLS sebelum dipercaya. Modul Katalog menegakkannya lewat `assertCategoryVisible` (`apps/server/src/modules/catalog/handlers/items.ts`), `fetchModifierListOrThrow` (`modifier-lists.ts`), kedua guard di `item-modifier-lists.ts`, dan `assertOutletVisible`/`assertUserVisible` di `prices.ts`. Modul B, C, dan E akan punya paparan yang sama (`order_line.variation_id`, `payment.order_id`, `stock_movement.variation_id`, dst) — cek ini di setiap FK klien-suplai baru.

**Dikonfirmasi ulang 2 Agustus 2026 di `price_history.outlet_id`,** lewat sabotase yang disengaja: `assertOutletVisible` dinonaktifkan, request yang menunjuk outlet tenant lain mengembalikan `201` dan barisnya benar-benar tersimpan. FK ke `outlet(id)` tidak menghentikannya. Ini bukan pengulangan bug yang sama — ini FK yang berbeda, di tabel yang berbeda, di modul yang berbeda. Polanya berulang setiap kali FK klien-suplai baru muncul.

**Dikonfirmasi keempat kalinya di `order.shift_id`** (Modul B): `assertShiftOpen` dinonaktifkan, dan satu order **utuh** — order + check + seluruh baris — tersimpan menunjuk shift milik tenant lain, `201`. Empat kali, empat FK berbeda, empat modul berbeda. Berhenti menganggap ini kejadian; ini sifat PostgreSQL. **Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya lewat sabotase.**

**Kasus yang lebih buruk: kolom tanpa FK sama sekali.** `price_history.changed_by` adalah `text NOT NULL` tanpa FK ke `"user"` — database tidak akan menangkap id karangan apa pun. Kolom audit finansial yang isinya tidak dijamin siapa-siapa lebih berbahaya daripada FK yang tidak tunduk RLS, karena tidak ada apa pun yang terlihat menjaganya. `assertUserVisible` adalah satu-satunya yang berdiri di sana.

**Batas temuan ini:** suite isolasi 189 test (invariant #8) menguji akses tabel langsung dan itu tetap benar dan hijau — RLS bekerja sesuai spesifikasi. Yang tidak diuji suite itu adalah kelas ini: aplikasi menulis ke tabelnya sendiri, dengan `tenant_id` sendiri, lewat RLS yang berjalan benar, sambil menunjuk baris tenant lain lewat FK. RLS tidak pernah dilanggar di sini — FK-lah pintunya.

---

## Open question yang masih terbuka

Jangan menebak jawabannya — tanyakan atau catat sebagai asumsi bertanda.

| # | Pertanyaan | Memblokir |
|---|---|---|
| OQ-08 | Batas kredensial offline vs janji offline tak terbatas | F2 |
| OQ-14 | Prototipe Tauri Android — printer Bluetooth + scanner HID | Rencana mobile |

**Sudah diputuskan 1 Agustus 2026 — jangan tanyakan ulang, jangan perlakukan sebagai asumsi:**

| # | Keputusan |
|---|---|
| OQ-09 | `VerticalProfile` **per outlet, mewarisi default tenant**. Pusat menetapkan standar, cabang boleh override. `vertical_profile.is_tenant_default` + partial unique index (`db/migrations/0015`); resolusi = `COALESCE(profil_outlet, profil_default_tenant)` |
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
