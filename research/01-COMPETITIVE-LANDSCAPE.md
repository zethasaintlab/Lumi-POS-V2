# 01 — Lanskap & Kompetitor

> Dokumen riset pra-produksi Lumi POS. Fase 1 dari 12.
> Tanggal riset: 27 Juli 2026. Semua klaim harga/fitur diverifikasi lewat pencarian web dalam sesi ini.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri karena data tidak tersedia.

---

## Ringkasan Keputusan

1. **Offline-first bukan diferensiator marketing, melainkan diferensiator teknis yang nyata.** Hampir semua kompetitor besar (Shopify POS, Lightspeed, Square) mendefinisikan "offline" sebagai *degraded mode*: tunai saja, tanpa update stok, tanpa refund, tanpa akses pelanggan. Lumi POS punya ruang nyata untuk menang di sini — tapi hanya jika batas kemampuannya didefinisikan sekeras kompetitor mendefinisikan batas mereka, bukan dijanjikan sebagai "offline penuh". (→ KEP-01)

2. **Segmen yang diserang adalah "celah tengah" pasar Indonesia: merchant 2–20 outlet.** Di bawahnya ada perang harga gratis-sampai-Rp150k (Qasir, Kasir Pintar, Loyverse) yang tidak bisa dimenangkan produk baru. Di atasnya ada ESB yang sudah menguasai enterprise F&B (30.000+ restoran, klien Starbucks Indonesia/Subway). Celah tengah punya kemauan bayar Rp300k–800k/outlet/bulan tapi dilayani produk yang arsitekturnya masih single-outlet. (→ KEP-02)

3. **Multi-vertikal (F&B + retail) dari satu produk adalah posisi yang jarang dipegang dengan baik di Indonesia.** ESB murni F&B; Moka/Majoo mencoba keduanya tapi dengan feature set yang terasa "retail dengan tempelan resto". Ini peluang, tapi hanya jika perbedaan vertikal ditangani di level data model sejak awal, bukan lewat if-else di UI. (→ KEP-03)

4. **Table stakes v1 lebih panjang dari yang nyaman.** Riset kompetitor menunjukkan 14 kapabilitas yang jika absen, merchant tidak akan mempertimbangkan produk sama sekali — termasuk integrasi GoFood/GrabFood/ShopeeFood yang di Indonesia bukan fitur premium melainkan syarat masuk. (→ tabel Table Stakes)

5. **Open-source POS bukan ancaman kompetitif, tapi juga bukan sumber kode yang bisa dipakai.** uniCenta/Chromis/Floreant adalah aplikasi desktop Java era 2010-an dengan arsitektur single-store. Tidak ada satu pun yang bisa dijadikan basis; nilainya murni sebagai referensi domain model. (→ bagian Open Source)

---

## 1. Metodologi & keterbatasan riset

**Yang dilakukan:** pencarian web terhadap halaman pricing resmi vendor, halaman dokumentasi/help center resmi, dan review pihak ketiga per Juli 2026.

**Keterbatasan yang harus diketahui pembaca:**

- `[FAKTA]` Harga POS Indonesia sangat tidak transparan. ESB, Majoo, dan Moka semua mencantumkan "Mulai dari" atau "Tanya Kami" untuk tier menengah ke atas — halaman pricing ESB per Juli 2026 hanya menampilkan tiga tier dengan Enterprise sebagai "Harga Sesuai Kebutuhan". Angka yang dikutip di dokumen ini untuk vendor lokal sebagian besar berasal dari review pihak ketiga, bukan halaman resmi vendor, dan harus diperlakukan sebagai indikatif ±30%.
  *Sumber: [Solusi Andal Sesuai Kebutuhan Bisnis Kuliner Anda — ESB Pricing](https://www.esb.id/id/pricing) (diakses 27 Jul 2026)*

- `[FAKTA]` Halaman pricing Toast mencantumkan "This page was last updated on: July 8, 2026" tetapi tidak menampilkan angka tier di HTML yang bisa di-fetch — angka $110/$165 berasal dari review pihak ketiga. Konflik sumber ini dilaporkan di bagian 3.
  *Sumber: [Restaurant POS Pricing & Plans — Toast](https://pos.toasttab.com/pricing) (diakses 27 Jul 2026, halaman ter-update 8 Jul 2026)*

- **Konflik sumber yang tidak dirapikan:** untuk Toast, satu sumber menyebut "Restaurant Basics $110/bulan + $4/karyawan", sumber lain menyebut "mulai $0/bulan dengan processing fee lebih tinggi (2,99% + 15¢)". Keduanya kemungkinan benar dan menggambarkan dua paket berbeda (Starter Kit vs Restaurant Basics). Yang lebih dipercaya adalah struktur bertingkat: Toast menawarkan $0 hardware-subsidized dengan rate tinggi, dan paket berbayar dengan rate lebih rendah. Ini pola pricing yang penting untuk Fase 11.

---

## 2. Peta segmen — di mana pemain berdiri

| Segmen | Karakter merchant | Kemauan bayar | Pemain dominan |
|---|---|---|---|
| **Mikro / warung** | 1 outlet, 1 device, owner = kasir, sering tanpa struk | Rp0–100k/bln atau tidak bayar sama sekali | Qasir (gratis + Rp66.780/bln Pro), Kasir Pintar Free, Loyverse (gratis) |
| **UKM mapan** | 1–3 outlet, 1–3 device, ada karyawan tetap, butuh laporan | Rp150k–350k/outlet/bln | Kasir Pintar Pro (Rp55.500/bln), Pawoon (Rp149k–299k), Majoo, Olsera (Rp1,288jt–2,688jt/tahun) |
| **Celah tengah** ⟵ *target Lumi* | 2–20 outlet, multi-device per outlet, butuh transfer stok antar outlet, ada manajer area | Rp300k–800k/outlet/bln | Moka (Rp299k–799k/outlet/bln), iSeller (dari Rp300k/bln), ESB Advanced (Rp499k/bln) |
| **Enterprise F&B** | 20+ outlet, franchise, integrasi ERP/akuntansi, SLA, kadang on-prem | Custom, sering >Rp1jt/outlet/bln + implementation fee | ESB (30.000+ restoran), Toast/Lightspeed untuk pasar global |

*Sumber harga Indonesia: [Perbandingan Moka vs Majoo vs Olsera — klikit](https://klikit.io/id/learn/moka-vs-majoo-vs-olsera-indonesia) · [10 Aplikasi POS Kasir Terbaik di Indonesia 2026 — Mas Software](https://www.mas-software.com/blog/aplikasi-pos-terbaik) · [8 Aplikasi Kasir (POS) Terbaik untuk UKM 2026 — Founderplus](https://founderplus.id/blog/aplikasi-kasir-pos-ukm-terbaik/) · [Olsera POS: Harga, Fitur — EquipERP](https://www.equiperp.com/blog/olsera-pos/) (semua diakses 27 Jul 2026)*

`[INFERENSI]` Segmen mikro tidak bisa dimenangkan produk baru. Qasir dan Loyverse memberikan produk fungsional secara gratis; biaya akuisisi mereka sudah tenggelam dan monetisasi mereka lewat volume/add-on. Produk baru yang menyerang segmen ini akan kehabisan uang sebelum mencapai skala.

`[INFERENSI]` Segmen enterprise F&B murni juga tidak bisa diserang dari nol. ESB sudah punya ekosistem tujuh produk (POS, Order, Kiosk, Loop, Kitchen, Core, Resto, Goods) dan referensi merek besar. Menang di sini butuh tim sales enterprise dan siklus penjualan 6–12 bulan — di luar jangkauan solo builder.

---

## 3. Kompetitor global — profil ringkas

### 3.1 Square

`[FAKTA]` Tiga tier: $0 (Free), $49 (Plus), $149 (Premium) per bulan. Processing in-person 2,5% + 15¢ (Plus), 2,4% + 15¢ (Premium). Online 3,3% + 30¢ (Free), 2,9% + 30¢ (Plus/Premium). Hardware: Reader contactless $59, Stand $149, Terminal $299, Register $799.

**Segmen:** mikro sampai UKM, retail + F&B ringan.
**Cakupan platform:** iOS, Android, web dashboard, hardware proprietary.
**Penanganan offline:** ada, tapi hanya untuk pembayaran kartu yang di-queue — dengan risiko decline saat sinkronisasi ditanggung merchant.
**Model bisnis:** subsidi software, monetisasi lewat payment processing. Ini penting — Square tidak menjual POS, ia menjual akuisisi pembayaran.
**Celah:** tidak beroperasi di Indonesia. Fitur F&B (table management, KDS, resep/BOM) lebih dangkal dari Toast.

*Sumber: [Square POS Pricing 2026 — tech.co](https://tech.co/pos-system/square-pos-pricing) · [Square Fees & Pricing 2026 — POS USA](https://www.posusa.com/square-fees-pricing/) · [Square Fees: Calculator and Pricing for 2026 — NerdWallet](https://www.nerdwallet.com/business/software/learn/square-fees) (diakses 27 Jul 2026)*

### 3.2 Toast

`[FAKTA]` Halaman pricing resmi menyebut tiga janji di header: 24/7 support, **offline mode**, simple & fast set-up. Halaman ter-update 8 Juli 2026. Toast menyatakan dirinya bukan payment card processor melainkan *payment facilitator* yang bermitra dengan processor.
`[FAKTA]` Hardware hanya boleh perangkat yang disetujui Toast — "Toast's services do not function with every device and may only be used on approved Toast hardware."
`[FAKTA — sumber pihak ketiga, konflik dilaporkan]` Restaurant Basics ~$110/bulan + $4/karyawan; Growth mulai ~$165/bulan; Starter Kit $0/bulan dengan processing 2,99% + 15¢. Hardware kit $609–$1.339. Kontrak umumnya 2 tahun dengan early termination fee.

**Segmen:** restoran full-service Amerika Utara, meluas ke retail (grocery, liquor, butcher).
**Cakupan platform:** Android-based hardware proprietary, handheld Toast Go, KDS, kiosk.
**Penanganan offline:** dipromosikan sebagai fitur utama — bisa menerima order, cetak tiket & struk, **dan menerima pembayaran kartu** selama outage. Ini lebih jauh dari Shopify/Lightspeed.
**Celah:** hardware lock-in mutlak, kontrak 2 tahun, tidak ada opsi self-hosted, tidak beroperasi di Indonesia.

*Sumber: [Restaurant POS Pricing & Plans — Toast](https://pos.toasttab.com/pricing) (halaman resmi, ter-update 8 Jul 2026) · [Toast Pricing: How Much Does This POS System Cost? 2026 — Owner.com](https://www.owner.com/blog/toast-pricing) · [Toast POS Review 2026 — POS USA](https://www.posusa.com/toast-pos-review/) (diakses 27 Jul 2026)*

### 3.3 Lightspeed

`[FAKTA]` Restaurant: Basic $69/bln, Essential $189/bln, Premium $399/bln. Retail: $69–$399/bln. Card-present rate 2,6% + $0,10; remote 2,6% + $0,30. Lightspeed Payments bersifat mandatory-integrated.
`[FAKTA]` Offline mode Restaurant bergantung pada perangkat lokal bernama **Lightserver**. Saat internet putus, order tetap bisa diambil dan disinkronkan nanti — **tapi tanpa internet tidak ada pembayaran kartu**.

**Yang paling penting dari Lightspeed untuk Lumi POS:** `[INFERENSI]` keberadaan Lightserver adalah pengakuan arsitektural bahwa sinkronisasi antar-device dalam satu outlet tidak bisa mengandalkan cloud. Vendor sekelas Lightspeed memilih menaruh appliance fisik di outlet daripada membangun mesh peer-to-peer antar tablet. Ini sinyal kuat untuk Fase 5.

*Sumber: [Lightspeed Restaurant POS Review 2026 — POS USA](https://www.posusa.com/lightspeed-restaurant-pos-review/) · [Lightspeed Pricing 2026 — checkthat.ai](https://checkthat.ai/brands/lightspeed/pricing) · [Lightspeed Retail POS Review 2026 — Sonary](https://sonary.com/b/lightspeed/lightspeed-retail+pos/) (diakses 27 Jul 2026)*

### 3.4 Shopify POS

`[FAKTA]` Batas offline yang didokumentasikan Shopify sangat tegas, dan ini adalah data paling berharga di seluruh Fase 1:
- Pembayaran kartu **tidak bisa** diproses offline — hanya tunai dan custom payment method yang sudah dikonfigurasi sebelumnya.
- **Tidak ada** update inventory saat offline.
- **Tidak bisa** membuat customer profile baru; record pelanggan tidak bisa diakses maupun di-update.
- **Tidak ada** refund.
- **Tidak ada** pemrosesan gift card.
- Transaksi yang di-queue otomatis tersinkron saat koneksi pulih.
`[FAKTA]` Shopify POS memiliki halaman dokumentasi khusus "Cash rounding on POS" dan "Country-specific retail requirements" termasuk halaman terpisah "Retail requirements in Italy" — bukti bahwa fiscalization per-negara adalah beban nyata, bukan teori.

*Sumber: [Selling in person with Shopify POS — Shopify Help Center](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) (halaman resmi, diakses 27 Jul 2026) · [Does Shopify POS Work Offline? — Posify](https://posify.io/does-shopify-pos-work-offline/) · [Shopify POS Offline Mode — First Pier](https://www.firstpier.com/resources/shopify-pos-offline-mode) (diakses 27 Jul 2026)*

### 3.5 Loyverse

`[FAKTA]` Model freemium agresif. Aplikasi inti — POS, Dashboard, KDS, dan Customer Display — **gratis** tanpa iklan, tanpa kartu kredit, tanpa kontrak. Yang berbayar: Employee Management, Advanced Inventory, Integrations. Penjualan offline didukung; data tersimpan lokal lalu tersinkron.

`[INFERENSI]` Loyverse menetapkan *price floor* global untuk fitur POS dasar termasuk KDS. Artinya: **KDS bukan fitur premium.** Rencana monetisasi apa pun yang menaruh KDS di tier berbayar akan langsung dibandingkan dengan Loyverse yang memberikannya gratis. Ini membatasi ruang pricing Lumi POS di Fase 11.

*Sumber: [Loyverse POS 2026: Free POS System for Small Business](https://www.thailandtechnology.com/loyverse/) · [Loyverse Pricing Guide (Juni 2026) — Loman](https://loman.ai/blog/loyverse-pricing) · [Loyverse POS 2026 Pricing, Features — GetApp](https://www.getapp.com/retail-consumer-services-software/a/loyverse-pos/) (diakses 27 Jul 2026)*

### 3.6 Odoo POS

`[FAKTA]` Odoo POS menyimpan data secara lokal di browser lewat IndexedDB/localStorage dan menyinkronkan saat koneksi pulih. Implementasi terbaru menambahkan Service Worker untuk cache asset, gambar, dan API call.
`[FAKTA]` Batasan penting: **sesi POS baru tidak bisa dibuka tanpa internet** — hanya sesi yang sudah terbuka yang bisa lanjut offline. Order yang dibuat offline disimpan sebagai unsynced data dan dikirim saat online.

`[INFERENSI]` Batasan "tidak bisa buka sesi baru saat offline" adalah kegagalan desain yang sering dikeluhkan dan merupakan target serangan yang jelas untuk Lumi POS. Skenario nyata: listrik/internet mati semalam, pagi hari kasir tidak bisa membuka shift. Ini harus jadi requirement eksplisit di PRD.

*Sumber: [What's the mechanism of POS offline? — Odoo Forum](https://www.odoo.com/forum/help-1/what-s-the-mechanism-of-pos-offline-283217) · [Odoo 18 Offline Mode, Point of Sale — KerningCode](https://www.kerningcode.com/blog/odoo-25/odoo-odoo-18-offline-mode-point-of-sale-and-working-offline-321) (diakses 27 Jul 2026)*

### 3.7 Clover

`[ASUMSI]` Tidak diriset mendalam dalam sesi ini karena tidak beroperasi di Indonesia dan modelnya identik dengan Square (hardware proprietary + monetisasi payment, disalurkan lewat bank/ISO). Dampaknya terhadap keputusan arsitektur Lumi POS mendekati nol. Dicatat sebagai gap riset di `12-OPEN-QUESTIONS.md`.

---

## 4. Kompetitor Indonesia — profil ringkas

### 4.1 ESB (PT Esensi Solusi Buana) — ancaman paling serius di F&B

`[FAKTA]` Halaman pricing resmi per Juli 2026 menampilkan tiga tier: **Basic "Mulai dari Rp0*/bulan"** (dengan syarat & ketentuan), **Advanced Rp499.000/bulan**, dan **Enterprise "Harga Sesuai Kebutuhan"**.
`[FAKTA]` Klaim skala: 30.000+ restoran, 60.000+ pebisnis kuliner di Indonesia, Asia Tenggara, hingga Eropa. Klien terverifikasi di halaman resmi termasuk Starbucks, Subway, Krispy Kreme, Auntie Anne's, Wingstop, Häagen-Dazs, Gyu-Kaku.
`[FAKTA]` Matriks fitur resmi ESB mengungkap peta fitur yang sangat berguna sebagai daftar table stakes F&B Indonesia:

| Fitur di matriks resmi ESB | Basic | Advanced |
|---|---|---|
| Multidevice POS, Customer Display | ✓ | ✓ |
| Table Management, Merge & Link Table, Move Item & Table | ✓ | ✓ |
| Menu Stock Limit Management, Split Bill | ✓ | ✓ |
| Integrasi GoFood, GrabFood & ShopeeFood | Grab & GoFood saja | ketiganya |
| Digital Payment (QRIS, VISA, Mastercard, GoPay, ShopeePay, OVO, DANA, Alipay, WeChat Pay) | ✓ | ✓ |
| Promotion Management | terbatas | lebih banyak | 
| Voucher System, Loyalty Program | ✓ | ✓ |
| WA Receipt, Email Receipt | ✓ | ✓ |
| Autosync Sales Data | ✓ | ✓ |
| Automatic Sales Journal, Inventory Journal, End Day Cutting Stock | ✓ | ✓ |
| Report | <30 laporan | 100+ laporan |
| Absensi (+ foto), Sesi Shift, Swipe Card for Duty Meal | ✓ | ✓ |
| User Access Limitation, Multi Branch | ✓ | ✓ |
| ERP Modules | Simple ERP | Full ERP |

**Celah yang ditinggalkan ESB:** `[INFERENSI]` ESB adalah produk **F&B murni**. Tidak ada jejak retail umum (minimarket, toko kelontong, apotek) di seluruh positioning-nya — taglinenya "Ahlinya Bisnis Kuliner". Merchant yang menjalankan hybrid (kafe + toko roti retail + jual biji kopi kiloan) harus memilih atau memakai dua sistem. Ini celah nyata untuk produk multi-vertikal.

*Sumber: [ESB Pricing — halaman resmi](https://www.esb.id/id/pricing) · [ESB — Aplikasi Kasir Online Terbaik untuk Restoran dan Cafe](https://www.esb.id/id) · [Aplikasi Kasir Restoran & Cafe — ESB POS](https://www.esb.id/id/solusi/produk/pos) (diakses 27 Jul 2026)*

### 4.2 Moka POS (GoTo Group)

`[FAKTA]` Paket Basic / Populer (Pro) / Enterprise, rentang **Rp299.000–Rp799.000 per outlet per bulan**. Trial 14 hari. Mendukung tunai, kartu debit/kredit, e-wallet, dan QRIS. Dikembangkan PT Moka Teknologi Indonesia, kini bagian ekosistem GoTo.

`[INFERENSI]` Moka adalah *price anchor* untuk segmen target Lumi POS. Angka Rp299k/outlet/bulan adalah lantai psikologis yang sudah tertanam di benak merchant Indonesia untuk POS "serius". Keunggulan distribusi Moka (ekosistem GoTo: GoPay, GoFood, GoBiz) tidak bisa disaingi produk baru — jadi Lumi POS harus menang di kedalaman produk, bukan di distribusi.

*Sumber: [Moka POS: Review Lengkap Fitur, Harga, dan Implementasi 2026 — HashMicro](https://www.hashmicro.com/id/blog/review-aplikasi-moka-pos/) · [Moka POS: Harga, Fitur, Kelebihan, Kekurangan & Alternatif 2026 — EquipERP](https://www.equiperp.com/blog/aplikasi-moka-pos-dan-alternatifnya/) (diakses 27 Jul 2026)*

### 4.3 Pemain harga rendah

| Produk | Harga terverifikasi | Catatan |
|---|---|---|
| **Qasir** | Gratis selamanya; Pro dari Rp66.780/bln (tagihan tahunan); paket usaha besar Rp249.000/bln; Rp699.000/tahun | Model freemium paling agresif di Indonesia |
| **Kasir Pintar** | Free (maks 1.000 produk, 3 laporan); Pro dari Rp55.500/bln (10.000 produk, 10+ laporan, 5 staff) | Batasan kuota produk & staff sebagai lever monetisasi — pola yang relevan untuk Fase 11 |
| **Pawoon** | Basic Rp149.000/bln; Pro Rp299.000/bln | |
| **Olsera** | Basic Rp1.288.000/thn; Premium Rp1.988.000/thn; Pro Rp2.688.000/thn (≈Rp107k–224k/bln) | Menjual tahunan, bukan bulanan — mengurangi churn |
| **iSeller** | Dari Rp300.000/bln | Positioning multi-industri (retail + resto) |
| **Majoo** | Tidak ditemukan angka resmi | Positioning all-in-one: POS + inventory + accounting + CRM + absensi |

*Sumber: [8 Aplikasi Kasir (POS) Terbaik untuk UKM 2026 — Founderplus](https://founderplus.id/blog/aplikasi-kasir-pos-ukm-terbaik/) · [10 Aplikasi POS Kasir Terbaik di Indonesia 2026 — Mas Software](https://www.mas-software.com/blog/aplikasi-pos-terbaik) · [Olsera POS: Harga, Fitur, Kelebihan & Alternatif 2026 — EquipERP](https://www.equiperp.com/blog/olsera-pos/) · [5 Rekomendasi Aplikasi Kasir Harga Murah — Paper.id](https://www.paper.id/blog/tips-bisnis/rekomendasi-aplikasi-kasir/) (diakses 27 Jul 2026)*

**Pola monetisasi yang berulang di pasar Indonesia** `[INFERENSI]`: lever yang dipakai untuk membedakan tier bukan fitur canggih, melainkan **kuota** — jumlah produk, jumlah staff, jumlah laporan, jumlah outlet. Ini keputusan produk yang punya konsekuensi teknis langsung: sistem metering & quota enforcement harus ada di arsitektur sejak awal, bukan ditambahkan belakangan.

---

## 5. Open-source POS — verdict

`[FAKTA]` Status per riset Juli 2026:
- **uniCenta oPOS** — versi 5.4.0, update terakhir 10 Agustus 2025, terintegrasi WooCommerce. Masih dipelihara.
- **Chromis POS** — update terakhir 15 Juli 2024; versi baru sedang dikembangkan terhadap OpenJFX 11.
- **Floreant POS** — masih dipakai luas untuk restoran/kafe/bar/pizzeria; tanggal update spesifik tidak ditemukan.

*Sumber: [Best Open Source Windows Point of Sale (POS) Software 2026 — SourceForge](https://sourceforge.net/directory/point-of-sale-pos/windows/) · [Chromis POS VS uniCenta oPOS — SaaSHub](https://www.saashub.com/compare-chromis-pos-vs-unicenta-opos) · [Chromis POS Reviews in 2026 — SourceForge](https://sourceforge.net/software/product/Chromis-POS/) (diakses 27 Jul 2026)*

`[INFERENSI]` Ketiganya adalah aplikasi desktop Java/JavaFX yang lahir dari lineage yang sama (Openbravo POS). Arsitekturnya: aplikasi tebal berbicara langsung ke database relasional di LAN. Konsekuensinya:
- Tidak ada konsep multi-tenant. Satu instalasi = satu bisnis.
- Tidak ada mobile. Tidak ada cloud sync yang layak.
- "Offline" bersifat trivial karena memang tidak pernah online — masalah sinkronisasi tidak pernah dipecahkan, hanya dihindari.

**Verdict:** nol nilai sebagai basis kode. Nilai terbatas sebagai referensi domain model (skema tabel produk/varian/order mereka matang setelah 15 tahun) — dan bahkan untuk itu, model dari sistem yang lebih modern lebih relevan.

**Peringatan lisensi:** `[ASUMSI]` uniCenta dan turunan Openbravo POS umumnya berlisensi GPL. Membaca skema untuk inspirasi tidak menular; menyalin kode akan menular ke produk komersial. Verifikasi lisensi spesifik sebelum melihat kode apa pun — dicatat sebagai open question.

---

## 6. Analisis offline — di mana batas yang ditarik kompetitor

Ini bagian terpenting dari Fase 1. Tabel di bawah menyusun ulang temuan agar bisa dipakai langsung sebagai spesifikasi target di Fase 5.

| Kapabilitas saat offline | Shopify POS | Lightspeed Restaurant | Toast | Odoo POS | Loyverse | **Target Lumi POS** |
|---|---|---|---|---|---|---|
| Buka shift/sesi baru | tidak jelas | tidak jelas | tidak jelas | **tidak bisa** | ya | **wajib bisa** |
| Terima pesanan & cetak tiket | ya | ya | ya | ya | ya | wajib bisa |
| Pembayaran tunai | ya | ya | ya | ya | ya | wajib bisa |
| Pembayaran kartu | **tidak** | **tidak** | **ya (queued)** | tidak | tidak | via EDC terpisah — tidak diklaim |
| Pembayaran QRIS | n/a | n/a | n/a | n/a | n/a | **tidak mungkin** (butuh konfirmasi issuer) |
| Update stok | **tidak** | parsial | parsial | parsial | ya | **wajib bisa (lokal)** |
| Refund / void | **tidak** | tidak jelas | tidak jelas | tidak jelas | tidak jelas | **wajib bisa** |
| Akses & buat data pelanggan | **tidak** | tidak jelas | tidak jelas | parsial | ya | wajib bisa |
| Sinkron antar device dalam outlet tanpa internet | tidak | **ya, via Lightserver** | ya (LAN) | tidak | tidak | **wajib — area risiko tertinggi** |

`[INFERENSI]` Dua kolom paling menentukan adalah baris terakhir dan baris "buka shift". Semua kompetitor cloud-native gagal di baris "sinkron antar device tanpa internet" kecuali mereka yang menaruh hardware/server lokal di outlet (Lightspeed dengan Lightserver, Toast dengan arsitektur LAN pada hardware proprietary). Ini bukan kebetulan — ini konsekuensi fisika jaringan, bukan kemalasan engineering.

**Kabar buruk yang tidak disembunyikan:** ambisi "offline penuh lintas device" secara efektif memaksa salah satu dari tiga pilihan: (a) menjual/mensyaratkan appliance lokal seperti Lightspeed, (b) mem-promote salah satu tablet jadi leader lokal dengan protokol election, atau (c) membatasi offline ke single-device dan jujur tentang itu. Ketiganya punya biaya besar; opsi (c) yang paling murah, dan menjualnya sebagai batasan yang jujur lebih baik daripada menjanjikan (a)/(b) lalu gagal. Ini digarap penuh di Fase 5.

---

## 7. Table stakes v1 — tanpa ini merchant tidak akan mempertimbangkan

Diturunkan dari irisan fitur yang muncul di **semua** kompetitor yang diriset, terutama matriks fitur resmi ESB dan Moka.

| # | Kapabilitas | Alasan masuk table stakes | Vertikal |
|---|---|---|---|
| 1 | Transaksi kasir dasar + cetak struk thermal | Definisi POS | Semua |
| 2 | Katalog produk dengan varian & modifier | Ada di setiap kompetitor | Semua |
| 3 | Multi-metode pembayaran termasuk **QRIS** | Wajib mutlak di Indonesia | Semua |
| 4 | Diskon, promo, voucher | Ada di tier terendah ESB & Moka | Semua |
| 5 | Manajemen stok dasar + stock cutting otomatis | ESB mencantumkan "End Day Cutting Stock" bahkan di Basic | Semua |
| 6 | Shift & tutup kas (cash management) | ESB "Sesi Shift" di Basic | Semua |
| 7 | Laporan penjualan harian + laporan produk | Semua vendor; jumlah laporan jadi lever tier | Semua |
| 8 | Multi-user dengan pembatasan akses (RBAC) | ESB "User Access Limitation" di Basic | Semua |
| 9 | Multi-outlet dari satu dashboard | ESB "Multi Branch" bahkan di Basic | Semua |
| 10 | Mode offline yang tidak menghentikan penjualan | Dipromosikan Toast di header pricing | Semua |
| 11 | **Integrasi GoFood / GrabFood / ShopeeFood** | Syarat masuk pasar F&B Indonesia, bukan fitur premium | F&B |
| 12 | Table management + split bill + merge/move table | ESB memasukkannya di Basic | F&B |
| 13 | Kitchen Display System | Loyverse memberikannya **gratis** — tidak bisa dijadikan fitur premium | F&B |
| 14 | Barcode scanning + pencarian SKU cepat | Definisi retail | Retail |

`[INFERENSI]` Poin 11 adalah yang paling underestimated oleh pendatang baru. Integrasi tiga platform aggregator bukan pekerjaan kecil: masing-masing punya API, model menu, aturan sinkronisasi stok, dan alur pembatalan sendiri. Ini kemungkinan besar tidak muat di v1 dan harus dijadikan keputusan sadar (dibahas di `12-OPEN-QUESTIONS.md`), bukan kelupaan.

---

## 8. Celah pasar — di mana ruang untuk produk baru

**Celah 1 — Offline yang jujur dan lengkap.** Semua kompetitor cloud-native memberi offline degraded. Merchant Indonesia di luar kota besar mengalami putus internet sebagai kejadian mingguan, bukan tahunan. Produk yang bisa berkata "buka shift, jual, refund, dan update stok tanpa internet — dengan batas yang tertulis jelas di kontrak" punya cerita penjualan yang tidak dimiliki siapa pun. `[INFERENSI]`

**Celah 2 — Multi-vertikal sejati.** ESB = F&B murni. Moka/Majoo = retail dengan tempelan F&B. Tidak ada yang menangani "satu merchant, dua model bisnis" (kafe + retail biji kopi; resto + katering; minimarket + dapur siap saji) sebagai kasus kelas satu. `[INFERENSI]`

**Celah 3 — Merchant 2–20 outlet yang butuh operasi antar-outlet.** Transfer stok antar outlet, pembelian terpusat, harga berbeda per outlet, manajer area dengan visibilitas terbatas. Ini fitur yang di ESB baru muncul di Advanced/Enterprise dan di Moka terasa ditempel. `[INFERENSI]`

**Celah 4 — Opsi self-hosted untuk merchant yang menolak cloud.** `[ASUMSI]` Ada segmen merchant Indonesia (terutama yang pernah mengalami vendor POS tutup atau menaikkan harga sepihak) yang menghargai kepemilikan data. Tidak ada satu pun kompetitor SaaS yang menawarkan ini. **Tapi:** ukuran segmen ini tidak terverifikasi dan biayanya besar — ini kandidat kuat untuk dipotong dari v1. Dibahas penuh di Fase 9.

**Bukan celah — jangan tertipu:** harga murah (sudah nol), UI cantik (tidak dibayar merchant), dan integrasi payment (Moka punya GoTo, tidak bisa disaingi).

---

## 9. Keputusan

### KEP-01 — Posisi kompetitif utama Lumi POS

**Pertanyaan:** Atas dasar apa Lumi POS meminta merchant meninggalkan produk yang sudah mereka pakai?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Harga lebih murah | Mudah dikomunikasikan, siklus jual pendek | Lantai sudah nol (Qasir, Loyverse, ESB Basic Rp0). Perang yang tidak bisa dimenangkan tanpa modal | Ada subsidi dari lini bisnis lain (mis. payment) |
| B. Fitur paling lengkap | Cocok dengan ambisi "sangat lengkap" | Butuh 3–5 tahun untuk menyamai ESB. Merchant tidak membeli daftar fitur, mereka membeli solusi satu masalah | Tim besar, runway panjang |
| C. Keandalan operasional saat jaringan buruk + multi-vertikal sejati | Batas kompetitor terdokumentasi dan sempit; nyeri merchant nyata dan mahal (outlet tidak bisa jualan = kerugian langsung) | Area teknis tersulit di seluruh produk; mudah dijanjikan, sulit dibuktikan | Pembangun teknis yang bersedia menghabiskan porsi terbesar effort di satu area |

**Rekomendasi:** Opsi C. `[INFERENSI dari batas offline terdokumentasi Shopify, Odoo, dan Lightspeed]`

**Alasan:** Satu-satunya keunggulan yang bisa dibangun solo builder adalah keunggulan yang mahal untuk ditiru dan sudah dihindari kompetitor karena alasan ekonomi, bukan karena tidak terpikir. Shopify secara eksplisit mendokumentasikan bahwa offline berarti tanpa stok, tanpa refund, tanpa pelanggan — mereka memilih itu karena biaya rekayasanya tinggi relatif terhadap segmen mereka. Untuk merchant Indonesia dengan konektivitas tidak stabil, biaya kegagalan itu ditanggung sebagai kerugian penjualan langsung, sehingga kemauan bayarnya berbeda. Design system Lumi sudah mengasumsikan posisi ini — setiap komponen punya state tersinkron/mengantre/gagal, yang berarti keputusan ini sudah tercermin di lapisan UI dan tidak perlu retrofit.

**Kapan keputusan ini harus ditinjau ulang:** jika riset lapangan (bukan desk research) menunjukkan frekuensi outage di segmen target < 1×/bulan dengan durasi < 15 menit, nyeri tidak cukup besar untuk membenarkan biaya rekayasanya, dan posisi harus bergeser ke Opsi B pada vertikal sempit.

**Sumber:** [Selling in person with Shopify POS — Shopify Help Center](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) (27 Jul 2026) · [What's the mechanism of POS offline? — Odoo Forum](https://www.odoo.com/forum/help-1/what-s-the-mechanism-of-pos-offline-283217) (27 Jul 2026) · [Lightspeed Restaurant POS Review 2026 — POS USA](https://www.posusa.com/lightspeed-restaurant-pos-review/) (27 Jul 2026)

---

### KEP-02 — Segmen beachhead

**Pertanyaan:** Merchant seperti apa yang harus dilayani sempurna oleh v1, dengan mengorbankan semua yang lain?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Mikro/warung 1 outlet | Volume calon pelanggan terbesar (30,21 juta UMKM non-pertanian per Des 2025) | Kemauan bayar ≈ nol; sudah dilayani gratis oleh Qasir & Loyverse; CAC tidak akan tertutup | Model monetisasi lewat payment, bukan lisensi |
| B. Kafe/resto 2–20 outlet | Kemauan bayar Rp300k–800k/outlet/bln terverifikasi (Moka, ESB Advanced); nyeri multi-outlet nyata; sesuai design system yang memang dibangun untuk kafe | Head-to-head dengan Moka dan ESB Advanced | Produk punya keunggulan teknis yang jelas di satu dimensi |
| C. Enterprise F&B 20+ outlet | ARPU tertinggi, churn terendah | Siklus jual 6–12 bulan, butuh tim implementasi, ESB sudah memegang referensi Starbucks/Subway | Ada tim sales enterprise |

**Rekomendasi:** Opsi B, dengan retail umum sebagai vertikal kedua yang dibangun sejak awal di data model tapi dirilis setelah F&B terbukti. `[INFERENSI]`

**Alasan:** Design system yang sudah final secara eksplisit dibangun untuk konteks fisik kafe — tablet 10" di counter, KDS dapur, HP owner jam 23:00. Menyerang segmen lain berarti melawan constraint yang sudah dikunci. Segmen ini juga satu-satunya yang punya kemauan bayar terverifikasi sekaligus nyeri yang cocok dengan keunggulan di KEP-01: outlet yang berhenti jualan karena internet mati adalah kerugian yang bisa dihitung dalam rupiah oleh owner 5-outlet, tapi tidak oleh warung yang catat manual.

**Kapan keputusan ini harus ditinjau ulang:** jika 20+ percakapan penjualan awal menunjukkan bahwa merchant 2–20 outlet sudah terkunci kontrak tahunan dengan Moka/ESB dan switching cost-nya prohibitive, geser ke merchant yang **baru membuka outlet kedua** — momen switching alami.

**Sumber:** [UMKM Indonesia — Kadin Indonesia](https://kadin.id/en/data-dan-statistik/umkm-indonesia/) (data per 31 Des 2025) · [Moka POS: Review Lengkap Fitur, Harga 2026 — HashMicro](https://www.hashmicro.com/id/blog/review-aplikasi-moka-pos/) (27 Jul 2026) · [ESB Pricing](https://www.esb.id/id/pricing) (27 Jul 2026)

---

### KEP-03 — Cakupan vertikal v1

**Pertanyaan:** Apakah v1 mengirim F&B saja, retail saja, atau keduanya?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. F&B saja di v1, retail menyusul | Fokus, cocok design system, mengurangi permukaan uji | Risiko data model terlanjur mengasumsikan F&B; retrofit retail mahal (pelajaran dari ESB yang terkunci di F&B) | Waktu ke pasar adalah kendala utama |
| B. Retail saja di v1 | Domain lebih sederhana (tanpa table, KDS, resep) | Design system dibangun untuk kafe; melawan constraint yang sudah dikunci | Design system belum final |
| C. Data model multi-vertikal sejak hari pertama, **rilis** F&B dulu | Menghindari rewrite terbesar; klaim multi-vertikal jadi kredibel | Menambah biaya desain data model di awal; godaan over-engineering tinggi | Ada niat serius menjual ke dua vertikal dalam 24 bulan |

**Rekomendasi:** Opsi C. `[INFERENSI dari kegagalan ESB memperluas keluar F&B dan Moka memperdalam ke F&B]`

**Alasan:** Kedua kompetitor lokal terbesar menunjukkan biaya dari memilih vertikal terlalu dini — ESB tidak bisa keluar dari F&B, Moka tidak bisa memperdalam ke F&B. Perbedaan biaya antara merancang katalog/order model yang vertikal-agnostik versus yang F&B-spesifik dibayar sekali di fase desain; biaya retrofit dibayar berulang selama umur produk. Yang **tidak** dilakukan: membangun UI, alur, dan fitur retail di v1 — hanya data model dan boundary modulnya yang disiapkan.

**Kapan keputusan ini harus ditinjau ulang:** jika desain data model vertikal-agnostik ternyata menambah lebih dari ~3 minggu ke jadwal v1 atau memaksa abstraksi yang tidak bisa dijelaskan dalam satu diagram, mundur ke Opsi A dan terima biaya retrofit.

**Sumber:** [ESB — Aplikasi Kasir Online Terbaik untuk Restoran dan Cafe](https://www.esb.id/id) (27 Jul 2026) · [Perbandingan Moka vs Majoo vs Olsera — klikit](https://klikit.io/id/learn/moka-vs-majoo-vs-olsera-indonesia) (27 Jul 2026)

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Bagian "Non-goals" wajib menyebut secara eksplisit: pembayaran kartu offline (tidak diklaim), QRIS offline (tidak mungkin secara teknis — butuh konfirmasi issuer), dan segmen mikro/warung (tidak dilayani di v1).
- Tabel di bagian 6 harus disalin ke PRD sebagai **spesifikasi kemampuan offline yang mengikat**, per baris, dengan kolom "Lumi POS" sebagai acceptance criteria. Baris "buka shift saat offline" adalah requirement pembeda utama dan harus punya user story sendiri.
- 14 table stakes di bagian 7 menjadi daftar functional requirement minimum. Poin 11 (integrasi aggregator) harus punya keputusan eksplisit: masuk v1, masuk v1.1, atau ditunda — dengan konsekuensi go-to-market yang tertulis.
- Persona dan konteks fisik sudah dikunci oleh design system (kasir tablet 10", KDS dapur, owner HP) — PRD tidak boleh memperkenalkan persona keempat tanpa memicu revisi design system.

**Untuk Information Architecture:**
- Navigasi harus mengakomodasi multi-outlet sebagai konsep kelas satu, bukan switcher yang ditempel: `AppShell` di design system sudah punya sidebar berkelompok, dan pengelompokan itu harus mencerminkan batas modul (Penjualan · Katalog · Inventori · Outlet · Laporan · Pengaturan).
- Konsep "mode" (F&B vs retail) harus punya representasi di IA — apakah sebagai setting tingkat tenant, tingkat outlet, atau keduanya, adalah pertanyaan yang dijawab di Fase 2.

**Untuk ERD:**
- Entitas `Outlet` harus ada sejak schema pertama, bukan ditambahkan saat pelanggan multi-outlet datang. Semua entitas transaksional dan sebagian besar entitas master butuh kolom outlet-scope.
- Struktur kuota/limit (jumlah produk, staff, outlet, laporan) harus punya tempat di model tenant karena itu lever monetisasi standar pasar Indonesia — bukan ditambahkan sebagai tabel `limits` belakangan.
- Model katalog harus bisa merepresentasikan item F&B (modifier, resep) dan item retail (SKU, barcode, satuan konversi) tanpa tabel terpisah per vertikal.

**Untuk Technical Architecture:**
- Keputusan arsitektur sinkronisasi harus menjawab secara eksplisit pertanyaan "Lightserver atau tidak" — apakah ada komponen server lokal di outlet. Ini keputusan paling berkonsekuensi di seluruh sistem dan tidak bisa ditunda ke setelah v1.
- Batas offline yang dijanjikan menentukan seberapa banyak state harus direplikasi ke device: menjanjikan refund offline berarti seluruh riwayat transaksi outlet (setidaknya jendela waktu tertentu) harus ada di device, bukan hanya katalog.
- Integrasi aggregator (GoFood/GrabFood/ShopeeFood) adalah integrasi cloud-only yang tidak bisa offline — boundary antara "yang bisa offline" dan "yang butuh cloud" harus menjadi garis arsitektural eksplisit, bukan konsekuensi tidak sengaja.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `02-DOMAIN-FEATURE-MAP.md`.*
