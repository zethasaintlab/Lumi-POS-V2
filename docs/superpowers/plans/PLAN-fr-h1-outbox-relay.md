# PLAN — FR-H1: antrean upload persisten (outbox + relay)

**Status:** SELESAI 8 Agustus 2026 — disetujui penuh, dikerjakan, 45 test hijau
**Fase:** F2, sisi klien · **Bentuk:** modul murni, tanpa UI (keputusan user 8 Agustus 2026)
**Spec:** `product/specs/spec-h-sinkronisasi.md` §FR-H1 (baris 37–71)

---

## 1. Yang dibangun

Tiga bagian, semuanya murni dan teruji tanpa browser:

1. **Penulis antrean** — `enqueue(tx, item)` yang dipanggil **di dalam transaksi pemanggil**, cerminan `apps/server/src/modules/sync/index.ts` di sisi klien. Ia tidak membuka transaksinya sendiri; itulah yang membuat AC pertama mungkin.
2. **Relay** — memilih batch, mengurutkan, mengirim, menerapkan backoff, memindahkan status. Tidak menyentuh jaringan maupun jam secara langsung.
3. **Klien REST** — di belakang port, dengan `fetchFn` di-inject. Pola yang sama dengan `PaymentProvider` (`apps/server/src/modules/payment/providers/index.ts`), bukan abstraksi baru.

Waktu, keacakan, dan I/O di-inject sebagai dependensi — prasyarat DST yang `CLAUDE.md` sebut retrofit-nya mahal.

---

## 2. Empat hal yang perlu kamu putuskan

### 2.1 Di mana kodenya tinggal

`apps/kasir` masih shell kosong, dan modul ini harus dapat diuji di Node tanpa browser.

**Usulan: workspace baru `packages/sync-client`**, sejajar `packages/domain`. Permukaan publiknya satu `index.ts` (invariant #4), dan `apps/kasir` nanti hanya memanggilnya.

Alternatifnya menaruhnya di `apps/kasir/src/sync/`, yang mengikat logika paling perlu diuji ke aplikasi yang belum ada.

### 2.2 Dependensi antar-item — `depends_on` atau tidak

Spec menuntut dua hal yang saling menarik:

> "Urutan pengiriman mengikuti `created_at` — dependensi dihormati (shift sebelum order)"
> "Item yang gagal **tidak memblokir** item berikutnya yang tidak bergantung padanya"

Tanpa penanda dependensi, satu-satunya cara memenuhi keduanya adalah: coba semua item berurutan, dan biarkan yang bergantung **gagal sendiri di server**. Itu berfungsi — tapi **membakar counter percobaannya**. Order yang sempurna bisa mencapai 20 percobaan dan ditandai `failed` permanen hanya karena shift-nya lambat terkirim.

**Usulan: tambah kolom `depends_on TEXT NULL`** ke `outbox_local` (menunjuk `outbox_local.id` lain). Item yang dependensinya belum `sent` **dilewati tanpa menambah `attempts`**.

Tidak ada migrasi lokal yang perlu ditulis — belum ada perangkat terpasang, jadi `db/local/001-initial.sql` disunting langsung, seperti pada `0018`.

**Kalau kamu menolak,** relay tetap benar tapi ambang `failed` jadi tidak dapat dipercaya, dan itu harus dicatat sebagai utang.

### 2.3 `entity_type` yang benar-benar dapat dikirim hari ini

Spec menyebut lima: `order · shift · stock_movement · audit_event · cash_movement`.

**Server hanya mengekspos endpoint untuk sebagian.** Yang ada: `openShift`, `createOrder`, `cancelOrder`, `createPayment`. Tidak ada endpoint berdiri sendiri untuk `stock_movement`, `audit_event`, maupun `cash_movement` — ketiganya ditulis **server-side di dalam transaksi order/cancel** (invariant #1), jadi ia ikut naik bersama order-nya dan tidak butuh entri outbox sendiri.

**Usulan: relay v1 menangani empat jenis** — `shift`, `order`, `order_cancel`, `payment` — dan **menolak jenis yang tidak dikenal dengan keras saat enqueue**, bukan diam-diam melewatinya.

Ini pembacaan saya terhadap spec, bukan pengabaiannya. Kalau maksudmu `cash_movement` berdiri sendiri (kas masuk/keluar, no-sale) harus bisa naik, ia butuh endpoint Modul D yang belum ada — dan itu pekerjaan terpisah.

### 2.4 `openShift` tidak menuntut `Idempotency-Key`

`createOrder`, `cancelOrder`, dan `createPayment` menuntutnya. `openShift` tidak — yang melindunginya hanya primary key `id` yang di-generate klien, dan retry menerima `409 ID_ALREADY_EXISTS`.

Relay **harus** memperlakukan `409 ID_ALREADY_EXISTS` sebagai **berhasil** — item itu memang sudah sampai. Itu benar dan akan saya bangun.

Tapi ia satu lapisan lebih sedikit daripada endpoint lain — persis catatan `CLAUDE.md` tentang `payment`. **Menambahkan `Idempotency-Key` ke `openShift` adalah perubahan server, di luar scope rencana ini.** Saya angkat; tidak saya kerjakan tanpa katamu.

---

## 3. Klasifikasi respons — inti kebenaran relay

Yang membedakan relay yang benar dari yang berbahaya bukan pengirimannya, melainkan bagaimana ia **membaca jawaban**:

| Respons | Tindakan | Alasan |
|---|---|---|
| `2xx` | `sent` | — |
| `409 ID_ALREADY_EXISTS` | **`sent`** | Sudah ada di server. Menganggapnya gagal berarti mengirim ulang selamanya |
| `409 IDEMPOTENCY_KEY_CONFLICT` | retry dengan backoff, **`attempts` naik** | Request kembar sedang diproses; jawabannya akan datang |
| `422 IDEMPOTENCY_KEY_REUSED` | **`failed` seketika** | Body berbeda dengan key yang sama — bug klien, dan 20 percobaan tidak akan memperbaikinya |
| `4xx` lain | **`failed` seketika** | Payload cacat. Mengulanginya 20× hanya menunda laporan |
| `5xx` · timeout · jaringan putus | retry dengan backoff | Server atau jaringan, bukan payload |

**Item `failed` tidak pernah dihapus** (spec baris 63).

**Respons yang HILANG diperlakukan sebagai `5xx`** — dan itu justru kasus yang membuat idempotency ada. `CLAUDE.md` menuntut idempotensi diuji "dengan retry berulang **dan respons yang hilang**"; harness akan menyuntikkan keduanya.

---

## 4. Pemulihan setelah mati mendadak

Item yang sedang dikirim saat aplikasi dibunuh tertinggal berstatus `sending` — selamanya, kalau tidak ada yang membereskannya.

**Saat mulai, setiap `sending` dikembalikan ke `pending`.** Aman justru karena `Idempotency-Key` sudah ditulis saat item dibuat, bukan saat dikirim: kalau request pertama ternyata sampai, retry menerima respons cache atau `409 ID_ALREADY_EXISTS`, dan keduanya berarti `sent`.

Kalau key di-generate saat pengiriman, pemulihan ini akan **menghasilkan duplikat**. Itulah kenapa `idempotency_key` sudah ada di kolom `outbox_local` sejak F0.

---

## 5. Bentuk port

Sengaja sempit, supaya `node:sqlite` (test) dan `writeTransaction` PowerSync (aplikasi) sama-sama memenuhinya tanpa adaptor tebal:

```ts
interface DbLokal {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbLokal) => Promise<T>): Promise<T>;
}
interface RelayDeps {
  db: DbLokal;
  fetchFn: typeof fetch;
  now: () => number;   // jam di-inject
  baseUrl: string;
}
```

Prototipe 04 sudah membuktikan `writeTransaction` PowerSync adalah `BEGIN IMMEDIATE`/`COMMIT` sungguhan, jadi `transaction` di atas tidak berpura-pura.

---

## 6. Task — TDD, test gagal dulu

| # | Isi |
|---|---|
| T1 | Skema: `depends_on` di `db/local/001-initial.sql` + index antrean, dengan test `tests/sqlite-local` |
| T2 | `enqueue(tx, item)` — menolak `entity_type` tak dikenal, menulis `idempotency_key` saat dibuat |
| T3 | **Atomisitas (AC #1)**: entitas + item outbox dalam satu transaksi; kegagalan yang disuntikkan tidak pernah menyisakan entitas tanpa outbox |
| T4 | Pemilihan batch: urut `created_at`, maksimum 50, item ber-backoff yang belum jatuh tempo dilewati |
| T5 | Klasifikasi respons — tabel §3, satu test per baris |
| T6 | Backoff 2/4/8/16/32/60/60…, dan `failed` pada percobaan ke-20 |
| T7 | **Dependensi (AC #4)**: item gagal tidak memblokir yang independen, dan yang bergantung dilewati **tanpa menambah `attempts`** |
| T8 | **Bertahan restart (AC #2)**: tutup DB di tengah kirim, buka lagi, `sending` → `pending`, tidak ada duplikat |
| T9 | **Property (AC #5)**: 1.000 item, jaringan putus-nyambung + respons hilang, RNG di-seed → server menerima **tepat sekali** per item |
| T10 | Pemeriksa determinisme: tidak ada `Date.now(`, `Math.random(`, `fetch` langsung di modul — cerminan pola `tests/dst` |

Skrip baru `test:sync-client`, masuk CI bersama yang lain.

---

## 7. Yang TIDAK dikerjakan

- **UI apa pun.** FR-H2 (SyncIndicator), FR-H3 (layar Status Sinkronisasi), FR-H4 (blokir operasi destruktif) tidak disentuh.
- **Integrasi ke `apps/kasir`.** Modul ini berdiri sendiri sampai pondasi klien ada.
- **Endpoint server baru.** Termasuk `Idempotency-Key` untuk `openShift` (§2.4) dan endpoint `cash_movement` berdiri sendiri (§2.3).
- **Menyambungkan relay ke PowerSync.** Port-nya disiapkan; pemasangannya pekerjaan lain.
- **`product/specs/`** tidak disunting. Kalau §2.3 berarti spec perlu diperjelas, itu keputusanmu.

---

## 8. Verifikasi sebelum menyatakan selesai

- [x] `test:sync-client` hijau, termasuk property test 1.000 item
- [x] Seluruh suite lama tetap hijau (740 test), `typecheck`, `lint:ds`
- [x] `npm ci` bersih setelah workspace baru ditambahkan
- [x] Sabotase: matikan pemulihan `sending` → `pending`, buktikan T8 merah. Matikan penanganan `409 ID_ALREADY_EXISTS`, buktikan T9 merah
- [x] Output sebenarnya ditempel, bukan diklaim

---

## 9. Checklist

- [x] Keputusan §2.1–§2.4 diterima
- [x] T1 skema + test · T2 enqueue · T3 atomisitas
- [x] T4 batch · T5 klasifikasi · T6 backoff · T7 dependensi
- [x] T8 restart · T9 property 1.000 item · T10 determinisme
- [x] Sabotase dijalankan dan hasilnya dicatat
- [x] HANDOFF diperbarui

---

## 10. Catatan pelaksanaan — tiga hal yang berbeda dari rencana

**Penyaringan dependensi salah tempat di versi pertama.** Rencana menyiratkan penyaringan di SQL. Ia benar-benar ditulis begitu, dan salah dengan cara yang halus: saat batch dipilih, shift masih `pending`, jadi order yang bergantung padanya **tidak pernah ikut terpilih** — keduanya tidak akan pernah naik dalam satu putaran. Ditangkap T7b. Penyaringannya pindah ke dalam loop, tempat status yang baru saja berubah sudah terlihat; urutan `created_at` yang menjamin dependensi selalu terpilih lebih dulu di batch yang sama.

**Penyaringan jatuh-tempo HARUS di SQL, dan itu tidak ada di rencana.** Kalau ia dilakukan setelah `LIMIT 50`, lima puluh item lama yang sedang backoff 60 detik mengisi seluruh batch dan menyisakan nol — sementara penjualan yang baru saja terjadi menunggu di belakangnya. Predikat SQL-nya **dihasilkan** dari `TANGGA_MS`, bukan diketik ulang, jadi ia tidak dapat hanyut dari tangganya. Dijaga T4b.

**Paket baru tidak ter-typecheck oleh apa pun.** `apps/server` tidak mengimpornya, jadi `tsc --noEmit --project apps/server` tidak menyentuhnya sama sekali — kesalahan tipe akan lolos diam-diam. Ditambahkan `packages/sync-client/tsconfig.json` dan dirantai ke skrip `typecheck`; dibuktikan menangkap dengan menyisipkan kesalahan tipe yang disengaja.

### Sabotase yang dijalankan

| Yang dimatikan | Akibat |
|---|---|
| `idempotency_key` diberi akhiran per percobaan | T9 + T9b merah: *"server membuat entitas lebih dari sekali — penjualan ganda"* |
| respons hilang → `gagal-permanen` | T9 merah: **432 dari 1.000 item** jadi `failed` — penjualan yang sudah tercatat di server, hilang dari antrean |
| `new Date()` disisipkan ke relay | T10 merah |
| tipe `BATAS_PERCOBAAN_GAGAL` dirusak | `typecheck` merah di dua berkas |

Jangkar diperiksa lebih dulu pada setiap sabotase — sabotase yang tidak mengenai apa pun membuat "hijau" tidak berarti.
