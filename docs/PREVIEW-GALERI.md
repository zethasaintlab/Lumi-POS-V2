# Preview galeri — apa yang di-deploy, dan apa yang TIDAK

Galeri komponen (`apps/kasir/harness-galeri.html`) di-deploy sebagai situs
statis supaya kamu dapat menilai layar dari HP lewat tautan, bukan lewat
deskripsi saya.

## ⛔ Yang di-deploy adalah TAMPILAN, bukan aplikasinya

Galeri memakai `DbLokal` palsu (`apps/kasir/src/galeri/db-palsu.ts`):

- **nol PostgreSQL** — tidak ada satu pun koneksi database
- **nol PowerSync** — `pasangLokalPalsu` mengganti instance tunggal sebelum
  React memasang apa pun, jadi `bukaDbLokal()` tidak pernah dipanggil
- **nol rahasia** — tidak ada token, kunci, atau variabel lingkungan
- **nol permintaan jaringan** — diverifikasi lewat intersepsi Playwright: satu
  pun permintaan keluar tidak ada, seluruhnya aset statis dari origin yang sama

Datanya karangan seluruhnya: katalog, shift, riwayat penjualan, dan sesi kasir
bernama "Kasir Galeri". Tidak ada satu baris data merchant di dalamnya.

## URL-state

Setiap sel dapat ditautkan langsung:

```
<preview-url>/?layar=K-03&keadaan=offline
```

| Parameter | Nilai |
|---|---|
| `layar` | `K-03` · `K-08` · `K-12` · `K-15` |
| `keadaan` | `kosong` · `normal` · `memuat` · `error` · `offline` · `panjang` · `meluap` · `angka-besar` |

⛔ Nilai yang tidak dikenal **jatuh ke bawaan**, bukan menghasilkan halaman
kosong. URL ini diketik tangan dan disalin ke chat; salah ketik adalah keadaan
normal, dan galeri yang menjawabnya dengan layar kosong tidak dapat dibedakan
dari galeri yang rusak.

## Build

```
npm run build:galeri     # → dist-galeri/
```

⛔ **Config terpisah** (`apps/kasir/vite.galeri.config.ts`), bukan entry kedua
di config produksi. `apps/kasir/vite.config.ts` tidak menyebut galeri sama
sekali, jadi `npm run build` tidak dapat menyeretnya masuk ke bundel perangkat
merchant — dan `db-palsu.ts` yang mendarat di tablet kasir tidak menghasilkan
satu pun error sampai seseorang membukanya.

Dijaga `tests/runtime/galeri-di-luar-produksi.test.js` (tiga test: config
produksi, config galeri, dan isi `dist/` bila sudah pernah dibangun).

## Konfigurasi Vercel

`vercel.json` di akar repo:

| Kunci | Nilai | Kenapa |
|---|---|---|
| `buildCommand` | `npm run build:galeri` | bukan `npm run build`, yang mem-build aplikasi kasir sungguhan |
| `outputDirectory` | `dist-galeri` | terpisah dari `dist/` |
| `rewrites` | `/` → `/harness-galeri.html` | entry-nya bukan `index.html`; tanpa ini root domain menjawab 404 |
| `github.silent` | `true` | Vercel tidak mengomentari setiap commit di PR |

## ⛔ Satu langkah yang HANYA kamu bisa lakukan

Saya tidak punya akses ke dashboard Vercel-mu. Percobaan membuat project lewat
integrasi memerlukan persetujuanmu dan saya hentikan di sana — sesuai pemicu
eskalasi "apa pun yang butuh aku mengklik di dashboard".

Konfigurasinya sudah lengkap dan ter-commit; yang tersisa satu kali klik:

1. Buka <https://vercel.com/new> dan pilih team **AfterSchool**.
2. **Import Git Repository** → `zethasaintlab/Lumi-POS-V2`.
   Kalau repo tidak muncul, klik **Adjust GitHub App Permissions** dan beri
   Vercel akses ke repo ini (ia privat).
3. Jangan ubah satu pun setelan build. `vercel.json` di akar repo sudah
   menetapkan `buildCommand`, `outputDirectory`, dan rewrite root — setelan di
   dashboard yang diisi tangan akan MENGALAHKANNYA dan menyimpang diam-diam.
4. **Deploy**.

Sesudah itu setiap push ke branch mana pun menghasilkan preview URL sendiri,
tanpa tindakan lagi dari kita berdua.

⛔ **Deployment PRODUKSI dari `main` akan GAGAL sampai kerja ini ter-merge** —
`main` belum punya skrip `build:galeri`. Itu bukan kerusakan; preview per-branch
tetap jalan, dan produksi hijau begitu branch-nya masuk.

⛔ **Plan-nya hobby (gratis).** Tidak ada layanan berbayar baru yang dibuat, dan
saya tidak membuat satu pun resource di akunmu.

## Batas yang dinyatakan

- **Hanya empat layar kasir** ada di galeri hari ini (K-03, K-08, K-12, K-15).
  Sisa 48 layar belum, dan menambahkannya adalah pekerjaan per layar.
- **Back-office dan HP belum punya galeri.** Keduanya online-only dan tidak
  memakai `DbLokal`, jadi memalsukannya menuntut memalsukan lapisan HTTP —
  bentuk pekerjaan yang berbeda.
- Bundel memuat aset WASM `wa-sqlite` (~8 MB di disk) karena rantai impor
  `DbLokalProvider` menyentuh `@powersync/web`. **Aset itu tidak pernah
  diminta browser** — halaman hanya mengambil ~510 kB JS + ~22 kB CSS,
  diverifikasi lewat access log server statis.
