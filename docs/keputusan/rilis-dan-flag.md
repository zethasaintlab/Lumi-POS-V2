# Staged rollout dan kill switch — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

### F6 — staged rollout, keputusan yang mengikat kode

`ARCH:§12` dan KEP-36 menolak dua jalan yang lebih mudah: auto-update paksa **menghentikan outlet di jam makan siang**, dan update manual berarti delapan versi di lapangan setelah setahun. Yang tersisa adalah rollout bertahap dengan jendela waktu. Aturannya di `packages/domain/src/rilis.ts`; keadaannya di `app_release` (migrasi `0030`).

- ⛔ **Yang dibangun adalah KEPUTUSAN, bukan PEMASANGAN.** `GET /devices/{id}/update` menjawab "versi mana yang seharusnya, dan boleh dipasang sekarang atau tidak". Mengunduh dan memasangnya menuntut shell Tauri — utang F4 yang tercatat. Memisahkan keduanya membuat updater yang lahir kelak tinggal menempel, bukan memutuskan ulang; aturannya tidak akan pernah punya dua salinan.
- ⛔ **Persentase MERCHANT, bukan perangkat.** Satu outlet dengan tiga kasir tidak boleh terbelah dua versi: ketiganya berbagi shift, printer, dan nomor struk, dan selisih versi di antara mereka adalah tepat beban multi-versi yang KEP-36 ingin hindari — dialami dalam satu ruangan.
- ⛔ **Kohort wajib SUBSET: 5% ⊂ 25% ⊂ 100%.** Merchant yang keluar dari cakupan saat tahap naik harus TURUN versi, dan rollback skema SQLite lokal "hampir mustahil" setelah data ditulis dengan skema baru (KEP-36). Diuji sebagai property atas 2.000 tenant.
- ⛔ **Kohort DI-GARAM per versi.** Tanpa garam, merchant yang kebetulan berkohort rendah menjadi kelinci percobaan untuk **setiap** rilis, selamanya.
- ⛔ **Kanari adalah PILIHAN (`tenant.is_canary`), bukan undian**, dan cakupannya nol persen. Merchant sungguhan tidak pernah menjadi kelinci percobaan tanpa memilihnya.
- ⛔ **Jendela update boleh MELEWATI TENGAH MALAM.** Outlet yang tutup 02:00 memilih 23:00–02:00, dan perbandingan naif (`mulai <= jam && jam < selesai`) menjawab "tidak pernah" untuknya — update yang tidak pernah terpasang terlihat persis seperti tidak ada rilis. `mulai = selesai` adalah jendela KOSONG, bukan 24 jam penuh; CHECK constraint menolaknya, karena menafsirkannya sebagai penuh membuat satu salah ketik mengizinkan update di jam makan siang.
- ⛔ **Jam lokal outlet dibaca dari jam DATABASE.** Jendela selebar tiga jam, dan dua mesin yang jamnya berselisih memasang update di luar jendela yang merchant setujui.
- ⛔ **Urutan pemeriksaan bukan selera.** "Belum giliran" mendahului segalanya — termasuk update yang wajib segera; yang menaikkan tahap adalah orang. "Wajib segera" mendahului jendela dan penundaan justru karena kategorinya tertutup (`keamanan`, `kehilangan_data`): yang lolos ke sana hanya kehilangan data dan lubang keamanan, dan menunggu 03:00 untuk keduanya berarti membiarkan kerusakan berjalan semalaman.
- ⛔ **Penundaan dihitung PER VERSI** (`device.update_deferred_version`). Tanpa itu, penundaan yang terkumpul untuk versi lama membuat versi berikutnya wajib segera saat pertama kali muncul — merchant kehilangan haknya tanpa pernah memakainya. Jatah yang habis membuat update **wajib**, bukan batal.
- ⛔ **Gate crash rate MENAHAN saat datanya belum ada.** Gate yang meloloskan ketidaktahuan hanya menyala pada rilis yang sudah cukup lama berjalan untuk tidak membutuhkannya. Dan crash rate yang naik SEDIKIT PUN menahan: `ARCH:304` menulis ambangnya `> baseline`, dan toleransi adalah angka yang harus dipilih seseorang — tidak ada di dokumen mana pun, jadi ia tidak dikarang di kode.
- ⛔ **Angka crash rate DIKETIK operator, bukan dihitung alat.** Crash rate satu versi bersifat lintas-tenant, dan `device_telemetry` tunduk RLS — `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga, jadi bahkan `DATABASE_MIGRATION_URL` tidak dapat mengagregasinya. `tools/naikkan-tahap.mjs` menuntut angkanya disebutkan, menegakkan aturannya, lalu **menyimpan** angka yang dipakai di `app_release.gate_crash_*`.
- **`app_release` dikecualikan RLS**, sejajar `printer_profile`: rilis milik KAMI, tidak ada tenant yang memilikinya. Konsekuensinya dinyatakan — setiap merchant dapat membaca barisnya, dan tidak satu pun kolomnya menyebut merchant lain.
- **Rilis yang dihentikan TIDAK dihapus.** Barisnya justru yang menjelaskan perangkat yang terlanjur memasangnya. Yang berlaku adalah rilis **terbaru dibuat**, bukan yang tertinggi nomornya — itulah yang membuat penarikan lewat versi bernomor lebih rendah mungkin.
- **Tidak ada endpoint untuk menaikkan tahap**, dan itu batas yang dinyatakan: seluruh peran di `spec-f` adalah peran merchant, dan endpoint operator menuntut permukaan otentikasi staf yang tidak ada di sistem ini. Alat memakai kredensial database yang memang sudah dipegang operator.

### F6 — feature flag & kill switch, keputusan yang mengikat kode

`ARCH:358`: *"Kill switch: per fitur per merchant, dari server tanpa rilis — kebutuhan operasional, bukan kemewahan."* Rantainya: `tools/kill-switch.mjs` → `feature_flag` (migrasi `0032`) → `GET /devices/{id}/features` → `fitur_lokal` → layar kasir.

- ⛔ **Tabel menyimpan PENYIMPANGAN saja.** Bawaan tiap fitur hidup di `packages/domain/src/fitur.ts`, bukan sebagai `DEFAULT` kolom — pola yang sama dengan ambang diskon dan jendela update. Tabelnya akan tetap hampir kosong, dan itu benar.
- ⛔ **`tenant_id IS NULL` = penyimpangan GLOBAL, dan baris tenant MENANG atasnya.** "Matikan untuk semua kecuali yang sudah kami periksa" adalah bentuk pemulihan insiden yang paling sering dipakai.
- ⛔ **DUA index unik parsial, bukan satu.** NULL tidak sama dengan NULL di index unik PostgreSQL, jadi `UNIQUE (key, tenant_id)` tunggal mengizinkan dua baris global untuk fitur yang sama.
- ⛔ **Kunci ASING dibaca MATI**, di server dan di klien. Baris yang tertinggal untuk fitur yang sudah dihapus dari kode tidak boleh menyalakan apa pun.
- ⛔ **Tabelnya dikecualikan RLS**, sejajar `app_release`: alat operator memakai `DATABASE_MIGRATION_URL`, dan `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga. Konsekuensinya dijaga dua penjaga — hanya SATU query di server yang menyentuhnya, dan query itu menyaring tenant.
- ⛔ **Respons berisi BOOLEAN per fitur, bukan barisnya.** Mengirim barisnya berarti mengirim `tenant_id` merchant lain; `reason` sebuah kill switch biasanya menyebut dugaan fraud.
- ⛔ **`fitur_lokal` murni lokal, SENGAJA bukan raw table.** Raw table mengubah sidik jari skema lokal dan menuntut `disconnectAndClear()` + unduh ulang katalog di setiap perangkat merchant — untuk tiga boolean.
- ⛔ **Dua fallback yang arahnya BERLAWANAN.** Fitur tanpa baris mengikuti bawaan kode (menyala) supaya perangkat baru tetap dapat berjualan; fitur yang punya baris bertahan **tanpa kedaluwarsa** supaya kill switch tetap berlaku pada perangkat yang mencabut internetnya. Kegagalan menyegarkan mempertahankan keadaan lama — respons yang tidak sampai bukan "tidak ada flag".
- ⛔ **Tidak ada flag yang menyentuh AUDIT** (`spec-f:369`) maupun yang dapat **menghentikan penjualan**. Keduanya dijaga test atas daftar tertutup, karena kunci berikutnya akan ditambahkan oleh orang yang sedang menangani insiden.

