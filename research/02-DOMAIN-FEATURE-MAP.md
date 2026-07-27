# 02 — Taksonomi Domain & Peta Fitur

> Fase 2 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Model katalog memakai tiga tingkat: Item → Variation → Modifier**, mengikuti pola yang sudah terbukti di Square dan Lightspeed. Aturan pemisahnya tegas dan bisa diuji: *punya SKU dan harga sendiri* → Variation; *kustomisasi yang menambah biaya pada SKU yang sudah ada* → Modifier. Ini bukan preferensi gaya, ini yang menentukan apakah inventory bisa dilacak sama sekali. (→ KEP-04)

2. **Perbedaan F&B vs retail ditangani lewat "profil vertikal" — konfigurasi berdata, bukan feature flag boolean dan bukan modul terpisah.** Feature flag runtime tidak bisa mengubah bentuk data; modul terpisah memecah codebase. Profil vertikal adalah satu record konfigurasi per outlet yang menentukan modul aktif, alur kasir default, dan field katalog yang wajib. (→ KEP-05)

3. **Order dan Payment adalah dua agregat terpisah, bukan satu.** Split bill, pembayaran campuran (tunai + QRIS), dan pembayaran parsial mustahil dimodelkan bersih kalau payment adalah kolom di tabel order. Ini keputusan yang mahal untuk diubah belakangan. (→ KEP-06)

4. **Stok dimodelkan sebagai movement ledger (append-only), bukan kolom `qty` yang di-update.** Ini prasyarat untuk sinkronisasi offline (Fase 5) dan untuk audit trail (Fase 8), bukan pilihan estetika. Angka stok saat ini adalah proyeksi dari ledger, bukan sumber kebenaran. (→ KEP-07)

5. **Cakupan v1 dipotong keras.** Dari 17 area domain yang dipetakan, hanya 9 masuk v1. Yang dipotong dan alasannya dicatat eksplisit agar tidak "bocor" kembali lewat scope creep — terutama resep/BOM, purchasing, dan loyalty yang semuanya terasa wajib tapi tidak menghalangi merchant menutup buku hari pertama.

---

## 1. Cara membaca dokumen ini

Setiap area domain dinilai pada tiga label:

- **WAJIB v1** — tanpa ini merchant tidak bisa menjalankan hari operasional lengkap. Absennya = produk tidak bisa dijual.
- **PENTING** — merchant bisa beroperasi tanpanya, tapi akan bermigrasi ke kompetitor dalam 3–6 bulan. Target v1.1–v1.3.
- **BISA DITUNDA** — nyeri nyata tapi bisa dikerjakan manual/di luar sistem untuk sementara.

Kriteria pemisah **WAJIB v1** yang dipakai konsisten: *"Bisakah merchant membuka toko pagi hari, menjual sepanjang hari, dan menutup buku malam hari dengan angka yang mereka percaya — tanpa fitur ini?"* Kalau jawabannya tidak, itu WAJIB.

---

## 2. Taksonomi domain — 17 area

| # | Area domain | Status | Alasan penempatan |
|---|---|---|---|
| 1 | **Katalog produk** (item, variation, modifier, kategori) | WAJIB v1 | Tidak bisa jualan tanpa katalog |
| 2 | **Order lifecycle** (draft → hold → paid → closed → void) | WAJIB v1 | Inti sistem |
| 3 | **Payment & split bill** | WAJIB v1 | Pembayaran campuran adalah norma di Indonesia (tunai + QRIS) |
| 4 | **Pricing & pajak dasar** (harga per outlet, PPN/PB1, inklusif/eksklusif) | WAJIB v1 | Salah pajak = masalah hukum, bukan bug |
| 5 | **Diskon & authority** (siapa boleh diskon berapa) | WAJIB v1 | Vektor fraud kasir #1; ESB menaruhnya di tier Basic |
| 6 | **Shift & cash management** (buka/tutup kas, selisih) | WAJIB v1 | Tanpa ini merchant tidak bisa menutup buku |
| 7 | **Stock movement dasar** (stok masuk/keluar/opname, cutting otomatis) | WAJIB v1 | ESB mencantumkan "End Day Cutting Stock" di tier terendah |
| 8 | **RBAC & audit trail** | WAJIB v1 | Retrofit audit trail ke sistem yang sudah jalan = menulis ulang |
| 9 | **Reporting operasional** (penjualan harian, per produk, per kasir, per shift) | WAJIB v1 | Ini alasan merchant membeli POS, bukan mesin kasir |
| 10 | **Table & floor management** (F&B) | PENTING | ESB menaruhnya di Basic — table stakes F&B, tapi kafe takeaway bisa jalan tanpanya |
| 11 | **Kitchen Display System** | PENTING | Loyverse memberikan gratis; design system Lumi sudah punya surface KDS |
| 12 | **Refund / void / retur** | PENTING (parsial WAJIB) | Void order berjalan = WAJIB. Refund transaksi hari lalu = PENTING |
| 13 | **Pelanggan & loyalty** | PENTING | Ada di semua kompetitor tapi tidak menghalangi operasi harian |
| 14 | **Multi-outlet & transfer stok** | PENTING | Segmen target 2–20 outlet; tapi outlet pertama bisa jalan tanpanya |
| 15 | **Promo & voucher lanjutan** (bundle, happy hour, buy-X-get-Y) | BISA DITUNDA | Diskon manual menutupi 80% kasus di awal |
| 16 | **Purchasing & supplier** (PO, penerimaan barang, hutang) | BISA DITUNDA | Merchant kecil mengelolanya di WhatsApp/Excel; nyeri baru muncul di skala |
| 17 | **Resep / BOM** (F&B) | BISA DITUNDA | Nyeri nyata tapi tidak menghalangi jualan; butuh data master yang jarang siap di merchant kecil |

`[INFERENSI]` Sembilan area WAJIB v1 sudah merupakan sistem yang besar. Godaan terbesar adalah memindahkan #11 (KDS) ke WAJIB karena design system sudah punya surface-nya — itu harus ditahan. Design system menyediakan komponen; ia tidak menentukan urutan rilis.

---

## 3. Katalog produk — area yang paling sering dirusak sejak awal

### 3.1 Tiga tingkat dan aturan pemisahnya

`[FAKTA]` Square memodelkan katalog sebagai: `CatalogItem` (produk yang dijual, **tanpa harga dan tanpa SKU**) → `CatalogItemVariation` (detail spesifik dengan harga dan SKU) → `CatalogModifier` dikelompokkan dalam `CatalogModifierList` (kustomisasi saat pembelian, punya harga tapi **tidak punya SKU**).

`[FAKTA]` Aturan keputusan yang dinyatakan Square secara eksplisit:
> - Apakah ini merepresentasikan sesuatu dengan SKU dan harga yang ditetapkan? → kemungkinan besar **item variation**.
> - Apakah ini merepresentasikan kustomisasi yang mungkin menambah biaya pada sesuatu yang sudah punya SKU dan harga dasar, atau properti yang bisa berlaku pada banyak variation? → kemungkinan besar **modifier**.

`[FAKTA]` Setiap `CatalogItem` **wajib punya minimal satu variation** sebelum bisa masuk transaksi; maksimum 250 variation. Item dengan satu variation ditampilkan dalam bentuk sederhana (nama variation disembunyikan, harga/SKU di-inline ke item).

`[FAKTA]` Lightspeed membuat pemisahan yang sama dengan bahasa berbeda: variation dipetakan ke SKU spesifik dan **inventory dimodelkan per Product Variant**; modifier tidak bisa dibeli sendiri tapi bisa punya harga sendiri.

`[FAKTA]` Modifier list mengontrol: pengelompokan modifier, batas kuantitas modifier yang bisa ditambahkan, batas/kewajiban pemilihan (single-select wajib vs multi-select bebas), apakah modifier yang sama bisa dipilih berulang, dan modifier mana yang terpilih secara default.

*Sumber: [Design a Catalog — Square Developer Documentation](https://developer.squareup.com/docs/catalog-api/design-a-catalog) (diakses 27 Jul 2026) · [Enable Item Customization with Modifiers — Square Developer](https://developer.squareup.com/docs/catalog-api/enable-modifiers-on-items) (27 Jul 2026) · [What is the difference between Products, Modifiers, Variants & Option Sets? — Lightspeed Restaurant POS O-Series](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329349913243-What-is-the-difference-between-Products-Modifiers-Variants-Option-Sets) (27 Jul 2026)*

### 3.2 Pola pemakaian berbeda per vertikal

`[FAKTA]` Square mendokumentasikan bahwa pola katalog berbeda menurut jenis bisnis:
- Retail kecil: banyak variation dasar untuk tracking & reporting, **sedikit modifier**.
- F&B: **banyak variation dan modifier** karena tingkat kustomisasi pembelian tinggi.
- Jasa: banyak variation, jarang modifier.

`[INFERENSI]` Ini adalah bukti langsung bahwa perbedaan vertikal **bukan** perbedaan struktur data, melainkan perbedaan *bobot pemakaian* struktur yang sama. Kafe memakai modifier secara intensif; minimarket hampir tidak memakainya sama sekali. Ini argumen terkuat untuk KEP-05: satu model katalog, konfigurasi berbeda — bukan dua model katalog.

### 3.3 Jebakan yang sering terjadi

| Jebakan | Gejala | Konsekuensi |
|---|---|---|
| Modifier dipakai untuk hal yang punya SKU | "Ukuran: Kecil/Sedang/Besar" dibuat sebagai modifier | Stok tidak bisa dilacak per ukuran. Tidak bisa diperbaiki tanpa migrasi data + retraining merchant |
| Variation dipakai untuk kustomisasi | Setiap kombinasi topping jadi variation sendiri | Ledakan kombinatorial: 6 topping opsional = 64 variation |
| Item tanpa variation | Produk sederhana disimpan dengan harga di level item | Setiap penambahan varian belakangan memaksa migrasi. Square menyelesaikan ini dengan variation "Regular" implisit |
| Harga disimpan hanya di katalog | Struk lama menampilkan harga hari ini, bukan harga saat transaksi | Sengketa dengan pelanggan dan audit tidak bisa direkonstruksi. Dibahas penuh di Fase 4 (versioning katalog) |
| Kategori sebagai hierarki dalam | Kategori bersarang 4 tingkat | Kasir tidak bisa menemukan produk dalam 2 tap; melanggar aturan density design system (min 12 kartu produk tanpa scroll di 1024×768) |

`[FAKTA]` Square membatasi kategorisasi hanya untuk `CatalogItem` — pajak, diskon, pricing rule, dan product set **tidak bisa** dikategorikan karena bukan item yang dijual. `[INFERENSI]` Batasan ini layak ditiru: mencampur entitas yang dijual dengan entitas aturan dalam satu pohon kategori adalah sumber kebingungan UI yang bisa dihindari sejak awal.

### 3.4 Satuan & konversi (kebutuhan retail)

`[ASUMSI]` Retail Indonesia butuh konversi satuan sebagai kasus kelas satu: beli 1 dus = 24 pcs, jual per pcs; beli beras karung 25 kg, jual per kg dengan timbangan. Square menangani ini lewat "stock conversion" pada Inventory API `[FAKTA — keberadaan fitur terkonfirmasi dari struktur dokumentasi Square: "Enable Stock Conversion"]`, yang mengindikasikan ini masalah cukup umum sampai butuh fitur khusus.

`[INFERENSI]` Konsekuensi data model: `ItemVariation` butuh konsep *stocking unit* yang bisa berbeda dari *selling unit*, dengan faktor konversi. Menaruhnya belakangan berarti setiap query stok harus diaudit ulang. Ini masuk ke ERD v1 meskipun UI-nya tidak dibangun di v1.

*Sumber: [Enable Stock Conversion — Square Developer](https://developer.squareup.com/docs/inventory-api/enable-stock-conversion) (struktur dokumentasi diakses 27 Jul 2026)*

---

## 4. Order lifecycle

### 4.1 State yang dibutuhkan

`[INFERENSI]` Diturunkan dari kebutuhan F&B dan retail sekaligus:

```
DRAFT ──► OPEN ──► (partially paid) ──► PAID ──► CLOSED
   │        │                              │
   │        ├──► VOIDED                     └──► REFUNDED (parsial/penuh)
   │        │
   └────────┴──► ABANDONED (auto, mis. saat tutup shift)
```

Perbedaan vertikal yang nyata:
- **Retail**: order hidup dalam hitungan detik. DRAFT → PAID → CLOSED nyaris atomik. State OPEN jarang bertahan.
- **F&B dine-in**: order hidup 30–120 menit dalam state OPEN, bisa ditambahi item berkali-kali, bisa dipindah meja, bisa digabung/dipecah.

`[FAKTA]` Kompleksitas F&B ini tercermin di matriks fitur ESB yang mencantumkan sebagai fitur terpisah: **Table Management, Merge & Link Table, Move Item & Table, Split Bill** — empat fitur berbeda yang semuanya beroperasi pada order dalam state OPEN.
*Sumber: [ESB Pricing — matriks fitur resmi](https://www.esb.id/id/pricing) (diakses 27 Jul 2026)*

### 4.2 Void vs refund — pemisahan yang wajib

`[FAKTA]` Toast memisahkan void pada tiga level berbeda: void item, void payment, dan void check — bukan satu operasi.
`[FAKTA]` Batas antara void dan refund ditentukan oleh state pembayaran, bukan preferensi UI: void reversal mengembalikan error "check must be open" ketika check sudah melewati state di mana reversal diizinkan, dan pada titik itu **refund yang direkomendasikan, bukan void**. Void juga bisa ditolak ("payment denied") jika otorisasi asli sudah di-settle oleh payment processor atau melewati jendela reversal.

`[INFERENSI]` Ini berarti model domain tidak boleh memperlakukan void dan refund sebagai varian dari satu operasi "batalkan". Keduanya punya prasyarat, efek finansial, dan konsekuensi stok yang berbeda:
- **Void** = transaksi dianggap tidak pernah terjadi secara finansial, tapi **jejaknya tetap tercatat** untuk audit. Stok dikembalikan.
- **Refund** = transaksi tetap valid, ditambah transaksi baru yang berlawanan arah. Dua record, bukan satu record yang diubah.

*Sumber: [Void Items, Payments, and Checks — Toast Support](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks) (diakses 27 Jul 2026) · [POS — Void or Refund Payments — Lavu Help Center](https://support.lavu.com/en/knowledge/pos-void-or-refund-payments) (27 Jul 2026)*

### 4.3 Discount & void authority

`[FAKTA]` Pola otorisasi yang dipakai industri: membersihkan split bill membutuhkan security PIN dari karyawan dengan permission refund; jika karyawan pemilik order tidak punya permission tersebut, POS **meminta PIN dari orang yang punya**.

`[INFERENSI]` Ini pola "step-up authorization" — bukan "tolak lalu suruh login ulang sebagai manajer". Perbedaannya besar dalam praktik: kasir tetap memegang layar, manajer datang dan memasukkan PIN, sesi kasir tidak terputus. Design system Lumi sudah mengantisipasi ini: komponen `ConfirmDialog` dispesifikasikan untuk "aksi merusak: void/refund/tutup kas — PIN owner + alasan dari daftar tertutup, 'Lainnya' wajib catatan, konfirmasi danger 56px".

**Yang harus ditiru dan diperkuat:** alasan dari **daftar tertutup**, bukan free text. Alasan free text tidak bisa diagregasi jadi laporan fraud. Daftar tertutup + opsi "Lainnya" yang wajib catatan adalah kompromi yang benar.

*Sumber: [How to Split Bill by Item Using Table Management — Qashier Help Center](https://support.qashier.com/en/articles/7911957-how-to-split-bill-by-item-using-table-management-in-qashier-pos) (diakses 27 Jul 2026) · `/ds-bundle/readme.md` — spesifikasi komponen `ConfirmDialog`*

---

## 5. Payment & split bill

`[FAKTA]` Split bill di industri didefinisikan sebagai pembagian satu tagihan barang/jasa menjadi dua bagian atau lebih. Dua mode standar: **split rata** (sistem membuat check terbagi otomatis) dan **split manual** (operator memasukkan jumlah per check). Varian ketiga yang umum: **split per item**.

*Sumber: [Split Bills — Revel Systems](https://support.revelsystems.com/s/article/Split-Bills-1582901435396) (diakses 27 Jul 2026) · [Split Merge Bill — MobiPOS](https://www.mobi-pos.com/web/guide/settings/split-merge-bill) (27 Jul 2026) · [Split Bill POS Commands — LS Central Help](https://help.lscentral.lsretail.com/Content/LS-Hospitality/Order-And-Sales-Management/Split-Bill-POS-Commands.htm) (27 Jul 2026)*

`[INFERENSI]` Tiga mode split ini tidak bisa dimodelkan kalau `Order` punya kolom `payment_method` dan `paid_amount`. Yang dibutuhkan minimal:

```
Order (1) ──< OrderLine (n)
Order (1) ──< Payment (n)        ← banyak payment per order
Payment ──► method, amount, reference, tendered_at
```

Dan untuk split per item, satu tingkat lagi: konsep **Check** (tagihan) yang berada di antara Order dan Payment, di mana satu Order bisa punya banyak Check, dan setiap Check punya subset dari OrderLine.

`[INFERENSI]` **Kabar buruk yang tidak disembunyikan:** memperkenalkan entitas `Check` menambah satu tingkat tidak langsung ke *setiap* query penjualan, setiap laporan, dan setiap perhitungan pajak. Biayanya nyata. Alternatifnya — menambahkan `Check` belakangan — berarti memigrasi seluruh riwayat transaksi. Rekomendasi: **modelkan `Check` di ERD v1 tapi dengan kardinalitas 1:1 yang dipaksakan di v1** (satu order = satu check), sehingga membuka split per item nanti adalah pelonggaran constraint, bukan migrasi struktur.

**Konteks Indonesia yang sering dilupakan** `[ASUMSI]`: pembayaran campuran (sebagian tunai, sisanya QRIS) sangat umum di kafe Indonesia karena pelanggan patungan. Ini bukan edge case — ini alur harian. Model `Payment` sebagai koleksi menangani ini secara alami; model `payment_method` sebagai kolom tidak.

---

## 6. Inventory & stock movement

`[FAKTA]` POS modern menghubungkan penjualan menu langsung ke deplesi bahan (*perpetual inventory*), menghasilkan metrik **actual vs theoretical (AvT)** — selisih antara deplesi produk aktual dengan yang seharusnya menurut catatan penjualan. Selisih ini (*variance*) adalah metrik utama deteksi kebocoran.
`[FAKTA]` Sub-recipe adalah pola standar: saus buatan rumah yang dipakai di lima hidangan harus ada sebagai **satu sub-recipe** yang di-feed ke setiap menu item; mengedit resep saus sekali akan meng-update cost dan deplesi di kelima hidangan secara otomatis.

*Sumber: [Restaurant Inventory Management Software — Toast POS](https://pos.toasttab.com/products/inventory-management) (diakses 27 Jul 2026) · [Ingredient Inventory Management: The Complete Guide for Restaurants — meez](https://www.getmeez.com/blog/recipes-in-optimizing-inventory-management) (27 Jul 2026) · [Recipe / Bill of Materials (BoM) — Orocube POS Guide](https://guide.orocube.com/recipe/) (27 Jul 2026)*

### Mengapa stok harus ledger, bukan kolom

`[INFERENSI]` Tiga alasan independen yang semuanya mengarah ke kesimpulan sama:

1. **Sinkronisasi offline.** Kalau stok adalah kolom `qty` yang di-update, dua device offline yang sama-sama menjual produk yang sama akan menghasilkan konflik last-write-wins yang secara diam-diam menghilangkan penjualan. Kalau stok adalah ledger of movements, dua device menghasilkan dua entry yang keduanya bertahan dan hasilnya konvergen. (Digarap penuh di Fase 5.)
2. **Audit.** Pertanyaan "kenapa stok kopi tinggal 3 padahal kemarin 40" hanya bisa dijawab kalau setiap perubahan punya record. Kolom yang di-update kehilangan sejarahnya.
3. **AvT variance.** Metrik ini secara definisi membutuhkan dua aliran: deplesi teoretis (dari penjualan × resep) dan deplesi aktual (dari opname). Keduanya adalah movement dengan tipe berbeda pada ledger yang sama.

**Biayanya, dikatakan langsung:** setiap tampilan "stok saat ini" menjadi agregasi, bukan pembacaan kolom. Untuk katalog 5.000 SKU dengan ratusan ribu movement, ini butuh materialized view atau tabel snapshot yang dipelihara — kompleksitas nyata yang tidak ada pada model kolom. Rekomendasi teknis konkret dibahas di Fase 4.

---

## 7. Shift & cash management

`[FAKTA]` Ini fitur tier-terendah di pasar Indonesia — ESB mencantumkan "Sesi Shift" dan "Absensi (+ foto)" di paket Basic.
`[FAKTA]` Square memiliki API terpisah khusus untuk ini: **Cash Drawer Shifts**, yang menandakan bahwa shift kas adalah agregat domain tersendiri, bukan atribut pada transaksi.

*Sumber: [ESB Pricing — matriks fitur](https://www.esb.id/id/pricing) (27 Jul 2026) · [Cash Drawer Shifts — Square Developer](https://developer.squareup.com/docs/cashdrawershift-api/reporting) (27 Jul 2026)*

`[INFERENSI]` Model minimum yang dibutuhkan:

| Konsep | Isi |
|---|---|
| `CashDrawerShift` | outlet, device, kasir pembuka, waktu buka, saldo awal (dihitung manual oleh kasir), waktu tutup, kasir penutup, saldo akhir terhitung, saldo akhir aktual, **selisih** |
| `CashMovement` | penjualan tunai, refund tunai, setoran (paid-in), pengeluaran (paid-out), transfer ke brankas |

Design system Lumi sudah memberi petunjuk desain yang penting: layar "Tutup Kas" memakai copy *"Hitung dulu, baru sistem menampilkan angkanya"* — artinya **kasir memasukkan hitungan fisik sebelum melihat angka sistem**. Ini bukan detail UI, ini kontrol anti-fraud yang mengikat data model: sistem harus menyimpan angka yang dimasukkan kasir dan angka terhitung sistem sebagai dua field terpisah, dan urutan pengisiannya harus ditegakkan.

*Sumber: `/ds-bundle/readme.md` — Content Fundamentals*

---

## 8. Analisis inti — bagaimana produk multi-vertikal menangani F&B vs retail

Ini pertanyaan riset terpenting di Fase 2 dan pondasi konsep "mode" Lumi POS.

### 8.1 Empat pola yang dipakai industri

`[FAKTA]` **Pola A — Feature flags + configuration tables.** Konsensus di literatur SaaS multi-tenant: fleksibilitas datang dari feature flag dan tabel konfigurasi, bukan dari codebase terpisah. Beberapa tenant berbagi codebase yang sama dengan feature flag mengontrol fitur mana yang bisa diakses tiap tier, tanpa memelihara codepath terpisah atau men-deploy build berbeda.

`[FAKTA]` **Pola B — Industry templates dengan flag berskala besar.** Contoh terdokumentasi dari dunia enterprise software: satu vendor menawarkan 10 template yang disesuaikan untuk 18 industri vertikal dengan **700 configuration flag** berbeda, di mana ~300 di antaranya sudah di-default untuk satu industri tertentu. Template mencakup workflow, konstruksi pemodelan, dan engine optimasi yang merepresentasikan best practice tiap industri, tapi bisa dimodifikasi pelanggan yang tidak mengikuti proses standar industri.

`[FAKTA]` **Pola C — Vertical modules (Odoo).** Modul vertikal adalah paket aplikasi industri-spesifik yang mem-prakonfigurasi sistem sehingga workflow tipikal industri langsung bisa dipakai tanpa development in-house. Sebuah "Vertical" menyediakan workflow, **field, view, dan otomasi** yang sesuai. Odoo 20 memperkenalkan solusi industri untuk minimal delapan sektor (mis. Auto Repair Shop, Hotel+).

`[FAKTA]` **Pola D — Localization packages (Odoo, untuk sumbu geografis).** Paket lokalisasi fiskal adalah modul country-specific yang meng-install pajak, fiscal position, chart of accounts, dan legal statement yang sudah dikonfigurasi ke database.

*Sumber: [Offering vertical options — InfoWorld](https://infoworld.com/article/2682433/offering-vertical-options.html) · [SaaS Feature Flags: Implementation Guide 2026 — DesignRevision](https://designrevision.com/blog/saas-feature-flags-guide) · [Odoo 20 Vertical Modules: The New Industry Apps — Pixel Mechanics](https://www.pixelmechanics.tech/en/blog/odoo-20-vertical-modules-industry-apps-2026) · [Fiscal localizations — Odoo 19.0 documentation](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations.html) · [The developer's guide to SaaS multi-tenant architecture — WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) (semua diakses 27 Jul 2026)*

### 8.2 Apa yang sebenarnya berbeda antara F&B dan retail

Sebelum memilih pola, perbedaannya harus dipetakan secara jujur — bukan diasumsikan besar.

| Dimensi | F&B (kafe/resto) | Retail umum | Berbeda di level apa? |
|---|---|---|---|
| Struktur katalog | Item → Variation → **banyak Modifier** | Item → **banyak Variation** → sedikit/tanpa Modifier | **Bobot pemakaian**, bukan struktur |
| Identifikasi produk | Nama + gambar, dipilih dari grid | **Barcode/SKU**, dipindai | **Alur input**, bukan struktur |
| Umur order | 30–120 menit (dine-in) | Detik | **Bobot state OPEN** |
| Konteks order | **Meja**, dine-in/takeaway | Tanpa konteks lokasi | **Field tambahan opsional** |
| Fulfillment | **Butuh KDS**, ada antrean dapur | Instan | **Modul tambahan** |
| Deplesi stok | Tidak langsung, lewat **resep/BOM** | Langsung 1:1 | **Struktur berbeda — perbedaan nyata** |
| Satuan | Porsi, tanpa konversi | **Konversi satuan** (dus→pcs, kg) | **Struktur berbeda — perbedaan nyata** |
| Pajak | Sering **PB1 (pajak daerah)**, bukan PPN | PPN | **Konfigurasi pajak** |
| Retur barang | Hampir tidak ada | **Retur & tukar** biasa | **Alur tambahan** |

`[INFERENSI]` Hasil pemetaan ini adalah temuan paling penting di Fase 2: **dari sembilan dimensi, hanya dua yang benar-benar berbeda di level struktur data** (deplesi lewat resep, dan konversi satuan). Sisanya adalah perbedaan konfigurasi, bobot pemakaian, atau modul opsional.

Ini mematahkan asumsi umum bahwa multi-vertikal butuh dua data model. Yang dibutuhkan adalah **satu data model yang punya dua ekstensi opsional** (Recipe, UnitConversion) dan satu lapisan konfigurasi yang mengatur sisanya.

### 8.3 Pola mana yang paling tahan jangka panjang

| Pola | Yang terjadi setelah 3 tahun | Verdict untuk Lumi POS |
|---|---|---|
| Feature flag boolean per fitur | Ratusan flag saling bergantung, tidak ada yang berani menghapus. Kombinasi flag yang tidak pernah diuji jadi mayoritas ruang state | **Ditolak sebagai mekanisme utama.** Tetap dipakai untuk gating komersial (Fase 9), bukan untuk perbedaan vertikal |
| Modul terpisah per vertikal | Duplikasi logika penjualan; perbaikan bug harus dikerjakan dua kali; divergensi perlahan | **Ditolak.** Fatal untuk solo builder |
| Codebase terpisah | Dua produk dengan satu nama | **Ditolak.** |
| Profil vertikal berdata (industry template) | Konfigurasi terbaca sebagai satu dokumen; vertikal baru = satu record baru + mungkin satu modul opsional | **Diterima** |

---

## 9. Keputusan

### KEP-04 — Struktur model katalog

**Pertanyaan:** Bagaimana produk dimodelkan agar satu struktur melayani kafe (banyak modifier) dan minimarket (banyak SKU) tanpa kompromi di keduanya?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Dua tingkat: Product → Variant, modifier sebagai teks bebas di order line | Paling sederhana; cukup untuk retail | Modifier tidak punya harga terstruktur, tidak bisa masuk laporan, tidak bisa memicu deplesi stok. Fatal untuk F&B | Retail murni tanpa kustomisasi |
| B. Tiga tingkat: Item → Variation → Modifier (via ModifierList) | Terbukti di Square & Lightspeed; memisahkan "punya SKU" dari "kustomisasi"; satu struktur melayani dua vertikal dengan bobot berbeda | Lebih banyak tabel; merchant sering salah menempatkan (ukuran sebagai modifier) sehingga butuh guardrail di UI | Multi-vertikal dengan kebutuhan inventory serius |
| C. Entity-Attribute-Value generik (produk sebagai bag of attributes) | Fleksibilitas maksimum, vertikal baru tanpa perubahan skema | Query menjadi mimpi buruk; tidak ada type safety; performa buruk; tidak bisa dijelaskan ke merchant | Katalog dengan atribut yang benar-benar tidak bisa diprediksi |

**Rekomendasi:** Opsi B. `[INFERENSI dari konvergensi Square dan Lightspeed pada model yang sama secara independen]`

**Alasan:** Dua vendor besar dengan basis merchant yang berbeda (Square lebih retail, Lightspeed lebih hospitality) sampai pada model tiga tingkat yang sama, dengan aturan pemisah yang sama-sama berbasis "punya SKU atau tidak". Konvergensi independen semacam ini adalah sinyal kuat bahwa modelnya benar untuk domain, bukan artefak satu tim. Square juga secara eksplisit mendokumentasikan bahwa retail dan F&B memakai model yang sama dengan bobot berbeda — persis kebutuhan Lumi POS. Guardrail yang wajib ada di UI untuk mengatasi kelemahan opsi ini: saat merchant membuat modifier, tanyakan "apakah ini perlu dilacak stoknya?" dan arahkan ke variation kalau jawabannya ya.

**Kapan keputusan ini harus ditinjau ulang:** jika riset merchant menunjukkan >30% merchant target menjual produk dengan atribut yang tidak bisa dipetakan ke variation/modifier (mis. produk custom-made dengan spesifikasi bebas), tambahkan lapisan custom attribute — Square menyediakan preseden untuk ini — **tanpa** berpindah ke opsi C.

**Sumber:** [Design a Catalog — Square Developer](https://developer.squareup.com/docs/catalog-api/design-a-catalog) (27 Jul 2026) · [Products, Modifiers, Variants & Option Sets — Lightspeed Restaurant O-Series](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329349913243-What-is-the-difference-between-Products-Modifiers-Variants-Option-Sets) (27 Jul 2026)

---

### KEP-05 — Mekanisme konsep "mode" / multi-vertikal

**Pertanyaan:** Bagaimana satu produk berperilaku sebagai POS kafe untuk satu merchant dan POS minimarket untuk merchant lain?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Feature flag boolean per fitur (`table_management: true`) | Mudah dimulai; granular | Tidak bisa mengubah bentuk data, hanya visibilitas. Ruang kombinasi meledak; sebagian besar kombinasi tidak pernah diuji. Tidak ada yang berani menghapus flag lama | Gating komersial per tier, bukan perbedaan vertikal |
| B. Modul terpisah per vertikal (`pos-fnb`, `pos-retail`) | Isolasi bersih; tim berbeda bisa bekerja paralel | Logika penjualan terduplikasi; bug diperbaiki dua kali; divergensi perlahan tak terhindarkan. Fatal untuk solo builder | Tim besar dengan vertikal yang benar-benar berbeda domainnya |
| C. Profil vertikal berdata: satu record `VerticalProfile` per outlet berisi modul aktif, alur kasir default, field katalog wajib, dan preset pajak — plus dua modul opsional (Recipe, UnitConversion) yang bisa dinyalakan | Konfigurasi terbaca sebagai satu dokumen yang bisa di-review; vertikal ketiga (mis. apotek, salon) = satu record baru; satu codepath penjualan; bisa diuji sebagai matriks profil × skenario | Butuh disiplin: setiap kali tergoda menulis `if (isFnB)` di luar lapisan profil, itu tanda desain bocor. Butuh keputusan desain di awal yang lebih mahal | Multi-vertikal serius dengan tim kecil |

**Rekomendasi:** Opsi C. `[INFERENSI dari pola vertical module Odoo dan industry template dengan configuration flags]`

**Alasan:** Pemetaan di bagian 8.2 menunjukkan hanya dua dari sembilan dimensi perbedaan F&B/retail yang benar-benar struktural. Untuk tujuh dimensi sisanya, profil berdata sudah cukup — dan untuk dua yang struktural, modul opsional adalah jawaban yang tepat karena keduanya memang *tambahan* pada model inti, bukan *pengganti*. Odoo membuktikan pola ini berskala ke belasan industri dengan mem-prakonfigurasi workflow, field, view, dan otomasi. Preseden 700-configuration-flag dari dunia enterprise menunjukkan batas atas pendekatan ini juga: ia berskala, tapi hanya jika flag dikelompokkan dalam template, bukan dibiarkan lepas.

**Kapan keputusan ini harus ditinjau ulang:** jika muncul vertikal yang membutuhkan **order lifecycle** yang berbeda secara fundamental (mis. salon dengan booking dan slot waktu, atau apotek dengan resep dokter dan regulasi obat keras), profil berdata tidak cukup — itu titik di mana modul vertikal sejati (Opsi B) menjadi jawaban yang benar untuk vertikal tersebut saja, sementara F&B dan retail tetap berbagi profil.

**Sumber:** [Odoo 20 Vertical Modules — Pixel Mechanics](https://www.pixelmechanics.tech/en/blog/odoo-20-vertical-modules-industry-apps-2026) (27 Jul 2026) · [Offering vertical options — InfoWorld](https://infoworld.com/article/2682433/offering-vertical-options.html) (27 Jul 2026) · [Design a Catalog — Square Developer](https://developer.squareup.com/docs/catalog-api/design-a-catalog), bagian pola pemakaian per jenis bisnis (27 Jul 2026)

---

### KEP-06 — Relasi Order dan Payment

**Pertanyaan:** Bagaimana pembayaran dimodelkan agar split bill, pembayaran campuran, dan pembayaran parsial semuanya bisa ditangani?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Payment sebagai kolom pada Order (`payment_method`, `paid_amount`) | Query paling sederhana; laporan langsung | Mustahil merepresentasikan tunai+QRIS dalam satu transaksi — alur harian di kafe Indonesia. Split bill tidak mungkin | Prototipe |
| B. Order 1:N Payment | Menangani pembayaran campuran dan parsial secara alami; refund parsial jadi payment negatif atau entitas refund terpisah | Split *per item* masih tidak bisa direpresentasikan | Retail dan F&B takeaway |
| C. Order 1:N Check 1:N Payment, dengan OrderLine dialokasikan ke Check | Menangani ketiga mode split (rata, manual, per item); model pajak per check jadi benar | Satu tingkat tidak langsung di **setiap** query penjualan dan laporan. Biaya kognitif dan performa nyata | F&B dine-in dengan split bill sebagai fitur yang dipakai |

**Rekomendasi:** Opsi C secara skema, dengan **constraint 1:1 Order↔Check ditegakkan di aplikasi selama v1**. `[INFERENSI]`

**Alasan:** Ini kompromi yang sadar antara dua biaya yang keduanya nyata. Memilih B lalu bermigrasi ke C berarti menulis ulang seluruh riwayat transaksi dan setiap laporan — pekerjaan berminggu-minggu pada sistem yang sudah punya pelanggan berbayar dan data finansial yang tidak boleh rusak. Memilih C penuh sejak v1 berarti membayar kompleksitas untuk fitur yang belum dirilis. Menaruh `Check` di skema tapi menguncinya 1:1 membuat pengaktifan split bill nanti menjadi pelonggaran validasi plus UI baru — bukan migrasi data. Split bill juga sudah terkonfirmasi sebagai table stakes F&B Indonesia (ada di tier Basic ESB), jadi ini bukan fitur spekulatif.

**Kapan keputusan ini harus ditinjau ulang:** jika setelah 6 bulan v1 tidak ada satu pun merchant yang meminta split bill (tidak mungkin untuk F&B, tapi mungkin jika beachhead bergeser ke retail), hapus entitas `Check` sebelum volume data membuatnya mahal.

**Sumber:** [Split Bills — Revel Systems](https://support.revelsystems.com/s/article/Split-Bills-1582901435396) (27 Jul 2026) · [Split Bill POS Commands — LS Central](https://help.lscentral.lsretail.com/Content/LS-Hospitality/Order-And-Sales-Management/Split-Bill-POS-Commands.htm) (27 Jul 2026) · [ESB Pricing — Split Bill di tier Basic](https://www.esb.id/id/pricing) (27 Jul 2026)

---

### KEP-07 — Representasi stok

**Pertanyaan:** Apakah stok disimpan sebagai angka saat ini atau sebagai riwayat pergerakan?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Kolom `quantity_on_hand` pada variation, di-update setiap transaksi | Pembacaan instan; skema minimal | Kehilangan sejarah; konflik sync last-write-wins yang menghilangkan penjualan secara diam-diam; tidak bisa menghitung AvT variance; audit mustahil | Single-device, selalu online |
| B. Movement ledger (append-only), stok saat ini = SUM(movements) | Sejarah lengkap; konvergen di bawah sync offline; AvT variance jadi query alami; audit trail gratis | Setiap pembacaan stok adalah agregasi; butuh snapshot/materialized view pada volume besar | Sistem offline-first dengan kebutuhan audit |
| C. Hybrid: ledger sebagai sumber kebenaran + kolom snapshot yang dipelihara | Pembacaan cepat **dan** sejarah lengkap | Dua sumber yang bisa menyimpang; butuh proses rekonsiliasi dan deteksi drift | Volume besar dengan kebutuhan audit |

**Rekomendasi:** Opsi B untuk v1, dengan jalur migrasi ke C yang direncanakan sejak awal. `[INFERENSI dari kebutuhan AvT variance dan konsekuensi sinkronisasi offline]`

**Alasan:** Tiga kebutuhan yang tidak berhubungan — sinkronisasi offline yang konvergen, audit trail yang tahan sengketa, dan metrik AvT variance — semuanya secara independen mengarah ke ledger. Ketika tiga kebutuhan berbeda menuntut struktur yang sama, itu struktur yang benar. Opsi C ditunda karena drift antara snapshot dan ledger adalah kelas bug yang mahal untuk di-debug, dan pada skala v1 (merchant 2–20 outlet, ribuan transaksi/hari) agregasi langsung masih layak. Ambang pindah ke C harus ditentukan dengan pengukuran, bukan firasat — dicatat di Fase 10.

**Kapan keputusan ini harus ditinjau ulang:** ketika query "stok saat ini untuk seluruh katalog satu outlet" melewati ~200ms pada data produksi nyata, atau ketika satu outlet melewati ~500.000 movement. Pada titik itu tambahkan snapshot (Opsi C) — bukan sebelumnya.

**Sumber:** [Restaurant Inventory Management Software — Toast POS](https://pos.toasttab.com/products/inventory-management) (27 Jul 2026) · [Ingredient Inventory Management — meez](https://www.getmeez.com/blog/recipes-in-optimizing-inventory-management) (27 Jul 2026) · [Inspect Inventory Changes — Square Developer](https://developer.squareup.com/docs/inventory-api/cookbook/inventory-change-history) (27 Jul 2026)

---

## 10. Cakupan v1 — daftar yang mengikat

**Masuk v1 (9 area):** Katalog · Order lifecycle · Payment & split (skema, 1:1 di v1) · Pricing & pajak dasar · Diskon & authority · Shift & cash management · Stock movement dasar · RBAC & audit trail · Reporting operasional.

**Tidak masuk v1, dan alasannya ditulis agar tidak bocor kembali:**

| Dipotong | Alasan | Kapan masuk |
|---|---|---|
| Table management & KDS | Kafe takeaway (mayoritas segmen awal) bisa beroperasi penuh tanpanya. Menambah dua surface + state sinkronisasi antar-device | v1.1 — ini yang pertama masuk |
| Resep/BOM | Butuh data master yang jarang siap di merchant; nilai baru terasa setelah 3 bulan data penjualan | v1.2 |
| Purchasing & supplier | Dikelola merchant di WhatsApp/Excel; tidak menghalangi penutupan buku harian | v1.3 |
| Loyalty | Table stakes kompetitif, bukan table stakes operasional | v1.2 |
| Transfer stok antar outlet | Merchant biasanya membuka outlet kedua setelah 6+ bulan | v1.1 |
| Promo lanjutan (bundle, happy hour) | Diskon manual menutupi mayoritas kasus awal | v1.2 |
| Integrasi GoFood/GrabFood/ShopeeFood | **Risiko terbesar dari daftar ini** — table stakes pasar tapi effort integrasi besar. Perlu keputusan manusia | Lihat `12-OPEN-QUESTIONS.md` |

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Sembilan area WAJIB v1 menjadi struktur bab functional requirements. Delapan yang dipotong masuk ke bagian "Non-goals v1" **beserta alasannya** — tanpa alasan tertulis, item ini akan kembali lewat scope creep.
- Aturan pemisah variation vs modifier dari Square harus masuk PRD sebagai *product rule* yang ditegakkan UI, bukan sekadar catatan desain. Butuh user story: "Sebagai merchant yang membuat modifier baru, saya ditanya apakah item ini perlu dilacak stoknya, dan diarahkan membuat variation kalau ya."
- Void dan refund butuh dua set acceptance criteria terpisah dengan prasyarat berbeda, bukan satu user story "batalkan transaksi".
- Alur tutup kas harus menspesifikasikan urutan wajib: kasir memasukkan hitungan fisik → sistem baru menampilkan angka terhitung dan selisih. Ini kontrol, bukan preferensi UX.

**Untuk Information Architecture:**
- Konsep "profil vertikal" butuh tempat di IA: kemungkinan besar di Pengaturan tingkat outlet, dengan efek yang terlihat langsung di navigasi (modul Meja & KDS muncul/hilang).
- Hierarki kategori dibatasi maksimal dua tingkat untuk memenuhi aturan density design system (min 12 kartu produk 96px tanpa scroll di 1024×768).
- Layar kasir F&B dan retail berbagi kerangka yang sama; yang berbeda adalah komponen input primer (grid produk vs field barcode) dan keberadaan konteks meja.

**Untuk ERD:**
- Entitas inti v1: `Item`, `ItemVariation`, `ModifierList`, `Modifier`, `Category`, `Order`, `Check`, `OrderLine`, `OrderLineModifier`, `Payment`, `Refund`, `StockMovement`, `CashDrawerShift`, `CashMovement`, `Outlet`, `User`, `Role`, `AuditEvent`, `VerticalProfile`.
- `Check` dimodelkan penuh tapi dikunci 1:1 dengan `Order` di v1 (KEP-06).
- `ItemVariation` butuh *stocking unit* + *selling unit* + faktor konversi sejak skema pertama, meskipun UI konversi tidak dibangun di v1.
- Stok **tidak** punya kolom `quantity`. Stok adalah `SUM(StockMovement.delta)` per (outlet, variation). Titik.
- `Recipe`/`RecipeLine` dan `UnitConversion` dirancang sebagai ekstensi opsional — tabel terpisah yang tidak mengubah entitas inti saat tidak dipakai.
- Setiap entitas transaksional butuh `outlet_id`. Setiap entitas master butuh keputusan eksplisit: tenant-scoped atau outlet-scoped (harga jelas outlet-scoped; katalog kemungkinan tenant-scoped dengan override per outlet).

**Untuk Technical Architecture:**
- Batas modul yang harus ditegakkan sejak awal: Catalog · Ordering · Payment · Inventory · Cash · Identity/RBAC · Reporting. `VerticalProfile` dibaca oleh semua modul tapi dimiliki oleh Settings.
- Aturan disiplin yang harus ditulis di dokumen arsitektur: **tidak boleh ada `if (vertical == 'fnb')` di luar lapisan yang membaca `VerticalProfile`.** Kemunculannya adalah sinyal desain bocor dan harus jadi item review.
- Stok sebagai ledger punya konsekuensi query yang harus dijawab arsitektur: strategi agregasi, kapan snapshot diperkenalkan, dan bagaimana device offline menghitung stok lokal tanpa mereplikasi seluruh ledger.
- Pemisahan Order/Payment berarti perhitungan pajak beroperasi pada level Check, bukan Order — ini menentukan di mana logika pajak hidup (dibahas lanjut di Fase 6).

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `03-TECH-STACK-EVALUATION.md`.*
