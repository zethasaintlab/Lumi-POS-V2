# Spec — Sub-proyek 2: Aplikasi kasir

Kampanye "Hidupkan desain LumiPOS apa adanya". Keputusan kampanye:
`docs/RENCANA-HIDUPKAN-DESAIN.md`. Spec ini disusun 28 September 2026 dari
`main` `f01d7d1`, sesudah sub-proyek 1 (fondasi) di-merge. **Belum disetujui
user.** Keputusan arah yang sudah diambil user tidak ditanyakan ulang; yang
belum diputuskan dikumpulkan di § 13.

Prinsipnya tetap satu kalimat: **identik secara tampilan, aman secara
perilaku.** Mockup menang untuk tampilan; spec dan test menang untuk perilaku
yang memindahkan uang, mengontrol kas, atau menyinkronkan data.

## 1. Tujuan dan batas

Membangun ulang setiap layar kasir mockup
(`docs/referensi-visual/sumber/ui_kits/kasir/index.html`, 11 layar, 23
kombinasi keadaan) di `apps/kasir`, termasuk yang sub-proyek 1 sengaja
tidak sentuh: header satu baris, toolbar delapan tombol, kartu
pembayaran bertoggle, keranjang tanpa stepper, dan dua layar baru (Edit Item,
pratinjau struk).

**Di luar sub-proyek ini:** layar back-office (sub-proyek 3), aplikasi
pelanggan (sub-proyek 4), `apps/hp`. Pengecualian: peta label metode
pembayaran back-office disentuh § 5 karena Transfer lahir di sini.

**Selesai bila:**

1. Setiap layar di § 2 cocok dengan mockup menurut penjaga DOM § 11, di
   1024×768 dan 1280×800.
2. Kedelapan tombol toolbar bekerja; tidak ada kontrol yang tidak melakukan
   apa pun di layar kasir mana pun (penjaga G-TOMBOL-HIDUP, § 11).
3. Setiap invarian di § 11 hijau, termasuk yang penjaganya diubah dalam commit
   tersendiri.
4. PR menyertakan link preview Vercel per layar yang berubah. Sub-proyek 2
   **tidak** punya gerbang visual: di-merge saat CI hijau dan tinjauan akhir
   bersih; user meninjau sesudahnya (`CLAUDE.md` § Gerbang visual).

## 2. Peta layar mockup → layar repo

| Mockup (`screen:state`) | Repo | Yang berubah |
|---|---|---|
| `login` | K-01 `layar/Login.tsx` | Sisa selisih kecil: judul/subjudul kartu mengikuti mockup. **Tetap 6 digit** (`spec-f:122`); salam "Halo, Rini Astuti" sebelum PIN tidak dibangun (pemilihan pengguna sebelum PIN tidak ada di spec) |
| `shift` | K-02 `layar/BukaShift.tsx` | Tombol "Kembali" mockup tidak dibangun (K-02 adalah gerbang, tidak ada tujuan kembali, `BANDING.md` § K-02). Field "Cash drawer" tidak dibangun (satu laci per perangkat). Selebihnya sudah dikejar Fase 3.8 rebuild UI |
| `kasir:campuran`, `keranjang-kosong`, `keranjang-penuh`, `katalog-kosong`, `offline` | K-03 `layar/Kasir.tsx` + K-17 | **Besar.** Header satu baris (§ 3), toolbar delapan tombol (§ 4), field cari tanpa label terlihat, keranjang tanpa stepper dengan baris 58 px (§ 6), baris Diskon selalu tampil, baris "Pajak · nama tarif" (keputusan bawaan #5), tombol kosongkan keranjang di kepala keranjang (= toolbar "Batalkan"), banner offline setinggi mockup |
| `edit-item` | **Baru**: `komponen/DialogEditItem.tsx` (memakai ulang pemilih modifier K-04/K-05) | § 6 |
| `bayar:tunai`, `qris-memuat`, `qris-siap`, `qris-terkonfirmasi`, `qris-kedaluwarsa`, `kartu`, `transfer` | K-06 `layar/Pembayaran.tsx` + `komponen/PanelQris.tsx` | **Besar.** Kartu pembayaran bertoggle empat metode, total di atas, QR di dalam kartu, Transfer, aksi "Konfirmasi bayar" (§ 5, § 7) |
| `sukses` | K-07 (tahap selesai `Pembayaran.tsx`) | Kembalian berwarna `--primary` seperti mockup; "Cetak Struk" membuka pratinjau struk (§ 8) |
| `struk:58mm`, `struk:80mm` | **Baru**: pratinjau struk, `komponen/PratinjauStruk.tsx` | § 8 |
| `riwayat:ada`, `riwayat:kosong` | K-08 `layar/Riwayat.tsx` | Penyaring Tanggal + Metode bayar, kolom Item dan Metode (§ 9). Nomor tetap `K1-YYYYMMDD-NNNN` (keputusan bawaan #3) |
| `void` | K-10 `komponen/DialogPembatalan.tsx` (dari K-09) | Sisa selisih kecil. **Tetap:** sistem memilih void/refund (`spec-b` § pemilihan otomatis), alasan daftar tertutup |
| `laci` | **Layar baru "Laci kas"** yang menampung FR-D5 (`DialogKasManual`) dan K-16 (`DialogNoSale`) | § 9 |
| `tutup` | K-12/K-13 `layar/TutupKas.tsx` | Dua kartu (Rekonsiliasi · Ringkasan shift) + bilah aksi bawah, **hanya di tahap `review`** (keputusan bawaan #1, FR-D2) |

Layar repo **tanpa** padanan mockup — K-09 Detail transaksi, K-11 Otorisasi,
K-14 Status sinkronisasi, K-15 Perangkat — tidak dirancang ulang. Mereka ikut
berubah hanya lewat header (§ 3) dan token.

## 3. Header satu baris dan navigasi berikon

**Target mockup** (`AppShell`, `ui_kits/kasir/index.html:67`): satu baris
68 px, latar `--card`, tepi bawah `--border`, padding 20 px. Kiri ke kanan:
wordmark (sudah ada, sub-proyek 1), nav empat tab berikon (ikon 18 px di atas
label 13/600, lebar minimum 76 px, aktif `--primary` + garis bawah 2 px),
lalu di kanan lonceng 44×44 dan tombol pengguna (avatar 28 px, nama 15/600,
chevron).

**Yang berubah di repo:**

- `ShellKasir.tsx`: `kasir-topbar` (61 px) dan `kasir-bilah` (45 px) digabung
  menjadi satu `header` 68 px. Terukur 28 September 2026 pada 1024×768: chrome
  atas turun dari 106 px ke 68 px di setiap layar selain K-03.
- **Tab nav mengikuti mockup:** Kasir · Riwayat · Laci kas · Tutup shift.
  `rute/tabel.ts` tetap satu-satunya sumber (`ruteNav()`), label dan ikon
  diganti: `layout-grid`, `receipt-text`, `wallet-cards`, `calculator`.
- **Sinkron dan Perangkat keluar dari bilah** dan pindah ke menu pengguna.
  Sinkron tetap dapat dicapai lewat indikator sinkron (`IA:114`, entry point
  K-14), jadi tidak ada fungsi yang hilang.
- **Indikator sinkron tetap di header**, di kiri lonceng. Mockup meletakkan pil
  "Online" di toolbar K-03, tetapi FR-H2 menuntut indikator di setiap layar,
  dan toolbar hanya ada di K-03. Aturan "Tersinkron tidak pernah tampil saat
  antrean tidak diketahui sehat" (`angkaDapatDipercaya`, `ShellKasir.tsx`)
  tidak berubah. Ini penyimpangan tata letak yang dicatat di
  `docs/referensi-visual/README.md`.
- **Identitas outlet · perangkat tetap terlihat** (`K1` adalah prefiks nomor
  struk). Ia pindah ke dalam tombol pengguna sebagai baris kedua 13 px di bawah
  nama, di dalam tinggi 44 px yang sama. Header tetap satu baris.
- **Menu pengguna** (chevron) berisi: nama + outlet · perangkat, Status
  sinkronisasi, Perangkat & uji cetak (K-15, peran Manajer+ tetap ditegakkan
  layar itu), dan **Keluar**. `keluar()` di `konteks/useSesi.ts` sudah ada dan
  sudah menolak logout saat antrean belum kosong (FR-H4, `spec-f:207`), tetapi
  **tidak ada satu tombol pun yang memanggilnya hari ini**. Menu ini
  menyambungkannya; pesan penolakannya ditampilkan apa adanya.
- **Lonceng**: lihat § 13 P7. Bawaan: panel "Pemberitahuan perangkat" yang
  hanya membaca data yang sudah ada di perangkat.
- **Pita antrean FR-H8** (`PitaAntrean.tsx`, terukur 61 px) dirender dengan
  bentuk banner offline mockup (padding 8 px, teks 13 px, ikon 15 px, ≈ 34 px).
  Kalimat, syarat, dan tautannya tidak berubah. Alasan tinggi: § 14 R1.

**Perilaku yang dijaga:** indikator sinkron sebagai entry point K-14; syarat
`angkaDapatDipercaya`; K-01 tanpa shell (`App.tsx`); `/login` dan
`/shift/buka` tidak pernah jadi tab (komentar `Rute.nav`).

## 4. Toolbar kasir delapan tombol

**Target mockup** (`Cashier`, baris `tools`): bilah 68 px di atas kolom
katalog saja (bukan di atas keranjang), latar `--card`, tombol ghost
min-lebar 70 px, tinggi 44 px, ikon 17 px di atas label 13/600. Pil
Online/Offline di kanan diganti indikator header (§ 3).

`SLOT_AKSI` dan `PortalAksi` dihapus: toolbar kini milik `Kasir.tsx` sendiri,
jadi portal ke shell tidak diperlukan lagi.

| # | Tombol (ikon) | Fungsi | Ada di kode hari ini | Yang dibangun |
|---|---|---|---|---|
| 1 | Item manual (`plus`) | Lihat § 13 P4. **Bawaan:** dialog masukan kode — kasir mengetik barcode/SKU saat scanner gagal atau label rusak | `cariBarcode` + jalur `dipindai` di `layar/Kasir.tsx` (K-17) | Dialog berisi satu `Bidang` + tombol Tambah; hasilnya lewat `dipindai`, jadi aturan stok FR-E4/E5 dan pesan "Barcode tidak dikenali" tetap satu jalur |
| 2 | Diskon (`calculator`) | Diskon tingkat order FR-B8 | `komponen/DialogDiskon.tsx`, `kasir/diskon.ts` `statusDiskon` | Pindah dari slot bilah ke toolbar. Tetap **hilang** saat kill switch `diskon_kasir` mati (bukan nonaktif) |
| 3 | Pajak (`receipt-text`) | Keputusan bawaan #2: pilihan tarif outlet yang sudah terdefinisi. **Diterjemahkan sebagai pilihan kanal Dine in/Takeaway** — lihat di bawah dan § 13 P9 | `hitungKeranjang(... channel)` sudah menerima `channel` (`kasir/penjualan.ts:351`), server menerima `body.channel`; tetapi layar selalu memakai `'takeaway'` | Lembar pilihan kanal yang menampilkan nama tarif hasil resolusi `TaxCalculator` untuk setiap kanal; `channel` disimpan di keranjang |
| 4 | Catatan (`pencil`) | Catatan tingkat pesanan, tercetak di struk | Tidak ada. `order` tidak punya kolom catatan (`0007_ordering.sql`) | Lihat § 13 P6 |
| 5 | Pelanggan (`user-round`) | Nama pemesan ("atas nama"), tercetak di struk | Tidak ada. `check.label` ada di skema server dan lokal tetapi selalu `NULL` (`orders.ts` `INSERT_CHECK_SQL`, `penjualan.ts:781`) | Lihat § 13 P5 |
| 6 | No. Meja (`utensils-crossed`) | Label meja, tercetak di struk. **Bukan** manajemen meja (v1.1, `CLAUDE.md` § Jangan bangun) | Tidak ada | Lihat § 13 P5 |
| 7 | Batalkan (`trash-2`) | Mengosongkan keranjang yang belum dibayar | `kosongkan()` di `kasir/keranjang.ts:226`; tidak dipakai layar mana pun | Konfirmasi "Kosongkan keranjang? N item" lalu `setelKeranjang(keranjangKosong())`. Juga dipanggil ikon tempat sampah di kepala keranjang (mockup). Tanpa baris database: keranjang belum menjadi `order` (FR-B1 AC: `DRAFT` yang ditinggalkan tidak menghasilkan baris) |
| 8 | Pesanan tahan (`pause-circle`) | Menyimpan keranjang berjalan untuk dilanjutkan, lalu memulai keranjang baru | Parsial: `kasir/keranjang-simpan.ts` (KEP-21) menyimpan **satu** keranjang berjalan per perangkat (`id = 'kini'`) | Tabel **murni lokal** baru `keranjang_tahan` (tidak didaftarkan ke PowerSync, tidak naik ke server). Tombol membuka daftar tahanan shift ini: Tahan pesanan ini · Lanjutkan · Buang |

### Pajak sebagai pilihan kanal

`TaxCalculator` meresolusi tarif menurut item > kategori > semua, kanal
spesifik > `all`, outlet > tenant (FR-C6, FR-C7). Kasir yang memilih
**tarif** secara langsung akan melompati resolusi itu, dan itu pelanggaran
FR-C6, bukan pilihan tampilan. Satu-satunya masukan per pesanan yang spec
izinkan adalah **kanal**: `spec-c` FR-C7, "Sumber channel: `Order.channel`
diisi dari `SegmentedControl` Dine In/Takeaway di layar kasir." Itu AC yang
belum pernah dibangun.

Karena itu tombol Pajak membuka lembar berisi dua pilihan kanal, masing-masing
menyebut tarif yang akan berlaku ("Takeaway · PBJT 10%"). Nama tarif diambil
dari hasil `hitungKeranjang`, tidak ditulis di layar (invariant #7). Outlet
tanpa tarif per kanal menampilkan tarif yang sama di kedua pilihan, dan
lembarnya mengatakan itu. Label tombol menyebut kanal aktif.

Konsekuensi yang dinyatakan: fixture `channel = 'dine_in'` + service charge
yang dituntut `uang-pembayaran-kas.md` § "K-06/K-07 tidak boleh dinyatakan
selesai tanpa tiga fixture ini" menjadi wajib di task ini.

### Pesanan tahan — batas yang dinyatakan

- Murni lokal, satu perangkat. **Bukan** berbagi order antar perangkat
  (non-goal v1.1) dan **bukan** `order` berstatus `open` (alasan di kepala
  `keranjang-simpan.ts`).
- Terikat `shift_id`. Harga diresolusi ulang saat dilanjutkan dan saat
  disimpan (FR-H6), jadi tahanan yang melewati perubahan harga ditagih harga
  baru. Keranjang yang dilanjutkan menyebut itu bila subtotalnya berubah.
- Diskon ikut ditahan beserta `nominalDisetujui`; aturan "potongan yang tumbuh
  menuntut persetujuan baru" tetap dari `statusDiskon`.
- **K-12 menolak tutup shift selama ada tahanan** dan menampilkan daftarnya,
  sejajar FR-B1 AC keempat ("Menutup shift dengan order OPEN menampilkan
  daftar dan meminta konfirmasi per order"). Membuang tahanan tidak menulis
  apa pun ke server, sama seperti Batalkan.
- Batas jumlah tahanan: 20 per shift `[ASUMSI]`.

### Aturan tombol

- Tombol yang kill switch-nya mati **hilang**, tidak nonaktif (pola yang sudah
  ada untuk Diskon).
- Tombol yang tidak berlaku pada keadaan sekarang (keranjang kosong untuk
  Diskon, Catatan, Batalkan, Tahan) **nonaktif dengan alasan** yang terbaca,
  bukan hilang.
- Scanner global (`usePemindaiGlobal`) dimatikan saat dialog toolbar mana pun
  terbuka, alasan yang sama dengan dialog yang sudah ada.
- Buka laci dan Kas masuk/keluar **tidak** lagi di K-03; keduanya pindah ke
  layar Laci kas (§ 9). "Maksimal 2 tap dari K-03" (`IA:104`) tetap: tab Laci
  kas lalu tombolnya.

## 5. Transfer sebagai metode pembayaran keempat

### Yang sudah diputuskan dokumen

- `spec-c:244` (FR-C2): **"Lainnya — ✅ online, ✅ offline — Voucher fisik,
  transfer, dll — dengan catatan wajib."** Ini satu-satunya kemunculan
  "transfer" sebagai pembayaran di `product/` (`rg -n -i transfer product/`;
  kemunculan lain adalah `transfer_in`/`transfer_out` stok v1.1).
- `docs/referensi-visual/README.md` § Diterima: Transfer diterima di toggle,
  "`spec-c:244` tetap menuntut Transfer dicatat dengan catatan wajib di bawah
  'Lainnya' — perilaku pencatatannya tidak berubah, hanya kemunculannya di
  toggle."
- Skema sudah menerimanya: `payment.method` CHECK memuat `'other'`
  (`db/migrations/0008_payment.sql:16`), begitu juga `refund.method`
  (`0021_refund_method.sql:53`). Tabel `payment` lokal tidak punya CHECK
  metode (`db/local/001-initial.sql:466`).

### Yang belum ada di kode

| Tempat | Keadaan hari ini |
|---|---|
| Server `payment` | `SUPPORTED_METHODS` = cash, qris_dynamic, qris_static, card_edc. `other` **ditolak** `PAYMENT_METHOD_UNSUPPORTED` (`handlers/payments.ts:93`) |
| Domain | `pembayaran-manual.ts` tidak punya aturan untuk `other`; `dikonfirmasiManual` hanya `qris_static`; `MetodeCampuran` tidak memuat `other` (`pembayaran-campuran.ts:38`) |
| Kasir | `MetodeBayar` tidak memuat `other` (`kasir/penjualan.ts:77`) |
| Label | `other: 'Lainnya'` di `metode-tampilan.ts`, `cetak/metode.ts`, dan **dua salinan lokal** di back-office (`penjualan/b04.ts:65`, `laporan/Pembayaran.tsx:70`) |

### Rancangan (bawaan, sampai § 13 P1 dan P2 dijawab)

**Transfer adalah metode konfirmasi-manual yang berfungsi offline**, bentuknya
sama dengan QRIS statis: tidak ada sistem yang memverifikasi, kasir
menyatakan uang sudah masuk berdasarkan bukti di ponsel pelanggan.

- **Penyimpanan:** `method = 'other'`, `provider = 'bank_transfer'`,
  `provider_reference` = nomor referensi dari bukti transfer (**wajib**),
  `acquirer` = bank tujuan (opsional, teks bebas). Nol migrasi: semua kolom
  sudah ada. `provider` membedakan transfer dari voucher kelak.
- **Validasi di domain, dipakai perangkat dan server** (pola
  `uang-pembayaran-kas.md` § "Aturan validasi QRIS statis dan EDC hidup di
  `pembayaran-manual.ts`"): `periksaTransfer(referensi, bank)` =
  `periksaReferensi` (≥ 3 karakter) + `periksaBukanNomorKartu` pada kedua
  field (FR-C5 AC keempat). Nomor rekening 10 digit lolos; 13–19 digit ditolak
  `POSSIBLE_CARD_NUMBER`.
- **`confirmed_manually`**: lihat § 13 P2. Bawaan **`true`**, supaya transfer
  masuk laporan exception FR-G5 bersama QRIS statis.
- **Server:** `other` masuk `SUPPORTED_METHODS` dan `MANUAL_METHODS`;
  `recordManualPayment` mendapat cabang `other` yang menuntut `provider` dari
  daftar tertutup (`'bank_transfer'` saja di v1).
- **Kas:** tidak menulis `cash_movement`. Aturan yang sudah ada berlaku tanpa
  perubahan: perangkat hanya menulis movement untuk `bagianTunai`
  (`penjualan.ts:917`), server hanya di cabang tunai (`payments.ts:980`).
  Penjaga baru membuktikannya untuk `other` (§ 11 G-TRF-KAS).
- **Pembulatan FR-C9:** tidak berlaku (`metodeDibulatkan` hanya `cash`).
- **Pembayaran campuran:** Transfer adalah bagian non-tunai. Ia dikirim
  **sebelum** bagian tunai lewat rantai `depends_on` yang sudah ada.
  Kelebihan bayar Transfer ditolak (aturan non-tunai).
- **MDR:** `null` (`metodePunyaPerkiraanMdr` tidak memuat `other`; transfer
  tidak punya potongan akuisisi).
- **Refund:** `refund.method` sudah menerima `other`. Refund dari order
  bertransfer tidak menyentuh laci.
- **Kill switch:** kunci baru `pembayaran_transfer`, bawaan menyala, pola yang
  sama dengan `pembayaran_qris_statis` (permukaan fraud yang tidak
  diverifikasi sistem). Tidak menyentuh audit, tidak menghentikan penjualan
  (tunai tetap ada).
- **Label:** `LABEL_METODE` diturunkan dari `(method, provider)`:
  `other` + `bank_transfer` → "Transfer", `other` lain → "Lainnya". Dua
  salinan back-office dihapus dan diganti impor `labelMetode` (salinan kelima
  dan keenam dari peta yang `TutupKas.tsx:76` sudah pernah temukan
  menyimpang). Struk (`cetak/metode.ts`): "Transfer", ditambah baris "Ref:
  …" dan penanda konfirmasi manual, sejajar QRIS statis.
- **Laporan:** `posisi-penjualan.ts` tidak disentuh (omzet tidak per metode).
  Rincian per metode di B-03/B-04/M-01/K-12 mengelompokkan menurut
  `method`; transfer tampil sebagai baris sendiri bila pengelompokan
  memakai label turunan `(method, provider)`. Plan memeriksa setiap query
  `GROUP BY method` dan memutuskan per query; yang tidak diubah tetap
  melaporkan transfer di bawah "Lainnya", dan itu dinyatakan.
- **Kompatibilitas N-1:** server lama menolak `other`. Urutan rilis: server
  dulu, klien sesudahnya. Klien baru yang bertemu server lama menerima
  `PAYMENT_METHOD_UNSUPPORTED` dan barisnya berhenti di outbox — kondisi yang
  dicegah urutan rilis, dan dinyatakan di runbook.

**Test yang wajib** (DoD uang, `CLAUDE.md`): property (`other` tidak pernah
menghasilkan `cash_movement`; transfer + tunai menutup tagihan tepat;
kelebihan transfer ditolak), idempotensi dengan respons hilang
(`pembayaran-offline-relay.test.js`), perangkat mati di tengah (penjualan
bertransfer tersimpan lokal lalu terkirim), isolasi tenant, audit event
`payment.recorded` dengan aktor.

## 6. Keranjang tanpa stepper dan layar Edit Item

### Baris keranjang (mockup `Cart`)

Satu tombol per baris, tinggi 58 px: lencana qty `2x` (kotak 36 px
`--accent-subtle`, teks `--primary` 13 px), nama 15 px + "Rp X per item"
13 px, subtotal baris 15 px di kanan. Menyentuh baris membuka Edit Item.

- Tidak ada `.stepper`, tidak ada tombol hapus di baris.
- Subtotal baris tetap `satuanKeranjang(b) * qty / 1000n` (bigint), modifier
  tetap tampil sebagai teks 13 px di bawah nama (dengan `×2` untuk modifier
  berkuantitas). Harga per item memakai `satuanKeranjang`, bukan
  `unitPrice` saja, supaya modifier ikut.
- `CartRow` bundle tetap **tidak** dipakai (`komponen-bundle-uang.test.js`).
- Area tekan ≥ 44 px dipenuhi tinggi baris sendiri; lencana adalah
  tampilan, bukan kontrol.

### Layar Edit Item (mockup `EditItem`)

Dialog 512 px, judul "Edit item" + nama item, tombol tutup 44×44. Dirender
dengan kelas `.overlay`/`.dialog` dan `LatarDialog` (latar tidak menutup
dialog), bukan `<Modal>` bundle.

| Elemen mockup | Keputusan |
|---|---|
| Jumlah dengan −/+ 56 px | **Dibangun.** Qty draf, bukan langsung ke keranjang |
| Harga sementara | **Ditolak** (tetap, `BANDING.md` § Edit item): harga diresolusi dari `price_history` pada `occurred_at` (FR-A7, FR-H6) |
| Diskon item | **Ditolak**: diskon per baris tidak dibangun (`uang-pembayaran-kas.md` § diskon; `POST /orders` hanya menerima diskon order) |
| Catatan per item | **Ditolak**: `order_line` tidak punya kolomnya. Catatan tingkat pesanan ada di toolbar (§ 4 #4) |
| Tombol "Hapus item" merah terpisah | **Ditolak** (`CLAUDE.md` § aturan `/ds-bundle`: qty turun ke 0 menghapus baris, "meniadakan tombol Hapus terpisah"). Diganti perilaku di bawah |
| Batal · Simpan | **Dibangun** |
| (tidak ada di mockup) Pilihan modifier | **Ditambahkan**, memakai ulang pemilih dari `DialogModifier.tsx` (`IA:63-64`: hanya bila item punya modifier) |

**Perilaku:**

- − di qty 1 menurunkan draf ke 0, dan labelnya berubah menjadi "Hapus". Pada
  draf 0 tombol utama berbunyi **"Hapus dari keranjang"** (varian danger, satu
  aksi utama), dan menekannya memanggil `ubahQty(k, id, 0)` → `hapusBaris`
  → `lepasDiskonBilaKosong`. Tidak ada tombol hapus kedua di mana pun.
- ⛔ **Kenaikan qty melewati `keputusanStok` dan penandaan habis FR-E5**, sama
  dengan ketukan kartu. **Temuan:** tombol `+` stepper hari ini memanggil
  `ubahQty` langsung (`layar/Kasir.tsx:991`) dan melewati pemeriksaan stok
  FR-E4 yang ketukan kartu jalankan (`pilihVariation`). Edit Item menutup
  lubang itu; pesannya kalimat yang sama.
- Modifier diganti lewat fungsi murni baru `gantiModifier(k, barisId,
  modifier)` di `keranjang.ts`. Bila hasilnya sama persis dengan baris lain
  (variation + modifier), keduanya digabung, perilaku yang sama dengan
  `tambah`. Variation tidak dapat diganti di sini; kasir menghapus lalu
  menambah ulang.
- **Interaksi diskon:** diskon tetap tingkat order. Edit Item tidak
  menampilkan field diskon. Subtotal yang berubah membuat `statusDiskon`
  menghitung ulang pada render berikutnya; potongan yang tumbuh melewati
  `nominalDisetujui` memunculkan peringatan yang sudah ada dan menonaktifkan
  Bayar.
- Simpan menerapkan draf dalam **satu** `setelKeranjang`, jadi
  `simpanKeranjang` (KEP-21) menulis satu kali.
- Scanner global mati selama dialog terbuka.

## 7. Kartu pembayaran bertoggle (K-06) dan QR di dalam kartu

### Target mockup (`Payment`)

Halaman dengan "Kembali ke kasir" di atas; kartu 728 px (terukur, `BANDING.md`): blok total
("TOTAL BELANJA" 13 px huruf kapital, nilai 32/700) di atas, segmented empat
tab (Tunai · QRIS · Kartu · Transfer, tinggi 40 px dalam wadah `--secondary`),
isi metode (min 355 px), bilah bawah dengan satu aksi kanan
"Konfirmasi bayar" 56 px.

### Wadah

K-06 dirender **di dalam** `kasir-konten` sebagai halaman (header tetap
terlihat, seperti mockup), bukan overlay `kasir-overlay-bayar`. K-03 tetap
di-unmount di baliknya, jadi `usePemindaiGlobal` tetap mati selama
pembayaran (alasan di `Kasir.tsx:505`). Selama QRIS dinamis menunggu atau
penjualan sedang disimpan, tab nav header **terkunci** (`aria-disabled` +
kalimat alasan), karena meninggalkan layar di tengah menghapus nominal yang
sudah diketik. Keputusan otonom, § 12.

### Isi per metode

| Tab | Isi | Sumber perilaku |
|---|---|---|
| Tunai | Field "Nominal diterima" (awalan `Rp`, rata kanan, pola K-12) + pintasan pecahan | `PECAHAN` yang ada. Mockup memberi tiga pintasan 44 px; repo tetap enam pecahan, tampil 44 px dengan `.sentuh-uang` |
| QRIS | Sub-pilihan **QRIS dinamis** / **QRIS statis**, lalu isi masing-masing | Dinamis: `mulaiQris` + `PanelQris` (FR-C14). Statis: field referensi wajib (FR-C2). Dinamis tetap terlihat dan nonaktif dengan "Perlu internet" saat tak terjangkau (FR-C3, P5). Statis hilang saat `pembayaran_qris_statis` mati |
| Kartu | Kode approval (wajib), 4 digit terakhir (opsional) | FR-C4. Mockup menulis "Jenis kartu" + "Nomor referensi"; label repo tetap karena kolomnya `approval_code`/`card_last4` |
| Transfer | "Bank tujuan" + "Nomor referensi" (wajib) | § 5 |

- **Total dari `hitungan.totals.total`**, di blok atas. Pembulatan FR-C9
  **tidak** tampil di K-06 (P2).
- ⛔ **Panel "Kembalian" mockup di tab Tunai DITOLAK.** Kembalian bergantung
  pada `amount_due` yang baru ada sesudah pembulatan di `simpanPenjualan`;
  menampilkannya di K-06 melanggar FR-C9 dan penjaga P3. Panel yang sama
  (latar `--accent-subtle`, 32/700) dipakai untuk **"Uang diterima"**, dan
  kembalian tetap hanya di K-07. Dicatat di `docs/referensi-visual/README.md`.
- **Pembayaran campuran** (keputusan bawaan #4): tautan kecil "Bayar dengan
  lebih dari satu metode" di bawah isi metode. Membukanya menampilkan daftar
  bagian ber-Hapus dan sisa tagihan (P7) di dalam kartu yang sama.
- **Aksi utama berlabel "Konfirmasi bayar"** untuk Tunai, QRIS statis, Kartu,
  dan Transfer. Galat tetap di atas bilah aksi (P8).

### QRIS dinamis di dalam kartu

- QR tampil di dalam kartu (mockup `QR`, 192 px), dengan nominal, kalimat
  "Pindai QRIS untuk membayar", dan hitung mundur dari `BATAS_POLLING_MS`
  ("Berlaku selama 04:56").
- ⛔ **Konfirmasi hanya dari gateway** (`spec-c:320`). Selama `pending`,
  tombol utama tampil di tempat yang sama tetapi **nonaktif** dan berlabel
  **"Menunggu pembayaran…"**; `confirmed` datang hanya dari `cekStatus`/
  polling, lalu `selesaikanQris` menulis penjualan. Tidak ada jalur ketukan
  yang menandai lunas.
- ⛔ **Toggle metode dan keranjang terkunci** selama menunggu: segmented
  dinonaktifkan dengan alasan tertulis, tautan pembayaran campuran dan
  "Kembali ke kasir" hilang, tab nav terkunci. Keranjang tidak dapat diubah
  karena K-03 tidak di-mount. "Tutup layar" (hasil `ditunda`, draf tetap
  hidup) dan "Cek status" tetap ada.
- Keadaan `memuat` (kerangka `--skeleton-bg`), `terkonfirmasi` (lingkaran
  centang hijau + "Pembayaran terkonfirmasi"), dan `kedaluwarsa` ("Kode QR
  kedaluwarsa" + "Buat kode baru") mengikuti mockup. Kalimat P6 yang
  membedakan habis waktu dari ditolak penerbit tidak berubah.
- **Kapan QR diminta**: § 13 P3. Bawaan: kartu QRIS dinamis menampilkan
  nominal + tombol sekunder "Tampilkan kode QR"; QR baru diminta saat itu
  ditekan.
- **Encoder QR**: § 13 P3b. `qrString` tetap tersedia sebagai teks yang dapat
  dipilih di bawah gambar (jalur salin), sesuai README § Diterima.
- Pemulihan draf (`pulihkanDraf`, `spec-c:328`) langsung membuka tab QRIS
  dalam keadaan menunggu, terkunci.

## 8. K-07 dan pratinjau struk

**K-07** (mockup `Success`): kartu 536 px (terukur, `BANDING.md`), lingkaran centang, "Transaksi
selesai", nomor struk (`K1-…`, bukan `TRX-…`) + nama kasir, panel kembalian
`--accent-subtle` dengan angka 32/700 **berwarna `--primary`** (mockup; aksen
di sini angka, bukan aksi kedua), grid 2×2 tombol. Pembulatan tetap tampil
hanya di sini. Kalimat hasil cetak pertama (`kalimatCetak`) tetap.

- "Cetak Struk" → pratinjau struk (mockup `sukses → struk`).
- "Transaksi Baru" tetap `setelKeranjang(keranjangKosong())`.
- "Kirim WhatsApp" dan "Kirim Email": § 13 P8. Bawaan: tidak dirender
  (tidak ada tombol mati); grid menjadi dua tombol.

**Pratinjau struk** (mockup `Receipt`): judul "Preview struk", toggle
58mm/80mm, kertas putih berbayangan, teks `--font-mono` 13 px (satu-satunya
pemakaian mono, `tokens/typography.css`).

⛔ **Satu formatter, tidak dua.** Isinya dibangun oleh
`bangunUlangStruk(db, orderId, …)` (`cetak/ulang.ts`) → `ReceiptDocument`,
jalur yang sama dengan cetak ulang K-09/K-07. Tata letak barisnya diambil
dari fungsi murni baru `tataLetakStruk(dok, profil): string[]` yang
diekstrak dari `renderEscPos` (`lipat`, `duaKolom`, `keAscii`), dan
`renderEscPos` memanggil fungsi yang sama. Pratinjau karena itu tidak dapat
menyimpang dari byte yang dicetak: transliterasi, pemotongan kiri dua kolom,
dan lebar 32/48 kolom sama persis. Perataan tengah (yang di printer diserahkan
ke `ESC a`) dirender di pratinjau dengan `text-align`, bukan spasi.

- Lebar kolom dari `PROFIL_58MM`/`PROFIL_80MM`; bawaan toggle = profil
  berlaku perangkat (`profilBerlaku`).
- Tombol "Cetak" di pratinjau memanggil `cetakUlangOrder` — jalur yang sama,
  hasilnya lewat `kalimatCetak`. Invariant #3 tidak berubah: penjualan sudah
  tersimpan sebelum pratinjau dapat dibuka.
- Pratinjau adalah **mode**, bukan rute (IA §7 tidak memberinya URL). Dapat
  dibuka dari K-07 dan dari K-09.
- Mockup menulis "Pajak" tanpa nama tarif: **tetap ditolak** untuk struk
  cetakan pertama (`spec-c:404`). Cetak ulang yang berbunyi "Pajak" adalah
  batas yang sudah dinyatakan (`cetak.md`), dan pratinjau menampilkannya apa
  adanya.
- Utang yang dinyatakan: struk belum mencetak Catatan/label pesanan sampai
  task § 4 #4–#6 selesai; urutan task di § 15 menaruh struk sesudahnya.

## 9. Layar lain

**Laci kas (baru, tab nav).** Mockup `CashDrawer`: dua kartu berdampingan.

- Kiri "Operasional laci": toggle Kas masuk/Kas keluar, nominal (awalan
  `Rp`), **alasan daftar tertutup** (bukan "Keterangan" teks bebas: FR-D6
  menurunkan `counterpart_type` dari alasan — tetap ditolak), "Simpan
  catatan". Logika dan penulisannya `kas/manual.ts` apa adanya; `jumlah`
  selalu positif, `arah` menurunkan tanda.
- Di bawahnya tombol sekunder **"Buka laci tanpa transaksi"** (K-16,
  `DialogNoSale`, kill switch `buka_laci_no_sale`, ambang PIN di atas 3×).
- Kanan "Riwayat shift berjalan": daftar kas masuk/keluar shift ini dari
  `cash_movement` lokal, baca-saja. Movement penjualan tunai tidak
  ditampilkan (mockup hanya menampilkan kas manual). Tanpa saldo: saldo laci tetap hanya di K-12 tahap
  review (hitungan buta FR-D2 tidak boleh dibocorkan lewat layar lain).
- Rute: § 13 P10. Bawaan `/laci`.

**K-08 Riwayat.** Tambah penyaring Tanggal (tanggal bisnis, jendela riwayat
lokal) dan Metode bayar (dari `LABEL_METODE`), kolom Item (jumlah baris) dan
Metode (satu metode, atau "Campuran"). Status tetap turunan pembatal +
status kirim FR-H3, bukan "Selesai" tunggal.

**K-12 Tutup kas.** Tahap `review` memakai tata letak dua kartu mockup
(Rekonsiliasi kas · Ringkasan shift) dan bilah aksi bawah dengan "Tutup
Shift". Tahap `hitung` tetap tanpa satu angka pun yang bocor
(`k12-hitungan-buta`). "Total penjualan" dan "Penjualan per metode" hanya di
`review`. Tutup ditolak selama ada Pesanan tahan (§ 4).

**K-01, K-02, K-10.** Hanya selisih sisa di § 2.

## 10. Utang dari sub-proyek 1

1. **Tinggi baris.** `packages/ds/lumi.css` mendefinisikan `line-height`
   untuk keempat token mockup: display 1.15, title 1.3, body 1.5, small 1.4
   (`sumber/tokens/typography.css`). Diterapkan pada kelas bundle yang
   memetakan ke token itu (`t-display`, `t-title`, `t-body`, `t-body-md`,
   `t-caption`) dan pada `body`. Task pertama sub-proyek ini, karena ia
   mengubah setiap pengukuran sesudahnya. Terukur hari ini: nama kartu K-03
   15 px ber-`line-height` 18,75 px (1,25); dengan 1,5 menjadi 22,5 px, dan
   kartu berfoto tumbuh 7 px (148 → 155).
2. **`.pita-kategori`** dihapus dari `lumi.css:697` (CSS mati sejak Task 9
   sub-proyek 1). Token `--kat-*` dan `gayaKategori` **tetap**: satu-satunya
   pemakainya `apps/backoffice/src/katalog/Produk.tsx` (`chip-kategori`), dan
   nasibnya milik sub-proyek 3. Komentar yang menyebut `pita-kategori` di
   `Kasir.tsx` dan `Fondasi.tsx` dirapikan.

## 11. Invarian dan penjaga

### Penjaga lama yang memaku tata letak lama

Diubah dalam **commit tersendiri** yang menyebut keputusan kampanye 26
September 2026, sebelum kode yang membuatnya merah, dan tidak pernah dicampur
dengan kode itu.

| Penjaga | Yang dipaku | Menjadi |
|---|---|---|
| `k03-chrome.test.js` "portal aksi: ketiga tombol…" | `.kasir-slot-aksi` berisi tepat Diskon · Buka laci · Kas masuk / keluar | Toolbar berisi tepat kedelapan label mockup, urut, dan tidak ada di header |
| `k03-chrome.test.js` anggaran chrome | membaca `.kasir-topbar` + `.kasir-bilah` untuk diagnostik | membaca `header` + toolbar; ambang ≥ 12 tidak berubah |
| `k03-kepadatan.test.js` keranjang | baris ≥ 82 px (stepper 44 px) | baris 58 px ± 2, area tekan baris ≥ 44 |
| `k14-tata-letak.test.js` "tinggi bilah nav SAMA di kelima layar" | `.kasir-bilah` + `.kasir-slot-aksi` | tinggi `header` 68 px sama di setiap layar ber-shell, termasuk saat indikator sinkron memuat teks terpanjang ("Gagal kirim (N) · Coba lagi") |
| `k12-aksi-slot.test.js` | "Tutup Kas" di slot bilah nav | "Tutup Shift" di bilah aksi bawah, terlihat tanpa gulir di tahap review |
| `k06-penjaga.test.js` P1 | pemilih metode **tidak ada di DOM** selama panel QRIS | pemilih metode ada tetapi setiap tab `disabled`, dengan alasan; "Kembali ke kasir" dan tautan campuran **tidak ada**; tombol utama nonaktif berlabel "Menunggu pembayaran"; tab nav terkunci. Keputusan kampanye "Selama QRIS menunggu, toggle metode dan keranjang terkunci" menggantikan "tidak ada di DOM" |
| `k06-penjaga.test.js` P5, P7, P8, P9 + `galeri-cakupan.test.js` K-07 + `k06-tata-letak.test.js` + `k07-konfirmasi.test.js` | teks "Simpan Penjualan", `QRIS`/`QRIS statis`/`Kartu (EDC)` sebagai tombol, "metode SATU baris 56 px", Total di blok aksi bawah, "Cetak ulang di kiri, Transaksi Baru 56 px di kanan" | "Konfirmasi bayar", segmented empat tab + sub-pilihan QRIS, Total di blok atas 32/700, K-07 grid tombol |
| `laci-kas.test.js` | dialog kas manual dari K-03, toggle 56 px | layar Laci kas dua kartu; toggle tampil 44 px dengan `.sentuh-uang` |
| `galeri-cakupan.test.js` dialog kas masuk/keluar dan buka laci | dibuka dari K-03 | dibuka dari Laci kas |
| `area-sentuh.test.js` S8 | `.stepper` keranjang | baris keranjang dan tombol Edit Item |
| `warna-tombol.test.js`, `komponen-bundle-uang.test.js` | disebut `stepper` | diperiksa di plan; `komponen-bundle-uang` tetap melarang `CartRow`/`ProductCard` |
| `tests/kasir/rute.test.js`, `urutan-tampilan.test.js` | `TABEL_RUTE` = IA §7, urutan nav lima tab | empat tab mockup; `/laci` bila P10 disetujui, bersama penyuntingan IA §7 |

### Invarian yang wajib hijau tanpa disunting

- ≥ 12 kartu tanpa gulir pada 1024×768 dan 1280×800 (`k03-kepadatan`,
  `k03-chrome`, IA:62);
- posisi Bayar sama untuk 0, 3, dan 20 item (`k03-bayar-tetap`);
- K-14 ≥ 3 baris tabel (`k14-tata-letak`);
- hitungan buta K-12 (`k12-hitungan-buta`);
- P2 dan P3 (`k06-penjaga`): pembulatan dan kata "Kembalian" tidak pernah di
  K-06; `tests/kasir/penjualan.test.js` untuk pembulatan hanya di
  `simpanPenjualan`;
- label terhubung (`bidang-label`), termasuk field cari yang labelnya kini
  tak terlihat (label tetap ada, disembunyikan secara visual);
- area chip tidak bertumpuk (`k03-area-chip`), skala teks (`skala-teks`),
  palet (`palet-berlaku`), nol hex (`nol-hex-css`), ikon Lucide
  (`ikon-lucide`, `ikon-bundle`), `ds-bundle` tidak disunting.

Bila salah satunya merah karena ukuran mockup: kondisi berhenti, laporkan.

### Penjaga baru

| # | Penjaga | Berkas | Jenis |
|---|---|---|---|
| G-HEADER | Header satu baris 68 px di setiap layar ber-shell pada 1024 dan 1280; wordmark, empat tab, indikator sinkron, lonceng, tombol pengguna semuanya di dalam kotak header (tidak membungkus); outlet · perangkat terbaca | `tests/kasir-dom/header.test.js` | DOM |
| G-TOMBOL-HIDUP | Setiap `button` yang terlihat dan tidak `disabled` di setiap layar × keadaan galeri, diklik, mengubah DOM (dialog terbuka, rute berubah, atau keadaan berubah). Tombol nonaktif wajib punya `aria-describedby` berisi alasan | `tests/kasir-dom/tombol-hidup.test.js` | DOM |
| G-TOOLBAR | Kedelapan tombol membuka fungsinya masing-masing; Diskon hilang saat `diskon_kasir` mati; Batalkan mengosongkan keranjang **dan** baris `keranjang_lokal` | `tests/kasir-dom/k03-toolbar.test.js` | DOM |
| G-EDIT | Menyentuh baris membuka Edit Item; qty naik melewati batas stok ditolak dengan kalimat FR-E4; qty 0 menghapus baris; tidak ada tombol berlabel "Hapus item" terpisah | `tests/kasir-dom/edit-item.test.js` + `tests/kasir/keranjang.test.js` (`gantiModifier`) | DOM + murni |
| G-TAHAN | Tahan → keranjang kosong; Lanjutkan → keranjang pulih identik; K-12 menolak tutup selama ada tahanan; `keranjang_tahan` tidak terdaftar sebagai raw table (`skema-lokal`) | `tests/kasir/keranjang-tahan.test.js` + DOM | murni + DOM |
| G-KANAL | Pilihan Dine in mengubah tarif yang tampil **dan** `order.channel` yang tersimpan; angka pajak tetap dari `TaxCalculator` (fixture `ppn` 11% + `dine_in` + service charge) | `tests/kasir/penjualan.test.js` + DOM | murni + DOM |
| G-TRF | `other`/`bank_transfer` tanpa referensi ditolak di perangkat **dan** server dengan pesan yang sama; 13–19 digit → `POSSIBLE_CARD_NUMBER` | `tests/domain/pembayaran-manual*.test.js`, `tests/payment/manual-methods.test.js` | murni + PostgreSQL |
| G-TRF-KAS | Property: penjualan apa pun yang memuat bagian transfer menulis `cash_movement` hanya sebesar bagian tunainya, di perangkat dan di server | `tests/kasir/penjualan.test.js`, `tests/payment/*` | property |
| G-TRF-RELAY | Transfer offline → outbox → server, dengan retry dan respons hilang, tanpa baris ganda | `tests/payment/pembayaran-offline-relay.test.js` | PostgreSQL |
| G-LABEL | Satu peta label metode: tidak ada `LABEL_METODE` lokal di `apps/backoffice` | `tests/runtime/` (pindai) | pindai |
| G-QR | QR yang dirender di-decode di peramban (decoder di devDependency test) dan hasilnya **sama persis** dengan `qrString` | `tests/kasir-dom/k06-qr.test.js` | DOM |
| G-STRUK | `tataLetakStruk(dok, profil)` sama dengan teks yang diturunkan dari byte `renderEscPos` (kode ESC dibuang), untuk 58 dan 80 mm, termasuk transliterasi dan dua kolom yang dipotong; pratinjau di DOM menampilkan baris yang sama | `tests/kasir/escpos.test.js` + `tests/kasir-dom/pratinjau-struk.test.js` | murni + DOM |
| G-IA62-PITA | ≥ 12 kartu pada 1024×768 dengan kartu berfoto **dan** pita antrean FR-H8 tampil | `k03-kepadatan.test.js` (skenario baru) | DOM |
| G-LH | `line-height` yang dihitung untuk setiap elemen teks galeri ∈ {1.15, 1.3, 1.5, 1.4} × ukurannya | `tests/kasir-dom/skala-teks.test.js` | DOM |
| G-KELUAR | Menu pengguna → Keluar memanggil `keluar()`; dengan antrean tidak kosong, pesan FR-H4 tampil dan sesi tetap | `tests/kasir-dom/header.test.js` | DOM |

Setiap penjaga: merah dulu terhadap kode lama, lalu disabotase. Penjaga di
jalur uang, kas, dan sync (G-EDIT stok, G-TAHAN, G-KANAL, G-TRF*, P1 baru,
G-STRUK) mendapat subagen sabotase independen.

## 12. Keputusan otonom

Kelas 2 (`docs/PROTOKOL-OTONOM.md` § 1). Format: apa · bawaan · alasan · cara
membalik. Disalin ke `docs/RENCANA-HIDUPKAN-DESAIN.md` saat task-nya
dikerjakan.

- **K-06 sebagai halaman di dalam shell** · header tetap terlihat, tab nav
  terkunci selama QRIS menunggu/menyimpan · mockup menggambar halaman; overlay
  adalah keputusan rebuild UI lama · kembalikan `kasir-overlay-bayar`.
- **Indikator sinkron di header, bukan pil di toolbar** · FR-H2 di setiap
  layar · toolbar hanya di K-03 · tambahkan pil toolbar dan sembunyikan
  indikator header di K-03.
- **Outlet · perangkat di tombol pengguna** · baris kedua 13 px · header satu
  baris, prefiks struk tetap terbaca · pindahkan ke sebelah wordmark.
- **Urutkan produk tetap ada** · segmented ringkas di kanan field cari, satu
  baris 44 px, tanpa label terlihat · fungsi yang sudah ada tidak dibuang;
  mockup tidak punya kontrol urut · hapus kontrolnya.
- **Pintasan tunai enam pecahan** · bukan tiga seperti mockup · kasir
  menekan pecahan yang diterima; tiga pecahan menghapus Rp 2.000/5.000/10.000
  · kurangi `PECAHAN` ke tiga.
- **Batalkan tanpa audit** · konfirmasi saja · keranjang belum menjadi
  `order`, FR-B1 melarang barisnya · tambahkan telemetri `keranjang_dikosongkan`.
- **Pesanan tahan maksimal 20 per shift** `[ASUMSI]` · ubah konstanta.
- **Kill switch `pembayaran_transfer`** · menyala bawaan · permukaan fraud
  tak terverifikasi, pola QRIS statis · hapus kuncinya dari `FITUR`.

## 13. Pertanyaan untuk user

Hanya yang tidak diputuskan `RENCANA-HIDUPKAN-DESAIN.md`, `CLAUDE.md`, atau
spec. Setiap pertanyaan punya bawaan; tanpa jawaban, bawaan dipakai.

**P1. Transfer: disimpan sebagai apa?**
(a) `method = 'other'` + `provider = 'bank_transfer'`, nol migrasi, sesuai
`spec-c:244` ("Lainnya: … transfer … dengan catatan wajib"). Laporan yang
mengelompokkan per `method` saja akan menyebutnya "Lainnya" sampai query-nya
diubah. (b) Metode baru `bank_transfer`: migrasi CHECK `payment` dan `refund`
(expand-contract, `lock_timeout`), baris sendiri di setiap laporan.
**Bawaan: (a).**

**P2. Apakah Transfer ditandai `confirmed_manually` dan masuk laporan
exception FR-G5?** Tidak ada sistem yang memverifikasinya, sama dengan QRIS
statis. (a) Ya. (b) Tidak; nomor referensi dianggap bukti cukup, seperti EDC.
**Bawaan: (a).**

**P3. QRIS dinamis: kapan QR diminta?** Mockup menampilkan QR memuat begitu
tab QRIS disentuh. Setiap permintaan QR mencadangkan nomor struk dan membuat
order draf di server; tab yang tersentuh tanpa sengaja meninggalkan order
`abandoned` dengan nomor struk "dibatalkan". (a) Saat tab disentuh, persis
mockup. (b) Kartu QRIS menampilkan nominal + tombol "Tampilkan kode QR", QR
diminta saat itu ditekan. **Bawaan: (b).**

**P3b. Encoder QR.** Stack tidak punya pembuat gambar QR (`uang-pembayaran-
kas.md`: "QR ditampilkan sebagai TEKS … menuntut pustaka baru"). (a)
Dependency `qrcode-generator` (MIT, tanpa dependency, versi dipaku),
dirender sebagai SVG. (b) Encoder ditulis sendiri. Keduanya dijaga G-QR.
**Bawaan: (a).**

**P4. "Item manual" berarti apa?** (a) Masukan kode barcode/SKU manual,
memakai jalur scan yang ada; nol perilaku uang baru. (b) Item berharga
bebas di luar katalog: butuh FR baru, varian khusus di katalog, aturan pajak
dan `cost_at_sale`, dan ia membuka jalur harga manual yang ditolak di Edit
Item. **Bawaan: (a).**

**P5. Pelanggan dan No. Meja disimpan di mana?** (a) Keduanya satu teks
"label pesanan" di `check.label` (kolom sudah ada di server dan lokal, nol
migrasi; mis. "Meja 4 · Budi"), maksimal 40 karakter, dicetak di struk, tanpa
nomor telepon (UU PDP, `ERD:666`). (b) Dua kolom baru di `order`: migrasi
server + raw table lokal (lihat risiko R4). **Bawaan: (a).**

**P6. Catatan pesanan.** `order` tidak punya kolom catatan. (a) Kolom baru
`order.note` (expand, nullable, ≤ 140 karakter, periksa bukan nomor kartu),
dicetak di struk. Ia menyentuh raw table `order`, jadi setiap perangkat
menjalankan `disconnectAndClear()` dan mengunduh ulang riwayat (R4). (b)
Catatan masuk `check.label` bersama P5. **Bawaan: (a)**, digabung dalam satu
migrasi dengan apa pun yang P5 putuskan supaya biaya R4 dibayar sekali.

**P7. Lonceng notifikasi** (pertanyaan terbuka dari sub-proyek 1). (a) Panel
"Pemberitahuan perangkat" yang membaca data yang sudah ada: item gagal kirim
(K-14), struk gagal cetak (`print_job`), QRIS menunggu (`draf_qris_lokal`),
dan kredensial offline mendekati 30 hari (OQ-08). Jumlahnya tampil sebagai
teks, bukan titik warna. (b) Lonceng tidak dirender. **Bawaan: (a).**

**P8. K-07 "Kirim WhatsApp" dan "Kirim Email".** Butuh penyedia pesan, data
kontak pelanggan (UU PDP), dan jalur online-only. (a) Tidak dirender di v1.
(b) Dibangun di sub-proyek ini. **Bawaan: (a).**

**P9. Tombol Pajak.** Keputusan bawaan #2 berbunyi "pilihan tarif outlet yang
sudah terdefinisi". Memilih tarif langsung melompati resolusi `TaxCalculator`
(FR-C6). (a) Pilihan **kanal** Dine in/Takeaway yang menampilkan tarif yang
akan berlaku, sesuai FR-C7 "Sumber channel". (b) Daftar tarif baca-saja tanpa
pilihan. **Bawaan: (a).**

**P10. Rute layar Laci kas.** IA §7 tidak punya rute laci, dan
`tests/kasir/rute.test.js` mengikat tabel rute ke IA §7. (a) Rute baru
`/laci`, IA §7 dan §2.2 disunting bersamaan. (b) Mode tanpa URL di dalam K-03.
**Bawaan: (a).**

## 14. Risiko

**R1 — IA:62 (≥ 12 kartu pada 1024×768).** Diukur 28 September 2026 di galeri
(`npm run build:galeri`, Playwright, skenario `normal` berfoto, panggung
1024×768). Simulasi: header 68 px menggantikan topbar + bilah, toolbar 68 px
di atas kolom katalog saja, kontrol urut disembunyikan, label "Cari produk"
**masih** terlihat.

| Keadaan | Baris ke-3 kartu berakhir di | Batas gulir | Sisa | Kartu terlihat |
|---|---:|---:|---:|---:|
| Hari ini | 696 | 767 | 71 | 12 |
| Header + toolbar mockup | 722 | 767 | 45 | 12 |
| + tinggi baris 1,5 (§ 10) | 736 | 767 | 31 | 12 |
| + pita FR-H8 61 px seperti hari ini | ≈ 797 | 767 | −30 | **8** |
| + pita setinggi banner mockup ≈ 34 px | ≈ 770 | 767 | −3 | **8** |
| + pita ≈ 34 px, label cari disembunyikan visual (−28) | ≈ 742 | 767 | 25 | 12 |

Kesimpulan: header + toolbar mockup **muat** tanpa pita (sisa 31 px sesudah
tinggi baris). Dengan pita antrean tampil, mockup hanya muat bila pita
setinggi banner mockup **dan** label field cari tak terlihat — itulah alasan
kedua keputusan di § 3 dan § 11. Hari ini pita + kartu berfoto lolos dengan
sisa 10 px dan **tidak dijaga** (penjaga IA:62 hanya memakai skenario
`normal`); G-IA62-PITA menutupnya. Pada 1280×800 sisanya besar (baris ke-3
berakhir di ≈ 713 dari 800). Angka ini simulasi CSS, bukan layar jadi; plan
mengukurnya ulang sesudah Task tinggi baris. Bila layar jadi tidak memenuhi
12: kondisi berhenti.

**R2 — Header satu baris pada 1024.** Wordmark, empat tab ≥ 76 px, indikator
sinkron dengan teks terpanjang, lonceng, dan tombol pengguna harus muat di
984 px. Belum diukur; G-HEADER memakai teks indikator terpanjang. Bila tidak
muat, nama pengguna dipotong lebih dulu, bukan tab.

**R3 — Uang: P1 melemah dari "tidak ada" ke "terkunci".** Hari ini kontrol
metode tidak ada di DOM selama QRIS menunggu; kampanye memilih tampil
terkunci. Kontrol yang terkunci dapat dibuka oleh cacat keadaan React yang
tidak akan pernah terjadi pada kontrol yang tidak dirender. Mitigasi: P1 baru
memeriksa `disabled` **dan** bahwa klik (lewat `dispatchEvent`, melewati
`disabled`) tidak mengubah metode maupun nominal; sabotase independen.

**R4 — Sync: kolom baru di raw table `order`.** Bila P5(b) atau P6(a)
dipilih, sidik jari skema lokal berubah, setiap perangkat menjalankan
`disconnectAndClear()` dan mengunduh ulang katalog + riwayat
(`kasir-offline-sync.md` § stream `riwayat`). Outbox tidak tersentuh (murni
lokal), tetapi perangkat yang offline saat pembaruan berjalan dengan katalog
kosong sampai terhubung. Semua kolom baru dikumpulkan dalam **satu** migrasi.
Kompatibilitas N-1: server menerima payload tanpa field baru.

**R5 — Uang: Transfer adalah permukaan fraud baru** yang berfungsi offline
dan tidak diverifikasi apa pun. Mitigasi: referensi wajib, periksa nomor
kartu, `confirmed_manually` (P2), kill switch, audit event dengan aktor.

**R6 — Uang: Edit Item dan stok.** Tombol `+` stepper hari ini melewati
FR-E4 (§ 6 Temuan). Edit Item menutupnya; bila dikerjakan sebagian, lubang
itu pindah tempat, bukan hilang. G-EDIT menjaganya.

**R7 — Sync: Pesanan tahan dan tutup shift.** Tahanan yang tertinggal saat
shift ditutup di perangkat lain (atau sesudah kredensial offline habis) tidak
terlihat server. Batas yang dinyatakan: tahanan murni lokal, dan K-12
perangkat ini menolak tutup selama ada tahanan.

**R8 — Rilis: urutan server → klien** untuk Transfer, label pesanan, dan
catatan. Klien baru di atas server lama menghasilkan baris outbox
`gagal-permanen`. Runbook dan catatan rilis wajib menyebutnya.

**R9 — Cakupan.** Delapan tombol, dua layar baru, satu metode pembayaran,
satu kemungkinan migrasi, dan satu dependency. Karena itu sub-proyek ini
dipecah menjadi empat PR (§ 15).

## 15. Pecahan task (masukan untuk writing-plans)

Satu implementer per task, berurutan. Setiap task: penjaga baru merah dulu,
penjaga lama yang memaku nilai lama diubah dalam commit tersendiri, sabotase.
Kolom "Baca" adalah daftar `docs/keputusan/*.md` wajib untuk implementer
(aturan (c), `CLAUDE.md` § Peta jalur kode) dan disalin apa adanya ke task
brief.

Model: implementer Sonnet 5; reviewer Opus 5.5 untuk task bertanda **U**
(uang, kas, sync), Sonnet 5 untuk sisanya; sabotase independen Opus 5.5 untuk
task **U**.

### PR 2A — kerangka dan K-03

| Task | Isi | Baca |
|---|---|---|
| 1 | Tinggi baris empat token + G-LH; ukur ulang semua invarian | `design-system.md` |
| 2 | Hapus `.pita-kategori`, rapikan komentar | `design-system.md` |
| 3 | Header satu baris, tab mockup, menu pengguna + Keluar, indikator sinkron, lonceng (per P7), pita FR-H8 setinggi banner; ubah penjaga `k14-tata-letak`/rute | `design-system.md`, `kasir-offline-sync.md` (indikator, FR-H4, antrean) |
| 4 **U** | Layar Laci kas (FR-D5 + K-16 + riwayat shift), rute per P10; ubah penjaga `laci-kas`/`galeri-cakupan` | `uang-pembayaran-kas.md`, `design-system.md`, `rilis-dan-flag.md` (kill switch no-sale) |
| 5 | Toolbar K-03 dengan tombol yang fungsinya sudah ada: Diskon, Batalkan, Item manual (per P4 bawaan); field cari tanpa label terlihat; G-TOOLBAR sebagian, G-IA62-PITA, G-TOMBOL-HIDUP; ubah penjaga `k03-chrome` | `uang-pembayaran-kas.md` (diskon), `design-system.md`, `rilis-dan-flag.md` |
| 6 **U** | Keranjang tanpa stepper + Edit Item + `gantiModifier` + pemeriksaan stok; ubah penjaga `k03-kepadatan`/`area-sentuh` | `uang-pembayaran-kas.md` (diskon, stok F3), `kasir-offline-sync.md` (KEP-21), `design-system.md` |

Tanpa toolbar lengkap PR ini hanya merender tombol yang bekerja; G-TOMBOL-HIDUP
menjaga "tidak ada tombol mati" di setiap PR, dan G-TOOLBAR baru menuntut
kedelapan label di akhir PR 2C.

### PR 2B — pembayaran

| Task | Isi | Baca |
|---|---|---|
| 7 **U** | Transfer: domain (`periksaTransfer`, `dikonfirmasiManual`, `MetodeCampuran`), server `MANUAL_METHODS`, kasir `MetodeBayar` + outbox, kill switch, label satu peta (hapus dua salinan back-office), struk; migrasi hanya bila P1(b) | `uang-pembayaran-kas.md`, `kasir-offline-sync.md`, `rilis-dan-flag.md`, `backoffice-hp-laporan.md` (label laporan), `database.md` (bila P1(b)), `cetak.md` |
| 8 **U** | Kartu pembayaran bertoggle: halaman di shell, total atas, segmented + sub-pilihan QRIS, "Konfirmasi bayar", tautan campuran, panel "Uang diterima"; ubah penjaga P1/P5/P7–P9/`k06-tata-letak`/`galeri-cakupan` | `uang-pembayaran-kas.md`, `design-system.md` |
| 9 **U** | QR di dalam kartu (encoder per P3b), hitung mundur, keadaan memuat/terkonfirmasi/kedaluwarsa, penguncian toggle + nav, pemulihan draf; G-QR | `uang-pembayaran-kas.md`, `kasir-offline-sync.md` (draf lokal), `design-system.md` |

### PR 2C — fungsi toolbar baru

| Task | Isi | Baca |
|---|---|---|
| 10 **U** | Pajak = pilihan kanal (per P9); `channel` di keranjang, `hitungKeranjang`, `simpanPenjualan`; fixture `ppn` 11% + `dine_in` + service charge; G-KANAL | `uang-pembayaran-kas.md` |
| 11 **U** | Pelanggan + No. Meja (per P5) dan Catatan (per P6): satu migrasi bila ada, server menerima field opsional (N-1), raw table + `put`, `disconnectAndClear`, struk | `uang-pembayaran-kas.md`, `database.md`, `kasir-offline-sync.md`, `cetak.md` |
| 12 **U** | Pesanan tahan: `keranjang_tahan` murni lokal, daftar, lanjutkan/buang, penolakan tutup shift di K-12; G-TAHAN; G-TOOLBAR lengkap delapan | `kasir-offline-sync.md`, `uang-pembayaran-kas.md` |

### PR 2D — K-07, struk, dan layar sisanya

| Task | Isi | Baca |
|---|---|---|
| 13 | `tataLetakStruk` diekstrak dari `renderEscPos`; pratinjau struk; K-07 mockup; G-STRUK; ubah penjaga `k07-konfirmasi` | `cetak.md`, `uang-pembayaran-kas.md`, `design-system.md` |
| 14 | K-08 penyaring tanggal + metode, kolom Item + Metode | `uang-pembayaran-kas.md`, `design-system.md` |
| 15 **U** | K-12 dua kartu di tahap review + bilah aksi bawah; ubah penjaga `k12-aksi-slot` | `uang-pembayaran-kas.md`, `design-system.md` |
| 16 | Sisa K-01, K-02, K-10 | `design-system.md`, `uang-pembayaran-kas.md` (K-10) |
| 17 | Dokumen: `docs/referensi-visual/README.md` (ditolak baru: panel Kembalian di K-06, Hapus item terpisah, harga sementara, diskon item, catatan per item, WhatsApp/Email per P8, pil toolbar), `BANDING.md`, `CLAUDE.md` § Rebuild UI (baris "Tinggi bilah nav sama" → header), `docs/DESIGN.md`, IA §7 bila P10(a), cermin ledger | — (dokumen) |

**Satu PR atau beberapa: empat.** Alasannya: 2B dan 2C memindahkan uang dan
butuh urutan rilis server → klien; 2A murni tampilan dan kas yang sudah ada;
2D bergantung pada 2C (struk mencetak label dan catatan). PR yang lebih kecil
membuat tinjauan akhir Opus dapat membaca seluruh diff jalur uang. Urutan:
2A → 2B → 2C → 2D; tinjauan akhir satu branch per PR.
