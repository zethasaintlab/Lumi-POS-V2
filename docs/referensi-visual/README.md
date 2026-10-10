# Referensi visual — ekspor Claude Design "LumiPOS design system (2)"

Direktori ini menyimpan ekspor proyek Claude Design beserta tangkapan setiap
layarnya. Tujuannya satu: rujukan untuk membangun ulang tampilan LumiPOS
supaya terlihat seperti aplikasi POS pada umumnya.

## ⛔ Statusnya: rujukan TATA LETAK dan TAMPILAN, peringkat 3

Urutan otoritas saat sumber-sumber bertentangan:

1. **Spec** (`product/`): PRD, ARCH, ERD, IA, dan `spec-a…h`.
2. **Test** yang menegakkan spec itu, termasuk penjaga di `tests/` dan `lint:ds`.
3. **Direktori ini**, dan hanya untuk tata letak dan tampilan.

**Perilaku tetap diatur spec dan test.** Mockup ini boleh menjawab
pertanyaan seperti "di mana tombolnya, seberapa padat kartunya, apa yang
menempel". Ia tidak boleh menjawab pertanyaan seperti "apa yang terjadi
saat tombol itu ditekan" atau "angka apa yang boleh terlihat". Kalau layar
di sini menyiratkan perilaku yang berbeda dari spec, spec yang menang, dan
layar di sini salah.

## ⛔ Yang di mockup bertabrakan dengan spec — keputusannya per 26 September 2026

Kesepuluh hal yang tercatat di bawah diputuskan user, di dua putaran berbeda.
Enam yang pertama diputuskan saat ekspor ini masuk; dua berikutnya ditemukan
saat memotret dan diputuskan 23 September 2026; dua terakhir ditetapkan saat
kampanye rebuild UI dimulai, 25 September 2026 (`docs/RENCANA-REBUILD-UI.md`).

⛔ **Keputusan kampanye Hidupkan desain, 26 September 2026**
(`docs/RENCANA-HIDUPKAN-DESAIN.md`) membalik ENAM dari kesepuluh — bukan
karena spec berubah, melainkan karena kampanye ini menetapkan "identik secara
tampilan, aman secara perilaku": elemen yang murni TAMPILAN (QR di kartu,
Transfer, delapan tombol toolbar, keranjang tanpa stepper, ukuran chip)
sekarang diikuti, dan yang menyentuh PERILAKU uang/kas (konfirmasi QRIS
dinamis) tetap dijaga di baliknya, bukan ditiru apa adanya. Empat sisanya
TETAP ditolak atau diubah sebagiannya — lihat kolom "Status sejak 26
September" di kedua tabel.

### Diterima — sub-proyek 2 (aplikasi kasir), bukan sub-proyek 1 (fondasi)

Sub-proyek 1 (fondasi desain) hanya mengubah token dan kulit komponen;
keenam hal di bawah adalah tata letak dan perilaku LAYAR K-03/K-06/K-09, milik
sub-proyek 2 (aplikasi kasir; `docs/superpowers/specs/2026-09-28-kasir-design.md`)
dan sudah dibangun di sana. Tambahan sub-proyek 2 ada di tabel
"Diterima sub-proyek 2 (28 September 2026)" sesudah tabel ini.

| Di mockup | Tangkapan | Status sejak 26 September | Perilaku yang tetap dijaga |
|---|---|---|---|
| **QR di dalam kartu pembayaran** | `kasir--bayar--qris-siap.png` | **Diterima, dibangun di sub-proyek 2.** Aturan lama `CLAUDE.md` § FR-C3 ("QR sebagai TEKS, bukan gambar") digantikan — QR tampil visual (192 px) di dalam kartu, mengikuti mockup; kartu dan pemilih metode tetap terlihat | `qrString` tetap dapat dipilih sebagai TEKS di bawah gambar; gambar didekode ulang di peramban dan harus sama persis dengan `qrString` (`k06-qr.test.js` G-QR); status pembayaran tetap menunggu konfirmasi gateway (lihat baris "Konfirmasi bayar" di bawah) |
| **Metode Transfer** | `kasir--bayar--transfer.png` | **Diterima.** Kartu pembayaran kini bertoggle empat metode termasuk Transfer | `LABEL_METODE` (`packages/domain/src/metode-tampilan.ts`) harus diperluas; `spec-c:244` tetap menuntut Transfer dicatat dengan catatan wajib di bawah "Lainnya" — perilaku pencatatannya tidak berubah, hanya kemunculannya di toggle |
| **Tombol toolbar yang nol kode** (delapan tombol: Item manual, Diskon, Pajak, Catatan, Pelanggan, No. Meja, Batalkan, Pesanan tahan) | `kasir--kasir--*.png` | **Diterima, dengan syarat.** "Setiap tombol harus bekerja; fungsi yang belum ada dibangun. Tidak ada tombol mati" (`docs/RENCANA-HIDUPKAN-DESAIN.md`) | Tombol yang fungsinya ada di daftar "jangan bangun" v1.1+ (`CLAUDE.md` § Jangan bangun ini) TIDAK dibangun sebagai fitur produk penuh hanya karena tombolnya ada di mockup — angkat sebagai pertanyaan bila terjadi, jangan bangun diam-diam |
| **Keranjang tanpa kontrol qty** (lencana `1x`/`2x`/`3x` saja) | `kasir--kasir--keranjang-penuh.png` | **Diterima, bentuknya diubah.** "Keranjang tanpa stepper. Qty diubah lewat menyentuh baris, yang membuka layar Edit Item" — bukan lencana tampilan-saja seperti mockup | Qty turun ke 0 tetap menghapus baris (meniadakan tombol "Hapus" terpisah, `CLAUDE.md` § aturan memakai `/ds-bundle`); layar Edit Item adalah tambahan di luar mockup, bukan penggantian aturan itu |
| **Tombol "Konfirmasi bayar" manual untuk QRIS dinamis** | `kasir--bayar--qris-siap.png`, `kasir--bayar--qris-memuat.png` | **Diterima TAMPILANNYA, dengan perilaku dijaga.** Tombol tampil persis mockup | ⛔ Untuk QRIS DINAMIS, tombol ini menunggu konfirmasi GATEWAY dan berlabel menunggu pembayaran — tidak pernah menandai lunas dari ketukan manual (`spec-c:320`). Selama menunggu, setiap tab metode terkunci dengan alasan, tab navigasi terkunci, dan tidak ada jalur ketukan yang menandai lunas (`k06-penjaga.test.js` P1, `k06-qr.test.js`). Hanya QRIS STATIS yang benar-benar dikonfirmasi orang lewat tombol ini, ditandai `confirmed_manually` (FR-G5) |
| **Chip 36px dan tombol aksi uang 44px** | `kasir--kasir--*.png` (chip kategori), `kasir--tutup--tunggal.png` ("Tutup Shift" 139×44) | **Diterima, lewat mekanisme area sentuh tak terlihat.** Elemen tampil PERSIS ukuran mockup (36px, 44px, dst); area sentuhnya diperluas TANPA TERLIHAT ke 44px (atau 56px untuk aksi uang) lewat kelas `.sentuh`/`.sentuh-uang` (`packages/ds/lumi.css`, Task 5) | DS #3 (target sentuh ≥44px, aksi uang 56px) tetap ditegakkan — lewat area sentuh, bukan ukuran visual |

### Diterima — sub-proyek 2, tambahan (28 September 2026)

Keputusan kampanye Hidupkan desain, 26 September 2026; rancangannya di
`docs/superpowers/specs/2026-09-28-kasir-design.md`, jawaban user atas P1–P10
dan keputusan 28 September 2026 (issue #76, komentar `5862870577`).

| Di mockup | Status | Perilaku yang tetap dijaga |
|---|---|---|
| **Panel "Kembalian" hidup di K-06** | **Diterima** (membalik aturan lama "kembalian hanya di K-07", keputusan user 28 September 2026). Kolom "Nominal diterima" + tiga pintasan Rp 20.000 · Rp 50.000 · Rp 100.000 (44 px, area sentuh 56 px; menetapkan, tidak menambah) | Kembalian dan tagihan tunai K-06 adalah hasil `rencanaBayarKeranjang` — fungsi yang sama dengan `simpanPenjualan`, tidak pernah aritmetika kedua; sama persis dengan K-07 dan `payment.change_amount` (`k06-penjaga.test.js` P2 + P3). Kolom kosong atau cacat: Kembalian `Rp —` dan "Konfirmasi bayar" nonaktif dengan alasan, tidak pernah `Rp 0` (G-NOMINAL) |
| **K-02 kolom "Saldo awal kas"** | **Diterima**, menggantikan empat tombol pecahan dan "Hapus" (keputusan user 28 September 2026) | Dibaca `bacaRupiah`; kosong bukan `Rp 0` ("Mulai Shift" nonaktif dengan alasan), "0" yang diketik sah; `validasiSaldoAwal` tetap penentu akhir; `opening_float` tetap satu-satunya movement pembuka (`k02-buka-shift.test.js`) |
| **K-01 judul "Masuk ke kasir" + subjudul perangkat** | **Diterima** (tiga keadaan: `Perangkat: <kode>` · belum terdaftar · tidak terbaca) | PIN tetap 6 titik (`spec-f:122`) |
| **K-07 grid Cetak Struk · Transaksi Baru, kembalian berwarna aksen** | **Diterima** | Pembulatan tetap tampil di K-07; simpan sebelum cetak (invariant #3) |
| **Pratinjau struk 58/80 mm** (mockup `Receipt`) | **Diterima** sebagai MODE (bukan rute), dibuka dari K-07 dan tombol "Pratinjau struk" di K-09; teks `--font-mono` 13 px, satu-satunya pemakaian mono | Satu tata letak: `tataLetakStruk` dipakai pratinjau DAN `renderEscPos`, jadi pratinjau tidak dapat menyimpang dari byte yang dicetak. Toggle 58/80 hanya mengubah pratinjau, tidak profil printer. Kata "Pajak" tanpa nama tarif di cetakan pertama tetap ditolak (`spec-c:404`) |
| **K-08 penyaring Tanggal + Metode, kolom Item + Metode** | **Diterima**: Tanggal = input tanggal bisnis di jendela riwayat lokal; Metode = chip dari `LABEL_METODE` ("Transfer" sendiri, tidak di bawah "Lainnya"); "Campuran" dari kode laporan | Nomor tetap `K1-YYYYMMDD-NNNN`; status tetap turunan pembatal + status kirim FR-H3, bukan "Selesai" tunggal |
| **K-12 tahap review: dua kartu + bilah aksi bawah "Tutup Shift"** | **Diterima, hanya di tahap `review`**: Rekonsiliasi kas (kiri), Ringkasan shift (kanan; "Total penjualan" = `omzetBersih`, per metode lewat `labelMetode`) | Hitungan buta FR-D2: tahap `hitung` tanpa satu angka pun (`k12-hitungan-buta.test.js` tidak disunting); bilah aksi `.kasir-aksi-bawah` tetap terlihat tanpa menggulir |
| **Header satu baris 68 px, menu pengguna + Keluar, lonceng** | **Diterima** (sub-proyek 2 PR 2A, Task 3): tinggi 68 px sama di semua layar ber-shell | Keluar dengan antrean tidak kosong menampilkan pesan FR-H4; lonceng membuka panel "Pemberitahuan perangkat" — pertanyaan ikon notifikasi di bawah terjawab |
| **Layar Laci kas, delapan tombol toolbar, keranjang tanpa stepper + Edit Item, Transfer** | **Diterima** (PR 2A–2C); toolbar K-03 natural 44 px, bukan 68 px (bilah 68 px ditolak: IA:62 menang, 12 kartu pada 1024×768) | Laci kas tanpa saldo (hitungan buta); Batalkan meninggalkan `audit_event` `cart_cleared` |

### Tetap ditolak atau diubah

| Di mockup | Tangkapan | Status sejak 26 September |
|---|---|---|
| **Kata "Pajak" menggantikan nama tarif** | `kasir--kasir--*.png` (ringkasan keranjang), `kasir--struk--*.png` | **Diubah sebagian.** `apps/kasir/src/layar/Kasir.tsx:1016`: "Baris pajak memakai NAMA TARIF, bukan kata 'Pajak'." — aturan itu tetap berlaku untuk NAMA baris (satu baris per tarif, tidak diganti kata generik "Pajak"). Keputusan bawaan kampanye (`docs/RENCANA-HIDUPKAN-DESAIN.md` keputusan #5) mengubahnya sebagian: baris berlabel "Pajak" DENGAN nama tarif di sampingnya, bukan salah satu saja — belum dibangun di sub-proyek 1 (fondasi), menunggu sub-proyek 2. Hanya cetak ulang yang boleh berbunyi "Pajak" tanpa nama tarif, dan itu batas yang dinyatakan (`CLAUDE.md` § F4), bukan pola tampilan |
| **Ikon notifikasi** (lonceng di bilah atas Kasir dan Back-office) | — | **Kasir: terjawab sub-proyek 2** — lonceng dibangun sebagai panel "Pemberitahuan perangkat" (gagal kirim tampil sebagai teks angka), bukan kontrol mati. **Back-office: tetap terbuka**, menunggu sub-proyek 3 |
| **"Saldo seharusnya" tampil sebelum hitungan fisik diisi** | `kasir--tutup--tunggal.png` | **Tetap ditolak.** Hitungan buta (`spec-d` FR-D2) dipertahankan: "Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka terhitung. Ini kontrol, bukan preferensi UX." Keputusan bawaan kampanye menegaskannya lagi: "tata letak persis mockup, saldo seharusnya tampil SESUDAH hitungan fisik diisi" — tata letak K-12 boleh mengikuti mockup, urutan pengungkapan angkanya tidak. Dijaga `tests/kasir-dom/k12-hitungan-buta.test.js` |
| **Nomor transaksi `TRX-…`** | `kasir--riwayat--ada.png` | **Diubah sebagian.** Format nomor struk TETAP `K1-20260726-0007` (prefiks perangkat + tanggal + urutan, `CLAUDE.md` § Konvensi data, counter lokal) — keputusan bawaan kampanye: "format `K1-YYYYMMDD-NNNN` tetap, **posisi dan gaya** mengikuti mockup". Yang berubah hanya di mana dan bagaimana nomor itu ditampilkan, bukan bentuknya |
| **Tombol "Hapus item" merah terpisah di Edit Item** | `kasir--edit-item--tunggal.png` | **Ditolak.** Qty turun ke 0 di layar Edit Item menghapus baris ("Hapus dari keranjang"), meniadakan tombol terpisah dan risiko salah tekan (`CLAUDE.md` § aturan memakai `/ds-bundle`) |
| **"Harga sementara"** di Edit Item | `kasir--edit-item--tunggal.png` | **Ditolak.** Harga diresolusi dari `price_history` pada `occurred_at` (FR-A7, FR-H6); tidak ada jalur harga manual per penjualan |
| **"Diskon item"** dan **"Catatan" per item** | `kasir--edit-item--tunggal.png` | **Ditolak.** Diskon PER BARIS tidak dibangun; `order_line` tidak punya kolom catatan. Catatan ada di tingkat pesanan, bukan baris |
| **Tombol "Kirim WhatsApp" dan "Kirim Email" di K-07** | `kasir--sukses--tunggal.png` | **Ditolak** (P8(a), disetujui): pengiriman struk digital tidak ada di v1 dan tidak ada tombol mati; grid K-07 menjadi dua tombol. `[P8]` |
| **Pil Online/Offline di toolbar** | `kasir--kasir--*.png` | **Ditolak.** Indikator sinkronisasi hidup di header (FR-H2, `SyncIndicator`), satu sumber; pil kedua akan menyimpang dari yang pertama |
| **"Item manual" berharga bebas** | `kasir--kasir--*.png` | **Ditolak (keputusan produk tertunda, P4).** Tombol "Item manual" dibangun sebagai dialog kode yang memindai item KATALOG; harga bebas tidak ada |
| **Salam "Halo, Rini Astuti" sebelum PIN; empat titik PIN; tombol angka 78×44** (K-01) | `kasir--login--tunggal.png` | **Ditolak.** PIN tepat 6 digit (`spec-f:122`); kasir diidentifikasi dari PIN, tidak dipilih sebelumnya; tombol angka repo tetap 56 px |
| **"Kembali", "Cash drawer", "Staf pembuka"/"Waktu buka" sebagai masukan** (K-02) | `kasir--shift--tunggal.png` | **Ditolak.** K-02 adalah gerbang tanpa tujuan kembali; satu laci per perangkat; staf dan waktu diambil dari sesi dan jam |
| **"Jenis tindakan" void/refund dan alasan teks bebas** (K-10) | `kasir--void--tunggal.png` | **Ditolak.** Sistem memilih void atau refund (`spec-b` § pemilihan otomatis); alasan daftar tertutup (FR-G5, FR-D6) |
| **"Jumlah transaksi" dan "Produk terlaris" di Ringkasan shift K-12** | `kasir--tutup--tunggal.png` | **Belum dibangun**, dicatat sebagai utang (`docs/RENCANA-HIDUPKAN-DESAIN.md` § ledger Task 15) |

## Palet mockup — DIPUTUSKAN, 26 September 2026

⛔ **Digantikan** (keputusan kampanye Hidupkan desain —
`docs/RENCANA-HIDUPKAN-DESAIN.md`). Bagian ini sebelumnya berbunyi "BELUM
DIPUTUSKAN" dan melarang menerapkan nilai `sumber/tokens/` ke token repo.
Keputusannya sekarang: **untuk tampilan, mockup adalah sumber kebenaran** —
palet, aksen, font, skala teks, radius, bayangan, spasi, komponen, tata
letak, struktur navigasi, dan layar-layarnya. Untuk perilaku yang memindahkan
uang, mengontrol kas, atau menyinkronkan data, spec dan test tetap menang.

Repo memakai palet mockup (`sumber/tokens/colors.css`): aksen `#14706b`, font
Nunito Sans, dan skala EMPAT ukuran teks 32/20/15/13 (bukan lagi aksen
`#0D5C63`, Inter, dan lima token termasuk `--t-metric`). Satu-satunya
pengecualian: status netral dinaikkan minimal dari kontras 4,37 ke 4,5 supaya
lolos AA — lihat `PALET.md` untuk keempat koreksi AA yang dipaku.

⛔ **Dua penyimpangan tampilan yang TERLIHAT**, keduanya koreksi AA yang
membuat warnanya sedikit lebih gelap daripada mockup:

- `--sidebar-label` (label grup sidebar back-office): mockup `#789194`, repo
  `#5e7477` — kontras terhadap `--background` naik dari 3,06:1 ke 4,53:1.
- `--step-inactive-text` (teks langkah tidak aktif, mis. `Stepper`): mockup
  `#7b9597`, repo `#596f71` — kontras terhadap `--step-inactive-bg` naik dari
  2,71:1 ke 4,53:1.

Keduanya sedikit lebih gelap daripada mockup pada perbandingan berdampingan;
selisihnya kecil dan tidak mengubah komposisi warna, tapi disebutkan di sini
karena keduanya SATU-SATUNYA nilai yang menyimpang dari `sumber/tokens/` di
seluruh token yang diadopsi. `PALET.md` mencatat keempat koreksi AA (dua di
atas, plus `--status-pending-text` dan `--icon-muted`) dengan angka kontras
lengkap.

`ds-bundle/` tidak disunting (aturan itu tidak berubah); seluruh nilai mockup
masuk lewat `packages/ds/tokens-mockup.css` dan `packages/ds/lumi.css` — lihat
`docs/DESIGN.md` § 2–3.

## ⛔ "Lumi-Order" di mockup adalah `apps/hp`

Aplikasi ketiga di mockup bernama "Lumi-Order". **Nama itu tidak ada di kode
repo ini.** Padanannya `apps/hp`, berjudul `Lumi POS — Owner`, lihat
`docs/DESIGN.md` § 1.

Catatan untuk siapa pun yang memakai tangkapan `order--*`: layar-layar itu
menggambar **alur pelanggan** (masuk lewat QR meja, menu, keranjang, QRIS,
status pesanan). `apps/hp` melayani **owner** dengan empat layar M-00…M-03
(`CLAUDE.md` § G2). Tidak satu pun layar `order--*` punya padanan fungsi di
`apps/hp`. Yang dapat dipinjam dari sana hanya bahasa visual untuk layar
390px: kepadatan, kartu, dan bilah bawah. Bukan alurnya.

## Isi direktori

| Path | Isi |
|---|---|
| `sumber/` | Ekspor Claude Design **apa adanya**. Tidak disunting satu byte pun |
| `layar/` | 51 tangkapan, satu per kombinasi aplikasi × layar × keadaan |
| `INDEKS.md` | Semua tangkapan dalam satu halaman, dikelompokkan per aplikasi |
| `banding/` | Mockup (kiri) berdampingan dengan galeri kasir (kanan) |
| `BANDING.md` | Pemetaan pasangan dan tabel selisih terukur |
| `PALET.md` + `palet.png` | Palet repo dan mockup berdampingan, dengan rasio kontras |
| `alat/` | Skrip yang menghasilkan semua di atas |

## Cara tangkapan dibuat, dan batasnya

```
cd docs/referensi-visual/alat
npm install
node vendor.mjs && node potret.mjs && node indeks.mjs
node palet.mjs
node banding.mjs      # butuh `npm run build:galeri` di akar repo lebih dulu
```

- **Daftar kombinasi dibaca dari berkas.** Sumbernya `const APPS` di
  `sumber/design-explorer.html`, lalu dicocokkan dengan opsi dropdown yang
  benar-benar dirender. Hasilnya 3 aplikasi, 25 layar, dan 51 kombinasi.
- **Navigasi lewat bar Penjelajah.** Skrip mengklik chip aplikasi dan
  memanggil `selectOption` pada dropdown layar dan keadaan. Tidak ada alur
  yang disimulasikan. `src` iframe diperiksa memuat `screen`/`state` yang
  diminta sebelum dipotret.
- **Yang dipotret piksel iframe saja**, pada skala 1: Kasir 1280×800,
  Back-office 1440×900, dan Lumi-Order 390×844, tanpa bingkai perangkat.
  Panel "Info layar" milik Penjelajah ditutup, karena ia menimpa pojok kanan
  bawah tangkapan back-office.
- ⛔ **CDN diganti versi lokal, bukan dimuat.** Proxy di lingkungan pemotretan
  menolak `cdn.tailwindcss.com`, `esm.sh`, `unpkg.com`, dan
  `images.unsplash.com` (403). `alat/vendor.mjs` membangun React 19,
  lucide-react 0.468.0, Babel standalone 7.24.7, dan Tailwind 3.4, lalu
  menyajikannya di URL CDN aslinya lewat `page.route`. CSS Tailwind dibangun
  statis. Kelas yang dipanen dari DOM hasil render (379) menghasilkan CSS
  yang **identik**, jadi tidak ada kelas dinamis yang terlewat.
- ⛔ **Foto produk TIDAK ADA di tangkapan.** Ke-10 URL Unsplash diganti kotak
  berlabel "foto Unsplash tidak terunduh" berukuran sama dengan permintaan
  (`w`/`h` di URL). Kotak itu **bukan** bagian dari desain. Jangan membacanya
  sebagai placeholder abu-abu yang mockup izinkan: README mockup sendiri
  melarangnya.
- ⛔ **Warna piksel di PNG tidak persis.** Tangkapan dikompres ke PNG berpalet
  (≤256 warna): 2,67 MB turun ke 0,95 MB, dan teks tetap terbaca. Setiap
  angka warna di `BANDING.md` dan `PALET.md` diukur dari DOM dan berkas
  token, bukan dari gambar.
- **Cacat mockup yang ikut terpotret, dan tidak diperbaiki:** grafik "Tren
  penjualan 7 hari" di `backoffice--dashboard--tunggal.png` tidak punya
  batang. Tinggi batang ditulis sebagai `height: N%` di dalam kolom flex
  yang tingginya tidak ditentukan, jadi ia runtuh ke 0. Perilakunya sama
  dengan Tailwind CDN, karena ini perilaku CSS, bukan perilaku pustaka.
- **Sinkronisasi Claude Design:** `/design-login` tidak tersedia di sesi ini
  ("isn't available in this environment"), dan `DesignSync list_projects`
  ditolak karena belum ada otorisasi design-system. Jadi tidak dapat
  dipastikan apakah proyek yang sama dapat ditarik lewat `/design-sync`.
  Berkas di sini tidak bergantung pada login dan tidak hilang saat container
  berganti.
- **Penyimpangan header kasir yang dicatat (Task 4, 29 September 2026):** jarak
  antar-elemen header 16 px dan jarak antar-tab 8 px, mockup 20 px dan 4 px
  (`ui_kits/kasir/index.html:96`, `gap-5`/`gap-1`). Alasan: token spasi tidak
  punya 20 px (`--space-4` 16, `--space-6` 24), dan dengan empat tab pada 1024
  px jarak 24 px antar-tab membuat header meluap 53 px pada keadaan antrean 50
  gagal. R2 (spec § 14) dijaga dengan menyusutkan NAMA pengguna (ellipsis), bukan
  tab; dijaga `tests/kasir-dom/header.test.js` (nama 21 karakter + "(500)").
