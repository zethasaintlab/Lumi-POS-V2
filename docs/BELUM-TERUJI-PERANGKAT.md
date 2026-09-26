# Belum teruji perangkat

Fitur yang perilakunya hanya dapat dibuktikan di perangkat nyata. Daftar ini
**syarat sebelum merchant pertama, bukan syarat merge** (`docs/PROTOKOL-OTONOM.md`
§ 2). Setiap fitur baru yang masuk kelas ini ditambahkan di sini oleh task yang
membangunnya.

| Fitur | Yang harus diuji | Langkah uji | Hasil yang diharapkan |
|---|---|---|---|
| Cetak struk (F4, `ARCH:398` bagian pertama) | Cetak di ≥ 5 model printer termal 58 dan 80 mm | Pilih profil printer di K-15, jual satu item, cetak ulang dari K-09 | Lebar kolom pas 32/48 karakter, nama varian tampil, potong kertas bekerja, tidak ada karakter sampah |
| Penjualan tetap tersimpan saat cetak gagal | Kertas habis atau printer mati di tengah penjualan | Cabut printer, jual satu item | K-07 menyatakan struk gagal dicetak; transaksi ada di K-08 |
| Buka laci kas (K-16, FR-D7) | Laci benar-benar terbuka lewat printer | Tekan buka laci tanpa penjualan | Laci terbuka; pembukaan keempat dalam satu shift menuntut PIN |
| QRIS dinamis lewat gateway sungguhan (FR-C3) | Pembayaran nyata lewat Midtrans | Bayar QRIS dinamis dengan aplikasi e-wallet | Terkonfirmasi hanya dari gateway; timeout tidak terbaca "gagal" |
| Sentuhan jari di tablet | Target 44 px dan aksi uang 56 px, termasuk area sentuh tak terlihat `.sentuh`/`.sentuh-uang` (sub-proyek 1) | Ketuk tepi setiap tombol kecil dan tetangganya di K-03 dengan jari | Setiap ketukan mengenai elemen yang dimaksud, tidak ada salah tambah produk |
| Scanner barcode HID (K-17) | Scan di K-03, dan scan tidak tertangkap di kolom PIN | Scan produk, lalu scan di K-01 | Produk masuk keranjang; di K-01 tidak terjadi apa pun |
| SQLite OPFS di Android/iOS | Penyimpanan lokal bertahan | Jual offline, tutup browser, buka lagi | Penjualan dan antrean masih ada |
