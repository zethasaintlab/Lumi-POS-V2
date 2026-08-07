# PLAN — Sisa F1: void & refund (FR-B7) dan pembayaran gateway (C-2)

Status: **B-3 disetujui, dalam pengerjaan.** Empat keputusan di §7 sudah dijawab user — lihat §7.0. C-2 menyusul setelah B-3.

---

## 1. Ringkasan audit

1. `main` di `6761136`; PR #6 (Modul C tunai) hijau dan menunggu merge. 547 test.
2. **Seluruh tabel yang dibutuhkan sudah ada** sejak F0: `refund`, `order.voided_by_order_id`, `stock_movement`, `audit_event`, dan seluruh kolom gateway di `payment` (`provider`, `provider_reference`, `terminal_reference`, `approval_code`, `card_last4`, `acquirer`, `confirmed_manually`, `mdr_estimated`). Tidak ada migrasi tabel baru.
3. **`fetch` global tersedia di Node 22** — integrasi Midtrans tidak butuh dependency baru.
4. `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_ENV` ada di `.env` lokal. `.env` ter-gitignore dan tidak pernah ter-commit — diverifikasi.
5. **CI mengisi kedua key dengan string kosong** (`.github/workflows/test.yml:62-63`). Konsekuensinya mutlak: **test tidak boleh pernah memanggil API Midtrans sungguhan.**
6. `ARCH:197` sudah mendefinisikan port-nya: `PaymentProvider` = `initiate · pollStatus · refund · void · settleReport`, dengan Midtrans sebagai adapter v1.
7. **Void dan refund menyentuh dua modul yang belum punya kode.** Ini temuan utama — §2.
8. `audit_event` punya `CHECK (approver_user_id IS NULL OR actor_user_id <> approver_user_id)` — **tidak bisa menyetujui diri sendiri**, ditegakkan database.
9. `refund.approved_by` adalah `text NOT NULL` **tanpa FK** — kelas yang sama dengan `price_history.changed_by` dan `tax_rate.applies_to_ids`.

---

## 2. Temuan utama — void menyentuh dua modul yang belum ada

Keputusanmu 1 Agustus 2026 (tercatat di `CLAUDE.md`) berbunyi:

> void **TANPA PIN manajer** — cukup alasan daftar tertutup + **audit** + **restock otomatis**

Keduanya bukan modul `ordering`:

| Yang dituntut | Tabel | Pemilik | Status |
|---|---|---|---|
| Restock otomatis | `stock_movement` | modul `inventory` (Modul E) | **belum ada kode** |
| Audit | `audit_event` | modul `audit` (Modul F) | **belum ada kode** |

Dan invariant #1 menuntut keduanya ditulis **dalam transaksi yang sama** dengan void — bukan sebagai event asinkron.

Ini pola yang sama persis dengan Modul B: skema F0 memaksa dependensi lintas modul, dan jalan keluarnya adalah irisan minimal (`cash` lahir dengan satu operasi, `identity` dengan satu guard). Tapi kali ini **keputusanmu sendiri** yang menuntutnya, jadi memilih membangun void tanpa restock berarti melanggar keputusan itu — bukan sekadar mempersempit scope.

`stock_movement.type` sudah memuat `'void'` dan `'refund'`, jadi skemanya memang dirancang untuk ini.

---

## 3. Milestone dan pemecahan

Dua sub-project yang saling bebas. **Usul saya: kerjakan B-3 lebih dulu** — ia tidak butuh dependensi eksternal, menutup lubang operasional yang paling nyata (kasir tidak punya cara membatalkan kesalahan), dan tidak terhalang gateway.

| Sub-project | Isi | FR |
|---|---|---|
| **B-3** | Void & refund, irisan `inventory` + `audit` | B7 · sisa B1 |
| **C-2** | QRIS dinamis (Midtrans), QRIS statis, EDC | C2 (sisa) · C3 (sebagian) · C4 · C14 |

---

## 4. Scope B-3 — void & refund

### 4.1 Aturan pemilihan otomatis (FR-B7)

> `spec-b:235` — Kasir tidak memilih "void" atau "refund" — kasir menekan "Batalkan transaksi", dan **sistem menentukan** operasi mana yang berlaku berdasarkan state.

Satu endpoint: `POST /orders/{id}/cancel`. Server memutuskan:

| Status order | Operasi | Hasil |
|---|---|---|
| `open` atau `paid` | **Void** | Order baru berstatus `voided` + audit + restock |
| `closed` | **Refund** | `refund` + `payment` negatif + `stock_movement` balik + audit |
| lainnya | Ditolak | `409` lewat `assertTransition` |

Respons menyebutkan operasi mana yang dilakukan, supaya UI bisa menjelaskannya ke kasir (`spec-b:235`).

### 4.2 Void

- Record asli **tidak berubah** (invariant #2, AC FR-B7 pertama)
- `order.voided_by_order_id` menunjuk order pembatal — **arahnya terbalik dari yang kutulis di sini, dan itu dipaksa invariant, bukan dipilih.** Kolom ini ada di baris order **pembatal** dan menunjuk order yang dibatalkan; menaruhnya di order asli menuntut `UPDATE` pada order asli (pembatalnya belum ada saat asli ditulis), dan AC FR-B7 pertama melarangnya. Namanya jadi terbaca terbalik — dicatat sebagai temuan di `HANDOFF.md`, bukan diubah sendiri
- Alasan dari **daftar tertutup**: `salah_input` · `pelanggan_batal` · `item_habis` · `uji_coba` · `lainnya`. `lainnya` wajib catatan ≥ 10 karakter (`spec-b:292`)
- `stock_movement` type `void`, delta positif per baris
- `audit_event` dengan aktor, reason_code, reason_note
- **Tanpa PIN manajer** — keputusanmu 1 Agu

### 4.3 Refund

- Hanya dari `closed` (`spec-b:228`)
- Refund parsial: kasir memilih baris; **kumulatif tidak boleh melebihi total order** (AC FR-B7 ketiga)
- `payment` negatif — tapi kolomnya `CHECK (amount > 0)`, jadi arah negatif dinyatakan lewat baris `refund`, bukan amount negatif. **Perlu diperiksa saat implementasi**; kalau spec menuntut payment negatif sungguhan, skema perlu berubah dan itu kuangkat, bukan kuputuskan
- `approved_by` **wajib** — refund selalu butuh persetujuan manajer (`spec-b:278`, tidak dapat diubah)
- Alasan daftar tertutup: `barang_rusak` · `pesanan_salah` · `pelanggan_tidak_puas` · `kelebihan_bayar` · `lainnya`

### 4.4 Irisan minimal dua modul baru

**`inventory`** — hanya `recordStockMovements(client, movements)`. Perhitungan stok (`SUM(delta)`), stocktake, oversell, sold-out: semuanya tetap Modul E penuh.

**`audit`** — hanya `recordAuditEvent(client, event)`. Query dan laporan audit tetap Modul F/G.

Keduanya diekspor lewat `index.ts` masing-masing (invariant #4).

---

## 5. Scope C-2 — gateway

### 5.1 Port `PaymentProvider` — dan kenapa ia wajib, bukan pilihan

`ARCH:197` sudah mendefinisikannya. Tapi ada alasan yang lebih memaksa: **CI mengisi Midtrans key dengan string kosong.** Test yang memanggil API sungguhan akan gagal di CI, lambat, dan bergantung pada layanan pihak ketiga yang bisa down.

```ts
interface PaymentProvider {
  initiate(req): Promise<{ providerReference, qrString, expiresAt }>;
  pollStatus(providerReference): Promise<'pending' | 'confirmed' | 'failed' | 'expired'>;
}
```

- Adapter Midtrans memakai `fetch` global (tanpa dependency baru)
- **Fake in-memory** dipakai seluruh test
- Dipilih di `buildApp` lewat environment variable — **bukan** `if (isProduction)` di kode aplikasi (invariant #5)

### 5.2 QRIS dinamis (FR-C2, FR-C14)

State machine `payment` dari `spec-c:293-316`:

- `initiate` → `pending_confirmation`. **Tidak pernah langsung `confirmed`.**
- Aturan mutlak (`spec-c:320`): sistem **tidak pernah** menandai lunas tanpa konfirmasi gateway
- Retry memakai **idempotency key yang sama** — tidak membuat transaksi gateway baru (AC FR-C14 pertama)
- Order **tidak dapat** ditutup `PAID` selama ada payment `pending_confirmation` (`spec-c:321`)

### 5.3 QRIS statis (FR-C2)

Berfungsi offline, karena itu kontrolnya wajib:

- Field referensi **wajib** (nominal + 4 digit terakhir referensi, atau catatan)
- `confirmed_manually = true`
- Masuk laporan exception (Modul G — di sini hanya datanya tersedia)

### 5.4 EDC (FR-C4)

- `approval_code` **wajib**; `card_last4` opsional, maksimal 4 karakter
- **Tidak ada field yang menerima nomor kartu lengkap** — di mana pun

### 5.5 FR-C5 — redaksi log

> AC FR-C5 ketiga: "Lapisan logging meredaksi payload pembayaran secara otomatis — **diverifikasi test** yang mengirim payload berisi pola nomor kartu dan memeriksa log"

Ini AC sisi server yang bisa dan harus dipenuhi sekarang: kirim payload berisi 13–19 digit berurutan, periksa log tidak memuatnya utuh.

---

## 5.6 Task breakdown B-3 — urutan TDD

Setiap task: test merah dulu → konfirmasi merah karena alasan yang benar → implementasi minimum → suite penuh hijau → `npm run typecheck` → `npm run lint:ds`.

Prasyarat:

- [x] **T1** — `getApproverId(req)` di `tenant-context.ts` (keputusan Q2), sejajar `getActorId`. Test: header hilang → `400`; > 64 karakter → `400`; header duplikat memakai yang pertama.
- [x] **T2** — Modul `audit`: `recordAuditEvent(client, event)`. Test: aktor lintas tenant → `404`; penyetuju sama dengan aktor → ditolak **oleh CHECK database**, bukan hanya aplikasi.
- [x] **T3** — Modul `inventory`: `recordStockMovements(client, movements)`. Test: `variation_id` lintas tenant → `404` dan tidak ada baris tersimpan; delta ×1000 bertanda.

Domain:

- [x] **T4** — `packages/domain`: `decideCancellation(status)` → `'void' | 'refund'`, dan validasi alasan daftar tertutup. **Property test** atas seluruh status × kedua daftar alasan. Murni, tanpa I/O — klien harus memutuskan hal yang sama saat offline.
- [x] **T5** — `packages/domain`: batas refund kumulatif. Property test: `SUM(refund) ≤ total` selalu, termasuk refund parsial berulang.

Void:

- [x] **T6** — `POST /orders/{id}/cancel` pada order `open`/`paid` → void. Order asli **tidak berubah**; order baru `voided`; `voided_by_order_id` terisi.
- [x] **T7** — Void menulis `stock_movement` type `void` (delta positif) + `audit_event`, **dalam transaksi yang sama** (invariant #1). Test injeksi kegagalan: nol baris di semua tabel.
- [x] **T8** — Alasan wajib dari daftar tertutup; `lainnya` menuntut catatan ≥ 10 karakter.
- [x] **T9** — Void **tanpa** PIN manajer (keputusanmu 1 Agu) — test membuktikan tidak ada `X-Approver-Id` yang dituntut.

Refund:

- [x] **T10** — Cancel pada order `closed` → refund, bukan void. Sistem yang memilih, bukan klien (AC FR-B7 kedua).
- [x] **T11** — `approved_by` wajib; aktor ≠ penyetuju ditegakkan database.
- [x] **T12** — Refund parsial; kumulatif melebihi total ditolak dengan sisa yang tersedia disebut (AC FR-B7 ketiga).
- [x] **T13** — `stock_movement` type `refund` + `audit_event` dengan aktor **dan** penyetuju.
- [x] **T14** — Idempotency: retry tidak menghasilkan void/refund ganda.
- [x] **T15** — Guard FK klien-suplai lintas tenant, **dengan bukti tidak ada baris tersimpan**. Dibuktikan lewat sabotase.
- [x] **T16** — Kontrak OpenAPI.
- [x] **T17** — Dokumen: `CLAUDE.md`, `README.md`, `HANDOFF.md`, `modules/README.md`.

---

## 6. Non-scope

| Hal | Alasan |
|---|---|
| **FR-C3** (nonaktifkan metode online saat offline) | Server tidak tahu klien offline. Klien + F2 |
| **Polling 2 detik / 5 menit** (FR-C14) | Perilaku klien. Server menyediakan endpoint cek status; penjadwalannya di klien |
| **Laporan "Perlu diperiksa" > 24 jam** | Modul G. Datanya tersedia; laporannya tidak dibangun |
| **FR-C12, FR-C13** | P1 |
| **Modul E penuh** (stok, stocktake, oversell) | Hanya irisan `recordStockMovements` |
| **Modul F penuh** (RBAC, PIN, sesi) | Hanya irisan `recordAuditEvent` |
| **Otorisasi step-up FR-B8/B9** | Butuh PIN — Modul F |
| **UI apa pun** | Tidak ada UI di proyek ini |

---

## 7.0 Keputusan user (7 Agustus 2026)

| # | Keputusan | Konsekuensi |
|---|---|---|
| **Q1** | **Irisan minimal Modul E dan F** | Dua modul baru lahir dengan satu fungsi masing-masing: `recordStockMovements` dan `recordAuditEvent`. Restock dan audit ikut dalam transaksi void/refund (invariant #1) |
| **Q2** | **Header `X-Approver-Id`, divalidasi** | `getApproverId` lahir sejajar `getActorId`; divalidasi ke `"user"` lewat SELECT tunduk RLS. `CHECK` di `audit_event` menegakkan aktor ≠ penyetuju — jadi database ikut menjaga, bukan hanya aplikasi |
| **Q3** | **B-3 dulu** | Void & refund dikerjakan lebih dulu; C-2 menyusul di sub-project terpisah |
| **Q4** | **Endpoint webhook + verifikasi signature, diuji payload buatan** | Seluruh jalur kode teruji tanpa jaringan. Verifikasi end-to-end dengan tunnel adalah langkah manual user, dicatat di `HANDOFF.md` sebagai gap yang diketahui |

**Q5 (`payment` negatif) belum diputuskan** — aku akan memeriksanya saat implementasi dan melaporkan temuannya, sesuai §7 Q5.

## 7. Keputusan yang kubutuhkan

### Q1 — Void butuh `stock_movement` dan `audit_event`. **MEMBLOKIR.**

Keputusanmu 1 Agu menuntut restock otomatis dan audit; keduanya milik modul yang belum ada, dan invariant #1 menuntutnya satu transaksi.

**(a) Bangun irisan minimal keduanya** — `recordStockMovements` dan `recordAuditEvent`, satu fungsi masing-masing. Pola yang sama dengan `cash` dan `identity` sebelumnya. **Rekomendasi saya.**
**(b) Void tanpa restock dulu.** Melanggar keputusanmu sendiri, dan stok akan salah sejak void pertama. Tidak saya sarankan.
**(c) Bangun Modul E dan F penuh lebih dulu.** Menggeser urutan roadmap jauh ke depan.

### Q2 — Dari mana `approved_by` refund datang? **MEMBLOKIR.**

Refund **selalu** butuh persetujuan manajer (`spec-b:278`, ditandai tidak dapat diubah), dan `audit_event` menolak aktor menyetujui dirinya sendiri lewat CHECK. Tapi PIN dan sesi ada di Modul F.

**(a) Header `X-Approver-Id`**, divalidasi ke `"user"` lewat SELECT tunduk RLS — sejajar dengan `X-Actor-Id` yang sudah ada, dan CHECK database menegakkan aktor ≠ penyetuju. **Rekomendasi saya.** Placeholder sampai PIN ada.
**(b) Tunda refund sampai Modul F.** Void tetap bisa jalan (tanpa PIN), tapi kasir tidak punya jalan untuk transaksi yang sudah `closed`.

### Q3 — Urutan: B-3 dulu atau C-2 dulu?

**(a) B-3 dulu** — tanpa dependensi eksternal, menutup lubang operasional paling nyata. **Rekomendasi saya.**
**(b) C-2 dulu** — kamu baru menambahkan kredensial Midtrans, jadi mungkin ingin memverifikasinya selagi segar.
**(c) Keduanya dalam satu sub-project** — lebih besar, tanpa titik verifikasi di tengah. Tidak saya sarankan.

### Q4 — Webhook Midtrans butuh URL publik

Midtrans mengirim notifikasi ke URL yang dapat dijangkau internet. Di mesin lokal itu butuh tunnel (ngrok atau sejenisnya), dan **itu di luar kendali saya** — aku tidak akan memasang atau menjalankan tunnel tanpa kamu minta.

**(a) Bangun endpoint webhook + verifikasi signature, uji dengan payload buatan.** Integrasi sungguhannya kamu verifikasi manual dengan tunnel. **Rekomendasi saya** — jalur kodenya teruji penuh tanpa bergantung jaringan.
**(b) Andalkan polling saja**, tanpa webhook. Lebih lambat dan lebih boros kuota, tapi tidak butuh URL publik.

### Q5 — `payment` negatif untuk refund

`spec-b:230` menulis refund membuat "**`payment` negatif**". Tapi `payment.amount` punya `CHECK (amount > 0)` di skema (`0008_payment.sql`).

Keduanya tidak bisa benar bersamaan. Kemungkinan besar maksudnya arah negatif dinyatakan lewat baris `refund` yang terpisah, dan skema memang mencegah amount negatif dengan sengaja. **Aku akan memeriksanya saat implementasi dan melaporkan** — kalau ternyata skema yang perlu berubah, itu keputusanmu, bukan keputusanku.

### Risiko

- **Rahasia.** `MIDTRANS_SERVER_KEY` tidak boleh muncul di log, pesan error, respons API, atau file yang ter-commit. AC FR-C5 sudah menuntut redaksi log; aku akan memperlakukan key gateway dengan aturan yang sama.
- **Dua modul baru lahir dengan satu fungsi.** Pola ini sudah empat kali terjadi dan selalu benar, tapi tiap kali ia menambah permukaan yang harus dijaga invariant #4.
- **`refund.approved_by` tanpa FK.** Kelas yang sudah menggigit dua kali. Akan divalidasi lewat SELECT tunduk RLS, dan dibuktikan lewat sabotase.
- **B-3 menyentuh jalur uang yang sudah hidup.** Void dan refund mengubah status order yang sudah bisa dibayar; setiap perubahan di sana berdampak ke test pembayaran yang baru hijau.
