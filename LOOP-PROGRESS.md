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
