# Cara melaporkan temuan dari galeri

Saya **tidak bisa membuka** preview URL — proxy sandbox menolak `*.vercel.app`
di lapisan jaringan. Jadi untuk lapisan terakhir, matamu satu-satunya alat yang
ada. Dokumen ini supaya laporanmu langsung dapat saya kerjakan alih-alih
memicu tiga putaran tanya-jawab.

**URL:**
<https://lumi-pos-v2-git-perbaikan-ui-pasca-uji-manual-after-school-mpp.vercel.app/>

---

## 1. Apa yang BISA kamu lakukan di galeri

Diuji langsung, bukan diasumsikan:

| Bisa | Bukti |
|---|---|
| Ketuk produk 1 varian → masuk keranjang | keranjang berubah jadi `Cappuccino 1× Rp 28.000`, subtotal ikut |
| Ketuk produk ber-varian → dialog pilihan ukuran terbuka | "Kopi Susu Gula Aren · Regular Rp 24.000 · Large Rp 30.000" |
| Saring kategori · cari nama/barcode | grid menyusut |
| Buka dialog Diskon · Buka laci · Kas masuk/keluar | ketiganya membuka dialog |
| Escape menutup dialog | diperbaiki 1 September 2026 — sebelumnya mati di ketujuh dialog |
| Pindah layar & keadaan lewat URL | `?layar=K-08&keadaan=offline` |

**Tidak bisa, dan itu memang bukan tujuannya:**

- **Menyelesaikan penjualan.** Tombol Bayar membuka K-06, tapi tidak ada server
  dan tidak ada database — tidak ada yang tersimpan.
- **Login.** Galeri melewati K-01; sesi sudah dipalsukan.
- **Melihat data sungguhan.** Seluruh katalog, shift, dan riwayat karangan.

⛔ **Jangan laporkan bahwa datanya aneh atau angkanya tidak masuk akal** —
itu fixture, dan saya yang mengarangnya. Yang dinilai TAMPILAN dan PERILAKU
layar, bukan isinya.

⛔ **Jangan laporkan chrome galerinya** (baris tombol K-03/K-08/… dan
Kosong/Normal/… di atas). Itu alat bantu kita, tidak pernah dilihat merchant.

---

## 2. Lima jenis temuan, dan kenapa bedanya penting

Sebutkan jenisnya. Ia menentukan urutan kerja saya, bukan sekadar label.

| Jenis | Artinya | Contoh |
|---|---|---|
| **RUSAK** | layar kosong, galat, macet, tidak bisa keluar | tekan chip → halaman putih |
| **SALAH** | menampilkan sesuatu yang tidak benar atau menyesatkan | tertulis `qris_static`, bukan "QRIS (statis)" |
| **HILANG** | keadaan atau informasi yang seharusnya ada tapi tidak | tidak ada penjelasan saat daftar kosong |
| **KIKUK** | jalan, tapi menyusahkan | tombol Bayar terlalu jauh dari keranjang |
| **JELEK** | jalan dan benar, tapi tampilannya buruk | kartu terlalu renggang, hierarki lemah |

**RUSAK dan SALAH saya kerjakan lebih dulu, selalu.** SALAH sering lebih
berbahaya daripada RUSAK: yang rusak terlihat, yang salah dipercaya.

---

## 3. Yang paling berharga darimu — dan tidak bisa saya dapatkan sendiri

Empat hal ini tidak muncul di tangkapan layar mana pun:

1. **Rasa di perangkat sungguhan.** Target terlalu kecil untuk jempol? Tombol
   penting kejauhan? Perlu dua tangan?
2. **Keterbacaan dari jarak kerja.** Kasir menatap layar dari ~50 cm sambil
   melihat pelanggan. Angka harganya kebaca sekilas?
3. **Apakah ia terasa seperti PRODUK atau seperti prototipe.** Ini penilaian
   yang cuma bisa diberikan orang, dan kamu sudah memberikannya sekali —
   *"sangat flat, tidak hidup"* — dan itu menghasilkan tiga perbaikan nyata.
4. **Perbandingan dengan Kasir Pintar.** Kamu memakainya, saya tidak pernah.
   Sebut hal KONKRET yang ia lakukan dan kita tidak: "kategorinya jadi tab
   besar di atas", "harga jauh lebih tebal", "ada bayangan di bawah kartu".

⛔ Yang paling tidak berguna: **"masih kurang bagus"** tanpa lanjutan. Saya akan
menebak, dan tebakan saya akan meleset — sudah terjadi sekali di sesi ini.

---

## 4. Format laporan

Salin blok ini. Satu blok per temuan. Tidak perlu semua kolom terisi — yang
wajib cuma **URL**, **jenis**, dan **apa yang kamu lihat**.

```
### [JENIS] Judul satu baris

URL      : ?layar=K-03&keadaan=meluap
Perangkat: HP Android 6.1" / iPhone / laptop 14"
Terlihat : (apa yang muncul di layar)
Harusnya : (apa yang kamu harapkan, kalau punya harapan tertentu)
Menghalangi: ya / tidak — kasir masih bisa jualan?
```

### Contoh yang BAIK

```
### [SALAH] Nama metode tertulis kode mentah

URL      : ?layar=K-12&keadaan=normal
Perangkat: HP Android
Terlihat : baris rincian berbunyi "qris_static Rp 115.500"
Harusnya : "QRIS (statis)" — kasir tidak tahu apa itu qris_static
Menghalangi: tidak, tapi bikin ragu saat cocokkan setoran
```

```
### [JELEK] Grid terasa renggang, harga tenggelam

URL      : ?layar=K-03&keadaan=normal
Perangkat: laptop 14"
Terlihat : kartu tinggi-tinggi, nama dan harga ukurannya mirip, mata tidak
           tahu harus ke mana dulu
Harusnya : di Kasir Pintar harga jauh lebih tebal dari nama, kartunya lebih
           rapat, muat lebih banyak per layar
Menghalangi: tidak
```

### Contoh yang TIDAK berguna

```
K-03 masih jelek, kurang hidup.
```

Tidak ada URL, tidak ada perangkat, tidak ada bagian yang disebut. Saya akan
menebak bagian mana yang kamu maksud, dan menghabiskan satu putaran untuk
memperbaiki hal yang tidak kamu keluhkan.

---

## 5. Daftar periksa cepat — 10 menit, 8 tautan

Kalau tidak sempat menyapu semuanya, buka delapan ini. Dipilih karena
masing-masing menjawab satu pertanyaan berbeda.

| # | Tautan | Pertanyaan |
|---|---|---|
| 1 | `?layar=K-03&keadaan=normal` | Layar utama. Terasa seperti produk? |
| 2 | `?layar=K-03&keadaan=panjang` | 120 varian — masih bisa dipindai? |
| 3 | `?layar=K-03&keadaan=meluap` | Nama 60 karakter — rapi atau merusak? |
| 4 | `?layar=K-03&keadaan=error` | Pesan gagalnya menjelaskan AKIBAT? |
| 5 | `?layar=K-03&keadaan=kosong` | Katalog kosong — tahu harus apa? |
| 6 | `?layar=K-08&keadaan=offline` | Indikator antrean beda dari "Tersinkron"? |
| 7 | `?layar=K-12&keadaan=normal` | Layar uang. Angkanya kebaca? |
| 8 | `?layar=K-15&keadaan=normal` | Form panjang. Melelahkan? |

Sambil di K-03: **ketuk satu produk** (masuk keranjang), **ketuk produk
ber-varian** (dialog terbuka), lalu **tekan Escape** (harus menutup).

---

## 6. Kalau yang kamu temukan RUSAK

Tiga hal ini melipatgandakan kegunaan laporannya:

1. **Tangkapan layar.** Satu gambar mengalahkan tiga paragraf.
2. **URL persisnya** dari address bar, bukan diketik ulang.
3. **Apakah berulang** — muat ulang halaman, terjadi lagi? Yang terjadi
   sekali dan hilang punya sebab yang sangat berbeda dari yang selalu terjadi.

Kalau layarnya **kosong sama sekali**, sebut juga: apakah baris tombol di
atas masih ada? Kalau ikut hilang, seluruh aplikasi yang runtuh — bukan satu
layar. Itu cacat paling gawat dan saya kerjakan lebih dulu daripada apa pun.
