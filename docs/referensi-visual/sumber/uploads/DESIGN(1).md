# LumiPOS Design System

Sumber nilai: repo `zethasaintlab/DesignSystemForLumiPOS`, branch `main`, commit `b18a26b`.
Semua token di bawah diambil langsung dari `src/index.css`, bukan diperkirakan dari gambar.

---

## 1. Konteks Produk

LumiPOS adalah platform Point of Sale untuk usaha kecil bidang makanan, minuman, dan ritel di Indonesia. Bahasa antarmuka Bahasa Indonesia sepenuhnya.

Tiga aplikasi, tiga postur pengguna yang berbeda:

- **Kasir.** Staf yang berdiri di depan pelanggan yang sedang menunggu. Butuh kecepatan di atas segalanya. Memakai tiga layar yang sama ratusan kali sehari. Kelancaran lebih penting daripada kemudahan ditemukan.
- **Back-office.** Pemilik usaha dengan laptop, memeriksa angka, mengelola katalog dan staf. Butuh kejelasan dan keyakinan, bukan kecepatan.
- **Lumi-Order.** Pelanggan yang memindai QR di meja dengan ponselnya sendiri. Belum pernah melihat antarmuka ini dan tidak akan melihatnya lagi. Butuh kejelasan yang langsung terbaca.

Ketiganya berbagi design system yang sama, tapi tidak berbagi navigasi. Kasir tidak punya menu ke back-office, dan sebaliknya.

## 2. Nada Bahasa

- Langsung dan fungsional. Antarmuka menyatakan apa sesuatu itu, bukan bagaimana perasaannya tentang itu.
- Pesan galat menyebut apa yang terjadi lalu apa yang harus dilakukan, dalam urutan itu.
- Tanpa tanda seru kecuali pada keberhasilan transaksi yang nyata.
- Tanpa microcopy yang dibuat lucu. Kasir yang membaca string yang sama 300 kali sehari tidak ingin ada lelucon di dalamnya.
- Istilah transaksional dan biasa: "Transaksi Penjualan", "Tambah Biaya", "Tutup Kas". Tidak pernah dipuisikan, tidak pernah membuat kosakata merek untuk fungsi biasa.
- Angka diformat gaya Indonesia: `Rp 45.000`, titik sebagai pemisah ribuan.

## 3. Tipografi

**Font: Nunito Sans**, dimuat dari Google Fonts dengan empat bobot: 400, 600, 700, 800.

```
@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap');
font-family: 'Nunito Sans', sans-serif;
```

**Tepat empat ukuran. Tidak ada yang kelima.**

| Token | Nilai | Bobot | Dipakai untuk |
|---|---|---|---|
| `--text-display` | 32px | 700 | Total belanja, kembalian, angka yang dibaca sekilas |
| `--text-title` | 20px | 600 | Judul layar, judul kartu |
| `--text-body` | 15px | 400 (600 untuk label tombol) | Teks normal, isi tabel |
| `--text-small` | 13px | 400 (600 untuk header tabel) | Label sekunder, keterangan, timestamp |

Kalau sebuah layar terasa butuh ukuran kelima, hierarkinya yang salah, bukan skalanya. Perbaiki dengan bobot atau warna.

Teks badan biasa tidak pernah memakai bobot 800.

**Pengecualian monospace:** hanya di preview struk termal, karena mensimulasikan cetakan printer asli. Tidak ada monospace di tempat lain.

## 4. Warna

Semua warna dirujuk lewat CSS variable. Tidak ada satu pun nilai hex yang ditulis langsung di komponen. Ini aturan yang sudah ditegakkan di kode: `src/App.tsx` berisi nol hex hardcoded.

### 4.1 Token inti

| Token | Terang | Gelap |
|---|---|---|
| `--background` | `#f0f6f7` | `#102224` |
| `--foreground` | `#16282c` | `#eaf3f3` |
| `--card` | `#ffffff` | `#183033` |
| `--card-foreground` | `#16282c` | `#eaf3f3` |
| `--primary` | `#14706b` | `#57aaa4` |
| `--primary-foreground` | `#ffffff` | `#102224` |
| `--secondary` | `#f7fafb` | `#234246` |
| `--secondary-foreground` | `#16282c` | `#eaf3f3` |
| `--muted` | `#f7fafb` | `#193438` |
| `--muted-foreground` | `#5e747a` | `#b2c7c9` |
| `--accent` | `#14706b` | `#57aaa4` |
| `--accent-foreground` | `#ffffff` | `#102224` |
| `--border` | `#e3ecee` | `#31575a` |
| `--ring` | `#14706b` | `#76c4be` |

Empat belas token ini yang berubah antara mode terang dan gelap. Sisanya di bawah hanya punya nilai terang.

### 4.2 Turunan aksen

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--accent-hover` | `#0f5b57` | Hover pada elemen beraksen |
| `--accent-subtle` | `#d9edf0` | Latar badge ikon, chip terpilih |
| `--surface-raised` | `#f7fafb` | Baris berselang, panel dalam kartu |

### 4.3 Status

Warna status hanya menyampaikan keadaan nyata. Tidak pernah dekoratif.

| Keadaan | Latar | Teks |
|---|---|---|
| Berhasil, Selesai, selisih kas lebih | `--status-success-bg` `#dff3e4` | `--status-success-text` `#2c6b3f` |
| Berjalan, Berikutnya, informasi | `--status-info-bg` `#d6eaf5` | `--status-info-text` `#1f5a7a` |
| Menunggu, belum mulai, netral | `--status-pending-bg` `#edf2f3` | `--status-pending-text` `#5e747a` |
| Stok menipis, perlu perhatian | `--status-warning-bg` `#fbf0d9` | `--status-warning-text` `#8a6520` |
| Galat, Batal, selisih kas kurang | `--status-danger-bg` `#f9e1e1` | `--status-danger-text` `#9a3535` |

### 4.4 Kontrol dan form

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--input-border` | `#c9dcdf` | Outline input |
| `--destructive` | `#b94747` | Tombol dan aksi merusak |
| `--destructive-hover` | `#a13d3d` | Hover pada aksi merusak |
| `--ghost-foreground` | `#28565a` | Teks tombol ghost |
| `--ghost-hover-bg` | `#e8f2f2` | Latar hover tombol ghost |
| `--secondary-hover` | `#eff6f6` | Hover tombol sekunder |
| `--chip-hover-bg` | `#e0eeee` | Hover chip kategori |
| `--option-border` | `#d9e6e7` | Batas pilihan |
| `--keypad-border` | `#d7e5e6` | Batas tombol keypad |
| `--pin-inactive-bg` | `#dce7e8` | Indikator PIN belum terisi |

### 4.5 Teks sekunder dan ikon

| Token | Nilai |
|---|---|
| `--muted-foreground-strong` | `#49666a` |
| `--muted-foreground-strong-alt` | `#47666a` |
| `--sidebar-label` | `#789194` |
| `--icon-muted` | `#9ab4b5` |
| `--icon-muted-alt` | `#91b3b4` |
| `--icon-muted-alt-2` | `#8eb1b1` |

### 4.6 Keadaan gambar dan dropzone

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--dashed-border` | `#a9c9c8` | Bingkai putus-putus keadaan gambar gagal |
| `--dashed-border-strong` | `#b8d0d1` | Varian bingkai putus-putus lebih tegas |
| `--dashed-bg` | `#f7fbfb` | Latar area putus-putus |
| `--dropzone-border` | `#b7d0d1` | Batas area unggah gambar |
| `--skeleton-bg` | `#e8f0f1` | Latar skeleton loader |

### 4.7 Mode offline

| Token | Nilai |
|---|---|
| `--offline-badge-bg` | `#fbf3d8` |
| `--offline-badge-text` | `#876615` |
| `--offline-banner-bg` | `#fff9e8` |
| `--offline-banner-border` | `#e9dca8` |
| `--offline-banner-text` | `#806215` |

### 4.8 Permukaan dan pembatas lain

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--card-outline` | `#e0eaeb` | Outline kartu |
| `--card-outline-hover` | `#9fc5c4` | Outline kartu saat hover |
| `--menu-hover-border` | `#a6c9c8` | Batas item menu saat hover |
| `--row-divider` | `#eef3f3` | Pemisah baris tabel |
| `--cart-divider` | `#c3dddc` | Pemisah di panel keranjang |
| `--panel-subtle-bg` | `#f8fbfb` | Latar panel halus |
| `--avatar-bg` | `#d9eceb` | Latar avatar |
| `--chart-baseline` | `#dce8e9` | Garis dasar grafik |
| `--progress-track` | `#e5eeee` | Track progress bar |
| `--step-inactive-bg` | `#e6eeef` | Latar langkah belum aktif |
| `--step-inactive-text` | `#7b9597` | Teks langkah belum aktif |
| `--guest-background` | `#fffdf9` | Latar aplikasi pelanggan, sedikit lebih hangat |
| `--guest-border` | `#e8eded` | Batas di aplikasi pelanggan |
| `--switcher-bg` | `#1e292b` | Latar bar Mockup Switcher |

## 5. Bentuk

`--radius: 12px` sebagai nilai dasar.

| Berlaku untuk | Nilai |
|---|---|
| Kartu, panel, modal | 12px |
| Tombol, input, select | 10px |
| Badge status, chip kategori | pill penuh |
| Kotak ikon kecil | 10px |

Satu sistem, dipakai konsisten. Jangan dicampur.

## 6. Spasi

Kelipatan empat: 4, 8, 12, 16, 24, 32.

## 7. Target Sentuh

Ini persyaratan fungsional, bukan preferensi estetika. Kasir menekan sambil terburu-buru di depan pelanggan yang menunggu.

| Nilai | Berlaku untuk |
|---|---|
| 44px | Setiap elemen yang bisa ditekan, minimum absolut |
| 56px | Aksi utama di layar kasir: kartu produk, tombol bayar, keypad angka, stepper qty |

## 8. Elevasi

Bayangan diberi rona biru kehijauan produk, bukan hitam murni. Kartu hanya diberi bayangan kalau elevasinya menyampaikan hierarki nyata, tidak pernah sebagai dekorasi default.

```
kartu     : 0 1px 2px rgba(22,40,44,0.04), 0 2px 8px rgba(22,40,44,0.04)
terangkat : 0 4px 16px rgba(22,40,44,0.08)
```

## 9. Komponen

### Tombol
Varian: primary (isi aksen), secondary (bergaris, tanpa isi), ghost (tanpa garis), destructive.
Setiap varian butuh: default, hover, active (turun 1px), disabled, loading.
Label maksimum tiga kata dan tidak pernah wrap ke baris kedua.

### Kartu Produk
Tiga keadaan berbeda, dan perbedaan antara dua yang terakhir itu menanggung beban nyata:

1. **Bergambar.** Foto, nama, harga.
2. **Belum difoto.** Hanya nama dan harga. **Tidak ada kotak abu-abu placeholder.** Ketiadaan wadah dekoratif itulah aturannya, bukan kelalaian. Ini ditegakkan oleh test di kode produksi yang menolak deklarasi CSS dekoratif pada keadaan ini.
3. **Gambar gagal dimuat.** Keadaan bernama: bingkai putus-putus, ikon, dan kata. Harus bisa dibedakan secara visual dari keadaan 2, karena "belum difoto" dan "fotonya rusak" menuntut tindakan yang berbeda dari pemilik usaha.

### Kartu Pembayaran
**Satu kartu tunggal dengan toggle**, bukan beberapa kartu dan bukan berpindah halaman. Mengganti metode mengubah isi kartu sementara kartunya tetap di tempat.

Metode: Tunai, QRIS, Kartu Debit/Kredit, Transfer Bank.

- **Tunai:** keypad angka, nominal preset yang sering dipakai (Rp 20.000, Rp 50.000, Rp 100.000), dan perhitungan kembalian otomatis yang tampil pada ukuran display dan berubah langsung saat angka diketik.
- **QRIS:** kode QR dirender di dalam kartu yang sama. Empat keadaan: memuat (skeleton, tidak pernah spinner bulat), siap dipindai dengan hitung mundur kedaluwarsa, terkonfirmasi, dan kedaluwarsa.
- **Kartu:** input nomor referensi, pilihan jenis kartu.
- **Transfer:** pilihan bank tujuan, input nomor referensi.

Total belanja tetap terlihat di bagian atas kartu apa pun metode yang dipilih.

### Input
Label di atas input. Teks bantuan opsional. Teks galat di bawah input. Placeholder tidak pernah menggantikan label.

### Badge Status
Bentuk pill, memakai warna status di bagian 4.3. Keadaan nyata saja.

### Navigasi Kasir
Satu baris, tinggi maksimum 72px, semua item muat tanpa wrap. Semua aksi terlihat sekaligus sebagai baris ikon, bukan terkubur di menu bertingkat. Ini mengikuti cara kerja aplikasi kasir mainstream Indonesia, supaya kasir yang datang dari aplikasi itu tidak perlu belajar ulang.

### Skeleton Loader
Bentuknya mengikuti tata letak final. Tidak pernah spinner bulat generik.

### Mockup Switcher
Bar gelap (`--switcher-bg` `#1e292b`) menempel di tepi atas, tinggi maksimum 44px, melayang di atas konten tanpa mendorong tata letak. Berisi tiga tombol segmented (Kasir, Back-office, Lumi-Order), dropdown "Keadaan" yang menyesuaikan layar aktif, toggle terang dan gelap, dan label "Mockup preview".

Bar ini **alat bantu mockup, bukan bagian dari produk**. Penampilannya sengaja dibuat berbeda dari UI produk supaya tidak pernah tertukar sebagai fitur. Tidak ada kontrol keadaan mockup yang boleh tertanam di dalam UI produk.

## 10. Pola Tata Letak

### Layar kasir utama
Tiga zona: navigasi, katalog (kolom pencarian, chip kategori yang bisa di-scroll, grid produk), dan panel keranjang dengan total berjalan serta tombol bayar.

**Grid produk wajib muat minimal 12 kartu tanpa scroll pada tablet landscape.** Ini persyaratan berangka dari dokumen produk, dan pernah rusak di produksi oleh aturan `aspect-ratio` yang diam-diam tidak pernah berlaku. Perlakukan sebagai angka yang diukur, bukan tampilan yang dikira-kira.

Diukur pada 1280x800: ruang tersedia 544px, tinggi grid 457px, tinggi kartu 143px sampai 147px, sisa 87px, tidak ada scroll.

### Back-office
Tata letak desktop. Jangan bungkus setiap metrik dalam kartu tersendiri kalau kartunya tidak menyampaikan hierarki apa pun. Biarkan angka bernapas di tata letak polos.

### Lumi-Order
Mobile portrait. Nadanya sedikit lebih hangat daripada aplikasi kasir karena dilihat pelanggan, memakai `--guest-background` `#fffdf9`, tapi token lainnya sama persis.

## 11. Aturan yang Tidak Bisa Ditawar

Beberapa di antaranya ditegakkan test di kode produksi. Desain yang melanggarnya akan bentrok dengan kode yang sudah ada.

1. Kartu produk tanpa gambar menampilkan **nol kotak abu-abu placeholder**.
2. Kartu produk dengan gambar gagal menampilkan **keadaan bernama**, bisa dibedakan dari belum difoto.
3. Grid katalog kasir muat **minimal 12 kartu** tanpa scroll pada tablet landscape.
4. Pembayaran adalah **satu kartu dengan toggle**. Mengganti metode tidak pernah berpindah halaman.
5. **Nol karakter em-dash** di seluruh teks yang terlihat pengguna. Pakai tanda hubung biasa atau titik.
6. Label di **atas** input. Teks galat di **bawah**. Placeholder bukan label.
7. Label tombol **maksimum tiga kata**, tidak pernah wrap.
8. Setiap komponen interaktif punya **semua keadaan**: default, hover, active, disabled, loading, galat.
9. **Tidak ada titik berwarna dekoratif** di depan item nav atau baris daftar. Titik berwarna hanya menandai keadaan nyata.
10. **Tidak ada label bernomor** seperti "01 / Katalog" atau "Langkah 1".
11. **Nol hex hardcoded di komponen.** Semua warna lewat CSS variable.
12. **Satu warna aksen di seluruh produk.** Tidak ada tombol biru di satu layar dan teal di layar lain.
13. Data contoh **realistis Indonesia**, bukan placeholder generik. Produk: Es Kopi Susu, Teh Tarik, Nasi Goreng Kampung, Roti Bakar Coklat, Air Mineral 600ml. Orang: Rini Astuti, Bagas Prasetyo, Siti Nurhaliza, Dewi Kurniawati. Harga Rp 8.000 sampai Rp 45.000, total belanja Rp 20.000 sampai Rp 300.000.
14. **Tidak ada navigasi silang antar aplikasi.** Kasir, back-office, dan Lumi-Order tidak saling menautkan.
