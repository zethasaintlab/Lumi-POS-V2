# Runbook operasional — Lumi POS v1

Gate F6 (`ARCH:400`): *"Runbook lengkap; alat koreksi ada **sebelum** insiden
pertama."*

⛔ **Berkas ini menggambarkan yang KODENYA benar-benar lakukan hari ini, bukan
yang seharusnya.** Setiap baris yang menyebut perilaku menunjuk berkas yang
menegakkannya. Kalau kode dan runbook berbeda, **kodenya yang benar** — dan
runbook yang salah lebih berbahaya daripada runbook yang tidak ada, karena
orang yang sedang panik akan memercayainya.

Tiga hal yang harus dibaca sebelum menyentuh apa pun:

1. ⛔ **Transaksi selesai tidak pernah di-`UPDATE`** (invariant #2). Koreksi
   adalah record BARU. Setiap "perbaikan" lewat `UPDATE` pada `order`,
   `payment`, `refund`, atau `cash_movement` menghancurkan jejak audit yang
   justru dibutuhkan untuk menjelaskan insidennya.
2. ⛔ **Aplikasi terhubung sebagai user yang tunduk RLS** (invariant #8).
   Query manual lewat `lumi_owner` **melewati** RLS untuk `FORCE ROW LEVEL
   SECURITY`? Tidak — `FORCE` berlaku untuk owner juga. Yang benar-benar
   melewatinya hanya superuser dan role ber-`BYPASSRLS`. Jangan memakai
   keduanya untuk membaca data merchant kecuali insiden menuntutnya, dan catat
   kalau memakainya.
3. **Penjualan tidak pernah boleh dihentikan** (`research/09:213`). Tidak ada
   prosedur di bawah yang menyuruh merchant berhenti berjualan.

---

## 0. Peta cepat: gejala → bagian

| Yang merchant katakan | Bagian |
|---|---|
| "Penjualan hari ini tidak muncul di laporan" | §1 antrean tidak terkuras |
| "Kasir tidak bisa masuk" | §2 login & PIN |
| "Struk tidak keluar" | §3 cetak |
| "Stok minus padahal barang ada" | §4 stok & oversell |
| "Sudah bayar QRIS tapi order belum lunas" | §5 pembayaran gateway |
| "Sudah upgrade tapi masih ditolak kuota" | §6 langganan |
| "Katalog di kasir kosong / tidak berubah" | §7 jalur turun |
| "Tutup kas minta otorisasi padahal cocok" | §8 kas & shift |

---

## 1. Antrean sinkronisasi tidak terkuras

**Metrik kesehatan #1** (`spec-h:304`). Antrean yang tua berarti **uang
merchant belum tercatat di mana pun selain perangkat itu**.

### Yang dilihat merchant

- Pita merah/kuning di layar kasir: *"Ada penjualan yang belum tercatat di
  server sejak N jam lalu."* (`apps/kasir/src/PitaAntrean.tsx`)
- Indikator topbar `Gagal kirim (N)` atau `Offline · N menunggu`.
- Kartu di dasbor back-office: *"N dari M perangkat belum terhubung."*

### ⛔ Yang TIDAK dapat dilihat dari server

Antrean yang menua adalah penjualan yang **belum pernah sampai** ke server —
tidak ada baris untuk dihitung. Yang server lihat hanyalah `device.last_seen_at`
yang basi. Perangkat yang **mati** terlihat sama dengan perangkat yang menahan
20 penjualan. **Jangan menyimpulkan salah satu dari yang lain.**

### Diagnosis, di perangkatnya

Buka **K-14 Status Sinkronisasi** (klik indikator di topbar):

| Yang terlihat | Artinya |
|---|---|
| `menunggu > 0`, `gagal = 0` | Normal saat offline. Akan terkuras sendiri. |
| `gagal > 0` | **Tidak akan pergi sendiri.** Baca alasan per item. |
| `Tertua: N hari lalu` | Umur itulah ambang 4/24/72 jam. |

Alasan gagal sudah diterjemahkan ke bahasa manusia (`pesanGagal` di
`packages/sync-client/src/status.ts`):

| Pesan | Tindakan |
|---|---|
| "Perangkat tidak lagi dikenali server" (401/403) | Kredensial dicabut atau kedaluwarsa. Terbitkan ulang di B-26, masukkan di layar Perangkat. |
| "Data tujuan tidak ditemukan di server" (404) | Shift/order rujukannya tidak ada. Lihat §1.1. |
| "Server menolak data ini (HTTP 4xx)" | **Tidak akan berhasil dikirim ulang tanpa perbaikan.** Eskalasi. |
| "Server sedang bermasalah (HTTP 5xx)" | Akan dicoba lagi otomatis. Periksa kesehatan server. |
| "Koneksi terputus sebelum server menjawab" | Akan dicoba lagi otomatis. |
| "Transaksi ini dikirim ulang dengan isi berbeda" (`IDEMPOTENCY_KEY_REUSED`) | Datanya perlu diperiksa. **Jangan hapus.** Eskalasi. |

### Tindakan

1. **Sambungkan internet**, lalu tekan **"Coba kirim sekarang"** di K-14. Ia
   memicu penjadwal yang SAMA yang berjalan di latar — bukan putaran kedua.
2. Kalau item tetap `failed`: **ambil ekspor darurat** dari K-14 sebelum
   melakukan apa pun. Ia berkas teks yang dapat dibaca manusia dan memuat
   seluruh transaksi yang belum tercatat (`spec-h:256`).
3. ⛔ **Jangan menghapus database lokal perangkat** sebelum ekspor darurat
   tersimpan di luar perangkat. `outbox_local` adalah satu-satunya salinan
   penjualan itu.

### 1.1 Item 404: shift atau order rujukannya tidak ada

Penyebab yang paling sering: perangkat mengirim `payment` untuk order yang
sendirinya belum terkirim, dan order-nya `failed`. Antrean punya `depends_on`
untuk itu — periksa apakah item induknya juga `failed`. Perbaiki induknya
lebih dulu; anaknya akan menyusul.

### 1.2 Ambang notifikasi

`4 / 24 / 72 jam`, dapat diubah lewat `VITE_AMBANG_ANTREAN_JAM` (`"4,24,72"`).
Nilai yang cacat — termasuk tiga angka yang **tidak menaik** — jatuh ke bawaan
secara utuh (`packages/domain/src/antrean-menua.ts`).

⛔ **Tidak ada kanal notifikasi.** Tidak ada push, email, atau SMS. Yang ada
adalah keadaan layar. "> 72 jam: kontak proaktif dari support" adalah prosedur
MANUSIA, dan sumber datanya kartu perangkat di dasbor owner.

---

## 2. Kasir tidak bisa masuk

### 2.1 PIN ditolak

FR-F4: 5 kali gagal mengunci **60 detik**; penguncian ketiga dalam satu jam
naik jadi **15 menit** (`spec-f:229`).

- Penguncian berlaku **per pengguna**, bukan per perangkat.
- Verifikasi PIN berjalan **lokal** (Argon2id, hash direplikasi turun). Jadi
  PIN yang baru diubah di back-office **tidak berlaku sampai perangkat
  tersinkron**. Ini penyebab paling sering "PIN baru tidak bisa".
- Reset: ubah PIN di B-27. Perangkat harus online untuk menerimanya.

### 2.2 Login back-office ditolak

- Sesi kedaluwarsa **12 jam absolut** sejak login, bukan 12 jam tidak aktif
  (`apps/server/src/sesi.ts` menyatakan selisih ini terhadap `spec-f:176`).
- Pengguna yang dinonaktifkan **kehilangan sesinya seketika**.
- Semua penolakan menjawab `401 SESSION_INVALID` dengan pesan yang sama —
  sengaja. Membedakan "token tidak ada" dari "kedaluwarsa" memberi penebak
  peta.

### 2.3 Kredensial perangkat 30 hari

OQ-08: perangkat yang melewati **30 hari** tanpa terhubung tetap dapat
**menyelesaikan transaksi berjalan dan menutup shift**, tapi **tidak dapat
membuka shift baru**. Ini disengaja. Yang memperbaikinya: sambungkan internet.

---

## 3. Struk tidak keluar

⛔ **Cetak adalah efek samping yang boleh gagal** (invariant #3). Penjualan
SELALU tersimpan lebih dulu. Kalau merchant melaporkan "struk tidak keluar",
pertanyaan pertama BUKAN "apakah penjualannya hilang" — ia tidak hilang.

### Diagnosis

| Yang layar katakan | Artinya |
|---|---|
| "Belum ada printer terpasang di perangkat ini" | `peripheralAktif()` mengembalikan `null`. **Ini keadaan normal v1** — lihat batas di bawah. |
| "Gagal mencetak: …" | Printer menjawab dengan galat. Struknya masuk `print_job`. |

### ⛔ Batas yang harus diketahui sebelum menjanjikan apa pun

**Tidak satu byte pun pernah sampai ke printer sungguhan di v1.** Adapter yang
menyentuh perangkat keras (`Network TCP 9100`, Tauri/Rust, WebUSB) belum ada —
`ARCH:235`. Gate F4 bagian pertama ("cetak berhasil di ≥5 model") **masih
terbuka**. Yang sudah terbukti adalah byte yang KELUAR dari renderer.

### Tindakan

1. **Cetak ulang** dari K-09 Detail Transaksi — tombol "Cetak ulang struk".
2. Struk yang gagal tersimpan di `print_job` **beserta dokumennya**, dan dapat
   dicoba ulang dari layar Perangkat: **"Coba cetak lagi"**.
3. Setelah **5 percobaan** job berhenti dicoba otomatis. Ia **tetap tersimpan**
   dan masih dapat dicetak dari K-09.
4. ⛔ `print_job` **murni lokal**. Printer yang gagal di kasir 1 **tidak dapat**
   dicetak ulang oleh kasir 2.

### 3.1 Struk salah lebar / terpotong

Profil printer adalah **data** (`printer_profile`), bukan kode. Baseline 58 mm
→ 32 karakter dan 80 mm → 48 karakter adalah **tebakan yang masuk akal, bukan
pengukuran**. Jalankan **uji cetak** di layar Perangkat: penggaris angka di
lembar uji harus muat dalam satu baris. Kalau tidak, ubah `chars_per_line` di
profil.

### 3.2 Nama produk tercetak sebagai tanda tanya

Transliterasi menutup sepuluh karakter yang design system pakai. Karakter di
luar ASCII menjadi `?`. Nama produk beraksara non-Latin akan tercetak sebagai
tanda tanya — **batas MVP yang diketahui**, bukan kerusakan.

---

## 4. Stok minus, atau oversell

### 4.1 Stok minus adalah keadaan yang DIIZINKAN

⛔ **Pencegahan oversell saat offline adalah non-goal permanen** (konsekuensi
CAP). Yang dibangun adalah **deteksi dan pelaporan**. Stok `-3` bukan
kerusakan data; ia laporan yang benar tentang kejadian yang benar.

`allow_negative_stock` default `true` untuk F&B (`[ASUMSI]`, `spec-e:341`).

### 4.2 Diagnosis

- **B-12 Stok** menampilkan saldo per outlet, dihitung `SUM(stock_movement.delta)`.
  ⛔ **Tidak ada kolom `quantity`.** Jangan mencari-cari kolom yang tidak ada.
- **B-15 Perlu diperiksa** menampilkan oversell yang terdeteksi beserta
  perangkat yang terlibat.
- **B-21 Laporan exception** menampilkan void, refund, dan selisih kas.

### 4.3 Koreksi

⛔ **JANGAN `UPDATE` saldo.** Tidak ada saldo untuk di-`UPDATE`.

Yang benar: **B-13 Penyesuaian** (`POST /inventory/movements`, tipe
`adjustment`) — wajib menyertakan `reasonCode`. Atau **B-14 Opname** untuk
hitungan fisik menyeluruh.

⛔ Delta opname dihitung dari **snapshot pada saat opname dimulai**, bukan dari
stok saat tombol ditekan (FR-E7). Penjualan yang terjadi SELAMA opname tidak
ikut terkoreksi. Ini disengaja.

### 4.4 Produk tertandai habis padahal ada

Penandaan habis **terpisah** dari stok terhitung, dan keduanya tidak pernah
saling menyimpulkan (`spec-e:220`). Yang membatalkannya: tandai ulang sebagai
tersedia di perangkat — ia baris BARU bernilai `false`, bukan penghapusan.
Penanda ber-HLC terbaru yang menang.

Reset saat buka shift **menuntut konfirmasi** dan tidak pernah otomatis
(`spec-e:229`): kopi yang memang masih habis akan kembali terjual tanpa ada
yang tahu.

---

## 5. Pembayaran gateway (QRIS dinamis / EDC)

### 5.1 "Pelanggan sudah bayar, order belum lunas"

Ini kelas bug yang FR-C14 sebut paling sering menghasilkan uang hilang di POS.
Yang dibangun untuk mencegahnya:

- Payment ditulis `pending_confirmation` dan **di-commit SEBELUM** gateway
  dipanggil. Gateway yang timeout **tidak** menghapus jejak bahwa QR pernah
  diminta.
- **Tekan "Cek status"** — ia satu-satunya jalan payment QRIS menjadi
  `confirmed` selain webhook.

⛔ **Jangan membuat payment baru.** Retry harus memakai `Idempotency-Key` yang
SAMA; klien sudah melakukannya. Payment kedua menagih pelanggan dua kali.

### 5.2 Status gateway tidak dikenal

Sistem **tidak pernah** menandai lunas berdasarkan kata yang tidak dimengerti
(`spec-c:320`). Status asing dibaca `pending`. Kalau gateway memperkenalkan
status baru, itu perubahan KODE (`STATUS_MAP` di
`payment/providers/index.ts`), bukan sesuatu yang dapat dikonfigurasi.

### 5.3 Webhook Midtrans (`/webhooks/midtrans`)

| Jawaban | Artinya |
|---|---|
| `503 WEBHOOK_NOT_CONFIGURED` | `MIDTRANS_SERVER_KEY` kosong. Endpoint mati **dengan sengaja** — menerima notifikasi tanpa verifikasi jauh lebih berbahaya. |
| `401 INVALID_SIGNATURE` | Signature tidak cocok. Jangan "perbaiki" dengan melonggarkan verifikasi. |
| `400 MISSING_TENANT_REFERENCE` | Notifikasi tanpa `custom_field1`. |
| `404 PAYMENT_NOT_FOUND` / `SUBSCRIPTION_INVOICE_NOT_FOUND` | ⛔ **Midtrans akan mengulanginya.** Lihat di bawah. |

⛔ **Midtrans mengirim ulang notifikasi yang tidak dijawab 200, selamanya.**
Notifikasi 404 yang berulang berarti ada transaksi gateway yang tidak punya
padanan di database kami — selidiki, jangan diamkan. Rutenya diputuskan dari
prefiks `sub-` pada `order_id` sebelum satu query pun jalan: dengan prefiks =
tagihan langganan, tanpa = pembayaran penjualan.

### 5.4 Jabat tangan sungguhan belum pernah terjadi

⛔ Seluruh jalur webhook teruji dengan payload BUATAN. Jabat tangan sungguhan
menuntut URL publik (tunnel) dan **belum pernah dilakukan**. Perlakukan
integrasi pertama di produksi sebagai langkah yang butuh pengawasan.

---

## 6. Langganan & kuota

### 6.1 "Sudah upgrade tapi masih ditolak kuota"

Paket naik **hanya setelah gateway mengonfirmasi**, bukan saat tagihan dibuat.
Periksa B-29: status tagihan harus `Lunas`.

Kalau statusnya `Lunas` tapi kuota masih lama: itu **cacat**, bukan konfigurasi
— `terapkanStatusTagihan` menulis `plan` DAN keempat kolom `max_*` dalam satu
transaksi. Eskalasi dengan id tagihannya.

### 6.2 "Tombol upgrade tidak muncul"

Pilihan paket disembunyikan selama ada **tagihan terbuka**. Server menegakkan
satu tagihan terbuka per tenant lewat index unik parsial. Selesaikan atau
tunggu tagihan itu kedaluwarsa.

### 6.3 "QR pembayaran langganan hilang"

Sejak migrasi `0027`, QR **tersimpan** di baris tagihan dan muncul lagi setelah
halaman dimuat ulang. Kalau `qrString` kosong, gateway tidak menjawab saat
tagihan dibuat — tekan "Cek status pembayaran"; bila tagihan kedaluwarsa,
buat yang baru.

### 6.4 ⛔ Turun paket tidak dapat dilakukan sendiri

Dijawab `409 PLAN_NOT_AN_UPGRADE`. **Jalur manualnya belum ada.** Jangan
meng-`UPDATE` `tenant.plan` untuk menurunkannya: kuota `max_*` tidak ikut
berubah, dan tenant masuk keadaan yang tidak dapat dicapai lewat jalur mana
pun (`periksaPerpindahanPaket` ada justru untuk menolak keadaan itu).

### 6.5 ⛔ Membayar satu tagihan menaikkan paket PERMANEN

Tidak ada periode tagihan di skema dan tidak ada penanganan langganan
berakhir. Tidak ada apa pun yang menurunkan paket kembali. Keadaan yang
disengaja dan dinyatakan.

---

## 7. Katalog di kasir kosong atau basi

### 7.1 ⛔ Perangkap yang paling berbahaya di jalur turun

Membangun ulang tabel lokal **tidak memicu unduh ulang**. Checkpoint PowerSync
hidup di tabel `ps_*`, terpisah dari tabel kami: `waitForFirstSync()` selesai
dalam **0 ms dan melaporkan sukses** sementara katalog kosong **permanen**.

**Setiap migrasi skema lokal yang menyentuh raw table wajib diikuti
`disconnectAndClear()`.** Kode sudah melakukannya; kalau seseorang menjalankan
DDL manual di perangkat, ia harus melakukannya sendiri.

### 7.2 Katalog kosong tanpa error

Urutan pemeriksaan:

1. Apakah `tenant_id` dan `outlet_id` di layar Perangkat benar?
2. Apakah token sinkronisasi terbit? (`POST /devices/{id}/sync-token` menjawab
   `503 SYNC_TOKEN_NOT_CONFIGURED` bila `POWERSYNC_JWT_PRIVATE_KEY` kosong.)
3. ⛔ Apakah sync rules memuat filter tenant untuk tabel itu? **Sync rules
   adalah SATU-SATUNYA batas tenant pada jalur turun** — role replikasi
   ber-`BYPASSRLS`, dan RLS tidak berlaku di WAL. Satu `WHERE tenant_id`
   yang hilang membuat katalog merchant lain mendarat di perangkat yang salah
   **tanpa satu pun error**.
4. Klaim JWT `tenant_id`/`outlet_id` harus **top-level**, bukan di dalam objek
   `parameters`. Salah tempat menghasilkan **nol baris**, bukan error.

### 7.3 Angka salah 10.000× atau 1.000×

Kolom yang tipenya berbeda antara PostgreSQL dan skema lokal wajib punya `put`
raw table yang **ditulis sendiri**. Yang diketahui: `tax_rate.rate`,
`item_variation.conversion_factor`, `order_line.tax_rate`. Gejalanya nilai yang
tersimpan sebagai `real` di kolom `INTEGER` — hanya `typeof()` SQLite yang
membedakannya.

---

## 8. Kas & shift

### 8.1 "Tutup kas minta otorisasi padahal hitungannya cocok"

⛔ Saldo laci adalah `saldo_awal + SUM(cash_movement.delta)` — **satu-satunya
definisi** (`spec-d:14`). Kalau angka yang diharapkan terasa salah:

- `saldoSeharusnya` **mengecualikan** tipe `opening_float` dan memakai
  `shift.opening_float` langsung. Menjumlahkan keduanya menghitung modal awal
  dua kali.
- Hanya **refund tunai** yang mengurangi laci. `refund.method` diturunkan dari
  payment order aslinya lalu **disimpan**.
- Pembayaran campuran **melempar**, tidak menebak (`spec-d:207`).
- Ambang otorisasi selisih: **Rp 20.000** (`AMBANG_SELISIH`, `[ASUMSI]`).

### 8.2 Shift tidak dapat ditutup

Urutan input wajib (K-12). Percobaan hitungan **tercatat** — jumlah percobaan
muncul di laporan shift, dan itu disengaja.

### 8.3 Keranjang hilang setelah aplikasi dimuat ulang

⛔ **Keranjang K-03 hanya ada di MEMORI.** Ia hilang saat aplikasi dimuat
ulang. **Ini bukan kehilangan uang** — penjualan baru ada setelah tersimpan —
tapi kasir harus memasukkan ulang pesanannya. Belum ada pemulihan; skema sudah
menyiapkan jalannya (`order.status = 'open'` + `owned_by_device_id`, KEP-21).

### 8.4 Order `open` yang ditinggalkan mengunci stok

`POST /orders/cleanup-abandoned` ada dan teruji, **sengaja tanpa tombol UI** —
ia dijalankan sebagai cron dari luar aplikasi. ⛔ **Sampai cron itu dipasang,
keranjang `open` yang ditinggalkan mengunci stok selamanya.**

---

## 9. Server tidak sehat

| Gejala | Periksa |
|---|---|
| Seluruh permintaan 500 | `GET /health`. Lalu koneksi PostgreSQL. |
| Boot gagal: `MIDTRANS_SERVER_KEY kosong` | `PAYMENT_PROVIDER=midtrans` tanpa kunci. **Gagal saat boot disengaja** — jauh lebih murah daripada gagal saat pelanggan pertama membayar. |
| Boot gagal: `PAYMENT_PROVIDER tidak dikenal` | Nilai di luar `fake`/`midtrans`. Default tertutup. |
| Aplikasi kasir tidak dapat mencapai server sama sekali | `CORS_ORIGINS`. **Kosong = tidak ada origin yang diizinkan**, dan `*` tidak pernah dijawab. |
| `429` di `POST /tenants` | Rate limit pendaftaran, bawaan 5 per 15 menit (`TENANT_REGISTRATION_RATE_MAX` / `_WINDOW`). ⛔ Hanya endpoint itu yang dibatasi; jalur kasir tidak pernah ikut. |
| `DeprecationWarning: Calling client.query() when the client is already executing` | Ada `Promise.all` atas satu `PoolClient`. **Jangan mengembalikannya sebagai "optimasi"** — `node-postgres` mengantrekan query pada satu koneksi, jadi ia tidak pernah membeli apa pun. |

### 9.1 Metrik: `GET /metrics`

Teks eksposisi Prometheus, **tanpa sesi** — scraper tidak punya kredensial
manusia. Batasi di lapisan jaringan, bukan dengan menyembunyikannya di balik
login. Ia sengaja **tidak** ada di `openapi.yaml`: ia permukaan operasional,
bukan kontrak klien.

Yang pertama dilihat saat server terasa sakit:

| Metrik | Yang dicari |
|---|---|
| `lumi_http_requests_total{status="5xx"}` | Naik = ada yang rusak. Lihat `route` mana. |
| `lumi_http_request_duration_seconds` | p95 per rute. `ARCH:300` memakai 100 ms sebagai ambang untuk jalur keranjang. |
| `lumi_db_pool_connections{state="waiting"}` | ⛔ Berkelanjutan > 0 berarti permintaan **mengantre untuk koneksi**. Gejalanya "aplikasi lambat" tanpa satu pun error. |
| `lumi_uptime_seconds` | Turun mendadak = proses restart. |

⛔ **Yang TIDAK ada di sana, dan jangan dicari:** umur antrean sinkronisasi,
item gagal sinkron, latensi keranjang, crash rate, rasio offline. Lima dari
delapan metrik `ARCH:296` **tidak dapat dihasilkan server** — tiga terjadi di
perangkat, dan dua tentang antrean yang menurut definisinya belum pernah
sampai ke server. Semuanya menuntut telemetri klien (buffer offline-first +
endpoint ingest), yang **belum ada**.

⛔ **Nol data merchant.** `ARCH:309` menyebutnya batas etis. Ada test yang
menembak `/metrics` lalu mencari id tenant, nama outlet, nama produk, dan email
pengguna di dalamnya.

---

## 10. Alat koreksi append-only

⛔ **BELUM ADA.** Gate F6 menuntut *"alat koreksi ada sebelum insiden
pertama"*, dan bagian itu **masih terbuka**.

Yang ADA hari ini, dan semuanya append-only:

| Kebutuhan | Alat |
|---|---|
| Membatalkan penjualan | `POST /orders/{id}/cancel` — server memilih void atau refund dari status order |
| Mengoreksi stok | `POST /inventory/movements` (`adjustment`, wajib beralasan) · opname B-14 |
| Menutup order terbengkalai | `POST /orders/cleanup-abandoned` |
| Menyelamatkan antrean perangkat | Ekspor darurat K-14 |

Yang **tidak** ada, dan harus dibangun sebelum insiden pertama:

- Menyisipkan penjualan dari ekspor darurat kembali ke server (hari ini: hanya
  dapat dibaca manusia, tidak ada jalur impor).
- Menurunkan paket / membatalkan langganan.
- Membatalkan tagihan langganan yang terlanjur dibuat.
- Mengoreksi `refund.method` yang salah tersimpan (kolomnya tanpa default sejak
  migrasi `0021`, jadi salah nilai hanya mungkin dari klien yang cacat).

---

## 11. Yang TIDAK boleh dilakukan, apa pun tekanannya

1. ⛔ `UPDATE` pada `order`, `payment`, `refund`, `cash_movement`, atau
   `stock_movement` yang sudah ter-commit. Koreksi adalah record baru.
2. ⛔ `DELETE` pada tabel katalog. Yang ada hanya `archived_at`.
3. ⛔ Menjalankan aplikasi sebagai superuser atau role ber-`BYPASSRLS`.
4. ⛔ Menghapus database lokal perangkat sebelum ekspor darurat tersimpan di
   luar perangkat.
5. ⛔ Melonggarkan verifikasi signature webhook untuk "membuat notifikasi
   masuk".
6. ⛔ Menandai pembayaran lunas tanpa konfirmasi gateway.
7. ⛔ Menambahkan angka pajak di luar `TaxCalculator`.
