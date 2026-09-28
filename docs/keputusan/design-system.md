# Design system — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

### Pelonggaran DS #8 — gradien dan tekstur, 1 September 2026

Keputusan user setelah membuka galeri di HP: *"sangat flat, tidak hidup, dan sangat jauh dari kasirpintar"*. Yang dicabut dari aturan #8 **hanya gradien dan tekstur**.

**Yang TETAP berlaku, dan tidak dicabut oleh apa pun:**

- tanpa emoji · tanpa dark mode (baris "tanpa gambar" yang pernah ada di sini sudah basi sejak § Gambar produk di bawah mencabutnya, hari yang sama — diperbaiki di sini, bukan bagian dari keputusan kampanye Hidupkan desain)
- ⛔ **PALET tidak disentuh UNTUK MEMBUAT gradiennya** — pernyataan aslinya. Tidak ada satu pun nilai warna baru ditambahkan demi efek kedalaman: setiap gradien disusun dari token permukaan yang sudah ada (`--surface`, `--surface-sunk`, `--surface-alt`, `--accent-soft`). ⛔ **Nilai token-token itu sendiri BERUBAH mengikuti mockup sejak kampanye Hidupkan desain, 26 September 2026** (`docs/RENCANA-HIDUPKAN-DESAIN.md`, § Aturan design system #2 di atas) — yang tetap benar adalah "gradien tidak menambah warna baru", bukan "nilai palet tidak pernah berubah"
- aksen (`--primary`, nilai mockup) tetap satu-satunya warna AKSI, tetap < 5% area, tetap satu aksi utama per layar — digantikan dari `#0D5C63` yang dipaku sebelumnya (keputusan kampanye Hidupkan desain, 26 September 2026)

⛔ **Gradiennya sengaja nyaris tidak terlihat sebagai gradien.** Yang dicari adalah permukaan yang tidak rata sempurna — itu yang membuat mata membaca "benda" alih-alih "kotak putih". Gradien yang terlihat sebagai gradien akan bersaing dengan aksen, dan aksen adalah satu-satunya hal yang boleh menarik mata di layar kasir.

Seluruhnya di `packages/ds/lumi.css`; `ds-bundle/` tidak mengirim satu pun gradien dan tidak disentuh.

### Gambar produk — DS #8 dicabut lebih jauh, 1 September 2026

Keputusan user setelah meninjau galeri: *"Card harusnya bergambar"*. Larangan
"tanpa gambar" DICABUT. Yang tetap: tanpa emoji, tanpa dark mode. Palet:
nilai mockup sejak kampanye Hidupkan desain, 26 September 2026 (sebelumnya
"tidak disentuh" — lihat § Pelonggaran DS #8 di atas).

⛔ **Ini FITUR, bukan perubahan tampilan.** `item.image_url` sudah ada di skema
sejak F0 dan **tidak pernah dibaca, tidak pernah ditulis, tidak ada di sync
rules**; server tidak punya satu pun jalur unggah berkas. Seluruhnya dari nol.

**Penyimpanan: TEKS base64 di PostgreSQL, turun lewat PowerSync.**
Alternatif object storage ditolak karena dua hal: ia layanan berbayar baru, dan
gambar yang tidak ikut PowerSync menuntut mekanisme cache KEDUA supaya kartu
tidak jadi kotak kosong tepat saat internet mati — keadaan yang seluruh
arsitektur ini ada untuk mendukungnya.

### ⛔ `bytea` DICABUT 2 September 2026 — dan ia dicabut karena DIUKUR

Keputusan awal user (1 September) adalah `bytea` PostgreSQL. **User menariknya
sendiri 2 September**, setelah pengukuran, dan alasannya ditulis di sini supaya
orang berikutnya tahu ia ditolak karena diuji — bukan karena tidak terpikir.

Kalimat user, dan ia yang mengikat:

> Yang menentukan bukan base64 lebih aman, melainkan bahwa jalur salah
> menghasilkan **15 byte jadi 4 tanpa error**, dan satu-satunya pembeda rusak
> dari utuh adalah angka yang perangkat tidak punya. Base64 menghapus kelasnya.

Terukur (`docs/verifikasi/GAMBAR-ANGGARAN.md` § 5), muatan uji memuat `0x00`,
`0xFF`, dan tiga bentuk urutan bukan-UTF-8:

| Jalur | `typeof()` | `length()` | Hasil |
|---|---|---:|---|
| bind `Uint8Array` — benar | `blob` | 15 | IDENTIK |
| bind string UTF-8 — salah | `text` | **4** | **BERBEDA** |
| heks Postgres apa adanya | `text` | 33 | **BERBEDA** |

⛔ Yang membuatnya kelas "nol baris, bukan error": `length()` mengembalikan 4,
jadi pemeriksaan "ada isinya" bernilai BENAR, dan kartu tanpa gambar **tidak
dapat dibedakan** dari item yang memang belum difoto.

⛔ **Jangan mengembalikan `bytea` sebagai "optimasi ukuran".** Ongkos base64
(+33%) sudah dibayar di anggaran: batas turun 32 KB → **30 KB mentah / 40 KB
melintas**, dan **500 item = 19,5 MB** per perangkat — tetap di bawah ambang
~20 MB. Setiap 1 KB tambahan pada batas adalah ~0,65 MB per perangkat.

⛔ **`byte` + `checksum` menempel di baris yang sama**, diverifikasi perangkat
saat membaca. Base64 menghapus kerusakan BINER; ia tidak menghapus kerusakan
TRANSPORT. ~40 byte per baris untuk menukar kekosongan diam dengan keadaan
bernama: **"gambar gagal dimuat"**, yang WAJIB berbeda dari "belum punya
gambar".

⛔ **Kartu tanpa gambar BUKAN keadaan menunggu** (keputusan user). Layar kasir
harus dapat dipakai penuh selagi gambar menyusul — 19,5 MB di jaringan warung
butuh waktu, dan kasir tidak boleh menunggunya. Kartu tanpa gambar berfungsi
penuh dan tidak menampilkan penanda memuat apa pun.

- ⛔ **Tabel TERPISAH (`item_image`), bukan kolom di `item`.** Blob di `item`
  ikut terseret setiap query katalog, dan `bacaKatalog` berjalan pada setiap
  pembukaan K-03.
- ⛔ **Kompresi di KLIEN back-office, bukan di server.** Canvas API mengecilkan
  ke ~400×400 WebP sebelum unggah — nol dependensi native baru di server, dan
  CPU-nya di mesin yang tidak melayani penjualan. Server memvalidasi ukuran dan
  mime, tidak mengolah — dan **tidak pernah men-decode base64-nya**: panjang
  byte dihitung dari panjang teks (aritmetika). Makin sedikit titik tempat
  biner dan teks bertukar, makin sedikit tempat 15 byte dapat menjadi 4.
- ⛔ **Menambah raw table mengubah sidik jari skema lokal**, jadi setiap
  perangkat membangun ulang tabel rawnya (`disconnectAndClear()`). Pelajaran
  migrasi `0035` berlaku lagi — bedanya sekarang stream `riwayat` sudah ada
  sebagai jalan pulang, jadi riwayat lokal kembali sendiri.
- **Kartu tanpa gambar wajib punya bentuknya sendiri.** Merchant baru dan
  produk yang belum difoto adalah keadaan normal, bukan pengecualian.

**Unggah + render selesai 3 September 2026.** Rantainya: `GambarProduk.tsx`
(B-07, kanvas → tangga kualitas) → `PUT /items/{id}/image` → `item_image` →
PowerSync → `apps/kasir/src/katalog/gambar.ts` (verifikasi) → kartu K-03.

- ⛔ **TIGA keadaan kartu, dan yang pertama adalah KETIADAAN kunci di peta:**
  belum difoto (kartu NORMAL, nol penanda) · gagal verifikasi (keadaan bernama,
  terlihat berbeda) · utuh. Peta memakai `Map` tanpa entri untuk yang pertama —
  memetakannya ke `null` membuat "belum difoto" dan "rusak" dapat tertukar oleh
  satu pemanggil yang lupa membedakannya. `data-gambar` di kartu membawa ketiga
  nilainya, dan `tests/kasir/gambar-kartu.test.js` menolak setiap aturan CSS
  dekoratif untuk `tanpa` — placeholder abu-abu mengubah katalog merchant baru,
  yang seluruhnya belum difoto, menjadi grid yang terlihat rusak di hari
  pertama.
- ⛔ **`aspect-ratio: 3 / 1` di kartu, foto selebar kartu, meski yang disimpan
  1:1** (rebuild UI Fase 3.1, 25 September 2026, mengikuti mockup; sebelumnya
  16:9 berbingkai). Diukur, dan rasio yang lebih tinggi dari 16:9 gugur:
  `IA:62` menuntut ≥12 kartu tanpa scroll; 1:1 → 8, 4:3 → 8, 3:2 → 8, 16:9 → 12,
  3:1 → 12 pada 1024 dan 1280. Harganya: kartu menampilkan sepertiga tengah
  foto. Penjaganya `tests/kasir-dom/k03-kepadatan.test.js` (CI, kedua lebar)
  dan `tools/tangkap-galeri.mjs`. Angkanya di
  `docs/verifikasi/GAMBAR-ANGGARAN.md` § 7.
- ⛔ **`height: auto` WAJIB pada `<img>` kartu.** Atribut `height="400"` adalah
  presentational hint yang menyetel `height: 400px`, dan `aspect-ratio` hanya
  berlaku bila satu dimensi `auto`. Tanpanya gambar dirender 125×400 di kartu
  151px, tinggi kartu 486px, **4** kartu muat — nol error, nol peringatan
  konsol, CSS terbaca benar. Ditemukan lewat pengukuran DOM.
- ⛔ **Kontrak OpenAPI TIDAK menyalin batasnya sebagai `maxLength`.** Ia salinan
  ketiga yang tidak dijaga apa pun, DAN ia membuat AJV menolak lebih dulu dengan
  `VALIDATION_ERROR` — sehingga `TERLALU_BESAR` beserta sarannya tidak pernah
  tercapai. `bodyLimit` bawaan Fastify menahan muatan tak masuk akal; angkanya
  diputuskan satu tempat. Dijaga `tests/domain/gambar-produk.test.js`.
- ⛔ **`byte` dan `checksum` dihitung SERVER**, dan nilai dari klien diabaikan
  sepenuhnya. Checksum kiriman klien membuat verifikasi perangkat memeriksa
  klaim klien terhadap dirinya sendiri: muatan yang rusak DI KLIEN datang dengan
  checksum yang cocok dengan kerusakannya.
- **`BATAS_BYTE` terikat anggaran lewat test.** `BATAS_BASE64 × 500 > 20 MB`
  MERAH. Sisa anggaran **2,5%**, dan maksimum yang masih muat ~40,9 KB base64
  (~30,7 KB mentah) — kurang dari satu kilobyte di atas nilai sekarang.

### ⛔ Kontrol urutan input K-12: pencabutannya DIBATALKAN, 22 September 2026

Hitungan buta **tetap berlaku**. `spec-d` FR-D2 berbunyi — dan menyebut dirinya
sendiri sebagai kontrol:

> Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka
> terhitung. **Ini kontrol, bukan preferensi UX** — kasir yang melihat angka
> target akan menghitung mundur ke angka itu.

Aturan itu pernah **dicabut 1 September 2026** dan **dikembalikan 22 September
2026**, keduanya keputusan user. Riwayatnya ditulis di sini karena bentuk
kesalahannya berulang.

⛔ **Pencabutannya mendiagnosis sebab yang salah.** Alasannya K-12 dinilai
"flat dan sangat lifeless", dan yang dituduh adalah layar tahap pertama yang
sengaja tidak menampilkan angka. Tapi mockup `ds-bundle/ui_kits/pos/
TutupKasScreen.jsx` **tetap hitungan buta** — ia memuat kalimat "Angka
ekspektasi sistem sengaja disembunyikan sampai kolom ini terisi" — dan ia kaya
visual. Yang membuatnya kaya adalah empat hal yang tidak pernah dibangun di
K-12: kartu berlangkah, field numerik ber-prefiks, rincian penuh, dan panel
selisih berwarna. Pencabutan itu mempertaruhkan kontrol kas untuk menyelesaikan
masalah yang sebabnya di tempat lain.

⛔ **Pencabutannya tidak pernah sampai ke kode, dan itu ditemukan saat membaca
K-12 pada 21 September 2026.** Yang disunting hanya paragraf Deskripsi
`spec-d` FR-D2 dan bagian ini; **Behavior** dan **Acceptance criteria** di
bawahnya tidak berubah, `IA:62` tetap menulis "Urutan input wajib", `PRD:207`
tetap menggambar urutannya, mockup tetap hitungan buta, dan
`tests/kasir/tutup-kas.test.js` justru **menegakkan** aturan lama
(`total tunai tidak boleh terbaca sebelum menghitung`). Satu keputusan tertulis
di dua tempat, diimplementasikan di nol tempat, dengan sebuah test mengunci
kebalikannya.

Pembatalannya karena itu **nol perubahan kode**: yang dikembalikan hanya kedua
dokumen, ke keadaan yang kode dan testnya memang sudah punya.

⛔ **Pelajaran yang mengikat pencabutan berikutnya:** sebelum sebuah kontrol
dicabut karena layarnya terasa kosong, periksa dulu apakah yang kosong adalah
kontrolnya atau hal-hal di sekelilingnya yang belum dibangun. Dan pencabutan
yang tidak menyentuh kode, test, IA, PRD, dan mockup bukan pencabutan — ia
dokumen yang menyimpang dari produknya, dan yang menyimpang berhenti dapat
dipakai memutuskan apa pun.

### ⛔ Datar BUKAN karena design system-nya austere — `apps/kasir` tidak memakainya

Diukur 1 September 2026, dan ini sebab utamanya:

| Komponen yang `/ds-bundle` kirim | Dipakai kasir sebelumnya |
|---|---|
| `.product-card` — hover & tekan jadi teal, focus ring, `data-out` untuk habis | **0×**, diganti `.kasir-kartu` buatan sendiri |
| `.chip` — `aria-pressed="true"` → latar teal penuh | **0×**, diganti `.kasir-chip` yang hanya menebalkan tepi |
| `.cart-row` · `.badge` | **0×** |
| `<Icon>` (42 ikon) | **2×** — back-office memakai **56×** |
| `--shadow-card` | **0×** — nol shadow di seluruh `kasir.css` |

Kesalahan yang sama dibuat **dua kali dalam dua jam** oleh agent yang sama: menulis `.kasir-kartu:hover` dan `.kasir-chip-aktif` sendiri tanpa memeriksa bahwa bundle sudah mengirim versi yang jauh lebih baik. **Periksa `ds-bundle/components.css` sebelum menulis satu pun kelas baru** — yang ditulis sendiri akan selalu lebih miskin daripada yang sudah dirancang, dan ia tidak menghasilkan satu pun error.

`.kasir-kartu` kini MODIFIER di atas komponen bundle, bukan pengganti.
`.kasir-chip` sendiri sudah DIHAPUS sepenuhnya (Task 9 Step 0, kampanye
"Hidupkan desain", 26 September 2026, keputusan user): chip saringan K-03
sekarang netral, tanpa modifier kasir sama sekali — kelas `.chip` bundle
yang dipakai, dengan kulit mockup (latar `--secondary`, tanpa tepi, 13px
bobot 600) di `packages/ds/lumi.css`, dijaga `tests/kasir-dom/kulit-komponen.test.js`.

