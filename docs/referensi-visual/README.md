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

## ⛔ Yang di mockup bertabrakan dengan spec, dan tetap DITOLAK

Delapan hal berikut diputuskan user. Kemunculannya di mockup tidak mengubah
keputusan apa pun. Enam yang pertama diputuskan saat ekspor ini masuk; dua
yang terakhir ditemukan saat memotret dan diputuskan 23 September 2026.

| Di mockup | Tangkapan | Kenapa ditolak |
|---|---|---|
| **QR di dalam kartu pembayaran** | `kasir--bayar--qris-siap.png` | `CLAUDE.md` § FR-C3: "QR ditampilkan sebagai TEKS, bukan gambar. Merender QR menuntut pustaka baru dan stack dikunci." |
| **Kata "Pajak" menggantikan nama tarif** | `kasir--kasir--*.png` (ringkasan keranjang), `kasir--struk--*.png` | `apps/kasir/src/layar/Kasir.tsx:1003`: "Baris pajak memakai NAMA TARIF, bukan kata 'Pajak'." Hanya cetak ulang yang boleh berbunyi "Pajak", dan itu batas yang dinyatakan (`CLAUDE.md` § F4), bukan pola tampilan |
| **Metode Transfer** | `kasir--bayar--transfer.png` | `LABEL_METODE` (`packages/domain/src/metode-tampilan.ts`) berisi `cash`, `qris_dynamic`, `qris_static`, `card_edc`, `other`. Transfer tidak punya metode sendiri, dan `spec-c:244` menaruhnya di bawah "Lainnya" dengan catatan wajib |
| **Tombol toolbar yang nol kode** | `kasir--kasir--*.png` (delapan tombol: Item manual, Diskon, Pajak, Catatan, Pelanggan, No. Meja, Batalkan, Pesanan tahan) | `apps/kasir/src/layar/Kasir.tsx` membatasi toolbar pada tiga aksi. Lima sisanya tidak punya kode di repo ini, dan tiga di antaranya ada di daftar "jangan bangun" v1.1 |
| **Ikon notifikasi** | lonceng di bilah atas Kasir dan Back-office | Tidak ada sistem notifikasi di v1. Ikon yang tidak membuka apa pun adalah kontrol mati |
| **Keranjang tanpa kontrol qty** | `kasir--kasir--keranjang-penuh.png` (lencana `1x`/`2x`/`3x` saja) | Kasir mengubah qty di baris. Qty turun ke 0 menghapus baris; itulah yang meniadakan tombol "Hapus" terpisah (`CLAUDE.md` § aturan memakai `/ds-bundle`) |
| **"Saldo seharusnya" tampil sebelum hitungan fisik diisi** | `kasir--tutup--tunggal.png` | `spec-d` FR-D2, hitungan buta: "Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka terhitung. Ini kontrol, bukan preferensi UX." Kontrol itu dipertahankan 22 September 2026 dan dijaga `tests/kasir-dom/k12-hitungan-buta.test.js`. "Penjualan tunai" dan "Total penjualan" di ringkasan shift mockup membocorkan angka yang sama. Mockup `ds-bundle/ui_kits/pos/TutupKasScreen.jsx` yang lama justru hitungan buta; mockup ini tidak |
| **Tombol "Konfirmasi bayar" manual untuk QRIS dinamis** | `kasir--bayar--qris-siap.png`, `kasir--bayar--qris-memuat.png` | `spec-c:320`: "Sistem **tidak pernah** menandai pembayaran lunas tanpa konfirmasi dari gateway." Tombol manual membuat pembayaran dapat ditandai lunas **tanpa uang masuk**. Hanya QRIS statis yang dikonfirmasi orang, dan ia ditandai `confirmed_manually` supaya FR-G5 dapat menemukannya |

## ⛔ Palet mockup ini BELUM DIPUTUSKAN

Mockup memakai palet sendiri (`sumber/tokens/colors.css`): aksen `#14706b`,
font Nunito Sans, dan ukuran teks kecil 13px. Repo memakai palet lain: aksen
`#0D5C63`, Inter, dan 12px. **Jangan terapkan satu pun nilai dari
`sumber/tokens/` ke token repo sampai user memutuskan.** Bahan keputusannya
ada di `PALET.md`, dan ia sengaja tanpa rekomendasi.

Sampai keputusan itu ada, aturan `CLAUDE.md` tetap berlaku apa adanya:
`ds-bundle/` tidak disunting, aksen teal `#0D5C63` tidak disentuh, dan skala
teks tetap lima token.

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
