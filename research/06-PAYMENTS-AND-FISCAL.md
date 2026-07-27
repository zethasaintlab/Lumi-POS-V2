# 06 — Payment & Kepatuhan Fiskal

> Fase 6 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.
> ⚠️ Dokumen ini memuat interpretasi peraturan perpajakan. Bukan nasihat hukum atau pajak. Setiap keputusan yang berkonsekuensi hukum harus diverifikasi dengan konsultan pajak Indonesia sebelum diimplementasikan.

---

## Ringkasan Keputusan

1. **Kesalahan paling mahal yang bisa dilakukan POS Indonesia: memperlakukan pajak restoran sebagai PPN.** Makanan dan minuman yang disajikan restoran/kafe **tidak dikenai PPN** — melainkan **PBJT** (dulu disebut PB1), pajak daerah dengan tarif maksimal 10% yang **ditetapkan per kabupaten/kota lewat peraturan daerah**. Artinya sistem harus mendukung tarif yang berbeda per outlet berdasarkan lokasi geografis, dengan jenis pajak yang berbeda pula. Ini bukan konfigurasi angka — ini perbedaan rezim pajak. (→ KEP-24)

2. **Lapisan pajak harus pluggable sejak v1, bukan setelah ekspansi.** Satu merchant Indonesia dengan kafe (PBJT 10%) dan toko retail biji kopi (PPN 11%) di kota berbeda sudah membutuhkan tiga konfigurasi pajak berbeda — sebelum bicara ekspansi ke negara lain. Pajak yang di-hardcode adalah alasan utama POS gagal berkembang. (→ KEP-25)

3. **QRIS tidak bisa offline, dan MDR-nya diatur negara sehingga tidak bisa jadi sumber pendapatan.** `[FAKTA]` Struktur MDR QRIS per 15 Maret 2025: UMI ≤ Rp500.000 = **0%**, UMI > Rp500.000 = 0,3%, UKE/UME/UBE = **0,7%**, pendidikan 0,6%, SPBU 0,4%. MDR **ditanggung merchant** dan merchant **dilarang membebankannya ke konsumen**. Model bisnis "gratis, monetisasi dari payment" ala Square tidak bisa direplikasi di Indonesia pada volume QRIS. (→ Fase 11)

4. **Coretax menjadi wajib untuk seluruh administrasi perpajakan mulai Juli 2026 — bulan ini.** `[FAKTA]` DJP menyatakan seluruh administrasi pajak beralih ke Coretax mulai Juli 2026, mengakhiri penggunaan DJP Online dan aplikasi desktop e-Faktur. Ini status yang berubah tepat saat riset dilakukan dan wajib diverifikasi ulang sebelum implementasi. (→ Bagian 4)

5. **Integrasi EDC dilakukan lewat protokol ECR per bank, bukan API terpadu.** BCA menyediakan ECR Interface dengan perjanjian yang **melarang penggunaannya untuk terminal bank lain**. Artinya setiap bank adalah integrasi terpisah dengan kontrak terpisah. Ini menetapkan cakupan realistis v1: satu bank, bukan semua. (→ KEP-26)

---

## 1. Rezim pajak Indonesia untuk merchant POS

### 1.1 Dua rezim yang tidak boleh dicampur

`[FAKTA]` **PBJT Makanan dan Minuman** — sejak berlakunya UU HKPD (Hubungan Keuangan Pemerintah Pusat dan Pemerintah Daerah), Pajak Restoran masuk ke dalam kategori **Pajak Barang dan Jasa Tertentu (PBJT)**. Pungutan yang dulu populer disebut **PB1** kini berada dalam kerangka PBJT.
- **Tarif maksimal 10%**, detailnya mengikuti peraturan daerah. Pemerintah daerah dapat menentukan tarif sendiri sepanjang tidak melebihi 10%.
- Dasar pengenaan: **jumlah pembayaran yang diterima** penyedia makanan/minuman.
- Wajib pungut: restoran, rumah makan, warung makan modern, kafe, coffee shop, bakery dengan layanan makan/minum, bar dan outlet minuman dengan layanan konsumsi.

`[FAKTA]` **Direktorat Jenderal Pajak menyatakan secara eksplisit bahwa makan di restoran tidak kena PPN.** Ini bukan interpretasi — ini judul publikasi resmi DJP.

`[FAKTA]` **PPN** — status tarif per 2026:
- Ketentuan PPN 12% untuk barang mewah yang diatur PMK 131/2024 **tetap berlaku** di 2026.
- Untuk barang/jasa **non-mewah**, tarif 12% dikalikan Dasar Pengenaan Pajak "nilai lain" sebesar **11/12** dari harga jual — **sehingga tarif efektifnya tetap 11%**.
- Presiden Prabowo Subianto menegaskan pemberlakuan PPN 12% hanya dikenakan terhadap barang dan jasa mewah.

*Sumber: [Makan di Restoran Tidak Kena PPN — Direktorat Jenderal Pajak](https://www.pajak.go.id/en/node/81110) · [Bagaimana Ketentuan Pajak Restoran Pasca UU HKPD? — Ortax](https://ortax.org/pbjt-makanan-minuman) · [Pengenalan Pajak Barang dan Jasa Tertentu (PBJT) dalam UU HKPD — FJP Law Offices](https://fjp-law.com/id/pengenalan-pajak-barang-dan-jasa-tertentu-pbjt-dalam-uu-hkpd/) · [Tak Berubah, Tarif PPN 12% Tetap Berlaku untuk Barang Mewah di 2026 — DDTC News](https://news.ddtc.co.id/berita/nasional/1812992/tak-berubah-tarif-ppn-12-tetap-berlaku-untuk-barang-mewah-di-2026) · [Presiden Prabowo Subianto Tegaskan Pemberlakuan PPN 12% Hanya Dikenakan Terhadap Barang dan Jasa Mewah — Kemenko Perekonomian](https://ekon.go.id/publikasi/detail/6122/presiden-prabowo-subianto-tegaskan-pemberlakuan-ppn-12-hanya-dikenakan-terhadap-barang-dan-jasa-mewah) · [Pajak Restoran (PB1) — Paper.id](https://www.paper.id/blog/pajak-usaha/pajak-restoran-pb1-adalah/) (semua diakses 27 Jul 2026)*

### 1.2 Konsekuensi arsitektural yang harus dipahami sebelum menulis satu baris kode

`[INFERENSI]` Dari fakta di atas, satu merchant multi-outlet bisa dengan mudah menghadapi tiga rezim berbeda sekaligus:

| Skenario nyata | Rezim | Tarif | Ditetapkan oleh |
|---|---|---|---|
| Kafe di Jakarta Selatan, makan di tempat | PBJT | s.d. 10% (perda DKI Jakarta) | Pemda |
| Kafe cabang di Kabupaten Bandung Barat | PBJT | s.d. 10% (**perda berbeda, bisa beda angka**) | Pemda |
| Toko retail menjual biji kopi kemasan | PPN | 11% efektif | Pusat (DJP) |
| Merchant belum PKP (omzet di bawah ambang) | Tidak memungut PPN | 0% | Status PKP |

**Kesalahan yang harus dicegah sejak desain:**
- Menyimpan satu field `tax_rate` di level tenant → salah, karena tarif berbeda per outlet.
- Menyimpan `tax_rate` per outlet tapi satu jenis saja → salah, karena satu outlet bisa menjual barang PBJT (makanan disajikan) dan barang PPN (kopi kemasan dibawa pulang) sekaligus.
- Menganggap "pajak" sebagai satu angka persentase → salah, karena PBJT dan PPN punya dasar pengenaan, pelaporan, dan penerima yang berbeda.

`[ASUMSI]` Perbedaan "dine-in vs takeaway" secara perpajakan (apakah kopi yang dibawa pulang tetap PBJT atau menjadi PPN) adalah area abu-abu yang jawabannya bergantung pada interpretasi dan praktik daerah. Ini **wajib diverifikasi dengan konsultan pajak** dan dicatat di `12-OPEN-QUESTIONS.md` sebagai pertanyaan prioritas tinggi — karena design system sudah memiliki komponen `SegmentedControl` untuk "mode Dine In/Takeaway", artinya perbedaan ini sudah ada di UI dan konsekuensi pajaknya harus diputuskan.

---

## 2. Desain lapisan pajak

### KEP-24 — Model perhitungan pajak

**Pertanyaan:** Bagaimana pajak dimodelkan agar benar untuk PBJT per-daerah, PPN, merchant non-PKP, dan (nanti) rezim negara lain?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Field `tax_rate` pada outlet, dikalikan ke subtotal | Paling sederhana; cukup untuk satu outlet satu rezim | Tidak bisa menangani outlet dengan dua jenis pajak. Tidak bisa menangani pajak inklusif vs eksklusif secara bersamaan. Tidak menyimpan *jenis* pajak sehingga pelaporan mustahil dipisah | Prototipe atau produk satu daerah |
| B. `TaxRate` sebagai entitas (nama, jenis, tarif, inklusif/eksklusif, otoritas penerima), dilekatkan ke kategori produk & outlet; `tax_amount` disnapshot ke order line | Menangani multi-rezim dalam satu outlet. Pelaporan bisa dipisah per otoritas. Perubahan tarif tidak mengubah riwayat (KEP-19) | Lebih banyak entitas dan konfigurasi; merchant bisa salah konfigurasi | Multi-outlet, multi-vertikal, dengan rencana ekspansi |
| C. Tax engine berbasis aturan (rule engine dengan kondisi: lokasi × kategori × channel × status pelanggan) | Fleksibilitas maksimum; menangani rezim mana pun termasuk pajak berjenjang | Kompleksitas besar; sulit dijelaskan ke merchant; sulit di-debug saat merchant komplain angka | Produk global dengan puluhan yurisdiksi |

**Rekomendasi:** Opsi B, dengan struktur yang sengaja dibuat bisa berkembang ke C. `[INFERENSI]`

**Alasan:** Realitas Indonesia sudah menuntut lebih dari opsi A sejak outlet pertama — satu kafe yang juga menjual kopi kemasan sudah punya dua rezim. Opsi C berlebihan untuk pasar pertama dan risikonya bukan teknis melainkan produk: merchant yang tidak bisa memahami mengapa sistem menghitung pajak tertentu akan berhenti mempercayai seluruh angka di sistem. Opsi B memberi model yang bisa dijelaskan dalam satu kalimat ("setiap kategori produk punya aturan pajak; setiap outlet punya tarif") sambil tetap benar.

**Yang wajib ada di model `TaxRate`:**
`name` (mis. "PBJT Kota Bandung") · `type` (`pbjt` | `ppn` | `none` | nanti: `vat`, `gst`, `sales_tax`) · `rate` · `is_inclusive` · `applies_to` (kategori/produk/channel) · `jurisdiction` (kode daerah, untuk pelaporan) · `effective_from` / `effective_to`.

Field `effective_from`/`effective_to` sering dilupakan dan penting: ketika perda mengubah tarif, tarif lama tidak dihapus — ia berakhir. Transaksi historis tetap merujuk tarif yang berlaku saat itu (sudah aman lewat snapshot di order line, tapi tabel tarif juga harus punya sejarahnya untuk pelaporan).

**Kapan keputusan ini harus ditinjau ulang:** saat masuk negara dengan pajak berjenjang (federal + state + city, mis. AS) atau dengan aturan reverse-charge (Eropa B2B). Pada titik itu opsi C menjadi perlu, dan struktur B memberi jalur migrasi karena `TaxRate` sudah menjadi entitas, bukan kolom.

**Sumber:** [Bagaimana Ketentuan Pajak Restoran Pasca UU HKPD? — Ortax](https://ortax.org/pbjt-makanan-minuman) (27 Jul 2026) · [Makan di Restoran Tidak Kena PPN — DJP](https://www.pajak.go.id/en/node/81110) (27 Jul 2026) · [Order Taxes — Square Developer](https://developer.squareup.com/docs/orders-api/taxes) (27 Jul 2026)

### Detail teknis: pajak inklusif vs eksklusif

`[FAKTA]` Square mendefinisikan perbedaannya dengan contoh yang bisa dipakai langsung: pajak **additive** ditambahkan di atas harga item — pajak additive 10% pada item $100 menghasilkan total $110. Pajak **inclusive** sudah termasuk dalam harga item — item $100 dengan pajak inklusif 10% totalnya tetap $100, dengan biaya dasar $90,91 dan pajak $9,09. Jika satu item terkena pajak additive **dan** inclusive, pajak additive dihitung atas biaya dasar setelah dikurangi pajak inklusif.
`[FAKTA]` Square juga membedakan fase penerapan: pajak fase *subtotal* dihitung atas biaya dasar item saja (mayoritas pajak); pajak fase *total* dihitung atas biaya dasar plus pajak dari fase subtotal.

*Sumber: [Design a Catalog — Square Developer](https://developer.squareup.com/docs/catalog-api/design-a-catalog), bagian Taxes (diakses 27 Jul 2026)*

`[INFERENSI]` Konsep "fase" ini penting untuk Indonesia meskipun terlihat seperti detail asing: **service charge** (biasanya 5–10%) di restoran Indonesia dikenakan sebelum PBJT, dan PBJT dihitung atas (subtotal + service charge). Ini persis pola "pajak fase total". Model pajak yang tidak punya konsep urutan/fase akan menghitung service charge dan PBJT salah — kesalahan yang langsung terlihat merchant dan merusak kepercayaan.

**Urutan perhitungan yang harus ditegakkan** `[INFERENSI]`:
```
subtotal item (setelah diskon per-item)
  − diskon tingkat order
  = dasar
  + service charge (persentase dari dasar)
  = dasar pajak
  + PBJT / PPN (persentase dari dasar pajak)
  = total
  → pembulatan tunai (hanya untuk pembayaran tunai)
```
Urutan ini harus dapat dikonfigurasi karena praktik berbeda antar merchant, tapi **defaultnya harus benar** dan hasilnya harus bisa ditelusuri baris demi baris di struk — karena inilah yang diperiksa pelanggan dan auditor pajak.

---

## 3. Pembulatan tunai

`[FAKTA]` Shopify memiliki halaman dokumentasi khusus "Cash rounding on POS" — menandakan ini kebutuhan cukup umum sampai butuh fitur tersendiri.
`[FAKTA]` Format uang yang ditetapkan design system Lumi: `Rp` + spasi + titik ribuan, **tanpa desimal** → `Rp 1.847.000`.

*Sumber: [Cash rounding on POS — Shopify Help Center](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-rounding-on-pos) (27 Jul 2026) · `/ds-bundle/readme.md` § Angka & format*

`[ASUMSI]` Praktik Indonesia: pecahan terkecil yang beredar luas adalah Rp100; pecahan Rp50 dan Rp25 secara praktis tidak dipakai. Kafe umumnya membulatkan ke Rp100 atau Rp500 terdekat, dan sebagian membulatkan ke atas sebagai kebijakan. Angka pastinya bervariasi per merchant, jadi ini **harus konfigurasi**, bukan asumsi.

`[INFERENSI]` Aturan yang harus ditegakkan agar tidak menimbulkan masalah pajak: **pembulatan hanya berlaku pada pembayaran tunai, tidak pada nilai transaksi dan tidak pada dasar pengenaan pajak.** Selisih pembulatan dicatat sebagai baris tersendiri (`cash_rounding_adjustment`), bukan disembunyikan ke dalam total. Kalau pembulatan mengubah dasar pajak, laporan pajak merchant akan tidak sinkron dengan penerimaan kas — masalah yang baru ketahuan saat pemeriksaan.

---

## 4. QRIS

`[FAKTA]` Struktur tarif MDR QRIS yang berlaku per 15 Maret 2025:

| Kategori merchant | MDR |
|---|---|
| UMI (Usaha Mikro) transaksi ≤ Rp500.000 | **0%** |
| UMI transaksi > Rp500.000 | 0,3% |
| UKE / UME / UBE (Usaha Kecil / Menengah / Besar) | **0,7%** |
| Sektor pendidikan | 0,6% |
| SPBU | 0,4% |
| Beberapa kategori spesifik | 0% |

`[FAKTA]` **MDR ditanggung merchant, bukan pembeli, dan merchant tidak diperbolehkan membebankan biaya ini kepada konsumen.** Ini kebijakan afirmatif Bank Indonesia untuk mendorong inklusi keuangan.
`[FAKTA]` Bank Indonesia mencatat 39,3 juta UMKM telah menggunakan QRIS hingga semester I 2025.
`[FAKTA]` Midtrans dan Xendit sama-sama mendukung QRIS dengan biaya yang sama, **0,7% per transaksi**, karena tarifnya diatur Bank Indonesia.

*Sumber: [Merchant Discount Rate (MDR) — Bank Indonesia](https://www.bi.go.id/id/publikasi/ruang-media/cerita-bi/Pages/mdr-qris.aspx) · [Ragam Tarif QRIS — Indonesia Baik (Kominfo)](https://indonesiabaik.id/infografis/ragam-tarif-qris) · [Biaya MDR QRIS 2026 untuk Merchant — GetQRIS](https://getqris.id/biaya-mdr-qris-2026-getqris/) · [Midtrans vs Xendit vs DOKU: Perbandingan Payment Gateway Indonesia 2026 — Albatech](https://albatech.id/blog/midtrans-vs-xendit-vs-doku-perbandingan-payment-gateway-indonesia-2026) · [Digitalisasi UMKM — Telkom](https://www.telkom.co.id/sites/berita/id_ID/article/digitalisasi-umkm-strategi-dan-manfaat-untuk-naik-kelas-di-era-digital-367) (semua diakses 27 Jul 2026)*

### Konsekuensi untuk model bisnis dan arsitektur

`[INFERENSI]` **Model bisnis:** Square membangun perusahaan bernilai puluhan miliar dolar dengan menggratiskan software dan mengambil 2,4–2,6% dari setiap transaksi. Di Indonesia, MDR QRIS dipatok 0,7% dan diatur negara — dan sebagian besar sudah menjadi bagian penyelenggara jasa pembayaran, bukan penyedia POS. **Strategi "software gratis, monetisasi dari payment" secara struktural tidak tersedia di Indonesia untuk pemain baru.** Lumi POS harus dimonetisasi dari lisensi software. Ini menutup satu opsi model bisnis dan harus tercermin di Fase 11.

`[INFERENSI]` **Arsitektur:** QRIS **tidak bisa dipakai offline**, dan alasannya struktural bukan implementasi. Alur QRIS dinamis membutuhkan: (1) POS meminta QR dari acquirer dengan nominal, (2) pelanggan memindai dan membayar dari aplikasi mereka, (3) issuer mengonfirmasi ke acquirer, (4) acquirer memberi tahu POS. Langkah 3 dan 4 mustahil tanpa koneksi. Untuk QRIS statis (satu QR untuk semua transaksi), pembayaran bisa terjadi tanpa POS terlibat sama sekali — tapi POS tidak akan tahu pembayarannya berhasil, sehingga kasir harus mengonfirmasi manual dari notifikasi di HP. Ini alur nyata yang dipakai warung dan **layak didukung sebagai metode pembayaran "QRIS statis — dikonfirmasi manual"** dengan penanda audit yang jelas.

**Yang harus ada di v1:**
- Integrasi QRIS dinamis lewat satu payment gateway (Midtrans atau Xendit).
- Metode pembayaran "QRIS statis (konfirmasi manual)" untuk merchant yang memakai QR statis dari bank mereka sendiri — dengan field referensi wajib agar rekonsiliasi tetap mungkin.
- **Rekonsiliasi**: MDR dipotong di sisi settlement, sehingga jumlah yang masuk ke rekening merchant lebih kecil dari nilai transaksi. Sistem harus menampilkan keduanya (nilai transaksi vs perkiraan settlement) agar merchant tidak mengira ada uang hilang.

---

## 5. Payment gateway

| Kandidat | Kekuatan | Kelemahan | Catatan |
|---|---|---|---|
| **Midtrans** | `[FAKTA]` Bagian grup GoTo dengan integrasi GoPay native — e-wallet terbesar Indonesia. Reputasi sebagai standar industri | Dokumentasi dan DX dinilai kurang dibanding Xendit | Keunggulan GoPay signifikan untuk segmen kafe |
| **Xendit** | `[FAKTA]` Reputasinya pada API modern yang bersih dan dokumentasi yang baik — DX lebih nyaman untuk sesuatu yang dibangun custom dan API-first. Fitur menonjol: **Disbursement** (mengirim uang ke rekening bank secara programatik) | Tidak punya integrasi GoPay native seperti Midtrans | Disbursement relevan jika nanti ada fitur settlement ke merchant |
| **DOKU** | Pemain lama Indonesia | Tidak diriset mendalam dalam sesi ini | Dicatat sebagai gap riset |

*Sumber: [Integrating Payments in Indonesia: Midtrans vs Xendit (and When to Pick Which) — DEV Community](https://dev.to/hem_081a27fed379/integrating-payments-in-indonesia-midtrans-vs-xendit-and-when-to-pick-which-5eb6) · [Midtrans vs Xendit vs DOKU — Albatech](https://albatech.id/blog/midtrans-vs-xendit-vs-doku-perbandingan-payment-gateway-indonesia-2026) (diakses 27 Jul 2026)*

### KEP-25 — Abstraksi payment provider

**Pertanyaan:** Apakah integrasi pembayaran dibangun langsung ke satu gateway atau di belakang abstraksi?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Integrasi langsung ke satu gateway | Tercepat; memakai seluruh fitur gateway tanpa penyederhanaan | Mengganti gateway = menyentuh seluruh alur pembayaran. Merchant enterprise sering sudah punya kontrak gateway sendiri dan akan meminta gateway mereka | Produk satu pasar, satu gateway selamanya |
| B. Antarmuka `PaymentProvider` dengan satu adapter di v1 | Menambah gateway = menambah adapter. Merchant on-premise bisa memakai gateway sendiri. Batasnya juga menjadi titik uji yang jelas | Abstraksi bisa terlalu sempit dan harus dibongkar saat gateway kedua ternyata berbeda modelnya | Multi-gateway atau multi-negara direncanakan |
| C. Abstraksi penuh + gateway sebagai plugin yang bisa dipasang merchant | Fleksibilitas maksimum; ekosistem integrator | Kompleksitas besar; permukaan keamanan luas; berlebihan untuk v1 | Platform dengan ekosistem partner |

**Rekomendasi:** Opsi B, dengan **Midtrans sebagai adapter pertama**. `[INFERENSI]`

**Alasan:** Kebutuhan gateway kedua bukan hipotesis — merchant on-premise enterprise hampir pasti sudah punya hubungan dengan bank/gateway tertentu, dan menolak mereka berarti menutup segmen yang paling menguntungkan. Midtrans dipilih pertama karena GoPay: segmen kafe Indonesia punya volume GoPay tinggi, dan integrasi native mengurangi satu lapisan kegagalan. Yang harus dijaga agar abstraksi tidak terlalu sempit: antarmuka harus dimodelkan pada **hasil** (`initiate`, `poll_status`, `refund`, `void`, `settle_report`) bukan pada bentuk request/response Midtrans.

**Yang tidak boleh dilakukan:** menyimpan data kartu apa pun. Digarap di Fase 8 (PCI DSS) — tapi keputusannya ditetapkan di sini: **Lumi POS tidak pernah menyentuh Primary Account Number.** Kartu ditangani terminal EDC bersertifikat atau gateway; POS hanya menerima token dan referensi.

---

## 6. EDC & integrasi terminal

`[FAKTA]` BCA menyediakan antarmuka data otomatis antara **electronic cash register (ECR)** merchant dan BCA EDC Terminal, memungkinkan pemrosesan transaksi tunggal lewat format pesan request/response, untuk rekonsiliasi otomatis dan mengurangi masalah dari double data entry.
`[FAKTA]` **Pembatasan kontraktual penting:** BCA menjamin ECR Interface yang disediakan **hanya akan digunakan untuk memproses transaksi pada terminal BCA, bukan pada terminal yang disediakan bank lain atau lembaga keuangan non-bank.**
`[FAKTA]` Implementasi nyata: Accurate POS terintegrasi dengan mesin ECR EDC BCA sehingga nominal transaksi langsung muncul di mesin EDC — kasir tidak perlu input manual. Integrasi ini mendukung QRIS, Debit, Credit, dan PayWave.
`[FAKTA]` Bank Mandiri menyediakan EDC yang mendukung transaksi QRIS lewat berbagai aplikasi serta Tap to Pay (contactless) maupun Dip.

*Sumber: [EDC BCA — Bank Central Asia](https://www.bca.co.id/en/bisnis/produk/penerimaan-bisnis/EDC-BCA) · [Cara integrasi Accurate POS ke ECR EDC BCA — Help Accurate](https://help.accurate.id/product/accurate-pos/fitur-apos/cara-integrasi-accurate-pos-dengan-mesin-ecr-edc-bca/) · [Mandiri EDC — Bank Mandiri](https://www.bankmandiri.co.id/en/edc) · [Configuration for Integrating BCA EDC Machine With DealPOS](https://support.dealpos.com/en/articles/7054767-configuration-for-integrating-bca-edc-machine-with-dealpos) (semua diakses 27 Jul 2026)*

### KEP-26 — Cakupan integrasi EDC di v1

**Pertanyaan:** Berapa banyak bank yang diintegrasikan lewat ECR di v1?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Tanpa integrasi EDC — kasir input manual "kartu (EDC)" | Nol effort integrasi; jalan dengan bank apa pun; bekerja offline | Double entry (kasir mengetik nominal di dua tempat) = sumber selisih. Rekonsiliasi manual di akhir hari | v1 dengan sumber daya terbatas |
| B. Integrasi ECR satu bank (BCA) | Menghilangkan double entry untuk mayoritas merchant kafe. Rekonsiliasi otomatis. Nilai yang langsung terasa | `[FAKTA]` Kontrak BCA melarang antarmuka dipakai untuk terminal bank lain → setiap bank adalah integrasi + kontrak terpisah. Butuh perangkat fisik untuk pengujian | Ada akses ke perangkat uji dan hubungan dengan bank |
| C. Integrasi multi-bank | Cakupan merchant terluas | Effort berlipat; setiap bank punya protokol, sertifikasi, dan kontrak sendiri. Tidak realistis untuk v1 | Setelah produk punya basis merchant |

**Rekomendasi:** Opsi A di v1, Opsi B di v1.1 dengan BCA sebagai bank pertama. `[INFERENSI]`

**Alasan:** Integrasi ECR membutuhkan tiga hal yang tidak dimiliki di awal: perangkat EDC fisik untuk pengujian, hubungan kontraktual dengan bank, dan waktu sertifikasi. Ketiganya bergantung pada pihak eksternal dan tidak bisa dipercepat dengan menulis kode lebih cepat. Yang **harus** dilakukan di v1 agar B tidak mahal nanti: metode pembayaran "kartu (EDC)" sudah menyimpan field `terminal_reference`, `approval_code`, `card_last4`, dan `acquirer` — meskipun diisi manual. Ketika integrasi ECR datang, field-nya sudah ada dan mengisinya otomatis adalah perubahan satu adapter, bukan migrasi.

**Kapan keputusan ini harus ditinjau ulang:** jika lebih dari 30% percakapan penjualan awal terhambat karena ketiadaan integrasi EDC, prioritasnya naik ke v1.

---

## 7. Coretax & faktur elektronik — status yang berubah bulan ini

`[FAKTA]` Direktorat Jenderal Pajak mulai menjadikan **Coretax** sebagai sistem inti seluruh proses administrasi perpajakan **mulai Juli 2026**. Seluruh pekerjaan pengawasan, penegakan hukum, penagihan, hingga penyelesaian keberatan dan banding dilakukan secara bertahap melalui satu sistem terintegrasi. Semua kertas kerja secara bertahap hanya akan bisa dikerjakan di platform Coretax.
`[FAKTA]` Implementasi penuh Sistem Inti Administrasi Perpajakan (SIAP)/Coretax **menandai berakhirnya penggunaan platform lama seperti DJP Online dan aplikasi desktop e-Faktur.**
`[FAKTA]` Coretax mengintegrasikan seluruh proses bisnis inti: pendaftaran wajib pajak, pelaporan SPT, pembayaran pajak, hingga pemeriksaan dan penagihan.

*Sumber: [DJP Sebut Transaksi Pajak Satu Pintu Lewat Coretax Mulai Juli 2026 — CNN Indonesia](https://www.cnnindonesia.com/ekonomi/20260713191739-532-1380281/djp-sebut-transaksi-pajak-satu-pintu-lewat-coretax-mulai-juli-2026) (13 Jul 2026) · [Dirjen Pajak: Seluruh Administrasi Perpajakan Beralih ke Coretax Mulai Juli 2026 — Kompas](https://money.kompas.com/read/2026/07/13/150400326/dirjen-pajak--seluruh-administrasi-perpajakan-beralih-ke-coretax-mulai-juli) (13 Jul 2026) · [DJP: Seluruh administrasi pajak mulai Juli dilakukan lewat Coretax — ANTARA](https://m.antaranews.com/amp/berita/5647015/djp-seluruh-administrasi-pajak-mulai-juli-dilakukan-lewat-coretax) · [Coretax — Direktorat Jenderal Pajak](https://www.pajak.go.id/en/node/107868) (semua diakses 27 Jul 2026)*

`[INFERENSI]` **Apa yang ini berarti dan tidak berarti untuk Lumi POS:**

**Tidak berarti:** POS harus terhubung langsung ke Coretax untuk setiap transaksi. Indonesia **belum** menerapkan fiscalization real-time gaya Eropa di mana setiap struk harus disahkan pemerintah sebelum dicetak. Tidak ada bukti dalam riset ini bahwa kewajiban semacam itu ada per Juli 2026.

**Berarti:** merchant yang berstatus PKP harus menerbitkan faktur pajak lewat Coretax, dan aplikasi desktop e-Faktur yang selama ini dipakai berakhir. Bagi merchant kafe/retail kecil yang mayoritas bertransaksi dengan konsumen akhir, dampaknya terbatas. Bagi merchant yang melayani B2B (katering perusahaan, penjualan grosir), kebutuhan menerbitkan faktur pajak menjadi nyata.

**Yang harus dilakukan v1:** menyediakan **ekspor rekapitulasi penjualan** dalam format yang bisa dipakai merchant atau akuntannya untuk memenuhi kewajiban pelaporan — bukan integrasi API langsung ke Coretax. Alasannya: integrasi langsung membutuhkan sertifikat elektronik merchant, penanganan kredensial pajak yang sangat sensitif (Fase 8), dan mengikuti perubahan sistem pemerintah yang masih dalam masa transisi.

**⚠️ Peringatan verifikasi:** status Coretax berubah pada bulan yang sama dengan riset ini (Juli 2026). Sumber yang dipakai adalah pemberitaan tanggal 13 Juli 2026. **Sebelum implementasi, status ini wajib diverifikasi ulang langsung ke pajak.go.id dan dengan konsultan pajak** — termasuk apakah ada kewajiban baru bagi penyedia sistem POS. Dicatat sebagai open question prioritas tertinggi.

---

## 8. Kesiapan global — mengapa POS gagal ekspansi karena pajak

`[FAKTA]` **Prancis:** seluruh software cash register dan sistem POS harus disertifikasi oleh badan terakreditasi eksternal paling lambat **31 Agustus 2026**. Undang-undang Keuangan 2026 mengembalikan attestation individual dari vendor software sebagai bukti kepatuhan yang sah, di samping sertifikasi NF525/LNE terakreditasi. Sejak 2018, semua software cash register wajib memenuhi persyaratan anti-fraud di bawah Pasal 286 Code Général des Impôts (CGI) — dikenal sebagai persyaratan ISCA, sertifikasi LNE, atau standar NF525.
`[FAKTA]` **Jerman:** memperkenalkan sistem fiscalization pada 2020 lewat **Kassensicherungsverordnung (KassenSichV)**. Regulasi mewajibkan semua cash register dilengkapi **certified technical security system (TSS/TSE)**. Kewajiban pelaporan cash register mulai berlaku **1 Januari 2025**, mewajibkan semua bisnis yang memakai sistem pencatatan elektronik dengan TSE untuk **mendaftarkan perangkat mereka ke otoritas pajak**.
`[FAKTA]` **Italia:** negara Eropa pertama yang menerapkan persyaratan fiscalization. Memakai fiscalization berbasis **hardware** dengan dua jenis perangkat: RT printer dan RT server.
`[FAKTA]` Pola umum Eropa: solusi fiskal berbasis hardware mengandalkan perangkat fisik (fiscal printer online atau cash register) — umum di Italia, Polandia, dan Bulgaria. Pendekatan hybrid hardware+software terlihat di Austria, Slovakia, dan Jerman.
`[FAKTA]` Shopify memiliki halaman dokumentasi terpisah untuk "Country-specific retail requirements" dan halaman khusus "Retail requirements in Italy" — bukti bahwa beban ini nyata bahkan untuk vendor global besar.

*Sumber: [Fiscalisation in Europe: Country-by-country regulations for 2026 — fiskaly](https://www.fiskaly.com/blog/fiscalization-and-tax-compliance-in-europe) · [POS software certification in France extended to August 2026 — fiskaly](https://www.fiskaly.com/blog/pos-software-certification-france-deadline-extension-august-2026) · [Certification of POS systems in France in 2026 — efsta](https://www.efsta.eu/en/solutions/certification-france) · [Germany — Fiscal Solutions](https://www.fiscal-requirements.com/countries/2) · [Real-time reporting and fiscalization in Europe 2026 — DDD Invoices](https://dddinvoices.com/learn/real-time-reporting-europe/) · [Selling in person with Shopify POS — Shopify Help Center](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) (semua diakses 27 Jul 2026)*

### Mengapa ini menghancurkan POS yang pajaknya di-hardcode

`[INFERENSI]` Bukan sekadar "tarif berbeda". Yang berbeda antar negara adalah **bentuk kewajibannya**:

| Dimensi | Indonesia | Jerman | Italia | Prancis |
|---|---|---|---|---|
| Bentuk kepatuhan | Pelaporan periodik | **Perangkat keamanan (TSE) + registrasi ke otoritas** | **Perangkat keras fiskal (RT printer/server)** | **Sertifikasi software oleh badan terakreditasi** |
| Apa yang disentuh POS | Perhitungan & pelaporan | Setiap transaksi harus ditandatangani TSE | Struk harus dicetak perangkat fiskal | Software harus bersertifikat, termasuk integritas datanya |
| Yang harus ada di arsitektur | Model pajak fleksibel | **Hook penandatanganan transaksi** | **Abstraksi perangkat cetak fiskal** | **Jaminan immutabilitas data yang bisa diaudit** |

**Kesimpulan arsitektural yang menentukan** `[INFERENSI]`: kesiapan global **bukan** tentang mendukung banyak tarif pajak. Ia tentang memiliki **tiga titik ekstensi** yang tidak bisa ditambahkan belakangan tanpa membongkar alur transaksi:

1. **Tax calculation port** — perhitungan pajak sebagai modul yang bisa diganti per yurisdiksi (sudah dijawab KEP-24).
2. **Transaction signing hook** — titik setelah transaksi selesai dan sebelum struk dicetak, di mana perangkat/layanan eksternal bisa menandatangani transaksi dan mengembalikan token yang wajib dicetak. Tidak dipakai di Indonesia, wajib di Jerman.
3. **Receipt rendering port** — pencetakan struk sebagai abstraksi yang bisa diarahkan ke printer biasa atau perangkat fiskal bersertifikat. Wajib di Italia.

**Kabar baik yang jarang disadari:** keputusan append-only di KEP-17 sudah memenuhi sebagian besar persyaratan integritas data yang menjadi inti sertifikasi Prancis (NF525) dan Jerman. Sistem yang bisa meng-`UPDATE` transaksi selesai akan gagal sertifikasi; sistem append-only sudah memenuhi semangatnya. Ini contoh keputusan arsitektur awal yang membayar dirinya bertahun-tahun kemudian.

**Kabar buruk yang harus dinyatakan:** ketiga titik ekstensi ini **tidak boleh dibangun di v1** — membangun abstraksi untuk kebutuhan yang belum ada adalah cara pasti membangun abstraksi yang salah. Yang harus dilakukan di v1 adalah memastikan alur transaksi punya *tempat* untuk ketiganya: satu titik terpusat setelah commit transaksi dan sebelum cetak, bukan logika cetak yang tersebar di banyak layar.

---

## 9. Rekomendasi desain lapisan tax & payment yang pluggable

`[INFERENSI]` Ringkasan yang bisa langsung dipakai di dokumen arsitektur:

```
                    ┌──────────────────────────┐
   Order selesai ──►│  TaxCalculator (port)    │──► TaxRate per jurisdiction
                    │  - id: pbjt | ppn | ...  │    (konfigurasi berdata)
                    └───────────┬──────────────┘
                                ▼
                    ┌──────────────────────────┐
                    │  Transaction commit      │  ◄── append-only (KEP-17)
                    └───────────┬──────────────┘
                                ▼
                    ┌──────────────────────────┐
                    │  SigningHook (port)      │──► no-op di ID
                    │                          │    TSE adapter di DE
                    └───────────┬──────────────┘
                                ▼
                    ┌──────────────────────────┐
                    │  ReceiptRenderer (port)  │──► ESC/POS di ID
                    │                          │    RT printer di IT
                    └──────────────────────────┘

   PaymentProvider (port) ──► Midtrans adapter  (v1)
                         ──► Xendit adapter     (nanti)
                         ──► ECR/EDC adapter    (v1.1)
```

**Aturan yang menjaga ini tetap berfungsi:**
- Tidak ada logika pajak di luar `TaxCalculator`. Kemunculan `* 0.11` di mana pun dalam kode adalah bug arsitektural.
- Tidak ada pemanggilan gateway pembayaran di luar adapter. Layar kasir tidak tahu Midtrans itu apa.
- `SigningHook` dan `ReceiptRenderer` di v1 adalah implementasi trivial (no-op signing, ESC/POS rendering) — keberadaan port-nya yang penting, bukan isinya.

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Perbedaan PBJT vs PPN harus muncul sebagai requirement fungsional, bukan detail teknis: merchant harus bisa mengonfigurasi jenis dan tarif pajak per kategori produk dan per outlet, dan struk harus menampilkan nama pajak yang benar ("PBJT 10%", bukan "Pajak 10%").
- Metode pembayaran v1 yang harus dispesifikasikan: tunai · QRIS dinamis (gateway) · QRIS statis (konfirmasi manual) · kartu via EDC (input manual) · pembayaran campuran (multi-payment per order).
- Pembulatan tunai harus punya requirement sendiri, termasuk pernyataan bahwa pembulatan tidak mengubah dasar pengenaan pajak.
- Ekspor rekapitulasi penjualan untuk keperluan pelaporan pajak masuk v1; integrasi API Coretax **tidak** masuk v1 dan harus dinyatakan sebagai non-goal beserta alasannya.
- Service charge harus ditangani sebagai konsep terpisah dari pajak dengan urutan perhitungan yang eksplisit.

**Untuk Information Architecture:**
- Pengaturan pajak berada di tingkat outlet (tarif, yurisdiksi) dan tingkat katalog (kategori mana kena pajak apa). Keduanya butuh layar sendiri dan hubungannya harus terlihat.
- Layar rekonsiliasi pembayaran digital (nilai transaksi vs perkiraan settlement setelah MDR) adalah layar baru yang belum ada di design system.
- Struk harus menampilkan rincian: subtotal, diskon, service charge, pajak (dengan nama), pembulatan, total — sebagai baris terpisah yang bisa ditelusuri.

**Untuk ERD:**
- `TaxRate` sebagai entitas dengan `type`, `rate`, `is_inclusive`, `jurisdiction`, `effective_from`, `effective_to`.
- `ProductCategory` ↔ `TaxRate` sebagai relasi, dan `Outlet` ↔ `TaxRate` untuk override lokal.
- `Payment` butuh field yang mengakomodasi semua metode: `method`, `amount`, `provider`, `provider_reference`, `terminal_reference`, `approval_code`, `card_last4`, `acquirer`, `confirmed_manually` (boolean untuk QRIS statis), `mdr_estimated`.
- `Order` butuh baris terpisah untuk `service_charge_amount` dan `cash_rounding_adjustment` — bukan digabung ke total.
- **Tidak ada** kolom untuk nomor kartu penuh, CVV, atau data magnetic stripe. Ini larangan yang harus tertulis di ERD, bukan diasumsikan.

**Untuk Technical Architecture:**
- Empat port (`TaxCalculator`, `PaymentProvider`, `SigningHook`, `ReceiptRenderer`) didokumentasikan sebagai titik ekstensi resmi, dengan implementasi v1 yang bisa trivial.
- Aturan "tidak ada angka pajak di luar TaxCalculator" ditetapkan sebagai invariant yang diperiksa dalam code review dan idealnya oleh lint rule.
- Alur pembayaran yang gagal di tengah (POS meminta QRIS, gateway timeout, pelanggan sudah bayar) butuh state machine eksplisit dengan status `pending_confirmation` dan mekanisme polling — ini kelas bug yang paling sering menghasilkan uang hilang di POS.
- Verifikasi status Coretax dan pertanyaan pajak dine-in/takeaway masuk sebagai prasyarat sebelum implementasi modul pajak.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `07-HARDWARE-INTEGRATION.md`.*
