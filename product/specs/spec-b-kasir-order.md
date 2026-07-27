# Spec Modul B — Kasir & Order

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul B · **Riset:** `/research/02` § 4, `/research/04` (KEP-16, KEP-17, KEP-19)

---

## B.0 Ringkasan modul

Modul ini memiliki siklus hidup transaksi penjualan — dari item pertama masuk keranjang sampai order tertutup, termasuk pembatalan dan koreksi. Ia adalah **jantung sistem**: setiap bug di sini bermanifestasi sebagai uang yang salah.

**Invariant:**

1. Satu penjualan = **satu transaksi database**. Tidak ada state parsial.
2. Transaksi selesai **tidak pernah** di-`UPDATE`. Koreksi adalah record baru.
3. `OrderLine` adalah snapshot; tidak pernah dihitung ulang dari katalog.
4. Setiap mutasi membawa idempotency key yang di-generate klien.
5. Nomor struk unik per (device, tanggal) tanpa koordinasi server.

---

## B.1 Siklus hidup order

### FR-B1 [P0] — State machine

```
        ┌─────────┐
        │  DRAFT  │  keranjang di layar, belum tersimpan ke DB
        └────┬────┘
             │ item pertama ditambahkan
             ▼
        ┌─────────┐
        │  OPEN   │  tersimpan lokal, belum lunas
        └────┬────┘
             │
      ┌──────┼──────────────┬──────────────┐
      │      │              │              │
      │  lunas         di-void      shift ditutup
      │      │              │              │
      ▼      ▼              ▼              ▼
   (parsial) PAID       VOIDED       ABANDONED
      │       │
      │       │ struk tercetak / operasi selesai
      │       ▼
      │   ┌────────┐
      └──►│ CLOSED │
          └───┬────┘
              │ refund
              ▼
          ┌──────────┐
          │ REFUNDED │  (parsial atau penuh)
          └──────────┘
```

**Transisi yang diizinkan — di luar ini ditolak:**

| Dari | Ke | Syarat |
|---|---|---|
| `DRAFT` | `OPEN` | Item pertama ditambahkan |
| `OPEN` | `OPEN` | Item ditambah/dikurangi, diskon diterapkan |
| `OPEN` | `PAID` | `SUM(payment.confirmed)` ≥ `amount_due` |
| `OPEN` | `VOIDED` | Otorisasi manajer + alasan |
| `OPEN` | `ABANDONED` | Otomatis saat shift ditutup, dengan konfirmasi |
| `PAID` | `CLOSED` | Otomatis setelah operasi pasca-bayar selesai |
| `PAID` | `VOIDED` | Otorisasi manajer + alasan; hanya bila belum di-settle |
| `CLOSED` | `REFUNDED` | Otorisasi manajer + alasan |
| `REFUNDED` | `REFUNDED` | Refund parsial berulang, sampai total refund = total order |

**Yang ditolak secara eksplisit:** `CLOSED` → `OPEN` · `VOIDED` → apa pun · `REFUNDED` → `PAID`.

**Acceptance criteria.**

- [ ] Transisi ilegal ditolak di lapisan domain, bukan hanya UI
- [ ] Order `DRAFT` yang ditinggalkan (aplikasi ditutup) tidak menghasilkan baris di database
- [ ] Order `OPEN` bertahan melewati restart aplikasi
- [ ] Menutup shift dengan order `OPEN` menampilkan daftar dan meminta konfirmasi per order

---

### FR-B2 [P0] — Satu penjualan = satu transaksi database

**Deskripsi.** Menyimpan penjualan menulis ke `order`, `check`, `order_line`, `order_line_modifier`, `payment`, `stock_movement`, `audit_event`, dan `idempotency_key` — semuanya dalam satu transaksi.

**Anti-pola yang dilarang.** Memecah penyimpanan menjadi beberapa event asinkron ("OrderCreated" → handler menulis stock movement → handler lain menulis audit). Ini menghasilkan kelas bug terburuk: penjualan tercatat tapi stok tidak berkurang karena satu handler gagal diam-diam.

**Event dipancarkan setelah commit** lewat pola **transactional outbox**: baris `outbox` ditulis **dalam transaksi yang sama**, lalu dikirim worker terpisah.

**Behavior.**

```
GIVEN kasir menekan konfirmasi pembayaran
WHEN penyimpanan dijalankan
THEN semua entitas ditulis dalam satu transaksi database
 AND kegagalan di titik mana pun me-rollback seluruhnya
 AND kasir melihat pesan gagal, keranjang TETAP UTUH, dapat mencoba lagi

GIVEN perangkat mati listrik tepat saat commit berjalan
WHEN perangkat dinyalakan kembali
THEN transaksi ADA seluruhnya atau TIDAK ADA sama sekali
```

**Acceptance criteria.**

- [ ] Test injeksi kegagalan pada tiap tahap penulisan tidak pernah meninggalkan penjualan parsial
- [ ] Baris `outbox` ditulis dalam transaksi yang sama
- [ ] Kegagalan menyimpan tidak menghapus keranjang
- [ ] Kill -9 di tengah commit tidak menghasilkan data rusak (test dengan SQLite lokal)

---

## B.2 Order line sebagai snapshot

### FR-B3 [P0] — Field snapshot yang wajib

**Deskripsi.** `OrderLine` menyimpan salinan nilai, bukan referensi yang di-resolve saat ditampilkan. Referensi ke katalog tetap disimpan untuk pelaporan, tetapi **tidak pernah dipakai merekonstruksi struk**.

| Field | Peran | Akibat bila tidak disnapshot |
|---|---|---|
| `variation_id` | Referensi pelaporan | — |
| `item_name` | Snapshot | Struk lama menampilkan nama baru setelah produk di-rename |
| `variation_name` | Snapshot | Sama |
| `unit_price` | Snapshot | **Seluruh riwayat berubah saat harga naik** |
| `quantity` | Data | — |
| `modifier_snapshot` (jsonb) | Snapshot | Modifier yang dihapus hilang dari struk lama |
| `discount_amount` | Snapshot nilai, bukan referensi aturan | Aturan diskon yang diubah mengubah riwayat |
| `tax_rate`, `tax_amount`, `is_tax_inclusive` | Snapshot | Perubahan perda mengubah pajak historis |
| `cost_at_sale` | Snapshot | **Laporan margin historis salah** — celah yang terdokumentasi di Shopify |
| `line_total` | Snapshot | — |

**Behavior.**

```
GIVEN transaksi dibuat pada 26 Jul dengan Kopi Susu Rp 25.000
  AND pada 1 Agu harga diubah menjadi Rp 28.000
  AND pada 5 Agu produk di-rename menjadi "Kopi Susu Gula Aren"
  AND pada 10 Agu produk diarsipkan
WHEN struk transaksi 26 Jul dicetak ulang pada 15 Agu
THEN struk menampilkan "Kopi Susu" seharga Rp 25.000
```

**Acceptance criteria.**

- [ ] Skenario di atas lolos sebagai test
- [ ] `cost_at_sale` terisi pada setiap `order_line` — laporan margin memakainya, bukan `cost` katalog
- [ ] Cetak ulang struk tidak melakukan query ke tabel katalog

---

### FR-B4 [P0] — Quantity numerik

**Deskripsi.** `quantity` bertipe `numeric`, bukan `integer`.

**Alasan.** Retail Indonesia menjual beras per kg dan daging per ons. Menetapkannya integer di v1 berarti migrasi seluruh tabel transaksi saat vertikal retail dirilis (v1.3).

**Perilaku v1 (F&B):** UI hanya menampilkan stepper bilangan bulat. Tipe datanya sudah siap; UI-nya belum.

**Acceptance criteria.**

- [ ] Kolom `quantity` bertipe numerik di PostgreSQL dan SQLite
- [ ] Perhitungan `unit_price × quantity` menghasilkan `bigint` setelah pembulatan half-up
- [ ] Qty `0.5` dapat disimpan lewat API meskipun UI v1 tidak menghasilkannya

---

## B.3 Penomoran struk

### FR-B5 [P0] — Format `K1-20260726-0007`

**Struktur:** `{kode_device}-{YYYYMMDD}-{urutan}`

**Aturan.**

| Aturan | Alasan |
|---|---|
| Kode device dialokasikan **sekali saat provisioning**, disimpan lokal, tidak pernah berubah | Prefiks inilah yang membuat penomoran offline bebas bentrok tanpa koordinasi server |
| Counter direset harian per device, disimpan **lokal** | Tidak pernah meminta nomor ke server — itu akan mematahkan offline |
| Tanggal mengikuti **tanggal bisnis**, bukan tanggal kalender | Kafe yang tutup jam 01:00 mengharapkan penjualan jam 00:30 masuk hari sebelumnya |
| Nomor struk adalah identitas **untuk manusia**; primary key internal tetap ULID | Mencampur keduanya mempersulit migrasi dan sinkronisasi |
| Lubang nomor **ditampilkan** di laporan audit | Lubang yang tidak dijelaskan adalah sinyal fraud klasik |

**Perbandingan dengan Toast** (yang memakai blok numerik `(device+2)×1000`): format ini tidak punya batas atas, langsung terbaca asalnya, dan menghasilkan satu rangkaian nomor untuk online maupun offline.

**Acceptance criteria.**

- [ ] Dua device offline menghasilkan nomor yang tidak pernah bentrok
- [ ] Counter direset saat tanggal bisnis berganti, bukan saat tengah malam
- [ ] Nomor tidak pernah diminta ke server
- [ ] Transaksi ke-10.000 dalam satu hari tetap menghasilkan nomor valid
- [ ] Laporan audit menampilkan nomor yang tidak terpakai beserta alasannya

---

### FR-B6 [P0] — Pencegahan kode device duplikat

**Deskripsi.** Dua device dengan kode sama di satu outlet adalah kegagalan katastrofik — nomor struk bentrok dan transaksi bertabrakan saat sinkronisasi.

**Behavior.**

```
GIVEN device K1 sudah aktif di Outlet A
WHEN admin mencoba mem-provisioning device baru dengan kode K1 di Outlet A
THEN ditolak dengan pesan yang menyebut device mana yang sudah memakainya
 AND menawarkan mencabut device lama atau memakai kode berikutnya

GIVEN device K1 di Outlet A dicabut
WHEN device baru di-provisioning dengan kode K1 di Outlet A
THEN diizinkan
 AND sistem memperingatkan bahwa nomor struk dapat menyerupai device lama
```

**Acceptance criteria.**

- [ ] Constraint unik `(outlet_id, device_code)` untuk device aktif di level database
- [ ] Pesan penolakan menyebut device yang sudah memakai kode tersebut
- [ ] Kode dapat dipakai ulang setelah pencabutan, dengan peringatan

---

## B.4 Void dan refund

### FR-B7 [P0] — Dua operasi terpisah

**Deskripsi.** Void dan refund **bukan** varian dari satu operasi "batalkan". Keduanya punya prasyarat, efek finansial, dan konsekuensi stok yang berbeda.

| | **Void** | **Refund** |
|---|---|---|
| Makna | Transaksi dianggap tidak pernah terjadi secara finansial | Transaksi tetap valid; ditambah transaksi berlawanan arah |
| Syarat state | `OPEN` atau `PAID` yang belum di-settle | `CLOSED` |
| Efek pada record asli | **Tidak ada** — record asli tidak berubah | **Tidak ada** |
| Record baru | `Order` dengan status `VOIDED` + `audit_event` | `Refund` + `payment` negatif + `stock_movement` balik |
| Stok | Dikembalikan | Dikembalikan |
| Muncul di laporan penjualan | Tidak (dikecualikan dari omzet) | Ya, sebagai pengurang |
| Offline | ✅ | ✅ dalam jendela riwayat lokal |

**Aturan pemilihan otomatis.** Kasir tidak memilih "void" atau "refund" — kasir menekan "Batalkan transaksi", dan **sistem menentukan** operasi mana yang berlaku berdasarkan state. Bila transaksi sudah `CLOSED`, sistem menjelaskan bahwa yang dilakukan adalah refund.

**Refund parsial.** Kasir memilih baris mana yang direfund. Total refund tidak boleh melebihi total order dikurangi refund sebelumnya.

**Behavior.**

```
GIVEN order K1-20260726-0007 berstatus CLOSED total Rp 93.600
WHEN manajer melakukan refund penuh
THEN Refund baru dibuat dengan amount 93.600
 AND Payment negatif dibuat
 AND StockMovement balik dibuat untuk setiap baris
 AND AuditEvent dibuat dengan actor=kasir, approver=manajer, reason_code
 AND order asli TETAP berstatus CLOSED dengan penanda "direfund"
 AND riwayat menampilkan rantai: penjualan → refund

GIVEN order sudah direfund Rp 60.000 dari total Rp 93.600
WHEN manajer mencoba refund Rp 50.000
THEN ditolak; maksimum yang tersisa Rp 33.600
```

**Acceptance criteria.**

- [ ] Tidak ada `UPDATE` pada `order` asli saat void maupun refund
- [ ] Sistem memilih operasi berdasarkan state, kasir tidak memilihnya
- [ ] Refund kumulatif tidak dapat melebihi total order
- [ ] Riwayat menampilkan rantai koreksi sebagai satu alur terbaca, bukan tiga baris terpisah
- [ ] Void dan refund berfungsi offline
- [ ] Laporan penjualan mengecualikan void dan mengurangi refund — konsisten dengan FR-G3

---

### FR-B8 & FR-B9 [P0] — Otorisasi step-up

**Deskripsi.** Operasi di atas ambang membutuhkan PIN manajer **tanpa memutus sesi kasir**. Manajer datang ke layar, memasukkan PIN, kasir melanjutkan.

**Ambang default** (dapat dikonfigurasi per outlet):

| Operasi | Ambang default | Dapat diubah |
|---|---|---|
| Diskon | > 20% atau > Rp 50.000 | Ya |
| Void item setelah dikirim ke dapur (v1.1) | Selalu | Ya |
| Void seluruh order | Selalu | **Tidak** |
| Refund | Selalu | **Tidak** |
| No-sale (buka laci) | Alasan selalu; PIN di atas 3× per shift | Ya |
| Selisih tutup kas | > Rp 20.000 | Ya |

**Alasan dari daftar tertutup** — free text tidak dapat diagregasi menjadi laporan fraud:

| Operasi | Pilihan alasan |
|---|---|
| Void | Salah input · Pelanggan batal · Item habis · Uji coba · Lainnya |
| Refund | Barang rusak · Pesanan salah · Pelanggan tidak puas · Kelebihan bayar · Lainnya |
| Diskon | Promo berjalan · Karyawan · Pelanggan langganan · Kompensasi keluhan · Lainnya |
| No-sale | Tukar uang kecil · Koreksi kembalian · Setor ke brankas · Lainnya |
| Selisih kas | Kelebihan kembalian · Kekurangan kembalian · Uang palsu · Belum teridentifikasi · Lainnya |

**"Lainnya" wajib catatan bebas** minimal 10 karakter.

**Behavior.**

```
GIVEN kasir Sari sedang menangani order
WHEN kasir menerapkan diskon 30% (di atas ambang)
THEN dialog otorisasi muncul: pilih alasan + input PIN
 AND setelah PIN manajer Budi benar, diskon diterapkan
 AND sesi kasir TETAP milik Sari — Sari tidak logout
 AND AuditEvent: actor_user_id=Sari, approver_user_id=Budi
```

**Acceptance criteria.**

- [ ] Sesi kasir tidak berubah setelah otorisasi manajer
- [ ] `audit_event` menyimpan dua identitas terpisah
- [ ] Alasan berasal dari daftar tertutup; "Lainnya" memvalidasi panjang catatan
- [ ] Dialog konfirmasi memakai komponen `ConfirmDialog` design system dengan tombol danger 56px
- [ ] Otorisasi berfungsi offline (PIN diverifikasi terhadap hash lokal)
- [ ] PIN salah 5× mengunci otorisasi 60 detik, termasuk offline

---

## B.5 Idempotency

### FR-B10 [P0] — Idempotency key di-generate klien

**Deskripsi.** Prasyarat mutlak untuk offline-first: antrean upload akan mengirim ulang request, dan server tidak dapat membedakan retry dari penjualan kedua yang identik tanpa token dari klien.

**Dua mekanisme yang bekerja bersama:**

1. **ID transaksi client-generated (ULID) sebagai primary key** — menjadikan tabel penjualan kebal duplikasi lewat constraint database.
2. **Tabel `idempotency_key`** — memungkinkan server **mengembalikan respons asli** untuk retry, sehingga klien yang kehilangan respons pertama menerima hasil yang sama dan dapat menandai antreannya selesai.

**Struktur `idempotency_key`:** `key` (PK), `tenant_id`, `request_hash`, `response_status`, `response_body`, `created_at`, `expires_at`.

**Retensi 30 hari** — penyimpangan sadar dari norma industri 24 jam. Alasan: perangkat kasir dapat offline lebih dari 24 jam (libur panjang, outlet tutup, perangkat rusak lalu dinyalakan lagi). Biaya penyimpanannya dapat diabaikan.

**Aturan yang menentukan benar-salahnya implementasi:**

```
GIVEN key K sudah ada dengan request_hash H1
WHEN request datang dengan key K dan request_hash H1
THEN kembalikan response_body yang tersimpan, status 200
 AND JANGAN proses ulang

GIVEN key K sudah ada dengan request_hash H1
WHEN request datang dengan key K tetapi request_hash H2 (berbeda)
THEN tolak 422 — ini bug klien, bukan cache hit
 AND JANGAN kembalikan respons penjualan lain

GIVEN dua request dengan key K tiba bersamaan
WHEN keduanya diproses
THEN satu berhasil, satu menerima 409 dengan instruksi retry
 AND TIDAK ADA yang lolos menghasilkan duplikat
```

**Penulisan record idempotency dan penulisan penjualan harus dalam satu transaksi.** Bila terpisah, ada jendela di mana penjualan tercatat tapi key belum, dan retry menghasilkan duplikat.

**Acceptance criteria.**

- [ ] Key di-generate klien, bukan server
- [ ] Key sama + body sama → respons asli dikembalikan, tidak ada penjualan kedua
- [ ] Key sama + body berbeda → `422`
- [ ] Dua request bersamaan → tepat satu berhasil
- [ ] Key dan penjualan ditulis dalam satu transaksi — diverifikasi test injeksi kegagalan
- [ ] Retensi 30 hari; pembersihan otomatis
- [ ] Test: kirim request yang sama 100× → tepat satu penjualan

---

## B.6 Check

### FR-B12 [P0] — `Check` ada di skema, dikunci 1:1

**Deskripsi.** Entitas `Check` dimodelkan penuh tetapi dibatasi 1:1 dengan `Order` di v1.

**Alasan.** Memilih model tanpa `Check` lalu bermigrasi berarti menulis ulang seluruh riwayat transaksi dan setiap laporan — pekerjaan berminggu-minggu pada sistem yang sudah punya data finansial pelanggan. Menaruhnya di skema tetapi menguncinya membuat pengaktifan split bill nanti menjadi pelonggaran validasi plus UI baru, bukan migrasi data.

**Acceptance criteria.**

- [ ] Setiap `Order` memiliki tepat satu `Check` di v1, ditegakkan validasi aplikasi
- [ ] `OrderLine` merujuk `check_id`, bukan langsung `order_id` saja
- [ ] Melonggarkan constraint tidak memerlukan perubahan skema

---

## B.7 Cetak

### FR-B11 [P1] — Cetak ulang struk

**Deskripsi.** Kegagalan printer adalah kejadian harian. Cetak ulang adalah fitur kelas satu, bukan afterthought.

**Aturan urutan yang tidak boleh dibalik:**

```
1. Simpan transaksi (atomik)     ← WAJIB berhasil
2. Cetak struk                   ← BOLEH gagal
3. Buka laci                     ← BOLEH gagal
```

Struk dapat dicetak ulang; penjualan yang hilang tidak dapat dipulihkan.

**Behavior.**

```
GIVEN transaksi tersimpan
WHEN pencetakan gagal (kertas habis / printer mati)
THEN kasir melihat "Struk gagal dicetak · Cetak ulang"
 AND transaksi TETAP berstatus PAID
 AND job masuk antrean cetak dan dapat diulang
 AND kasir dapat melanjutkan transaksi berikutnya
```

**Acceptance criteria.**

- [ ] Kegagalan cetak tidak pernah mengubah status transaksi
- [ ] Cetak ulang tersedia dari riwayat transaksi tanpa batas waktu
- [ ] Struk cetak ulang menampilkan penanda "CETAK ULANG" beserta waktu
- [ ] Antrean cetak bertahan melewati restart aplikasi

---

## B.8 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Keranjang kosong, kasir menekan Bayar | Tombol Bayar nonaktif; tidak ada jalur yang menghasilkan order kosong |
| Order dengan 200 baris | Keranjang scroll; total sticky di dasar; performa tetap < 100 ms per penambahan |
| Kasir menambah item saat pembayaran sedang berlangsung | Diblokir; layar pembayaran mengunci keranjang |
| Aplikasi ditutup dengan keranjang berisi | `DRAFT` tidak tersimpan; keranjang hilang. Dinyatakan di UI: keranjang belum tersimpan sampai order dibuat |
| Aplikasi ditutup dengan order `OPEN` | Order tetap ada; muncul kembali saat aplikasi dibuka |
| Shift ditutup dengan order `OPEN` | Daftar ditampilkan; kasir memilih selesaikan atau abaikan per order; yang diabaikan menjadi `ABANDONED` dengan alasan |
| Double-tap tombol Bayar | Tombol dinonaktifkan setelah tap pertama; idempotency key sebagai jaring pengaman kedua |
| Jam device mundur 2 jam di tengah shift | Transaksi tetap tersimpan dengan `occurred_at` device dan HLC; selisih ditandai saat sinkronisasi; masuk exception report |
| Tanggal bisnis berganti saat order `OPEN` | Order tetap milik tanggal bisnis saat dibuat |
| Refund transaksi di luar jendela riwayat lokal, saat offline | Ditolak dengan pesan yang menjelaskan bahwa transaksi tersebut memerlukan koneksi |
| Manajer tidak ada, kasir butuh void | Order tetap `OPEN`; kasir dapat menyelesaikan transaksi lain di device yang sama |
| Dua kasir bergantian di satu device dalam satu shift | Diizinkan; setiap transaksi mencatat `created_by` yang sedang login |

---

## B.9 Test yang wajib ada

**Property test:**

- [ ] Untuk urutan operasi apa pun: tidak ada `UPDATE` pada order berstatus `CLOSED`/`VOIDED`/`REFUNDED`
- [ ] Untuk urutan retry apa pun: satu idempotency key menghasilkan tepat satu penjualan
- [ ] Untuk satu device dan satu tanggal bisnis: nomor struk selalu menaik
- [ ] Untuk order apa pun: `SUM(refund)` ≤ `order.total`

**Test contoh:**

- [ ] Snapshot: harga berubah + produk di-rename + produk diarsipkan → struk lama tetap benar
- [ ] Dua device offline menghasilkan nomor struk tanpa bentrok
- [ ] Rantai penjualan → refund parsial → refund parsial kedua

**Test kegagalan:**

- [ ] Injeksi kegagalan di tiap tahap penulisan → tidak ada penjualan parsial
- [ ] Kirim request identik 100× → satu penjualan
- [ ] Kill aplikasi saat commit → data konsisten setelah restart

---

## B.10 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Ambang default diskon/void/refund/selisih kas — angka usulan ada di `/research/08` § 3, perlu divalidasi 3 merchant | Implementasi FR-B8 |
| — | Berapa lama order `OPEN` boleh menggantung sebelum otomatis `ABANDONED`? | Implementasi FR-B1 |
| ~~OQ-07~~ | ✅ **Terjawab: 90 hari.** Terukur 39–130 MB — lihat `/prototypes/01-sqlite-sizing/FINDINGS.md` | — |
| — | Apakah `DRAFT` perlu disimpan agar keranjang bertahan saat aplikasi crash? | Implementasi FR-B1 |

---

*Spec Modul B · Lumi POS v1 · Draft 0.1*
