# 03 — Evaluasi Tech Stack

> Fase 3 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Design system menghilangkan sebagian besar ruang pilihan sebelum evaluasi dimulai.** `/ds-bundle` berisi 21 komponen React (`.jsx`) yang memancarkan className dari `components.css`, dengan seluruh nilai visual di CSS custom properties. Ini bukan preferensi — ini aset yang sudah final. Konsekuensinya: **Flutter, SwiftUI, Jetpack Compose, dan native Android/iOS tereliminasi** karena memakainya berarti menulis ulang seluruh lapisan komponen. Yang tersisa adalah keluarga React yang merender ke DOM. (→ Bagian 1)

2. **TypeScript end-to-end, bukan karena "modern", tapi karena solo builder tidak mampu membayar dua ekosistem.** Rekomendasi: Node.js + TypeScript di backend, React di web, React + wrapper native di mobile/desktop. Trade-off yang dibayar (performa runtime lebih rendah dari Go, memory footprint lebih besar) diukur dan dinyatakan, bukan disembunyikan. (→ KEP-08)

3. **PostgreSQL sebagai database utama, tanpa keraguan.** Untuk sistem finansial, ketatnya kepatuhan ACID dan model MVCC lebih menentukan daripada selisih 10–20% throughput pada benchmark sintetis. PostgreSQL juga satu-satunya database yang didukung penuh oleh semua kandidat sync engine. (→ KEP-09)

4. **SQLite di klien, di semua platform, lewat satu API.** SQLite WASM+OPFS di browser, SQLite native di desktop dan mobile. Ini satu-satunya cara memiliki *satu* skema lokal dan *satu* set query untuk tiga platform. (→ KEP-10)

5. **Sync engine: PowerSync Open Edition sebagai kandidat utama, dengan kewaspadaan lisensi yang dinyatakan terbuka.** Open Edition gratis dan self-hostable di bawah Functional Source License (bukan OSI open source), client SDK di bawah Apache-2.0. Ini menyelesaikan masalah tersulit produk, tapi memasang ketergantungan pada vendor tunggal dengan lisensi non-standar. Keputusan penuh dibahas di Fase 5 (KEP-22); di sini hanya evaluasi teknisnya. (→ KEP-13)

---

## 0. Constraint dari `/ds-bundle` — filter yang dipakai di seluruh dokumen

Dibaca di Fase 0. Yang mengikat evaluasi teknis:

| Constraint | Sumber | Konsekuensi teknis |
|---|---|---|
| 21 komponen React sebagai `.jsx` + `.d.ts` di `components/` | `readme.md` § Komponen | Lapisan UI harus React yang merender DOM |
| Semua styling lewat CSS custom properties di `tokens/*.css`; komponen tidak boleh punya nilai warna/ukuran | `readme.md` § ATURAN YANG MENGIKAT #6 | Styling approach harus mendukung CSS variables natif. CSS-in-JS runtime yang menghasilkan nilai literal melanggar aturan ini |
| `styles.css` sebagai entry tunggal yang meng-`@import` seluruh token + lapisan kelas | `readme.md` § Index/manifest | Build tool harus menangani CSS `@import` — bukan hambatan, tapi mengecualikan pendekatan yang memaksa CSS-in-JS |
| `tailwind.tokens.ts` ada sebagai pemetaan token → Tailwind theme, "referensi konsumen React/Vite" | `readme.md` § Sumber | Tailwind **kompatibel dan sudah dipetakan**, tapi opsional — lapisan kelas `components.css` sudah mandiri |
| Inter dimuat dari Google Fonts via `@import` di `tokens/fonts.css` | `readme.md` § Fonts | **Masalah offline.** Aplikasi offline-first tidak boleh bergantung pada CDN font. Font wajib di-self-host |
| Web-based responsive, satu codebase untuk 1024×768 (tablet kasir), 1920×1080 (KDS), 390×844 (HP owner) | `readme.md` § pembuka | Satu aplikasi web responsif, bukan tiga aplikasi |
| Offline-first: setiap komponen punya state tersinkron/mengantre-sync/gagal-sync | `readme.md` § pembuka | Lapisan data klien harus mengekspos status sinkronisasi per-record, bukan hanya global online/offline |

`[INFERENSI]` Baris terakhir adalah yang paling sering diremehkan. Design system menuntut UI bisa menampilkan *"Offline · 3 menunggu"* dan *"Gagal kirim (2) · Coba lagi"*. Itu berarti sync engine yang dipilih harus mengekspos antrean tulis beserta status per-item ke lapisan UI. Sync engine yang hanya menyediakan boolean `isOnline` **tidak memenuhi kebutuhan** dan akan memaksa penulisan lapisan pelacakan sendiri.

**Masalah font — konkret dan harus diselesaikan:** `tokens/fonts.css` melakukan `@import` ke Google Fonts. Pada tablet kasir yang boot tanpa internet, `@import` gagal, font fallback ke `system-ui`, dan **`tabular-nums` tidak dijamin ada** — kolom angka uang akan bergoyang, melanggar ATURAN MENGIKAT #4. Perbaikan: self-host Inter (readme sendiri menyebut sumbernya, rsms.me/inter) dan ganti `@import` dengan `@font-face` lokal. Ini perubahan satu file dan tidak mengubah desain visual, jadi tidak melanggar batasan "jangan mengubah design system".

---

## 1. Lapisan UI web — framework

| Kandidat | Kematangan | Performa untuk beban POS | Ekosistem | Hiring/maintenance | Kompatibilitas `/ds-bundle` |
|---|---|---|---|---|---|
| **React 19** | Sangat matang; standar de facto | Cukup. Grid 200 produk dengan virtualisasi tidak bermasalah | Terbesar; semua library POS-relevan tersedia | Pool developer terbesar di Indonesia | **Native — komponen sudah React** |
| **Vue 3** | Matang | Sedikit lebih baik pada re-render granular | Besar tapi lebih kecil dari React | Pool bagus di Indonesia | Butuh **port 21 komponen** |
| **Svelte 5** | Matang, adopsi tumbuh | Terbaik dari ketiganya (tanpa VDOM, bundle terkecil) | Terkecil; beberapa library POS-relevan absen | Pool kecil di Indonesia | Butuh **port 21 komponen** |
| **Solid** | Cukup matang | Sangat baik | Kecil | Sangat kecil | Butuh port |

**Rekomendasi: React.** Bukan karena unggul secara teknis — Svelte lebih cepat dan lebih ringan — tapi karena `/ds-bundle` sudah React dan porting 21 komponen adalah pekerjaan berminggu-minggu tanpa nilai fungsional apa pun. `[INFERENSI]`

**Meta-framework:** `[INFERENSI]` **Vite + React Router (SPA), bukan Next.js.** Alasan: aplikasi kasir adalah SPA yang berjalan offline; SSR tidak memberi nilai apa pun dan menambah runtime server yang harus ikut dikemas untuk self-hosted. Halaman marketing/landing (yang ada di `ui_kits/rekanara/LandingScreen.jsx`) adalah artefak terpisah dan bisa dibuat statis. Next.js masuk akal hanya jika landing page dan aplikasi harus satu proyek — dan mereka tidak harus.

---

## 2. Styling & component layer

| Kandidat | Kekuatan | Kelemahan | Kompatibilitas `/ds-bundle` |
|---|---|---|---|
| **CSS murni + custom properties (`components.css` apa adanya)** | Persis yang sudah ada; nol konversi; nol runtime; token adalah sumber kebenaran tunggal | Tidak ada scoping otomatis; disiplin penamaan manual | **Sempurna — ini yang dipakai design system** |
| **Tailwind + `tailwind.tokens.ts`** | Pemetaan sudah disediakan design system; DX cepat; purging menghasilkan CSS kecil | Menduplikasi lapisan kelas yang sudah ada; risiko developer menulis `text-[13px]` yang melanggar aturan 4-ukuran | Kompatibel — pemetaan sudah ada |
| **CSS-in-JS runtime (styled-components, Emotion)** | Scoping otomatis; props-driven styling | Runtime cost pada setiap render; sulit menjaga aturan "tidak ada nilai di komponen"; menghambat SSR/streaming | **Bertentangan dengan ATURAN MENGIKAT #6** |

**Rekomendasi: CSS murni + custom properties, persis seperti `components.css`.** Tailwind ditambahkan **hanya** untuk utilitas layout (flex, grid, gap) jika terasa perlu, dengan konfigurasi yang **melarang** nilai arbitrer (`arbitraryValues: false` atau ekuivalen) agar aturan 4-ukuran teks tidak bisa dilanggar. `[INFERENSI]`

`[FAKTA]` Design system sudah menyertakan `_adherence.oxlintrc.json` (14 KB) — konfigurasi linter untuk menegakkan kepatuhan. `[INFERENSI]` Ini harus masuk pipeline CI sejak commit pertama, bukan ditambahkan belakangan. Penegakan otomatis adalah satu-satunya cara aturan design system bertahan lebih dari tiga bulan.

---

## 3. Bahasa & runtime backend

| Kandidat | Kematangan | Performa POS | Ekosistem | Hiring (Indonesia) | Biaya ops kecil | Biaya ops besar | Kemudahan on-premise |
|---|---|---|---|---|---|---|---|
| **Node.js + TypeScript** | Sangat matang | Cukup untuk beban POS (I/O-bound, bukan CPU-bound) | Terbesar | Pool terbesar; tumpang tindih penuh dengan frontend | Sedang | Sedang–tinggi (memory) | Sedang — butuh Node runtime, bisa di-bundle |
| **Go** | Sangat matang | Terbaik. `[FAKTA]` HTTP server Go idle ~10–30 MB RAM vs ratusan MB untuk Java/.NET setara | Baik, lebih kecil dari Node | Pool kecil di Indonesia | Terendah | Terendah | **Terbaik — single static binary, Docker opsional** |
| **.NET 9 / ASP.NET Core** | Sangat matang | Sangat baik | Besar | Pool sedang | Sedang | Rendah | Baik — `[FAKTA]` single-file deployment tersedia, tapi ukuran file besar karena menyertakan runtime |
| **Java/Kotlin + Spring** | Sangat matang | Sangat baik | Terbesar di enterprise | Pool sedang | Tinggi (JVM) | Rendah | Sedang |

`[FAKTA]` Model deployment Go lebih sederhana dari kebanyakan runtime: tidak ada interpreter, tidak ada dependency tree yang harus di-install di server, tidak ada virtual environment. Go mengompilasi ke satu binary statis tanpa runtime dependency.
`[FAKTA]` Node.js menuntut tim merakit stack sendiri — memilih antara Express/NestJS/Fastify, memilih ORM, dan mendefinisikan konvensi arsitektur dari nol. Tim melaporkan menghabiskan porsi signifikan waktu development awal untuk keputusan tooling dan arsitektur, bukan pengiriman fitur.
`[FAKTA]` Rekomendasi umum 2026: untuk startup dan tim full-stack TypeScript, pilih Node.js + NestJS atau Fastify; untuk greenfield SaaS dengan tim senior campuran, keduanya bekerja — pilih berdasarkan preferensi tim.

*Sumber: [Go runs as a single binary — Fly.io](https://fly.io/learn/golang-hosting/) · [Create a single file for application deployment — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview) · [Best Backend Frameworks for 2026 — Coderio](https://www.coderio.com/blog/software-development/best-backend-frameworks-2026/) · [Best Node.js Frameworks in 2026: Express vs Fastify vs NestJS vs Hono — HireNodeJS](https://www.hirenodejs.com/blog/nodejs-frameworks-compared-2026) (semua diakses 27 Jul 2026)*

### KEP-08 — Bahasa & runtime backend

**Pertanyaan:** Bahasa apa yang dipakai backend, mengingat pembangunnya satu orang dengan bantuan coding agent, dan produk harus bisa dikemas untuk on-premise?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Node.js + TypeScript | Satu bahasa untuk backend, web, mobile, desktop, dan tipe yang dibagikan lintas batas. Konteks kognitif tunggal — nilai terbesar untuk solo builder. Ekosistem terbesar | Memory footprint lebih besar; performa CPU-bound lebih rendah; on-premise butuh Node runtime ikut dikemas | Solo builder / tim kecil dengan TypeScript di frontend |
| B. Go | Single static binary → paket on-premise paling bersih. Memory terendah, biaya infra terendah pada skala. Konkurensi bagus untuk sync fan-out | Dua bahasa, dua ekosistem, dua set konvensi untuk satu orang. Pool hiring Indonesia kecil. Tidak bisa berbagi tipe dengan klien tanpa codegen | Beban tinggi, tim yang nyaman dengan dua bahasa, on-premise sebagai prioritas #1 |
| C. .NET 9 | Performa sangat baik, tooling matang, single-file deployment tersedia | Ketiga bahasa berbeda dari frontend; ekosistem POS/sync-engine lebih tipis; komunitas Indonesia lebih kecil dari Node | Tim dengan latar Microsoft |

**Rekomendasi:** Opsi A — Node.js + TypeScript, dengan Fastify sebagai HTTP layer. `[INFERENSI]`

**Alasan:** Untuk satu orang, biaya dominan bukan biaya CPU melainkan biaya perpindahan konteks. Berbagi tipe domain (Order, Payment, StockMovement) secara literal antara server, aplikasi kasir, dan aplikasi desktop menghilangkan seluruh kelas bug integrasi — dan bug integrasi di sistem finansial adalah yang paling mahal. Beban POS bersifat I/O-bound (query database, panggilan gateway pembayaran), bukan CPU-bound, sehingga keunggulan Go tidak terpakai pada skala target. Fastify dipilih daripada NestJS karena NestJS membawa banyak konvensi dan boilerplate yang berharga untuk tim besar tapi menjadi beban untuk satu orang; Express dihindari karena performa dan penanganan async-nya lebih lemah.

**Yang dibayar, dinyatakan langsung:** paket on-premise akan berukuran ~50–120 MB (Node runtime + node_modules terkompilasi) versus ~15–25 MB untuk Go. Memory per instance ~150–250 MB versus ~30 MB. Pada 100 tenant self-hosted ini tidak berarti apa-apa; pada SaaS dengan 10.000 tenant ini berarti tagihan infra 3–5× lebih tinggi dibanding Go. Angka pastinya dimodelkan di Fase 11.

**Kapan keputusan ini harus ditinjau ulang:** jika profiling produksi menunjukkan endpoint sinkronisasi menjadi CPU-bound (bukan I/O-bound) — kemungkinan terjadi jika logika resolusi konflik kompleks dijalankan di server untuk ribuan device — pindahkan **hanya service sinkronisasi** ke Go, bukan seluruh backend. Arsitektur modular monolith (Fase 4) harus menjaga kemungkinan ini tetap terbuka.

**Sumber:** [Best Node.js Frameworks in 2026 — HireNodeJS](https://www.hirenodejs.com/blog/nodejs-frameworks-compared-2026) (27 Jul 2026) · [Go runs as a single binary — Fly.io](https://fly.io/learn/golang-hosting/) (27 Jul 2026) · [Best Backend Frameworks for 2026 — Coderio](https://www.coderio.com/blog/software-development/best-backend-frameworks-2026/) (27 Jul 2026)

---

## 4. Framework API & gaya kontrak

`[FAKTA]` tRPC ditujukan untuk API internal dalam monorepo TypeScript atau aplikasi full-stack, dan **sebaiknya dihindari untuk API publik** atau kasus dengan tim yang bekerja dalam beberapa bahasa. Jika tRPC dipakai sebagai API publik, versinya harus dikunci dan permukaan REST/GraphQL terpisah harus diterbitkan.
`[FAKTA]` OpenAPI memakai semantic versioning pada kontrak dengan deprecation ditandai di skema dan permukaan `/v1`, `/v2` paralel bila perlu — **lebih aman untuk permukaan multi-tahun, multi-klien**. Platform yang menstandarkan OpenAPI dengan SDK yang di-generate melihat tiket support tentang field yang hilang turun tajam setelah menambahkan contract test.
`[FAKTA]` tRPC biasanya melakukan versioning di level router atau lewat feature flag.

*Sumber: [When to use GraphQL vs Federation vs tRPC vs REST vs gRPC — WunderGraph](https://wundergraph.com/blog/graphql-vs-federation-vs-trpc-vs-rest-vs-grpc-vs-asyncapi-vs-webhooks) · [tRPC vs GraphQL vs REST — SD Times](https://sdtimes.com/graphql/trpc-vs-graphql-vs-rest-choosing-the-right-api-design-for-modern-web-applications/) · [Ship Faster with Type-Safe APIs: tRPC vs OpenAPI — Medium](https://medium.com/@Modexa/ship-faster-with-type-safe-apis-trpc-vs-openapi-9aa977b4331b) (semua diakses 27 Jul 2026)*

### KEP-09 — Gaya kontrak API

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. tRPC | Type safety end-to-end tanpa codegen; kecepatan development tertinggi untuk monorepo TS | Tidak cocok untuk API publik; klien non-TS mustahil; **versioning lemah** — masalah serius untuk aplikasi kasir yang tidak bisa dipaksa update di jam sibuk | Aplikasi internal, klien terkendali penuh |
| B. REST + OpenAPI (spec-first) | Versioning eksplisit; SDK multi-bahasa; contract test; mudah dipahami integrator pihak ketiga (aggregator, akuntansi) | Codegen sebagai langkah build; lebih banyak boilerplate | Produk komersial dengan klien versi-campur dan integrasi eksternal |
| C. GraphQL | Klien memilih field yang dibutuhkan; satu endpoint | Kompleksitas caching dan rate-limiting; overkill untuk domain dengan bentuk query yang sudah dikenal; N+1 mudah tanpa disiplin | Banyak klien dengan kebutuhan data sangat berbeda |

**Rekomendasi:** Opsi B — REST + OpenAPI spec-first, dengan generator tipe TypeScript sehingga klien tetap type-safe. `[INFERENSI]`

**Alasan:** Aplikasi kasir yang sudah terpasang di merchant tidak bisa dipaksa update — memaksa update di jam makan siang berarti outlet berhenti jualan. Artinya server **harus** melayani beberapa versi klien secara bersamaan untuk waktu yang lama. Ini persis skenario yang membuat tRPC lemah dan OpenAPI kuat. Ditambah lagi, integrasi masa depan (aggregator makanan, software akuntansi, marketplace) adalah pihak ketiga yang tidak menulis TypeScript. Kecepatan development tRPC nyata, tapi biayanya dibayar pada momen paling mahal: saat ada 500 outlet dengan lima versi klien berbeda di lapangan.

**Kapan keputusan ini harus ditinjau ulang:** jika setelah 12 bulan tidak ada satu pun integrator pihak ketiga dan seluruh klien bisa di-update serentak (tidak mungkin untuk POS), tRPC untuk endpoint internal bisa dipertimbangkan sebagai lapisan tambahan — bukan pengganti.

**Sumber:** [When to use GraphQL vs Federation vs tRPC vs REST — WunderGraph](https://wundergraph.com/blog/graphql-vs-federation-vs-trpc-vs-rest-vs-grpc-vs-asyncapi-vs-webhooks) (27 Jul 2026) · [tRPC vs GraphQL vs REST — SD Times](https://sdtimes.com/graphql/trpc-vs-graphql-vs-rest-choosing-the-right-api-design-for-modern-web-applications/) (27 Jul 2026)

---

## 5. Database utama

`[FAKTA]` Perbandingan performa PostgreSQL vs MySQL 2026:
- MySQL mencapai ~21% transaksi-per-detik puncak lebih tinggi pada beban read-heavy sederhana.
- PostgreSQL menyelesaikan beban transaksional kompleks **2× lebih cepat** menurut benchmark TPC-C.
- Pada benchmark sysbench OLTP dan TPC-C modern, keduanya berada dalam rentang 10–20% satu sama lain pada mayoritas beban.

`[FAKTA]` PostgreSQL mengikuti standar SQL lebih ketat dari MySQL; ketika PostgreSQL menyatakan sebuah transaksi ACID compliant, itu berarti demikian. Pada model MVCC PostgreSQL, pembaca tidak pernah memblokir penulis dan penulis tidak pernah memblokir pembaca.
`[FAKTA]` Konsekuensi operasional PostgreSQL yang harus diketahui: autovacuum harus berjalan terus-menerus; dead tuple menumpuk jika vacuum tertinggal, menyebabkan table bloat dan degradasi performa. MySQL (InnoDB) memakai model thread-per-connection yang lebih ringan dan berskala ke ribuan koneksi.
`[FAKTA]` Asumsi default untuk proyek baru di 2026 adalah PostgreSQL kecuali ada alasan spesifik untuk menyimpang.

*Sumber: [PostgreSQL vs MySQL: 5 Benchmarks Reveal the Winner 2026 — Tech Insider](https://tech-insider.org/postgresql-vs-mysql-2026/) · [Postgres vs MySQL 2026: An Independent Decision Guide](https://postgresvsmysql.com/) · [PostgreSQL vs MySQL in 2026: Performance, Features and When to Use Each — DEV](https://dev.to/philip_mcclarence_2ef9475/postgresql-vs-mysql-in-2026-performance-features-and-when-to-use-each-3g7e) (semua diakses 27 Jul 2026)*

### KEP-10 — Database utama

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. PostgreSQL | ACID paling ketat; MVCC pembaca-tidak-memblokir-penulis; logical replication (prasyarat sync engine); tipe kaya (JSONB untuk konfigurasi profil vertikal); ekstensi (partitioning, RLS untuk multi-tenancy) | Autovacuum sebagai beban operasional nyata; koneksi lebih berat (butuh pooler pada skala) | Sistem finansial dengan transaksi kompleks |
| B. MySQL/MariaDB | Throughput read sederhana ~21% lebih tinggi; koneksi lebih ringan; familiar bagi hosting Indonesia yang murah | Kepatuhan standar SQL lebih longgar; dukungan sync engine lebih terbatas (PowerSync menandai MySQL sebagai *beta*); JSON kurang matang | Beban read-heavy sederhana, tim dengan pengalaman MySQL |
| C. SQLite di server (LiteFS/Turso) | Deployment paling sederhana; identik dengan database klien; on-premise trivial | Model penulisan single-writer; multi-tenancy skala besar bermasalah; ekosistem operasional tipis untuk beban SaaS | Self-hosted single-tenant saja |

**Rekomendasi:** Opsi A — PostgreSQL. `[INFERENSI]`

**Alasan:** Tiga alasan yang berdiri sendiri-sendiri. **Pertama**, benchmark yang relevan bukan read-heavy sederhana melainkan transaksional kompleks (satu penjualan = insert order + n order line + n modifier + m payment + n stock movement + audit event, dalam satu transaksi), dan di sana PostgreSQL 2× lebih cepat menurut TPC-C. **Kedua**, logical replication PostgreSQL adalah prasyarat untuk semua kandidat sync engine yang dievaluasi di bagian 9 — memilih MySQL mempersempit pilihan sync engine ke jalur beta. **Ketiga**, Row-Level Security PostgreSQL adalah salah satu opsi isolasi tenant yang dievaluasi di Fase 9; MySQL tidak punya padanan setara.

**Beban operasional yang harus diterima, dinyatakan langsung:** autovacuum bukan "atur lalu lupakan". Tabel `stock_movement` dan `audit_event` bersifat append-heavy dengan volume tinggi; keduanya butuh strategi partitioning dan tuning autovacuum sejak awal, bukan setelah performa turun. Ini masuk ke runbook di Fase 10.

**Kapan keputusan ini harus ditinjau ulang:** jika opsi self-hosted ternyata harus berjalan di lingkungan yang sangat terbatas (mini-PC di outlet, bukan server), pertimbangkan PostgreSQL yang di-embed atau SQLite untuk *deployment single-outlet saja* — dengan konsekuensi dua target database yang dibahas jujur di Fase 9.

---

## 6. Caching & queue

| Lapisan | Kandidat | Rekomendasi |
|---|---|---|
| Cache | Redis / Valkey · in-memory proses · tanpa cache | **Tanpa cache di v1.** Beban baca POS didominasi katalog yang sudah direplikasi ke device — server jarang menjadi bottleneck baca. Menambah Redis di v1 berarti menambah satu komponen ke paket on-premise tanpa masalah yang dipecahkan |
| Queue | Redis+BullMQ · PostgreSQL sebagai queue (pgmq / SKIP LOCKED) · RabbitMQ/NATS | **PostgreSQL sebagai queue di v1.** `[INFERENSI]` Volume job (kirim struk WA/email, generate laporan, webhook aggregator) berada di orde ratusan per menit — jauh di bawah titik di mana PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` menjadi masalah. Nilai terbesarnya: **nol komponen tambahan di paket self-hosted** |

`[INFERENSI]` Prinsip yang dipakai konsisten: setiap komponen infrastruktur tambahan dibayar dua kali — sekali di ops SaaS, sekali lagi di dokumentasi, packaging, dan support untuk on-premise. Ambang untuk menambahkan Redis harus berupa masalah yang terukur, bukan antisipasi.

**Kapan Redis masuk:** ketika (a) rate limiting terdistribusi dibutuhkan lintas beberapa instance API, atau (b) queue depth secara rutin melewati ~10.000 job, atau (c) sesi/token butuh penyimpanan bersama yang tidak cocok di PostgreSQL. Sebelum salah satu terjadi, Redis adalah kompleksitas tanpa manfaat.

---

## 7. Database lokal di klien

`[FAKTA]` SQLite menyediakan build WebAssembly resmi yang mengompilasi engine inti ke WASM, memungkinkan SQLite berjalan di dalam sandbox browser dengan performa mendekati native.
`[FAKTA]` Penyimpanan browser standar seperti LocalStorage dan IndexedDB **terlalu lambat, terlalu terbatas, atau secara fundamental tidak kompatibel** dengan cara engine database relasional sinkron membaca dan menulis byte ke disk. OPFS (Origin Private File System) memungkinkan SQLite berjalan di browser pada kecepatan filesystem native.
`[FAKTA]` Pola arsitektur yang direkomendasikan: engine SQLite dan filesystem OPFS dipindahkan ke Web Worker, menjaga UI berjalan pada 60 FPS terlepas dari beban database.
`[FAKTA]` Notion memakai OPFS untuk menyimpan data lokal dan menjalankan operasi database di Web Worker, dengan **hanya tab aktif yang menangani penulisan database** sementara tab lain merutekan request lewat SharedWorker ke tab aktif.
`[FAKTA — batasan penting]` Ada dua pendekatan implementasi: Asyncify (membuat WASM lebih besar dan lebih lambat) dan SharedArrayBuffer (dipakai OPFS VFS resmi SQLite, dengan **restriksi header COOP/COEP**, dan **OPFS belum didukung di Firefox**).

*Sumber: [SQLite Wasm in the browser backed by the Origin Private File System — Chrome for Developers](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system) · [Persistent Storage Options — SQLite WASM documentation](https://sqlite.org/wasm/doc/trunk/persistence.md) · [OPFS & WASM SQLite: High-Performance Database Storage in the Browser 2026 — Sachin Sharma](https://sachinsharma.dev/blogs/opfs-sqlite-browser-storage-2026) · [Running SQLite in the Browser with OPFS and Web Workers — didof.dev](https://didof.dev/blog/sqlite-in-browser-with-opfs-and-web-workers/) (semua diakses 27 Jul 2026)*

### KEP-11 — Database lokal di klien

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. IndexedDB langsung (mis. via Dexie) | Didukung semua browser termasuk Firefox; tanpa header khusus; tanpa WASM | Bukan relasional — query stok dan laporan lokal menjadi loop manual. Tidak ada transaksi multi-tabel yang layak untuk data finansial. Skema lokal akan berbeda dari server | Data lokal sederhana berbentuk key-value |
| B. SQLite WASM + OPFS di browser, SQLite native di desktop & mobile | **Satu skema, satu dialek SQL untuk tiga platform.** Transaksi ACID lokal — wajib untuk data finansial. Query laporan lokal jadi SQL biasa | Butuh header COOP/COEP; **OPFS belum didukung Firefox**; harus berjalan di Web Worker; ukuran WASM ~1 MB | Sistem offline-first dengan data relasional |
| C. Hybrid: SQLite di desktop/mobile, IndexedDB di web | Menghindari batasan OPFS di web | **Dua skema, dua set query, dua kelas bug.** Biaya terburuk dari semua opsi | Web hanya untuk dashboard read-only |

**Rekomendasi:** Opsi B. `[INFERENSI dari kebutuhan transaksi ACID lokal dan biaya memelihara dua skema]`

**Alasan:** Data yang disimpan offline adalah data finansial — satu penjualan menyentuh order, order line, payment, dan stock movement yang semuanya harus commit bersama atau tidak sama sekali. IndexedDB tidak menyediakan jaminan ini secara praktis. Lebih menentukan lagi: opsi C berarti setiap logika "hitung stok lokal", "cari transaksi untuk refund", dan "laporan shift offline" harus ditulis dua kali dan di-debug dua kali. Untuk solo builder, itu biaya yang tidak bisa ditanggung.

**Batasan Firefox — dinyatakan langsung, bukan disembunyikan:** OPFS belum didukung Firefox `[FAKTA]`. Konsekuensinya: **aplikasi kasir tidak didukung di Firefox.** Ini keputusan produk, bukan bug, dan harus tertulis di requirement sistem. Mitigasinya wajar — tablet kasir adalah perangkat terkendali yang di-provision merchant, dan browser yang didukung bisa ditetapkan (Chrome/Edge di Windows, Chrome di Android, WebView di aplikasi desktop/mobile). Untuk dashboard owner di HP (read-only, tanpa OPFS) Firefox tetap bisa didukung karena tidak butuh database lokal.

**Header COOP/COEP — konsekuensi yang harus direncanakan:** menyalakan `Cross-Origin-Opener-Policy` dan `Cross-Origin-Embedder-Policy` memblokir resource lintas-origin yang tidak mengirim header CORP yang benar. Ini **memutus `@import` Google Fonts** — yang sudah harus di-self-host karena alasan offline. Kedua masalah punya satu perbaikan yang sama.

**Kapan keputusan ini harus ditinjau ulang:** jika Firefox mengimplementasikan OPFS penuh (perlu dipantau), batasan browser bisa dilonggarkan tanpa perubahan arsitektur.

---

## 8. Aplikasi mobile kasir & aplikasi desktop offline-first

### 8.1 Desktop

`[FAKTA]` Perbandingan Tauri v2 vs Electron 2026:
- Aplikasi Tauri minimal bisa di bawah 600 KB pada intinya; aplikasi sederhana tipikal 3–15 MB. Aplikasi Electron rutin berada di 150 MB atau lebih untuk installer saja. Selisih bundle size ~25×.
- Memory Tauri 50–75% lebih rendah; aplikasi Tauri tipikal memakai 30–60 MB RAM.
- Keunggulan Tauri bersifat struktural dan tidak terhindarkan — berasal langsung dari tidak mem-bundle browser engine 85+ MB. Tauri memakai WebView sistem operasi (Edge WebView2 di Windows, WebKitGTK di Linux, WebKit di macOS) dipasangkan dengan core Rust.
- Pilih Electron ketika butuh ekosistem desktop paling matang, JavaScript sampai ke bawah, jalur auto-update/packaging yang terbukti, dan **rendering identik lintas Windows/macOS/Linux**.

*Sumber: [Electron vs Tauri 2026: Bundle Size, RAM, Security and Team Fit — PkgPulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) · [Tauri v2 vs Electron 2026: The Honest Comparison — BuildMVPFast](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026) · [Tauri vs Electron 2026: 96% Smaller Apps — Tech Insider](https://tech-insider.org/tauri-vs-electron-2026/) (semua diakses 27 Jul 2026)*

### 8.2 Mobile

`[FAKTA]` React Native memegang 42% pangsa pasar cross-platform di 2026.
`[FAKTA]` Filosofi tiga pendekatan berbeda secara fundamental: Capacitor membungkus aplikasi web yang sudah ada dalam shell native dan menambahkan plugin untuk API perangkat; React Native menulis JavaScript tapi merender dengan komponen UI native; Flutter menawarkan performa tertinggi dan code sharing terbanyak tapi menuntut belajar Dart.
`[FAKTA]` Untuk multi-platform: dengan Flutter bisa membangun web, iOS, dan Android dari satu codebase; dengan React Native dibutuhkan **codebase terpisah dalam React untuk aplikasi web**.
`[FAKTA]` Ukuran aplikasi: Ionic/Capacitor sering terkecil (3–5 MB), diikuti React Native, dengan Flutter tipikal lebih besar karena engine yang di-bundle.
`[FAKTA]` Tauri 2 mendukung membangun aplikasi mobile dan desktop dari satu codebase.

*Sumber: [React Native vs Flutter vs Expo vs Lynx 2026 — GroovyWeb](https://www.groovyweb.co/blog/react-native-vs-flutter-vs-expo-vs-lynx-2026) · [Capacitor vs React Native vs Flutter: Hybrid Apps in 2026 — Kanopy](https://kanopylabs.com/blog/capacitor-vs-react-native-vs-flutter) · [Building a Cross-Platform App in 2026 — The Debuggers](https://thedebuggersitsolutions.com/blog/cross-platform-app-2026-flutter-react-native-capacitor) · [Build Mobile and Desktop Apps From One Codebase — Tauri 2](https://www.mayhemcode.com/2026/07/build-mobile-and-desktop-apps-from-one.html) (semua diakses 27 Jul 2026)*

### KEP-12 — Strategi cross-platform (mobile + desktop)

**Pertanyaan:** Bagaimana satu tim satu orang mengirim aplikasi kasir yang berjalan di browser, Android, iOS, dan desktop offline-first tanpa memelihara empat codebase?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Flutter untuk semua | Code sharing tertinggi; performa terbaik; satu bahasa | **Membuang 21 komponen React di `/ds-bundle`** — menulis ulang seluruh lapisan UI dalam Dart. Bahasa berbeda dari backend. Akses hardware POS (ESC/POS via USB/serial) butuh plugin platform-channel | Design system belum dibuat |
| B. React Native (+ RN Web) untuk semua | Ekosistem React; pangsa pasar 42% | RN tidak merender DOM — komponen `/ds-bundle` yang memancarkan className **tidak berjalan tanpa modifikasi**. RN Web membantu tapi menambah lapisan translasi. `[FAKTA]` Web tetap butuh codebase React terpisah | Aplikasi mobile-first tanpa design system web |
| C. Satu aplikasi web React sebagai inti, dibungkus **Tauri 2** untuk desktop dan mobile | **21 komponen dipakai apa adanya** — Tauri merender WebView, jadi DOM + CSS berjalan tanpa perubahan. Bundle 3–15 MB, RAM 30–60 MB. Satu codebase UI untuk empat target. Rust core memberi akses USB/serial untuk printer & cash drawer | WebView berbeda antar platform → inkonsistensi rendering. Tauri mobile lebih baru dari Tauri desktop, risiko kematangan. Rust dibutuhkan untuk plugin native | Ada design system web yang final dan tim kecil |
| D. Web + Capacitor (mobile) + Electron (desktop) | Semua matang; JavaScript sampai bawah; jalur packaging terbukti | Dua toolchain wrapper berbeda untuk dipelihara. Electron 150+ MB dan RAM tinggi — masalah nyata di mini-PC outlet murah | Prioritas kematangan di atas efisiensi |

**Rekomendasi:** Opsi C — inti web React tunggal, dibungkus Tauri 2 untuk desktop dan mobile — **dengan Opsi D sebagai rencana mundur yang eksplisit.** `[INFERENSI]`

**Alasan:** Design system yang sudah final adalah aset terbesar dan paling mahal untuk dibuat ulang; setiap opsi yang membuangnya dimulai dengan defisit berminggu-minggu. Tauri merender WebView, artinya `components.css`, token CSS, dan 21 komponen `.jsx` berjalan tanpa satu baris perubahan. Keunggulan sumber daya Tauri bukan kosmetik untuk kasus ini: tablet kasir dan mini-PC di outlet Indonesia sering perangkat kelas bawah, dan selisih 30–60 MB (Tauri) versus 150+ MB (Electron) menentukan apakah aplikasi tetap responsif saat browser dan aplikasi lain juga berjalan. Core Rust Tauri juga memberi akses langsung ke USB/serial yang dibutuhkan printer ESC/POS dan cash drawer — kebutuhan yang digarap di Fase 7.

**Risiko yang dinyatakan langsung:** Tauri mobile lebih baru dan kurang terbukti daripada Tauri desktop. Ini risiko nyata, bukan teoretis. Mitigasi: **bangun web + desktop dulu**, dan tunda mobile native sampai kematangan Tauri mobile bisa dinilai dengan prototipe nyata. Aplikasi kasir di tablet Android dapat berjalan sebagai PWA di Chrome sebagai jalur sementara — dengan catatan bahwa PWA tidak memberi akses USB/serial yang sama. Jika prototipe Tauri mobile gagal, mundur ke Capacitor untuk mobile saja (Opsi D parsial) sambil mempertahankan Tauri di desktop.

**Kapan keputusan ini harus ditinjau ulang:** jika inkonsistensi WebView antar platform menghasilkan lebih dari ~3 bug rendering yang butuh workaround per bulan, atau jika prototipe Tauri mobile menunjukkan blocker pada akses printer/scanner, pindah ke Opsi D untuk platform yang bermasalah saja.

**Sumber:** [Electron vs Tauri 2026: Bundle Size, RAM, Security and Team Fit — PkgPulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) (27 Jul 2026) · [Build Mobile and Desktop Apps From One Codebase — Tauri 2](https://www.mayhemcode.com/2026/07/build-mobile-and-desktop-apps-from-one.html) (27 Jul 2026) · [Capacitor vs React Native vs Flutter — Kanopy](https://kanopylabs.com/blog/capacitor-vs-react-native-vs-flutter) (27 Jul 2026) · `/ds-bundle/readme.md` § Komponen

---

## 9. Sync engine

`[FAKTA]` Perbedaan arsitektural tiga kandidat utama:
- **ElectricSQL** adalah sync engine **read-path**: men-stream data dari PostgreSQL ke klien secara real time memakai *Shapes*, sementara **penulisan tetap lewat backend API yang sudah ada**.
- **PowerSync** menyediakan sync **bidirectional penuh**: data mengalir dari database server ke SQLite sisi klien, dan penulisan sisi klien mengalir balik lewat **upload queue yang persisten**.
- **Replicache** adalah framework sync JavaScript untuk aplikasi web offline-first dengan optimistic UI, sinkronisasi server, dan resolusi konflik.

`[FAKTA]` Pada 17 Juli 2024 ElectricSQL mengumumkan "clean rebuild" produk mereka bernama *electric-next* dan menghentikan pengembangan ElectricSQL 1 (legacy).
`[FAKTA]` PowerSync direkomendasikan untuk aplikasi produksi terutama mobile karena paling matang dan teruji di lapangan; ElectricSQL bagus sebagai jalur paling sederhana ke local-first dengan PostgreSQL.

`[FAKTA]` **Lisensi & self-hosting PowerSync (dari halaman resmi):**
- **Open Edition** — versi self-hosted, source-available, gratis. Diumumkan 31 Mei 2024.
- Source code PowerSync berada di bawah **Functional Source License (FSL)**, lisensi unggulan inisiatif Fair Source. **Client SDK di bawah Apache-2.0.**
- Open Edition mencakup: dukungan Postgres, MongoDB, MySQL (beta), SQL Server (alpha); akses ke **semua client SDK**; partial sync dengan Sync Streams; konfigurasi lewat config file; monitoring lewat log file dan status API; debugging tool.
- Yang **tidak** ada di Open Edition: PowerSync Dashboard (berstatus *planned* bahkan untuk Enterprise Self-Hosted), custom write checkpoints, monitoring & alerting (APIs only, early access), usage metrics OpenTelemetry (*planned*), SOC 2 report, dan support berbayar.
- Sync service adalah **aplikasi Node.js** yang memakai fork pgwire untuk streaming perubahan dari Postgres dan RSocket untuk WebSocket streaming ke klien.

`[FAKTA]` **Harga PowerSync Cloud (jika memilih hosted):** Free $0 (2 GB sync/bulan, 500 MB hosted, 50 peak concurrent connection, 2 instance, deaktivasi setelah 1 minggu tidak aktif) · Pro dari $49/bulan (30 GB sync termasuk lalu $1/GB, 10 GB hosted, 1.000 peak connection lalu $30 per 1.000, 2 instance lalu $25/bulan per instance) · Team dari $599/bulan (menambah version locking, SLA, uptime guarantee, custom write checkpoints, VPC peering AWS, SOC 2 & HIPAA) · Enterprise custom.

*Sumber: [PowerSync Pricing — halaman resmi](https://www.powersync.com/pricing) (diakses 27 Jul 2026) · [PowerSync Open Edition Release](https://powersync.com/blog/powersync-open-edition-release) (31 Mei 2024) · [PowerSync Supports Fair Source](https://powersync.com/blog/powersync-supports-fair-source) · [PowerSync Licensing & Terms](https://www.powersync.com/legal/licensing-terms) · [ElectricSQL vs PowerSync vs Replicache — QueryPlane](https://queryplane.com/blog/electricsql-vs-powersync-vs-replicache/) · [ElectricSQL electric-next Vs PowerSync](https://powersync.com/blog/electricsql-electric-next-vs-powersync) (semua diakses 27 Jul 2026)*

### KEP-13 — Sync engine: pakai atau bangun sendiri

Evaluasi teknis di sini; keputusan penuh beserta strategi resolusi konflik ada di **Fase 5**. Yang ditetapkan di sini adalah kandidatnya.

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. PowerSync (Open Edition, self-host) | Bidirectional penuh dengan **upload queue persisten** — persis yang dibutuhkan design system untuk state "mengantre-sync"/"gagal-sync". SQLite di klien = sejalan dengan KEP-11. Self-host gratis, jalur ke on-premise jelas. Semua client SDK tersedia di Open Edition | **FSL bukan lisensi OSI open source** — batasan penggunaan harus dibaca sebelum berkomitmen. Ketergantungan vendor tunggal. Sync service adalah komponen Node.js tambahan di paket on-premise. Dashboard dan alerting tidak tersedia di Open Edition | Offline-first bidirectional dengan sumber daya engineering terbatas |
| B. ElectricSQL (electric-next) | Open source; jalur paling sederhana; read-path streaming dari PostgreSQL yang elegan | **Read-path saja** — penulisan tetap harus dirancang sendiri lewat API. Untuk POS, sisi penulisan justru bagian tersulit. `[FAKTA]` Rebuild besar Juli 2024 berarti maturitas produk saat ini lebih muda dari umur proyeknya | Aplikasi yang banyak baca, sedikit tulis |
| C. Bangun sendiri (change log + upload queue di atas SQLite) | Kendali penuh; nol ketergantungan vendor dan lisensi; bisa dioptimalkan persis untuk domain POS (mis. penomoran transaksi offline, konflik stok sebagai keputusan bisnis) | Ini **pekerjaan berbulan-bulan**, dan bug di sini berarti uang merchant hilang. Kelas bug tersulit: reordering, duplikasi saat retry, clock skew antar device, partial sync failure | Domain punya semantik konflik yang tidak bisa diekspresikan sync engine generik |

**Kandidat yang dibawa ke Fase 5:** A dan C, dengan A sebagai default dan C sebagai kemungkinan untuk *subset* domain yang punya semantik konflik khusus (stok). B dikeluarkan karena tidak menyelesaikan bagian tersulit.

**Yang harus diverifikasi manusia sebelum berkomitmen** (masuk `12-OPEN-QUESTIONS.md`): teks Functional Source License PowerSync harus dibaca utuh untuk memastikan tidak ada batasan yang menghalangi penjualan Lumi POS sebagai produk komersial, khususnya dalam paket on-premise ke pelanggan enterprise. FSL umumnya membatasi penggunaan kompetitif; apakah "POS yang menyertakan PowerSync" dianggap kompetitif terhadap PowerSync adalah pertanyaan hukum, bukan teknis.

---

## 10. Autentikasi & manajemen identitas

`[FAKTA]` Keycloak: proyek berbasis Java/Quarkus, lisensi Apache 2.0, didukung Red Hat, dengan model ekstensi SPI mendalam dan ekosistem IAM open-source terbesar. Memakai RDBMS untuk penyimpanan (PostgreSQL direkomendasikan untuk produksi). Isolasi utama lewat **realm**; Keycloak 26.x menambahkan fitur **Organizations** sebagai tier kedua tenancy di dalam realm untuk skenario B2B SaaS. **Satu-satunya dari ketiganya yang mendukung SAML federation.**
`[FAKTA]` Zitadel: platform berbasis Go, dibangun *organizations-first*, dengan API gRPC/REST modern, multi-tenancy native, dan **audit trail bawaan**. **Single binary** dengan arsitektur event-sourced — semua perubahan state disimpan sebagai event di database. Mendukung CockroachDB dan PostgreSQL. Hierarki Instance → Organization → Project → Application. Komunitas lebih kecil dan dokumentasi kurang komprehensif dibanding Keycloak.
`[FAKTA]` Ory: pendekatan microservices — Kratos (identitas), Hydra (OAuth2), Keto (permission), Oathkeeper (gateway); tiap komponen binary Go mandiri dengan database sendiri. Headless secara default. Tidak punya SAML/enterprise federation.

*Sumber: [Keycloak vs Zitadel: Open-Source IAM Compared — Skycloak](https://skycloak.io/blog/keycloak-vs-zitadel-comparison/) · [Open Source Authentication in 2026: Complete Comparison — Skycloak](https://skycloak.io/blog/open-source-authentication-comparison-2026/) · [Top 10 Open-Source IAM Solutions in 2026 — StartWithIdentity](https://startwithidentity.com/articles/top-10-open-source-iam-solutions/) (semua diakses 27 Jul 2026)*

### KEP-14 — Autentikasi & identitas

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Bangun sendiri (session + JWT + tabel user/role) | Nol komponen tambahan di paket on-premise. Kendali penuh atas alur PIN kasir yang tidak standar. Paling sederhana untuk v1 | Harus mengimplementasikan sendiri: rotasi token, reset password, MFA, dan (nanti) SSO enterprise. Risiko keamanan ditanggung sendiri | Kebutuhan auth sederhana dan spesifik domain |
| B. Zitadel (self-host) | Single binary Go — paling mudah masuk paket on-premise dari ketiga IAM. Multi-tenancy native (Organization = tenant). **Audit trail bawaan** — sejalan dengan kebutuhan Fase 8 | Satu komponen tambahan di on-premise. Komunitas dan dokumentasi lebih kecil dari Keycloak. Tidak mendukung SAML | SaaS multi-tenant yang butuh IAM matang tanpa kompleksitas ops tinggi |
| C. Keycloak (self-host) | Ekosistem terbesar, paling matang, **satu-satunya dengan SAML** — dibutuhkan jika pelanggan enterprise Indonesia meminta SSO korporat | Java/Quarkus — runtime tambahan yang berat di paket on-premise, bertentangan dengan tujuan paket ringan. Kompleksitas operasional tertinggi | Pelanggan enterprise dengan kebutuhan federation sejak awal |

**Rekomendasi:** Opsi A untuk v1, dengan **batas modul auth yang dirancang agar bisa ditukar ke Opsi B tanpa perubahan berantai.** `[INFERENSI]`

**Alasan:** Alur autentikasi POS tidak standar dan sebagian besar tidak dilayani IAM generik. Kasir login dengan **PIN 4–6 digit di perangkat bersama**, bukan email+password. Manajer melakukan step-up authorization dengan PIN di tengah sesi kasir lain (KEP dari Fase 2). Shift terikat ke device, bukan hanya ke user. Memaksa alur ini ke dalam Keycloak/Zitadel berarti menulis banyak custom flow — pekerjaan yang setara dengan membangunnya sendiri, tapi dengan komponen tambahan yang harus dikemas untuk on-premise. Yang **harus** dibangun dengan benar sejak awal meskipun buatan sendiri: hashing (Argon2id), rotasi refresh token, dan pencatatan setiap event auth ke audit trail.

**Batas modul yang harus dijaga agar penukaran tetap mungkin:** aplikasi hanya boleh mengenal `subject` (siapa), `tenant`, `outlet`, dan `roles` — bukan mekanisme bagaimana keempatnya didapat. Selama kontrak ini dijaga, memindahkan identitas ke Zitadel nanti adalah pekerjaan satu modul.

**Kapan keputusan ini harus ditinjau ulang:** saat pelanggan enterprise pertama meminta SSO/SAML, atau saat kebutuhan MFA untuk akun owner menjadi wajib secara regulasi. Pada titik itu Zitadel (atau Keycloak jika SAML wajib) menggantikan modul buatan sendiri.

---

## 11. Real-time transport

| Kandidat | Kekuatan | Kelemahan | Verdict |
|---|---|---|---|
| WebSocket (raw / via sync engine) | Bidirectional; latensi rendah; `[FAKTA]` PowerSync sudah memakai RSocket di atas WebSocket | Butuh penanganan reconnect, heartbeat, backoff sendiri jika raw | **Dipakai — lewat sync engine, bukan diimplementasikan sendiri** |
| Server-Sent Events (SSE) | Sederhana; reconnect otomatis; jalan lewat proxy HTTP biasa | Satu arah (server→klien) | Cadangan untuk notifikasi dashboard |
| Polling | Paling sederhana; paling tahan jaringan buruk | Latensi dan beban server | Fallback saat WebSocket diblokir jaringan merchant |

**Rekomendasi:** transport real-time **bukan keputusan terpisah** — ia mengikuti sync engine. `[INFERENSI]` Yang perlu ditetapkan adalah kebutuhan real-time di luar sinkronisasi data: **KDS** (tiket baru harus muncul di layar dapur dalam < 2 detik) dan **notifikasi otorisasi** (permintaan PIN manajer). Keduanya berada dalam satu outlet dan **harus bekerja tanpa internet** — artinya keduanya tidak boleh melewati cloud. Ini menegaskan kembali kebutuhan transport lokal dalam outlet yang digarap di Fase 5, dan bukan sesuatu yang bisa diselesaikan WebSocket ke server.

---

## 12. Hosting & infrastruktur

| Opsi | Biaya skala kecil | Biaya skala besar | Kemudahan on-premise | Catatan |
|---|---|---|---|---|
| **VPS terkelola (Hetzner/Contabo/DigitalOcean) + Docker Compose** | Terendah (~$20–60/bln untuk puluhan tenant) | Butuh kerja manual untuk scaling | **Terbaik** — paket on-premise adalah `docker-compose.yml` yang sama | Latensi ke Indonesia tinggi jika di Eropa |
| **Cloud regional (AWS/GCP Jakarta, Alibaba Cloud ID)** | Sedang–tinggi | Baik, managed services mengurangi ops | Sedang — managed service tidak punya padanan on-prem | Latensi terbaik ke merchant Indonesia. Pertimbangan kedaulatan data (Fase 8) |
| **PaaS (Fly.io/Railway/Render)** | Rendah | Tinggi pada skala | Buruk — abstraksi PaaS tidak bisa dikirim ke pelanggan | Kecepatan development tertinggi |
| **Kubernetes** | Tinggi (biaya kompleksitas) | Baik | Buruk untuk merchant, baik untuk enterprise besar | Overkill untuk solo builder |

**Rekomendasi:** `[INFERENSI]` **Cloud regional di Jakarta + Docker Compose sebagai unit deployment.** Alasan latensi bersifat menentukan: aplikasi kasir sudah offline-first, tapi dashboard, sinkronisasi, dan pemrosesan pembayaran tetap melewati jaringan, dan RTT 200 ms+ ke Singapura/Eropa terasa langsung di jam sibuk. Docker Compose dipilih sebagai unit deployment justru karena ia adalah **artefak yang sama** yang dikirim ke pelanggan on-premise — memisahkan keduanya berarti memelihara dua topologi.

**Yang dihindari secara sadar:** managed service yang tidak punya padanan self-hosted (managed queue, managed search, serverless function proprietary). Setiap pemakaiannya menambah cabang di paket on-premise. Prinsip ini dibahas penuh di Fase 9.

---

## 13. Rangkuman rekomendasi stack

| Lapisan | Rekomendasi | Alternatif utama | Pemicu untuk berpindah |
|---|---|---|---|
| Runtime backend | Node.js 22+ / TypeScript | Go | Endpoint sync menjadi CPU-bound |
| HTTP framework | Fastify | NestJS | Tim tumbuh > 4 orang |
| Kontrak API | REST + OpenAPI spec-first | tRPC | Tidak ada integrator eksternal setelah 12 bulan |
| Database utama | PostgreSQL 17+ | MySQL | Tidak ada — perpindahan tidak direkomendasikan |
| Queue | PostgreSQL (SKIP LOCKED) | Redis + BullMQ | Queue depth rutin > 10.000 |
| Cache | Tidak ada di v1 | Redis/Valkey | Rate limiting terdistribusi dibutuhkan |
| Frontend web | React 19 + Vite (SPA) | — | Terkunci oleh `/ds-bundle` |
| Styling | CSS custom properties + `components.css` | + Tailwind utilitas layout | — |
| DB lokal klien | SQLite (WASM+OPFS di web, native di Tauri) | IndexedDB | OPFS diblokir di platform target |
| Desktop | Tauri 2 | Electron | Bug WebView > 3/bulan |
| Mobile | Tauri 2 (setelah prototipe) atau PWA sementara | Capacitor | Prototipe Tauri mobile gagal |
| Sync | PowerSync Open Edition (self-host) | Bangun sendiri | Batasan lisensi FSL menghalangi penjualan komersial |
| Auth | Buatan sendiri, modul terisolasi | Zitadel | Kebutuhan SSO/SAML enterprise |
| Real-time | Mengikuti sync engine + transport lokal-outlet | — | — |
| Hosting | Cloud regional Jakarta + Docker Compose | VPS + Compose | Kepatuhan data mengharuskan lokasi tertentu |

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Requirement sistem harus menyatakan browser dan platform yang **didukung dan tidak didukung**: Firefox tidak didukung untuk aplikasi kasir karena OPFS. Ini keputusan produk yang harus disetujui, bukan detail teknis tersembunyi.
- Aplikasi mobile native harus dinyatakan sebagai *fase kedua* dengan PWA sebagai jalur awal, bukan dijanjikan bersamaan dengan web dan desktop di v1.
- Setiap fitur yang menyebut "real-time" harus menyatakan apakah real-time-nya bekerja tanpa internet (KDS: ya, wajib) atau tidak (dashboard owner: tidak).

**Untuk Information Architecture:**
- Aplikasi adalah SPA tunggal dengan route yang dapat diakses offline. IA harus menandai setiap layar sebagai **offline-capable** atau **online-only** — pembagian ini menentukan bundel mana yang di-precache dan data mana yang direplikasi ke device.
- Layar yang online-only (integrasi aggregator, pengaturan billing, laporan lintas-outlet historis panjang) butuh empty state khusus offline, sesuai aturan design system bahwa kegagalan harus menjelaskan alasannya.

**Untuk ERD:**
- Skema harus ada dalam **dua bentuk yang diturunkan dari satu sumber**: PostgreSQL di server dan SQLite di klien. Perbedaan tipe (`timestamptz`, `numeric`, `uuid`, `jsonb`) harus dipetakan eksplisit. Uang **tidak boleh** disimpan sebagai float di kedua sisi — `bigint` dalam satuan terkecil (rupiah, tanpa desimal per aturan format design system) adalah pilihan yang paling aman.
- Setiap tabel yang direplikasi ke klien butuh kolom yang dibutuhkan sync engine (versi/checkpoint/tombstone). Bentuk pastinya ditentukan sync engine yang dipilih di Fase 5, tapi keberadaannya harus diasumsikan di ERD.

**Untuk Technical Architecture:**
- Dokumen arsitektur harus memuat **satu diagram deployment yang sama** untuk SaaS dan on-premise, dengan perbedaan ditandai sebagai konfigurasi. Jika keduanya butuh diagram berbeda, itu tanda arsitektur sudah bercabang terlalu awal.
- Modul auth, modul sync, dan modul pembayaran adalah tiga titik di mana ketergantungan vendor terkonsentrasi. Ketiganya butuh batas antarmuka eksplisit yang didokumentasikan sebagai *port*, dengan implementasi saat ini sebagai *adapter*.
- Perbaikan self-host font Inter dan penambahan header COOP/COEP adalah dua item infrastruktur yang harus masuk backlog awal karena keduanya prasyarat untuk kemampuan offline, bukan polish.
- `_adherence.oxlintrc.json` dari `/ds-bundle` masuk ke pipeline CI sejak commit pertama.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `04-ARCHITECTURE-PATTERNS.md`.*
