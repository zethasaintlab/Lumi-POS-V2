# 04 — Pola Arsitektur & Data Model

> Fase 4 dari 12. Tanggal riset: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Ringkasan Keputusan

1. **Modular monolith, dengan batas modul yang ditegakkan compiler dan linter — bukan konvensi.** Data 2026 menunjukkan ~42% organisasi yang mengadopsi microservices telah mengkonsolidasikan sebagian layanan kembali. Untuk satu pembangun, microservices adalah biaya operasional tanpa manfaat. Yang **tidak** boleh dikompromikan: tidak ada akses database lintas modul. (→ KEP-15)

2. **Idempotency key wajib, di-generate klien, pada setiap operasi yang menyentuh uang.** Ini bukan optimasi — ini prasyarat mutlak untuk POS offline-first, di mana antrean upload akan mengirim ulang request setelah jaringan pulih dan tidak ada cara membedakan "retry" dari "penjualan kedua yang identik" tanpa token korelasi dari klien. (→ KEP-16)

3. **Penjualan adalah append-only. Tidak ada UPDATE pada transaksi yang sudah selesai; koreksi dilakukan dengan entry baru yang berlawanan arah.** Square membangun layanan akuntansi internal (`Books`) di atas prinsip ini. Void dan refund adalah entry baru, bukan modifikasi record lama. (→ KEP-17)

4. **Order line adalah snapshot, bukan referensi.** Harga, nama, pajak, dan komposisi modifier di-copy ke order line saat item masuk keranjang. Referensi ke katalog tetap disimpan untuk pelaporan, tapi **tidak dipakai untuk merekonstruksi struk**. Ini satu-satunya cara struk enam bulan lalu tetap akurat setelah harga naik tiga kali. (→ KEP-18)

5. **Double-entry dipakai untuk uang, tapi disederhanakan ke *cash movement ledger* di v1 — bukan chart of accounts penuh.** Prinsip "uang tidak bisa diciptakan atau dihancurkan" ditegakkan; kompleksitas akuntansi lengkap ditunda. Alasan dan batas penyederhanaan dinyatakan eksplisit. (→ KEP-19)

---

## 1. Bentuk arsitektur: monolith modular vs microservices

`[FAKTA]` Rekomendasi konsensus 2026 untuk startup: modular monolith adalah titik awal yang lebih cerdas. Kecuali punya 15+ engineer, kepemilikan domain per tim yang berbeda, atau kebutuhan scaling independen sejak hari pertama, microservices akan memperlambat sebelum mempercepat.
`[FAKTA]` Definisi modular monolith yang dipakai: menegakkan batas modul yang ketat secara internal, dengan **antarmuka eksplisit antar modul dan tanpa akses database lintas-modul**, sambil tetap menjadi satu unit yang di-deploy. Pola ini memberi ~80% kejelasan arsitektural microservices tanpa kompleksitas operasionalnya, dan mempertahankan opsi mengekstrak modul menjadi service nanti.
`[FAKTA]` Menurut survei CNCF 2025, sekitar **42% organisasi yang awalnya mengadopsi microservices telah mengkonsolidasikan setidaknya sebagian service kembali** menjadi unit deployment yang lebih besar. Di 2026 percakapan ini matang sebagian karena postmortem publik dari perusahaan yang mendekomposisi terlalu dini.
`[FAKTA]` Kapan microservices masuk akal: ketika bagian-bagian aplikasi punya kebutuhan non-fungsional yang berbeda secara radikal — sebagian butuh keandalan ekstrem sementara yang lain memprioritaskan eksperimentasi cepat.

*Sumber: [Microservices vs Monolith for Startups: The Honest 2026 Decision Guide — Technijian](https://technijian.com/software-development/microservices-vs-monolith-for-startups-the-honest-2026-decision-guide/) · [Rethinking Microservices in 2026: When Modular Monolith Architecture Actually Wins — Enqcode](https://enqcode.com/blog/rethinking-microservices-in-2026-when-modular-monolith-architecture-actually-win) · [Microservices vs Monoliths in 2026: When Each Architecture Wins — Java Code Geeks](https://www.javacodegeeks.com/2025/12/microservices-vs-monoliths-in-2026-when-each-architecture-wins.html) (semua diakses 27 Jul 2026)*

### KEP-15 — Bentuk arsitektur backend

**Pertanyaan:** Bagaimana backend distrukturkan agar bisa dikembangkan satu orang, dikemas untuk on-premise, dan tetap bisa dipecah jika satu bagian butuh scaling berbeda?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Monolith tanpa batas modul internal | Paling cepat dimulai; refactor lintas domain trivial | Setelah 12 bulan, setiap query menyentuh setiap tabel. Tidak bisa dipecah tanpa menulis ulang. Perubahan katalog memecahkan laporan | Prototipe atau produk berumur pendek |
| B. Modular monolith — satu deployable, batas modul ditegakkan, tanpa akses DB lintas modul | Satu unit deploy → paket on-premise sederhana. Batas modul memberi jalur ekstraksi. Debugging dalam satu proses | Butuh disiplin terus-menerus; batas mudah bocor lewat "satu join kecil ini saja". Butuh penegakan otomatis | Tim kecil dengan domain yang jelas berlapis |
| C. Microservices | Scaling dan deploy independen; isolasi kegagalan | Kompleksitas operasional (service discovery, tracing terdistribusi, transaksi lintas service) yang tidak terbayar pada skala target. **Paket on-premise menjadi 6+ container yang harus di-support merchant** | 15+ engineer dengan kepemilikan domain terpisah |

**Rekomendasi:** Opsi B, dengan penegakan batas modul yang **otomatis**, bukan berbasis niat baik. `[INFERENSI]`

**Alasan:** Dualisme SaaS + on-premise (Fase 9) membuat pilihan ini hampir tidak punya alternatif. Setiap service tambahan adalah container tambahan yang harus di-dokumentasikan, di-monitor, dan di-support di lingkungan pelanggan yang tidak dikendalikan — biaya yang dibayar berulang untuk setiap pelanggan on-premise. Data konsolidasi CNCF menunjukkan bahwa bahkan organisasi dengan sumber daya penuh mundur dari dekomposisi dini.

**Cara penegakan yang konkret** (tanpa ini, opsi B degradasi menjadi opsi A dalam 6 bulan):
- Satu direktori per modul dengan file `index.ts` sebagai satu-satunya permukaan publik.
- Aturan lint yang melarang import dalam-dalam antar modul (`import { x } from '../catalog/internal/...'` → error).
- Aturan yang lebih penting dan lebih sering dilanggar: **tidak ada modul yang boleh melakukan query ke tabel milik modul lain.** Ini tidak bisa ditangkap linter TypeScript biasa dan butuh konvensi kepemilikan tabel yang di-audit, misalnya lewat skema PostgreSQL terpisah per modul dengan user database berbeda.

**Modul yang ditetapkan:** `catalog` · `ordering` · `payment` · `inventory` · `cash` · `identity` · `reporting` · `sync` · `tenancy`.

**Kapan keputusan ini harus ditinjau ulang:** ketika satu modul secara terukur membutuhkan profil scaling yang berbeda — kandidat paling mungkin adalah `sync` (banyak koneksi WebSocket persisten) dan `reporting` (query berat). Ekstraksi dilakukan **satu modul saja**, bukan dekomposisi menyeluruh, dan hanya setelah metrik menunjukkan kebutuhannya.

---

## 2. Event-driven vs request-response

`[INFERENSI]` Ini bukan pilihan biner. Yang dibutuhkan adalah garis yang jelas:

| Sifat operasi | Gaya | Contoh |
|---|---|---|
| Harus konsisten sekarang juga, kegagalan harus terlihat langsung ke kasir | **Request-response, transaksi database tunggal** | Menyimpan penjualan (order + line + payment + stock movement + audit event) |
| Bisa terlambat beberapa detik, kegagalan bisa di-retry tanpa kasir tahu | **Event / job queue** | Kirim struk WhatsApp/email, generate laporan harian, push ke aggregator, update proyeksi analitik |
| Harus sampai ke device lain dalam outlet segera | **Event lokal dalam outlet** | Tiket masuk ke KDS, permintaan otorisasi PIN manajer |

**Anti-pola yang harus dihindari secara eksplisit** `[INFERENSI]`: memecah penyimpanan satu penjualan menjadi beberapa event asinkron ("OrderCreated" → handler menulis stock movement → handler lain menulis audit). Ini terlihat elegan dan menghasilkan kelas bug terburuk di sistem finansial: penjualan tercatat tapi stok tidak berkurang karena satu handler gagal diam-diam. **Satu penjualan = satu transaksi database.** Event dipancarkan *setelah* commit, untuk konsumen yang boleh terlambat.

Pola implementasi yang mengamankan ini: **transactional outbox** — event ditulis ke tabel `outbox` **dalam transaksi yang sama** dengan penjualan, lalu dikirim oleh worker terpisah. Ini menjamin tidak ada event yang hilang dan tidak ada event untuk penjualan yang rollback.

---

## 3. Idempotency — prasyarat, bukan optimasi

`[FAKTA]` Idempotency key adalah token unik yang dikirim klien bersama request yang mengubah state (POST/PATCH/DELETE), menjamin operasi hanya dieksekusi sekali berapa kali pun request dikirim.
`[FAKTA]` Stripe mewajibkan klien mengirim idempotency key di header bernama `Idempotency-Key`. Jika Stripe menerima key yang sama dua kali, ia mengembalikan hasil dari request pertama alih-alih memproses pembayaran lagi.
`[FAKTA]` **Key harus di-generate klien, bukan server** — ini non-negotiable, karena server tidak bisa membedakan dua retry dari dua request yang benar-benar terpisah tanpa token korelasi yang disuplai klien.
`[FAKTA]` Key Stripe kedaluwarsa setelah 24 jam; 24 jam adalah titik ideal untuk pembayaran retail — cukup panjang untuk jendela retry yang wajar. Razorpay memakai angka yang sama.
`[FAKTA]` Untuk kegagalan sementara (timeout, error 5xx), retry dengan idempotency key dan exponential back-off. Untuk **respons ambigu** (tidak ada respons sama sekali), panggil endpoint status transaksi sebelum retry untuk menghindari pemrosesan ganda.
`[FAKTA]` Direkomendasikan memakai tabel/database terpisah untuk menyimpan idempotency key agar server bisa memvalidasi status pemrosesan dengan cepat.

*Sumber: [How Stripe Prevents Double Payments With Idempotency Keys — Ajit Singh](https://singhajit.com/how-stripe-prevents-double-payment/) · [Idempotency Keys in Payment API Design — Patterns & Pitfalls — NXT Banking](https://nxtbanking.com/idempotency-keys-payment-api-design/) · [Designing Idempotent Payment APIs — Arpit Bhayani](https://arpit.substack.com/p/designing-idempotent-payment-apis) · [Preventing Duplicate Payments with Idempotency Keys by Stripe, PayPal and Adyen — Medium](https://medium.com/@sahintalha1/the-way-psps-such-as-paypal-stripe-and-adyen-prevent-duplicate-payment-idempotency-keys-615845c185bf) (semua diakses 27 Jul 2026)*

### KEP-16 — Pencegahan transaksi ganda

**Pertanyaan:** Bagaimana memastikan satu penjualan yang dibuat offline dan diunggah ulang beberapa kali hanya tercatat sekali?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Deduplikasi server berbasis heuristik (outlet + total + waktu ±30 detik) | Tanpa perubahan kontrak API | **Salah secara fundamental.** Dua pelanggan yang membeli kopi dengan harga sama dalam 30 detik akan digabung. Kehilangan penjualan nyata tanpa jejak | Tidak pernah |
| B. Idempotency key di-generate klien, disimpan di tabel khusus, kedaluwarsa 24 jam | Standar industri (Stripe, PayPal, Adyen). Benar secara semantik: klien yang tahu ini retry-nya sendiri | Butuh tabel tambahan dan penanganan race saat dua request dengan key sama tiba bersamaan | Setiap sistem pembayaran |
| C. ID transaksi di-generate klien sebagai primary key (UUID/ULID), insert gagal jika sudah ada | Paling sederhana; tanpa tabel tambahan; deduplikasi menjadi constraint database | Tidak menangani kasus "request pertama sukses tapi respons hilang" — klien tidak tahu harus mengembalikan hasil apa. Tidak menangani request yang berubah isinya dengan key sama | Entitas sederhana tanpa efek samping |

**Rekomendasi:** Opsi B **dan** C bersama-sama, bukan salah satu. `[INFERENSI]`

**Alasan:** Keduanya menyelesaikan masalah berbeda. ID transaksi client-generated (C) menjadikan tabel penjualan itu sendiri kebal duplikasi — jaring pengaman terakhir yang ditegakkan database. Tabel idempotency (B) memungkinkan server **mengembalikan respons asli** untuk retry, sehingga klien yang kehilangan respons pertama menerima hasil yang sama dan bisa menandai antreannya selesai — tanpa ini, klien akan retry selamanya. Untuk POS offline-first ini bukan kasus langka: setiap kali koneksi terputus di tengah upload, skenario "sukses tapi respons hilang" terjadi.

**Detail yang harus benar, karena di sinilah bug biasanya bersembunyi:**
- Key disimpan bersama **hash dari request body**. Jika key sama datang dengan body berbeda, itu error klien (`422`), bukan hit cache. Tanpa ini, bug klien akan mengembalikan respons penjualan A untuk penjualan B.
- Penulisan record idempotency dan penulisan penjualan harus berada dalam **satu transaksi database**. Jika terpisah, ada jendela di mana penjualan tercatat tapi key belum, dan retry menghasilkan duplikat.
- Dua request dengan key sama tiba bersamaan → yang kedua harus menunggu atau mendapat `409 Conflict` dengan instruksi retry, bukan lolos.
- Retensi 24 jam **tidak cukup** untuk POS offline-first. `[INFERENSI]` Perangkat kasir bisa offline lebih dari 24 jam (libur panjang, outlet tutup, perangkat rusak lalu dinyalakan lagi). Rekomendasi: **retensi 30 hari** untuk key transaksi penjualan, dengan biaya penyimpanan yang bisa diabaikan (satu baris kecil per transaksi). Ini penyimpangan sadar dari norma Stripe, dan alasannya adalah perbedaan konteks: Stripe melayani klien server yang selalu online.

**Kapan keputusan ini harus ditinjau ulang:** jika tabel idempotency menjadi hotspot penulisan (tidak mungkin pada skala target), pindahkan ke penyimpanan terpisah — tapi jangan sebelum itu terukur, karena memisahkannya mengorbankan atomisitas dengan penjualan.

---

## 4. Race condition: stok dan nomor transaksi

### 4.1 Stok

`[INFERENSI]` Ada dua pertanyaan berbeda yang sering dicampur:

**(a) Apakah stok boleh negatif?** Ini keputusan **bisnis**, bukan teknis. Untuk F&B jawabannya hampir selalu "boleh, dengan peringatan" — melarang penjualan karena sistem mengira stok habis akan menghentikan penjualan nyata dan kasir akan mencari jalan pintas. Untuk retail dengan barang bernilai tinggi, jawabannya bisa berbeda. Ini harus jadi setting per profil vertikal, bukan asumsi yang di-hardcode.

**(b) Bagaimana dua penjualan bersamaan tidak saling menimpa?** Dengan model ledger (KEP-07), pertanyaan ini sebagian besar hilang: dua penjualan menghasilkan dua `INSERT` ke `stock_movement`, dan `INSERT` tidak saling menimpa. Yang tersisa adalah kasus di mana stok harus **dicek sebelum** menjual (reservasi), dan di sana yang dibutuhkan adalah advisory lock atau `SELECT ... FOR UPDATE` pada baris agregat — bukan pada seluruh tabel.

**Kabar buruk yang harus dinyatakan:** pengecekan stok yang benar-benar konsisten **tidak mungkin** saat offline. Dua device offline yang menjual item terakhir akan sama-sama berhasil, dan stok akan negatif setelah sinkronisasi. Ini bukan bug yang bisa diperbaiki dengan arsitektur yang lebih baik — ini konsekuensi teorema CAP. Yang bisa dilakukan adalah membuat konsekuensinya terlihat dan tertangani sebagai proses bisnis (peringatan ke manajer, laporan oversell). Digarap penuh di Fase 5.

### 4.2 Nomor transaksi

`[FAKTA]` Design system menetapkan format nomor struk: `K1-20260726-0007` — terbaca sebagai `{kode device}-{tanggal}-{urutan}`.
*Sumber: `/ds-bundle/readme.md` § Angka & format*

`[INFERENSI]` Format ini adalah keputusan arsitektural yang bagus dan sudah menyelesaikan masalah tersulit tanpa disadari: **prefiks device membuat penomoran offline bebas bentrok tanpa koordinasi.** Device K1 dan K2 bisa sama-sama offline dan sama-sama membuat nomor urut 0007 tanpa tabrakan, karena nomor lengkapnya berbeda.

Yang harus ditegakkan agar properti ini bertahan:
- Kode device dialokasikan **sekali saat provisioning** dan tidak pernah berubah. Dua device dengan kode sama di satu outlet adalah kegagalan katastrofik yang harus dicegah di level provisioning, bukan dideteksi belakangan.
- Urutan direset harian per device, dan counter-nya disimpan **lokal** di device — bukan diminta ke server.
- Nomor struk adalah **identitas untuk manusia** (dicetak, dicari kasir, disebut pelanggan). Primary key internal tetap UUID/ULID yang di-generate klien (KEP-16 opsi C). Mencampur keduanya adalah kesalahan umum yang membuat migrasi dan sinkronisasi jauh lebih sulit.
- Nomor yang **melompat** (0007 lalu 0009) harus bisa dijelaskan. Karena nomor dialokasikan lokal sebelum upload, transaksi yang di-void sebelum tersinkron akan meninggalkan lubang. Laporan audit harus menampilkan lubang ini secara eksplisit, bukan menyembunyikannya — lubang yang tidak dijelaskan adalah sinyal fraud klasik.

---

## 5. Immutable transaction log — mengapa penjualan append-only

`[FAKTA]` Square membangun `Books`, layanan database akuntansi double-entry yang immutable, di mana **kedua dataset (journal entry dan book entry) bersifat append-only dan immutable setelah tersimpan**, yang bisa dipandang sebagai audit log dari semua operasi.
`[FAKTA]` Prinsip umum ledger: entry bersifat append-only sehingga terbentuk catatan historis yang immutable — jika terjadi kesalahan, ia dikoreksi dengan entry berikutnya. **Tidak ada delete, tidak ada update diam-diam.** Hanya jejak append-only yang membuat fraud dan bug jauh lebih sulit disembunyikan.
`[FAKTA]` Koreksi dilakukan lewat *reversing entry* — menjaga audit trail penuh.
`[FAKTA]` Prinsip desain ledger database: menegakkan entry append-only dipasangkan dengan audit trail penuh, menyertakan kontrol konkurensi untuk menangani request simultan bervolume tinggi, dan memakai double-entry bookkeeping untuk memastikan **uang tidak bisa diciptakan atau dihancurkan** di dalam database.

*Sumber: [Books, an immutable double-entry accounting database service — Square Developer Blog](https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/) · [How to Scale a Ledger, Part V: Immutability and Double-Entry — Modern Treasury](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v) · [Ledger Database — Modern Treasury](https://www.moderntreasury.com/learn/ledger-database) · [Ledger API — Double-Entry Bookkeeping for Developers](https://api-ledger.com/) (semua diakses 27 Jul 2026)*

### KEP-17 — Mutabilitas transaksi penjualan

**Pertanyaan:** Apa yang terjadi pada record ketika kasir membatalkan atau mengoreksi penjualan yang sudah selesai?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. UPDATE pada record penjualan (ubah status jadi `voided`, ubah total) | Query laporan sederhana; satu baris per penjualan | Kehilangan nilai sebelumnya. Tidak bisa menjawab "apa isi struk yang dicetak pelanggan". **Konflik sinkronisasi menjadi ambigu**: dua device yang sama-sama meng-update baris yang sama | Sistem non-finansial |
| B. Append-only: void/refund adalah record baru yang mereferensikan yang asli; record asli tidak pernah berubah | Audit trail alami. Sinkronisasi menjadi trivial — dua INSERT tidak konflik. Sengketa pelanggan bisa direkonstruksi persis | Laporan harus menjumlahkan beberapa record untuk mendapat "posisi bersih". Volume data lebih besar | Sistem finansial dengan audit dan offline sync |
| C. Event sourcing penuh (state adalah hasil replay seluruh event) | Fleksibilitas maksimum; bisa membangun proyeksi baru dari sejarah | Kompleksitas tinggi; setiap pembacaan butuh proyeksi yang dipelihara; sulit di-debug; berlebihan untuk domain yang bentuk querynya sudah dikenal | Domain dengan kebutuhan analitik historis yang belum diketahui |

**Rekomendasi:** Opsi B. `[INFERENSI dari konvergensi praktik Square Books, Modern Treasury, dan kebutuhan sinkronisasi offline]`

**Alasan:** Tiga kebutuhan independen menuntut hal yang sama. **Audit**: sengketa dengan pelanggan atau pemeriksaan pajak menuntut rekonstruksi persis apa yang tercetak. **Sinkronisasi**: dua `INSERT` dari device berbeda tidak pernah konflik, sementara dua `UPDATE` pada baris yang sama adalah definisi konflik — memilih append-only menghilangkan seluruh kelas masalah sinkronisasi yang sebaliknya harus dipecahkan dengan CRDT atau resolusi manual. **Anti-fraud**: kasir yang bisa mengubah transaksi selesai adalah lubang kontrol; kasir yang hanya bisa menambah entry koreksi meninggalkan jejak.

Opsi C ditolak karena bentuk query di domain POS sudah sangat dikenal (penjualan per hari, per produk, per kasir, per shift) dan tidak memerlukan fleksibilitas yang dibayar dengan kompleksitas event sourcing penuh. Opsi B memberi manfaat immutabilitas tanpa biayanya.

**Konsekuensi yang harus diterima:** setiap laporan harus menghitung posisi bersih dengan menjumlahkan penjualan, void, dan refund — tidak bisa sekadar `SUM(order.total) WHERE status = 'paid'`. Ini harus dibungkus dalam satu view/fungsi yang dipakai semua laporan, karena kalau setiap laporan mengimplementasikan logikanya sendiri, laporan akan saling bertentangan — dan laporan yang saling bertentangan menghancurkan kepercayaan merchant lebih cepat daripada fitur yang hilang.

**Kapan keputusan ini harus ditinjau ulang:** tidak ada kondisi yang wajar. Ini keputusan yang harus bertahan seumur produk.

---

## 6. Double-entry untuk uang

`[FAKTA]` Double-entry bookkeeping adalah metode di mana setiap transaksi finansial dicatat dengan entry yang sama besar dan berlawanan (debit dan kredit) — sehingga buku "seimbang". Tujuannya menjaga akurasi catatan finansial dan memungkinkan deteksi error atau fraud.

*Sumber: [Double-entry bookkeeping — Wikipedia](https://en.wikipedia.org/wiki/Double-entry_bookkeeping) · [A Short History of Ledgers — Modern Treasury](https://www.moderntreasury.com/journal/history-of-ledgers) (diakses 27 Jul 2026)*

### KEP-18 — Seberapa jauh double-entry diterapkan di v1

**Pertanyaan:** Apakah Lumi POS memerlukan ledger double-entry penuh dengan chart of accounts, atau ada bentuk yang lebih ringan yang tetap menjaga integritas?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Tanpa ledger — total disimpan di order, kas dihitung dari penjualan | Paling sederhana | Tidak ada cara mendeteksi uang yang "menguap". Selisih kas tidak bisa ditelusuri. Integrasi akuntansi nanti butuh rekonstruksi | Prototipe |
| B. Cash movement ledger: setiap pergerakan uang adalah entry bertanda, dengan invariant "saldo laci = SUM(movement)" | Menegakkan "uang tidak diciptakan/dihancurkan" pada domain kas. Menjawab pertanyaan tutup kas secara alami. Jauh lebih sederhana dari chart of accounts | Bukan double-entry sejati — tidak melacak sisi lawan (piutang, pendapatan, pajak terutang) | POS yang belum menjadi sistem akuntansi |
| C. Double-entry penuh dengan chart of accounts | Benar secara akuntansi; ekspor ke software akuntansi trivial; menangani piutang, pajak terutang, HPP | Butuh merchant memahami akun. Setiap transaksi menghasilkan banyak entry. Kompleksitas besar untuk nilai yang belum dibutuhkan segmen target | Produk yang menggantikan software akuntansi |

**Rekomendasi:** Opsi B untuk v1, dengan **struktur entry yang sengaja dibuat kompatibel dengan C.** `[INFERENSI]`

**Alasan:** Merchant 2–20 outlet segmen target tidak meminta jurnal akuntansi — mereka meminta jawaban atas "kenapa laci kurang Rp50.000". Cash movement ledger menjawab itu dengan tepat dan menegakkan invariant terpenting (uang tidak muncul dari ketiadaan) tanpa memaksa merchant memahami debit-kredit. Yang membuat ini aman untuk dipilih: catatan ESB menunjukkan bahwa merchant yang tumbuh **akan** meminta jurnal akuntansi otomatis (ESB mencantumkan "Automatic Sales Journal, Inventory Journal" bahkan di tier Basic) `[FAKTA — dari matriks fitur ESB]`, jadi jalur ke C harus tetap terbuka. Caranya: setiap `CashMovement` menyimpan `counterpart_type` sejak v1 (`sales_revenue`, `refund`, `paid_in`, `paid_out`, `bank_deposit`) meskipun sisi lawannya belum dibukukan. Ketika C dibutuhkan, informasi untuk menghasilkan sisi lawan sudah ada dan tidak perlu ditebak dari data historis.

**Kapan keputusan ini harus ditinjau ulang:** saat pelanggan pertama meminta ekspor ke software akuntansi (Accurate, Jurnal, Xero) — pada titik itu C menjadi kebutuhan nyata, bukan kesempurnaan teoretis.

**Sumber:** [Books, an immutable double-entry accounting database service — Square](https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/) (27 Jul 2026) · [ESB Pricing — matriks fitur](https://www.esb.id/id/pricing) (27 Jul 2026)

---

## 7. Versioning katalog agar struk historis tetap akurat

`[FAKTA]` commercetools mendefinisikan: **Line Item adalah snapshot dari Product Variant pada saat item ditambahkan ke Cart.** Pendekatan snapshot ini memastikan data order tetap konsisten meskipun informasi katalog berubah.
`[FAKTA]` Craft Commerce memberi peringatan penting tentang batas snapshot: snapshot **bukan sumber otoritatif** untuk harga, stok, ketersediaan, atau nilai lain yang bisa berubah — snapshot hanya dimaksudkan sebagai cara mengidentifikasi purchasable kepada pelanggan (dan admin) setelah order selesai. Data snapshot esensial ketika line item dari order yang sudah selesai harus ditampilkan padahal produk dan variant-nya sudah dihapus.
`[FAKTA]` Celah yang terdokumentasi di sistem nyata: API Shopify hanya mengekspos `InventoryItem.unitCost` saat ini, bukan cost historis yang tercatat per order/line item — ada permintaan untuk "mengekspos cost tercatat di level order dan line item (immutable historic COGS)".

*Sumber: [Carts and Orders overview — commercetools HTTP API](https://docs.commercetools.com/api/carts-orders-overview) · [Purchasables — Craft Commerce 5.x Documentation](https://craftcms.com/docs/commerce/5.x/system/purchasables.html) · [Cost on Orders API — Shopify Community](https://community.shopify.com/t/cost-on-orders-api/1610) (semua diakses 27 Jul 2026)*

### KEP-19 — Strategi versioning katalog

**Pertanyaan:** Bagaimana struk enam bulan lalu tetap menampilkan harga, nama, dan pajak yang benar setelah katalog berubah puluhan kali?

**Opsi yang dipertimbangkan:**

| Opsi | Kekuatan | Kelemahan | Cocok bila |
|---|---|---|---|
| A. Order line menyimpan `variation_id` saja; nama & harga diambil dari katalog saat menampilkan | Skema minimal; katalog adalah sumber kebenaran tunggal | **Salah untuk sistem finansial.** Harga naik → seluruh riwayat berubah. Produk dihapus → struk lama rusak. Tidak bisa dipertahankan di audit pajak | Sistem non-finansial |
| B. Order line sebagai **snapshot**: menyimpan nama, harga satuan, pajak, dan komposisi modifier hasil salin, **plus** referensi ke katalog untuk pelaporan | Struk historis kebal terhadap perubahan katalog. Pola yang dipakai commercetools dan Craft Commerce. Sederhana untuk dipahami dan di-debug | Duplikasi data (nama produk berulang di jutaan baris). Perubahan nama produk tidak terefleksi di riwayat — yang justru diinginkan | POS dan e-commerce |
| C. Katalog ber-versi penuh: setiap perubahan menghasilkan versi baru; order line mereferensikan `(variation_id, version)` | Tidak ada duplikasi; sejarah katalog bisa ditelusuri sendiri; bisa menjawab "harga apa yang berlaku pada tanggal X" | Setiap query katalog butuh resolusi versi. Tabel katalog tumbuh dengan setiap edit harga. Kompleksitas besar termasuk di sisi klien offline | Katalog yang sering berubah dengan kebutuhan audit atas katalognya sendiri |

**Rekomendasi:** Opsi B, ditambah **tabel riwayat harga terpisah** yang ringan (bukan versioning penuh atas seluruh entitas katalog). `[INFERENSI]`

**Alasan:** Snapshot menyelesaikan masalah utama — akurasi struk historis — dengan biaya termurah dan model mental yang paling mudah dijelaskan. Peringatan Craft Commerce menetapkan batas yang harus dihormati: snapshot untuk **identifikasi dan tampilan**, bukan sebagai basis perhitungan ulang. Tabel riwayat harga terpisah ditambahkan karena satu pertanyaan tidak terjawab oleh snapshot saja: *"kapan harga kopi naik dan siapa yang menaikkannya"* — pertanyaan yang muncul dalam sengketa internal antara owner dan manajer, dan yang celahnya sudah terdokumentasi di sistem sebesar Shopify.

**Yang wajib masuk snapshot di order line** (di luar ini akan menyebabkan struk historis salah):
`item_name` · `variation_name` · `unit_price` · `quantity` · `modifier_snapshot` (array nama+harga) · `discount_applied` (nilai, bukan referensi ke aturan diskon) · `tax_rate` dan `tax_amount` · `is_tax_inclusive` · `cost_at_sale` (HPP saat itu, untuk margin historis yang benar).

Kolom terakhir adalah yang paling sering dilupakan dan celah yang persis dikeluhkan di Shopify. Tanpa `cost_at_sale`, laporan margin akan menghitung ulang memakai HPP hari ini dan menghasilkan angka yang salah untuk seluruh periode historis.

**Kapan keputusan ini harus ditinjau ulang:** jika muncul kebutuhan regulasi untuk mengaudit **katalognya sendiri** (misalnya pembuktian bahwa harga tertentu berlaku pada tanggal tertentu untuk sengketa hukum), tabel riwayat harga saja mungkin tidak cukup dan versioning penuh (Opsi C) menjadi perlu untuk entitas harga.

---

## 8. API versioning

`[INFERENSI]` Dari KEP-09 (Fase 3): klien POS tidak bisa dipaksa update, sehingga server harus melayani banyak versi klien untuk periode panjang. Konkretnya:

| Aturan | Alasan |
|---|---|
| Versi mayor di path (`/v1/`, `/v2/`), bukan di header | Terlihat di log, cache, dan routing. Debugging insiden dengan merchant jadi mungkin |
| Perubahan **additive** tidak menaikkan versi | Menambah field opsional aman; klien lama mengabaikannya |
| Perubahan **breaking** memicu versi baru, dan versi lama hidup **minimal 12 bulan** | Merchant yang tidak update selama setahun bukan skenario hipotetis |
| Setiap request klien mengirim versi aplikasi & versi skema lokal | Server bisa menolak dengan pesan yang berguna ("versi aplikasi terlalu lama, perbarui sebelum tanggal X") alih-alih gagal misterius |
| Deprecation diumumkan lewat field respons, bukan hanya email | Merchant tidak membaca email; aplikasi bisa menampilkan peringatan di dashboard owner |

**Yang berbeda dari API web biasa dan sering dilupakan:** POS punya **dua kontrak versi**, bukan satu. Selain kontrak API, ada **kontrak skema database lokal** di device. Migrasi skema SQLite lokal harus bisa berjalan pada device yang tertinggal beberapa versi, offline, tanpa intervensi — dan harus bisa gagal dengan aman (rollback ke skema lama, tetap bisa jualan) alih-alih meninggalkan device dalam state rusak. Digarap di Fase 10.

---

## 9. Pola data model kunci & jebakan

| Pola | Aturan | Jebakan yang dihindari |
|---|---|---|
| **Uang** | `bigint` dalam rupiah utuh (design system menetapkan tanpa desimal). Tidak pernah `float`/`double` | Kesalahan pembulatan yang terakumulasi. Total yang tidak sama dengan jumlah baris |
| **Waktu** | `timestamptz` di server, UTC di penyimpanan, konversi ke WIB/WITA/WIT di tampilan. Simpan **dua** waktu untuk transaksi offline: `occurred_at` (waktu device) dan `recorded_at` (waktu server) | Laporan harian yang salah karena zona waktu. Transaksi offline yang "terjadi di masa depan" karena jam device miring |
| **ID** | UUIDv7 atau ULID di-generate klien. Bukan auto-increment | Auto-increment mustahil untuk penulisan offline. UUIDv4 acak merusak lokalitas index; UUIDv7/ULID terurut waktu |
| **Soft delete** | Katalog: `archived_at`, tidak pernah `DELETE`. Transaksi: tidak ada delete sama sekali | Menghapus produk merusak struk historis (dimitigasi snapshot, tapi referensi tetap perlu ada) |
| **Tenant & outlet** | `tenant_id` pada semua tabel; `outlet_id` pada semua tabel transaksional dan sebagian master | Menambahkan tenant_id belakangan berarti mengaudit setiap query. Ini kesalahan yang paling mahal dari seluruh daftar |
| **Enum** | Sebagai string terbatas dengan check constraint, bukan integer | Integer enum membuat data mentah tidak terbaca saat debugging insiden produksi |
| **Pajak** | Disimpan sebagai nilai dan tarif di line, bukan dihitung ulang | Perubahan tarif pajak mengubah riwayat. Digarap di Fase 6 |
| **Sync metadata** | Kolom versi/checkpoint dan tombstone pada setiap tabel yang direplikasi | Menambahkannya setelah ada data di device berarti migrasi terkoordinasi di semua device |

### Ilustrasi bentuk order line (bukan kode implementasi, hanya bentuk)

```
order_line
  id                  ulid          -- di-generate klien
  order_id            ulid
  check_id            ulid          -- KEP-06, 1:1 dengan order di v1
  -- referensi (untuk pelaporan & analitik)
  variation_id        uuid          -- boleh menunjuk ke katalog yang sudah diarsip
  -- snapshot (untuk struk & audit; tidak pernah dihitung ulang)
  item_name           text
  variation_name      text
  unit_price          bigint        -- rupiah utuh
  quantity            numeric       -- numeric karena retail bisa 0,5 kg
  modifier_snapshot   jsonb         -- [{name, price}, ...]
  discount_amount     bigint
  tax_rate            numeric
  tax_amount          bigint
  is_tax_inclusive    boolean
  cost_at_sale        bigint        -- HPP saat transaksi; sering dilupakan
  line_total          bigint
```

`[INFERENSI]` `quantity` sebagai `numeric` dan bukan `integer` adalah keputusan kecil dengan konsekuensi besar: retail Indonesia menjual beras per kg dan daging per ons. Menetapkannya integer di v1 berarti migrasi seluruh tabel transaksi saat vertikal retail dirilis.

---

## Implikasi untuk dokumen pra-produksi

**Untuk PRD:**
- Perilaku "stok boleh negatif" harus menjadi setting eksplisit per profil vertikal dengan default yang dinyatakan, bukan perilaku implisit.
- Void dan refund butuh user story terpisah dengan prasyarat berbeda, dan keduanya menghasilkan record baru — ini harus terlihat di acceptance criteria ("setelah void, transaksi asli tetap muncul di riwayat dengan penanda dibatalkan").
- Laporan yang menampilkan angka penjualan harus menyatakan secara eksplisit apakah angkanya bersih (setelah void & refund) atau kotor. Ambiguitas di sini menghasilkan komplain merchant yang tidak berujung.
- Kebijakan dukungan versi (server melayani klien N-2 selama 12 bulan) adalah komitmen produk yang harus disetujui, bukan detail implementasi.

**Untuk Information Architecture:**
- Riwayat transaksi harus menampilkan rantai koreksi (penjualan asli → void → penjualan pengganti) sebagai satu alur yang terbaca, bukan tiga baris terpisah yang membingungkan.
- Lubang pada nomor struk harus punya tempat di laporan audit — layar yang menampilkan "nomor yang tidak terpakai" beserta alasannya.

**Untuk ERD:**
- Setiap tabel transaksional: `id` (ULID client-generated), `tenant_id`, `outlet_id`, `device_id`, `occurred_at`, `recorded_at`, `created_by`.
- Tabel `idempotency_key` dengan `key`, `request_hash`, `response_body`, `expires_at` (30 hari), ditulis dalam transaksi yang sama dengan entitas yang dilindungi.
- Tabel `outbox` untuk event pasca-commit.
- `order_line` memuat snapshot penuh sesuai bentuk di bagian 9, termasuk `cost_at_sale`.
- `price_history` sebagai tabel ringan terpisah: `variation_id`, `outlet_id`, `price`, `effective_from`, `changed_by`.
- `cash_movement` dengan `counterpart_type` sejak v1 meskipun sisi lawan belum dibukukan.
- Tidak ada foreign key dari transaksi ke katalog yang bersifat `ON DELETE CASCADE`. Katalog tidak pernah di-delete, hanya di-archive.

**Untuk Technical Architecture:**
- Kepemilikan tabel per modul harus didokumentasikan sebagai tabel eksplisit, dan penegakannya (skema PostgreSQL terpisah atau audit query) harus menjadi bagian dari CI, bukan review manual.
- Pola transactional outbox harus dijelaskan sebagai satu-satunya cara memancarkan event — bukan salah satu opsi.
- Aturan "satu penjualan = satu transaksi database" harus dinyatakan sebagai invariant arsitektural dengan test yang membuktikannya (uji kegagalan di tengah penulisan tidak meninggalkan penjualan parsial).
- Fungsi/view tunggal untuk menghitung posisi penjualan bersih harus ditetapkan sebagai satu-satunya sumber untuk semua laporan.

---

*Dokumen ini bagian dari paket riset Lumi POS. Lanjut ke `05-OFFLINE-SYNC-STRATEGY.md` — area risiko tertinggi.*
