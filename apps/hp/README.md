# `apps/hp` — Owner mobile

Aplikasi ketiga, lahir 24 Agustus 2026. `IA:§4`.

> `IA:229` — *"Persona P3 membuka aplikasi **pukul 23:00 untuk satu
> pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan
> menyediakan navigasi lengkap."*

| Layar | Kode | Status |
|---|---|---|
| Login | M-00 | ada |
| Ringkasan Hari Ini | M-01 | ada |
| Perlu Diperiksa | M-02 | ada |
| Laporan (ringkas) | M-03 | ada |
| Otorisasi Jarak Jauh | M-04 | **v1.1**, `IA:251` — tidak dibangun |

## Yang mengikat kode

- ⛔ **Tanggal "hari ini" datang dari SERVER.** `GET /reports/daily-summary`
  dipanggil TANPA `date`, dan server menghitung tanggal bisnisnya dari jam
  database, zona outlet, dan jam tutupnya. Jam HP dapat salah — FR-F8 ada di
  produk ini justru karena jam perangkat berbohong cukup sering untuk perlu
  dideteksi — dan HP yang jamnya maju satu hari meminta ringkasan hari yang
  belum terjadi lalu menerima nol transaksi tanpa satu pun error.
- ⛔ **Sesi dan pintu HTTP dibagi dengan back-office** lewat
  `packages/klien-api`, bukan disalin. `IA:245`: kredensialnya memang sama.
- ⛔ **Online-only** (`IA:265`). Tanpa PowerSync, tanpa SQLite lokal, tanpa
  `outbox_local`. Owner membaca; ia tidak menjual.
- ⛔ **Aturan tampilan hidup di `ringkasan/m01.ts`**, komponennya hanya JSX —
  pola yang sama dengan `b21-daftar.ts` dan `harga-basi.ts` di back-office.
  Yang hanya dapat diuji lewat DOM biasanya tidak diuji sama sekali.
- ⛔ **Bilah nav punya DUA item, dan keduanya BUKAN yang wireframe gambar.**
  `IA:§4.2` menulis `[Laporan] [Otorisasi]`; Otorisasi adalah M-04 dan tidak
  ada di v1 (`IA:251`), jadi tab yang menujunya akan mati. Yang dipakai
  `[Ringkasan] [Laporan]` — jumlahnya tetap dua, dan `IA:253` menyebut
  penambahan ketiga sebagai pergeseran IA.
- ⛔ **M-02 BUKAN tab.** `IA:247` menyebutnya drill-down dari peringatan di
  M-01, dan `spec-g:245` melarang bagian "perlu diperiksa" muncul tanpa
  temuan. Tab untuknya akan tampil juga saat tidak ada apa pun yang perlu
  diperiksa.
- ⛔ **Pengambilan data ada di `Beranda.tsx`, bukan di tiap layar.** M-01
  meringkas daftar yang M-02 tampilkan penuh, dan M-03 menghitung rentangnya
  dari tanggal yang M-01 terima. Tiga permintaan terpisah dapat menjawab
  berbeda, dan owner yang membuka daftar dari "3 hal perlu diperiksa" lalu
  melihat empat baris tidak punya cara memahami selisihnya.
- ⛔ **Daftar "perlu diperiksa" TERTUNGGAK, bukan harian.** Oversell yang belum
  ditindaklanjuti tiga hari lalu masih perlu ditindaklanjuti malam ini. Daftar
  yang disaring per tanggal mengosongkan dirinya setiap tengah malam, dan owner
  yang membukanya pukul 23:00 lalu 00:30 melihat dua jawaban berbeda.
- ⛔ **Rute disimpan di state, bukan di URL.** Berbeda dari `apps/kasir` dan
  `apps/backoffice`. Tidak satu pun dari ketiga layar berguna di-bookmark: M-02
  adalah drill-down dari peringatan yang mungkin sudah tidak ada besok, dan
  M-03 bergantung pada tanggal yang M-01 ambil.

## Batas yang dinyatakan

- **Bukan PWA.** `IA:445` masih membukanya sebagai pertanyaan ("PWA yang dapat
  dipasang, atau situs biasa?"), dan tidak ada di dokumen mana pun yang
  memutuskannya. Ia dibangun sebagai SPA biasa; menambahkan manifest dan
  service worker kelak tidak mengubah satu pun layar.
- **Email yang terdaftar di DUA tenant tidak dapat masuk lewat HP.** Field "ID
  Tenant" sengaja tidak ada di layar 390px; orang itu masuk lewat back-office.
- **M-03 adalah SATU laporan, bukan sembilan.** `IA:248` menyebutnya "subset
  dari back-office", dan yang dipilih adalah omzet per rentang — angka yang
  sama dengan B-16. Rincian per produk, per kasir, dan ekspor tetap di laptop;
  menyalin sembilan layar ke 390px menghasilkan navigasi yang `IA:229` tolak.
- **Rincian per outlet hanya dua kolom** — omzet bersih dan jumlah transaksi.
  Rincian lengkap per outlet adalah laporan back-office; layar 390px yang
  memuat tujuh kolom × dua puluh baris adalah tabel yang tidak dapat dibaca.
  Outlet tanpa transaksi tidak muncul sebagai baris nol: dua puluh baris "Rp 0"
  mengubur dua yang berisi.

## Menjalankan

```
npm run dev --workspace hp     # port 1423
npm run test:hp
```
