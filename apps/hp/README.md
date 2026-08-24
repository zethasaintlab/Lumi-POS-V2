# `apps/hp` — Owner mobile

Aplikasi ketiga, lahir 24 Agustus 2026. `IA:§4`.

> `IA:229` — *"Persona P3 membuka aplikasi **pukul 23:00 untuk satu
> pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan
> menyediakan navigasi lengkap."*

| Layar | Kode | Status |
|---|---|---|
| Login | M-00 | ada |
| Ringkasan Hari Ini | M-01 | ada |
| Perlu Diperiksa | M-02 | belum |
| Laporan (ringkas) | M-03 | belum |
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
- ⛔ **Bilah nav bawah belum ada**, dan itu disengaja: `IA:§4.2` menggambar
  `[Laporan] [Otorisasi]`, keduanya belum ada di v1. Tab yang menuju layar yang
  tidak ada terbaca sebagai aplikasi rusak, bukan sebagai fitur yang ditunda.

## Batas yang dinyatakan

- **Bukan PWA.** `IA:445` masih membukanya sebagai pertanyaan ("PWA yang dapat
  dipasang, atau situs biasa?"), dan tidak ada di dokumen mana pun yang
  memutuskannya. Ia dibangun sebagai SPA biasa; menambahkan manifest dan
  service worker kelak tidak mengubah satu pun layar.
- **Email yang terdaftar di DUA tenant tidak dapat masuk lewat HP.** Field "ID
  Tenant" sengaja tidak ada di layar 390px; orang itu masuk lewat back-office.

## Menjalankan

```
npm run dev --workspace hp     # port 1423
npm run test:hp
```
