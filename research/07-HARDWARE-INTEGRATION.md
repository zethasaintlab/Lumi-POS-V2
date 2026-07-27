# 07 — Hardware & Peripheral

> Fase 7 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **ESC/POS adalah standar de facto, tapi "standar" di sini berarti "kesepakatan longgar".** `[FAKTA]` Dukungan perintah dan code page **bervariasi antar vendor dan model**; dokumentasinya berbeda tergantung siapa yang memproduksi hardware. Printer Star bahkan punya bahasa native sendiri (SPL) dan harus **dialihkan ke mode emulasi ESC/POS** lewat DIP switch. Implikasinya: lapisan abstraksi printer harus punya konsep *profil printer*, bukan satu implementasi ESC/POS. (→ KEP-27)

2. **Pencetakan dari browser murni tidak layak untuk produksi.** `[FAKTA]` WebUSB tidak bisa mengakses printer di **Windows** karena driver printer meng-klaim perangkat secara eksklusif — dan Windows adalah platform mini-PC kasir paling umum di Indonesia. Ini alasan teknis konkret yang memperkuat KEP-12 (Tauri): akses hardware harus lewat lapisan native. (→ KEP-27)

3. **Cash drawer bukan perangkat yang perlu diintegrasikan — ia dikendalikan printer.** `[FAKTA]` Drawer terhubung ke port DK printer lewat kabel RJ11/RJ12; POS mengirim perintah ESC/POS dan printer memancarkan pulsa listrik yang membuka laci. Tidak ada logika software di level laci. Ini menyederhanakan arsitektur secara signifikan: satu integrasi (printer) melayani dua perangkat.

4. **Biaya hardware kasir di Indonesia sangat rendah dan itu membentuk ekspektasi merchant.** `[FAKTA]` Printer thermal 58mm USB tersedia dari ~Rp235.000; printer 80mm WiFi dengan autocutter ~Rp890.000; barcode scanner Rp312.000–798.000. Merchant sudah punya hardware atau bisa membelinya sendiri — **model bisnis hardware-locked ala Toast tidak akan diterima**. (→ KEP-28)

5. **Abstraksi hardware dibangun sebagai satu port dengan implementasi per platform, bukan per perangkat.** Tiga platform (browser, Tauri desktop, Tauri/Android) punya kemampuan akses perangkat yang berbeda secara fundamental, dan perbedaannya harus diserap di satu tempat.

---

## 1. Protokol thermal printer

### 1.1 ESC/POS dan variasinya

`[FAKTA]` ESC/POS mendefinisikan standar untuk pencetakan, tetapi **dukungan perintah dan code page bervariasi antar vendor dan model printer**, dan dokumentasinya bisa berbeda tergantung produsen hardware.
`[FAKTA]` **Star Micronics** memiliki bahasa native sendiri, SPL (Star Printer Language). Sebagian besar printer Star bisa dialihkan ke mode ESC/POS lewat **DIP switch atau utilitas konfigurasi**. Pustaka pihak ketiga umumnya hanya mendukung printer Star dalam **mode emulasi ESC/POS**, bukan mode SPL native.
`[FAKTA]` Star Micronics memperluas dukungan ESC/POS untuk seri TSP100IV termasuk model TSP100IV SK, dan menambahkan emulasi ESC/POS berbasis LAN untuk printer impact SP742.
`[FAKTA]` **Jebakan implementasi paling umum:** tanpa mengirim perintah inisialisasi `ESC @` (hex `1B 40`), buffer printer tidak bersih dan hasil cetak menjadi tidak konsisten. `ESC @` adalah perintah "Initialize printer" yang membersihkan buffer dan mereset seluruh formatting ke default.
`[FAKTA]` Seri Star TSP100 bisa dikonfigurasi lewat DIP switch untuk menerima raw ASCII tanpa perintah ESC/POS; selain itu, mayoritas printer struk thermal membutuhkan inisialisasi protokol ESC/POS sebelum menerima data cetak.

*Sumber: [Exploring ESC/POS: Integrating Point of Sale Printers — Bright Inventions](https://brightinventions.pl/blog/esc-pos-integrating-point-of-sale-printers/) · [escpos-php — GitHub (mike42)](https://github.com/mike42/escpos-php) · [Star Micronics Expands ESC/POS Printer Compatibility Across Thermal and Impact Printing Solutions — Star Micronics](https://starmicronics.com/blog/star-micronics-expands-esc-pos-printer-compatibility-across-thermal-and-impact-printing-solutions/) · [Free Thermal Printer Drivers — ESC/POS, Epson, Xprinter — PushPrinter](https://pushprinter.com/drivers/) · [Star Micronics to Epson — Emulation Setup — POSGuys](https://posguys.com/blog/tech-support/article/Star-Micronics-Epson-Emulation-Setup) (semua diakses 27 Jul 2026)*

### 1.2 Yang berbeda antar printer dalam praktik

`[INFERENSI]` Dari fakta variasi di atas, dimensi yang harus dikelola profil printer:

| Dimensi | Variasi nyata | Dampak kalau salah |
|---|---|---|
| **Lebar kertas** | 58mm (32 karakter) vs 80mm (48 karakter) | Struk terpotong atau terlalu renggang |
| **Code page** | Bervariasi per vendor | Karakter Indonesia dan simbol `Rp` tercetak sebagai sampah |
| **Autocutter** | Ada / tidak ada; perintah partial cut vs full cut | Perintah cut ke printer tanpa cutter mencetak karakter aneh |
| **Cash drawer kick** | Perintah dan durasi pulsa bervariasi | Laci tidak terbuka atau solenoid panas |
| **Dukungan gambar/logo** | Raster vs bit-image, resolusi berbeda | Logo tercetak rusak atau tidak sama sekali |
| **Inisialisasi** | `ESC @` wajib pada mayoritas | Cetakan tidak konsisten — bug yang muncul acak dan sulit dilacak |
| **Mode native vs emulasi** | Star SPL vs ESC/POS | Printer tidak merespons sama sekali |

`[INFERENSI]` Konsekuensinya jelas: **profil printer harus berupa data (konfigurasi), bukan kode.** Menambahkan dukungan model printer baru harus berupa menambah satu entri konfigurasi, bukan menulis kelas baru. Merchant Indonesia memakai printer generik dari Tokopedia dengan merek yang tidak terprediksi — sistem yang hanya mendukung daftar model tertutup akan gagal di lapangan.

---

## 2. Pencetakan dari browser versus native

`[FAKTA]` Pendekatan yang diterima untuk web printing ESC/POS tanpa driver: menghubungkan printer thermal lewat **WebUSB, Web Serial, atau WebHID di atas HTTPS**; me-render struk dengan JS/CSS; lalu mengonversi ke perintah ESC/POS.
`[FAKTA]` **Batasan yang menentukan:** meskipun sebagian besar platform bisa berbicara langsung ke printer struk USB lewat WebUSB, **pengecualian utamanya adalah Windows, di mana driver printer meng-klaim printer secara eksklusif.**
`[FAKTA]` Ada inkompatibilitas antara implementasi WebSerial dan virtual serial port yang dibuat driver printer Star — workaround ini **tidak berfungsi untuk printer Star**.
`[FAKTA]` WebUSB memberi kendali paling besar untuk model USB Epson TM dan Star TSP.

*Sumber: [Print ESC/POS From a Browser Without Installing Drivers — Whizz Tech](https://whizz-tech.com/support/printers/escpos-web-printing-without-drivers-test-page/) · [WebUSBReceiptPrinter — GitHub (NielsLeenheer)](https://github.com/NielsLeenheer/WebUSBReceiptPrinter) · [WebUSB — Print Image and Text in Thermal Printers — Visuality](https://www.visuality.pl/posts/webusb-print-image-and-text-in-thermal-printers) (semua diakses 27 Jul 2026)*

### KEP-27 — Jalur akses printer per platform

**Pertanyaan:** Bagaimana aplikasi mencetak struk di browser, di desktop Windows, dan di tablet Android?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. WebUSB/WebSerial saja (browser murni) | Tanpa instalasi apa pun; aplikasi tetap murni web | **Gagal di Windows** — driver printer meng-klaim perangkat secara eksklusif. Gagal untuk printer Star via WebSerial. Butuh HTTPS dan gesture pengguna untuk izin perangkat | Tablet Android/ChromeOS dengan printer USB langsung |
| B. Print bridge lokal (aplikasi kecil yang dipasang merchant, mengekspos HTTP lokal) | Jalan di semua OS; memakai driver OS; pola yang dipakai banyak POS web | Satu instalasi tambahan yang harus di-support, di-update, dan di-troubleshoot per merchant. Titik kegagalan baru ("bridge-nya mati") | Aplikasi web murni tanpa wrapper native |
| C. Akses native lewat wrapper (Tauri) — Rust berbicara langsung ke USB/serial/network | Tanpa instalasi terpisah (sudah bagian aplikasi). Jalan di Windows tanpa masalah klaim driver. Kendali penuh atas byte yang dikirim. Konsisten dengan KEP-12 | Butuh kode Rust untuk lapisan perangkat. Tidak berlaku untuk mode browser murni | Aplikasi sudah dibungkus native |
| D. Network printer (printer dengan Ethernet/WiFi, kirim ESC/POS lewat TCP port 9100) | **Tidak butuh akses perangkat sama sekali** — hanya socket TCP. Jalan dari platform mana pun termasuk browser (via server). Satu printer bisa dipakai beberapa device | Printer network lebih mahal (~Rp890.000 vs ~Rp235.000). Butuh jaringan lokal yang stabil dan IP tetap | Outlet dengan LAN dan anggaran hardware sedikit lebih besar |

**Rekomendasi:** **C sebagai jalur utama, D sebagai jalur yang didukung penuh dan direkomendasikan untuk KDS/printer dapur, A sebagai fallback terbatas untuk mode browser.** `[INFERENSI]`

**Alasan:** Batasan Windows pada WebUSB bukan detail kecil — ia mematikan opsi A untuk platform kasir yang paling umum di Indonesia (mini-PC Windows). Opsi B menambah artefak instalasi yang harus di-support, yang untuk solo builder berarti kelas tiket support baru yang tidak berujung. Opsi C sudah "gratis" karena keputusan Tauri di KEP-12 — wrapper native yang dipilih karena alasan lain ternyata juga menyelesaikan masalah ini, yang merupakan konfirmasi bahwa KEP-12 benar. Opsi D layak didukung penuh sejak v1 karena ia adalah jalur **paling sederhana secara arsitektur** (hanya socket TCP) dan menjadi satu-satunya cara praktis mencetak ke printer dapur yang letaknya jauh dari kasir.

**Konsekuensi yang harus diterima:** aplikasi dalam mode browser murni (tanpa Tauri) memiliki kemampuan cetak yang terbatas — hanya printer network (D) dan WebUSB pada non-Windows (A). Ini harus dinyatakan di requirement sistem: **kasir produksi memakai aplikasi desktop, bukan browser.** Browser tetap didukung penuh untuk dashboard owner dan back-office yang tidak mencetak struk.

**Kapan keputusan ini harus ditinjau ulang:** jika Chrome/Windows mengubah perilaku klaim driver eksklusif untuk WebUSB (tidak ada indikasi), opsi A menjadi layak dan mode browser bisa dipromosikan.

**Sumber:** [Print ESC/POS From a Browser Without Installing Drivers — Whizz Tech](https://whizz-tech.com/support/printers/escpos-web-printing-without-drivers-test-page/) (27 Jul 2026) · [WebUSBReceiptPrinter — GitHub](https://github.com/NielsLeenheer/WebUSBReceiptPrinter) (27 Jul 2026) · [Electron vs Tauri 2026 — PkgPulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) (27 Jul 2026)

---

## 3. Cash drawer

`[FAKTA]` Kabel kick-out menghubungkan cash drawer ke printer struk dan membawa sinyal yang memerintahkan laci terbuka. Kabel **RJ11 atau RJ12** menghubungkan satu ujung ke port **DK (drawer kick)** di belakang printer struk dan ujung lain ke port yang sesuai di cash drawer.
`[FAKTA]` Ketika transaksi selesai, POS mengirim perintah cetak struk, dan bersamaan dengan itu printer mengirim sinyal listrik kecil ke cash drawer lewat kabel tersebut. Printer memancarkan sinyal buka di akhir penjualan tunai.
`[FAKTA]` "Drawer control code" adalah perintah ESC/POS khusus yang memerintahkan printer membuka laci. Contoh perintah standar EPSON: `27,112,48,55,121` — di mana `27` adalah karakter escape yang memerintahkan printer masuk mode perintah, dan sisanya menginisiasi pembukaan laci.
`[FAKTA]` **Tidak ada logika software kompleks di level laci — hanya sinyal.**

*Sumber: [How Do Cash Drawers Connect to Receipt Printers and POS Machines? — POS Central UK](https://poscentraluk.wordpress.com/2026/04/13/how-do-cash-drawers-connect-to-receipt-printers-and-pos-machines/) · [Cash drawer — Aronium Help Center](https://help.aronium.com/hc/en-us/articles/115002486449-Cash-drawer) · [Configuring Cash Drawer (Hardware Setup) — Orocube POS Guide](https://guide.orocube.com/configuring-cash-drawer/) · [Open Cash Drawer — escpos-php Issue #1054](https://github.com/mike42/escpos-php/issues/1054) (semua diakses 27 Jul 2026)*

`[INFERENSI]` **Ini penyederhanaan arsitektur yang signifikan dan sering tidak disadari:** cash drawer bukan perangkat yang perlu diintegrasikan. Ia adalah efek samping dari perintah ke printer. Konsekuensinya:
- Tidak ada driver cash drawer, tidak ada deteksi perangkat, tidak ada penanganan koneksi terpisah.
- **Tidak ada cara mengetahui apakah laci benar-benar terbuka.** Sinyalnya satu arah. Sistem tidak bisa mendeteksi laci yang dibuka manual dengan kunci — celah anti-fraud yang harus diketahui dan tidak bisa ditutup dengan software.
- Konsekuensi anti-fraud: setiap pembukaan laci **yang diperintahkan sistem** harus dicatat di audit trail dengan siapa dan mengapa (penjualan tunai, no-sale, koreksi). Pembukaan manual tidak terdeteksi — merchant harus tahu ini.
- Fitur "buka laci tanpa penjualan" (*no sale*) adalah operasi berotorisasi yang wajib masuk audit trail. Ini pola fraud kasir paling dasar.

---

## 4. Barcode scanner

`[INFERENSI]` Scanner barcode adalah perangkat paling mudah dari semuanya dan sering di-over-engineer. Mayoritas scanner USB beroperasi sebagai **HID keyboard**: mereka "mengetik" isi barcode diikuti Enter. Tidak butuh driver, tidak butuh integrasi, jalan di semua platform termasuk browser.

Yang perlu ditangani aplikasi:
- **Deteksi input scanner vs ketikan manusia** — scanner mengetik jauh lebih cepat (biasanya < 30 ms antar karakter). Heuristik kecepatan + terminator Enter cukup andal.
- **Fokus input** — barcode bisa dipindai kapan saja; layar kasir harus punya listener global, bukan mengandalkan field yang sedang fokus.
- **Scanner Bluetooth** — sama saja dari sisi aplikasi (tetap HID), tapi punya masalah pairing dan baterai yang menjadi beban support.
- **Scanner 2D untuk QRIS** — beberapa merchant memakai scanner 2D untuk memindai QR pelanggan. Ini alur berbeda (POS memindai pelanggan, bukan sebaliknya) dan harus diputuskan apakah didukung.

`[ASUMSI]` Tidak ada kebutuhan mode SDK/serial untuk scanner di v1. Mode HID keyboard menutupi hampir semua kasus retail Indonesia.

---

## 5. Customer-facing display

`[INFERENSI]` Tiga pola yang mungkin, dengan biaya sangat berbeda:

| Pola | Cara kerja | Biaya | Catatan |
|---|---|---|---|
| **Layar kedua dari device kasir** | Monitor/tablet kedua terhubung ke device kasir, menampilkan halaman berbeda dari aplikasi yang sama | Murah (monitor bekas) | Paling sederhana; butuh dukungan multi-window di Tauri |
| **Device terpisah di jaringan lokal** | Tablet murah menjalankan mode "display", menerima update lewat LAN | Sedang | Butuh transport lokal — sama dengan kebutuhan KDS (Fase 5). Bangun bersamaan |
| **VFD/LCD pole display serial** | Perangkat khusus 2×20 karakter lewat serial | Murah tapi terbatas | Umum di minimarket lama; hanya bisa menampilkan teks |

`[INFERENSI]` Customer display dan KDS memiliki kebutuhan teknis yang **identik**: satu device menampilkan state yang dikendalikan device lain di jaringan lokal yang sama, harus bekerja tanpa internet. Keduanya harus dibangun di atas mekanisme transport lokal yang sama (KEP-20, v1.1). Membangunnya terpisah adalah duplikasi.

Design system sudah menyediakan komponen untuk KDS (`Ticket`, `.kds-scale`) tapi **tidak** untuk customer display — ini gap yang perlu diketahui sebelum fitur direncanakan.

---

## 6. Timbangan (retail)

`[FAKTA]` Toast mencantumkan "Use scales for weighted menu items" sebagai operasi yang **tersedia saat offline** — menandakan timbangan terhubung lokal ke device, bukan lewat cloud.

*Sumber: [Offline mode with local sync — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) (27 Jul 2026)*

`[ASUMSI]` Timbangan retail Indonesia umumnya terhubung lewat serial (RS-232) atau USB-serial, mengirim berat sebagai teks dengan protokol yang berbeda per merek. Sebagian besar toko kecil memakai timbangan berdiri sendiri dan kasir mengetik berat manual.

`[INFERENSI]` **Rekomendasi: tidak masuk v1.** Alasannya bukan kompleksitas teknis (integrasi serial sederhana) melainkan **fragmentasi protokol** yang membuat setiap merek timbangan menjadi proyek integrasi sendiri, dengan pengujian yang membutuhkan perangkat fisik. Yang harus disiapkan v1: `quantity` sebagai `numeric` bukan `integer` (sudah ditetapkan di Fase 4), sehingga input berat manual sudah didukung penuh.

---

## 7. Realitas hardware pasar Indonesia

`[FAKTA]` Harga yang ditemukan per Juli 2026 di kanal ritel Indonesia:

| Perangkat | Kisaran harga | Contoh terverifikasi |
|---|---|---|
| Printer thermal 58mm USB | Rp235.000 – Rp530.000 | IWARE Z58D USB 58mm: **Rp235.000** · Codeshop CBT-58ii Bluetooth: **Rp530.000** |
| Printer thermal 58mm Bluetooth | ~Rp325.000 | IWARE MP-58XL: **Rp325.000** |
| Printer thermal 80mm WiFi + autocutter | ~Rp890.000 | |
| Barcode scanner (USB / Bluetooth) | Rp312.000 – Rp798.000 | |
| Mesin kasir terintegrasi (cash register + printer 58mm) | Rp4.576.500 – Rp4.700.000 | Olympia CM802SD |

*Sumber: [Printer Thermal 58mm Bluetooth Codeshop CBT-58ii — Codeshop Indonesia](https://codeshop.co.id/product/printer-thermal-58mm-bluetooth-cdoeshop-cbt-58ii/) · [Jual Printer Thermal 58mm — Tokopedia (harga Juli 2026)](https://www.tokopedia.com/find/printer-thermal-58mm) · [Harga 58 thermal printer Terbaru Jul 2026 — BigGo Indonesia](https://biggo.id/s/58%20thermal%20printer) · [Jual Scanner Kasir — Tokopedia](https://www.tokopedia.com/find/scanner-kasir) · [Paket Alat Kasir — Grosir Mesin Kasir](https://grosirmesinkasir.com/p/paket-alat-kasir-printer-kasir-usbcash-drawerscanner-barcode-1d1672908040) (semua diakses 27 Jul 2026)*

### KEP-28 — Model hardware

**Pertanyaan:** Apakah Lumi POS menjual/mensyaratkan hardware, atau mendukung hardware yang sudah dimiliki merchant?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Hardware-locked (model Toast) | Kendali penuh atas pengalaman; pengujian terbatas pada perangkat yang diketahui; margin hardware | `[FAKTA]` Toast menyatakan layanan hanya berfungsi pada hardware yang disetujui. **Mustahil di Indonesia** — printer Rp235.000 tersedia bebas dan merchant sudah punya. Butuh rantai pasok, gudang, garansi, RMA | Pasar dengan margin tinggi dan ekspektasi bundling |
| B. Hardware-agnostic dengan daftar rekomendasi terverifikasi | Hambatan masuk terendah; merchant memakai yang sudah ada; nol biaya rantai pasok | Permukaan pengujian tidak terbatas — printer generik dengan firmware tidak terprediksi. Tiket support "printer saya tidak jalan" akan menjadi kategori terbesar | Pasar sensitif harga dengan hardware yang mudah didapat |
| C. Hardware-agnostic + program "Sertifikasi Lumi" (daftar model yang diuji dan dijamin) | Kombinasi keduanya: merchant bebas memilih, tapi ada jalur yang dijamin. Support bisa mengarahkan ke daftar terverifikasi | Butuh membeli dan menguji perangkat secara berkala; daftar harus dipelihara | Produk komersial yang ingin membatasi beban support tanpa mengunci merchant |

**Rekomendasi:** Opsi C. `[INFERENSI]`

**Alasan:** Opsi A tidak tersedia — struktur pasar Indonesia menghalanginya, dan mencoba menerapkannya akan menghentikan penjualan sebelum dimulai. Opsi B murni akan menghasilkan beban support yang tidak terkendali untuk satu orang: setiap merek printer generik adalah kemungkinan tiket support dengan perangkat yang tidak bisa direproduksi. Opsi C menempatkan biaya di tempat yang bisa dikendalikan: membeli 5–8 model printer yang paling umum di Tokopedia (total di bawah Rp5 juta), mengujinya, dan menerbitkan daftar "Diuji dengan Lumi POS". Merchant di luar daftar tetap didukung *best-effort*, dan support punya jawaban yang jelas.

**Yang harus disiapkan agar C berfungsi:**
- Profil printer sebagai data, sehingga menambah model baru = menambah konfigurasi (dari bagian 1.2).
- **Halaman uji cetak** di aplikasi yang mencetak semua kasus (teks, karakter Indonesia, simbol Rp, angka tabular, garis, cut, kick drawer) sehingga merchant bisa memverifikasi sendiri dan mengirim hasilnya ke support.
- Deteksi otomatis lebar kertas dari hasil uji, bukan mengandalkan merchant memilih dengan benar.

**Kapan keputusan ini harus ditinjau ulang:** jika tiket support hardware melewati ~20% dari total tiket, pertimbangkan mempersempit daftar dukungan resmi atau menawarkan bundle hardware dari reseller partner (tanpa memegang inventaris sendiri).

---

## 8. Perbedaan akses perangkat antar platform

| Perangkat | Browser (Chrome/Edge) | Tauri Desktop (Win/macOS/Linux) | Tauri Android | Tauri iOS |
|---|---|---|---|---|
| Printer USB | WebUSB — **gagal di Windows** | ✅ Penuh via Rust | ⚠️ Butuh izin USB host; bervariasi per perangkat | ❌ Praktis tidak mungkin |
| Printer Bluetooth | Web Bluetooth (terbatas, butuh gesture) | ✅ Penuh | ✅ Penuh | ⚠️ Terbatas (MFi) |
| Printer network (TCP:9100) | ❌ (browser tidak bisa raw TCP) | ✅ Penuh | ✅ Penuh | ✅ Penuh |
| Cash drawer | Via printer | Via printer | Via printer | Via printer |
| Barcode scanner (HID) | ✅ Penuh | ✅ Penuh | ✅ Penuh | ⚠️ Butuh keyboard eksternal |
| Kamera sebagai scanner | ✅ getUserMedia | ✅ | ✅ | ✅ |
| Timbangan serial | Web Serial (terbatas) | ✅ Penuh | ⚠️ USB-serial via OTG | ❌ |

`[INFERENSI]` **Dua kesimpulan dari tabel ini:**

**Pertama — printer network adalah satu-satunya jalur yang berfungsi di semua platform.** Ini argumen kuat untuk merekomendasikannya sebagai konfigurasi utama meskipun harganya lebih tinggi (~Rp890.000 vs ~Rp235.000). Selisih Rp655.000 sekali bayar menghilangkan seluruh kelas masalah kompatibilitas platform.

**Kedua — iOS secara efektif tidak cocok untuk kasir dengan printer USB.** Ini memperkuat rekomendasi Fase 3 untuk menunda mobile: kalaupun mobile dibangun, targetnya Android (tablet kasir Indonesia hampir seluruhnya Android), dan iOS lebih cocok sebagai aplikasi owner/manajer yang tidak mencetak.

---

## 9. Rekomendasi lapisan abstraksi hardware

`[INFERENSI]` Bentuk yang direkomendasikan — satu port, implementasi per platform, profil per perangkat:

```
Aplikasi (React, agnostik platform)
        │
        ▼
  ┌──────────────────────────────────────┐
  │  PeripheralPort (antarmuka tunggal)  │
  │   printReceipt(document, profile)    │
  │   openCashDrawer()                   │
  │   onBarcodeScanned(callback)         │
  │   listDevices() / testDevice()       │
  └──────────────┬───────────────────────┘
                 │
   ┌─────────────┼─────────────┬──────────────┐
   ▼             ▼             ▼              ▼
TauriAdapter  NetworkAdapter  WebUSBAdapter  NoopAdapter
(Rust: USB,   (TCP :9100 —    (fallback,     (mode demo /
 serial, BT)   semua platform)  non-Windows)   tanpa hardware)
                 │
                 ▼
        ┌──────────────────────┐
        │  ReceiptDocument     │  ← struktur abstrak, bukan byte ESC/POS
        │  (baris, gaya, cut,  │
        │   drawer, logo)      │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │  EscPosRenderer      │  ← memakai PrinterProfile (data)
        │  + PrinterProfile    │     lebar, codepage, cutter,
        └──────────────────────┘     perintah drawer, dukungan gambar
```

**Prinsip yang harus dijaga:**
1. **Aplikasi tidak pernah menghasilkan byte ESC/POS.** Ia menghasilkan `ReceiptDocument` yang deskriptif. Renderer yang menerjemahkannya. Tanpa pemisahan ini, mendukung printer fiskal Italia (Fase 6) atau format struk baru berarti menyentuh layar kasir.
2. **PrinterProfile adalah data**, disimpan bersama konfigurasi outlet dan bisa diedit tanpa rilis aplikasi.
3. **Setiap operasi hardware punya timeout dan mode gagal yang eksplisit.** Printer yang kehabisan kertas tidak boleh menggantung layar kasir. Penjualan **harus tetap tersimpan** meskipun cetak gagal — struk bisa dicetak ulang, penjualan yang hilang tidak bisa dipulihkan. Ini urutan operasi yang sering salah: cetak dulu lalu simpan adalah bug.
4. **Cetak ulang adalah fitur kelas satu**, bukan afterthought. Kegagalan printer adalah kejadian harian.

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Requirement sistem harus menyatakan: kasir produksi memakai aplikasi desktop (Tauri), bukan browser, karena batasan akses printer di Windows. Browser didukung untuk back-office dan dashboard owner.
- Printer network direkomendasikan sebagai konfigurasi utama dengan alasan yang dijelaskan ke merchant (bekerja di semua perangkat, bisa dipakai bersama).
- Butuh requirement "halaman uji cetak" sebagai bagian dari onboarding merchant, bukan fitur tersembunyi di pengaturan.
- Cetak ulang struk dan penanganan cetak gagal butuh user story sendiri: penjualan tersimpan meskipun cetak gagal, dan ada antrean cetak yang bisa diulang.
- "Buka laci tanpa penjualan" (no sale) adalah operasi berotorisasi dengan alasan wajib, sejajar dengan void dan diskon.
- Non-goal v1 yang harus dinyatakan: timbangan terintegrasi, customer display, scanner mode SDK.

**Untuk Information Architecture:**
- Layar "Perangkat" di pengaturan outlet: daftar perangkat terhubung, profil printer, uji cetak, status koneksi terakhir.
- Antrean cetak yang gagal butuh tempat — kemungkinan digabung dengan layar Status Sinkronisasi (Fase 5) sebagai "hal yang tertunda", karena keduanya adalah kegagalan yang merchant harus tahu dan bisa perbaiki.
- Customer display tidak punya komponen di design system — jika direncanakan, ini gap yang harus diangkat.

**Untuk ERD:**
- `Device` (perangkat kasir): `id`, `outlet_id`, `code` (`K1`), `platform`, `app_version`, `last_seen_at`.
- `Peripheral`: `id`, `device_id` atau `outlet_id` (untuk printer network yang dibagi), `type` (printer/drawer/scanner/display), `connection` (usb/bluetooth/network), `address`, `printer_profile_id`.
- `PrinterProfile`: `id`, `name`, `paper_width_mm`, `chars_per_line`, `codepage`, `has_cutter`, `cut_command`, `drawer_command`, `image_support`, `init_command`.
- `PrintJob` untuk antrean cetak: `id`, `order_id`, `peripheral_id`, `document` (jsonb), `status`, `attempts`, `last_error`.
- `AuditEvent` harus mencakup `cash_drawer_opened` dengan alasan dan aktor.

**Untuk Technical Architecture:**
- `PeripheralPort` sebagai port resmi dengan empat adapter, sejajar dengan port pajak dan pembayaran dari Fase 6.
- Aturan invariant: **simpan penjualan sebelum mencetak, selalu.** Cetak adalah efek samping yang boleh gagal.
- `ReceiptDocument` sebagai struktur perantara yang memisahkan konten struk dari protokol printer — prasyarat untuk dukungan printer fiskal di masa depan.
- Kode Rust untuk akses perangkat adalah satu-satunya bagian sistem yang tidak TypeScript; batasnya harus sempit dan antarmukanya stabil agar biaya pemeliharaan dua bahasa tetap kecil.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `08-SECURITY-AND-COMPLIANCE.md`.*
