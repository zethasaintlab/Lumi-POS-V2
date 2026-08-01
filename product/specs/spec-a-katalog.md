# Spec Modul A — Katalog

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul A · **Riset:** `/research/02-DOMAIN-FEATURE-MAP.md` § 3, KEP-04

---

## A.0 Ringkasan modul

Modul ini memiliki entitas produk dan harga. Ia adalah **hulu** dari seluruh sistem: kesalahan struktur di sini merambat ke inventori, laporan margin, dan struk historis, dan hampir selalu memerlukan migrasi data plus pelatihan ulang merchant untuk diperbaiki.

**Invariant:**

1. Setiap `Item` memiliki ≥1 `ItemVariation`.
2. Stok dan harga melekat pada `ItemVariation`, **tidak pernah** pada `Item`.
3. `Modifier` memiliki harga tetapi **tidak memiliki SKU dan tidak dilacak stoknya**.
4. Katalog tidak pernah dihapus — hanya diarsipkan.
5. Perubahan harga menghasilkan record di `price_history`; nilai lama tidak hilang.

---

## A.1 Struktur tiga tingkat

### FR-A1 [P0] — Item → ItemVariation → Modifier

**Deskripsi.** Model tiga tingkat mengikuti pola yang dikonvergensikan Square dan Lightspeed secara independen.

**Aturan pemisah yang dapat diuji** — inilah aturan yang menentukan apakah inventori dapat dilacak sama sekali:

| Pertanyaan | Jawaban | Maka |
|---|---|---|
| Punya SKU dan harga sendiri, dan stoknya perlu dilacak terpisah? | Ya | **ItemVariation** |
| Kustomisasi yang menambah biaya pada sesuatu yang sudah punya SKU, atau properti yang berlaku pada banyak variation? | Ya | **Modifier** |

**Contoh yang benar:**

```
Item: Kopi Susu
  ├── Variation: Regular    SKU KOP-01-R   Rp 25.000
  └── Variation: Large      SKU KOP-01-L   Rp 30.000
  
  ModifierList: "Extra" (multi-select, maks 3)
    ├── Extra Shot     +Rp 5.000
    ├── Less Sugar     +Rp 0
    └── Oat Milk       +Rp 8.000
```

**Contoh yang salah dan harus dicegah UI:**

```
❌ Item: Kopi Susu
     └── Variation: Regular
     ModifierList: "Ukuran"
       ├── Regular  +Rp 0
       └── Large    +Rp 5.000       ← ukuran sebagai modifier
```

Akibatnya: stok tidak dapat dilacak per ukuran, dan laporan produk terlaris tidak dapat membedakan Regular dari Large. Memperbaikinya setelah ada data transaksi memerlukan migrasi **dan** melatih ulang merchant.

**Struktur data:**

| Entitas | Field kunci |
|---|---|
| `Item` | `id`, `tenant_id`, `name`, `category_id`, `description`, `image_url`, `archived_at`. **Tanpa harga, tanpa SKU** |
| `ItemVariation` | `id`, `item_id`, `name`, `sku`, `barcode`, `price`, `cost`, `stocking_unit`, `selling_unit`, `conversion_factor`, `track_stock` (boolean), `archived_at` |
| `ModifierList` | `id`, `tenant_id`, `name`, `selection_type` (`single`/`multi`), `min_selections`, `max_selections`, `allow_duplicate`, `is_required` |
| `Modifier` | `id`, `modifier_list_id`, `name`, `price`, `is_default`, `sort_order`, `archived_at` |
| `ItemModifierList` | Relasi N:M antara `Item` dan `ModifierList` |
| `Category` | `id`, `tenant_id`, `name`, `parent_id` (maks 1 tingkat), `sort_order`, `color_hint` |
| `PriceHistory` | `id`, `variation_id`, `outlet_id`, `price`, `effective_from`, `changed_by`, `reason` |

**Acceptance criteria.**

- [ ] `Item` tidak memiliki kolom `price` maupun `sku` — diverifikasi di skema
- [ ] Menyimpan `Item` tanpa variation ditolak
- [ ] `Modifier` tidak memiliki kolom `sku` maupun `track_stock`
- [ ] Satu `ModifierList` dapat dipakai banyak `Item`
- [ ] Menghapus `ModifierList` yang dipakai `Item` ditolak; hanya dapat diarsipkan

---

### FR-A2 [P0] — Item dengan satu variation ditampilkan sederhana

**Deskripsi.** Merchant tidak perlu memahami konsep variation untuk produk sederhana.

**Behavior.**

```
GIVEN Item memiliki tepat 1 variation
WHEN merchant membuka form edit produk
THEN nama variation disembunyikan
 AND harga, SKU, dan stok tampil inline sebagai properti Item

GIVEN Item memiliki tepat 1 variation
WHEN kasir menekan kartu produk
THEN item langsung masuk keranjang tanpa dialog pemilihan variation

GIVEN merchant menambahkan variation kedua
WHEN form disimpan
THEN variation pertama otomatis diberi nama default "Regular" bila kosong
 AND kasir mulai melihat dialog pemilihan variation
```

**Acceptance criteria.**

- [ ] Produk satu-variation dapat dibuat dalam ≤3 field (nama, harga, kategori)
- [ ] Kasir tidak melihat dialog variation untuk produk satu-variation
- [ ] Menambah variation kedua tidak memerlukan migrasi data atau mengubah transaksi historis
- [ ] Struk mencetak nama variation **hanya** bila item punya >1 variation

---

### FR-A3 [P0] — Aturan ModifierList

**Deskripsi.** `ModifierList` mengontrol bagaimana modifier dipilih.

**Aturan yang harus ditegakkan saat kasir memilih:**

| Konfigurasi | Perilaku di layar kasir |
|---|---|
| `selection_type = single`, `is_required = true` | Radio; kasir tidak dapat lanjut tanpa memilih; `is_default` terpilih otomatis |
| `selection_type = single`, `is_required = false` | Radio + opsi "Tanpa pilihan" |
| `selection_type = multi`, `max_selections = 3` | Checkbox; pilihan ke-4 dinonaktifkan dengan pesan, bukan diam-diam gagal |
| `allow_duplicate = true` | Stepper qty per modifier (mis. "Extra Shot ×2") |
| `min_selections = 2` | Tombol konfirmasi nonaktif sampai 2 dipilih, dengan hitungan terlihat |

**Acceptance criteria.**

- [ ] Batas maksimum menonaktifkan pilihan berikutnya dengan pesan, bukan menerima lalu menolak
- [ ] Modifier `is_default` terpilih otomatis saat dialog dibuka
- [ ] `allow_duplicate` menampilkan stepper, dan qty>1 menggandakan harga modifier di `order_line`
- [ ] Modifier dengan harga Rp 0 tetap tercetak di struk (mis. "Less Sugar") — ia mengubah pesanan meski tidak mengubah harga

---

### FR-A5 [P0] — Guardrail variation versus modifier

**Deskripsi.** Kesalahan penempatan adalah jebakan #1 di modul ini. UI harus mencegahnya, bukan mendokumentasikannya.

**Behavior.**

```
GIVEN merchant sedang membuat ModifierList baru
WHEN merchant memasukkan nama list
THEN sistem menampilkan pertanyaan:
     "Apakah pilihan ini perlu dilacak stoknya secara terpisah?"
     [ Ya, stoknya berbeda ]  [ Tidak, hanya menambah biaya ]

WHEN merchant memilih "Ya, stoknya berbeda"
THEN sistem menawarkan membuat variation alih-alih modifier
 AND menjelaskan konsekuensinya dalam satu kalimat
 AND merchant tetap dapat melanjutkan sebagai modifier bila memaksa
```

**Deteksi pola mencurigakan** — peringatan non-blocking saat menyimpan:

- Nama `ModifierList` mengandung: `ukuran`, `size`, `varian`, `rasa`, `flavor`
- Semua modifier dalam satu list memiliki harga berbeda dan tidak ada yang Rp 0

**Acceptance criteria.**

- [ ] Pertanyaan guardrail muncul saat membuat `ModifierList` baru
- [ ] Merchant dapat mengabaikannya dan melanjutkan
- [ ] Peringatan pola tidak memblokir penyimpanan
- [ ] Pertanyaan **tidak** muncul saat mengedit `ModifierList` yang sudah ada

---

## A.2 Kategori & tampilan kasir

### FR-A4 [P0] — Kategori maksimal dua tingkat

**Deskripsi.** Batas kedalaman berasal dari aturan density design system: minimal 12 kartu produk (tinggi 96px) tanpa scroll di 1024×768.

**Aturan.**

- `Category.parent_id` boleh menunjuk kategori lain, tetapi kategori yang sudah punya parent **tidak boleh** menjadi parent.
- Kasir mencapai produk mana pun dalam **maksimal 2 tap** dari layar kasir.

**Behavior.**

```
GIVEN merchant mencoba membuat kategori tingkat ketiga
WHEN form disimpan
THEN ditolak dengan pesan yang menjelaskan batas dua tingkat
```

**Acceptance criteria.**

- [ ] Kategori tingkat ketiga ditolak di level validasi, bukan hanya UI
- [ ] Layar kasir menampilkan ≥12 kartu produk tanpa scroll di 1024×768 — diverifikasi dengan screenshot test
- [ ] Produk tanpa kategori muncul di grup "Lainnya", tidak hilang

---

## A.3 Harga

### FR-A7 [P0] — Harga per outlet dan riwayatnya

**Deskripsi.** Harga melekat pada `ItemVariation` dengan kemungkinan override per outlet. Setiap perubahan tercatat.

**Resolusi harga:**

```
1. Cari PriceHistory untuk (variation, outlet) dengan effective_from
   terbesar yang ≤ waktu transaksi
2. Bila tidak ada, cari untuk (variation, outlet=NULL)
3. Bila tidak ada, pakai ItemVariation.price
```

**Behavior.**

```
GIVEN harga Kopi Susu diubah dari 25.000 menjadi 28.000 oleh user "Budi"
WHEN perubahan disimpan
THEN PriceHistory baru dibuat: price=28.000, changed_by=Budi, effective_from=now
 AND record lama TIDAK diubah
 AND transaksi yang sudah tersimpan tetap menampilkan 25.000 (snapshot di order_line)
 AND perangkat offline tetap memakai 25.000 sampai tersinkron — ini BENAR,
     karena itulah harga yang tercetak dan dibayar pelanggan
```

**Acceptance criteria.**

- [ ] Perubahan harga menghasilkan record baru, bukan `UPDATE`
- [ ] `changed_by` selalu terisi
- [ ] Laporan margin historis memakai `cost_at_sale` dari `order_line`, bukan `cost` katalog saat ini
- [ ] Dashboard menampilkan device mana yang belum menerima perubahan harga terakhir

---

## A.4 Satuan & konversi

### FR-A9 [P0] — Stocking unit versus selling unit

**Deskripsi.** Field disimpan di v1; **UI konversi tidak dibangun** (KEP-03). Alasan: menambahkannya ke skema sekarang berbiaya tiga kolom; menambahkannya setelah ada data transaksi mengharuskan audit ulang setiap query stok.

**Field:** `stocking_unit` (mis. `dus`), `selling_unit` (mis. `pcs`), `conversion_factor` (mis. `24`).

**Perilaku v1:** ketiganya default ke `pcs` / `pcs` / `1`. Tidak ada UI yang mengubahnya. Perhitungan stok memakai `selling_unit`.

**Acceptance criteria.**

- [ ] Ketiga kolom ada di skema dengan default yang benar
- [ ] Query stok memakai `selling_unit` secara konsisten
- [ ] Tidak ada UI konversi di v1 — bila muncul, itu scope creep

---

## A.5 Impor

### FR-A8 [P1] — Impor katalog

**Deskripsi.** Ini **fitur akuisisi**, bukan utilitas admin — migrasi katalog adalah biaya switching terbesar bagi merchant yang pindah dari kompetitor.

**Format yang didukung:** CSV generik (template Lumi), ekspor Moka, ekspor Olsera.

**Alur:**

```
[Unggah file] → [Deteksi format] → [Pemetaan kolom]
      ▼
[PRATINJAU: n baris valid, m baris bermasalah]
      ▼
[Daftar masalah PER BARIS dengan nomor baris dan alasan]
      ▼
[Impor n baris valid]  ← baris bermasalah TIDAK diimpor diam-diam
      ▼
[Ringkasan + unduh file berisi baris yang gagal untuk diperbaiki]
```

**Aturan penanganan error:**

| Masalah | Perilaku |
|---|---|
| Nama produk kosong | Baris ditolak, dilaporkan |
| Harga bukan angka | Baris ditolak, dilaporkan |
| Kategori belum ada | **Dibuat otomatis**, dicatat di ringkasan |
| Nama produk duplikat dalam file | Baris kedua ditolak, dilaporkan |
| Nama produk sudah ada di katalog | Ditanyakan sekali di awal: lewati semua / perbarui semua |
| Modifier di kolom teks bebas (format Moka) | Diparse best-effort; hasilnya ditampilkan di pratinjau untuk dikonfirmasi |

**Acceptance criteria.**

- [ ] Pratinjau menampilkan jumlah valid dan bermasalah sebelum impor dijalankan
- [ ] Setiap baris bermasalah dilaporkan dengan **nomor baris** dan alasan spesifik
- [ ] Tidak ada impor parsial diam-diam
- [ ] File berisi baris gagal dapat diunduh, diperbaiki, dan diunggah ulang
- [ ] Impor 5.000 baris selesai < 60 detik
- [ ] Impor dicatat di audit trail dengan jumlah baris

---

## A.6 Arsip

### FR-A6 [P0] — Katalog tidak pernah dihapus

**Deskripsi.** Menghapus produk merusak riwayat. Snapshot di `order_line` melindungi struk, tetapi referensi tetap dibutuhkan untuk pelaporan.

**Behavior.**

```
GIVEN merchant menekan "Hapus" pada produk
WHEN konfirmasi diterima
THEN archived_at diisi
 AND produk hilang dari layar kasir
 AND produk tetap muncul di laporan periode lalu
 AND tidak ada baris yang di-DELETE

GIVEN produk diarsipkan
WHEN merchant membuka daftar produk dengan filter "Termasuk yang diarsipkan"
THEN produk muncul dengan penanda dan tombol "Pulihkan"
```

**Acceptance criteria.**

- [ ] Tidak ada `DELETE` pada tabel katalog di seluruh kode
- [ ] Tidak ada foreign key `ON DELETE CASCADE` dari transaksi ke katalog
- [ ] Produk yang diarsipkan tetap muncul di laporan historis
- [ ] Produk dapat dipulihkan

---

## A.7 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Katalog kosong pertama kali | Empty state dengan dua CTA: "Tambah produk" dan "Impor dari file" |
| Katalog 10.000 SKU | Pencarian < 150 ms; grid virtualisasi; kategori dimuat lazy |
| Nama produk 200 karakter | Disimpan penuh; grid truncate dengan ellipsis; struk memotong sesuai lebar kertas |
| Produk tanpa gambar | Kartu menampilkan nama pada bidang warna kategori — design system melarang placeholder gambar |
| Harga Rp 0 | Diizinkan (produk gratis/promo); tetap masuk laporan |
| Harga negatif | Ditolak |
| Variation ke-251 | Ditolak dengan pesan; batas 250 mengikuti preseden Square |
| Modifier list tanpa modifier | Tidak muncul di layar kasir; peringatan di form edit |
| Barcode duplikat antar variation | Ditolak — barcode harus unik per tenant |
| Merchant mengubah kategori produk yang punya transaksi | Diizinkan; laporan historis mengikuti kategori **saat ini**, dan hal ini dinyatakan di catatan laporan |
| Produk diarsipkan saat ada di keranjang device lain | Keranjang tetap valid; transaksi dapat diselesaikan |
| Impor mengandung 50.000 baris | Ditolak dengan pesan; batas 10.000 per impor |

---

## A.8 Test yang wajib ada

**Property test:**

- [ ] Untuk `Item` apa pun: jumlah variation ≥ 1
- [ ] Untuk kombinasi modifier apa pun: harga baris = harga variation + `SUM(modifier × qty)`
- [ ] Untuk perubahan harga apa pun: transaksi historis tidak berubah

**Test contoh:**

- [ ] Item satu-variation → tambah variation kedua → transaksi lama tetap utuh
- [ ] Resolusi harga: outlet override > tenant default > `variation.price`
- [ ] Impor 1.000 baris dengan 50 baris rusak → 950 masuk, 50 dilaporkan per baris

**Test kegagalan:**

- [ ] Kategori tingkat ketiga ditolak
- [ ] Barcode duplikat ditolak
- [ ] `DELETE` pada tabel katalog tidak ada di kode (grep test)

---

## A.9 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Apakah gambar produk didukung di v1? Design system melarang imagery di layar kasir, tetapi grid produk kompetitor umumnya memakainya | Implementasi FR-A1 |
| — | Batas jumlah produk per tier (tier Gratis 200, Standar 5.000) — dihitung per variation atau per item? | Implementasi kuota, Modul komersial |
| ~~OQ-09~~ | ✅ **Terjawab 1 Agu 2026 — per outlet dengan default tenant.** Konsekuensi untuk modul ini: katalog tetap **milik tenant** (`category`/`item`/`item_variation` ber-`tenant_id`, bukan `outlet_id`), jadi ia dibagi ke seluruh outlet apa pun profil vertikalnya. Yang berbeda per outlet adalah *perilaku* (mis. `allow_negative_stock`), bukan isi katalognya | — |

---

*Spec Modul A · Lumi POS v1 · Draft 0.1*
