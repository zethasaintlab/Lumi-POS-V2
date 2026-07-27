# 09 — Multi-Tenancy & Strategi Deployment Hybrid

> Fase 9 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Shared database dengan PostgreSQL Row-Level Security, bukan database-per-tenant.** `[FAKTA]` RLS menegakkan isolasi di level database sehingga **query aplikasi yang bermasalah pun tidak bisa membocorkan data lintas tenant** — bahaya klasik `WHERE tenant_id` yang terlupakan hilang. RLS juga menang telak untuk perubahan skema, sementara schema-per-tenant harus melakukan loop ke semua skema. (→ KEP-32)

2. **Temuan penting tentang FSL yang mengubah penilaian risiko PowerSync:** `[FAKTA]` Functional Source License **menjadi open source Apache 2.0 setelah 2 tahun**. Sentry memakainya dengan larangan spesifik: pengguna dilarang menjual deployment self-hosted Sentry sebagai penawaran, dan dilarang menjadi kompetitor langsung Sentry. Ini melonggarkan kekhawatiran di Fase 3/5 secara substansial — tapi verifikasi teks lisensi tetap wajib. (→ Bagian 4)

3. **Rekomendasi paling tidak nyaman di seluruh riset: on-premise sebaiknya TIDAK ada di v1, v2, atau sampai ada pelanggan yang membayar di muka untuk itu.** Biayanya bukan "membangun installer" — biayanya adalah setiap fitur harus diuji dua kali, setiap dependensi harus punya padanan self-hosted, setiap bug pelanggan harus di-debug tanpa akses ke sistemnya, dan setiap rilis harus di-support di lima versi berbeda yang berjalan di lingkungan yang tidak dikendalikan. (→ KEP-33)

4. **Jika on-premise tetap dikerjakan, modelnya adalah single-tenant deployment dari codebase multi-tenant yang sama** — bukan varian produk. Tenant tetap ada sebagai konsep, hanya jumlahnya satu. Setiap penyimpangan dari ini menghasilkan dua produk.

5. **Feature gating komersial memakai lisensi bertandatangan yang diverifikasi offline**, bukan panggilan ke server lisensi. Outlet yang tidak bisa berjualan karena server lisensi Lumi POS sedang down adalah kegagalan yang tidak bisa dimaafkan merchant.

---

## 1. Model isolasi tenant

`[FAKTA]` **Database per tenant** — mengalokasikan database PostgreSQL yang sepenuhnya independen untuk setiap klien; standar emas mutlak untuk keamanan, kepatuhan, dan kustomisasi, tetapi dengan overhead sumber daya tertinggi. Digambarkan sebagai *"expensive, resource-intensive, and a nightmare to manage and migrate at scale."*

`[FAKTA]` **Schema per tenant** — mengelompokkan semua tenant dalam satu database PostgreSQL tetapi menempatkan tabel tiap tenant dalam namespace (schema) privat; jalan tengah yang seimbang untuk platform SaaS skala menengah. **Namun** masalah performa PostgreSQL bisa muncul dengan ribuan skema.

`[FAKTA]` **Shared database dengan Row-Level Security** — semua data tenant di tabel yang sama dengan kolom pengenal tenant, memakai RLS native PostgreSQL untuk memfilter baris yang tidak berwenang secara dinamis; **model paling hemat biaya dan paling berskala**.

`[FAKTA]` **Argumen keamanan yang menentukan:** bahaya klausa `WHERE tenant_id` yang hilang membocorkan data lintas tenant **dihilangkan oleh Row-Level Security di level database**. Kebijakan RLS menegakkan isolasi data di level database, memastikan bahwa **query aplikasi yang bermasalah pun tidak bisa membocorkan data lintas tenant**.

`[FAKTA]` **Performa dan operasi:** RLS menawarkan overhead operasional terendah dengan skema bersama untuk semua tenant dan sedikit lebih cepat karena satu B-tree index, sementara schema-per-tenant memiliki 1.000 index terpisah (lebih banyak overhead). **RLS menang telak untuk perubahan skema**, sedangkan schema-per-tenant mengharuskan loop ke seluruh skema.

`[FAKTA]` Panduan pemilihan: pilih Row-Level Security jika ada 10.000+ tenant (kekhawatiran batas skema), tenant seragam dalam ukuran dan perilaku, perubahan skema sering, dan optimasi biaya kritis.

*Sumber: [Multi-Tenant Database Isolation: Row-Level Security vs Schema-per-Tenant in PostgreSQL — Propelius](https://propelius.tech/blogs/multi-tenant-database-isolation-postgresql-rls-schema/) · [Designing for Multi-Tenancy: Scalable Data Isolation Patterns in PostgreSQL — DoHost](https://dohost.us/index.php/2026/06/12/designing-for-multi-tenancy-scalable-data-isolation-patterns-in-postgresql/) · [Multi-tenant data isolation with PostgreSQL Row Level Security — AWS Database Blog](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security) · [Mastering PostgreSQL Row-Level Security (RLS) for Rock-Solid Multi-Tenancy — Rico Fritzsche](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/) · [Multi-Tenant Architecture: Database Per Tenant vs Shared Schema — DEV Community](https://dev.to/young_gao/multi-tenant-architecture-database-per-tenant-vs-shared-schema-1n2e) (semua diakses 27 Jul 2026)*

### KEP-32 — Model isolasi tenant

**Pertanyaan:** Bagaimana data merchant diisolasi satu sama lain, mengingat kebocoran lintas tenant adalah kegagalan eksistensial dan produk juga harus bisa dikemas single-tenant?

**Opsi yang dipertimbangkan:**

| Opsi | Keamanan | Biaya | Kompleksitas operasional | Kemudahan jadi paket self-hosted |
|---|---|---|---|---|
| A. Database per tenant | Tertinggi — isolasi fisik. Backup/restore per tenant trivial. Kepatuhan mudah dijelaskan | Tertinggi — tiap database punya overhead koneksi dan memori. Ratusan tenant = ratusan database | **Terburuk** — migrasi skema harus dijalankan ratusan kali dan bisa gagal sebagian. Monitoring per database | **Terbaik** — self-hosted secara alami adalah satu database |
| B. Schema per tenant | Tinggi — namespace terpisah, tapi masih satu database dan satu koneksi user | Sedang | Buruk pada skala — `[FAKTA]` masalah performa dengan ribuan skema; migrasi harus loop semua skema | Baik |
| C. Shared tables + RLS | Tinggi — `[FAKTA]` ditegakkan database, kebal terhadap bug query aplikasi | **Terendah** — satu database, satu set index | **Terbaik** — satu migrasi untuk semua tenant | **Baik** — self-hosted = satu tenant di skema yang sama |

**Rekomendasi:** Opsi C — shared tables dengan RLS. `[INFERENSI]`

**Alasan:** Argumen yang menentukan bukan biaya melainkan **keamanan**, dan hasilnya berlawanan dengan intuisi. Isolasi fisik (opsi A) terasa lebih aman, tapi risiko kebocoran nyata untuk aplikasi seperti Lumi POS bukan penyerang yang menembus batas database — melainkan satu query di modul laporan yang lupa memfilter `tenant_id`. RLS mematikan kelas bug itu di level database, sementara opsi A dan B tetap rentan terhadapnya di dalam satu tenant yang salah dipilih. Ditambah, migrasi skema akan sering terjadi pada produk baru; opsi A membuat setiap migrasi menjadi operasi berisiko yang bisa gagal sebagian dan meninggalkan tenant dalam versi berbeda.

**Yang harus dilakukan dengan benar agar RLS tidak menjadi ilusi keamanan:**
- Aplikasi terhubung sebagai user database yang **tunduk pada RLS** (bukan superuser, bukan owner tabel yang secara default melewati RLS). Ini kesalahan paling umum dan membuat seluruh RLS tidak berfungsi tanpa gejala apa pun.
- `tenant_id` di-set per transaksi lewat `SET LOCAL app.tenant_id`, diikat ke konteks request, bukan dilewatkan sebagai parameter query.
- **Pengujian otomatis lintas tenant di CI**: buat dua tenant, coba akses data tenant A dengan konteks tenant B untuk setiap tabel, pastikan hasilnya kosong. Ini test yang harus ada sejak commit pertama, bukan ditambahkan setelah insiden.
- Kebijakan RLS ditulis untuk `SELECT`, `INSERT`, `UPDATE`, `DELETE` secara terpisah. Kebijakan yang hanya menutupi `SELECT` membiarkan penulisan lintas tenant.
- Isolasi tenant besar tetap mungkin nanti: tenant enterprise dapat dipindahkan ke database sendiri **tanpa mengubah kode** karena skemanya identik. Ini jalur keluar yang menjaga opsi A tetap tersedia untuk kasus yang benar-benar membutuhkannya.

**Kapan keputusan ini harus ditinjau ulang:** jika pelanggan enterprise mensyaratkan isolasi fisik sebagai syarat kontrak (umum di sektor yang diregulasi), pindahkan tenant tersebut ke database terpisah dengan skema yang sama — bukan mengubah model untuk semua tenant.

---

## 2. Dualisme SaaS + on-premise: biaya sebenarnya

`[FAKTA]` Solusi on-premise melibatkan biaya awal dan berkelanjutan yang tinggi, membutuhkan investasi pada hardware, infrastruktur, dan staf IT khusus, dengan maintenance intensif untuk menjaga sistem tetap ter-update, ter-patch, dan aman.
`[FAKTA]` Lingkungan yang berat di on-premise membutuhkan **entitlement management yang kokoh, logika rekonsiliasi kepatuhan, version tracking, dukungan audit, metering, dan visibilitas instalasi**.
`[FAKTA]` Pendekatan single-codebase yang berhasil: kontainerisasi memungkinkan satu badan kode dikelola di lingkungan yang berbeda; sebelum kontainerisasi, memelihara codebase terpisah untuk versi hosted dan on-prem akan rumit dan memakan waktu. **Flag adalah cara yang lebih ringan untuk mengatur perbedaan lingkungan** dibandingkan membebani kode dengan pemanggilan spesifik lingkungan.

*Sumber: [Packaging Your SaaS Application to Ship to Customers — Teleport](https://goteleport.com/blog/saas-to-onprem-considerations/) · [The True Cost of ITSM: On-Prem vs. SaaS — SolarWinds](https://www.solarwinds.com/blog/the-true-cost-of-itsm-on-prem-vs-saas) · [Mastering the Art of SaaS License Management — Reprise Software](https://reprisesoftware.com/post/mastering-the-art-of-saas-license-management-your-complete-guide) (semua diakses 27 Jul 2026)*

### KEP-33 — Apakah on-premise dikerjakan, dan kapan

Ini keputusan dengan konsekuensi terbesar di seluruh dokumen riset, dan rekomendasinya bertentangan dengan konteks produk yang diberikan. Disajikan dengan bukti dan angka.

**Pertanyaan:** Kapan opsi self-hosted/on-premise dibangun?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. On-premise sejak v1, sejajar dengan SaaS | Membuka segmen enterprise sejak awal; menjadi pembeda vs semua kompetitor Indonesia | Setiap fitur diuji dua kali. Setiap dependensi butuh padanan self-hosted. Debugging tanpa akses. Support multi-versi. **Melipatgandakan permukaan kerja pada saat basis pelanggan masih nol** | Ada pelanggan enterprise yang sudah berkomitmen |
| B. Arsitektur disiapkan untuk on-premise; **paketnya tidak dibangun** sampai ada pelanggan berbayar | Semua manfaat disiplin arsitektur (nol managed service proprietary, satu unit deploy, konfigurasi lewat env) tanpa biaya operasionalnya. Bisa dijanjikan dalam penjualan enterprise dengan syarat pembayaran di muka | Tidak bisa dijual sebagai "tersedia hari ini". Ada risiko arsitektur bergeser tanpa disadari karena tidak pernah diuji | Solo builder yang belum punya pelanggan enterprise |
| C. Tidak ada on-premise sama sekali | Fokus maksimum; bebas memakai managed service apa pun | Menutup segmen enterprise permanen; menyerah pada satu-satunya pembeda struktural vs Moka/ESB | SaaS murni |

**Rekomendasi:** Opsi B. `[INFERENSI]`

**Alasan:** Perbedaan antara A dan B bukan tentang arsitektur — arsitekturnya identik. Perbedaannya adalah apakah paket, installer, dokumentasi, jalur update, dan proses support-nya dibangun dan dipelihara. Yang terakhir inilah biaya sebenarnya, dan biaya itu berulang setiap rilis. Untuk satu pembangun tanpa pelanggan enterprise yang sudah berkomitmen, ini adalah biaya yang dibayar terhadap pendapatan nol.

Opsi B mempertahankan seluruh nilai strategisnya: dalam percakapan penjualan enterprise, "tersedia sebagai on-premise dengan biaya implementasi X, tersedia Y minggu setelah kontrak" adalah jawaban yang kredibel dan sekaligus memenuhi syarat calon pelanggan — jika mereka tidak bersedia membayar di muka, kebutuhan on-premise mereka tidak nyata.

**Disiplin arsitektur yang HARUS dijaga agar opsi B tetap valid** (ini yang membuatnya berbeda dari opsi C):

| Aturan | Alasan |
|---|---|
| Tidak ada managed service proprietary tanpa padanan self-hosted | Setiap pemakaian menambah cabang di paket on-prem. Sudah diputuskan di Fase 3 (tanpa managed queue, tanpa serverless proprietary) |
| Satu unit deployment (`docker-compose.yml`) yang sama untuk SaaS dan on-prem | Jika keduanya butuh topologi berbeda, arsitektur sudah bercabang |
| Seluruh konfigurasi lewat environment variable, tanpa hardcode host/region | Prasyarat portabilitas |
| Migrasi skema idempoten, bisa dijalankan berulang, aman untuk versi yang tertinggal jauh | Pelanggan on-prem akan melompat beberapa versi |
| Tidak ada asumsi bahwa server bisa menjangkau internet keluar | Beberapa lingkungan enterprise tertutup |
| Setiap komponen infrastruktur punya alasan tertulis mengapa ia ada | Menahan penambahan komponen yang tidak perlu |

**Kabar buruk yang harus dinyatakan dengan angka** `[ASUMSI — estimasi]`: membangun paket on-premise yang benar-benar bisa diserahkan ke pelanggan (installer, dokumentasi instalasi, jalur update, prosedur backup/restore, panduan troubleshooting, mekanisme lisensi, dan proses support tanpa akses sistem) adalah **8–14 minggu kerja awal**, ditambah **15–25% overhead permanen** pada setiap rilis berikutnya untuk pengujian dan dokumentasi dua target. Overhead permanen inilah yang membunuh — ia tidak pernah berakhir, dan ia dibayar dari waktu yang sama yang dipakai membangun fitur.

**Kapan keputusan ini harus ditinjau ulang:** saat ada pelanggan yang bersedia membayar biaya implementasi di muka yang menutupi minimal 8 minggu kerja, **atau** saat regulasi (mis. persyaratan kedaulatan data untuk sektor tertentu) membuat SaaS tidak memungkinkan bagi segmen yang cukup besar.

---

## 3. Menjalankan SaaS dan on-premise dari satu basis kode

Bagian ini menetapkan bagaimana Opsi B dijalankan jika/ketika on-premise diaktifkan.

### 3.1 Bentuk deployment

`[INFERENSI]` Prinsip inti: **on-premise adalah deployment single-tenant dari sistem multi-tenant yang sama** — bukan varian produk.

```
SaaS                              On-premise
────────────────────────          ────────────────────────
docker-compose.yml                docker-compose.yml   ← file yang sama
  api  (n instance)                 api  (1 instance)
  worker                            worker
  sync-service                      sync-service
  postgres (managed/dedicated)      postgres (container)
  caddy/nginx                       caddy/nginx

TENANT_MODE=multi                 TENANT_MODE=single
LICENSE=cloud                     LICENSE=<signed license file>
TELEMETRY=full                    TELEMETRY=minimal|off
```

Tenant tetap ada sebagai entitas dengan tepat satu baris. Semua kode berjalan pada jalur yang sama. Yang berbeda hanya konfigurasi. `[INFERENSI]` Godaan terbesar adalah menambahkan `if (isOnPrem)` untuk menyederhanakan sesuatu — setiap kemunculannya adalah awal dari dua produk dan harus ditolak di code review.

### 3.2 Strategi lisensi

`[FAKTA]` **Dua model yang kontras di industri:**
- **GitLab (open core)**: sebagian besar codebase adalah Community Edition berlisensi MIT, sementara fitur Enterprise Edition proprietary berada di monorepo yang sama di bawah lisensi source-available GitLab sendiri. Fitur governance enterprise di-gate ke tier berbayar — SSO, merge approval, dan tooling kepatuhan.
- **Sentry (Fair Source, tanpa open core)**: **"There should be no difference in features between Sentry's SaaS and self-hosted offerings (no open-core model)."** Sentry berada di bawah FSL — bukan di bawah payung OSI, tetapi **menjadi open source di bawah Apache 2.0 setelah 2 tahun**. Pengguna boleh memakai dan men-deploy Sentry di mana pun, tetapi **dilarang menjual deployment self-hosted Sentry sebagai penawaran apa pun** dan **dilarang menjadi kompetitor langsung Sentry** dengan memakai kode Sentry.

*Sumber: [Licensing — Sentry](https://open.sentry.io/licensing/) · [Self-Hosted Sentry — Sentry Developer Documentation](https://develop.sentry.dev/self-hosted/) · [Open Source vs Open Core: What's the Difference? — OneUptime](https://oneuptime.com/blog/post/2026-03-03-open-source-vs-open-core-whats-the-difference/view) · [GitLab: Open Core DevSecOps Alternative to GitHub — OpenTechHub](https://www.opentechhub.io/gitlab/) (semua diakses 27 Jul 2026)*

`[INFERENSI]` **Ini juga menyelesaikan sebagian kekhawatiran tentang PowerSync dari Fase 3 dan 5.** PowerSync memakai FSL yang sama dengan Sentry. Jika bentuk larangannya serupa — melarang menjual PowerSync itu sendiri dan melarang menjadi kompetitor langsung PowerSync — maka **menyertakan PowerSync sebagai komponen di dalam POS bukan pelanggaran**, karena POS bukan kompetitor sync engine. Ditambah konversi otomatis ke Apache 2.0 setelah 2 tahun, risikonya jauh lebih kecil dari yang tampak awalnya. **Namun verifikasi teks lisensi PowerSync yang sebenarnya tetap wajib** — kesimpulan ini berdasarkan analogi dengan Sentry, bukan pembacaan lisensi PowerSync. Tetap di `12-OPEN-QUESTIONS.md`, dengan tingkat kekhawatiran diturunkan dari kritis menjadi penting.

### KEP-34 — Mekanisme lisensi & feature gating

**Pertanyaan:** Bagaimana fitur tier berbayar ditegakkan, terutama di lingkungan on-premise yang tidak dikendalikan?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Pengecekan online ke server lisensi | Pencabutan instan; metering akurat; sulit dibypass | **Outlet berhenti berjualan kalau server lisensi down atau internet mati.** Bertentangan langsung dengan seluruh premis offline-first produk | Software yang boleh berhenti |
| B. File lisensi bertandatangan, diverifikasi offline, dengan masa berlaku | Bekerja sepenuhnya offline. Tanda tangan kriptografis sulit dipalsukan. Kedaluwarsa memaksa pembaruan berkala | Bisa dibypass oleh pihak yang bersedia memodifikasi biner. Pencabutan hanya berlaku saat pembaruan berikutnya | Software yang harus berjalan tanpa jaringan |
| C. Tanpa penegakan teknis — hanya kontrak | Nol kompleksitas; nol risiko outlet berhenti | Tidak ada penegakan sama sekali untuk on-premise | Pelanggan enterprise dengan hubungan kontraktual kuat |

**Rekomendasi:** Opsi B, dengan sikap yang **sengaja lunak terhadap kedaluwarsa**. `[INFERENSI]`

**Alasan:** Opsi A tidak tersedia — produk yang seluruh nilai jualnya adalah "tetap jualan saat internet mati" tidak boleh punya komponen yang membutuhkan internet untuk mengizinkan penjualan. Yang paling penting bukan pilihan opsinya, melainkan **perilaku saat lisensi kedaluwarsa**: penjualan **tidak pernah** dihentikan. Yang dinonaktifkan adalah fitur tier atas (laporan lanjutan, multi-outlet, integrasi), dengan peringatan yang jelas dan masa tenggang. Merchant yang tidak bisa berjualan karena masalah lisensi akan menceritakannya ke seluruh komunitasnya, dan kerusakan reputasinya jauh melampaui pendapatan yang diselamatkan.

**Struktur file lisensi:** `tenant_id` · `plan` · daftar fitur aktif · batas kuota (outlet, device, pengguna, produk) · `issued_at` · `expires_at` · tanda tangan Ed25519. Diverifikasi saat startup dan periodik, dengan public key tertanam di aplikasi.

**Yang di-gate dan yang tidak** `[INFERENSI]`: mengikuti prinsip Sentry lebih dari GitLab untuk kapabilitas inti — **tidak ada perbedaan fitur antara SaaS dan self-hosted pada tier yang sama**. Yang membedakan adalah tier komersial (Fase 11), bukan bentuk deployment. Alasannya praktis: perbedaan fitur antar bentuk deployment berarti dua matriks pengujian, dan matriks pengujian adalah biaya berulang terbesar dari dualisme ini.

---

## 4. Mekanisme update & migrasi skema di lingkungan pelanggan

`[INFERENSI]` Ini adalah bagian on-premise yang paling sering diremehkan dan paling sering merusak.

| Masalah | Penanganan |
|---|---|
| Pelanggan tertinggal 5 versi | Migrasi harus **berurutan dan idempoten**; setiap rilis menjalankan semua migrasi yang belum diterapkan. Tidak boleh ada migrasi yang mengasumsikan versi sebelumnya adalah versi terakhir |
| Migrasi gagal di tengah | Setiap migrasi dalam transaksi; kegagalan meninggalkan sistem di versi lama yang berfungsi, bukan di antara dua versi |
| Backup sebelum update | Update **menolak berjalan** tanpa backup yang berhasil diverifikasi. Bukan anjuran — penolakan |
| Downtime saat update | Migrasi expand-contract: tambah kolom baru → deploy kode yang menulis keduanya → backfill → deploy kode yang membaca baru → hapus kolom lama. Butuh disiplin di setiap perubahan skema |
| Rollback | Rollback database hampir selalu mustahil setelah data masuk. Yang realistis: restore dari backup. Ini harus dinyatakan, bukan dijanjikan sebagai fitur |
| Update tanpa akses internet | Paket update sebagai file yang bisa dipindahkan (tar image + skrip), bukan `docker pull` |
| Klien versi lama terhadap server versi baru | Kebijakan API versioning dari Fase 4 berlaku identik di on-premise |

---

## 5. Telemetry yang etis

`[INFERENSI]` Telemetry adalah titik di mana kepentingan vendor dan kepercayaan pelanggan paling mudah berbenturan, terutama untuk on-premise di mana pelanggan memilih self-hosted **justru** karena kendali data.

| Prinsip | Implementasi |
|---|---|
| **Opt-in untuk on-premise, opt-out untuk SaaS** | Pelanggan on-prem memilih self-hosted karena kendali; mengirim data tanpa persetujuan mengkhianati alasan mereka memilih |
| **Tidak pernah mengirim data bisnis** | Nama produk, harga, jumlah transaksi, data pelanggan, nama merchant — semua dilarang |
| **Yang boleh dikirim** | Versi aplikasi, jenis platform, jumlah error per tipe (tanpa isi), metrik performa agregat, fitur mana yang dipakai (hitungan, bukan isi) |
| **Dapat diperiksa** | Endpoint atau perintah yang menampilkan persis apa yang akan dikirim, sehingga pelanggan bisa memverifikasi sendiri |
| **Error reporting terpisah dari usage telemetry** | Dua keputusan berbeda dengan sensitivitas berbeda; jangan dibundel dalam satu toggle |
| **Kegagalan telemetry tidak pernah menghambat aplikasi** | Fire-and-forget dengan timeout pendek |

`[INFERENSI]` **Konsekuensi yang harus diterima:** merchant on-premise yang menolak telemetry berarti setiap bug mereka harus di-debug dari deskripsi verbal dan log yang mereka kirim manual. Ini biaya support nyata dan menjadi salah satu argumen di KEP-33 untuk menunda on-premise. Mitigasi yang membuatnya bisa ditanggung: **paket diagnostik yang di-generate lokal** — satu perintah yang mengumpulkan log tersanitasi, versi, konfigurasi (tanpa secret), dan status sistem ke dalam satu file yang pelanggan **periksa dan kirim sendiri**. Ini memberi kendali penuh sambil membuat support tetap mungkin.

---

## 6. Kuota & metering

`[INFERENSI]` Dari temuan Fase 1: lever monetisasi standar pasar Indonesia adalah **kuota** — jumlah produk, staff, laporan, outlet (Kasir Pintar membatasi 1.000 vs 10.000 produk dan 5 staff; ESB membatasi <30 vs 100+ laporan). Ini berarti sistem kuota bukan fitur billing yang bisa ditambahkan belakangan, melainkan bagian dari model tenant sejak awal.

| Dimensi kuota | Ditegakkan di mana | Perilaku saat terlampaui |
|---|---|---|
| Jumlah outlet | Server, saat membuat outlet | Tolak dengan pesan upgrade |
| Jumlah device aktif | Server, saat provisioning device | Tolak; tawarkan mencabut device lama |
| Jumlah pengguna | Server | Tolak |
| Jumlah produk | Server, saat membuat produk | Tolak |
| Volume transaksi | **Tidak ditegakkan** | Membatasi transaksi = menghentikan penjualan. Dipakai untuk metering/penagihan saja |
| Fitur (KDS, multi-outlet, laporan lanjutan) | File lisensi | Fitur tidak muncul; penjualan tetap jalan |

**Aturan mutlak:** tidak ada kuota yang boleh menghentikan penjualan. Semua penegakan terjadi pada operasi administratif (membuat outlet, menambah produk), tidak pernah pada alur kasir.

---

## 7. Biaya jangka panjang dualisme — dinyatakan jujur

`[ASUMSI — estimasi berdasarkan struktur pekerjaan, bukan pengukuran]`

| Area | Biaya sekali | Biaya berulang per rilis |
|---|---|---|
| Paket & installer | 3–4 minggu | Rendah setelah stabil |
| Dokumentasi instalasi & operasi | 2 minggu | 10–15% waktu dokumentasi |
| Mekanisme lisensi | 1–2 minggu | Rendah |
| Jalur update & migrasi yang aman untuk versi tertinggal | 2–3 minggu | **Sedang — setiap perubahan skema harus dipikirkan dua kali** |
| Matriks pengujian ganda | 1 minggu setup | **15–25% waktu QA setiap rilis** |
| Proses support tanpa akses sistem | 1 minggu | **Tinggi dan tidak terprediksi** |
| **Total awal** | **8–14 minggu** | **15–25% overhead permanen** |

**Untuk konteks:** 8–14 minggu adalah rentang waktu yang sama dengan membangun modul KDS + table management + hub lokal (Fase 5), yang melayani segmen target yang sudah terbukti ada. Perbandingan ini adalah inti argumen KEP-33.

Dan ketegangan yang harus dilihat bersama-sama: **Fase 5 sudah menyatakan bahwa offline penuh lintas device + multi-tenant SaaS + on-premise adalah tiga ambisi yang biayanya saling mengalikan.** Dokumen ini menambahkan angka pada ambisi ketiga. Rekomendasi gabungan dari kedua fase: **kerjakan satu ambisi dengan sangat baik (offline single-device), tunda dua lainnya dengan tanggal dan syarat yang eksplisit.**

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- On-premise dinyatakan sebagai **roadmap dengan syarat** (tersedia setelah kontrak enterprise dengan biaya implementasi di muka), bukan fitur v1. Ini menghindari janji yang membentuk ekspektasi penjualan yang salah.
- Perilaku saat lisensi kedaluwarsa adalah requirement produk: **penjualan tidak pernah berhenti**; hanya fitur tier atas yang dinonaktifkan dengan masa tenggang.
- Kuota per tier (outlet, device, pengguna, produk) masuk PRD sebagai bagian dari definisi paket, dengan aturan bahwa kuota tidak pernah menghambat transaksi.
- Kebijakan telemetry (opt-in on-prem, opt-out SaaS, daftar data yang dikirim) adalah komitmen yang harus tertulis dan dapat diperiksa pelanggan.

**Untuk Information Architecture:**
- Layar "Langganan & Batas" di tingkat tenant: paket aktif, pemakaian versus kuota, tanggal berakhir, riwayat tagihan.
- Untuk on-premise: layar "Lisensi" yang menampilkan isi lisensi, masa berlaku, dan cara memperbarui — plus perintah/tombol "Buat paket diagnostik".
- Peringatan kuota mendekati batas harus muncul di dashboard owner, bukan hanya saat operasi ditolak.

**Untuk ERD:**
- `Tenant`: `id`, `name`, `plan`, `status`, `created_at`, `suspended_at`, `deployment_mode` (`cloud` | `self_hosted`).
- `TenantQuota` atau kolom kuota pada `Tenant`: `max_outlets`, `max_devices`, `max_users`, `max_products`, `features` (jsonb).
- **Setiap tabel** memiliki `tenant_id` dengan kebijakan RLS untuk keempat operasi (SELECT/INSERT/UPDATE/DELETE).
- `UsageMetric` untuk metering: `tenant_id`, `period`, `metric`, `value` — untuk penagihan berbasis pemakaian dan untuk menunjukkan pemakaian versus kuota.
- Tabel migrasi (`schema_migrations`) harus menyimpan versi aplikasi, bukan hanya nomor migrasi — untuk mendiagnosis instalasi on-prem yang tertinggal.

**Untuk Technical Architecture:**
- Koneksi database aplikasi **wajib** memakai user yang tunduk pada RLS. Ini didokumentasikan sebagai kontrol keamanan kritis dengan verifikasi otomatis (test yang gagal jika user aplikasi bisa melewati RLS).
- Pengujian isolasi lintas tenant sebagai gate CI wajib.
- Aturan "tidak ada `if (isOnPrem)` di kode aplikasi" ditetapkan sebagai invariant; perbedaan lingkungan hanya lewat konfigurasi.
- Setiap komponen di `docker-compose.yml` harus punya justifikasi tertulis. Daftar ini menjadi kontrol terhadap penambahan komponen yang tidak perlu.
- Strategi migrasi expand-contract didokumentasikan sebagai satu-satunya pola perubahan skema yang diizinkan untuk tabel bervolume tinggi.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `10-OPERATIONS-AND-QUALITY.md`.*
