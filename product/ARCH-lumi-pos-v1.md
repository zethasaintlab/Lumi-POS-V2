# Technical Architecture — Lumi POS v1

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` · **ERD:** `/product/ERD-lumi-pos-v1.md` · **Riset:** `/research/` (KEP-08…KEP-36)

---

## 1. Prinsip yang mengikat

Delapan aturan yang menjadi dasar review. Pelanggarannya adalah cacat arsitektur, bukan preferensi gaya.

| # | Prinsip | Konsekuensi kalau dilanggar |
|---|---|---|
| 1 | **Satu penjualan = satu transaksi database** | Penjualan tercatat tapi stok tidak berkurang — kelas bug terburuk di sistem finansial |
| 2 | **Transaksi selesai tidak pernah di-`UPDATE`** | Audit trail rusak; konflik sinkronisasi menjadi ambigu |
| 3 | **Simpan sebelum cetak, selalu** | Struk dapat dicetak ulang; penjualan yang hilang tidak dapat dipulihkan |
| 4 | **Tidak ada akses database lintas modul** | Setelah 12 bulan setiap query menyentuh setiap tabel; tidak dapat dipecah |
| 5 | **Tidak ada `if (isOnPrem)` di kode aplikasi** | Dua produk dengan satu nama |
| 6 | **Tidak ada `if (vertical === 'fnb')` di luar lapisan profil** | Desain multi-vertikal bocor; vertikal ketiga menjadi mustahil |
| 7 | **Tidak ada angka pajak di luar `TaxCalculator`** | Perubahan tarif harus dicari di seluruh codebase |
| 8 | **Aplikasi terhubung ke DB sebagai user yang tunduk RLS** | RLS menjadi ilusi keamanan tanpa gejala apa pun |

---

## 2. Gambaran sistem

```
╔════════════════════════════════════════════════════════════════════╗
║  PERANGKAT                                                          ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  React 19 + Vite (SPA)                                        │  ║
║  │  21 komponen dari /ds-bundle · CSS custom properties           │  ║
║  ├──────────────────────────────────────────────────────────────┤  ║
║  │  Lapisan domain klien (TypeScript, dibagi dengan server)       │  ║
║  │  perhitungan total · state machine order · validasi            │  ║
║  ├──────────────────────────────────────────────────────────────┤  ║
║  │  SQLite   (WASM+OPFS di web · native di Tauri)                │  ║
║  │  terenkripsi, kunci di keystore OS                            │  ║
║  ├──────────────────┬───────────────────┬───────────────────────┤  ║
║  │  outbox_local    │  sync client      │  PeripheralPort       │  ║
║  │  (jalur naik)    │  (jalur turun)    │  (Rust: USB/serial)   │  ║
║  └────────┬─────────┴─────────┬─────────┴───────────────────────┘  ║
╚═══════════╪═══════════════════╪═════════════════════════════════════╝
            │ HTTPS/REST        │ WebSocket
            │ idempoten         │ (PowerSync)
            ▼                   ▼
╔════════════════════════════════════════════════════════════════════╗
║  SERVER                                                             ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  Fastify · REST + OpenAPI (spec-first)                        │  ║
║  ├──────────────────────────────────────────────────────────────┤  ║
║  │  MODULAR MONOLITH — satu deployable                           │  ║
║  │                                                                │  ║
║  │  catalog │ ordering │ payment │ inventory │ cash              │  ║
║  │  identity │ reporting │ sync │ tenancy                        │  ║
║  │                                                                │  ║
║  │  ↳ komunikasi antar modul HANYA lewat index.ts publik         │  ║
║  │  ↳ TIDAK ADA query ke tabel milik modul lain                  │  ║
║  ├──────────────────────────────────────────────────────────────┤  ║
║  │  PORT: TaxCalculator · PaymentProvider · SigningHook          │  ║
║  │        ReceiptRenderer · PeripheralPort                        │  ║
║  ├──────────────────────────────────────────────────────────────┤  ║
║  │  PostgreSQL 17+ · RLS · queue via SKIP LOCKED                 │  ║
║  │  PowerSync Service (Node.js) — replikasi turun                │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 3. Modul & kepemilikan tabel

Batas modul ditegakkan lewat **kepemilikan tabel yang eksplisit**. Ini kontrak, bukan konvensi.

| Modul | Tabel yang dimiliki | Permukaan publik |
|---|---|---|
| `tenancy` | `tenant`, `outlet`, `vertical_profile`, `subscription`, `usage_metric` | `getTenant`, `getOutlet`, `getVerticalProfile`, `checkQuota` |
| `identity` | `user`, `role`, `user_role`, `device`, `support_session` | `authenticate`, `authorize`, `verifyPin`, `getDevice` |
| `catalog` | `category`, `item`, `item_variation`, `modifier_list`, `modifier`, `item_modifier_list`, `price_history` | `getCatalog`, `resolvePrice`, `getVariation` |
| `ordering` | `order`, `check`, `order_line`, `order_line_modifier`, `refund` | `createOrder`, `voidOrder`, `refundOrder`, `getOrder` |
| `payment` | `payment`, `tax_rate` | `addPayment`, `calculateTax`, `confirmPayment` |
| `inventory` | `stock_movement`, `sold_out_flag`, `stocktake`, `stocktake_line`, `oversell_event` | `recordMovement`, `getStock`, `detectOversell` |
| `cash` | `cash_drawer_shift`, `cash_movement` | `openShift`, `closeShift`, `recordCashMovement` |
| `reporting` | — (baca lewat view yang disediakan modul lain) | `getSalesPosition`, `getExceptionReport` |
| `sync` | `idempotency_key`, `outbox` | `enqueue`, `processUpload`, `validateTransaction` |
| `peripheral` | `peripheral`, `printer_profile`, `print_job` | `print`, `openDrawer`, `testDevice` |
| `audit` | `audit_event` | `record` |

**Penegakan:**

1. Satu direktori per modul; `index.ts` sebagai **satu-satunya** permukaan publik.
2. Lint rule melarang import dalam-dalam antar modul.
3. **Aturan yang lebih penting dan lebih sering dilanggar:** kepemilikan tabel di-audit. Idealnya lewat **skema PostgreSQL terpisah per modul dengan grant terbatas**, sehingga pelanggaran gagal di runtime, bukan menunggu review.

**Modul yang paling mungkin diekstrak nanti:** `sync` (banyak koneksi WebSocket persisten) dan `reporting` (query berat). Ekstraksi dilakukan **satu modul saja**, setelah metrik menunjukkan kebutuhannya — bukan dekomposisi menyeluruh.

---

## 4. Transaksi penjualan — jalur kritis

Ini alur yang paling banyak dilanggar dan paling mahal kalau salah.

```
KLIEN
  1. Validasi lokal (state machine, kuota, otorisasi)
  2. Hitung total lewat TaxCalculator versi klien
  3. BEGIN TRANSACTION (SQLite)
       insert order, check, order_line, order_line_modifier
       insert payment
       insert stock_movement                     ← untuk track_stock=true
       insert cash_movement                      ← bila ada tunai
       insert audit_event
       insert outbox_local (+ idempotency_key)   ← SATU TRANSAKSI
     COMMIT
  4. Tampilkan kembalian                          ← penjualan sudah aman
  5. Cetak struk        ← BOLEH GAGAL
  6. Buka laci          ← BOLEH GAGAL

SERVER (saat upload)
  1. Cek idempotency_key
       ada + hash sama    → kembalikan respons asli, SELESAI
       ada + hash beda    → 422
       tidak ada          → lanjut
  2. BEGIN TRANSACTION (PostgreSQL)
       SET LOCAL app.tenant_id
       validasi ulang total dari katalog & tax_rate pada occurred_at
       insert order, order_line, payment, stock_movement,
              cash_movement, audit_event
       insert idempotency_key                    ← SATU TRANSAKSI
       insert outbox (event pasca-commit)
     COMMIT
  3. SigningHook (no-op di v1)
  4. Deteksi oversell → oversell_event bila stok negatif
  5. Kembalikan respons
```

**Aturan yang tidak boleh dilanggar:**

- Langkah 3 klien dan langkah 2 server masing-masing **satu transaksi**. Tidak ada pemecahan menjadi event asinkron.
- Idempotency key ditulis **dalam transaksi yang sama** dengan penjualan. Terpisah = jendela duplikasi.
- Server **tidak menolak** transaksi yang selisih perhitungannya — menerima, menandai, melaporkan (FR-H6).
- Event dipancarkan lewat **transactional outbox**, bukan dipublikasikan langsung.

---

## 5. Arsitektur sinkronisasi

### 5.1 Dua jalur yang sengaja dipisah

| | Jalur turun | Jalur naik |
|---|---|---|
| Isi | Katalog, harga, pajak, pengguna, konfigurasi, riwayat | Penjualan, void, refund, shift, movement, audit |
| Mekanisme | **PowerSync Open Edition** | **outbox_local → REST idempoten** |
| Alasan | Masalah generik, sudah diselesaikan engine teruji | Semantik POS spesifik: idempotency, penomoran, otorisasi, oversell |
| Risiko | Rendah — tidak menyentuh uang | Tinggi — inilah jalur uang |

**Konsekuensi lisensi yang disengaja:** jalur yang membawa uang tidak melewati kode pihak ketiga. Bila verifikasi lisensi PowerSync bermasalah, yang harus diganti hanya jalur turun — bagian yang jauh lebih sederhana.

### 5.2 Penggabungan status

Klien punya dua sumber status yang harus digabung menjadi satu untuk UI (`SyncIndicator` dengan state `ok`/`queued`/`failed`/`offline-only`):

```
statusGabungan =
  failed        bila ada item outbox_local berstatus 'failed'
  queued        bila ada item berstatus 'pending' atau 'sending'
  offline-only  bila tidak ada koneksi dan antrean kosong
  ok            bila terhubung, antrean kosong, dan turun ter-update
```

### 5.3 Waktu

**Hybrid Logical Clock** pada setiap record yang direplikasi. HLC untuk **pengurutan**; `occurred_at` untuk **tampilan**; `recorded_at` untuk **audit**.

Perangkat memajukan counter logisnya setiap menerima HLC lebih besar dari server. Selisih jam > 5 menit menghasilkan `audit_event`.

### 5.4 Resolusi konflik

| Data | Strategi |
|---|---|
| Transaksi, movement, audit | **Tidak ada konflik** — append-only, dua `INSERT` tidak pernah bentrok |
| Katalog, harga, pengaturan | LWW + HLC, konflik **dicatat** di audit |
| Order `open` | **Kepemilikan device** (`owned_by_device_id`) |
| Stok | Proyeksi dari movement — konvergen tanpa koordinasi |

**CRDT tidak dipakai.** POS bukan aplikasi kolaboratif — dua kasir membuat objek berbeda, tidak mengedit objek yang sama.

---

## 6. Port & adapter

Lima titik ekstensi. Implementasi v1 boleh trivial; **keberadaan port-nya yang penting.**

| Port | Antarmuka | v1 | Nanti |
|---|---|---|---|
| `TaxCalculator` | `calculate(draft, outletConfig, channel) → TaxBreakdown` | PBJT/PPN Indonesia | Pajak berjenjang, reverse-charge |
| `PaymentProvider` | `initiate` · `pollStatus` · `refund` · `void` · `settleReport` | Midtrans | Xendit, ECR/EDC, gateway merchant |
| `SigningHook` | `sign(transaction) → SignatureToken \| null` | **No-op** | TSE Jerman, fiscalization real-time |
| `ReceiptRenderer` | `render(ReceiptDocument, PrinterProfile) → bytes` | ESC/POS | Printer fiskal Italia (RT) |
| `PeripheralPort` | `printReceipt` · `openCashDrawer` · `onBarcodeScanned` · `listDevices` · `testDevice` | Tauri/Rust, Network, WebUSB, Noop | — |

**Urutan yang mengikat:** `commit → SigningHook → ReceiptRenderer`. Satu titik terpusat, bukan logika cetak tersebar di banyak layar. Menambahkan penandatanganan belakangan pada sistem yang tersebar adalah pekerjaan berminggu-minggu.

**`ReceiptDocument` sebagai perantara.** Aplikasi menghasilkan struktur deskriptif (baris, gaya, cut, drawer, logo); renderer menerjemahkannya ke byte. Tanpa pemisahan ini, mendukung printer fiskal berarti menyentuh layar kasir.

---

## 7. Klien — lapisan

```
┌────────────────────────────────────────────┐
│ UI (React)                                 │  komponen /ds-bundle
├────────────────────────────────────────────┤
│ View model / hooks                         │  state layar
├────────────────────────────────────────────┤
│ DOMAIN (dibagi dengan server)              │  ← TypeScript yang sama
│ perhitungan total · state machine · validasi│    dijalankan di dua sisi
├────────────────────────────────────────────┤
│ Repository (SQLite)                        │  query lokal
├────────────────────────────────────────────┤
│ Sync client · Peripheral client            │
└────────────────────────────────────────────┘
```

**Nilai terbesar berbagi TypeScript:** lapisan domain — terutama perhitungan total dan pajak — adalah **kode yang sama persis** yang berjalan di klien dan server. Ini menghilangkan seluruh kelas bug "klien dan server menghitung berbeda", dan membuat validasi ulang di server (FR-H6) menjadi pemeriksaan yang bermakna, bukan reimplementasi yang bisa menyimpang.

**Batasan platform yang harus ditangani:**

| Batasan | Penanganan |
|---|---|
| OPFS butuh header COOP/COEP | Di-set di server dan konfigurasi Tauri |
| COOP/COEP memutus `@import` lintas-origin | **Self-host font Inter** — sekaligus menyelesaikan masalah font offline |
| OPFS tidak didukung Firefox | Aplikasi kasir tidak mendukung Firefox; dinyatakan di requirement |
| SQLite WASM harus di Web Worker | Seluruh akses DB lewat worker; UI tetap 60 FPS |
| WebUSB gagal di Windows | Akses printer lewat Rust (Tauri); printer network sebagai jalur universal |

---

## 8. Deployment

### 8.1 Topologi

**Satu `docker-compose.yml` yang sama** untuk SaaS dan on-premise. Perbedaan hanya environment variable.

```
services:
  api            Fastify + modul     (SaaS: n instance · on-prem: 1)
  worker         queue + outbox      (1)
  sync           PowerSync Service   (1)
  postgres       PostgreSQL 17       (SaaS: managed/dedicated · on-prem: container)
  proxy          Caddy/nginx + TLS   (1)
```

**Setiap komponen harus punya justifikasi tertulis.** Daftar ini adalah kontrol terhadap penambahan komponen yang tidak perlu. Yang secara sadar **tidak ada**: Redis (tidak ada masalah terukur yang dipecahkannya di v1), message broker (PostgreSQL `SKIP LOCKED` cukup), search engine, Kubernetes.

### 8.2 Perbedaan lingkungan

| Variabel | SaaS | On-premise |
|---|---|---|
| `TENANT_MODE` | `multi` | `single` |
| `LICENSE` | `cloud` | file bertandatangan Ed25519 |
| `TELEMETRY` | `full` (opt-out) | `minimal`/`off` (**opt-in**) |
| `DB_HOST` | managed | container |

**On-premise adalah deployment single-tenant dari sistem multi-tenant yang sama** — bukan varian produk. Tenant tetap ada sebagai entitas dengan tepat satu baris.

### 8.3 Hosting

Cloud regional **Jakarta**. Alasan latensi bersifat menentukan: aplikasi kasir sudah offline-first, tetapi dashboard, sinkronisasi, dan pemrosesan pembayaran tetap melewati jaringan, dan RTT 200 ms+ terasa langsung di jam sibuk.

Yang dihindari secara sadar: managed service yang tidak punya padanan self-hosted. Setiap pemakaiannya menambah cabang di paket on-premise.

---

## 9. Keamanan

| Lapisan | Implementasi |
|---|---|
| Isolasi tenant | PostgreSQL RLS + `FORCE ROW LEVEL SECURITY`; aplikasi memakai user **tanpa** `BYPASSRLS`; `app.tenant_id` di-`SET LOCAL` **per transaksi** |
| Data kartu | Tidak pernah menyentuh sistem — EDC bersertifikat menanganinya |
| Password | Argon2id |
| PIN | Argon2id + salt; di-hash sebelum direplikasi; verifikasi lokal |
| In-transit | TLS 1.3, validasi sertifikat wajib |
| At-rest klien | SQLite terenkripsi, kunci di keystore OS (Keychain/Keystore/DPAPI) |
| At-rest server | Enkripsi disk + enkripsi kolom untuk data pribadi sensitif |
| Log | **Redaksi di lapisan logging**, bukan mengandalkan disiplin penulis kode |
| Token perangkat | Terikat device, dapat dicabut, umur pendek + refresh |
| Akses support | Berbatas waktu, butuh persetujuan merchant, tercatat penuh |

**Gate CI wajib:** test isolasi lintas-tenant untuk **setiap** tabel — buat dua tenant, coba baca dan tulis data tenant A dengan konteks tenant B, pastikan gagal.

---

## 10. Observability

| Metrik | Ambang alarm |
|---|---|
| **Umur antrean sinkronisasi tertua per device** | > 24 jam — **metrik kesehatan #1** |
| Item gagal sinkron per device | > 0 selama > 1 jam |
| Latensi p95 tambah item ke keranjang | > 100 ms |
| Kegagalan cetak per device | > 5% percobaan |
| Oversell terdeteksi | apa pun > 0 dilaporkan ke merchant |
| Selisih jam device vs server | > 5 menit |
| Crash rate per versi | > baseline versi sebelumnya (gate rollout) |
| Rasio waktu offline per outlet | > 20% jam operasional |

**Telemetry harus offline-first** — buffer persisten di disk, sama seperti data transaksi. Dan **tidak pernah menghambat aplikasi**: fire-and-forget dengan timeout pendek.

**Batas etis:** tidak pernah mengirim nama produk, harga, nilai transaksi, data pelanggan, atau nama merchant. Metrik dan tipe error saja.

---

## 11. Testing

| Lapisan | Cakupan | Alat |
|---|---|---|
| Unit — uang & pajak | **Prioritas tertinggi** — paling sering salah, paling terlihat merchant | Test biasa + property-based |
| Unit — domain | State machine, otorisasi, kuota | Test biasa |
| Integration — DB | **RLS/isolasi tenant**, migrasi, atomisitas transaksi | Database nyata di container, bukan mock |
| **DST — sinkronisasi** | Seluruh invariant dengan fault injection | Harness khusus |
| Contract — API | Klien versi N-1 vs server baru | Kontrak OpenAPI |
| E2E | **Lima alur kritis saja** | Playwright |
| Manual — hardware | Cetak, laci, scanner pada perangkat nyata | Checklist |

**Deterministic Simulation Testing** adalah keputusan desain yang harus diambil **sebelum** menulis kode sinkronisasi: waktu, keacakan, dan I/O jaringan **di-inject sebagai dependensi**. Retrofitnya mahal.

**Delapan invariant yang diuji sebagai property** — `[FAKTA]` divalidasi lewat prototipe DST, lihat `/prototypes/02-dst-sinkronisasi/FINDINGS.md`:

| # | Invariant | Menangkap |
|---|---|---|
| I1 | Konservasi — setiap order perangkat ada di server | Kehilangan data |
| I2 | Tanpa duplikasi — satu nomor struk = satu order server | Duplikasi |
| I3 | Konvergensi — himpunan server = gabungan perangkat | Divergensi |
| I4 | Monotonisitas nomor struk per (device, tanggal bisnis) | Penomoran rusak |
| I5 | Konservasi uang — total perangkat = total server | Uang hilang/muncul |
| **I6** | **Kemampuan jual offline** — nol penjualan gagal karena tidak ada koneksi | Regresi offline-first |
| **I7** | **Immutabilitas** — record server tidak berubah setelah tulis pertama | Pelanggaran append-only |
| **I8** | **Higienis idempotency** — satu order ≤ 1 idempotency key | Dedup yang diam-diam bergantung pada PK saja |

> ⚠️ **I6, I7, dan I8 ditambahkan setelah pengukuran.** Daftar awal (I1–I5) hanya menangkap **1 dari 5** cacat yang diinjeksikan — empat cacat nyata lolos tanpa terdeteksi. Harness yang hanya menguji I1–I5 memberi rasa aman palsu.

Plus, di luar lapisan sync: isolasi tenant · konsistensi pajak.

**Fault yang diinjeksikan:** jaringan putus di tengah upload · respons hilang setelah server sukses · duplikat request · request tidak berurutan · clock skew · storage penuh · aplikasi mati di tengah transaksi · dua device menjual item terakhir · sinkronisasi parsial.

**Yang sengaja tidak diprioritaskan:** cakupan E2E tinggi. Lima alur E2E yang selalu hijau lebih berguna daripada lima puluh yang sering merah karena alasan yang tidak berarti.

---

## 12. Rilis

| Elemen | Ketentuan |
|---|---|
| Jendela update | Default 03:00–06:00 waktu outlet; dapat dikonfigurasi merchant |
| Staged rollout | Kanari internal → 5% → 25% → 100%, jeda ≥24 jam, gate crash rate |
| Kemampuan menunda | Maksimal 2× oleh merchant |
| Update wajib segera | **Hanya** keamanan atau bug kehilangan data; kategori ini didefinisikan tertulis dan harus jarang |
| Rollback aplikasi | Versi sebelumnya disimpan di perangkat, berfungsi tanpa jaringan |
| Rollback skema lokal | **Hampir mustahil** — karena itu migrasi SQLite lokal **aditif-saja** sampai beberapa versi berlalu |
| Feature flag | Terpisah dari rilis; fitur berisiko dikirim mati, dinyalakan per merchant |
| Kill switch | Per fitur per merchant, dari server tanpa rilis — kebutuhan operasional, bukan kemewahan |

**API versioning:** versi mayor di path (`/v1/`), perubahan additive tidak menaikkan versi, versi lama hidup **minimal 12 bulan**. Klien mengirim versi aplikasi dan versi skema lokal di setiap request.

**Dua kontrak versi, bukan satu:** kontrak API **dan** kontrak skema SQLite lokal. Migrasi lokal harus berjalan pada perangkat yang tertinggal beberapa versi, offline, tanpa intervensi, dan gagal dengan aman (tetap bisa jualan dengan skema lama).

---

## 13. Insiden

| Sev | Definisi | Target respons |
|---|---|---|
| **SEV-1** | Merchant tidak bisa menyelesaikan penjualan | Segera, 24/7 |
| **SEV-2** | Bisa jualan tapi ada risiko kehilangan data | < 2 jam jam kerja |
| **SEV-3** | Fungsi non-kritis rusak | Hari kerja berikutnya |
| **SEV-4** | Kosmetik | Rilis berikutnya |

**Prinsip yang membedakan insiden POS:**

1. **Mitigasi pertama bukan memperbaiki, melainkan memulihkan kemampuan berjualan.** Kalau sinkronisasi rusak, matikan sinkronisasi — merchant tetap jualan, data aman di antrean.
2. **Jangan pernah menyuruh merchant menginstal ulang aplikasi atau menghapus data.** Itu menghapus transaksi yang belum tersinkron secara permanen. Larangan ini tertulis di runbook support.
3. **Alat koreksi data mengikuti aturan append-only yang sama.** Tidak pernah `UPDATE`/`DELETE` langsung di database — godaan terbesar saat tekanan tinggi, dan sekali dilakukan, audit trail merchant berbohong tanpa cara mengetahuinya.

**Backup:** RPO ≤ 5 menit (PITR via WAL archiving), RTO ≤ 2 jam, latihan restore kuartalan yang tercatat waktunya.

**Keunggulan struktural offline-first:** perangkat menyimpan salinan lokal. Bila server kehilangan data dalam jendela RPO, perangkat masih memilikinya — dan idempotency key (retensi 30 hari) memastikan rekonsiliasi ulang tidak menduplikasi.

---

## 14. Urutan build

| Fase | Isi | Gate |
|---|---|---|
| **F0** 2–3 mgg | Skema + RLS · SQLite lokal · self-host Inter · COOP/COEP · linter DS ke CI · test isolasi tenant | Test lintas-tenant hijau; aplikasi kosong berjalan di Tauri |
| **F1** 4–6 mgg | Modul catalog, ordering, payment · idempotency · append-only | Satu penjualan tersimpan atomik dengan pajak benar; property test invariant uang hijau |
| **F2** 5–8 mgg | Modul sync · buka shift offline · refund offline · outbox · HLC · **harness DST** | **0 transaksi hilang/duplikat** di bawah fault injection, 10.000 iterasi |
| **F3** 3–4 mgg | Modul cash, inventory, identity/audit, reporting | Buka toko → jual → tutup buku dengan angka konsisten antar laporan |
| **F4** 2–3 mgg | PeripheralPort · ESC/POS + profil printer · uji cetak | Cetak berhasil di ≥5 model; penjualan tetap tersimpan saat cetak gagal |
| **F5** 2–3 mgg | Tenancy, kuota, lisensi, onboarding, impor katalog | Merchant dapat mendaftar → impor → bertransaksi tanpa bantuan |
| **F6** 2 mgg | Staged rollout · observability · runbook · alat koreksi append-only | Runbook lengkap; alat koreksi ada **sebelum** insiden pertama |

**Total ±18–24 minggu.** Estimasi tidak menyertakan waktu penjualan, support, dan verifikasi open question — yang untuk solo builder sering 30–40%.

---

## 15. Keputusan yang ditunda dengan sengaja

| Keputusan | Kapan ditinjau |
|---|---|
| Redis untuk cache/queue | Rate limiting terdistribusi dibutuhkan, atau queue depth > 10.000 |
| Ekstraksi modul `sync` atau `reporting` | Metrik menunjukkan profil scaling berbeda |
| Double-entry penuh (chart of accounts) | Pelanggan pertama meminta ekspor ke software akuntansi |
| Hub lokal untuk KDS | v1.1, bersamaan dengan KDS |
| Paket on-premise | Pelanggan bayar biaya implementasi di muka |
| Zitadel untuk identitas | Kebutuhan SSO/SAML enterprise |
| Migrasi backend ke Go | Endpoint sync terbukti CPU-bound |
| Tauri mobile | Setelah prototipe (OQ-14) |

Setiap baris punya **pemicu yang dapat diukur**, bukan "nanti kalau perlu".

---

## 16. Open questions arsitektur

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| ~~Kuantitas `numeric` atau ×1000?~~ | ✅ **Terjawab: `INTEGER ×1000`.** `REAL` membuat `WHERE stok = 0` gagal | — |
| ~~OQ-07 jendela riwayat lokal~~ | ✅ **Terjawab: 90 hari = 39–130 MB.** Bahkan 180 hari aman | — |
| OQ-08 | Batas kredensial offline vs janji offline tak terbatas | F2 |
| OQ-03b | Konfirmasi tertulis lisensi PowerSync untuk redistribusi on-premise | Kontrak on-prem pertama, bukan v1 |
| — | PowerSync Cloud di awal (<100 merchant) lalu self-host, atau self-host sejak awal? | F2 |
| — | Skema PostgreSQL terpisah per modul untuk menegakkan kepemilikan tabel — layak atau terlalu berat? | F0 |
| — | Certificate pinning di aplikasi native — mempersulit rotasi sertifikat; trade-off belum diputuskan | F2 |

---

*Technical Architecture Lumi POS v1 · Draft 0.1 · 27 Juli 2026*
