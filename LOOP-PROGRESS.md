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
