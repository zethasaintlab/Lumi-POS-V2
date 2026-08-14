# Spec Modul H — Sinkronisasi & Status

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul H · **Riset:** `/research/05-OFFLINE-SYNC-STRATEGY.md` (KEP-20…KEP-23)

> ⚠️ **Area risiko tertinggi produk.** Bug di modul ini berarti uang merchant hilang atau tercatat dua kali. Deterministic Simulation Testing bukan opsional di sini.

---

## H.0 Ringkasan modul

Modul ini memindahkan data antara perangkat dan server dalam dua jalur yang sengaja dipisah:

```
        SERVER (PostgreSQL)
             │        ▲
    TURUN    │        │   NAIK
  PowerSync  │        │   Outbox lokal → REST idempoten
  (generik)  │        │   (semantik POS)
             ▼        │
        PERANGKAT (SQLite)
```

**Alasan pemisahan** (KEP-22): replikasi turun adalah masalah generik yang sudah diselesaikan engine teruji. Jalur naik punya semantik POS yang spesifik — idempotency, penomoran struk, validasi otorisasi, penanganan oversell — semuanya aturan bisnis, bukan mekanisme sinkronisasi. Menempatkannya di endpoint REST biasa membuatnya dapat di-test, di-log, di-debug, dan di-versioning dengan tooling biasa. Pemisahan ini juga membatasi paparan lisensi: **jalur yang membawa uang tidak melewati kode pihak ketiga.**

**Invariant:**

1. Tidak ada transaksi yang hilang. Tidak ada transaksi yang terduplikasi.
2. Antrean upload bertahan melewati restart aplikasi dan restart perangkat.
3. Operasi destruktif diblokir selama antrean tidak kosong.
4. Konvergensi: untuk urutan sinkronisasi apa pun, perangkat dan server akhirnya menyepakati himpunan transaksi yang sama.

---

## H.1 Jalur naik — outbox lokal

### FR-H1 [P0] — Antrean upload persisten

**Deskripsi.** Setiap mutasi yang dibuat perangkat masuk ke tabel `outbox_local` **dalam transaksi yang sama** dengan mutasi itu sendiri.

**Struktur `outbox_local`** (lokal-only, tidak direplikasi):

| Field | Catatan |
|---|---|
| `id` | ulid, urut waktu |
| `entity_type` | `order` · `shift` · `stock_movement` · `audit_event` · `cash_movement` |
| `entity_id` | ulid entitas |
| `operation` | `create` · `update` (hanya untuk entitas mutable) |
| `payload` | jsonb — snapshot lengkap saat dibuat |
| `idempotency_key` | ulid, di-generate saat item dibuat |
| `status` | `pending` · `sending` · `sent` · `failed` |
| `attempts` | integer |
| `last_error` | text nullable |
| `last_attempt_at` | timestamptz nullable |
| `created_at` | timestamptz |

**Aturan pengiriman.**

- Urutan pengiriman mengikuti `created_at` — dependensi dihormati (shift sebelum order, order sebelum refund order itu).
- Batch maksimum 50 item per request untuk membatasi ukuran payload dan waktu retry.
- Item yang gagal **tidak memblokir** item berikutnya yang tidak bergantung padanya.
- Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s, lalu tetap 60s.
- Setelah 20 percobaan gagal, status menjadi `failed` dan item muncul menonjol di layar Status Sinkronisasi. Item `failed` **tidak dihapus**.

**Acceptance criteria.**

- [ ] Item outbox ditulis dalam transaksi yang sama dengan entitasnya — injeksi kegagalan tidak pernah menghasilkan entitas tanpa item outbox
- [ ] Antrean bertahan melewati force-close aplikasi dan restart perangkat
- [ ] Urutan dependensi dihormati: shift terkirim sebelum order miliknya
- [ ] Item gagal tidak memblokir item independen
- [ ] Test: 1.000 item dalam antrean, jaringan putus-nyambung acak → semua terkirim tepat sekali

---

### FR-H6 [P0] — Validasi ulang di server

**Deskripsi.** Klien tidak dipercaya. Server menghitung ulang total transaksi dari katalog dan aturan pajak yang berlaku pada `occurred_at`.

**Behavior.**

```
GIVEN klien mengirim order dengan total Rp 93.600
WHEN server menghitung ulang dari order_line yang dikirim
THEN bila hasilnya sama, transaksi diterima tanpa penanda

WHEN hasilnya berbeda
THEN transaksi TETAP DITERIMA (menolaknya berarti kehilangan penjualan nyata)
 AND ditandai dengan `has_calculation_variance = true`
 AND selisihnya disimpan
 AND masuk laporan "Perlu diperiksa"
 AND audit_event type='calculation_variance' dibuat
```

**Aturan.** Server **tidak menolak** transaksi yang selisih. Menolak berarti kehilangan penjualan yang sudah terjadi dan uangnya sudah diterima merchant. Yang benar adalah menerima, menandai, dan melaporkan.

**Sumber selisih yang wajar:** harga berubah setelah perangkat terakhir tersinkron. Ini bukan anomali dan tidak boleh membanjiri laporan — server memeriksa apakah harga pada `occurred_at` cocok dengan harga yang dipakai klien sebelum menandai.

**Acceptance criteria.**

- [ ] Transaksi dengan selisih tetap diterima
- [ ] Selisih akibat harga yang berubah setelah sinkronisasi terakhir **tidak** ditandai
- [ ] Selisih yang tidak dapat dijelaskan ditandai dan dilaporkan
- [ ] Laporan "Perlu diperiksa" menampilkan konteks: device, waktu, selisih

---

## H.2 Jalur turun — replikasi

**Deskripsi.** Server → perangkat untuk: katalog, harga, modifier, kategori, `TaxRate`, konfigurasi outlet, pengguna & hash PIN, `VerticalProfile`, ambang otorisasi, profil printer, dan riwayat transaksi dalam jendela waktu tertentu.

**Aturan partial sync.** Perangkat **hanya** menerima data outletnya. Perangkat di Outlet A tidak pernah menerima data Outlet B. Ini sekaligus kontrol keamanan (perangkat curian) dan kontrol ukuran.

### FR-H7 [P0] — Jendela riwayat lokal

**Deskripsi.** Refund offline memerlukan riwayat transaksi di perangkat.

`[FAKTA — diukur 27 Jul 2026]` **OQ-07 terjawab: 90 hari dikonfirmasi aman.**

| Jendela | Kafe kecil (150 ord/hari) | Kafe menengah (300) | Kafe besar (500) |
|---|---:|---:|---:|
| 30 hari | 13 MB | 26 MB | 44 MB |
| **90 hari** | **39 MB** | **78 MB** | **130 MB** |
| 180 hari | 77 MB | 155 MB | 261 MB |

Angka perencanaan: **≈3,0 KB per order**, konsisten di seluruh skenario. Asumsi riset "di bawah 500 MB" terlalu konservatif.

Batas praktisnya bukan storage melainkan performa query stok — yang diselesaikan tabel `stock_snapshot` (lihat spec E). Jendela dapat diperpanjang melewati 90 hari bila terbukti bernilai jual.

*Sumber: `/prototypes/01-sqlite-sizing/FINDINGS.md` § 2*

**Aturan.**

- Riwayat direplikasi sebagai data **read-only** untuk pencarian dan refund.
- Di luar jendela, refund memerlukan koneksi, dengan pesan yang menjelaskan.
- Jendela dapat dikonfigurasi per tenant bila terbukti perlu.

**Acceptance criteria.**

- [ ] Refund transaksi dalam jendela berfungsi offline
- [ ] Refund di luar jendela ditolak dengan pesan yang menjelaskan, bukan "gagal"
- [ ] Ukuran database lokal diukur dan dilaporkan di layar Status Sinkronisasi
- [x] Prototipe pengukuran dijalankan — jendela 90 hari terkonfirmasi (`/prototypes/01-sqlite-sizing/`)
- [ ] Ukuran DB diukur ulang pada perangkat target nyata setelah prototipe Tauri (OQ-14)

---

## H.3 Waktu & urutan

### FR-H5 [P0] — Hybrid Logical Clock

**Deskripsi.** Jam perangkat kasir tidak dapat dipercaya. NTP menjaga jam dalam 100–250 ms pada kondisi baik, dan tablet kasir murah sering tidak ber-NTP sama sekali.

**Aturan.**

- Setiap record yang direplikasi membawa `hlc` (64-bit: physical timestamp + counter logis).
- HLC dipakai untuk **pengurutan**; `occurred_at` dipakai untuk **tampilan**; `recorded_at` untuk **audit**.
- Perangkat memperbarui HLC-nya setiap kali menerima HLC yang lebih besar dari server.

**Behavior.**

```
GIVEN perangkat memiliki jam 2 menit lebih lambat dari server
WHEN perangkat menerima respons server dengan HLC lebih besar
THEN perangkat memajukan counter logisnya
 AND transaksi berikutnya memiliki HLC yang terurut benar
 AND occurred_at TETAP menampilkan jam perangkat (untuk kasir)
```

**Acceptance criteria.**

- [x] Urutan transaksi berdasarkan HLC benar meskipun jam perangkat mundur — **I10** di `tests/dst/`, dengan jam yang benar-benar dimundurkan 1 detik sampai satu hari penuh
- [x] Transaksi dari dua perangkat dengan jam berbeda terurut konsisten di server — **I9**; tiap perangkat punya jamnya sendiri, saling geser mengelilingi ambang 5 menit di bawah
- [ ] Selisih jam > 5 menit menghasilkan audit event (lihat Modul F, FR-F8)

`[FAKTA — 8 Agustus 2026]` Sebelum ini, seluruh perangkat di harness DST **berbagi satu jam**, dan tidak ada satu pun invariant yang membaca `hlc`. Nilainya dihitung, disimpan, lalu diabaikan — jadi kedua AC di atas tidak sedang diuji oleh apa pun. Aturan "perangkat memperbarui HLC-nya dari server" juga tidak dapat dipenuhi siapa pun, karena model server tidak mengembalikan HLC sama sekali. Keduanya diperbaiki bersamaan; rinciannya di `docs/superpowers/plans/PLAN-fr-h5-hlc.md`.

---

### Resolusi konflik

**Deskripsi.** Karena penjualan bersifat append-only (KEP-17), konflik pada data transaksional **tidak mungkin terjadi secara struktural** — dua `INSERT` tidak pernah konflik. Yang tersisa hanyalah data mutable.

| Data | Strategi | Alasan |
|---|---|---|
| Transaksi, movement, audit | **Tidak ada konflik** | Append-only |
| Katalog, harga, pengaturan | **LWW + HLC** | Hampir selalu diedit dari dashboard (satu tempat, biasanya online); konflik nyata jarang |
| Order `OPEN` | **Kepemilikan device** | Satu order dimiliki satu device sampai dilepas eksplisit — bukan CRDT |
| Stok | **Proyeksi dari movement** | Konvergen tanpa koordinasi |
| Penandaan sold-out | LWW + HLC | |

**Aturan LWW.** Konflik yang terdeteksi **dicatat** di audit trail, tidak diselesaikan diam-diam. Merchant harus dapat mengetahui bahwa perubahan mereka ditimpa.

**CRDT tidak dipakai.** POS bukan aplikasi kolaboratif — dua kasir tidak mengedit objek yang sama, mereka membuat objek yang berbeda. Membayar kompleksitas CRDT untuk masalah yang tidak ada adalah kesalahan mahal.

**Acceptance criteria.**

- [ ] Tidak ada implementasi CRDT di codebase
- [ ] Konflik LWW yang terdeteksi menghasilkan audit event
- [ ] Order `OPEN` memiliki `owned_by_device_id`
- [ ] Property test konvergensi: untuk urutan sinkronisasi apa pun, semua replika sepakat

---

## H.4 Status yang terlihat pengguna

### FR-H2 [P0] — SyncIndicator per-record

**Deskripsi.** Design system sudah menetapkan komponen `SyncIndicator` dengan empat state: `ok` · `queued` · `failed` · `offline-only`. Ini berarti lapisan sinkronisasi **harus** mengekspos status per-item, bukan hanya boolean `isOnline`.

Sync engine yang hanya menyediakan `isOnline` tidak memenuhi kebutuhan — inilah salah satu alasan jalur naik dibangun sendiri.

**Pesan yang wajib didukung** (dari design system):

| State | Teks |
|---|---|
| Tersinkron | (ikon saja, tanpa teks menonjol) |
| Mengantre | `Offline · 3 menunggu` |
| Gagal | `Gagal kirim (2) · Coba lagi` |
| Offline-only | `Hanya di perangkat ini` |

**Acceptance criteria.**

- [ ] Status tersedia per-record, bukan hanya global
- [ ] Teks mengikuti design system persis
- [ ] Status tidak pernah warna saja — selalu ada teks (aturan design system #5)
- [ ] Indikator diperbarui < 1 detik setelah perubahan status

---

### FR-H3 [P0] — Layar Status Sinkronisasi

**Deskripsi.** Layar baru yang belum ada di design system.

**Isi:**

```
┌──────────────────────────────────────┐
│ Status Sinkronisasi                  │
│                                      │
│ Offline · terakhir tersinkron 2j lalu│
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Menunggu terkirim            14  │ │
│ │ Tertua: 2 jam lalu               │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ Gagal terkirim                2  │ │
│ │ [Coba lagi]  [Lihat detail]      │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Penyimpanan perangkat                │
│ ████████░░  312 MB / 2 GB            │
│                                      │
│ [Ekspor darurat]                     │
└──────────────────────────────────────┘
```

**Ekspor darurat.** Menghasilkan file berisi seluruh antrean yang belum terkirim, agar merchant memiliki salinan bila perangkat rusak. Ini adalah jaring pengaman terakhir dan harus selalu tersedia.

**Acceptance criteria.**

- [ ] Menampilkan jumlah antrean, umur item tertua, dan item gagal
- [ ] Tombol coba lagi memicu pengiriman ulang segera
- [ ] Detail item gagal menampilkan alasan yang dapat dipahami, bukan stack trace
- [ ] Ekspor darurat berfungsi offline dan menghasilkan file yang dapat dibaca manusia
- [ ] Penggunaan storage ditampilkan

---

### FR-H4 [P0] — Blokir operasi destruktif

**Deskripsi.** Pelajaran langsung dari daftar "jangan" milik Toast, di mana instruksi manual ("jangan uninstall aplikasi, jangan clear cache, jangan logout") melindungi data. Lumi POS menegakkannya **secara teknis**, bukan lewat dokumentasi.

| Operasi | Perilaku saat antrean tidak kosong |
|---|---|
| Logout | **Diblokir** dengan pesan yang menyebut jumlah item tertunda |
| Resync / muat ulang data | **Diblokir** — inilah operasi yang menghapus data tersimpan di Toast |
| Hapus data aplikasi | **Diblokir** dari dalam aplikasi; peringatan keras |
| Ganti outlet perangkat | **Diblokir** |
| Uninstall | Tidak dapat dicegah aplikasi. Mitigasi: data disimpan di lokasi yang tidak terhapus oleh clear-cache biasa, dan ekspor darurat tersedia |

**Behavior.**

```
GIVEN 14 item menunggu di antrean
WHEN kasir menekan Logout
THEN ditolak dengan pesan:
     "14 transaksi belum terkirim. Sambungkan ke internet
      atau ekspor data sebelum keluar."
 AND menawarkan [Coba kirim sekarang] dan [Ekspor darurat]
```

**Acceptance criteria.**

- [ ] Keempat operasi diblokir saat antrean tidak kosong
- [ ] Pesan menyebut jumlah item, bukan pesan generik
- [ ] Blokir ditegakkan di lapisan domain, bukan hanya menyembunyikan tombol
- [ ] Ekspor darurat ditawarkan sebagai jalan keluar

---

### FR-H8 [P1] — Notifikasi antrean menua

**Deskripsi.** Antrean yang tua berarti uang merchant belum tercatat — metrik kesehatan #1.

**Aturan.**

| Umur antrean tertua | Tindakan |
|---|---|
| > 4 jam | Peringatan di layar kasir |
| > 24 jam | Notifikasi ke owner + muncul di dashboard kesehatan internal |
| > 72 jam | Kontak proaktif dari support |

**Acceptance criteria.**

- [ ] Ambang dapat dikonfigurasi
- [ ] Notifikasi tidak mengganggu alur kasir di jam sibuk — muncul sebagai banner, bukan dialog
- [ ] Dashboard internal menampilkan merchant dengan antrean tua

---

## H.5 Pengujian — Deterministic Simulation Testing

**Deskripsi.** Bug sinkronisasi muncul dari kombinasi kondisi yang tidak akan ditulis manusia sebagai test case. DST menjalankan sistem terdistribusi pada satu thread dengan seluruh keacakan dikendalikan, lalu menginjeksikan fault. Teknik ini dipakai FoundationDB, MongoDB, dan **TigerBeetle** — database akuntansi finansial terdistribusi, domain yang hampir identik.

**Prasyarat desain yang harus diputuskan SEBELUM menulis kode sinkronisasi:** waktu, keacakan, dan I/O jaringan **di-inject sebagai dependensi**, bukan dipanggil langsung. Retrofitnya mahal.

**Sepuluh invariant yang diuji sebagai property.** `[FAKTA]` I1–I8 divalidasi lewat prototipe — lihat `/prototypes/02-dst-sinkronisasi/FINDINGS.md`. I9 dan I10 lahir belakangan, saat FR-H5 dikerjakan (8 Agustus 2026).

- [x] **I1 Konservasi** — tidak ada transaksi yang hilang untuk urutan operasi apa pun
- [x] **I2 Tanpa duplikasi** — satu nomor struk = tepat satu order di server
- [x] **I3 Konvergensi** — semua replika akhirnya sepakat pada himpunan transaksi
- [x] **I4 Monotonisitas struk** — nomor struk per (device, tanggal bisnis) berurutan rapat
- [x] **I5 Konservasi uang** — total perangkat = total server
- [x] **I6 Kemampuan jual offline** — nol penjualan gagal karena tidak ada koneksi
- [x] **I7 Immutabilitas** — record server tidak berubah setelah tulis pertama
- [x] **I8 Higienis idempotency** — satu order tidak punya lebih dari satu idempotency key
- [x] **I9 Urutan kausal** — apa pun yang perangkat **buat** setelah ia **melihat** keadaan server mengurutkan sesudah keadaan itu, meskipun jam melenceng
- [x] **I10 Monotonisitas HLC** — satu perangkat tidak pernah menghasilkan HLC yang tidak naik, apa pun yang terjadi pada jam dindingnya
- [ ] **Isolasi tenant** — tidak ada data lintas tenant dalam kondisi apa pun *(belum diuji di DST; lihat catatan jalur turun di bawah)*

> ⚠️ **I1–I5 saja tidak cukup.** Pengukuran menunjukkan lima invariant pertama hanya menangkap **1 dari 5** cacat yang diinjeksikan: regenerasi idempotency key, nomor struk dari server, dan void-sebagai-UPDATE semuanya lolos. I6, I7, dan I8 ditambahkan untuk menutupnya.
>
> ⚠️ **I1–I8 pun tidak melihat cacat HLC sama sekali.** Dua cacat yang disuntikkan saat FR-H5 dikerjakan — HLC diambil mentah dari jam dinding, dan perangkat mengabaikan HLC yang dikembalikan server — **tidak melanggar satu pun I1–I8**: tidak ada transaksi yang hilang, tidak ada yang ganda, uangnya cocok. Yang rusak hanya urutannya. I9 dan I10 ditambahkan untuk menutup itu, dan keduanya lahir dengan alasan yang sama persis dengan I6, I7, dan I8.
>
> ⚠️ **Isolasi tenant tidak dapat dijaga DST pada jalur TURUN.** Role replikasi PowerSync wajib `BYPASSRLS` (replikasi logis membaca WAL, dan RLS tidak berlaku di sana), jadi sync rules adalah satu-satunya batas tenant di sana. Dibuktikan lewat sabotase di `/prototypes/05-powersync-jalur-turun/FINDINGS.md`. Pemeriksaannya harus menyentuh **setiap tabel** — kebocoran satu tabel tidak terlihat oleh pemeriksaan pada tabel lain.
>
> **Baseline terukur:** protokol yang didokumentasikan lolos **2.000 iterasi** di prototipe, dan bertahan pada jaringan dengan 70% request hilang / 65% respons hilang / 50% duplikat pada 8 device. Implementasinya lolos **10.000 iterasi** di `tests/dst/`, termasuk setelah skew jam per perangkat ditambahkan.

**Fault yang wajib diinjeksikan:**

| Fault | Skenario nyata |
|---|---|
| Jaringan putus di tengah upload | Wi-Fi outlet tidak stabil |
| Respons hilang setelah server sukses | Timeout di sisi klien |
| Request duplikat | Retry otomatis |
| Request tiba tidak berurutan | Jaringan seluler |
| ✅ Jam device mundur/maju | Perangkat murah tanpa NTP, atau manipulasi — **diinjeksikan sejak 8 Agu 2026**: tiap perangkat berjam sendiri dengan skew, dan sesekali mundur |
| Storage penuh | Perangkat kapasitas kecil |
| Aplikasi mati di tengah transaksi | Baterai habis, force-close |
| Dua device menjual item terakhir | Alur nyata |
| Sinkronisasi parsial | Sebagian tabel berhasil, sebagian gagal |
| Server mengembalikan 5xx | Deployment, insiden |

**Acceptance criteria.**

- [x] Harness DST ada dan dapat dijalankan di CI — `npm run test:dst`, `.github/workflows/test.yml`
- [x] Bug yang ditemukan datang dengan **seed yang mereproduksinya persis** — tidak ada `Date.now()` maupun `Math.random()` di seluruh harness, dan ada test yang memindainya
- [ ] Seluruh invariant di atas diuji — I1–I10 hijau; **isolasi tenant belum**
- [ ] Seluruh fault di atas diinjeksikan — sudah: request hilang, respons hilang setelah server menulis, request duplikat, aplikasi mati di tengah, jam device melenceng/mundur. 5xx diinjeksikan di `tests/dst-server/`, bukan di harness murni. **Tersisa: storage penuh, request tiba tidak berurutan, dua device menjual item terakhir, sinkronisasi parsial**
- [x] DST dijalankan minimal 10.000 iterasi sebelum rilis F2 — gate-nya di suite, bukan dijalankan tangan

---

## H.6 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Antrean 5.000 item | Layar paginated; upload ber-batch 50; UI tetap responsif |
| Item gagal karena versi klien terlalu lama | Pesan spesifik: "Perbarui aplikasi sebelum [tanggal]"; penjualan offline tetap jalan |
| Item gagal karena data tidak valid | Item masuk `failed`; detail menampilkan alasan; **tidak dihapus otomatis** |
| Storage penuh saat antrean besar | Peringatan pada 80% dan 90%; pada 95% transaksi baru ditolak dengan tawaran ekspor darurat; transaksi berjalan tetap dapat diselesaikan |
| Perangkat offline 60 hari | Antrean tetap utuh; kredensial mungkin kedaluwarsa (OQ-08); shift berjalan tetap dapat ditutup |
| Server mengembalikan 409 untuk semua item | Kemungkinan bug klien; item masuk `failed` dengan detail; tidak retry tanpa batas |
| Jam device maju 1 tahun | HLC menjaga urutan; anomali ditandai menonjol; transaksi tetap tersimpan |
| Dua perangkat dengan kode device sama (kegagalan provisioning) | Server mendeteksi nomor struk bentrok, menolak yang kedua dengan pesan spesifik, dan menandai insiden untuk support |
| Merchant memindahkan perangkat ke outlet lain | Diblokir saat antrean tidak kosong; setelah kosong, memerlukan provisioning ulang |
| PowerSync (jalur turun) down, jalur naik normal | Penjualan tetap terkirim; katalog tidak diperbarui; UI menyatakan katalog mungkin usang |
| Konflik LWW pada harga | Nilai terakhir menang berdasarkan HLC; audit event dibuat; dashboard menampilkan perubahan yang ditimpa |

---

## H.7 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| ~~OQ-07~~ | ✅ **Terjawab: 90 hari muat nyaman** (39–130 MB). Bahkan 180 hari aman | — |
| OQ-08 | Batas kredensial offline | Implementasi bersama Modul F |
| OQ-03b | Konfirmasi tertulis lisensi PowerSync untuk redistribusi on-premise | Kontrak on-premise pertama, bukan v1 |
| — | Apakah PowerSync Cloud dipakai di awal (< 100 merchant) lalu self-host, atau self-host sejak awal? | Fase F2 |
| — | Ambang notifikasi antrean menua (4j / 24j / 72j) — validasi setelah beberapa merchant aktif | Setelah rilis |

---

*Spec Modul H · Lumi POS v1 · Draft 0.1*
