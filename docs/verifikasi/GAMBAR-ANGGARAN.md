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


---

## 5. ⛔ Round-trip `bytea` → PowerSync → BLOB: **TIDAK DAPAT DIUKUR** di sesi ini

Diminta user 2 September 2026 sebagai syarat sebelum UI apa pun, dengan alasan
yang tepat: kalau byte-nya rusak di perangkat, yang muncul adalah kartu tanpa
gambar — **tidak dapat dibedakan dari item yang memang belum punya gambar**.
Kekosongan yang menyamar, lagi.

### Yang berubah, dan yang tetap menghalangi

Docker **ADA** di sesi ini (29.3.1) dan daemonnya berhasil dinyalakan — itu
berubah dari catatan lama. Yang menghalangi sekarang satu lapis lebih dalam:
**lapisan image tidak dapat ditarik.** `production.cloudfront.docker.com`
menjawab `403 Forbidden` lewat proxy egress, juga sesudah daemon dikonfigurasi
memakai proxy itu.

Jadi `postgres:18` dan `journeyapps/powersync-service` tidak dapat dijalankan,
dan langkah 2 (bawa lewat PowerSync sungguhan) mustahil di sini.

### Yang DAPAT diukur, dan hasilnya penting

Separuh risiko yang hilir dari transport dapat diputuskan tanpa PowerSync:
**apa yang SQLite lakukan saat nilai teks mendarat di kolom `BLOB`.**

Muatan uji memuat persis byte yang user minta — `0x00`, `0xFF`, dan urutan
yang BUKAN UTF-8 valid (`0xED 0xA0 0x80`, surrogate; `0xC3 0x28`, lanjutan
cacat):

| Jalur | `typeof()` | `length()` | Hasil |
|---|---|---:|---|
| bind `Uint8Array` — jalur benar | `blob` | 15 | **IDENTIK** |
| bind string UTF-8 — jalur salah | `text` | **4** | **BERBEDA** |
| bind heks Postgres apa adanya | `text` | 33 | **BERBEDA** |
| heks di-decode di `put` | `blob` | 15 | **IDENTIK** |
| base64 di-decode di `put` | `blob` | 15 | **IDENTIK** |

⛔ **Baris kedua adalah cacatnya, dan ia lebih buruk dari dugaan:** 15 byte
menjadi **4**, tersimpan sebagai `text` di kolom `BLOB` (affinity SQLite
mengizinkannya), **tanpa satu pun error**. Bentuk yang sama persis dengan
`tax_rate.rate` yang mendarat `real` di kolom `INTEGER`.

Dan pemeriksaan naif tidak menangkapnya: `length()` mengembalikan 4, jadi
"ada isinya" bernilai benar. Yang membedakannya hanya perbandingan terhadap
panjang ASLI — angka yang perangkat tidak punya.

### Yang masih tidak diketahui

**Representasi mana yang PowerSync benar-benar kirim untuk `bytea`.** Itu
menentukan apakah `put` harus men-decode heks, men-decode base64, atau tidak
melakukan apa pun. Ketiganya menghasilkan hasil yang berbeda, dan dua di
antaranya rusak diam-diam.

Tanpa jawaban itu, fitur gambar akan dibangun di atas tebakan.


---

## 6. Anggaran SESUDAH `bytea` dicabut (2 September 2026)

User menarik `bytea`; penyimpanannya kini **TEKS base64**. Angka anggaran
berubah, dan angka barunya inilah yang berlaku.

| | Sebelum (`bytea`) | Sesudah (base64) |
|---|---:|---:|
| Batas per gambar, mentah | 32 KB | **30 KB** |
| Yang MELINTAS jaringan | 32 KB | **40 KB** |
| 500 item | 15,6 MB | **19,5 MB** |
| Ambang user | ~20 MB | ~20 MB |

⛔ **Yang dianggarkan sekarang adalah panjang BASE64, bukan byte mentah.**
Memakai byte mentah melaporkan anggaran 25% lebih kecil daripada yang merchant
benar-benar unduh — dan angka yang terlalu kecil adalah yang membuat seseorang
menyetujui fitur yang tidak akan ia setujui. `anggaranByte()` memakai
`BATAS_BASE64`, dan testnya mengunci `19,5 MB`.

Batas mentah turun hanya 2 KB karena itu memang ongkos base64 (+33%), bukan
ongkos keamanan. Ia masih ~45% di atas sampel foto-mirip tertinggi yang terukur
(20,7 KB), jadi foto sah tetap tidak tertolak.

⛔ **Setiap 1 KB tambahan pada batas kini ~0,65 MB per perangkat** pada 500
item — lebih mahal daripada sebelumnya, karena yang melintas base64-nya.

### Round-trip: DIUKUR, dan sekarang murah

`tests/kasir/gambar-round-trip.test.js`. Muatan uji memuat `0x00`, `0xFF`, dan
tiga bentuk urutan bukan-UTF-8; hasilnya **identik byte per byte**, panjang
sama, dan keenam bentuk kerusakan yang disengaja **terdeteksi**.

⛔ **Itulah keuntungan sebenarnya dari pencabutan `bytea`** — bukan "lebih
aman", melainkan **dapat diuji tanpa menjalankan seluruh stack**. Versi `bytea`
menuntut PowerSync sungguhan; versi base64 menuntut SQLite, yang sudah ada di
setiap test run.

---

## 7. Jalur unggah DIJALANKAN, 3 September 2026 — bukan hanya diuji

Ditembak lewat browser sungguhan (Chromium, back-office di `localhost:1422`,
server Fastify + PostgreSQL sungguhan). Bukan fake, bukan `app.inject`.

| | |
|---|---:|
| Berkas sumber | PNG 1200×900, **1.434.180 byte** |
| Hasil kanvas klien | WebP 400×400, **13.954 byte** |
| Kualitas yang dipakai | **85%** — anak tangga PERTAMA |
| Panjang base64 tersimpan | 18.608 |
| Batas | 30.720 byte / 40.960 base64 |

⛔ **Anak tangga pertama sudah muat, dan itu memberi tahu sesuatu:** tangga
`KUALITAS_TURUN_PERSEN` ada untuk foto yang sulit dikompresi, dan foto yang
sulit tidak dihasilkan gradien sintetis. Yang dibuktikan pengukuran ini adalah
jalurnya bekerja end-to-end; ia **tidak** membuktikan tangganya pernah turun
lebih dari satu langkah pada foto sungguhan. Itu diuji lewat encoder yang
di-inject (`tests/backoffice/gambar-kompres.test.js`), bukan di sini.

Tujuh item diberi gambar dan sisanya tidak — katalog campuran, keadaan yang
paling sering nyata. `byte` dan `checksum` di ketujuh barisnya identik karena
sumbernya berkas yang sama; itu justru yang membuktikan keduanya dihitung dari
ISI, bukan dari waktu atau id barisnya.

### ⛔ `aspect-ratio` kartu: 16:9, dan angkanya diukur

Diukur di galeri (build statis, viewport 1280×800, katalog yang sama, menghitung
kartu yang tepi bawahnya masih di dalam panel yang menggulir):

| Rasio gambar di kartu | Kartu terlihat tanpa scroll | Tinggi kartu bergambar |
|---|---:|---:|
| tanpa gambar | 15 | 81px |
| 1:1 | 8 ⛔ | 231px |
| 4:3 | 8 ⛔ | 199px |
| 3:2 | 8 ⛔ | 189px |
| **16:9** | **12** ✓ | 176px |

`IA:62` menuntut ≥12 kartu tanpa scroll. Tiga rasio pertama melanggarnya, dan
selisih di antara ketiganya belasan piksel — tidak cukup memindahkan satu baris.

⛔ **Cacat yang ditemukan pengukuran, bukan pembacaan:** atribut `height="400"`
pada `<img>` adalah presentational hint yang menyetel `height: 400px`, dan
`aspect-ratio` hanya berlaku bila salah satu dimensi `auto`. Tanpa `height:
auto` di CSS, gambar dirender **125×400** di kartu selebar 151px — tinggi kartu
486px, dan hanya **4** kartu muat. Nol error, nol peringatan konsol, dan
CSS-nya terbaca benar.

Penjaganya kini di `tools/tangkap-galeri.mjs`: setiap penangkapan K-03 keadaan
`gambar` MENGHITUNG kartu yang terlihat dan gagal di bawah 12. Tangkapan layar
membuktikan tampilannya; ia tidak membuktikan angkanya — dan kartu yang terlalu
besar tetap terlihat rapi di foto.
