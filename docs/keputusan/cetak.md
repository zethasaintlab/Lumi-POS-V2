# Cetak struk — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

⛔ **Gate F4 punya DUA bagian.** `ARCH:398`: *"Cetak berhasil di ≥5 model; penjualan tetap tersimpan saat cetak gagal."* Bagian kedua terbukti lewat test. **Bagian pertama: `Logika & Profil Production-Ready (Hardware-Blocked)`** — status resmi user, 25 Agustus 2026. Ia dipindahkan ke Acceptance Test lapangan, bukan dinyatakan lulus.

⛔ **Perbedaan itu harus dijaga di kalimat mana pun tentang F4.** Yang benar: *"logika pemilihan profil dan antrean cetak selesai dan teruji deterministik; cetak di lima model fisik belum pernah dijalankan."* Yang SALAH: "F4 hijau". Tidak satu byte pun pernah meninggalkan perangkat menuju printer sungguhan — `peripheralAktif()` masih mengembalikan `null`, dan itu tercatat sebagai utang Tauri, bukan sebagai adapter yang bekerja.

## F4 — keputusan yang mengikat kode

**Rantai cetak: `ReceiptDocument` → `ReceiptRenderer` → `PeripheralPort`** (`ARCH:199-200`). Dokumen deskriptif dulu, byte belakangan — `ARCH:204` menyebut alasannya: tanpa pemisahan itu, mendukung printer fiskal berarti menyentuh layar kasir.

- ⛔ **Invariant #3 ditegakkan di DUA tempat.** `cetakStruk` tidak pernah melempar (lemparan apa pun jadi `HasilCetak`), dan cetak berjalan SETELAH `db.transaction` ter-commit. Satu saja tidak cukup: lemparan yang lolos naik ke alur penjualan, dan cetak di dalam transaksi membuat kertas habis me-rollback penjualan yang uangnya sudah masuk laci.
- **Kegagalan cetak DIKEMBALIKAN, bukan didiamkan.** Layar harus dapat berkata "struk gagal dicetak, transaksi tersimpan". `tanpa_printer` dibedakan dari `gagal` — merchant tanpa printer adalah kasus sah.
- **Renderer MURNI.** Tanpa jam, tanpa acak. FR-B11 menuntut cetak ulang identik dengan cetakan pertama; renderer yang menyentuh `Date.now()` membuat itu mustahil dibuktikan.
- ⛔ **Perintah printer datang dari PROFIL, tidak pernah dari renderer** (`ERD:445`: "Data, bukan kode"). `printer_profile` diturunkan sebagai tabel; baseline 58/80 mm ikut di kode hanya supaya perangkat tanpa profil tersinkron tetap dapat mencetak.
- ⛔ **Transliterasi terjadi SEBELUM hitungan lebar.** `…` panjangnya 1 karakter di JavaScript tetapi mencetak 3; menerjemahkan belakangan membuat baris yang dihitung "pas 32" mencetak 34, dan printer melipatnya sendiri.
- **Dua kolom dipotong di KIRI**, tidak pernah di angkanya — memotong dari kanan menghasilkan "Rp 25.0", struk yang menyebut harga salah.
- **Cetak ulang tidak menyentuh satu pun tabel katalog** (`spec-b:145`), diuji dari tabel yang benar-benar disentuh query. Konsekuensinya: baris pajak pada cetak ulang berbunyi "Pajak" tanpa nama tarif — nama tarif hidup di `tax_rate`, dan meresolusinya melanggar aturan itu. **Batas yang dinyatakan**, bukan kelalaian.
- `print_job` **murni lokal**: struk adalah artefak perangkat, dan printer yang gagal di kasir 1 tidak dapat dicetak ulang oleh kasir 2.

**⛔ Penjaga sync-rules kini menurunkan aturannya dari DDL.** Aturannya bukan lagi "setiap query menyaring tenant" melainkan "setiap query atas tabel **ber-tenant** menyaring tenant", dan daftar tabel ber-tenant dibaca dari `db/migrations/*.sql`. Diperlukan karena `printer_profile` dikecualikan dari RLS dan tidak punya `tenant_id` sama sekali. Daftar pengecualian yang ditulis tangan akan bertambah panjang sampai penjaganya tidak menjaga apa pun.

