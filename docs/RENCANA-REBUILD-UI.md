# Rencana rebuild UI kasir — pelacak kemajuan

Kampanye membangun ulang tampilan `apps/kasir` supaya terlihat dan terasa
seperti aplikasi POS pada umumnya. Dimulai 25 September 2026.

**Berkas ini yang memberi tahu di mana kampanye berhenti.** Perbarui setiap
kali satu PR dibuka, di-merge, atau berhenti. Kalau container berganti:
jalankan `bash tools/siapkan-dev.sh`, baca `CLAUDE.md` § Rebuild UI kasir,
lalu lanjutkan dari baris pertama yang belum `selesai` di bawah.

## Sumber

| Apa | Di mana |
|---|---|
| Urutan otoritas, aturan kerja, invarian | `CLAUDE.md` § Cara kerja yang diharapkan · § Rebuild UI kasir |
| Mockup rujukan (peringkat 3) | `docs/referensi-visual/sumber/design-explorer.html` |
| Elemen mockup yang DITOLAK | `docs/referensi-visual/README.md` (10 butir) |
| Selisih terukur per layar | `docs/referensi-visual/BANDING.md` |
| Tangkapan semua layar mockup | `docs/referensi-visual/INDEKS.md` |
| Palet repo vs mockup | `docs/referensi-visual/PALET.md` |

## Cakupan

- **Masuk:** `apps/kasir` dan token di `packages/ds/lumi.css`.
- **Tidak masuk:** back-office; aplikasi pelanggan ("Lumi-Order" di mockup
  bukan `apps/hp`, dan belum ada di repo); kelompok B dan C `test:schema`;
  `GET /shifts`; klasifikasi tujuh kode 409; yatim snapshot pindah outlet.

## Kondisi berhenti — laporkan dan tunggu

- Test yang sudah ada merah, dan sebabnya bukan perubahan kampanye
- Penjaga hampa yang tidak dapat diperbaiki
- Elemen mockup yang hanya dapat diterapkan dengan mengubah spec
- Perubahan yang menyentuh logika uang, kas, atau sync di luar tata letak
- Perubahan nilai token di luar Fase 1
- Keadaan repo atau branch tidak seperti yang diharapkan

Elemen yang butuh fitur belum ada **bukan** kondisi berhenti: catat, lewati.

## Status

Nilai status: `belum` · `berjalan` · `PR terbuka` · `menunggu user` · `selesai` · `berhenti`

| Fase | Pekerjaan | Status | PR | Catatan |
|---|---|---|---|---|
| 0 | Persiapan: aturan di `CLAUDE.md`, pelacak ini, penolakan #9–#10 | berjalan | — | |
| 1 | Palet campuran: permukaan netral terang, teks dan aksen repo | belum | — | ⛔ **Tidak di-merge tanpa persetujuan user lewat preview.** Sesudah merge: gabungkan `main` ke semua PR terbuka, jalankan ulang seluruh penjaga |
| 2 | Cakupan galeri: login, buka shift, edit item, pembayaran, konfirmasi, struk, void/refund, laci kas | belum | — | Nol perubahan tata letak aplikasi |
| 3.1 | K-03 Kasir | belum | — | ≥ 12 kartu pada 1024×768; baris keranjang tidak dipendekkan |
| 3.2 | K-06 Pembayaran | belum | — | Sembilan penjaga K-06 tetap hijau |
| 3.3 | K-07 Konfirmasi | belum | — | |
| 3.4 | Struk | belum | — | |
| 3.5 | Void dan refund | belum | — | |
| 3.6 | Laci kas | belum | — | |
| 3.7 | K-01 Login | belum | — | |
| 3.8 | K-02 Buka shift | belum | — | |
| 3.9 | K-08 Riwayat | belum | — | Format nomor struk repo dipertahankan |
| 3.10 | K-12 Tutup kas | belum | — | Hitungan buta tetap |
| 4 | Laporan akhir | belum | — | |

## Catatan per fase

Diisi saat fase berjalan: selisih yang dikejar, ditolak, dan dilewati; hasil
penjaga dan sabotase; fitur yang dibutuhkan mockup tetapi belum ada.
