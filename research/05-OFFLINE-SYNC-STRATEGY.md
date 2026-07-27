# 05 — Strategi Offline-First & Sinkronisasi

> Fase 5 dari 12. Tanggal riset: 27 Juli 2026.
> **Area risiko tertinggi produk.** Digarap paling dalam sesuai instruksi riset.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Temuan terpenting seluruh riset: Toast — perusahaan POS publik dengan ribuan engineer — TIDAK menyediakan berbagi order antar terminal saat offline.** Bahkan pada mode paling canggih mereka ("offline mode with local sync" dengan hub device di LAN), dokumentasi resmi menyatakan: *"orders sent from one POS device cannot be seen on another device unless it is a KDS device"*, dan mereka **merekomendasikan setiap karyawan memilih satu device** dan hanya memakai device itu selama offline. Jika Toast memilih batas ini, ambisi "offline penuh lintas device" untuk Lumi POS harus dievaluasi ulang secara serius. (→ KEP-20)

2. **Sinkronisasi berbasis event domain append-only, bukan CRDT dan bukan last-write-wins.** Keputusan KEP-17 (penjualan append-only) sudah menghilangkan sebagian besar konflik sebelum terjadi: dua `INSERT` tidak pernah konflik. Yang tersisa hanyalah data mutable — katalog dan pengaturan — yang konfliknya jarang dan bisa ditangani dengan LWW + hybrid logical clock. (→ KEP-21)

3. **Konflik stok bukan masalah teknis, melainkan keputusan bisnis yang harus dibuat terlihat.** Dua device offline yang menjual item terakhir akan sama-sama berhasil; ini konsekuensi CAP, bukan bug. Sistem harus mendeteksi, melaporkan, dan meminta manusia menyelesaikannya — bukan berpura-pura mencegahnya. (→ KEP-22)

4. **Penomoran offline sudah terpecahkan oleh design system.** Format `K1-20260726-0007` dengan prefiks device membuat nomor bebas bentrok tanpa koordinasi. Ini lebih baik daripada solusi Toast (rentang blok berbasis nomor device × 1000) karena tidak punya batas atas dan tidak menghasilkan lompatan nomor yang membingungkan.

5. **Batas offline Lumi POS ditetapkan secara eksplisit dan konservatif: satu device = satu unit otonom penuh.** Sinkronisasi antar device dalam outlet ditawarkan sebagai *best-effort* lewat LAN, bukan janji. Merchant diberi tahu batasnya sebelum membeli, bukan sesudah. (→ KEP-23)

---

## 1. Kerangka: apa yang sebenarnya diminta "offline-first"

`[FAKTA]` Manifesto Ink & Switch mengusulkan tujuh ideal untuk local-first software: **Fast** (operasi merespons tanpa network round-trip), **Multi-device** (data tersinkron lintas device pengguna), **Offline** (baca dan tulis tanpa koneksi), **Collaboration** (banyak pengguna bekerja pada data yang sama secara bersamaan), **Longevity** (data tetap bisa diakses meski vendor berhenti beroperasi), **Privacy** (enkripsi end-to-end), **User control** (vendor tidak bisa membatasi akses pengguna ke datanya).
`[FAKTA]` Manifesto tersebut mengidentifikasi CRDT sebagai fondasi teknis yang menjanjikan untuk aplikasi local-first.
`[FAKTA]` Elemen kunci desain local-first: salinan primer berada di device tempat aplikasi membaca dan menulis ke **database lokal alih-alih ke HTTP endpoint**, dengan lapisan sync yang mengamati database lokal dan mengirim perubahan ke server atau peer setiap kali koneksi tersedia.

*Sumber: [Local-first software: You own your data, in spite of the cloud — Ink & Switch](https://www.inkandswitch.com/essay/local-first/) · [Local-First Software — PowerSync Documentation](https://docs.powersync.com/resources/local-first-software) · [Local-First Software: Origins And Evolution — PowerSync](https://powersync.com/blog/local-first-software-origins-and-evolution) (semua diakses 27 Jul 2026)*

`[INFERENSI]` Dari tujuh ideal ini, POS **tidak membutuhkan semuanya**, dan kejelasan tentang mana yang tidak dibutuhkan menghemat pekerjaan berbulan-bulan:

| Ideal | Dibutuhkan Lumi POS? | Catatan |
|---|---|---|
| Fast | **Ya, mutlak** | Kasir tidak boleh menunggu network round-trip untuk menambah item ke keranjang |
| Offline | **Ya, mutlak** | Alasan utama produk ini ada |
| Multi-device | Ya, tapi **eventual, bukan real-time saat offline** | Inilah keputusan yang dibahas di KEP-20 |
| Collaboration | **Tidak dalam bentuk kolaboratif** | Dua kasir tidak mengedit dokumen yang sama. Mereka membuat transaksi terpisah. **Ini menghilangkan kebutuhan CRDT teks/list sepenuhnya** |
| Longevity | Sebagian | Relevan untuk opsi self-hosted (Fase 9) |
| Privacy (E2E) | **Tidak** | Merchant justru menginginkan server bisa membaca data mereka untuk laporan dan support |
| User control | Sebagian | Ekspor data adalah kebutuhan nyata; E2E bukan |

**Kesimpulan yang menghemat paling banyak:** karena POS bukan aplikasi kolaboratif (tidak ada dua orang mengedit objek yang sama secara bersamaan), **kebutuhan CRDT yang kompleks — RGA, Logoot, sequence CRDT — tidak ada.** Yang tersisa hanyalah konvergensi pada data skalar, yang jauh lebih sederhana.

---

## 2. Bukti lapangan: bagaimana Toast mendefinisikan batas offline-nya

Bagian ini adalah temuan riset terpenting dan disajikan dengan detail penuh karena mengubah asumsi dasar produk.

`[FAKTA]` Toast memiliki **dua** mode offline yang berbeda:
- **Offline mode (legacy)** — "Toast devices communicate with each other **through** the Toast platform cloud-based services." Konsekuensinya dinyatakan eksplisit: *"If the restaurant cannot communicate with the Toast cloud, the devices cannot communicate with each other."*
- **Offline mode with local sync** — memakai satu device Toast sebagai **local hub device** yang menjadi titik koneksi antar semua device di jaringan lokal restoran. Hub merelay update dari satu device ke device lain dan ke cloud Toast. Mode ini **bergantung pada koneksi jaringan lokal untuk berfungsi**.

`[FAKTA]` **Syarat local hub device:**
- Bukan perangkat hand-held, bukan Elo V1.
- Memakai koneksi **Ethernet berkabel**.
- Terhubung ke jaringan lokal restoran.
- Aktif — menerima ping dari Toast dalam tiga menit terakhir.
- Dipilih **otomatis oleh Toast**; support Toast bisa memindahkan penunjukan.

`[FAKTA]` **Batasan hub yang dinyatakan sebagai Caution di dokumentasi:** satu local hub hanya bisa berkomunikasi dengan device di jaringan lokal yang sama, dan **satu restoran hanya boleh punya satu local hub device**. Jika ada beberapa jaringan lokal atau subnet, informasi tidak bisa dibagi antar keduanya saat offline. Contoh yang diberikan Toast: dua ToastGo di jaringan terpisah tidak bisa mengirim informasi ke/dari local hub atau satu sama lain saat offline.

`[FAKTA]` **Yang TIDAK tersedia bahkan pada offline mode with local sync:**
- *"Sharing orders between devices on the same local network that are not KDS devices. KDS devices will show all orders regardless of which device they were taken on."*
- Login atau logout ke aplikasi Toast POS — *"You will not be able to log back in until the connection is restored."*
- Clock in/clock out di device terpisah.
- Mode EMV kartu kredit (kartu harus di-swipe).
- Penjualan atau penggunaan gift card sebagai metode pembayaran.
- Penukaran poin loyalty sebagai metode pembayaran.
- House account dan customer credit sebagai metode pembayaran.
- Pencarian informasi tamu untuk order takeout/delivery.
- Akses data tamu dan laporan online; employee shift review.
- Pengiriman/penerimaan order di Kiosk.
- Pencetakan tiket dapur saat fulfilled atau on-demand dari KDS untuk order yang dibuat saat outage.
- Operasi *Resync Orders* dan *Resync ALL Data* dinonaktifkan — Toast menjelaskan alasannya: *"This prevents the erasure of stored information on the device, which means you would lose all sales data and payments without the ability to retrieve them."*

`[FAKTA]` **Yang tersedia offline dengan local sync:** menampilkan order POS & Kiosk di KDS pada jaringan lokal yang sama (jika dikonfigurasi); jika tidak memakai KDS, tiket dicetak di printer dapur; memakai timbangan untuk item per berat; **memproses kartu kredit sebagai offline payment**; menambahkan tip; membuka cash drawer (jika printer tersedia); mencetak struk pelanggan di terminal (jika printer tersedia).

`[FAKTA]` **Panduan operasional yang diberikan Toast kepada merchant** — daftar ini menunjukkan betapa rapuhnya state offline dalam praktik:
- **Jangan** uninstall/reinstall aplikasi Toast — *"Doing so permanently removes all stored data and payments from the device."*
- **Jangan** menutup paksa aplikasi.
- **Jangan** membersihkan cache device atau data aplikasi — konsekuensi sama: data dan pembayaran hilang permanen.
- **Jangan** login/logout.
- **Jangan** mematikan dan menyalakan router jaringan saat offline.
- **Jangan** memutus device dari jaringan lokal (termasuk keluar jangkauan wireless, airplane mode, atau pindah jaringan).
- **Tambah dan update order di device yang sama.** *"Toast recommends each employee choose a single device to place and update orders. More than one front of house employee can work on a device, but it is important that they use only that one device while offline."*
- Simpan salinan merchant dari struk yang ditandatangani tamu sebagai catatan pembayaran offline, **jika pembayarannya hilang**.
- Pertimbangkan memasang cellular network backup stick.
- Hubungi support Toast untuk menonaktifkan sementara proses auto-capture jika sistem belum tersambung kembali sampai akhir hari kerja.

`[FAKTA]` **Penomoran check offline Toast:** device tetap menghasilkan nomor check saat offline, dihitung dengan: (nomor device + 2) × 1000 = base check number, lalu increment dari sana. Contoh dari dokumentasi: device nomor 1 → check dimulai dari 3000. Setelah online kembali, penomoran check kembali dari posisi sebelum offline dan nomor mode offline tidak dipakai lagi.

`[FAKTA]` Banner offline muncul **setelah 40 detik** aktivitas offline, memberi informasi penyebab gangguan, apa yang bisa dan tidak bisa dilakukan, dan langkah penyelesaian.
`[FAKTA]` Praktik terbaik yang dianjurkan: tersambung kembali dalam **24–72 jam** untuk mengurangi risiko chargeback ketika pembayaran kartu offline sudah diambil.

*Sumber: [Offline mode with local sync — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) · [Offline mode — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html) · [Offline mode overview — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/adminOfflineModeOverview.html) · [Prepare to Operate in Offline Mode During Service Disruptions or Outages — Toast Central](https://central.toasttab.com/s/article/Offline-Mode-Setup-and-Configuration) (semua diakses 27 Jul 2026)*

### Apa artinya ini untuk Lumi POS

`[INFERENSI]` Empat kesimpulan yang mengubah rencana:

**Pertama — ambisi "offline penuh lintas device" lebih mahal dari yang diasumsikan siapa pun.** Toast tidak menyediakannya bukan karena tidak terpikir, melainkan karena biaya rekayasa dan permukaan kegagalannya besar. Mereka punya sumber daya untuk membangunnya dan memilih tidak. Perencanaan Lumi POS yang mengasumsikan ini "hanya masalah implementasi" adalah perencanaan yang salah.

**Kedua — pola arsitektur yang menang di lapangan adalah hub lokal, bukan mesh peer-to-peer.** Toast memilih satu device sebagai hub (dengan syarat Ethernet berkabel, bukan Wi-Fi). Lightspeed menjual appliance khusus (Lightserver). Tidak ada satu pun vendor besar yang membangun mesh peer-to-peer antar tablet. Ini konvergensi yang harus dihormati, bukan ditantang tanpa alasan kuat.

**Ketiga — daftar "jangan" milik Toast adalah peta risiko operasional yang bisa dipakai langsung.** Setiap larangan menandai satu titik kegagalan nyata: data hilang saat aplikasi di-uninstall, sesi tidak bisa dipulihkan setelah logout, KDS kehilangan tiket saat router direstart. Lumi POS akan menghadapi titik yang sama dan harus menanganinya lebih baik atau mendokumentasikannya sama jujurnya.

**Keempat — batasan "tidak bisa login saat offline" adalah target serangan yang jelas dan bisa dicapai.** Ini konsisten dengan temuan Odoo di Fase 1 (tidak bisa membuka sesi POS baru saat offline). Dua vendor besar punya kelemahan yang sama, penyebabnya sama (otentikasi bergantung server), dan solusinya diketahui (kredensial ter-cache + PIN terverifikasi lokal). Ini fitur pembeda yang biayanya sedang dan nilainya tinggi.

---

## 3. Strategi resolusi konflik

`[FAKTA]` Perbandingan pendekatan:
- **Last-write-wins (LWW)** telah diadopsi luas sebagai implementasi resolusi konflik berbasis operasi di level data, di mana operasi yang konflik diselesaikan dengan operator pengurutan global (mis. timestamp) dan perubahan yang lebih baru menang. **Namun** jika sekadar mengambil "tulisan terbaru", ada risiko kehilangan data karena timestamp di sistem terdistribusi bisa melenceng atau tiba tidak berurutan.
- **CRDT** adalah struktur data yang dibangun untuk menyelesaikan konflik secara otomatis dan tetap konvergen ke state yang sama lintas replika, terlepas dari urutan operasi.
- Dalam implementasi local-first praktis, sistem memakai **semantik LWW untuk field skalar dengan logical timestamp**, dan CRDT sejati (seperti Logoot atau RGA untuk sequence) hanya untuk collaborative text editing atau struktur list.
- Teknik rekonsiliasi yang membutuhkan koordinasi terpusat kurang cocok untuk skenario local-first, di mana replika harus terus maju secara independen pada salinan lokal.

`[FAKTA]` **Clock skew dan hybrid logical clock:**
- Clock skew dan ketiadaan sinkronisasi global membuat physical timestamp standar tidak memadai untuk pengurutan event yang presisi. NTP menjaga jam dalam beberapa milidetik pada hari baik, dan dalam beberapa ratus milidetik pada hari buruk. Skew maksimum tipikal dengan NTP: **100–250 ms**.
- **Hybrid Logical Clock (HLC)** tetap dekat dengan wall-clock time sambil menjamin pengurutan kausal seperti logical clock. HLC menggabungkan keterbacaan waktu jam dinding dengan kebenaran kausal Lamport Clock dalam satu timestamp 64-bit. Counter logis memutus seri ketika physical timestamp identik atau ketika pesan yang diterima punya physical timestamp di masa depan karena skew.
- HLC ideal untuk sistem yang butuh pengurutan berbasis timestamp tapi tidak bisa sepenuhnya mempercayai sinkronisasi jam fisik — dan merupakan **jalan tengah pragmatis yang dipakai mayoritas database terdistribusi modern**.

*Sumber: [Deciding between CRDTs and OT for data synchronization — Thom.ee](https://thom.ee/blog/crdt-vs-operational-transformation/) · [CRDTs and Local-First Architecture — DEV Community](https://dev.to/smallstack/crdts-and-local-first-architecture-how-smallstack-handles-offline-conflict-resolution-338c) · [CRDTs solve distributed data consistency challenges — Ably](https://ably.com/blog/crdts-distributed-data-consistency-challenges) · [Hybrid Logical Clock in Distributed Systems — Ajit Singh](https://singhajit.com/distributed-systems/hybrid-clock/) · [All Things Clock, Time and Order in Distributed Systems: Hybrid Logical Clock in Depth — Medium](https://medium.com/geekculture/all-things-clock-time-and-order-in-distributed-systems-hybrid-logical-clock-in-depth-7c645eb03682) · [Clock Offset vs Clock Skew in Distributed Networks — Baeldung](https://www.baeldung.com/cs/clock-offset-skew-difference) (semua diakses 27 Jul 2026)*

### KEP-21 — Mekanisme sinkronisasi & resolusi konflik

**Pertanyaan:** Bagaimana transaksi dan perubahan data yang dibuat saat offline direkonsiliasi ke server tanpa merusak akurasi finansial dan stok?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Last-write-wins per record | Paling sederhana; nol state tambahan | **Kehilangan diam-diam** pada update bersamaan. Bergantung pada timestamp yang bisa melenceng 100–250 ms bahkan dengan NTP — dan tablet kasir sering tidak ber-NTP sama sekali. Untuk stok, ini berarti penjualan hilang tanpa jejak | Data yang kehilangannya tidak berkonsekuensi (mis. preferensi UI) |
| B. CRDT counter untuk stok, CRDT map untuk entitas | Konvergen tanpa koordinasi; secara matematis terbukti | Kompleksitas tinggi dan sulit di-debug saat produksi. State metadata tumbuh terus (tombstone, versi per field). **Menyelesaikan masalah yang sebagian besar tidak ada** — POS bukan aplikasi kolaboratif | Beberapa terminal benar-benar menulis field yang sama secara bersamaan |
| C. Sync berbasis event domain: penjualan sebagai append-only log, stok sebagai proyeksi dari movement, LWW+HLC hanya untuk data mutable (katalog, setting) | Audit trail alami (sejalan KEP-17). **Konflik pada data transaksional menjadi mustahil secara struktural** — dua INSERT tidak konflik. Konflik yang tersisa menjadi ranah bisnis, bukan teknis, dan jumlahnya sedikit | Perlu disiplin desain event sejak awal. Konflik katalog tetap butuh penanganan | Sistem finansial dengan kebutuhan audit dan offline |

**Rekomendasi:** Opsi C. `[INFERENSI dari kombinasi: praktik append-only Square Books, temuan bahwa POS bukan aplikasi kolaboratif, dan realitas clock skew]`

**Alasan:** Keputusan append-only di KEP-17 sudah membuat pilihan ini hampir gratis — jika penjualan, void, dan refund semuanya `INSERT` dan tidak pernah `UPDATE`, maka tidak ada yang bisa konflik pada data yang paling penting. CRDT (Opsi B) memecahkan masalah kolaborasi bersamaan yang tidak dimiliki POS: dua kasir tidak mengetik pada order yang sama, mereka membuat order yang berbeda. Membayar kompleksitas CRDT untuk masalah yang tidak ada adalah kesalahan mahal. LWW murni (Opsi A) ditolak karena bergantung pada jam yang terbukti tidak bisa dipercaya pada 100–250 ms bahkan dalam kondisi baik.

**Detail penting yang menentukan keberhasilan:**
- **HLC dipakai untuk setiap record, bukan wall-clock.** Ini menyelesaikan masalah tablet kasir yang jamnya salah beberapa menit (umum, karena perangkat murah tanpa NTP). Tanpa HLC, transaksi bisa terurut salah di laporan.
- **Data mutable dibatasi seketat mungkin.** Semakin sedikit yang bisa di-`UPDATE`, semakin sedikit yang bisa konflik. Katalog dan pengaturan hampir selalu diedit dari dashboard (satu tempat, biasanya online), sehingga konflik nyata jarang — LWW+HLC cukup, dengan syarat konflik yang terdeteksi **dicatat** dan bisa dilihat, bukan diselesaikan diam-diam.
- **Kasus khusus yang butuh perlakuan berbeda:** `order` yang masih `OPEN` di F&B (meja yang belum bayar) **adalah** data mutable yang bisa disentuh dua device. Ini satu-satunya tempat di seluruh domain yang mendekati skenario kolaboratif — dan solusinya bukan CRDT melainkan **kepemilikan**: satu order dimiliki satu device sampai dilepas secara eksplisit. Ini persis yang dilakukan Toast dengan rekomendasi "satu karyawan, satu device".

**Kapan keputusan ini harus ditinjau ulang:** jika riset lapangan menunjukkan alur kerja nyata di mana dua kasir rutin mengedit satu order terbuka yang sama secara bersamaan **saat offline** (mis. resto besar dengan waiter berpindah terminal), model kepemilikan tidak cukup dan opsi B untuk entitas `order` saja menjadi perlu — bukan untuk seluruh sistem.

**Sumber:** [Deciding between CRDTs and OT — Thom.ee](https://thom.ee/blog/crdt-vs-operational-transformation/) (27 Jul 2026) · [Hybrid Logical Clock in Distributed Systems — Ajit Singh](https://singhajit.com/distributed-systems/hybrid-clock/) (27 Jul 2026) · [Books, an immutable double-entry accounting database service — Square](https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/) (27 Jul 2026)

---

## 4. Konflik stok dan harga

### 4.1 Stok — yang tidak bisa dijanjikan

`[INFERENSI]` Pernyataan yang harus masuk dokumen produk apa adanya: **stok yang akurat secara real-time dan penjualan offline penuh tidak bisa dimiliki bersamaan.** Ini teorema CAP, bukan kekurangan implementasi. Dua device offline yang menjual item terakhir akan sama-sama berhasil.

Yang bisa dan harus dilakukan:

| Mekanisme | Cara kerja | Kapan berguna |
|---|---|---|
| **Stok lokal per device sebagai proyeksi** | Setiap device menghitung stok dari movement yang diketahuinya (movement tersinkron terakhir + movement lokal) | Selalu — ini basis tampilan stok saat offline |
| **Buffer stok / ambang peringatan** | Merchant menetapkan ambang (mis. "peringatkan di bawah 5"). Saat offline, ambang dinaikkan otomatis karena ketidakpastian lebih besar | Mengurangi frekuensi oversell tanpa menghentikan penjualan |
| **Penandaan sold-out manual yang menyebar cepat** | Kasir menandai "habis" → menyebar ke device lain lewat LAN jika tersedia | Kafe: barista tahu kopi habis sebelum sistem tahu. Ini alur nyata yang lebih andal daripada hitungan otomatis |
| **Deteksi oversell pasca-sinkronisasi + laporan** | Setelah sinkron, sistem mendeteksi stok negatif, mencatat, dan menampilkan ke manajer dengan konteks (device mana, jam berapa) | Wajib — ini yang membuat konsekuensi terlihat alih-alih tersembunyi |

**Yang secara eksplisit TIDAK dijanjikan:** pencegahan oversell saat offline. Menjanjikannya berarti berbohong, dan merchant akan menemukan kebohongannya pada hari tersibuk mereka.

### 4.2 Harga

`[INFERENSI]` Konflik harga jauh lebih mudah dan sudah terselesaikan oleh KEP-19 (order line sebagai snapshot). Harga yang berlaku adalah harga yang ada di device pada saat transaksi, dan harga itu tersalin ke order line. Jika owner menaikkan harga saat device offline, transaksi offline memakai harga lama — dan **itu perilaku yang benar**, karena itulah harga yang tercetak di struk dan dibayar pelanggan.

Yang perlu ditangani: **jendela ketidaktahuan harus terlihat.** Device menampilkan kapan katalognya terakhir tersinkron. Manajer yang mengubah harga di dashboard harus melihat device mana yang belum menerima perubahan itu. Ini fitur UI, bukan masalah algoritma.

---

## 5. Penomoran transaksi offline

`[FAKTA]` Solusi Toast: (nomor device + 2) × 1000 sebagai base, lalu increment. Setelah online, penomoran kembali ke urutan sebelum offline dan nomor offline tidak dipakai lagi.
`[FAKTA]` Format design system Lumi: `K1-20260726-0007` = kode device + tanggal + urutan.

`[INFERENSI]` **Format Lumi lebih baik daripada solusi Toast**, dan alasannya layak dicatat:

| Aspek | Toast (blok numerik) | Lumi (prefiks device + tanggal) |
|---|---|---|
| Bebas bentrok tanpa koordinasi | Ya | Ya |
| Batas atas | **Ada** — device 1 punya rentang 3000–3999, jebol setelah 1.000 transaksi offline | **Tidak ada** — urutan direset harian, dan tanggal ada di dalam nomor |
| Keterbacaan asal | Butuh perhitungan mundur | **Langsung terbaca** — K1 = kasir 1, tanggal jelas |
| Kesinambungan | Nomor offline "dibuang" setelah online — dua rangkaian nomor berbeda | **Satu rangkaian** untuk online dan offline |
| Deteksi anomali | Sulit | Lubang nomor per device per hari mudah dideteksi |

Aturan yang harus ditegakkan agar properti ini bertahan (diulang dari Fase 4 karena kritis):
- Kode device (`K1`, `K2`, …) dialokasikan **sekali saat provisioning** dan tersimpan di device. Dua device dengan kode sama di satu outlet = kegagalan katastrofik. Pencegahannya di alur provisioning: server menolak mengaktifkan device kedua dengan kode yang sudah dipakai di outlet yang sama.
- Counter direset harian, disimpan lokal, **tidak pernah diminta ke server**.
- Nomor struk adalah identitas manusia; primary key internal tetap ULID client-generated.
- Lubang nomor (0007 lalu 0009 karena 0008 di-void sebelum tersinkron) **harus ditampilkan di laporan audit**, bukan disembunyikan.

---

## 6. Durasi offline yang realistis

`[FAKTA]` Toast: banner muncul setelah **40 detik**; praktik terbaik tersambung kembali dalam **24–72 jam** untuk mengurangi risiko chargeback pada pembayaran kartu offline; jika belum tersambung sampai akhir hari kerja, merchant disarankan menghubungi support untuk menonaktifkan auto-capture.

`[INFERENSI]` Untuk Lumi POS, durasi offline harus dipecah per kapabilitas — bukan satu angka:

| Kapabilitas | Batas realistis | Yang membatasi |
|---|---|---|
| Menjual dengan pembayaran tunai | **Tidak terbatas** (dibatasi kapasitas storage device) | Hanya ruang disk. Ini yang harus dijanjikan |
| Menampilkan stok yang berguna | ~1 hari | Setelah itu drift dari device lain terlalu besar untuk dipercaya |
| Membuka shift baru | **Tidak terbatas** | Butuh kredensial ter-cache — ini pembeda utama vs Toast & Odoo |
| Refund transaksi lama | Terbatas oleh jendela riwayat lokal | Berapa lama riwayat direplikasi ke device — keputusan produk, rekomendasi **90 hari** |
| Pembayaran QRIS | **0 detik** | Butuh konfirmasi issuer. Tidak mungkin, titik |
| Pembayaran kartu via EDC terpisah | Tidak terbatas (EDC punya jalur sendiri) | Tapi rekonsiliasi manual dibutuhkan |
| Menerima order dari GoFood/GrabFood | **0 detik** | Cloud-only secara definisi |

`[ASUMSI]` Rekomendasi kapasitas storage device: menyimpan 90 hari riwayat transaksi + katalog penuh untuk outlet 5.000 SKU membutuhkan **kurang dari 500 MB** SQLite untuk merchant tipikal. Angka ini harus diverifikasi dengan data nyata sebelum dijanjikan — dicatat sebagai open question.

---

## 7. Sinkronisasi antar device dalam outlet tanpa internet

Ini pertanyaan tersulit dan termahal di seluruh produk.

### KEP-20 — Arsitektur sinkronisasi intra-outlet saat offline

**Pertanyaan:** Ketika internet mati, apakah dua tablet kasir dan satu layar KDS di outlet yang sama tetap bisa saling melihat data?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Tidak ada sinkronisasi lokal — setiap device otonom sepenuhnya | Paling sederhana, paling andal, nol permukaan kegagalan tambahan. **Ini yang dilakukan Toast pada mode legacy-nya** | KDS tidak menerima tiket saat offline — untuk resto dine-in ini berarti dapur berhenti. Order tidak bisa dipindah antar device | Kafe takeaway single-terminal; retail |
| B. Hub device terpilih di LAN (pola Toast "local sync") | Terbukti di produksi oleh vendor terbesar. KDS tetap menerima tiket. Tidak butuh hardware tambahan | Kompleksitas election/failover. `[FAKTA]` Toast mensyaratkan hub memakai **Ethernet berkabel** dan tidak boleh handheld — syarat yang tidak selalu bisa dipenuhi outlet Indonesia. Satu subnet saja. Bahkan Toast **tidak membagi order antar POS device** lewat hub — hanya ke KDS | Outlet dengan LAN stabil dan minimal satu device tetap |
| C. Appliance lokal khusus (pola Lightspeed "Lightserver") | Paling andal — server sungguhan, bukan tablet yang bisa dimatikan. Bisa menyimpan seluruh state outlet | Menambah SKU hardware yang harus dijual, dikirim, di-support, dan di-update. Biaya modal untuk merchant. **Mengubah model bisnis dari software menjadi software+hardware** | Segmen enterprise dengan margin yang menanggungnya |
| D. Mesh peer-to-peer antar semua device | Tidak ada single point of failure | **Tidak ada vendor besar yang melakukannya.** Kompleksitas discovery, partisi jaringan, dan konvergensi sangat tinggi. Debugging di lapangan hampir mustahil | Tidak pernah, pada tahap ini |

**Rekomendasi:** **Opsi A untuk v1, dengan Opsi B sebagai v1.1 yang cakupannya sengaja dipersempit ke KDS saja.** `[INFERENSI dari batas yang dipilih Toast dan Lightspeed]`

**Alasan:** Bukti lapangan sangat kuat dan searah. Toast — dengan sumber daya yang jauh melampaui proyek ini — memilih untuk **tidak** membagi order antar POS device bahkan pada mode local sync mereka; satu-satunya hal yang dibagikan lewat hub adalah tiket ke KDS. Lightspeed memilih menjual appliance daripada membangun mesh. Ketika dua vendor besar secara independen menarik garis di tempat yang sama, garis itu kemungkinan besar ada karena alasan struktural, bukan kemalasan.

Ini juga sejalan dengan cakupan v1 di Fase 2: KDS dan table management **tidak masuk v1**. Tanpa KDS, kebutuhan sinkronisasi intra-outlet saat offline hampir hilang — kafe takeaway dengan satu atau dua terminal yang masing-masing otonom bisa beroperasi penuh. Menunda opsi B ke v1.1 berarti membangunnya bersamaan dengan KDS, ketika kebutuhannya nyata dan bisa diuji dengan merchant sungguhan.

**Yang dibayar, dinyatakan langsung:** di v1, jika outlet punya dua terminal dan internet mati, **order yang dibuat di terminal 1 tidak terlihat di terminal 2.** Untuk kafe takeaway ini tidak masalah. Untuk resto dine-in ini masalah besar — dan itulah sebabnya resto dine-in bukan target v1. Batas ini harus tertulis di materi penjualan, bukan ditemukan merchant sendiri.

**Kapan keputusan ini harus ditinjau ulang:** saat merchant dine-in menjadi porsi signifikan dari pipeline penjualan, atau saat ada permintaan berulang untuk KDS yang bekerja offline. Pada titik itu opsi B dibangun dengan cakupan sempit (hub → KDS saja), dan hanya diperluas ke berbagi order antar POS jika ada bukti kebutuhan yang jelas.

**Sumber:** [Offline mode with local sync — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) (27 Jul 2026) · [Offline mode — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html) (27 Jul 2026) · [Lightspeed Restaurant POS Review 2026 — POS USA](https://www.posusa.com/lightspeed-restaurant-pos-review/) (27 Jul 2026)

---

## 8. Sync engine siap pakai versus membangun sendiri

Melanjutkan KEP-13 dari Fase 3 dengan keputusan penuh.

`[FAKTA]` Ringkasan yang relevan (detail dan sumber di Fase 3 § 9):
- **PowerSync** menyediakan sync bidirectional penuh dengan **upload queue persisten** di klien; SQLite di sisi klien; Open Edition self-hosted gratis di bawah Functional Source License; client SDK Apache-2.0; sync service adalah aplikasi Node.js memakai fork pgwire + RSocket over WebSocket.
- **ElectricSQL (electric-next)** adalah sync **read-path** — penulisan tetap lewat backend API sendiri; open source; rebuild besar Juli 2024.
- **Replicache** framework sync JavaScript dengan optimistic UI dan resolusi konflik.

### KEP-22 — Sync engine: pakai atau bangun

**Pertanyaan:** Apakah lapisan sinkronisasi dibangun sendiri atau memakai engine yang ada?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. PowerSync Open Edition untuk seluruh sinkronisasi | Menyelesaikan bagian tersulit (upload queue persisten, retry, checkpoint, partial sync lewat Sync Rules) dengan kode yang sudah diuji produksi. SQLite klien sejalan KEP-11. Semua client SDK tersedia di Open Edition. Self-host = jalur on-premise jelas | **FSL bukan lisensi OSI** — risiko hukum harus diverifikasi. Ketergantungan vendor tunggal pada komponen paling kritis. Komponen Node.js tambahan di paket on-premise. Dashboard & alerting tidak ada di Open Edition (harus dibangun sendiri dari status API) | Offline-first bidirectional dengan sumber daya engineering terbatas |
| B. Bangun sendiri seluruhnya | Kendali penuh, nol lisensi pihak ketiga, bisa dioptimalkan untuk semantik POS | Pekerjaan berbulan-bulan pada kelas bug tersulit: reordering, duplikasi saat retry, partial failure, clock skew. **Bug di sini = uang merchant hilang**. Ini bukan tempat untuk belajar | Semantik domain tidak bisa diekspresikan engine generik |
| C. Hybrid: PowerSync untuk replikasi **turun** (server→device: katalog, harga, pengaturan, riwayat); antrean upload **naik** dibangun sendiri di atas tabel outbox lokal + endpoint idempoten | Bagian turun (yang generik dan tidak berisiko) memakai kode teruji. Bagian naik (yang butuh semantik POS: idempotency, penomoran, otorisasi, urutan) sepenuhnya dikendalikan dan bisa di-debug. Mengurangi ketergantungan lisensi pada jalur yang menyentuh uang | Dua mekanisme untuk dipahami dan di-monitor. Sebagian nilai PowerSync tidak terpakai | Ada satu bagian domain dengan semantik khusus dan sisanya generik |

**Rekomendasi:** Opsi C. `[INFERENSI]`

**Alasan:** Pembagiannya mengikuti garis risiko, bukan garis teknologi. Replikasi **turun** adalah masalah yang benar-benar generik — mengirim baris katalog dari PostgreSQL ke SQLite tidak punya semantik POS khusus, dan Sync Rules PowerSync menangani partial sync (hanya katalog outlet ini, hanya riwayat 90 hari) yang jika dibangun sendiri akan memakan waktu lama. Jalur **naik** punya semantik yang sangat spesifik: idempotency key dengan retensi 30 hari, penomoran struk dengan prefiks device, validasi otorisasi server-side, dan penanganan oversell — semuanya adalah aturan bisnis, bukan mekanisme sinkronisasi. Menempatkannya di endpoint API biasa yang idempoten (KEP-16) membuatnya bisa di-test, di-log, di-debug, dan di-versioning dengan tooling biasa. Ini juga membatasi paparan lisensi FSL: jalur yang membawa uang tidak melewati kode pihak ketiga.

**Konsekuensi yang harus diterima:** klien punya dua mekanisme — PowerSync untuk data turun, antrean outbox lokal untuk data naik — dan status keduanya harus digabung menjadi satu tampilan untuk UI (`SyncIndicator` di design system dengan state ok/queued/failed/offline-only). Ini pekerjaan nyata tapi kecil, dan justru memberi kendali penuh atas pesan yang diminta design system (*"Offline · 3 menunggu"*, *"Gagal kirim (2) · Coba lagi"*) — pesan yang tidak akan tersedia dari engine generik mana pun.

**Yang harus diverifikasi manusia sebelum berkomitmen:** teks Functional Source License PowerSync (masuk `12-OPEN-QUESTIONS.md`, prioritas tinggi). Jika FSL ternyata menghalangi distribusi dalam paket on-premise komersial, Opsi C tetap bisa dijalankan dengan mengganti sisi turun dengan implementasi sendiri — dan karena sisi turun jauh lebih sederhana daripada sisi naik, kerugiannya terbatas. Ini alasan tambahan memilih C: **ia mengurangi biaya kesalahan jika verifikasi lisensi gagal.**

**Kapan keputusan ini harus ditinjau ulang:** jika PowerSync Open Edition ternyata tidak bisa memenuhi kebutuhan partial sync (mis. Sync Rules tidak bisa mengekspresikan "riwayat 90 hari untuk outlet ini"), atau jika beban operasional menjalankan sync service tambahan di setiap deployment on-premise terbukti tidak sepadan.

---

## 9. Batas offline Lumi POS — spesifikasi yang mengikat

### KEP-23 — Definisi resmi kemampuan offline

Ini tabel yang harus masuk ke PRD, materi penjualan, dan kontrak — sebagaimana Shopify dan Toast mendokumentasikan batas mereka.

| Kapabilitas | v1 | Catatan |
|---|---|---|
| **Buka shift / sesi kasir baru** | ✅ **Ya** | Pembeda utama vs Toast dan Odoo. Butuh kredensial ter-cache + verifikasi PIN lokal |
| Login kasir dengan PIN | ✅ Ya | PIN diverifikasi terhadap hash yang direplikasi ke device |
| Membuat & menyelesaikan order | ✅ Ya | |
| Pembayaran tunai | ✅ Ya | |
| Pembayaran QRIS | ❌ **Tidak — mustahil** | Butuh konfirmasi issuer. Dinyatakan sebagai batas fisik, bukan kekurangan |
| Pembayaran kartu | ⚠️ Via EDC terpisah | Kasir mencatat manual sebagai "kartu (EDC)". Tidak ada integrasi terminal saat offline di v1 |
| Cetak struk & buka cash drawer | ✅ Ya | Printer terhubung langsung ke device |
| Update stok lokal | ✅ Ya | Sebagai movement lokal; akurasi lintas-device tidak dijamin |
| **Pencegahan oversell** | ❌ **Tidak dijanjikan** | Peringatan ya, pencegahan tidak. Konsekuensi CAP |
| **Refund & void** | ✅ Ya, untuk transaksi dalam jendela riwayat lokal | Target 90 hari; harus diverifikasi terhadap kapasitas storage |
| Akses & buat data pelanggan | ✅ Ya | Berbeda dari Shopify yang tidak mengizinkan |
| Loyalty / poin | ❌ Tidak | Sejalan dengan Toast; saldo poin butuh sumber kebenaran tunggal |
| Voucher & gift card | ❌ Tidak | Sejalan dengan Toast; risiko penggunaan ganda |
| Tutup kas / tutup shift | ✅ Ya | Wajib — merchant harus bisa menutup buku |
| Laporan penjualan device ini | ✅ Ya | Dari data lokal |
| Laporan lintas-outlet / historis panjang | ❌ Tidak | Online-only, dengan empty state yang menjelaskan |
| **Melihat order dari device lain di outlet** | ❌ **Tidak di v1** | Sejalan dengan Toast; KDS via hub lokal ditargetkan v1.1 |
| Terima order GoFood/GrabFood/ShopeeFood | ❌ Tidak | Cloud-only secara definisi |
| Durasi offline maksimum untuk penjualan tunai | **Tidak dibatasi** | Dibatasi kapasitas storage device |

**Aturan yang diturunkan dari daftar "jangan" milik Toast** — pelajaran yang diambil tanpa harus mengalaminya sendiri:

| Risiko yang Toast tangani dengan instruksi manual | Cara Lumi POS menanganinya secara teknis |
|---|---|
| Uninstall/clear cache menghapus data & pembayaran permanen | Data offline disimpan di lokasi yang **tidak** terhapus oleh clear cache aplikasi; peringatan keras sebelum operasi destruktif; ekspor darurat antrean ke file |
| Tidak bisa login kembali saat offline | Kredensial di-cache; login PIN diverifikasi lokal |
| Logout saat offline mengunci pengguna | Logout **dinonaktifkan** saat ada antrean belum terkirim, dengan pesan yang menjelaskan alasannya |
| Restart router memutus KDS | (v1.1) Hub menyimpan tiket persisten; KDS memulihkan state setelah reconnect, bukan kehilangannya |
| Resync menghapus data tersimpan | Operasi resync **dinonaktifkan** saat antrean tidak kosong — sama seperti Toast, tapi ditegakkan sistem, bukan dokumentasi |
| Pembayaran offline bisa "hilang" sehingga merchant harus menyimpan struk fisik | Antrean upload persisten dengan konfirmasi eksplisit; laporan "transaksi belum terkirim" yang tidak bisa diabaikan |

---

## 10. Biaya yang tidak disembunyikan

Instruksi riset meminta kabar buruk dinyatakan langsung beserta angkanya. `[ASUMSI — estimasi, bukan pengukuran]`

| Ambisi | Biaya tambahan (estimasi effort) | Rekomendasi |
|---|---|---|
| Offline single-device penuh (v1 sesuai KEP-23) | Baseline | **Kerjakan** |
| + Buka shift & login saat offline | ~1–2 minggu | **Kerjakan** — pembeda dengan biaya rendah |
| + Refund offline dengan riwayat 90 hari lokal | ~2–3 minggu (replikasi riwayat, indeks pencarian lokal, validasi) | **Kerjakan** |
| + Hub lokal untuk KDS (Opsi B, cakupan sempit) | ~6–10 minggu (discovery, election, failover, persistensi, pengujian partisi jaringan) | **Tunda ke v1.1** |
| + Berbagi order antar POS device saat offline | ~10–16 minggu tambahan di atas hub, dengan permukaan bug yang besar | **Jangan — Toast pun tidak** |
| + Multi-tenant SaaS **dan** paket on-premise bersamaan | Dibahas di Fase 9 | Lihat Fase 9 |

**Pernyataan yang harus dibaca pemilik produk:** kombinasi "offline penuh lintas device" + "multi-tenant SaaS" + "paket on-premise" adalah tiga ambisi yang masing-masing mahal dan yang **saling mengalikan** biayanya, bukan menjumlahkan. Setiap fitur offline harus diuji dalam konteks multi-tenant dan dalam konteks on-premise. Memilih ketiganya sekaligus di v1 adalah cara paling andal untuk tidak pernah merilis. Rekomendasi: offline single-device penuh di v1, tunda dua ambisi lainnya dengan tanggal yang ditetapkan.

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Tabel KEP-23 disalin utuh sebagai **spesifikasi kemampuan offline yang mengikat**, dengan setiap baris menjadi acceptance criteria. Baris bertanda ❌ sama pentingnya dengan yang ✅ — itu adalah non-goals yang mencegah scope creep dan janji penjualan yang tidak bisa ditepati.
- "Buka shift saat offline" butuh user story sendiri dengan acceptance criteria eksplisit, karena ini pembeda utama versus Toast dan Odoo.
- Pencegahan oversell harus dinyatakan sebagai **non-goal** dengan penjelasan, dan digantikan requirement "deteksi & laporkan oversell setelah sinkronisasi".
- Butuh requirement untuk layar "status sinkronisasi" yang menampilkan antrean, umur antrean, dan aksi pemulihan — bukan hanya indikator di pojok layar.
- Kebijakan retensi riwayat lokal (90 hari) adalah komitmen produk yang menentukan kemampuan refund offline; harus diverifikasi terhadap kapasitas storage nyata sebelum ditetapkan.

**Untuk Information Architecture:**
- Setiap layar ditandai **offline-capable** atau **online-only**. Layar online-only butuh empty state yang menjelaskan alasan dan menawarkan jalan keluar — sesuai aturan design system bahwa kegagalan menjelaskan alasannya.
- Layar baru yang dibutuhkan dan belum ada di design system: **Status Sinkronisasi** (daftar antrean, item gagal, tombol coba lagi, ekspor darurat) dan **Laporan Oversell** (deteksi pasca-sinkronisasi).
- Komponen `SyncIndicator` dari design system (state ok/queued/failed/offline-only) adalah titik masuk ke layar Status Sinkronisasi — relasinya harus didefinisikan di IA.

**Untuk ERD:**
- Setiap tabel yang direplikasi butuh kolom HLC (`hlc_timestamp`) di samping `occurred_at`/`recorded_at`.
- Tabel lokal khusus device yang **tidak** direplikasi ke server: `outbox_local` (antrean upload dengan status, percobaan, error terakhir), `device_config` (kode device `K1`, counter nomor struk harian), `sync_checkpoint`.
- Tabel `oversell_event` di server untuk deteksi pasca-sinkronisasi: `variation_id`, `outlet_id`, `detected_at`, `devices_involved`, `quantity_over`, `resolved_by`, `resolved_at`.
- Order yang masih `OPEN` butuh kolom `owned_by_device_id` untuk menegakkan model kepemilikan (KEP-21).
- Skema SQLite lokal harus punya versinya sendiri, terpisah dari versi API.

**Untuk Technical Architecture:**
- Dua jalur sinkronisasi (turun via PowerSync, naik via outbox + endpoint idempoten) harus digambarkan sebagai dua alur terpisah dengan titik penggabungan status yang jelas.
- Semua operasi destruktif di device (resync, logout, clear data) harus melewati satu penjaga yang memeriksa antrean — ini invariant arsitektural, bukan pengecekan di UI.
- Verifikasi lisensi FSL PowerSync adalah **blocker** untuk keputusan arsitektur final dan harus dijadwalkan sebelum implementasi dimulai.
- Strategi pengujian untuk skenario offline (partisi jaringan, clock skew, retry duplikat, storage penuh) harus didefinisikan di Fase 10 dan tidak boleh diserahkan ke pengujian manual.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `06-PAYMENTS-AND-FISCAL.md`.*
