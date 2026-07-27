# 00 — Executive Brief

> Sintesis paket riset pra-produksi **Lumi POS**. Tanggal riset: 27 Juli 2026.
> **Dokumen ini bisa dibaca berdiri sendiri.** Pembaca yang belum membuka satu pun dokumen lain akan memahami rekomendasi utama, arsitektur yang diusulkan, risiko terbesar, dan urutan build.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri karena data tidak tersedia.

---

## 1. Ringkasan dalam satu halaman

**Lumi POS** akan menjadi point-of-sale komersial untuk pasar Indonesia, menyasar merchant **2–20 outlet** di segmen F&B (kafe/resto) dengan retail umum sebagai vertikal kedua.

**Posisi kompetitif:** keandalan operasional saat jaringan buruk, ditambah dukungan multi-vertikal sejati. Ini bukan klaim pemasaran — ia dipilih karena batas kemampuan offline kompetitor **terdokumentasi secara publik dan sempit**, dan karena kompetitor lokal terbesar terkunci pada satu vertikal.

**Bukti yang mendasari posisi ini:**
- `[FAKTA]` Shopify POS saat offline: tidak bisa pembayaran kartu, **tidak ada update stok, tidak ada refund, tidak bisa mengakses data pelanggan**.
- `[FAKTA]` Odoo POS: **tidak bisa membuka sesi POS baru** tanpa internet.
- `[FAKTA]` Lightspeed: butuh appliance khusus (Lightserver) untuk sinkronisasi lokal; tanpa internet tidak ada pembayaran kartu.
- `[FAKTA]` ESB — pemain terbesar F&B Indonesia dengan 30.000+ restoran dan klien Starbucks Indonesia/Subway — adalah produk **F&B murni**, tanpa jejak retail umum.

**Model bisnis:** lisensi berlangganan per outlet per bulan. `[FAKTA]` Monetisasi lewat payment tidak tersedia di Indonesia — MDR QRIS dipatok Bank Indonesia (0,7% untuk usaha kecil/menengah/besar, 0% untuk mikro ≤Rp500.000) dan merchant **dilarang membebankannya ke konsumen**.

**Rekomendasi harga** `[ASUMSI]`: Gratis (terbatas keras) / **Rp349.000** / **Rp699.000** per outlet per bulan, diposisikan tepat di atas anchor pasar Moka (Rp299.000–799.000/outlet/bulan).

---

## 2. Arsitektur yang diusulkan — satu halaman

```
                          ┌─────────────────────────────────────────┐
  PERANGKAT               │  Aplikasi React (satu codebase UI)      │
  (kasir, KDS, owner)     │  ← 21 komponen dari /ds-bundle          │
                          │                                          │
                          │  Web (browser)  ·  Tauri 2 (desktop)    │
                          │                 ·  Tauri 2 (mobile, fase 2)│
                          ├─────────────────────────────────────────┤
                          │  SQLite lokal                            │
                          │  · WASM + OPFS di browser                │
                          │  · native di Tauri                       │
                          │  → satu skema, satu dialek SQL            │
                          └────────┬───────────────────┬────────────┘
                                   │                   │
                     TURUN (replikasi)          NAIK (transaksi)
                     PowerSync Open Edition     Outbox lokal → REST idempoten
                     katalog, harga,            penjualan, void, refund,
                     riwayat 90 hari            stock movement
                                   │                   │
                          ┌────────┴───────────────────┴────────────┐
   SERVER                 │  Modular monolith — Node.js/TypeScript  │
                          │  Fastify · REST + OpenAPI (spec-first)   │
                          │                                          │
                          │  catalog · ordering · payment            │
                          │  inventory · cash · identity             │
                          │  reporting · sync · tenancy              │
                          │  ↳ tanpa akses DB lintas modul           │
                          ├─────────────────────────────────────────┤
   PORT (titik ekstensi)  │ TaxCalculator │ PaymentProvider          │
                          │ SigningHook   │ ReceiptRenderer          │
                          │ PeripheralPort                           │
                          ├─────────────────────────────────────────┤
                          │  PostgreSQL 17+                          │
                          │  · shared tables + Row-Level Security    │
                          │  · queue via SKIP LOCKED (tanpa Redis)   │
                          │  · penjualan APPEND-ONLY                 │
                          └─────────────────────────────────────────┘

   Deployment: satu docker-compose.yml — sama untuk SaaS dan (nanti) on-premise
   Perbedaan hanya lewat environment variable. Tidak ada `if (isOnPrem)`.
```

**Lima keputusan struktural yang membentuk segalanya:**

1. **Penjualan bersifat append-only.** Void dan refund adalah record baru, bukan modifikasi. Ini memberi audit trail, menghilangkan hampir seluruh konflik sinkronisasi (dua `INSERT` tidak pernah konflik), dan memenuhi semangat persyaratan integritas data yang menjadi inti sertifikasi POS Eropa.

2. **Stok adalah ledger, bukan angka.** Stok saat ini = `SUM(stock_movement)`. Tiga kebutuhan berbeda — sinkronisasi offline yang konvergen, audit trail, dan metrik actual-vs-theoretical — semuanya secara independen menuntut struktur ini.

3. **Order line adalah snapshot.** Harga, nama, pajak, modifier, dan HPP disalin ke baris order saat item masuk keranjang. Struk enam bulan lalu tetap akurat setelah harga naik tiga kali.

4. **Idempotency key wajib, di-generate klien.** Prasyarat mutlak untuk offline-first: antrean upload akan mengirim ulang request, dan tanpa token korelasi dari klien, server tidak bisa membedakan retry dari penjualan kedua yang identik.

5. **Isolasi tenant lewat PostgreSQL Row-Level Security.** `[FAKTA]` RLS menegakkan isolasi di level database, sehingga query aplikasi yang bermasalah pun tidak bisa membocorkan data lintas tenant — menghilangkan risiko `WHERE tenant_id` yang terlupakan.

---

## 3. Tech stack yang direkomendasikan

| Lapisan | Rekomendasi | Alasan singkat |
|---|---|---|
| Frontend | **React 19 + Vite (SPA)** | Terkunci oleh `/ds-bundle` — 21 komponen sudah React |
| Styling | **CSS custom properties + `components.css`** apa adanya | Design system sudah menetapkan seluruh nilai lewat token |
| Desktop | **Tauri 2** | `[FAKTA]` bundle 3–15 MB vs Electron 150+ MB; RAM 30–60 MB vs jauh lebih tinggi. Merender WebView → komponen `/ds-bundle` berjalan tanpa perubahan. Rust core memberi akses USB untuk printer |
| Mobile | Tauri 2 setelah prototipe; PWA sementara | Tauri mobile lebih baru — butuh validasi |
| DB lokal | **SQLite** (WASM+OPFS di web, native di Tauri) | Satu skema untuk semua platform; transaksi ACID lokal wajib untuk data finansial |
| Backend | **Node.js 22+ / TypeScript + Fastify** | Untuk satu pembangun, biaya dominan adalah perpindahan konteks, bukan CPU. Tipe domain dibagi literal antara server dan klien |
| API | **REST + OpenAPI spec-first** | Klien POS tidak bisa dipaksa update; server harus melayani banyak versi klien selama berbulan-bulan |
| Database | **PostgreSQL 17+** | `[FAKTA]` menyelesaikan beban transaksional kompleks 2× lebih cepat dari MySQL menurut TPC-C. Logical replication adalah prasyarat sync engine. RLS untuk multi-tenancy |
| Sync | **Hybrid**: PowerSync Open Edition (turun) + outbox sendiri (naik) | Bagian generik memakai kode teruji; jalur yang membawa uang sepenuhnya dikendalikan dan bisa di-debug |
| Auth | Buatan sendiri, modul terisolasi | Alur POS (PIN di perangkat bersama, step-up authorization) tidak dilayani IAM generik |
| Queue & cache | **PostgreSQL SKIP LOCKED · tanpa Redis di v1** | Setiap komponen infrastruktur dibayar dua kali: sekali di ops, sekali di paket on-premise |
| Hosting | Cloud regional Jakarta + Docker Compose | Latensi; unit deployment yang sama untuk SaaS dan on-premise |

**Yang secara sadar ditolak:** Flutter dan React Native (membuang 21 komponen `/ds-bundle`) · Electron (150+ MB di mini-PC outlet murah) · microservices (`[FAKTA]` ~42% organisasi yang mengadopsinya telah mengkonsolidasikan sebagian kembali) · tRPC (versioning lemah untuk klien yang tidak bisa dipaksa update) · CRDT (POS bukan aplikasi kolaboratif — dua kasir tidak mengedit objek yang sama).

---

## 4. Lima risiko terbesar

### Risiko 1 — Ambisi offline lintas device jauh lebih mahal dari yang diasumsikan

`[FAKTA]` **Toast tidak membagi order antar POS device saat offline**, bahkan pada mode "local sync" dengan hub device di LAN. Dokumentasi resmi mereka: *"orders sent from one POS device cannot be seen on another device unless it is a KDS device"*, dan mereka **merekomendasikan setiap karyawan memilih satu device** selama offline. Lightspeed memilih menjual appliance fisik daripada membangun mesh peer-to-peer. Tidak ada vendor besar yang membangun mesh.

**Artinya:** perusahaan dengan sumber daya jauh melampaui proyek ini menghadapi masalah yang sama dan menarik garis di tempat yang sama. Merencanakan untuk melampauinya adalah keputusan yang harus diambil sadar, bukan diasumsikan.

**Mitigasi:** v1 menerima batas — satu device = satu unit otonom penuh. Hub lokal untuk KDS ditargetkan v1.1 bersamaan dengan KDS itu sendiri. Batas ini **ditulis di materi penjualan**, bukan ditemukan merchant sendiri.

---

### Risiko 2 — Tiga ambisi yang biayanya saling mengalikan

Offline penuh lintas device **+** multi-tenant SaaS **+** paket on-premise: ketiganya masing-masing mahal, dan biayanya **berlipat, bukan bertambah** — setiap fitur offline harus diuji dalam konteks multi-tenant *dan* dalam konteks on-premise.

`[ASUMSI — estimasi]` On-premise saja: **8–14 minggu kerja awal + 15–25% overhead permanen pada setiap rilis**. Rentang waktu yang sama dengan membangun KDS + table management + hub lokal, yang melayani segmen yang sudah terbukti ada.

**Mitigasi:** kerjakan satu ambisi dengan sangat baik (offline single-device penuh). Siapkan arsitektur untuk on-premise (nol managed service proprietary, satu unit deploy, konfigurasi lewat env) tetapi **jangan bangun paketnya** sampai ada pelanggan yang membayar biaya implementasi di muka.

---

### Risiko 3 — Pajak Indonesia salah dimodelkan

`[FAKTA]` Makanan dan minuman yang disajikan restoran/kafe **tidak dikenai PPN** — melainkan **PBJT** (pajak daerah, tarif maksimal 10%, ditetapkan per kabupaten/kota lewat perda). Sementara barang retail dikenai PPN dengan tarif efektif 11%. Satu merchant dengan kafe di dua kota dan toko retail sudah menghadapi tiga konfigurasi pajak berbeda.

`[FAKTA]` Coretax menjadi wajib untuk seluruh administrasi perpajakan **mulai Juli 2026** — bulan yang sama dengan riset ini dilakukan. Status ini wajib diverifikasi ulang.

**Konsekuensi kalau salah:** ini bukan bug yang diperbaiki di rilis berikutnya. Merchant menghadapi masalah hukum, dan produk kehilangan kepercayaan secara permanen.

**Mitigasi:** `TaxRate` sebagai entitas (jenis, tarif, inklusif/eksklusif, yurisdiksi, masa berlaku), bukan kolom. Semua perhitungan pajak di satu modul — kemunculan `* 0.11` di mana pun dalam kode adalah bug arsitektural. Verifikasi status fiskal dengan konsultan pajak sebelum implementasi.

---

### Risiko 4 — Ketidakmungkinan mencegah oversell saat offline

Dua device offline yang menjual item terakhir akan **sama-sama berhasil**. Ini konsekuensi teorema CAP, bukan kekurangan implementasi, dan tidak bisa diperbaiki dengan arsitektur yang lebih baik.

**Mitigasi:** jangan janjikan pencegahan. Deteksi pasca-sinkronisasi, laporkan ke manajer dengan konteks (device mana, jam berapa), dan nyatakan sebagai non-goal di PRD dan materi penjualan. Merchant yang diberi tahu di muka bisa menerimanya; merchant yang menemukannya sendiri di hari tersibuk tidak.

---

### Risiko 5 — Bug sinkronisasi berarti uang merchant hilang

Kelas bug tersulit di seluruh sistem — reordering, duplikasi saat retry, clock skew, partial failure — dan konsekuensinya finansial, bukan kosmetik.

**Mitigasi:** `[FAKTA]` Deterministic Simulation Testing menjalankan sistem terdistribusi pada satu thread dengan seluruh keacakan dikendalikan, lalu menginjeksikan fault. Teknik ini dipakai FoundationDB, MongoDB, dan **TigerBeetle — database akuntansi finansial terdistribusi**, domain yang hampir identik. Bug yang ditemukan datang dengan seed yang mereproduksinya persis. Prasyaratnya harus diputuskan **sebelum menulis kode sinkronisasi**: waktu, keacakan, dan I/O di-inject sebagai dependensi.

---

## 5. Urutan build yang disarankan

| Fase | Isi | Mengapa urutan ini |
|---|---|---|
| **0. Fondasi** (2–3 mgg) | Skema PostgreSQL + RLS · SQLite lokal · test isolasi tenant · self-host font Inter · header COOP/COEP · `_adherence.oxlintrc.json` ke CI | RLS dan isolasi tenant harus benar sejak baris pertama — retrofitnya berarti mengaudit setiap query. Font dan header adalah prasyarat offline, bukan polish |
| **1. Inti transaksi** (4–6 mgg) | Katalog (Item→Variation→Modifier) · order lifecycle · payment multi-metode · pajak (PBJT/PPN) · diskon berotorisasi · append-only + idempotency | Ini yang membuat produk bisa disebut POS. Idempotency dan append-only harus ada **sebelum** sinkronisasi, bukan sesudah |
| **2. Offline** (5–8 mgg) | SQLite lokal · outbox + upload queue · replikasi turun · buka shift offline · refund offline · **harness DST** | Area risiko tertinggi. Dibangun setelah domain stabil agar invariant yang diuji sudah jelas |
| **3. Operasional harian** (3–4 mgg) | Shift & tutup kas · stock movement · RBAC & audit trail · laporan operasional · exception report | Melengkapi "buka toko pagi, jual, tutup buku malam" — definisi minimum produk yang bisa dijual |
| **4. Hardware** (2–3 mgg) | `PeripheralPort` · ESC/POS dengan profil printer sebagai data · printer network · cash drawer · scanner · halaman uji cetak | Setelah transaksi benar. Cetak adalah efek samping yang boleh gagal — penjualan disimpan lebih dulu, selalu |
| **5. Komersial** (2–3 mgg) | Tenant, paket, kuota · lisensi · onboarding · impor katalog dari kompetitor | Impor adalah fitur akuisisi, bukan utilitas admin |
| **6. Rilis** (2 mgg) | Staged rollout · jendela update · observability · runbook · alat koreksi data append-only | Alat koreksi dibangun **sebelum** insiden pertama, bukan sesudah |
| **— v1 —** | **±20–29 minggu** | |
| **v1.1** | KDS + hub lokal · table management · multi-outlet & transfer stok | Dibangun bersamaan karena semuanya butuh transport lokal-outlet yang sama |
| **v1.2** | Resep/BOM · loyalty · promo lanjutan | |
| **v1.3** | Purchasing & supplier · vertikal retail dirilis | Data model sudah siap sejak v1; yang dibangun hanya UI dan alur |
| **Bersyarat** | Integrasi aggregator · on-premise · mobile native | Ketiganya menunggu jawaban open question |

`[ASUMSI]` Estimasi waktu mengasumsikan satu pembangun dengan bantuan coding agent, bekerja penuh waktu. Angka ini **tidak** menyertakan waktu untuk penjualan, support, atau verifikasi open question — yang untuk solo builder sering memakan 30–40% waktu.

---

## 6. Yang secara sadar TIDAK masuk v1

Daftar ini sama pentingnya dengan yang masuk. Tanpa alasan tertulis, item-item ini akan kembali lewat scope creep.

| Dipotong | Alasan |
|---|---|
| Table management & KDS | Kafe takeaway — mayoritas segmen awal — beroperasi penuh tanpanya |
| Berbagi order antar POS device saat offline | Toast pun tidak; biaya 10–16 minggu dengan permukaan bug besar |
| Paket on-premise | 8–14 minggu + overhead permanen 15–25%, terhadap pendapatan nol |
| Resep/BOM | Butuh data master yang jarang siap di merchant baru |
| Purchasing & supplier | Dikelola merchant di WhatsApp/Excel; tidak menghalangi tutup buku harian |
| Loyalty | Table stakes kompetitif, bukan table stakes operasional |
| Integrasi GoFood/GrabFood/ShopeeFood | **Keputusan tertunda** — table stakes pasar tapi effort besar. Lihat OQ-06 |
| Integrasi EDC (ECR) | Butuh perangkat fisik, kontrak bank, dan sertifikasi — bergantung pihak eksternal |
| Timbangan terintegrasi | Fragmentasi protokol per merek; input manual sudah didukung |
| Mobile native | Tauri mobile butuh validasi prototipe lebih dulu |
| Pembayaran kartu di dalam POS | **Permanen** — menempatkan setiap tablet merchant di dalam PCI CDE |
| QRIS offline | **Mustahil secara teknis** — butuh konfirmasi issuer |

---

## 7. Tiga pertanyaan yang harus dijawab sebelum PRD

1. **Apakah ambisi "offline penuh lintas device" dipertahankan?** Bukti dari Toast menunjukkan biayanya jauh lebih besar dari yang biasanya diasumsikan, dan jawabannya menentukan bentuk seluruh lapisan sinkronisasi. *(OQ-01)*

2. **Bagaimana status kewajiban fiskal Indonesia pasca-Coretax, dan bagaimana perlakuan pajak dine-in versus takeaway?** Coretax menjadi wajib pada bulan riset ini dilakukan; salah menghitung pajak adalah masalah hukum merchant. *(OQ-04, OQ-05)*

3. **Integrasi GoFood/GrabFood/ShopeeFood masuk v1 atau tidak?** Ini muncul di paket Rp0 milik ESB — table stakes, bukan fitur premium. Proses persetujuan partner mungkin lebih lama daripada kodenya, artinya keputusannya harus diambil lebih awal daripada yang terasa perlu. *(OQ-06)*

Enam belas pertanyaan lengkap dengan cara menjawabnya ada di `12-OPEN-QUESTIONS.md`.

---

## 8. Peta dokumen

| File | Isi |
|---|---|
| `00-EXECUTIVE-BRIEF.md` | Dokumen ini |
| `01-COMPETITIVE-LANDSCAPE.md` | Kompetitor global & Indonesia, batas offline mereka, table stakes v1, celah pasar |
| `02-DOMAIN-FEATURE-MAP.md` | 17 area domain dengan prioritas, model katalog, analisis pola multi-vertikal |
| `03-TECH-STACK-EVALUATION.md` | Evaluasi per lapisan dengan minimal tiga kandidat dan trade-off |
| `04-ARCHITECTURE-PATTERNS.md` | Modular monolith, idempotency, append-only, double-entry, versioning katalog |
| `05-OFFLINE-SYNC-STRATEGY.md` | Area risiko tertinggi. Bukti lapangan Toast, strategi konflik, batas offline yang mengikat |
| `06-PAYMENTS-AND-FISCAL.md` | PBJT vs PPN, QRIS & MDR, Coretax, EDC, kesiapan global |
| `07-HARDWARE-INTEGRATION.md` | ESC/POS, batasan cetak per platform, cash drawer, harga hardware Indonesia |
| `08-SECURITY-AND-COMPLIANCE.md` | Strategi keluar dari PCI scope, threat model 12 ancaman, fraud kasir, UU PDP |
| `09-MULTITENANCY-DEPLOYMENT.md` | RLS, biaya sebenarnya dualisme SaaS/on-prem, lisensi & feature gating |
| `10-OPERATIONS-AND-QUALITY.md` | DST untuk sinkronisasi, observability perangkat, strategi rilis, migrasi, insiden |
| `11-BUSINESS-MODEL.md` | Pola pricing, harga pasar Indonesia, struktur tier, model biaya infrastruktur |
| `12-OPEN-QUESTIONS.md` | 16 pertanyaan untuk manusia, diurut berdasarkan dampak |
| `13-DECISION-LOG.md` | **Keputusan atas enam open question prioritas tertinggi** (OQ-01 s.d. OQ-06), beserta konsekuensinya pada cakupan v1 |
| `SOURCES.md` | Seluruh sumber dikelompokkan per topik dengan tanggal akses |

> **Catatan status per 27 Juli 2026:** enam open question prioritas tertinggi sudah diputuskan. Ringkasan dampaknya: KDS/table management/hub lokal keluar dari v1 · on-premise ditunda · PowerSync bebas dipakai untuk SaaS · aggregator masuk v1.1 dengan proses partner dimulai sekarang · estimasi v1 turun ke ±18–24 minggu. Detail di `13-DECISION-LOG.md`.

Setiap dokumen 02–11 diawali "Ringkasan Keputusan" (3–5 keputusan terpenting) dan diakhiri "Implikasi untuk dokumen pra-produksi" (apa yang harus masuk PRD, IA, ERD, dan technical architecture).

Keputusan arsitektural besar diberi nomor **KEP-01** sampai **KEP-39**, masing-masing dengan minimal tiga opsi, tabel trade-off, rekomendasi beralasan, kondisi peninjauan ulang, dan sumber.

---

## 9. Catatan tentang keterbatasan riset ini

Disampaikan agar pembaca bisa menilai bobot setiap bagian:

- **Harga POS Indonesia tidak transparan.** ESB, Majoo, dan Moka mencantumkan "Mulai dari" atau "Tanya Kami" untuk tier menengah ke atas. Angka untuk vendor lokal sebagian besar dari review pihak ketiga, bukan halaman resmi — perlakukan sebagai indikatif ±30%.
- **Kuota pencarian web habis di Fase 11.** Benchmark biaya cloud regional Jakarta dan benchmark churn/CAC vertical SaaS Indonesia **tidak terverifikasi**. Seluruh model biaya di `11-BUSINESS-MODEL.md` § 5 adalah `[ASUMSI]` terstruktur.
- **Tidak ada riset lapangan.** Semua temuan berasal dari desk research. Kemauan bayar, frekuensi outage nyata di segmen target, dan pola kerja kasir sesungguhnya **belum divalidasi dengan merchant**. Beberapa keputusan besar (terutama KEP-01, KEP-02, KEP-39) bergantung pada asumsi yang hanya bisa diuji dengan berbicara kepada merchant.
- **Tidak ada nasihat hukum atau pajak.** Semua interpretasi peraturan harus diverifikasi profesional sebelum diimplementasikan.
- **Clover dan DOKU tidak diriset mendalam.** Dampaknya terhadap keputusan arsitektur dinilai rendah; dicatat di `12-OPEN-QUESTIONS.md`.

---

*Paket riset pra-produksi Lumi POS · 27 Juli 2026*
