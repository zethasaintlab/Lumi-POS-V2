# Bukti verifikasi visual

Tangkapan layar dari **galeri komponen**, dibangun sebagai situs statis
(`npm run build:galeri`) dan ditangkap dari build itu — bukan dari dev server.
Build statis dapat berbeda dari dev server, dan yang dinilai merchant adalah
yang statis.

Regenerasi: `npm run verifikasi:galeri`

## ⛔ Kenapa gambar ini ada di dalam repo

Preview URL adalah jalur utama, dan ia dapat mati: token kedaluwarsa, integrasi
dicabut, build gagal. Gambar yang ter-commit selalu jalan, GitHub merendernya,
dan ia dapat dinilai dari HP.

Yang paling penting: ia **terikat pada commit-nya**. "Seperti apa layar ini saat
itu" punya jawaban yang tidak berubah kemudian — dan tanpa itu, setiap klaim
visual di pesan commit hanya dapat dipercaya atau tidak dipercaya.

## Isi

| Layar | Keadaan | Viewport |
|---|---|---|
| [K-03 Kasir](K-03/) | 8 | 2 |
| [K-08 Riwayat](K-08/) | 8 | 2 |
| [K-12 Tutup kas](K-12/) | 8 | 2 |
| [K-15 Perangkat](K-15/) | 8 | 2 |

64 gambar. Dua viewport: `tablet-1280x800` (tablet kasir, `PRD:428`) dan
`backoffice-1440x900`.

## Batas yang dinyatakan

Gambar ini membuktikan layar **ter-render** dan tampak seperti apa. Ia tidak
membuktikan perilaku: apa yang terjadi saat tombol ditekan, apakah angkanya
benar, apakah penjualan tersimpan. Itu pekerjaan test, dan test tidak
digantikan oleh gambar.
