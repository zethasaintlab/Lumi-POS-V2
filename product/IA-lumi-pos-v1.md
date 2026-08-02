# Information Architecture — Lumi POS v1

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` · **Design system:** `/ds-bundle/readme.md` (final, tidak diubah)

> IA ini menurunkan struktur dari PRD dan spec modul. Setiap layar ditandai **offline-capable** atau **online-only** — pembagian ini menentukan bundel mana yang di-precache dan data mana yang direplikasi ke perangkat, sehingga ia adalah keputusan arsitektural, bukan hanya navigasi.

---

## 1. Tiga aplikasi, satu codebase

Design system mengunci tiga konteks fisik. IA mengikutinya.

| Aplikasi | Perangkat | Viewport | Persona | Bentuk |
|---|---|---|---|---|
| **Kasir** | Tablet/mini-PC di counter | 1024×768 | Kasir, Manajer Outlet | Tauri desktop (produksi) |
| **Back-office** | Laptop/desktop | ≥1280 | Owner, Manajer Area, Akuntan | Browser |
| **Owner mobile** | HP | 390×844 | Owner | Browser / PWA |
| *(KDS — v1.1)* | Monitor dapur | 1920×1080, `--scale 1.6` | Dapur, tanpa login | — |

**Aturan pembeda.** Ketiganya berbagi komponen dan token yang sama, tetapi **bukan navigasi yang sama**. Kasir tidak punya sidebar; back-office punya. Memaksakan satu navigasi ke tiga konteks adalah kesalahan yang merusak ketiganya.

---

## 2. Aplikasi Kasir

### 2.1 Struktur

```
┌─────────────────────────────────────────────────────────┐
│ TOPBAR (tetap)                                          │
│  Outlet · K1 · Sari      [SyncIndicator]  [⋮ Menu]     │
├──────────────────────────────────┬──────────────────────┤
│                                  │                      │
│  AREA UTAMA                      │  KERANJANG           │
│  (grid produk / layar aktif)     │  (kolom kanan        │
│                                  │   ≥900px; bottom     │
│                                  │   sheet di <900px)   │
│                                  │                      │
│                                  ├──────────────────────┤
│                                  │  [Bayar]  56px       │
└──────────────────────────────────┴──────────────────────┘
```

**Elemen tetap** (dari design system): topbar dan panel keranjang. Tombol kritis sticky di dasar.

### 2.2 Inventaris layar

| # | Layar | Offline | Akses | Catatan |
|---|---|:---:|---|---|
| K-01 | **Login PIN** (6 digit) | ✅ | Semua | Entry point; verifikasi hash lokal. **Tanpa opsi email/password** — permukaan kasir hanya menerima PIN |
| K-02 | **Buka Shift** | ✅ | Kasir+ | Wajib sebelum K-03; input saldo awal |
| K-03 | **Kasir** (grid produk + keranjang) | ✅ | Kasir+ | Layar utama; ≥12 kartu tanpa scroll |
| K-04 | Pilih Modifier (modal) | ✅ | Kasir+ | Muncul bila item punya `ModifierList` |
| K-05 | Pilih Variation (modal) | ✅ | Kasir+ | Hanya bila item punya >1 variation |
| K-06 | **Pembayaran** | ✅ | Kasir+ | Multi-payment; metode online-only nonaktif saat offline |
| K-07 | Konfirmasi & Kembalian | ✅ | Kasir+ | Angka `--text-display` |
| K-08 | **Riwayat Transaksi** | ✅ | Kasir+ | Dalam jendela riwayat lokal |
| K-09 | Detail Transaksi | ✅ | Kasir+ | Menampilkan rantai koreksi |
| K-10 | Void / Refund (ConfirmDialog) | ✅ | Kasir + PIN manajer | Alasan daftar tertutup |
| K-11 | Otorisasi Step-up (dialog) | ✅ | — | Tidak memutus sesi kasir |
| K-12 | **Tutup Kas** | ✅ | Kasir+ | Urutan input wajib |
| K-13 | Laporan Shift | ✅ | Kasir (miliknya) | Dapat dicetak |
| K-14 | **Status Sinkronisasi** | ✅ | Kasir+ | **Layar baru, belum ada di DS** |
| K-15 | Perangkat & Uji Cetak | ✅ | Manajer+ | Profil printer, halaman uji |
| K-16 | Buka Laci (no-sale) | ✅ | Kasir + alasan | Dialog, bukan layar |
| K-17 | Cari Produk / Scan | ✅ | Kasir+ | Listener barcode global |

**Semua layar kasir offline-capable.** Tidak ada satu pun yang online-only — ini konsekuensi langsung dari posisi produk.

### 2.3 Alur navigasi

```
   [K-01 Login PIN]
          │
   ┌──────┴───────┐
   │ Shift aktif? │
   └──┬────────┬──┘
     tidak    ya
      │        │
 [K-02 Buka    │
   Shift]      │
      └────┬───┘
           ▼
   ╔═══════════════╗
   ║ K-03 KASIR    ║◄────────────────────┐
   ╚═══╤═══════════╝                     │
       │                                 │
   ┌───┼─────┬─────────┬──────────┐      │
   ▼   ▼     ▼         ▼          ▼      │
 K-17 K-05  K-04    [Bayar]    [⋮ Menu]  │
 cari var.  modif.      │          │      │
                        ▼          │      │
                  [K-06 Bayar]     │      │
                        ▼          │      │
                  [K-07 Kembalian]─┘      │
                                          │
       Menu ⋮ ──┬── K-08 Riwayat ── K-09 ─┤
                ├── K-12 Tutup Kas ── K-13│
                ├── K-14 Status Sync      │
                ├── K-15 Perangkat        │
                └── K-16 Buka Laci ───────┘
```

**Aturan kedalaman.** Dari K-03, setiap fungsi dapat dicapai dalam **maksimal 2 tap**. Produk apa pun dicapai maksimal 2 tap (kategori → produk), konsekuensi batas kategori dua tingkat.

### 2.4 Layar baru yang belum ada di design system

| Layar | Mengapa dibutuhkan | Komponen yang dipakai ulang |
|---|---|---|
| **K-14 Status Sinkronisasi** | `SyncIndicator` di DS hanya indikator; layar tujuannya belum ada | `Card`, `Badge`, `Table`, `Button`, `EmptyState` |
| **K-15 Perangkat & Uji Cetak** | Profil printer sebagai data butuh UI; halaman uji cetak adalah requirement onboarding | `Card`, `Field`, `Button`, `Badge` |

`SyncIndicator` di topbar adalah **entry point** ke K-14. Relasi ini harus eksplisit — indikator yang tidak dapat diklik membuat kasir tidak tahu harus berbuat apa.

---

## 3. Back-office

### 3.1 Struktur

Memakai `AppShell` dari design system: sidebar berkelompok + topbar breadcrumb + konten.

### 3.2 Sidebar — pengelompokan mencerminkan batas modul

```
┌──────────────────────┐
│ Lumi POS             │
│ [Outlet switcher ▾]  │  ← multi-outlet sebagai konsep kelas satu,
├──────────────────────┤     bukan switcher yang ditempel
│ RINGKASAN            │
│   Dashboard          │
├──────────────────────┤
│ PENJUALAN            │
│   Transaksi          │
│   Shift              │
├──────────────────────┤
│ KATALOG              │
│   Produk             │
│   Kategori           │
│   Modifier           │
│   Harga              │
│   Impor              │
├──────────────────────┤
│ INVENTORI            │
│   Stok               │
│   Penyesuaian        │
│   Opname             │
│   Perlu diperiksa 🔴 │  ← oversell + selisih perhitungan
├──────────────────────┤
│ LAPORAN              │
│   Penjualan          │
│   Produk             │
│   Kasir              │
│   Pembayaran         │
│   Ekspor             │
├──────────────────────┤
│ PENGAWASAN           │  ← terpisah dari LAPORAN secara sadar
│   Laporan exception  │
│   Audit & Aktivitas  │
├──────────────────────┤
│ PENGATURAN           │
│   Outlet             │
│   Profil vertikal    │
│   Pajak              │
│   Ambang otorisasi   │
│   Pengguna & Peran   │
│   Perangkat          │
│   Langganan & Batas  │
└──────────────────────┘
```

**Mengapa PENGAWASAN dipisah dari LAPORAN.** Laporan menjawab "apa yang terjadi"; pengawasan menjawab "apa yang tidak wajar". Mencampurnya membuat laporan exception tenggelam di antara laporan rutin, dan laporan exception adalah yang dibeli owner.

### 3.3 Inventaris layar back-office

| # | Layar | Offline | Akses minimum |
|---|---|:---:|---|
| B-00 | **Login** (email + password) | ❌ | — |
| B-01 | Dashboard | ❌ | Manajer Outlet |
| B-02 | Transaksi (daftar + filter) | ❌ | Manajer Outlet |
| B-03 | Detail Transaksi | ❌ | Manajer Outlet |
| B-04 | Shift (daftar) | ❌ | Manajer Outlet |
| B-05 | Detail Shift | ❌ | Manajer Outlet |
| B-06 | Produk (daftar) | ❌ | Manajer Area |
| B-07 | Edit Produk + Variation | ❌ | Manajer Area |
| B-08 | Kategori | ❌ | Manajer Area |
| B-09 | Modifier List | ❌ | Manajer Area |
| B-10 | Harga & Riwayat Harga | ❌ | Manajer Area |
| B-11 | **Impor Katalog** | ❌ | Manajer Area |
| B-12 | Stok (daftar + level) | ❌ | Manajer Outlet |
| B-13 | Penyesuaian Stok | ❌ | Manajer Outlet |
| B-14 | Opname | ❌ | Manajer Outlet |
| B-15 | **Perlu Diperiksa** (oversell + selisih) | ❌ | Manajer Outlet |
| B-16 | Laporan Penjualan | ❌ | Manajer Outlet |
| B-17 | Laporan Produk | ❌ | Manajer Outlet |
| B-18 | Laporan Kasir | ❌ | Manajer Outlet |
| B-19 | Laporan Pembayaran & Rekonsiliasi | ❌ | Manajer Outlet |
| B-20 | Ekspor | ❌ | Akuntan |
| B-21 | **Laporan Exception** (8 laporan) | ❌ | Manajer Outlet |
| B-22 | **Audit & Aktivitas** | ❌ | Manajer Outlet |
| B-23 | Pengaturan Outlet | ❌ | Manajer Area |
| B-24 | **Profil Vertikal** | ❌ | Owner |
| B-25 | **Pajak** (TaxRate) | ❌ | Owner |
| B-26 | Ambang Otorisasi | ❌ | Manajer Area |
| B-27 | Pengguna & Peran | ❌ | Manajer Outlet (kasir saja) |
| B-28 | **Perangkat** | ❌ | Manajer Outlet |
| B-29 | Langganan & Batas | ❌ | Owner |

**Seluruh back-office online-only.** Ini keputusan sadar: back-office diakses dari laptop dengan koneksi, dan membuatnya offline berarti mereplikasi seluruh data tenant ke browser — biaya besar tanpa kebutuhan nyata.

---

## 4. Owner mobile

### 4.1 Prinsip

Persona P3 membuka aplikasi **pukul 23:00 untuk satu pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan menyediakan navigasi lengkap.

### 4.2 Struktur

```
┌────────────────────────┐
│ [Outlet ▾]        [⋮]  │
├────────────────────────┤
│                        │
│  RINGKASAN HARI INI    │  ← layar pertama = jawaban,
│  (satu layar,             bukan menu
│   tanpa scroll)        │
│                        │
│  ⚠ 2 perlu diperiksa   │  ← muncul hanya bila ada
│                        │
├────────────────────────┤
│ [Laporan] [Otorisasi]  │  ← bottom nav, 2 item saja
└────────────────────────┘
```

| # | Layar | Offline | Catatan |
|---|---|:---:|---|
| M-00 | **Login** (email + password) | ❌ | Entry point; kredensial sama dengan back-office |
| M-01 | **Ringkasan Hari Ini** | ❌ | Layar pertama setelah login; satu layar tanpa scroll |
| M-02 | Perlu Diperiksa | ❌ | Drill-down dari peringatan di M-01 |
| M-03 | Laporan (ringkas, mobile) | ❌ | Subset dari back-office |
| M-04 | Otorisasi Jarak Jauh | ❌ | **v1.1** — lihat catatan di bawah |

**M-04 tidak ada di v1.** Otorisasi memerlukan kehadiran fisik di perangkat kasir (spec F § F.6). Otorisasi jarak jauh menyelesaikan masalah nyata (manajer sedang cuti) tetapi membuka vektor fraud baru, dan keputusannya ditunda.

**Bottom nav hanya 2 item.** Menambah item ketiga berarti IA-nya sudah bergeser dari "satu pertanyaan" menjadi "aplikasi manajemen", dan itu bukan yang dibutuhkan pukul 23:00.

---

## 5. Peta offline-capable versus online-only

Ini tabel yang menentukan apa yang di-precache dan direplikasi.

| Kelompok | Offline | Data yang direplikasi ke perangkat |
|---|:---:|---|
| Seluruh aplikasi Kasir (K-01…K-17) | ✅ | Katalog outlet · harga · modifier · kategori · `TaxRate` · pengguna + hash PIN outlet · `VerticalProfile` · ambang otorisasi · profil printer · riwayat transaksi dalam jendela (OQ-07) · movement stok agregat |
| Seluruh Back-office (B-01…B-29) | ❌ | — |
| Seluruh Owner mobile (M-01…M-03) | ❌ | — |

**Aturan empty state untuk layar online-only** (dari design system: kegagalan menjelaskan **alasan**, bukan spinner tanpa akhir):

```
┌────────────────────────────────────┐
│  Perlu internet                    │
│                                    │
│  Laporan lintas-outlet mengambil   │
│  data dari semua cabang, jadi      │
│  butuh koneksi.                    │
│                                    │
│  Yang tersedia sekarang:           │
│  → Laporan shift perangkat ini     │
│                                    │
│  [Lihat laporan shift]             │
└────────────────────────────────────┘
```

Tiga elemen wajib: **alasan** · **apa yang tersedia sebagai gantinya** · **jalan keluar**.

---

## 6. Konsep "mode" — di mana profil vertikal hidup

Profil vertikal (F&B / retail) berada di **tingkat outlet**, dengan default diturunkan dari tenant.

**Lokasi di IA:** `Pengaturan → Profil vertikal` (B-24), akses Owner.

**Efek yang terlihat langsung setelah diubah:**

| Elemen | F&B | Retail (v1.3) |
|---|---|---|
| Input primer di K-03 | Grid produk | Field barcode + grid |
| `SegmentedControl` Dine In/Takeaway | Muncul | Tidak muncul |
| Menu Meja & KDS (v1.1) | Muncul | Tidak muncul |
| Konversi satuan di B-07 | Tidak muncul | Muncul |
| Retur barang | Tidak muncul | Muncul |
| Preset pajak | PBJT | PPN |

**Aturan yang mengikat.** Perbedaan vertikal hanya boleh dibaca dari `VerticalProfile`. Kemunculan `if (vertical === 'fnb')` di luar lapisan yang membaca profil adalah tanda desain bocor dan menjadi item review — sama seperti aturan di technical architecture.

---

## 7. Struktur URL

Konsisten, dapat di-bookmark, dan menyatakan konteks outlet secara eksplisit.

```
/kasir                                  aplikasi kasir (Tauri)
  /login
  /shift/buka
  /                                     layar kasir
  /riwayat
  /riwayat/:orderId
  /shift/tutup
  /sync
  /perangkat

/app                                    back-office
  /login                                email + password
  /                                     dashboard
  /o/:outletId/transaksi
  /o/:outletId/transaksi/:id
  /o/:outletId/shift
  /katalog/produk
  /katalog/produk/:id
  /katalog/kategori
  /katalog/modifier
  /katalog/impor
  /o/:outletId/stok
  /o/:outletId/stok/opname
  /o/:outletId/perlu-diperiksa
  /laporan/penjualan
  /laporan/produk
  /laporan/kasir
  /laporan/pembayaran
  /pengawasan/exception
  /pengawasan/audit
  /pengaturan/outlet
  /pengaturan/vertikal
  /pengaturan/pajak
  /pengaturan/ambang
  /pengaturan/pengguna
  /pengaturan/perangkat
  /pengaturan/langganan

/m                                      owner mobile
  /login                                email + password
  /                                     ringkasan
  /perlu-diperiksa
  /laporan
```

**Aturan `/o/:outletId/`.** Layar yang datanya outlet-scoped membawa outletId di URL; layar tenant-scoped (katalog, pengaturan) tidak. Ini membuat konteks eksplisit dan mencegah bug "melihat data outlet yang salah".

---

## 8. Notifikasi & peringatan — di mana muncul

| Peristiwa | Kasir | Back-office | Owner mobile |
|---|---|---|---|
| Offline | `SyncIndicator` topbar | — | — |
| Antrean > 4 jam | Banner (bukan dialog) | — | — |
| Antrean > 24 jam | Banner menonjol | Badge di Perangkat | Notifikasi |
| Oversell terdeteksi | — | Badge di Perlu Diperiksa | Bagian "perlu diperiksa" |
| Selisih perhitungan | — | Badge di Perlu Diperiksa | — |
| Stok rendah | Badge pada kartu produk | Badge di Stok | — |
| Anomali exception (mingguan) | — | Badge di Pengawasan | Ringkasan mingguan, maks 3 temuan |
| Kuota mendekati batas | — | Banner di Dashboard | — |
| Versi aplikasi terlalu lama | Banner dengan tanggal batas | — | — |
| Pembayaran `pending_confirmation` > 24 jam | — | Perlu Diperiksa | Bagian "perlu diperiksa" |

**Aturan.** Di layar kasir, peringatan **tidak pernah** berupa dialog yang memblokir — kasir sedang melayani antrean. Banner atau badge saja.

---

## 9. Onboarding merchant baru

Design system melarang onboarding in-app, wizard, dan tooltip. Yang tersisa adalah **urutan tugas yang jelas di back-office**, bukan tur berpandu.

```
Dashboard merchant baru
┌────────────────────────────────────┐
│ Siapkan Lumi POS                   │
│                                    │
│ ☑ Buat akun                        │
│ ☐ Tambah produk         [Mulai]    │  ← atau Impor
│ ☐ Atur pajak            [Mulai]    │
│ ☐ Hubungkan perangkat   [Mulai]    │
│ ☐ Uji cetak struk       [Mulai]    │
│ ☐ Transaksi pertama                │
└────────────────────────────────────┘
```

Hilang otomatis setelah semua selesai. Bukan modal, bukan wizard — kartu di dashboard yang dapat diabaikan.

**Urutan ini bukan sembarang.** Uji cetak diletakkan **sebelum** transaksi pertama karena masalah printer yang ditemukan saat transaksi pertama di depan pelanggan adalah pengalaman yang merusak kepercayaan sejak hari pertama.

---

## 10. Yang sengaja tidak ada di IA v1

| Tidak ada | Alasan |
|---|---|
| Menu Meja / Denah | Table management adalah v1.1 |
| Menu KDS | v1.1 |
| Menu Resep / BOM | v1.2 |
| Menu Pembelian / Supplier | v1.3 |
| Menu Pelanggan & Loyalty | Loyalty v1.2; data pelanggan dasar melekat di transaksi |
| Menu Promo | v1.2 |
| Menu Transfer Stok | v1.1 |
| Menu Integrasi (aggregator) | v1.1 |
| Wizard onboarding | Dilarang design system |
| Tooltip & tur berpandu | Dilarang design system |
| Dark mode | Di luar scope design system |
| Otorisasi jarak jauh | Vektor fraud belum diputuskan |

---

## 11. Konsistensi dengan design system

| Aturan DS | Cara IA mematuhinya |
|---|---|
| Tepat 4 ukuran teks | Tidak ada layar yang memperkenalkan hierarki tipografi baru |
| Satu aksen teal, satu aksi utama per layar | K-03 → Bayar · K-12 → Tutup Kas · B-07 → Simpan · setiap layar punya tepat satu primary |
| Target sentuh ≥44px, aksi uang 56px | Bayar, Tutup Kas, konfirmasi void = 56px |
| Status tidak pernah warna saja | Semua badge dan indikator membawa teks |
| Setiap komponen punya keadaan kosong & error | Setiap layar daftar punya dua empty state berbeda: "belum ada data" dan "tidak cocok filter" |
| Density: min 12 kartu produk tanpa scroll | K-03 diuji pada 1024×768 |
| Bahasa Indonesia, nada operasional | Seluruh label dan pesan |

---

## 12. Open questions IA

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Apakah gambar produk ditampilkan di grid K-03? DS melarang imagery, tetapi kompetitor memakainya dan merchant mungkin mengharapkannya | Desain K-03 |
| — | Apakah `Akuntan` punya navigasi sendiri yang disederhanakan, atau back-office penuh dengan menu tersembunyi? | Implementasi B-20 |
| — | Owner mobile: PWA yang dapat dipasang, atau situs biasa? PWA memberi ikon di home screen — relevan untuk Goal G4 (owner membuka ≥4×/bulan) | Implementasi M-01 |
| ~~OQ-09~~ | ✅ **Terjawab 1 Agu 2026 — per outlet dengan default tenant**, sesuai asumsi IA. B-24 karena itu mengedit profil **milik outlet**, dengan indikator apakah nilainya diwarisi dari pusat atau di-override cabang | — |

---

*IA Lumi POS v1 · Draft 0.1 · 27 Juli 2026*
