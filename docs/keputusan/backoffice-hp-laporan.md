# Back-office, Owner mobile, dan laporan — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

### G2 — Owner mobile (`apps/hp`), 25 Agustus 2026

**Aplikasi KETIGA berdiri**, dan keempat layar v1 `IA:§4` ada: M-00 login ·
M-01 Ringkasan Hari Ini · M-02 Perlu Diperiksa · M-03 Laporan ringkas. M-04
(otorisasi jarak jauh) tetap v1.1 — `IA:251`.

> `IA:229` — *"Persona P3 membuka aplikasi **pukul 23:00 untuk satu
> pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan
> menyediakan navigasi lengkap."*

⛔ **Tiga modul PINDAH menjadi milik bersama, tidak satu pun disalin.** Aplikasi
ketiga adalah titik di mana salinan mulai menyimpang:

| Ke | Isi | Kenapa |
|---|---|---|
| `packages/klien-api` | `http.ts` · `sesi-simpanan.ts` · `sesi.tsx` | `IA:245`: kredensial M-00 SAMA dengan back-office. Dua klien sesi yang menyimpang menghasilkan aplikasi yang berhenti dari sesi yang masih hidup — atau tetap menampilkan layar dengan sesi yang sudah mati |
| `packages/domain/src/uang-tampilan.ts` | `rupiah` · `bacaRupiah` | Format uang adalah aturan produk, dan yang ditulis ulang per layar menyimpang tepat di nilai besar, negatif, dan hilang |
| `packages/domain/src/metode-tampilan.ts` | `LABEL_METODE` · `LABEL_STATUS_BAYAR` | HP merinci pembayaran per metode; dua peta yang menyimpang menyebut saluran berbeda dari back-office untuk hari yang sama |

⛔ **`apps/kasir/src/cetak/metode.ts` SENGAJA tetap terpisah** — nama di struk
dipendekkan karena struk 58 mm hanya 32 kolom, dan "QRIS (dinamis)" tidak muat.
Batasnya dinyatakan di kedua berkas.

**Keputusan yang mengikat kode Owner mobile:**

- ⛔ **"Hari ini" diputuskan SERVER, bukan jam HP.** `date` di
  `GET /reports/daily-summary` OPSIONAL; dikosongkan berarti hari ini, dihitung
  dari `now()` database + zona outlet + jam tutupnya lewat `tanggalBisnis` yang
  kasir pakai. FR-F8 ada di produk ini justru karena jam perangkat berbohong
  cukup sering untuk perlu dideteksi, dan HP yang jamnya maju satu hari meminta
  ringkasan hari yang belum terjadi lalu menerima **nol transaksi tanpa satu pun
  error** — owner menyimpulkan outletnya tidak berjualan. `date` KOSONG tetap
  ditolak: string kosong berarti klien bermaksud menyebut tanggal dan gagal.
- ⛔ **Tanpa `outlet_id`, "hari ini" hanya dijawab bila SELURUH outlet aktif
  sepakat** zona waktu DAN jam tutup. Pukul 23:00 di Jayapura masih pukul 21:00
  di Jakarta; angka gabungan memuat dua tanggal bisnis berbeda. `400
  BUSINESS_DATE_AMBIGUOUS` dengan instruksi memilih outlet — bentuk yang sama
  dengan "ringkasan stok `null` tanpa `outlet_id`". Outlet DIARSIPKAN tidak ikut
  membuatnya ambigu.
- ⛔ **Pembanding tren HARI YANG SAMA empat minggu ke belakang** (FR-G6,
  `spec-g:243`), bukan hari sebelumnya. Delta terhadap kemarin membuat setiap
  Senin terlihat seperti bencana dan setiap Jumat seperti rekor — dua sinyal
  palsu setiap minggu, selamanya. `deltaPersen: null` BERBEDA dari 0; hari
  pembanding yang tidak punya transaksi tidak dihitung nol; minimum dua hari
  (`[ASUMSI]`), dan `basisMinggu` menyatakan seberapa kasar pembandingnya.
- ⛔ **Daftar "perlu diperiksa" TERTUNGGAK, bukan harian**
  (`GET /reports/needs-attention`). Oversell yang belum ditindaklanjuti tiga
  hari lalu masih perlu ditindaklanjuti malam ini. Daftar yang disaring per
  tanggal **mengosongkan dirinya setiap tengah malam**. Diurutkan ulang LINTAS
  JENIS — tiga daftar yang disambung apa adanya membuat M-01, yang hanya
  menampilkan tiga teratas, tidak pernah menampilkan selisih kas.
  `jumlah` adalah TOTAL, bukan panjang `temuan`.
- ⛔ **Server mengirim DATA; kalimatnya disusun klien.** Kalimat yang disusun
  server menjadi kalimat KEDUA yang harus dijaga sepakat dengan back-office.
  Tanpa satu pun kata yang menyalahkan orang (`spec-g:168`), diuji di kedua
  sisi — oversell khususnya **bukan kesalahan**, ia konsekuensi CAP.
- ⛔ **Rincian per outlet dihitung `posisiPenjualan` per kelompok**, bukan
  `GROUP BY … SUM`. Ia bergantung pada order PEMBATAL berbagi outlet dengan
  aslinya — benar hari ini karena `cancel.ts` menyalin `outlet_id` lewat
  `INSERT … SELECT`. Refund menempel pada outlet ORDER-nya (JOIN), dan yang
  jatuh ke outlet salah membuat satu cabang terlihat merugi dan satu untung.
  `perOutlet: null` saat satu outlet diminta; outlet tanpa transaksi tidak
  muncul sebagai baris nol.
- ⛔ **Setiap angka bertanda membawa KATANYA**, dan besaran ditampilkan **tanpa
  tandanya** — "−12,3% lebih rendah" adalah negasi ganda yang dibaca cepat
  berarti naik. Panah tidak pernah sendirian (aturan DS #5).
- ⛔ **Bilah nav DUA item, dan keduanya bukan yang wireframe gambar.**
  `IA:§4.2` menulis `[Laporan] [Otorisasi]`; Otorisasi adalah M-04 dan tidak ada
  di v1, jadi tab yang menujunya akan mati. Yang dipakai `[Ringkasan]
  [Laporan]`. **M-02 bukan tab** — `spec-g:245` melarang bagian "perlu
  diperiksa" muncul tanpa temuan, dan tab untuknya akan tampil juga saat tidak
  ada apa pun.
- ⛔ **Pengambilan data di `Beranda.tsx`, bukan di tiap layar.** M-01 meringkas
  daftar yang M-02 tampilkan penuh; dua permintaan untuk satu jawaban dapat
  berbeda.
- ⛔ **`CATATAN_ANTREAN` selalu tampil**, juga saat angkanya lengkap: angka di
  layar adalah apa yang SUDAH SAMPAI ke server, bukan apa yang terjual.
- **Rute di state, bukan di URL** — tidak satu pun dari ketiga layar berguna
  di-bookmark. **Online-only** (`IA:265`): tanpa PowerSync, tanpa SQLite lokal.
- **Bukan PWA** — `IA:445` masih membukanya sebagai pertanyaan. **M-03 adalah
  SATU laporan, bukan sembilan.** **Email di DUA tenant tidak dapat masuk lewat
  HP** (tanpa field "ID Tenant" di layar 390px).

**AC FR-A2 KEEMPAT ditutup 25 Agustus 2026** (migrasi `0035`, keputusan user).

⛔ **Yang diperbaikinya adalah cacat NYATA:** `cetak/dokumen.ts` menerima
`variationName` di setiap baris dan **tidak pernah merendernya sama sekali**.
Merchant yang menjual "Kopi Susu Regular" dan "Kopi Susu Large" mencetak dua
baris struk yang **tidak dapat dibedakan** — dan struk adalah satu-satunya
bukti yang pelanggan pegang. Bidangnya dibawa sepanjang jalur cetak lalu
dijatuhkan di titik render; seluruh test kasir hijau di atasnya.

- ⛔ **`order_line.variation_count_at_sale` adalah SNAPSHOT, dan itu yang
  membuat ACnya dapat ditegakkan sama sekali.** Cetak ulang membangun
  dokumennya dari `order_line` dan `spec-b:145` melarangnya menyentuh tabel
  katalog; jumlah varian karena itu harus ada DI BARISNYA, kalau tidak cetakan
  pertama (yang punya katalog di tangan) dan cetak ulang (yang tidak) akan
  berbeda tepat pada hari merchant menambahkan varian kedua.
- ⛔ **Aturan berbasis NAMA ("sebut varian bila berbeda dari nama item")
  DICOBA dan DIKEMBALIKAN.** Ia bertentangan dengan contoh spec sendiri:
  `spec-c:376` mencetak "2x Kopi Susu" untuk baris ber-varian "Regular". Ada
  test kontrol yang mereproduksi contoh itu dan menolak aturan tersebut —
  sabotase memastikan ia menyala.
- ⛔ **`DEFAULT 1` dibuang setelah backfill** (pola `refund.method`, migrasi
  `0021`). Default yang tertinggal membuat jalur tulis berikutnya yang lupa
  mengirimnya diam-diam mengaku "produk ini hanya punya satu varian", dan nama
  varian menghilang dari struk tanpa satu pun error. Enam fixture test langsung
  gagal keras saat migrasi jalan — itu justru gunanya.
- ⛔ **Varian yang DIARSIPKAN ikut dihitung.** Pertanyaannya "apakah nama
  varian menambah informasi bagi pelanggan", dan merchant yang mengarsipkan
  "Large" hari ini tetap punya pelanggan yang memegang struk "Regular" dari
  kemarin.
- ⛔ **Jumlah dibekukan di baris keranjang**, bukan dibaca ulang saat menyimpan:
  katalog dapat turun di tengah antrean pelanggan.
- ⛔ **`CHECK (>= 1)`.** Nol berarti "item tanpa varian", keadaan yang tidak
  dapat ada — dan nol yang lolos membuat `> 1` bernilai false, gejala yang sama
  dengan default yang tertinggal.
- ⛔ **Biaya yang dinyatakan:** `order_line` adalah raw table, jadi kolom baru
  mengubah sidik jari skema lokal dan setiap perangkat membangun ulang tabel
  raw-nya (`disconnectAndClear()`). Riwayat penjualan LOKAL perangkat hilang
  karenanya — K-08 dan cetak ulang K-09 untuk penjualan lama berhenti bekerja
  di perangkat yang sudah terpasang. **Sejak stream `riwayat` (29 Agustus
  2026), `order_line` kembali lewat stream itu** — disaring per `device_id`,
  tanpa batas tanggal — jadi riwayat lokal tidak lagi hilang permanen di
  perangkat yang bermigrasi. Batas yang dinyatakan: stream itu **belum pernah
  dijalankan terhadap PowerSync sungguhan** (`kasir-offline-sync.md`).

⛔ **AC FR-G6 KELIMA: `Payload Optimized <50KB (Environment-Blocked)`** —
status resmi user, 25 Agustus 2026. *"Render < 2 detik pada koneksi seluler"*
dipindahkan ke Acceptance Test, sejajar dengan gate F4 bagian pertama.

⛔ **Yang menjadi dasarnya adalah UKURAN muatan, bukan latensi terukur.**
Agregasi terjadi di server dan responsnya beberapa puluh baris; tidak ada satu
pun pengukuran throttling yang pernah dijalankan **di dalam repo ini**, dan
tidak ada test yang menegakkan ambang dua detik. Kalimat "sudah diverifikasi"
tentang AC ini salah; yang benar "biayanya dibatasi di sisi muatan, latensinya
belum diukur".

### G1 — back-office, milestone ditutup 16 Agustus 2026

`apps/backoffice` bukan lagi kerangka. Empat epik selesai dan ter-merge, semuanya lewat PR ber-CI:

| Epik | Layar | PR |
|---|---|---|
| **Dasbor** | B-01 beranda | #44 |
| **Penjualan** | B-02 riwayat · B-03 detail transaksi · B-04 shift · B-05 detail shift | #34–#36, #41 |
| **Inventori** | B-12 stok · B-13 penyesuaian · B-14 opname · B-15 perlu diperiksa | #38–#40, #42, #43 |
| **Pengawasan** | B-21 laporan exception | #32, #33 |

**⛔ Modul `reporting` adalah satu-satunya yang boleh MEMBACA lintas domain.** Ia lahir bersama B-03 dan aman karena dua sifat yang **diuji**, bukan dijanjikan: ia tidak memiliki satu pun tabel, dan ia tidak pernah menulis. Invariant #4 karena itu tidak dilonggarkan — yang dibuat adalah satu tempat yang batasnya dinyatakan dan dijaga. Setiap layar yang menjahit data dari beberapa modul masuk ke sana.

**Keputusan yang mengikat kode back-office:**

- **`posisi-penjualan.ts` tetap satu-satunya definisi omzet, dan B-01 membuktikannya lewat test.** Dasbor memakai `ambilPenjualan`/`ambilProduk`/`ambilStok` — fungsi yang **sama persis** dengan B-16/B-17/B-12, diekspor lewat `index.ts` masing-masing. Test utamanya `assert.deepEqual` terhadap respons `GET /reports/sales`, bukan terhadap angka tulisan tangan. Dasbor adalah layar yang pertama dilihat merchant setiap pagi dan yang paling jarang diperiksa ulang; angka di sini yang berbeda dari laporan akan dipercaya lebih dulu.
- **Top-N diambil `slice`, bukan `LIMIT` di query kedua.** Query kedua dengan urutannya sendiri adalah tempat kedua yang memutuskan "terlaris".
- **Ringkasan stok `null` tanpa `outlet_id`.** Stok per outlet; satu angka gabungan lintas outlet tidak dapat dipakai memutuskan apa pun — kekurangan di satu cabang tertutup kelebihan di cabang lain.
- **`order` TIDAK berisi satu baris per transaksi.** Order pembatal adalah baris tersendiri dan order asli tetap `open` (lihat § void & refund). Setiap layar riwayat harus menurunkan status dari ada/tidaknya pembatal, bukan dari kolom `status`.
- **B-06 memakai pencarian SISI SERVER**, dan `saringProduk` dihapus (21 Agustus 2026). Dua tempat yang memutuskan "produk mana yang cocok" akan menyimpang; yang menyimpang menghasilkan pencarian yang menemukan hal berbeda tergantung layar mana yang bertanya. ⛔ Server punya cabang `category_id IS NULL` untuk `TANPA_KATEGORI` — tanpa itu, saringan "tanpa kategori" mengembalikan **nol produk** alih-alih produk tanpa kategori, dan nol terlihat persis seperti "memang tidak ada". Konstantanya di `packages/domain/src/katalog-saringan.ts`.
- **Paginasi riwayat wajib keyset, bukan offset.** Perangkat offline menyisipkan baris ber-`business_date` historis di tengah urutan; offset akan melewatkan atau menggandakan baris tepat saat antrean terkuras.
- **Delta opname dihitung dari snapshot pada T**, bukan dari stok saat tombol ditekan (FR-E7) — penjualan yang terjadi SELAMA opname tidak boleh ikut terkoreksi. Dibuktikan di browser: stok 5, bukan 8.
- **Ambang stok menipis dan `AMBANG_SELISIH` hidup di `packages/domain`**, dibagi server dan klien. Konstanta yang dipanggang di satu sisi akan menyimpang dari sisi lain.

**⛔ Utang PostgreSQL yang dibersihkan, 16 Agustus 2026 (PR #45):** `Promise.all` atas **satu `PoolClient`** dihapus dari ketiga tempat yang punya — rute Dasbor (`reporting/handlers/dasbor.ts`), Identity (`identity/handlers/users.ts`), dan Reporting (`reporting/index.ts`).

`node-postgres` **tidak** memparalelkan query pada satu koneksi; ia mengantrekannya. Jadi polanya tidak pernah membeli apa pun — yang didapat hanya `DeprecationWarning: Calling client.query() when the client is already executing a query`, perilaku yang **dihapus di pg@9**. Terlihat di log server saat E2E, bukan di test: ketiganya menjawab benar.

Memparalelkannya dengan sungguh-sungguh menuntut koneksi tambahan, dan itu berarti transaksi tambahan — `SET LOCAL app.tenant_id` berlaku **per transaksi** (invariant #8), jadi responsnya berhenti menjadi satu potret pada satu titik waktu. **Jangan mengembalikan `Promise.all` ke sana sebagai "optimasi";** alasannya ditulis sebagai komentar di ketiga berkas.

Gate F3 `ARCH:§14` — *"buka toko → jual → tutup buku dengan angka konsisten antar laporan"* — terpenuhi: buku kas menjadi sumber tunggal saldo laci, satu fungsi mendefinisikan omzet untuk seluruh laporan, dan stok akhirnya bergerak dua arah.

**Apa yang F3 temukan, dan ini polanya:** setiap potongan Modul G dan E yang dibangun menjatuhkan cacat diam di kode yang sudah lolos review dan lolos gate sebelumnya. Empat, semuanya di jalur uang atau stok, semuanya tanpa satu pun error:

| Cacat | Akibatnya | Yang menyembunyikannya |
|---|---|---|
| Saldo laci dihitung dari `payment`, bukan `cash_movement` | Refund tunai tidak pernah mengurangi laci; kasir terlihat kurang sebesar nilai refund, **dan tutup kasnya menuntut otorisasi manajer** untuk selisih yang tidak ada | Fake `DbLokal` diberi baris `{method:'cash', arah:-1}` yang query sungguhannya **tidak dapat hasilkan** |
| Tidak ada `stock_movement` bertipe `sale` sama sekali | Stok hanya pernah NAIK — void/refund mengembalikan barang yang tidak pernah dikurangi | 18 test void/refund menghitung SELURUH baris `stock_movement`; nol adalah jawaban benar karena alasan yang salah |
| `getVariationSnapshot` memetakan `itemId`/`categoryId` tanpa menyeleksinya | Tarif ber-scope item/kategori **tidak pernah berlaku**; FR-C6 punya tiga tingkat, dua teratasnya mati | Test hanya menguji PEMBUATAN tarif ber-scope item, bukan penerapannya ke order |
| Cabang `arah = -1` di tutup kas | Kode mati yang menyamar sebagai penanganan pembatalan | Order pembatal tidak punya baris `payment`; cabangnya tidak pernah menyala |

**Yang ketiganya punya bersama:** test yang hijau karena hampa. Bukan test yang salah menghitung — test yang memeriksa keadaan yang tidak dapat terjadi. Itu kelas yang tidak tertangkap review dan tidak tertangkap coverage.

Seluruh isi F2 yang `ARCH:§14` sebut kini ada, dan **seluruh alur kasir berjalan tanpa jaringan**:

```
login PIN → buka shift → jual (grid + modifier) → bayar tunai
          → riwayat → batalkan/refund → tutup kas → laporan shift
```

| Layar | Kode | Bukti |
|---|---|---|
| Login PIN | K-01 | Argon2 WASM, 33 ms, diverifikasi di browser |
| Buka shift | K-02 | Tanggal bisnis dari zona outlet; relay `pending → sent` |
| Kasir + modifier | K-03/04/05 | Tangga harga tiga tingkat berjalan di perangkat |
| Pembayaran | K-06/07 | Satu `writeTransaction`; mendarat di server dengan ULID klien |
| Riwayat + detail | K-08/09 | Rantai koreksi dua arah |
| Void/refund | K-10 | Dua identitas, stok kembali, nol payment negatif |
| Otorisasi | K-11 | PIN manajer diverifikasi lokal |
| Tutup kas + laporan | K-12/13 | Urutan input wajib; percobaan hitungan tercatat |

**Gate F2 hijau:** `npm run test:dst` — 10.000 iterasi fault injection, nol pelanggaran atas sepuluh invariant.

### FR-G5 — delapan laporan exception, keputusan yang mengikat kode

`spec-g:151` menyebutnya *"fitur yang **dibeli owner**, bukan sekadar kontrol keamanan"*. Tujuh dari delapan belum ada sampai 23 Agustus 2026; kini tujuh selesai (X1, X2, X3, X4, X5, X7, X8) dan satu **tidak dapat dibangun**.

- ⛔ **X2–X7 hidup di `reporting`, X1 tetap di `ordering`.** Yang baru membaca `cash_drawer_shift` + `audit_event` + `"order"` — tiga modul dalam satu pertanyaan, dan `reporting` satu-satunya yang boleh (invariant #4). X1 lahir sebelum modul itu ada; memindahkannya adalah refactor tersendiri, dan `reporting/index.ts` sudah menyatakan kebijakan itu sejak B-03.
- ⛔ **Penjaga `report_exception` dipasang di SATU pembungkus**, bukan disalin per laporan. Laporan berikutnya yang lahir akan lupa menyalinnya, dan yang lupa membocorkan daftar siapa-membatalkan-apa ke kasir.
- ⛔ **Prinsipnya VARIASI, bukan nilai absolut** (`spec-g:153`). X3 memakai persentil 90 dari periode yang diminta — ambang rupiah tetap menandai seluruh kasir di kafe besar dan tidak pernah menandai siapa pun di kafe kecil. Ambangnya ikut di respons: daftar tanpa ambangnya tidak dapat dijelaskan kepada kasir yang namanya ada di sana.
- ⛔ **X2 membandingkan dengan `shift.closed_at`, bukan jam sekarang.** Shift yang belum ditutup tidak punya "60 menit terakhir"; menghitungnya dari sekarang menghasilkan laporan yang jawabannya berubah tanpa satu pun data berubah.
- ⛔ **X8 membaca `clock_drift_detected`, bukan selisih `occurred_at` vs `recorded_at`.** Selisih keduanya adalah durasi offline pada hampir setiap penjualan yang produk ini ada untuk mendukung.
- ⛔ **X7 mengembalikan total DAN total mutlak.** Kasir yang kurang Rp 50.000 lalu lebih Rp 50.000 punya total nol dan mutlak Rp 100.000 — dua angka yang menceritakan hal yang sangat berbeda.
- ⛔ **X6 TIDAK DAPAT DIBANGUN, dan KEP-21 tidak mengubahnya.** "Item ditambah lalu dihapus berkali-kali" menuntut RIWAYAT perubahan keranjang; keranjang yang bertahan (24 Agustus 2026) menyimpan **keadaannya**, dan keadaan terakhir tidak menyebut apa pun yang pernah dihapus darinya. Menyimpan riwayatnya menuntut telemetri yang memuat nama produk — yang `ARCH:309` larang. Batas yang dinyatakan, bukan penundaan.
- **Tanpa bahasa menuduh, dan itu diuji.** Tidak ada field skor maupun label; ada test yang memindai JSON keluaran ketujuhnya. `spec-g:168`: *"produk yang menuduh karyawan merchant akan merusak hubungan merchant dengan stafnya"*.

**B-21 menampung kedelapan laporan, 23 Agustus 2026.** `IA:200` menamainya "Laporan Exception (8 laporan)" — satu layar, penyeleksi tab, bukan delapan entri menu (`IA:173` menjelaskan kenapa PENGAWASAN dipisah dari LAPORAN sama sekali; memecahnya delapan mengembalikan masalah yang pemisahan itu selesaikan).

- ⛔ **Daftar laporan adalah DATA (`apps/backoffice/src/pengawasan/b21-daftar.ts`), bukan cabang JSX.** Penjaga bahasa menuduh karena itu membaca data, bukan berkas: laporan kesembilan yang lahir kelak diperiksa tanpa siapa pun mengingat penjaganya ada.
- ⛔ **`pesanLaporan` adalah SATU fungsi untuk kedelapan keadaan layar.** "Belum dimuat", "tidak ada apa-apa", dan "gagal memuat" tampak sama dan berarti sangat berbeda; delapan salinan berarti tujuh kesempatan melupakan kalimat "perangkat yang belum tersinkronisasi juga menghasilkan daftar kosong" — dan yang lupa membuat kegagalan jaringan terbaca sebagai **pembebasan** orang yang namanya tidak muncul. `pesanKeadaan` di `b21.ts` dihapus, bukan disalin.
- ⛔ **Bentuk respons X3 BERSARANG, dan `barisLaporan` menanganinya di satu tempat.** Hasil X3 ada di bawah kunci `laporan` sebagai objek `{ambang, jumlahSeluruhRefund, refund}`, bukan larik: `hasil[kunci].length` adalah `undefined`, `undefined > 0` adalah `false`, dan layar berkata "tidak ada refund" untuk periode yang penuh refund tanpa satu pun error.
- ⛔ **X6 tetap punya tab, dengan alasannya di layar, untuk SETIAP keadaan** — termasuk `siap`: berpindah ke tab X6 tidak boleh menampilkan tabel refund yang baru saja dilihat. Menghilangkan tabnya membuat merchant yang membaca spec menyimpulkan laporannya rusak.
- **Angka bertanda selalu disertai KATANYA**: selisih kas negatif diberi kata "kurang", menit ke penutupan yang negatif dibaca "sesudah tutup", selisih jam dibaca "maju"/"mundur". Tren `datar` berbunyi "belum menunjukkan arah", bukan "stabil" — `arahTren` mengembalikan `datar` juga untuk deret yang terlalu pendek.
- **Endpoint tiap laporan dicocokkan ke `openapi.yaml` oleh test.** Path salah ketik menghasilkan 404 yang layar tampilkan sebagai "laporan tidak dapat dimuat" — tidak dapat dibedakan dari server mati.


### B-22 Audit & Aktivitas, dan kosakata `audit_event` (23 Agustus 2026)

⛔ **`audit_event.event_type` kini daftar TERTUTUP** (`packages/domain/src/audit-peristiwa.ts`), dan `recordAuditEvent` menerima `PeristiwaAudit`, bukan `string`. Sampai sekarang delapan belas nama tersebar di dua belas berkas tanpa satu pun terdaftar di mana pun. Ejaan yang menyimpang **tidak menghasilkan error** — ia menghasilkan baris audit yang tidak pernah cocok dengan saringan mana pun, dan laporan yang melewatkannya terlihat persis seperti laporan yang tidak menemukan apa pun. Bentuk cacat yang sama persis dengan `stock_movement.type`.

⛔ **Audit trail BERLUBANG terhadap `spec-f:288`, dan lubangnya adalah DATA.** Saat ditemukan: 24 dari 35 nama di tabel spec belum dipancarkan sama sekali. `PERISTIWA_BELUM_DIPANCARKAN` diturunkan dari selisih kedua daftar, ikut di respons `GET /audit-events`, dan **disebutkan di layar**: trail berlubang yang terlihat lengkap lebih berbahaya daripada trail yang tidak ada. Daftarnya menyusut sendiri saat peristiwanya mulai ditulis, jadi tidak ada daftar kedua yang harus diingat untuk dipangkas. FR-F6 **ditutup 25 Agustus 2026** — daftar itu kosong.

**Ditutup 23 Agustus 2026, lubang 24 → 9**, lewat satu pembungkus `catatPerubahanServer` di modul `audit`: katalog/harga/stok/pajak (`item_created` · `item_updated` · `item_archived` · `price_changed` · `stock_adjusted` · `stocktake_completed` · `sold_out_toggled` · `tax_rate_changed`), lalu sesi/shift/perangkat/ekspor (`login` · `logout` · `shift_opened` · `cash_variance_approved` · `device_provisioned` · `device_revoked` · `data_exported`). **Lubang 9 → 4 pada 24 Agustus** bersama FR-D5 (`cash_paid_in` · `cash_paid_out`) dan peran/ambang/vertikal.

**Lubang 4 → 2 pada 24 Agustus** bersama F.5 akses support (`support_session_started` · `support_session_ended`), lalu **2 → 1** bersama FR-D2 (`shift_count_attempt`), lalu **1 → 0 pada 25 Agustus** bersama modul `peripheral` (`peripheral_configured`). **FR-F6 tertutup: `PERISTIWA_BELUM_DIPANCARKAN` kosong.**

⛔ **`peripheral_configured` TIDAK menunggu shell Tauri, dan anggapan sebaliknya menyembunyikan cacat nyata selama berminggu-minggu.** Yang menunggu Tauri adalah *mendeteksi* perangkat keras; yang tidak menunggu apa pun adalah **mencatat printer mana yang merchant katakan ada di perangkat ini** — dan tanpa itu, K-09 dan K-15 memilih profil dengan `p[0]`, baris PERTAMA dari query yang tidak punya `ORDER BY` sama sekali. Merchant dengan tiga model printer mencetak dengan profil yang dipilih urutan baris, bukan dengan printer yang benar-benar tercolok: struk 80 mm dipotong di kolom 32, atau perintah potong tercetak sebagai karakter sampah. Tanpa satu pun error.

- ⛔ **Pilihan hidup di PERANGKAT** (`device_config.printer_profile_id`, murni lokal), bukan di merchant. Kasir 1 dengan Epson dan kasir 2 dengan Xprinter di outlet yang sama adalah keadaan normal.
- ⛔ **`profilBerlaku` membedakan EMPAT sebab**, dan masing-masing punya kalimatnya: dipilih · pilihan-hilang · belum-dipilih · tidak-ada-profil. Yang belum memilih jatuh ke **baseline**, bukan ke `daftar[0]` — jatuh ke elemen pertama mengembalikan cacat yang sama satu lapis lebih dalam.
- ⛔ **`peripheralId` DIBEKUKAN per perangkat.** Id baru pada setiap penyimpanan menghasilkan lima printer terdaftar untuk merchant yang mengubah profilnya lima kali. Kunci idempotensinya `peripheral:{id}:{profilId}` — tanpa profil di dalamnya, perubahan KEDUA dijawab dari cache dan tidak pernah berlaku.
- ⛔ **Rutenya kemunculan KEEMPAT cacat "jalur perangkat 401"**, dan dua propertinya diuji TERPISAH: entri di `RUTE_TERBUKA` (dijaga test relay) dan `sesiOpsional: true` pada entri itu (dijaga test endpoint). Sabotase menunjukkan test relay semula hanya membuktikan yang pertama.
- ⛔ **Pengiriman ulang MEMPERBARUI barisnya**, bukan ditolak `ID_ALREADY_EXISTS` — `peripheral` bukan tabel transaksional, dan invariant #2 menjaga transaksi selesai dan katalog, bukan setelan perangkat. Riwayat perubahannya ada di `audit_event`, dengan `before` memuat keadaan sebelumnya.
- ⛔ **Perintah printer TIDAK diterima dari klien**, hanya `printerProfileId`. Perangkat yang dapat mengarang perintahnya sendiri dapat mengirim byte apa pun ke printer merchant.

- ⛔ **`cart_cleared` (28 September 2026, keputusan user, issue #76) — Batalkan keranjang K-03 kini meninggalkan jejak.** Alasan user: pembatalan keranjang sesudah barang di-scan adalah pola kecurangan kasir — pelanggan membayar tunai, keranjang dibatalkan, uangnya tidak tercatat. Peristiwa ini **tidak ada di daftar `spec-f:288`** dan dinyatakan begitu di `PERISTIWA_AUDIT` (kelompok `transaksi`, pola `calculation_variance`), jadi `PERISTIWA_BELUM_DIPANCARKAN` tidak bergeser. `after` = `{ line_count, quantity_milli, total }`, `total` **string** dan **sebagaimana dilaporkan perangkat** (angka yang kasir lihat; server tidak pernah melihat keranjangnya). Ditulis lewat `POST /shifts/{id}/cart-cleared` di modul `cash` (pemilik `cash_drawer_shift`), jalur perangkat tanpa Bearer (`sesi.ts`), peran dijaga `assertBoleh(shift_open_close)`, shift `closed` tetap diterima. **Laporan exception per kasir untuk `cart_cleared` (FR-G5) adalah utang sub-proyek 3**; sampai itu ada, peristiwanya terbaca di log audit B-22 lewat kelompok `transaksi`.

- ⛔ **`cart_line_reduced` (Task 5C, 28 September 2026, issue #76 Q2) — saudara `cart_cleared`: penghapusan baris dan penurunan qty Edit Item.** Alasan user: kalau Batalkan tercatat tapi menghapus baris satu per satu tidak, kecurangannya cuma pindah cara. Satu jenis untuk keduanya (baris dihapus = `quantity_after_milli` 0), kelompok `transaksi`, tidak ada di daftar `spec-f:288` (`PERISTIWA_BELUM_DIPANCARKAN` tidak bergeser). `after` = `{ variation_id, item_name, variation_name, quantity_before_milli, quantity_after_milli, unit_price, reduced_value }`, uang **string**, **sebagaimana dilaporkan perangkat** (Fix round 1: server MENGHITUNG ULANG `reduced_value` dalam bigint dan menyimpan hasilnya; nilai klien yang berbeda tetap diterima dan ditandai lewat `reduced_value_client` + `variance_amount` + audit `calculation_variance`, pola `spec-h:93`). **Rute SAUDARA** `POST /shifts/{id}/cart-line-reduced` di modul `cash` (bukan berbagi `cart-cleared`: bentuk muatan berbeda, dan satu rute untuk dua bentuk berarti validasi dan hash bersyarat); pola handler, `sesi.ts`, RBAC, idempotensi (hash seluruh isi termasuk `occurredAt`), dan shift `closed` tetap diterima identik. Penghapusan baris oleh `gantiModifier` (penggabungan) BUKAN penurunan: keputusan diambil dari qty DRAF baris yang diedit, bukan dari bentuk keranjang hasil akhir.

### F.5 akses support, ditutup 24 Agustus 2026 (B-30)

`spec-f:393`: *"akses support harus menjadi fitur SISTEM, bukan akses database langsung."* Alternatif yang tidak dibangun adalah alternatif yang akan dipakai — staf tanpa jalan resmi akan diberi kredensial database, dan sejak itu tidak ada baris yang mencatat siapa membaca apa milik merchant mana. Rantainya: `packages/domain/src/sesi-support.ts` → `support_session` (migrasi `0034`) → `POST/GET /support-sessions` + `/end` → penjaga token di `sesi.ts` → banner di seluruh layar back-office.

- ⛔ **Penanda audit dipasang SEKALI lewat `AsyncLocalStorage`** (`apps/server/src/konteks-permintaan.ts`), bukan diteruskan ke ~20 pemanggil `recordAuditEvent`. Penanda yang harus diingat 20 kali akan terlupa yang ke-21, dan yang terlupa menisbatkan tindakan support kepada OWNER MERCHANT secara pribadi — tuduhan yang diam. Bentuk kegagalan yang sama dengan yang membuat penjaga peran pindah ke satu hook. ⛔ `enterWith` dipanggil **sinkron** di hook `onRequest` paling awal, dalam hook tersendiri: dipanggil dari dalam hook async (yang menunggu verifikasi token lebih dulu), storenya hilang sebelum handler. Terukur — penandanya mendarat `null`.
- ⛔ **`support_session_id` adalah KOLOM, bukan jenis peristiwa tersendiri.** Tindakan selama sesi support adalah tindakan yang SAMA (`item_updated` tetap `item_updated`); memberinya nama lain membuat setiap laporan yang menyaring per jenis diam-diam melewatkan yang dilakukan support. **`actor_user_id` tetap owner yang menyetujui** — kolomnya `NOT NULL` ber-FK ke `"user"`, dan staf kami tidak punya baris di sana.
- ⛔ **`admin_label`, bukan `admin_user_id` yang `spec-f:405` tulis.** Kolom itu mengandaikan tabel pengguna STAF yang tidak ada — batas yang sama dengan `tools/naikkan-tahap.mjs`. Yang mengotentikasi `token_hash` (SHA-256), bukan labelnya.
- ⛔ **Sesi support TETAP tunduk RBAC** — ia meminjam peran owner yang menyetujui, dan melewatinya akan membuat akses support satu-satunya jalan di sistem ini yang tidak tunduk RBAC. Diuji lewat owner yang diturunkan menjadi kasir SESUDAH sesi dibuat.
- ⛔ **Mutasi diputuskan dari METODE HTTP**, bukan dari peta operasi RBAC: peta itu tidak mencakup setiap rute, dan yang tidak ada di sana lolos gerbang tulis diam-diam.
- ⛔ **Kedaluwarsa dihitung SAAT DIBACA**, bukan lewat pekerjaan terjadwal — job pembersih yang tidak berjalan membiarkan akses hidup melewati batas yang merchant setujui, tanpa siapa pun melihatnya. Dijawab **403 `SUPPORT_SESSION_EXPIRED`**, bukan 401: yang menerima 401 menyimpulkan tokennya salah dan meminta merchant mengulang seluruh prosesnya.
- ⛔ **Read-only BAWAAN** (`spec-f:403`), konsekuensinya dinyatakan sebelum owner memilihnya. **Sesi aktif menolak yang baru (409)** — dua token hidup berarti mengakhiri sesi di layar tidak benar-benar memutus akses. **Owner yang dinonaktifkan mencabut sesi yang ia beri.**
- ⛔ **`GET /support-sessions` TIDAK dijaga peran**, dan banner dirender di `App.tsx` di atas `children` `AppShell`. `spec-f:401` menuntut "terlihat di SELURUH layar"; banner yang hanya terlihat owner tidak memenuhinya, dan banner yang dipasang per layar hilang di layar berikutnya.
- ⛔ **Token TIDAK masuk audit** dan tidak pernah dapat dibaca kembali. Jejak audit bertahan lima tahun.
- **Batas yang dinyatakan:** petugas support tidak punya akun (token diserahkan owner di luar sistem — permukaan otentikasi staf tidak ada di produk ini) · tidak ada notifikasi ke merchant saat sesi dimulai · sesi tidak dapat diperpanjang, yang habis digantikan sesi baru dengan persetujuan baru.

- ⛔ **`hlc: 0n` adalah nilai yang JUJUR, bukan placeholder.** HLC menyatakan urutan kausal terhadap peristiwa perangkat; perubahan back-office tidak punya perangkat dan tidak berhak mengklaim posisi di dalamnya. Mengarangnya dari jam server menempatkannya di antara dua peristiwa kasir yang tidak pernah melihatnya.
- ⛔ **`price_changed` meresolusi harga lama SEBELUM baris baru ditulis** — baris baru menang di tangga resolusi begitu ia tertulis, jadi meresolusi sesudahnya membuat `before` sama dengan `after`. Dan yang diresolusi harga yang **berlaku** pada `effective_from` baris baru, bukan baris `price_history` sebelumnya: tangga tiga tingkat berarti baris terakhir yang ditulis belum tentu yang sedang berlaku.
- ⛔ **Arsip dan pemulihan memancarkan peristiwa yang SAMA**, dibedakan `before`/`after`. `spec-f:294` hanya menyebut `item_archived`; memancarkan `item_restored` yang tidak ada di daftar berarti kosakata yang tidak dapat dibandingkan dengan spec-nya. Varian dicatat pada ITEM-nya, alasan yang sama.
- ⛔ **`stock_adjusted` mencatat DELTA, bukan stok akhir** — stok adalah `SUM(stock_movement.delta)` dan tidak punya kolom; stok akhir di audit adalah angka kedua yang harus dijaga sepakat dengan ledger-nya. **`stocktake_completed` mencatat JUMLAH baris, bukan barisnya** — opname menyentuh ratusan varian, dan menyalin semuanya menenggelamkan peristiwa lain. **`sold_out_toggled` mencatat ARAHNYA.**
- ⛔ **Test memanggil ENDPOINT-nya, bukan `catatPerubahanServer`.** Test yang memanggil fungsinya langsung membuktikan fungsinya menulis, bukan bahwa handler-nya memanggilnya — kelas yang sama dengan pelajaran transport perangkat 21 Agustus. Dan `before` diuji ISINYA: audit yang menjawab "diubah dari apa" dengan nilai barunya sendiri lolos setiap test yang hanya memeriksa bahwa kolomnya terisi.
- ⛔ **Sepuluh assertion `audit_event` yang lama menghitung SELURUH baris tabel.** Nol benar karena alasan yang salah — tidak ada endpoint katalog yang menulis audit, jadi satu-satunya baris yang mungkin memang milik void. Bentuk yang sama persis dengan 18 test `stock_movement` yang F3 temukan. Kini disaring per `event_type`.
- ⛔ **Tidak ada `login_failed`**, dan `audit_event.actor_user_id` yang `NOT NULL` ber-FK adalah alasannya: login gagal sering memakai email yang tidak menunjuk siapa pun. `after` login memuat PERAN, bukan email — trail bertahan lima tahun, jadi setiap field masuk untuk lima tahun.
- ⛔ **`cash_variance_approved` peristiwa TERSENDIRI**, bukan `approver_user_id` yang kadang terisi pada `shift_closed`: laporan "siapa menyetujui selisih siapa" harus dapat dijawab dengan menyaring satu jenis, tanpa pembacanya perlu tahu bahwa satu kolom bermakna berbeda tergantung jenis barisnya.
- ⛔ **`data_exported` ditulis pada endpoint GET.** Ekspor tidak mengubah apa pun; yang berubah adalah **di mana datanya berada**. Yang dicatat LINGKUPNYA — menyalin CSV-nya ke `after` menggandakan setiap angka penjualan ke tabel berumur lima tahun.

**Peran dapat DIUBAH sejak 24 Agustus 2026 (`user_role_changed`, lubang 9 → 8).** Sebelumnya `createUser` menerima `roles` dan `updateUser` tidak — merchant yang menaikkan kasirnya menjadi manajer outlet tidak punya jalan apa pun kecuali membuat pengguna KEDUA dengan nama orang yang sama, yang memecah setiap laporan per kasir menjadi dua baris. Gap PRODUK, ditemukan saat mencari endpoint untuk peristiwa auditnya.

- ⛔ **Peran LAMA target ikut diperiksa `assertBolehKelola`.** `createUser` tidak perlu — pengguna yang belum ada belum berperan apa pun. Di jalur ubah, mengabaikannya membiarkan Manajer Outlet (yang matriks izinkan mengelola *kasir saja*) menurunkan seorang **Owner** menjadi kasir, lalu mengelolanya dengan bebas.
- ⛔ **Owner terakhir tidak dapat DICABUT PERANNYA**, bukan hanya tidak dapat dinonaktifkan. Keduanya meninggalkan tenant tanpa siapa pun yang dapat mengurus billing; penjaga yang menutup satu dari dua jalan ke keadaan yang sama bukan penjaga.
- ⛔ **Cakupan diperiksa terhadap gabungan yang AKAN berlaku**, bukan terhadap yang dikirim: mengubah peran saja menjadi Kasir sementara pengguna sudah di dua outlet menghasilkan tepat keadaan yang `spec-f:32` larang, dan tidak ada apa pun di permintaan itu yang terlihat salah.
- ⛔ **`user_role` DIHAPUS lalu ditulis ulang** — pengecualian yang dinyatakan terhadap invariant #2, yang menjaga data finansial dan katalog. `user_role` tidak ditunjuk riwayat transaksi mana pun; yang menjaga riwayat perannya adalah `audit_event`, dan itulah kenapa `user_role_changed` wajib.
- ⛔ **Aturan cakupan klien hidup di `buatMuatanPeran`, dipakai form tambah DAN form ubah.** Testnya menjalankan keduanya atas masukan yang sama dan membandingkan hasilnya, bukan membaca kodenya.

- ⛔ **Ejaan KODE yang dibekukan, bukan ejaan spec.** `spec-f:292` menulis `order_voided`, kode menulis `order.voided`; keduanya sudah ada di database merchant dan `audit_event` tidak pernah di-`UPDATE` (invariant #2). Menyeragamkan berarti dua ejaan untuk satu peristiwa selamanya. `PETA_EJAAN_SPEC` menyatakan padanannya.
- ⛔ **Paginasi keyset dengan perbandingan BARIS `(occurred_at, id)`.** Lima baris audit pada detik yang sama persis adalah keadaan normal — satu penjualan menulis beberapa dalam satu transaksi; kursor yang hanya membandingkan waktu melewati empat di antaranya. Testnya membuktikan bahwa **menyusuri seluruh halaman mengembalikan setiap baris tepat satu kali**, bukan sekadar bahwa halaman kedua ada.
- ⛔ **Jenis peristiwa asing ditolak 400, bukan dijawab nol baris.** Nol baris terlihat persis seperti "tidak ada yang melakukannya".
- ⛔ **`before`/`after` tidak dikembalikan** — muatan bebas yang pada `item_updated` akan memuat `cost` (FR-F5). Himpunan peran `report_exception` kebetulan sama persis dengan `view_margin` hari ini; kebetulan bukan penjaga.
- ⛔ **Saringan yang aktif ikut di respons DAN disebutkan di atas tabel.** Daftar audit yang tidak menyebut apa yang disaring terbaca seperti daftar lengkap.
- ⛔ **RBAC `report_exception`, `[ASUMSI]` yang dinyatakan.** Matriks `spec-f:38-53` tidak punya baris untuk audit trail; himpunan peran operasi itu sama dengan minimum `IA:201`, dan isi trail adalah superset dari X1 yang matriks sudah berikan kepada keempatnya. Operasi baru `audit_view` sengaja tidak dibuat — matriks yang mengandung baris karangan berhenti dapat dibaca berdampingan dengan spec-nya.
**B-26 Ambang Otorisasi, 24 Agustus 2026 (`threshold_changed`, lubang 8 → 7).** Ketiga ambang keputusan 1 Agustus kini dapat disetel per outlet: diskon (`0031`), selisih kas dan no-sale (`0033`). Resolusinya `ambangBerlaku` di `packages/domain/src/ambang.ts`.

- ⛔ **Setelan dibaca di EMPAT tempat, bukan satu**: `closeShift` dan `recordNoSale` di server, `tutupKas` dan `rencanaNoSaleLokal` di klien. Kedua kolom **turun ke perangkat** — K-12 dan K-16 berjalan tanpa jaringan, dan perangkat yang memakai bawaan sementara server memakai angka merchant menghasilkan *kasir yang sama, shift yang sama, jawaban berbeda*. Layar pengaturan yang menyimpan benar dan tidak mengubah apa pun adalah kegagalan tanpa satu pun error.
- ⛔ **`null` BERBEDA dari nol.** `null` = pakai bawaan; `0` = **setiap** kejadian menuntut otorisasi. `0n || bawaan` membuangnya — `ambangBerlaku` memakai `??`.
- ⛔ **TIDAK ADA nilai yang berarti "tidak pernah menuntut otorisasi".** Kontrol yang dapat dimatikan hilang pada hari seseorang membutuhkannya, dan yang mematikannya adalah orang yang paling ingin ia mati. Yang menginginkan praktis tanpa PIN menyetel angkanya tinggi — terlihat, dan tercatat. Penjaganya BENTUK datanya: tidak ada bidang boolean.
- ⛔ **RBAC `threshold_settings` = {owner, area_manager}**, diturunkan dari `IA:205`. Manajer Outlet sengaja di luar: ambang inilah yang memutuskan kapan persetujuannya dituntut. MEMBACA tidak dijaga — kasir yang ditolak PIN-nya berhak tahu ambang mana yang menolaknya.
- ⛔ **`PUT`, bukan `PATCH`**; respons membawa `tersimpan` DAN `berlaku`; audit mencatat `tersimpan`. Layar yang menebak `tersimpan` dari `berlaku` menuliskan bawaan sebagai pilihan pada penyimpanan berikutnya, dan sejak itu outlet berhenti mengikuti perubahan bawaan tanpa siapa pun memutuskannya.
- ⛔ **AJV meng-koersi `number` → `string`** sebelum handler melihatnya, bentuk yang sama dengan temuan telemetri (`null` → `0`). Kontrak bertipe string tidak dapat menolak `number` di handler; yang menjaganya adalah klien. Yang masih dapat dijaga: rupiah tanpa desimal.

**B-24 Profil Vertikal, 24 Agustus 2026 (`vertical_profile_changed`, lubang 7 → 6). Seluruh 26 layar back-office kini ada.** OQ-09 diputuskan 1 Agustus dan sampai sekarang hanya dapat dijalankan lewat SQL.

- ⛔ **Lima dari enam kolom perilaku TIDAK dibuka di layar** — `default_channel`, `requires_barcode_flow`, `default_tax_type`, `modules_enabled`, dan `name` untuk retail tidak dibaca satu baris kode pun di luar pendaftaran tenant. Membukanya adalah setelan yang tersimpan benar dan tidak mengubah apa pun. Yang dibuka hanya `allow_negative_stock` (FR-E4), dan ia menentukan sesuatu **di perangkat, offline**.
- ⛔ **`retail` DITOLAK `VERTICAL_NOT_AVAILABLE`, dan dinyatakan di layar.** UI-nya ada di daftar "jangan bangun" (v1.1+); merchant yang dapat menekannya mendapat aplikasi kasir F&B dengan label yang mengatakan sebaliknya. Pilihan yang hilang tanpa penjelasan terbaca sebagai layar yang rusak.
- ⛔ **Bawaan tenant tidak dapat DIKOSONGKAN, hanya DIPINDAHKAN.** `resolusiProfil` punya bawaan keras; mencabutnya membuat setiap outlet ber-override NULL jatuh ke aturan yang tidak seorang pun pilih. Menetapkan bawaan baru MENCABUT yang lama di transaksi yang sama — `ux_vertical_profile_tenant_default` adalah index unik parsial, dan tanpanya jawabannya 500 dengan nama index di pesannya.
- ⛔ **TIGA keadaan outlet, bukan dua**: memilih sendiri · mengikuti bawaan tenant · memakai bawaan keras sistem. Ketiganya menampilkan aturan yang sama; hanya yang ketiga tidak dipilih siapa pun, dan hanya yang ketiga menuntut tindakan. Audit mencatat `null` sebagai null, bukan diresolusi.
- ⛔ **Resolusi dihitung di SERVER lewat `resolusiProfil` yang perangkat pakai.** Layar yang menghitungnya sendiri menampilkan aturan yang berbeda dari yang kasirnya alami.

- ⛔ **`RentangTanggal` punya prop `sumbu`.** Ia menyatakan "tanggal bisnis" di setiap layar yang memakainya; benar sepuluh kali dan salah sekali — B-22 menyaring `occurred_at`, karena sebagian besar peristiwa audit tidak menempel pada order mana pun.


### Transfer di setiap laporan per metode (PR 2B Task 7, 30 September 2026)

Syarat user atas P1 (issue #76, komentar `5862870577`): *laporan per metode dan rekonsiliasi FR-C12 mengelompokkan menurut `provider` dan menampilkan "Transfer", tidak pernah "Lainnya"; uang bank tidak boleh tersembunyi dari pemilik.*

- Aturan lipat `(method, provider)` → kode laporan ditulis SEKALI, di `kodeLaporanMetode` (`packages/domain/src/metode-tampilan.ts`): `other` + `bank_transfer` menjadi `transfer`, selebihnya `method`. Query mengambil `provider` dan melipat di TypeScript; SQL tidak menulis `CASE` padanannya.
- Field `method` pada laporan agregat (FR-C12, rekapitulasi FR-C13, CSV, ringkasan HP, detail shift, K-12, K-13, laporan harian perangkat) adalah kode laporan; detail transaksi (B-03 dan riwayat perangkat) membawa `provider` per baris dan memanggil `labelMetode(method, provider)`.
- Klien lama yang belum mengenal kode `transfer` menampilkan kata mentah `transfer`, bukan "Lainnya". Dijaga `tests/server/laporan-transfer.test.js` (G-LAPORAN-TRF) dan `tests/runtime/label-metode-tunggal.test.js` (G-LABEL).
- Koreksi lingkup kalimat di atas: ia benar hanya untuk laporan agregat yang sudah terlipat. B-03 back-office lama (detail per baris) membaca `other` tanpa `provider` dan menampilkan "Lainnya" (`openapi.yaml` sudah mengakuinya); yang sudah meneruskan `provider` adalah `Detail.tsx` versi baru (dijaga G-LABEL).
