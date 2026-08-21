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
| 6 | Modul C-3 — rekonsiliasi & ekspor | P1 | belum |
| 7 | Paginasi + pencarian katalog sisi server | utang G1 | selesai (server) |
| 8 | Refund parsial dengan pemilihan baris di UI | utang F2 | belum |
| 9 | K-16 buka laci · K-17 scanner | utang F2 | belum |
| 10 | **F6** — runbook | `ARCH:400` | selesai |
| 11 | **F6** — observability sisi server | `ARCH:294` | selesai (sisi server) |
| 12 | **F6** — alat koreksi append-only | `ARCH:400` | belum |

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
