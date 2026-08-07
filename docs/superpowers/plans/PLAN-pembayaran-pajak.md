# PLAN — F1 Modul C (Pembayaran & Pajak), sub-project 1: TaxCalculator, urutan hitung, pembayaran tunai

Status: **selesai.** Empat keputusan di §8 sudah dijawab user — lihat §8.0. T1–T4 dikerjakan di PR #5 (keputusan Q1).

---

## 1. Ringkasan audit

1. Modul C punya **14 FR dan 66 acceptance criteria** — lebih besar dari Modul B. Tidak muat dalam satu sub-project.
2. `tax_rate` (`0005_tax.sql`) dan `payment` (`0008_payment.sql`) **sudah ada** sejak F0, lengkap dengan RLS. Tidak ada tabel baru.
3. `payment` sudah melarang data kartu: tidak ada kolom PAN/CVV, dan `card_last4` punya `CHECK (length <= 4)`. **FR-C5 sudah ditegakkan skema sejak F0.**
4. **FR-C8 menetapkan urutan perhitungan yang berbeda dari yang sudah saya bangun.** Ini temuan utama — lihat §2.
5. **FR-C8 juga mewajibkan pembulatan di SETIAP langkah**; `computeLineTotal` yang sudah di-commit membulatkan sekali di akhir, dengan komentar yang justru membenarkan kebalikannya.
6. Modul C menutup exit criteria F1 ("pajak benar") **dan** separuh state machine Modul B yang masih menganggur (`OPEN` → `PAID` → `CLOSED`).
7. FR-C3 (nonaktifkan metode online saat offline) tidak bisa ditegakkan server — server tidak tahu klien sedang offline. Itu urusan klien + F2.
8. FR-C12 dan FR-C13 berlabel **P1**.

---

## 2. Temuan utama — cacat di kode yang sudah saya commit

**Ini bukan pekerjaan baru; ini koreksi.** Ditemukan saat membaca FR-C8, bukan dari test yang gagal.

### 2.1 `total` seharusnya TIDAK dibulatkan

> `spec-c-pembayaran-pajak.md:113-116`
> ```
> 12. total              = tax_base + tax_amount
> 13. rounding_adjustment = pembulatan (HANYA bila ada pembayaran tunai)
> 14. amount_due         = total + rounding_adjustment
> ```

Pembulatan mengenai **`amount_due`**, bukan `total`. Dan hanya **bila ada pembayaran tunai** (FR-C9): order yang dibayar 100% QRIS punya `rounding_adjustment = 0`.

`computeOrderTotals` yang sudah di-commit membulatkan `total` tanpa syarat, dan `orders.ts` menulis nilai itu ke **`order.total` maupun `order.amount_due`**.

**Dijalankan lewat contoh terhitung FR-C8 (`spec-c:133-147`):**

| | Kode sekarang | Spec |
|---|---|---|
| baris 1 | 60.000 | 60.000 ✅ |
| baris 2 | 30.000 | 30.000 ✅ |
| subtotal | 90.000 | 90.000 ✅ |
| `rounding_adjustment` | +45 | +45 ✅ |
| **`total`** | **93.600** | **93.555** ❌ |
| `amount_due` | 93.600 | 93.600 ✅ |

`total` meleset 45 rupiah, dan itu nilai yang dipakai laporan penjualan serta dasar pelaporan pajak. `amount_due` kebetulan benar hanya karena kasus contoh dibayar tunai.

### 2.2 Pembulatan per langkah

> `spec-c:126` — "Semua nilai uang dibulatkan ke rupiah utuh (`bigint`) **pada setiap langkah**, memakai *half-up*. Alasan: menyimpan pecahan lalu membulatkan di akhir menghasilkan total yang tidak sama dengan jumlah baris yang tercetak di struk — dan merchant akan menemukannya."

`computeLineTotal` membulatkan sekali di akhir, dengan komentar yang menyebut itu lebih baik karena menghindari akumulasi galat. **Komentar itu bertentangan dengan spec**, dan spec menyertakan alasannya.

Selisihnya nyata, bukan teoretis. `unit_price` 3.333, qty 0,5, modifier 3.333 qty 1:

- Spec: langkah 1 → 1.666,5 → **1.667**; langkah 2 → 1.666,5 → **1.667**; total **3.334**
- Kode sekarang: satu pembulatan di akhir → **3.333**

Hanya muncul pada kuantitas pecahan — yang UI v1 tidak hasilkan, tapi FR-B4 wajibkan dapat disimpan lewat API.

---

## 3. Milestone yang dipilih

**F1 · Modul C sub-project 1 — TaxCalculator, urutan perhitungan, dan pembayaran tunai.**

> `product/ARCH-lumi-pos-v1.md:395` — **F1** | Modul catalog, ordering, **payment** · idempotency · append-only | Satu penjualan tersimpan atomik **dengan pajak benar**

Ini yang menutup F1.

Usul pemecahan Modul C:

| Sub-project | Isi | FR |
|---|---|---|
| **C-1 (plan ini)** | `TaxCalculator`, urutan hitung, pembulatan tunai, pembayaran tunai, `OPEN`→`PAID`→`CLOSED` | C6 · C7 · C8 · C9 · C11 · C1 (tunai) · C2 (tunai) · C10 |
| **C-2** | QRIS dinamis lewat Midtrans + webhook, QRIS statis, EDC, FR-C14 | C2 (sisa) · C3 · C4 · C14 |
| **C-3** | Rekonsiliasi, ekspor rekapitulasi | C12 · C13 (keduanya P1) |

---

## 4. Scope

### 4.1 Koreksi lebih dulu (§2)

- `computeOrderTotals` mengembalikan `total` **tanpa pembulatan**, plus fungsi terpisah untuk `amountDue` yang menerima informasi apakah ada pembayaran tunai.
- `computeLineTotal` membulatkan **per langkah** sesuai FR-C8, dan komentar yang keliru dihapus.
- `orders.ts` menulis `total` dan `amount_due` yang berbeda.
- Contoh terhitung `spec-c:133-147` menjadi test case, **angka per angka** (AC FR-C8 pertama).

### 4.2 `TaxCalculator` — port, bukan fungsi lepas

> `spec-c:461-467`
> ```
> TaxCalculator (port)
>   calculate(order_draft, outlet_config, channel) → TaxBreakdown
> TaxBreakdown
>   lines: [{ tax_rate_id, name, rate, base, amount, is_inclusive }]
>   total_tax: bigint
> ```

Hidup di `packages/domain` sebagai **fungsi murni** — menerima daftar `TaxRate` yang sudah di-resolve, tidak melakukan I/O. Resolusi `TaxRate` dari database adalah tugas modul `payment`.

Alasan pemisahan itu: klien harus menghitung pajak yang sama saat offline, dan `ARCH:106` memang menyebut "Hitung total lewat TaxCalculator versi klien".

**Invariant #7 ditegakkan test**: pencarian regex atas `0.1`, `0.11`, `10%`, `11%` di jalur perhitungan di luar modul pajak harus nihil (AC FR-C11 pertama), dengan sentinel supaya guard-nya sendiri tidak lolos vakum.

### 4.3 Resolusi `TaxRate` (FR-C6, FR-C7)

Yang lebih spesifik menang: `item` > `category` > `all_items`; seri → `outlet_id` terisi menang atas `null`; channel spesifik menang atas `all`. Efektif pada `effective_from <= at < effective_to`.

Waktu diambil dari **jam database**, bukan `new Date()` — pelajaran bug dua-jam di `prices.ts`.

### 4.4 Pembayaran tunai (FR-C1, FR-C2 baris tunai)

`POST /orders/{id}/payments`, `method = 'cash'`. Satu order boleh banyak payment.

- `OPEN` → `PAID` hanya bila `SUM(payment.amount WHERE status='confirmed') >= amount_due`
- Kurang bayar → tetap `OPEN`, sisa tagihan dilaporkan
- Lebih bayar tunai → `change_amount`, bukan payment negatif
- Transisi lewat `assertTransition` dari `packages/domain` — bukan `if` di handler
- `PAID` → `CLOSED` otomatis

### 4.5 Snapshot pajak di `order_line`

`tax_rate_id`, `tax_rate`, `tax_amount`, `is_tax_inclusive` diisi dari hasil `TaxCalculator` — snapshot, bukan referensi (FR-B3). Mengubah tarif tidak boleh mengubah transaksi lama (AC FR-C6 kedua).

---

## 5. Non-scope

| Hal | Alasan |
|---|---|
| **QRIS dinamis, Midtrans, webhook** | C-2. Butuh integrasi eksternal dan kredensial sandbox |
| **QRIS statis, EDC** | C-2 |
| **FR-C3** (nonaktifkan metode online saat offline) | Server tidak tahu klien offline. Klien + F2 |
| **FR-C14** (gateway gagal di tengah) | Butuh gateway lebih dulu |
| **FR-C12, FR-C13** | P1 |
| **Void & refund** | Modul B sub-project 3 |
| **`stock_movement`** | Modul E |
| **`audit_event`** | Modul F |
| **Struk tercetak** (FR-C10 sisi cetak) | Printer F4. Yang dibangun: data rinciannya tersedia dan dapat ditelusuri |
| **UI apa pun** | Tidak ada UI di proyek ini |

---

## 6. Task breakdown — urutan TDD

Koreksi lebih dulu, supaya fondasinya benar sebelum pajak menumpuk di atasnya:

- [ ] **T1** — `computeLineTotal` membulatkan per langkah (FR-C8 langkah 1–5). Property test: kuantitas pecahan menghasilkan angka yang sama dengan urutan spec.
- [ ] **T2** — `computeOrderTotals` mengembalikan `total` tanpa pembulatan; `amountDue` jadi perhitungan terpisah yang bergantung pada ada-tidaknya pembayaran tunai. Test: order non-tunai → `rounding_adjustment = 0` dan `amount_due = total`.
- [ ] **T3** — Contoh terhitung `spec-c:133-147` sebagai test, **angka per angka**.
- [ ] **T4** — `orders.ts` menulis `total` dan `amount_due` yang berbeda; test membuktikan keduanya tidak lagi identik saat ada pembulatan.

Lalu pajak:

- [x] **T5** — `TaxCalculator` di `packages/domain`: fungsi murni, `TaxBreakdown`. Property test: eksklusif menambah total, **inklusif tidak menambah total** (AC FR-C8 ketiga).
- [x] **T6** — Pajak inklusif dan eksklusif dalam satu order dihitung terpisah lalu dijumlahkan (AC FR-C8 keempat).
- [x] **T7** — Guard invariant #7: regex atas angka tarif di luar modul pajak, dengan sentinel.
- [x] **T8** — REST `tax_rate`: buat, daftar, arsip lewat `effective_to`. Guard FK klien-suplai lintas tenant untuk `outlet_id` dan `applies_to_ids` — **dengan bukti tidak ada baris tersimpan.**
- [x] **T9** — Resolusi FR-C6: `item` > `category` > `all_items`, `outlet_id` menang atas `null`. Property test atas matriks kombinasi.
- [x] **T10** — Resolusi FR-C7: channel spesifik menang atas `all`.
- [x] **T11** — Tarif 0% berbeda dari tidak-ada-tarif (AC FR-C6 kelima) — yang pertama menghasilkan baris `TaxBreakdown`, yang kedua tidak.
- [x] **T12** — Snapshot pajak di `order_line`; mengubah tarif tidak mengubah order lama.

Lalu pembayaran tunai:

- [x] **T13** — `POST /orders/{id}/payments` tunai, dalam satu transaksi bersama perubahan status order.
- [x] **T14** — `OPEN` → `PAID` hanya bila `SUM(confirmed) >= amount_due`; kurang bayar tetap `OPEN`.
- [x] **T15** — Lebih bayar tunai → `change_amount`; lebih bayar non-tunai ditolak.
- [x] **T16** — Transisi ilegal ditolak lewat `assertTransition`, bukan `if` di handler.
- [x] **T17** — Idempotency untuk pembayaran — retry tidak boleh menghasilkan pembayaran ganda.
- [x] **T18** — Kontrak OpenAPI.
- [x] **T19** — Dokumen: `CLAUDE.md`, `README.md`, `HANDOFF.md`, `modules/README.md`.

---

## 7. Definition of done

- [ ] Contoh terhitung FR-C8 lolos angka per angka
- [ ] Setiap langkah menghasilkan `bigint`; **tidak ada float di jalur perhitungan mana pun** — diuji sebagai property
- [ ] Pajak inklusif tidak menambah total
- [ ] Invariant #7 ditegakkan test, bukan review
- [ ] `total` tidak dibulatkan; `amount_due` dibulatkan hanya saat ada tunai
- [ ] Pajak tidak berubah oleh pembulatan
- [ ] Isolasi tenant diuji untuk setiap FK klien-suplai baru, **dengan bukti tidak ada baris tersimpan**
- [ ] Idempotensi pembayaran diuji dengan retry berulang
- [ ] Snapshot pajak kebal perubahan tarif
- [ ] Seluruh suite hijau, output ditempel apa adanya

Yang **tidak** bisa dicentang: audit event (Modul F), stok (Modul E), struk tercetak (F4), perilaku offline penuh (F2).

---

## 8.0 Keputusan user (6 Agustus 2026)

| # | Keputusan | Konsekuensi |
|---|---|---|
| **Q1** | **Perbaiki cacat `total` di PR #5 sebelum merge** | T1–T4 dikerjakan di branch `f1-ordering-fondasi`, bukan di sini. `main` tidak pernah memuat perhitungan `total` yang salah |
| **Q2** | **Ikuti spec — bulatkan per langkah** | `computeLineTotal` diubah; komentar yang membenarkan kebalikannya dihapus |
| **Q3** | **Pajak + pembayaran tunai** | C-1 menutup exit criteria F1 sekaligus menghidupkan `OPEN`→`PAID`→`CLOSED` |
| **Q4** | **Bangun data rincian struk sekarang** | `TaxBreakdown` memuat nama, tarif, dasar, dan nominal per baris; pencetakan menunggu F4 |

Karena Q1, **T1–T4 pindah ke PR #5** dan tidak lagi jadi bagian sub-project ini. Plan ini dimulai dari T5.

### Konsekuensi Q1 pada pembulatan di PR #5

Order yang baru dibuat **belum punya pembayaran apa pun**. FR-C9 menetapkan pembulatan hanya berlaku bila ada pembayaran tunai — jadi di PR #5 yang benar adalah:

```
total              = tax_base + tax_amount   (tanpa pembulatan)
rounding_adjustment = 0
amount_due         = total
```

Pembulatan baru masuk bersama pembayaran, di C-1. Karena itu `roundingIncrement` **dikeluarkan** dari `computeOrderTotals` — bukan disimpan menganggur.

## 8. Keputusan yang kubutuhkan

### Q1 — Cacat `total` (§2.1): perbaiki di PR #5 atau di sini? **MEMBLOKIR.**

PR #5 sedang terbuka dan menulis `order.total` yang meleset. CI-nya belum pernah hijau karena insiden GitHub Actions, jadi belum ada yang ter-merge.

**(a) Perbaiki di PR #5 sebelum merge.** Tidak ada commit yang pernah menulis `total` salah ke `main`. **Rekomendasi saya** — ini jalur uang, dan memperbaikinya sekarang lebih murah daripada menjelaskan nanti kenapa laporan penjualan meleset.
**(b) Merge PR #5 apa adanya, perbaiki di C-1.** PR #5 tetap kecil dan fokus, tapi `main` sempat memuat perhitungan `total` yang salah.

### Q2 — Pembulatan per langkah (§2.2): spec menang?

`spec-c:126` mewajibkan pembulatan di setiap langkah dan menyertakan alasannya. Kode saya membulatkan sekali di akhir.

Usul saya: **ikuti spec.** Tapi ini mengubah kode yang sudah di-commit dan menyentuh aritmetika uang, jadi saya angkat alih-alih diam-diam menggantinya. Kalau kamu justru lebih suka pembulatan tunggal, `spec-c:126` yang perlu diperbarui — dan itu keputusanmu, bukan saya.

### Q3 — Scope C-1: pembayaran tunai ikut atau pajak saja?

**(a) Pajak + pembayaran tunai** (seperti plan ini). Menutup exit criteria F1 sekaligus menghidupkan `OPEN`→`PAID`→`CLOSED`. Lebih besar, tapi "pajak benar" tanpa pembayaran tidak benar-benar membuktikan apa pun. **Rekomendasi saya.**
**(b) Pajak saja.** Lebih kecil dan cepat diverifikasi, tapi F1 tetap terbuka sampai sub-project berikutnya.

### Q4 — FR-C10 rincian struk: sekarang atau bersama printer?

FR-C10 menuntut rincian yang dapat ditelusuri — tiap baris pajak dengan nama dari `TaxRate.name`, bukan string hardcode. Datanya bisa dibangun sekarang; pencetakannya butuh F4.

**(a) Bangun datanya sekarang**, cetak di F4. Rekomendasi saya — `TaxBreakdown` memang sudah memuatnya.
**(b) Tunda seluruhnya ke F4.**

### Risiko

- **Ini menyentuh aritmetika uang yang sudah dipakai jalur penjualan.** Setiap perubahan di `money.ts` berdampak ke order yang sudah bisa dibuat. Property test yang ada harus tetap hijau, dan yang berubah harus berubah karena spec, bukan karena implementasi.
- **`tax_rate.applies_to_ids` adalah `text[]` tanpa FK.** Sama seperti `price_history.changed_by`: tidak ada apa pun di database yang menjaganya. Perlu validasi eksplisit lewat SELECT yang tunduk RLS, dan ia menunjuk tabel milik modul `catalog`.
- **PR #5 belum terverifikasi CI** akibat insiden GitHub Actions. Plan ini menumpuk di atasnya; kalau PR #5 berubah, pekerjaan ini ikut bergeser.
