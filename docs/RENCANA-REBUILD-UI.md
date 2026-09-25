# Rencana rebuild UI kasir — pelacak kemajuan

Kampanye membangun ulang tampilan `apps/kasir` supaya terlihat dan terasa
seperti aplikasi POS pada umumnya. Dimulai 25 September 2026.

**Berkas ini yang memberi tahu di mana kampanye berhenti.** Perbarui setiap
kali satu PR dibuka, di-merge, atau berhenti. Kalau container berganti:
jalankan `bash tools/siapkan-dev.sh`, baca `CLAUDE.md` § Rebuild UI kasir,
lalu lanjutkan dari baris pertama yang belum `selesai` di bawah.

## Sumber

| Apa | Di mana |
|---|---|
| Urutan otoritas, aturan kerja, invarian | `CLAUDE.md` § Cara kerja yang diharapkan · § Rebuild UI kasir |
| Mockup rujukan (peringkat 3) | `docs/referensi-visual/sumber/design-explorer.html` |
| Elemen mockup yang DITOLAK | `docs/referensi-visual/README.md` (10 butir) |
| Selisih terukur per layar | `docs/referensi-visual/BANDING.md` |
| Tangkapan semua layar mockup | `docs/referensi-visual/INDEKS.md` |
| Palet repo vs mockup | `docs/referensi-visual/PALET.md` |

## Cakupan

- **Masuk:** `apps/kasir` dan token di `packages/ds/lumi.css`.
- **Tidak masuk:** back-office; aplikasi pelanggan ("Lumi-Order" di mockup
  bukan `apps/hp`, dan belum ada di repo); kelompok B dan C `test:schema`;
  `GET /shifts`; klasifikasi tujuh kode 409; yatim snapshot pindah outlet.

## Kondisi berhenti — laporkan dan tunggu

- Test yang sudah ada merah, dan sebabnya bukan perubahan kampanye
- Penjaga hampa yang tidak dapat diperbaiki
- Elemen mockup yang hanya dapat diterapkan dengan mengubah spec
- Perubahan yang menyentuh logika uang, kas, atau sync di luar tata letak
- Perubahan nilai token di luar Fase 1
- Keadaan repo atau branch tidak seperti yang diharapkan

Elemen yang butuh fitur belum ada **bukan** kondisi berhenti: catat, lewati.

## Status

Nilai status: `belum` · `berjalan` · `PR terbuka` · `menunggu user` · `selesai` · `berhenti`

| Fase | Pekerjaan | Status | PR | Catatan |
|---|---|---|---|---|
| 0 | Persiapan: aturan di `CLAUDE.md`, pelacak ini, penolakan #9–#10 | selesai | #59 | |
| 1 | Palet campuran: permukaan netral terang, teks dan aksen repo | menunggu user | #60 | ⛔ **Tidak di-merge tanpa persetujuan user lewat preview.** Sesudah merge: gabungkan `main` ke semua PR terbuka, jalankan ulang seluruh penjaga |
| 2 | Cakupan galeri: login, buka shift, edit item, pembayaran, konfirmasi, struk, void/refund, laci kas | selesai | #61 | Nol perubahan tata letak aplikasi |
| 3.1 | K-03 Kasir | selesai | #62 | ≥ 12 kartu pada 1024×768; baris keranjang tidak dipendekkan |
| 3.2 | K-06 Pembayaran | selesai | #63 | Sembilan penjaga K-06 tetap hijau |
| 3.3 | K-07 Konfirmasi | selesai | #64 | |
| 3.4 | Struk | dilewati | — | |
| 3.5 | Void dan refund | selesai | #65 | |
| 3.6 | Laci kas | belum | — | |
| 3.7 | K-01 Login | belum | — | |
| 3.8 | K-02 Buka shift | belum | — | |
| 3.9 | K-08 Riwayat | belum | — | Format nomor struk repo dipertahankan |
| 3.10 | K-12 Tutup kas | belum | — | Hitungan buta tetap |
| 4 | Laporan akhir | belum | — | |

## Catatan per fase

Diisi saat fase berjalan: selisih yang dikejar, ditolak, dan dilewati; hasil
penjaga dan sabotase; fitur yang dibutuhkan mockup tetapi belum ada.

### Fase 1 — palet campuran (#60, menunggu persetujuan user)

- Delapan token ditimpa di `packages/ds/lumi.css`, nilainya diturunkan
  `tools/palet-turunan.mjs`. `--warning` ikut digelapkan (4,31 → 4,52 di
  `--surface-alt`; gagal sejak palet lama).
- Penjaga: `tests/runtime/palet-kontras.test.js`, `tests/kasir-dom/palet-berlaku.test.js`.
- Sesudah merge: gabungkan `main` ke semua PR terbuka, jalankan ulang seluruh penjaga.
- Preview: `lumi-pos-v2-git-rebuild-ui-fase-1-after-school-mpp.vercel.app/harness-galeri.html?layar=…`
- Dinyatakan: bayangan dan `--overlay` masih rona tinta lama.

### Fase 2 — cakupan galeri (#61)

- K-01, K-02, K-09 masuk galeri; dialog dan overlay dicapai lewat jalur klik
  (`docs/referensi-visual/alat/banding2.mjs` `JALUR`, dan
  `tests/kasir-dom/galeri-cakupan.test.js`).
- Tiga cacat fixture diperbaiki: rounding 0 / `'nearest'` (K-07 tak
  tercapai), `WHERE order_id` diabaikan + order tanpa subtotal/baris (K-09).
- `BANDING.md` § Fase 2: sebelas pasangan baru dengan selisih bertanda.
- Sabotase menyala: rounding 0 (K-07), filter `WHERE` dilepas (K-09 empat
  pembayaran), K-01 di dalam shell, `tanpaShift` false (K-02).
- Suite: kasir-dom 38, kasir 569, server 506, seluruh suite lain hijau.
  Satu kegagalan `test:server` saat hook sesi menjalankan `test:isolation`
  bersamaan; diulang sendirian 506/506.

**Fitur yang dibutuhkan mockup tetapi belum ada** (dikumpulkan untuk Fase 4):
pemilihan pengguna sebelum PIN (K-01) · banyak laci per perangkat (K-02) ·
diskon per baris, catatan per baris (edit item) · hitung mundur QRIS ·
pengiriman struk digital WhatsApp/Email (K-07) · pratinjau struk di layar ·
daftar movement kas shift di perangkat (laci).

### Fase 3.1 — K-03 Kasir (#62)

Dikejar (penjaga `tests/kasir-dom/k03-kepadatan.test.js`, merah dulu di
empat titik):

| Selisih | Sebelum | Sesudah | Mockup |
|---|---|---|---|
| Kolom grid pada 1280 | 6 | 4 | 4 |
| Kartu bergambar 1280 | 139 × 133, foto 113 × 64 berbingkai | 213 × 130, foto 211 × 70 selebar kartu | 213 × 143, foto 213 × 72 |
| Kartu bergambar 1024 | 151 × 156 | 149 × 127 | — |
| Kartu terlihat (IA:62) | 12 / 15 pada 1024 · 15 pada 1280 | 12 pada keduanya | 12 dari 12 |
| Kolom keranjang | 352 | 360 | 360 |
| Judul "Keranjang", label "Total" | 15/500 | 20/500 | 20/600 |

Sabotase yang menyala (8/8): kolom kembali 6 · foto berbingkai · rasio 16:9 ·
rasio 1:1 (IA:62 merah di tiga penjaga) · keranjang 352 · baris keranjang
dipendekkan · judul 15 px · label Total bobot 600.

Ditolak:
- Bobot 600 untuk judul dan label: `--weight-bold` bundle "hanya untuk
  --text-display" (peringkat 2 mengalahkan mockup).
- Harga kartu berwarna aksen: DS #2 dan keputusan "berat, bukan warna" di
  `kasir.css`.
- Chrome atas setinggi mockup (136 px): chrome repo 108 px, dan menambah
  toolbar melintang sudah terukur menjatuhkan grid ke 8 kartu
  (`k03-chrome.test.js`). Toolbar delapan tombol, lonceng, lencana qty tanpa
  stepper, baris "Pajak": sudah ditolak di README.
- Chip kategori netral: warna kategori adalah token repo; urusan palet (Fase 1).

Dilewati (fitur belum ada): kosongkan keranjang sekaligus · menu pengguna di
topbar.

Dilewati, dengan alasan:
- "Diskon Rp 0" selalu tampil dan subjudul "Rp X per item": keduanya menambah
  baris di kolom keranjang, yang sudah hanya memperlihatkan ≈ 4 baris 82 px;
  baris keranjang tidak boleh dipendekkan, jadi ruangnya diambil dari daftar.
- Pita offline di dalam kolom katalog: pita milik `ShellKasir` dan berlaku
  di setiap layar; memindahkannya hanya di K-03 adalah perubahan shell, bukan
  K-03.

Harga yang dinyatakan: foto 1:1 tampil sepertiga tengahnya (3:1). Catatan
16:9 di `CLAUDE.md` dan `docs/verifikasi/GAMBAR-ANGGARAN.md` § 7 diperbarui.

Tangkapan sesudah: `docs/referensi-visual/sesudah/`, kolom "Sesudah" di
`INDEKS.md` (`BANDING_KELUAR=sesudah BANDING_SARING=kasir node banding.mjs`).

### Fase 3.2 — K-06 Pembayaran (#63)

Dikejar (penjaga `tests/kasir-dom/k06-tata-letak.test.js`, diukur di overlay
galeri pada 1024 dan 1280, merah dulu di empat test):

| Selisih | Sebelum | Sesudah | Mockup |
|---|---|---|---|
| Lebar kartu | 896 | 728 | 728 |
| Pemilih metode | 2 × 2 | satu baris, 56 px | satu baris (segmented) |
| Total | 15/500 · 20/500 | label 20/500 · nilai 32/600 | 32/700 |
| Aksi utama | selebar kartu | kanan bawah, sebaris dengan Kembali | 198 × 56 kanan bawah |

Sembilan penjaga `k06-penjaga` tetap hijau (P8 pada viewport 600).
Sabotase yang menyala (5/5): lebar 896 · metode 2 × 2 · Total 20 px · aksi
utama tidak di kanan · aksi utama selebar kartu.

Ditolak:
- Total di ATAS kartu: P9 menjaga Total di blok aksi yang menempel, dan angka
  yang ditagih duduk di samping tombol yang menagihnya. Ukurannya dikejar,
  letaknya tidak.
- Bobot 700: bukan token (`--weight-bold` 600).
- Tab metode 44 px dan pintasan uang 44 px (#10); tab Transfer (#3); panel
  "Kembalian" di K-06 (P3, FR-C9).
- Halaman penuh "Kembali ke kasir": overlay dipertahankan (P1 dan alur QRIS
  bergantung padanya).

⛔ **Menunggu keputusan user, tidak dibangun:** field teks bebas "Nominal
diterima". Ia jalur MASUKAN uang baru (mengurai rupiah yang diketik) di layar
yang menyimpan penjualan — kondisi berhenti "perubahan yang menyentuh logika
uang di luar tata letak". Pola parsernya sudah ada di K-12 (`Bidang` ber-awalan),
jadi biayanya kecil bila disetujui.

### Fase 3.3 — K-07 Konfirmasi (#64)

Dikejar (penjaga `tests/kasir-dom/k07-konfirmasi.test.js`, overlay galeri pada
1024 dan 1280, merah dulu di empat test):

| Selisih | Sebelum | Sesudah | Mockup |
|---|---|---|---|
| Wadah | kartu pembayaran 728 × 303 | kartu 536, ikon centang di lingkaran `--success-soft` | 536 × 466, ikon dalam lingkaran lembut |
| Judul | tidak ada | "Transaksi selesai" 20 px | ada |
| Kembalian | 32/600 tanpa panel | panel `--accent-soft`, 32/600 warna teks | panel, 32/700 aksen |
| Cetak struk | tidak ada | "Cetak ulang struk" (jalur K-09) | "Cetak Struk" |
| Transaksi Baru | selebar kartu | kanan, sebaris dengan Cetak ulang, 56 px | 229 × 44 |

⛔ **Cacat yang ditemukan:** `HasilPenjualan.cetak` dikembalikan
`simpanPenjualan` supaya layar dapat berkata "struk gagal dicetak, transaksi
tersimpan" (`CLAUDE.md` § F4), dan K-07 tidak pernah membacanya: kegagalan
cetak pertama tidak terlihat di mana pun. Kini dirender (`data-cetak="pertama"`),
dijaga, dan sabotasenya menyala.

Jalur cetak ulang K-09 dipindahkan ke `apps/kasir/src/cetak/cetak-ulang.ts`
(`cetakUlangOrder` + `kalimatCetak`) dan dipakai K-07 dan K-09. Satu test
menjaga K-09 tetap membangun ulang struknya lewat jalur itu.

Sabotase yang menyala (8/8): lebar 728 · ikon tanpa latar · kembalian tanpa
panel · angka kembalian aksen · hasil cetak pertama tidak dirender · Cetak
ulang 44 px · Transaksi Baru selebar kartu · struk K-09 tidak dibangun.
⛔ Sabotase "angka aksen" semula TIDAK menyala: token `--accent` dibaca dari
`color` elemen terlepas (string kosong). Penjaganya diperbaiki dan kini
menegaskan tokennya terbaca.

Klaim berangka `KELAS-GAGAL.md` K1 berubah 27/42 → 28/42 tanpa perubahan
perilaku (komentar ber-"antrean" pindah dari `DetailTransaksi.tsx`).

Ditolak: angka kembalian berwarna aksen (DS #2) · nomor `TRX-…` (#9) ·
"Transaksi Baru" 44 px (#10).

Dilewati (fitur belum ada): kirim struk WhatsApp/Email.

Temuan, TIDAK diperbaiki (di luar layar ini): `DetailTransaksi.tsx` punya peta
metode sendiri berkunci `card`, bukan `card_edc` — pembayaran EDC tampil
sebagai kode mentah di K-09, dan ini salinan kedua `LABEL_METODE`.

### Fase 3.4 — Struk: dilewati

Repo tidak punya layar struk. `apps/kasir/src/cetak/dokumen.ts` menghasilkan
dokumen untuk printer; mockup `struk` (58/80 mm) adalah PRATINJAU di layar —
fitur yang belum ada (daftar Fase 2). Tidak ada tata letak yang dapat dikejar
tanpa membangunnya. Kata "Pajak" di struk mockup: ditolak #2.

### Fase 3.5 — Void dan refund (K-10, #65)

Dikejar (penjaga `tests/kasir-dom/k10-refund.test.js`, viewport 1280×800 dan
1280×768, merah dulu: "menggulir 895 dari 768 px"):

| Selisih | Sebelum | Sesudah | Mockup |
|---|---|---|---|
| Wadah refund | satu kolom 448, menggulir 895 px | dua kolom (alasan · barang + jumlah), tanpa gulir | dua kartu 502 berdampingan |
| Bilah aksi | di dasar isi yang menggulir | selebar dialog, aksi utama di kanan | bilah bawah, aksi di kanan |

Void tetap satu kolom sempit (isinya hanya alasan). `LatarDialog` mendapat
prop `lebar`.

Sabotase yang menyala (3/3): tanpa `lebar` · satu kolom · aksi di kiri.

Ditolak: kasir memilih "Jenis tindakan" (`spec-b`: sistem yang memilih) ·
alasan teks bebas (daftar tertutup, FR-G5) · "Konfirmasi void" 44 px (#10) ·
nomor `TRX-…` (#9).

Diadaptasi, bukan disalin: kolom kanan mockup adalah ringkasan "Transaksi
asli"; di repo ringkasan itu sudah ada di K-09 di belakang dialog, jadi kolom
kanan memuat barang yang kembali dan jumlahnya — isi yang membuat dialog satu
kolom menggulir.

