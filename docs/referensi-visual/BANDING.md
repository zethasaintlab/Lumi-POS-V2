# Mockup berdampingan dengan galeri kasir — pemetaan dan selisih terukur

Gambar di `banding/` dan angka di bawah dibangkitkan `alat/banding.mjs`. Mockup
ada di kiri, galeri di kanan. Galeri dibangun dari `c71abba` (`main` sesudah
#55); PR #56 (K-12 diperkaya) **belum** termasuk.

## ⛔ Batas pengukuran — baca dulu

- **Viewport.** Mockup Kasir dirancang untuk 1280×800. Galeri merender
  panggung **tetap 1024×768**, viewport kasir yang PRD:428 wajibkan
  (`apps/kasir/src/galeri/galeri.css`). Supaya viewport sama, panggung galeri
  diperbesar ke 1280×800 lewat CSS yang **disuntikkan di harness**; kode
  galeri tidak disentuh. Kolom "galeri 1024" di tabel kepadatan adalah ukuran
  pada viewport wajibnya.
- **Sumber angka.** Kotak, ukuran font, bobot, dan warna teks diukur dari DOM
  (`getBoundingClientRect`, `getComputedStyle`). Pangsa warna permukaan diukur
  dari piksel tangkapan mentah, **sebelum** kompresi. Tipografi dihitung per
  karakter teks yang terlihat.
- **Data fixture berbeda.** Nama produk, jumlah, dan harga di kedua sisi
  bukan data yang sama. Yang dibandingkan hanya bentuk.
- **Foto.** Mockup meminta foto Unsplash yang tidak dapat diunduh; kotak
  penggantinya berukuran sama dengan permintaan (lihat `README.md`).

## Pemetaan menurut fungsi

| Galeri | Layar mockup | Pasangan keadaan (mockup → galeri) | Gambar |
|---|---|---|---|
| **K-03** Kasir | `kasir` Layar Kasir | `campuran` → `normal` | [K-03--normal__kasir--campuran.png](banding/K-03--normal__kasir--campuran.png) |
| | | `keranjang-kosong` → `normal` (keranjang galeri `normal` memang kosong) | [K-03--normal__kasir--keranjang-kosong.png](banding/K-03--normal__kasir--keranjang-kosong.png) |
| | | `keranjang-penuh` → `keranjang-penuh` | [K-03--keranjang-penuh__kasir--keranjang-penuh.png](banding/K-03--keranjang-penuh__kasir--keranjang-penuh.png) |
| | | `katalog-kosong` → `kosong` ⚠ padanan lemah, lihat bawah | [K-03--kosong__kasir--katalog-kosong.png](banding/K-03--kosong__kasir--katalog-kosong.png) |
| | | `offline` → `offline` | [K-03--offline__kasir--offline.png](banding/K-03--offline__kasir--offline.png) |
| **K-08** Riwayat | `riwayat` Riwayat Transaksi | `ada` → `normal` | [K-08--normal__riwayat--ada.png](banding/K-08--normal__riwayat--ada.png) |
| | | `kosong` → `kosong` | [K-08--kosong__riwayat--kosong.png](banding/K-08--kosong__riwayat--kosong.png) |
| **K-12** Tutup kas | `tutup` Tutup Kas dan Laporan Shift | (tunggal) → `normal` | [K-12--normal__tutup--tunggal.png](banding/K-12--normal__tutup--tunggal.png) |

⚠ **`katalog-kosong` → `kosong` bukan padanan yang sama.** Galeri `kosong`
adalah perangkat yang **belum terdaftar**, jadi K-03 tidak merender grid dan
keranjang sama sekali. Galeri tidak punya keadaan "terdaftar, katalog kosong".
Pasangan ini hanya dapat membandingkan kalimat dan tata letak keadaan kosong,
bukan keranjang di sebelahnya.

### Tanpa padanan di galeri — ditutup Fase 2 (25 September 2026)

Sejak Fase 2 rebuild UI, setiap layar kasir mockup punya padanan yang dapat
dicapai dan diukur. Pasangan dan selisihnya ada di § Fase 2 di bawah.

| Layar mockup | Padanannya di repo | Cara mencapainya di galeri |
|---|---|---|
| `login` | K-01 `layar/Login.tsx` | `?layar=K-01` (tanpa shell, sama dengan `App.tsx:45`) |
| `shift` | K-02 `layar/BukaShift.tsx` | `?layar=K-02` (fixture tanpa shift terbuka) |
| `edit-item` | K-04/K-05 `komponen/DialogModifier.tsx` — ⚠ fungsi berbeda | K-03 `normal` → kartu ber-"pilihan" |
| `bayar` tunai / kartu | K-06 `layar/Pembayaran.tsx` | K-03 `keranjang-penuh` → Bayar (→ Kartu (EDC)) |
| `bayar` qris-* | K-06 `komponen/PanelQris.tsx` | `harness-k06.html?render=panel&status=…` |
| `sukses` | K-07, tahap selesai `Pembayaran.tsx` | K-06 → uang diterima ≥ tagihan → Simpan Penjualan |
| `struk` | **tidak ada layar** — `cetak/dokumen.ts` hanya menghasilkan dokumen cetak | — (butuh fitur pratinjau struk) |
| `void` | K-10 `komponen/DialogPembatalan.tsx` | `?layar=K-09` → Kembalikan dana |
| `laci` | Kas masuk/keluar `komponen/DialogKasManual.tsx` (FR-D5) + buka laci K-16 `komponen/DialogNoSale.tsx` | K-03 → Kas masuk / keluar · K-03 → Buka laci |
| Back-office, 6 layar / 10 kombinasi | B-xx di `apps/backoffice` — di luar cakupan kampanye | — |
| Lumi-Order, 8 layar / 18 kombinasi | **Tidak ada padanan fungsi.** `apps/hp` melayani owner, bukan pelanggan | — |

### Tanpa padanan di mockup

| Galeri | Catatan |
|---|---|
| **K-14** Status sinkronisasi | Mockup hanya punya pil "Online/Offline" di toolbar dan banner offline. Tidak ada layar antrean |
| **K-15** Perangkat | Tidak ada |
| K-03 `memuat`, `error`, `panjang`, `meluap`, `angka-besar`, `gambar`, `antrean-panjang` | Mockup tidak punya keadaan memuat atau galat untuk layar kasir |

---

## Tanda klasifikasi

- **Dapat dikejar**: tata letak murni, bisa dikerjakan dengan token yang ada.
- **Bertabrakan dengan spec**: aturannya disebut di baris.
- **Tergantung keputusan palet**: ikut keputusan `PALET.md` (warna dan font).
- **Butuh fitur yang belum ada**: fiturnya disebut di baris.

---

## K-03 Kasir

### Struktur

| Aspek | Mockup | Galeri (1280×800) | Tanda |
|---|---|---|---|
| Chrome atas | Header 68 px (logo, 4 tab, lonceng, avatar) + toolbar 68 px = **136 px** sebelum field cari | Topbar 61 px + bilah nav 47 px = **108 px** | Dapat dikejar |
| Zona | 3 zona: toolbar · katalog · keranjang | 2 zona: katalog · keranjang; aksi di slot bilah nav | Dapat dikejar |
| Kolom keranjang | x=920, lebar **360** px | x=928, lebar **352** px | Dapat dikejar |
| Yang menggulir, `keranjang-penuh` | Daftar keranjang: tampak 424 px dari 1.344 px isi | Daftar keranjang: tampak 356 px dari 1.782 px isi | Dapat dikejar |
| Yang menggulir, katalog | Tidak ada (fixture mockup hanya 12 produk) | Tidak ada pada 1280; **grid menggulir pada 1024** (tampak 660 dari 832 px) | Dapat dikejar |
| Yang menempel | Tidak ada `fixed`/`sticky`; blok total dan Bayar ditahan flex di dasar kolom | Sama: nol `fixed`/`sticky` | — |
| Aksi utama "Bayar" | 327×56, **y=728** di setiap keadaan, termasuk keranjang kosong | 319×56. **y=370 saat keranjang kosong**, y=728 saat penuh; pada 1024: y=696 saat penuh | Dapat dikejar: di galeri, Bayar berpindah 358 px mengikuti isi keranjang |
| Aksen di layar | Chip "Semua" + Bayar; pangsa piksel `#14706B` **2,0%** | Chip "Semua" + Bayar; pangsa piksel `#0D5C63` **2,0%** (`keranjang-penuh`) | — |

### Kepadatan

| Aspek | Mockup | Galeri 1280 | Galeri 1024 | Tanda |
|---|---|---|---|---|
| Kolom grid | 4 | 6 | 4 | Dapat dikejar |
| Kartu (lebar × tinggi median) | 213 × **143** (foto 72 px di atas) | 139 × 150 bergambar · 139 × **81** tanpa gambar | 151 × 156 · 151 × 81 | Dapat dikejar |
| Kartu terlihat penuh | 12 dari 12 | 15 dari 15 | **12 dari 15** (IA:62 menuntut ≥ 12) | — |
| Jarak antar kartu | 12 / 12 px | 12 / 12 px | 12 / 12 px | — |
| Baris keranjang | **58 px** (lencana qty, nama, harga satuan, subtotal) | **82 px** (nama, stepper × / 1 / + 44 px, subtotal) | 82 px | Dapat dikejar, dengan batas: stepper 44 px adalah DS #3, dan tingginya harus tetap |
| Baris keranjang terlihat, 20 item | ≈ 7 | ≈ 4 | ≈ 4 | Mengikuti baris di atas |
| Chip kategori | tinggi **36 px** | 44 px | 44 px | **Bertabrakan dengan spec**: DS #3, target sentuh ≥ 44 px |

### Tipografi (px/bobot, diurutkan menurut jumlah karakter)

| | Mockup | Galeri |
|---|---|---|
| Keluarga | Nunito Sans | Inter |
| Distribusi `campuran`/`normal` | 15/400 · 13/600 · 13/400 · 20/600 · 15/600 | 15/400 · 15/500 · 12/400 · 12/500 · 20/500 |
| Judul "Keranjang" | 20/600 | 15/500 |
| Label "Total" | 20/600 | 15/500 |

| Selisih | Tanda |
|---|---|
| Nunito Sans ↔ Inter | Tergantung keputusan palet (lihat `PALET.md` § "Yang ikut berubah") |
| Ukuran 13 px | **Bertabrakan dengan spec**: DS #1 dan skala lima token (32/20/15/12 + `--t-metric`). 13 px bukan salah satunya |
| Bobot 600 untuk label dan judul, bukan 500 | Dapat dikejar: Inter 600 sudah dimuat (`docs/DESIGN.md` § 2) |
| Judul panel 20 px, bukan 15 | Dapat dikejar: `--text-title` 20 px adalah token inti |

### Warna

| | Mockup | Galeri | Tanda |
|---|---|---|---|
| **Permukaan**, pangsa piksel | putih 72,4% · `#F0F6F7` 13,0% (latar grid) | putih 38,8% · `#F7F5F3` 26,4% (latar halaman) | Tergantung keputusan palet |
| **Aksen** | `#14706B` | `#0D5C63` | Tergantung keputusan palet |
| **Teks utama** | `#16282C` | `#14110F` | Tergantung keputusan palet |
| **Teks sekunder** | `#5E747A` | `#5C5450` | Tergantung keputusan palet |
| Harga di kartu | berwarna aksen (106 karakter aksen) | **`#000000`**: nama dan harga kartu tidak memakai token teks | Dapat dikejar. ⛔ **Temuan:** `span.kasir-kartu-nama` dan `span.kasir-kartu-harga` mewarisi `color: buttontext` bawaan `<button>` peramban (15 + 15 elemen), bukan `--ink`. Dicatat, tidak diperbaiki di PR ini |
| Chip kategori | netral, aktif teal penuh | bertepi warna kategori (`--kat-*`), aktif teal penuh | Dapat dikejar (warna kategori sudah token repo) |

### Komponen yang hanya ada di satu sisi

| Hanya di mockup | Tanda |
|---|---|
| Toolbar delapan tombol | **Bertabrakan dengan spec**: `Kasir.tsx:545`, tiga aksi saja |
| Lonceng notifikasi | **Bertabrakan dengan spec**: tidak ada notifikasi di v1 (`README.md`) |
| Lencana qty `1x` tanpa stepper | **Bertabrakan dengan spec**: qty diubah di baris, qty 0 menghapus baris |
| Baris "Pajak" tanpa nama tarif | **Bertabrakan dengan spec**: `Kasir.tsx:1003` |
| "Diskon Rp 0" selalu tampil | Dapat dikejar |
| Tombol hapus semua isi keranjang (ikon tempat sampah) | Butuh fitur yang belum ada: kosongkan keranjang sekaligus |
| Subjudul "Pesanan baru", "Rp X per item" | Dapat dikejar |
| Avatar + nama + chevron menu pengguna | Butuh fitur yang belum ada: menu pengguna (ganti kasir/keluar dari topbar) |
| Pil "Online" di toolbar | Dapat dikejar: galeri menyatakannya di indikator topbar |
| Katalog kosong dengan tombol "Tambah produk" | **Bertabrakan dengan spec**: katalog dikelola di back-office (B-06), bukan di kasir |
| Banner offline kuning **di dalam kolom katalog** | Dapat dikejar: galeri memasang pita di atas kedua kolom |

| Hanya di galeri | Tanda |
|---|---|
| Indikator sinkronisasi + "Coba lagi" di topbar, label outlet · perangkat | — (FR-H2) |
| Tab Sinkron dan Perangkat di bilah nav | — (K-14, K-15) |
| Aksi Diskon / Buka laci / Kas masuk-keluar di slot bilah nav | — |
| Kontrol urut A–Z / Termurah / Termahal, label "Cari produk" di atas field | — |
| "dari Rp …" dan "2 pilihan" untuk item bervarian | — |
| Stepper qty, pemberitahuan keranjang dipulihkan (KEP-21), baris "PPN 11%" bernama | — |

---

## K-08 Riwayat

| Aspek | Mockup | Galeri (1280×800) | Tanda |
|---|---|---|---|
| Chrome atas | 68 px | 108 px | Dapat dikejar |
| Judul halaman | "Riwayat transaksi" 20/600 + subjudul | Tidak ada; field cari langsung di bawah bilah nav | Dapat dikejar |
| Penyaring | Tanggal + Metode bayar (dropdown 197×44) | Cari nomor struk (951×44) + urut Terbaru/Terlama/Nilai tertinggi | Butuh fitur yang belum ada: saring tanggal dan metode di K-08 |
| Bentuk daftar | Tabel dalam kartu, 6 kolom: Waktu · Nomor · Item · Total · Metode · Status | Daftar baris tanpa kartu: nomor · jam · (lencana) · total · status kirim | Dapat dikejar (bentuk); kolom Item dan Metode butuh data baris yang belum dibaca K-08 |
| Tinggi baris | **61 px** (jarak antarbaris 60 px) | **48 px** (jarak antarbaris ≈ 55,5 px) | Dapat dikejar |
| Nomor transaksi | `TRX-140926-028` | `K1-20260901-0001` | **Bertabrakan dengan spec**: `CLAUDE.md` § Konvensi data, nomor struk = prefiks perangkat + tanggal + urutan |
| Status | "Selesai" (hijau) | Terkirim / Dibatalkan / Pembatalan | **Bertabrakan dengan spec**: order yang di-void tetap `open`; status diturunkan dari pembatal, dan status kirim adalah FR-H3. "Selesai" tunggal menyembunyikan keduanya |
| Paginasi | Tidak ada | "1–7 dari 7" | — |
| Permukaan halaman (piksel) | `#F0F6F7` 63,5% · putih 33,2% | `#F7F5F3` 74,2% · putih 17,7% | Tergantung keputusan palet |
| Tipografi | 15/400 · 13/600 · 20/600 · 13/400 | 15/500 · 12/500 · 12/400 · 15/400 | 13 px: **bertabrakan dengan spec** (DS #1); bobot: dapat dikejar |
| Teks utama / sekunder | `#16282C` / `#5E747A` | `#14110F` / `#5C5450` | Tergantung keputusan palet |
| `kosong` | Ikon + "Belum ada transaksi hari ini" di dalam kartu; penyaring tetap tampil | Kalimat di tengah tanpa kartu. ⚠ Galeri `kosong` juga **belum terdaftar**, jadi pasangan ini membandingkan dua sebab kosong yang berbeda | Dapat dikejar |

---

## K-12 Tutup kas

⛔ **Pasangan ini adalah yang paling jauh, dan sebagian besar jaraknya disengaja.**

| Aspek | Mockup | Galeri (1280×800) | Tanda |
|---|---|---|---|
| Urutan | Satu layar: rekonsiliasi + ringkasan + input, semuanya sekaligus | Tahap `hitung` dulu; angka baru terlihat sesudah Lanjut | — |
| "Saldo seharusnya Rp 1.775.000" sebelum menghitung | Tampil | Tidak tampil | **Bertabrakan dengan spec**: FR-D2 hitungan buta, dijaga `k12-hitungan-buta.test.js` |
| Ringkasan shift (total penjualan, per metode, produk terlaris) sebelum menghitung | Tampil | Hanya jumlah transaksi dan nominal non-tunai | **Bertabrakan dengan spec**: "Penjualan tunai" dan "Total penjualan" membocorkan angka yang sama |
| Zona | Dua kartu berdampingan, 623 + 509 px × 465 px, + bilah aksi bawah | Satu kolom terpusat | Dapat dikejar: tata letak dua kartu cocok untuk tahap `review` |
| Field hitungan | 573 × **44** px, tanpa awalan | 531 × **56** px, awalan `Rp`, rata kanan | — (galeri sudah memenuhi DS #3) |
| Pintasan pecahan | Tidak ada | 5 tombol 177 × 56 + Hapus | — |
| Aksi utama | "Tutup Shift" **139 × 44** di bilah bawah (y=740) | "Lanjut" 109 × 56 di badan (y=649) | Tinggi 44: **bertabrakan dengan spec** (DS #3, aksi uang 56 px); letak bilah bawah: dapat dikejar |
| Tipografi | 15/400 · 15/700 · 13/400 · 20/600 | 12/400 · 20/500 · 15/500 · 15/400 | Bobot 700: tergantung keputusan palet (Inter repo dimuat 400/500/600); 13 px: bertabrakan dengan spec |
| Permukaan (piksel) | putih 56,3% · `#F0F6F7` 30,2% | putih 96,9% | Tergantung keputusan palet (latar halaman bertinta) |
| Kartu berlangkah, rincian penuh, panel selisih | Tidak ada di mockup ini | Tidak ada di galeri `main`; **ada di PR #56** (belum di-merge) | — |

---

## Ringkasan per tanda

| Tanda | Baris tabel yang membawanya | Contoh terbesar |
|---|---:|---|
| Dapat dikejar | 25 | Bayar yang berpindah 358 px mengikuti isi keranjang (K-03); chrome atas 136 px vs 108 px; judul panel 20 px; bilah aksi bawah K-12 |
| Bertabrakan dengan spec | 14 | Hitungan buta K-12; toolbar delapan tombol; ukuran 13 px; chip 36 px; nomor `TRX-…` |
| Tergantung keputusan palet | 9 | Aksen; permukaan halaman bertinta; Nunito Sans; bobot 700 |
| Butuh fitur yang belum ada | 3 | Saring tanggal/metode di K-08; menu pengguna; kosongkan keranjang sekaligus |

Angka dihitung dari teks tabel di atas, tanpa membedakan huruf besar: satu baris dapat membawa dua tanda
(mis. bobot "dapat dikejar" dan 13 px "bertabrakan") dan dihitung di
keduanya. Baris "—" tidak dihitung.


---

## Fase 2 — pasangan baru (25 September 2026)

Dibangkitkan `alat/banding2.mjs`: mockup dan repo pada viewport yang sama,
1280×800. Chrome galeri disembunyikan dan panggung ditaruh di (0,0), karena
overlay kasir `position: fixed` mengikuti viewport. Galeri dari branch Fase 2
(palet LAMA; Fase 1 #60 belum di-merge). Gambar di `banding/`.

⛔ **Tiga fixture galeri diperbaiki untuk membuat pasangan ini jujur**, dan
ketiganya cacat nyata di fixture, bukan di aplikasi:
- `outlet.rounding_increment` **0**, nilai yang `simpanPenjualan` tolak. K-07 tidak pernah dapat dicapai.
- `outlet.rounding_mode` **`'nearest'`**, di luar kosakata `half_up`/`up`/`down`.

Ukuran kartu mockup diukur dari DOM (`getBoundingClientRect`); ukuran dialog repo dari `.kasir-dialog` / `.overlay .dialog`.
- Order tanpa `subtotal` dan tanpa `order_line`, dan fake DB mengabaikan `WHERE order_id = ?`. K-09 menampilkan "Subtotal Rp 0" dan pembayaran milik order LAIN.

### K-01 Login

[gambar](banding/K-01-normal__login--tunggal.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Komposisi | Kartu 510×522 di tengah latar bertinta, ikon gembok + "Masuk ke kasir" + nama perangkat | Tanpa kartu; judul 32/600 di atas papan angka | Dapat dikejar |
| Salam "Halo, Rini Astuti" | Nama kasir tampil sebelum PIN | PIN saja; kasir diidentifikasi dari PIN | Butuh fitur yang belum ada: pemilihan pengguna sebelum PIN |
| Penanda digit | **4** titik | **6** titik | **Bertabrakan dengan spec**: `spec-f:122`, "Panjang tepat 6 digit. Bukan 4" |
| Tombol angka | 78×44 px | 110×56 px | — (repo di atas target sentuh; tidak dikecilkan) |
| Tipografi | 20/600 · 13/400 · 15/400 | 15/500 · 15/400 · 12/400 · 20/500 · 32/600 | 13 px: bertabrakan (DS #1); bobot: dapat dikejar |
| Permukaan (piksel) | `#F0F6F7` 64% · putih 25% | putih 98% | Tergantung keputusan palet (latar bertinta) |

### K-02 Buka shift

[gambar](banding/K-02-normal__shift--tunggal.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Komposisi | Kartu 624×384 dengan ikon dan subjudul, dua kolom field | Kolom tunggal terpusat tanpa kartu | Dapat dikejar |
| Saldo awal | Field teks bebas `500.000` | Tampilan angka besar + 4 tombol pecahan, tanpa field bebas | Dapat dikejar: field `Rp` bebas sudah ada di K-12 (`Bidang` `awalan`) |
| "Cash drawer: Laci Utama" | Pilihan laci | Tidak ada; satu laci per perangkat | Butuh fitur yang belum ada: banyak laci per perangkat |
| "Staf pembuka", "Waktu buka" | Field yang tampil (terisi) | Tidak tampil; diambil dari sesi dan jam | Dapat dikejar (tampil sebagai teks, bukan field yang dapat diubah) |
| Aksi utama | "Mulai Shift" 149×56 kanan bawah kartu | 151×56 terpusat | Dapat dikejar |
| "Kembali" | Ada | Tidak ada — K-02 muncul saat shift belum ada; tidak ada tujuan kembali | — |

### Edit item (K-04/K-05) — ⚠ padanan terdekat, fungsi berbeda

[gambar](banding/K-03-normal-modifier__edit-item--tunggal.png)

Mockup menyunting BARIS keranjang yang sudah ada. Repo tidak punya dialog itu; yang ada adalah dialog modifier (448×267) yang MEMILIH opsi sebelum item masuk keranjang.

| Elemen mockup | Tanda |
|---|---|
| Jumlah dengan stepper −/+ | — sudah ada di baris keranjang repo (`.stepper`) |
| "Harga sementara" (mengubah harga saat menjual) | **Bertabrakan dengan spec**: harga diresolusi dari `price_history` pada `occurred_at` (FR-A7, FR-H6); tidak ada jalur harga manual per penjualan |
| "Diskon item" | Butuh fitur yang belum ada: diskon PER BARIS (`CLAUDE.md` § diskon: "Diskon PER BARIS tidak dibangun") |
| "Catatan" per item | Butuh fitur yang belum ada: catatan baris (`order_line` tidak punya kolomnya) |
| "Hapus item" merah | — sudah ada: qty turun ke 0 menghapus baris (penolakan #6 berlaku terbalik: repo sengaja tanpa tombol hapus terpisah) |

### K-06 Pembayaran — tunai dan kartu

[tunai](banding/K-03-keranjang-penuh-bayar__bayar--tunai.png) · [kartu](banding/K-03-keranjang-penuh-kartu__bayar--kartu.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Wadah | Halaman penuh dengan "Kembali ke kasir"; kartu 728×640 | Overlay dialog 896×768 di atas K-03 | Dapat dikejar (lebar dan tata letak kartu); overlay dipertahankan |
| Total | "TOTAL BELANJA Rp 50.600" di **atas**, 32/700 | Total di blok bawah, 20/500 | Dapat dikejar: P9 menuntut Total tampil, bukan letaknya |
| Pemilih metode | Segmented 4 tab, satu baris | 2×2 tombol 56 px | Dapat dikejar (bentuk); tab ke-4 Transfer: **ditolak #3** |
| Uang diterima | Field teks + 3 pintasan 44 px | Angka besar + 6 pintasan 56 px, tanpa field bebas | Field bebas: dapat dikejar (pola K-12); pintasan 44 px: **ditolak #10** |
| Panel "Kembalian Rp 0" tampil langsung di K-06 | Ya | Tidak — kembalian hanya di K-07 | **Bertabrakan dengan spec**: penjaga P3 `k06-penjaga`, dan FR-C9 (pembulatan hanya di `simpanPenjualan`, kembalian dari `amount_due` yang baru ada saat disimpan) |
| Aksi utama | "Konfirmasi bayar" 198×56 kanan bawah | "Simpan Penjualan" 848×56 selebar kartu | Dapat dikejar |
| Yang menggulir | Tidak ada | `.kasir-bayar-isi` 436 px tampak dari 620 px isi | — (P8 menuntut blok aksi tidak bergeser; penggulir itu yang menjaminnya) |

### K-06 Panel QRIS

[siap](banding/K-06-panel-pending__bayar--qris-siap.png) · [terkonfirmasi](banding/K-06-panel-confirmed__bayar--qris-terkonfirmasi.png) · [kedaluwarsa](banding/K-06-panel-kedaluwarsa__bayar--qris-kedaluwarsa.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| QR di dalam kartu pembayaran | Ya, dengan tab metode tetap terlihat | Panel mengganti layar penuh; tab metode dan keranjang TIDAK ada di DOM | **Ditolak #1**; invarian "QRIS mengganti layar penuh" (P1) |
| Gambar QR | Kotak modul | QR sebagai TEKS | **Ditolak #1** (`CLAUDE.md` § FR-C3) |
| "Berlaku selama 04:56" | Hitung mundur | Tidak ada | Butuh fitur yang belum ada: hitung mundur batas 5 menit |
| "Konfirmasi bayar" di keadaan siap | Ada | Tidak ada; "Cek status" + "Tutup layar" | **Ditolak #8** (`spec-c:320`) |
| Tipografi, komposisi | Kartu, 13/600 | Kolom terpusat, nominal 32/600 | Dapat dikejar (kartu), 13 px bertabrakan (DS #1) |

### K-07 Transaksi berhasil

[gambar](banding/K-03-keranjang-penuh-k07__sukses--tunggal.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Wadah | Kartu 536×466, ikon centang dalam lingkaran hijau lembut | Dialog 896×303, tanpa ikon | Dapat dikejar |
| Judul "Transaksi selesai" | Ada | Tidak ada; label "Kembalian" di atas angka | Dapat dikejar |
| Kembalian | Panel aksen-lembut, 32/700 berwarna aksen | 32/600 teks utama, tanpa panel | Dapat dikejar (panel dari token yang ada) |
| Nomor transaksi | `TRX-140926-028` | `K1-20260925-0001 · dibayar Rp 505.100` | **Ditolak #9** |
| Pembulatan | Tidak tampil | "Pembulatan +Rp 50" | — (invarian: pembulatan HANYA tampil di K-07) |
| Cetak struk | Tombol | Cetak berjalan sesudah simpan; tombol cetak ulang ada di K-09 | Dapat dikejar: tombol "Cetak ulang" di K-07 memakai jalur cetak ulang yang sudah ada |
| Kirim WhatsApp, Kirim Email | Ada | Tidak ada | Butuh fitur yang belum ada: pengiriman struk digital |
| "Transaksi Baru" | 229×**44** | 192×56 | 44 px: **ditolak #10** |

### K-09 Detail transaksi — ⚠ mockup tidak punya layar ini

[gambar](banding/K-09-normal__riwayat--ada.png) — dipasangkan dengan daftar riwayat mockup hanya untuk bahasa visual (kartu, tabel). Tidak ada selisih fungsi yang dapat diukur.

### K-10 Void dan refund

[gambar](banding/K-09-normal-refund__void--tunggal.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Wadah | Halaman: kartu form + kartu "Transaksi asli" berdampingan, masing-masing 502×347, bilah aksi bawah | Dialog 448×768 di atas K-09, isi menggulir (768 dari 895 px) | Dapat dikejar: dua kolom meniadakan gulir; detail order sudah ada di K-09 |
| "Jenis tindakan: Void transaksi" | Kasir memilih | Sistem memilih dari status order | **Bertabrakan dengan spec**: `spec-b` § Aturan pemilihan otomatis — "Kasir tidak memilih void atau refund" |
| Alasan | Teks bebas | Daftar tertutup | **Bertabrakan dengan spec**: alasan daftar tertutup (`CLAUDE.md` § void & refund; FR-G5 menyaring per kode) |
| Pemilihan baris yang kembali ke rak | Tidak ada | Ada, per baris dengan batas | — (FR-B7 refund parsial) |
| Aksi "Konfirmasi void" | Merah 162×**44** | 56 px | 44 px: **ditolak #10** |
| Nomor `TRX-…` di kartu transaksi | Ada | Nomor struk repo | **Ditolak #9** |

### Laci kas — kas masuk/keluar dan buka laci

[kas masuk/keluar](banding/K-03-normal-kasManual__laci--tunggal.png) · [buka laci](banding/K-03-normal-noSale__laci--tunggal--nosale.png)

| Aspek | Mockup | Repo | Tanda |
|---|---|---|---|
| Wadah | Layar tersendiri di bilah nav ("Laci kas"): kartu form 430×428 + kartu riwayat 526×428 | Dua dialog dari slot aksi K-03 (448×768 menggulir, 448×572) | Dapat dikejar: form dan riwayat berdampingan; tab nav baru tidak (bilah nav tetap sama tinggi, dan slot aksi sudah membawanya) |
| Arah | Toggle "Kas masuk / Kas keluar" 186×44 | Radio arah | Dapat dikejar (toggle); 44 px: ditolak #10 |
| Keterangan | Teks bebas | Alasan daftar tertutup | **Bertabrakan dengan spec**: `counterpart_type` diturunkan dari alasan (FR-D6) |
| "Riwayat shift berjalan" | Daftar movement dengan waktu dan nominal | Tidak ada di kasir | Butuh fitur yang belum ada: daftar `cash_movement` shift di perangkat |
| Buka laci tanpa transaksi (no-sale) | Tidak ada | Dialog K-16 dengan alasan dan penghitung ambang | — (FR-D7) |
| "Simpan catatan" | 380×**44** | 56 px | 44 px: **ditolak #10** |

### Struk

Tidak ada layar struk di repo. `apps/kasir/src/cetak/dokumen.ts` menghasilkan
dokumen untuk printer 58/80 mm. Mockup `struk` (58mm, 80mm) adalah pratinjau
di layar: **butuh fitur yang belum ada — pratinjau struk**. Mockup memakai kata
"Pajak" di struk: **ditolak #2**.
