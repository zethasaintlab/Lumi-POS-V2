# Temuan peninjauan visual — 1 September 2026

Sumber: `komentar_visual_galeri_lumipos.pdf`, ditinjau user terhadap galeri
komponen di preview URL branch.

Status: **⬜ belum · 🔧 dikerjakan · ✅ selesai · ⛔ menunggu keputusan**

---

## Umum

| # | Temuan | Jenis | Status |
|---|---|---|---|
| U1 | Design system keseluruhan, terutama background/warna elemen | JELEK | ✅ 2 Sep — permukaan tenggelam untuk grid, gradien, elevasi kartu |
| U2 | Tambah lebih banyak elemen dan ikon di tiap halaman | JELEK | ✅ 2 Sep — `<Badge>`, `<SegmentedControl>`, `<Tabs>`, `<Card>` |
| U3 | Layout diperbaiki secara keseluruhan | JELEK | ✅ 2 Sep — nav persisten, baris kontrol, pengelompokan kartu |

## A. K-03 Normal

| # | Temuan | Jenis | Status |
|---|---|---|---|
| A1 | **Kartu harusnya bergambar** | JELEK | ⛔ tabrakan DS #8 |
| A2 | Elemen dan border bisa lebih bagus | JELEK | ✅ `--shadow-card`, `--surface-sunk`, badge habis |
| A3 | Pencarian lebih aesthetic + fungsional, tambah **"sort by"** | JELEK | ✅ baris kontrol + `<SegmentedControl>` A–Z/termurah/termahal + hitungan hasil |
| A4 | Menu "…" jelek — buat mirip navbar back-office | JELEK | ✅ `<Tabs variant="underline">` persisten; gerbang tidak jadi tab |
| A5 | Kartu extend pemilihan variasi sangat plain | JELEK | ✅ `<SegmentedControl>` bernama+berharga |
| A6 | **Pembayaran jadi overlay card, bukan 1 halaman penuh** | JELEK | ✅ overlay 56rem lewat KELAS `.overlay`/`.dialog` — bukan `<Modal>`, yang menutup saat latar diklik |
| A7 | Keranjang memanjang sampai bawah, memaksa scroll halaman utama — **scroll khusus di keranjang** | KIKUK | ✅ 1 Sep |
| A8 | Baris keranjang perlu opsi **menambah kuantitas**, dan pembagian antar elemen diperjelas agar tidak salah tekan | KIKUK | ✅ `.stepper`; qty→0 menghapus, tombol Hapus dibuang |

## B. K-03 Memuat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| B1 | Perlu **loading screen**, jangan kosong | KIKUK | ✅ 2 Sep — `<Memuat>` kerangka di 7 layar; bundle tidak punya skeleton |

## C. K-03 Daftar panjang

| # | Temuan | Jenis | Status |
|---|---|---|---|
| C1 | Katalog perlu **pagination** | KIKUK | ✅ 2 Sep — **"muat lebih banyak", bukan halaman bernomor**; alasannya di bawah |

## D. K-08 Riwayat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| D1 | Flat. Waktu, status, dll harus lebih jelas. Harus bisa melihat **detail transaksi keseluruhan** | JELEK | ✅ `<Badge>` status; ⛔ **Subtotal + Diskon dirender** — `order_discount` tidak pernah dibaca sebelumnya |
| D2 | Pencarian lebih aesthetic + **sort by** (jam / tanggal) | JELEK | ✅ terbaru/terlama/nilai tertinggi |
| D3 | Daftar panjang perlu **pagination** | KIKUK | ✅ 2 Sep — halaman bernomor + elipsis, 25/halaman |

## F. K-12 Tutup kas

| # | Temuan | Jenis | Status |
|---|---|---|---|
| F1 | Flat dan lifeless — **jauh lebih visual, banyak data, grafik** | KIKUK/JELEK | ⛔ tabrakan spec-d:96 |

## E. K-06/K-07 Pembayaran — GERBANG FIXTURE

⛔ Bukan temuan visual. Ini prasyarat yang mengikat sebelum kedua layar
pembayaran boleh dinyatakan selesai (keputusan user 2 September 2026, dari
`MONOKULTUR-FIXTURE.md`).

| # | Butir | Status |
|---|---|---|
| E1 | Fixture `tax_rate.type='ppn'` 11%. ⛔ Bila `TaxCalculator` tidak menanganinya: **bug uang, laporkan, jangan tambal diam** | ⬜ |
| E2 | Fixture `service_charge_amount != 0` **dan** `channel='dine_in'` | ⬜ |
| E3 | Fixture `qris_static` + `card_edc` di jalur **TAMPILAN**, bukan hanya data | ⬜ |

## G. K-15 Perangkat

| # | Temuan | Jenis | Status |
|---|---|---|---|
| G1 | Dipakai orang awam — harus rapi, aesthetic, mudah, jelas | KIKUK/JELEK | ✅ kolom dikelompokkan `<Card>`, status `<Badge>`, profil printer `<SegmentedControl>` |

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


---

# Sapuan sembilan butir — selesai 2 September 2026

Sembilan butir "ongkos turun" ditutup dalam satu sapuan. **Tiga yang harus
DIBANGUN belum dikerjakan** dan tetap berstatus ⬜: B1 penanda memuat, C1
paginasi katalog, D3 paginasi riwayat.

⛔ **Yang ditemukan saat menyapu, dan ia bukan perbaikan tampilan:**

1. **`order_discount` tidak pernah dibaca K-08.** Query detailnya bahkan tidak
   menyeleksi kolomnya, jadi baris + pajak tidak menjumlah ke Total pada setiap
   transaksi berdiskon — di layar yang dipakai memutuskan refund. Bentuk yang
   sama dengan cacat struk yang sudah dibayar 22 Agustus, bertahan sebelas hari
   lebih lama karena tidak ada test yang menjumlahkan angka di layar.

2. **`<Modal>` bundle tidak aman untuk K-06.** Ia memasang `onClick={onClose}`
   pada latarnya — ketukan meleset di tepi tablet membuang nominal tunai yang
   sedang diketik. Yang dipakai KELASnya (`.overlay`/`.dialog`), pola yang sama
   dengan `CartRow`/`ProductCard`. Bedanya di sini bukan uang melainkan
   PERILAKU, dan keduanya sama-sama tidak menghasilkan error.

3. **`--space-5` tidak ada**, dan saya memakainya lagi satu jam setelah menulis
   catatan tentang delapan token hantu. `tests/runtime/token-css-ada.test.js`
   yang menemukannya, bukan mata.

⛔ **Batas yang dinyatakan pada A6:** K-03 tetap di-unmount di balik overlay,
jadi keranjang tidak terlihat menembus latar. Membiarkannya hidup berarti
listener pemindai tetap mendengarkan, dan scan yang masuk saat kasir mengetik
nominal akan menambah barang ke pesanan yang angkanya sudah disebutkan.
Perubahan perilaku, bukan tampilan — tidak dikerjakan di dalam sapuan UI.

⛔ **`<Switch>` TIDAK dipakai di K-15** meski `BUNDLE.md` mengusulkannya: layar
itu tidak punya satu pun setelan boolean. Mengarang satu untuk mengisi slot
adalah persis yang aturan token melarang.


---

# Tiga yang harus DIBANGUN — selesai 2 September 2026

`/ds-bundle` tidak mengirim satu pun dari ketiganya; diperiksa di sumbernya.

## B1 — `<Memuat>`, kerangka bukan spinner

Tujuh layar memakai `<EmptyState title="Membaca …">`. `EmptyState` dirancang
untuk keadaan **KOSONG**, dan bentuknya menyatakan itu: ikon besar, ruang
lapang, kalimat yang terdengar final. Keadaan MEMUAT berarti kebalikannya —
"ada sesuatu, tunggu". Kasir pada perangkat lambat menyimpulkan katalognya
hilang, setiap pagi.

- Kerangka menempati ruang yang akan diisi, jadi kedatangan isi tidak
  memindahkan satu pun elemen. Kolom kerangka grid disamakan PERSIS dengan
  `.kasir-grid` (8rem) — kolom yang berbeda membuat kartu melompat, dan
  lompatan itu justru yang kerangka ada untuk mencegahnya.
- `prefers-reduced-motion` menghentikan denyutnya. Bentuknya tetap
  menyampaikan "sedang datang".
- `role="status"` + `aria-live`: pembaca layar tidak melihat kerangka sama
  sekali, dan senyap tidak dapat dibedakan dari layar yang tidak merespons.

## D3 — halaman bernomor untuk K-08

25 baris per halaman, elipsis di atas 7 halaman, `aria-current` pada halaman
aktif. **Rentang ("1–25 dari 137") selalu tampil**, juga saat hanya ada satu
halaman: daftar yang tidak menyebut totalnya membuat kasir tidak dapat
membedakan "riwayat memang pendek" dari "saringannya menyisakan sedikit".

## C1 — ⛔ K-03 memakai bentuk yang BERBEDA, dan itu keputusan

**"Muat lebih banyak", bukan halaman bernomor.**

`IA:53` menuntut ≥12 kartu tanpa scroll, dan paginasi bernomor tidak
melanggarnya. Yang jadi soal **ketukan per penjualan**: kasir yang produknya
di halaman 3 menekan dua kali sebelum menemukannya, pada setiap penjualan
produk itu, sepanjang hari. Saringan kategori dan pencarian sudah
menyelesaikan masalah yang sama dengan nol ketukan tambahan untuk produk yang
sering dijual.

- Batasnya **48**, empat kali lipat yang `IA:53` tuntut. Ia menahan ONGKOS
  RENDER pada katalog besar, bukan memecah menu — merchant di bawah 48 produk
  tidak pernah melihat tombolnya sama sekali.
- Kalimat tombolnya membawa **angkanya**: "muat lebih banyak" tanpa angka
  membuat katalog terbaca seperti tidak punya ujung.
- Potongan kembali ke awal saat saringan berubah.

⛔ **Ini trade-off yang dinyatakan, bukan penolakan.** `potongHalaman` sudah
mendukung halaman bernomor; yang berubah hanya komponen yang memanggilnya.
Kalau kamu ingin K-03 bernomor juga, ongkosnya satu berkas.
