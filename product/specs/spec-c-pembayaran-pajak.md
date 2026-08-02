# Spec Modul C — Pembayaran & Pajak

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul C · **Riset:** `/research/06-PAYMENTS-AND-FISCAL.md`

> ⚠️ **Modul dengan risiko hukum tertinggi.** Salah menghitung pajak bukan bug yang diperbaiki di rilis berikutnya — merchant menghadapi masalah hukum. Verifikasi OQ-04 dan OQ-05 ke konsultan pajak wajib selesai sebelum merchant berbayar pertama.

---

## C.0 Ringkasan modul

Modul ini bertanggung jawab atas: menghitung total transaksi (diskon → service charge → pajak → pembulatan), menerima pembayaran dalam berbagai metode termasuk campuran, dan menyediakan titik ekstensi untuk yurisdiksi lain.

**Invariant yang tidak boleh dilanggar:**

1. `order.total` = `SUM(order_line.line_total)` − diskon order + service charge + pajak + pembulatan.
2. `SUM(payment.amount)` ≥ `order.total` untuk order berstatus `PAID`.
3. Tidak ada konstanta tarif pajak di luar `TaxCalculator`.
4. Tidak ada kolom mana pun yang menyimpan PAN, CVV, PIN kartu, atau data track.
5. Pembulatan tunai tidak mengubah dasar pengenaan pajak.

---

## C.1 Model pajak

### FR-C6 [P0] — `TaxRate` sebagai entitas

**Deskripsi.** Tarif pajak adalah entitas berdata, bukan konstanta. Satu outlet dapat memiliki beberapa `TaxRate` aktif untuk kategori produk yang berbeda.

**Struktur.**

| Field | Tipe | Catatan |
|---|---|---|
| `id` | ulid | |
| `tenant_id` | ulid | RLS |
| `outlet_id` | ulid nullable | `null` = berlaku untuk seluruh tenant |
| `name` | text | Teks yang **dicetak di struk**, mis. `"PBJT 10%"` |
| `type` | enum | `pbjt` · `ppn` · `service_charge` · `none` |
| `rate` | numeric(6,4) | `0.1000` = 10% |
| `is_inclusive` | boolean | `true` = sudah termasuk dalam harga |
| `phase` | enum | `subtotal` · `total` — menentukan urutan (lihat C.2) |
| `jurisdiction` | text nullable | Kode daerah, untuk pelaporan |
| `channel` | enum | `all` · `dine_in` · `takeaway` — **default `all`** (FR-C7) |
| `applies_to` | enum | `all_items` · `category` · `item` |
| `applies_to_ids` | ulid[] | Diisi bila `applies_to` ≠ `all_items` |
| `effective_from` | timestamptz | |
| `effective_to` | timestamptz nullable | `null` = masih berlaku |

**Aturan.**

- Ketika perda mengubah tarif, tarif lama **tidak dihapus** — `effective_to` diisi dan record baru dibuat. Transaksi historis tetap benar lewat snapshot di `order_line`.
- Bila dua `TaxRate` cocok untuk satu item pada waktu yang sama, yang lebih spesifik menang: `item` > `category` > `all_items`. Bila masih seri, `outlet_id` terisi menang atas `null`.
- Bila tidak ada `TaxRate` yang cocok, pajak = 0 dan baris pajak **tidak dicetak** di struk.

**Acceptance criteria.**

- [ ] Membuat `TaxRate` dengan `effective_to` di masa lalu tidak memengaruhi transaksi baru
- [ ] Mengubah tarif tidak mengubah nilai pajak pada transaksi yang sudah tersimpan
- [ ] Resolusi konflik `item` > `category` > `all_items` terverifikasi test
- [ ] Nama pajak yang tercetak di struk berasal dari `TaxRate.name`, bukan string hardcode
- [ ] Tarif 0% berbeda dari "tidak ada pajak": 0% mencetak baris `"PPN 0%  Rp 0"`, tidak-ada-pajak tidak mencetak baris

---

### FR-C7 [P0] — Channel sebagai dimensi pajak

**Deskripsi.** `TaxRate.channel` mendukung `all` / `dine_in` / `takeaway`, dengan **default `all`**.

**Alasan** (dari OQ-05, keputusan asimetris): membangun kapabilitasnya sekarang berbiaya satu kolom dan satu kondisi. Tidak membangunnya, bila jawaban hukum ternyata "berbeda", berbiaya migrasi model pajak pada sistem yang sudah memegang data finansial pelanggan.

**Behavior.**

```
GIVEN order memiliki channel = 'takeaway'
  AND terdapat TaxRate A (channel='all', rate=0.10)
  AND terdapat TaxRate B (channel='takeaway', rate=0.11)
WHEN pajak dihitung
THEN TaxRate B dipakai (channel spesifik menang atas 'all')
```

**Acceptance criteria.**

- [ ] `channel` default `all` saat `TaxRate` dibuat tanpa menyebutkannya
- [ ] Order menyimpan `channel` yang dipakai saat perhitungan
- [ ] Channel spesifik menang atas `all`
- [ ] Mengubah semua tarif dari `all` ke per-channel dapat dilakukan **tanpa migrasi data transaksi**

**Sumber channel.** `Order.channel` diisi dari `SegmentedControl` Dine In/Takeaway di layar kasir. Untuk vertikal retail (v1.3), channel selalu `takeaway`.

---

## C.2 Urutan perhitungan

### FR-C8 [P0] — Urutan perhitungan total

**Deskripsi.** Urutan operasi ditetapkan dan tidak boleh diubah tanpa keputusan eksplisit, karena setiap urutan berbeda menghasilkan angka berbeda.

**Urutan wajib:**

```
1.  line_subtotal      = unit_price × quantity
2.  line_modifiers     = SUM(modifier.price × modifier.qty)
3.  line_before_disc   = line_subtotal + line_modifiers
4.  line_discount      = diskon tingkat baris
5.  line_total         = line_before_disc − line_discount
    ─────────────────────────────────────────────────────
6.  subtotal           = SUM(line_total)
7.  order_discount     = diskon tingkat order
8.  base               = subtotal − order_discount
9.  service_charge     = base × service_charge_rate
10. tax_base           = base + service_charge      ← service charge KENA pajak
11. tax_amount         = tax_base × tax_rate        (bila is_inclusive = false)
12. total              = tax_base + tax_amount
    ─────────────────────────────────────────────────────
13. rounding_adjustment = pembulatan (HANYA bila ada pembayaran tunai)
14. amount_due         = total + rounding_adjustment
```

**Pajak inklusif.** Bila `is_inclusive = true`, langkah 11–12 berubah:

```
11'. tax_amount = tax_base − (tax_base ÷ (1 + tax_rate))
12'. total      = tax_base                          ← total tidak bertambah
```

**Pembulatan per baris.** Semua nilai uang dibulatkan ke rupiah utuh (`bigint`) **pada setiap langkah**, memakai *half-up*. Alasan: menyimpan pecahan lalu membulatkan di akhir menghasilkan total yang tidak sama dengan jumlah baris yang tercetak di struk — dan merchant akan menemukannya.

**Contoh terhitung — wajib dijadikan test case:**

Pesanan: 2× Kopi Susu @ Rp 25.000 (+ modifier Extra Shot Rp 5.000), 1× Croissant @ Rp 30.000.
Diskon order 10%. Service charge 5%. PBJT 10% eksklusif. Bayar tunai, pembulatan Rp 100.

| Langkah | Perhitungan | Hasil |
|---|---|---|
| Baris 1 subtotal | 25.000 × 2 | 50.000 |
| Baris 1 modifier | 5.000 × 2 | 10.000 |
| Baris 1 total | 50.000 + 10.000 | **60.000** |
| Baris 2 total | 30.000 × 1 | **30.000** |
| Subtotal | 60.000 + 30.000 | **90.000** |
| Diskon order 10% | 90.000 × 0,10 | −9.000 |
| Base | 90.000 − 9.000 | **81.000** |
| Service charge 5% | 81.000 × 0,05 | +4.050 |
| Dasar pajak | 81.000 + 4.050 | **85.050** |
| PBJT 10% | 85.050 × 0,10 | +8.505 |
| Total | 85.050 + 8.505 | **93.555** |
| Pembulatan ke Rp 100 (half-up) | 93.555 → 93.600 | +45 |
| **Yang dibayar** | | **Rp 93.600** |

**Acceptance criteria.**

- [ ] Contoh terhitung di atas lolos sebagai test case, angka per angka
- [ ] Service charge dihitung **sebelum** pajak dan **termasuk** dalam dasar pajak
- [ ] Pajak inklusif tidak menambah total
- [ ] Item dengan pajak inklusif dan eksklusif dalam satu order dihitung terpisah lalu dijumlahkan
- [ ] Diskon order didistribusikan proporsional ke baris untuk keperluan pelaporan margin, tanpa mengubah total
- [ ] Setiap langkah menghasilkan `bigint`; tidak ada float di jalur perhitungan mana pun

---

### FR-C9 [P0] — Pembulatan tunai

**Deskripsi.** Pembulatan mengubah **jumlah yang dibayar tunai**, bukan nilai transaksi dan bukan dasar pengenaan pajak.

**Konfigurasi per outlet:** `rounding_increment` (default `100`), `rounding_mode` (`half_up` default · `up` · `down`).

**Behavior.**

```
GIVEN total = 93.555 DAN rounding_increment = 100 DAN mode = half_up
WHEN order dibayar dengan metode yang mengandung tunai
THEN amount_due = 93.600
 AND order menyimpan rounding_adjustment = +45
 AND tax_amount TETAP 8.505 (tidak berubah)

GIVEN total = 93.555
WHEN order dibayar 100% non-tunai (QRIS/EDC)
THEN amount_due = 93.555
 AND rounding_adjustment = 0
```

**Pembayaran campuran.** Bila order dibayar sebagian tunai dan sebagian non-tunai, pembulatan berlaku pada **sisa yang dibayar tunai**, bukan pada total. Contoh: total 93.555, QRIS 50.000, sisa tunai 43.555 → dibulatkan menjadi 43.600, `rounding_adjustment` = +45.

**Acceptance criteria.**

- [ ] `rounding_adjustment` disimpan sebagai kolom terpisah, tidak digabung ke total
- [ ] Struk menampilkan baris "Pembulatan" terpisah bila nilainya ≠ 0
- [ ] Pajak tidak berubah oleh pembulatan — diverifikasi test
- [ ] Order non-tunai memiliki `rounding_adjustment` = 0
- [ ] Pembayaran campuran membulatkan sisa tunai, bukan total

---

## C.3 Pembayaran

### FR-C1 [P0] — Satu order, banyak payment

**Deskripsi.** `Order` 1:N `Payment`. Pembayaran campuran (tunai + QRIS) adalah alur harian di kafe Indonesia, bukan edge case.

**Struktur `Payment`.**

| Field | Tipe | Catatan |
|---|---|---|
| `id` | ulid | Client-generated |
| `order_id` / `check_id` | ulid | |
| `method` | enum | `cash` · `qris_dynamic` · `qris_static` · `card_edc` · `other` |
| `amount` | bigint | Selalu positif |
| `tendered_amount` | bigint nullable | Untuk tunai — uang yang diserahkan pelanggan |
| `change_amount` | bigint nullable | Untuk tunai — kembalian |
| `status` | enum | `pending_confirmation` · `confirmed` · `failed` · `voided` |
| `provider` | text nullable | `midtrans` dll |
| `provider_reference` | text nullable | ID transaksi gateway |
| `terminal_reference` | text nullable | EDC |
| `approval_code` | text nullable | EDC |
| `card_last4` | text nullable | **Maks 4 karakter** |
| `card_brand` | text nullable | |
| `acquirer` | text nullable | Bank penerbit EDC |
| `confirmed_manually` | boolean | `true` untuk QRIS statis |
| `mdr_estimated` | bigint nullable | Perkiraan potongan, untuk rekonsiliasi |
| `tendered_at` | timestamptz | |

**Aturan.**

- Order berpindah ke `PAID` hanya ketika `SUM(payment.amount WHERE status='confirmed')` ≥ `amount_due`.
- Kelebihan pembayaran tunai menghasilkan `change_amount`, bukan payment negatif.
- Kelebihan pembayaran non-tunai **ditolak** — tidak ada mekanisme mengembalikan kembalian non-tunai.

**Acceptance criteria.**

- [ ] Satu order dapat memiliki ≥2 payment dengan metode berbeda
- [ ] Order dengan `SUM(payment)` < `amount_due` tetap `OPEN`, sisa tagihan ditampilkan
- [ ] Kelebihan bayar non-tunai ditolak dengan pesan yang menjelaskan
- [ ] Kembalian tunai dihitung dan ditampilkan dengan tipografi `--text-display` (aturan design system)

---

### FR-C2 [P0] — Metode pembayaran v1

| Metode | Online | Offline | Catatan |
|---|---|---|---|
| **Tunai** | ✅ | ✅ | Selalu tersedia |
| **QRIS dinamis** | ✅ | ❌ | Via gateway; butuh konfirmasi issuer |
| **QRIS statis (konfirmasi manual)** | ✅ | ✅ | Merchant memakai QR statis dari banknya sendiri; kasir mengonfirmasi manual. **Dikonfirmasi didukung [OQ-15 terjawab 1 Agu 2026]** — satu-satunya metode pembayaran digital yang berfungsi offline, karena itu kontrol di bawah wajib |
| **Kartu via EDC** | ✅ | ✅ | Input manual di v1; field siap untuk integrasi ECR |
| **Lainnya** | ✅ | ✅ | Voucher fisik, transfer, dll — dengan catatan wajib |

**QRIS statis — kontrol yang wajib menyertainya** (mitigasi risiko fraud, karena kasir mengonfirmasi tanpa verifikasi sistem):

- Field referensi **wajib** diisi (nominal + 4 digit terakhir nomor referensi, atau catatan).
- `confirmed_manually = true` disimpan.
- Struk mencetak penanda bahwa pembayaran dikonfirmasi manual.
- Masuk laporan exception per kasir (Modul G, FR-G5).

**Acceptance criteria.**

- [ ] QRIS statis wajib mengisi field referensi sebelum dapat dikonfirmasi
- [ ] Pembayaran `confirmed_manually` dapat difilter di laporan
- [ ] Metode yang tidak tersedia offline ditangani sesuai FR-C3

---

### FR-C3 [P0] — Metode online-only dinonaktifkan saat offline

**Deskripsi.** QRIS dinamis membutuhkan konfirmasi issuer dan tidak mungkin offline. Yang salah adalah membiarkan kasir memilihnya lalu gagal; yang benar adalah menonaktifkannya dengan alasan yang terbaca.

**Behavior.**

```
GIVEN perangkat offline
WHEN kasir membuka layar pembayaran
THEN metode QRIS dinamis tampil dalam keadaan nonaktif
 AND disertai teks "Perlu internet"
 AND TIDAK disembunyikan — kasir harus tahu metode itu ada dan mengapa tidak bisa dipakai
 AND metode tunai, QRIS statis, kartu (EDC), dan lainnya tetap aktif

GIVEN koneksi pulih saat layar pembayaran terbuka
WHEN status berubah
THEN metode QRIS dinamis aktif kembali tanpa perlu menutup layar
```

**Acceptance criteria.**

- [ ] Metode online-only tampil nonaktif dengan alasan, bukan disembunyikan
- [ ] Tidak ada jalur yang memungkinkan kasir memilih QRIS dinamis saat offline lalu gagal
- [ ] Metode aktif kembali otomatis saat koneksi pulih
- [ ] Status mengikuti aturan design system: tidak pernah warna saja, selalu ada teks

---

### FR-C14 [P0] — Alur pembayaran gateway yang gagal di tengah

**Deskripsi.** Kelas bug yang paling sering menghasilkan uang hilang di POS: POS meminta QR, gateway timeout, pelanggan **sudah membayar**, POS tidak tahu.

**State machine `Payment` untuk QRIS dinamis:**

```
[Kasir pilih QRIS] → POST ke gateway (idempotency key)
        │
        ├─ Respons OK ──► status = pending_confirmation
        │                        │
        │                  [Polling tiap 2 dtk, maks 5 menit]
        │                        │
        │            ┌───────────┼───────────┬──────────────┐
        │            ▼           ▼           ▼              ▼
        │        confirmed    failed    expired      timeout polling
        │            │           │           │              │
        │            ▼           ▼           ▼              ▼
        │      Order PAID   Batalkan   Batalkan    status TETAP
        │                   payment    payment     pending_confirmation
        │                                          + masuk daftar
        │                                            "Perlu diperiksa"
        │
        └─ Timeout/error ──► status = pending_confirmation
                             + tombol "Cek status"
                             (JANGAN buat request baru — pakai
                              idempotency key yang sama)
```

**Aturan mutlak:**

- Sistem **tidak pernah** menandai pembayaran lunas tanpa konfirmasi dari gateway.
- Kasir **tidak dapat** menutup order sebagai `PAID` selama ada payment `pending_confirmation` — kecuali dengan otorisasi manajer dan alasan tertulis.
- Payment yang tetap `pending_confirmation` setelah 24 jam masuk laporan "Perlu diperiksa" di dashboard owner.

**Acceptance criteria.**

- [ ] Retry pembayaran memakai idempotency key yang sama, tidak membuat transaksi gateway baru
- [ ] Kasir dapat menutup layar dan kembali; payment `pending_confirmation` tetap ada dan dapat dicek ulang
- [ ] Aplikasi mati di tengah polling → setelah restart, payment masih `pending_confirmation` dan polling dilanjutkan
- [ ] Ada laporan payment `pending_confirmation` berumur > 24 jam

---

### FR-C4 [P0] — Pembayaran EDC

**Deskripsi.** Kartu ditangani terminal EDC bersertifikat. POS hanya mencatat hasilnya.

**Behavior.**

```
GIVEN kasir memilih metode "Kartu (EDC)"
WHEN layar input muncul
THEN sistem meminta: nominal, approval code, 4 digit terakhir, acquirer
 AND approval code WAJIB diisi
 AND 4 digit terakhir bersifat opsional
 AND field bernama "nomor kartu lengkap" TIDAK ADA di mana pun
```

**Acceptance criteria.**

- [ ] Tidak ada input yang menerima lebih dari 4 digit nomor kartu
- [ ] Approval code wajib; pembayaran tidak dapat dikonfirmasi tanpanya
- [ ] Field `terminal_reference`, `approval_code`, `card_last4`, `acquirer` tersimpan dan siap diisi otomatis saat integrasi ECR

---

### FR-C5 [P0] — Larangan data kartu

**Deskripsi.** Larangan tingkat skema dan tingkat kode.

**Acceptance criteria.**

- [ ] Migrasi database ditolak review bila menambah kolom yang dapat menampung PAN
- [ ] `card_last4` memiliki constraint `length ≤ 4`
- [ ] Lapisan logging meredaksi payload pembayaran secara otomatis — diverifikasi test yang mengirim payload berisi pola nomor kartu dan memeriksa log
- [ ] Tidak ada field bebas (`notes`, `reference`) yang divalidasi menerima 13–19 digit berurutan tanpa peringatan

---

## C.4 Struk

### FR-C10 [P0] — Rincian struk yang dapat ditelusuri

**Deskripsi.** Struk harus dapat diverifikasi baris demi baris oleh pelanggan dan auditor pajak.

**Struktur wajib:**

```
        [Nama Merchant]
        [Alamat outlet]
        ────────────────────────
        K1-20260726-0007
        26 Jul 2026  14:32
        Kasir: Sari
        Takeaway
        ────────────────────────
        2× Kopi Susu        50.000
           + Extra Shot     10.000
        1× Croissant        30.000
        ────────────────────────
        Subtotal            90.000
        Diskon           −   9.000
        Service 5%       +   4.050
        PBJT 10%         +   8.505
        Pembulatan       +      45
        ────────────────────────
        TOTAL               93.600
        Tunai              100.000
        Kembali              6.400
        ────────────────────────
```

**Aturan.**

- Baris pajak memakai `TaxRate.name` (mis. `"PBJT 10%"`), tidak pernah string generik `"Pajak"`.
- Baris dengan nilai 0 **tidak dicetak**, kecuali pajak 0% yang eksplisit dikonfigurasi.
- Angka uang rata kanan dengan `tabular-nums`.
- Format mengikuti aturan design system: titik ribuan, tanpa desimal, minus di depan.

**Acceptance criteria.**

- [ ] Struk contoh di atas dapat direproduksi persis dari data test
- [ ] `SUM` baris yang tercetak = total yang tercetak (tidak ada selisih pembulatan tersembunyi)
- [ ] Nama pajak berasal dari konfigurasi
- [ ] Struk tercetak benar pada lebar 58mm (32 karakter) dan 80mm (48 karakter)

---

## C.5 Rekonsiliasi & pelaporan

### FR-C12 [P1] — Rekonsiliasi pembayaran digital

**Deskripsi.** MDR dipotong di sisi settlement, sehingga yang masuk rekening merchant lebih kecil dari nilai transaksi. Tanpa ditampilkan, merchant mengira ada uang hilang.

**Tarif MDR untuk estimasi** (`[FAKTA]` per 15 Maret 2025, dapat dikonfigurasi):

| Kategori merchant | MDR |
|---|---|
| UMI, transaksi ≤ Rp 500.000 | 0% |
| UMI, transaksi > Rp 500.000 | 0,3% |
| UKE / UME / UBE | 0,7% |

**Acceptance criteria.**

- [ ] Laporan menampilkan nilai transaksi **dan** perkiraan settlement berdampingan
- [ ] Angka settlement ditandai sebagai **perkiraan**, bukan nilai final
- [ ] Kategori merchant dapat dikonfigurasi per tenant

---

### FR-C13 [P1] — Ekspor rekapitulasi penjualan

**Deskripsi.** Menggantikan integrasi API Coretax (OQ-04). Merchant atau akuntannya memakai hasil ekspor untuk pelaporan.

**Isi ekspor (CSV + XLSX):** periode · outlet · jumlah transaksi · omzet kotor · total diskon · total service charge · **total pajak dipisah per `TaxRate.name` dan per `jurisdiction`** · total pembulatan · omzet bersih · rincian per metode pembayaran.

**Acceptance criteria.**

- [ ] Pajak dipisah per jenis dan yurisdiksi, bukan satu angka gabungan
- [ ] Total di ekspor cocok dengan laporan penjualan pada periode yang sama
- [ ] Ekspor mencantumkan tanggal dibuat dan rentang periode di dalam file

---

## C.6 Titik ekstensi

### FR-C11 [P0] — `TaxCalculator` sebagai satu-satunya sumber logika pajak

**Struktur port:**

```
TaxCalculator (port)
  calculate(order_draft, outlet_config, channel) → TaxBreakdown
  
TaxBreakdown
  lines: [{ tax_rate_id, name, rate, base, amount, is_inclusive }]
  total_tax: bigint
```

**Aturan.** Layar kasir, laporan, struk, dan ekspor **membaca** hasil `TaxCalculator`; tidak satu pun menghitung sendiri.

**Acceptance criteria.**

- [ ] Pencarian regex terhadap angka tarif (`0.1`, `0.11`, `10%`, `11%`) di luar modul pajak tidak menemukan hasil di jalur perhitungan
- [ ] Mengganti implementasi `TaxCalculator` tidak memerlukan perubahan di layar kasir

---

### Port lain yang disiapkan (implementasi trivial di v1)

| Port | v1 | Untuk apa nanti |
|---|---|---|
| `PaymentProvider` | Adapter Midtrans | Xendit, ECR/EDC, gateway milik merchant enterprise |
| `SigningHook` | **No-op** | TSE Jerman, fiscalization real-time bila muncul di Indonesia [OQ-04] |
| `ReceiptRenderer` | ESC/POS | Printer fiskal Italia (RT), format struk alternatif |

**Aturan penempatan.** `SigningHook` dipanggil **setelah** transaksi commit dan **sebelum** `ReceiptRenderer`. Satu titik terpusat — bukan logika cetak yang tersebar di banyak layar. Menambahkannya belakangan pada sistem yang tersebar adalah pekerjaan berminggu-minggu.

**Acceptance criteria.**

- [ ] `SigningHook` dipanggil pada setiap transaksi meskipun implementasinya no-op
- [ ] Urutan commit → sign → render terverifikasi test

---

## C.7 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Order Rp 0 (penggantian barang rusak) | Diizinkan dengan alasan wajib; tidak ada payment; langsung `PAID`; tercatat di audit |
| Diskon 100% | Diizinkan dengan otorisasi manajer; pajak = 0; masuk exception report |
| Diskon melebihi subtotal | **Ditolak** — diskon maksimum = subtotal |
| Service charge tanpa pajak | Valid; `tax_base` = `base` + service charge, pajak 0 |
| Dua `TaxRate` cocok dengan spesifisitas sama | Ambil `effective_from` terbaru; bila masih seri, tolak konfigurasi saat disimpan |
| `TaxRate` kedaluwarsa di tengah shift | Transaksi memakai tarif yang berlaku pada `occurred_at`, bukan waktu sinkronisasi |
| Pelanggan bayar QRIS, gateway konfirmasi setelah order ditutup | Payment tercatat; bila order sudah `PAID` dengan metode lain, masuk daftar "Perlu diperiksa" — **tidak** otomatis refund |
| Perangkat offline, kasir salah pilih QRIS dinamis | Metode tidak dapat dipilih; tidak ada jalur yang menghasilkan state ini |
| Nominal pembayaran melebihi `bigint` wajar (mis. salah ketik 999.999.999) | Peringatan konfirmasi di atas ambang yang dapat dikonfigurasi (default Rp 10.000.000) |
| Pembulatan menghasilkan `amount_due` < total karena mode `down` | Diizinkan; selisih negatif tercatat sebagai `rounding_adjustment` negatif |

---

## C.8 Test yang wajib ada

**Property test (invariant):**

- [ ] Untuk order apa pun: `total` = `SUM(line_total)` − diskon + service + pajak
- [ ] Untuk order apa pun: `SUM(payment.amount)` − `change_amount` = `amount_due` bila `PAID`
- [ ] Untuk urutan operasi apa pun: pajak tidak pernah berubah akibat pembulatan
- [ ] Untuk konfigurasi tarif apa pun: pajak inklusif tidak menambah total

**Test contoh (regresi):**

- [ ] Contoh terhitung C.2 lolos angka per angka
- [ ] Pembayaran campuran tunai + QRIS dengan pembulatan hanya pada sisa tunai
- [ ] Pajak inklusif dan eksklusif dalam satu order

**Test kegagalan:**

- [ ] Gateway timeout → `pending_confirmation`, bukan `PAID`
- [ ] Retry setelah respons hilang → tidak ada transaksi gateway ganda
- [ ] Aplikasi mati di tengah polling → state pulih setelah restart

---

## C.9 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| OQ-04 | Adakah kewajiban fiscalization bagi penyedia POS di Indonesia? | Merchant berbayar pertama |
| OQ-05 | Pajak dine-in versus takeaway — sama atau berbeda? | Merchant berbayar pertama |
| ~~OQ-15~~ | ✅ **Terjawab 1 Agu 2026 — YA, didukung, bersama QRIS dinamis.** Dinamis lewat API Midtrans + konfirmasi webhook (online-only); statis lewat QR cetak merchant + konfirmasi manual (berfungsi offline). Konsekuensinya kontrol anti-fraud di § "QRIS statis" di atas **wajib dibangun**, bukan opsional | — |
| — | Default `rounding_increment`: Rp 100 atau Rp 500? | Implementasi FR-C9 — tanya 3 merchant |
| — | Apakah service charge kena pajak di semua daerah? | Verifikasi konsultan pajak bersama OQ-05 |

---

*Spec Modul C · Lumi POS v1 · Draft 0.1*
