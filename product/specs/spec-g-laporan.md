# Spec Modul G — Laporan & Exception

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul G · **Riset:** `/research/08` § 3 (KEP-30), `/research/11` § 7

---

## G.0 Ringkasan modul

Modul ini adalah **alasan owner membayar setiap bulan**. Produk yang hanya "bekerja diam-diam" akan di-churn karena owner tidak melihat apa yang dibayarnya (Goal G4 di PRD induk).

Dua kelompok laporan dengan tujuan berbeda:
- **Operasional** — apa yang terjadi hari ini.
- **Exception** — apa yang tidak wajar. Ini yang menemukan kebocoran, dan ini yang dijual.

**Invariant:**

1. Semua laporan menghitung posisi penjualan bersih dari **satu fungsi tunggal**.
2. Setiap laporan menyatakan eksplisit apakah angkanya bersih atau kotor.
3. Laporan device ini berfungsi penuh saat offline.
4. Angka di dua laporan berbeda untuk periode sama **tidak boleh** berbeda.

---

## G.1 Sumber kebenaran tunggal

### FR-G3 [P0] — Satu fungsi untuk posisi penjualan bersih

**Deskripsi.** Karena penjualan bersifat append-only (KEP-17), setiap laporan harus menghitung posisi bersih dengan menjumlahkan penjualan, void, dan refund. Bila setiap laporan mengimplementasikan logikanya sendiri, laporan akan saling bertentangan — dan **laporan yang saling bertentangan menghancurkan kepercayaan merchant lebih cepat daripada fitur yang hilang**.

**Definisi kanonik:**

```
omzet_kotor      = SUM(order.total)
                   WHERE status IN ('PAID','CLOSED','REFUNDED')
                     AND business_date BETWEEN ...

void_amount      = SUM(order.total) WHERE status = 'VOIDED'
                   → TIDAK termasuk dalam omzet kotor maupun bersih

refund_amount    = SUM(refund.amount)

omzet_bersih     = omzet_kotor − refund_amount

pajak_terkumpul  = SUM(order_line.tax_amount) untuk order yang sama,
                   dikurangi porsi yang direfund
```

**Aturan implementasi.** Satu view/fungsi database (`v_sales_position`) atau satu modul aplikasi. Setiap laporan **memanggilnya**, tidak menulis query sendiri.

**Acceptance criteria.**

- [ ] Hanya ada satu tempat di kode yang mendefinisikan omzet bersih — diverifikasi dengan grep terhadap pola `status = 'VOIDED'` di luar modul laporan
- [ ] Laporan penjualan harian dan laporan per produk untuk periode sama menghasilkan total identik
- [ ] Laporan shift dan laporan harian untuk shift yang sama konsisten
- [ ] Property test: untuk kombinasi penjualan/void/refund apa pun, semua laporan sepakat

---

### FR-G2 [P0] — Deklarasi bersih atau kotor

**Deskripsi.** Ambiguitas di sini menghasilkan komplain merchant yang tidak berujung.

**Aturan.** Setiap tampilan angka penjualan menyertakan label yang tidak dapat dilewatkan:

```
Penjualan hari ini          Rp 12.450.000
Setelah void & refund       ← label wajib, bukan tooltip
```

**Acceptance criteria.**

- [ ] Setiap laporan yang menampilkan angka penjualan memiliki label bersih/kotor yang terlihat tanpa interaksi
- [ ] Ekspor CSV/XLSX menyertakan label yang sama di header
- [ ] Struk laporan shift menyertakannya

---

## G.2 Laporan operasional

### FR-G1 [P0] — Laporan inti

| Laporan | Isi | Offline |
|---|---|---|
| **Penjualan harian** | Omzet kotor, void, refund, omzet bersih, jumlah transaksi, rata-rata per transaksi, rincian per metode pembayaran, pajak terkumpul per jenis | ✅ device ini |
| **Per produk** | Qty terjual, omzet, kontribusi %, margin (bila punya hak) — diurutkan dan dapat difilter kategori | ✅ device ini |
| **Per kasir** | Transaksi, omzet, void, refund, diskon, selisih kas | ✅ device ini |
| **Per shift** | Isi laporan tutup kas (lihat Modul D § D.4) | ✅ |
| **Per metode pembayaran** | Nilai, jumlah transaksi, perkiraan settlement setelah MDR | ✅ device ini |
| **Per jam** | Distribusi transaksi per jam — untuk perencanaan staf | ✅ device ini |

**Definisi tanggal bisnis.** Semua laporan harian memakai **tanggal bisnis**, bukan tanggal kalender. Tanggal bisnis berakhir saat shift ditutup, bukan tengah malam. Kafe yang tutup pukul 01:00 mengharapkan penjualan pukul 00:30 masuk hari sebelumnya.

**Acceptance criteria.**

- [ ] Keenam laporan tersedia dan konsisten satu sama lain
- [ ] Tanggal bisnis diterapkan konsisten di seluruh laporan
- [ ] Kasir hanya melihat laporan shiftnya sendiri
- [ ] Kolom margin tidak muncul untuk peran Kasir
- [ ] Laporan render < 2 detik pada data satu bulan

---

### FR-G4 [P0] — Laporan offline dari data lokal

**Deskripsi.** Laporan device ini dihitung dari SQLite lokal, tanpa memanggil server.

**Batasan yang harus dinyatakan di UI:**

```
Laporan ini hanya mencakup transaksi dari perangkat ini.
Terakhir tersinkron: 2 jam lalu
```

**Acceptance criteria.**

- [ ] Laporan device ini berfungsi dengan jaringan mati
- [ ] UI menyatakan cakupan (device ini saja) dan waktu sinkronisasi terakhir
- [ ] Angka laporan lokal cocok dengan laporan server setelah tersinkron — diverifikasi test

---

### FR-G7 [P0] — Laporan online-only

**Deskripsi.** Laporan lintas-outlet dan historis panjang memerlukan koneksi.

**Behavior.**

```
GIVEN perangkat offline
WHEN pengguna membuka laporan lintas-outlet
THEN empty state menjelaskan: mengapa tidak tersedia, apa yang tersedia
     sebagai gantinya, dan apa yang harus dilakukan
 AND BUKAN spinner tanpa akhir
```

Sesuai aturan design system: kegagalan menjelaskan **alasan**, bukan spinner tanpa akhir.

**Acceptance criteria.**

- [ ] Setiap layar laporan ditandai offline-capable atau online-only di kode
- [ ] Layar online-only memiliki empty state khusus offline, bukan error generik
- [ ] Tidak ada spinner tanpa timeout

---

## G.3 Laporan exception

### FR-G5 [P1] — Delapan laporan exception

**Deskripsi.** Setiap laporan berasal dari pola deteksi fraud yang terdokumentasi industri. Ini **fitur yang dibeli owner**, bukan sekadar kontrol keamanan — harus muncul di materi penjualan.

**Prinsip deteksi:** yang dicari bukan nilai absolut melainkan **variasi** — angka yang lebih tinggi dari biasanya untuk orang atau periode tertentu.

| # | Laporan | Yang ditampilkan | Sinyal yang dicari |
|---|---|---|---|
| **X1** | Void & refund per kasir | Jumlah dan nilai per kasir, dibandingkan rata-rata seluruh kasir, dengan rasio | Kasir dengan rasio > 2× rata-rata |
| **X2** | Void mendekati/sesudah tutup shift | Void dalam 60 menit terakhir shift, dan void setelah shift ditutup | Lonjakan di akhir shift — pola klasik |
| **X3** | Refund bernilai tinggi | Refund di atas persentil 90, dengan alasan dan penyetuju | Refund besar dengan alasan generik |
| **X4** | Frekuensi no-sale | Pembukaan laci tanpa transaksi per kasir per shift | Frekuensi jauh di atas rekan kerja |
| **X5** | Diskon manual per kasir | Total nilai, frekuensi, sebaran alasan | Kasir dengan diskon tinggi terkonsentrasi pada alasan tertentu |
| **X6** | Item berulang dibatalkan | Item yang ditambah lalu dihapus berkali-kali pada satu order | Manipulasi keranjang sebelum pembayaran |
| **X7** | Selisih kas per kasir | Selisih per shift dengan tren, positif dan negatif | Selisih konsisten satu arah |
| **X8** | Anomali waktu | Transaksi dengan selisih besar `occurred_at` vs `recorded_at` di luar durasi offline yang wajar | Manipulasi jam perangkat |

**Format tampilan.** Setiap laporan menampilkan **daftar terurut berdasarkan tingkat anomali**, bukan tabel mentah. Baris teratas adalah yang paling layak diselidiki.

**Yang harus dihindari:** menuduh. Laporan menampilkan angka dan konteks, bukan label "mencurigakan". Selisih dapat berasal dari kesalahan jujur, dan produk yang menuduh karyawan merchant akan merusak hubungan merchant dengan stafnya.

**Behavior.**

```
GIVEN kasir Sari memiliki 12 void dalam sebulan
  AND rata-rata kasir lain 3 void
WHEN owner membuka laporan X1
THEN Sari muncul di baris teratas dengan rasio 4,0×
 AND menampilkan sebaran alasan void Sari
 AND dapat di-drill down ke daftar transaksinya
 AND TIDAK ada label "mencurigakan" atau sejenisnya
```

**Acceptance criteria.**

- [ ] Kedelapan laporan tersedia dan dapat difilter per periode dan per outlet
- [ ] Pengurutan berdasarkan tingkat anomali, bukan abjad atau waktu
- [ ] Setiap baris dapat di-drill down ke transaksi penyusunnya
- [ ] Tidak ada bahasa yang menuduh
- [ ] Kasir tidak dapat mengakses laporan exception
- [ ] Laporan tetap benar ketika satu kasir bekerja di beberapa outlet

---

### Notifikasi proaktif

**Deskripsi.** Merchant kecil sering tidak membuka laporan. Deteksi yang tidak dibaca tidak bernilai.

**Aturan.** Ringkasan mingguan dikirim ke owner berisi maksimal **tiga temuan teratas** dengan satu kalimat konteks masing-masing. Bukan daftar lengkap — daftar lengkap tidak dibaca.

**Acceptance criteria.**

- [ ] Ringkasan dikirim mingguan; frekuensi dapat diubah atau dimatikan
- [ ] Maksimal tiga temuan
- [ ] Setiap temuan menyertakan tautan langsung ke laporan detail
- [ ] Tidak dikirim bila tidak ada anomali — mengirim "tidak ada temuan" setiap minggu melatih owner mengabaikannya

---

## G.4 Ringkasan owner

### FR-G6 [P1] — Ringkasan harian untuk HP

**Deskripsi.** Persona P3 membuka aplikasi pukul 23:00 di HP 390×844 untuk satu pertanyaan: *"hari ini bagaimana, dan apakah ada yang aneh."*

**Isi dalam satu layar tanpa scroll:**

```
┌────────────────────────────┐
│ Hari ini                   │
│                            │
│ Rp 12.450.000        ↑ 8%  │  ← omzet bersih + delta vs
│ Setelah void & refund         rata-rata 4 minggu terakhir
│                            │
│ 187 transaksi   Rp 66.578  │  ← rata-rata per transaksi
│                            │
│ ─────────────────────────  │
│ Tunai        Rp  6.200.000 │
│ QRIS         Rp  5.100.000 │
│ Kartu        Rp  1.150.000 │
│ ─────────────────────────  │
│                            │
│ ⚠ 2 hal perlu diperiksa    │  ← hanya muncul bila ada
│   Selisih kas Cabang Dago  │
│   Void tinggi: Sari (4×)   │
│                            │
│ [Lihat laporan lengkap]    │
└────────────────────────────┘
```

**Aturan design system:** angka uang `--text-display` dengan `tabular-nums`; delta memakai `↑`/`↓`; warna semantik hanya untuk status, selalu disertai teks.

**Acceptance criteria.**

- [ ] Muat dalam satu layar 390×844 tanpa scroll
- [ ] Delta dibandingkan rata-rata 4 minggu terakhir pada hari yang sama, bukan hari sebelumnya
- [ ] Bagian "perlu diperiksa" tidak muncul bila tidak ada temuan
- [ ] Multi-outlet: ringkasan agregat dengan rincian per outlet dapat dibuka
- [ ] Render < 2 detik pada koneksi seluler

---

## G.5 Ekspor

**Format:** CSV dan XLSX. PDF tidak didukung di v1 — merchant dan akuntan membutuhkan data yang dapat diolah.

**Aturan.**

- Setiap file memuat metadata di dalamnya: nama merchant, outlet, rentang periode, waktu dibuat, dan **label bersih/kotor**.
- Ekspor tercatat di audit trail (`data_exported`) — ini adalah data keluar dari sistem.
- Ekspor besar (> 50.000 baris) diproses asinkron dengan notifikasi saat siap.

**Acceptance criteria.**

- [ ] Metadata ada di dalam file, bukan hanya nama file
- [ ] Angka di ekspor cocok dengan angka di layar untuk periode sama
- [ ] Ekspor tercatat di audit trail dengan jumlah baris
- [ ] Format angka mengikuti locale Indonesia di XLSX

---

## G.6 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Belum ada transaksi hari ini | Empty state "Belum ada transaksi hari ini" dengan jam berjalan — **berbeda** dari "tidak ada yang cocok dengan filter" |
| Filter tidak menemukan hasil | "Tidak ada yang cocok dengan filter" + tombol reset |
| Periode dipilih di masa depan | Ditolak dengan pesan |
| Periode 5 tahun pada tenant besar | Diproses asinkron; UI menyatakan estimasi waktu |
| Kasir bekerja di 2 outlet dalam satu hari | Laporan per kasir mengagregasi lintas outlet; laporan per outlet memisahkannya |
| Transaksi offline masuk setelah laporan dilihat | Angka berubah. UI menyatakan waktu data terakhir diperbarui, dan laporan dapat di-refresh |
| Void terjadi setelah laporan harian dikirim | Laporan berikutnya menampilkan koreksi; laporan tidak diubah surut |
| Outlet baru tanpa data historis | Delta tidak ditampilkan alih-alih menampilkan `↑ ∞` |
| Semua kasir memiliki void tinggi | Rata-rata ikut tinggi, rasio semua mendekati 1. Laporan menampilkan **nilai absolut juga**, bukan hanya rasio — agar pola menyeluruh tetap terlihat |
| Refund melebihi penjualan pada satu hari (refund transaksi hari lalu) | Omzet bersih negatif; ditampilkan apa adanya dengan penjelasan |
| Produk diarsipkan | Tetap muncul di laporan periode ketika masih aktif |
| Kategori produk diubah | Laporan historis mengikuti kategori **saat ini**; dinyatakan di catatan laporan |

---

## G.7 Test yang wajib ada

**Property test:**

- [ ] Untuk kombinasi penjualan/void/refund apa pun: semua laporan sepakat pada omzet bersih
- [ ] `omzet_bersih` = `omzet_kotor` − `refund_amount` untuk periode apa pun
- [ ] Jumlah laporan per kasir = laporan harian outlet, untuk periode sama

**Test contoh:**

- [ ] Penjualan → void → refund dalam satu hari; verifikasi keenam laporan
- [ ] Transaksi pukul 00:30 pada outlet yang tutup 01:00 masuk tanggal bisnis sebelumnya
- [ ] Laporan lokal cocok dengan laporan server setelah sinkronisasi

**Test exception:**

- [ ] Kasir dengan void 4× rata-rata muncul di baris teratas X1
- [ ] Void 30 menit sebelum tutup shift muncul di X2
- [ ] Transaksi dengan jam device mundur 2 jam muncul di X8

**Test performa:**

- [ ] Laporan bulanan pada 150.000 transaksi < 2 detik
- [ ] Ringkasan owner < 2 detik pada koneksi seluler

---

## G.8 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Ambang anomali X1 (rasio 2×) — validasi dengan data nyata setelah beberapa merchant aktif | Setelah rilis |
| — | Apakah ringkasan mingguan dikirim lewat email, WhatsApp, atau notifikasi in-app? WhatsApp paling dibaca di Indonesia tetapi menambah dependensi | Implementasi notifikasi |
| — | Berapa lama laporan historis tersedia untuk tier Standar (24 bulan) — apakah cukup? | Implementasi kuota |
| — | Apakah laporan margin dibutuhkan di v1, mengingat resep/BOM baru ada di v1.2 sehingga HPP F&B belum akurat? | Perencanaan F3 |

---

*Spec Modul G · Lumi POS v1 · Draft 0.1*
