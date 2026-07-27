# Temuan Prototipe 01 — Ukuran & Performa Database Lokal

**Tanggal:** 27 Juli 2026 · **Menjawab:** OQ-07 (jendela riwayat lokal) + pertanyaan tipe kuantitas di ERD
**Skrip:** `schema.sql` · `populate.py` · `perf.py` · `threshold.py` · `snapshot2.py` · `qty_precision.py` · `qty_ledger.py`

> **Metode.** Skema SQLite lokal dibangun langsung dari `/product/ERD-lumi-pos-v1.md` (19 tabel, 14 index), diisi data sintetis pada volume operasional realistis, lalu diukur. Semua angka adalah hasil pengukuran, bukan estimasi.
>
> **Batasan yang harus diketahui.** Pengukuran dijalankan di lingkungan Linux server, bukan pada tablet kasir. Faktor tablet (3–5× lebih lambat) adalah `[ASUMSI]` dan ditandai jelas setiap kali dipakai. Data sintetis memakai distribusi yang wajar tetapi bukan data merchant nyata.

---

## Ringkasan — empat keputusan yang berubah

| # | Temuan | Dampak |
|---|---|---|
| 1 | **Kuantitas wajib `INTEGER ×1000`, bukan `REAL`** | `REAL` membuat query "stok habis" gagal dan menampilkan `-4.6e-12 kg` ke merchant |
| 2 | **OQ-07 terjawab: 90 hari aman, 180 hari juga aman** | Kafe menengah 90 hari = **78 MB**. Asumsi riset (500 MB) terlalu konservatif |
| 3 | **Ambang snapshot di ERD salah — 500.000 movement terlalu lambat** | Batas nyata ≈ **197.000** di server, **≈40.000–66.000** di tablet |
| 4 | **Snapshot stok wajib ada di v1, bukan optimasi nanti** — dan butuh index `(tenant_id, outlet_id, hlc)` | Tanpa index yang benar snapshot tidak berguna (117→112 ms). Dengan index: **117→1,1 ms, 107× lebih cepat** |

---

## 1. Tipe kuantitas — `REAL` gagal

### Perkalian tunggal: `REAL` lolos

Tujuh kasus retail (0,1 kg sampai 2,35 kg dengan harga bervariasi) — `REAL` menghasilkan nilai yang **sama persis** dengan perhitungan Decimal setelah dibulatkan ke rupiah utuh. Pembulatan ke integer menyerap galat float.

**Kesimpulan sementara yang menyesatkan:** kalau hanya menguji perkalian, `REAL` tampak aman.

### Akumulasi: `REAL` gagal

Stok adalah `SUM(delta)` pada ledger. Di sinilah galat menumpuk.

| Uji | `REAL` | `INTEGER ×1000` | Seharusnya |
|---|---|---|---|
| SUM 500 × 0,1 kg | `50.00000000000044` | `50.0` | 50,0 |
| Terima 1.000 kg → jual habis dalam 1.411 transaksi pecahan | `-4.605760217657462e-12` | `0.0` | 0 |
| SUM 500.000 movement × 0,1 | `49999.9999995529` | `50000.0` | 50.000,0 |

### Yang menentukan keputusan

```
Query "stok habis":  SELECT ... WHERE SUM(delta) = 0

  REAL       → TIDAK cocok  ← query stok habis GAGAL DIAM-DIAM
  INT ×1000  → cocok
```

Dan yang dilihat merchant di layar:

```
  REAL       : "-4.605760217657462e-12 kg"
  INT ×1000  : "0.0 kg"
```

**Keputusan: `INTEGER ×1000` di kedua sisi (PostgreSQL dan SQLite).** Kuantitas `0.5 kg` disimpan sebagai `500`. Ini menghilangkan float dari jalur kuantitas sepenuhnya, sejajar dengan aturan yang sudah berlaku untuk uang.

**Konsekuensi:** setiap pembacaan kuantitas dibagi 1000 di lapisan tampilan; setiap penulisan dikalikan 1000 di lapisan domain. Satu tempat, bukan tersebar.

---

## 2. Ukuran database lokal — OQ-07 terjawab

### Hasil pengukuran

| Skenario | Katalog | Order/hari | Hari | Order | Baris | Movement | **Ukuran** |
|---|---:|---:|---:|---:|---:|---:|---:|
| Kafe kecil | 200 produk (321 var) | 150 | 30 | 4.500 | 15.454 | 12.454 | **13,1 MB** |
| Kafe kecil | | 150 | **90** | 13.500 | 46.349 | 37.349 | **39,0 MB** |
| Kafe kecil | | 150 | 180 | 27.000 | 92.446 | 74.446 | **77,4 MB** |
| Kafe menengah | 800 produk (1.293 var) | 300 | 30 | 9.000 | 30.763 | 24.763 | **26,3 MB** |
| Kafe menengah | | 300 | **90** | 27.000 | 92.289 | 74.289 | **77,8 MB** |
| Kafe menengah | | 300 | 180 | 54.000 | 184.400 | 148.400 | **154,9 MB** |
| Kafe besar | 2.000 produk (3.203 var) | 500 | **90** | 45.000 | 154.389 | 124.389 | **130,3 MB** |

### Angka yang bisa dipakai untuk perencanaan

**≈ 3,0 KB per order** — sangat konsisten di seluruh skenario (2,9–3,0 KB). Ini termasuk order, check, order line, modifier, payment, stock movement, cash movement, audit event, dan seluruh index.

```
Ukuran DB (MB) ≈ order_per_hari × jumlah_hari × 0,003
```

### Verdict OQ-07

| Jendela | Kafe kecil | Kafe menengah | Kafe besar |
|---|---|---|---|
| 30 hari | 13 MB | 26 MB | 44 MB |
| **90 hari** | **39 MB** | **78 MB** | **130 MB** |
| 180 hari | 77 MB | 155 MB | 261 MB |
| 365 hari | 157 MB | 314 MB | 529 MB |

**Keputusan: jendela riwayat lokal 90 hari — dikonfirmasi aman.** Bahkan 180 hari muat nyaman pada perangkat kasir mana pun yang dijual hari ini. Asumsi riset "di bawah 500 MB" terlalu konservatif; angka nyatanya 39–130 MB.

**Ruang untuk keputusan lain:** karena 90 hari hanya memakai 78 MB pada kafe menengah, jendela dapat diperpanjang tanpa risiko bila kemampuan refund offline yang lebih panjang terbukti bernilai jual. Batas praktisnya adalah performa query, bukan storage — dibahas di bagian 4.

---

## 3. Komposisi ukuran — di mana byte-nya pergi

`menengah_90` (77,8 MB):

| Objek | Tipe | MB | % |
|---|---|---:|---:|
| `stock_movement` | tabel | 17,1 | 22,0% |
| `order_line` | tabel | 13,5 | 17,4% |
| `ix_mv_stock` | index | 7,9 | 10,1% |
| `order` | tabel | 7,1 | 9,1% |
| `ix_line_variation` | index | 4,4 | 5,7% |
| `payment` | tabel | 3,9 | 5,0% |
| `order_line_modifier` | tabel | 2,8 | 3,6% |
| sisanya | | 21,1 | 27,1% |
| **Total tabel** | | **48,8** | **62,8%** |
| **Total index** | | **28,9** | **37,2%** |

**Dua pengamatan:**

- **`stock_movement` + index-nya = 32% dari seluruh database.** Ini konsekuensi langsung keputusan "stok sebagai ledger" (KEP-07) dan merupakan harga yang dibayar untuk audit trail, konvergensi offline, dan metrik AvT. Harganya wajar, tetapi harus diketahui.
- **Index memakan 37%.** Semua ID adalah ULID sebagai `TEXT` (26 karakter). Menyimpannya sebagai `BLOB` 16-byte akan memangkas ukuran secara signifikan — kandidat optimasi bila suatu saat dibutuhkan, tetapi **tidak dibutuhkan sekarang** karena angka absolutnya sudah kecil.

---

## 4. Performa query

Diukur pada `cache_size` 8 MB (konservatif untuk tablet), median dari 12 kali jalan.

| Query | kecil_90 | menengah_90 | besar_90 | Target |
|---|---:|---:|---:|---|
| **Stok seluruh katalog** | 17,0 ms | 58,2 ms | **117,9 ms** | < 200 ms |
| Stok satu produk | 0,0 ms | 0,0 ms | 0,0 ms | — |
| Cari produk (LIKE) | 0,1 ms | 0,1 ms | 0,1 ms | < 150 ms |
| Scan barcode | 0,0 ms | 0,0 ms | 0,0 ms | — |
| Laporan harian | 0,0 ms | 0,0 ms | 0,1 ms | — |
| Laporan produk 30 hari | 5,7 ms | 14,3 ms | 25,1 ms | — |
| Cari struk untuk refund | 0,4 ms | 0,9 ms | 3,1 ms | — |

**Enam dari tujuh query berada jauh di bawah target** — sebagian besar di bawah 1 ms. Cold cache tidak mengubahnya secara berarti (26 ms vs 17 ms pada kasus terkecil).

**Satu query menjadi masalah: agregasi stok seluruh katalog.**

---

## 5. Ambang snapshot — angka di ERD salah

### Regresi terhadap jumlah movement

```
waktu (ms) ≈ 1,155 ms per 1.000 movement − 27

→ 200 ms tercapai pada ≈ 196.663 movement
```

| Hardware | Ambang 200 ms |
|---|---|
| Server (diukur) | ≈ 197.000 movement |
| Tablet 3× lebih lambat `[ASUMSI]` | ≈ 66.000 movement |
| Tablet 5× lebih lambat `[ASUMSI]` | ≈ 39.000 movement |

### Diterjemahkan ke waktu operasional

| Merchant | Movement/hari | 200 ms tercapai setelah (tablet 5×) |
|---|---:|---|
| Kafe kecil | 415 | ≈ 95 hari |
| Kafe menengah | 825 | ≈ **48 hari** |
| Kafe besar | 1.382 | ≈ **28 hari** |

**ERD `/product/ERD-lumi-pos-v1.md` § 16 menetapkan ambang 500.000 movement. Angka itu terlalu lambat** — kafe besar akan melewatinya dalam kurang dari sebulan, jauh sebelum mencapai 500.000.

### Snapshot memperbaikinya — dengan syarat index yang benar

Percobaan pertama menambahkan tabel snapshot **tanpa** index pada `hlc`:

```
agregasi langsung : 117,7 ms
snapshot          : 111,6 ms    ← hampir tidak membantu
```

Penyebabnya: subquery delta memindai `stock_movement` penuh karena index yang ada `(tenant_id, outlet_id, variation_id, occurred_at)` tidak melayani filter `hlc > checkpoint`.

Setelah menambahkan `CREATE INDEX ix_mv_hlc ON stock_movement(tenant_id, outlet_id, hlc)`:

| | Waktu | Percepatan |
|---|---:|---:|
| Agregasi langsung | 116,3 ms | — |
| Snapshot, 0 movement sejak checkpoint | **1,1 ms** | **107×** |
| Snapshot, 1 hari (1.382 movement) sejak checkpoint | **1,9 ms** | **61×** |
| Biaya rebuild snapshot | 126,4 ms | — |

**Proyeksi pada tablet 5× lebih lambat** `[ASUMSI]`:

```
agregasi langsung : 582 ms    ← MELEWATI target, terasa oleh kasir
dengan snapshot   :   9,5 ms  ← aman
```

### Rekomendasi konkret

1. **Tabel `stock_snapshot` masuk v1**, bukan ditunda. Bentuk:
   `(tenant_id, outlet_id, variation_id) PK · balance INTEGER · checkpoint_hlc INTEGER` — `WITHOUT ROWID`.
2. **Index `(tenant_id, outlet_id, hlc)` pada `stock_movement` wajib.** Tanpanya snapshot tidak berguna.
3. **Rebuild snapshot saat tutup shift**, bukan nightly job. Alasannya: tutup shift sudah merupakan jeda operasional alami, biayanya 126 ms (tidak terasa), dan delta setelahnya hanya mencakup movement sejak shift dibuka — yang selalu kecil.
4. Query stok membaca `snapshot.balance + COALESCE(delta_sejak_checkpoint, 0)`.

---

## 6. Perubahan yang harus dilakukan pada dokumen

| Dokumen | Bagian | Perubahan |
|---|---|---|
| `ERD-lumi-pos-v1.md` | § 13 Pemetaan tipe | Kuantitas: `INTEGER ×1000` di kedua sisi. Hapus opsi `numeric`/`REAL` |
| `ERD-lumi-pos-v1.md` | § 16 Snapshot | Snapshot **masuk v1**; hapus ambang 500.000; tambahkan `stock_snapshot` dan `ix_mv_hlc` |
| `ERD-lumi-pos-v1.md` | § 15 Index | Tambahkan `ix_mv_hlc` |
| `ERD-lumi-pos-v1.md` | § 19 Open questions | Tutup pertanyaan tipe kuantitas |
| `ARCH-lumi-pos-v1.md` | § 15 Keputusan ditunda | Hapus "Snapshot table untuk stok" — sudah diputuskan masuk v1 |
| `ARCH-lumi-pos-v1.md` | § 16 Open questions | Tutup pertanyaan tipe kuantitas |
| `PRD-lumi-pos-v1.md` | § 14 Open questions | Tutup OQ-07 |
| `spec-e-inventori.md` | FR-E1 | Ganti ambang snapshot dengan keputusan snapshot-sejak-v1 |
| `spec-h-sinkronisasi.md` | FR-H7 | Jendela riwayat lokal = **90 hari**, terkonfirmasi |

---

## 7. Yang belum diuji

| Belum diuji | Mengapa penting |
|---|---|
| Performa pada tablet Android/mini-PC nyata | Faktor 3–5× adalah asumsi; angka nyatanya bisa berbeda |
| SQLite WASM + OPFS di browser | Performa WASM berbeda dari SQLite native; kemungkinan lebih lambat |
| Perilaku dengan enkripsi at-rest aktif | Enkripsi menambah overhead pada setiap pembacaan halaman |
| Kecepatan sinkronisasi awal (unduh katalog + 90 hari riwayat) | Menentukan pengalaman provisioning perangkat baru |
| Ukuran setelah enkripsi | Umumnya serupa, tetapi belum dikonfirmasi |
| ULID sebagai `BLOB` 16-byte | Potensi penghematan ~20–30%; belum dibutuhkan |

**Prioritas berikutnya:** menjalankan `perf.py` pada perangkat target nyata setelah prototipe Tauri (OQ-14) berjalan. Sampai itu, faktor tablet tetap `[ASUMSI]` dan keputusan snapshot mengambil sikap konservatif — yang tepat, karena biaya snapshot kecil sementara biaya salah adalah layar kasir yang terasa lambat.

---

## 8. Cara menjalankan ulang

```bash
python3 qty_precision.py     # presisi perkalian
python3 qty_ledger.py        # presisi akumulasi — uji yang menentukan
python3 populate.py          # bangun 9 skenario, ukur ukuran (~5 menit)
python3 perf.py              # benchmark 7 query
python3 threshold.py         # regresi ambang 200 ms
python3 snapshot2.py         # efektivitas snapshot + index hlc
```

`schema.sql` diturunkan langsung dari ERD dan dapat dipakai sebagai titik awal migrasi lokal pertama.

---

*Prototipe 01 · Lumi POS · 27 Juli 2026*
