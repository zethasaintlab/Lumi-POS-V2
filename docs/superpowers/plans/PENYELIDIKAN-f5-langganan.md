# Penyelidikan — F5, upgrade paket berbayar

Tanggal 21 Agustus 2026. Ditulis sebelum satu baris kode pun.

Keputusan user: upgrade paket **self-serve + pembayaran**, scope epik pertama
**hanya** jalan menaikkan paket (endpoint + B-29).

---

## 1. Apa yang sudah ada, dan itu banyak

| Isi F5 | Status | Bukti |
|---|---|---|
| Pendaftaran mandiri | ada | `POST /tenants` |
| Kuota 4 dimensi | ada | `assertKuota` di outlet, device, pengguna, produk |
| Kuota tidak menyentuh jalur kasir | ada, **dijaga** | penjaga memindai `ordering`/`payment`/`cash` untuk pemanggilan `assertKuota` |
| Pemakaian vs kuota | ada | `GET /tenants/usage` + B-29 |
| Impor katalog | ada | `POST /catalog/import` + B-11 |
| Cabut device membebaskan kuota | ada | `hitungPerangkat` menyaring `revoked_at IS NULL` |

Yang **tidak** ada: satu pun cara mengubah `tenant.plan`. Pesan penolakan
kuota berbunyi *"Naikkan paket atau kurangi ... yang ada"* — kalimat yang
menunjuk ke jalan yang belum dibangun.

---

## 2. ⛔ Temuan terpenting: pembayaran langganan TIDAK DAPAT masuk tabel `payment`

Bukan sebagai preferensi arsitektur — **secara struktural mustahil**.
`db/migrations/0008_payment.sql`:

```sql
order_id   text NOT NULL REFERENCES "order"(id),
outlet_id  text NOT NULL REFERENCES outlet(id),
device_id  text NOT NULL REFERENCES device(id),
check_id   text NOT NULL REFERENCES "check"(id),
```

Tagihan langganan tidak punya satu pun dari keempatnya. Ia bukan penjualan di
outlet mana pun, tidak dilakukan perangkat mana pun, dan tidak menutup check
mana pun.

**Skemanya sudah mencegah kesalahan ini, dan itu kabar baik.** Kalau keempat
kolom itu nullable, jalan termudah adalah menulis tagihan langganan sebagai
`payment` — dan akibatnya: `posisi-penjualan.ts` menjumlahkan `payment` per
order, B-19 (Laporan Pembayaran) membaca tabel yang sama, dan **biaya langganan
merchant akan muncul sebagai omzet kafenya sendiri**. Cacat diam di jalur uang,
kelas yang sama dengan empat cacat F3.

Konsekuensi: tabel baru, dimiliki modul `tenancy`.

---

## 3. ⛔ Tabel `subscription` tidak punya skema di mana pun

`ERD:466` menyebut `usage_metric`, `subscription`, `support_session` lalu
berkata *"Sesuai spec modul komersial dan operasional"* — **spec itu tidak
ada**. `HANDOFF.md` sudah mencatat ini sebagai penundaan sadar di F0 untuk
menghindari menebak skema.

Artinya skemanya harus dirancang sekarang, dan seluruhnya `[ASUMSI]`.
Menyunting `product/ERD-lumi-pos-v1.md` bukan kewenangan agent — jadi setelah
migrasi ini mendarat, **ERD dan database akan berbeda sampai kamu
menyamakannya**, persis seperti `item_modifier_list` §15 yang sudah tercatat.

---

## 4. ⛔ Tabrakan webhook — bahaya operasional, bukan teori

Midtrans mengirim SELURUH notifikasi ke satu URL. Handler yang ada
(`payment/handlers/webhook.ts`) memperlakukan `order_id` notifikasi sebagai id
**payment** kami, dan bila tidak ditemukan:

```ts
throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pembayaran tidak ditemukan.');
```

Komentar di berkas yang sama menyebut sifat yang membuat ini berbahaya:
*"Midtrans mengirim ulang notifikasi yang tidak dijawab 200"*.

Jadi notifikasi tagihan langganan pertama yang tiba akan dijawab 404, lalu
**dikirim ulang selamanya**. Ini harus diselesaikan sebelum satu tagihan
langganan pun dibuat, bukan sesudahnya.

Dua jalan:
- **(a) Prefiks pada id yang dititipkan** — id tagihan langganan dikirim ke
  gateway dengan awalan yang dapat dikenali, dan webhook merutekan berdasarkan
  itu sebelum query mana pun.
- **(b) Cari di kedua tabel** — payment dulu, lalu tagihan langganan.

(a) lebih disukai: ia memutuskan rute **sebelum** menyentuh database, jadi
notifikasi asing tidak menghasilkan dua query yang keduanya gagal, dan
penambahan jenis tagihan berikutnya tidak menambah query ketiga.

---

## 5. Port: TAMBAH, jangan generalisasi

`PaymentProvider.initiate` menerima `InitiateRequest` yang mewajibkan
`orderId` dan `paymentId`. Melonggarkan keduanya jadi opsional berarti
menyentuh jalur uang yang sudah terbukti — untuk fitur yang bukan penjualan.

Yang diusulkan: port kedua, memakai ulang pipa HTTP adapter Midtrans yang ada
(termasuk `fetch` yang di-inject, sehingga **tetap nol test menyentuh
jaringan** — aturan yang CI tegakkan dengan mengisi `MIDTRANS_SERVER_KEY`
kosong).

---

## 6. ⛔ Turun paket adalah lubang yang kuota TIDAK jaga

`assertKuota` hanya berjalan saat MEMBUAT sesuatu. Tidak ada apa pun yang
memeriksa kuota saat batasnya sendiri yang berubah.

Tanpa penjaga: tenant dengan 8 outlet turun ke `free` (1 outlet) dan sistem
masuk keadaan yang tidak dapat dicapai lewat jalur mana pun — 8 outlet hidup di
bawah kuota 1, dan tidak ada satu pun error. Setiap layar yang menampilkan
"pemakaian vs kuota" akan menunjukkan 8/1.

Perubahan paket karena itu wajib memeriksa **seluruh empat dimensi** terhadap
kuota TUJUAN, dan menolak bila ada yang melebihi — dengan menyebut dimensi
mana dan angkanya.

---

## 7. Pertanyaan yang belum terjawab, ditandai bukan ditebak

| # | Pertanyaan | Kenapa tidak dapat kutebak |
|---|---|---|
| S-1 | Harga tiap paket (Rp/bulan) | `research/11` menyebut Rp349.000/Rp699.000 sebagai harga yang diuji ke merchant, tapi tidak memetakannya ke `free/standard/pro/enterprise` |
| S-2 | Siklus tagihan: bulanan, tahunan, atau keduanya | Menentukan bentuk tabel, bukan hanya angka |
| S-3 | Kapan paket naik — saat tagihan **dibuat** atau saat **dikonfirmasi** | Menentukan apakah merchant yang membayar lalu gagal bayar sempat memakai kuota lebih |
| S-4 | Apa yang terjadi saat langganan berakhir/gagal bayar | `research/09:213` melarang menghentikan penjualan. Turun otomatis ke `free` menabrak §6 di atas bila pemakaiannya melebihi |
| S-5 | Auto-charge berulang atau tagihan per periode | Auto-charge menuntut tokenisasi kartu di Midtrans. Itu **tidak** melanggar larangan menyimpan PAN (tokennya di Midtrans, bukan di kami), tapi ia keputusan tersendiri |

**S-3 dan S-4 memblokir kode**, bukan hanya dokumen. Sisanya dapat berjalan
dengan nilai `[ASUMSI]` yang ditandai.

---

## 8. Usul urutan

1. Migrasi: tabel tagihan langganan (tenancy), + RLS keempat operasi
2. Penjaga turun-paket (§6) — murni, di `packages/domain`, diuji sebagai property
3. Port langganan + adapter (§5)
4. Endpoint: buat tagihan → bayar → konfirmasi menaikkan paket
5. Routing webhook (§4)
6. B-29: pilih paket, lihat harga, bayar

Langkah 2 dapat dikerjakan lebih dulu dan berdiri sendiri — ia tidak menunggu
satu pun jawaban S-1..S-5.

---

## 9. Status, 21 Agustus 2026

| Langkah §8 | Status |
|---|---|
| 1. Migrasi tabel tagihan + RLS | selesai — `0026_subscription_invoice.sql`, isolasi 204/204 |
| 2. Penjaga turun-paket | selesai — `periksaPerpindahanPaket`, murni, diuji sebagai property |
| 3. Port langganan + adapter | selesai — `payment/providers/langganan.ts`, pipa HTTP dipakai ulang |
| 4. Endpoint buat → bayar → konfirmasi | selesai — tiga operasi REST, `tenancy` |
| 5. Routing webhook | selesai — prefiks `sub-`, jalan (a) |
| 6. B-29 pilih paket & bayar | **belum** — endpointnya belum punya konsumen UI |

### Jawaban atas S-1..S-5, dan mana yang masih terbuka

| # | Keadaan |
|---|---|
| S-1 harga | **Terjawab** KEP-38/KEP-39: Rp349.000 / Rp699.000 **per outlet per bulan**. Tetap `[ASUMSI]` — belum divalidasi ke merchant |
| S-2 siklus tagihan | **Masih terbuka.** Skema sengaja tanpa kolom periode; menebaknya berarti setiap tagihan membawa periode yang salah |
| S-3 kapan paket naik | **Terjawab: saat DIKONFIRMASI**, tidak pernah saat tagihan dibuat. `spec-c:320` — sistem tidak menandai lunas tanpa konfirmasi gateway |
| S-4 langganan berakhir | **Di luar scope** (keputusan user). Konsekuensi yang dinyatakan: membayar satu tagihan menaikkan paket **permanen** |
| S-5 auto-charge | **Tidak dibangun.** Tagihan per permintaan, dibayar QRIS. Tokenisasi kartu adalah keputusan tersendiri |

### Yang §6 tuntut, dan kenapa ia belum dipanggil

§6 menyebut lubang yang `assertKuota` tidak jaga: kuota tidak diperiksa saat
**batasnya sendiri** yang berubah. Penjaganya ada (`periksaPerpindahanPaket`)
dan **belum dipanggil dari mana pun** — dengan sengaja, dan itu bukan
kelalaian:

- Satu-satunya operasi yang mengubah `plan` hari ini adalah **kenaikan**, dan
  `periksaKenaikanPaket` menolak arah lain sebelum tagihan dibuat.
- Kuota naik monoton sepanjang `URUTAN_PAKET`, jadi kenaikan tidak dapat
  melanggar kuota. Itu **diuji sebagai property**, bukan diasumsikan.

Memanggilnya di jalur kenaikan akan menjadi cabang yang tidak pernah menyala —
kelas cacat yang sama dengan `arah = -1` di tutup kas. Ia menyala pada hari
endpoint penurunan paket lahir, dan pada hari itu ia sudah ada dan sudah
teruji.
