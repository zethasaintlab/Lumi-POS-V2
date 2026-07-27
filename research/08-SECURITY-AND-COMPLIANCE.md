# 08 — Keamanan & Compliance

> Fase 8 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.
> ⚠️ Dokumen ini memuat interpretasi standar keamanan dan peraturan. Bukan nasihat hukum. Klaim kepatuhan apa pun harus divalidasi oleh QSA (untuk PCI DSS) dan penasihat hukum (untuk UU PDP).

---

## Ringkasan Keputusan

1. **Strategi PCI DSS: keluar dari scope, bukan patuh di dalam scope.** `[FAKTA]` Cara tercepat mengurangi cakupan kepatuhan adalah berhenti menyentuh data kartu sama sekali — lewat tokenization, hosted payment page, atau P2PE. Merchant dengan P2PE tervalidasi memenuhi syarat **SAQ P2PE dengan sekitar 33 pertanyaan**, jauh lebih sedikit dibanding SAQ-D. Lumi POS tidak boleh pernah menyentuh Primary Account Number dalam bentuk apa pun. (→ KEP-29)

2. **Ancaman terbesar POS bukan hacker eksternal — ia adalah kasir.** `[FAKTA]` Area berisiko tertinggi fraud di restoran adalah cash handling, refund & void, inventory, dan accounts payable. Pola deteksi yang terdokumentasi (void setelah tutup, no-sale berulang, diskon manual besar, lonjakan di akhir shift) bisa langsung dijadikan spesifikasi laporan. Ini fitur produk yang dijual, bukan hanya kontrol keamanan. (→ KEP-30)

3. **RAM scraping tetap ancaman aktif dan mitigasinya adalah tidak pernah memiliki data yang layak di-scrape.** `[FAKTA]` Malware memori dan keylogger masih dua ancaman terbesar POS; varian modern seperti Prilex bahkan **mematikan transaksi contactless untuk memaksa fallback ke transaksi chip yang lebih lemah**. Karena Lumi POS tidak memproses kartu (KEP-29), permukaan serangan ini hilang secara struktural.

4. **UU PDP No. 27/2022 mengenakan denda administratif hingga 2% dari pendapatan tahunan.** `[FAKTA]` Sanksi berjenjang: peringatan tertulis → penghentian sementara pemrosesan → penghapusan data → denda hingga 2% pendapatan tahunan; ditambah sanksi pidana untuk pelanggaran serius seperti penjualan data pribadi ilegal. Untuk Lumi POS, **merchant adalah pengendali data dan Lumi POS adalah prosesor** — pembagian peran ini harus ada di kontrak sejak pelanggan pertama. (→ KEP-31)

5. **Perangkat kasir fisik harus diperlakukan sebagai perangkat yang akan hilang.** Tablet kasir dicuri, dijual, atau dibawa mantan karyawan. Kredensial di device harus terikat device (revocable), berumur pendek, dan tidak memberi akses ke data tenant di luar outletnya.

---

## 1. PCI DSS — strategi cakupan

`[FAKTA]` PCI DSS v4.0.1 berlaku efektif **Maret 2025** dan secara eksplisit mencantumkan **tokenization** sebagai metode yang dapat diterima untuk membuat PAN tidak terbaca di mana pun ia disimpan, bersama truncation, hashing, dan enkripsi.
`[FAKTA]` Network tokenization yang diimplementasikan dengan benar dapat **menghilangkan penyimpanan PAN dari Cardholder Data Environment (CDE)**, mengurangi persyaratan SAQ.
`[FAKTA]` Dengan **P2PE**, sistem POS merchant, infrastruktur jaringan, server back-office, dan komponen pendukung hanya menangani **ciphertext terenkripsi — tidak pernah cardholder data dalam bentuk plaintext**.
`[FAKTA]` Merchant yang memenuhi persyaratan solusi P2PE umumnya memenuhi syarat untuk **SAQ-P2PE** alih-alih SAQ-D atau SAQ-C yang jauh lebih luas. SAQ P2PE berisi sekitar **33 pertanyaan** — jauh lebih sedikit dibanding jenis SAQ lain.
`[FAKTA]` Cara tercepat mengurangi cakupan kepatuhan adalah **berhenti menyentuh data kartu secara langsung** — pindah ke tokenization, hosted payment page, atau solusi P2PE.

*Sumber: [PCI DSS Scope Reduction — Segmentation, Tokenization, and P2PE — episki](https://episki.com/frameworks/pci/scope-reduction) · [PCI DSS 4.0: Scope Reduction & Compliance Guide — Petronella Cybersecurity](https://petronellatech.com/blog/pci-dss-4-0-shrink-your-scope-with-tokenization-serverless-payment/) · [PCI Compliance Checklist 2026: The Merchant's Guide to DSS 4.0.1 — Strictly](https://strictlyzero.com/announcements/payments-announcements/pci-compliance-checklist-2026-the-merchants-guide-to-dss-4-0-1/) · [PCI DSS v4.0 SAQ P2PE — PCI Security Standards Council](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-P2PE.pdf) · [Payment Token Standards 2026 — WebPayMe](https://webpayme.com/blog/payment-token-standards-2026) (semua diakses 27 Jul 2026)*

### KEP-29 — Posisi Lumi POS terhadap data kartu

**Pertanyaan:** Bagaimana Lumi POS menangani pembayaran kartu sedemikian rupa sehingga beban PCI DSS untuk Lumi POS dan merchant-nya seminimal mungkin?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. POS memproses kartu (membaca, mengirim ke acquirer) | Pengalaman kasir paling mulus; satu perangkat | Menempatkan seluruh sistem — termasuk **setiap tablet kasir merchant** — di dalam CDE. Butuh SAQ-D, audit tahunan, segmentasi jaringan, pengujian penetrasi. Membuka permukaan RAM scraping. **Tidak realistis untuk solo builder** | Perusahaan payment dengan tim compliance |
| B. Terminal EDC bersertifikat menangani kartu sepenuhnya; POS hanya menerima hasil (approval code, 4 digit terakhir, token) | POS **berada di luar CDE**. Tidak ada PAN yang pernah menyentuh kode Lumi POS. Sesuai dengan realitas Indonesia di mana merchant sudah punya EDC dari bank | Kasir harus memicu transaksi di dua tempat kecuali ada integrasi ECR (Fase 7) | Pasar dengan penetrasi EDC bank yang tinggi |
| C. Payment gateway dengan tokenization untuk kartu online + EDC untuk kartu fisik | Menangani kartu tanpa PAN menyentuh sistem; token bisa disimpan untuk transaksi berulang | Kompleksitas dua jalur; tokenization lebih relevan untuk e-commerce daripada POS fisik | Produk dengan komponen online ordering |

**Rekomendasi:** Opsi B untuk kartu fisik, dengan Opsi C untuk pembayaran non-kartu-hadir (QRIS, e-wallet) — dan larangan mutlak terhadap Opsi A. `[INFERENSI]`

**Alasan:** Pilihan ini bukan optimasi melainkan syarat kelangsungan. Menempatkan tablet kasir merchant di dalam CDE berarti setiap merchant harus menjalani audit PCI yang tidak akan mereka lakukan, dan Lumi POS akan bertanggung jawab atas kepatuhan lingkungan yang tidak dikendalikannya. Realitas Indonesia mendukung pilihan ini: merchant kafe sudah memiliki EDC dari BCA/Mandiri, dan pelanggan sudah terbiasa dengan alur "kasir menyebut nominal, pelanggan tap di EDC". Yang hilang (satu langkah manual) jauh lebih kecil daripada yang didapat (keluar dari CDE sepenuhnya).

**Aturan yang harus ditegakkan dan tidak bisa dinegosiasikan:**
- Tidak ada kolom di database mana pun untuk PAN penuh, CVV/CVC, PIN, atau data magnetic stripe/chip. Ini larangan di level ERD, ditegakkan oleh review skema.
- Field yang boleh disimpan: `card_last4`, `card_brand`, `approval_code`, `terminal_reference`, `acquirer`, `token` (jika dari gateway).
- Log aplikasi tidak boleh pernah memuat payload pembayaran mentah. Redaksi harus dilakukan di lapisan logging, bukan mengandalkan disiplin penulis kode.
- Dokumentasi merchant harus menyatakan dengan jelas: menggunakan Lumi POS **tidak** menghilangkan kewajiban PCI merchant terhadap terminal EDC mereka — itu tanggung jawab bank/acquirer mereka.

**Kapan keputusan ini harus ditinjau ulang:** jika integrasi Tap-to-Phone (SoftPOS) menjadi kebutuhan pasar, posisi ini berubah secara fundamental — SoftPOS menempatkan pembacaan kartu di perangkat, dengan rezim sertifikasi tersendiri (PCI MPoC). Itu proyek terpisah dengan biaya kepatuhan besar, bukan penambahan fitur.

---

## 2. Threat model

`[FAKTA]` Malware memory scraping (RAM scraper) dan keylogger tetap **dua ancaman terbesar** untuk sistem POS. Malware ini menginfeksi software POS atau sistem operasi dan mencuri detail pembayaran langsung dari memori atau input pengguna.
`[FAKTA]` Ketika kartu dimasukkan atau di-swipe, software POS menyimpan data kartu dalam plaintext sementara di RAM (khususnya ketika enkripsi langsung tidak diaktifkan). Serangan terjadi saat penyerang mengompromikan sistem POS memakai memory scraper, RAM dumper, keylogger, atau network sniffer.
`[FAKTA]` **Prilex** adalah varian POS malware lanjutan yang menambahkan trik kriptografis dan bahkan **mematikan transaksi contactless (NFC) untuk memicu fallback ke transaksi chip yang lebih lemah**. **ModPipe** menyerang terminal POS Oracle Micros di sektor hospitality untuk mencuri password dan data kartu.
`[FAKTA]` Serangan ini mengeksploitasi keamanan endpoint yang lemah, penyalahgunaan remote access, dan sistem yang usang.

*Sumber: [PoS Malware & RAM Scraping: A Retailer's Nightmare — Securus Communications](https://www.securuscomms.com/blog/pos-malware-ram-scraping-a-retailers-nightmare/) · [PoS Malware: All You Need to Know — Infosec Institute](https://www.infosecinstitute.com/resources/malware-analysis/pos-malwareall-you-need-to-know/) · [POS Security: Most Common POS Breaches and Stats — SapientPro](https://sapient.pro/blog/importance-of-pos-security) · [POS Security: Complete Guide to Point-of-Sale System Protection — Trio](https://www.trio.so/blog/pos-security) (semua diakses 27 Jul 2026)*

### 2.1 Threat model ringkas

| # | Ancaman | Aktor | Dampak | Mitigasi | Sisa risiko |
|---|---|---|---|---|---|
| T1 | **RAM scraping data kartu** | Malware di device kasir | Kebocoran data kartu massal | **Tidak ada PAN di memori** (KEP-29). Serangan tidak punya target | Rendah — struktural |
| T2 | **Manipulasi harga di klien** | Kasir teknis / pemilik nakal | Penjualan tercatat lebih kecil dari yang dibayar pelanggan | Server memvalidasi ulang total dari katalog + aturan diskon saat sinkronisasi; selisih ditandai. **Klien tidak dipercaya** | Sedang — offline berarti validasi tertunda |
| T3 | **Void/refund fiktif oleh kasir** | Kasir | Uang tunai diambil, transaksi dihapus | Void = record baru (KEP-17), tidak bisa menghilangkan yang asli. Otorisasi PIN manajer di atas ambang. Laporan exception (KEP-30) | Sedang — kasir dengan PIN manajer tetap bisa |
| T4 | **Penyalahgunaan diskon** ("sweetheart deal") | Kasir | Kebocoran margin perlahan, sulit terdeteksi | Ambang diskon berotorisasi; alasan dari daftar tertutup; laporan diskon per kasir | Sedang |
| T5 | **No-sale (buka laci tanpa transaksi)** | Kasir | Pencurian tunai langsung | Operasi berotorisasi + audit trail. **Tidak bisa mendeteksi laci dibuka dengan kunci fisik** (Fase 7) | Tinggi pada pembukaan manual |
| T6 | **Perangkat kasir hilang/dicuri** | Eksternal / mantan karyawan | Akses ke data outlet & katalog; kemungkinan transaksi palsu | Kredensial terikat device dan bisa dicabut; data terenkripsi at-rest; PIN wajib; remote wipe pada koneksi berikutnya | Sedang — device offline tidak bisa di-wipe |
| T7 | **Akses lintas tenant** | Eksternal / bug | Kebocoran data merchant lain — **kegagalan eksistensial** | Isolasi tenant (Fase 9); setiap query ter-scope; pengujian otomatis lintas-tenant | Rendah jika diuji |
| T8 | **Kebocoran data pelanggan** | Eksternal | Pelanggaran UU PDP; denda s.d. 2% pendapatan | Minimalisasi data; enkripsi; retensi terbatas; kontrol akses | Sedang |
| T9 | **Penyalahgunaan akses support** | Internal Lumi POS | Akses ke data merchant tanpa izin | Akses berbatas waktu, tercatat, dan butuh persetujuan merchant | Sedang |
| T10 | **Kompromi rantai pasok** (dependency) | Eksternal | Kode berbahaya di aplikasi kasir | Lockfile, audit dependency, pinning versi, build reproducible | Sedang |
| T11 | **Rekaman ulang / replay request sinkronisasi** | Eksternal | Transaksi palsu atau duplikat | Idempotency key (KEP-16) + otentikasi per request + TLS | Rendah |
| T12 | **Manipulasi jam device** | Kasir | Transaksi ditanggalkan di shift lain untuk menyembunyikan pola | HLC + `recorded_at` server; selisih jam device vs server ditandai di audit | Sedang |

`[INFERENSI]` **T2 dan T12 adalah dua ancaman yang secara khusus diperburuk oleh offline-first**, dan keduanya tidak bisa dihilangkan — hanya bisa dideteksi setelah sinkronisasi. Ini biaya nyata dari keputusan produk di KEP-01 dan harus dinyatakan, bukan disembunyikan. Deteksi pasca-fakta (server menghitung ulang dan menandai selisih) adalah mitigasi yang benar; pencegahan tidak tersedia.

---

## 3. Fraud kasir — kontrol dan deteksi

`[FAKTA]` Area berisiko tertinggi fraud di restoran: **cash handling, refund & void, inventory management, dan accounts payable** — semuanya melibatkan transaksi sering, banyak karyawan, dan peluang kesalahan atau manipulasi.
`[FAKTA]` **POS exception reporting** dapat menandai: void setelah tutup, refund bernilai tinggi, pembukaan "no-sale" yang sering, item yang berulang kali dibatalkan, dan diskon manual besar.
`[FAKTA]` Pola void/refund yang **konsisten terjadi selama shift satu karyawan**, yang **berkorelasi dengan transaksi bernilai tinggi**, atau yang **melonjak di akhir shift** adalah sinyal bermakna yang layak diselidiki.
`[FAKTA]` Discount abuse adalah penerapan diskon secara tidak benar untuk pembelian sendiri atau membuat "sweetheart deal" untuk teman dan keluarga. Praktik yang dianjurkan: menetapkan alert harian pada void, diskon, dan pembatalan per kasir, dengan fokus pada **variasi metrik** — ambang yang lebih tinggi dari biasanya kemungkinan besar menandakan perilaku mencurigakan.
`[FAKTA]` Mayoritas sistem POS memungkinkan penetapan ambang di atas mana transaksi memerlukan persetujuan manajer: diskon di atas persentase tertentu, refund di atas nominal tertentu, atau void transaksi di atas nilai tertentu. Menetapkan ambang ini **dan benar-benar mewajibkan persetujuan manajer alih-alih membiarkan kasir menyetujui sendiri** menciptakan checkpoint akuntabilitas yang mencegah bentuk fraud register paling umum.
`[FAKTA]` Mewajibkan login karyawan individual untuk setiap shift memastikan setiap transaksi, void, diskon, dan refund dapat diatribusikan ke orang tertentu. Ini **tidak mencegah fraud tapi membuat identifikasi pola per individu jauh lebih mudah**.

*Sumber: [POS Exception Reporting — Interface Systems](https://interfacesystems.com/business-intelligence/pos-exception-reporting/) · [How to spot point-of-sale theft, fraud, discount abuse — Solink](https://solink.com/resources/point-of-sale-employee-theft/) · [Restaurant Fraud Prevention Tactics Every Operator Should Know — BEP Back Office](https://bepbackoffice.com/blog/restaurant-fraud-prevention/) · [POS Exception Reporting: How LP Teams Use Transaction Data to Detect Fraud — Agilence](https://blog.agilenceinc.com/pos-exception-reporting-how-lp-teams-use-transaction-data-to-detect-fraud) · [Restaurant and Bar Scams: How Smart POS Systems Prevent Theft — Lavu](https://lavu.com/most-common-lp-scams-restaurants-and-bars/) (semua diakses 27 Jul 2026)*

### KEP-30 — Kontrol otorisasi & laporan exception

**Pertanyaan:** Bagaimana sistem mencegah dan mendeteksi fraud kasir tanpa membuat kasir tidak bisa bekerja di jam sibuk?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Pencegahan keras — semua void/diskon/refund butuh manajer | Kontrol maksimum | Manajer tidak selalu ada. Kasir akan mencari jalan pintas (membatalkan sebelum dibayar, tidak mencatat penjualan sama sekali) — **fraud berpindah ke tempat yang tidak terlihat sistem** | Outlet dengan manajer selalu hadir |
| B. Deteksi saja — semua diizinkan, semua tercatat, laporan exception | Tidak menghambat operasi; jejak lengkap | Fraud terdeteksi setelah uang hilang. Merchant kecil sering tidak membaca laporan | Merchant dengan proses review disiplin |
| C. Ambang berotorisasi + audit lengkap + laporan exception dengan alert | Operasi lancar di bawah ambang; kontrol di atas ambang; deteksi pola untuk yang di bawah ambang | Ambang harus dikonfigurasi dengan benar; ambang terlalu rendah mengganggu, terlalu tinggi tidak berguna | Mayoritas merchant |

**Rekomendasi:** Opsi C, dengan default ambang yang konservatif dan dapat diubah. `[INFERENSI]`

**Alasan:** Opsi A punya efek samping yang terdokumentasi dan berbahaya: ketika kontrol terlalu ketat, fraud tidak hilang melainkan berpindah ke bentuk yang lebih sulit dideteksi (tidak mencatat penjualan sama sekali) — dan pada titik itu sistem tidak punya data apa pun untuk dianalisis. Opsi C mempertahankan setiap kejadian di dalam sistem, di mana ia bisa dianalisis. Design system sudah mengantisipasi ini: `ConfirmDialog` dispesifikasikan dengan "PIN owner + alasan dari daftar tertutup, 'Lainnya' wajib catatan".

**Spesifikasi konkret yang bisa langsung masuk PRD** (diturunkan dari pola terdokumentasi):

| Kontrol | Default | Dapat diubah |
|---|---|---|
| Diskon > 20% atau > Rp50.000 | Butuh PIN manajer | Ya |
| Void item setelah dikirim ke dapur | Butuh PIN manajer + alasan | Ya |
| Void seluruh order | Butuh PIN manajer + alasan | Tidak (selalu wajib) |
| Refund apa pun | Butuh PIN manajer + alasan | Tidak |
| No-sale (buka laci) | Butuh alasan; PIN di atas frekuensi tertentu | Ya |
| Tutup kas dengan selisih > Rp20.000 | Butuh PIN manajer + catatan | Ya |

**Laporan exception yang wajib ada** (setiap baris berasal dari pola terdokumentasi):
1. Void & refund per kasir, dibandingkan dengan rata-rata semua kasir.
2. Void yang terjadi **setelah shift ditutup** atau mendekati akhir shift.
3. Refund bernilai tinggi (di atas persentil tertentu).
4. Frekuensi no-sale per kasir per shift.
5. Diskon manual per kasir: total nilai, frekuensi, dan alasan yang dipilih.
6. Item yang berulang kali dibatalkan pada order yang sama.
7. Selisih kas per kasir per shift, dengan tren.
8. Transaksi yang dibuat saat offline dengan selisih besar antara jam device dan jam server (T12).

`[INFERENSI]` Poin penting untuk positioning produk: laporan-laporan ini bukan sekadar kontrol keamanan — mereka adalah **fitur yang dibeli owner**. Owner kafe yang kehilangan uang tanpa tahu penyebabnya adalah nyeri yang mereka bayar untuk selesaikan. Ini harus muncul di materi penjualan, bukan disembunyikan di pengaturan keamanan.

---

## 4. RBAC & pemisahan tugas

`[INFERENSI]` Peran minimum yang dibutuhkan, diturunkan dari struktur merchant 2–20 outlet:

| Peran | Cakupan | Kemampuan kunci |
|---|---|---|
| **Owner** | Tenant | Semua, termasuk pengaturan billing dan penghapusan outlet |
| **Manajer Area** | Beberapa outlet | Laporan lintas outlet, katalog, harga; **tidak** billing |
| **Manajer Outlet** | Satu outlet | Otorisasi void/refund/diskon, tutup kas, laporan outlet, stok |
| **Kasir** | Satu outlet, satu device saat shift aktif | Transaksi, buka/tutup shift sendiri; **tidak** melihat laporan margin atau HPP |
| **Dapur (KDS)** | Satu outlet | Baca tiket, tandai selesai. **Tanpa login** (per design system) |
| **Akuntan** (read-only) | Tenant | Ekspor & laporan keuangan; tidak bisa mengubah apa pun |

**Pemisahan tugas yang harus ditegakkan** `[INFERENSI]`:
- Kasir yang menghitung laci **tidak boleh** menjadi orang yang menyetujui selisihnya. Alur tutup kas harus melibatkan dua identitas ketika selisih melewati ambang.
- Orang yang membuat produk/harga sebaiknya berbeda dari yang menyetujui diskon besar — sulit ditegakkan di merchant kecil, tapi harus mungkin dikonfigurasi untuk merchant yang lebih besar.
- **Owner tidak dikecualikan dari audit trail.** Tindakan owner tercatat sama seperti yang lain. Ini penting untuk sengketa antar pemilik (kafe dengan beberapa investor adalah hal biasa).

`[FAKTA]` KDS di design system Lumi dispesifikasikan **tanpa login** ("Monitor dapur — dibaca dari 2 meter, tanpa login").
*Sumber: `/ds-bundle/readme.md`*

`[INFERENSI]` Ini keputusan UX yang benar (dapur tidak boleh terhalang login) tapi punya konsekuensi keamanan: perangkat KDS memiliki akses persisten ke data order outlet tanpa otentikasi pengguna. Mitigasinya: KDS diotentikasi sebagai **perangkat**, bukan pengguna, dengan token terikat perangkat yang bisa dicabut, dan haknya dibatasi keras — **baca tiket dan tandai selesai saja**, tanpa akses harga, pelanggan, atau laporan.

---

## 5. Manajemen secret pada perangkat yang bisa hilang

`[INFERENSI]` Perangkat kasir adalah kelas perangkat yang **akan** hilang. Asumsi desain harus: setiap tablet yang dikirim ke merchant suatu saat akan berada di tangan yang salah.

| Prinsip | Implementasi |
|---|---|
| **Kredensial terikat perangkat** | Token perangkat di-issue saat provisioning, tidak bisa dipindah ke perangkat lain, bisa dicabut dari dashboard |
| **Umur pendek + refresh** | Access token berumur menit; refresh token terikat perangkat. Perangkat offline memakai refresh terakhir sampai batas yang ditetapkan |
| **Batas offline untuk kredensial** | Perangkat yang tidak terhubung > N hari (rekomendasi 30) harus diaktivasi ulang. **Trade-off langsung dengan janji offline tak terbatas** — harus diputuskan sadar |
| **Enkripsi at-rest** | Database SQLite lokal terenkripsi dengan kunci di keystore OS (Keychain/Keystore/DPAPI), bukan di file konfigurasi |
| **PIN bukan pengganti otentikasi perangkat** | PIN 4–6 digit mudah ditebak; ia mengidentifikasi *siapa* di antara staf outlet, bukan mengamankan perangkat. Keamanan berasal dari token perangkat + enkripsi |
| **Rate limiting PIN lokal** | Percobaan PIN gagal berulang mengunci perangkat sementara, bahkan offline |
| **Remote wipe best-effort** | Perintah wipe dijalankan saat perangkat terhubung berikutnya. **Perangkat yang tidak pernah terhubung tidak bisa di-wipe** — inilah alasan enkripsi at-rest wajib |
| **Cakupan data minimal** | Perangkat hanya mereplikasi data outletnya. Perangkat yang dicuri tidak memberi akses ke outlet lain, apalagi tenant lain |

`[INFERENSI]` **Ketegangan yang harus diputuskan pemilik produk:** batas kredensial offline (mis. 30 hari) bertentangan langsung dengan janji "offline tidak terbatas untuk penjualan tunai" di KEP-23. Rekomendasi kompromi: perangkat yang melewati batas tetap bisa **menyelesaikan dan menyimpan** transaksi yang sedang berjalan dan menutup shift, tapi tidak bisa membuka shift baru sampai terhubung. Ini menjaga merchant tidak kehilangan data sambil membatasi jendela penyalahgunaan perangkat curian. Masuk `12-OPEN-QUESTIONS.md`.

---

## 6. Enkripsi

| Lapisan | Rekomendasi | Catatan |
|---|---|---|
| In-transit | TLS 1.3, sertifikat wajib divalidasi, tanpa opsi "abaikan sertifikat" | Certificate pinning dipertimbangkan untuk aplikasi native — tapi mempersulit rotasi sertifikat; keputusan trade-off |
| At-rest server | Enkripsi disk + enkripsi kolom untuk data pribadi sensitif | Enkripsi kolom hanya untuk yang benar-benar sensitif; enkripsi semuanya membuat query mustahil |
| At-rest klien | SQLite terenkripsi, kunci di keystore OS | Wajib karena remote wipe tidak dijamin |
| Backup | Terenkripsi dengan kunci terpisah dari kunci produksi | Backup yang tidak terenkripsi adalah jalur kebocoran paling umum yang terlupakan |
| Password | Argon2id | Bukan bcrypt/MD5/SHA |
| PIN kasir | Argon2id dengan salt per pengguna, di-hash **sebelum** direplikasi ke perangkat | Perangkat memverifikasi hash lokal; PIN plaintext tidak pernah meninggalkan input |

---

## 7. Audit trail yang tahan sengketa

`[INFERENSI]` Audit trail POS harus menjawab pertanyaan yang muncul dalam sengketa nyata:
- "Siapa memberi diskon Rp200.000 pada 14 Juli jam 20:15?"
- "Kenapa stok kopi turun 40 tanpa penjualan?"
- "Apakah manajer benar-benar menyetujui refund ini, atau kasir tahu PIN-nya?"
- "Struk apa yang sebenarnya dicetak untuk pelanggan yang komplain?"

**Properti yang wajib ada:**

| Properti | Alasan |
|---|---|
| **Append-only, tanpa update dan delete** | Sudah dijamin KEP-17 untuk transaksi; harus berlaku juga untuk `audit_event` |
| **Aktor, bukan hanya user_id** | Untuk otorisasi step-up, catat **dua** identitas: yang melakukan (kasir) dan yang menyetujui (manajer). Ini yang membedakan audit yang berguna dari yang tidak |
| **Waktu ganda** | `occurred_at` (device) dan `recorded_at` (server) — selisihnya sendiri adalah sinyal (T12) |
| **Konteks device dan outlet** | Sengketa hampir selalu tentang "di mana dan mesin mana" |
| **Nilai sebelum & sesudah** untuk perubahan | Perubahan harga tanpa nilai lama tidak berguna |
| **Alasan dari daftar tertutup** | Free text tidak bisa diagregasi menjadi laporan. Design system sudah menetapkan ini |
| **Retensi lebih panjang dari transaksi** | Sengketa muncul berbulan-bulan kemudian. Rekomendasi minimal 5 tahun (sejalan dengan kewajiban pembukuan) |
| **Tidak bisa dimatikan merchant** | Audit trail yang bisa dinonaktifkan bukan audit trail |

**Event yang wajib tercatat:** login/logout · buka/tutup shift · void (item & order) · refund · diskon manual · perubahan harga · perubahan katalog · penyesuaian stok · no-sale (buka laci) · perubahan pengaturan pajak · perubahan peran/pengguna · ekspor data · akses support · perubahan konfigurasi perangkat.

---

## 8. UU PDP — kewajiban perlindungan data pribadi Indonesia

`[FAKTA]` **Pengendali data pribadi** adalah setiap orang, badan publik, atau organisasi internasional yang menentukan tujuan dan melakukan kendali atas pemrosesan data pribadi, dengan kewajiban utama melakukan pemrosesan **atas persetujuan subjek data pribadi**.
`[FAKTA]` Perusahaan diwajibkan mengambil **langkah teknis dan administratif** untuk melindungi data pribadi dari penyalahgunaan.
`[FAKTA]` **Sanksi administratif (Pasal 57 UU PDP)** berjenjang: (1) peringatan tertulis; (2) penghentian sementara kegiatan pemrosesan data pribadi; (3) penghapusan atau pemusnahan data pribadi; dan/atau (4) **denda administratif paling tinggi 2% dari pendapatan tahunan atau penerimaan tahunan** terhadap variabel pelanggaran.
`[FAKTA]` **Sanksi pidana** diterapkan untuk pelanggaran serius, seperti penjualan data pribadi secara ilegal.

*Sumber: [UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi — JDIH BPK RI](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) · [Kewajiban Perusahaan Dalam UU PDP dan Konsekuensinya — Prolegal](https://prolegal.id/kewajiban-perusahaan-dalam-uu-pdp-dan-konsekuensinya/) · [Implikasi UU Perlindungan Data Pribadi (PDP): Kewajiban Korporasi dan Hak Warga Negara — FH Universitas Medan Area](https://hukum.uma.ac.id/implikasi-uu-perlindungan-data-pribadi-pdp-kewajiban-korporasi-dan-hak-warga-negara/) · [Perlindungan Data Pribadi: Implementasi UU No. 27 Tahun 2022 — FH Universitas Tarumanagara](https://fh.untar.ac.id/2025/09/11/perlindungan-data-pribadi-implementasi-uu-no-27-tahun-2022-dan-tantangan-penegakannya/) (semua diakses 27 Jul 2026)*

### KEP-31 — Posisi Lumi POS dalam UU PDP

**Pertanyaan:** Apakah Lumi POS adalah pengendali atau prosesor data pribadi, dan apa konsekuensi desainnya?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Lumi POS sebagai pengendali data pelanggan merchant | Kebebasan memakai data untuk analitik lintas merchant, benchmarking | Menanggung seluruh kewajiban pengendali termasuk consent langsung dari konsumen akhir — **mustahil dilakukan lewat merchant**. Paparan denda 2% pendapatan | Produk yang datanya memang miliknya |
| B. **Merchant adalah pengendali, Lumi POS adalah prosesor** | Sesuai realitas: merchant yang menentukan tujuan pemrosesan data pelanggannya. Kewajiban consent ada di merchant. Beban Lumi POS adalah langkah teknis & administratif | Tidak bisa memakai data merchant untuk tujuan sendiri tanpa perjanjian terpisah. Butuh kontrak pemrosesan data yang jelas | SaaS B2B |
| C. Peran ganda: prosesor untuk data pelanggan merchant, pengendali untuk data akun merchant | Paling akurat secara hukum | Butuh dua rezim kebijakan dan dua kebijakan privasi | Produk yang matang secara hukum |

**Rekomendasi:** Opsi C, yang secara praktis berarti Opsi B untuk data pelanggan akhir plus pengendali untuk data akun/pengguna merchant. `[INFERENSI]`

**Alasan:** Lumi POS tidak menentukan tujuan pemrosesan data pelanggan kafe — kafe yang menentukannya. Sementara itu, data akun merchant (nama pemilik, email, data billing) diproses Lumi POS untuk tujuannya sendiri, yang membuatnya pengendali untuk data tersebut. Memisahkan keduanya sejak awal jauh lebih murah daripada memperbaikinya setelah ada pertanyaan dari regulator atau pelanggan enterprise.

**Yang harus ada sejak pelanggan pertama:**
- **Perjanjian pemrosesan data** dalam Syarat & Ketentuan yang menyatakan peran, tujuan, dan batasan.
- **Minimalisasi data:** untuk apa Lumi POS menyimpan nomor telepon pelanggan? Jika hanya untuk struk WhatsApp, apakah perlu disimpan permanen atau cukup selama transaksi? Setiap field data pribadi harus punya justifikasi tertulis.
- **Retensi terbatas dengan penghapusan otomatis.** Data pelanggan yang tidak aktif dihapus atau dianonimkan setelah periode yang ditetapkan.
- **Hak subjek data:** merchant harus punya cara mengekspor dan menghapus data pelanggan tertentu ketika pelanggan itu memintanya kepada merchant. Ini fitur produk, bukan proses manual support.
- **Notifikasi kebocoran:** prosedur dan jalur komunikasi ke merchant harus ada sebelum dibutuhkan.
- **Lokasi pemrosesan data** harus diketahui dan didokumentasikan — memilih hosting Jakarta (Fase 3) menyederhanakan ini.

**Pemetaan ke rezim global** `[INFERENSI]`: struktur UU PDP mengikuti pola GDPR (pengendali/prosesor, consent, hak subjek data, sanksi berbasis persentase pendapatan). Sistem yang dirancang memenuhi UU PDP dengan benar akan berada pada posisi yang jauh lebih baik untuk GDPR daripada sistem yang tidak — perbedaan utamanya pada besaran denda (GDPR hingga 4% pendapatan global), hak portabilitas yang lebih eksplisit, dan aturan transfer data lintas batas. **Tidak** ada nilai dalam membangun kepatuhan GDPR di v1; ada nilai besar dalam tidak membangun sesuatu yang menghalanginya.

---

## 9. Keamanan perangkat offline

`[INFERENSI]` Ringkasan kontrol khusus untuk mode offline, yang berbeda dari keamanan online biasa:

| Risiko khusus offline | Kontrol |
|---|---|
| Validasi server tidak tersedia saat transaksi | Server memvalidasi ulang saat sinkronisasi; selisih ditandai, bukan diterima diam-diam |
| Pencabutan akses tidak sampai ke perangkat | Batas umur kredensial offline; perangkat berhenti membuka shift baru setelah batas |
| Data sensitif menumpuk di perangkat | Replikasi minimal (hanya outlet, hanya jendela waktu tertentu); enkripsi at-rest |
| Jam perangkat dimanipulasi | HLC + perbandingan dengan jam server saat sinkron; selisih besar dicatat sebagai audit event |
| Antrean transaksi bisa dihapus | Operasi destruktif dikunci saat antrean tidak kosong (pelajaran dari Toast, Fase 5); ekspor darurat tersedia |
| Perangkat tidak menerima patch keamanan | Kebijakan versi minimum: perangkat dengan versi di bawah ambang keamanan ditolak sinkronisasi dengan pesan yang jelas |

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Non-goal yang harus dinyatakan tegas: Lumi POS **tidak memproses data kartu**. Semua alur pembayaran kartu melewati terminal EDC bersertifikat. Ini keputusan produk yang membentuk seluruh pengalaman pembayaran kartu.
- Delapan laporan exception di bagian 3 masuk sebagai functional requirement dan sebaiknya juga masuk materi penjualan — ini fitur yang dibeli owner.
- Matriks ambang otorisasi (diskon, void, refund, no-sale, selisih kas) masuk PRD dengan nilai default yang eksplisit.
- Hak subjek data (ekspor & hapus data pelanggan tertentu) adalah fitur produk dengan user story, bukan proses support manual.
- Kebijakan batas kredensial offline adalah keputusan produk dengan trade-off yang harus disetujui secara sadar.

**Untuk Information Architecture:**
- Layar "Audit & Aktivitas" di tingkat outlet dan tenant, dengan filter per aktor, per jenis event, per rentang waktu.
- Laporan exception butuh tempatnya sendiri, terpisah dari laporan penjualan — kemungkinan bagian "Pengawasan" atau "Kontrol" di sidebar.
- Layar manajemen perangkat: daftar perangkat, terakhir terhubung, versi aplikasi, tombol cabut akses.
- Alur otorisasi step-up (`ConfirmDialog` dengan PIN manajer) sudah ada di design system dan harus dipetakan ke setiap operasi berotorisasi.

**Untuk ERD:**
- `AuditEvent`: `id`, `tenant_id`, `outlet_id`, `device_id`, `actor_user_id`, **`approver_user_id`** (nullable — untuk otorisasi step-up), `event_type`, `entity_type`, `entity_id`, `before` (jsonb), `after` (jsonb), `reason_code`, `reason_note`, `occurred_at`, `recorded_at`, `hlc`.
- Larangan eksplisit di ERD: tidak ada kolom untuk PAN, CVV, PIN kartu, atau data track. Ditulis sebagai catatan di skema.
- `Device`: `revoked_at`, `credentials_expire_at`, `min_app_version_ok`.
- `User`: `pin_hash` (Argon2id), `pin_failed_attempts`, `pin_locked_until`.
- Data pelanggan: setiap field pribadi diberi anotasi tujuan pemrosesan dan periode retensi di dokumentasi ERD.

**Untuk Technical Architecture:**
- Redaksi log sebagai lapisan wajib, bukan konvensi penulisan kode.
- Pengujian isolasi tenant sebagai bagian dari CI — bukan pengujian manual (detail di Fase 9 dan 10).
- Kebijakan versi minimum klien sebagai mekanisme arsitektural (server menolak sinkronisasi dari versi di bawah ambang keamanan).
- Prosedur akses support (berbatas waktu, tercatat, dengan persetujuan merchant) harus dirancang sebagai fitur sistem, bukan akses database langsung oleh admin.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `09-MULTITENANCY-DEPLOYMENT.md`.*
