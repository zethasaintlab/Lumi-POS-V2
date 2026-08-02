# PRD: Lumi POS v1

**Status:** Draft · **Owner:** Dimas Satria Erlangga · **Last updated:** 27 Juli 2026 · **Version:** 0.1

> **Dokumen induk.** Berisi problem, goals, non-goals, persona, alur utama, functional requirement tingkat tinggi, data model, edge case, dan release plan. Detail per requirement ada di **spec modul** (`/product/specs/`).
>
> **Basis faktual:** seluruh klaim di dokumen ini bersumber dari paket riset `/research/` (14 dokumen, 39 keputusan bernomor KEP-01…KEP-39) dan `/research/13-DECISION-LOG.md` (keputusan OQ-01…OQ-06). Rujukan ditulis sebagai `[KEP-xx]` atau `[Fase n]`.
>
> **Penanda:** `[FAKTA]` = terverifikasi di riset · `[ASUMSI]` = belum divalidasi, ditandai agar tidak menyamar jadi fakta.

---

## 1. Summary

Lumi POS adalah point-of-sale untuk kafe takeaway 2–20 outlet di Indonesia yang tetap berfungsi penuh tanpa internet — termasuk membuka shift, refund, dan menutup kas — dengan batas kemampuan yang tertulis eksplisit alih-alih ditemukan merchant saat outage. v1 melayani vertikal F&B; data model disiapkan multi-vertikal agar retail bisa menyusul tanpa penulisan ulang.

Produk ini dijual sebagai lisensi berlangganan per outlet, bukan disubsidi dari transaksi — `[FAKTA]` MDR QRIS dipatok Bank Indonesia dan merchant dilarang membebankannya ke konsumen, sehingga model Square tidak tersedia di Indonesia [Fase 6, Fase 11].

---

## 2. Problem

**Nyeri utama:** outlet berhenti berjualan ketika internet mati.

Ini bukan ketidaknyamanan — ini kerugian yang berjalan per menit dan bersifat permanen, karena pelanggan yang pergi tidak kembali. Untuk merchant di luar kota besar Indonesia, putus internet adalah kejadian mingguan, bukan tahunan `[ASUMSI — frekuensi belum divalidasi lapangan]`.

**Yang dilakukan merchant hari ini:**

| Status quo | Kekurangannya |
|---|---|
| Moka, Majoo, Olsera, Pawoon | `[FAKTA]` Offline terbatas; kompetitor cloud-native umumnya mendefinisikan offline sebagai *degraded mode* |
| ESB | `[FAKTA]` Kuat di F&B (30.000+ restoran) tetapi F&B murni — merchant hybrid harus pakai dua sistem |
| Qasir, Kasir Pintar, Loyverse (gratis) | Fungsional untuk satu outlet, tidak untuk operasi antar-outlet |
| Catat manual saat sistem mati | Rekonsiliasi tidak pernah cocok; stok tidak terlacak |

**Batas offline kompetitor yang terdokumentasi** `[FAKTA]` [Fase 1 § 6, Fase 5 § 2]:

- **Shopify POS**: tanpa pembayaran kartu, **tanpa update stok, tanpa refund, tanpa akses data pelanggan**.
- **Odoo POS**: **tidak bisa membuka sesi POS baru** tanpa internet.
- **Toast**: **tidak bisa login/logout** saat offline; order tidak dibagi antar POS device bahkan dengan hub LAN.
- **Lightspeed**: butuh appliance fisik (Lightserver); tanpa internet tidak ada pembayaran kartu.

**Nyeri kedua:** owner tidak bisa melihat ke mana uang bocor. `[FAKTA]` Area berisiko tertinggi fraud di restoran adalah cash handling, void & refund, dan inventory [Fase 8]. Pola deteksinya sudah dikenal industri — void di akhir shift, no-sale berulang, diskon manual besar — tetapi merchant tidak punya alatnya.

---

## 3. Goals & Success Metrics

Baseline seluruhnya **nol** karena greenfield. Target diukur **3 bulan setelah rilis komersial pertama**.

| # | Goal | Metrik | Baseline | Target |
|---|---|---|---|---|
| G1 | Produk dipakai sungguhan, bukan dicoba lalu ditinggal | Merchant berbayar aktif (≥1 transaksi dalam 7 hari) | 0 | **10** |
| G2 | Klaim offline terbukti di lapangan, bukan di lab | Merchant menyelesaikan hari operasional penuh (buka shift → tutup kas) selama outage, tanpa menghubungi support | 0 | **≥3 kejadian terverifikasi** |
| G3 | Tidak ada uang hilang | Transaksi hilang atau terduplikasi di produksi | 0 | **0 — gate rilis, bukan target** |
| G4 | Owner melihat nilai yang dibayarnya | Merchant dengan owner membuka dashboard ≥4× per bulan | 0 | **70%** |
| G5 | Beban support terkendali untuk satu orang | Tiket support per merchant per bulan | 0 | **< 2** |

`[ASUMSI]` Kelima target adalah angka usulan, belum divalidasi.

**Catatan tentang G1:** 10 merchant sengaja kecil. Pada skala ini yang diuji adalah apakah produknya benar, bukan apakah bisa tumbuh. `[FAKTA]` Model biaya menunjukkan biaya tetap mendominasi di bawah ~50 merchant [Fase 11 § 5.4] — pertumbuhan adalah target fase berikutnya.

**Catatan tentang G3:** ini satu-satunya metrik yang diperlakukan sebagai **syarat**, bukan target. Satu transaksi hilang di produksi menghentikan rilis berikutnya sampai akar masalahnya ditemukan dan test yang seharusnya menangkapnya ditambahkan.

**Goal direksional tanpa metrik** (diakui sebagai direksional, tidak dipaksa jadi angka): produk terasa tenang dan bisa dipakai kasir tanpa pelatihan formal. Design system sudah menetapkan arah ini ("tidak ada onboarding in-app, tidak ada wizard basa-basi") tetapi belum ada cara mengukurnya yang jujur di v1.

---

## 4. Non-Goals

Bagian ini mengikat. Setiap item punya alasan agar tidak kembali lewat scope creep, dan agar coding agent tidak "membantu" membangunnya.

### 4.1 Tidak dibangun di v1

| Non-goal | Alasan |
|---|---|
| **Kitchen Display System (KDS)** | Kafe takeaway beroperasi penuh tanpanya. Butuh transport lokal-outlet yang sama dengan table management dan hub lokal — dibangun sekaligus di v1.1 [OQ-01] |
| **Table & floor management** | Sama dengan di atas; konsekuensi keputusan segmen v1 = takeaway |
| **Berbagi order antar POS device saat offline** | `[FAKTA]` Toast pun tidak menyediakannya. Biaya 10–16 minggu dengan permukaan bug besar [KEP-20, OQ-01] |
| **Paket on-premise / self-hosted** | 8–14 minggu awal + 15–25% overhead permanen setiap rilis, terhadap pendapatan nol [KEP-33, OQ-02]. Arsitekturnya tetap disiapkan |
| **UI & alur vertikal retail** | Data model disiapkan multi-vertikal, tetapi barcode-first flow, konversi satuan, dan retur tidak dibangun [KEP-03] |
| **Resep / BOM & food cost** | Butuh data master yang jarang siap di merchant baru; nilainya baru terasa setelah 3 bulan data penjualan |
| **Purchasing & supplier** | Dikelola merchant di WhatsApp/Excel; tidak menghalangi penutupan buku harian |
| **Loyalty & poin** | Table stakes kompetitif, bukan table stakes operasional |
| **Promo lanjutan** (bundle, happy hour, buy-X-get-Y) | Diskon manual menutupi mayoritas kasus awal |
| **Transfer stok antar outlet** | Merchant biasanya membuka outlet kedua setelah 6+ bulan |
| **Integrasi GoFood / GrabFood / ShopeeFood** | Table stakes pasar, tetapi lead time persetujuan partner di luar kendali. Proses administratif dimulai sekarang, integrasi v1.1 [OQ-06] |
| **Integrasi EDC (ECR)** | Butuh perangkat fisik, kontrak bank, dan sertifikasi — bergantung pihak eksternal [KEP-26] |
| **Timbangan terintegrasi** | Fragmentasi protokol per merek; input berat manual sudah didukung |
| **Customer-facing display** | Butuh transport lokal-outlet (v1.1); tidak ada komponennya di design system |
| **Aplikasi mobile native** | Tauri mobile butuh validasi prototipe lebih dulu [OQ-14] |
| **Integrasi API Coretax** | Diganti ekspor rekapitulasi penjualan. `SigningHook` disiapkan sebagai port kosong [OQ-04] |

### 4.2 Tidak akan dibangun — permanen

| Non-goal | Alasan |
|---|---|
| **Pemrosesan data kartu di dalam POS** | Menempatkan setiap tablet merchant di dalam PCI CDE. Kartu ditangani terminal EDC bersertifikat; POS hanya menerima approval code, 4 digit terakhir, dan referensi [KEP-29] |
| **Pembayaran QRIS *dinamis* saat offline** | Mustahil secara teknis — alur QRIS dinamis butuh konfirmasi issuer [Fase 6 § 4]. **Batas ini khusus QRIS dinamis.** QRIS *statis* (QR cetak milik merchant, konfirmasi manual kasir) berfungsi offline dan **didukung** [OQ-15 terjawab] — lihat FR-C2 dan § 8.2 |
| **Pencegahan oversell saat offline** | Konsekuensi teorema CAP, bukan kekurangan implementasi. Diganti **deteksi & pelaporan** pasca-sinkronisasi [KEP-23] |
| **Dukungan browser Firefox untuk aplikasi kasir** | `[FAKTA]` OPFS belum didukung Firefox; SQLite lokal tidak berjalan. Dashboard owner tetap didukung [KEP-11] |

---

## 5. Users & Use Cases

Persona dan konteks fisiknya **dikunci oleh design system** dan tidak boleh ditambah tanpa memicu revisi design system. `[FAKTA]` `/ds-bundle/readme.md`.

### 5.1 Persona

**P1 — Kasir (pengguna utama)**
Berdiri di counter, tablet 10" (1024×768), sering satu tangan, tangan sering basah. Shift 6–8 jam. Turnover tinggi — sistem harus bisa dipakai tanpa pelatihan formal. Tidak melihat margin atau HPP. Bekerja di jam sibuk di mana setiap detik terasa.

**P2 — Manajer Outlet**
Ada di outlet sebagian waktu. Memberi otorisasi void, refund, dan diskon di atas ambang lewat PIN — tanpa memutus sesi kasir. Menutup kas dan menjelaskan selisih. Membaca laporan harian.

**P3 — Owner**
Membuka aplikasi di HP (390×844) jam 23:00 untuk satu pertanyaan: *"hari ini bagaimana, dan apakah ada yang aneh."* Tidak duduk di depan komputer. Butuh angka yang bisa dipercaya, bukan dashboard yang mengesankan. **Persona yang membayar** — kalau P3 berhenti membuka aplikasi, merchant akan churn (G4).

### 5.2 Use case utama

**UC-1 — Jam sibuk, internet mati.**
Pukul 12:15, antrean 6 orang. Wi-Fi outlet mati. Kasir menyelesaikan transaksi berjalan, dan enam transaksi berikutnya, tanpa perubahan alur kerja. Indikator status berubah menjadi "Offline · 3 menunggu". Pelanggan yang ingin bayar QRIS diarahkan ke tunai atau EDC. Pukul 14:40 internet pulih; antrean terkirim otomatis; kasir tidak melakukan apa-apa.

**UC-2 — Buka toko pagi hari, internet belum pulih.**
Internet mati sejak semalam. Kasir menyalakan tablet, login dengan PIN, membuka shift, dan mulai berjualan. **Ini pembeda utama** — `[FAKTA]` Odoo tidak bisa membuka sesi baru offline, Toast tidak bisa login offline.

**UC-3 — Pelanggan komplain, minta refund.**
Pelanggan kembali tiga hari kemudian dengan struk. Kasir mencari nomor struk `K1-20260726-0007`, memilih refund. Sistem meminta PIN manajer dan alasan dari daftar tertutup. Transaksi asli **tetap ada** di riwayat dengan penanda; refund adalah record baru [KEP-17]. Berjalan meskipun offline, selama transaksi ada dalam jendela riwayat lokal.

**UC-4 — Tutup kas, ada selisih.**
Akhir shift. Kasir menghitung fisik uang di laci dan memasukkan angkanya **sebelum sistem menampilkan angka terhitung** — urutan ini adalah kontrol, bukan preferensi UX. Selisih Rp35.000 melewati ambang; sistem meminta PIN manajer dan catatan.

**UC-5 — Owner mencari kebocoran.**
Jam 23:00 di HP. Owner membuka laporan exception: void per kasir dibanding rata-rata, diskon manual, frekuensi no-sale, selisih kas per shift. Menemukan satu kasir dengan void 4× rata-rata di akhir shift.

**UC-6 — Merchant pindah dari Moka.**
Owner mengimpor katalog dari ekspor Moka/CSV. Sistem menampilkan pratinjau, menandai baris bermasalah per baris, dan mengimpor sisanya. Ini **fitur akuisisi**, bukan utilitas admin [Fase 11 § 4].

---

## 6. User Flows

### 6.1 Alur inti — penjualan

```
[Buka aplikasi] → [Login PIN] → [Shift aktif?]
                                     │
                          ┌──────────┴──────────┐
                         Ya                    Tidak
                          │                     │
                          │              [Buka shift:
                          │               input saldo awal]
                          │                     │
                          └──────────┬──────────┘
                                     ▼
                          ┌─────────────────────┐
                          │   LAYAR KASIR       │◄──────┐
                          │  grid produk +      │       │
                          │  keranjang          │       │
                          └──────────┬──────────┘       │
                                     │                  │
                 ┌───────────────────┼──────────────┐   │
                 ▼                   ▼              ▼   │
          [Pilih produk]      [Ubah qty]      [Diskon]──┘
                 │                                  │
          [Punya modifier?]                  [> ambang?]
                 │ ya                               │ ya
          [Pilih modifier]                   [PIN manajer
                 │                            + alasan]
                 └──────────┬───────────────────────┘
                            ▼
                      [Tombol Bayar 56px]
                            ▼
                 ┌─────────────────────────┐
                 │  LAYAR PEMBAYARAN       │
                 │  tunai / QRIS / EDC /   │
                 │  campuran (multi)       │
                 └──────────┬──────────────┘
                            ▼
                   [Total terpenuhi?] ──tidak──► [Tambah payment]
                            │ ya
                            ▼
              ╔═════════════════════════════╗
              ║  SIMPAN TRANSAKSI (atomik)  ║  ← order + line + payment
              ║  order, line, payment,      ║    + stock movement + audit
              ║  stock movement, audit,     ║    dalam SATU transaksi DB
              ║  idempotency key            ║
              ╚══════════════┬══════════════╝
                             ▼
                       [Cetak struk]  ← efek samping, BOLEH gagal
                       [Buka laci]       penjualan sudah tersimpan
                             ▼
                    [Kembali ke Kasir]
```

**Titik cabang yang menentukan:**
- **Simpan sebelum cetak, selalu.** Struk bisa dicetak ulang; penjualan yang hilang tidak bisa dipulihkan. Urutan terbalik adalah bug [Fase 7 § 9].
- **QRIS hanya muncul saat online.** Saat offline, metode ini dinonaktifkan dengan alasan tertulis, bukan disembunyikan.

### 6.2 Alur tutup kas

```
[Tutup Kas] → [Sistem menampilkan: jumlah transaksi, rincian metode]
                                  ▼
              ┌────────────────────────────────────────┐
              │  "Hitung dulu, baru sistem             │
              │   menampilkan angkanya"                │
              │                                        │
              │  Input: hitungan fisik laci  [_______] │  ← WAJIB dulu
              └──────────────────┬─────────────────────┘
                                 ▼
              [Sistem menampilkan saldo terhitung + SELISIH]
                                 ▼
                        [|Selisih| > ambang?]
                          │              │
                         ya            tidak
                          ▼              │
                 [PIN manajer            │
                  + catatan wajib]       │
                          └──────┬───────┘
                                 ▼
                        [Shift ditutup]
                        [Laporan shift]
```

Urutan input-sebelum-tampil adalah kontrol anti-fraud. Sistem menyimpan **dua field terpisah**: angka yang dimasukkan kasir dan angka terhitung sistem.

### 6.3 Alur sinkronisasi (latar belakang, terlihat sebagai status)

```
Transaksi tersimpan lokal
        ▼
  [Masuk outbox lokal]
        ▼
  [Online?] ──tidak──► [Menunggu] ──► SyncIndicator: "Offline · N menunggu"
        │ ya
        ▼
  [Kirim + idempotency key]
        ▼
  [Respons?] ──tidak──► [Retry exponential backoff] ──► masih gagal?
        │ ya                                              │
        ▼                                                 ▼
  [200/409 idempotent] ──► [Tandai terkirim]    SyncIndicator: "Gagal kirim (N)
        │                                         · Coba lagi"
        ▼
  SyncIndicator: tersinkron
```

**Aturan:** operasi destruktif (logout, resync, hapus data) **diblokir** selama outbox tidak kosong. Pelajaran langsung dari daftar "jangan" milik Toast [Fase 5 § 9].

---

## 7. Functional Requirements

FR di sini adalah **tingkat modul**. Setiap FR punya spec detail berisi behavior given/when/then dan acceptance criteria di `/product/specs/`.

Prioritas: **P0** = tanpa ini tidak bisa rilis · **P1** = rilis mungkin tapi merchant akan komplain dalam sebulan · **P2** = bisa menyusul di v1.x.

### Modul A — Katalog (`spec-a-katalog.md`)

| ID | P | Requirement |
|---|---|---|
| FR-A1 | P0 | Item → ItemVariation → ModifierList → Modifier sesuai aturan pemisah: punya SKU & harga sendiri → variation; kustomisasi yang menambah biaya → modifier [KEP-04] |
| FR-A2 | P0 | Setiap Item wajib punya ≥1 variation; item dengan satu variation ditampilkan dalam bentuk sederhana (nama variation disembunyikan) |
| FR-A3 | P0 | ModifierList mengontrol: batas kuantitas, wajib/opsional, single/multi-select, boleh berulang, default terpilih |
| FR-A4 | P0 | Kategori maksimal **2 tingkat**, agar aturan density design system terpenuhi (min 12 kartu produk 96px tanpa scroll di 1024×768) |
| FR-A5 | P0 | Guardrail: saat merchant membuat modifier, sistem menanyakan apakah item perlu dilacak stoknya, dan mengarahkan ke variation bila ya |
| FR-A6 | P0 | Katalog tidak pernah dihapus, hanya diarsipkan (`archived_at`) |
| FR-A7 | P0 | Harga per outlet dengan override; perubahan harga tercatat di `price_history` beserta aktor |
| FR-A8 | P1 | Impor katalog dari CSV dan format ekspor Moka/Olsera, dengan pratinjau dan pelaporan error **per baris** |
| FR-A9 | P0 | `ItemVariation` menyimpan *stocking unit*, *selling unit*, dan faktor konversi — **disimpan tetapi UI konversi tidak dibangun di v1** [KEP-03] |

### Modul B — Kasir & Order (`spec-b-kasir-order.md`)

| ID | P | Requirement |
|---|---|---|
| FR-B1 | P0 | State order: `DRAFT → OPEN → PAID → CLOSED`, plus `VOIDED` dan `REFUNDED`. Transisi tidak boleh melompat |
| FR-B2 | P0 | Order dan seluruh turunannya disimpan dalam **satu transaksi database**. Kegagalan di tengah tidak meninggalkan penjualan parsial |
| FR-B3 | P0 | `OrderLine` adalah **snapshot**: nama item, nama variation, harga satuan, qty, modifier, diskon, tarif & nilai pajak, `is_tax_inclusive`, dan `cost_at_sale` [KEP-19] |
| FR-B4 | P0 | `quantity` bertipe numerik (bukan integer) — retail menjual per kg/ons |
| FR-B5 | P0 | Nomor struk berformat `K1-20260726-0007`; prefiks device dialokasikan sekali saat provisioning; counter direset harian dan disimpan lokal |
| FR-B6 | P0 | Sistem menolak provisioning device kedua dengan kode yang sudah dipakai di outlet yang sama |
| FR-B7 | P0 | **Void** dan **refund** adalah dua operasi terpisah dengan prasyarat berbeda; keduanya menghasilkan record baru dan tidak pernah mengubah record asli [KEP-17] |
| FR-B7b | P0 | **Void tidak memerlukan persetujuan manajer** — kasir dapat membatalkan transaksi sendiri. Sebagai gantinya, empat hal wajib menyertainya: (1) alasan dari **daftar tertutup** (FR-F11), "Lainnya" wajib catatan; (2) transaksi ditandai `VOIDED`, record asli tidak diubah; (3) audit event dipancarkan (FR-F6); (4) stok dikembalikan otomatis lewat `stock_movement` bertipe void dalam transaksi yang sama (FR-E2, FR-E3). **Refund tetap memerlukan PIN manajer** — keputusan ini hanya menyangkut void. ⚠️ Ini **override eksplisit** terhadap `/research/08` § 3, yang menandai "void seluruh order → butuh PIN manajer, tidak dapat diubah". Konsekuensinya: laporan exception FR-G5 (#1 void per kasir vs rata-rata, #2 void mendekati/sesudah tutup shift) menjadi **satu-satunya kontrol** terhadap penyalahgunaan void, sehingga naik dari P1 menjadi wajib ada sebelum merchant berbayar pertama |
| FR-B8 | P0 | Diskon di atas ambang memicu otorisasi step-up: PIN manajer + alasan dari **daftar tertutup**; "Lainnya" wajib catatan. **Ambang default: diskon > 20% atau > Rp50.000** (dapat diubah merchant) |
| FR-B9 | P0 | Otorisasi step-up **tidak memutus sesi kasir** — kasir tetap memegang layar |
| FR-B10 | P0 | Setiap operasi mutasi membawa **idempotency key yang di-generate klien**; retensi 30 hari [KEP-16] |
| FR-B11 | P1 | Cetak ulang struk tersedia dari riwayat transaksi |
| FR-B12 | P0 | Entitas `Check` ada di skema tetapi **dikunci 1:1 dengan Order** di v1 [KEP-06] |

### Modul C — Pembayaran & Pajak (`spec-c-pembayaran-pajak.md`)

| ID | P | Requirement |
|---|---|---|
| FR-C1 | P0 | Satu order dapat memiliki **banyak payment** (tunai + QRIS dalam satu transaksi adalah alur harian) |
| FR-C2 | P0 | Metode v1: tunai · QRIS dinamis (gateway) · **QRIS statis (konfirmasi manual)** · kartu via EDC (input manual). **Keduanya didukung [OQ-15 terjawab]:** QRIS **dinamis** di-generate lewat API **Midtrans** dan dikonfirmasi lewat webhook (sandbox + simulator webhook Midtrans untuk pengembangan dan pengujian) — online-only. QRIS **statis** memakai QR cetak milik merchant sendiri dan dikonfirmasi manual oleh kasir — **berfungsi offline**, dan karena itu wajib disertai kontrol anti-fraud di `spec-c-pembayaran-pajak.md` § "QRIS statis": field referensi wajib, `confirmed_manually = true`, penanda di struk, dan masuk laporan exception per kasir |
| FR-C3 | P0 | QRIS dinamis dinonaktifkan saat offline dengan pesan yang menjelaskan alasannya |
| FR-C4 | P0 | Pembayaran EDC menyimpan `terminal_reference`, `approval_code`, `card_last4`, `acquirer` — diisi manual di v1, siap diisi otomatis saat integrasi ECR [KEP-26] |
| FR-C5 | P0 | **Tidak ada** penyimpanan PAN, CVV, PIN kartu, atau data track — di kolom mana pun [KEP-29] |
| FR-C6 | P0 | `TaxRate` sebagai entitas: `type` (`pbjt`/`ppn`/`none`), `rate`, `is_inclusive`, `jurisdiction`, `applies_to`, `effective_from/to` [KEP-24] |
| FR-C7 | P0 | `TaxRate` mendukung **channel** (`dine_in`/`takeaway`/`all`) sebagai dimensi, **default `all`** [OQ-05] |
| FR-C8 | P0 | Urutan perhitungan: subtotal → diskon order → service charge → dasar pajak → pajak → pembulatan tunai. Urutan dapat dikonfigurasi; default harus benar |
| FR-C9 | P0 | Pembulatan tunai **hanya** berlaku pada pembayaran tunai dan **tidak** mengubah dasar pengenaan pajak; selisih dicatat sebagai baris `cash_rounding_adjustment` |
| FR-C10 | P0 | Struk menampilkan rincian terpisah dan dapat ditelusuri: subtotal, diskon, service charge, pajak (dengan **nama**, mis. "PBJT 10%"), pembulatan, total |
| FR-C11 | P0 | Tidak ada perhitungan pajak di luar modul `TaxCalculator`. Kemunculan konstanta tarif di luar modul adalah cacat arsitektur |
| FR-C12 | P1 | Rekonsiliasi pembayaran digital: menampilkan nilai transaksi **dan** perkiraan settlement setelah MDR |
| FR-C13 | P1 | Ekspor rekapitulasi penjualan untuk keperluan pelaporan pajak [OQ-04] |
| FR-C14 | P0 | Alur pembayaran gateway yang gagal di tengah memiliki state `pending_confirmation` dengan mekanisme polling |

### Modul D — Kas & Shift (`spec-d-kas-shift.md`)

| ID | P | Requirement |
|---|---|---|
| FR-D1 | P0 | **Buka shift berfungsi penuh saat offline** — pembeda utama versus Toast dan Odoo [KEP-23] |
| FR-D2 | P0 | Tutup kas menegakkan urutan: kasir memasukkan hitungan fisik → sistem menampilkan angka terhitung dan selisih |
| FR-D3 | P0 | Sistem menyimpan angka kasir dan angka terhitung sebagai **dua field terpisah** |
| FR-D4 | P0 | Selisih di atas ambang memicu PIN manajer + catatan wajib. **Ambang default: selisih > Rp20.000** (dapat diubah merchant). Ambang bersifat **inklusif** — `>=` memicu otorisasi (lihat § 10.6) |
| FR-D5 | P0 | `CashMovement` mencatat: penjualan tunai, refund tunai, paid-in, paid-out. Invariant: saldo laci = `SUM(cash_movement)` [KEP-18] |
| FR-D6 | P0 | `CashMovement` menyimpan `counterpart_type` sejak v1 meskipun sisi lawan belum dibukukan — menjaga jalur ke double-entry penuh |
| FR-D7 | P0 | **No-sale** (buka laci tanpa transaksi) adalah operasi berotorisasi dengan alasan wajib, tercatat di audit trail. **Ambang default: alasan wajib selalu; PIN manajer di atas 3× per shift** (dapat diubah merchant) |
| FR-D8 | P0 | Tutup kas berfungsi penuh saat offline |

### Modul E — Inventori (`spec-e-inventori.md`)

| ID | P | Requirement |
|---|---|---|
| FR-E1 | P0 | Stok **tidak memiliki kolom quantity**. Stok saat ini = `SUM(stock_movement.delta)` per (outlet, variation) [KEP-07] |
| FR-E2 | P0 | Tipe movement: penjualan, void, refund, penerimaan, penyesuaian, opname |
| FR-E3 | P0 | Stock cutting otomatis saat penjualan tersimpan, dalam transaksi yang sama |
| FR-E4 | P0 | Perilaku "stok boleh negatif" adalah **setting per profil vertikal** dengan default yang dinyatakan, bukan perilaku implisit. Kolomnya `vertical_profile.allow_negative_stock` (default `true` untuk F&B per `spec-e` § FR-E4). Karena profil melekat di **outlet** dengan warisan dari tenant [OQ-09 terjawab], setting ini efektif **per outlet**: satu cabang boleh memblokir stok negatif sementara cabang lain mengizinkannya |
| FR-E5 | P0 | Penandaan sold-out manual oleh kasir (barista tahu kopi habis sebelum sistem tahu) |
| FR-E6 | P0 | **Deteksi oversell pasca-sinkronisasi**: sistem mendeteksi stok negatif akibat penjualan offline paralel, mencatat konteksnya (device, waktu), dan menampilkannya ke manajer [KEP-23] |
| FR-E7 | P1 | Stock opname dengan pencatatan selisih |

### Modul F — Identitas, RBAC & Audit (`spec-f-rbac-audit.md`)

| ID | P | Requirement |
|---|---|---|
| FR-F1 | P0 | Peran: Owner · Manajer Area · Manajer Outlet · Kasir · Akuntan (read-only). KDS tanpa login (v1.1) |
| FR-F2 | P0 | **Kredensial dibagi per permukaan:** kasir & otorisasi step-up memakai **PIN 6 digit** (diverifikasi lokal terhadap hash Argon2id yang direplikasi); back-office & owner mobile memakai **email + password**. Alasan: otorisasi step-up terjadi di tengah transaksi dengan antrean menunggu, dan friksi login menyebabkan berbagi akun yang merusak atribusi audit |
| FR-F2b | P0 | Password back-office minimal 10 karakter, Argon2id, ditolak bila ada di daftar bocor; sesi kedaluwarsa 12 jam. MFA opsional v1 |
| FR-F2c | P0 | PIN lemah ditolak: digit berulang, urutan naik/turun, tanggal lahir, pola berulang, 20 PIN paling umum. PIN manajer dirotasi berkala (default 90 hari) — satu-satunya mitigasi shoulder surfing |
| FR-F3 | P0 | **Login berfungsi saat offline** menggunakan kredensial ter-cache |
| FR-F4 | P0 | Percobaan PIN gagal berulang mengunci perangkat sementara, **termasuk saat offline** |
| FR-F5 | P0 | Kasir tidak melihat margin dan HPP |
| FR-F6 | P0 | Audit trail append-only mencatat: login/logout, buka/tutup shift, void, refund, diskon manual, perubahan harga, perubahan katalog, penyesuaian stok, no-sale, perubahan pengaturan pajak, perubahan peran, ekspor data, akses support, perubahan konfigurasi perangkat |
| FR-F7 | P0 | Audit event menyimpan **dua identitas** untuk otorisasi step-up: pelaku (`actor_user_id`) dan penyetuju (`approver_user_id`) |
| FR-F8 | P0 | Audit event menyimpan `occurred_at` (device) dan `recorded_at` (server); selisih besar antar keduanya ditandai |
| FR-F9 | P0 | Audit trail **tidak dapat dinonaktifkan merchant** |
| FR-F10 | P0 | Owner **tidak dikecualikan** dari audit trail |
| FR-F11 | P0 | Alasan diambil dari **daftar tertutup**; "Lainnya" wajib catatan bebas |
| FR-F12 | P0 | Token perangkat terikat device, dapat dicabut dari dashboard, dan tidak dapat dipindah |

### Modul G — Laporan & Exception (`spec-g-laporan.md`)

| ID | P | Requirement |
|---|---|---|
| FR-G1 | P0 | Laporan operasional: penjualan harian, per produk, per kasir, per shift, per metode pembayaran |
| FR-G2 | P0 | Setiap laporan menyatakan eksplisit apakah angkanya **bersih** (setelah void & refund) atau kotor |
| FR-G3 | P0 | Perhitungan posisi penjualan bersih berasal dari **satu fungsi tunggal** yang dipakai semua laporan — laporan yang saling bertentangan menghancurkan kepercayaan merchant lebih cepat daripada fitur yang hilang |
| FR-G4 | P0 | Laporan device ini berfungsi saat offline dari data lokal |
| FR-G5 | P1 | **Delapan laporan exception**: (1) void & refund per kasir vs rata-rata; (2) void mendekati/sesudah tutup shift; (3) refund bernilai tinggi; (4) frekuensi no-sale per kasir; (5) diskon manual per kasir dengan alasan; (6) item berulang kali dibatalkan pada satu order; (7) selisih kas per kasir dengan tren; (8) transaksi offline dengan selisih jam device-server besar [KEP-30] |
| FR-G6 | P1 | Ringkasan harian yang dapat dibaca owner di layar 390×844 dalam satu layar |
| FR-G7 | P0 | Laporan lintas-outlet dan historis panjang bersifat **online-only**, dengan empty state yang menjelaskan alasannya |

### Modul H — Sinkronisasi & Status (`spec-h-sinkronisasi.md`)

| ID | P | Requirement |
|---|---|---|
| FR-H1 | P0 | Antrean upload persisten yang bertahan melewati restart aplikasi dan restart perangkat |
| FR-H2 | P0 | `SyncIndicator` menampilkan status per-record: tersinkron / mengantre / gagal / offline-only — bukan hanya boolean online |
| FR-H3 | P0 | Layar **Status Sinkronisasi**: daftar antrean, umur item tertua, item gagal, tombol coba lagi, ekspor darurat |
| FR-H4 | P0 | Operasi destruktif (logout, resync, hapus data) **diblokir** selama antrean tidak kosong, dengan pesan yang menjelaskan |
| FR-H5 | P0 | Setiap record membawa HLC (hybrid logical clock), bukan wall-clock [KEP-21] |
| FR-H6 | P0 | Server memvalidasi ulang total transaksi saat sinkronisasi; selisih ditandai, tidak diterima diam-diam |
| FR-H7 | P0 | Riwayat transaksi direplikasi ke device untuk **90 hari** agar refund offline mungkin — durasi terkonfirmasi lewat pengukuran (39–130 MB tergantung ukuran merchant) |
| FR-H8 | P1 | Notifikasi proaktif ke merchant saat antrean menua melewati ambang |

---

## 8. Non-Functional Requirements

Hanya yang benar-benar menggigit untuk produk ini.

### 8.1 Performa

| Aspek | Target | Alasan |
|---|---|---|
| Tambah item ke keranjang | p95 **< 100 ms** | Dirasakan kasir setiap detik; operasi lokal, tidak boleh menunggu jaringan |
| Buka layar kasir dari cold start | **< 3 detik** | Kasir membuka aplikasi di awal shift |
| Cari produk (katalog 5.000 SKU) | p95 **< 150 ms** | Pencarian lokal |
| Simpan transaksi (lokal) | p95 **< 200 ms** | Termasuk seluruh entitas turunan dalam satu transaksi DB |
| Query stok seluruh katalog satu outlet | **< 200 ms** | Ambang yang memicu penambahan snapshot table [KEP-07] |
| Render laporan harian | **< 2 detik** | |

### 8.2 Offline — spesifikasi yang mengikat

Tabel ini adalah **acceptance criteria**, bukan aspirasi. Baris ❌ sama mengikatnya dengan baris ✅.

| Kapabilitas | v1 |
|---|---|
| Buka shift / sesi kasir baru | ✅ |
| Login kasir dengan PIN | ✅ |
| Membuat & menyelesaikan order | ✅ |
| Pembayaran tunai | ✅ |
| Cetak struk & buka laci | ✅ |
| Update stok lokal | ✅ |
| Refund & void (dalam jendela riwayat lokal) | ✅ |
| Akses & buat data pelanggan | ✅ |
| Tutup kas / tutup shift | ✅ |
| Laporan device ini | ✅ |
| Durasi offline untuk penjualan tunai | **Tidak dibatasi** (dibatasi kapasitas storage) |
| Pembayaran QRIS **dinamis** (gateway Midtrans) | ❌ mustahil secara teknis — butuh konfirmasi issuer |
| Pembayaran QRIS **statis** (konfirmasi manual kasir) | ✅ — QR cetak milik merchant; wajib field referensi + `confirmed_manually` + masuk laporan exception |
| Pencegahan oversell | ❌ tidak dijanjikan; deteksi pasca-sinkronisasi |
| Loyalty, voucher, gift card | ❌ |
| Melihat order dari device lain di outlet | ❌ tidak di v1 |
| Laporan lintas-outlet / historis panjang | ❌ online-only |

### 8.3 Platform & perangkat

| Aspek | Ketentuan |
|---|---|
| Aplikasi kasir produksi | **Aplikasi desktop (Tauri 2)**, bukan browser — `[FAKTA]` WebUSB gagal mengakses printer di Windows karena driver meng-klaim perangkat secara eksklusif [KEP-27] |
| Browser didukung (dashboard/back-office) | Chrome, Edge, Safari, Firefox |
| Browser **tidak** didukung (aplikasi kasir) | **Firefox** — OPFS belum didukung |
| Viewport wajib | 1024×768 (kasir) · 390×844 (owner) · 1920×1080 (KDS, v1.1) |
| Printer | ESC/POS dengan **profil printer sebagai data**; printer network (TCP:9100) direkomendasikan karena satu-satunya jalur yang berfungsi di semua platform |
| Program uji perangkat | 5–8 model printer paling umum diuji dan diterbitkan sebagai daftar "Diuji dengan Lumi POS" [KEP-28] |

### 8.4 Keamanan & privasi

| Aspek | Ketentuan |
|---|---|
| Data kartu | Tidak pernah menyentuh sistem [KEP-29] |
| Password | Argon2id |
| PIN kasir | **6 digit**, Argon2id + salt per pengguna; di-hash sebelum direplikasi. PIN lemah ditolak; PIN manajer dirotasi 90 hari |
| Password back-office | Argon2id, min 10 karakter, ditolak bila ada di daftar bocor |
| **Batas keamanan sebenarnya** | PIN adalah **atribusi**, bukan otentikasi. Perangkat diamankan token terikat yang dapat dicabut + enkripsi at-rest + keberadaan fisik di outlet |
| In-transit | TLS 1.3, validasi sertifikat wajib, tanpa opsi abaikan |
| At-rest klien | SQLite terenkripsi, kunci di keystore OS |
| Isolasi tenant | PostgreSQL Row-Level Security; aplikasi terhubung sebagai user yang **tunduk** pada RLS [KEP-32] |
| Log | Redaksi payload sensitif di **lapisan logging**, bukan mengandalkan disiplin penulis kode |
| UU PDP | Merchant = pengendali data pelanggan; Lumi POS = prosesor. Lumi POS = pengendali untuk data akun merchant [KEP-31] |

### 8.5 Bahasa & format

`[FAKTA]` Ditetapkan design system, tidak dapat dinegosiasikan:

- Bahasa antarmuka **Indonesia**, nada tenang dan operasional.
- Uang: `Rp` + spasi + titik ribuan, **tanpa desimal** → `Rp 1.847.000`. Negatif/diskon: `− Rp 8.000`.
- Angka uang selalu `tabular-nums` (kelas `.num`).
- Jam 24-jam `14:32` · Tanggal `26 Jul 2026` · Qty `2×` · Persen `11%`.
- Target sentuh ≥ 44px; aksi menyangkut uang **56px**.
- Status tidak pernah warna saja — selalu ada teks.
- Setiap komponen punya keadaan **kosong** dan **error**.
- Tanpa emoji.

### 8.6 Prasyarat teknis yang harus diselesaikan lebih dulu

| Item | Alasan |
|---|---|
| **Self-host font Inter** | `tokens/fonts.css` melakukan `@import` ke Google Fonts. Saat boot offline, `@import` gagal, font fallback ke `system-ui`, dan `tabular-nums` tidak dijamin ada — kolom angka uang akan bergoyang, melanggar aturan mengikat design system |
| **Header COOP/COEP** | Prasyarat SQLite WASM + OPFS. Sekaligus memutus `@import` lintas-origin — dua masalah, satu perbaikan |
| **`_adherence.oxlintrc.json` ke CI** | Penegakan otomatis adalah satu-satunya cara aturan design system bertahan lebih dari tiga bulan |

---

## 9. Data Model

Detail lengkap ada di ERD terpisah. Di sini: entitas inti, sumber kebenaran, dan aturan yang tidak boleh dilanggar.

### 9.1 Entitas inti v1

```
Tenant ─┬─< Outlet ─┬─< Device
        │           ├─< CashDrawerShift ──< CashMovement
        │           └─< StockMovement
        │
        ├─< User ──< Role
        ├─< VerticalProfile          (per outlet, default dari tenant)
        ├─< TaxRate                  (jenis, tarif, yurisdiksi, channel, masa berlaku)
        │
        ├─< Category ──< Item ──< ItemVariation ──< PriceHistory
        │                   └──< ModifierList ──< Modifier
        │
        └─< Order ─┬─< Check (1:1 di v1) ──< OrderLine ──< OrderLineModifier
                   ├─< Payment
                   ├─< Refund
                   └─< AuditEvent

Lokal-only (tidak direplikasi ke server):
  OutboxLocal · DeviceConfig · SyncCheckpoint

Server-only:
  IdempotencyKey · Outbox · OversellEvent · Subscription · UsageMetric
```

### 9.2 Aturan data yang mengikat

| Aturan | Alasan |
|---|---|
| **Uang** disimpan `bigint` dalam rupiah utuh. Tidak pernah float | Design system menetapkan tanpa desimal; float mengakumulasi kesalahan pembulatan |
| **ID** UUIDv7/ULID di-generate klien | Auto-increment mustahil untuk penulisan offline |
| **Waktu** disimpan ganda: `occurred_at` (device) + `recorded_at` (server), plus `hlc` | Jam device tidak bisa dipercaya; selisihnya sendiri adalah sinyal |
| **Stok tidak punya kolom quantity** | Stok = `SUM(stock_movement)` [KEP-07] |
| **Transaksi selesai tidak pernah di-`UPDATE`** | Koreksi = record baru [KEP-17] |
| **Katalog tidak pernah di-`DELETE`** | Hanya `archived_at`; tidak ada FK `ON DELETE CASCADE` dari transaksi ke katalog |
| **`OrderLine` adalah snapshot** — termasuk `cost_at_sale` | Tanpa `cost_at_sale`, laporan margin historis salah [KEP-19] |
| **Setiap tabel punya `tenant_id`** dengan kebijakan RLS untuk SELECT/INSERT/UPDATE/DELETE | Kebijakan yang hanya menutupi SELECT membiarkan penulisan lintas tenant |
| **Larangan skema:** tidak ada kolom untuk PAN, CVV, PIN kartu, atau data track | Ditulis di ERD sebagai larangan eksplisit, bukan diasumsikan |

### 9.3 State machine

**Order:**
```
DRAFT ──► OPEN ──► PAID ──► CLOSED
   │        │                 │
   │        └──► VOIDED       └──► REFUNDED (parsial/penuh)
   └──► ABANDONED (otomatis saat tutup shift)
```

**CashDrawerShift:** `OPEN → CLOSING → CLOSED`. Tidak dapat dibuka ulang setelah `CLOSED`.

**Sync item (lokal):** `PENDING → SENDING → SENT` · `PENDING → FAILED → PENDING` (retry) · `FAILED → EXPORTED` (ekspor darurat).

---

## 10. Edge Cases & Error States

Bagian yang paling sering dilewati PRD dan sumber mayoritas bug.

### 10.1 Kosong (first-run, nol item)

| Situasi | Yang dilihat pengguna | Yang dilakukan sistem |
|---|---|---|
| Katalog kosong saat pertama kali | "Belum ada produk" + CTA tambah produk / impor | Menawarkan impor CSV |
| Tidak ada transaksi hari ini | "Belum ada transaksi hari ini" — **berbeda** dari "tidak ada yang cocok dengan filter" | Menampilkan jam berjalan |
| Filter laporan tidak menemukan hasil | "Tidak ada yang cocok dengan filter" + tombol reset filter | Mempertahankan filter |
| Shift belum dibuka | Layar kasir terkunci dengan CTA "Buka shift" | Tidak mengizinkan transaksi |

### 10.2 Ekstrem

| Situasi | Perilaku |
|---|---|
| Katalog 10.000 SKU | Pencarian tetap < 150 ms; grid virtualisasi |
| Nama produk sangat panjang | Truncate dengan ellipsis di grid; nama penuh di struk dan detail |
| Order dengan 200 baris | Keranjang dapat di-scroll; total tetap terlihat (sticky) |
| Antrean sync 5.000 item | Layar Status Sinkronisasi paginated; upload ber-batch |
| Diskon 100% | Diizinkan dengan otorisasi manajer; tercatat di exception report |
| Transaksi Rp0 | Diizinkan (mis. penggantian barang rusak) dengan alasan wajib |
| Storage device penuh | **Peringatan pada 80% dan 90%**; pada 95% sistem menolak transaksi baru dengan pesan yang menyatakan alasannya dan menawarkan ekspor darurat. Transaksi berjalan tetap dapat diselesaikan |

### 10.3 Input tidak valid

| Situasi | Perilaku |
|---|---|
| Qty negatif atau nol | Ditolak dengan pesan inline |
| Harga negatif | Ditolak |
| Pembayaran melebihi total | Diizinkan untuk tunai (menghasilkan kembalian); ditolak untuk non-tunai |
| Pembayaran kurang dari total | Order tetap `OPEN`, sisa tagihan ditampilkan |
| PIN salah | Pesan netral tanpa membocorkan apakah PIN atau user yang salah; hitungan percobaan bertambah |
| Barcode tidak ditemukan | Pesan + tawaran mencari manual; tidak menghapus keranjang |
| Impor CSV dengan baris rusak | Baris valid diimpor; baris rusak dilaporkan **per baris dengan nomor baris dan alasan**; tidak ada impor parsial diam-diam |

### 10.4 Konkurensi

| Situasi | Perilaku |
|---|---|
| Dua device menjual item terakhir saat offline | **Keduanya berhasil.** Oversell terdeteksi pasca-sinkronisasi, dicatat di `OversellEvent`, dilaporkan ke manajer [KEP-23] |
| Double-submit tombol Bayar | Idempotency key mencegah duplikasi; klien juga menonaktifkan tombol setelah tap pertama |
| Retry upload setelah respons hilang | Server mengembalikan respons asli dari tabel idempotency; klien menandai antrean selesai |
| Idempotency key sama dengan body berbeda | Ditolak `422` — ini bug klien, bukan cache hit |
| Owner mengubah harga saat device offline | Transaksi offline memakai harga lama. **Ini perilaku yang benar** — itulah harga yang tercetak dan dibayar pelanggan |
| Dua manajer menyetujui void yang sama | Idempotency key; void kedua menjadi no-op |
| Order `OPEN` disentuh dua device | Model **kepemilikan**: satu order dimiliki satu device sampai dilepas eksplisit [KEP-21] |

### 10.5 Kegagalan

| Situasi | Yang dilihat pengguna | Yang dilakukan sistem |
|---|---|---|
| Internet mati | `SyncIndicator`: "Offline · N menunggu" | Semua operasi offline-capable tetap jalan |
| Printer kehabisan kertas | "Struk gagal dicetak · Cetak ulang" | **Penjualan sudah tersimpan.** Job masuk antrean cetak |
| Printer tidak terhubung | Peringatan saat buka shift, bukan saat transaksi pertama | Menawarkan uji cetak |
| Gateway QRIS timeout setelah pelanggan bayar | "Menunggu konfirmasi" dengan tombol cek status | Payment `pending_confirmation`; polling; **tidak pernah** menandai lunas tanpa konfirmasi |
| Upload gagal permanen | "Gagal kirim (N) · Coba lagi" | Retry exponential backoff; ekspor darurat tersedia |
| Perangkat mati di tengah simpan transaksi | Setelah restart, transaksi ada atau tidak ada sama sekali | Transaksi database atomik — tidak ada state parsial |
| Server menolak versi klien terlalu lama | "Versi aplikasi terlalu lama, perbarui sebelum [tanggal]" | **Tetap bisa berjualan offline**; sinkronisasi ditolak dengan pesan yang berguna |
| Perangkat hilang/dicuri | — | Token dicabut dari dashboard; wipe dijalankan saat perangkat terhubung berikutnya; enkripsi at-rest melindungi perangkat yang tidak pernah terhubung |

### 10.6 Batas

| Situasi | Perilaku |
|---|---|
| Transaksi tepat pukul 00:00 | Ditetapkan ke tanggal bisnis, bukan tanggal kalender. **Tanggal bisnis berakhir saat shift ditutup**, bukan tengah malam |
| Shift melewati tengah malam | Tetap satu shift; laporan mengikuti shift |
| Zona waktu WIB/WITA/WIT | Disimpan UTC, ditampilkan sesuai zona outlet |
| Selisih kas tepat di ambang | Ambang bersifat inklusif (`>=` memicu otorisasi); dinyatakan eksplisit agar tidak ambigu |
| Nomor struk ke-10.000 dalam satu hari | Format mendukung; counter direset harian per device |
| Lubang pada nomor struk | **Ditampilkan di laporan audit**, tidak disembunyikan — lubang yang tidak dijelaskan adalah sinyal fraud klasik |

---

## 11. Dependencies & Assumptions

### 11.1 Dependensi

| Dependensi | Status | Catatan |
|---|---|---|
| Design system `/ds-bundle` | ✅ **Terkonfirmasi** | Final, tidak diriset ulang, tidak diubah |
| PostgreSQL 17+ | ✅ Terkonfirmasi | |
| PowerSync Open Edition | ✅ **Terkonfirmasi untuk SaaS** | `[FAKTA]` FSL mengizinkan; POS bukan Competing Use [OQ-03] |
| Payment gateway (Midtrans) | ⬜ **Belum** | Butuh pendaftaran merchant dan sandbox |
| Font Inter self-hosted | ⬜ Belum | Prasyarat offline, harus diselesaikan di fase fondasi |
| Perangkat uji printer (5–8 model) | ⬜ Belum | `[FAKTA]` Total di bawah Rp5 juta |
| Konsultan pajak | ⬜ Belum | Untuk verifikasi OQ-04 & OQ-05 sebelum merchant berbayar pertama |

### 11.2 Asumsi — dan apa yang terjadi kalau salah

| # | Asumsi | Kalau salah |
|---|---|---|
| A1 | Merchant target mengalami outage cukup sering sehingga offline bernilai bayar | Posisi kompetitif runtuh; produk harus bergeser ke kedalaman fitur pada vertikal sempit [KEP-01] |
| A2 | Merchant bersedia bayar ~17% di atas Moka | Harga turun ke Rp299.000 **dan** sebagian fitur pindah ke tier Pro — bukan sekadar potong harga [OQ-11] |
| ~~A3~~ | ✅ **Bukan lagi asumsi — terukur.** 90 hari = 39 MB (kafe kecil) sampai 130 MB (kafe besar); ≈3,0 KB per order | — |
| A4 | Kafe takeaway tanpa integrasi aggregator masih dapat dijual | Pipeline awal menyempit drastis; OQ-06 harus ditinjau ulang |
| A5 | Tidak ada kewajiban fiscalization real-time di Indonesia | `SigningHook` diaktifkan; alur cetak struk berubah [OQ-04] |
| A6 | Pajak dine-in dan takeaway sama | Ubah satu baris konfigurasi — **nol migrasi**, karena channel sudah jadi dimensi [OQ-05] |
| A7 | Tauri 2 desktop stabil untuk akses printer USB di Windows | Fallback ke Electron atau print bridge lokal [KEP-12] |
| A8 | Merchant memakai perangkat Windows/Android, bukan iOS | `[FAKTA]` iOS praktis tidak mungkin untuk printer USB [Fase 7 § 8] |

---

## 12. Risks & Mitigations

| # | Risiko | Kemungkinan | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | **Bug sinkronisasi menghilangkan atau menggandakan uang merchant** | Sedang | **Fatal** — kepercayaan hilang permanen | Deterministic Simulation Testing untuk lapisan sync; property test untuk invariant finansial; idempotency + append-only menghilangkan sebagian besar kelasnya secara struktural [KEP-35] |
| R2 | Pajak dimodelkan salah (PBJT vs PPN) | Sedang | **Tinggi** — masalah hukum merchant | `TaxRate` sebagai entitas dengan channel dan yurisdiksi; verifikasi konsultan pajak sebelum merchant berbayar pertama |
| R3 | Beban support hardware tidak terkendali untuk satu orang | **Tinggi** | Sedang | Daftar printer terverifikasi; halaman uji cetak yang bisa dijalankan merchant sendiri; profil printer sebagai data [KEP-28] |
| R4 | Merchant menolak karena tidak ada integrasi aggregator | **Tinggi** | Sedang | Kualifikasi lead di awal; proses partner dimulai sekarang; target v1.1 |
| R5 | Asumsi frekuensi outage salah (A1) | Sedang | **Tinggi** — posisi kompetitif runtuh | Validasi dengan 10 merchant **sebelum** fase Offline dimulai, bukan sesudah |
| R6 | Scope creep dari non-goals | **Tinggi** | Sedang | Bagian 4 beserta alasan tiap item; review setiap PR terhadap daftar ini |
| R7 | Isolasi tenant bocor | Rendah | **Fatal** | RLS di level database; test lintas-tenant sebagai gate CI wajib; aplikasi terhubung sebagai user yang tunduk RLS |
| R8 | Rilis buruk mengganggu jam sibuk merchant | Sedang | Tinggi | Jendela update 03:00–06:00; staged rollout dengan gate crash rate; kill switch per fitur per merchant [KEP-36] |

---

## 13. Release Plan

Kapasitas: penuh waktu, tanpa tenggat keras. Milestone mengikuti **dependensi teknis**, bukan tanggal.

| Fase | Durasi `[ASUMSI]` | Isi | Gate untuk lanjut |
|---|---|---|---|
| **F0 — Fondasi** | 2–3 mgg | Skema PostgreSQL + RLS · SQLite lokal · self-host Inter · header COOP/COEP · linter design system ke CI · test isolasi tenant | Test lintas-tenant hijau; aplikasi kosong berjalan di Tauri dengan token DS terpasang |
| **F1 — Inti transaksi** | 4–6 mgg | Modul A (Katalog) · B (Kasir & Order) · C (Pembayaran & Pajak) · idempotency · append-only | Satu penjualan lengkap tersimpan atomik dengan pajak benar; property test invariant uang hijau |
| **F2 — Offline** | 5–8 mgg | Modul H (Sinkronisasi) · buka shift offline · refund offline · outbox · HLC · **harness DST** | **G3 terpenuhi di simulasi**: 0 transaksi hilang/duplikat di bawah fault injection |
| **F3 — Operasional** | 3–4 mgg | Modul D (Kas & Shift) · E (Inventori) · F (RBAC & Audit) · G (Laporan) | Merchant dapat buka toko → jual → tutup buku dengan angka yang konsisten antar laporan |
| **F4 — Hardware** | 2–3 mgg | `PeripheralPort` · ESC/POS + profil printer · printer network · laci · scanner · halaman uji cetak | Cetak berhasil di ≥5 model printer; penjualan tetap tersimpan saat cetak gagal |
| **F5 — Komersial** | 2–3 mgg | Tenant, paket, kuota · lisensi · onboarding · impor katalog | Merchant dapat mendaftar, impor katalog, dan bertransaksi tanpa bantuan |
| **F6 — Rilis** | 2 mgg | Staged rollout · jendela update · observability · runbook · alat koreksi data append-only | Runbook lengkap; alat koreksi ada **sebelum** insiden pertama |
| **Total v1** | **±18–24 mgg** | | |

**Yang menyusul:**
- **v1.1** — KDS + hub lokal + table management + transfer stok antar outlet + integrasi aggregator (semuanya butuh transport lokal-outlet yang sama, dibangun sekaligus)
- **v1.2** — Resep/BOM · loyalty · promo lanjutan
- **v1.3** — Purchasing & supplier · **vertikal retail dirilis** (data model sudah siap sejak v1; yang dibangun hanya UI dan alur)

**Feature flag & rollback:**
- Fitur berisiko dikirim dalam keadaan mati, dinyalakan per merchant — memisahkan *deploy* dari *release*.
- Rollback aplikasi: versi sebelumnya disimpan di perangkat, berfungsi tanpa jaringan.
- **Migrasi skema SQLite lokal wajib aditif-saja** sampai beberapa versi berlalu — rollback aplikasi mudah, rollback skema lokal hampir mustahil.
- Migrasi server memakai expand-contract dengan `lock_timeout` wajib.

**Migrasi data:** tidak ada (greenfield). Impor katalog dari kompetitor adalah fitur, bukan migrasi.

---

## 14. Open Questions

| # | Pertanyaan | Owner | Dibutuhkan sebelum |
|---|---|---|---|
| ~~OQ-07~~ | ✅ **Terjawab lewat pengukuran** — 90 hari = 39–130 MB tergantung ukuran merchant; bahkan 180 hari aman. Lihat `/prototypes/01-sqlite-sizing/FINDINGS.md` | — | — |
| OQ-08 | Batas kredensial offline versus janji offline tak terbatas | Dimas | F2 — menentukan FR-F3 |
| OQ-04 | Adakah kewajiban fiscalization bagi penyedia POS di Indonesia? | Konsultan pajak | **Merchant berbayar pertama** (bukan F1) |
| OQ-05 | Pajak dine-in versus takeaway — sama atau berbeda? | Konsultan pajak + 3 merchant | Merchant berbayar pertama |
| ~~OQ-09~~ | ✅ **Terjawab 1 Agu 2026 — per OUTLET, mewarisi default dari TENANT.** Pusat menetapkan standar, cabang boleh override. Diterapkan `db/migrations/0015`: `vertical_profile.is_tenant_default` + partial unique index (tepat satu default per tenant, ditegakkan database). Resolusi: `COALESCE(profil_outlet, profil_default_tenant)` — `outlet.vertical_profile_id` terisi = override, NULL = warisi. Kolom `outlet.vertical_profile_id` dan `vertical_profile.allow_negative_stock` (FR-E4) sudah ada sejak F0 di bawah penanda `[ASUMSI]`; keputusan ini mengonfirmasinya, bukan menggantinya | Dimas | — |
| OQ-14 | Prototipe Tauri Android: printer Bluetooth + scanner HID | Dimas | Sebelum desain mobile dikunci (setelah v1) |
| OQ-11 | Validasi harga Rp349.000/Rp699.000 terhadap kemauan bayar | Dimas | F5 (Komersial) |
| ~~OQ-15~~ | ✅ **Terjawab 1 Agu 2026 — YA, didukung, bersama QRIS dinamis.** Dinamis lewat API Midtrans + konfirmasi webhook (online-only). Statis lewat QR cetak merchant + konfirmasi manual kasir (berfungsi offline), **wajib** disertai kontrol anti-fraud di `spec-c` § "QRIS statis". Lihat FR-C2, § 4.2, § 8.2 | Dimas | — |
| OQ-03b | Konfirmasi tertulis lisensi PowerSync untuk redistribusi on-premise | PowerSync | Kontrak on-premise pertama (bukan v1) |
| ~~—~~ | ✅ **Terjawab 1 Agu 2026 — ambang default ditetapkan.** Diskon > 20% atau > Rp50.000 → PIN manajer (FR-B8) · Selisih kas > Rp20.000 → PIN manajer + catatan (FR-D4) · No-sale → alasan wajib selalu, PIN di atas 3×/shift (FR-D7) · Refund → PIN manajer + alasan, tidak dapat diubah · **Void → TANPA PIN manajer**, cukup alasan daftar tertutup + audit + restock otomatis (FR-B7b). Semua dapat diubah merchant kecuali refund. ⚠️ Baris void adalah **override eksplisit** terhadap `/research/08` § 3 yang menandainya "tidak dapat diubah" — konsekuensinya laporan exception FR-G5 naik jadi wajib | Dimas | — |
| — | Validasi ketiga ambang di atas ke 3 merchant nyata — angkanya diadopsi dari usulan riset, **belum divalidasi lapangan** `[ASUMSI]` | Dimas + 3 merchant | Sebelum merchant berbayar pertama |
| — | Apakah `Akuntan` (read-only) benar-benar dibutuhkan di v1? | Dimas | F3 |

Daftar lengkap 16 pertanyaan beserta cara menjawabnya ada di `/research/12-OPEN-QUESTIONS.md`; enam yang sudah diputuskan ada di `/research/13-DECISION-LOG.md`.

---

## 15. Appendix

### 15.1 Dokumen terkait

| Dokumen | Isi |
|---|---|
| `/research/00-EXECUTIVE-BRIEF.md` | Sintesis riset, arsitektur satu halaman, 5 risiko terbesar |
| `/research/01`…`/research/11` | Riset per fase, 39 keputusan bernomor KEP |
| `/research/12-OPEN-QUESTIONS.md` | 16 pertanyaan untuk manusia |
| `/research/13-DECISION-LOG.md` | Keputusan OQ-01…OQ-06 beserta konsekuensinya |
| `/research/SOURCES.md` | Seluruh sumber dengan tanggal akses |
| `/ds-bundle/readme.md` | Design system — aturan mengikat, token, komponen |
| `/product/specs/` | Spec detail per modul (menyusul) |

### 15.2 Glosarium

| Istilah | Arti |
|---|---|
| **PBJT** | Pajak Barang dan Jasa Tertentu — pajak daerah atas makanan/minuman, maks 10%, ditetapkan perda. Menggantikan istilah PB1 |
| **MDR** | Merchant Discount Rate — potongan atas transaksi digital, ditanggung merchant |
| **HLC** | Hybrid Logical Clock — timestamp yang menjaga urutan kausal meski jam device melenceng |
| **Append-only** | Record tidak pernah diubah; koreksi berupa record baru |
| **Step-up authorization** | Manajer memasukkan PIN tanpa memutus sesi kasir |
| **Exception report** | Laporan yang menyoroti pola tidak wajar (void, diskon, no-sale) untuk deteksi fraud |
| **Oversell** | Stok terjual melebihi yang tersedia akibat penjualan offline paralel |
| **Table stakes** | Fitur yang absennya membuat produk tidak dipertimbangkan sama sekali |
| **RLS** | Row-Level Security — isolasi data tenant ditegakkan di level database |
| **DST** | Deterministic Simulation Testing — pengujian sistem terdistribusi dengan keacakan terkendali |

### 15.3 Prior art yang dipelajari

Square (model katalog Item→Variation→Modifier, ledger Books) · Toast (batas offline, penomoran offline, daftar operasi yang dinonaktifkan) · Shopify POS (batas offline terdokumentasi, cash rounding, country-specific requirements) · Lightspeed (Lightserver sebagai pengakuan bahwa sync lokal butuh appliance) · ESB (matriks fitur sebagai peta table stakes F&B Indonesia) · Loyverse (KDS gratis sebagai lantai harga) · Odoo (batas sesi offline, pola vertical module).

---

*PRD induk Lumi POS v1 · Draft 0.1 · 27 Juli 2026*
