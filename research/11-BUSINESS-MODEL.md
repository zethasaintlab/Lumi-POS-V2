# 11 — Model Bisnis & Pricing

> Fase 11 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

> ⚠️ **Keterbatasan riset yang harus diketahui pembaca.** Kuota pencarian web habis di tengah fase ini. Dokumen ini dibangun dari data yang sudah **terverifikasi dalam sesi yang sama** (harga kompetitor Fase 1, struktur MDR QRIS Fase 6, harga PowerSync Fase 3, harga hardware Fase 7). Dua area **tidak berhasil diverifikasi** dan ditandai jelas: (a) benchmark biaya cloud regional Jakarta per Juli 2026, (b) benchmark churn dan CAC untuk vertical SaaS Indonesia. Keduanya masuk `12-OPEN-QUESTIONS.md`. Seluruh model biaya di bagian 5 adalah `[ASUMSI]` terstruktur, bukan pengukuran.

---

## Ringkasan Keputusan

1. **Monetisasi harus dari lisensi software, bukan dari payment.** `[FAKTA]` MDR QRIS diatur Bank Indonesia (0,7% untuk UKE/UME/UBE, 0% untuk mikro ≤Rp500rb) dan **merchant dilarang membebankannya ke konsumen**. Strategi Square — software gratis, monetisasi 2,4–2,6% dari setiap transaksi — secara struktural tidak tersedia di Indonesia. Ini menutup satu model dan memaksa yang lain. (→ KEP-37)

2. **Unit harga adalah per outlet per bulan, bukan per terminal atau per user.** Ini yang dipakai anchor pasar (Moka Rp299k–799k/outlet/bulan) dan yang paling mudah dipahami merchant. Per-terminal menghukum merchant yang menambah kasir di jam sibuk — persis perilaku yang seharusnya didorong. (→ KEP-38)

3. **Lever tier di pasar Indonesia adalah kuota, bukan fitur canggih.** `[FAKTA]` Kasir Pintar membedakan Free vs Pro dengan batas 1.000 vs 10.000 produk, 3 vs 10+ laporan, dan maks 5 staff. ESB membedakan Basic vs Advanced dengan <30 vs 100+ laporan. Ini menentukan bahwa sistem metering & kuota harus ada di arsitektur sejak v1 (sudah diputuskan di Fase 9).

4. **KDS tidak boleh menjadi fitur premium.** `[FAKTA]` Loyverse memberikan POS, Dashboard, **KDS, dan Customer Display secara gratis**. Menaruh KDS di tier berbayar akan langsung dibandingkan dan kalah. Ini membatasi ruang pricing secara nyata.

5. **Rekomendasi harga: tiga tier pada Rp0 (terbatas keras) / Rp349.000 / Rp699.000 per outlet per bulan**, dengan diskon tahunan. Diposisikan tepat di bawah Moka pada tier menengah, dengan pembeda offline dan multi-vertikal — bukan perang harga. (→ KEP-39)

---

## 1. Pola pricing POS yang dipakai industri

Diringkas dari data yang diverifikasi di Fase 1.

| Pola | Contoh terverifikasi | Kapan berhasil | Kapan gagal |
|---|---|---|---|
| **Payment-subsidized** (software murah/gratis, ambil dari transaksi) | `[FAKTA]` Square: $0/$49/$149 per bulan + 2,4–2,5% + 15¢ in-person. Toast: Starter Kit $0/bulan dengan 2,99% + 15¢ | Pasar di mana penyedia POS bisa menjadi payment facilitator dengan margin | **Indonesia — MDR diatur negara di 0,7% dan dilarang dibebankan ke konsumen** |
| **Per lokasi / outlet per bulan** | `[FAKTA]` Moka: Rp299.000–799.000 per outlet per bulan. Lightspeed Restaurant: $69/$189/$399 per bulan | Merchant multi-outlet; unit yang mudah dipahami | Merchant satu outlet dengan banyak terminal merasa terlalu mahal |
| **Per lokasi + per karyawan** | `[FAKTA — sumber pihak ketiga]` Toast Restaurant Basics ~$110/bulan + $4/karyawan | Menangkap nilai dari outlet besar | Menghukum outlet dengan banyak staf paruh waktu — umum di F&B Indonesia |
| **Freemium dengan batas kuota** | `[FAKTA]` Qasir gratis selamanya, Pro dari Rp66.780/bln. Kasir Pintar Free (1.000 produk, 3 laporan) vs Pro dari Rp55.500/bln (10.000 produk, 10+ laporan, 5 staff) | Akuisisi volume tinggi, konversi rendah | Butuh modal untuk menanggung pengguna gratis |
| **Freemium fitur inti gratis + add-on** | `[FAKTA]` Loyverse: POS, Dashboard, **KDS, CDS gratis**; Employee Management, Advanced Inventory, Integrations berbayar | Penetrasi pasar cepat | Menetapkan lantai harga yang menghancurkan pemain baru |
| **Tahunan di muka** | `[FAKTA]` Olsera: Basic Rp1.288.000/thn, Premium Rp1.988.000/thn, Pro Rp2.688.000/thn (≈Rp107k–224k/bln). Qasir Rp699.000/tahun | Mengurangi churn; arus kas di muka | Hambatan masuk lebih tinggi |
| **Enterprise "tanya kami"** | `[FAKTA]` ESB Enterprise: "Harga Sesuai Kebutuhan". Moka Enterprise | Menangkap nilai dari akun besar | Butuh tim sales |

*Sumber (semua diakses 27 Jul 2026): [Square POS Pricing 2026 — tech.co](https://tech.co/pos-system/square-pos-pricing) · [Restaurant POS Pricing & Plans — Toast](https://pos.toasttab.com/pricing) · [Toast Pricing — Owner.com](https://www.owner.com/blog/toast-pricing) · [Lightspeed Restaurant POS Review 2026 — POS USA](https://www.posusa.com/lightspeed-restaurant-pos-review/) · [Moka POS: Review Lengkap Fitur, Harga 2026 — HashMicro](https://www.hashmicro.com/id/blog/review-aplikasi-moka-pos/) · [Loyverse Pricing Guide — Loman](https://loman.ai/blog/loyverse-pricing) · [Olsera POS: Harga, Fitur — EquipERP](https://www.equiperp.com/blog/olsera-pos/) · [8 Aplikasi Kasir (POS) Terbaik untuk UKM 2026 — Founderplus](https://founderplus.id/blog/aplikasi-kasir-pos-ukm-terbaik/) · [ESB Pricing](https://www.esb.id/id/pricing)*

---

## 2. Tingkat harga yang berlaku di pasar Indonesia

Disusun ulang dari data Fase 1 sebagai peta harga yang bisa dipakai untuk memposisikan.

| Produk | Harga bulanan efektif | Posisi |
|---|---|---|
| Qasir Free, Kasir Pintar Free, Loyverse | **Rp0** | Lantai absolut |
| Kasir Pintar Pro | Rp55.500 | |
| Qasir Pro | Rp66.780 (tagihan tahunan) | |
| Olsera Basic | ≈Rp107.000 (Rp1.288.000/thn) | |
| Pawoon Basic | Rp149.000 | |
| Olsera Pro | ≈Rp224.000 (Rp2.688.000/thn) | |
| Qasir paket usaha besar | Rp249.000 | |
| **Moka Basic** | **Rp299.000/outlet** | **Anchor psikologis segmen "POS serius"** |
| Pawoon Pro | Rp299.000 | |
| iSeller | dari Rp300.000 | |
| ESB Advanced | Rp499.000 | |
| **Moka Enterprise** | **s.d. Rp799.000/outlet** | Batas atas non-negosiasi |
| ESB Enterprise, Moka Enterprise custom | "Tanya kami" | |

`[INFERENSI]` **Dua angka yang membentuk seluruh strategi:**
- **Rp299.000** adalah harga yang diasosiasikan merchant dengan "POS profesional dengan multi-outlet". Harga di bawahnya dianggap kelas UKM; di atasnya butuh justifikasi eksplisit.
- **Rp0** adalah lantai nyata, bukan teoretis. Tiga produk fungsional tersedia gratis, dan salah satunya (Loyverse) menyertakan KDS.

---

## 3. Keputusan model bisnis

### KEP-37 — Sumber pendapatan utama

**Pertanyaan:** Dari mana Lumi POS menghasilkan uang?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Payment-subsidized (software murah, ambil dari transaksi) | Model paling kuat secara ekonomi di pasar lain; hambatan masuk merchant nol | `[FAKTA]` MDR QRIS dipatok BI di 0,7% (0% untuk mikro ≤Rp500rb) dan **dilarang dibebankan ke konsumen**. Sebagian besar MDR itu milik penyelenggara jasa pembayaran, bukan penyedia POS. **Secara struktural tidak tersedia** | Pasar dengan MDR tidak diatur dan lisensi payment facilitator |
| B. Lisensi software berlangganan | Pendapatan terprediksi; tidak bergantung volume transaksi merchant; selaras dengan segmen target yang mau membayar | Harus bersaing dengan produk gratis; butuh nilai yang terlihat setiap bulan | Pasar dengan kemauan bayar terbukti (terbukti di segmen Rp299k–799k) |
| C. Hybrid: lisensi + revenue share dari gateway partner | Menambah aliran pendapatan tanpa membangun payment sendiri | Margin dari partner tipis karena MDR sudah dipatok. Menambah kompleksitas kontrak untuk pendapatan kecil | Volume transaksi sangat besar |

**Rekomendasi:** Opsi B, dengan Opsi C sebagai tambahan opsional setelah volume signifikan. `[INFERENSI]`

**Alasan:** Ini bukan pilihan melainkan konsekuensi regulasi. Regulasi Bank Indonesia menghilangkan opsi A secara struktural. Yang penting dari kesimpulan ini bukan pilihannya, melainkan **implikasinya pada desain produk**: karena pendapatan datang dari lisensi bulanan, produk harus memberikan nilai yang **terlihat setiap bulan** kepada owner — laporan yang dibuka, exception report yang menemukan kebocoran, keputusan yang terbantu. Produk yang hanya "bekerja diam-diam" akan di-churn karena owner tidak melihat alasan membayar.

**Kapan keputusan ini harus ditinjau ulang:** jika regulasi MDR berubah, atau jika Lumi POS mencapai skala yang membuat menjadi agregator pembayaran layak secara ekonomi (jauh di luar horizon v1).

---

### KEP-38 — Unit penagihan

**Pertanyaan:** Apa yang dihitung — outlet, terminal, pengguna, atau transaksi?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Per **outlet** per bulan | `[FAKTA]` Sesuai anchor pasar (Moka per outlet). Mudah dipahami. Merchant bebas menambah terminal di jam sibuk tanpa penalti. Metering sederhana | Outlet besar dan kecil membayar sama — nilai tidak proporsional | Merchant multi-outlet, yang persis segmen target |
| B. Per **terminal/device** | Lebih proporsional terhadap ukuran outlet | **Menghukum perilaku yang seharusnya didorong** — merchant akan menahan diri menambah kasir di jam sibuk, memperburuk pengalaman mereka dan mengurangi ketergantungan pada produk | Outlet dengan jumlah terminal stabil |
| C. Per **pengguna** | Umum di SaaS B2B | Tidak cocok F&B Indonesia: turnover staf tinggi, banyak paruh waktu. Merchant akan berbagi akun — merusak audit trail, yang merupakan fitur inti (Fase 8) | Software knowledge worker |
| D. Berbasis **volume transaksi** | Paling proporsional terhadap nilai | Merchant tidak bisa memprediksi tagihan. Menghukum kesuksesan. Berisiko dianggap "potongan penjualan" | Infrastruktur, bukan aplikasi bisnis |

**Rekomendasi:** Opsi A — per outlet per bulan, dengan **kuota device yang longgar** (mis. 3 device termasuk, tambahan dikenakan biaya kecil). `[INFERENSI]`

**Alasan:** Opsi C punya efek samping yang merusak fitur inti: penagihan per pengguna mendorong merchant berbagi akun, dan akun bersama menghancurkan atribusi audit trail yang menjadi dasar seluruh laporan exception (Fase 8) — fitur yang justru dijual. Opsi B menghukum penambahan terminal, padahal semakin banyak terminal Lumi POS di outlet, semakin dalam ketergantungannya dan semakin rendah churn. Kuota device longgar menangkap sedikit nilai proporsional tanpa menciptakan disinsentif.

---

### KEP-39 — Struktur tier dan harga

**Pertanyaan:** Berapa tier, apa isinya, dan pada harga berapa?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Satu harga tunggal | Paling sederhana untuk dijelaskan dan dibangun; tanpa feature gating | Meninggalkan uang di meja pada akun besar; tidak ada jalur masuk murah | Produk dengan segmen sangat homogen |
| B. Dua tier (Standar / Pro) | Sederhana; keputusan pembelian mudah | Tanpa jalur gratis, biaya akuisisi tinggi di pasar yang terbiasa mencoba gratis | Segmen menengah murni |
| C. Tiga tier: Gratis (terbatas keras) / Standar / Pro, + Enterprise custom | Jalur masuk tanpa hambatan; upgrade alami saat merchant tumbuh; menangkap akun besar | Tier gratis membawa biaya dukungan dan infrastruktur tanpa pendapatan; butuh disiplin membatasinya | Pasar yang terbiasa mencoba gratis — persis Indonesia |

**Rekomendasi:** Opsi C. `[INFERENSI]`

**Struktur yang direkomendasikan** `[ASUMSI — angka harga adalah rekomendasi berdasarkan posisi kompetitif, bukan hasil riset kemauan bayar]`:

| | **Gratis** | **Standar** | **Pro** | **Enterprise** |
|---|---|---|---|---|
| **Harga** | Rp0 | **Rp349.000**/outlet/bln | **Rp699.000**/outlet/bln | Custom |
| Tahunan (−15%) | — | Rp3.560.000/thn | Rp7.130.000/thn | — |
| Outlet | 1 | tanpa batas (per outlet) | tanpa batas | tanpa batas |
| Device termasuk | 1 | 3 | 6 | negosiasi |
| Device tambahan | — | Rp50.000/bln | Rp50.000/bln | negosiasi |
| Pengguna | 2 | 10 | tanpa batas | tanpa batas |
| Produk | 200 | 5.000 | tanpa batas | tanpa batas |
| Riwayat & laporan | 30 hari | 24 bulan | tanpa batas | tanpa batas |
| **Offline penuh** | ✅ | ✅ | ✅ | ✅ |
| **KDS** | ✅ | ✅ | ✅ | ✅ |
| Multi-outlet & transfer stok | — | ✅ | ✅ | ✅ |
| Laporan exception / anti-fraud | — | dasar | lengkap | lengkap |
| Resep/BOM & food cost | — | — | ✅ | ✅ |
| Purchasing & supplier | — | — | ✅ | ✅ |
| Integrasi aggregator | — | — | ✅ | ✅ |
| API & webhook | — | — | ✅ | ✅ |
| Self-hosted | — | — | — | ✅ (dengan biaya implementasi) |
| SLA & support prioritas | komunitas | email | email prioritas | SLA |

**Alasan penempatan harga:**
- **Rp349.000** ditempatkan Rp50.000 di atas anchor Moka Basic (Rp299.000) — cukup dekat untuk dibandingkan, cukup berbeda untuk tidak terlihat sebagai peniru harga. Selisihnya harus dijustifikasi oleh pembeda offline dan multi-vertikal. Menempatkannya **di bawah** Rp299.000 adalah kesalahan: ia memicu perang harga yang tidak bisa dimenangkan dan memberi sinyal produk kelas bawah.
- **Rp699.000** berada di dalam rentang atas Moka (s.d. Rp799.000) tetapi di bawahnya, dengan fitur (resep/BOM, purchasing, exception report lengkap) yang harus lebih dalam.
- **KDS dan offline penuh ada di semua tier termasuk gratis.** `[FAKTA]` Loyverse memberikan KDS gratis; melawannya adalah kekalahan pasti. Offline penuh ada di semua tier karena ia adalah identitas produk — menjadikannya premium berarti mengubur satu-satunya pembeda.
- **Yang di-gate adalah skala dan kedalaman**, bukan kemampuan dasar berjualan: multi-outlet, kedalaman laporan, resep/BOM, integrasi. Ini sejalan dengan pola pasar Indonesia yang memakai kuota sebagai lever.

**Kapan keputusan ini harus ditinjau ulang:** setelah 30–50 percakapan penjualan nyata. Jika lebih dari separuh calon pelanggan menolak karena harga, turunkan tier Standar ke Rp299.000 dan pindahkan sebagian fitur ke Pro — **jangan** menurunkan harga tanpa memindahkan nilai, karena itu menetapkan ulang persepsi tanpa memperbaiki ekonomi.

---

## 4. Trial, onboarding, dan biaya switching

`[FAKTA]` Moka menawarkan demo gratis 14 hari bagi pengguna baru. Loyverse tidak meminta kartu kredit, kontrak, atau komitmen apa pun. Qasir menawarkan versi gratis yang bisa dipakai selamanya.

`[INFERENSI]` **Trial 14 hari adalah norma, tapi salah untuk POS.** POS bukan software yang bisa dievaluasi dalam 14 hari — nilainya baru terlihat setelah satu siklus penuh (laporan bulanan, tutup buku, pola penjualan). Rekomendasi: **tier gratis permanen dengan batas keras** menggantikan trial berwaktu. Merchant memakai gratis sampai batasnya menghalangi, lalu upgrade karena kebutuhan nyata — bukan karena timer berakhir.

### Biaya switching bagi merchant

`[INFERENSI]` Memahami ini penting dari dua arah: apa yang menghalangi merchant meninggalkan kompetitor (hambatan akuisisi), dan apa yang menahan mereka meninggalkan Lumi POS (retensi).

| Sumber biaya switching | Besarnya | Implikasi untuk akuisisi |
|---|---|---|
| **Migrasi katalog produk** | Sedang–besar (ratusan–ribuan SKU dengan modifier) | **Impor dari format kompetitor adalah fitur akuisisi, bukan utilitas.** Impor dari Moka, Olsera, dan CSV generik harus ada sejak awal |
| Migrasi data pelanggan & loyalty | Sedang | Poin loyalty yang hilang adalah blocker emosional |
| Pelatihan ulang kasir | Besar (turnover tinggi, tapi tetap disruptif) | UI yang bisa dipelajari tanpa training adalah keunggulan nyata — design system sudah menetapkan "tanpa onboarding in-app, tanpa wizard basa-basi" |
| Kontrak tahunan berjalan | Besar | `[FAKTA]` Olsera dan Qasir menjual tahunan. **Merchant hanya bisa direbut di jendela perpanjangan** — timing penjualan penting |
| Riwayat historis tertinggal | Sedang | Tawarkan impor riwayat penjualan, meski hanya agregat |
| Hardware terkunci | **Nol untuk kompetitor Indonesia** | Berbeda dari Toast; tidak ada kompetitor lokal yang mengunci hardware, jadi ini bukan hambatan maupun keunggulan |

`[INFERENSI]` **Momen switching alami yang paling berharga:** merchant yang **membuka outlet kedua**. Pada momen itu mereka mengevaluasi ulang sistem karena kebutuhan berubah (dari single-outlet menjadi multi-outlet), dan biaya switching relatif lebih rendah karena mereka toh harus melakukan setup baru. Ini konsisten dengan KEP-02 (Fase 1) dan harus menjadi fokus channel penjualan.

---

## 5. Model biaya infrastruktur kasar per tenant

> ⚠️ Seluruh bagian ini `[ASUMSI]` terstruktur. Harga cloud regional Jakarta tidak berhasil diverifikasi (kuota riset habis). Angka dipakai sebagai **kerangka perhitungan**, bukan sebagai prediksi. Verifikasi harga sebelum dipakai untuk keputusan.

### 5.1 Asumsi beban per tenant

| Parameter | Tenant kecil (1 outlet) | Tenant menengah (5 outlet) | Tenant besar (20 outlet) |
|---|---|---|---|
| Transaksi/hari | 150 | 1.000 | 5.000 |
| Transaksi/bulan | 4.500 | 30.000 | 150.000 |
| Device aktif | 1–2 | 8 | 35 |
| Ukuran data/bulan (transaksi + audit + stock movement) | ~15 MB | ~100 MB | ~500 MB |
| Data tersinkron ke device/bulan | ~50 MB | ~400 MB | ~2 GB |

`[ASUMSI]` Estimasi ukuran: satu transaksi dengan 4 baris menghasilkan ~3 KB (order + line + payment + stock movement + audit event, termasuk index).

### 5.2 Komponen biaya

| Komponen | Basis | Catatan |
|---|---|---|
| **Compute (API + worker)** | Dibagi antar tenant | Beban I/O-bound; satu instance ukuran menengah melayani banyak tenant |
| **Database** | Dibagi (shared + RLS, KEP-32) | Dominan pada storage dan IOPS, bukan compute |
| **Sync service** | `[FAKTA]` PowerSync Open Edition **self-hosted = gratis**; PowerSync Cloud Pro dari $49/bulan dengan 30 GB sync termasuk lalu **$1/GB**, 1.000 peak concurrent connection lalu **$30 per 1.000**, instance tambahan $25/bulan | Ini komponen biaya paling terprediksi dan paling mudah dimodelkan |
| **Storage** | Tumbuh linear, tidak pernah menyusut (append-only) | Perlu strategi arsip untuk data > 24 bulan |
| **Egress** | Sinkronisasi turun ke device | Bisa menjadi signifikan pada tenant besar dengan banyak device |
| **Backup** | ~2× ukuran data | |
| **Observability** | Per event | Sampling wajib untuk mengendalikannya |

### 5.3 Implikasi PowerSync Cloud versus self-host

`[FAKTA]` Data harga PowerSync Cloud (halaman resmi, Fase 3):
- Pro dari **$49/bulan**: 30 GB sync termasuk, lalu $1/GB; 10 GB hosted, lalu $1/GB; 1.000 peak concurrent connection, lalu $30 per 1.000; 2 instance, lalu $25/bln per instance.
- Team dari **$599/bulan**: menambah SLA, uptime guarantee, version locking, custom write checkpoint, SOC 2.
- **Open Edition: self-hosted, gratis** (Functional Source License).

`[INFERENSI]` Perhitungan yang menentukan: peak concurrent connection setara jumlah device kasir yang aktif bersamaan. Pada 1.000 device — kira-kira **150–300 merchant** dengan asumsi 3–6 device per merchant — batas 1.000 connection tercapai dan biaya tambahan mulai berjalan pada $30 per 1.000 berikutnya. Sync 30 GB/bulan tercapai kira-kira pada 60–100 tenant menengah.

**Kesimpulannya:** PowerSync Cloud masuk akal untuk fase awal (di bawah ~100 merchant) karena menghilangkan beban operasional, dan **self-host menjadi wajar setelahnya** — terutama karena arsitektur on-premise (Fase 9) sudah menuntut kemampuan self-host PowerSync. Ini bukan keputusan yang harus diambil sekarang; yang penting adalah **tidak membangun ketergantungan pada fitur PowerSync Cloud yang absen di Open Edition** (dashboard, alerting, custom write checkpoints). Sudah tercatat di Fase 3.

### 5.4 Kerangka gross margin

`[ASUMSI]` Dengan harga Standar Rp349.000/outlet/bulan:

| Skala | Pendapatan/bulan | Biaya infra `[ASUMSI]` | Gross margin |
|---|---|---|---|
| 10 merchant (15 outlet) | Rp5,2 juta | Rp1,5–2,5 juta (biaya tetap dominan) | ~55% |
| 100 merchant (180 outlet) | Rp62,8 juta | Rp8–14 juta | ~80% |
| 500 merchant (1.000 outlet) | Rp349 juta | Rp35–60 juta | ~85% |

`[INFERENSI]` Bentuk kurvanya lebih penting daripada angkanya: **biaya tetap mendominasi di bawah ~50 merchant**, dan margin baru sehat setelah melewati titik itu. Ini menentukan bahwa target awal bukan "profitabilitas" melainkan **mencapai ~50 merchant secepat mungkin**, dan bahwa struktur biaya harus dijaga tetap rendah sampai titik itu tercapai (argumen tambahan untuk tanpa Redis, tanpa managed service proprietary, tanpa on-premise di awal — konsisten dengan Fase 3 dan 9).

### 5.5 Biaya yang sering dilupakan dalam model

| Biaya | Catatan |
|---|---|
| **Support** | Untuk solo builder ini adalah **waktu**, bukan uang — dan waktu adalah sumber daya yang paling langka. Fase 7 memperkirakan tiket hardware bisa menjadi kategori terbesar |
| Payment gateway | MDR ditanggung merchant, tapi biaya integrasi/settlement report bisa ada |
| Perangkat uji hardware | `[FAKTA]` 5–8 model printer dari Rp235.000–890.000 = di bawah Rp5 juta sekali. Murah, dan Fase 7 merekomendasikannya |
| App store | Jika mobile dirilis lewat Play Store/App Store |
| Tier gratis | Merchant gratis tetap memakai sync, storage, dan support. **Batas kuota tier gratis adalah keputusan ekonomi, bukan produk** |

---

## 6. Implikasi teknis dari pilihan pricing

`[INFERENSI]` Setiap keputusan pricing di atas menuntut sesuatu dari arsitektur. Ini jembatan langsung ke Fase 9.

| Keputusan pricing | Yang dituntut dari sistem |
|---|---|
| Per outlet per bulan | `Outlet` sebagai entitas kelas satu sejak skema pertama (sudah di Fase 1) |
| Kuota device dengan biaya tambahan | Registri device dengan status aktif/dicabut; penegakan saat provisioning (Fase 9) |
| Kuota produk & pengguna | Penegakan pada operasi administratif, **tidak pernah pada alur kasir** (Fase 9) |
| Batas riwayat & laporan per tier | Query laporan harus tahu batas tier — ini masuk lapisan otorisasi, bukan UI |
| Fitur di-gate (resep, purchasing, integrasi) | Feature flag komersial, terpisah dari kill switch operasional (Fase 10) |
| Tier gratis dengan batas keras | Sistem harus **menurunkan** tenant dengan anggun saat downgrade — tidak menghapus data, hanya membatasi akses. Menghapus data merchant adalah cara pasti kehilangan reputasi |
| Diskon tahunan | Siklus penagihan dan proration |
| Enterprise custom + self-hosted | Lisensi bertandatangan yang diverifikasi offline (KEP-34) |
| Impor dari kompetitor sebagai fitur akuisisi | Modul impor dengan pemetaan format; bukan skrip sekali pakai |

---

## 7. Metrik yang harus dilacak sejak merchant pertama

`[INFERENSI]` Untuk produk berbasis lisensi, metrik yang menentukan bukan volume transaksi merchant melainkan **apakah merchant melihat nilai**:

| Metrik | Mengapa |
|---|---|
| Merchant aktif (transaksi ≥ 1 dalam 7 hari) | Definisi hidup |
| **Owner login per bulan** | Owner yang tidak pernah membuka dashboard akan churn — dia tidak melihat apa yang dibayarnya |
| Laporan yang dibuka per merchant per bulan | Proksi nilai yang dirasakan |
| Konversi Gratis → Standar | Menguji apakah batas kuota ditempatkan dengan benar |
| Churn bulanan per tier | |
| Waktu dari daftar sampai transaksi pertama | Kualitas onboarding |
| Outlet per merchant (tren) | Ekspansi = pendapatan tanpa akuisisi baru |
| Tiket support per merchant per bulan | Untuk solo builder, ini penentu berapa banyak merchant yang bisa dilayani |
| Rasio waktu offline per merchant | Merchant dengan internet buruk adalah yang paling merasakan nilai — dan kandidat testimoni terbaik |

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Matriks tier di KEP-39 adalah lampiran PRD yang mendefinisikan gating fitur — setiap functional requirement harus tahu tier minimumnya.
- Perilaku downgrade harus punya requirement eksplisit: data tidak dihapus, hanya akses dibatasi, dengan pesan yang menjelaskan.
- Impor katalog dari kompetitor (Moka, Olsera, CSV) adalah fitur v1 dengan justifikasi akuisisi, bukan utilitas admin.
- Tier gratis permanen menggantikan trial berwaktu — ini keputusan produk dengan konsekuensi pada biaya yang harus disetujui sadar.
- Requirement "owner melihat nilai bulanan" harus diterjemahkan menjadi fitur konkret: ringkasan bulanan yang dikirim proaktif, exception report yang menemukan angka.

**Untuk Information Architecture:**
- Layar "Langganan & Batas" (dari Fase 9) menampilkan pemakaian versus kuota, dengan jalur upgrade yang jelas pada titik di mana batas terasa.
- Prompt upgrade muncul di titik gesekan alami (saat menambah outlet kedua, saat produk mendekati batas) — bukan sebagai banner global.
- Alur impor katalog butuh layarnya sendiri dengan pratinjau dan penanganan error per baris.

**Untuk ERD:**
- `Subscription`: `tenant_id`, `plan`, `billing_cycle`, `started_at`, `renews_at`, `status`, `price_locked` (harga yang dikunci saat berlangganan — kenaikan harga tidak boleh berlaku surut).
- `UsageMetric` per tenant per periode (sudah di Fase 9) menjadi dasar tampilan pemakaian dan penagihan device tambahan.
- `PlanDefinition` sebagai data, bukan konstanta di kode — agar tier bisa diubah tanpa rilis.
- Histori perubahan paket (`SubscriptionEvent`) untuk analisis churn dan upgrade.

**Untuk Technical Architecture:**
- Feature gating komersial (dari `PlanDefinition` + lisensi) harus terpisah secara arsitektural dari kill switch operasional (Fase 10) meskipun mekanismenya mirip — mencampurnya berarti insiden operasional bisa mengubah hak komersial merchant.
- Penegakan kuota berada di satu lapisan yang dipanggil operasi administratif, tidak tersebar.
- Aturan mutlak yang diulang dari Fase 9: **tidak ada penegakan komersial yang boleh menghentikan penjualan.**

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `12-OPEN-QUESTIONS.md` dan `00-EXECUTIVE-BRIEF.md`.*
