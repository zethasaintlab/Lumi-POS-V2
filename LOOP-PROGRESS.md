# LOOP-PROGRESS — catatan berjalan menuju Lumi POS v1

Mode kerja: ambil task berikutnya dari milestone yang sudah ada, kerjakan,
verifikasi (`typecheck` + `lint:ds` + suite test yang relevan), commit, lanjut.

⛔ **Berkas ini bukan pengganti `HANDOFF.md`.** `HANDOFF.md` memuat keputusan
yang mengikat kode dan batas yang harus dibaca sebelum menyebut sebuah gate
aman. Yang di sini adalah **jurnal**: task apa, kenapa urutannya begitu, apa
yang gagal, dan bagaimana diperbaiki.

Verifikasi baku setiap task (yang relevan saja dijalankan, sisanya sebelum
commit milestone):

```
npm run typecheck · npm run lint:ds
npm run test:domain · test:tenancy · test:payment · test:server
npm run test:identity · test:catalog · test:ordering · test:isolation
npm run test:schema · test:kasir · test:backoffice · test:sync-client
npm run test:runtime · test:dst · test:dst-server · test:sqlite-local
```

⛔ **Suite ber-database TIDAK boleh berjalan bersamaan.** Semuanya memakai
`resetAll` pada database yang sama; dua suite paralel saling menghapus data dan
menghasilkan kegagalan yang terbaca seperti bug kode. Ditemukan langsung di
loop ini — `test:catalog` merah 40+ test hanya karena `test:server` masih
berjalan di latar. Jalankan berurutan.

---

## Backlog

Diturunkan dari `HANDOFF.md` (utang per gate) dan `CLAUDE.md` (§ status).
Urutan mengikuti satu aturan: **yang menutup jalur pengguna lebih dulu**,
lalu yang menutup utang yang sudah punya kode setengah jalan, lalu P1.

| # | Task | Asal | Status |
|---|---|---|---|
| 1 | B-29 — pilih paket, lihat harga, bayar | F5 §8 langkah 6 | selesai |
| 2 | FR-H8 — notifikasi antrean menua | utang F2 | selesai |
| 3 | `sold_out_flag` REST + relay | utang F3 | selesai |
| 4 | Tombol cetak ulang di K-09 | utang F4 | selesai (digabung dgn 5) |
| 5 | Retry antrean `print_job` | utang F4 | selesai |
| 6 | Modul C-3 — rekonsiliasi & ekspor | P1 | selesai |
| 7 | Paginasi + pencarian katalog sisi server | utang G1 | selesai (server + B-06) |
| 8 | Refund parsial dengan pemilihan baris di UI | utang F2 | selesai |
| 9 | K-16 buka laci · K-17 scanner | utang F2 | selesai |
| 10 | **F6** — runbook | `ARCH:400` | selesai |
| 11 | **F6** — observability sisi server | `ARCH:294` | selesai (sisi server) |
| 12 | **F6** — alat koreksi append-only | `ARCH:400` | selesai |
| 13 | B-10 Harga — pemilih produk sisi server | utang Task 10 | selesai |
| 19 | FR-B8 di layar kasir — K-03 diskon + K-11 | utang Task 16 | selesai |
| 20 | FR-A3 — aturan pemilihan modifier di kasir | `spec-a:113`, P0 | selesai |
| 21 | K-06 QRIS statis + EDC | FR-C2, FR-C4 | selesai |
| 22 | Pembayaran campuran di perangkat | FR-C1, P0 | selesai |
| 23 | FR-H4 — blokir operasi destruktif | `spec-h:270`, P0 | selesai |
| 24 | Feature flag & kill switch | `ARCH:358` | selesai |
| 25 | FR-F8 deteksi manipulasi jam + laporan X8 | `spec-f:337`, P0 | selesai |
| 26 | FR-G5 X2, X3, X4, X5, X7 — lima laporan exception | `spec-g:149`, P1 | selesai |
| — | FR-G5 X6 — manipulasi keranjang | `spec-g:162` | ⛔ tidak dapat dibangun: keranjang tidak meninggalkan jejak |

Yang **tidak** masuk backlog dan alasannya:

- **Gate F4 bagian pertama** (cetak di ≥5 model printer) — menuntut perangkat
  fisik. Tidak dapat ditutup dari sini, dan menandainya selesai adalah
  kebohongan yang akan ditemukan merchant.
- **OQ-14** (prototipe Tauri Android) — pertanyaan terbuka, bukan task.
- **Daftar "jangan bangun"** `PRD §4` — KDS, table management, loyalty, dan
  seterusnya. Tidak dibangun, tidak diusulkan.

---

## Jurnal

### Task 1 — B-29: pilih paket, lihat harga, bayar

**Selesai.** Langkah 6 dan terakhir dari `PENYELIDIKAN-f5-langganan.md` §8.
Tiga endpoint langganan yang mendarat di commit sebelumnya akhirnya punya
konsumen.

**Keputusan yang diambil:**

- **Aturan tampilan hidup di modul murni** (`upgrade.ts`), komponennya hanya
  JSX — pola yang sama dengan `kuota-tampilan.ts` di layar yang sama. Itu yang
  membuat "paket mana yang boleh dibeli" dan "berapa tagihannya" dapat diuji
  `node --test` tanpa merender satu komponen pun.
- ⛔ **Harga dan urutan paket diimpor dari `packages/domain`, tidak diketik
  ulang.** Angka harga yang disalin ke klien akan menyimpang dari yang
  ditagih server, dan gejalanya adalah layar yang menjanjikan Rp349.000 lalu
  menagih lain.
- ⛔ **Perkiraan tagihan dihitung dari `kuota.outlet.terpakai`** — angka yang
  SAMA dengan yang server pakai (`hitungOutlet`). Menghitungnya dari daftar
  outlet di layar lain akan menyimpang pada aturan arsip.
- **QR ditampilkan sebagai tautan, bukan gambar.** Aturan design system #8
  melarang gambar, dan tidak ada komponen QR di `/ds-bundle`. `qrString`
  Midtrans memang sebuah URL. Batas yang dinyatakan: merchant membuka tautan
  itu untuk memindai, dan itu bukan alur ideal — alur idealnya menuntut
  renderer QR yang belum ada di repo ini.

**Masalah + solusinya:**

- `hitungTagihanBulanan` **melempar** untuk `enterprise` (harga `null`) dan
  untuk `jumlahOutlet < 1`. Dipanggil langsung dari render, lemparan itu
  mematikan seluruh layar. Solusinya `perkiraanTagihan` yang mengembalikan
  `null` alih-alih melempar — batas antara "fungsi domain yang fail-closed"
  dan "layar yang tidak boleh mati" ditarik di klien, bukan dengan
  melonggarkan domain.

- ⛔ **Cacat nyata yang hanya BROWSER temukan: QR hilang setelah muat ulang.**
  `qrString` hanya hidup di respons `POST .../invoices`, jadi ia hanya ada di
  memori komponen. Merchant yang memuat ulang halaman — atau membukanya besok
  dari perangkat lain — kehilangan satu-satunya cara membayar tagihan yang
  masih terbuka, sementara index unik parsial menolak tagihan kedua. **Ia
  terkunci sampai tagihan pertama kedaluwarsa sendiri, tanpa satu pun error.**

  Menanyakan ulang ke gateway tidak menolong: respons `/v2/{id}/status`
  Midtrans tidak memuat `actions`. Akarnya karena itu di skema, bukan di
  komponen — migrasi `0027` menambahkan `qr_string` + `expires_at` (aditif,
  nullable), `catatRujukanGateway` menyimpan keduanya, dan `toTagihan`
  mengembalikannya di SETIAP pembacaan. Sabotase membuktikan test barunya
  menyala: kolomnya ditulis `NULL` → 1 merah.

  Ini persis kelas cacat yang `CLAUDE.md` sebut berulang — hijau di seluruh
  test karena testnya memeriksa respons pembuatan, dan respons pembuatan
  memang benar.

**Verifikasi browser** (Chromium + Playwright, server + Vite sungguhan, tenant
`free` yang baru didaftarkan lewat API):

```
QR setelah beli        : true
QR setelah cek status  : true
QR setelah MUAT ULANG  : true      ← sebelum 0027: false
galat konsol           : []
```

Alur penuh terlihat: pilih paket → tagihan Rp 349.000 (1 outlet) → QR →
cek status (fake menjawab `pending`, paket TETAP `Gratis`) → riwayat terisi.


### Task 2 — FR-H8: notifikasi antrean menua

**Selesai.** `spec-h:304`: *"Antrean yang tua berarti uang merchant belum
tercatat — metrik kesehatan #1."* Tangga 4 / 24 / 72 jam.

**⛔ Temuan yang menentukan bentuk fitur ini: server TIDAK DAPAT melihat
antrean yang menua.**

Antrean yang menua adalah penjualan yang belum pernah sampai ke server — tidak
ada baris untuk dihitung. Yang server lihat adalah perangkat yang **berhenti
menyapa** (`device.last_seen_at`). Keduanya bukan hal yang sama, dan
menyamakannya berbohong dua arah:

- perangkat yang **mati** terlihat seperti antrean menua meski tidak ada
  penjualan tertahan;
- perangkat yang **online tapi selalu ditolak** server terlihat sehat.

Jadi fitur ini punya dua sisi yang sengaja dinamai berbeda, dan hanya
**ambangnya** yang dibagi (`packages/domain/src/antrean-menua.ts`, pola
`AMBANG_SELISIH`):

| Sisi | Sumber | Yang ditampilkan |
|---|---|---|
| Kasir | `outbox_local` tertua yang belum terkirim | pita "penjualan belum tercatat sejak N" |
| Owner (B-01) | `device.last_seen_at` | kartu "perangkat belum terhubung" |

**Keputusan yang diambil:**

- ⛔ **PITA, bukan dialog** — AC FR-H8 kedua menuliskannya sebagai aturan.
  Pitanya tidak mengambil fokus, tidak melayang (ia mendorong isi), dan
  **tidak punya tombol tutup**: yang menutupnya adalah antrean yang terkuras.
  Peringatan yang dapat ditutup akan ditutup, dan uang yang belum tercatat
  tidak berhenti belum tercatat karena kasir menekan silang.
- ⛔ **Detak satu menit di komponen.** Umur antrean berubah karena WAKTU
  BERJALAN, bukan karena data berubah — komponen yang menghitungnya saat
  render menyeberangi ambang 4 jam tanpa merender ulang, dan pitanya baru
  muncul saat ada penjualan berikutnya, yaitu tepat saat kasir sedang sibuk.
  Satu menit, bukan satu detik: ambang terkecil 4 jam.
- ⛔ **Ambang `>=`, bukan `>`.** `spec-h:308` menulis "> 4 jam"; yang dipilih
  memperingatkan LEBIH DULU. Selisihnya satu titik waktu, dan antrean tepat 4
  jam sudah berarti uang belum tercatat sejak sarapan.
- **Ambang dapat dikonfigurasi** (AC pertama) lewat `VITE_AMBANG_ANTREAN_JAM`
  = `"4,24,72"` — satu variabel, bukan tiga, karena ketiganya hanya berarti
  bersama-sama.
- ⛔ **Konfigurasi cacat jatuh ke bawaan SECARA UTUH.** Termasuk tiga angka
  sah yang tidak menaik (`"72,24,4"`) — diterima apa adanya, setiap antrean
  langsung berstatus `darurat`, dan peringatan yang selalu menyala adalah
  peringatan yang diabaikan.
- ⛔ **Kartu owner hanya muncul bila ada yang perlu ditindaklanjuti.** Kartu
  yang selalu ada dengan tulisan "semua sehat" berhenti dibaca.
- ⛔ **Perangkat tanpa kredensial tidak pernah dilaporkan menua** — ia belum
  pernah dapat menyapa server. Sabotase membuktikan penjaganya menyala:
  filternya dilepas → 1 merah.
- ⛔ **Umur dihitung di DATABASE** (`now() - last_seen_at`), bukan di Node.
  Aturan repo, dan ia lahir dari bug nyata (skew ±2 ms, 4 dari 12 run gagal).

**Batas yang dinyatakan:**

- ⛔ **Tidak ada kanal notifikasi.** `spec-h:311` menulis "notifikasi ke
  owner"; yang dibangun adalah **keadaan layar**, bukan push/email/SMS —
  transport notifikasi adalah layanan baru dan biaya baru, dan itu bukan
  keputusan agent.
- ⛔ **AC ketiga — "dashboard internal menampilkan merchant dengan antrean
  tua" — TIDAK dibangun.** Ia perkakas operasional internal lintas-tenant;
  52 layar `IA` tidak memuatnya, dan query lintas-tenant melanggar invariant
  #8. Ia menuntut keputusan produk tersendiri.
- **Pita kasir belum pernah dilihat di browser.** Aplikasi kasir menuntut
  perangkat ber-kredensial + PowerSync berjalan; logikanya teruji penuh
  (`node --test`) dan `vite build` hijau, tapi tampilannya belum
  diverifikasi mata. Dicatat, bukan diklaim.


### Task 3 — `sold_out_flag`: REST + relay

**Selesai.** Penandaan habis sudah berjalan di perangkat sejak F3, tapi **lokal
saja**. `apps/kasir/src/inventori/sold-out.ts` mencatat alasannya sendiri:
meng-enqueue item yang tidak punya rute membakar hitungan percobaannya sampai
`failed` permanen — antrean merah tanpa ada yang salah.

**Akibat dari ketiadaannya, dan alasan ia akhirnya dibangun:** barista menandai
kopi habis di terminal 1, dan kasir di terminal 2 tetap menerima pesanannya
lima menit kemudian — dengan pelanggan berdiri di depannya. Jalur turunnya
sudah ada sejak F2 (`sold_out_flag` adalah raw table yang direplikasi); yang
hilang hanya jalur naiknya.

**Keputusan yang diambil:**

- **`POST /inventory/sold-out` adalah jalur PERANGKAT**, bukan back-office. Ia
  dipanggil relay outbox, yang tidak mengirim `Authorization` sama sekali —
  jadi ia masuk `RUTE_TERBUKA` bersama `/orders` dan `/shifts`. Melindunginya
  dengan sesi berarti setiap penandaan yang menyusul dari perangkat offline
  dijawab 401.
- ⛔ **`ON CONFLICT (id) DO NOTHING`, bukan `DO UPDATE`.** Menimpanya berarti
  server menulis ulang penanda yang mungkin sudah kalah dari penanda perangkat
  lain yang tiba di antaranya — retry sebuah penanda lama menghidupkan kembali
  keadaan yang sudah dibatalkan.
- ⛔ **`entity_id` outbox adalah id BARIS penandaan, bukan variation.** Satu
  produk ditandai berkali-kali, dan `statusRecordBanyak` memetakan status per
  entitas dengan aturan terburuk-menang: memakai variation membuat penandaan
  kemarin yang gagal terkirim menampilkan status merah pada penandaan hari ini.
- ⛔ **Satu transaksi: penanda + HLC + outbox.** Bentuk yang sama dengan
  penjualan. Penanda yang ter-commit tanpa item outbox-nya tidak akan pernah
  naik dan tidak ada yang memperbaikinya sendiri; HLC yang tidak tersimpan
  lebih halus — boot berikutnya memuat nilai lama dan tick berikutnya dapat
  menghasilkan HLC yang **sudah dipakai** (pelanggaran I10 tanpa satu pun
  error).
- **Server tidak menyimpulkan apa pun.** Tidak menyentuh `stock_movement`
  (`spec-e:220` — penandaan habis dan stok terhitung tidak pernah saling
  menyimpulkan), dan siapa yang menang dijawab saat DIBACA, bukan saat ditulis.

**Masalah + solusinya:**

- Test lama `enqueue menerima keempat jenis yang punya endpoint` **menulis
  daftarnya dengan tangan** dan langsung merah begitu jenis kelima lahir.
  Memperbaikinya dengan menambah satu string akan mempertahankan penjaga yang
  memeriksa hal yang salah: yang berbahaya bukan "daftarnya berubah" melainkan
  **kedua daftar menyimpang**. Jenis di `ENTITY_TYPES` tanpa rute MELEMPAR saat
  relay mengirimnya — berjam-jam setelah penjualan ditulis, di perangkat
  merchant. Diganti penjaga turunan: `ENTITY_TYPES` wajib sama persis dengan
  `RUTE_DIDUKUNG` (kunci peta `RUTE`), dua arah.
- Test HLC merah karena fixture SQLite tidak punya baris `device_config`, dan
  `simpanHlc` melakukan `UPDATE` — nol baris, tanpa error. Bukan bug produksi
  (barisnya lahir saat perangkat dipasang), tapi fixture yang tidak meniru
  perangkat terpasang membuktikan hal yang salah. Fixture-nya yang diperbaiki.

**Sabotase** — dua dijalankan, keduanya merah lalu pulih: `assertVariationVisible`
dimatikan (1 merah) · `DO NOTHING` → `DO UPDATE` (1 merah, dan ia hanya menyala
setelah test-nya diperbaiki mengirim isi yang BERBEDA dengan id yang sama —
sebelum itu kedua bentuk menghasilkan hasil identik dan test-nya tidak
membuktikan apa pun).

**Batas yang dinyatakan:** belum ada layar kasir yang memanggil `tandaiHabis`.
Modul dan jalur naiknya lengkap dan teruji; tombolnya milik K-03/K-04, bukan
task ini.


### Task 4 + 5 — antrean cetak `print_job` dan tombol cetak ulang K-09

**Digabung, dan itu keputusan.** Keduanya utang F4 yang terpisah di daftar,
tapi satu fitur di kode: tombol cetak ulang yang gagal harus masuk antrean yang
sama, dan antrean tanpa satu pun penulis adalah tabel kosong. Mengerjakannya
terpisah berarti menulis jalur cetak dua kali.

**⛔ Temuan: tabel `print_job` ada sejak F0 dan TIDAK PERNAH DITULIS SIAPA
PUN.** Skemanya bahkan memuat komentar yang menjelaskan kenapa `document`
disimpan apa adanya — untuk retry yang mencetak persis yang gagal. Tidak ada
satu baris kode pun yang mengisinya. Struk yang gagal dicetak hilang seketika.

**Keputusan yang diambil:**

- **`cetakDanCatat` adalah satu-satunya pintu cetak**, dipakai jalur penjualan
  dan cetak ulang. Jalur yang lupa mencatat adalah jalur yang struknya hilang
  saat gagal — yaitu tepat jalur yang paling membutuhkan antreannya.
- ⛔ **`tanpa_printer` TIDAK menulis apa pun.** Merchant tanpa printer adalah
  kasus sah dan perangkatnya mencetak nol struk selamanya; menuliskan setiap
  penjualan sebagai job menghasilkan antrean yang tumbuh tanpa batas dan tidak
  pernah dapat terkuras.
- ⛔ **Retry mencetak DOKUMEN YANG TERSIMPAN**, bukan hasil render kedua.
  FR-B11 menuntut cetak ulang identik dengan cetakan pertama.
- ⛔ **`MAKS_PERCOBAAN_CETAK` = 5.** Job yang dicoba tanpa batas akan mencetak
  struk kemarin saat printer akhirnya menyala — di tengah antrean pelanggan,
  tanpa ada yang memintanya. Setelah batas, job **tetap tersimpan** dan masih
  dapat dicetak manual dari K-09; yang berhenti hanya percobaan otomatisnya.
- ⛔ **`peripheralAktif()` mengembalikan `null`, dan itu BUKAN `noopPeripheral`.**
  Noop selalu "berhasil": dipakai di jalur penjualan, setiap struk akan
  dilaporkan **"tercetak"** kepada kasir sementara tidak ada satu byte pun yang
  meninggalkan perangkat — dan kasir yang percaya itu tidak akan mencari
  struknya. K-15 tetap memakai noop dengan sengaja, karena yang dibuktikannya
  adalah byte-nya terbentuk, dan layarnya menyatakan itu.
- **Satu tempat memutuskan port**, bukan satu per layar. Saat adapter sungguhan
  lahir, yang berubah adalah satu baris.
- **Cetak ulang K-09 membangun ulang dokumen dari database**, bukan dari
  `print_job`: transaksi yang dicetak di perangkat LAIN tidak punya baris di
  sana sama sekali.

**Masalah + solusinya:**

- ⛔ **Sabotase menemukan CABANG MATI di kodeku sendiri.** `prosesAntreanCetak`
  memeriksa `cetak.status === 'tanpa_printer'` di dalam loop; melepasnya tidak
  menjatuhkan satu test pun. Sebabnya: `cetakStruk` mengembalikan
  `tanpa_printer` hanya untuk `!port || !profil`, dan keduanya sudah dijawab
  `return` di baris pertama fungsi. Kode mati yang menyamar sebagai
  kehati-hatian — kelas yang sama dengan cabang `arah = -1` di tutup kas.
  Dihapus, dan **typecheck yang membuktikannya**: tanpa cabang itu TypeScript
  menolak `cetak.pesan`, karena tipenya masih memuat varian yang runtime tidak
  akan pernah hasilkan.
- Test merah karena fixture `PrinterProfile` memakai `null` untuk
  `initCommand`/`cutCommand`; `renderEscPos` memanggil `.trim()` padanya.
  Fixture disamakan dengan yang sudah dipakai `cetak-invariant.test.js`.

**Batas yang dinyatakan:**

- ⛔ **Tidak ada penjadwal otomatis.** Retry dipicu manual dari K-15. Penjadwal
  yang berjalan sendiri tidak dapat diamati sama sekali sampai ada adapter
  printer — dan `prosesAntreanCetak` adalah fungsi yang akan dipanggilnya.
- ⛔ **Tidak satu byte pun pernah sampai ke printer sungguhan.** Gate F4 bagian
  pertama tetap terbuka; ia menuntut perangkat fisik.


### Task 6 — paginasi & pencarian katalog sisi server

**Selesai di sisi server.** Penyelidikannya ditulis lebih dulu:
`docs/superpowers/plans/PENYELIDIKAN-katalog-paginasi.md`.

**Apa yang sebenarnya terjadi sebelum ini:** `GET /items` mengembalikan
**seluruh** item tenant, dan menjalankan satu query varian **per item**.
Komentar `FIX 5` di berkas itu menyebut modifier list sebagai N+1 yang sudah
diperbaiki — lalu di baris berikutnya meninggalkan N+1 kedua dengan catatan
"pre-existing, out of scope". Katalog 5.000 produk (kuota tier `standard`) =
**5.001 query** dalam satu transaksi.

**Keputusan yang diambil:**

- ⛔ **Tanpa `limit`, SELURUH baris dikembalikan.** Kompatibilitas klien N-1,
  dan bukan formalitas: bawaan yang memotong membuat klien lama menerima 100
  dari 5.000 produk lalu menampilkan katalog terpotong **tanpa satu pun
  error** — dan kasir yang tidak menemukan produknya akan menyalahkan
  katalognya, bukan aplikasinya. Paginasi adalah sesuatu yang klien MINTA.
- ⛔ **Keyset, tapi alasannya BUKAN alasan riwayat.** `CLAUDE.md` menuntut
  keyset untuk riwayat karena perangkat offline menyisipkan baris di tengah
  urutan; katalog tidak punya sifat itu. Yang membuat keyset tetap dipilih
  adalah biaya: `OFFSET n` memindai lalu MEMBUANG `n` baris. Konsekuensi yang
  dinyatakan: tidak dapat melompat ke halaman 17.
- ⛔ **Keyset atas `(sort_order, id)`, bukan `sort_order` saja.** `sort_order`
  DEFAULT 0, jadi katalog yang belum diurutkan seluruhnya seri — perbandingan
  satu kolom melompati sisa baris bernilai sama, dan produk lenyap dari daftar
  tanpa error. Sabotase membuktikannya: 2 merah.
- ⛔ **N+1 varian diperbaiki BERSAMA paginasi, bukan sesudahnya.** Paginasi
  tanpa itu memindahkan masalahnya — halaman 100 item tetap 101 query — dan
  sesudah paginasi mendarat, N+1-nya jadi **lebih sulit terlihat**: 101 query
  terasa wajar, 5.001 tidak.
- **`ILIKE`, bukan full-text.** Nama produk kafe adalah dua sampai empat kata
  Indonesia dan yang merchant ketik adalah POTONGAN kata — "kop" untuk "Kopi
  Susu". `pg_trgm` tidak dipasang: extension baru adalah keputusan operasional
  dan angka yang membenarkannya belum ada. `[ASUMSI]` bahwa sequential scan
  atas satu tenant cukup cepat — belum diukur.
- ⛔ **`%` dan `_` di masukan di-ESCAPE.** Merchant yang mencari "50%" tidak
  boleh mendapat seluruh katalog. Sabotase: 1 merah.
- **Kursor `sortOrder:id`, sengaja TIDAK di-base64.** Ia tidak membawa
  kewenangan apa pun — hasilnya tetap tunduk RLS, dan kursor palsu hanya
  membuat pemanggil melompati barisnya sendiri. Base64 membeli kesan aman
  tanpa membeli keamanan, dan menyembunyikan nilai yang berguna saat debug.

**Masalah + solusinya:**

- ⛔ **Risiko regresi yang hampir lolos: pencarian klien mencakup SKU dan
  BARCODE varian; versi pertama server hanya mencari nama item.** `saringProduk`
  di B-06 sudah mencarinya sejak layar itu lahir, dengan alasannya tertulis di
  sana: *"merchant mencari produk lewat kode yang tertempel di rak."* Layar
  yang berpindah ke pencarian sisi server akan **diam-diam berhenti menemukan
  barcode** — kasir memindai, tidak ada yang muncul, tanpa satu pun error.
  Ditemukan saat membaca `saringProduk` untuk merencanakan wiring UI-nya, bukan
  dari test. Server kini mencari nama/deskripsi item **dan** nama/SKU/barcode
  varian lewat `EXISTS`.
- Test awal memakai jumlah ABSOLUT dan merah karena `seedTenantBase` membuat
  itemnya sendiri. Diperbaiki memakai token unik per test dan hitungan relatif
  — angka absolut akan merah pada hari seed berubah, dan itu kegagalan yang
  menunjuk ke tempat yang salah.

**⛔ Batas yang dinyatakan: B-06 MASIH menyaring di klien.**

Kemampuan servernya ada dan teruji; layarnya belum memakainya. Berpindah ke
pencarian sisi server menukar penyaringan seketika dengan perjalanan
pulang-pergi, dan menuntut UX yang dirancang: debounce, keadaan memuat, dan
kalimat untuk katalog yang terpotong. Menyetengahinya — memuat satu halaman
lalu tetap menyaring di klien — menghasilkan pencarian yang hanya menemukan
apa yang kebetulan sudah dimuat, yaitu regresi yang sama dengan barcode di
atas. Dicatat sebagai langkah berikutnya, bukan dikerjakan setengah.


### Task 7 + 8 — F6: runbook dan observability

**Fase terakhir dimulai.** Gate F6 (`ARCH:400`): *"Runbook lengkap; alat
koreksi ada **sebelum** insiden pertama."*

#### `docs/RUNBOOK.md`

Ditulis dari kode yang benar-benar ada, bukan dari yang seharusnya. Sebelas
bagian, dipetakan dari **kalimat yang merchant ucapkan** ("penjualan hari ini
tidak muncul di laporan") ke prosedurnya.

⛔ **Runbook yang salah lebih berbahaya daripada runbook yang tidak ada** —
orang yang sedang panik akan memercayainya. Karena itu ia datang bersama
`tests/domain/runbook.test.js`, penjaga statis yang menuntut:

- setiap **kode error** yang runbook sebut benar-benar ada di kode
- setiap **environment variable** yang ia suruh periksa ada di kode
- setiap **endpoint** yang ia suruh panggil terdaftar di OpenAPI
- setiap **angka ambang** sama dengan yang kode tegakkan (`AMBANG_SELISIH`,
  `AMBANG_ANTREAN`, `MAKS_PERCOBAAN_CETAK` — diimpor, bukan diketik ulang)
- runbook **tidak menyuruh siapa pun** meng-`UPDATE`/`DELETE` tabel jalur uang

Sabotase: `Rp 20.000` → `Rp 15.000` dan satu kode error diganti nama → 2 merah.

**Masalah + solusinya:** penjaga "tidak menyuruh melanggar invariant" mula-mula
memeriksa **per baris**, dan langsung menandai dokumen yang benar — markdown
membungkus di 80 kolom, jadi larangan dan kata `UPDATE`-nya jatuh di baris
berbeda. Diubah memeriksa per **paragraf**.

#### `GET /metrics`

Teks eksposisi Prometheus, nol dependensi baru.

⛔ **Lima dari delapan metrik `ARCH:296` TIDAK dapat dihasilkan server ini,
dan itu dinyatakan alih-alih dikarang.** Umur antrean sinkronisasi dan item
gagal sinkron hidup di `outbox_local` **di perangkat** — server tidak punya
baris untuk dihitung. Latensi keranjang, crash rate, dan rasio offline terjadi
di klien. Ketiganya menuntut telemetri klien (buffer offline-first + endpoint
ingest), yang belum ada. **Metrik bernama benar yang selalu nol lebih buruk
daripada metrik yang tidak ada** — ada test yang menolak nama-nama itu muncul.

⛔ **Nol data merchant, dan itu batas ETIS** (`ARCH:309`). Metrik operasional
bersifat lintas-tenant menurut sifatnya, sementara aplikasi tunduk RLS
(invariant #8) — agregasi lintas-tenant menuntut pembaca ber-`BYPASSRLS`, yaitu
keputusan deployment. Yang diekspor adalah metrik **proses**. Ada test yang
menembak `/metrics` lalu mencari id tenant, nama outlet, nama produk, dan email
pengguna di dalamnya.

⛔ **Label rute memakai POLA Fastify, bukan URL mentah.** URL mentah membuat
setiap `/orders/<uuid>` menjadi deret waktu tersendiri — monitoring yang penuh
deret sekali-pakai berhenti dapat dipakai, dan gejalanya baru terlihat
berminggu kemudian saat penyimpanan metriknya penuh.

⛔ **`onResponse`, bukan `onSend`**: yang diukur adalah permintaan yang
SELESAI, termasuk yang gagal. Hook yang hanya berjalan pada jalur sukses
menghasilkan grafik yang paling cerah tepat saat server paling sakit.

Sabotase: URL mentah + `/metrics` mencatat dirinya sendiri → 3 merah.

**Masalah + solusinya:** ⛔ **Penjaga invariant #7 menandai kodeku sendiri.**
Batas histogram ditulis sebagai detik berbunyi `[0.01, 0.025, 0.05, 0.1, …]`,
dan `tests/domain/tax-invariant.test.js` membacanya sebagai angka tarif pajak
di luar `TaxCalculator`. **Penjaganya benar** — `0.1` telanjang di kode server
tidak dapat dibedakan dari 10% tanpa membaca konteks. Yang diperbaiki adalah
kodeku: ember kini **milidetik bilangan bulat**, dibagi 1.000 saat render.
Daftar pengecualian akan bertambah panjang sampai penjaganya tidak menjaga apa
pun — dan `ARCH:300` memang menyebut ambangnya dalam milidetik.

### Task 12 — F6: alat koreksi append-only

**Bagian terakhir gate F6.** `ARCH:400` menuntut alat koreksi ada **sebelum**
insiden pertama, dan §10 runbook sendiri mencatat lubangnya: perangkat yang
rusak, hilang, atau di-reset membawa penjualan yang belum terkirim, dan
satu-satunya ekspor yang ada hanya dapat **dibaca orang**. Jalan masuknya
kembali ke server adalah mengetik ulang dari kertas — untuk transaksi yang
uangnya sudah masuk laci merchant.

Tiga potong:

1. `buatEksporPemulihan` di `packages/sync-client/src/status.ts` — ekspor JSON
   yang dapat dibaca mesin, di samping ekspor teks yang sudah ada.
2. `tools/pulihkan-antrean.mjs` — memutar ulang berkas itu lewat endpoint REST
   yang **sama** dengan relay outbox.
3. Tombol kedua **"Ekspor pemulihan (JSON)"** di K-14, di sebelah ekspor
   darurat.

⛔ **Tidak melanggar invariant #2.** Alat ini tidak meng-`UPDATE` apa pun. Ia
menyampaikan penjualan yang **belum pernah sampai**, dengan id dan idempotency
key aslinya; server memperlakukannya persis seperti perangkat yang akhirnya
online.

⛔ **Idempotency key ASLI ikut di berkas, dan payload dikirim APA ADANYA** —
tidak diurai lalu dirangkai ulang. Dua alasan, keduanya keras: key yang
di-generate ulang menghasilkan penjualan **ganda** pada setiap item yang
sebenarnya sudah sampai, dan server mem-*hash* body untuk mendeteksi
`IDEMPOTENCY_KEY_REUSED` — `JSON.parse` lalu `JSON.stringify` mengubah urutan
kunci dan spasi, jadi retry yang sah akan terbaca sebagai isi yang berubah.

**Aman dijalankan dua kali** adalah sifat yang wajib, bukan kemewahan: yang
menjalankannya adalah orang yang sedang panik. Ada `--kering` (dry run), dan
jenis entitas tanpa rute diperiksa **sebelum satu permintaan pun dikirim** —
berhenti di tengah adalah keadaan yang paling sulit dijelaskan ke merchant.

Item dikirim **berurutan** mengikuti urutan berkas (`created_at, id`).
`payment` menunjuk order yang harus mendarat lebih dulu.

**Masalah + solusinya:** ⛔ **alat pemulihanku sendiri punya cacat, dan hanya
menjalankannya terhadap server sungguhan yang menemukannya.** Versi pertama
memperlakukan **setiap 409** sebagai "sudah ada di server". Saat diuji,
`POST /shifts` menjawab `409 SHIFT_ALREADY_OPEN` — perangkat itu punya shift
LAIN yang masih terbuka — dan alatnya melaporkan keberhasilan. Shift-nya tidak
pernah dibuat, order berikutnya gagal `SHIFT_NOT_FOUND`, dan ringkasan akhirnya
menyebut satu keberhasilan yang tidak pernah terjadi.

**Sukses karena alasan yang salah adalah bentuk kegagalan terburuk untuk alat
pemulihan**: operator menutup insiden dengan penjualan yang masih hilang.
Perbaikannya menyempit ke `ID_ALREADY_EXISTS` saja — semua sisanya kegagalan —
plus petunjuk terarah untuk `SHIFT_ALREADY_OPEN` dan `SHIFT_NOT_FOUND`, dua
kode yang paling mudah salah dibaca sebagai kerusakan data. Ini kelas yang sama
dengan yang F3 catat: test hijau karena memeriksa keadaan yang tidak dapat
terjadi. Fake tidak dapat menghasilkan `SHIFT_ALREADY_OPEN`.

**Test** (`tests/sync-client/status.test.js`, 4 baru): key asli dipertahankan,
payload identik byte demi byte, baris `sent` dikecualikan, dan setiap jenis di
`RUTE_DIDUKUNG` punya rute di alat — penjaga dua arah, supaya jenis entitas
baru tidak diam-diam kehilangan jalur pemulihannya.

**Runbook**: §10 kehilangan tanda ⛔ "BELUM ADA", dan §10.1 baru memuat
prosedurnya beserta tabel arti keluaran. §1 langkah 3 kini menuntut **kedua**
ekspor sebelum perangkat diganti. Ditambah penjaga baru di
`tests/domain/runbook.test.js`: setiap `tools/*.mjs` yang runbook suruh
jalankan harus benar-benar ada di repo — perintah yang menjawab "Cannot find
module" saat insiden adalah tepat cara terburuk untuk mengetahui berkasnya
dipindah. Sabotase: nama alat diketik salah → 1 merah.

**Gate F6 tertutup sejauh yang dapat dibuktikan tanpa deployment.** Yang
tersisa dari F6 dan dicatat sebagai batas, bukan kelalaian: telemetri klien
untuk lima metrik `ARCH:296` yang server tidak dapat lihat, metrik ops
lintas-tenant (menuntut pembaca ber-`BYPASSRLS` — keputusan deployment), dan
staged rollout.

### Task 6 — Modul C-3: rekonsiliasi & ekspor rekapitulasi

**Selesai.** Sisa terakhir Modul C: FR-C12 (rekonsiliasi pembayaran digital)
dan FR-C13 (ekspor rekapitulasi), keduanya P1.

`IA:§3.3` menamai B-19 "Laporan Pembayaran **& Rekonsiliasi**" sejak awal, dan
sampai sekarang kata kedua itu tidak punya kode di baliknya — layarnya sendiri
menyatakan batas itu di komentar kepalanya.

#### FR-C12 — perkiraan MDR

**Keputusan yang diambil:**

- ⛔ **MDR bukan pajak, dan tidak boleh diperlakukan seperti pajak.** Ia hidup
  di `packages/domain/src/mdr.ts`, bukan di `tax.ts`. Ia biaya jasa akuisisi:
  tidak masuk `order.tax_amount`, tidak muncul di struk, tidak mengubah satu
  pun angka di `order`. Menaruhnya di `tax.ts` akan membuatnya ikut terhitung
  sebagai pajak pada laporan berikutnya yang menjumlahkan isi berkas itu.
- ⛔ **`null` BERBEDA dari `0`, dan perbedaannya sampai ke layar.** `0` =
  diperkirakan tidak dipotong (UMI ≤ Rp 500.000); `null` = tidak ada perkiraan
  sama sekali. Kartu EDC masuk yang kedua — `spec-c` tidak memberikan satu pun
  tarifnya. Layar menampilkan "— tidak ada perkiraan", CSV menulis sel kosong.
  "Rp 0" untuk kartu adalah pernyataan yang **salah**, bukan sekadar kosong.
- ⛔ **`payment.mdr_estimated` adalah SNAPSHOT**, ditulis di transaksi
  pembayaran. Menghitungnya saat laporan dibaca membuat dua ekspor untuk
  periode yang sama berbeda begitu kategori atau tarif regulator berubah — dan
  yang kedua akan dibaca sebagai koreksi meski tidak ada transaksi yang
  berubah. Konsekuensinya **dinyatakan**, bukan disembunyikan: memperbaiki
  kategori tidak mengubah baris lama (runbook §5.5).
- **Tarif berskala 10.000 (`bigint`)**, konvensi yang sama dengan
  `tax_rate.rate`. Bukan karena float akan meleset di skala ini — ia tidak —
  melainkan supaya aturan "jalur uang tidak menyentuh float" tidak punya
  pengecualian yang akan disalin ke kolom lain.
- **Kategori merchant bawaan `umi`**, ditandai `[ASUMSI]`. Yang membuat bawaan
  salah tidak berbahaya: seluruh angka turunannya berlabel PERKIRAAN dan tidak
  satu pun masuk `order`, struk, atau omzet.

#### FR-C13 — rekapitulasi

- ⛔ **Angka kepalanya dari fungsi yang SAMA dengan `/reports/sales`.** AC
  kedua menuntut totalnya cocok; `rekapPenjualan` memanggil `posisiPenjualan`,
  jadi itu benar menurut **konstruksi**. Testnya `assert.deepEqual` terhadap
  respons endpoint yang lain, bukan terhadap angka tulisan tangan.
- ⛔ **Rincian per metode DIPANGGIL dari `ambilPembayaran`.** Versi pertama
  menyalin query-nya, dan salinan itu akan menyimpang pada tiga aturan
  sekaligus. Diubah sebelum sempat mendarat.
- ⛔ **Pajak dari kolom SNAPSHOT**, bukan JOIN ke `tax_rate`. Migrasi `0028`
  menambah `order_line.tax_jurisdiction` dengan alasan yang sama persis
  dengan `tax_rate_name` di `0022`: nullable, tanpa backfill.
- **Periode dan tanggal dibuat ADA DI DALAM berkas** (AC ketiga) — nama berkas
  hilang begitu seseorang menyimpannya ulang. `dibuatPada` dari jam
  **database**.

**Masalah + solusinya:**

- ⛔ **Sabotase menemukan test yang HAMPA — punyaku sendiri.** Test integrasi
  "order yang dibatalkan tidak menyumbang diskon/service charge/pembulatan"
  tetap **hijau** saat aturan `dibatalkan.has(o.id)` dihapus dari
  `rekapPenjualan`. Sebabnya: `POST /orders` menulis **nol** ke
  `order.order_discount` dan `order.service_charge_amount` — diskon tingkat
  order belum ada di jalur itu, jadi assertion-nya memeriksa keadaan yang
  tidak dapat terjadi. Persis kelas cacat yang F3 catat.

  Perbaikannya bukan menghapus fieldnya, melainkan memindahkan pengujian ke
  tempat barisnya dapat disusun langsung: lima test baru di
  `tests/domain/posisi-penjualan.test.js`. Sabotase yang sama sekarang
  menghasilkan merah. Batasnya dicatat di komentar handler dan di `HANDOFF.md`.

- ⛔ **Kelas tipografi yang tidak ada, dan tidak ada yang menangkapnya.**
  `t-body-lg` ditulis di B-19; `/ds-bundle` hanya punya `t-body`, `t-body-md`,
  `t-caption`, `t-display`, `t-heading`, `t-hero`, `t-title`, `t-title-lg`.
  Kelas yang tidak cocok apa pun **tidak menghasilkan error** — teksnya
  dirender pada ukuran warisan, dan hasilnya terlihat *hampir* benar.
  `typecheck` dan `lint:ds` sama-sama buta: keduanya tidak tahu apa pun
  tentang nama kelas CSS di dalam string.

  Yang menangkapnya adalah membaca `tokens/typography.css`. Supaya tidak
  bergantung pada itu lagi: `tests/oxlint-ds-adherence/kelas-tipografi.test.js`
  menuntut setiap `t-*` yang dipakai aplikasi ada di design system. Sabotase →
  1 merah.

- **Penjaga drift lokal menuntut keputusan, dan itu benar.**
  `order_line.tax_jurisdiction` membuat `tests/kasir/tipe-divergen.test.js`
  merah: kolom server baru harus ada di skema lokal ATAU terdaftar sebagai
  keputusan. Ia didaftarkan **sengaja tidak turun** — menambah kolom raw table
  mengubah sidik jari skema lokal, dan itu menuntut `disconnectAndClear()` +
  unduh ulang katalog di setiap perangkat merchant. Biaya nyata untuk kolom
  yang tidak satu pun layar kasir baca.

- **Penjaga cakupan RBAC merah** setelah `PATCH /tenants/settings` masuk
  `PETA_PERAN` — bekerja sesuai desain. Kasus penolakannya ditambahkan.

- Void di test menuntut `receiptNumber` **dan** `sequence`: order pembatal
  adalah baris tersendiri dengan nomor struknya sendiri.

**Yang TIDAK dibuat, dan alasannya:**

- **XLSX.** `spec-c:444` menulis "CSV + XLSX". XLSX menuntut dependensi baru;
  CSV terbuka apa adanya di Excel dan Google Sheets. Batas yang dinyatakan.
- **Perkiraan MDR kartu EDC.** Tarifnya per-acquirer dan per-jenis kartu;
  `spec-c` tidak memberikan satu pun angkanya. Menebak satu tarif untuk
  semuanya menghasilkan perkiraan yang salah dengan percaya diri, pada laporan
  yang gunanya justru menjelaskan selisih.

**Verifikasi browser** (Chromium + Playwright, server + Vite sungguhan, merchant
`free` yang baru didaftarkan lewat API — 1 penjualan tunai + 2 QRIS statis):

```
B-19 judul memuat "Rekonsiliasi"     : true
B-19 kolom perkiraan potongan        : true
B-19 kolom perkiraan diterima        : true
B-19 tunai → "— tidak ada perkiraan" : true
B-29 kategori awal                   : umi
B-29 setelah simpan                  : uke
B-29 setelah MUAT ULANG penuh        : uke   ← dari server, bukan state lokal
B-20 tombol "Rekapitulasi pajak"     : true
galat konsol                         : hanya favicon.ico 404 (Vite dev)
```

Tabelnya terbaca apa adanya:

```
Metode          Transaksi  Nilai transaksi  Perkiraan potongan       Perkiraan diterima
QRIS (statis)   2          Rp 2.640.000     − Rp 7.920               Rp 2.632.080
Tunai           1          Rp 1.320.000     — tidak ada perkiraan    Rp 1.320.000
```

Rp 7.920 = 0,3% dari Rp 2.640.000 — UMI di atas ambang, dihitung per baris
payment lalu dijumlahkan.

**Efek samping yang menyenangkan dari pengujian ulang:** menjalankan skrip
browser dua kali membuat "Simpan kategori" **tidak dapat diklik** pada putaran
kedua — tombolnya `disabled` karena nilai pilihan sama dengan yang tersimpan.
Itu perilaku yang diinginkan, dan cara ia terbukti adalah kegagalan skrip, bukan
assertion yang ditulis untuk itu.

### Task 8 — refund parsial dengan pemilihan baris di UI

**Selesai.** Utang F2 terakhir yang menyentuh jalur uang. `spec-b:237`:
*"Kasir memilih baris mana yang direfund."* Sampai sekarang K-10 selalu
mengirim `lines: []` — uang kembali, barang tidak pernah tercatat kembali —
dan itu **dinyatakan** di komentar kode alih-alih ditebak.

**Keputusan yang diambil:**

- ⛔ **Nilai refund BUKAN jumlah `line_total`.** `order_line.line_total`
  belum kena pajak eksklusif sementara `order.total` sudah; menjumlahkannya
  mengembalikan uang **lebih sedikit** daripada yang pelanggan bayar, dan
  salahnya diam karena angkanya masuk akal. Untuk pajak inklusif ia justru
  sudah termasuk — tidak ada satu rumus penjumlahan yang benar untuk keduanya.

  Yang dipakai: bagi `order.total` itu sendiri dengan `line_total` sebagai
  bobot (`allocateProportionally`). Apa pun bentuk pajaknya, pembulatannya,
  dan service charge-nya, memilih seluruh baris mengembalikan **tepat**
  `order.total`. Diuji sebagai **property**, bukan contoh.

- ⛔ **Batas per baris diturunkan per VARIASI**, meniru aturan server
  (`planRestock` → `RESTOCK_EXCEEDS_SOLD`). `stock_movement` tidak menyimpan
  `line_id`, jadi kebenaran per baris tidak ada di mana pun; yang dijamin
  adalah jumlahnya per variasi tidak pernah melebihi yang server izinkan. Dua
  baris dapat menunjuk variasi yang sama — modifier memisahkan baris, stoknya
  satu.

- **Ditegakkan di KLIEN juga, bukan hanya server.** Kalau hanya server yang
  memeriksanya, kasir baru tahu berjam-jam kemudian saat antrean terkuras —
  uang sudah keluar laci dan barangnya sudah di rak.

- ⛔ **Pilihan bermula KOSONG, bukan penuh.** `lines: []` adalah keadaan yang
  sah: pelanggan yang kopinya tumpah tidak mengembalikan kopinya. Memulai
  dengan seluruh baris terpilih membuat restock menjadi bawaan diam-diam, dan
  stok yang mengembang baru ketahuan saat opname.

- **Barang dan uang tetap DUA keputusan.** Tombol "Sesuai barang" menyalin
  nilai baris terpilih ke nominal alih-alih mengunci keduanya — mengembalikan
  uang tanpa barang, dan barang tanpa seluruh uangnya, keduanya nyata.

- **`baris_melebihi_sisa` terpisah dari `melebihi_sisa`.** Yang pertama soal
  BARANG, yang kedua soal UANG. Kasir yang diberi tahu "melebihi sisa" untuk
  kuantitas yang salah akan mengurangi nominalnya — dan nominalnya sudah benar.

**Masalah + solusinya:**

- ⛔ **Kosakata `stock_movement.type` klien BERBEDA dari server.** Klien
  menulis `void_return`/`refund_return`; `0010_inventory.sql` punya
  `CHECK (type IN ('sale','void','refund',…))` yang **menolak keduanya**.

  Kenapa tidak pernah gagal: baris `stock_movement` klien murni lokal — jalur
  naik mengirim PERMINTAAN pembatalan dan server menulis barisnya sendiri, dan
  `stock_movement` tidak ada di sync rules jalur turun. Skema lokal juga tidak
  punya CHECK, jadi SQLite tidak menangkapnya.

  Yang membuatnya berbahaya justru kalimat itu: `stock_movement` **sudah**
  terdaftar sebagai raw table. Hari ia ditambahkan ke sync rules, dua kosakata
  untuk satu peristiwa menjadi laporan yang menghitung sebagian pengembalian
  dan melewatkan sisanya — tanpa satu pun error. Disamakan, dan dijaga
  `tests/kasir/kosakata-stock-movement.test.js`.

- **Dua salinan aturan tampilan kuantitas.** `tampilkanKuantitas` hidup di
  handler laporan server, dan layar kasir menulis `quantityMilli / 1000`
  (float, kelas `0.30000000000000004`). Diangkat ke
  `packages/domain/src/kuantitas.ts`; server mengimpornya, klien memakainya.

- **`allocateProportionally` diangkat dari `tax.ts`** ke
  `packages/domain/src/alokasi.ts`. Menyalinnya ke modul kedua berarti dua
  aturan pembulatan sisa.

**Sabotase — tiga, semuanya merah:**

```
nilai refund dijumlahkan dari line_total   → 3 merah (property "tepat total")
batas per baris dilewati                   → 3 merah (tests/kasir/pembatalan)
type kembali ke `refund_return`            → 1 merah (penjaga kosakata)
```

**Verifikasi browser** (harness kasir di atas wa-sqlite + OPFS sungguhan):

```
T14 sisa refund per variasi terbaca di wa-sqlite
    var-1=1000 (number) · var-2=500 (number)     LULUS
```

Bentuk SQL barunya — `SUM(...) WHERE type IN (...) GROUP BY` — dijalankan di
browser sebelum dipercaya, aturan `CLAUDE.md` yang lahir dari `ON CONFLICT(id)`.
Baris `sale` (−2000) benar dikecualikan: kalau ia ikut, sisa per baris menjadi
negatif dan setiap pemilihan ditolak — gejalanya "tidak bisa refund apa pun",
bukan error.

**Batas yang dinyatakan:** picker-nya belum dijalankan lewat alur perangkat
sungguhan (login → shift → jual → refund parsial), karena itu menuntut
PowerSync tersambung dan katalog tersinkron. Yang sudah dibuktikan di browser
adalah bentuk SQL-nya; aturannya diuji sebagai property, dan wiring-nya lewat
fake `DbLokal`.

### Task 9 — K-16 buka laci (FR-D7) dan K-17 scanner

**Selesai.** Dua utang F2 terakhir yang tidak menuntut perangkat keras.

#### K-16 — no-sale

`spec-d:229`: *"Membuka laci tanpa transaksi adalah pola fraud kasir paling
dasar."* Yang dibangun karena itu bukan tombolnya — tombolnya sepele —
melainkan **kontrolnya**.

- ⛔ **Yang dicatat adalah PERINTAH sistem, bukan bukti laci terbuka.**
  `spec-d:231`: sinyalnya **satu arah**. Sistem tidak tahu apakah laci
  benar-benar terbuka, dan tidak dapat mendeteksi laci yang dibuka manual
  dengan kunci. Dinyatakan di layar, di runbook, dan di kontrak endpoint —
  merchant yang mengira laporan ini menghitung SETIAP pembukaan akan
  menyimpulkan selisih kas dari angka yang buta pada separuhnya.
- ⛔ **Ambang dihitung dari `audit_event`, bukan dari kolom hitungan.** Kolom
  hitungan adalah angka kedua yang harus dijaga sepakat dengan jejaknya, dan
  yang menyimpang di antaranya tidak dapat diputuskan mana yang benar. Jejak
  itu juga yang laporan exception FR-G5 baca.
- ⛔ **Pembukaan KEEMPAT yang menuntut PIN, bukan ketiga** (`spec-d:239`).
  Ambang yang bergeser satu membuat kasir dimintai PIN pada pembukaan yang
  merchant janjikan bebas. Sabotase `>=` → `>` menghasilkan 3 merah di server
  dan 3 di domain.
- ⛔ **TIDAK menulis `cash_movement`.** No-sale tidak memindahkan uang;
  movement bernilai nol membuat buku kas memuat baris yang tidak menjelaskan
  apa pun.
- **Catatan ditulis MESKI laci tidak dapat dibuka.** v1 belum punya printer
  sama sekali, jadi "laci tidak terbuka" adalah keadaan NORMAL. Kalau
  catatannya ikut gagal saat lacinya gagal, tidak ada kontrol sama sekali.
- **Berjalan penuh tanpa jaringan** (`IA:66`). Menukar uang pecahan terjadi
  justru saat sibuk, dan sibuk adalah saat jaringan paling sering putus.

#### K-17 — scanner

`research/07` §4: mayoritas scanner USB adalah **HID keyboard** — ia mengetik
isi barcode lalu Enter. Dari sudut pandang aplikasi, scanner dan kasir memakai
pintu yang **sama persis**; yang membedakan hanya kecepatan.

- ⛔ **Heuristik, bukan kepastian**, dan yang diuji adalah perilaku saat ia
  SALAH: kasir cepat yang dianggap scan → pencarian barcode yang tidak
  menemukan apa-apa; scanner lambat yang dianggap ketikan → kasir mengetik
  ulang. Keduanya menjengkelkan, bukan berbahaya. Yang TIDAK boleh terjadi
  adalah scan yang menambahkan produk salah — dijaga di tempat lain.
- ⛔ **`cariBarcode`, BUKAN `cariItem`.** Pencarian menyaring daftar untuk
  dilihat kasir; scan harus memutuskan SATU produk tanpa kasir melihat apa
  pun. Memakai pencarian untuk scan akan menambahkan produk pertama yang
  NAMANYA memuat angka barcode.
- ⛔ **Barcode ganda tidak memilih siapa pun.** Menebak berarti setengah
  penjualan produk itu tercatat pada produk lain, tanpa satu pun error.
- ⛔ **Listener global, tapi TIDAK menangkap ketukan di kolom teks.** PIN di
  K-01 dan K-11 diketik cepat dan diakhiri Enter — bentuk yang PERSIS sama
  dengan scan. Menangkapnya berarti PIN mendarat sebagai pencarian barcode.
- **Waktu di-INJECT** di modul domain, jadi setiap kasus batas dapat ditulis
  persis dan tidak ada test yang merah sesekali. Ada penjaga yang memindai
  modulnya untuk `Date.now`.

**Masalah + solusinya:**

- ⛔ **Test yang HAMPA karena `X-Actor-Id` diabaikan.** Test "akuntan ditolak"
  hijau… dengan status **201**. Sebabnya: `getActorId` mengabaikan
  `X-Actor-Id` sepenuhnya di rute terlindungi — *"itu yang mengubahnya dari
  klaim menjadi bukti"* — jadi yang diuji adalah **owner**, bukan akuntan.
  Diperbaiki dengan `buatSesi` sungguhan. Sabotase menghapus `assertBoleh` →
  1 merah, jadi guardnya kini benar-benar dijaga.

- **Penempatan RBAC yang salah, ditemukan penjaga cakupan.** `POST
  /shifts/:shiftId/no-sale` mula-mula masuk `PETA_PERAN` dengan
  `shift_open_close`. Penjaga `jumlah kasus MENUTUPI seluruh PETA_PERAN`
  menuntut kasus penolakan untuk setiap entri — dan setiap kasus di sana
  menyatakan kasir DITOLAK, sementara kasir justru BOLEH membuka laci.
  Dipindah ke `DIKECUALIKAN` dengan alasan tertulis, dan penjaganya menjadi
  `assertBoleh` di handler (menutup akuntan, `spec-f:82`).

- **Penjaga dua arah alat pemulihan merah** setelah jenis `no_sale`
  ditambahkan — bekerja sesuai desain. `tools/pulihkan-antrean.mjs` mendapat
  rutenya.

- **Ambang test-ku sendiri salah baca.** Saya menulis "ambang 1 → pembukaan
  pertama sudah menuntut PIN"; semantiknya "ambang = berapa pembukaan yang
  BEBAS". Kodenya benar, assertion-nya salah — diperbaiki beserta komentar
  yang menyatakan semantiknya, supaya pembaca berikutnya tidak menggeser
  seluruh tangga.

**Batas yang dinyatakan:** perintah fisik ke laci belum ada
(`peripheralAktif()` mengembalikan `null` di v1; laci di-kick lewat printer).
Layar menyatakan itu apa adanya alih-alih diam. Scanner belum pernah diuji
dengan perangkat sungguhan — `JEDA_MAKS_MS` ditandai `[ASUMSI]` dan menunggu
OQ-14 bersama printer Bluetooth.

### Task 10 — B-06 memakai pencarian sisi server

**Selesai.** Menutup batas yang Task 7 nyatakan: *"kemampuan servernya ada dan
teruji; layarnya belum memakainya."*

**Keputusan yang diambil:**

- ⛔ **Seluruh saringan dikirim ke server, bukan sebagian.** Task 7 sudah
  mencatat kenapa menyetengahinya berbahaya: memuat satu halaman lalu tetap
  menyaring di klien menghasilkan pencarian yang hanya menemukan apa yang
  **kebetulan sudah dimuat** — merchant mengetik barcode produk ke-300, tidak
  ada yang muncul, tanpa satu pun error. `q`, `categoryId`, dan
  `includeArchived` semuanya berangkat.
- ⛔ **`saringProduk` DIHAPUS, bukan dibiarkan menganggur.** Dua tempat yang
  memutuskan "produk mana yang cocok" akan menyimpang, dan yang menyimpang
  menghasilkan pencarian yang menemukan hal berbeda tergantung layar mana yang
  bertanya. Testnya ikut dihapus — aturannya sudah diuji di sisi server, dan
  komentar di kedua tempat menunjuk ke sana.
- **Jeda ketik 300 ms.** Tanpa itu "kopi susu" adalah sembilan permintaan, dan
  urutan kembalinya tidak dijamin: hasil untuk "kop" dapat mendarat SESUDAH
  hasil untuk "kopi susu" dan menimpanya.
- ⛔ **Dua keadaan kosong yang BERBEDA.** Sejak pencarian pindah ke server,
  `semua.length === 0` tidak lagi berarti "katalog kosong" — ia berarti
  "halaman ini kosong". "Belum ada produk" mengarahkan merchant ke impor
  katalog; "tidak ada yang cocok" mengarahkannya mengubah pencarian. Satu
  kalimat untuk keduanya salah untuk salah satunya.
- **Katalog yang terpotong DINYATAKAN.** Daftar yang berhenti di 50 tanpa
  berkata apa-apa membuat merchant menyimpulkan produknya hilang, dan
  mencarinya di tempat yang salah. Kalimatnya juga menyebut bahwa
  **pencariannya mencakup seluruh katalog**, bukan hanya yang tampil.

**Masalah + solusinya:**

- ⛔ **Lubang yang ditemukan saat merencanakan wiring: server tidak punya
  saringan "tanpa kategori".** Klien mengirim `categoryId=__tanpa__`; server
  akan mencari kategori ber-id itu, tidak menemukannya, dan mengembalikan
  **nol produk** — bukan produk tanpa kategori. Nol terlihat persis seperti
  "memang tidak ada".

  Ini kelas regresi yang **sama** dengan barcode di Task 7, dan ditemukan
  dengan cara yang sama: membaca `saringProduk` sebelum menggantinya, bukan
  dari test. Server mendapat cabang `category_id IS NULL`, dan konstantanya
  diangkat ke `packages/domain/src/katalog-saringan.ts` supaya klien dan
  server tidak punya dua salinan string ajaib.

- ⛔ **Saya menjalankan satu suite ber-database bersamaan dengan yang berjalan
  di latar, dan keduanya saling menghapus data.** Persis bahaya yang tertulis
  di kepala berkas ini. Hasilnya: `catalog` dan `ordering` merah dengan
  kegagalan yang terbaca seperti bug harga. Dijalankan ulang bersih; nol
  kegagalan. Peringatan di kepala berkas ini ternyata belum cukup — yang
  kurang adalah **menunggu**, bukan mengetahui.

**Verifikasi Task 9 + 10 selesai penuh.** Commit `93c65e4` dibuat saat lima
suite ber-database masih berjalan, dan itu dinyatakan di pesan commit-nya.
Hasil akhirnya, dijalankan bersih tanpa satu pun proses test lain:

```
typecheck · lint:ds                                   PASS
runtime · domain · sqlite-local · oxlint-ds-adherence PASS
dst · sync-client · kasir · backoffice                PASS
isolation · schema · server · catalog · ordering      PASS
payment · identity · tenancy · dst-server             PASS
```

Tujuh belas suite, nol kegagalan.

### Task 13 — B-10 Harga memakai pemilih sisi server

**Selesai.** Menutup batas yang Task 10 catat sendiri: *"B-10 Harga masih
memuat `/items` tanpa paginasi."*

**Yang sebenarnya terjadi di layar itu lebih buruk daripada terpotong.** B-06
setidaknya berhenti di 50 baris tabel; B-10 merender **setiap** produk sebagai
tombol di satu baris yang membungkus. Pada katalog paket Pro (5.000 produk)
itu 5.000 tombol — bukan sekadar lambat, melainkan layar yang tidak dapat
dipakai memilih apa pun.

**Keputusan yang diambil:**

- **Pencarian, bukan paginasi.** Layar ini memilih SATU varian untuk diberi
  harga, dan merchant tahu produk mana yang ia maksud. Daftar panjang bukan
  bantuan melainkan dinding yang harus dipindai mata; yang menemukan produk
  adalah kotak pencariannya. Batasnya 20.
- **`kueriDaftarProduk` dipakai ulang** dari B-06 — sudah teruji, dan dua
  pembangun kueri akan menyimpang pada saringan berikutnya yang ditambahkan.
- ⛔ **Produk yang SEDANG DIPILIH dijamin tetap ada di daftar.** Merchant
  memilih Kopi Susu, panel riwayat harganya terbuka, lalu ia mengetik
  pencarian lain — dan hasil baru tidak memuat Kopi Susu. Tanpa aturan ini
  tombol yang aktif lenyap sementara panelnya masih menampilkan harganya, dan
  merchant menyunting harga produk yang ia kira sudah tidak dipilih. Aturannya
  di modul murni (`daftarPemilih`), diuji tanpa DOM; sabotase yang
  mengembalikan hasil apa adanya → 1 merah.
- **Urutan hasil dipertahankan.** Tombol yang melompat posisi saat mengetik
  adalah tombol yang salah diklik.
- **Daftar terpotong dinyatakan**, beserta kalimat bahwa pencariannya mencakup
  seluruh katalog.

**Verifikasi:** `typecheck` · `lint:ds` · 8 suite non-DB — hijau. Perubahannya
**hanya klien** (`Harga.tsx`, `produk.ts`, testnya); tidak satu baris pun kode
server atau skema berubah sejak commit sebelumnya, yang ke-17 suitenya hijau.

### Task 14 — Telemetri klien (F6)

**Selesai.** Menutup lima dari delapan metrik `ARCH:296` yang
`apps/server/src/metrik.ts` sendiri daftarkan sebagai **tidak dapat
dihasilkan server**: umur antrean, item gagal sinkron, latensi keranjang,
crash rate, dan rasio offline. Semuanya terjadi di perangkat, sebagian besar
justru saat perangkat tidak terhubung.

Rantainya: `catat()` → buffer `telemetry_local` → penjadwal →
`POST /devices/{id}/telemetry` → `device_telemetry` → `GET .../telemetry`.

**Keputusan yang mengikat kode:**

- ⛔ **Batas etis `ARCH:309` ditegakkan di TIGA lapisan, dan lapisan ketiga
  membaca KODE.** Daftar event tertutup + nilai wajib angka menjaga data;
  yang tidak dijaga keduanya adalah slot `tipe` — ia memang string, dan
  string apa pun lolos. `tests/kasir/telemetri-batas-etis.test.js` karena itu
  memindai setiap pemanggilan `catat()` di `apps/kasir/src` dan menolak
  `.message`, template literal, dan properti selain `.name`. Sabotase
  (`e.name` → `e.message`) → 2 merah.
- ⛔ **Variabel `VITE_TELEMETRY` yang TIDAK DISET berarti `off`, bukan
  `full`.** `ARCH:262` tetap berlaku — yang menetapkan `full` adalah
  konfigurasi deployment SaaS, bukan ketiadaan konfigurasi. Alasannya
  asimetri akibat: on-premise yang lupa menyetelnya akan MENGUMPULKAN data
  tanpa ada yang menyetujuinya, dan itu tidak terlihat siapa pun; SaaS yang
  lupa hanya menghasilkan metrik kosong, dan kosong itu terlihat.
- ⛔ **`mode === 'off'` berarti tidak ada yang dipasang** — bukan sink yang
  membuang. Tidak ada pendengar, tidak ada timer, tidak ada baris database.
  "Dikumpulkan lalu dibuang" adalah jawaban yang berbeda dari "tidak
  dikumpulkan".
- ⛔ **`rekam()` menelan SETIAP kegagalan**, termasuk `no such table` pada
  perangkat yang migrasi lokalnya belum jalan. Pemanggilnya jalur penjualan
  dan jalur cetak (`ARCH:307`).
- ⛔ **Pemangkasan buffer membuang yang TERLAMA.** Jaminan itu hidup di
  `ORDER BY`, dan fake `DbLokal` tidak menegakkan `ORDER BY` sama sekali —
  jadi testnya di atas SQLite sungguhan, disisipkan dalam urutan acak.
  Sabotase `ASC` → `DESC` → 2 merah.
- ⛔ **`susunMuatan` tidak menghapus; penghapusan menunggu server menjawab.**
  Menghapus lebih dulu berarti kegagalan jaringan membuang metrik yang justru
  menjelaskan kegagalan itu.
- ⛔ **Percobaan ulang mengirim BATCH YANG SAMA**, dengan kunci idempotensi
  yang diturunkan dari daftar id (FNV-1a). Batch yang melebar di antara dua
  percobaan akan menghitung ganda bila yang pertama sebenarnya sampai.
- ⛔ **`401` DIPERTAHANKAN, `400` DIBUANG.** Perangkat yang kredensialnya
  kedaluwarsa akan di-provisioning ulang, dan metrik dari masa ia tidak
  terhubung justru yang menjelaskan kenapa. Muatan yang bentuknya salah tidak
  akan pernah diterima, dan batch yang diulang selamanya akhirnya memangkas
  metrik yang masih baik.
- ⛔ **Latensi keranjang diukur HANYA untuk jalur langsung.** Penanda
  dikosongkan begitu dialog modifier terbuka — angka yang memuat waktu
  berpikir orang mengukur menu, bukan aplikasi.
- **`app_version` disimpan bersama angkanya**, bukan dibaca dari
  `device.app_version` saat laporan dibuat: `ARCH:302` memakai crash rate per
  versi sebagai gate rollout, dan versi perangkat sekarang sudah berubah saat
  rollout gagal.
- **Kesehatan antrean dibaca lewat `ringkasanAntrean`** — fungsi yang sama
  dengan indikator sinkronisasi dan K-14. Antrean kosong TIDAK mengirim
  `umur_antrean_jam: 0`; nol akan menurunkan rata-rata umur tepat pada
  perangkat yang paling sehat.
- **`double precision` di `device_telemetry` bukan pelanggaran aturan float:**
  larangan itu berlaku di jalur uang, dan yang menjaga kolom-kolom ini tetap
  di luar jalur itu adalah CHECK `event` — tidak ada nama event yang menyebut
  jumlah uang, dan tidak boleh ada.

**Dua cacat yang ditemukan test, bukan review:**

| Temuan | Yang menyembunyikannya |
|---|---|
| **Koersi AJV mengubah `null` menjadi `0`** pada kolom bertipe `number`, sebelum handler melihatnya — pengukuran yang tidak pernah terjadi, tidak dapat dibedakan dari nol yang sungguhan | `typeof === 'number'` di handler tidak melihat apa pun; muatan menjawab `202` |
| **Migrasi lokal tidak pernah membuat tabel murni-lokal yang BARU** — `jalankanDdl` hanya berjalan saat sidik jari raw table berubah, dan sidik jari itu tidak menghitung tabel lokal | Test memakai skema `001-initial.sql` yang sudah lengkap; hanya perangkat yang SUDAH terpasang yang terkena |

Yang menangkap cacat pertama bukan pemeriksaan tipe melainkan **aritmetika**:
setiap sampel ada di `[min, max]`, jadi `total` ada di
`[min × count, max × count]`. `total = 0` dengan `min = 20` melanggar itu, apa
pun sebabnya. Yang kedua diperbaiki `rencanaBuatLokalHilang`.

**Yang TIDAK dibangun, dan dinyatakan:** agregasi lintas-tenant beserta ambang
alarmnya. Ia menuntut pembaca ber-`BYPASSRLS` — koneksi kedua, kredensial
kedua, keputusan deployment. Batas yang sama yang sudah tercatat di
`metrik.ts` sejak F6 dimulai. Yang ada sekarang: `GET /devices/{id}/telemetry`
per perangkat, tunduk RLS, siap dipakai B-28.

**Verifikasi Task 14 selesai penuh.** Commit `7b3959a` dibuat saat enam suite
ber-database masih berjalan, dan itu dinyatakan di pesan commit-nya. Hasil
akhirnya, dijalankan berurutan tanpa satu pun proses test lain:

```
typecheck · lint:ds                                   PASS
runtime · domain · sqlite-local · oxlint-ds-adherence PASS
dst · sync-client · kasir · backoffice                PASS
isolation · schema · server · catalog · ordering      PASS
payment · identity · tenancy · dst-server             PASS
```

Tujuh belas suite, nol kegagalan.

⛔ **PostgreSQL mati di tengah putaran pertama** — kesembilan suite ber-database
melaporkan FAIL dengan `ECONNREFUSED`, dan tidak satu pun kegagalan itu tentang
kode. Kalau seluruh suite ber-database merah sekaligus, periksa `pg_isready`
**sebelum** membaca satu pun log kegagalan.

### Task 15 — Staged rollout (F6)

**Selesai sejauh yang dapat dibangun tanpa updater.** Item F6 terakhir yang
bernama. `ARCH:§12` dan KEP-36 menolak dua jalan yang lebih mudah: auto-update
paksa menghentikan outlet di jam makan siang, dan update manual berarti
delapan versi di lapangan setelah setahun.

**⛔ Batas yang dinyatakan sejak awal, bukan ditemukan belakangan:** yang
dibangun adalah **KEPUTUSAN**, bukan **PEMASANGAN**. Mengunduh dan memasang
versi menuntut shell Tauri, dan itu utang F4. Membangun "staged rollout"
sebagai distributor update hari ini akan menjadi fiksi; yang dibangun adalah
separuh yang tidak menuntut perangkat keras, disusun supaya updater yang lahir
kelak tinggal menempel alih-alih memutuskan ulang.

**Keputusan yang diambil:**

- **Kohort per MERCHANT, bukan per perangkat.** Satu outlet dengan tiga kasir
  tidak boleh terbelah dua versi — ketiganya berbagi shift, printer, dan nomor
  struk, dan selisih versi di antara mereka adalah tepat beban multi-versi
  yang KEP-36 ingin hindari, dialami dalam satu ruangan.
- ⛔ **Kohort wajib SUBSET dan di-garam per versi.** Subset karena merchant
  yang keluar dari cakupan saat tahap naik harus TURUN versi, dan rollback
  skema lokal "hampir mustahil". Di-garam karena tanpa itu merchant berkohort
  rendah menjadi kelinci percobaan untuk setiap rilis, selamanya. Diuji
  sebagai property atas 2.000 tenant.
- ⛔ **Jendela update boleh melewati tengah malam.** Outlet yang tutup 02:00
  memilih 23:00–02:00, dan perbandingan naif menjawab "tidak pernah" —
  update yang tidak pernah terpasang terlihat persis seperti tidak ada rilis.
  `mulai = selesai` adalah jendela KOSONG, ditolak CHECK constraint; menafsir-
  kannya 24 jam penuh membuat satu salah ketik mengizinkan update jam makan
  siang.
- ⛔ **Belum-giliran mendahului wajib-segera.** Yang menaikkan tahap adalah
  orang, bukan tingkat kegentingan rilis.
- ⛔ **Gate crash rate MENAHAN saat datanya belum ada.** Gate yang meloloskan
  ketidaktahuan hanya menyala pada rilis yang sudah tidak membutuhkannya.
- ⛔ **Angka crash rate diketik operator, bukan dihitung alat.** Agregasi
  lintas-tenant menuntut pembaca ber-`BYPASSRLS`; `FORCE ROW LEVEL SECURITY`
  berlaku untuk owner juga, jadi bahkan `DATABASE_MIGRATION_URL` tidak dapat
  membacanya. Yang dilakukan `tools/naikkan-tahap.mjs`: menuntut angkanya
  disebutkan, menegakkan aturannya, lalu **menyimpan** angka yang dipakai.
- **Tidak ada endpoint untuk menaikkan tahap.** Seluruh peran di `spec-f`
  adalah peran merchant; endpoint operator menuntut permukaan otentikasi staf
  yang tidak ada di sistem ini. Batas yang dinyatakan, bukan kelalaian.
- **Modul `rilis` lahir untuk satu tabel**, alasan yang sama dengan `sync` dan
  `audit`: keputusannya menunjuk `device` (identity) DAN `outlet`/`tenant`
  (tenancy), dan alternatifnya adalah salah satu meng-query tabel milik yang
  lain.

**Dua hal yang ditemukan test, bukan review:**

| Temuan | Yang menyembunyikannya |
|---|---|
| Guard drift skema menolak dua kolom `outlet` baru | `outlet` raw table; kolom server yang tidak punya padanan lokal harus dinyatakan sebagai keputusan, bukan didiamkan. Keduanya memang berhenti di server — keputusan update menuntut jaringan menurut sifatnya |
| Helper test membaca `outlet` lewat koneksi owner | Gagal dengan `unrecognized configuration parameter "app.tenant_id"` — pesan yang tidak menyebut RLS sama sekali. `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga |

**Alat diverifikasi terhadap database sungguhan**, bukan hanya test: tahap
dinaikkan `kanari → lima`, angka gate tersimpan, dan percobaan kedua langsung
ditahan "belum 24 jam". Penjaga angka runbook diperluas ke ketiganya (jeda 24
jam, 2× penundaan, jendela 03:00–06:00) dan disabotase — `MAKS_TUNDA = 3`
membuatnya merah.

**Verifikasi Task 15 selesai penuh.** Commit `c892b41` dibuat saat tujuh suite
ber-database masih berjalan, dan itu dinyatakan di pesan commit-nya. Hasil
akhirnya, dijalankan berurutan tanpa satu pun proses test lain:

```
typecheck · lint:ds                                   PASS
runtime · domain · sqlite-local · oxlint-ds-adherence PASS
dst · sync-client · kasir · backoffice                PASS
isolation · schema · server · catalog · ordering      PASS
payment · identity · tenancy · dst-server             PASS
```

Tujuh belas suite, nol kegagalan.

### Task 16 — Diskon order + otorisasi step-up (FR-B8 & FR-B9, P0)

**Selesai sisi server dan domain.** P0 yang tertinggal, dan yang paling
mengejutkan tentangnya: **`order_discount` SELALU NOL sebelum ini.** Kolomnya
ada sejak F0, `computeOrderTotals` sudah menghitungnya sejak Modul C — tapi
`POST /orders` menulis nol ke sana. Tidak ada satu pun jalan bagi merchant
untuk memberi diskon, dan tidak ada satu pun test yang merah karenanya.

**Keputusan yang diambil:**

- ⛔ **Ambang diputuskan dari NILAI RUPIAH, bukan dari bentuk yang diketik
  kasir.** `spec-b:273` menulis "> 20% **atau** > Rp 50.000", dan keduanya
  harus berlaku apa pun bentuk masukannya: Rp 60.000 atas Rp 1.000.000 hanya
  6% tapi melewati ambang nominal; 30% atas Rp 10.000 hanya Rp 3.000 tapi
  melewati ambang persen. Memeriksa satu bentuk saja membuat setengah ambang
  tidak pernah menyala — dan yang tidak menyala adalah yang dipakai untuk
  melewatinya.
- ⛔ **Perbandingan persen memakai perkalian silang.** Pembagian bigint
  memotong, dan 20,004% akan terbaca persis 20% lalu lolos.
- ⛔ **403 `APPROVAL_REQUIRED`, bukan 400.** Permintaannya tidak cacat, ia
  hanya belum disetujui. Kasir yang menerima 400 akan mengira ia salah
  memasukkan angka.
- ⛔ **Ambang dihitung dari subtotal SERVER.** Perangkat yang di-root dapat
  mengirim subtotal apa pun; ambang yang dihitung atasnya adalah ambang yang
  dapat dipilih penyerang sendiri.
- ⛔ **Alasan dituntut untuk SETIAP diskon, bukan hanya yang melewati
  ambang**, dan audit ditulis untuk keduanya. Pola diskon kecil yang berulang
  adalah persis yang laporan exception FR-G5 ada untuk menemukannya.
- **Aturan catatan "lainnya" diangkat ke `alasan.ts`.** Ia sebelumnya
  konstanta privat di `cancellation.ts`, dan daftar kelima yang lahir akan
  menyalinnya.
- **`SKALA_TARIF` diekspor dari `numeric.ts`.** Sudah ada DUA salinan (`SCALE`
  dan `RATE_SCALE` di `tax.ts`); menambah yang ketiga untuk diskon akan
  menjadikannya tiga.
- **Ambang turun ke perangkat.** FR-B8 harus bekerja offline: klien yang tidak
  tahu ambangnya akan menerapkan diskon 90% tanpa satu pun PIN, lalu server
  menolaknya berjam-jam kemudian — saat uangnya sudah diterima dan
  pelanggannya sudah pulang. Ia kemunculan KEEMPAT kelas cacat
  `numeric → INTEGER berskala`.

**⛔ Dua test HAMPA yang ditemukan sabotase, bukan review:**

| Yang hampa | Kenapa ia hijau |
|---|---|
| Test saya sendiri: "order berdiskon tidak ditandai selisih" | Ia mengirim total yang COCOK dengan hitungan server, jadi jalur pemeriksaan selisih **tidak pernah berjalan**. Meneruskan diskon `0n` ke `hitungTotalVersiKlien` tidak membuat satu pun test merah |
| Parser DDL PostgreSQL hanya membaca `ADD COLUMN` **pertama** dalam satu pernyataan | Migrasi 0030 menambahkan `outlet.update_window_end_hour` dan `device.update_deferred_version` lewat bentuk itu, dan **keduanya lolos tanpa pernah dibandingkan** dengan skema lokal |

Yang pertama diganti test yang benar-benar menguji aturannya: harga basi
(total klien berbeda) **dan** ada diskon. Itu juga yang mengungkap keputusan
yang belum diambil — **diskon persen di jalur pemeriksaan selisih diturunkan
dari subtotal KLIEN, bukan subtotal server.** Pertanyaannya "apakah total
klien konsisten dengan harga-harganya sendiri", dan perangkat yang harganya
basi menghitung 10% dari 10.000, bukan dari 25.000.

Yang kedua ketahuan hanya karena migrasi 0031 kebetulan menambahkan kolom yang
ADA di skema lokal — arah kesalahan yang berlawanan, dan satu-satunya yang
berteriak. Parsernya diperbaiki; kini ia membaca setiap `ADD COLUMN`.

**Belum digarap, dan dinyatakan:** UI diskon di K-03 dan dialog step-up K-11
(klien). Aturannya sudah di `packages/domain`, jadi klien tinggal
memanggilnya — tapi sampai itu ada, diskon hanya dapat diberikan lewat API.

**Verifikasi Task 16 selesai penuh.** Commit `fc6fde5` dibuat saat enam suite
ber-database masih berjalan. Hasil akhirnya, dijalankan berurutan tanpa satu
pun proses test lain:

```
typecheck · lint:ds                                   PASS
runtime · domain · sqlite-local · oxlint-ds-adherence PASS
dst · sync-client · kasir · backoffice                PASS
isolation · schema · server · catalog · ordering      PASS
payment · identity · tenancy · dst-server             PASS
```

Tujuh belas suite, nol kegagalan. `ordering` yang paling berisiko — seluruh
jalur `POST /orders` disentuh — dan ia hijau tanpa satu pun test lama yang
perlu diubah.

### Task 17 — ⛔ Refund offline TIDAK PERNAH sampai ke server

**Cacat yang sudah hidup di kode ter-merge, ditemukan sambil membaca jalur
diskon — bukan dari test yang merah.**

`POST /orders/{id}/cancel` menuntut `X-Approver-Id` untuk setiap refund.
Relay outbox **tidak pernah mengirim header itu**, dan `outbox_local` tidak
punya kolom untuk menyimpannya. Akibatnya:

```
refund dibuat offline → uang dikembalikan, stok kembali, laci berkurang
                      → relay mengirim → 400 MISSING_APPROVER_ID
                      → gagal-permanen → berhenti di antrean SELAMANYA
```

Server tetap mencatat penjualannya tertutup dengan omzet penuh. Buku merchant
dan buku server berpisah, tanpa satu pun error di mana pun.

**Direproduksi terhadap server sungguhan** lewat `buatPengirimHttp` dan
`klasifikasi` yang asli — bukan disimpulkan dari membaca kode. Yang dipalsukan
hanya `fetch`, dan ia meneruskan ke server.

**⛔ Kenapa 18 test void/refund yang sudah ada tidak menangkapnya:** semuanya
memanggil endpoint LANGSUNG dengan header lengkap — bentuk yang dipakai
back-office, bukan bentuk yang dipakai perangkat kasir. Yang tidak pernah
diuji adalah JALAN MASUKNYA. `buatPengirimHttp` menyusun headernya sendiri,
dan header yang tidak pernah disusunnya tidak dapat hilang dari test yang
menuliskan headernya sendiri.

**Perbaikannya:** penyetuju dibekukan di `outbox_local.approver_id`, persis
seperti `actor_id` — antrean dapat terkuras setelah pergantian shift, dan
manajer yang menyetujui refund sore ini bukan manajer yang sedang masuk besok
pagi. Relay mengirimnya hanya bila barisnya membawanya; header KOSONG ditolak
dengan pesan yang sama persis, jadi mengirimnya selalu hanya memindahkan
kegagalan tanpa memperbaikinya.

**Perangkat yang sudah terpasang** mendapat kolomnya lewat migrasi aditif di
boot berikutnya. Refund yang dibuat SEBELUM itu tidak menyimpan penyetuju di
mana pun dan tidak dapat diperbaiki dari perangkat — jalannya ekspor pemulihan
plus `--penyetuju <id>` pada `tools/pulihkan-antrean.mjs`, yang ditambahkan di
task ini. Ekspor pemulihan kini juga membawa `approverId`.

⛔ **Runbook §1 sempat menjanjikan sesuatu yang alatnya belum bisa lakukan.**
Baris pertama yang saya tulis menyuruh operator "kirim ulang lewat alat, yang
dapat menyebutkan penyetujunya" — dan alat itu belum punya flag-nya. Diperiksa
sebelum di-commit, lalu alatnya yang dibuat benar. Runbook yang salah lebih
berbahaya daripada runbook yang tidak ada.

**Pelajarannya, dan ia sejajar dengan pelajaran F3:** transport yang dipakai
perangkat harus diuji SEBAGAI transport. Test yang memanggil endpoint dengan
header buatan sendiri membuktikan servernya benar; ia tidak dapat membuktikan
kliennya memanggil dengan benar.

**Verifikasi Task 17 selesai penuh.** Commit `4870ca1` dibuat saat tujuh suite
ber-database masih berjalan. Hasil akhirnya:

```
typecheck · lint:ds                                   PASS
runtime · domain · sqlite-local · oxlint-ds-adherence PASS
dst · sync-client · kasir · backoffice                PASS
isolation · schema · server · catalog · ordering      PASS
payment · identity · tenancy · dst-server             PASS
```

Tujuh belas suite, nol kegagalan.

### Task 18 — Aturan transport diterapkan ke SELURUH jenis, dan ia menemukan dua lagi

Task 17 menghasilkan aturan; menulis aturan lalu tidak menerapkannya adalah
setengah pekerjaan. `tests/ordering/relay-transport.test.js` kini mengirim
**setiap** jenis di `RUTE_DIDUKUNG` lewat `buatPengirimHttp` dan `klasifikasi`
yang ASLI, dengan penjaga dua arah: jenis yang ditambahkan besok tanpa test
transport membuatnya merah.

**Dua cacat lagi, kelas yang sama, keduanya di kode ter-merge:**

| Cacat | Akibatnya |
|---|---|
| `no_sale` tidak membawa penyetuju di baris outbox | Pembukaan laci KEEMPAT dan seterusnya yang dilakukan offline dijawab `403` dan berhenti permanen. Laci sudah terbuka, PIN manajer sudah dimasukkan, servernya tidak pernah tahu |
| ⛔ `POST /shifts/{id}/no-sale` **tidak pernah ada di `RUTE_TERBUKA`** | **SETIAP** no-sale offline dijawab `401 SESSION_INVALID` — bahkan yang pertama, yang tidak menuntut PIN sama sekali. Relay tidak pernah punya sesi back-office |

Yang kedua lebih luas daripada yang pertama dan tidak ada hubungannya dengan
penyetuju: rutenya cuma tidak pernah didaftarkan sebagai jalur perangkat.
K-16 tercatat "selesai" di `CLAUDE.md` sejak 21 Agustus, dan jalur relay-nya
tidak pernah berfungsi sama sekali.

**Yang menemukan keduanya adalah penjaga, bukan pembacaan kode.** Saya menulis
test untuk enam jenis dengan harapan semuanya hijau; empat merah, dua di
antaranya karena kesalahan test saya sendiri (`soldOut` vs `isSoldOut`,
`tukar_uang_kecil` vs `tukar_uang`) dan dua karena cacat sungguhan. Itu
perbandingan yang sehat: penjaga yang hanya menemukan kesalahan penulisnya
sendiri tidak menjaga apa pun.

**Sabotase diverifikasi:** melepas `/shifts/:shiftId/no-sale` dari
`RUTE_TERBUKA` → 3 merah.

### Task 18b — ⛔ Membuka rute perangkat MENGEMBALIKAN kepercayaan pada `X-Actor-Id`

**Regresi yang saya buat sendiri di Task 18, ditangkap suite `server`.**
Menambahkan `/shifts/{id}/no-sale` ke `RUTE_TERBUKA` membuat test "AKUNTAN
ditolak" berubah dari **403 menjadi 201**.

Sebabnya struktural, bukan salah ketik: rute yang sepenuhnya terbuka membuat
penjaga sesi TIDAK BERJALAN, jadi `req.sesi` tidak pernah terisi dan
`getActorId` kembali memakai header. Akuntan yang login di back-office dapat
memanggil rute perangkat **atas nama siapa pun** — dan kontrol peran
`spec-f:82` menguap tanpa satu pun error.

⛔ **Dan itu sudah berlaku untuk empat rute perangkat lain sejak lama**
(`/shifts`, `/orders`, `/orders/{id}/cancel`, `/orders/{id}/payments`). Yang
membuatnya tidak terlihat: tidak satu pun dari keempatnya punya aturan peran
di `rbac-rute.ts`, jadi tidak ada test yang dapat berubah warna.

**Perbaikannya `sesiOpsional`:** sesi TIDAK dituntut, tapi DITEGAKKAN bila
pemanggil membawanya.

- Relay outbox tidak mengirim `Authorization` sama sekali → lewat apa adanya,
  jalur naik tidak tersentuh.
- Yang membawa Bearer diverifikasi, dan Bearer yang tidak sah ditolak `401`
  alih-alih diabaikan.
- ⛔ TIDAK dipasang pada rute berkredensial PERANGKAT (`sync-token`,
  `telemetry`, `update`): Bearer di sana adalah secret perangkat, dan
  memverifikasinya sebagai sesi menolak perangkat yang sah — seluruh armada
  berhenti sinkron setelah satu perubahan middleware.

**Cacat kedua di perbaikan pertama saya:** pencarian rute di hook tidak
menormalkan `HEAD` → `GET` seperti `ruteTerbuka`, jadi `HEAD /health` tidak
cocok entri mana pun lalu dituntut sesi. Probe kesehatan dijawab 401, dan yang
membacanya menyimpulkan server mati. Ditemukan dengan membaca ulang perubahan
sendiri, bukan oleh test.

**Test yang saya tulis lalu HAPUS:** "sesi menang atas `X-Actor-Id` di jalur
perangkat", diarahkan ke `POST /shifts`. Rute itu tidak punya aturan peran
sama sekali, jadi test itu akan menyatakan penolakan yang tidak pernah
dilakukan siapa pun — hijau atau merah karena alasan yang tidak berhubungan.
Yang benar-benar menjaga sifat itu adalah `tests/server/no-sale.test.js`, dan
ia sudah ada.

**Tiga test yang hijau karena alasan yang salah, terungkap `sesiOpsional`.**

`shifts.test.js` (dua) dan `void.test.js` (satu) menguji atribusi lewat
`X-Actor-Id` — aktor lintas tenant ditolak 404, header hilang ditolak 400 —
tetapi mengirim **sesi DAN header** sekaligus. Keduanya hijau hanya selama
rute perangkat sepenuhnya terbuka dan sesinya diabaikan.

Begitu sesi yang dibawa ditegakkan, `getActorId` memakai pemilik sesi dan
headernya tidak berarti apa-apa: guard lintas-tenant (temuan F1) tidak pernah
disentuh, dan test yang mengaku mengujinya sebenarnya menguji jalur yang
selalu sah.

⛔ Ini kelas yang PERSIS sama dengan yang `CLAUDE.md` catat pada "akuntan
ditolak" — dan ia masih hidup di tiga tempat lain tanpa ada yang tahu.
Perbaikannya membuat test lebih setia, bukan kurang: relay tidak pernah
mengirim `Authorization`, jadi test atribusi header pun tidak boleh
mengirimnya.

---

### Task 19 — Diskon di layar kasir: K-03 + K-11 (FR-B8, separuh klien)

Task 16 menutup server dan domain; FR-B8 tetap **tidak dapat dicapai
merchant** — satu-satunya jalan memberi diskon adalah memanggil REST langsung.
Yang di sini adalah separuh yang membuatnya nyata: dialog K-03, rantai ke
K-11, baris diskon di keranjang, di layar bayar, dan **di struk**.

**Yang dibangun:**

| Berkas | Isi |
|---|---|
| `packages/domain/src/diskon.ts` | `parseNilaiDiskon` · `formatPersenDiskon` |
| `apps/kasir/src/kasir/diskon.ts` | `bacaAmbangDiskon` · `statusDiskon` · `LABEL_ALASAN_DISKON` |
| `apps/kasir/src/komponen/DialogDiskon.tsx` | K-03 diskon → K-11 otorisasi |
| `Kasir.tsx` · `Pembayaran.tsx` | baris diskon, peringatan, penolakan yang menjelaskan |

**Keputusan yang diambil:**

- ⛔ **Persetujuan berlaku untuk ANGKA yang manajer lihat, bukan untuk
  persentasenya.** Ini cacat yang saya temukan saat menulis alurnya, bukan
  dari spec: manajer menyetujui 30% dari Rp 100.000 — Rp 30.000 — lalu kasir
  menambahkan barang senilai Rp 900.000 dan potongannya menjadi Rp 300.000
  dengan persetujuan yang sama. Persetujuan yang menempel pada persen adalah
  cek kosong. `DiskonKeranjang.nominalDisetujui` membekukan angkanya; potongan
  yang tumbuh melewatinya menuntut persetujuan baru, yang **mengecil** tidak
  (meminta PIN untuk potongan yang lebih kecil hanya melatih manajer mengetik
  tanpa membaca).
- ⛔ **`approverId` tanpa `nominalDisetujui` TIDAK menutup apa pun.** Bentuk
  yang lahir dari kode lama atau jalur yang lupa mengisinya; menganggapnya
  tertutup berarti satu field yang hilang mematikan aturannya diam-diam.
- ⛔ **Satu fungsi untuk layar dan untuk jalur penulisan** (`statusDiskon`).
  K-03 memakainya untuk memberi tahu kasir sebelum ia menekan Bayar;
  `simpanPenjualan` memakainya untuk menolak. Dua salinan akan menyimpang, dan
  yang menyimpang menghasilkan layar yang berkata "siap" pada penjualan yang
  ditolak sendiri.
- ⛔ **Struk mencetak diskonnya — sebelumnya `diskon: 0` dipaku di
  `penjualan.ts`.** `computeOrderTotals` TIDAK mengurangi `subtotal`, jadi
  struk mencetak Subtotal 20.000 lalu TOTAL 20.900 dengan potongan 1.000 yang
  tidak muncul di mana pun. Selisih tak terjelaskan di struk adalah keluhan
  yang berakhir di kasir.
- ⛔ **Angka dikosongkan saat bentuk diskon berubah.** "50" yang berarti Rp 50
  menjadi 50% begitu radio ditekan — potongan ribuan kali lipat dari satu
  ketukan yang tidak terlihat mengubah apa pun.
- ⛔ **Digit desimal persen DITURUNKAN dari skalanya, bukan dipilih.** "15%"
  adalah rate 0,15 dan berskala 10.000 ia 1500, jadi angka persennya berskala
  `SKALA_TARIF / 100` — tepat dua digit. Digit ketiga adalah angka yang tidak
  dapat disimpan; menerimanya berarti memotongnya diam-diam.
- **Koma DAN titik diterima.** Kasir mengetik "12,5"; papan ketik numerik
  perangkat mengetik "12.5". Menolak salah satunya berarti separuh perangkat
  tidak dapat memberi diskon pecahan sama sekali. "12," di tengah pengetikan
  dibaca 12%, bukan ditolak.
- **Nominal TIDAK menerima desimal** — uang di sistem ini rupiah utuh, dan
  "5000,50" yang diterima lalu dipotong adalah potongan yang berbeda dari yang
  diketik.
- **Alasan dikumpulkan di `DialogDiskon`, `DialogOtorisasi` dipanggil TANPA
  `daftarAlasan`.** Pelajaran yang sama dengan K-10: meminta manajer mengulang
  pilihan kasir membuang waktu di antrean dan membuang pilihan pertamanya.
- ⛔ **Pemindai global dimatikan saat dialog terbuka.** Kolom teksnya sudah
  diabaikan `usePemindaiGlobal`, tapi fokus yang berada di radio button TIDAK
  — dan scan di sana menambahkan produk ke keranjang di BELAKANG dialog,
  perubahan yang tidak terlihat siapa pun sampai struk tercetak. Berlaku juga
  untuk `DialogNoSale`, yang punya lubang yang sama.
- **`MIN_CATATAN` ketiga dihapus.** `identitas/otorisasi.ts` memegang salinan
  ketiga angka 10 dan menghitungnya per unit UTF-16; kini `catatanCukup` dari
  `alasan.ts`, yang menghitung per titik kode.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 371 · `test:kasir` 370
(+11 berkas baru `tests/kasir/diskon.test.js`) · `test:sync-client` 102 ·
`test:sqlite-local` · `test:runtime` · `test:oxlint-ds-adherence` ·
`test:backoffice` 370 · `test:ordering` 178 · `apps/kasir` build.

**Sabotase yang membuktikan test-nya tidak hampa:** perbandingan
`nominal <= nominalDisetujui` diganti `true` → 1 merah; `diskon: Number(...)`
dikembalikan ke `0` di jalur struk → 1 merah.

**Batas yang dinyatakan:** diskon **per baris** tidak dibangun — `spec-b:267`
menyebut keduanya, dan `order_line.discount_amount` ada di skema, tapi jalur
server (`POST /orders`) hanya menerima diskon tingkat order. Membangun
setengahnya di klien berarti angka yang tidak dapat dikirim ke mana pun.

---

### Task 20 — FR-A3: aturan pemilihan modifier di kasir

`max_selections` dan `allow_duplicate` ada di skema sejak F0, turun ke
perangkat, dan dibaca `bacaModifier` — lalu **diabaikan**. Kasir dapat memilih
enam topping pada list bermaksimal tiga, dan pesanannya tersimpan: barista
tidak dapat membuatnya, dan tidak ada satu pun error di jalan.

**Yang dibangun:**

| Berkas | Isi |
|---|---|
| `packages/domain/src/modifier-pilihan.ts` | aturan murni: `bolehTambah` · `tambah/kurang/toggle` · `kurangnya` · `pesanKurang` |
| `apps/kasir/src/komponen/DialogModifier.tsx` | K-04/K-05, dipindah keluar dari `Kasir.tsx` |
| `keranjang.ts` · `penjualan.ts` · `dokumen.ts` · `ulang.ts` · `riwayat/baca.ts` | kuantitas modifier mengalir sampai struk dan riwayat |

**Keputusan yang diambil:**

- ⛔ **Aturannya di DOMAIN, bukan di komponen React.** `spec-a:117` menulis
  tabelnya sebagai "perilaku di layar kasir" dan itu benar, tapi aturannya
  bukan tata letak: `max_selections = 3` yang dilanggar menghasilkan
  `order_line_modifier` yang tidak dapat dibuat barista. Yang hanya dapat
  diuji lewat DOM biasanya tidak diuji sama sekali.
- ⛔ **Batas menghitung UNIT, bukan baris.** `Extra Shot ×2` dihitung dua.
  Menghitung baris membuat `max_selections = 3` meloloskan enam shot lewat
  tiga baris ber-qty 2. `[ASUMSI]` — `spec-a` tidak menyatakan interaksi
  `max_selections` dengan `allow_duplicate`.
- ⛔ **`is_required` dan `min_selections` adalah SATU pertanyaan**, dan yang
  berlaku yang lebih besar. Dua sumber untuk satu pertanyaan menghasilkan
  dialog yang menolak karena alasan yang tidak ditampilkannya.
- ⛔ **Kuantitas modifier masuk SIDIK JARI keranjang.** Tanpa itu "Extra Shot
  ×1" dan "Extra Shot ×2" digabung jadi satu baris: pelanggan kedua menerima
  kopi pelanggan pertama, dan totalnya salah tanpa error.
- ⛔ **`satuanKeranjang` menggantikan penjumlahan kedua di `Kasir.tsx`.**
  Salinan yang ada sebelumnya mengabaikan kuantitas modifier, jadi baris
  keranjang menagih satu shot sementara subtotal di bawahnya menagih dua —
  dua angka di layar yang sama.
- ⛔ **Snapshot modifier lokal kini `[{nama, qtyMilli}]`, dan parsernya
  menerima KEDUA bentuk.** Baris lama ada di perangkat merchant dan tidak
  dapat ditulis ulang — `order_line` tidak pernah di-`UPDATE` (invariant #2).
- **Kuantitas nol MENGHAPUS kuncinya.** Kunci ber-nilai nol terkirim sebagai
  `order_line_modifier` ber-qty 0 — baris yang mengaku ada, tidak menambah apa
  pun, dan tetap tercetak.
- **`ModifierTerpilih` terpisah dari `ModifierPilihan` katalog.** `bawaan`
  adalah sifat katalog, `qtyMilli` sifat pilihan; satu tipe untuk keduanya
  membuat `bawaan` ikut tersimpan ke keranjang dan terkirim ke server.

**Cacat kedua yang ikut ditemukan:** **cetak ulang juga memaku `diskon: 0`** —
bentuk yang sama dengan yang Task 19 perbaiki di cetakan pertama, di berkas
lain. Diperbaiki bersamaan; `spec-b:145` menuntut cetak ulang identik dengan
cetakan pertama, dan dua tempat yang memutuskan isi struk sudah menyimpang.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 382 · `test:kasir` 377
· `test:ordering` 178 · `test:backoffice` 370 · `test:sync-client` 102 ·
`test:sqlite-local` · build kasir.

**Sabotase:** `jumlahUnit` diubah menghitung baris → 2 merah; kuantitas
dilepas dari sidik jari keranjang → 1 merah.

**Batas yang dinyatakan:** server **tidak** menegakkan aturan ini —
`POST /orders` menerima modifier apa adanya. Menegakkannya di sana menuntut
server membaca `modifier_list` pada setiap penjualan, dan aturannya dapat
berubah setelah order antre offline berjam-jam. `modifier-pilihan.ts` duduk di
tempat yang benar bila keputusan itu berubah.

---

### Task 21 — K-06 menerima QRIS statis dan EDC (FR-C2, FR-C4)

Server menerima keempat metode sejak Modul C sub-project 2. Yang tidak ada
adalah jalan bagi **kasir** memakainya: `MetodeBayar` di klien secara harfiah
`'cash'`. Merchant yang pelanggannya membayar QRIS harus mencatatnya sebagai
tunai — dan saldo laci lalu berbohong sebesar seluruh omzet QRIS, setiap hari,
tanpa satu pun error.

**Keputusan yang diambil:**

- ⛔ **Aturan validasi diangkat ke `packages/domain/src/pembayaran-manual.ts`,
  dan SERVER memakainya juga.** QRIS statis dan EDC berfungsi offline; aturan
  yang hanya hidup di server berarti kasir mengetik referensi kosong, layar
  menerimanya, penjualan tersimpan, dan barisnya berhenti `gagal-permanen` di
  antrean berjam-jam kemudian. Bentuk cacat yang sama dengan refund offline —
  berkas itu ada supaya ia tidak terjadi untuk ketiga kalinya.
- ⛔ **Kode galat ikut dikembalikan, bukan hanya pesannya.**
  `POSSIBLE_CARD_NUMBER` berbeda dari `VALIDATION_ERROR`, dan menyamakannya
  membuang satu-satunya sinyal bahwa seseorang mengetik nomor kartu ke POS.
- ⛔ **Non-tunai TIDAK menulis `cash_movement`.** Laci yang naik pada setiap
  penjualan QRIS membuat tutup kas menuntut otorisasi manajer untuk selisih
  yang tidak pernah ada — cacat yang PERSIS sama bentuknya dengan yang F3
  temukan pada refund tunai, arahnya terbalik.
- ⛔ **Pembulatan tunai berhenti tanpa syarat.** Sebelum ini metode hanya ada
  satu, jadi membulatkan selalu kebetulan benar. QRIS memindahkan angka, bukan
  lembaran: tidak ada pecahan yang tidak beredar, dan membulatkannya menagih
  pelanggan beberapa rupiah lebih lewat saluran yang mencatat nominalnya
  persis.
- ⛔ **`tendered_amount` dan `change_amount` NULL untuk non-tunai.**
  Mengisinya sama dengan `amount` membuat laporan tidak dapat membedakan uang
  yang benar-benar diserahkan dari nominal transaksi, dan `spec-d:201` memakai
  perbedaan itu.
- ⛔ **`confirmed_manually` hanya untuk QRIS statis.** EDC punya kode approval
  dari acquirer — bukti yang dapat dicocokkan; QRIS statis tidak punya apa pun
  selain kalimat kasir.
- ⛔ **Muatan outbox berbeda PER METODE.** Kartu yang membawa `tenderedAmount`
  terlihat seperti tunai di setiap laporan yang membacanya.
- ⛔ **`cardLast4` dipotong di titik MASUKNYA**, bukan hanya ditolak saat
  simpan. Membiarkan digit kelima masuk state berarti nomor kartu sempat ada
  di dalam aplikasi, dan larangannya permanen.
- **`LABEL_METODE` satu sumber** (`cetak/metode.ts`). Versi pertama saya
  menulis peta kedua di `penjualan.ts` dengan "Kartu (EDC)" sementara
  `ulang.ts` menulis "Kartu" — cetak ulang akan menyebut metode berbeda dari
  cetakan pertama, tepat yang `spec-b:145` larang. Ditemukan dengan membaca
  peta yang sudah ada sebelum menulis yang baru.

**Test transport, sesuai aturan 21 Agustus:**
`tests/payment/pembayaran-offline-relay.test.js` memakai `buatPengirimHttp`
dan `klasifikasi` ASLI, dan **muatannya benar-benar disusun
`simpanPenjualan`** — bukan ditulis tangan di test. Sabotase: `reference`
dilepas dari muatan klien → `400`, 2 merah.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 382 · `test:kasir` 387
· `test:payment` 130 · `test:ordering` 178 · `test:server` 295 ·
`test:backoffice` 370 · `test:sync-client` 102 · `test:sqlite-local` ·
`test:runtime` · `test:oxlint-ds-adherence` · build kasir.

**Batas yang dinyatakan:**

| Batas | Kenapa |
|---|---|
| QRIS **dinamis** tidak dibangun di kasir | Ia menuntut gateway menjawab sebelum lunas (`spec-c:320`), jadi ordernya harus sudah ada di server — sementara jalur penjualan perangkat menulis lokal lebih dulu lalu me-relay. Membangunnya menuntut jalur penjualan **online-first** yang belum ada |
| **FR-C3** tetap terbuka | "Nonaktifkan metode online saat offline" menuntut metode online ADA lebih dulu. Ketiga metode yang kini ada semuanya berfungsi tanpa jaringan |
| Pembayaran campuran | Satu penjualan = satu payment di jalur perangkat. Server sudah mendukung sisa tagihan (`outstanding`); layarnya belum |
| Verifikasi browser | **Belum dijalankan** untuk pemilih metode dan kedua form |

---

### Task 22 — Pembayaran campuran di perangkat (FR-C1, P0)

*"Pembayaran campuran (tunai + QRIS) adalah alur harian di kafe Indonesia,
bukan edge case"* (`spec-c:197`). Server sudah mendukungnya sejak Modul C;
jalur perangkat hanya pernah menulis **satu** payment.

**Keputusan yang diambil:**

- ⛔ **Yang dibulatkan adalah SISA TUNAI setelah bagian non-tunai**
  (`spec-c:181`), bukan totalnya. Diukur di test: total 93.555 dengan QRIS
  50.020 menagih tunai 43.500, sementara membulatkan total lebih dulu menagih
  43.580 — **80 rupiah per transaksi**, besaran yang tidak pernah dilaporkan
  siapa pun tapi muncul di rekonsiliasi. Aturannya di
  `packages/domain/src/pembayaran-campuran.ts`, dan itu sebabnya ia menerima
  seluruh bagian sekaligus: menghitung per bagian berarti membulatkan sisa
  yang belum lengkap.
- ⛔ **Bagian TUNAI dikirim TERAKHIR, dan rantainya `depends_on` eksplisit.**
  Server menghitung nominal tunai dari `total − SUM(confirmed)` lalu
  membulatkannya — bagian tunai yang mendarat lebih dulu menagih SELURUH total
  dan menutup ordernya, lalu bagian QRIS berikutnya **ditolak**. Penjualannya
  sempurna; yang salah hanya urutan kedatangannya. Dibuktikan lewat test
  sabotase yang membalik urutannya terhadap server sungguhan: bagian kedua
  ditolak, dan laci menerima seluruh total sementara pelanggan membayar
  sebagian lewat QRIS.
- ⛔ **`delta` laci adalah BAGIAN TUNAI-nya, bukan `amount_due`.** Pada
  pembayaran campuran, `amount_due` memuat uang yang masuk lewat bank;
  mencatatnya sebagai movement membuat kasir terlihat KELEBIHAN sebesar bagian
  non-tunai — bentuk ketiga dari cacat yang sama yang F3 temukan.
- ⛔ **Satu baris payment per bagian.** Menggabungkan dua metode menjadi satu
  baris membuat rekonsiliasi FR-C12 tidak dapat memisahkan uang yang masuk
  lewat bank dari uang di laci — dua saluran yang settlement-nya berbeda hari.
- ⛔ **Kelebihan bayar non-tunai DITOLAK dengan angkanya** (`spec-c:225`).
  Tidak ada mekanisme mengembalikan kembalian non-tunai: QRIS yang kelebihan
  Rp 10.000 berarti merchant berutang lewat saluran yang tidak dapat
  mengembalikannya, dan yang mengetahuinya hanya pelanggan.
- ⛔ **Hanya SATU bagian tunai.** Dua baris tunai tidak menambah informasi apa
  pun — uang tunai tidak punya identitas yang membedakan — sementara "berapa
  kembaliannya" jadi punya lebih dari satu jawaban yang sama benarnya.
- ⛔ **`hitungKeranjang` diekstrak, dan LAYAR memakainya.** K-06 harus
  menampilkan TOTAL sebelum kasir membaginya, dan subtotal tidak cukup: ia
  belum kena pajak. Menghitungnya sendiri di layar berarti kasir membagi angka
  yang berbeda dari angka yang tersimpan.
- **Penjualan tetap ditulis hanya saat LUNAS.** Order `open` yang tidak pernah
  dibayar akan muncul di laporan dan belum punya jalan penutupan (KEP-21,
  belum dibangun). Batas yang dinyatakan, bukan kelalaian.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 394 · `test:kasir` 393
· `test:payment` 132 · `test:ordering` 178 · `test:dst` 14 ·
`test:backoffice` 370 · `test:sync-client` 102 · `test:sqlite-local` ·
`test:runtime` · `test:oxlint-ds-adherence` · build kasir.

**Sabotase:** laci diberi `amount_due` → 1 merah; tunai tidak diurutkan
terakhir → 1 merah di suite klien dan 1 merah di suite relay.

---

### Task 23 — FR-H4: blokir operasi destruktif (P0)

`spec-h:270` — *"Lumi POS menegakkannya **secara teknis**, bukan lewat
dokumentasi."* Dari empat operasi, hanya **logout** yang benar-benar diblokir.
Layar Perangkat menerima perubahan `tenantId`/`outletId`/`deviceId` tanpa
memeriksa antrean sama sekali: penjualan yang antre akan dikirim atas nama
outlet yang salah, atau ditolak permanen begitu tenant-nya berubah.

**Keputusan yang diambil:**

- ⛔ **Yang TIDAK diblokir adalah bagian terpenting aturannya.** Alamat server
  dan kredensial perangkat tidak pernah diblokir: keduanya adalah jalan
  MEMPERBAIKI antrean yang macet. Server yang pindah alamat atau kredensial
  yang kedaluwarsa menghasilkan antrean yang tidak dapat terkuras, dan
  memblokir perbaikannya karena antreannya tidak kosong adalah kunci yang
  tidak punya kunci pembuka. `deviceCode` juga lolos — ia hanya prefiks nomor
  struk, dan memasukkannya membuat merchant yang memperbaiki salah ketik
  "K1" → "K2" terkunci sampai antreannya kosong.
- ⛔ **Daftar operasi gagal-TERTUTUP.** Operasi tak dikenal ditolak, bukan
  diizinkan; daftar tertutup yang gagal-terbuka membuat operasi destruktif
  berikutnya lolos tanpa ada yang menyadarinya.
- ⛔ **`resync` dan `hapus_data` masuk daftar SEKARANG**, meski belum punya
  tombol di mana pun. Aturan yang ditulis bersamaan dengan tombolnya adalah
  aturan yang ditulis oleh orang yang sedang terburu-buru membuat tombolnya
  jalan. Ada penjaga yang menandai bila keduanya mulai punya pemanggil.
- **`bolehLogout` kini pembungkus tipis** atas `periksaOperasiDestruktif`.
  Pesannya sebelumnya ditulis sendiri di `login.ts`, dan operasi kedua yang
  lahir akan menyalinnya — dua salinan menghasilkan dua kalimat berbeda untuk
  keadaan yang sama, dan yang satu akan lupa menyebut jumlahnya.

**Masalah yang saya buat sendiri, dan bagaimana ketahuannya:**

Versi pertama menaruh blokirnya **di dalam `Perangkat.tsx`**, dijaga penjaga
struktural yang memindai kode dan menuntut berkas penulis `device_config`
menyebut `periksaOperasiDestruktif`. Sabotase membuktikan penjaga itu
**lolos**: saya hapus pemanggilnya, import-nya tertinggal, dan testnya tetap
hijau. Pemeriksaan yang dapat dipalsukan oleh satu baris import bukan
pemeriksaan.

Perbaikannya bukan menajamkan regex melainkan memindahkan aturannya:
`apps/kasir/src/perangkat/simpan-identitas.ts`, bentuk yang sama dengan
`keluar()` di `konteks/useSesi.ts` — satu fungsi yang membaca antrean tepat
sebelum menulis, dan **dapat dijalankan test**. Penjaganya lalu diubah dari
"setiap penulis memeriksa" menjadi "hanya ADA SATU penulis", yang tidak dapat
dipalsukan import.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 405 · `test:kasir` 405
· `test:sync-client` 102 · `test:backoffice` 370 ·
`test:oxlint-ds-adherence` · build kasir.

**Sabotase:** `identitasBerubah` dimatikan → 2 merah; `gagal` tidak ikut
dihitung → 1 merah; pesan blokir disalin ke layar → 1 merah.

**Batas yang dinyatakan:** `resync` dan `hapus_data` belum punya jalur di
aplikasi sama sekali — tidak ada tombol yang memuat ulang data atau menghapus
database dari dalam. Aturannya sudah ada dan diuji; yang belum ada adalah
operasinya. `uninstall` tidak dapat dicegah aplikasi mana pun (`spec-h:280`),
dan mitigasinya — ekspor darurat — sudah ada di K-14.

---

### Task 24 — Feature flag & kill switch (`ARCH:358`)

*"Kill switch: per fitur per merchant, dari server tanpa rilis — **kebutuhan
operasional, bukan kemewahan**."* Satu-satunya baris `ARCH:§12` yang belum
punya kode sama sekali.

**Rantainya:** `tools/kill-switch.mjs` → `feature_flag` (migrasi `0032`) →
`GET /devices/{id}/features` → `fitur_lokal` → layar kasir.

**Keputusan yang diambil:**

- ⛔ **Tabel menyimpan PENYIMPANGAN saja; bawaannya hidup di
  `packages/domain/src/fitur.ts`.** Pola yang sama dengan ambang diskon dan
  jendela update: kolom ber-`DEFAULT` membuat perubahan bawaan hanya berlaku
  untuk baris yang dibuat sesudahnya. Konsekuensinya tabel ini akan tetap
  hampir kosong, dan itu benar.
- ⛔ **`tenant_id IS NULL` = penyimpangan GLOBAL, dan baris tenant MENANG
  atasnya.** "Matikan untuk semua kecuali yang sudah kami periksa" adalah
  bentuk pemulihan insiden yang paling sering dipakai; urutan yang terbalik
  membuatnya mustahil.
- ⛔ **DUA index unik parsial, bukan satu.** PostgreSQL memperlakukan NULL
  sebagai tidak-sama-dengan-NULL, jadi `UNIQUE (key, tenant_id)` tunggal
  mengizinkan dua baris global untuk fitur yang sama — dan "mana yang berlaku"
  lalu tidak punya jawaban.
- ⛔ **Kunci ASING dibaca MATI, di kedua sisi.** Baris yang tertinggal untuk
  fitur yang sudah dihapus dari kode tidak boleh menyalakan apa pun, dan
  salah ketik di alat operator harus terlihat sebagai fitur yang tidak
  menyala.
- ⛔ **Tabelnya DIKECUALIKAN dari RLS**, sejajar `app_release`: alat operator
  memakai `DATABASE_MIGRATION_URL`, dan `FORCE ROW LEVEL SECURITY` berlaku
  untuk owner juga — tabel ber-RLS tidak dapat ditulis lintas tenant sama
  sekali (pelajaran backfill `refund.method`). Konsekuensinya dinyatakan, dan
  dijaga dua penjaga: hanya SATU query di server yang menyentuh tabelnya, dan
  query itu menyaring tenant.
- ⛔ **Respons berisi BOOLEAN per fitur, bukan barisnya.** Mengirim barisnya
  berarti mengirim `tenant_id` merchant lain — dan `reason` sebuah kill switch
  biasanya menyebut dugaan fraud, yang menghapus gunanya bila dibaca pihak
  yang sedang diselidiki.
- ⛔ **`fitur_lokal` murni lokal, SENGAJA bukan raw table.** Menambah raw
  table mengubah sidik jari skema lokal, dan itu menuntut
  `disconnectAndClear()` + unduh ulang katalog di setiap perangkat merchant —
  biaya nyata untuk tiga boolean yang muat dalam satu permintaan HTTP.
- ⛔ **Dua fallback yang arahnya BERLAWANAN, keduanya disengaja:** fitur tanpa
  baris mengikuti bawaan kode (menyala) supaya perangkat baru tetap dapat
  berjualan; fitur yang punya baris bertahan **tanpa kedaluwarsa** supaya kill
  switch tetap berlaku pada perangkat yang mencabut internetnya.
- ⛔ **Kegagalan menyegarkan MEMPERTAHANKAN keadaan lama.** Respons yang tidak
  sampai bukan "tidak ada flag" — ia "belum tahu". Menulis apa pun atas
  kegagalan berarti flag yang dimatikan operator menyala kembali setiap kali
  internet merchant terputus. Bentuk respons yang tidak dikenali juga dibaca
  gagal, bukan "tidak ada fitur".
- ⛔ **Nilai non-boolean DIABAIKAN, tidak dikoersi.** `"false"` yang dikoersi
  menjadi `true` adalah kill switch yang menyala terbalik tanpa satu pun
  error.
- ⛔ **`--alasan` wajib saat mematikan.** Kill switch dinyalakan saat insiden
  dan dilupakan sesudahnya; baris tanpa alasan adalah fitur yang mati
  berbulan-bulan tanpa ada yang tahu kenapa.
- ⛔ **Tidak ada flag yang menyentuh AUDIT** (`spec-f:369`) maupun yang dapat
  **menghentikan penjualan** — kill switch yang dapat menghentikan penjualan
  adalah SEV-1 yang dipicu sendiri. Keduanya dijaga test atas daftar tertutup,
  karena kunci berikutnya akan ditambahkan oleh orang yang sedang menangani
  insiden.
- **Tombol yang fiturnya mati HILANG, bukan dinonaktifkan.** Tombol mati yang
  tetap terlihat mengundang kasir menekannya berulang lalu menelepon support.
  Yang menegakkannya tetap jalur penulisan — layar tidak pernah jadi
  satu-satunya penjaga.

**Tiga fitur pertama, dan alasan masing-masing dipilih:**
`pembayaran_qris_statis` (satu-satunya metode digital yang tidak diverifikasi
sistem mana pun), `diskon_kasir` (permukaan fraud FR-B8), `buka_laci_no_sale`
(`spec-d:229` menyebutnya pola fraud paling dasar).

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 416 · `test:kasir` 418
· `test:identity` 142 · `test:isolation` 211 · `test:schema` 14 ·
`test:server` 295 · `test:catalog` 177 · `test:ordering` 178 ·
`test:payment` 132 · `test:tenancy` 75 · `test:backoffice` 370 ·
`test:sync-client` 102 · `test:sqlite-local` · `test:runtime` ·
`test:oxlint-ds-adherence` · build kasir. Alat operator dijalankan sungguhan
terhadap database (`--daftar`, `--status`, `--kering`, penolakan tanpa alasan).

**Sabotase:** klausa `WHERE tenant_id IS NULL OR tenant_id = $1` dilepas → 6
merah, termasuk "penyimpangan merchant LAIN tidak pernah ikut".

**Batas yang dinyatakan:** kill switch tidak dapat mendahului perangkat yang
**belum pernah** terhubung sama sekali — perangkat itu memakai bawaan kode,
yaitu menyala. Tercatat di runbook §13.5.

---

### Task 25 — FR-F8: deteksi manipulasi jam + laporan X8

**Audit status yang mendahului task ini.** Saya menghitung 74 FR dari
`product/specs/*.md` lalu meng-grep repo untuk masing-masing. Hasilnya
menemukan tiga hal:

- `CLAUDE.md` **basi** untuk FR-A8 (impor katalog — sudah ada domain, endpoint,
  DAN layar B-11) dan FR-B11 (cetak ulang — sudah ada di K-09). Keduanya
  ditandai "belum digarap"; keduanya sudah selesai. Diperbaiki.
- **FR-F8 [P0] benar-benar kosong**: nol kemunculan `clock_drift_detected` di
  seluruh repo. Yang ada hanya `onSkew` telemetri, yang mengukur selisih di
  KLIEN dan tidak menghasilkan audit event apa pun.
- **Tujuh dari delapan laporan exception FR-G5 belum ada** — hanya X1 yang
  dibangun. X8 adalah pasangan pembaca FR-F8, jadi keduanya dikerjakan
  bersama.

**Keputusan yang diambil:**

- ⛔ **Yang dibandingkan JAM SEKARANG, bukan `occurred_at`.** `spec-f:346`
  menyatakannya langsung: transaksi ber-`occurred_at` 1,5 jam lebih tua adalah
  durasi offline yang WAJAR, dan seluruh produk ini dibangun supaya durasi itu
  ada. Deteksi yang membandingkan `occurred_at` dengan `recorded_at` menandai
  setiap penjualan offline — yaitu justru penjualan yang paling penting. Yang
  tidak dapat dijelaskan apa pun adalah dua jam yang sama-sama mengaku
  "sekarang" tapi berbeda.
- ⛔ **Header `X-Device-Time` dikirim `buatPengirimHttp`, dan jamnya
  DI-INJECT.** Deteksi manipulasi jam yang jamnya tidak dapat dipalsukan test
  tidak dapat diuji sama sekali.
- ⛔ **Header yang HILANG bukan anomali**, dan header yang CACAT juga bukan —
  dua keputusan yang berbeda. Klien versi N-1 tidak mengirimnya (`ARCH`:
  versi lama hidup minimal 12 bulan), dan menandai seluruh armada lama membuat
  laporannya tidak dapat dibaca siapa pun. Bentuk yang tidak dapat diurai
  tidak memberi tahu apa pun tentang jamnya; menandainya berarti melaporkan
  tebakan.
- ⛔ **Jam server dibaca dari DATABASE.** Dua mesin yang jamnya berselisih
  beberapa detik akan menandai armada yang sehat — aturan yang sama dengan
  resolusi harga.
- ⛔ **Penjualan TIDAK PERNAH ditolak karena jam.** Uangnya sudah diterima
  merchant; menolaknya berarti kehilangan penjualan karena baterai RTC sebuah
  tablet habis. Aturan yang sama dengan selisih hitungan (`spec-h:95`).
  `catatDriftJam` juga tidak pernah melempar — pemanggilnya jalur penjualan.
- ⛔ **Dibatasi satu per perangkat per jam, diturunkan dari `audit_event`.**
  Perangkat yang meleset 10 menit mengirim puluhan permintaan sehari; satu
  event per permintaan mengubur seluruh audit trail di bawah satu tablet yang
  salah setel — audit yang tidak dapat dibaca adalah audit yang tidak ada.
  Batasnya dari jejaknya sendiri, bukan kolom hitungan (pola ambang no-sale).
- ⛔ **Arahnya DUA.** Jam yang maju sama berbahayanya dengan yang mundur:
  yang satu mendarat di shift berikutnya, yang lain di shift sebelumnya.
  Tandanya dipertahankan di `after.skewDetik`.
- ⛔ **X8 membaca `clock_drift_detected`, bukan selisih `occurred_at` vs
  `recorded_at`** — alasan yang sama dengan poin pertama. `spec-g:164` menulis
  "di luar durasi offline yang wajar", dan kalimat terakhir itu yang
  menentukan.
- ⛔ **X8 diurutkan berdasarkan BESAR selisih, bukan waktu** (`spec-g:166`).
  Urutan kronologis membuat yang paling layak diselidiki tenggelam di antara
  yang meleset dua menit.
- **Angkanya masuk `after`, bukan ke pesan teks.** Kalimat harus diurai ulang
  oleh siapa pun yang ingin membandingkan dua perangkat.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 426 ·
`test:ordering` 184 · `test:kasir` 418 · `test:server` 295 ·
`test:identity` 142 · `test:payment` 132 · `test:catalog` 177 ·
`test:isolation` 211 · `test:backoffice` 370 · `test:sync-client` 102 ·
`test:dst` 14 · `test:sqlite-local` · `test:runtime` ·
`test:oxlint-ds-adherence` · build kasir.

**Sabotase:** `X-Device-Time` tidak dikirim → 4 merah; pembatasan satu per jam
dilepas → 1 merah.

**Batas yang dinyatakan:** deteksi hanya berjalan di jalur `POST /orders` —
jalur relay yang selalu membawa perangkat DAN aktor. `audit_event.actor_user_id`
adalah `NOT NULL` dengan FK ke `"user"`, jadi jalur berkredensial perangkat
(telemetri, token, fitur) tidak dapat menulis peristiwa ini tanpa mengubah
skema. Perangkat yang jamnya salah tapi tidak pernah menjual tidak tertangkap;
perangkat yang menjual selalu tertangkap, dan itu yang laporannya cari.

**Sisa FR-G5:** X2–X7 belum dibangun (X1 dan X8 selesai).

---

### Task 26 — FR-G5 X2, X3, X4, X5, X7: lima laporan exception

`spec-g:151` menyebutnya *"fitur yang **dibeli owner**, bukan sekadar kontrol
keamanan — harus muncul di materi penjualan"*. Hanya X1 yang ada; audit Task 25
menemukan tujuh sisanya kosong. X8 ditutup bersama FR-F8; lima yang dapat
dibangun ditutup di sini.

**Keputusan yang diambil:**

- ⛔ **Ditempatkan di `reporting`, bukan `ordering`.** X2, X4, dan X7 membaca
  `cash_drawer_shift` (milik `cash`) bersama `audit_event` (milik `audit`) dan
  `"order"` (milik `ordering`) — tiga modul dalam satu pertanyaan.
  `reporting/index.ts` sudah menyatakan kebijakannya: pelanggaran batas yang
  terlanjur ada di `ordering` tidak dipindahkan sambil lalu, tapi yang BARU
  tidak boleh menambahnya. X1 karena itu tetap di tempatnya.
- ⛔ **Penjaga RBAC di SATU tempat** (`exceptionHandlers`), bukan disalin lima
  kali. Laporan keenam yang ditambahkan besok akan lupa menyalinnya, dan yang
  lupa adalah yang membocorkan daftar siapa-membatalkan-apa ke kasir.
- ⛔ **X2 membandingkan `audit_event.occurred_at` dengan `shift.closed_at`**,
  bukan dengan jam sekarang. Shift yang belum ditutup tidak punya "60 menit
  terakhir": menghitungnya dari sekarang membuat setiap void pada shift
  berjalan tertandai selama satu jam lalu berhenti tertandai sendiri — laporan
  yang jawabannya berubah tanpa satu pun data berubah.
- ⛔ **X2 membuang void biasa.** Void biasa sudah ada di X1; mengulangnya
  membuat pola waktu tenggelam di antara seluruh void. `sesudah_tutup` selalu
  di atas `akhir_shift` — ia keadaan yang BERBEDA, bukan sekadar lebih dekat.
- ⛔ **X3 memakai persentil, bukan ambang rupiah tetap.** Kafe yang omzetnya
  besar punya refund besar; ambang tetap menandai seluruh kasirnya sementara
  kafe kecil tidak pernah menandai siapa pun. Ambangnya dihitung dari SELURUH
  refund periode itu (bukan dari yang sudah tersaring, yang akan menggeser
  ambangnya setiap kali laporan dibuka) dan **ikut dikembalikan** — daftar
  tanpa ambangnya tidak dapat dijelaskan kepada kasir yang namanya ada di sana.
- ⛔ **X5 membaca `audit_event.after.orderDiscount`, bukan
  `order.order_discount`.** Keduanya sama hari ini, tapi audit yang mencatat
  SIAPA yang menekannya — dan itu pertanyaan laporan ini. Sebaran alasan ikut,
  karena sinyalnya bukan diskon besar melainkan diskon yang selalu beralasan
  sama.
- ⛔ **X7 mengembalikan `totalSelisih` DAN `totalMutlak`.** Kasir yang kurang
  Rp 50.000 lalu lebih Rp 50.000 punya total nol dan mutlak Rp 100.000 — dua
  angka yang menceritakan hal yang sangat berbeda, dan menampilkan salah
  satunya saja menyembunyikan yang lain. Selisih tidak di-clamp; arahnya
  adalah informasinya.
- ⛔ **Tren `datar` juga berarti "deretnya terlalu pendek".** Dua shift tidak
  menunjukkan kecenderungan apa pun, dan menyebutnya "naik" memberi pembaca
  keyakinan yang tidak dimiliki datanya.
- **`persentil` kini SATU sumber** dengan telemetri (`statistik.ts`). Dua
  implementasi nearest-rank yang menyimpang menghasilkan p95 latensi yang
  berbeda dari p90 refund untuk bentuk data yang sama.

**Dua masalah yang muncul, dan akar penyebabnya:**

1. **`fastify-openapi-glue` menolak seluruh spec** dengan pesan *"must contain
   a valid specification of a supported OpenApi version"* — pesan yang tidak
   menyebut baris mana pun. Seluruh 295 test server merah sekaligus. YAML-nya
   sendiri parse bersih, jadi bukan sintaks. Akarnya: `{ type: string,
   description: Rata-rata per shift, satu desimal. }` — **koma di dalam flow
   mapping YAML** memecah deskripsi menjadi kunci tambahan `satu desimal.`.
   Ditemukan dengan memanggil `Parser.preProcessSpec` langsung, yang mencetak
   daftar error AJV-nya. Setiap deskripsi inline kini dikutip.
2. **Penjaga invariant #7 menandai `'0.0'`** di `exception.ts` dan
   `statistik.ts` — string format rasio, bukan tarif pajak. Penjaganya BENAR
   untuk ketat; `CLAUDE.md` mencatat bahwa penjaga yang menandai kode benar
   akan dimatikan orang berikutnya. Yang diubah kodenya: `satuDesimal()` dan
   `rataRataSatuDesimal()` membentuk nolnya lewat `toFixed`, jadi tidak ada
   satu pun literal desimal tersisa di jalur laporan.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 439 · `test:server` 311
· `test:ordering` 184 · `test:identity` 142 · `test:payment` 132 ·
`test:catalog` 177 · `test:isolation` 211 · `test:tenancy` 75 ·
`test:schema` 14 · `test:kasir` 418 · `test:backoffice` 370 ·
`test:sync-client` 102 · `test:dst` 14 · `test:sqlite-local` · `test:runtime` ·
`test:oxlint-ds-adherence` · build kasir.

**Sabotase:** `assertBoleh` dilepas dari pembungkus → 1 merah (kasir dapat
membuka kelimanya); saringan `posisi !== 'biasa'` dilepas dari X2 → 2 merah.

⛔ **Salah satu putaran sabotase menghasilkan 28 merah yang MENYESATKAN** —
dua `test:server` berjalan bersamaan atas satu database, persis hazard yang
tercatat di kepala berkas ini. Dijalankan ulang berurutan: 311 hijau. Angka
merah dari suite ber-database yang tumpang tindih bukan bukti apa pun.

**⛔ X6 TIDAK DAPAT DIBANGUN, dan itu temuan, bukan penundaan.**

`spec-g:162` menggambarkannya sebagai *"item yang ditambah lalu dihapus
berkali-kali pada SATU order — manipulasi keranjang sebelum pembayaran"*.
Keranjang K-03 hanya hidup di MEMORI (`apps/kasir/src/kasir/simpanan.ts`); ia
tidak pernah ditulis ke SQLite lokal maupun dikirim ke server. Penambahan dan
penghapusan sebelum pembayaran karena itu **tidak meninggalkan jejak di mana
pun** — tidak ada tabel, tidak ada audit event, tidak ada telemetri yang
memuatnya.

Membangunnya menuntut salah satu dari dua hal, dan keduanya keputusan yang
lebih besar daripada satu laporan:

| Jalan | Konsekuensinya |
|---|---|
| Persistensi keranjang (KEP-21) | Order `open` yang tidak pernah dibayar muncul di laporan dan belum punya jalan penutupan |
| Telemetri peristiwa keranjang | `ARCH:309` melarang telemetri memuat nama produk; X6 menuntut TEPAT itu untuk berguna |

Dicatat sebagai batas yang dinyatakan, bukan dikerjakan setengah.

---

## Task 27 — B-21 menampung KEDELAPAN laporan exception (FR-G5)

**Status: selesai.**

Task 26 memberi enam laporan baru endpoint dan test, dan tidak satu pun punya
jalan masuk: B-21 hanya menampilkan X1. `spec-g:151` menyebut FR-G5 *"fitur
yang dibeli owner"* — endpoint tanpa layar adalah fitur yang tidak dibeli
siapa pun.

`IA:200` menamai B-21 **"Laporan Exception (8 laporan)"**. Delapan entri menu
karena itu bukan pilihan yang tersedia: `IA:173` menjelaskan kenapa PENGAWASAN
dipisah dari LAPORAN sama sekali, dan memecahnya delapan mengembalikan masalah
yang pemisahan itu selesaikan — masing-masing tenggelam sendiri-sendiri. Yang
dibangun satu layar dengan penyeleksi tab.

**Keputusan:**

- ⛔ **Daftar laporan adalah DATA (`b21-daftar.ts`), bukan cabang JSX.** Judul,
  deskripsi, endpoint, kunci baris, catatan kaki, dan kosakata keadaan kosong
  hidup sebagai satu larik. Penjaga bahasa menuduh karena itu membaca **data**,
  bukan berkas: laporan kesembilan yang lahir kelak diperiksa tanpa siapa pun
  mengingat penjaganya ada.
- ⛔ **`pesanKeadaan` dihapus dari `b21.ts`; penggantinya `pesanLaporan` yang
  menerima definisi laporan.** Tiga keadaan yang tampak sama — "belum dimuat",
  "tidak ada apa-apa", "gagal memuat" — adalah tepat jenis keputusan yang tidak
  boleh punya delapan salinan. Salinan yang lupa membedakannya membuat
  kegagalan jaringan terbaca sebagai **pembebasan** orang yang namanya tidak
  muncul. Kalimat "perangkat yang belum tersinkronisasi juga menghasilkan
  daftar kosong" kini diuji untuk KETUJUH laporan yang punya endpoint.
- ⛔ **`barisLaporan` menangani bentuk BERSARANG X3, dan itu bukan kerapian.**
  Pembungkus `exceptionHandlers` menaruh hasil X3 di bawah kunci `laporan`, dan
  hasil itu sendiri objek `{ambang, jumlahSeluruhRefund, refund}` — bukan
  larik. `hasil[kunci]` apa adanya menghasilkan objek, `objek.length` adalah
  `undefined`, dan `undefined > 0` adalah `false`: layar berkata "tidak ada
  refund" untuk periode yang penuh refund, **tanpa satu pun error**. Satu
  tempat yang memutuskan "nol baris", dan bentuk bersarangnya dinyatakan di
  sana.
- ⛔ **X6 TETAP punya tab, dengan alasannya di layar.** Menghilangkannya
  membuat merchant yang membaca spec menyimpulkan laporannya rusak — atau
  bahwa ia salah mencari. `pesanLaporan` mengembalikan alasan itu untuk
  **setiap** keadaan, termasuk `siap`: berpindah ke tab X6 tidak boleh
  menampilkan tabel refund yang baru saja dilihat.
- ⛔ **Pindah tab memuat ulang, dan hasil lama tidak dibawa serta.** Menyimpan
  hasil per tab menampilkan angka rentang LAMA di bawah penyaring rentang yang
  sudah diubah — laporan yang tidak menjawab pertanyaan yang terlihat sedang
  diajukan.
- ⛔ **`JUDUL_LAYAR` menjadi "Laporan Exception".** Judul yang menyebut satu
  dari delapan membuat tujuh sisanya terbaca seperti tempelan. Menu sidebar
  sudah berbunyi "Laporan exception" sejak awal.
- **Angka bertanda selalu disertai KATANYA.** Selisih kas `− Rp 50.000` diberi
  kata "kurang"; menit ke penutupan yang negatif dibaca "12 menit **sesudah**
  tutup"; selisih jam dibaca "maju"/"mundur". Tanda minus sendirian menuntut
  pembaca menerjemahkannya, di laporan yang dipakai memutuskan apakah perlu
  bicara dengan seseorang. Tren `datar` berbunyi "belum menunjukkan arah",
  bukan "stabil" — `arahTren` mengembalikan `datar` juga untuk deret yang
  terlalu pendek.
- **Endpoint tiap laporan dicocokkan ke `openapi.yaml` oleh test.** Path yang
  salah ketik menghasilkan 404 yang layar tampilkan sebagai "laporan tidak
  dapat dimuat" — bentuk kegagalan yang tidak dapat dibedakan dari server mati.

**Verifikasi:** `typecheck` · `lint:ds` · build back-office · `test:backoffice`
389 · `test:domain` 439 · `test:kasir` 418 · `test:sync-client` 102 ·
`test:dst` 14 · `test:runtime` 3 · `test:oxlint-ds-adherence` 12 ·
`test:schema` 14 · `test:server` 311 · `test:ordering` 184 · `test:isolation`
211 · `test:catalog` · `test:payment` · `test:identity` · `test:tenancy`.

**Sabotase:** penanganan bentuk bersarang dilepas dari `barisLaporan` → 1 merah
(X3 terbaca kosong); kalimat sinkronisasi dilepas dari `pesanLaporan` → 2 merah
(termasuk penjaga X1 yang sudah ada sejak Task 26).

---

## Task 28 — B-22 Audit & Aktivitas, dan kosakata audit yang tidak pernah ada

**Status: selesai.**

`IA:201` mendaftarkan B-22 sejak awal dan `navigasi.ts` sudah punya entrinya;
yang tidak ada adalah endpoint, layar, dan — yang ternyata paling menentukan —
**daftar tertutup untuk `audit_event.event_type`**.

### ⛔ Temuan: `recordAuditEvent` menerima `eventType: string`

Delapan belas nama peristiwa tersebar di dua belas berkas, tidak satu pun
terdaftar di mana pun, dan tidak ada apa pun yang menahan yang kesembilan belas
dieja berbeda. Ejaan yang menyimpang **tidak menghasilkan error**: ia
menghasilkan baris audit yang tidak pernah cocok dengan saringan mana pun, dan
laporan yang melewatkannya terlihat persis seperti laporan yang tidak menemukan
apa pun. Bentuk cacat yang sama persis dengan `stock_movement.type` yang
`CLAUDE.md` sudah catat.

Ditutup dengan `packages/domain/src/audit-peristiwa.ts` + `eventType:
PeristiwaAudit`. Sabotase: satu nama diubah menjadi `shift_ditutup` → typecheck
merah, dengan seluruh daftar yang sah tercetak di pesannya.

### ⛔ Temuan kedua: audit trail BERLUBANG terhadap `spec-f:288`

FR-F6 AC pertama menuntut *"setiap event dalam daftar menghasilkan record"*.
Dari 35 nama di tabel spec, **24 belum dipancarkan sama sekali** — termasuk
`shift_opened` (setiap shift dibuka, tidak satu pun tercatat), `price_changed`,
`stock_adjusted`, `tax_rate_changed`, `device_revoked`, dan `data_exported`.

Yang dibangun bukan penambalannya (itu Task berikutnya) melainkan **cara
melihatnya**: `PERISTIWA_BELUM_DIPANCARKAN` diturunkan dari selisih daftar spec
dan daftar kode — bukan ditulis tangan — ikut di respons endpoint, dan
**disebutkan di layar**. Trail berlubang yang terlihat lengkap adalah bentuk
paling berbahaya dari trail yang tidak lengkap: manajer yang tidak menemukan
perubahan harga di sini akan menyimpulkan tidak ada yang mengubah harga.
Daftarnya menyusut sendiri saat peristiwanya mulai ditulis.

### Keputusan lain

- ⛔ **Ejaan KODE yang dibekukan, bukan ejaan spec.** `spec-f:292` menulis
  `order_voided`; kode menulis `order.voided`. Keduanya sudah ada di database
  merchant dan `audit_event` tidak pernah di-`UPDATE` (invariant #2) — baris
  lama tidak dapat ditulis ulang. Menyeragamkan berarti dua ejaan untuk satu
  peristiwa, selamanya. `PETA_EJAAN_SPEC` menyatakan padanannya supaya daftar
  spec tetap dapat dibandingkan.
- ⛔ **Paginasi KEYSET, dengan perbandingan BARIS `(occurred_at, id)`.** Lima
  peristiwa pada detik yang sama persis adalah keadaan normal — satu penjualan
  menulis beberapa baris audit dalam satu transaksi. Kursor yang hanya
  membandingkan waktu melewati empat di antaranya. Testnya tidak memeriksa
  "halaman kedua ada" melainkan bahwa **menyusuri seluruh halaman mengembalikan
  setiap baris tepat satu kali**. Sabotase: keyset diganti perbandingan waktu
  saja → 2 merah.
- ⛔ **Server mengambil SATU baris lebih banyak daripada yang diminta.** Itu
  yang membedakan "halaman penuh kebetulan" dari "masih ada lagi"; kursor yang
  selalu ada membuat layar menampilkan tombol yang membuka halaman kosong.
- ⛔ **Jenis peristiwa ASING ditolak 400, bukan dijawab nol baris.** Nol baris
  terlihat persis seperti "tidak ada yang melakukannya", dan salah ketik pada
  saringan audit adalah cara paling mudah menyimpulkan hal yang salah tentang
  seseorang. `order_voided` (ejaan spec) karena itu ditolak dengan daftar ejaan
  yang benar di pesannya.
- ⛔ **`before`/`after` TIDAK dikembalikan.** Keduanya muatan bebas yang pada
  `item_updated` akan memuat `cost`; FR-F5 melarang HPP sampai ke mata yang
  tidak berhak. Bahwa himpunan peran `report_exception` kebetulan sama persis
  dengan `view_margin` hari ini bukan penjaga.
- ⛔ **Setiap saringan yang dipakai ikut dikembalikan DAN disebutkan di atas
  tabel.** Daftar audit yang tidak menyebut apa yang disaring terbaca seperti
  daftar lengkap, dan kesimpulan yang ditarik darinya menyangkut orang.
- ⛔ **RBAC `report_exception`, `[ASUMSI]` yang dinyatakan.** Matriks
  `spec-f:38-53` tidak punya baris untuk audit trail, dan `navigasi.ts`
  mencatat itu apa adanya. Himpunan peran `report_exception` sama persis dengan
  minimum `IA:201`, dan isi trail adalah **superset** dari X1 yang matriks
  sudah berikan kepada keempat peran itu — menolak trail sambil memberikan X1
  tidak melindungi apa pun. Operasi baru `audit_view` sengaja tidak dibuat:
  matriks yang mengandung baris karangan berhenti dapat dibaca berdampingan
  dengan spec-nya.
- ⛔ **`RentangTanggal` mendapat prop `sumbu`.** Ia menyatakan "tanggal bisnis"
  pada setiap layar yang memakainya; benar sepuluh kali dan **salah sekali** —
  B-22 menyaring `occurred_at`, karena sebagian besar peristiwa audit tidak
  menempel pada order mana pun. Yang sekali itu ada di layar yang dibaca saat
  sengketa.
- ⛔ **Kursor adalah state tersendiri, bukan dibaca ulang dari hasil halaman
  pertama.** Hasil pertama tidak berubah saat halaman lanjutan datang;
  menurunkan kursor darinya berarti tombol "Muat lebih banyak" meminta halaman
  kedua selamanya — dan kegagalannya menggandakan baris, bukan melempar error.
- **Penjaga navigasi diubah dari daftar id menjadi MEKANISME.** Test lama
  berbunyi "akuntan melihat B-21 tapi TIDAK B-22" dan benar untuk keadaan saat
  itu. Sekarang yang dijaga: setiap item di luar grup Akuntan yang terlihat
  olehnya harus punya operasi yang matriks benar-benar berikan — daftar id akan
  berubah lagi, mekanismenya tidak boleh.

**Verifikasi:** `typecheck` · `lint:ds` · build back-office · `test:domain` 445
· `test:server` 327 · `test:backoffice` 403 · `test:ordering` 184 ·
`test:kasir` 418 · `test:schema` 14 · `test:sync-client` 102 · `test:dst` 14 ·
`test:sqlite-local` 8 · `test:runtime` 3 · `test:oxlint-ds-adherence` 12 ·
`test:isolation` · `test:catalog` · `test:payment` · `test:identity` ·
`test:tenancy`.

---

## Task 29 — FR-F6: menutup lubang audit katalog, harga, stok, dan pajak

**Status: selesai. Lubang FR-F6 menyusut dari 24 menjadi 16.**

Task 28 membuat jaraknya terukur; ini yang mulai menutupnya. Yang ditambahkan:
`item_created` · `item_updated` · `item_archived` · `price_changed` ·
`stock_adjusted` · `stocktake_completed` · `sold_out_toggled` ·
`tax_rate_changed`. Delapan peristiwa, dua belas endpoint mutasi.

**Keputusan:**

- ⛔ **Satu pembungkus `catatPerubahanServer`, bukan `recordAuditEvent`
  langsung di dua belas tempat.** Semua peristiwa ini berbentuk identik: tanpa
  perangkat, tanpa penyetuju, tanpa alasan, tanpa HLC. Menyalin lima field
  tetap ke dua belas tempat berarti dua belas kesempatan salah menuliskan salah
  satunya — dan yang paling mudah salah `hlc`, yang tipenya `bigint` dan yang
  nilai benarnya justru nol.
- ⛔ **`hlc: 0n` adalah nilai yang JUJUR, bukan placeholder.** HLC menyatakan
  urutan kausal terhadap peristiwa perangkat; perubahan back-office tidak punya
  perangkat dan tidak berhak mengklaim posisi dalam urutan itu. Mengarangnya
  dari jam server akan menempatkannya di antara dua peristiwa kasir yang tidak
  pernah melihatnya.
- ⛔ **`price_changed` meresolusi harga lama SEBELUM baris baru ditulis.**
  Baris baru menang di tangga resolusi begitu ia tertulis — meresolusi
  sesudahnya membuat `before` sama dengan `after`, dan audit yang menjawab
  "harganya diubah dari berapa" dengan angka barunya sendiri lebih buruk
  daripada audit yang tidak menjawab. Dan yang diresolusi **harga yang berlaku
  pada `effective_from` baris baru**, bukan baris `price_history` sebelumnya:
  tangga tiga tingkat berarti baris terakhir yang ditulis belum tentu yang
  sedang berlaku. Sabotase: urutannya dibalik → 1 merah.
- ⛔ **Arsip dan pemulihan memancarkan peristiwa yang SAMA**, dibedakan
  `before`/`after`. `spec-f:294` hanya menyebut `item_archived`; memancarkan
  `item_restored` yang tidak ada di daftar berarti kosakata yang tidak dapat
  dibandingkan dengan spec-nya.
- ⛔ **Varian dicatat pada ITEM-nya** (`entityId` = item). Menelusuri satu item
  harus mengembalikan seluruh riwayat variannya; `spec-f:294` tidak punya
  peristiwa tingkat varian.
- ⛔ **`stock_adjusted` mencatat DELTA, bukan stok akhir.** Stok adalah
  `SUM(stock_movement.delta)` dan tidak punya kolom (`CLAUDE.md`); menuliskan
  stok akhir ke audit berarti angka kedua yang harus dijaga sepakat dengan
  ledger-nya, dan yang menyimpang di antaranya tidak dapat diputuskan mana yang
  benar.
- ⛔ **`stocktake_completed` mencatat JUMLAH baris, bukan barisnya.** Opname
  sebuah kafe menyentuh ratusan varian; menyalin semuanya membuat satu
  peristiwa audit lebih besar daripada seluruh trail hari itu, lalu
  menenggelamkan peristiwa yang justru dicari.
- ⛔ **`sold_out_toggled` mencatat ARAHNYA.** Penandaan habis terpisah dari
  stok terhitung (`spec-e:220`); audit yang hanya mencatat "ditandai" tidak
  dapat membedakan menandai habis dari membatalkannya.
- ⛔ **Tarif pajak disalin sebagai STRING dari kolom `numeric`.**
  Melewatkannya lewat `Number` adalah persis yang `packages/domain/src/numeric.ts`
  ada untuk mencegah — dan audit trail pajak yang angkanya bergeser adalah
  bukti yang lebih buruk daripada tidak ada bukti. Invariant #7 tidak dilanggar:
  yang ditulis salinan nilai, bukan aritmetika.
- ⛔ **`before` diuji ISINYA, bukan keberadaannya.** Audit yang menjawab
  "diubah dari apa" dengan nilai barunya sendiri lolos setiap test yang hanya
  memeriksa bahwa kolomnya terisi.
- ⛔ **Test memanggil ENDPOINT-nya, bukan `catatPerubahanServer`.** Test yang
  memanggil fungsinya langsung membuktikan bahwa fungsinya menulis — bukan
  bahwa handler-nya memanggilnya. Kelas yang sama dengan pelajaran 21 Agustus
  2026 tentang transport perangkat. Ada juga test arah sebaliknya: operasi yang
  GAGAL (409 id ganda) tidak boleh meninggalkan baris audit — trail yang memuat
  perubahan yang tidak pernah terjadi lebih buruk daripada trail berlubang.
- **Assertion "lubang mana yang tersisa" dibuat STRUKTURAL.** Versi pertamanya
  menyebut `price_changed` dan merah tiga jam kemudian saat peristiwa itu mulai
  dipancarkan; test yang harus disunting setiap kali daftarnya menyusut akan
  disunting tanpa dibaca.

**Sisa 16 lubang, dan kenapa masing-masing belum ditutup:**

| Peristiwa | Alasan |
|---|---|
| `login` · `logout` | Endpoint ada — task berikutnya |
| `shift_opened` · `shift_count_attempt` · `cash_variance_approved` | Endpoint ada — task berikutnya |
| `user_role_changed` · `device_provisioned` · `device_revoked` | Endpoint ada — task berikutnya |
| `data_exported` | Endpoint ada — task berikutnya |
| `cash_paid_in` · `cash_paid_out` | **Tidak ada endpointnya.** Setoran/penarikan kas di luar penjualan belum dibangun |
| `threshold_changed` | B-26 (Ambang Otorisasi) belum ada |
| `vertical_profile_changed` | B-24 (Profil Vertikal) belum ada |
| `peripheral_configured` | `printer_profile` belum punya endpoint mutasi |
| `support_session_started` · `support_session_ended` | Akses support belum dibangun |

**⛔ Task 29 menemukan sembilan test yang hijau karena HAMPA.** Sepuluh
assertion di `tests/ordering/{void,refund,calculation-variance}.test.js`
menghitung **seluruh** baris `audit_event` alih-alih baris yang operasinya
tulis. Nol adalah jawaban benar karena alasan yang salah: tidak ada satu pun
endpoint katalog yang menulis audit, jadi satu-satunya baris yang mungkin ada
memang milik void. Begitu `item_created` dan `price_changed` mulai
dipancarkan, setup test-nya sendiri menghasilkan dua baris.

Bentuk yang sama persis dengan pelajaran F3 yang `CLAUDE.md` catat: *"18 test
void/refund menghitung SELURUH baris `stock_movement`; nol adalah jawaban benar
karena alasan yang salah."* Diperbaiki dengan menyaring `event_type`, dan
alasannya ditulis di tempatnya.

**Penjaga label B-22 menyala persis seperti yang dirancang** — kedelapan
peristiwa baru langsung merah di `pengawasan-b22.test.js` sampai labelnya
ditambahkan, alih-alih tampil sebagai slug mentah di layar.

**Verifikasi:** `typecheck` · `lint:ds` · `test:server` 338 · `test:ordering`
184 · `test:catalog` 177 · `test:payment` 132 · `test:domain` 445 ·
`test:backoffice` 403 · `test:identity` 142 · `test:tenancy` 75 ·
`test:isolation` 211 · `test:schema` 14 · `test:kasir` 418 ·
`test:sync-client` 102 · `test:dst` 14 · `test:sqlite-local` 8 ·
`test:runtime` 3 · `test:oxlint-ds-adherence` 12.

**Sabotase:** resolusi harga lama dipindah ke SESUDAH insert → 1 merah
(`before` sama dengan `after`).

---

## Task 30 — FR-F6: sesi, shift, perangkat, dan ekspor (lubang 16 → 9)

**Status: selesai.** Yang ditambahkan: `login` · `logout` · `shift_opened` ·
`cash_variance_approved` · `device_provisioned` · `device_revoked` ·
`data_exported`.

**Keputusan:**

- ⛔ **Tidak ada `login_failed`, dan itu batas yang DINYATAKAN.**
  `audit_event.actor_user_id` adalah `NOT NULL` ber-FK ke `"user"`, sementara
  login yang gagal sering memakai email yang tidak menunjuk pengguna mana pun —
  tidak ada aktor untuk dicatat. Daftar `spec-f:290` sendiri hanya memuat
  `login`, `logout`, `pin_failed`, dan `pin_lockout`. Ada test yang
  membuktikannya: login yang gagal tidak menulis apa pun.
- ⛔ **`after` login memuat PERAN, bukan email atau alamat IP.** Peran pada
  saat itu yang menjelaskan "kenapa orang ini dapat melakukan itu"
  berbulan-bulan kemudian, saat perannya sudah berbeda. Audit trail bertahan
  lima tahun (`spec-f:372`); setiap field yang masuk ke sana masuk untuk lima
  tahun, dan ada test yang menolak `@` di muatannya.
- ⛔ **`logout` ditulis SESUDAH `DELETE user_session`.** Barisnya hilang,
  jejaknya tidak — pemisahan yang benar: tidak ada yang membutuhkan riwayat
  sesi back-office, tapi "sampai kapan orang ini masih masuk" adalah
  pertanyaan sengketa.
- ⛔ **`shift_opened` sama sekali tidak ada sebelum ini.**
  `cash/handlers/shifts.ts` tidak menyentuh `recordAuditEvent`, sementara
  pasangannya (`shift_closed`) sudah punya sejak F3. Setiap shift dibuka tanpa
  satu pun jejak.
- ⛔ **`cash_variance_approved` adalah peristiwa TERSENDIRI**, bukan
  `approver_user_id` yang kadang terisi pada `shift_closed`. `spec-f:293`
  menamainya sendiri, dan alasannya operasional: laporan "siapa menyetujui
  selisih kas siapa" harus dapat dijawab dengan menyaring satu jenis peristiwa,
  tanpa pembacanya perlu tahu bahwa satu kolom bermakna berbeda tergantung
  jenis barisnya. Ada test bahwa selisih di bawah ambang TIDAK menulisnya.
- ⛔ **`device_revoked` membawa `before.revokedAt`.**
  `UPDATE ... SET revoked_at = now()` tanpa syarat membuat pencabutan kedua
  menimpa stempel yang pertama; tanpa `before`, audit tidak dapat membedakan
  perangkat yang baru dicabut dari perangkat yang sudah lama dicabut lalu
  diklik lagi. "Kapan perangkat ini berhenti dipercaya" adalah pertanyaan
  sengketa.
- ⛔ **Tidak ada bahan kredensial di jejak.** `device_provisioned` mencatat
  kode, nama, dan platform — tidak pernah `token_hash`. Ada test yang
  memindainya.
- ⛔ **`data_exported` ditulis pada endpoint GET, dan itu disengaja.** Ekspor
  tidak mengubah apa pun di sistem; yang berubah adalah **di mana datanya
  berada** — sesudah itu ia ada di laptop seseorang, di luar seluruh kontrol
  akses yang produk ini punya. Justru karena itu `spec-f:300`
  mendaftarkannya, dan justru karena itu ia satu-satunya PEMBACAAN yang
  meninggalkan jejak.
- ⛔ **Yang dicatat LINGKUP ekspor, bukan isinya.** Menyalin CSV-nya ke `after`
  menaruh omzet, nama kasir, dan seluruh angka penjualan ke tabel yang bertahan
  lima tahun — menggandakan setiap data yang diekspor, di tempat yang tidak
  seorang pun kira memuatnya. Ada test yang menolaknya.

**⛔ Dua peristiwa yang TIDAK dibangun, dengan alasannya:**

| Peristiwa | Kenapa |
|---|---|
| `shift_count_attempt` | Server hanya mencatat percobaan hitungan yang **berhasil** menutup shift. Percobaan yang ditolak (selisih melewati ambang tanpa penyetuju) dilempar SEBELUM `UPDATE`, jadi transaksinya di-rollback dan tidak meninggalkan apa pun — dan percobaan yang gagal justru yang `spec-d` ingin buktikan tidak dapat diulang diam-diam. Mencatatnya menuntut jalur tulis yang bertahan melewati rollback: perubahan rancangan, bukan satu baris. Percobaan yang berhasil sudah dijelaskan sepenuhnya oleh `shift_closed` |
| `user_role_changed` | **Tidak ada endpointnya.** `updateUser` hanya menerima `name`/`email`/`isActive`; peran hanya dapat diberikan saat `createUser`. Merchant tidak dapat menaikkan kasir menjadi manajer outlet sama sekali — itu gap PRODUK, bukan gap audit |

**Sisa 9 lubang:** `shift_count_attempt` · `cash_paid_in` · `cash_paid_out` ·
`threshold_changed` · `vertical_profile_changed` · `user_role_changed` ·
`peripheral_configured` · `support_session_started` ·
`support_session_ended`. Tidak satu pun punya endpoint hari ini.

**Assertion "lubang mana yang tersisa" dijadikan STRUKTURAL di dua tempat.**
Versi pertamanya menyebut `shift_opened` sebagai lubang paling menonjol, dan ia
merah beberapa jam kemudian saat peristiwa itu mulai dipancarkan. Test yang
harus disunting setiap kali daftarnya menyusut akan disunting tanpa dibaca —
dan saat FR-F6 akhirnya tertutup, yang tersisa adalah test yang menuntut
lubangnya masih ada.

**Verifikasi:** `typecheck` · `lint:ds` · `test:domain` 445 · `test:backoffice`
403 · `test:server` 346 · `test:ordering` 184 · `test:kasir` 418 ·
`test:sync-client` 102 · `test:dst` 14 · `test:sqlite-local` 8 ·
`test:runtime` 3 · `test:oxlint-ds-adherence` 12 · `test:catalog` 177 ·
`test:payment` 132 · `test:identity` 142 · `test:tenancy` 75 ·
`test:isolation` 211 · `test:schema` 14.

---

## Task 31 — FR-F1: peran dapat DIUBAH, dan `user_role_changed` (lubang 9 → 8)

**Status: selesai.**

### ⛔ Temuan: peran hanya dapat diberikan saat pengguna DIBUAT

`createUser` menerima `roles`; `updateUser` tidak. Merchant yang menaikkan
kasirnya menjadi manajer outlet karena itu tidak punya jalan apa pun — kecuali
membuat pengguna **kedua** dengan nama orang yang sama. Sesudah itu setiap
laporan per kasir memecah orang itu menjadi dua baris, dan riwayat lamanya
menggantung pada akun yang dinonaktifkan.

Ditemukan saat Task 30 mencari endpoint untuk `user_role_changed` dan tidak
menemukannya. Ia gap **produk**, bukan gap audit — dan itu sebabnya ia layak
task tersendiri alih-alih satu baris `catatPerubahanServer`.

### ⛔ Dua penjaga yang HANYA ada di jalur ubah

Keduanya tidak terlihat sebagai kelalaian sampai ditulis:

1. **Peran LAMA target ikut diperiksa.** `createUser` hanya perlu memeriksa
   peran BARU — pengguna yang belum ada belum berperan apa pun. Di sini,
   mengabaikannya membiarkan Manajer Outlet (yang matriks izinkan mengelola
   *kasir saja*) **menurunkan seorang Owner menjadi kasir**, lalu mengelolanya
   dengan bebas. Pemisahan tugas `spec-f:91` runtuh tanpa satu pun aturan
   terlihat dilanggar. Sabotase: peran lama dilepas dari `assertBolehKelola` →
   1 merah.
2. **Owner terakhir tidak dapat DICABUT PERANNYA.** `spec-f:425` menulis
   aturannya untuk penonaktifan, dan `updateUser` sudah menegakkannya di sana.
   Mencabut peran `owner` meninggalkan tenant dalam keadaan yang **persis
   sama** — tidak ada seorang pun yang dapat mengurus billing — tanpa satu pun
   pengguna dinonaktifkan. Penjaga yang menutup satu dari dua jalan ke keadaan
   yang sama bukan penjaga. Sabotase → 3 merah.

### Keputusan lain

- ⛔ **Cakupan diperiksa terhadap gabungan yang AKAN berlaku**, bukan terhadap
  apa yang dikirim. Mengubah peran SAJA menjadi Kasir, sementara pengguna sudah
  terdaftar di dua outlet, menghasilkan tepat keadaan yang `spec-f:32` larang —
  dan tidak ada apa pun di permintaan itu yang terlihat salah.
- ⛔ **Peran diganti SELURUHNYA, bukan digabung.** Peran adalah himpunan; PATCH
  yang menambahkan tanpa dapat menghapus membuat penurunan peran mustahil —
  dan penurunan peran adalah separuh alasan endpoint ini ada.
- ⛔ **`user_role` DIHAPUS lalu ditulis ulang**, pengecualian yang dinyatakan
  terhadap invariant #2. Invariant itu menjaga data finansial dan katalog —
  baris yang riwayat transaksi menunjuknya. `user_role` tidak ditunjuk siapa
  pun; yang menjaga riwayat perannya adalah `audit_event`, dan itulah kenapa
  `user_role_changed` wajib. Ia satu-satunya riwayat peran yang ada: "siapa
  berperan apa pada bulan Maret" hanya dapat dijawab dari sana, dan itu tepat
  pertanyaan yang muncul saat seseorang mempersoalkan sebuah persetujuan.
- ⛔ **Aturan cakupan klien diangkat ke `buatMuatanPeran`, dipakai form tambah
  DAN form ubah.** Dua salinan menyimpang tepat pada kasus yang paling jarang
  dicoba — dan yang menyimpang menghasilkan form tambah yang menolak apa yang
  form ubah terima, di layar yang sama. Testnya menjalankan **keduanya** atas
  masukan yang sama dan membandingkan hasilnya, bukan membaca kodenya.
- ⛔ **Panel ubah peran dibuka dengan keadaan SEKARANG, bukan kosong.** Panel
  kosong membuat "simpan" tanpa mengubah apa pun menghapus seluruh peran dan
  outlet orang itu.
- **Layar menyatakan bahwa perubahan berlaku pada sesi BERIKUTNYA.** Peran
  dibaca saat sesi dibuat; manajer yang menurunkan kasirnya lalu mengira haknya
  langsung hilang akan menyimpulkan sistemnya bocor.

### ⛔ Fixture test yang hijau karena alasan yang salah

Versi pertama `tests/identity/pengguna-peran.test.js` hanya *menambahkan*
`area_manager` ke aktor tanpa menghapus peran fixture-nya (kasir **dan owner**,
`seed.js:122`). Akibatnya setiap tenant di berkas itu punya owner tersembunyi,
dan test "owner terakhir" tidak pernah benar-benar sampai ke owner terakhir.
Ditemukan justru karena test itu MERAH.

**Sisa 8 lubang FR-F6:** `shift_count_attempt` · `cash_paid_in` ·
`cash_paid_out` · `threshold_changed` · `vertical_profile_changed` ·
`peripheral_configured` · `support_session_started` · `support_session_ended`.

---

## Task 32 — B-26 Ambang Otorisasi, dan `threshold_changed` (lubang 8 → 7)

**Status: selesai.** Back-office tinggal satu layar: B-24 Profil Vertikal.

Keputusan 1 Agustus 2026 menyebut ketiga ambang dalam satu kalimat — *"diskon
>20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale wajib alasan, PIN di atas
3×/shift"* — dan mencatat bahwa **angkanya `[ASUMSI]`, belum divalidasi ke
merchant**. Ambang diskon sudah dapat disetel sejak migrasi `0031`; dua sisanya
hanya konstanta. B-26 (`IA:205`) menutup jaraknya.

### ⛔ Bagian yang paling penting bukan endpointnya, melainkan PENERAPANNYA

Layar pengaturan yang menyimpan dengan benar, menampilkan kembali dengan benar,
dan **tidak mengubah apa pun** adalah bentuk kegagalan yang paling sulit
dilihat: tidak ada error di mana pun, dan satu-satunya gejalanya adalah PIN yang
tetap diminta pada angka yang merchant kira sudah ia naikkan.

Karena itu setelan ini dibaca di **empat** tempat, bukan satu:

| Tempat | Kenapa |
|---|---|
| `closeShift` server | Tutup kas lewat back-office |
| `recordNoSale` server | Buka laci lewat server |
| `tutupKas` klien | K-12 berjalan **tanpa jaringan** |
| `rencanaNoSaleLokal` klien | K-16 berjalan **tanpa jaringan** |

Kedua kolom karena itu **turun ke perangkat** (sync rules + skema lokal),
alasan yang sama dengan ambang diskon: perangkat yang memakai bawaan sementara
server memakai angka merchant menghasilkan *kasir yang sama, shift yang sama,
jawaban berbeda* — persis penyimpangan yang `buku-kas.ts` catat saat
konstantanya dipindahkan ke domain.

Sabotase: kedua panggilan dikembalikan ke bawaan → 3 merah.

### Keputusan

- ⛔ **`null` BERBEDA dari nol, dan perbedaannya sampai ke perilaku.** `null` =
  pakai bawaan; `0` = **setiap** kejadian menuntut otorisasi, pilihan yang sah
  untuk merchant yang lacinya kecil. `0n || bawaan` membuangnya tanpa satu pun
  error — `ambangBerlaku` memakai `??`, dan ada test di domain, server, dan
  klien untuk itu.
- ⛔ **TIDAK ADA nilai yang berarti "tidak pernah menuntut otorisasi".** Ambang
  yang dapat dimatikan adalah kontrol yang hilang pada hari seseorang
  membutuhkannya — dan yang mematikannya adalah orang yang paling ingin ia
  mati. Merchant yang menginginkan praktis tanpa PIN menyetel angkanya tinggi:
  terlihat sebagai angka, tercatat sebagai `threshold_changed` dengan nilai
  lama dan barunya. Sebuah toggle `false` tidak menceritakan apa pun tentang
  seberapa jauh. Penjaganya BENTUK datanya — tidak ada bidang boolean.
- ⛔ **Batas atas yang WAJAR, bukan batas yang mungkin.** Salah ketik satu nol
  berlebih menaikkan ambang selisih kas dari Rp 20.000 ke Rp 200.000, dan tidak
  ada apa pun di layar yang akan memberitahunya — selisih yang seharusnya
  dipertanyakan hanya berhenti muncul.
- ⛔ **RBAC `threshold_settings` = {owner, area_manager}**, diturunkan dari
  `IA:205`. **Manajer Outlet sengaja di luar**: ambang inilah yang memutuskan
  kapan persetujuan Manajer Outlet dituntut, dan yang dapat menaikkannya dapat
  menghapus kebutuhan atas persetujuannya sendiri. Operasi tersendiri, bukan
  `tax_settings` yang dipakai ulang — pola yang sama dengan `outlet_manage`,
  supaya penolakannya berbunyi jujur. **MEMBACA tidak dijaga**: kasir yang
  ditolak PIN-nya berhak tahu ambang mana yang menolaknya.
- ⛔ **`PUT`, bukan `PATCH`.** Mengosongkan adalah satu-satunya cara kembali ke
  bawaan, dan PATCH yang menyimpan sebagian membuat perintah itu tidak dapat
  dinyatakan sama sekali.
- ⛔ **Respons membawa `tersimpan` DAN `berlaku`.** Layar yang menebak
  `tersimpan` dari `berlaku` akan menuliskan bawaan sebagai pilihan pada
  penyimpanan berikutnya, dan sejak saat itu outlet berhenti mengikuti
  perubahan bawaan tanpa siapa pun memutuskannya. Isian kosong TETAP kosong;
  bawaannya muncul sebagai petunjuk.
- ⛔ **Audit mencatat `tersimpan`, bukan `berlaku`.** Outlet yang mengosongkan
  ambangnya kembali ke bawaan, dan audit yang mencatat angka bawaan sebagai
  nilai baru tidak dapat dibedakan dari merchant yang mengetik angka itu — dua
  keadaan yang berperilaku sama hari ini dan berbeda pada hari bawaannya
  berubah.
- ⛔ **Dialog no-sale menyebut ambang yang BERLAKU.** `RencanaNoSale` membawa
  `ambang`; komponen yang membacanya dari konstanta akan menyebut "3×" pada
  outlet berambang 6, memberi tahu kasir aturan yang tidak berlaku baginya.
  Audit no-sale mencatat ambang berlaku juga — laporan exception yang
  menampilkan "ke-4 dari 3" menuduh orang atas aturan yang tidak pernah berlaku
  baginya.

### ⛔ Temuan: AJV meng-koersi `number` menjadi `string`

Kontrak menulis `type: string` untuk uang, dan alasannya benar. Tapi AJV
mengubah `50000` menjadi `"50000"` **sebelum handler melihatnya** — bentuk yang
sama persis dengan temuan telemetri (`null` → `0`). Menolaknya di handler
mustahil, dan mengejarnya pun tidak berguna: angka yang melampaui 2⁵³ sudah
kehilangan presisinya di `JSON.stringify` klien. Yang menjaga sisi itu adalah
`b26.ts`, yang selalu mengirim string. Yang masih dapat dijaga: rupiah tidak
punya desimal — `50000.5` dikoersi menjadi `"50000.5"` dan ditolak bentuknya.

### Lima penjaga yang menyala persis seperti yang dirancang

1. `tipe-divergen.test.js` — kedua kolom PostgreSQL baru tidak ada di skema
   lokal dan tidak terdaftar sebagai keputusan. Itu yang memaksa keputusan
   "turun atau tidak" diambil sadar, bukan terlewat.
2. `navigasi.test.js` — B-26 masih terdaftar sebagai "endpointnya belum ada".
3. `outlet.test.js` — daftar operasi outlet di kontrak berubah. Penjaganya
   dipertajam: daftar putihnya tetap, ditambah pola yang menamai apa yang
   sebenarnya dijaga (tidak ada `update`/`archive`/`rename`Outlet), supaya
   penjaganya tidak lagi merah untuk endpoint yang tidak menyentuh identitas
   outlet.
4. `rbac-cakupan.test.js` — rute mutasi baru tanpa aturan peran di
   `PETA_PERAN`. `assertBoleh` di handler sudah ada dan tetap **tidak cukup**:
   peta itu yang membuat "rute mana menuntut apa" dapat dibaca sekali,
   berdampingan dengan matriks spec.
5. `rbac-penolakan.test.js` — rute yang punya aturan tapi tidak punya kasus
   penolakan. Penjaga cakupan menjamin ia PUNYA aturan; yang ini menjamin
   aturannya BEKERJA.

**Sisa 7 lubang FR-F6:** `shift_count_attempt` · `cash_paid_in` ·
`cash_paid_out` · `vertical_profile_changed` · `peripheral_configured` ·
`support_session_started` · `support_session_ended`.

---

## Task 33 — B-24 Profil Vertikal, dan `vertical_profile_changed` (lubang 7 → 6)

**Status: selesai. Seluruh 26 layar back-office kini ada.**

`vertical_profile` punya tabel sejak F0 dan sudah turun ke perangkat, tapi NOL
endpoint mutasi — OQ-09 ("profil per outlet, mewarisi default tenant")
diputuskan 1 Agustus 2026 dan sampai sekarang hanya dapat dijalankan lewat SQL.

### ⛔ Yang TIDAK dibuka di layar, dan kenapa

`vertical_profile` punya enam kolom perilaku. **Lima di antaranya tidak dibaca
satu baris kode pun** di luar pendaftaran tenant: `default_channel`,
`requires_barcode_flow`, `default_tax_type`, `modules_enabled`, dan `name`
untuk `retail`.

Membukanya adalah persis cacat yang Task 32 ada untuk menghindari: setelan yang
tersimpan dengan benar, ditampilkan kembali dengan benar, dan **tidak mengubah
apa pun**. Yang dibuka hanya `allow_negative_stock` — satu-satunya yang
benar-benar menentukan sesuatu (FR-E4), dan ia menentukannya **di perangkat,
offline**.

### ⛔ `retail` DITOLAK, dengan pesan yang menjelaskan

`retail` ada di CHECK constraint sejak F0 dan `IA:291` menulisnya sebagai kolom
v1.3; `PRD` § 4 menaruh UI vertikal retail di v1.1+. Tabel `IA:293` menyebut apa
yang seharusnya berbeda — input barcode primer di K-03, konversi satuan di
B-07, retur barang, preset pajak PPN. Tidak satu pun ada.

Merchant yang dapat menekan "retail" mendapat aplikasi kasir yang dibangun
untuk F&B dengan label yang mengatakan sebaliknya. Ditolak
`VERTICAL_NOT_AVAILABLE` dengan kalimat yang menyebut apa yang belum ada —
bukan `VALIDATION_ERROR` generik, yang akan membuat merchant mengira ia salah
mengetik. Dan **dinyatakan di layar**, bukan sekadar tidak ada: pilihan yang
hilang tanpa penjelasan terbaca sebagai layar yang rusak.

### Keputusan

- ⛔ **Bawaan tenant tidak dapat DIKOSONGKAN, hanya DIPINDAHKAN.**
  `resolusiProfil` punya bawaan keras (`allowNegativeStock: true`) untuk
  perangkat yang katalognya belum turun. Membiarkan merchant mencabut bawaan
  tenantnya berarti setiap outlet ber-override NULL diam-diam jatuh ke aturan
  yang **tidak seorang pun pilih**, di jalur yang paling tidak terlihat.
  Ditolak `DEFAULT_PROFILE_REQUIRED`. Sabotase → 2 merah.
- ⛔ **Menetapkan bawaan BARU mencabut yang lama di transaksi yang sama.**
  `ux_vertical_profile_tenant_default` adalah index unik PARSIAL: dua baris
  default menghasilkan 23505 — benar, tapi jawabannya 500 dan pesannya menyebut
  nama index. Sabotase → 1 merah.
- ⛔ **Resolusi dihitung di SERVER lewat `resolusiProfil` yang sama yang
  perangkat pakai.** Layar yang menghitungnya sendiri adalah tempat kedua yang
  memutuskan "profil mana yang berlaku di cabang ini", dan yang menyimpang
  menampilkan aturan yang berbeda dari yang kasirnya alami.
- ⛔ **TIGA keadaan outlet, bukan dua.** Memilih sendiri · mengikuti bawaan
  tenant · memakai **bawaan keras sistem** karena tenantnya belum punya bawaan.
  Ketiganya menghasilkan satu baris yang menampilkan aturan yang sama; hanya
  yang ketiga adalah aturan yang tidak dipilih siapa pun, dan hanya yang ketiga
  menuntut tindakan. `asalProfil` membedakannya, dan layar menamai ketiganya.
- ⛔ **Audit mencatat `null` sebagai null**, bukan diresolusi menjadi id bawaan.
  "Outlet ini mengikuti pusat" dan "outlet ini memilih profil yang kebetulan
  sama dengan pusat" berperilaku sama hari ini dan berbeda pada hari bawaannya
  dipindahkan.
- ⛔ **Profil klien-suplai divalidasi lewat SELECT yang tunduk RLS.** Temuan F1
  lagi: FK PostgreSQL hanya membuktikan barisnya ada di SUATU tenant, dan
  profil merchant lain akan menentukan perilaku stok negatif outlet ini.
- ⛔ **`false ?? null` adalah `false`.** `COALESCE` dengan `||` di tempat itu
  akan membuang pilihan "larang jual saat habis" sepenuhnya — ada test untuk
  itu.
- ⛔ **Kolom mati diisi nilai yang SAMA dengan yang `registerTenant` tulis**,
  bukan dibiarkan ke `DEFAULT` kolom. Profil yang dibuat lewat layar tidak
  boleh berperilaku berbeda dari profil yang lahir bersama tenant — perbedaan
  yang tidak terlihat sampai seseorang membandingkan dua baris.
- **RBAC `outlet_manage` dipakai ulang** (owner saja), bukan operasi baru:
  himpunan perannya sama persis dan cakupannya sama — keduanya menentukan
  bentuk jaringan outlet merchant. Operasi baru yang himpunannya identik hanya
  menambah baris ke matriks yang spec tidak nyatakan.
- **Kalimat layar menyebut AKIBATNYA, bukan nama kolom.** Owner kafe tidak tahu
  apa yang "izinkan stok negatif" ubah di tablet kasirnya besok pagi — dan
  kedua arahnya disebutkan, karena `spec-e:146` memilih arahnya dengan alasan
  yang dinyatakan.

### Penjaga navigasi diubah dari DAFTAR menjadi MEKANISME

Test `⛔ B-24 dan B-26 TIDAK ditandai siap` adalah daftar tulisan tangan, dan
keduanya sudah keluar dalam dua task berturut-turut. Daftar yang dikosongkan
sepotong-sepotong berhenti menjaga apa pun. Sekarang yang dijaga: layar dan
endpointnya harus **sepakat di kedua arah** — siap tanpa endpoint berarti
sidebar menjanjikan layar yang tidak dapat memuat apa pun; belum siap padahal
endpointnya ada berarti layar yang berfungsi disembunyikan di balik keadaan
kosong "belum dibangun".

**Sisa 6 lubang FR-F6, dan tidak satu pun punya fiturnya:**
`shift_count_attempt` · `cash_paid_in` · `cash_paid_out` ·
`peripheral_configured` · `support_session_started` · `support_session_ended`.

---

## Task 34 — FR-D5 kas masuk & kas keluar (24 Agustus 2026) ✅

`spec-d:189` mendaftarkan `paid_in`/`paid_out` di enum `cash_movement` sejak
awal, dan `spec-d:202` menetapkan aturannya. Sampai hari ini **tidak ada satu
pun jalan untuk membuatnya** — di server maupun di perangkat.

**Ketiadaannya adalah cacat, bukan fitur yang tertunda.** Saldo laci adalah
`saldo_awal + SUM(cash_movement.delta)` (`spec-d:14`). Owner yang mengambil
Rp 500.000 dari laci untuk membayar pemasok tidak punya cara mencatatnya, jadi
tutup kas **ditolak** sampai kasir mengarang alasan untuk selisih yang bukan
salahnya — dan Rp 500.000 melewati ambang Rp 20.000, jadi otorisasi manajer
dituntut juga, lalu laporan exception FR-G5 menandai kasirnya. Kedua sisinya
diuji langsung: shift yang identik dengan pencatatan menutup dengan selisih
**nol**, dan tanpa pencatatan dijawab `400 VARIANCE_REASON_REQUIRED`.

Ini bentuk **KEEMPAT** dari cacat yang `CLAUDE.md` catat tiga kali — laci yang
angkanya berbeda dari uang yang benar-benar ada di dalamnya. Tiga yang pertama
adalah uang yang tidak pernah masuk; ini uang yang keluar dengan sah dan tidak
pernah tercatat.

Rantainya: `packages/domain/src/kas-manual.ts` → `POST /shifts/{id}/cash-movements`
(server) **dan** `apps/kasir/src/kas/manual.ts` + `DialogKasManual` (perangkat,
offline) → `outbox_local` → relay.

### Keputusan yang mengikat kodenya

- ⛔ **`jumlah` selalu POSITIF; `arah` yang menurunkan tandanya**, di domain,
  satu tempat, dipakai server dan klien. Klien yang mengirim `-50000` untuk kas
  MASUK akan mengurangi laci yang seharusnya bertambah — angkanya benar,
  tandanya tidak, dan tutup kas menemukannya berjam-jam kemudian sebagai
  selisih dua kali lipat.
- ⛔ **`counterpart_type` diturunkan dari ALASAN, bukan dari arah** (FR-D6).
  "Ambil pemilik" dan "bayar pemasok" keduanya `paid_out` dengan jumlah yang
  sama; yang pertama `owner_draw` dan yang kedua `expense`. Pembukuan yang
  menyamakannya melaporkan biaya operasional yang tidak pernah terjadi.
  `lainnya` dan `koreksi_pencatatan` → `unidentified`, dan itu **jujur**:
  menebaknya `expense` membuat setiap koreksi kecil masuk laporan biaya.
- ⛔ **TANPA PIN manajer**, ditiru dari keputusan void 1 Agustus 2026. Orang
  yang mengambil uang dari laci sering satu-satunya orang yang ada, dan ia
  pemiliknya; penyetuju yang wajib berbeda dari aktor (`CHECK` di
  `audit_event`) membuat fiturnya mustahil dipakai justru oleh yang paling
  membutuhkannya — dan yang tidak dapat mencatat tetap mengambil uangnya.
  `[ASUMSI]` — `spec-d` hanya menyatakan alasannya wajib, bukan siapa yang
  boleh. Yang menjaganya `assertBoleh(shift_open_close)` (menutup akuntan,
  `spec-f:82`) + alasan daftar tertutup + audit.
- ⛔ **Nol ditolak.** Movement bernilai nol tidak memindahkan uang dan membuat
  buku kas memuat baris yang tidak menjelaskan apa pun — aturan yang sama
  dengan no-sale, yang justru TIDAK menulis `cash_movement` karena alasan itu.
- ⛔ **Shift TERTUTUP menolak movement baru (409).** Saldo dan selisihnya sudah
  dihitung dan disetujui; menambahkan baris sesudahnya mengubah angka yang
  seseorang sudah tanda tangani.
- ⛔ **Catatan wajib untuk `lainnya`** — `lainnya` adalah yang paling sering
  dipilih orang yang sedang terburu-buru, dan alasan bebas tanpa penjelasan
  adalah baris yang tidak dapat dibaca siapa pun enam bulan kemudian.
- **`setor_ke_bank` ada di daftar keluar** meski enum punya `bank_deposit`
  tersendiri: `spec-d:339` menunda fitur setoran, dan yang tidak boleh terjadi
  sementara itu adalah merchant yang menyetor ke bank tidak punya cara
  mencatatnya sama sekali. `counterpart_type` tetap `bank` supaya barisnya
  dapat ditemukan lagi bila `bank_deposit` kelak dibangun.

### Cacat yang ditemukan test transport, bukan review

Rute masuk `DIKECUALIKAN` (peta RBAC) tapi **tidak** ditandai `sesiOpsional`.
Akibatnya setiap kas masuk/keluar yang dicatat offline dijawab **401** dan
berhenti permanen di antrean — bentuk yang PERSIS sama dengan cacat refund
offline 21 Agustus, dan akibatnya lebih buruk: server tetap menghitung uang
yang sudah tidak ada di laci, lalu tutup kas berikutnya menuduh kasirnya atas
selisih yang justru sudah dicatat.

Yang menemukannya adalah aturan yang lahir dari cacat itu: **test yang memakai
`buatPengirimHttp` dan `klasifikasi` yang ASLI**, dengan hanya `fetch` yang
dipalsukan. Ke-16 test endpoint langsung hijau selama itu.

Penjaga `⛔ SETIAP jenis di RUTE_DIDUKUNG diuji lewat transport asli` juga
menyala — ia hanya melihat berkasnya sendiri, jadi `cash_movement` ditambahkan
di sana juga; rincian arah/tanda/idempotensi tetap di berkas terpisah.

### Kontrak dikoreksi, bukan test

`Idempotency-Key` sempat ditandai `required: true` — menyimpang dari setiap
endpoint idempoten lain di kontrak ini. Validator menjawab
`400 VALIDATION_ERROR` sementara yang dimaksud `MISSING_IDEMPOTENCY_KEY`
("muatan Anda cacat" mengirim klien memeriksa body yang sebenarnya benar), dan
ia membuat penjaga di handler tidak dapat dibedakan dari luar — bentuk
guard-yang-tidak-teruji yang `CLAUDE.md` catat pada penyetuju refund.

### Sabotase

Tiga, semuanya merah: tanda `delta` dibalik (domain + kasir), `counterpart`
diturunkan dari arah (domain + kasir), penolakan shift tertutup dimatikan
(server). `sesiOpsional` terbukti tanpa disengaja — ia merah sebelum ditambahkan.

### Verifikasi

Seluruh suite hijau. `test:server` 392 · `test:ordering` 192 · `test:catalog`
177 · `test:identity` 156 · `test:payment` 132 · `test:tenancy` 75 ·
`test:domain` 468 · `test:kasir` 435 · `test:backoffice` 419 ·
`test:sync-client` 103 · `test:isolation` 211 · `test:schema` 14 ·
`test:sqlite-local` 8 · `test:dst` 14 · `test:dst-server` 10 · `test:runtime` 3
· `test:oxlint-ds-adherence` 12. `lint:ds` bersih; kedua app build.

**Sisa 4 lubang FR-F6, dan tidak satu pun punya fiturnya:**
`shift_count_attempt` · `peripheral_configured` · `support_session_started` ·
`support_session_ended`.

---

## Task 35 — KEP-21 keranjang yang bertahan (24 Agustus 2026) ✅

Sampai sekarang keranjang K-03 hanya hidup di memori modul
(`kasir/simpanan.ts`). Tab yang ter-refresh, tablet yang mati baterai, atau
browser yang membuang tab di belakang membuat kasir memasukkan ulang seluruh
pesanan **di depan pelanggan yang sedang menunggu**. Bukan kehilangan uang —
tetapi kegagalan yang paling terlihat pelanggan.

### ⛔ Jalan yang TIDAK diambil, dan kenapa

`ERD` menyiapkan `order.status = 'open'` + `owned_by_device_id` untuk ini
(KEP-21). Jalan itu **tidak** dipakai: menulis baris `order` berarti
mengirimkannya ke server, dan order `open` yang tidak pernah dibayar muncul di
laporan sambil menuntut jalan penutupan yang belum ada. Ia juga tidak
dibutuhkan v1 — **berbagi order antar device saat offline adalah non-goal yang
DINYATAKAN** (`PRD` § 4, ditunda v1.1). Masalah yang sebenarnya ada adalah
"keranjang perangkat INI hilang saat dimuat ulang", dan untuk itu tabel lokal
sudah cukup.

Yang dibangun: tabel murni lokal `keranjang_lokal` (satu baris, kunci
konstan), `apps/kasir/src/kasir/keranjang-simpan.ts`, efek tulis + pemulihan
di K-03.

### Keputusan yang mengikat kodenya

- ⛔ **Pembersihan ada DI DALAM transaksi penjualan.** Membersihkannya sesudah
  commit meninggalkan jendela tempat perangkat dapat mati di antaranya, dan
  boot berikutnya memulihkan keranjang untuk penjualan yang **sudah tersimpan
  dan sudah dibayar** — kasir yang tidak menyadarinya menagih pelanggan
  berikutnya dua kali, tanpa satu pun error. Bentuk yang sama persis dengan
  alasan `simpanHlc` ada di dalam transaksi.
- ⛔ **`JSON.stringify` MELEMPAR pada `bigint`,** dan keranjang berdiskon punya
  dua (`minta.nilai`, `nominalDisetujui`). Tanpa replacer, keranjang berdiskon
  adalah **satu-satunya** yang tidak dapat disimpan — persis yang paling mahal
  dimasukkan ulang, karena ia menuntut PIN manajer lagi. Ditulis sebagai
  string, dibaca kembali menjadi `bigint`; `number` **ditolak** saat memulihkan
  (float tidak pernah masuk jalur uang).
- ⛔ **Keranjang milik shift LAIN tidak pernah dipulihkan, dan barisnya
  dibuang.** Kasir berikutnya yang menemukan pesanan pelanggan kemarin di
  layarnya akan menjualnya kepada orang yang salah.
- ⛔ **Penulisan baru dimulai SETELAH pemulihan selesai.** Efek yang menulis
  sejak render pertama menyimpan keranjang kosong lebih dulu — dan karena
  keranjang kosong menghapus barisnya, ia menghapus persis apa yang sedang
  dipulihkan. Urutannya yang menentukan, bukan keberadaan kodenya.
- ⛔ **Pemulihan DISEBUTKAN di layar.** Keranjang yang muncul sendiri tanpa
  penjelasan terbaca seperti pesanan pelanggan yang sedang berdiri di depan
  kasir. Dapat ditutup: peringatan yang menetap sepanjang shift berhenti
  dibaca.
- ⛔ **Isi yang rusak DIBUANG, tidak melempar.** Keranjang adalah kenyamanan;
  satu baris rusak tidak boleh membuat aplikasi kasir gagal boot. Diurai dengan
  pemeriksaan bentuk, bukan `JSON.parse` lalu dipercaya — barisnya ditulis
  versi aplikasi yang mungkin berbeda dari yang membacanya.
- ⛔ **Penyetuju tanpa nominalnya membuang diskonnya**, bukan memulihkannya
  setengah. Yang manajer setujui adalah ANGKANYA.
- **Kegagalan tulis DITELAN** (`ARCH:307`, aturan yang sama dengan `rekam()`):
  disk penuh tidak boleh menghentikan penjualan yang sedang berjalan.
- **K-06/K-07 TETAP tanpa URL.** Alasannya berubah, kesimpulannya tidak:
  memulihkan kasir langsung ke layar pembayaran menempatkannya di depan angka
  yang harus ditagih tanpa sempat memeriksa pesanan yang baru dipulihkan — dan
  pemulihan itu justru yang menuntut diperiksa.
- **`simpanan.ts` tetap memori-saja.** Ia dipanggil dari render React dan harus
  sinkron; menyembunyikan I/O di balik setter sinkron menghasilkan kegagalan
  tulis yang tidak dapat ditangani siapa pun.

### Penjaga migrasi diubah dari DAFTAR menjadi MEKANISME

`⛔ T5b tabel lokal yang hilang dibuat` menyebut `telemetry_local` dengan nama.
Itu benar untuk apa yang ia buktikan (indeksnya ikut), tapi ia tidak menjaga
tabel lokal BERIKUTNYA — dan `jalankanDdl` hanya berjalan saat sidik jari raw
table berubah, sementara sidik jari itu tidak menghitung tabel lokal. Tabel
lokal baru yang terlewat adalah `no such table` **permanen** di setiap
perangkat yang sudah terpasang. Test baru menyusuri seluruh `TABEL_LOKAL_SAJA`.
Pola yang sama dengan penjaga navigasi di Task 33.

### Sabotase

Empat, semuanya merah: pembersihan dipindah ke luar transaksi · penjaga shift
dimatikan · replacer bigint dihapus · `keranjang_lokal` dilepas dari
`TABEL_LOKAL_SAJA`.

### Verifikasi

`test:kasir` 450 · `test:domain` 468 · `test:backoffice` 419 ·
`test:sync-client` 103 · `test:sqlite-local` 8 · `test:dst` 14 ·
`test:runtime` 3 · `test:oxlint-ds-adherence` 12. `lint:ds` bersih; kasir build.
Suite server tidak tersentuh perubahan ini (tidak ada berkas server yang
diubah).

### Yang TIDAK ikut ditutup

**X6 tetap tidak dapat dibangun.** Ia menuntut jejak "item ditambah lalu
dihapus berkali-kali", dan keranjang yang bertahan hanya menyimpan
KEADAANNYA — bukan riwayat perubahannya. Menyimpan riwayatnya menuntut
telemetri yang memuat nama produk, yang `ARCH:309` larang. Batas yang
dinyatakan, tidak berubah.

**Catatan dokumen:** `CLAUDE.md` menulis FR-A8 (import katalog) "sengaja belum
digarap". Itu **stale** — `catalog/handlers/import.ts`, `tests/catalog/import.test.js`,
dan layar impor back-office semuanya ada. Barisnya dikoreksi.

---

## Task 36 — F.5 akses support (24 Agustus 2026) ✅

`spec-f:393`: *"Untuk mendukung ratusan merchant, akses support diperlukan —
tetapi harus menjadi fitur SISTEM, bukan akses database langsung."*

**Alternatif yang tidak dibangun adalah alternatif yang akan dipakai.** Staf
yang tidak punya jalan resmi akan diberi kredensial database, dan sejak saat
itu tidak ada satu pun baris yang mencatat siapa membaca apa milik merchant
mana.

Rantainya: `packages/domain/src/sesi-support.ts` → `support_session` (migrasi
`0034`) → `POST/GET /support-sessions` + `POST /support-sessions/{id}/end` →
penjaga token di `sesi.ts` → banner B-30 di seluruh layar back-office.

**Lubang FR-F6 4 → 2.** Yang tersisa: `shift_count_attempt` (menuntut jalur
tulis yang bertahan melewati rollback — perubahan rancangan) dan
`peripheral_configured` (utang F4, menunggu shell Tauri).

### Keempat AC, dan bagaimana masing-masing dibuat benar

**1. "Akses support tanpa persetujuan merchant tidak mungkin."** Bukan sesuatu
yang dijaga pemeriksaan — ia sifat BENTUKNYA. Token akses hanya ada sebagai
keluaran permintaan yang owner sendiri kirim, dan tidak dapat dibaca kembali
sesudahnya (yang tersimpan SHA-256-nya). Tidak ada endpoint mana pun yang
menerbitkan token support tanpa owner menekan tombolnya.

**2. "Sesi berakhir otomatis saat `expires_at`."** ⛔ Dihitung SAAT DIBACA,
bukan lewat pekerjaan terjadwal. Job pembersih yang tidak berjalan — deploy
gagal, worker mati — akan membiarkan akses hidup melewati batas yang merchant
setujui, tanpa siapa pun melihatnya. Yang dihitung saat dibaca tidak dapat
gagal berjalan.

**3. "Banner terlihat di semua layar."** Dirender di `App.tsx` di atas
`children` `AppShell` — ada di setiap layar tanpa satu pun dari mereka perlu
mengingatnya. Banner yang harus dipasang per layar akan hilang di layar
berikutnya. ⛔ Dan `GET /support-sessions` **tidak dijaga peran**: banner yang
hanya terlihat owner tidak memenuhi kalimat "seluruh layar", dan
menyembunyikannya dari staf berarti orang yang sedang bekerja di layar itu
tidak tahu siapa lagi yang sedang melihatnya.

**4. "Setiap tindakan selama sesi support tercatat dengan penanda."** Yang
paling mudah lulus secara HAMPA: test yang memeriksa `support_session_started`
membuktikan pemberian aksesnya tercatat, bukan bahwa TINDAKANNYA tercatat.
Yang diuji adalah baris audit dari perubahan katalog yang dilakukan LEWAT token
support — plus kontrol negatif bahwa tindakan yang sama tanpa sesi support
TIDAK ditandai (penanda yang selalu terisi tidak membedakan apa pun).

### Keputusan yang mengikat kodenya

- ⛔ **Penanda dipasang SEKALI lewat `AsyncLocalStorage`, bukan diteruskan ke
  ~20 pemanggil `recordAuditEvent`.** Penanda yang harus diingat 20 kali akan
  terlupa yang ke-21, dan yang terlupa menisbatkan tindakan support kepada
  OWNER MERCHANT secara pribadi — tuduhan yang diam. Bentuk kegagalan yang sama
  persis dengan yang membuat penjaga peran pindah ke satu hook. `node:async_hooks`
  stdlib, nol dependensi baru.
- ⛔ **`enterWith` dipanggil SINKRON di hook `onRequest` paling awal**, dalam
  hook tersendiri. Dipanggil dari dalam hook async (yang menunggu verifikasi
  token lebih dulu), storenya hanya mencakup kelanjutan hook itu dan hilang
  sebelum handler. Terukur, bukan dugaan: penandanya mendarat `null`.
- ⛔ **`support_session_id` adalah KOLOM, bukan jenis peristiwa tersendiri.**
  Tindakan selama sesi support adalah tindakan yang SAMA — `item_updated` tetap
  `item_updated` — dan memberinya nama lain berarti setiap laporan yang
  menyaring per jenis diam-diam melewatkan yang dilakukan support.
- ⛔ **`actor_user_id` tetap OWNER YANG MENYETUJUI.** Kolomnya `NOT NULL`
  ber-FK ke `"user"`, dan staf kami tidak punya baris di sana (`"user"`
  ber-`tenant_id` dan tunduk RLS). Owner itu memang orang yang bertanggung
  jawab atas akses ini; penandanya yang mencegah pembaca menyimpulkan ia
  melakukannya sendiri.
- ⛔ **`admin_label`, bukan `admin_user_id` yang `spec-f:405` tulis.** Kolom itu
  mengandaikan tabel pengguna STAF yang tidak ada — batas yang sama sudah
  dinyatakan untuk `tools/naikkan-tahap.mjs`. Ia teks bebas dan itu disengaja:
  ia bukan otentikasi, ia catatan tentang persetujuan siapa yang diberikan.
  Yang mengotentikasi adalah `token_hash`.
- ⛔ **Sesi support TETAP tunduk RBAC.** Ia meminjam peran owner yang
  menyetujui dan lewat penjaga peran seperti sesi lain; melewatinya akan
  membuat akses support satu-satunya jalan di sistem ini yang tidak tunduk RBAC
  sama sekali. Diuji: owner yang diturunkan menjadi kasir SESUDAH sesi dibuat
  membuat token yang sama ditolak `FORBIDDEN`.
- ⛔ **Mutasi diputuskan dari METODE HTTP, bukan dari peta operasi RBAC.** Peta
  itu tidak mencakup setiap rute, dan rute yang tidak ada di sana akan lolos
  gerbang tulis diam-diam. Metode mencakup semuanya, termasuk endpoint yang
  lahir bulan depan.
- ⛔ **Kedaluwarsa dijawab `403 SUPPORT_SESSION_EXPIRED`, bukan 401.** Petugas
  support yang menerima 401 untuk sesi yang baru saja kedaluwarsa akan
  menyimpulkan tokennya salah dan meminta merchant mengulang seluruh prosesnya.
- ⛔ **Read-only BAWAAN; menulis menuntut pilihan terpisah** (`spec-f:403`), dan
  konsekuensinya dinyatakan di layar SEBELUM owner memilihnya.
- ⛔ **Sesi aktif yang sudah ada menolak yang baru (409).** Dua token hidup
  untuk satu merchant berarti mengakhiri "sesi support" di layar tidak
  benar-benar memutus akses, dan owner tidak punya cara mengetahui ada yang
  kedua.
- ⛔ **Owner yang DINONAKTIFKAN mencabut sesi yang ia beri.** Persetujuan itu
  miliknya.
- ⛔ **Batas durasi ditegakkan CHECK constraint juga**, bukan hanya aplikasi.
  Bawaan 2 jam, maksimum 24 jam (`spec-f:400`); yang tidak disebut memakai
  BAWAAN, bukan maksimum — owner yang menyetujui tanpa memikirkan durasinya
  tidak boleh diberi jendela 24 jam.
- ⛔ **`support_grant` = {owner} SAJA.** Yang diberikan bukan akses ke satu
  outlet melainkan ke SELURUH data merchant; Manajer Outlet maupun Area Manager
  tidak dapat menyetujui pemberian yang cakupannya melampaui cakupan mereka.
- ⛔ **Token TIDAK masuk audit.** Jejaknya bertahan lima tahun; kredensial di
  dalamnya akan bertahan lima tahun juga.

### B-30 ditambahkan ke IA §3.3

Peta layar berhenti di B-29 sementara `spec-f:391` menuntut fiturnya ada.
Fitur yang dituntut spec dan tidak punya tempat di peta layar akan dibangun
sebagai tombol yang diselipkan ke layar lain, dan yang diselipkan tidak dapat
ditemukan merchant yang mencarinya. Penjaga navigasi yang menuntut setiap kode
sidebar ada di IA memaksa keputusan itu eksplisit alih-alih diam.

### Lima penjaga yang menyala, semuanya sebagai sinyal

`navigasi` (B-30 belum di IA) · `pengawasan-b22` (label peristiwa belum ada) ·
`rbac-penolakan` ("jumlah kasus MENUTUPI seluruh PETA_PERAN") · `tipe-divergen`
(`audit_event.support_session_id` kolom server baru tanpa keputusan tertulis) ·
`oxlint-ds-adherence` (`t-body-lg` bukan salah satu dari empat ukuran teks).

### Sabotase

Tiga, semuanya merah: sesi support melewati penjaga peran · gerbang read-only
dimatikan · penanda audit tidak dipasang.

### Verifikasi

Seluruh suite hijau. `test:domain` 484 · `test:kasir` 450 · `test:backoffice`
419 · `test:server` 412 · `test:isolation` 211 · `test:ordering` 192 ·
`test:catalog` 177 · `test:identity` 156 · `test:payment` 132 ·
`test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 · `test:dst` 14 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3 ·
`test:oxlint-ds-adherence` 12. `lint:ds` bersih; kedua app build.

### Batas yang dinyatakan

- **Petugas support tidak punya akun.** Token diserahkan owner kepadanya di
  luar sistem. Permukaan otentikasi staf tidak ada di produk ini — batas yang
  sama dengan `tools/naikkan-tahap.mjs`, dan membangunnya adalah keputusan
  tersendiri.
- **Tidak ada notifikasi ke merchant** saat sesi dimulai. Banner memenuhi
  `spec-f:401`; email/push adalah permukaan yang belum ada.
- **Sesi tidak dapat diperpanjang.** Yang habis waktunya digantikan sesi baru,
  dan itu berarti persetujuan baru — disengaja.

---

## Task 37 — penanda sesi support TERBACA di B-22 (24 Agustus 2026) ✅

Task 36 menulis `audit_event.support_session_id` dan tidak ada satu pun layar
yang membacanya. **Data yang tidak dibaca siapa pun bukan kontrol** — bentuk
yang sama dengan lima kolom `vertical_profile` yang Task 33 catat sebagai
"setelan yang tersimpan benar dan tidak mengubah apa pun".

`GET /audit-events` kini membawa `supportSessionId` + `supportAdmin` di setiap
baris, menerima `support_only=true`, dan B-22 menampilkannya di kolom Pelaku.

### Keputusan yang mengikat kodenya

- ⛔ **Penanda ikut di SETIAP baris, bukan hanya saat disaring.** `aktorId`
  pada baris support adalah **owner yang menyetujui** akses itu — nama yang
  benar secara faktual, dan yang akan dibaca sebagai "owner melakukannya
  sendiri" oleh siapa pun yang tidak melihat penandanya. Layar audit dibaca
  saat sengketa; kesalahan atribusi di sana menyangkut orang. Diuji dengan
  kontrol negatif: dua baris `item_created` berpelaku SAMA, satu bertanda satu
  tidak.
- ⛔ **`pelakuTampil` adalah kolom TERSENDIRI, bukan catatan kaki pada nama.**
  Baris non-support berbunyi "Budi — langsung", bukan kosong: sel kosong
  terbaca seperti data yang hilang, dan pembacanya tidak dapat membedakan
  "dilakukan langsung" dari "penandanya tidak terbaca".
- ⛔ **TIDAK ADA saringan yang MENYEMBUNYIKAN tindakan support.** Hanya
  `support_only=true` yang ada, dan enum kontraknya berisi tepat satu nilai.
  Audit yang dapat menyembunyikan sebagian dirinya bukan audit, dan yang paling
  ingin memakai saringan itu adalah pihak yang tindakannya sedang diperiksa.
  Dijaga test yang membaca BENTUK enum-nya.
- ⛔ **Saringan yang aktif ikut di respons dan disebutkan di atas tabel.**
  Aturan yang sudah ada di B-22; `hanyaSupport` mengikutinya.

### Test hampa yang ditemukan lewat sabotase, di test yang baru ditulis

Versi pertama membungkus assertion-nya dalam `if (res.statusCode === 200)`.
Karena enum kontrak menolak ketiga nilai yang diuji, **assertion-nya tidak
pernah berjalan sama sekali** — dan sabotase `q.support_only !== undefined`
lolos tanpa satu test merah.

Bentuk yang sama persis dengan 18 test `stock_movement` yang F3 temukan: test
yang memeriksa keadaan yang tidak dapat terjadi. Diganti menjadi assertion
tegas (400 untuk setiap nilai selain `true`) plus penjaga atas bentuk enum-nya;
sabotase yang sama kini merah.

⛔ **Response schema OpenAPI MEMBUANG properti yang tidak terdaftar.** Kolom
baru yang ditambahkan ke query tanpa didaftarkan di `responses` mendarat
`undefined` di klien, tanpa satu pun error di server. Ditemukan karena test
memeriksa NILAINYA, bukan bahwa kunci-nya ada.

### Verifikasi

Seluruh suite hijau. `test:domain` 484 · `test:kasir` 450 · `test:backoffice`
422 · `test:server` 414 · `test:isolation` 211 · `test:ordering` 192 ·
`test:catalog` 177 · `test:identity` 156 · `test:payment` 132 ·
`test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 · `test:dst` 14 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3 ·
`test:oxlint-ds-adherence` 12. `lint:ds` bersih; build ok.

---

## Task 38 — FR-C3 + QRIS dinamis di kasir, jalur ONLINE-FIRST (24 Agustus 2026) ✅

Dua FR yang saling mengunci: FR-C3 menuntut metode online-only tampil nonaktif
dengan alasan, dan itu hanya benar bila metodenya ADA lebih dulu. Keduanya
karena itu satu task.

### ⛔ Kenapa jalur ini terbalik dari setiap jalur lain di produk ini

Setiap penjualan lain menulis LOKAL lebih dulu lalu me-relay — itu yang membuat
kasir tetap dapat berjualan tanpa internet, dan itu seluruh nilai jual produk
ini. QRIS dinamis tidak dapat mengikutinya, dan bukan karena pilihan rancangan:
`spec-c:320` melarang sistem menandai lunas tanpa konfirmasi GATEWAY, dan
gateway hanya dapat dihubungi server kami. Perangkat tidak punya cara
mengetahui pelanggan sudah membayar.

```
cadangkan nomor struk (lokal)
  → POST /orders                  (draf, status `open` di server)
  → POST /orders/{id}/payments    (qris_dynamic → QR)
  → tampilkan QR, polling 2 dtk / maks 5 mnt
  → confirmed → simpanPenjualan({ draf })   ← satu transaksi lokal
```

### Keputusan yang mengikat kodenya

- ⛔ **`navigator.onLine === true` BUKAN bukti**, dan ini bukan kehati-hatian
  berlebihan. Browser melaporkan keadaan ANTARMUKA, bukan keterjangkauan: kafe
  yang Wi-Fi-nya menyala dengan uplink mati, captive portal yang belum
  di-login, dan DNS yang tidak menjawab semuanya melaporkan `true`. Ketiganya
  keadaan nyata di outlet, dan ketiganya membuat QRIS dinamis tampil aktif lalu
  gagal — persis yang `spec-c:272` larang. Arahnya asimetris: `false` **pasti**
  tidak terjangkau; `true` **belum tahu**, dan yang menjawabnya hanya
  permintaan yang benar-benar sampai ke `/health` SERVER KAMI.
- ⛔ **`memeriksa` diperlakukan sebagai TIDAK terjangkau.** Jendelanya satu
  probe; salah ke arah aman di sana tidak menghilangkan satu pun penjualan
  karena metode lain tetap aktif.
- ⛔ **Nomor struk dicadangkan SEBELUM QR diminta**, dan draf yang batal TIDAK
  menghapus ordernya. Server menuntut `receiptNumber` saat order dibuat dan
  counternya lokal; konsekuensinya pelanggan yang batal membakar satu nomor.
  Yang TIDAK boleh terjadi adalah LUBANG di urutan struk — 41 dan 43 ada
  sementara 42 tidak pernah ada di mana pun tidak dapat dijelaskan siapa pun
  saat diperiksa. Nomor yang melekat pada order `abandoned` jauh lebih baik.
- ⛔ **Payment lokal ditulis `qris_dynamic`, BUKAN `qris_static`.** Keduanya
  "QRIS" di mata kasir dan sangat berbeda di mata laporan: `qris_static`
  menandai `confirmed_manually`, dan FR-G5 memakainya sebagai sinyal exception.
  Menulis pembayaran yang GATEWAY konfirmasi sebagai dikonfirmasi-manual
  **menuduh kasir atas kontrol yang justru berjalan.** Saya hampir menulisnya
  begitu; yang menahannya adalah tipe `MetodeBayar` yang menolak.
- ⛔ **`draf` adalah SATU objek, bukan beberapa bendera.** Ia mengubah dua hal
  yang tidak pernah benar sendirian: identitas tidak di-generate ulang, dan
  outbox tidak diisi. Bendera yang dapat dinyalakan sebagian adalah bendera
  yang suatu hari dinyalakan sebagian — dan separuhnya menghasilkan order kedua
  untuk uang yang sama.
- ⛔ **Outbox dilewati karena PEMBAYARANNYA, bukan ordernya.** Order yang
  di-relay ulang dipantulkan idempotency key; pembayaran QRIS dinamis yang
  di-relay ulang meminta gateway menerbitkan **QR KEDUA untuk uang yang sudah
  diterima**.
- ⛔ **Draf BERTAHAN di perangkat** (`draf_qris_lokal`), dan disimpan SEBELUM
  gateway dipanggil — alasan yang sama persis dengan kenapa server meng-commit
  payment `pending_confirmation` lebih dulu. `spec-c:328` menuntutnya: aplikasi
  yang mati di tengah polling harus dapat melanjutkan.
- ⛔ **Timeout polling BUKAN gagal**, dan kalimat di layar mengatakannya. Kasir
  yang membaca "gagal" akan menagih ulang pelanggan yang mungkin sudah
  membayar. Statusnya tetap `pending`; `spec-c:307` menaruhnya di "Perlu
  diperiksa".
- ⛔ **"Batalkan" hanya ditawarkan saat kita TAHU uang tidak berpindah**
  (ditolak penerbit / QR kedaluwarsa). Selama masih `pending` yang tersedia
  adalah menutup layar — membatalkan draf yang pelanggannya sedang memindai
  berarti melepas stok untuk penjualan yang detik berikutnya lunas.
- ⛔ **Status gateway TAK DIKENAL dan kegagalan JARINGAN keduanya `pending`**,
  tidak pernah `confirmed` maupun `gagal`. Aturan yang sama dengan adapter
  gateway di server.
- **QR ditampilkan sebagai TEKS, bukan gambar.** Merender QR menuntut pustaka
  baru dan `CLAUDE.md` mengunci dependensi. Batas yang dinyatakan.

### `POST /orders/{id}/abandon` — endpoint baru

Pembersihan massal (`cleanup-abandoned`) baru menyentuh order `open` setelah
**24 jam** dan menuntut peran `stock_adjust`. Kasir yang membatalkan di depan
pelanggan tidak dapat menunggu keduanya, dan stok yang terkunci sehari membuat
produk berikutnya terlihat habis.

- ⛔ **`tinggalkanOrder` diekstrak menjadi SATU fungsi** yang dipakai
  pembersihan massal dan endpoint baru. Dua salinan aturan "apa artinya
  meninggalkan sebuah order" akan menyimpang, dan yang menyimpang meninggalkan
  stok terkunci atau audit yang tidak ditulis.
- ⛔ **`sale`, bukan `stock_adjust`.** Membatalkan satu draf yang kasir itu
  sendiri baru buat adalah bagian dari menjual; membebaskan stok SELURUH outlet
  dalam satu permintaan bukan.
- ⛔ **Order yang SUDAH dibayar ditolak 409.** Membatalkan transaksi lunas
  adalah void/refund — dengan restock, alasan daftar tertutup, dan baris
  pembatalnya sendiri. Jalan kedua ke sana tidak punya satu pun dari itu.
- ⛔ **`sesiOpsional`**, aturan yang sudah dua kali dilanggar sebelumnya
  (refund offline, kas manual). Tanpa itu pembatalan dijawab 401 dan stok tetap
  terkunci.

### Sabotase yang TIDAK menyala, dan apa yang dilakukan

Setelah semua test hijau, sabotase `const orderId = idBaru()` — perilaku paling
berbahaya di seluruh fitur ini — **lolos tanpa satu test merah**. Tidak ada
test yang menjalankan `simpanPenjualan` dengan `draf`.

Ditambahkan tujuh test untuk jalur draf, termasuk kontrol negatif bahwa jalur
NORMAL tetap mengisi outbox dan menaikkan counter. Ketiga sabotase kini merah:
identitas di-generate ulang · counter dinaikkan lagi · outbox tetap diisi.

### Verifikasi

Seluruh suite hijau. `test:domain` 492 · `test:kasir` 489 · `test:backoffice`
422 · `test:server` 420 · `test:isolation` 211 · `test:ordering` 192 ·
`test:catalog` 177 · `test:identity` 156 · `test:payment` 132 ·
`test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 · `test:dst` 14 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3 ·
`test:oxlint-ds-adherence` 12. `lint:ds` bersih; kasir build.

### Utang yang dinyatakan

- **Bentuk SQL `draf_qris_lokal` belum dijalankan di BROWSER.**
  `ON CONFLICT(id) DO UPDATE` diterima `node:sqlite`; bentuk tanpa aksi pernah
  DITOLAK `wa-sqlite` (8 Agustus 2026). Jalankan `apps/kasir/harness.html`
  sebelum mempercayainya di perangkat merchant.
- **QRIS dinamis belum dapat digabung** dengan metode lain (pembayaran
  campuran). `MetodeCampuran` sudah memuatnya sehingga aritmetikanya benar bila
  kelak digabung; yang belum ada adalah jalurnya.

---

## Task 39 — `shift_count_attempt`: jalur tulis kebal rollback (24 Agustus 2026) ✅

`spec-d:127`: *"Kasir tidak dapat mengubah hitungan fisik setelah melihat
selisih. Untuk mengoreksi, kasir memasukkan hitungan ulang yang tercatat
sebagai PERCOBAAN KEDUA di audit trail."*

**Lubang FR-F6 2 → 1.** Yang tersisa hanya `peripheral_configured` — utang F4
yang menunggu shell Tauri.

### ⛔ Kenapa ia tidak dapat ditulis dari dalam transaksi penutupan

Percobaan yang **DITOLAK** — selisih melewati ambang tanpa penyetuju — dilempar
`closeShift` SEBELUM satu pun `UPDATE`, dan seluruh transaksinya di-rollback.
Jejak yang ditulis di dalamnya ikut hilang.

Dan justru percobaan yang gagal itulah yang spec ingin buktikan tidak dapat
diulang diam-diam: kasir yang mencoba Rp 2.450.000, melihat selisihnya, lalu
mengetik Rp 2.485.000 supaya cocok, meninggalkan jejak **NOL** di jalur tutup
kas.

### Keputusan yang mengikat kodenya

- ⛔ **Endpoint TERSENDIRI (`POST /shifts/{id}/count-attempts`), dan ia TIDAK
  menyentuh `cash_drawer_shift` sama sekali.** Endpoint yang menulis percobaan
  DAN memperbarui shift akan menjadi jalan kedua menuju penutupan — tanpa
  pemeriksaan ambang, tanpa penyetuju, tanpa buku kas. Yang ditulis hanya
  JEJAK. Diuji dengan membandingkan seluruh baris shift sebelum dan sesudah.
- ⛔ **Di klien, satu transaksi yang BERDIRI SENDIRI** — riwayat lokal
  (`count_attempts`) dan jejak auditnya ditulis BERSAMA, tetapi tidak pernah
  bersarang di dalam transaksi `tutupKas`. Riwayat yang ada tanpa auditnya,
  atau sebaliknya, adalah dua angka yang harus dijaga sepakat dan tidak ada apa
  pun yang menjaganya.
- ⛔ **Shift yang SUDAH TERTUTUP tetap menerima percobaan.** Yang dikirim
  terlambat — perangkat yang antreannya baru terkuras — adalah jejak dari
  SEBELUM penutupan, dan menolaknya menghapus jejak justru pada perangkat yang
  paling lama offline.
- ⛔ **Tipe peristiwa DI-BIND sebagai parameter bertipe `PeristiwaAudit`**,
  bukan ditulis inline di string SQL. Nama yang dipaku di dalam string tidak
  diperiksa TypeScript terhadap kosakata tertutup, dan ejaan yang menyimpang
  tidak menghasilkan error — ia menghasilkan baris audit yang tidak pernah
  cocok dengan saringan mana pun. Ditemukan karena test tidak dapat
  memverifikasinya dari `params`.
- ⛔ **`konfig`/`sesi`/`idBaru`/`hlc` OPSIONAL di `catatHitungan`.** Tanpanya
  riwayat lokal TETAP tercatat — hanya jejak auditnya yang hilang. Membuatnya
  wajib berarti setiap pemanggil yang belum diperbarui berhenti mencatat
  percobaan sama sekali, dan itu kegagalan yang lebih besar daripada jejak yang
  belum lengkap. Ada kontrol negatif untuknya.
- ⛔ **`sesiOpsional` + `DIKECUALIKAN`**, keduanya. Aturan yang sudah tiga kali
  dilanggar sebelumnya (refund offline, kas manual, abandon).

### Batas AJV yang dinyatakan, bukan didiamkan

`countedAmount: 2450000` (NUMBER) **tidak ditolak** — koersi AJV mengubahnya
menjadi `"2450000"` sebelum handler melihatnya. Kelas yang sama dengan temuan
ambang otorisasi (`number` → `string`) dan telemetri (`null` → `0`). Yang MASIH
dijaga adalah nilainya: pecahan dan tanda negatif menghasilkan string yang
gagal regex. Test-nya menyatakan batas itu alih-alih berpura-pura menolaknya.

### Sabotase

Dua, keduanya merah: jejak audit dihapus dari `catatHitungan` · endpoint juga
memperbarui `cash_drawer_shift`.

### Verifikasi

Seluruh suite hijau. `test:kasir` 494 · `test:domain` 492 · `test:server` 427 ·
`test:backoffice` 422 · `test:isolation` 211 · `test:ordering` 193 ·
`test:catalog` 177 · `test:identity` 156 · `test:payment` 132 ·
`test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 · `test:dst` 14 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3 ·
`test:oxlint-ds-adherence` 12. `lint:ds` bersih; kedua app build.

---

## Task 40 — FR-A7 AC keempat: perangkat berharga basi (24 Agustus 2026) ✅

`spec-a:230`: *"Dashboard menampilkan device mana yang belum menerima perubahan
harga terakhir."* AC ini menunggu sync (F2) + laporan (Modul G); keduanya sudah
ada sejak lama, dan ACnya tidak pernah ditutup.

**Masalah yang dijawabnya:** `spec-a:220` menyatakan bahwa perangkat offline
yang memakai harga lama adalah **BENAR** — itulah harga yang tercetak dan
dibayar pelanggan. Yang TIDAK benar adalah merchant yang menaikkan harga lalu
tidak tahu bahwa satu kasirnya masih menjual dengan harga lama, berhari-hari,
tanpa satu pun error di mana pun.

### ⛔ "Terakhir terlihat" adalah PROKSI, dan arahnya SATU ARAH

Checkpoint PowerSync hidup di tabel `ps_*` MILIK PERANGKAT; server kami tidak
dapat membacanya. Yang server tahu hanya kapan perangkat terakhir meminta token
sinkronisasi.

- `last_seen_at < effective_from` → perangkat **PASTI** belum menerimanya.
- `last_seen_at >= effective_from` → **belum tentu** sudah.

Layar menyatakan asimetri itu, dan kalimatnya tampil **juga saat daftarnya
kosong**. Daftar kosong yang tidak disertai kalimat itu terbaca sebagai
jaminan — dan merchant akan membacanya begitu, kecuali layar mengatakan
sebaliknya.

### Keputusan yang mengikat kodenya

- ⛔ **`jumlahDiperiksa` ikut di respons DAN di kalimat kosongnya.** "Tidak ada
  yang tertinggal" dari NOL perangkat berarti hal yang sangat berbeda dari yang
  sama dari sepuluh perangkat.
- ⛔ **Harga MASA DEPAN tidak dihitung tertinggal.** Harga terjadwal belum
  berlaku untuk siapa pun; menghitungnya membuat setiap penjadwalan menandai
  SELURUH armada.
- ⛔ **Perangkat yang BELUM PERNAH terlihat ikut** — ia justru yang paling
  penting.
- ⛔ **Harga milik outlet LAIN tidak menandai perangkat outlet ini.**
- ⛔ **Panel mengambil datanya SENDIRI.** RBAC `price_edit` sementara dasbor
  dibaca peran lebih luas; menggabungkannya berarti seluruh dasbor 403 untuk
  manajer outlet. **403 dibedakan dari gagal**, dan "gagal" menyangkal
  kesimpulan "semua mutakhir" secara eksplisit.
- **Modul `reporting`** karena ia menjahit `device` (identity) dan
  `price_history` (catalog) — invariant #4.

### Test yang ekspektasinya salah, dan apa yang diajarkannya

Lima dari sebelas test gagal pada jalan pertama. Semuanya karena **harga AWAL
item adalah baris `price_history` juga** — `POST /items` menulisnya — sehingga
perangkat yang lama tidak terlihat tertinggal olehnya juga. Itu perilaku yang
BENAR; yang salah adalah ekspektasi saya. Setup ditua-kan alih-alih kodenya
dilonggarkan.

### Sabotase

Tiga, semuanya merah: batas masa depan dihapus · saringan outlet dihapus ·
`COALESCE` untuk perangkat yang belum pernah terlihat dihapus.

### Verifikasi

Seluruh suite hijau. `test:kasir` 494 · `test:domain` 492 · `test:server` 438 ·
`test:backoffice` 430 · `test:isolation` 211 · `test:ordering` 193 ·
`test:catalog` 177 · `test:identity` 156 · `test:payment` 132 ·
`test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 · `test:dst` 14 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3 ·
`test:oxlint-ds-adherence` 12. `lint:ds` bersih; build ok.

**FR-A7 AC ketiga masih terbuka** — `cost_at_sale` untuk laporan margin
menunggu keputusan FR-F5, yang user tahan.

---

## Task 41 — penjaga FR-F10: Owner tidak dikecualikan dari audit (24 Agustus 2026) ✅

Survei sistematis atas 77 FR di PRD menemukan lima yang tidak dirujuk satu
berkas pun. Empat ternyata sudah ditegakkan tanpa menyebut nomornya
(FR-A2 variasi wajib · FR-A4 kategori maksimal dua tingkat · FR-F9 daftar
tertutup feature flag menolak kunci yang menyebut audit · FR-G6 lihat Task
berikutnya). **FR-F10 tidak punya penjaga sama sekali.**

⛔ **Ia properti, bukan fitur** — dan properti yang tidak diuji adalah properti
yang rusak diam-diam. Tidak ada apa pun di `recordAuditEvent` yang memeriksa
peran, dan itulah yang membuat FR ini benar hari ini. Yang tidak ada adalah
sesuatu yang menahan pemeriksaan seperti itu ditambahkan besok.

`spec-f` menaruhnya sebagai FR tersendiri justru karena ia godaan yang wajar:
owner adalah pemilik datanya, dan "kenapa tindakan saya sendiri harus dicatat"
adalah pertanyaan yang akan diajukan seseorang. Jawabannya: audit trail dibaca
saat SENGKETA, dan sengketa yang paling mahal adalah antara owner dan rekan
pemiliknya atau investornya. Trail yang mengecualikan owner tidak dapat
menjawab satu pun dari keduanya — dan yang mengecualikan dirinya adalah orang
yang paling ingin dikecualikan.

Ditambahkan dua test: owner tercatat, dan **bentuk barisnya sama** untuk peran
apa pun (kontrol negatif — "owner tercatat" tidak boleh berarti "owner tercatat
berbeda").

**Sabotase:** `recordAuditEvent` mengecualikan owner → 18 dari 19 test merah.

---

## Task 42 — FR-G6: ringkasan harian untuk HP (24 Agustus 2026) ✅

`spec-g:212`: *"Persona P3 membuka aplikasi pukul 23:00 di HP 390×844 untuk
satu pertanyaan: hari ini bagaimana, dan apakah ada yang aneh."* Sampai hari
ini tidak ada satu pun endpoint yang menjawabnya dalam satu permintaan — yang
ada `GET /reports/sales` (rentang) dan `GET /reports/payments`, dan layar HP
yang menjahitnya sendiri menjadi tempat kedua yang memutuskan omzet.

Ditemukan lewat survei 77 FR yang sama dengan Task 41: FR-G6 tidak dirujuk satu
berkas pun.

### Keputusan yang mengikat kode

- ⛔ **Pembandingnya HARI YANG SAMA empat minggu ke belakang, bukan hari
  sebelumnya.** Omzet kafe pada Sabtu dan Selasa berbeda jauh, dan itu normal.
  Delta terhadap hari sebelumnya membuat **setiap Senin terlihat seperti
  bencana** dan setiap Jumat terlihat seperti rekor — dua sinyal palsu setiap
  minggu, selamanya, dan owner berhenti mempercayai panahnya dalam dua minggu.
  Testnya menyemai 23 Agustus dengan Rp 9.000.000: implementasi yang
  membandingkan ke "kemarin" meleset jauh, terlihat, dan merah.
- ⛔ **`deltaPersen: null` BERBEDA dari `0`.** Merchant yang baru dua minggu
  berjualan tidak punya empat Senin sebelumnya; "0%" untuknya adalah pernyataan
  yang **salah** — ia mengaku omzet hari ini persis sama dengan kebiasaannya,
  dan kebiasaan itu belum ada. Bentuk cacat yang sama dengan `null` vs `0` pada
  MDR dan pada ringkasan stok lintas outlet.
- ⛔ **Hari pembanding yang TIDAK ADA tidak dihitung nol.** Outlet yang tutup
  pada satu Senin tidak punya baris untuk hari itu; memperlakukannya sebagai
  omzet nol menyeret rata-rata ke bawah, lalu Senin berikutnya terlihat naik
  puluhan persen karena outletnya kebetulan buka. `basisMinggu` ikut di respons
  supaya layar dapat menyatakan seberapa kasar pembandingnya.
- ⛔ **Minimum DUA hari pembanding, bukan empat.** `[ASUMSI]` — `spec-g` menyebut
  "rata-rata 4 minggu terakhir" tanpa menyatakan apa yang terjadi bila belum ada
  empat. Menuntut empat berarti merchant baru tidak melihat panah apa pun selama
  sebulan penuh, persis periode ia paling ingin tahu apakah dagangannya tumbuh.
- ⛔ **Pembandingnya diambil PER HARI, bukan sebagai satu rentang.** Satu query
  `from..to` mengembalikan rata-rata 28 hari — angka yang membuat setiap Senin
  terlihat seperti bencana dan setiap Sabtu seperti rekor, cacat yang sama
  bentuknya dengan yang aturan hari-sama ada untuk mencegahnya. Empat pembacaan
  kecil, bukan satu yang salah.
- ⛔ **Angkanya dari `ambilPenjualan`/`ambilPembayaran` yang SAMA** dengan
  `/reports/sales` dan `/reports/payments`. Testnya `assert.equal` terhadap
  respons `/reports/sales`, bukan terhadap angka tulisan tangan — aturan yang
  sama yang membuat B-01 memakai `posisi-penjualan.ts`. Yang owner lihat pukul
  23:00 adalah yang paling jarang diperiksa ulang.
- ⛔ **`rataRataPerTransaksi: null` untuk NOL transaksi.** "Rp 0 per transaksi"
  mengaku ada transaksi yang nilainya nol.
- **`arah: 'datar'` HANYA untuk selisih nol.** Ambang "kekecilan" adalah angka
  yang harus dipilih seseorang dan tidak ada di dokumen mana pun — jadi ia tidak
  dikarang di kode. Panah untuk 0,3% tetap jujur; layar dapat memilih tidak
  menonjolkannya.
- **`perMetode` memakai `totalDiterima`, bukan omzet** — uang yang benar-benar
  masuk per saluran. Keduanya berbeda saat ada pembayaran campuran, dan owner
  yang menjumlahkan baris metode berharap mendapat uang yang ia terima.
- **Modul `reporting`** karena ia menjahit penjualan dan pembayaran dalam satu
  pertanyaan (invariant #4). `ambilPembayaran` diekspor dari `ordering/index.ts`
  untuk itu.

### Masalah + solusinya

Delapan test baru gagal serentak pada jalan pertama — termasuk yang hanya
memeriksa 400. Keserentakan itu sinyalnya: `ReferenceError: hdr is not
defined`, bukan delapan bug logika. Helper header di berkas itu selama ini
tertanam di dalam `laporan()`; diekstrak menjadi `hdr()` dan dipakai keduanya.
Satu ekspektasi lain juga salah — `/reports/sales` membungkus angkanya di bawah
kunci `penjualan`.

### Sabotase

Tiga, semuanya merah:

| Sabotase | Yang merah |
|---|---|
| pembanding `i * 7` → `i` (hari sebelumnya) | 4 test, termasuk dua di server |
| `deltaPersen: null` → `0` saat data kurang | 2 test |
| hari nol-transaksi ikut dihitung | 2 test |

### Verifikasi

Seluruh suite hijau, dijalankan berurutan: `test:kasir` 494 · `test:domain` 506
· `test:server` 448 · `test:backoffice` 430 · `test:isolation` 211 ·
`test:ordering` 193 · `test:catalog` 177 · `test:identity` 156 · `test:payment`
132 · `test:sync-client` 103 · `test:tenancy` 75 · `test:schema` 14 ·
`test:dst` 14 · `test:oxlint-ds-adherence` 12 · `test:dst-server` 10 ·
`test:sqlite-local` 8 · `test:runtime` 3. `typecheck` dan `lint:ds` bersih.

**Batas yang dinyatakan:** yang dibangun adalah **datanya**, bukan layarnya.
M-01 hidup di aplikasi HP owner yang belum ada sama sekali (`apps/` hanya punya
`backoffice`, `kasir`, `server`) — itu task berikutnya.

---

## Task 43 — apps/hp: aplikasi Owner mobile, M-00 dan M-01 (24 Agustus 2026) ✅

`IA:§4` mendaftarkan empat layar Owner mobile untuk v1 (M-00…M-03) dan
`apps/` hanya berisi `backoffice`, `kasir`, `server`. Permukaan ketiga tidak
ada sama sekali — dan FR-G6 yang baru ditutup Task 42 adalah datanya, tanpa
satu pun layar yang membacanya.

Task ini menutup **M-00 dan M-01**. M-02 dan M-03 menyusul; alasannya di bawah.

### Tiga pemindahan, dan kenapa memindahkan bukan menyalin

Aplikasi ketiga membuat tiga modul menjadi milik bersama. Semuanya **dipindah**,
tidak satu pun disalin:

| Dari | Ke | Kenapa |
|---|---|---|
| `apps/backoffice/src/{http,sesi-simpanan}.ts` + `sesi.tsx` | `packages/klien-api/src/` | `IA:245`: kredensial M-00 SAMA dengan back-office. Dua klien sesi yang menyimpang menghasilkan aplikasi yang berhenti dari sesi yang masih hidup — atau lebih buruk, tetap menampilkan layar dengan sesi yang sudah mati |
| `rupiah`/`bacaRupiah` dari `katalog/produk.ts` | `packages/domain/src/uang-tampilan.ts` | Format uang adalah aturan produk (`CLAUDE.md`), bukan selera. Yang ditulis ulang per layar menyimpang di tepiannya — nilai besar, negatif, dan hilang: tepat tiga keadaan yang paling perlu dibaca benar |
| `LABEL_METODE`/`LABEL_STATUS_BAYAR` dari `penjualan/b03.ts` | `packages/domain/src/metode-tampilan.ts` | Ringkasan HP merinci pembayaran per metode. Dua peta yang menyimpang membuat HP menyebut saluran berbeda dari back-office untuk hari yang sama |

⛔ **`apps/kasir/src/cetak/metode.ts` SENGAJA tetap terpisah** — nama di struk
dipendekkan karena struk 58 mm hanya 32 kolom, dan "QRIS (dinamis)" tidak muat
di sana. Batasnya dinyatakan di kedua berkas.

⛔ **Utang yang dinyatakan:** `apps/kasir` masih punya **delapan** salinan
pemformat uang sendiri (`Rp ${n.toLocaleString('id-ID')}`, satu per layar). Ia
menerima `number` alih-alih `bigint` dan TIDAK menghasilkan `−` untuk negatif.
Menyatukannya menyentuh setiap layar uang di aplikasi kasir dan karena itu
task tersendiri, bukan efek samping task ini.

### Keputusan yang mengikat kode

- ⛔ **"Hari ini" diputuskan SERVER, bukan jam HP.** `date` di
  `GET /reports/daily-summary` menjadi OPSIONAL; dikosongkan berarti hari ini,
  dan server menghitung tanggal bisnisnya dari `now()` database, zona outlet,
  dan jam tutupnya lewat `tanggalBisnis` yang kasir pakai. FR-F8 ada di produk
  ini justru karena jam perangkat berbohong cukup sering untuk perlu
  dideteksi; HP yang jamnya maju satu hari akan meminta ringkasan hari yang
  belum terjadi lalu menerima **nol transaksi tanpa satu pun error**, dan owner
  menyimpulkan outletnya tidak berjualan.
- ⛔ **Tanpa `outlet_id`, "hari ini" hanya dijawab bila SELURUH outlet aktif
  sepakat** zona waktu DAN jam tutupnya. Indonesia punya tiga zona waktu;
  pukul 23:00 di Jayapura masih pukul 21:00 di Jakarta, dan angka gabungan
  memuat dua tanggal bisnis berbeda. Dijawab `400 BUSINESS_DATE_AMBIGUOUS`
  dengan instruksi memilih outlet — bentuk yang sama dengan keputusan
  "ringkasan stok `null` tanpa `outlet_id`". Outlet yang DIARSIPKAN tidak ikut
  membuatnya ambigu.
- ⛔ **`date` KOSONG tetap ditolak**, berbeda dari `date` yang tidak dikirim.
  String kosong berarti klien bermaksud menyebut tanggal dan gagal;
  memperlakukannya sebagai "hari ini" menyembunyikan bug klien di balik jawaban
  yang terlihat masuk akal.
- ⛔ **Setiap angka bertanda membawa KATANYA** (aturan DS #5). Panah hijau ke
  atas pada omzet yang turun dibaca sekilas sebagai kabar baik, dan layar ini
  memang dibaca sekilas. Besaran ditampilkan **tanpa tandanya** — "−12,3% lebih
  rendah" adalah negasi ganda yang dibaca cepat berarti naik.
- ⛔ **`deltaPersen: null` dirender "belum dapat dibandingkan", DENGAN
  alasannya.** Tanpa sebab ia terbaca seperti kerusakan; dengan sebab ia
  terbaca seperti fakta tentang usia merchant itu sendiri. Pembandingnya
  DISEBUT ("hari yang sama"), bukan disingkat jadi "biasanya" — owner yang
  mengasumsikan kemarin akan menyimpulkan Senin yang normal sebagai bencana.
- ⛔ **`pesanLayar` SATU fungsi untuk keempat keadaan bukan-siap**, pola yang
  sama dengan `pesanLaporan` (B-21) dan `pesanPanel` (panel harga basi). Yang
  paling berbahaya: kegagalan jaringan yang terbaca seperti "outlet Anda tidak
  berjualan hari ini". "Gagal" karena itu MENYANGKAL kesimpulan itu secara
  eksplisit, dan "Coba lagi" hanya ditawarkan pada keadaan yang mencoba lagi
  dapat memperbaikinya.
- ⛔ **`CATATAN_ANTREAN` selalu tampil, juga saat angkanya lengkap.** Penjualan
  offline baru mendarat saat perangkatnya terhubung, jadi angka di layar adalah
  apa yang SUDAH SAMPAI, bukan apa yang terjual. Owner yang tidak diberi tahu
  akan menelepon kasirnya tentang omzet yang ada di antrean sebuah tablet.
- ⛔ **Tanggal diurai sebagai TEKS, bukan lewat `new Date()`.**
  `new Date('2026-08-24')` adalah tengah malam UTC, dan `getDate()` atasnya
  mengembalikan 23 untuk setiap zona di sebelah barat Greenwich.
- ⛔ **Bilah nav bawah TIDAK dibangun sekarang.** `IA:§4.2` menggambar
  `[Laporan] [Otorisasi]` dan keduanya belum ada di v1 — Otorisasi adalah M-04
  (`IA:251`, ditunda), Laporan adalah M-03. Tab yang menuju layar yang tidak
  ada terbaca sebagai aplikasi rusak, bukan sebagai fitur yang ditunda; ia
  lahir bersama M-03.
- **Tanpa pendaftaran dan tanpa field "ID Tenant" di M-00.** Yang mendaftarkan
  usaha melakukannya di laptop. Batas yang dinyatakan: email yang terdaftar di
  dua tenant tidak dapat masuk lewat HP.
- **Bukan PWA.** `IA:445` masih membukanya sebagai pertanyaan dan tidak ada
  dokumen yang memutuskannya; manifest dan service worker kelak tidak mengubah
  satu pun layar.

### Masalah + solusinya

- **Ekstraksi `rupiah` ikut menyeret `bacaDesimal`** (ia tetangga blok yang
  sama, dan bukan uang). Dikembalikan ke `produk.ts`; `produk.ts` sendiri
  memakai `bacaRupiah`, jadi ia mengimpornya dari lokasi baru.
- **`HttpError` diimpor dari `errors.ts` yang tidak ada** — berkasnya
  `http-error.ts`. Seluruh berkas test merah serentak, dan keserentakan itu
  sinyalnya: satu kegagalan modul, bukan dua puluh bug.
- **Satu test memakai helper yang mengirim `date=` kosong** padahal ia
  bermaksud MENGHILANGKAN `date`. Perbedaan keduanya justru yang diuji test
  berikutnya, jadi yang diperbaiki testnya.
- **Assertion "tanpa tanda minus" menandai kalimat yang benar** — `rata-rata`
  mengandung tanda hubung. Dipersempit ke tanda yang tepat di depan angka.

### Sabotase

Dua, keduanya merah: penjaga ambiguitas zona dilepas (2 test) · outlet
terarsip ikut dihitung (1 test).

### Verifikasi

Seluruh suite hijau, berurutan: `test:domain` 506 · `test:kasir` 494 ·
`test:server` 454 · `test:backoffice` 430 · `test:isolation` 211 ·
`test:ordering` 193 · `test:catalog` 177 · `test:identity` 156 ·
`test:payment` 132 · `test:sync-client` 103 · `test:tenancy` 75 · **`test:hp`
20** · `test:schema` 14 · `test:dst` 14 · `test:oxlint-ds-adherence` 12 ·
`test:dst-server` 10 · `test:sqlite-local` 8 · `test:runtime` 3.
`typecheck` (kini termasuk `apps/hp`) dan `lint:ds` bersih; `vite build`
aplikasi HP berhasil.
