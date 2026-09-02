# Temuan peninjauan visual — 1 September 2026

Sumber: `komentar_visual_galeri_lumipos.pdf`, ditinjau user terhadap galeri
komponen di preview URL branch.

Status: **⬜ belum · 🔧 dikerjakan · ✅ selesai · ⛔ menunggu keputusan**

---

## Umum

| # | Temuan | Jenis | Status |
|---|---|---|---|
| U1 | Design system keseluruhan, terutama background/warna elemen | JELEK | 🔧 |
| U2 | Tambah lebih banyak elemen dan ikon di tiap halaman | JELEK | 🔧 |
| U3 | Layout diperbaiki secara keseluruhan | JELEK | 🔧 |

## A. K-03 Normal

| # | Temuan | Jenis | Status |
|---|---|---|---|
| A1 | **Kartu harusnya bergambar** | JELEK | ⛔ tabrakan DS #8 |
| A2 | Elemen dan border bisa lebih bagus | JELEK | ⬜ |
| A3 | Pencarian lebih aesthetic + fungsional, tambah **"sort by"** | JELEK | ⬜ |
| A4 | Menu "…" jelek — buat mirip navbar back-office | JELEK | ⬜ |
| A5 | Kartu extend pemilihan variasi sangat plain | JELEK | ⬜ |
| A6 | **Pembayaran jadi overlay card, bukan 1 halaman penuh** | JELEK | ⛔ tabrakan IA |
| A7 | Keranjang memanjang sampai bawah, memaksa scroll halaman utama — **scroll khusus di keranjang** | KIKUK | ⬜ |
| A8 | Baris keranjang perlu opsi **menambah kuantitas**, dan pembagian antar elemen diperjelas agar tidak salah tekan | KIKUK | ⬜ |

## B. K-03 Memuat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| B1 | Perlu **loading screen**, jangan kosong | KIKUK | ⬜ |

## C. K-03 Daftar panjang

| # | Temuan | Jenis | Status |
|---|---|---|---|
| C1 | Katalog perlu **pagination** | KIKUK | ⛔ tabrakan IA:53 |

## D. K-08 Riwayat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| D1 | Flat. Waktu, status, dll harus lebih jelas. Harus bisa melihat **detail transaksi keseluruhan** | JELEK | ⬜ |
| D2 | Pencarian lebih aesthetic + **sort by** (jam / tanggal) | JELEK | ⬜ |
| D3 | Daftar panjang perlu **pagination** | KIKUK | ⬜ |

## F. K-12 Tutup kas

| # | Temuan | Jenis | Status |
|---|---|---|---|
| F1 | Flat dan lifeless — **jauh lebih visual, banyak data, grafik** | KIKUK/JELEK | ⛔ tabrakan spec-d:96 |

## G. K-15 Perangkat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| G1 | Dipakai orang awam — harus rapi, aesthetic, mudah, jelas | KIKUK/JELEK | ⬜ |

---

# ⛔ Empat tabrakan dengan aturan terkunci

Diperiksa di spec, bukan ditebak. Aturan user sendiri: *"Kalau instruksiku
bertentangan satu sama lain — tunjuk konfliknya, jangan tebak."*

## 1. A1 — gambar di kartu produk vs DS #8

`CLAUDE.md` aturan #8, sesudah pelonggaran 1 September:

> Tanpa emoji, **tanpa gambar**, tanpa dark mode.

Yang dicabut hari itu **hanya gradien dan tekstur** — "tanpa gambar" sengaja
dipertahankan dan ditulis ulang dalam kalimat pencabutannya.

⛔ **Datanya bukan penghalang:** `item.image_url` sudah ada di skema lokal
(`db/local/001-initial.sql:14`) dan di PostgreSQL.

**Yang menghalangi adalah ongkosnya, dan ia bukan ongkos CSS:**

- gambar harus TURUN ke perangkat lewat PowerSync — menambah bandwidth pada
  produk yang seluruh nilai jualnya adalah bekerja tanpa internet
- disimpan di OPFS, yang `storage.persisted() === false` (prototipe 03) —
  browser boleh menghapusnya kapan saja
- butuh jalur unggah di back-office yang **belum ada sama sekali**
- kartu tanpa gambar (merchant baru, atau produk yang belum difoto) menuntut
  keadaan tersendiri, kalau tidak grid jadi campuran kotak abu-abu dan foto

Ini fitur, bukan perubahan tampilan. **Butuh keputusanmu.**

## 2. F1 — grafik di K-12 vs kontrol anti-fraud

`spec-d:96`, dan kalimatnya menyebut dirinya sendiri sebagai kontrol:

> Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka
> terhitung. **Ini kontrol, bukan preferensi UX** — kasir yang melihat angka
> target akan menghitung mundur ke angka itu.

Layar K-12 tahap pertama **sengaja** hampir kosong. Mengisinya dengan data dan
grafik membatalkan satu-satunya kontrol yang mencegah kasir menyesuaikan
hitungannya ke angka yang sudah ia lihat.

⛔ **Tapi ada ruang nyata, dan besar.** K-12 punya TIGA tahap:

| Tahap | Boleh dipadatkan? |
|---|---|
| 1. hitung | **tidak** — ini kontrolnya |
| 2. review (setelah hitungan masuk) | **ya, sepenuhnya** |
| 3. K-13 laporan shift | **ya, sepenuhnya** — di sinilah grafik berhak ada |

Rekomendasi: tolak untuk tahap 1, kerjakan penuh untuk tahap 2 dan 3. Yang
kamu lihat di galeri adalah tahap 1 — memang yang paling kosong.

## 3. A6 — pembayaran sebagai overlay vs IA

`IA:56-57` mendaftarkan K-06 dan K-07 sebagai **layar**, punya kode layar
sendiri di tabel 52 layar. Bandingkan K-16 yang IA sebut eksplisit *"Dialog,
bukan layar"* — jadi IA memang membedakan keduanya, dan menempatkan pembayaran
di sisi layar.

Tabrakannya **lebih lunak** daripada dua di atas: IA tidak melarang overlay
dengan kalimat, ia hanya menempatkannya sebagai layar.

Pertimbangan nyata di 1024×768:

- K-06 memuat pembayaran CAMPURAN — beberapa metode dalam satu transaksi
- QRIS dinamis menampilkan QR + polling sampai 5 menit
- K-07 menampilkan kembalian pada `--text-display` (32px), angka terbesar di
  seluruh aplikasi, dibaca kasir DAN pelanggan bersamaan

Overlay kecil akan menyempitkan ketiganya. **Overlay besar** (menutup ~80%
layar, bukan kotak dialog) memenuhi maksudmu tanpa mengorbankan itu.

## 4. C1 — pagination katalog vs IA:53

`IA:53` menuntut K-03 menampilkan **≥12 kartu tanpa scroll**. Pagination tidak
melanggar itu — ia justru menegakkannya.

Yang jadi soal: **ketukan per penjualan**. Kasir yang produknya ada di halaman
3 menekan dua kali sebelum menemukannya, pada setiap penjualan produk itu,
sepanjang hari. Saringan kategori dan pencarian sudah ada dan menyelesaikan
masalah yang sama dengan nol ketukan tambahan untuk produk yang sering dijual.

Rekomendasi: **pagination untuk K-08** (D3 — daftar yang DIBACA, bukan ditekan
cepat), dan untuk K-03 perbaiki kepadatan + saringan alih-alih memecah halaman.
Bukan penolakan; ini trade-off yang perlu kamu putuskan.
