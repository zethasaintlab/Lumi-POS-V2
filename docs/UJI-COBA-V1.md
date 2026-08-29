# Uji coba Lumi POS v1 dari instalasi bersih

Panduan langkah demi langkah untuk menjalankan seluruh v1 dari database kosong,
mengisinya dengan data eksplorasi, lalu menelusurinya per peran.

⛔ **Setiap perintah dan setiap keluaran di bawah adalah hasil EKSEKUSI, bukan
susunan dari ingatan.** Dijalankan ujung ke ujung 29 Agustus 2026 di Node
v24.7.0 · npm 10.9.7 · PostgreSQL 16.13. Yang **tidak** dapat dijalankan di
lingkungan itu dinyatakan sebagai batas di §6 — tidak ditulis seolah berhasil.

Berkas ini berbeda dari `docs/RUNBOOK.md`, yang menjawab *"merchant melaporkan
gejala X, apa yang saya lakukan"*. Yang ini menjawab *"saya ingin mencoba
produknya dari nol"*.

---

## 0. Ringkasan lima perintah

Untuk yang sudah pernah menjalankannya sekali:

```bash
npm install
npm run db:reset && npm run db:bootstrap && npm run db:migrate
npm run dev:server                       # terminal 1 — biarkan terbuka
npm run seed:explore                     # terminal 2 — catat keluarannya
npm run dev --workspace backoffice       # terminal 3 → http://localhost:1422
```

Selebihnya di bawah menjelaskan tiap langkah dan apa yang harus terlihat.

---

## 1. Prasyarat

| Kebutuhan | Versi | Kenapa versinya mengikat |
|---|---|---|
| **Node.js** | **≥ 24.7** | `crypto.argon2` — hash PIN Modul F — baru ada sejak 24.7.0. Node yang lebih tua **tidak** gagal dengan kalimat yang menyebut "Node"; ia gagal sebagai tiga test PIN merah. Dijaga `tests/runtime/versi-node.test.js`, yang berjalan paling dulu di CI |
| **PostgreSQL** | **17+** | Stack terkunci (`research/03`). Verifikasi 29 Agustus 2026 dijalankan di **16.13** dan ke-35 migrasi berjalan tanpa kegagalan — itu **pengamatan, bukan janji**: v1 ditargetkan ke 17+ dan hanya itu yang didukung |
| **npm** | 10+ | Workspaces |
| **Rust/Cargo** | — | **Hanya** bila ingin `npm run tauri dev` (aplikasi desktop). Tidak dibutuhkan untuk uji coba di browser |
| **Docker** | — | **Hanya** untuk PowerSync. Lihat §6.1 — tanpa ini aplikasi kasir tidak dapat di-login |

```bash
node --version    # harus v24.7.0 atau lebih baru
psql --version
npm install
```

### 1.1 Berkas `.env`

```bash
cp .env.example .env
```

Lalu sesuaikan **tiga** baris koneksi. `.env.example` memakai `CHANGEME`; ganti
dengan kata sandi PostgreSQL Anda sendiri:

```
DATABASE_URL=postgres://lumi_app:<sandi>@localhost:5432/lumi
DATABASE_MIGRATION_URL=postgres://lumi_owner:<sandi>@localhost:5432/lumi
DATABASE_ADMIN_URL=postgres://postgres:<sandi>@localhost:5432/postgres
```

Ketiganya berbeda peran, dan itu **invariant #8**, bukan gaya:

- `lumi_app` — dipakai aplikasi. **Tunduk RLS**, bukan superuser, bukan pemilik tabel.
- `lumi_owner` — dipakai migrasi. Pemilik tabel.
- `postgres` — superuser, **hanya** dipakai `db:bootstrap` dan `db:reset` untuk membuat/membuang role dan database.

⛔ **`CORS_ORIGINS` harus memuat ketiga aplikasi**, dan port-nya bukan yang
ditebak:

```
CORS_ORIGINS=http://localhost:1420,http://localhost:1422,http://localhost:1423
```

`1420` kasir · `1422` back-office · `1423` HP. **Port 1421 bukan milik aplikasi
mana pun** — ia HMR Tauri, dan menuliskannya di sini mengizinkan asal yang tidak
ada sambil membiarkan kasir tetap diblokir.

Origin yang hilang tidak menghasilkan pesan yang menyebut CORS di layar mana
pun: aplikasi memuat dengan sempurna, lalu login gagal seperti server mati atau
kata sandi salah. Dijaga `tests/runtime/cors-origin-aplikasi.test.js`, yang
menurunkan daftar port dari `vite.config.ts` tiap aplikasi.

**Yang boleh dibiarkan kosong** untuk uji coba: `MIDTRANS_*` (QRIS dinamis —
lihat §6.2), `POWERSYNC_JWT_PRIVATE_KEY` (§6.1), `POWERSYNC_TOKEN`.

---

## 2. Database bersih dari nol

```bash
npm run db:reset       # buang database lama
npm run db:bootstrap   # buat role lumi_owner/lumi_app + database
npm run db:migrate     # terapkan 0001–0035
```

Keluaran yang benar:

```
Database "lumi" dibuang.
Role lumi_owner/lumi_app siap.
Database "lumi" dibuat, owner lumi_owner.
apply 0001_extensions
...
apply 0035_order_line_variation_count
```

⛔ **`db:reset` MENGHAPUS SELURUH DATA dan tidak dapat dibatalkan.** Ia menolak
berjalan bila `DATABASE_URL` tidak menunjuk localhost, dan penjaganya adalah
**hostname, bukan isi database** — database lokal yang memuat pekerjaan
eksplorasi berjam-jam akan dibuang tanpa pertanyaan. Itu memang gunanya.

⛔ **Kenapa langkah reset perlu ada:** `db:bootstrap` idempoten (melewati
database yang sudah ada) dan `db:migrate` melewati migrasi yang sudah tercatat
di `schema_migrations`. Keduanya benar. Konsekuensinya, "uji coba dari instalasi
bersih" yang dijalankan di atas database lama **tidak pernah benar-benar
menjalankan migrasinya lagi** — migrasi yang rusak tetap terlihat hijau.

> **`db:reset` menolak jalan?** Bila pesannya menyebut koneksi yang masih hidup,
> matikan server di terminal lain lebih dulu. Skrip memutus koneksi yang tersisa
> dan mencetak jumlahnya.

---

## 3. Jalankan server

```bash
npm run dev:server
```

Biarkan terminal ini terbuka. Server mendengarkan di port `3000`:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

> `npm start` di `apps/server` **tidak** memuat `.env`, jadi koneksi database
> akan gagal. Pakai perintah di atas dari akar repo.

---

## 4. Seeding data eksplorasi

**Server harus sudah berjalan** — skrip ini menembak API sungguhan, bukan menulis SQL.

```bash
npm run seed:explore
```

Ia membuat tenant **The Cafe by ORIGEN**: dua outlet, empat kategori, 18 varian
produk, stok awal, satu perangkat kasir, satu shift terbuka, sepuluh order
(delapan lunas), lima akun — satu per peran — dan PIN kasir.

Keluaran sungguhnya:

```
tenant + outlet + owner : 201
login owner             : 200 [ 'owner' ]
paket                   : free → pro (tanpa batas outlet · 60 pengguna)
outlet kedua            : 201
katalog                 : 4 kategori · 18 varian
stok masuk              : selesai
device + shift          : 201
penjualan               : 10 order
pengguna                : 5 akun
PIN kasir               : 204
```

Lalu blok ringkasan berisi email, kata sandi, PIN, dan **enam nilai untuk layar
Perangkat kasir** (§5.3). ⛔ **Simpan blok itu.** Kredensial perangkat
dikembalikan **sekali saja** — server hanya menyimpan SHA-256-nya (FR-F12).

### Yang sengaja ada di dalam data

Data seed **tidak rapi**, dan itu disengaja — layar yang seluruh angkanya sehat
tidak menunjukkan apa pun:

| Keadaan | Di mana terlihat |
|---|---|
| Stok **menipis** (1–5) dan **habis** (0) | B-12 Stok |
| Stok **minus** — Cold Brew 500ml terjual tanpa barang masuk | B-15 Perlu Diperiksa · M-02 di HP |
| Dua order **belum dibayar** | B-02 Riwayat |
| Outlet kedua **tanpa transaksi sama sekali** | B-01 — ia tidak muncul sebagai baris nol, dan itu benar |

⛔ **Oversell BUKAN kesalahan siapa pun** — ia konsekuensi CAP, dan pencegahannya
adalah non-goal permanen. Yang dibangun adalah deteksi dan pelaporannya.

### Menjalankan ulang

Setiap run membuat tenant **baru** dan tidak pernah menghapus apa pun. Tapi
email unik lintas tenant, jadi run **kedua** menabrak `EMAIL_TAKEN`. Dua jalan:

```bash
npm run db:reset && npm run db:bootstrap && npm run db:migrate && npm run seed:explore
npm run seed:explore -- --unik    # tenant berdampingan, email berakhiran angka
```

---

## 5. Menjalankan aplikasi

Empat proses, empat terminal. Ketiga aplikasi harus dapat berjalan **bersamaan**
— `strictPort: true` di ketiganya, jadi tabrakan port gagal keras, bukan pindah
diam-diam.

| Terminal | Perintah | Alamat |
|---|---|---|
| 1 | `npm run dev:server` | `http://localhost:3000` |
| 2 | `npm run dev --workspace backoffice` | **`http://localhost:1422`** |
| 3 | `npm run dev --workspace hp` | **`http://localhost:1423`** |
| 4 | `npm run dev --workspace kasir` | **`http://localhost:1420`** |

⛔ **Firefox tidak didukung untuk aplikasi kasir** — OPFS. Pakai Chromium/Chrome/Edge.

### 5.1 Back-office (`1422`) — 26 layar

Online-only. Masuk dengan email + kata sandi (§5.4). Ini permukaan terbesar dan
yang paling siap diuji.

### 5.2 Owner mobile (`1423`) — 4 layar

Online-only. **Sempitkan jendela browser ke lebar ~390px** — ia dirancang untuk
satu pertanyaan pukul 23:00, bukan untuk navigasi lengkap.

⛔ **Akun yang emailnya ada di dua tenant tidak dapat masuk lewat HP** (tidak ada
bidang "ID Tenant" di layar 390px). Data seed tidak menghasilkan keadaan itu
kecuali Anda menjalankan seed dua kali tanpa `--unik`.

### 5.3 Kasir (`1420`) — perlu satu langkah tambahan

Buka **`http://localhost:1420/perangkat`** (layar K-15) **sebelum** mencoba
login — perangkat baru belum punya satu pun pengguna di database lokalnya, jadi
tidak ada PIN yang dapat diverifikasi.

Isi enam bidang dengan blok yang dicetak `seed:explore`:

| Bidang | Isi |
|---|---|
| Alamat server | `http://localhost:3000` |
| Tenant | UUID dari keluaran seed |
| Outlet | UUID dari keluaran seed |
| ID perangkat | UUID dari keluaran seed |
| Kode perangkat | `K1` |
| Kredensial | secret dari keluaran seed |

Simpan, lalu **muat ulang aplikasi** — sinkronisasi menyala saat aplikasi
dimuat, bukan saat pengaturan disimpan.

⛔ **Setelah ini pun kasir belum dapat di-login tanpa PowerSync.** Katalog DAN
tabel `"user"` (tempat PIN diverifikasi) turun lewat jalur turun PowerSync;
tanpa layanan itu keduanya kosong permanen, dan `waitForFirstSync()` **melaporkan
sukses** atas katalog kosong. Baca §6.1 sebelum menyimpulkan aplikasinya rusak.

### 5.4 Matriks kredensial

Kata sandi **`password123`** untuk semua akun. PIN kasir **`246810`**.

| Peran | Email | Masuk lewat | Cakupan |
|---|---|---|---|
| **Owner** | `owner@lumipos.test` | Back-office · HP | Seluruh tenant |
| **Manajer Area** | `area_manager@lumipos.test` | Back-office · HP | Seluruh tenant |
| **Manajer Outlet** | `outlet_manager@lumipos.test` | Back-office | ORIGEN Menteng saja |
| **Kasir** | `cashier@lumipos.test` | **PIN `246810` di aplikasi kasir** | ORIGEN Menteng saja |
| **Akuntan** | `accountant@lumipos.test` | Back-office | Seluruh tenant |

⛔ **Akun kasir DAPAT masuk back-office di data seed ini, dan di produksi ia
tidak boleh.** Yang menegakkan `spec-f:150` adalah kenyataan bahwa kasir tidak
pernah **diberi** kata sandi — `login` hanya menyaring `password_hash IS NOT
NULL` dan tidak memeriksa peran sama sekali. Seed memberinya satu supaya
perbandingan RBAC per peran dapat dilakukan di satu tempat. Jalankan
`npm run seed:explore -- --taat-spec` untuk melewatkannya.

⛔ **`password123` ditulis LANGSUNG ke tabel, melewati API.** Ia ada di daftar
kata sandi bocor FR-F2b, jadi `PUT /users/{id}/password` menjawab `400
PASSWORD_BREACHED` — **kontrolnya bekerja persis seperti seharusnya**. Skrip
mencoba API lebih dulu dan hanya menulis hash langsung ketika penolakannya
tepat `PASSWORD_BREACHED`; penolakan lain dilaporkan, tidak di-bypass. Itu
sebabnya seluruh skrip menolak berjalan di luar localhost.

---

## 6. ⛔ Yang TIDAK dapat diuji dari instalasi bersih

Bagian ini ada supaya waktu tidak habis mengejar sesuatu yang memang belum ada.
Tidak satu pun dari ini adalah kegagalan pemasangan.

### 6.1 Aplikasi kasir menuntut PowerSync — dan ini yang paling mahal bila tidak diketahui

Jalur turun (katalog, harga, pajak, **dan tabel `"user"` tempat PIN
diverifikasi**) dilayani PowerSync. Tanpa layanan itu berjalan:

- katalog kasir **kosong permanen**, dan
- **tidak ada PIN yang dapat diverifikasi** — K-01 menolak setiap PIN, termasuk `246810`.

⛔ Gejalanya **bukan** pesan error. `waitForFirstSync()` selesai dalam 0 ms dan
**melaporkan sukses** sementara katalognya kosong — checkpoint PowerSync hidup
di tabel `ps_*`, terpisah dari tabel kami.

Yang ada di repo hanyalah stack prototipe
(`prototypes/05-powersync-jalur-turun/docker-compose.yaml`), dan ia menunjuk
**database miliknya sendiri** (port 5433), bukan database eksplorasi Anda —
jadi ia tidak melayani tenant yang baru saja di-seed. Mengarahkannya ke sana
menuntut penyesuaian `sync-config.yaml`, `POWERSYNC_JWT_PRIVATE_KEY` yang terisi
(kosong → endpoint token menjawab `503`), dan Docker.

**Batas yang dinyatakan:** langkah itu **tidak dijalankan** saat verifikasi 29
Agustus 2026 — daemon Docker tidak tersedia di lingkungan itu. Jadi rangkaian
lengkapnya belum pernah dibuktikan berjalan ujung ke ujung, dan panduan ini
tidak berpura-pura sebaliknya. Yang sudah terbukti berjalan terhadap layanan
sungguhan ada di `prototypes/05-powersync-jalur-turun/FINDINGS.md`.

**Yang tetap dapat diuji di aplikasi kasir tanpa PowerSync:** K-15 (Perangkat &
Uji Cetak) — termasuk pemilihan profil printer, antrean cetak, dan uji cetak.

### 6.2 QRIS dinamis menuntut kunci Midtrans

`PAYMENT_PROVIDER=midtrans` dengan kunci kosong **gagal saat boot**, bukan saat
pelanggan pertama membayar — itu disengaja. Biarkan `MIDTRANS_*` kosong; QRIS
**statis** dan EDC berfungsi tanpa gateway (keduanya dikonfirmasi orang, bukan
sistem).

### 6.3 Cetak ke printer fisik — Gate F4, bagian pertama

Status resmi: **`Logika & Profil Production-Ready (Hardware-Blocked)`**.

Logika pemilihan profil dan antrean cetak selesai dan teruji deterministik.
**Cetak di lima model fisik belum pernah dijalankan** — `peripheralAktif()`
masih mengembalikan `null`, dan tidak satu byte pun pernah meninggalkan
perangkat menuju printer sungguhan. Dipindahkan ke Acceptance Test lapangan.

### 6.4 Latensi seluler M-03 — AC FR-G6 kelima

Status resmi: **`Payload Optimized <50KB (Environment-Blocked)`**.

Yang menjadi dasarnya **ukuran muatan, bukan latensi terukur**. Tidak ada satu
pun pengukuran throttling yang pernah dijalankan di dalam repo ini. Dipindahkan
ke Acceptance Test.

### 6.5 Lain-lain

- **Aplikasi desktop Tauri** — `npm run tauri dev` menuntut Rust/Cargo.
- **Enkripsi database lokal at-rest** — menunggu Tauri, tercatat sebagai utang.
- **Turun paket** dan **agregasi lintas-tenant** — keputusan deployment, bukan endpoint.

---

## 7. Skenario uji coba yang direkomendasikan

Delapan alur, diurutkan supaya yang belakangan memakai hasil yang sebelumnya.
Semuanya berjalan di **back-office** dan **HP** — keduanya tidak menuntut
PowerSync. Alur kasir ada di §7.8, dengan prasyaratnya.

### 7.1 Dasbor dan konsistensi angka — masuk sebagai **Owner**

B-01. Yang diperiksa **bukan** apakah angkanya muncul, melainkan apakah angka
yang sama muncul di dua tempat:

1. Catat omzet hari ini di B-01.
2. Buka B-16 Laporan Penjualan untuk tanggal yang sama.
3. **Keduanya harus identik** — `posisi-penjualan.ts` adalah satu-satunya
   definisi omzet, dan dasbor adalah layar yang paling jarang diperiksa ulang.
4. Penyaring outlet: pilih ORIGEN Kemang → seluruh angka **nol**, dan outlet itu
   **tidak muncul** sebagai baris di rincian per outlet. Itu benar.

### 7.2 Stok dan yang perlu diperiksa — **Owner** atau **Manajer Outlet**

1. B-12 Stok → tanpa `outlet_id`, ringkasannya **`null`**, bukan angka gabungan.
   Kekurangan di satu cabang tertutup kelebihan di cabang lain.
2. Pilih ORIGEN Menteng → aman / menipis / habis / **minus** semuanya terwakili.
3. B-15 Perlu Diperiksa → oversell Cold Brew 500ml. **Tanpa satu pun kata yang
   menyalahkan orang.**
4. B-13 Penyesuaian Stok → koreksi satu varian, lalu kembali ke B-12 dan
   pastikan saldonya bergerak. Stok adalah `SUM(stock_movement.delta)`; tidak
   ada kolom `quantity`.

### 7.3 Riwayat, void, dan refund — **Owner**

1. B-02 Riwayat → sepuluh order, **dua belum lunas**.
2. B-03 Detail Transaksi → periksa baris, pajak, dan total.
3. Void sebuah order. ⛔ Order aslinya **tetap berstatus `open`** dan order
   **pembatal** adalah baris tersendiri — transaksi selesai tidak pernah
   di-`UPDATE` (invariant #2). Riwayat menurunkan status dari ada/tidaknya
   pembatal.
4. Kembali ke B-01: omzet **berkurang**. Order yang dibatalkan keluar dari omzet
   kotor.

### 7.4 Laporan margin dan HPP — bandingkan **Owner** vs **Akuntan**

Ini menguji FR-F5, dan caranya adalah **membandingkan dua peran**:

1. Sebagai **Owner**, buka B-17 Laporan Produk → kolom **HPP** dan **Margin** ada.
2. Keluar, masuk sebagai **Akuntan**, buka layar yang sama → kolom itu
   ⛔ **HILANG, bukan bernilai `null`**. Kolom kosong tetap memberi tahu bahwa
   margin ada dan tidak boleh dilihat.
3. Laporannya sendiri **tidak** dijawab 403 — yang berubah hanya kolomnya.
4. Ekspor CSV **tanpa margin untuk kedua peran**: kolom yang berubah menurut
   peran pengekspor menghasilkan dua berkas bernama sama dengan isi berbeda.

### 7.5 Delapan laporan exception — **Owner**

B-21, satu layar dengan penyeleksi tab.

1. Telusuri kedelapan tab. Data seed tidak mengisi semuanya — **tab kosong
   adalah hasil yang sah**, dan kalimatnya harus membedakan "tidak ada
   temuan" dari "gagal memuat".
2. ⛔ **X6 punya tab dengan alasannya di layar** dan memang tidak dapat
   dibangun: ia menuntut RIWAYAT perubahan keranjang, dan keranjang yang
   bertahan hanya menyimpan **keadaannya**.
3. Masuk sebagai **Kasir** (lihat catatan §5.4) → B-21 **ditolak**. Penjaga
   `report_exception` dipasang di satu pembungkus, bukan disalin per laporan.

### 7.6 Audit trail — **Owner**

B-22.

1. Saring per jenis peristiwa. Login Anda sendiri ada di sana.
2. ⛔ **`belumDipancarkan` harus KOSONG.** FR-F6 ditutup 25 Agustus 2026;
   daftar berisi berarti ada peristiwa yang spec sebut tapi kode belum pancarkan.
3. Lakukan satu perubahan katalog di B-06, lalu kembali — peristiwanya muncul,
   dengan **`before` berisi nilai LAMA**.
4. Saringan yang aktif **disebutkan di atas tabel**. Daftar audit yang tidak
   menyebut apa yang disaring terbaca seperti daftar lengkap.

### 7.7 Owner mobile — **Owner** di `1423`, jendela ~390px

1. M-01 Ringkasan Hari Ini → omzet **identik** dengan B-01 untuk tanggal yang sama.
2. ⛔ `deltaPersen` **`null`**, bukan 0 — tenant ini baru lahir hari ini, jadi
   tidak ada pembanding empat minggu ke belakang. `basisMinggu: 0`.
3. M-02 Perlu Diperiksa → oversell Cold Brew. Daftarnya **tertunggak**, bukan
   harian: ia tidak mengosongkan dirinya tengah malam.
4. ⛔ Catatan antrean **selalu tampil**, juga saat angkanya lengkap: yang di
   layar adalah apa yang **sudah sampai** ke server, bukan apa yang terjual.
5. Bilah nav punya **dua** item — `[Ringkasan] [Laporan]`. M-02 bukan tab.

### 7.8 Alur kasir penuh — **hanya setelah §6.1 terpenuhi**

Prasyarat: PowerSync berjalan dan melayani tenant ini. Tanpa itu berhenti di
langkah 1 — dan itu bukan kerusakan.

```
K-15 daftarkan perangkat → muat ulang → K-01 login PIN 246810
  → K-02 buka shift → K-03 jual (grid + modifier) → K-06 bayar tunai
  → K-08 riwayat → K-10 batalkan/refund → K-12 tutup kas → K-13 laporan shift
```

Yang paling layak diperiksa di jalur itu:

- **Cabut jaringan di tengahnya.** Seluruh alur harus tetap berjalan; indikator
  sinkronisasi berpindah ke antrean, dan K-14 menampilkan jumlah serta umur
  tertua. Ini nilai jual produknya.
- **Muat ulang di tengah keranjang** → keranjang pulih, dan pemulihannya
  **disebutkan di layar**. Keranjang milik shift lain tidak pernah dipulihkan.
- **Jual item ber-varian lebih dari satu** (mis. Kopi Susu Gula Aren
  Regular/Large) → strukmya menyebut nama varian. Item bervarian **tunggal**
  tidak menyebutnya (FR-A2, migrasi `0035`).
- **Tutup kas dengan selisih di atas ambang** → menuntut otorisasi manajer, dan
  percobaan hitungan yang **ditolak** tetap meninggalkan jejak.

---

## 8. Kalau ada yang tidak beres

| Gejala | Kemungkinan besar |
|---|---|
| Aplikasi memuat, login gagal tanpa pesan jelas | `CORS_ORIGINS` — §1.1. Periksa tab Network |
| `npm run db:reset` menolak jalan | `DATABASE_URL` bukan localhost, atau server masih memegang koneksi |
| Server gagal boot menyebut kunci | `PAYMENT_PROVIDER=midtrans` dengan kunci kosong — §6.2 |
| Seed berhenti di `EMAIL_TAKEN` | Sudah pernah di-seed. `--unik`, atau reset — §4 |
| Katalog kasir kosong, PIN ditolak | PowerSync — §6.1. **Bukan kerusakan** |
| Test PIN merah, pesannya tidak menyebut Node | Node < 24.7 — §1 |

Untuk gejala yang dilaporkan **merchant** (bukan pemasangan), pakai
`docs/RUNBOOK.md`.

---

## 9. Menjalankan suite verifikasi

```bash
npm run typecheck
npm run lint:ds
npm run test:runtime      # jalankan paling dulu — ia menjelaskan kegagalan yang lain
```

⛔ **Suite yang menyentuh database TIDAK boleh berjalan bersamaan** — semuanya
berbagi satu database lewat `resetAll`, dan menjalankannya paralel menghasilkan
kegagalan yang terlihat acak. Jalankan satu per satu:

```bash
npm run test:domain && npm run test:server && npm run test:catalog && \
npm run test:ordering && npm run test:identity && npm run test:tenancy && \
npm run test:payment && npm run test:isolation && npm run test:schema
```

Yang tidak menyentuh database boleh kapan saja:

```bash
npm run test:kasir && npm run test:backoffice && npm run test:hp && \
npm run test:sync-client && npm run test:dst && npm run test:sqlite-local
```

⛔ **Menjalankan suite ini MENGOSONGKAN database eksplorasi Anda.** Seed ulang
sesudahnya (§4).
