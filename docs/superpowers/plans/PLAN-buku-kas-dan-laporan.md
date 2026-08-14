# PLAN — Buku kas (`cash_movement`) dan fondasi Modul G

**Fase:** F3 · **Ditulis:** 14 Agustus 2026 · **Status:** Tahap A & B selesai; Tahap C berikutnya

**Spec:** `product/specs/spec-d-kas-shift.md` (FR-D5, FR-D6) · `product/specs/spec-g-laporan.md` (FR-G3, FR-G1)

---

## 1. Kenapa plan ini didahulukan daripada Modul G

Gate F3 adalah *"buka toko → jual → tutup buku dengan angka konsisten antar laporan"*, dan Modul G invariant nomor 4 berbunyi: **angka di dua laporan berbeda untuk periode sama tidak boleh berbeda**. FR-G3 menuntut satu fungsi tunggal untuk posisi penjualan bersih.

Saat mengaudit siapa saja yang sudah menghitung posisi uang, saya menemukan bahwa penghitung yang sudah ada **menghitungnya dari tabel yang salah**, dan hasilnya merugikan kasir. Membangun Modul G di atasnya akan menyalin kesalahan itu ke setiap laporan.

---

## 2. Temuan — saldo laci dihitung dari tabel yang salah

### 2.1 Apa yang dituntut spec

`spec-d:14`, invariant Modul D nomor 1:

> Saldo laci terhitung = `saldo_awal + SUM(cash_movement.delta)`

`spec-d:315`, property test wajib:

> Untuk urutan operasi apa pun: `expected_amount` = `opening_float` + `SUM(cash_movement.delta)`

### 2.2 Apa yang dilakukan kode

`apps/kasir/src/kas/tutup.ts:93-102` menghitungnya dari **`payment`**, bukan `cash_movement`:

```sql
SELECT p.method, p.amount,
       CASE WHEN o.status = 'voided' THEN -1 ELSE 1 END AS arah
  FROM payment p JOIN "order" o ON o.id = p.order_id
 WHERE o.shift_id = ?
```

Kata `refund` tidak muncul sama sekali di berkas itu. **Klien tidak pernah menulis satu pun baris `cash_movement`** — tabelnya hanya dideklarasikan sebagai raw table di `skema.ts:42`.

### 2.3 Akibatnya, terukur

Refund menulis baris `refund`, dan **tidak pernah** menulis baris `payment` — `payment.amount` punya `CHECK (amount > 0)`, dan arah berlawanan dinyatakan lewat tabel `refund` (keputusan 7 Agustus 2026). Query di atas karena itu tidak dapat melihat refund sama sekali.

Dibuktikan di `tests/kasir/tutup-kas-refund.test.js`, di atas SQLite sungguhan dengan skema lokal sungguhan:

```
penjualan tunai Rp 300.000 → refund tunai Rp 300.000 → laci berisi Rp 500.000 (saldo awal)
saldo seharusnya menurut kode: Rp 800.000
                        →  800000 !== 500000
```

Kasir terlihat **kurang Rp 300.000** untuk laci yang isinya persis benar. Rp 300.000 di atas ambang Rp 20.000, jadi tutup kas juga **menuntut otorisasi manajer** untuk selisih yang tidak pernah ada — setiap kali ada refund tunai.

Cabang `arah = -1` sendiri **tidak pernah menyala**: order pembatal ber-status `voided` tidak punya baris `payment`, dan order asli mempertahankan statusnya. Ia kode mati.

### 2.4 Kenapa test tidak menangkapnya

`tests/kasir/tutup-kas.test.js:63-67`:

```js
// Penjualan tunai 2.010.000, refund tunai 25.000 — angka dari contoh spec-d.
const PEMBAYARAN = [
  { method: 'cash', amount: 2010000, arah: 1 },
  { method: 'cash', amount: 25000, arah: -1 },
];
```

`dbPalsu` mengembalikan larik itu apa adanya untuk query mana pun yang cocok `/FROM payment/`. Barisnya **tidak dapat dihasilkan query sungguhannya** — refund tidak menulis `payment`, dan tidak ada order ber-`payment` yang berstatus `voided`. Fake-nya mengarang bentuk data yang skemanya sendiri tidak bisa menghasilkan, jadi aritmetikanya diuji terhadap dunia yang tidak ada.

Ini keluarga yang sama dengan dua pelajaran yang sudah tercatat di `CLAUDE.md` (`ON CONFLICT`, `audit_event.tenant_id`), tapi satu tingkat lebih buruk: yang sebelumnya fake gagal **menegakkan** constraint; yang ini fake **mengarang datanya**.

### 2.5 Yang ikut hilang

`spec-d:189` mendaftar tujuh tipe movement. Yang dapat memengaruhi saldo laci sekarang: **nol**. `paid_in`, `paid_out`, `bank_deposit`, `adjustment`, dan `opening_float` tidak punya jalur sama sekali.

### 2.6 Bukan kelalaian F2

`apps/server/src/modules/cash/handlers/shifts.ts:12` menyatakannya eksplisit: *"selisih, cash_movement, no-sale tetap F3."* `cash_movement` memang dijadwalkan di sini. Yang tidak disadari adalah bahwa penundaannya **meninggalkan penghitung pengganti yang salah** di jalur produksi, bukan meninggalkan lubang yang terlihat kosong.

---

## 3. Yang akan dibangun

### Tahap A — buku kas (`cash_movement`) menjadi sumber tunggal

- [x] A1. `sale` ditulis di dalam `writeTransaction` yang sama dengan penjualan (`penjualan.ts`), **hanya** untuk payment `method = cash` (`spec-d:200`). `delta` = `amount`, bukan `tendered_amount` (`spec-d:201`) — invariant #1 CLAUDE.md menyebut cash movement sebagai bagian dari satu transaksi itu, dan sekarang ia benar-benar ada
- [x] A0. Kolom `refund.method` — migrasi server + skema lokal + ERD (keputusan §5)
- [x] A2. `refund` ditulis di dalam transaksi pembatalan (`pembatalan.ts`), `delta` negatif, **hanya bila `refund.method = 'cash'`**
- [x] A4. `counterpart_type` diisi per tipe, `NOT NULL` (FR-D6) — tabel pemetaan di `packages/domain`, supaya server dan klien tidak pernah berbeda
- [x] A5. `saldoSeharusnya` dihitung dari `saldo_awal + SUM(delta)`; query berbasis `payment` dihapus, termasuk cabang `arah` yang mati
- [x] A6. Property test `spec-d:315`: untuk urutan operasi apa pun, `expected_amount` = `opening_float` + `SUM(delta)`
- [x] A7. `tests/kasir/tutup-kas.test.js` diperbaiki — `PEMBAYARAN` yang dikarang diganti baris sungguhan di SQLite sungguhan
- [x] A8. **Server menulis movement-nya sendiri**, bukan menerimanya lewat outbox — lihat catatan di bawah

**A8 berubah bentuk, dan itu keputusan.** Rencana awalnya merelay `cash_movement` sebagai entity outbox baru, yang menuntut endpoint REST baru + entry di `ENTITY_TYPES` + rute di `http.ts`. Yang dipilih: server menulis movement-nya sendiri di dalam transaksi pembayaran dan transaksi refund yang **sudah** ada. Alasannya:

- server sudah menerima order beserta payment-nya, dan sudah menghitung `cost_at_sale` sendiri — polanya persis sama
- tidak ada jendela tempat movement mendarat tanpa order yang menjelaskannya
- tidak ada idempotensi kedua yang harus dijaga; ia ikut idempotensi pembayaran

Yang membuat kedua sisi tidak pernah berbeda BUKAN relay, melainkan `packages/domain/src/buku-kas.ts`: arah delta, `counterpart_type`, dan derivasi `refund.method` semuanya dibaca dari sana oleh klien maupun server.

- [ ] A3. Movement `opening_float` saat buka shift — **belum**. Tidak memengaruhi hitungan (`saldoSeharusnya` memakai `shift.opening_float` langsung dan mengecualikan tipe ini), tapi buku kasnya belum dapat merekonstruksi laci dari movement saja

### Tahap B — FR-G3, satu fungsi posisi penjualan bersih

- [x] B1. `packages/domain`: definisi kanonik omzet kotor / void / refund / bersih sebagai fungsi murni
- [x] B2. Laporan shift (`laporanShift`) memanggilnya, bukan menghitung sendiri
- [x] B3. Property test `spec-g:293` — untuk kombinasi penjualan/void/refund apa pun, semua laporan sepakat
- [x] B4. Penjaga satu-sumber (AC FR-G3 pertama) — **polanya diubah, dan itu keputusan**

Pola yang ACnya sebut (`status = 'VOIDED'` di luar modul laporan) tidak dapat dipakai apa adanya: di repo ini `status = 'voided'` muncul sah di `pembatalan.ts` dan `cancel.ts`, karena di sanalah baris pembatal DITULIS. Meng-grep pola itu menandai penulisan yang benar dan melewatkan yang berbahaya.

Yang dijaga: tidak ada `SUM(...)` atas tabel `"order"` di luar `posisi-penjualan.ts`. Pola aslinya tetap ditegakkan, dipersempit ke berkas laporan.

Versi pertama penjaga ini menandai `SUM(amount)` apa pun dan menemukan tiga tempat yang semuanya sah — sisa refund dan sisa tagihan, keduanya agregasi per-order untuk penegakan. Dipersempit, bukan dilonggarkan dengan daftar pengecualian: penjaga yang menandai kode benar akan dimatikan orang berikutnya.

### Tahap C — FR-G1 laporan operasional, FR-G4 offline, FR-G2 label bersih/kotor

Dirinci setelah A dan B selesai.

---

## 4. Di luar scope plan ini

Laporan exception FR-G5 (P1) · ringkasan owner FR-G6 (P1) · ekspor G.5 · notifikasi proaktif · Modul E (inventori) · laporan lintas-outlet FR-G7 (butuh server).

---

## 5. Keputusan — diambil 14 Agustus 2026

**Pertanyaan 1 → (b) tambah kolom `refund.method`.** Bukan diturunkan dari payment order asli. Konsekuensinya: migrasi di kedua sisi, dan `refund.method` didokumentasikan di ERD — kewenangan untuk suntingan ERD spesifik itu diberikan lewat pilihan ini.

Yang menjadi lebih baik dibanding rekomendasi saya: pembayaran campuran (`spec-d:207`) punya jawaban sejak hari pertama, dan tidak ada `[ASUMSI]` yang harus dibongkar nanti di jalur uang.

**Pertanyaan 2 → ya, Tahap A dulu.** Buku kas menjadi sumber tunggal sebelum Modul G dibangun di atasnya.

**Pertanyaan 3** tetap terbuka, bukan untuk agent.

---

<details>
<summary>Bentuk asli pertanyaannya, untuk jejak</summary>

### Pertanyaan 1 — bagaimana klien tahu sebuah refund dikembalikan TUNAI?

Tabel `refund` **tidak punya kolom `method`**, di kedua sisi (`db/migrations/0007_ordering.sql:98`, `db/local/001-initial.sql:189`). Hanya refund tunai yang mengurangi laci, jadi jawabannya menentukan `delta`.

Tiga jalan:

| | Cara | Konsekuensi |
|---|---|---|
| **a** | Turunkan dari payment order aslinya — order yang dibayar tunai, refundnya tunai | Tanpa perubahan skema. Salah bila merchant mengembalikan lewat transfer, dan tidak punya jawaban untuk pembayaran campuran (`spec-d:207` menyebutnya) |
| **b** | Tambah `refund.method` | Jujur dan eksplisit. **Perubahan skema + ERD** — kewenanganmu, bukan aku |
| **c** | Kasir memilih saat refund | Paling benar; menambah satu langkah UI di K-10 yang sudah selesai |

Rekomendasi saya: **(a) sekarang**, dengan `[ASUMSI]` tertulis, karena klien v1 hanya menulis satu payment per order dan seluruhnya tunai — jadi (a) dan (c) menghasilkan angka identik hari ini. (b) atau (c) menjadi wajib begitu pembayaran campuran ada.

### Pertanyaan 2 — apakah tahap A dikerjakan sekarang?

Tahap A memperbaiki kode F2 yang **sudah ter-merge ke `main`**. Ia bukan Modul G, dan menambah pekerjaan sebelum F3 benar-benar mulai.

Menurut saya ia prasyarat, bukan pilihan: FR-G3 menuntut satu sumber angka, dan sumber yang ada sekarang salah. Tapi keputusan mendahulukannya milikmu.

### Pertanyaan 3 — `research/00` dan `research/03` masih menulis "Node.js 22+"

Terpisah dari plan ini, tercatat supaya tidak hilang. Lantai sebenarnya 24.7. Penyuntingan dokumen riset bukan kewenangan agent.

</details>
