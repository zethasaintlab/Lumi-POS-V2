# Spec Modul E — Inventori

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul E · **Riset:** `/research/02` § 6 (KEP-07), `/research/05` § 4

---

## E.0 Ringkasan modul

Modul ini melacak stok sebagai **ledger pergerakan**, bukan angka yang di-update. Keputusan ini datang dari tiga kebutuhan independen yang semuanya menuntut struktur yang sama: sinkronisasi offline yang konvergen, audit trail, dan metrik actual-vs-theoretical.

**Invariant:**

1. Stok saat ini = `SUM(stock_movement.delta)` per `(outlet_id, variation_id)`. **Tidak ada kolom quantity.**
2. Setiap movement bersifat append-only; tidak pernah di-`UPDATE` maupun di-`DELETE`.
3. Setiap movement dapat ditelusuri ke penyebabnya (order, opname, penerimaan, penyesuaian).
4. Penjualan dan movement-nya ditulis dalam satu transaksi database.

---

## E.1 Stok sebagai ledger

### FR-E1 [P0] — Tidak ada kolom quantity

**Deskripsi.** `ItemVariation` **tidak** memiliki kolom `quantity_on_hand`. Stok adalah hasil agregasi.

**Alasan — tiga kebutuhan yang menuntut hal sama:**

| Kebutuhan | Mengapa kolom gagal |
|---|---|
| Sinkronisasi offline | Dua device offline yang menjual produk sama menghasilkan konflik last-write-wins yang **menghilangkan penjualan secara diam-diam**. Dua `INSERT` tidak pernah konflik |
| Audit | "Kenapa stok kopi tinggal 3 padahal kemarin 40" hanya dapat dijawab bila setiap perubahan punya record |
| AvT variance | Metrik ini butuh dua aliran (deplesi teoretis dari penjualan, deplesi aktual dari opname) sebagai tipe movement berbeda pada ledger yang sama |

**Struktur `StockMovement`:**

| Field | Tipe | Catatan |
|---|---|---|
| `id` | ulid | Client-generated |
| `tenant_id`, `outlet_id` | ulid | RLS |
| `variation_id` | ulid | |
| `type` | enum | `sale` · `void` · `refund` · `receipt` · `adjustment` · `stocktake` · `transfer_in` · `transfer_out` (v1.1) |
| `delta` | numeric | Bertanda; negatif mengurangi stok |
| `order_id` | ulid nullable | Untuk `sale`/`void`/`refund` |
| `stocktake_id` | ulid nullable | Untuk `stocktake` |
| `reason_code` | text nullable | Wajib untuk `adjustment` |
| `note` | text nullable | |
| `unit_cost` | bigint nullable | HPP saat penerimaan — untuk perhitungan margin |
| `device_id` | ulid | Untuk penelusuran oversell |
| `created_by` | ulid | |
| `occurred_at`, `recorded_at`, `hlc` | | |

**Aturan performa — diperbarui berdasarkan pengukuran.** `[FAKTA — diukur 27 Jul 2026]` Agregasi langsung melewati 200 ms pada **≈197.000 movement** (server) atau **≈39.000–66.000** pada tablet kasir — dicapai kafe besar dalam kurang dari 30 hari. Karena itu **tabel `stock_snapshot` masuk v1**, bukan ditunda.

| | Waktu | Percepatan |
|---|---:|---:|
| Agregasi langsung (3.203 variation, 124.389 movement) | 116,3 ms | — |
| Snapshot + delta | **1,1 ms** | **107×** |

**Index `(tenant_id, outlet_id, hlc)` wajib menyertainya.** Tanpanya snapshot hanya menghasilkan 117,7 → 111,6 ms karena subquery delta memindai tabel penuh.

**Pembacaan stok:** `snapshot.balance + COALESCE(SUM(delta) WHERE hlc > checkpoint_hlc, 0)`
**Rebuild:** saat tutup shift (jeda operasional alami, biaya 126 ms).

*Sumber: `/prototypes/01-sqlite-sizing/FINDINGS.md` § 5*

**Acceptance criteria.**

- [ ] Tidak ada kolom `quantity` pada `ItemVariation` — diverifikasi skema
- [ ] Stok dihitung dari agregasi di seluruh kode; tidak ada jalur yang membacanya dari kolom
- [ ] Query stok satu outlet (5.000 SKU, 100.000 movement) < 200 ms
- [ ] Index pada `(outlet_id, variation_id)` ada dan dipakai — diverifikasi `EXPLAIN`
- [ ] Tidak ada `UPDATE` maupun `DELETE` pada `stock_movement` di seluruh kode

---

### FR-E2 [P0] — Tipe movement

| Tipe | Delta | Dipicu oleh | Otorisasi |
|---|---|---|---|
| `sale` | Negatif | Penjualan tersimpan | — |
| `void` | Positif | Order di-void | Manajer (di modul B) |
| `refund` | Positif | Refund | Manajer (di modul B) |
| `receipt` | Positif | Penerimaan barang | Manajer |
| `adjustment` | Bertanda | Koreksi manual | **Manajer + alasan wajib** |
| `stocktake` | Bertanda | Hasil opname | Manajer |

**Aturan.** Movement `sale` dibuat untuk `ItemVariation` dengan `track_stock = true` saja. Produk jasa atau produk yang stoknya tidak dilacak tidak menghasilkan movement.

**Acceptance criteria.**

- [ ] Setiap tipe menghasilkan tanda delta yang benar
- [ ] `adjustment` tanpa `reason_code` ditolak
- [ ] Produk dengan `track_stock = false` tidak menghasilkan movement
- [ ] Void dan refund mengembalikan jumlah yang **persis sama** dengan yang dikurangi penjualan aslinya

---

### FR-E3 [P0] — Stock cutting otomatis

**Deskripsi.** Pengurangan stok terjadi saat penjualan tersimpan, dalam transaksi database yang sama.

**Behavior.**

```
GIVEN order berisi 2× Kopi Susu Regular (track_stock=true)
  AND 1× Croissant (track_stock=true)
WHEN order disimpan sebagai PAID
THEN dalam TRANSAKSI YANG SAMA:
     StockMovement(variation=KopiSusuReg, delta=−2, type=sale, order_id=X)
     StockMovement(variation=Croissant,   delta=−1, type=sale, order_id=X)
 AND kegagalan menulis movement me-rollback seluruh penjualan
```

**Modifier tidak mengurangi stok di v1.** Modifier tidak memiliki SKU dan tidak dilacak stoknya (KEP-04). Deplesi bahan lewat resep/BOM adalah v1.2.

**Acceptance criteria.**

- [ ] Movement ditulis dalam transaksi yang sama dengan penjualan
- [ ] Injeksi kegagalan saat menulis movement me-rollback penjualan
- [ ] Modifier tidak menghasilkan movement di v1
- [ ] Jumlah movement `sale` = jumlah `order_line` dengan `track_stock = true`

---

## E.2 Stok negatif dan oversell

### FR-E4 [P0] — Stok boleh negatif sebagai setting

**Deskripsi.** Apakah stok boleh negatif adalah keputusan **bisnis**, bukan teknis, dan harus menjadi setting per profil vertikal — bukan asumsi yang di-hardcode.

**Default per vertikal** `[ASUMSI]`:

| Vertikal | Default | Alasan |
|---|---|---|
| F&B | **Boleh negatif, dengan peringatan** | Melarang penjualan karena sistem mengira stok habis akan menghentikan penjualan nyata, dan kasir akan mencari jalan pintas — memindahkan masalah ke tempat yang tidak terlihat sistem |
| Retail (v1.3) | Boleh negatif, dengan peringatan | Dapat diubah merchant menjadi blokir untuk barang bernilai tinggi |

**Behavior.**

```
GIVEN allow_negative_stock = true
  AND stok Kopi Susu = 1
WHEN kasir menambahkan 3 Kopi Susu ke keranjang
THEN peringatan tampil: "Stok tersisa 1"
 AND penjualan TETAP dapat diselesaikan
 AND stok menjadi −2

GIVEN allow_negative_stock = false
  AND stok Kopi Susu = 1
WHEN kasir menambahkan 3 Kopi Susu
THEN qty maksimum dibatasi 1, dengan pesan yang menjelaskan
```

**Acceptance criteria.**

- [ ] Setting berada di `VerticalProfile`, bukan konstanta
- [ ] Default terdokumentasi dan dapat diubah per outlet
- [ ] Peringatan stok tidak memblokir alur kasir saat `allow_negative_stock = true`
- [ ] Stok negatif muncul jelas di daftar produk dengan penanda

---

### FR-E6 [P0] — Deteksi oversell pasca-sinkronisasi

**Deskripsi.** Dua device offline yang menjual item terakhir akan **sama-sama berhasil**. Ini konsekuensi teorema CAP, bukan bug. Yang dapat dan harus dilakukan: membuat konsekuensinya **terlihat dan tertangani sebagai proses bisnis**.

**Pencegahan tidak dijanjikan.** Ini dinyatakan di PRD sebagai non-goal permanen, di materi penjualan, dan di dokumentasi merchant.

**Behavior.**

```
GIVEN stok Croissant = 1 saat kedua device terakhir tersinkron
  AND device K1 offline menjual 1 Croissant pukul 12:10
  AND device K2 offline menjual 1 Croissant pukul 12:15
WHEN keduanya tersinkron
THEN kedua penjualan DITERIMA — tidak ada yang ditolak
 AND stok menjadi −1
 AND OversellEvent dibuat:
     variation_id, outlet_id, detected_at,
     devices_involved = [K1, K2],
     orders_involved  = [order K1, order K2],
     quantity_over    = 1
 AND manajer melihatnya di daftar "Perlu diperiksa"
```

**Struktur `OversellEvent`:** `id`, `tenant_id`, `outlet_id`, `variation_id`, `detected_at`, `devices_involved` (jsonb), `orders_involved` (jsonb), `quantity_over`, `resolved_by`, `resolved_at`, `resolution_note`.

**Penyelesaian oleh manusia.** Manajer memeriksa dan memilih: (a) stok memang salah — buat `adjustment`; (b) barang memang ada lebih banyak dari catatan — buat `adjustment`; (c) satu transaksi salah — void dengan alasan. Sistem **tidak** menyelesaikannya otomatis.

**Acceptance criteria.**

- [ ] Kedua penjualan diterima; tidak ada yang ditolak saat sinkronisasi
- [ ] `OversellEvent` dibuat dengan konteks lengkap (device, order, waktu)
- [ ] Manajer melihat notifikasi, bukan hanya entri di laporan yang mungkin tidak dibuka
- [ ] Penyelesaian tercatat dengan aktor dan catatan
- [ ] Test simulasi: dua device offline menjual item terakhir → tepat satu `OversellEvent`

---

### FR-E5 [P0] — Penandaan sold-out manual

**Deskripsi.** Barista tahu kopi habis sebelum sistem tahu. Alur ini lebih andal daripada hitungan otomatis dan wajib ada.

**Behavior.**

```
GIVEN kasir menekan tahan pada kartu produk
WHEN memilih "Tandai habis"
THEN produk ditandai habis di device ini seketika
 AND penandaan masuk antrean sinkronisasi
 AND bila hub lokal tersedia (v1.1), menyebar ke device lain dalam outlet
 AND kartu produk tampil dengan state "habis" sesuai design system

GIVEN produk ditandai habis
WHEN kasir mencoba menambahkannya ke keranjang
THEN diblokir dengan pesan, TETAPI manajer dapat menimpanya
```

**Penandaan habis berbeda dari stok nol.** Produk dapat ditandai habis meskipun stok tercatat masih 10 (mis. bahan habis, mesin rusak). Keduanya disimpan terpisah: `is_sold_out` (manual, per outlet) dan stok terhitung.

**Reset otomatis.** Penandaan habis direset saat shift baru dibuka, dengan konfirmasi — mencegah produk tetap tertandai habis berhari-hari karena lupa.

**Acceptance criteria.**

- [ ] Penandaan berlaku seketika di device yang menandai, tanpa menunggu jaringan
- [ ] `is_sold_out` terpisah dari stok terhitung
- [ ] Manajer dapat menimpa penandaan
- [ ] Reset saat buka shift dengan konfirmasi, bukan otomatis diam-diam
- [ ] State "habis" pada kartu produk memakai komponen `ProductCard` design system

---

## E.3 Opname

### FR-E7 [P1] — Stock opname

**Deskripsi.** Menghitung fisik dan mencatat selisih terhadap catatan sistem.

**Alur:**

```
[Mulai opname] → pilih kategori atau seluruh katalog
      ▼
[Sistem membekukan snapshot stok terhitung pada waktu T]
      ▼
[Petugas memasukkan hitungan fisik per produk]
      ▼
[Sistem menampilkan selisih per produk]
      ▼
[Manajer menyetujui] → StockMovement type='stocktake' dibuat
                        dengan delta = hitungan_fisik − stok_pada_T
```

**Aturan.**

- Penjualan **tetap berjalan** selama opname. Movement setelah waktu T tidak memengaruhi perhitungan selisih.
- Opname dapat dijeda dan dilanjutkan.
- Selisih di atas ambang nilai memerlukan alasan per produk.

**Acceptance criteria.**

- [ ] Penjualan tidak diblokir selama opname
- [ ] Selisih dihitung terhadap snapshot waktu T, bukan stok saat penyimpanan
- [ ] Opname dapat dijeda dan dilanjutkan tanpa kehilangan data
- [ ] Hasil opname menghasilkan movement, bukan `UPDATE` stok
- [ ] Laporan opname menampilkan nilai rupiah selisih, bukan hanya kuantitas

---

## E.4 Perhitungan stok di perangkat offline

**Deskripsi.** Perangkat menghitung stok lokal dari movement yang diketahuinya: movement tersinkron terakhir + movement lokal yang belum terkirim.

**Konsekuensi yang harus terlihat di UI:**

```
Stok Kopi Susu: 12
Terakhir tersinkron: 2 jam lalu     ← wajib ditampilkan saat offline
```

**Aturan.** Angka stok saat offline **tidak** diklaim akurat. UI menyatakan kapan data terakhir tersinkron, sesuai aturan design system bahwa kegagalan dan ketidakpastian menjelaskan alasannya.

**Buffer peringatan otomatis.** Saat offline, ambang peringatan stok rendah dinaikkan otomatis (default ×2) karena ketidakpastian lebih besar. Dapat dikonfigurasi.

**Acceptance criteria.**

- [ ] Stok lokal = movement tersinkron + movement lokal
- [ ] Waktu sinkronisasi terakhir ditampilkan saat offline
- [ ] Ambang peringatan naik saat offline
- [ ] Perangkat tidak mereplikasi seluruh ledger — hanya agregat per variation plus movement dalam jendela waktu

---

## E.5 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Produk baru tanpa penerimaan barang | Stok 0; tetap dapat dijual bila `allow_negative_stock = true` |
| Movement dengan delta 0 | Ditolak — tidak ada gunanya dan mengotori ledger |
| Void transaksi yang produknya sudah diarsipkan | Movement balik tetap dibuat; produk yang diarsipkan tetap punya stok |
| Opname saat ada transaksi offline belum tersinkron | Selisih akan salah. Sistem **memperingatkan** dan menampilkan jumlah antrean sebelum opname dimulai |
| Dua opname berjalan bersamaan di outlet sama | Ditolak — satu opname aktif per outlet |
| Stok negatif ekstrem (mis. −500) | Peringatan menonjol di dashboard; kemungkinan kesalahan konfigurasi `track_stock` |
| Produk `track_stock` diubah dari false ke true | Stok dimulai dari 0; movement historis tidak dibuat surut |
| Produk `track_stock` diubah dari true ke false | Movement historis tetap ada; stok berhenti dihitung |
| Ledger tumbuh besar | Ditangani `stock_snapshot` sejak v1; rebuild saat tutup shift menjaga delta selalu kecil |
| Refund parsial | Movement balik hanya untuk baris yang direfund, dengan qty yang direfund |
| Transfer stok antar outlet | v1.1 — tipe `transfer_in`/`transfer_out` sudah ada di enum, tanpa UI di v1 |

---

## E.6 Test yang wajib ada

**Property test:**

- [ ] Untuk urutan operasi apa pun: stok = `SUM(delta)`
- [ ] Untuk penjualan + void: stok kembali ke nilai sebelum penjualan
- [ ] Untuk penjualan + refund penuh: stok kembali ke nilai sebelum penjualan
- [ ] Tidak ada urutan operasi yang menghasilkan `UPDATE` pada `stock_movement`

**Test contoh:**

- [ ] Penjualan 2 item → 2 movement dengan delta benar
- [ ] Dua device offline menjual item terakhir → keduanya diterima, satu `OversellEvent`
- [ ] Opname dengan penjualan berjalan → selisih dihitung terhadap snapshot T

**Test performa:**

- [ ] Query stok via snapshot < 10 ms pada 3.200 variation / 124.000 movement (baseline terukur: 1,1 ms)
- [ ] Snapshot dan agregasi langsung menghasilkan angka **identik** — uji drift wajib
- [ ] Rebuild snapshot saat tutup shift < 200 ms
- [ ] Query stok diukur ulang pada perangkat target nyata setelah prototipe Tauri (OQ-14)

---

## E.7 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Default `allow_negative_stock` untuk F&B — validasi dengan 3 merchant | Implementasi FR-E4 |
| ~~Jendela movement ke perangkat~~ | ✅ **Terjawab: 90 hari**, sejalan dengan jendela riwayat transaksi | — |
| — | Apakah opname (FR-E7) benar-benar dibutuhkan di v1, atau v1.1? Ia P1 tetapi menambah alur yang tidak sedikit | Perencanaan F3 |
| — | Metode penilaian persediaan: FIFO, average, atau standard cost? Memengaruhi `unit_cost` dan laporan margin | Implementasi laporan margin |

---

*Spec Modul E · Lumi POS v1 · Draft 0.1*
