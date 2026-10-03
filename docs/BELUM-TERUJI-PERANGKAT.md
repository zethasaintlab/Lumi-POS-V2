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
| QRIS dinamis lewat gateway sungguhan (FR-C3) | Pembayaran nyata lewat Midtrans; QR kini gambar SVG 192 px di kartu K-06 (G-QR hanya mendekode dengan jsQR di Chromium) — dapat-dipindainya dari layar tablet/WebView Tauri oleh kamera e-wallet (kecerahan, ukuran fisik, silau) hanya terbukti di perangkat nyata | Tampilkan QR di tablet, pindai dengan beberapa aplikasi e-wallet dari jarak kasir; lalu bayar | QR terpindai pada kecerahan layar biasa dan dari jarak wajar; terkonfirmasi hanya dari gateway; timeout tidak terbaca "gagal" |
| Sentuhan jari di tablet | Target 44 px dan aksi uang 56 px, termasuk area sentuh tak terlihat `.sentuh`/`.sentuh-uang` (sub-proyek 1) | Ketuk tepi setiap tombol kecil dan tetangganya di K-03 dengan jari | Setiap ketukan mengenai elemen yang dimaksud, tidak ada salah tambah produk |
| Scanner barcode HID (K-17) | Scan di K-03, dan scan tidak tertangkap di kolom PIN | Scan produk, lalu scan di K-01 | Produk masuk keranjang; di K-01 tidak terjadi apa pun |
| SQLite OPFS di Android/iOS | Penyimpanan lokal bertahan | Jual offline, tutup browser, buka lagi | Penjualan dan antrean masih ada |
| Pesanan tahan (K-03 Pesanan tahan, Task 12): SQL `keranjang_tahan` di wa-sqlite/OPFS nyata | `INSERT`/`SELECT ... WHERE`/`DELETE` tabel murni lokal, termasuk tabel yang baru dibuat di perangkat lama lewat `rencanaBuatLokalHilang`, dan tahan/lanjutkan/buang atomik saat tab dimatikan paksa | Di perangkat yang sudah punya data: perbarui aplikasi, buka K-03, isi keranjang, Tahan; matikan tab saat dialog terbuka; buka lagi; Lanjutkan; ulangi dengan Buang; coba tutup shift dari K-12 saat masih ada tahanan | Tabel ada tanpa unduh ulang katalog; keranjang kosong tepat setelah Tahan dan pulih identik (diskon, kanal, nama/meja/catatan) setelah Lanjutkan; Buang menulis satu `cart_cleared` di K-22/audit; K-12 menonaktifkan Lanjut dan menampilkan daftar tahanan |
