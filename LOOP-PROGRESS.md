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
| 3 | `sold_out_flag` REST + relay | utang F3 | belum |
| 4 | Tombol cetak ulang di K-09 | utang F4 | belum |
| 5 | Retry antrean `print_job` | utang F4 | belum |
| 6 | Modul C-3 — rekonsiliasi & ekspor | P1 | belum |
| 7 | Paginasi + pencarian katalog sisi server | utang G1 | belum |
| 8 | Refund parsial dengan pemilihan baris di UI | utang F2 | belum |
| 9 | K-16 buka laci · K-17 scanner | utang F2 | belum |

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
