# 10 — Operasi, Kualitas, dan Rilis

> Fase 10 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Deterministic Simulation Testing (DST) adalah teknik yang tepat untuk lapisan sinkronisasi, dan ini bukan pilihan mewah.** `[FAKTA]` DST menjalankan beberapa sistem yang saling berkomunikasi dalam satu thread dengan seluruh keacakan dikendalikan, lalu melakukan property testing dengan injeksi fault. Teknik ini dipakai FoundationDB, MongoDB, dan TigerBeetle — sebuah database akuntansi finansial terdistribusi. Domain Lumi POS (uang + terdistribusi + offline) persis domain yang sama. (→ KEP-35)

2. **Rilis aplikasi kasir memiliki batasan yang tidak dimiliki software lain: ada jam di mana update dilarang.** Jam makan siang dan jam makan malam adalah waktu di mana outlet tidak boleh terganggu apa pun. Ini bukan preferensi — ini requirement yang membentuk seluruh strategi rilis. (→ KEP-36)

3. **Migrasi skema memakai expand-contract secara wajib untuk tabel bervolume tinggi.** `[FAKTA]` Pada tabel PostgreSQL 200 juta baris, `ALTER TABLE ADD COLUMN NOT NULL DEFAULT` yang memblokir bisa berjalan berjam-jam sambil memegang lock ACCESS EXCLUSIVE yang **memblokir setiap baca dan tulis** — bahkan `SELECT` menumpuk di antrean. Untuk POS, ini berarti seluruh merchant berhenti berjualan.

4. **Observability harus mencapai perangkat merchant, dan perangkat itu sering offline.** `[FAKTA]` OpenTelemetry Android menyertakan **disk persistence untuk mem-buffer data telemetry saat perangkat offline**, memastikan tidak ada data hilang saat jaringan putus. Ini pola yang harus diikuti: telemetry sendiri harus offline-first.

5. **Insiden "outlet tidak bisa berjualan" membutuhkan runbook yang berbeda dari insiden biasa** — karena kerugian merchant berjalan per menit dan mitigasi tercepatnya sering bukan memperbaiki sistem, melainkan memastikan merchant bisa terus jualan dengan cara lain. (→ Bagian 6)

---

## 1. Strategi pengujian untuk sistem finansial terdistribusi

`[FAKTA]` **Property-based testing** memungkinkan menulis lebih sedikit test yang lebih kuat dan tangguh dibanding pendekatan berbasis contoh, menghemat waktu developer dan menemukan bug pada skenario yang tidak terpikir untuk diuji secara langsung. Engine transaksi finansial seperti Formance termasuk sistem yang mendapat manfaat dari pendekatan ini.
`[FAKTA]` **Deterministic Simulation Testing (DST)** melibatkan penulisan kode sedemikian rupa sehingga aspek kacau dari sistem terdistribusi terisolasi selama pengujian — menjalankan beberapa sistem yang saling berkomunikasi **pada satu thread** dan mengendalikan seluruh keacakan di tiap sistem, lalu melakukan property testing terhadap versi single-threaded ini dengan **menginjeksikan fault yang mungkin terjadi di dunia nyata**.
`[FAKTA]` DST sangat efektif untuk menguji database terdistribusi (FoundationDB, MongoDB, TigerBeetle) dan engine transaksi finansial. **TigerBeetle** adalah database akuntansi finansial terdistribusi yang memakai simulation test terinspirasi Dropbox dan FoundationDB.
`[FAKTA]` DST sering dipasangkan dengan property-based testing/fuzzing dan fault injection.

*Sumber: [Deterministic simulation testing — how it works and when to use it — Antithesis Docs](https://antithesis.com/docs/resources/deterministic_simulation_testing/) · [Property-based testing — how it works and when to use it — Antithesis Docs](https://antithesis.com/docs/resources/property_based_testing/) · [What's the big deal about Deterministic Simulation Testing? — notes.eatonphil.com](https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html) · [Deterministic Simulation Testing for Our Entire SaaS — WarpStream](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas) · [Testing Distributed Systems — curated list (asatarin)](https://asatarin.github.io/testing-distributed-systems/) (semua diakses 27 Jul 2026)*

### KEP-35 — Strategi pengujian berlapis

**Pertanyaan:** Bagaimana satu pembangun memverifikasi bahwa sistem finansial offline-first tidak kehilangan atau menggandakan uang?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Unit test + integration test konvensional | Familiar; cepat ditulis; cukup untuk logika bisnis | Tidak akan pernah menemukan bug sinkronisasi. Skenario "device A offline 3 hari, jam mundur 2 menit, retry duplikat, storage penuh di tengah" tidak akan pernah ditulis sebagai test case oleh manusia | Logika domain deterministik |
| B. Konvensional + pengujian manual skenario offline | Menemukan masalah UX nyata | Tidak dapat diulang; tidak berskala; skenario kombinatorial tidak mungkin dijelajahi manual. Bug muncul di merchant, bukan di lab | Verifikasi akhir sebelum rilis |
| C. Berlapis: konvensional untuk domain + **property-based** untuk invariant finansial + **DST** untuk lapisan sinkronisasi | Menemukan kelas bug yang tidak bisa ditemukan cara lain. Bug yang ditemukan **dapat direproduksi** (seed deterministik) — ini yang membedakannya dari fuzzing biasa | Investasi awal untuk membangun harness simulasi. Butuh kode sync ditulis agar bisa dijalankan deterministik (I/O dan waktu di-inject, bukan dipanggil langsung) | Sistem finansial terdistribusi |

**Rekomendasi:** Opsi C, dengan cakupan DST **dibatasi ketat pada lapisan sinkronisasi**. `[INFERENSI]`

**Alasan:** Bug sinkronisasi di POS berarti uang merchant hilang atau tercatat dua kali, dan bug itu muncul dari kombinasi kondisi yang tidak akan ditulis manusia sebagai test case. TigerBeetle — sistem dengan domain yang hampir identik (akuntansi + terdistribusi) — memilih pendekatan ini, dan konvergensi domain ini adalah sinyal kuat. Yang membuat DST layak untuk satu orang adalah **reproduksibilitas**: bug yang ditemukan datang dengan seed yang mereproduksinya persis, sehingga debugging tidak menjadi arkeologi. Ini kebalikan dari pengujian manual, di mana bug offline yang muncul sekali sering tidak pernah bisa direproduksi.

**Yang membuat ini mungkin dan harus diputuskan di awal:** kode sinkronisasi harus ditulis dengan waktu, keacakan, dan I/O jaringan **di-inject sebagai dependensi**, bukan dipanggil langsung. Ini keputusan desain yang harus diambil sebelum menulis lapisan sync — retrofitnya mahal.

**Invariant yang harus diuji sebagai property** (bukan sebagai contoh):

| Invariant | Pernyataan |
|---|---|
| Konservasi uang | Untuk urutan operasi apa pun, `SUM(cash_movement)` = saldo laci terhitung |
| Tidak ada duplikasi | Untuk urutan retry apa pun, satu idempotency key menghasilkan tepat satu penjualan |
| Konvergensi | Untuk urutan sinkronisasi apa pun, semua device dan server akhirnya menyepakati himpunan transaksi yang sama |
| Immutabilitas | Tidak ada urutan operasi yang menghasilkan `UPDATE` pada transaksi selesai |
| Monotonisitas nomor | Untuk satu device dan satu hari, nomor struk selalu naik |
| Isolasi tenant | Untuk query apa pun dengan konteks tenant A, tidak ada baris tenant B yang terlihat |
| Konsistensi pajak | Total order selalu = jumlah baris + service charge + pajak + pembulatan |

**Fault yang harus diinjeksikan dalam simulasi:** jaringan putus di tengah upload · respons hilang setelah server sukses · duplikat request · request tiba tidak berurutan · jam device mundur/maju · storage penuh · aplikasi mati di tengah transaksi · dua device menjual item terakhir yang sama · sinkronisasi parsial (sebagian tabel berhasil).

---

## 2. Piramida pengujian yang direkomendasikan

`[INFERENSI]` Untuk satu pembangun dengan bantuan coding agent, alokasi effort yang realistis:

| Lapisan | Cakupan | Effort relatif | Alat |
|---|---|---|---|
| **Unit — logika uang & pajak** | Perhitungan total, diskon, service charge, pajak, pembulatan | Tinggi — **ini yang paling sering salah dan paling terlihat merchant** | Test biasa + property-based |
| **Unit — domain** | State machine order, otorisasi, kuota | Sedang | Test biasa |
| **Integration — database** | RLS/isolasi tenant, migrasi, transaksi atomik | Tinggi — kegagalan di sini eksistensial | Database nyata di container, bukan mock |
| **DST — sinkronisasi** | Semua invariant di atas dengan fault injection | Tinggi | Harness khusus |
| **Contract — API** | Kompatibilitas versi klien lama vs server baru | Sedang | Kontrak OpenAPI + test |
| **E2E — alur kasir** | Beberapa alur kritis saja: jual-bayar-cetak, void, tutup kas | Rendah–sedang; E2E rapuh dan mahal | Playwright pada aplikasi web |
| **Manual — hardware** | Cetak, laci, scanner pada perangkat nyata | Tidak bisa dihindari | Checklist perangkat |

`[INFERENSI]` **Yang sengaja tidak diprioritaskan:** cakupan E2E tinggi. Untuk POS, test E2E rapuh (bergantung UI yang sering berubah) dan lambat, sementara nilai deteksinya rendah dibanding lapisan lain. Lebih baik lima alur E2E yang selalu hijau daripada lima puluh yang sering merah karena alasan yang tidak berarti.

---

## 3. Observability di perangkat merchant

`[FAKTA]` OpenTelemetry Android menyediakan observability untuk aplikasi Android native dengan instrumentasi otomatis, real user monitoring (RUM), dan instrumentasi manual. **OpenTelemetry Android menyertakan disk persistence untuk mem-buffer data telemetry saat perangkat offline**, memastikan tidak ada data hilang selama gangguan jaringan.
`[FAKTA]` Untuk implementasi mobile: jaringan seluler putus, dan SDK harus mem-buffer dan me-retry dalam batas yang wajar.
`[FAKTA]` Untuk perangkat edge: konfigurasikan **persistent file-backed buffering** untuk menangani gangguan jaringan dengan baik, dan deploy lapisan gateway regional untuk mengagregasi, memperkaya, dan memfilter telemetry sebelum mencapai cloud.
`[FAKTA]` Sentry exporter pada OpenTelemetry Collector mengantre telemetry ketika Sentry sementara tidak tersedia, mengurangi kehilangan data selama outage singkat. Sentry mempropagasi header W3C Trace Context sehingga kedua sisi request muncul dalam satu distributed trace.

*Sumber: [Android — OpenTelemetry Documentation](https://opentelemetry.io/docs/platforms/client-apps/android/) · [How to Set Up Observability for IoT Edge Devices Using OpenTelemetry — OneUptime](https://oneuptime.com/blog/post/2026-02-06-observability-iot-edge-devices-opentelemetry/view) · [How to Configure OpenTelemetry for Edge Computing — OneUptime](https://oneuptime.com/blog/post/2026-01-25-opentelemetry-edge-computing/view) · [OpenTelemetry observability and distributed tracing — Sentry](https://sentry.io/solutions/opentelemetry/) (semua diakses 27 Jul 2026)*

### 3.1 Yang harus di-instrumen

`[INFERENSI]` Metrik yang menentukan kesehatan produk POS berbeda dari metrik web biasa:

| Metrik | Mengapa penting | Ambang alarm `[ASUMSI]` |
|---|---|---|
| **Umur antrean sinkronisasi tertua per device** | Metrik kesehatan #1. Antrean yang tua = uang merchant belum tercatat = risiko kehilangan | > 24 jam |
| Jumlah item gagal sinkron per device | Kegagalan permanen berbeda dari keterlambatan | > 0 selama > 1 jam |
| Rasio waktu offline per outlet | Merchant dengan internet buruk butuh perlakuan berbeda | > 20% jam operasional |
| Latensi p95 "tambah item ke keranjang" | Ini dirasakan kasir setiap detik | > 100 ms |
| Kegagalan cetak per device | Printer bermasalah = tiket support | > 5% percobaan |
| Deteksi oversell setelah sinkronisasi | Konsekuensi CAP yang harus terlihat | apa pun > 0 dilaporkan ke merchant |
| Selisih jam device vs server | Sinyal manipulasi (T12) dan sumber bug urutan | > 5 menit |
| Crash rate per versi aplikasi | Gate untuk melanjutkan rollout | > baseline versi sebelumnya |
| Versi aplikasi yang beredar | Untuk kebijakan dukungan versi | — |

`[INFERENSI]` **Prinsip yang membedakan observability POS:** telemetry sendiri harus offline-first, dengan buffer persisten di disk — sama seperti data transaksi. Dan telemetry **tidak boleh pernah** menghambat aplikasi: fire-and-forget dengan timeout pendek, dan kegagalannya tidak pernah terlihat kasir.

### 3.2 Batas etis

Dari Fase 9 (telemetry etis) dan Fase 8 (UU PDP): telemetry **tidak boleh** memuat nama produk, harga, nilai transaksi, data pelanggan, atau nama merchant. Yang dikirim adalah metrik dan tipe error, bukan isi. Error yang menyertakan payload harus melalui lapisan redaksi otomatis.

---

## 4. Strategi rilis untuk aplikasi kasir

### KEP-36 — Strategi rilis & update

**Pertanyaan:** Bagaimana update dikirim ke ratusan perangkat kasir di outlet yang tidak boleh berhenti berjualan?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Auto-update paksa saat tersedia | Semua merchant selalu di versi terbaru; permukaan dukungan sempit | **Update di jam makan siang menghentikan outlet.** Bug di versi baru menyebar ke semua merchant sekaligus | Aplikasi non-kritis |
| B. Update manual sepenuhnya oleh merchant | Merchant mengendalikan waktunya | Merchant tidak akan pernah update. Setelah setahun ada 8 versi di lapangan, semuanya harus di-support | Software enterprise dengan tim IT |
| C. **Staged rollout + jendela update yang menghormati jam operasional + kemampuan menunda terbatas** | Bug terdeteksi pada kelompok kecil sebelum menyebar. Merchant tidak terganggu di jam sibuk. Versi lapangan tetap terkendali | Kompleksitas: butuh cohort, feature flag, dan mekanisme jendela waktu | Aplikasi operasional kritis |

**Rekomendasi:** Opsi C. `[INFERENSI]`

**Alasan:** Ini satu-satunya opsi yang mengakui bahwa POS punya batasan waktu yang tidak dimiliki software lain. Merchant kafe tidak peduli fitur baru; mereka peduli bahwa jam 12:00–14:00 dan 18:00–21:00 tidak ada yang berubah. Sekaligus, opsi B terbukti gagal di praktik — merchant tidak akan pernah menekan tombol update, dan setelah setahun beban dukungan multi-versi menjadi tidak terkelola.

**Mekanisme konkret:**

| Elemen | Spesifikasi |
|---|---|
| **Jendela update** | Default 03:00–06:00 waktu lokal outlet; dapat dikonfigurasi merchant (outlet 24 jam butuh jendela lain) |
| **Staged rollout** | Kanari internal → 5% merchant → 25% → 100%, dengan jeda minimal 24 jam dan gate crash rate di tiap tahap |
| **Kemampuan menunda** | Merchant bisa menunda maksimal 2× (mis. 2 minggu); setelah itu update wajib pada jendela berikutnya |
| **Update wajib segera** | Hanya untuk perbaikan keamanan atau bug yang menyebabkan kehilangan data. Kategori ini harus jarang dan didefinisikan tertulis |
| **Rollback aplikasi** | Versi sebelumnya disimpan di perangkat; rollback tanpa jaringan harus mungkin |
| **Rollback skema lokal** | Migrasi SQLite lokal harus punya jalur mundur, atau perangkat harus bisa berjalan dengan skema lama saat aplikasi di-rollback |
| **Feature flag terpisah dari rilis** | Fitur berisiko dikirim dalam keadaan mati, dinyalakan per merchant. Memisahkan "deploy" dari "release" mengurangi risiko rilis secara signifikan |

`[INFERENSI]` **Yang paling sering dilupakan:** rollback aplikasi mudah; rollback **skema database lokal** hampir mustahil setelah data ditulis dengan skema baru. Konsekuensinya, setiap migrasi skema lokal harus **hanya aditif** (tambah tabel/kolom, jangan hapus/ubah tipe) sampai beberapa versi berlalu — pola expand-contract yang sama seperti server, diterapkan di perangkat.

---

## 5. Migrasi database tanpa downtime

`[FAKTA]` Pola **expand-contract** (disebut juga *parallel change*) adalah cara teraman melakukan perubahan skema yang tidak backward-compatible: **Expand** (tambah kolom baru dengan nama/tipe yang diinginkan) → **Backfill** (salin data dari kolom lama ke baru secara batch) → **Switch** (update kode aplikasi untuk membaca dan menulis kolom baru) → **Contract** (hapus kolom lama setelah tidak ada kode yang merujuknya).
`[FAKTA]` Alasan ini wajib untuk tabel besar: pada tabel PostgreSQL 200 juta baris, `ALTER TABLE ADD COLUMN NOT NULL DEFAULT` yang memblokir bisa berjalan **berjam-jam** sambil memegang lock **ACCESS EXCLUSIVE yang memblokir setiap baca dan tulis** pada tabel tersebut. Selama lock dipegang, bahkan query `SELECT` menumpuk di antrean tunggu.
`[FAKTA]` `ALTER TABLE` PostgreSQL tidak selalu terlihat berbahaya, tetapi beberapa operasi mengambil lock ACCESS EXCLUSIVE pada seluruh tabel.
`[FAKTA]` `CREATE INDEX CONCURRENTLY` menghindari lock yang memblokir penulisan — dengan konsekuensi berjalan di luar transaksi dan kadang perlu di-retry.
`[FAKTA]` Rekomendasi umum: untuk mayoritas aplikasi, **expand-contract ditambah lock timeout dan backfill ber-batch sudah cukup**. Tunggu satu siklus rollout penuh sebelum fase contract untuk memastikan tidak ada kode berjalan yang merujuk kolom lama.

*Sumber: [Zero-Downtime PostgreSQL Schema Migrations: Expand/Contract vs Blue-Green Deployment — DEV Community](https://dev.to/software_mvp-factory/zero-downtime-postgresql-schema-migrations-expandcontract-vs-blue-green-deployment-339o) · [Database Migrations in Production: Zero-Downtime Schema Changes (2026 Guide) — DEV Community](https://dev.to/young_gao/database-migrations-in-production-zero-downtime-schema-changes-5fng) · [Zero-Downtime PostgreSQL Migrations: Expand/Contract, Backfill and Rollback Strategies — Michal Drozd](https://www.michal-drozd.com/en/blog/zero-downtime-postgresql-migrations/) · [PostgreSQL Migration Best Practices for Zero-Downtime Deployments — DEV Community](https://dev.to/mickelsamuel/postgresql-migration-best-practices-for-zero-downtime-deployments-1c4) (semua diakses 27 Jul 2026)*

`[INFERENSI]` **Aturan migrasi yang harus ditegakkan sebagai kebijakan, bukan anjuran:**

| Aturan | Alasan |
|---|---|
| `lock_timeout` selalu di-set pada setiap migrasi | Migrasi yang tidak bisa mendapat lock **gagal cepat** alih-alih memblokir seluruh merchant. Ini satu baris yang mencegah insiden terburuk |
| `CREATE INDEX CONCURRENTLY` untuk semua index pada tabel produksi | Index biasa memblokir penulisan |
| Kolom baru selalu nullable atau dengan default yang tidak memicu rewrite | Menghindari lock panjang |
| Backfill ber-batch dengan jeda | Menghindari lonjakan I/O dan pertumbuhan WAL |
| Fase contract minimal satu rilis penuh setelah switch | Kode lama mungkin masih berjalan di suatu tempat |
| Tabel `stock_movement`, `audit_event`, `order_line` diperlakukan sebagai tabel besar sejak hari pertama | Ketiganya tumbuh paling cepat; memperlakukannya sebagai tabel kecil di awal berarti migrasi pertama yang menyakitkan datang tanpa peringatan |
| Partitioning by range (bulan) untuk tabel append-heavy | Direncanakan sejak awal; menambahkannya belakangan pada tabel besar sangat mahal |

---

## 6. Insiden: ketika outlet tidak bisa berjualan

`[INFERENSI]` Ini kelas insiden yang unik untuk POS dan membutuhkan penanganan berbeda. Kerugian merchant berjalan per menit dan bersifat permanen — pelanggan yang pergi tidak kembali.

### Klasifikasi severity

| Sev | Definisi | Contoh | Target respons |
|---|---|---|---|
| **SEV-1** | Merchant tidak bisa menyelesaikan penjualan | Aplikasi crash saat bayar; total salah dihitung; sinkronisasi menghapus transaksi | Segera, 24/7 |
| **SEV-2** | Merchant bisa berjualan tapi ada risiko kehilangan data | Antrean sinkronisasi macet; upload gagal berulang | < 2 jam pada jam kerja |
| **SEV-3** | Fungsi non-kritis rusak | Laporan salah, dashboard lambat, cetak logo rusak | Hari kerja berikutnya |
| **SEV-4** | Kosmetik | Salah ketik, alignment | Rilis berikutnya |

### Prinsip yang membedakan penanganan insiden POS

`[INFERENSI]`

1. **Mitigasi pertama bukan memperbaiki, melainkan memulihkan kemampuan berjualan.** Kalau sinkronisasi rusak, matikan sinkronisasi dan biarkan perangkat beroperasi offline penuh — merchant tetap jualan, data tetap aman di antrean. Perbaikan menyusul.
2. **Feature kill switch adalah kebutuhan operasional, bukan kemewahan.** Setiap fitur berisiko (sinkronisasi, integrasi pembayaran, integrasi aggregator) harus bisa dimatikan per merchant dari server tanpa rilis.
3. **Komunikasi ke merchant harus proaktif dan dalam Bahasa Indonesia yang operasional**, sesuai nada design system: "Sinkronisasi tertunda. Penjualan tetap tercatat di perangkat. Perkiraan pulih: 15:00." Bukan "kami mengalami degradasi layanan".
4. **Jangan pernah menyuruh merchant menginstal ulang aplikasi atau menghapus data sebagai langkah troubleshooting.** Pelajaran langsung dari daftar "jangan" milik Toast (Fase 5): itu menghapus transaksi yang belum tersinkron secara permanen. Ini harus tertulis di runbook support sebagai larangan.
5. **Postmortem untuk setiap SEV-1 dan SEV-2**, dengan fokus pada bagaimana bug lolos dari lapisan pengujian di bagian 1 — dan test baru ditambahkan ke lapisan yang seharusnya menangkapnya.

### Runbook minimum yang harus ada sebelum pelanggan pertama

| Skenario | Isi runbook |
|---|---|
| Antrean sinkronisasi macet di satu merchant | Cara diagnosis dari server, cara memicu ulang, cara ekspor antrean dari perangkat |
| Duplikasi transaksi terdeteksi | Cara mengidentifikasi, cara mengoreksi (entry pembalik, bukan delete), cara mencegah berulang |
| Database utama tidak responsif | Failover, restore, dan **pesan apa yang dikirim ke merchant** |
| Merchant melaporkan angka laporan salah | Urutan verifikasi: hitung ulang dari sumber, bandingkan, tentukan apakah data atau tampilan |
| Perangkat hilang/dicuri | Cabut kredensial, pemulihan data dari antrean terakhir, komunikasi ke merchant |
| Rilis buruk sudah menyebar | Prosedur rollback, cara mempercepatnya, cara menghentikan rollout |

---

## 7. Backup & disaster recovery

`[INFERENSI]` Target yang harus ditetapkan dan diuji, bukan diasumsikan:

| Parameter | Target `[ASUMSI]` | Catatan |
|---|---|---|
| **RPO** (data maksimum yang boleh hilang) | ≤ 5 menit | Point-in-time recovery via WAL archiving |
| **RTO** (waktu pulih) | ≤ 2 jam | Terukur dari latihan restore, bukan teori |
| Retensi backup | Harian 30 hari, mingguan 12 minggu, bulanan 7 tahun untuk data finansial | Sejalan kewajiban pembukuan |
| Enkripsi backup | Wajib, kunci terpisah dari produksi | Fase 8 |
| **Latihan restore** | Minimal kuartalan, tercatat waktunya | Backup yang tidak pernah di-restore bukan backup |
| Isolasi backup | Salinan di region/penyedia berbeda | Melindungi dari kegagalan akun/region |

`[INFERENSI]` **Keunggulan struktural offline-first yang jarang disadari:** perangkat kasir menyimpan salinan lokal transaksi. Jika server kehilangan data dalam jendela RPO, perangkat masih memilikinya. Ini bukan pengganti backup, tapi ia mengubah profil risiko secara nyata dan harus ada prosedur eksplisit: **rekonsiliasi ulang dari perangkat** setelah restore server, dengan idempotency key (KEP-16) memastikan transaksi yang sudah ada tidak terduplikasi. Retensi idempotency key 30 hari yang diputuskan di Fase 4 mendukung ini secara langsung.

---

## 8. Support tooling untuk produk komersial

`[INFERENSI]` Yang harus ada agar satu orang bisa men-support ratusan merchant:

| Alat | Fungsi | Prasyarat keamanan |
|---|---|---|
| **Konsol admin lintas tenant** | Melihat status merchant, perangkat, antrean, versi | Setiap akses tercatat; tidak menampilkan data transaksi detail secara default |
| **Impersonation berbatas waktu** | Melihat yang dilihat merchant untuk mendiagnosis | **Butuh persetujuan merchant**; berdurasi terbatas; sangat menonjol di UI bahwa sedang di-impersonate; tercatat penuh |
| **Paket diagnostik dari perangkat** | Satu tombol menghasilkan file berisi log tersanitasi, versi, konfigurasi, status antrean | Merchant memeriksa sebelum mengirim (Fase 9) |
| **Feature kill switch per merchant** | Mematikan fitur bermasalah tanpa rilis | Perubahan tercatat |
| **Dashboard kesehatan merchant** | Daftar merchant dengan antrean tua, error tinggi, versi lama | Proaktif — hubungi sebelum merchant komplain |
| **Alat koreksi data** | Menerapkan entry pembalik untuk memperbaiki data rusak | **Tidak pernah `UPDATE`/`DELETE` langsung.** Koreksi mengikuti aturan append-only yang sama seperti kasir |

`[INFERENSI]` Baris terakhir adalah aturan yang paling mudah dilanggar dan paling merusak: ketika ada insiden dan tekanan tinggi, godaan untuk "cepat perbaiki dengan UPDATE di database" sangat besar. Sekali dilakukan, audit trail merchant berbohong, dan tidak ada cara mengetahuinya kemudian. Alat koreksi resmi yang mengikuti aturan yang sama menghilangkan godaan itu.

---

## 9. Definition of Done untuk fitur yang menyentuh uang

`[INFERENSI]` Checklist yang harus dilewati sebelum fitur finansial apa pun dianggap selesai:

- [ ] Invariant finansial yang relevan diuji sebagai property, bukan hanya contoh
- [ ] Perilaku saat offline didefinisikan dan diuji (termasuk: apa yang terjadi jika perangkat mati di tengah)
- [ ] Idempotensi diuji dengan retry berulang dan respons yang hilang
- [ ] Isolasi tenant diuji
- [ ] Event audit dipancarkan dengan aktor, penyetuju, dan alasan
- [ ] Migrasi skema mengikuti expand-contract dengan `lock_timeout`
- [ ] Kompatibilitas dengan klien versi N-1 diverifikasi
- [ ] Perilaku saat kuota terlampaui didefinisikan (dan tidak menghentikan penjualan)
- [ ] Metrik dan alarm ditambahkan
- [ ] Empty state dan error state ada (aturan design system #9)
- [ ] Entri runbook dibuat jika fitur bisa gagal dengan cara yang terlihat merchant

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Jendela update dan kemampuan menunda adalah requirement produk yang terlihat merchant, bukan detail operasional — merchant memilih jendelanya di pengaturan.
- Kategori "update wajib segera" harus didefinisikan tertulis dan sempit, karena ini satu-satunya kondisi di mana Lumi POS boleh mengganggu operasional merchant.
- Notifikasi proaktif ke merchant saat antrean sinkronisasi menua adalah fitur, bukan hanya alert internal.
- Target RPO/RTO adalah komitmen yang muncul di SLA untuk tier atas dan harus disetujui secara sadar.

**Untuk Information Architecture:**
- Layar "Pembaruan" di pengaturan: versi saat ini, versi tersedia, jendela update, tombol tunda dengan sisa jatah.
- Konsol admin internal adalah aplikasi terpisah dengan IA sendiri — jangan dicampur ke aplikasi merchant.
- Dashboard kesehatan merchant (internal) adalah permukaan operasional yang harus dirancang, bukan kumpulan query ad-hoc.

**Untuk ERD:**
- `ReleaseChannel` / `TenantRolloutCohort` untuk staged rollout.
- `FeatureFlag` per tenant, terpisah dari `TenantQuota` (kuota = komersial, flag = operasional/kill switch).
- `SupportSession` untuk impersonation: `admin_user_id`, `tenant_id`, `granted_by`, `started_at`, `expires_at`, `reason`.
- Tabel bervolume tinggi (`stock_movement`, `audit_event`, `order_line`, `payment`) dirancang dengan partitioning by range sejak awal.
- `schema_migrations` menyimpan versi aplikasi dan waktu, untuk diagnosis instalasi yang tertinggal.

**Untuk Technical Architecture:**
- Lapisan sinkronisasi harus ditulis dengan waktu, keacakan, dan I/O di-inject agar DST mungkin. Ini keputusan desain yang harus diambil **sebelum** menulis kode sinkronisasi.
- Kebijakan migrasi (lock_timeout wajib, CONCURRENTLY wajib, expand-contract wajib, contract tertunda satu rilis) didokumentasikan sebagai aturan yang diperiksa di review.
- Kill switch per fitur per tenant adalah komponen arsitektur, bukan tambahan.
- Alat koreksi data yang append-only adalah komponen yang harus dibangun sebelum pelanggan pertama, bukan setelah insiden pertama.
- Migrasi skema SQLite lokal wajib aditif-saja sampai beberapa versi berlalu, mengikuti expand-contract yang sama seperti server.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `11-BUSINESS-MODEL.md`.*
