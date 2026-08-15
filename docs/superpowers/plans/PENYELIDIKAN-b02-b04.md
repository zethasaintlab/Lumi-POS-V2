# Penyelidikan B-02 / B-03 / B-04 — Riwayat & Detail Transaksi

**16 Agustus 2026** · branch `g1-penyelidikan-b02-b04-riwayat` · UI belum dibangun, sesuai instruksi.

---

## Ringkasan eksekutif

| Layar | Endpoint | Putusan |
|---|---|---|
| **B-02** Transaksi (daftar) | ❌ tidak ada | Kontrak dirancang · helper SQL + 16 test **sudah dibangun** |
| **B-03** Detail Transaksi | ⚠️ `GET /orders/{id}` ada, **tidak lengkap** | Butuh keputusan lintas-modul |
| **B-04** Shift (daftar) | ❌ tidak ada | ⛔ **DIBLOKIR** — datanya tidak ada di server |

Satu kalimat per layar:

- **B-02 dapat dibangun sekarang.** Yang menghalangi bukan endpointnya, melainkan bentuk data yang membuat query naif salah — dan itu sudah diselesaikan serta diuji.
- **B-03 setengah ada.** Ia mengembalikan keranjang belanja, tapi tidak pembayaran, tidak refund, tidak riwayat audit, dan tidak rantai koreksi.
- **B-04 tidak boleh dibangun.** Shift yang ditutup **tidak pernah sampai ke server**. Layarnya akan menampilkan setiap shift sebagai terbuka selamanya, tanpa hitungan kas dan tanpa selisih — justru angka yang membuat merchant membukanya.

---

## 1. Apa yang ada sekarang

Seluruh permukaan REST yang menyentuh transaksi:

| Rute | Operasi |
|---|---|
| `POST /orders` | `createOrder` |
| `GET /orders/{orderId}` | `getOrder` |
| `POST /orders/{orderId}/cancel` | `cancelOrder` |
| `POST /orders/{orderId}/payments` | `createPayment` |
| `POST /shifts` | `openShift` |

**Tidak ada `GET /orders`, tidak ada `GET /shifts`, tidak ada `GET /orders/{id}/payments`, tidak ada permukaan query audit.**

### 1.1 Paginasi: tidak ada, di seluruh API

Survei seluruh operasi `GET` di `openapi.yaml` — **nol** yang menerima `limit`, `offset`, atau `cursor`. Untuk katalog itu benar dan aman: jumlah item sebuah kafe terbatas.

Untuk transaksi, tidak. Satu outlet sibuk menulis 200–500 order per hari; sebulan ≈ 15.000 baris, dan itu satu outlet. Daftar transaksi tanpa paginasi bukan sekadar lambat — ia mengirim seluruh riwayat merchant ke browser pada setiap pembukaan layar.

### 1.2 `GET /orders/{orderId}` mengembalikan apa

Membaca `orders.ts:979`: order + `check` + `order_line` + `order_line_modifier`. Itu saja.

| Yang B-03 butuhkan | Ada? |
|---|:---:|
| Baris item + modifier | ✅ |
| Total, pajak, service charge, pembulatan | ✅ |
| Penanda selisih hitungan klien | ✅ |
| **Metode & status pembayaran** | ❌ |
| **Refund atas transaksi ini** | ❌ |
| **Order pembatal / rantai koreksi** | ❌ |
| **Riwayat audit (dibuat, dibayar, dibatalkan)** | ❌ |
| **Nama kasir** (hanya `createdBy` berupa id) | ❌ |
| Nama outlet, nama device | ❌ |

---

## 2. ⛔ Temuan yang menentukan bentuk B-02

### 2.1 Tabel `order` tidak berisi satu baris per transaksi

Ini tidak terlihat dari skema, dan query naif akan salah dalam tiga cara sekaligus.

Sebuah penjualan yang dibatalkan menghasilkan **dua** baris:

| baris | `status` | `voided_by_order_id` | apa sebenarnya ia |
|---|---|---|---|
| order asli | `open` | `NULL` | penjualan yang dibatalkan |
| order pembatal | `voided` | id order asli | catatan koreksi, bukan penjualan |

Arahnya dipaksa AC FR-B7 pertama — *"tidak ada `UPDATE` pada order asli"* — jadi order asli **tetap `open` selamanya**.

**Dibuktikan pada data sungguhan**, bukan disimpulkan dari kode. Dua penjualan yang di-void lewat `POST /orders/{id}/cancel`:

```
order  : [{"status":"voided","n":2},{"status":"open","n":2}]
```

Akibatnya untuk `SELECT * FROM "order"`:

1. **Empat baris untuk dua transaksi.**
2. Dua di antaranya berlabel `open` — terbaca sebagai pesanan yang belum selesai, padahal justru yang dibatalkan.
3. Dua lainnya berlabel `voided`, dan nilai uangnya **salinan** dari order aslinya. Menjumlahkan kolom itu menggandakan angka.

`posisi-penjualan.ts` sudah menyelesaikan hal yang sama untuk laporan. Helper B-02 memakai aturan yang sama, bukan menuliskannya lagi.

### 2.2 `status = 'open'` berarti dua hal yang berbeda

Keranjang yang belum dibayar, **atau** penjualan yang sudah dibatalkan. Menyamakannya membuat manajer mengira ada pesanan menggantung yang perlu ditutup.

Ini juga menyentuh utang yang sudah tercatat di `CLAUDE.md`: keranjang K-03 hanya ada di memori, dan *"order `open` yang tidak pernah dibayar akan muncul di laporan dan harus punya jalan penutupan"*. B-02 adalah layar pertama tempat itu akan terlihat merchant.

### 2.3 Tidak ada index untuk pencarian nomor struk

```sql
CREATE INDEX ix_order_outlet_date ON "order"(tenant_id, outlet_id, business_date);
CREATE INDEX ix_order_open        ON "order"(status) WHERE status = 'open';
UNIQUE (device_id, business_date, sequence)
```

`receipt_number` **tidak punya index sama sekali**, dan juga tidak punya UNIQUE. Yang menegakkan invariant `spec-h` I2 (*"satu nomor struk = tepat satu order"*) adalah `UNIQUE (device_id, business_date, sequence)` — nomor struknya diturunkan dari ketiganya, jadi invariantnya utuh, tapi lewat kolom lain.

Konsekuensi praktis: **kasus pemakaian utama B-02 — pelanggan datang membawa struk — adalah sequential scan.** Perlu migrasi:

```sql
CREATE INDEX ix_order_receipt ON "order"(tenant_id, receipt_number);
```

Belum saya buat: menambah migrasi di luar scope penyelidikan, dan keputusannya (index biasa vs UNIQUE) milikmu. Lihat §6.

### 2.4 `business_date` bergeser satu hari lewat `Date` JavaScript

Ditemukan dengan menjalankan test, bukan dengan membaca. `node-postgres` memetakan kolom `date` ke `Date` bertengah-malam **lokal**; `toISOString()` menariknya kembali ke UTC. Di WIB (+7) setiap tanggal mundur satu hari — `2026-08-10` terbaca `2026-08-09`, tanpa satu pun error.

Akibat keduanya, dan yang kedua jauh lebih sulit dilacak:

1. Setiap tanggal di layar salah satu hari.
2. **Kursor paginasi ikut bergeser**, jadi halaman kedua menyaring `< '2026-08-09'` dan membuang seluruh transaksi tanggal itu. **Halaman 2 datang kosong sementara datanya ada.**

Perbaikannya `to_char(business_date,'YYYY-MM-DD')` — tanggal selalu diformat database, sisi sebaliknya dari aturan "waktu selalu dari jam database".

---

## 3. ⛔ B-04 diblokir: shift tertutup tidak pernah sampai ke server

Rantai buktinya lengkap dan tidak menyisakan tafsir.

**a. Jalur naik hanya mengenal empat jenis entitas** (`packages/sync-client/src/http.ts`):

```js
const RUTE = {
  shift:        () => '/shifts',
  order:        () => '/orders',
  order_cancel: (id) => `/orders/${id}/cancel`,
  payment:      (id) => `/orders/${id}/payments`,
};
```

`enqueue.ts` **melempar** untuk jenis di luar daftar itu — jadi tutup shift tidak dapat masuk antrean bahkan bila seseorang mencoba.

**b. Tutup kas hanya menulis ke tabel LOKAL** (`apps/kasir/src/kas/tutup.ts:357`): satu baris `audit_event` bertipe `shift_closed` di SQLite perangkat. Tidak ada item outbox.

**c. Server tidak pernah meng-`UPDATE` shift.** `grep "UPDATE cash_drawer_shift" apps/server/src/` → **nol hasil**. Satu-satunya penulis adalah `POST /shifts`, yang menyisipkan `status = 'open'`.

**d. Dikonfirmasi pada data sungguhan:**

```
shift  : [{"status":"open","n":1,"closed":0}]
audit  : [{"event_type":"order.voided","n":2},
          {"event_type":"tenant_registered","n":1},
          {"event_type":"user_created","n":1}]
```

Nol `shift_closed`. `closed_at` NULL.

**Karena itu di server, `counted_amount`, `expected_amount`, `difference`, `closed_by`, `approved_by`, `count_attempts`, dan `closed_at` selamanya NULL.** Kolomnya ada sejak migrasi `0006`; yang tidak ada adalah jalan bagi nilainya untuk sampai.

B-04 yang dibangun sekarang akan menampilkan setiap shift "terbuka", saldo kosong, selisih kosong. Merchant membuka layar itu justru untuk melihat selisih kas — dan layar yang menampilkan kolom kosong terbaca sebagai bug, bukan sebagai fitur yang belum ada.

> **Yang dibutuhkan lebih dulu:** endpoint `POST /shifts/{id}/close` + jenis entitas `shift_close` di jalur naik. Itu pekerjaan Modul D di sisi server, bukan pekerjaan UI, dan **bukan keputusan yang boleh saya ambil sendiri**.

---

## 4. ⛔ Batas modul: tujuh pelanggaran yang sudah ada

Invariant #4 melarang query ke tabel milik modul lain. Modul `ordering` saat ini membaca tabel milik **empat** modul lain:

| Berkas | Tabel | Pemilik |
|---|---|---|
| `reports-pembayaran.ts:61` | `payment` | `payment` |
| `cancel.ts:462` | `payment` | `payment` |
| `exceptions-data.ts:120` | `audit_event` | `audit` |
| `exceptions-data.ts:122-123` | `"user"` ×2 | `identity` |
| `reports-kasir.ts:95` | `"user"` | `identity` |
| `cancel.ts:318` | `stock_movement` | `inventory` |

Sebagiannya saya sendiri yang tulis, di PR laporan dan PR X1.

`modules/README.md` sebenarnya sudah menyediakan jawabannya — ada modul `reporting` yang *"membaca lewat view yang disediakan modul lain"*, dan ia masih kosong. Seluruh endpoint laporan mendarat di `ordering` karena di sanalah tabel `order` berada.

**B-03 akan memperburuknya secara tajam**, karena detail transaksi menurut definisi menggabungkan order + pembayaran + refund + audit + nama orang: satu layar yang menyentuh lima modul.

Helper B-02 yang saya bangun **tidak menambah pelanggaran** — ia hanya menyentuh `order` dan `refund`, keduanya milik `ordering`, dan ada test yang menahannya begitu. Nama kasir diresolusi klien lewat `GET /users`, sama seperti nama outlet lewat `GET /outlets`.

---

## 5. Yang sudah dibangun di branch ini

`apps/server/src/modules/ordering/handlers/riwayat-data.ts` + `tests/server/riwayat-pesanan.test.js` (**16/16 hijau**).

```
ambilRiwayat(client, filter) -> { items, cursorBerikut }
```

Kemampuannya:

| Kemampuan | Bentuk |
|---|---|
| Rentang | `business_date`, keduanya termasuk |
| Outlet | `outlet_id` opsional |
| Kasir | `created_by` opsional |
| Nomor struk | cocok **persis** |
| Status | `terjual` · `dibatalkan` · `direfund` · `terbuka` · `ditinggalkan` |
| Paginasi | **keyset** `(business_date, sequence, id)` |
| Uang | STRING, presisi utuh di atas 2⁵³ |

### Keputusan yang mengikat kode ini

- ⛔ **Order pembatal tidak pernah menjadi baris daftar.** Ia catatan koreksi; nilainya salinan. Yang ditampilkan order asli dengan status `dibatalkan` dan penunjuk `dibatalkanOleh` untuk drill-down B-03.
- ⛔ **Aturan status hidup di SQL, dan hanya di SQL.** Ia harus dapat disaring dan diurutkan, dan penyaringan setelah `LIMIT` menghasilkan halaman yang lebih pendek daripada yang diminta — kadang kosong sementara masih ada baris yang cocok di belakangnya. Salinan di JavaScript akan menyimpang, dan bentuk penyimpangannya buruk: yang satu menentukan baris mana yang MASUK halaman, yang lain menentukan label yang DIBACA manajer. Ada test yang menahan JavaScript tidak menghitungnya ulang.
- ⛔ **Keyset, bukan `OFFSET`.** Order dari perangkat yang baru tersambung membawa `business_date` **historis** — ia menyisip di tengah urutan, bukan di ujungnya. Dengan `OFFSET`, satu sisipan membuat satu transaksi terlewat sepenuhnya: tidak ada error, hanya struk yang "tidak ada di sistem" saat pelanggan komplain. Ada test yang menyisipkan order di antara dua permintaan halaman.
- **Kursornya bukan `occurred_at`** — itu jam perangkat (jam ketiga), dan ia dapat mundur. Kursor yang mundur mengulang halaman selamanya.

### Sabotase

| Yang dimatikan | Akibat |
|---|---|
| `AND o.voided_by_order_id IS NULL` | test "satu baris daftar, bukan dua" merah |
| `LEFT JOIN "user"` ditambahkan | test batas modul merah |
| (organik) `to_char` diganti `toISOString` | 6 test merah, termasuk paginasi |

### Kontrak yang diusulkan

```
GET /orders?from&to&outlet_id&created_by&receipt_number&status&limit&cursor
```

```jsonc
{
  "items": [{
    "id": "…", "receiptNumber": "K1-20260810-0007",
    "businessDate": "2026-08-10", "sequence": 7,
    "outletId": "…", "deviceId": "…", "createdBy": "…",
    "occurredAt": "2026-08-10T03:00:00.000Z",
    "total": "127500",
    "status": "dibatalkan",
    "dibatalkanOleh": "…",       // null bila tidak dibatalkan
    "nilaiRefund": "0",
    "hasCalculationVariance": false
  }],
  "cursorBerikut": { "businessDate": "…", "sequence": 7, "id": "…" }
}
```

Belum didaftarkan di `openapi.yaml` dan belum punya handler — menunggu keputusan §6.

---

## 6. Keputusan yang saya butuhkan darimu

| # | Pertanyaan | Kenapa aku tidak memutuskannya sendiri |
|---|---|---|
| **1** | **Index `receipt_number`** — index biasa, atau `UNIQUE (tenant_id, receipt_number)`? | UNIQUE menegakkan I2 secara langsung, tapi ia dapat **gagal saat migrasi** bila sudah ada duplikat, dan itu perubahan skema |
| **2** | **B-03 lintas-modul** — tambahkan permukaan di `payment`/`audit`/`identity` lalu komposisi di handler, atau bangkitkan modul `reporting` yang `README` sudah janjikan? | Ini keputusan arsitektur, bukan implementasi. Yang kedua juga menjadi rumah bagi tujuh pelanggaran yang sudah ada |
| **3** | **B-04** — bangun `POST /shifts/{id}/close` (Modul D di server) lebih dulu, atau tunda B-04 seluruhnya? | Tanpa salah satunya, layarnya berbohong. Aku tidak menambah endpoint tulis tanpa persetujuanmu |
| **4** | **Pencarian struk** — cocok persis, atau awalan (`K1-20260810-%`)? | Persis sudah cukup untuk "pelanggan membawa struk". Awalan berguna untuk "semua struk device K1 hari itu", dan itu keputusan produk |
| **5** | **Keranjang `open` yang tidak pernah dibayar** — tampilkan di B-02 atau sembunyikan? | Utang yang `CLAUDE.md` sudah catat. B-02 adalah tempat pertama ia terlihat merchant, dan belum ada jalan penutupannya |

---

## 7. Yang **tidak** aku sentuh

- Tidak ada UI (sesuai instruksi).
- Tidak ada migrasi baru.
- Tidak ada endpoint baru di `openapi.yaml`.
- Tidak ada perbaikan atas tujuh pelanggaran batas modul — melaporkannya, bukan memperbaikinya diam-diam di tengah penyelidikan.
- `product/`, `research/`, dan `docs/superpowers/specs/` tidak disentuh.
