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
| 2 | FR-H8 — notifikasi antrean menua | utang F2 | belum |
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
