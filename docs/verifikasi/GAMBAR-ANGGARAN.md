# Gambar produk — anggaran byte per perangkat

Diukur 2 September 2026, **sebelum satu baris kode fitur ditulis** (syarat
user). Pertanyaannya: pada 500 item, berapa MB yang setiap perangkat unduh
lewat PowerSync?

---

## 1. Cara mengukurnya

Canvas Chromium — **encoder yang sama persis** dengan yang klien back-office
akan pakai, karena keputusannya kompresi di klien. Bukan pustaka lain, bukan
angka dari dokumentasi.

`toBlob(c, 'image/webp', q)` pada kanvas 400×400, konten sintetis di beberapa
tingkat kerumitan.

⛔ **Konten sintetis TIDAK dapat menggantikan foto sungguhan**, dan hasil di
bawah membuktikan kenapa itu penting: rentangnya **50×** antara yang paling
mudah dan yang paling sulit dikompresi. Angka "tipikal" karena itu tidak
mengikat apa pun — yang mengikat adalah **batas yang ditegakkan**.

---

## 2. Hasil, 400×400 WebP

| Konten | q=0.8 | 500 item |
|---|---:|---:|
| Datar — bidang warna + satu bentuk | 1,9 KB | **0,9 MB** |
| Gradien + bentuk bertumpuk | 4,0 KB | **1,9 MB** |
| Foto-mirip (1/f, detail rendah) | 10,8 KB | **5,3 MB** |
| Foto-mirip (1/f, detail sedang) | 17,9 KB | **8,7 MB** |
| Foto-mirip (1/f, detail tinggi) | 20,7 KB | **10,1 MB** |
| Derau putih | 108,0 KB | 52,7 MB |

**Derau putih dilaporkan sebagai batas atas teoretis, bukan sebagai kasus.**
Spektrumnya rata; tidak ada kamera yang menghasilkannya. Ia ada di tabel supaya
jelas bahwa 50× rentang itu nyata dan bahwa konten yang menentukan, bukan
resolusinya.

Baris "foto-mirip" memakai derau **1/f** — model baku untuk statistik citra
alami, dan satu-satunya dari ketiga jenis yang mendekati foto produk kafe.

---

## 3. ⛔ Putusan: anggaran ditentukan BATAS, bukan rata-rata

Merancang anggaran dari ukuran tipikal berarti anggarannya berubah setiap kali
seorang merchant mengunggah foto yang lebih rumit dari dugaan kita. Yang
dipakai adalah kebalikannya:

> **Batas keras 32 KB per gambar, ditegakkan saat unggah.**
> Anggaran per perangkat = 32 KB × jumlah item, **deterministik**.

**Pada 500 item: 15,6 MB.** Di bawah ambang ~20 MB yang user tetapkan, dengan
sisa ruang ~22%.

⛔ **32 KB bukan angka yang dikarang.** Ia ~55% di atas sampel foto-mirip
tertinggi yang terukur (20,7 KB), jadi foto sah tidak akan tertolak — dan
klien menurunkan kualitas secara bertahap sampai muat, jadi batas ini adalah
**target kompresi**, bukan pintu penolakan. Server menegakkannya sebagai batas
keras; yang ditolak hanya klien yang mengirim melebihi batas, dan itu berarti
klien yang tidak menjalankan kompresinya.

### Yang membuat angka ini tetap benar

| Sumbu | Keputusan |
|---|---|
| Resolusi | 400×400, satu ukuran. Ukuran kedua menggandakan anggaran untuk kenyamanan yang tidak seorang pun minta |
| Kualitas | menurun bertahap di klien sampai ≤32 KB — bukan q tetap |
| Format | WebP saja. JPEG pada ukuran yang sama ~30% lebih besar |
| Item tanpa gambar | tidak menghasilkan baris `item_image` sama sekali; merchant baru mengunduh **nol** byte |

---

## 4. Audit migrasi tertunda (syarat kedua)

**Tidak ada perubahan raw table lain yang tertunda maupun pasti dibutuhkan.**
Diperiksa, bukan diasumsikan:

- 25 raw table terdaftar; migrasi terakhir `0035`.
- `KOLOM_BELUM_DIUKUR` (21 kolom) adalah divergensi TIPE pada kolom yang
  **sudah turun** — bukan penambahan yang menunggu.
- `KOLOM_SENGAJA_TIDAK_TURUN` (40 kolom) adalah penghilangan yang disengaja
  dan bernalar (`cost`, `card_last4`, `tax_jurisdiction`, kolom tenancy).
- Tidak ada kolom yang dibaca layar kasir tetapi belum turun.

⛔ **Konsekuensinya: `item_image` adalah SATU-SATUNYA perubahan sidik jari
skema yang perlu dilakukan.** Merchant membayar ongkos `disconnectAndClear()`
sekali, bukan dua kali — yang persis syaratmu.

Riwayat penjualan lokal yang hilang karena rebuild **kembali sendiri**: stream
`riwayat` sudah ada sejak 29 Agustus 2026, jadi pelajaran migrasi `0035` tidak
terulang dalam bentuk yang sama.

---

## Reproduksi

Skrip pengukurnya ada di riwayat sesi, bukan di repo: ia menuntut Chromium dan
tidak dipakai CI. Yang masuk repo adalah **batasnya** (`packages/domain`), dan
batas itulah yang diuji.
