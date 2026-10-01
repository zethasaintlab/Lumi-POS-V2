# Uang, pembayaran, dan kas — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

**Yang TIDAK termasuk, dan tercatat sebagai utang:** enkripsi at-rest (menunggu Tauri, F4). (FR-F5 ditutup 25 Agustus 2026 — lihat § FR-F5.) (FR-H8, Modul C-3, refund parsial dengan pemilihan baris, K-16 buka laci, dan K-17 scanner sudah ditutup, 21 Agustus 2026; FR-D5 kas masuk/keluar 24 Agustus 2026.)

**Kas masuk & kas keluar (FR-D5) ditutup 24 Agustus 2026.** `spec-d:189` mendaftarkan `paid_in`/`paid_out` di enum `cash_movement` sejak awal dan `spec-d:202` menetapkan aturannya; sampai hari itu tidak ada satu pun jalan untuk membuatnya, di server maupun di perangkat.

⛔ **Ketiadaannya adalah bentuk KEEMPAT dari cacat "laci yang angkanya berbeda dari uang di dalamnya".** Tiga yang pertama adalah uang yang tidak pernah masuk; ini uang yang keluar dengan sah dan tidak pernah tercatat. Owner yang mengambil Rp 500.000 untuk membayar pemasok membuat tutup kas **ditolak** (`VARIANCE_REASON_REQUIRED`) sampai kasir mengarang alasan untuk selisih yang bukan salahnya — dan Rp 500.000 melewati ambang, jadi otorisasi manajer dituntut juga, lalu FR-G5 menandai kasirnya. Kedua sisinya diuji langsung: shift identik DENGAN pencatatan menutup dengan selisih **nol**.

- ⛔ **`jumlah` selalu POSITIF; `arah` yang menurunkan tandanya** (`packages/domain/src/kas-manual.ts`), dipakai server dan klien. Klien yang mengirim `-50000` untuk kas MASUK mengurangi laci yang seharusnya bertambah — angkanya benar, tandanya tidak, dan tutup kas menemukannya berjam-jam kemudian sebagai selisih dua kali lipat. Klien karena itu mengirim `{arah, jumlah}`, **bukan** `delta` bertanda: dua tempat yang menurunkan tanda akan menyimpang.
- ⛔ **`counterpart_type` diturunkan dari ALASAN, bukan dari arah** (FR-D6). "Ambil pemilik" dan "bayar pemasok" keduanya `paid_out` dengan jumlah yang sama; yang pertama `owner_draw`, yang kedua `expense`. Pembukuan yang menyamakannya melaporkan biaya operasional yang tidak pernah terjadi. `lainnya`/`koreksi_pencatatan` → `unidentified`, dan itu **jujur** — menebaknya `expense` membuat setiap koreksi kecil masuk laporan biaya.
- ⛔ **TANPA PIN manajer**, ditiru dari keputusan void 1 Agustus 2026. Orang yang mengambil uang dari laci sering satu-satunya orang yang ada, dan ia pemiliknya; penyetuju yang wajib berbeda dari aktor (`CHECK` di `audit_event`) membuat fiturnya mustahil dipakai justru oleh yang paling membutuhkannya — dan yang tidak dapat mencatat tetap mengambil uangnya. `[ASUMSI]`; yang menjaganya `assertBoleh(shift_open_close)` + alasan daftar tertutup + audit.
- ⛔ **Nol ditolak**, alasan yang sama dengan no-sale yang justru TIDAK menulis `cash_movement`: movement bernilai nol membuat buku kas memuat baris yang tidak menjelaskan apa pun. **Shift TERTUTUP menolak 409** — saldo dan selisihnya sudah ditandatangani seseorang.
- ⛔ **Rute jalur perangkat wajib `sesiOpsional`, bukan sekadar `DIKECUALIKAN`.** Ia sempat hanya yang kedua, dan akibatnya setiap kas masuk/keluar yang dicatat offline dijawab **401** lalu berhenti permanen di antrean — bentuk PERSIS sama dengan cacat refund offline 21 Agustus. Yang menemukannya adalah aturan yang lahir dari cacat itu: test yang memakai `buatPengirimHttp` dan `klasifikasi` yang ASLI. Ke-16 test endpoint langsung hijau selama itu.
- **`setor_ke_bank` ada di daftar keluar** meski enum punya `bank_deposit` tersendiri: `spec-d:339` menunda fitur setoran, dan yang tidak boleh terjadi sementara itu adalah merchant yang menyetor ke bank tidak punya cara mencatatnya sama sekali. `counterpart_type` tetap `bank` supaya barisnya dapat ditemukan lagi bila `bank_deposit` kelak dibangun.

**Percobaan hitungan kas (FR-D2, `shift_count_attempt`) ditutup 24 Agustus 2026** lewat jalur tulis yang **berdiri sendiri**.

⛔ **Ia tidak dapat ditulis dari dalam transaksi penutupan.** Percobaan yang DITOLAK — selisih melewati ambang tanpa penyetuju — dilempar `closeShift` SEBELUM satu pun `UPDATE`, dan seluruh transaksinya di-rollback. Dan justru percobaan yang gagal itulah yang `spec-d:127` ingin buktikan tidak dapat diulang diam-diam: kasir yang mencoba Rp 2.450.000, melihat selisihnya, lalu mengetik Rp 2.485.000 supaya cocok, meninggalkan jejak **NOL**.

- ⛔ **`POST /shifts/{id}/count-attempts` TIDAK menyentuh `cash_drawer_shift` sama sekali.** Endpoint yang menulis percobaan DAN memperbarui shift menjadi jalan kedua menuju penutupan — tanpa pemeriksaan ambang, tanpa penyetuju, tanpa buku kas. Yang ditulis hanya JEJAK; diuji dengan membandingkan seluruh baris shift sebelum dan sesudah.
- ⛔ **Di klien, satu transaksi yang BERDIRI SENDIRI** — riwayat lokal dan jejak auditnya ditulis BERSAMA, tapi tidak pernah bersarang di dalam transaksi `tutupKas`.
- ⛔ **Shift yang SUDAH TERTUTUP tetap menerima percobaan.** Yang dikirim terlambat adalah jejak dari SEBELUM penutupan; menolaknya menghapus jejak justru pada perangkat yang paling lama offline.
- ⛔ **Tipe peristiwa DI-BIND sebagai parameter bertipe `PeristiwaAudit`**, bukan inline di string SQL — nama yang dipaku di dalam string tidak diperiksa TypeScript terhadap kosakata tertutup.
- **Batas AJV yang dinyatakan:** `countedAmount` bertipe `number` TIDAK ditolak — koersi AJV mengubahnya menjadi string sebelum handler melihatnya. Kemunculan KETIGA kelas ini (ambang otorisasi, telemetri). Yang masih dijaga adalah nilainya: pecahan dan negatif gagal regex.

**Keputusan yang mengikat K-16 (FR-D7) dan K-17:**

- ⛔ **Yang dicatat no-sale adalah PERINTAH sistem, bukan bukti laci terbuka.** `spec-d:231`: sinyalnya **satu arah** — sistem tidak tahu apakah laci benar-benar terbuka, dan **tidak dapat mendeteksi laci yang dibuka manual dengan kunci**. AC FR-D7 kelima menuntut ini dinyatakan ke merchant; ia ada di layar, runbook §8.5, dan kontrak endpoint.
- ⛔ **Ambang no-sale dihitung dari `audit_event`, bukan dari kolom hitungan.** Kolom hitungan adalah angka kedua yang harus dijaga sepakat dengan jejaknya, dan yang menyimpang di antaranya tidak dapat diputuskan mana yang benar. Pembukaan **KEEMPAT** yang menuntut PIN (`AMBANG_NO_SALE = 3` berarti tiga yang bebas).
- ⛔ **No-sale TIDAK menulis `cash_movement`** — ia tidak memindahkan uang, dan movement bernilai nol membuat buku kas memuat baris yang tidak menjelaskan apa pun.
- ⛔ **RBAC no-sale ada di `DIKECUALIKAN`, bukan `PETA_PERAN`.** Setiap entri `PETA_PERAN` diuji MENOLAK kasir, sementara kasir justru BOLEH membuka laci (`IA:66`). Yang menjaganya `assertBoleh(shift_open_close)` di handler — menutup akuntan (`spec-f:82`) — plus ambang frekuensi.
- ⛔ **Scanner: `cariBarcode` BUKAN `cariItem`.** Pencarian menyaring daftar untuk dilihat kasir; scan memutuskan SATU produk tanpa kasir melihat apa pun. Barcode ganda **tidak memilih siapa pun** — menebak berarti setengah penjualan produk itu tercatat pada produk lain, tanpa satu pun error.
- ⛔ **Listener scanner global TIDAK menangkap ketukan di kolom teks.** PIN di K-01/K-11 diketik cepat dan diakhiri Enter — bentuk yang PERSIS sama dengan scan.
- ⛔ **`X-Actor-Id` diabaikan sepenuhnya di rute terlindungi** (`getActorId`: "sesi menang"). Test yang mengganti header itu untuk menguji peran lain sebenarnya menguji pemilik sesi — ditemukan lewat test "akuntan ditolak" yang hijau dengan status **201**. Pakai `buatSesi`.

**Keputusan yang mengikat refund parsial (FR-B7, 21 Agustus 2026):**

- ⛔ **Nilai refund BUKAN jumlah `order_line.line_total`.** `line_total` belum kena pajak eksklusif sementara `order.total` sudah; menjumlahkannya mengembalikan uang **lebih sedikit** daripada yang pelanggan bayar, dan salahnya diam. Untuk pajak inklusif ia justru sudah termasuk — tidak ada satu rumus penjumlahan yang benar untuk keduanya. Yang dipakai: `allocateProportionally(order.total, line_total[])` di `packages/domain/src/pilihan-refund.ts`, sehingga memilih seluruh baris mengembalikan **tepat** `order.total`.
- ⛔ **Batas per baris diturunkan per VARIASI**, meniru `planRestock` server. `stock_movement` tidak menyimpan `line_id`, jadi kebenaran per baris tidak ada di mana pun; yang dijamin adalah jumlahnya per variasi tidak melebihi yang server izinkan.
- **Pilihan bermula KOSONG.** `lines: []` sah — uang kembali tanpa barang kembali. Memulai penuh membuat restock jadi bawaan diam-diam, dan stok yang mengembang baru ketahuan saat opname.
- ⛔ **Kosakata `stock_movement.type` klien kini SAMA dengan server.** Klien sempat menulis `void_return`/`refund_return` — nilai yang `CHECK` di server tolak. Ia tidak pernah gagal karena barisnya murni lokal dan skema lokal tanpa CHECK, tapi `stock_movement` sudah terdaftar sebagai raw table: hari ia masuk sync rules, dua kosakata untuk satu peristiwa menjadi laporan yang menghitung sebagian pengembalian dan melewatkan sisanya. Dijaga `tests/kasir/kosakata-stock-movement.test.js`.

Gate F0 (lihat `HANDOFF.md` untuk bukti per item):
- [x] Skema PostgreSQL + RLS berjalan (`db/migrations/0001–0014`)
- [x] **Test isolasi lintas-tenant hijau untuk setiap tabel** — `npm run test:isolation`
- [x] Skema SQLite lokal berjalan (`db/local/001-initial.sql`) — `npm run test:sqlite-local` hijau
- [x] Font Inter di-self-host (mengganti `@import` Google Fonts) — ⛔ digantikan Nunito Sans sejak kampanye Hidupkan desain, 26 September 2026 (`docs/RENCANA-HIDUPKAN-DESAIN.md`, `docs/DESIGN.md` § 2); baris ini tetap sebagai riwayat pencapaian gate F0 pada tanggalnya, bukan keadaan font saat ini
- [x] Header COOP/COEP di-set (`apps/kasir/vite.config.ts` + `tauri.conf.json`)
- [x] `_adherence.oxlintrc.json` masuk CI — `npm run lint:ds` hijau, `.github/workflows/lint-ds.yml`
- [x] Aplikasi kosong berjalan di Tauri dengan token design system terpasang
- [x] **DST menembak server sungguhan juga** — `npm run test:dst-server`: Fastify + PostgreSQL lewat transport yang sama cacatnya, invariant diperiksa terhadap baris database. Iterasinya jauh lebih sedikit; yang dicari ikatan ke implementasi, bukan kedalaman ruang keadaan
- [x] **Harness DST ada dan gate-nya hijau** — `npm run test:dst`, 10.000 iterasi fault injection, nol pelanggaran. **Sepuluh** invariant: I1–I8 dari `prototypes/02-dst-sinkronisasi/FINDINGS.md`, lalu **I9 urutan kausal** dan **I10 monotonisitas HLC per perangkat** yang lahir bersama FR-H5 (8 Agustus 2026). Tiap perangkat punya jamnya sendiri, saling geser dan sesekali mundur — sebelumnya ketiganya berbagi satu jam, jadi HLC dihitung lalu diabaikan. Ketujuh mode cacat tinggal permanen sebagai bukti invariantnya tidak kosong
- [x] **SQLite WASM+OPFS berjalan di browser — diukur 7 Agustus 2026** (`prototypes/03-sqlite-opfs/FINDINGS.md`). Paket `@sqlite.org/sqlite-wasm`. **Temuan yang membalik asumsi: VFS `opfs-sahpool` 71× lebih cepat menulis daripada VFS `opfs`, dan tidak butuh COOP/COEP.** Dua tab tidak dapat sama-sama menulis (`NoModificationAllowedError`) — pola satu-penulis WAJIB. `storage.persisted()` = `false`: data lokal dapat dihapus browser. Belum diukur di Android/iOS

Status F1 sekarang:

- **Sub-project 1 — endpoint REST inti: selesai.** 28 operasi REST atas `category`, `item`/`item_variation`, `modifier_list`/`modifier`, `item_modifier_list` (`docs/superpowers/plans/PLAN-katalog-rest-inti.md`). Menutup FR-A1/A2/A4/A6/A9 di sisi backend.
- **Sub-project 2 — FR-A7 harga per outlet dan riwayatnya: selesai sebagian** (`docs/superpowers/plans/PLAN-katalog-harga-riwayat.md`). 4 operasi REST atas `price_history`, resolver tangga tiga tingkat diekspor lewat `catalog/index.ts` untuk dipakai Modul B, migrasi `0016` (index resolusi).

**FR-A7 AC keempat ditutup 24 Agustus 2026** — `GET /reports/stale-price-devices` + panel di B-01.

⛔ **"Terakhir terlihat" adalah PROKSI, bukan bukti, dan arahnya SATU ARAH.** Checkpoint PowerSync hidup di tabel `ps_*` MILIK PERANGKAT; server kami tidak dapat membacanya. Yang server tahu hanya `device.last_seen_at` (diperbarui saat perangkat meminta token sync). Jadi `last_seen_at < effective_from` berarti perangkat **PASTI** belum menerimanya, sementara sebaliknya **belum tentu** sudah. Layar menyatakan asimetri itu, dan kalimatnya tampil **juga saat daftarnya kosong** — daftar kosong yang tidak disertai kalimat itu terbaca sebagai jaminan.

- ⛔ **`jumlahDiperiksa` ikut di respons.** "Tidak ada yang tertinggal" dari NOL perangkat berarti hal yang sangat berbeda dari yang sama dari sepuluh perangkat, dan keduanya terlihat sama.
- ⛔ **Harga ber-`effective_from` di MASA DEPAN tidak dihitung tertinggal.** Harga terjadwal belum berlaku untuk siapa pun; menghitungnya membuat setiap penjadwalan menandai SELURUH armada sebagai basi.
- ⛔ **Perangkat yang BELUM PERNAH terlihat ikut**, lewat `COALESCE(last_seen_at, '-infinity')` — ia justru yang paling penting: perangkat yang baru didaftarkan dan tidak pernah menyala tidak akan pernah memakai harga apa pun yang benar.
- ⛔ **Harga milik outlet LAIN tidak menandai perangkat outlet ini** (tangga tiga tingkat). Laporan yang menandai armada untuk perubahan yang tidak berlaku baginya berhenti dipercaya.
- ⛔ **Panel mengambil datanya SENDIRI, bukan ikut respons dasbor.** RBAC-nya `price_edit` sementara dasbor dibaca peran yang lebih luas; menggabungkannya berarti seluruh dasbor dijawab 403 untuk manajer outlet. **403 dibedakan dari gagal** di layar.
- **Harga AWAL item adalah baris `price_history` juga**, jadi perangkat yang lama tidak terlihat tertinggal olehnya. Benar, dan ditemukan lewat test yang ekspektasinya salah.

**FR-G6 ditutup 25 Agustus 2026** — `GET /reports/daily-summary` + `GET /reports/needs-attention` + `apps/hp`. Rinciannya di § G2.

**FR-F5 dan FR-A7 AC ketiga ditutup 25 Agustus 2026** (keputusan user).

⛔ **`cost` TIDAK PERNAH turun ke perangkat, dan servernya yang men-snapshot.** Ia margin modal milik owner; perangkat kasir yang memegangnya adalah kebocoran yang tidak dapat ditarik kembali begitu satu tablet hilang. `item_variation.cost` ada di `KOLOM_SENGAJA_TIDAK_TURUN`, dan `POST /orders` mengambil nilainya dari katalog lewat `getVariationSnapshot` saat order masuk.

- ⛔ **Nilai dari KLIEN diabaikan sepenuhnya.** `order_line` lokal PUNYA kolom `cost_at_sale` dan klien menulis nol ke sana; jalur naik yang kelak menyertakannya akan mengirim nol, dan nol yang dipercaya menghasilkan **margin 100%** untuk setiap produk. Angkanya terlihat meyakinkan, dan owner memutuskan harga jual berdasarkan itu.
- ⛔ **Snapshot BEKU.** `spec-a:227`: laporan margin historis memakai `cost_at_sale`, bukan `cost` katalog hari ini. Merchant yang harga belinya naik pekan depan tidak boleh mendapati margin bulan lalu ikut berubah — laporan yang jawabannya berubah tanpa satu pun transaksi berubah tidak dapat dipakai memutuskan apa pun.
- ⛔ **Kolom margin HILANG untuk yang tidak berhak, bukan bernilai `null`** (`spec-g:99`). Kolom kosong tetap memberi tahu bahwa margin ada dan tidak boleh dilihat.
- ⛔ **`view_margin` TIDAK menolak permintaannya.** `spec-g:86` menandai laporan produk tersedia di perangkat kasir; 403 di sana akan menutup seluruh laporan demi satu kolom. Yang berubah hanya kolomnya, dan `margin: boolean` di respons **menyatakannya** — layar yang menyimpulkannya dari baris pertama akan menyembunyikan kolom untuk owner pada periode tanpa penjualan.
- ⛔ **Baris ber-HPP NOL dihitung dan DISEBUTKAN** (`barisTanpaHpp`). Nol dapat berarti "belum diisi" atau "memang tanpa biaya", dan keduanya menghasilkan margin 100%; layar menyatakan arah kesalahannya ("angka di bawah lebih tinggi dari yang sebenarnya").
- ⛔ **Margin NEGATIF tidak di-clamp**, dan persennya membawa kata "rugi" — "−60%" di kolom bernama Margin dibaca sekilas sebagai enam puluh persen, dan baris yang rugi adalah tepat yang paling perlu dilihat.
- **Ekspor CSV TANPA margin**, batas yang dinyatakan: kolom yang berubah menurut peran pengekspor menghasilkan dua berkas bernama sama dengan isi berbeda, dan akuntan merchant tidak punya cara mengetahui mana yang ia pegang.

**FR-A5 ditutup bersama B-09** · **FR-A3 ditutup 22 Agustus 2026** · **FR-A8 (import katalog) sudah ada** — `catalog/handlers/import.ts` + layar impor back-office.

**Keputusan yang mengikat kode pemilihan modifier (FR-A3):**

- ⛔ **Aturannya di `packages/domain/src/modifier-pilihan.ts`, bukan di komponen React.** `spec-a:117` menulis tabelnya sebagai "perilaku di layar kasir" dan itu benar, tapi aturannya bukan tata letak: `max_selections = 3` yang dilanggar menghasilkan `order_line_modifier` yang tidak dapat dibuat barista. Yang hanya dapat diuji lewat DOM biasanya tidak diuji sama sekali.
- ⛔ **Batas menghitung UNIT, bukan baris.** `Extra Shot ×2` dihitung dua; menghitung baris membuat `max_selections = 3` meloloskan enam shot lewat tiga baris ber-qty 2. `[ASUMSI]` — `spec-a` tidak menyatakan interaksi `max_selections` dengan `allow_duplicate`.
- ⛔ **Pilihan yang melewati batas DINONAKTIFKAN** (`spec-a:126`: "bukan menerima lalu menolak"), dan batasnya ikut terlihat di legend. Kasir yang tombolnya mati tanpa penjelasan menyimpulkan aplikasinya rusak.
- ⛔ **`is_required` dan `min_selections` adalah SATU pertanyaan**, yang berlaku yang lebih besar. Dua sumber untuk satu pertanyaan menghasilkan dialog yang menolak karena alasan yang tidak ditampilkannya.
- ⛔ **Kuantitas modifier masuk SIDIK JARI keranjang.** Tanpa itu "Extra Shot ×1" dan "×2" digabung jadi satu baris — pelanggan kedua menerima kopi pelanggan pertama, dan totalnya salah tanpa error.
- ⛔ **`ModifierTerpilih` terpisah dari `ModifierPilihan` katalog.** `bawaan` sifat katalog, `qtyMilli` sifat pilihan; satu tipe untuk keduanya membuat `bawaan` ikut tersimpan ke keranjang dan terkirim ke server sebagai bagian dari pesanan.
- ⛔ **`order_line.modifier_snapshot` lokal kini `[{nama, qtyMilli}]`, dan parsernya menerima TIGA bentuk.** Baris lama ada di perangkat merchant dan tidak dapat ditulis ulang — `order_line` tidak pernah di-`UPDATE` (invariant #2). ⛔ Bentuk ini **berbeda** dari snapshot server (`[{id, modifierId, name, price, quantityMilli}]`), dan **hari yang diramalkan itu tiba 29 Agustus 2026** saat `order_line` masuk sync rules: tanpa bentuk ketiga, `nama` bernilai `undefined` dan K-08 menampilkan kata **`"undefined"`** sebagai nama modifier untuk setiap baris yang dipulihkan dari server — di layar yang dipakai memutuskan refund, tanpa satu pun error. Bentuk klien menang bila keduanya ada.
- **Server TIDAK menegakkan aturan ini.** `POST /orders` menerima modifier apa adanya; menegakkannya di sana menuntut server membaca `modifier_list` pada setiap penjualan, dan aturannya dapat berubah setelah order antre offline berjam-jam. Batas yang dinyatakan.

Sisa Modul B: tidak ada yang belum digarap. **FR-B11 ditutup** bersama antrean `print_job` (tombol cetak ulang di K-09). **FR-B8/B9 ditutup 22 Agustus 2026** — server + domain lebih dulu, lalu layar kasir; keputusannya di § diskon di bawah.

**Keputusan yang mengikat kode diskon (FR-B8/B9):**

- ⛔ **Sebelum ini `order_discount` SELALU NOL.** Kolomnya ada sejak F0 dan `computeOrderTotals` sudah menghitungnya sejak Modul C, tapi `POST /orders` menulis nol ke sana — tidak ada satu pun jalan bagi merchant untuk memberi diskon, dan tidak ada satu pun test yang merah karenanya.
- ⛔ **Ambang diputuskan dari NILAI RUPIAH, bukan dari bentuk yang diketik kasir.** `spec-b:273` menulis "> 20% **atau** > Rp 50.000", dan keduanya berlaku apa pun bentuk masukannya. Memeriksa satu bentuk saja membuat setengah ambang tidak pernah menyala — dan yang tidak menyala adalah yang dipakai untuk melewatinya. Perbandingannya **perkalian silang**: pembagian bigint memotong, dan 20,004% akan terbaca persis 20% lalu lolos.
- ⛔ **Ambang dihitung dari subtotal SERVER**, dan **turun ke perangkat** supaya aturannya berlaku offline. Klien yang tidak tahu ambangnya menerapkan diskon 90% tanpa satu pun PIN, lalu server menolaknya berjam-jam kemudian — saat uangnya sudah diterima. Kolomnya kemunculan KEEMPAT kelas cacat `numeric → INTEGER berskala`.
- ⛔ **Persetujuan manajer berlaku untuk ANGKA yang ia lihat, bukan untuk persentasenya** (`DiskonKeranjang.nominalDisetujui`). Manajer menyetujui 30% dari Rp 100.000 — Rp 30.000 — lalu kasir menambah barang senilai Rp 900.000 dan potongannya menjadi Rp 300.000 dengan persetujuan yang sama. Potongan yang **tumbuh** melewatinya menuntut persetujuan baru; yang **mengecil** tidak. `approverId` tanpa `nominalDisetujui` tidak menutup apa pun.
- ⛔ **`statusDiskon` adalah SATU fungsi untuk layar dan untuk jalur penulisan.** K-03 memakainya untuk memberi tahu kasir sebelum ia menekan Bayar; `simpanPenjualan` memakainya untuk menolak. Dua salinan menghasilkan layar yang berkata "siap" pada penjualan yang ditolak sendiri.
- ⛔ **Klien mengirim PERMINTAAN (`{tipe, nilai}`), bukan nominalnya.** Server menghitung ulang dari subtotalnya sendiri; itu yang membuat pemeriksaan selisih FR-H6 dapat membedakan perangkat berharga basi dari angka yang dikarang.
- ⛔ **Penjualan berdiskon di atas ambang TIDAK ditulis tanpa penyetuju.** Berbeda dari selisih hitungan (`spec-h:95`, "tidak pernah menolak transaksi"): di sana uangnya sudah diterima merchant, di sini kasir belum menerima apa pun. `approver_id` dibekukan di `outbox_local` — tanpanya diskon offline dijawab `403` lalu berhenti permanen di antrean, bentuk cacat yang sama persis dengan refund offline.
- ⛔ **403 `APPROVAL_REQUIRED`, bukan 400.** Permintaannya tidak cacat, ia hanya belum disetujui; kasir yang menerima 400 akan mengira ia salah memasukkan angka.
- ⛔ **Alasan dituntut untuk SETIAP diskon**, bukan hanya yang melewati ambang, dan audit ditulis untuk keduanya. Pola diskon kecil yang berulang adalah persis yang laporan exception FR-G5 ada untuk menemukannya.
- ⛔ **Digit desimal persen DITURUNKAN dari skalanya.** "15%" adalah rate 0,15, berskala 10.000 ia `1500` — jadi angka persennya berskala `SKALA_TARIF / 100`, tepat dua digit. Koma dan titik sama-sama diterima; nominal rupiah tidak menerima desimal sama sekali.
- **Struk mencetak diskonnya.** `computeOrderTotals` tidak mengurangi `subtotal`, jadi `diskon: 0` yang sempat dipaku di jalur cetak menghasilkan struk bersubtotal 20.000 dan TOTAL 20.900 tanpa baris yang menjelaskan selisihnya.
- **Diskon PER BARIS tidak dibangun.** `spec-b:267` menyebutnya dan `order_line.discount_amount` ada di skema, tapi `POST /orders` hanya menerima diskon tingkat order. Batas yang dinyatakan.

**Modul C sub-project 1 selesai** (`docs/superpowers/plans/PLAN-pembayaran-pajak.md`): `TaxCalculator`, REST `tax_rate`, dan pembayaran tunai. `OPEN` → `PAID` → `CLOSED` kini hidup. Menutup FR-C6, C7, C8, C9, C11, dan FR-C1/C2 untuk tunai.

**Modul C sub-project 2 — gateway: selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md` §5.7). QRIS dinamis lewat port `PaymentProvider`, QRIS statis, EDC, endpoint cek status, dan webhook Midtrans. Menutup sisa FR-C2, FR-C4, FR-C5, dan FR-C14.

**Keputusan yang mengikat kode gateway:**

- **Port `PaymentProvider` wajib, bukan pilihan gaya.** CI mengisi `MIDTRANS_SERVER_KEY` dengan string kosong, jadi **tidak ada satu pun test yang boleh menyentuh jaringan**. Adapter dipilih di `buildApp` lewat `PAYMENT_PROVIDER` (invariant #5); `midtrans` dengan kunci kosong **gagal saat boot**, bukan saat pelanggan pertama membayar.
- **Status gateway tak dikenal → `pending`, tidak pernah `confirmed`.** `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi; menebak ke arah lain berarti menandai lunas berdasarkan kata yang tidak dimengerti.
- **QRIS dinamis memakai DUA transaksi** — satu-satunya jalur di repo ini yang begitu. Payment `pending_confirmation` ditulis dan di-commit **sebelum** gateway dipanggil, karena kegagalan gateway di dalam transaksi akan me-rollback satu-satunya jejak bahwa QR pernah diminta — sementara pelanggan mungkin sudah membayar (FR-C14). Ini tidak melanggar invariant #1: inisiasi QRIS bukan penjualan yang selesai, dan `sumConfirmed` mengabaikan payment `pending_confirmation` sepenuhnya.
- **Idempotency key gateway hanya diselesaikan bila gateway menjawab.** Kalau ia diselesaikan juga saat gateway gagal, retry dengan key yang sama menerima respons "tanpa QR" dari cache selamanya. Ini yang membuat `IdempotencyRecord.completed` perlu ada — `response_status ?? 200` membuat klaim yang belum selesai tidak dapat dibedakan dari sukses ber-body kosong.
- **QRIS statis dan EDC langsung `confirmed`, dan itu bukan pelanggaran `spec-c:320`** — aturan itu berbunyi "tanpa konfirmasi dari **gateway**" dan berlaku untuk pembayaran yang punya gateway. Yang mengonfirmasi keduanya adalah orang. `confirmed_manually` menandai bahwa tidak ada sistem yang memverifikasi (FR-G5 memakainya), dan diisi `true` hanya untuk `qris_static`.
- **Webhook adalah satu-satunya endpoint tanpa `X-Tenant-Id`.** Signature diverifikasi sebelum satu query pun jalan; tenant dibaca dari `custom_field1` lalu dipakai sebagai `app.tenant_id`, sehingga pencariannya tetap tunduk RLS. Kunci kosong → `503`, bukan diterima apa adanya.
- **Redaksi log dipasang di lapisan logging** (`logMethod` pino), bukan dipanggil dari tiap handler — AC FR-C5 ketiga menuntut kata itu. Ia menyaring bentuk nomor kartu **dan** nilai rahasia yang didaftarkan saat boot; penyaringan berbasis nama field saja tidak menangkap kunci yang menyelinap ke pesan error.

**Modul C sub-project 3 — rekonsiliasi & ekspor: selesai** (21 Agustus 2026). FR-C12 dan FR-C13, keduanya P1. `IA:§3.3` menamai B-19 "Laporan Pembayaran **& Rekonsiliasi**" sejak awal; kata kedua itu kini punya kode di baliknya.

**Keputusan yang mengikat kode rekonsiliasi:**

- ⛔ **MDR bukan pajak.** Ia hidup di `packages/domain/src/mdr.ts`, bukan di `tax.ts` — biaya jasa akuisisi yang tidak masuk `order.tax_amount`, tidak muncul di struk, dan tidak mengubah satu pun angka di `order`. Tarifnya `bigint` berskala 10.000, konvensi yang sama dengan `tax_rate.rate`.
- ⛔ **`null` BERBEDA dari `0`, dan perbedaannya sampai ke layar.** `0` = diperkirakan tidak dipotong (UMI ≤ Rp 500.000); `null` = metode itu tidak punya perkiraan sama sekali. Kartu EDC masuk yang kedua — tarifnya per-acquirer dan `spec-c` tidak memberikan satu pun angkanya. Layar menulis "— tidak ada perkiraan", CSV menulis sel kosong. "Rp 0" untuk kartu adalah pernyataan yang **salah**.
- ⛔ **`payment.mdr_estimated` SNAPSHOT**, ditulis di transaksi pembayaran. Menghitungnya saat dibaca membuat dua ekspor untuk periode yang sama berbeda begitu kategori atau tarif regulator berubah. Konsekuensinya dinyatakan: memperbaiki `tenant.merchant_category` **tidak** mengubah baris lama.
- ⛔ **Angka kepala rekapitulasi dari `posisiPenjualan`**, lewat `rekapPenjualan` di berkas yang sama. AC FR-C13 kedua menuntut totalnya cocok dengan laporan penjualan; memakai fungsi yang sama membuat itu benar menurut **konstruksi**, dan testnya `assert.deepEqual` terhadap respons `GET /reports/sales`.
- ⛔ **Pajak dipisah dari kolom SNAPSHOT** `order_line.tax_rate_name` (`0022`) dan `order_line.tax_jurisdiction` (`0028`), bukan JOIN ke `tax_rate`. Tarif yang di-rename setelah pelaporan tidak boleh mengubah rekapitulasi periode yang sudah dilaporkan.
- **`tax_jurisdiction` sengaja TIDAK turun ke perangkat.** Menambah kolom raw table mengubah sidik jari skema lokal, dan itu menuntut `disconnectAndClear()` + unduh ulang katalog di setiap perangkat merchant — biaya nyata untuk kolom yang tidak satu pun layar kasir baca.
- **`totalServiceCharge` masih selalu NOL**: `POST /orders` menulis literal `0` ke `service_charge_amount` (TERVERIFIKASI 2 September 2026). ⛔ **`totalDiskonOrder` TIDAK lagi nol sejak FR-B8/B9 (22 Agustus 2026)** — kalimat ini menyebut keduanya sampai 2 September dan sudah salah selama sebelas hari. Keduanya tetap dilaporkan karena `spec-c:444` menyebutnya. ⛔ Test integrasi untuk keduanya akan hijau karena **hampa**; aturannya diuji di `tests/domain/posisi-penjualan.test.js`.
- **XLSX tidak dibuat.** `spec-c:444` menulis "CSV + XLSX"; XLSX menuntut dependensi baru dan CSV terbuka apa adanya di Excel dan Google Sheets. Batas yang dinyatakan.

**K-06 menerima QRIS statis dan EDC, 22 Agustus 2026.** Server menerima keempat metode sejak sub-project 2; yang tidak ada adalah jalan bagi KASIR memakainya — `MetodeBayar` di klien secara harfiah `'cash'`, jadi merchant yang pelanggannya membayar QRIS mencatatnya sebagai tunai dan saldo laci berbohong sebesar seluruh omzet QRIS.

**Keputusan yang mengikat kode pembayaran di perangkat:**

- ⛔ **Aturan validasi QRIS statis dan EDC hidup di `packages/domain/src/pembayaran-manual.ts`, dan SERVER memakainya juga.** Keduanya berfungsi offline; aturan yang hanya hidup di server berarti kasir mengetik referensi kosong, penjualan tersimpan, dan barisnya berhenti `gagal-permanen` di antrean berjam-jam kemudian — bentuk cacat yang sama dengan refund offline. Kode galatnya ikut dikembalikan: `POSSIBLE_CARD_NUMBER` berbeda dari `VALIDATION_ERROR`, dan menyamakannya membuang satu-satunya sinyal bahwa seseorang mengetik nomor kartu ke POS.
- ⛔ **Non-tunai TIDAK menulis `cash_movement`.** Laci yang naik pada setiap penjualan QRIS membuat tutup kas menuntut otorisasi manajer untuk selisih yang tidak pernah ada — cacat yang PERSIS sama bentuknya dengan yang F3 temukan pada refund tunai, arahnya terbalik.
- ⛔ **Pembulatan tunai berhenti tanpa syarat** (FR-C9). Sebelum metode kedua lahir, membulatkan selalu kebetulan benar; QRIS memindahkan angka, bukan lembaran.
- ⛔ **`tendered_amount` dan `change_amount` NULL untuk non-tunai.** Mengisinya sama dengan `amount` membuat laporan tidak dapat membedakan uang yang benar-benar diserahkan dari nominal transaksi, dan `spec-d:201` memakai perbedaan itu.
- ⛔ **Muatan outbox berbeda PER METODE.** Kartu yang membawa `tenderedAmount` terlihat seperti tunai di setiap laporan yang membacanya.
- ⛔ **`card_last4` dipotong di titik MASUKNYA di layar**, bukan hanya ditolak saat simpan. Membiarkan digit kelima masuk state berarti nomor kartu sempat ada di dalam aplikasi.
- **`LABEL_METODE` satu sumber** (`cetak/metode.ts`), dipakai cetakan pertama dan cetak ulang. Dua peta nama yang menyimpang menghasilkan struk kedua yang menyebut metode berbeda — tepat yang `spec-b:145` larang.

**Pembayaran campuran (FR-C1) ditutup 22 Agustus 2026.** Keputusan yang mengikat kodenya:

- ⛔ **Yang dibulatkan SISA TUNAI setelah bagian non-tunai** (`spec-c:181`), bukan totalnya. Total 93.555 dengan QRIS 50.020 menagih tunai 43.500; membulatkan total lebih dulu menagih 43.580 — 80 rupiah per transaksi. Aturannya di `packages/domain/src/pembayaran-campuran.ts`, dan ia menerima seluruh bagian sekaligus karena menghitung per bagian berarti membulatkan sisa yang belum lengkap.
- ⛔ **Bagian TUNAI dikirim TERAKHIR, dengan rantai `depends_on` eksplisit.** Server menghitung nominal tunai dari `total − SUM(confirmed)` lalu membulatkannya: tunai yang mendarat lebih dulu menagih SELURUH total dan menutup ordernya, lalu bagian QRIS berikutnya **ditolak** — untuk penjualan yang sempurna. Urutan antar-baris outbox tidak dijamin apa pun kecuali `depends_on`.
- ⛔ **`delta` laci adalah BAGIAN TUNAI-nya, bukan `amount_due`.** Kemunculan KETIGA cacat yang sama: `amount_due` pada pembayaran campuran memuat uang yang masuk lewat bank.
- ⛔ **Satu baris `payment` per bagian.** Menggabungkan dua metode menjadi satu baris membuat rekonsiliasi FR-C12 tidak dapat memisahkan uang bank dari uang laci — dua saluran yang settlement-nya berbeda hari.
- ⛔ **Kelebihan bayar non-tunai DITOLAK** (`spec-c:225`), dengan angkanya. Hanya SATU bagian tunai per transaksi.
- ⛔ **`hitungKeranjang` adalah satu fungsi untuk layar dan jalur penulisan.** K-06 harus menampilkan TOTAL sebelum kasir membaginya, dan subtotal belum kena pajak.
- **Penjualan tetap ditulis hanya saat LUNAS.** Order `open` yang tidak pernah dibayar akan muncul di laporan dan belum punya jalan penutupan (KEP-21).

**Modul C selesai. FR-C3 + QRIS dinamis di kasir ditutup 24 Agustus 2026** lewat jalur penjualan **ONLINE-FIRST** — satu-satunya jalur di repo ini yang menulis ke server lebih dulu.

```
cadangkan nomor struk (lokal) → POST /orders (draf, `open`)
  → POST /orders/{id}/payments (qris_dynamic → QR) → polling 2 dtk / maks 5 mnt
  → confirmed → simpanPenjualan({ draf })   ← satu transaksi lokal
```

- ⛔ **`navigator.onLine === true` BUKAN bukti.** Browser melaporkan keadaan ANTARMUKA, bukan keterjangkauan: kafe yang Wi-Fi-nya menyala dengan uplink mati, captive portal yang belum di-login, dan DNS yang tidak menjawab semuanya melaporkan `true`. Ketiganya keadaan nyata di outlet, dan ketiganya membuat QRIS dinamis tampil AKTIF lalu gagal — persis yang `spec-c:272` larang. Arahnya asimetris: `false` **pasti** tidak terjangkau; `true` **belum tahu**, dan yang menjawabnya hanya permintaan yang benar-benar sampai ke `/health` **server kami** (`apps/kasir/src/lokal/keterjangkauan.ts`). `memeriksa` diperlakukan sebagai tidak terjangkau.
- ⛔ **Nomor struk dicadangkan SEBELUM QR diminta**, dan draf yang batal TIDAK menghapus ordernya. Server menuntut `receiptNumber` saat order dibuat dan counternya lokal; pelanggan yang batal membakar satu nomor. Yang tidak boleh terjadi adalah **LUBANG di urutan struk** — 41 dan 43 ada sementara 42 tidak pernah ada di mana pun tidak dapat dijelaskan siapa pun saat diperiksa. Nomor yang melekat pada order `abandoned` jauh lebih baik.
- ⛔ **Payment lokal ditulis `qris_dynamic`, BUKAN `qris_static`.** Keduanya "QRIS" di mata kasir dan sangat berbeda di mata laporan: `qris_static` menandai `confirmed_manually`, dan FR-G5 memakainya sebagai sinyal exception. Menulis pembayaran yang GATEWAY konfirmasi sebagai dikonfirmasi-manual **menuduh kasir atas kontrol yang justru berjalan.**
- ⛔ **`draf` adalah SATU objek, bukan beberapa bendera.** Ia mengubah dua hal yang tidak pernah benar sendirian: identitas tidak di-generate ulang, dan outbox tidak diisi. Outbox dilewati karena PEMBAYARANNYA — relay ulang QRIS dinamis meminta gateway menerbitkan **QR KEDUA untuk uang yang sudah diterima**.
- ⛔ **Draf BERTAHAN di perangkat** (`draf_qris_lokal`, murni lokal) dan disimpan **sebelum** gateway dipanggil — alasan yang sama persis dengan commit `pending_confirmation` di server. `spec-c:328` menuntutnya; K-06 memulihkannya saat dibuka.
- ⛔ **Timeout polling BUKAN gagal**, dan kalimat di layar mengatakannya. Kasir yang membaca "gagal" akan menagih ulang pelanggan yang mungkin sudah membayar. **"Batalkan" hanya ditawarkan saat kita TAHU uang tidak berpindah** (ditolak penerbit / QR kedaluwarsa); selama `pending` yang tersedia adalah menutup layar.
- ⛔ **`POST /orders/{id}/abandon`** — pembersihan massal baru menyentuh order `open` setelah **24 jam** dan menuntut `stock_adjust`. Kasir yang membatalkan di depan pelanggan tidak dapat menunggu keduanya, dan stok yang terkunci sehari membuat produk berikutnya terlihat habis. `tinggalkanOrder` adalah SATU fungsi yang dipakai keduanya; order yang sudah dibayar ditolak **409** (void/refund punya kontrolnya sendiri).
- **QR ditampilkan sebagai TEKS, bukan gambar.** Merender QR menuntut pustaka baru dan stack dikunci. Batas yang dinyatakan.
- **Bentuk SQL `draf_qris_lokal` belum dijalankan di BROWSER** — utang yang dicatat; `ON CONFLICT(id)` pernah ditolak `wa-sqlite`.

**Keputusan produk yang mengikat kode katalog:**

- `item_variation.price` **beku setelah variation dibuat** — ia adalah harga awal, anak tangga paling bawah resolusi. Semua perubahan harga lewat `price_history`. `updateItemVariation` tidak menerima `price`, dan itu permanen, bukan penundaan.
- **Harga terjadwal masa depan diizinkan.** `effective_from` boleh di masa depan; resolusi `effective_from <= at` yang menentukan kapan ia berlaku.
- Aktor perubahan dibaca dari header **`X-Actor-Id`** (`getActorId`), divalidasi ke tabel `"user"` lewat SELECT yang tunduk RLS. Pada rute terlindungi header ini diabaikan sepenuhnya dan sesi yang menang (`getActorId`: "sesi menang") — lihat § Transport perangkat di `docs/keputusan/kasir-offline-sync.md`; ini fakta keamanan, bukan placeholder.

**Modul B (Kasir & Order) sub-project 1 — fondasi order: selesai** (`docs/superpowers/plans/PLAN-ordering-fondasi.md`). `POST /orders` menulis order + check + line + modifier + outbox + idempotency_key dalam **satu transaksi** (invariant #1). Menutup FR-B2, B3, B4, B5, B6, B10, B12 dan sebagian B1.

`packages/domain` akhirnya berisi kode: state machine order, aritmetika uang, generator HLC — semuanya **fungsi murni tanpa I/O**, dibagi server dan klien supaya keduanya tidak pernah menghitung total yang berbeda.

**Tiga aplikasi kini ada**: `apps/kasir` (offline-first, PowerSync), `apps/backoffice` (online-only), `apps/hp` (Owner mobile, online-only). Sesi dan pintu HTTP keduanya yang terakhir dibagi lewat `packages/klien-api`.

**Dua belas modul kini punya kode** (TERVERIFIKASI 2 September 2026): `catalog`, `ordering`, `identity`, `cash`, `tenancy`, `sync`, `inventory`, `audit`, `peripheral`, `payment`, `reporting`, `rilis`. Peta lengkapnya di `apps/server/src/modules/README.md`. Modul-modul kecil itu lahir karena invariant #4 — jalur penjualan menunjuk ke lima modul lain, dan alternatifnya adalah `ordering` meng-query tabel milik semuanya.

**Keputusan yang mengikat kode ordering:**

- **Harga diresolusi pada `occurred_at`, bukan `now()`** (FR-H6, `spec-h:77`). Order yang antre offline berjam-jam dihitung dengan harga saat penjualan terjadi. Klien yang tidak mengirim `occurredAt` tetap memakai jam database, persis seperti sebelumnya. Ini memperkenalkan **jam ketiga** — jam perangkat klien — dan risikonya dicatat di `HANDOFF.md`.
- **Selisih hitungan klien TIDAK PERNAH menolak transaksi** (`spec-h:95`). Yang tersimpan selalu hitungan server; selisihnya ditandai `has_calculation_variance` + `variance_amount` + `audit_event` bertipe `calculation_variance`. Menolak berarti kehilangan penjualan yang uangnya sudah diterima merchant.
- **Selisih dianggap terjelaskan hanya bila DUA syarat terpenuhi**: setiap harga yang dipakai klien pernah benar-benar berlaku pada-atau-sebelum `occurred_at`, **dan** total klien konsisten dengan harga-harganya sendiri. Memeriksa syarat pertama saja meloloskan klien yang aritmetikanya salah — ditemukan lewat sabotase, bukan review.

- **`item_variation.price` beku setelah dibuat** — lihat bagian katalog di atas; `order_line.unit_price` adalah snapshot hasil `resolvePrice`, bukan pembacaan langsung.
- **Waktu selalu dari jam database, tidak pernah `new Date()` di Node.** Dipelajari dari bug nyata: resolusi harga menstempel `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node — skew ±2 ms cukup membuat harga yang baru ditulis dianggap belum berlaku, 4 dari 12 run gagal. Di produksi keduanya mesin terpisah. Berlaku juga untuk `occurred_at`, `expires_at`, dan seterusnya.
- **HLC**: satu instance dibuat di `buildApp` dengan clock di-inject di batas itu; domain tetap murni. Klien mengirim `hlc` → `update()`, tidak mengirim → `tick()`.
- **Idempotency**: key di-*claim* lebih dulu (INSERT `response_status = NULL`), order ditulis, lalu key di-*complete*. Urutan ini penting — kalau key ditulis terakhir, PK milik `order` sendiri yang memenangkan balapan dan klien menerima `ID_ALREADY_EXISTS`, bukan `409` idempotency dengan instruksi retry.
- **Cache hit mengembalikan `response_status` yang tersimpan** (jadi `201`), bukan `200`. `spec-b:336` menulis "status 200" sementara `spec-b:325` menulis "mengembalikan respons asli" dan skema menyediakan kolom `response_status` justru untuk itu. **`[ASUMSI]` — belum kamu putuskan.**

**Keputusan yang mengikat kode pajak dan pembayaran:**

- **Tarif tidak pernah float.** `tax_rate.rate` dan `outlet.service_charge_rate` adalah `numeric(6,4)`; di domain keduanya `bigint` berskala 10.000 (10% → `1000n`). Konversinya di `packages/domain/src/numeric.ts`, dibagi server dan klien. Float **terbukti aman** di skala ini — diuji atas seluruh 1.000.000 nilai — jadi alasannya bukan presisi, melainkan agar aturan "jalur uang tidak menyentuh float" tidak punya pengecualian yang akan disalin ke kolom lain.
- **`total` tidak pernah dibulatkan.** Yang dibulatkan `amount_due`, dan hanya **saat ada pembayaran tunai** (FR-C9). Pembulatan karena itu mustahil dihitung saat order dibuat, dan `computeOrderTotals` tidak menerima `roundingIncrement` sama sekali.
- **Pembulatan uang dilakukan per langkah** FR-C8, bukan sekali di akhir.
- **`order.tax_amount` = `totalTax`** (seluruh pajak, untuk struk); yang **menambah** total hanya `totalTaxExclusive`. Menukar keduanya menggandakan pajak inklusif.
- **`payment` PK-nya `(id, occurred_at)`**, bukan `id` saja — tabelnya dipartisi. Berbeda dari `order`. Yang melindungi retry pembayaran adalah **Idempotency-Key**, bukan primary key: satu lapisan lebih sedikit daripada yang dimiliki order.

**Modul B sub-project 3 — void & refund (FR-B7): selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md`). Satu endpoint `POST /orders/{id}/cancel`; **server** yang memilih operasi dari status order, bukan kasir (`spec-b:235`). Void dan refund menulis order pembatal / baris `refund` + `stock_movement` + `audit_event` + outbox + idempotency_key dalam **satu transaksi**.

`inventory` dan `audit` lahir sebagai irisan minimal, masing-masing satu fungsi — keputusan 1 Agustus menghapus PIN dari void, jadi restock dan audit adalah kontrol yang tersisa untuknya, bukan pelengkap.

**Keputusan yang mengikat kode void & refund:**

- **`voided_by_order_id` ada di order PEMBATAL**, menunjuk order yang dibatalkan. Arahnya **dipaksa** AC FR-B7 pertama ("tidak ada `UPDATE` pada order asli") — pembatalnya belum ada saat order asli ditulis, jadi tidak ada arah lain yang mungkin. Namanya terbaca terbalik; itu utang yang dicatat di `HANDOFF.md`, bukan kekeliruan implementasi.
- **Order yang sudah di-void tetap berstatus `open`.** Konsekuensi langsung dari aturan di atas. Yang menolak void kedua adalah `SELECT` di aplikasi **dan** index unik `ux_order_voided_by` (migrasi `0017`). Jangan pernah menyimpulkan "order ini sah" dari `status = 'open'` saja.
- **Refund tidak membuat `payment` negatif** (keputusan user 7 Agustus 2026). `payment.amount` punya `CHECK (amount > 0)` dan itu dipertahankan; arah berlawanan dinyatakan lewat baris `refund`. `spec-b:230` yang menulis "payment negatif" karena itu tidak akurat terhadap kode.
- **Refund sebagian wajib menyebut `lines`.** Tanpa itu server harus menebak apakah barang fisik kembali ke rak. `lines: []` berarti uang kembali tanpa barang kembali.
- **Void berjalan tanpa `X-Approver-Id`; refund selalu menuntutnya.** Header itu diabaikan pada jalur void. Bahwa penyetuju berbeda dari aktor ditegakkan `CHECK` di `audit_event` — **database**, bukan aplikasi.

**Exit criteria F1 terpenuhi.** Satu penjualan tersimpan atomik dengan pajak benar, dapat dibayar tunai/QRIS/EDC, dan dapat dikoreksi lewat void & refund. `ARCH:395` menuntut modul `payment` — ia ada, beserta port gateway-nya. C-3 (rekonsiliasi dan ekspor) ditutup 21 Agustus 2026.

## F3 — keputusan yang mengikat kode

**Buku kas (`cash_movement`) adalah SATU-SATUNYA definisi saldo laci** (`spec-d:14`). `saldo_awal + SUM(delta)`, tidak ada sumber kedua. Ia ditulis di transaksi yang sama dengan penjualan/refund/buka-shift, di **kedua sisi**, dari aturan yang sama di `packages/domain/src/buku-kas.ts`.

- ⛔ `saldoSeharusnya` **mengecualikan** tipe `opening_float` dan memakai `shift.opening_float` langsung. Menjumlahkan keduanya menghitung modal awal dua kali, dan setiap shift terlihat kelebihan sebesar modalnya sendiri. Pengecualian yang sama berlaku di **setiap** test yang menjumlahkan `delta` per shift.
- `delta` memakai nilai transaksi, bukan `tendered_amount` (`spec-d:201`). Kembalian tidak menghasilkan movement terpisah.
- **`refund.method` ditambahkan** (migrasi `0021`, keputusan user 14 Agustus). Hanya refund tunai mengurangi laci. Nilainya diturunkan dari payment order aslinya lewat `metodeRefundDari` — dibagi server dan klien — lalu **disimpan**, bukan disimpulkan ulang saat dibaca. Pembayaran campuran **melempar**, tidak menebak (`spec-d:207`).
- ⛔ **Backfill lintas-tenant mustahil lewat DML.** `UPDATE` ditolak `FORCE ROW LEVEL SECURITY` yang berlaku untuk owner juga, sementara `app.tenant_id` hanya dapat bernilai satu tenant. Jalannya `ADD COLUMN … DEFAULT` (DDL, tidak lewat RLS) lalu **DROP DEFAULT** — default yang tertinggal membuat klien yang lupa mengirim `method` diam-diam mencatat refund tunai.

**`posisi-penjualan.ts` adalah satu-satunya definisi omzet** (FR-G3). Setiap laporan memanggilnya; ada penjaga yang menolak `SUM(...)` atas tabel `"order"` di berkas mana pun selain itu.

- ⛔ **Definisi kanonik `spec-g:34` ditulis untuk skema yang bukan skema ini.** Void tidak mengubah status order aslinya (AC FR-B7 pertama), jadi membaca `status IN ('PAID','CLOSED')` harfiah membuat order yang **sudah dibatalkan tetap masuk omzet kotor**. Yang dipakai: order dianggap batal bila ADA pembatal yang menunjuknya. Penerjemahan ke skema, bukan perubahan spec.
- Omzet bersih boleh **negatif**, tanpa clamp (`spec-g:283`). Sama seperti saldo laci.
- Refund atas order yang dibatalkan **tidak** dikurangkan lagi — ordernya sudah keluar dari omzet kotor.
- **Penjaga satu-sumber polanya diubah dari yang ACnya sebut.** `status = 'voided'` muncul sah di jalur penulisan; meng-grepnya menandai kode benar. Versi pertama penjaga menandai `SUM(amount)` apa pun dan menemukan tiga tempat yang semuanya sah (sisa refund, sisa tagihan). Dipersempit ke `SUM(...)` atas `"order"`, **bukan** dilonggarkan lewat daftar pengecualian: penjaga yang menandai kode benar akan dimatikan orang berikutnya.
- **`basis` laporan per produk adalah `sebelum void & refund`**, dan itu bukan kelalaian: baris produk menyatakan barang apa yang keluar, dan refund uang tidak selalu mengembalikan barang (`lines: []`).
- Tanggal bisnis **dibaca** dari `order.business_date`, tidak dihitung ulang dari `occurred_at` — menghitungnya ulang menjadikan laporan tempat kedua yang memutuskan hal yang sama.

**Modul E — stok bergerak dua arah, akhirnya.**

- ⛔ `item_variation.cost` **dibuang** dari skema lokal dan sync rules (FR-F5). Klien menulis `cost_at_sale = 0`; server menghitungnya lewat `getVariationSnapshot`. Perangkat tidak pernah membutuhkannya.
- ⛔ **`vertical_profile` diturunkan sebagai TABEL, bukan kolom terhitung di `outlet`.** PowerSync mereplikasi perubahan per tabel dari WAL: mengubah profil tidak mengubah baris outlet, jadi baris itu tidak dipancarkan ulang — perangkat memegang nilai basi selamanya, tanpa error. Resolusi `COALESCE(profil_outlet, default_tenant)` terjadi di perangkat.
- `allow_negative_stock` default `true` untuk F&B, ditandai **`[ASUMSI]`** — `spec-e:341` menuntut validasi tiga merchant untuk NILAINYA, bukan untuk keberadaan setting-nya.
- Peringatan stok **tidak memblokir** saat boleh negatif (`spec-e:146`); saat blokir aktif, pesannya membawa **angkanya** (`spec-e:152`). Kuantitas diperiksa **kumulatif lintas baris** — modifier memisahkan baris, stoknya satu.
- Snapshot stok di-rebuild saat tutup shift, **di luar** transaksi penutupan: snapshot adalah cache, dan kegagalan membangunnya tidak boleh me-rollback penutupan kas yang sudah benar.
- Penandaan habis **terpisah** dari stok terhitung dan tidak pernah saling menyimpulkan (`spec-e:220`). Ledger ber-HLC; penanda terbaru menang.
- ⛔ **Oversell tidak dicegah** (non-goal permanen) dan tidak pernah ditolak. Konteks `OversellEvent` dibaca dari `stock_movement`, **bukan** dari parameter: event lahir pada penjualan kedua, jadi menyerahkan perangkat yang sedang menulis membuat perangkat pertama tidak pernah muncul. Terlibat = setiap penjualan sejak saldo terakhir kali masih positif.

**⛔ Pelajaran terpenting F3: database sungguhan juga dapat menyembunyikan cacat.**

Aturannya selama ini "fake menyembunyikan, SQLite sungguhan membuktikan". F3 menemukan kebalikannya: test HLC penandaan habis tetap **hijau** saat perbandingan HLC diganti "baris terakhir menang", karena index `(outlet_id, variation_id, hlc)` membuat pemindaian terurut hlc menaik — kedua aturan memberi jawaban identik, secara struktural. Membalik urutan `INSERT` tidak menolong; index yang menentukan.

Jaminan urutan yang kodenya sendiri harus berikan hanya dapat diuji lewat sumber yang mengembalikan baris dalam urutan **yang tidak dijamin SQL** — di sana fake bukan penyederhanaan, melainkan satu-satunya alat yang benar.

### ⛔ K-06/K-07 tidak boleh dinyatakan selesai tanpa tiga fixture ini

Keputusan user 2 September 2026, diambil setelah audit monokultur. Ketiganya
**mengikat**, dan ditulis di sini alih-alih diingat saat sampai ke sana.

| # | Fixture yang WAJIB ada | Kenapa |
|---|---|---|
| 1 | `tax_rate.type = 'ppn'` **11%** | `TaxCalculator` belum pernah dijalankan dengan jenis pajak yang paling banyak dipakai merchant Indonesia. Fixture memakai `pbjt` saja — `ppn` **nol di seluruh repo**. ⛔ Kalau ternyata ia tidak menanganinya, itu **bug uang: laporkan, jangan tambal diam** |
| 2 | `service_charge_amount != 0` **dan** `channel = 'dine_in'` | 3 berkas lawan 48 di produk F&B — yang paling khas LumiPOS justru yang paling sedikit diuji. Kanal memutuskan tarif pajak di sebagian yurisdiksi (`spec-c`) |
| 3 | `qris_static` + `card_edc` di jalur **TAMPILAN** | Keduanya sudah teruji di jalur DATA (4 berkas: penjualan, tutup-kas, tutup-kas-refund, laporan-harian) dan TIDAK di jalur tampilan — persis lubang yang meloloskan peta metode keempat yang memuat `card` dan tidak memuat `qris_static` |

⛔ **K1 (28 dari 42 empty state) dan K2 (~19 endpoint tanpa penyebut) SENGAJA
tidak dipilah sekarang** (keputusan user). Keduanya batas atas populasi, bukan
cacat; apakah nol di suatu layar sah atau tidak hanya dapat diputuskan **saat
menyentuh layar itu**. Pemilahan massal akan menghasilkan tebakan bervolume.

Audit monokultur fixture: `docs/verifikasi/MONOKULTUR-FIXTURE.md`. ⛔ Temuan terbesarnya bukan metode pembayaran melainkan **`tax_rate.type = 'ppn'` yang NOL di seluruh fixture** — PPN adalah pajak nasional 11%, dan `TaxCalculator` berdiri di atas satu jenis pajak saja (`pbjt`).


**Transfer bank sebagai metode keempat, 1 Oktober 2026 (kampanye Hidupkan desain, sub-proyek 2, Task 7; keputusan user P1/P2, 28 September 2026).** Transfer disimpan sebagai `payment.method = 'other'` + `provider = 'bank_transfer'` (spec-c:244), tanpa migrasi; `provider_reference` = nomor referensi dari bukti transfer (wajib), `acquirer` = bank tujuan (opsional).

- Aturan validasi Transfer (`periksaTransfer`: referensi >= 3 karakter, dan tidak ada 13-19 digit di referensi maupun bank) juga hidup di `packages/domain/src/pembayaran-manual.ts`, dipakai perangkat dan server dengan kalimat galat yang sama persis.
- `dikonfirmasiManual` benar untuk `qris_static` dan `other` (P2): `confirmed_manually = true`. Server menerima `other` hanya dengan `provider` dari daftar tertutup (`bank_transfer`); selain itu `400 VALIDATION_ERROR`.
- Transfer tidak pernah menulis `cash_movement` (perangkat: hanya bagian tunai; server: hanya cabang tunai), tidak dibulatkan (FR-C9), tidak punya perkiraan MDR, dan kelebihan bayarnya ditolak aturan non-tunai di `rencanakanPembayaran`. Pada pembayaran campuran ia dikirim sebelum bagian tunai lewat rantai `depends_on` yang sama.
- Pelanggaran aturan yang diketahui, menunggu keputusan user (issue #76 `butuh-dimas`): handler server untuk metode konfirmasi-manual (QRIS statis, EDC, Transfer) tidak menolak kelebihan bayar non-tunai; penolakannya hanya di perangkat (`rencanakanPembayaran`). Tidak diubah di task ini.
- Kill switch `pembayaran_transfer` (bawaan menyala) sejajar `pembayaran_qris_statis`; tidak menyentuh audit dan tidak menghentikan penjualan.
