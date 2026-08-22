# Mencoba Lumi POS di browser

**Belum ada antarmuka pengguna.** `apps/kasir/src/App.tsx` masih 12 baris berisi
`AppShell` kosong; `apps/backoffice/` hanya berisi `README.md`. Yang sudah ada
adalah **API REST** — dan itu yang bisa kamu coba.

Panduan ini diverifikasi ujung ke ujung pada 2 Agustus 2026, bukan disusun dari
asumsi. Setiap angka di bawah adalah keluaran sungguhan.

---

## 1. Prasyarat

PostgreSQL 17 berjalan, dan `.env` sudah terisi. Sekali saja:

```bash
npm run db:bootstrap
```

```bash
npm run db:migrate
```

## 2. Jalankan server

```bash
node --env-file=.env apps/server/src/index.ts
```

Biarkan terminal ini terbuka. Server mendengarkan di port `3000`.

> `npm start` di `apps/server` **tidak** memuat `.env`, jadi koneksi database
> akan gagal. Pakai perintah di atas dari root repo.

## 3. Seed data awal

Modul identity dan tenancy belum dibangun, jadi belum ada `POST /tenants`,
`POST /outlets`, atau `POST /users`. Tanpa baris-baris itu tidak ada
`X-Tenant-Id` maupun `X-Actor-Id` yang sah, dan **seluruh API menolak setiap
request**. Skrip ini menutup celah itu:

```bash
node --env-file=.env tools/dev-seed.mjs
```

Ia mencetak id yang kamu butuhkan plus satu blok siap tempel. Setiap run
membuat tenant baru; tidak ada yang dihapus.

Yang **sengaja tidak** di-seed: device, shift, katalog, order. Semuanya sudah
punya endpoint — justru itu yang mau kamu coba.

## 4. Buka browser

Buka **`http://localhost:3000/health`**. Kamu akan melihat `{"status":"ok"}`.

Halaman ini sengaja dipakai sebagai pijakan: server **belum memasang CORS**,
jadi `fetch` hanya diizinkan dari origin yang sama. Membuka file HTML sendiri
atau tab lain akan diblokir browser.

Buka **DevTools → Console** (F12), lalu tempel blok yang dicetak `dev-seed.mjs`.
Isinya kira-kira begini:

```js
const T = "<tenant-id>";
const A = "<actor-id>";
const OUTLET = "<outlet-id>";
const H = { 'content-type': 'application/json', 'x-tenant-id': T, 'x-actor-id': A };
const uid = () => crypto.randomUUID();
const api = async (m, p, b) => {
  const r = await fetch(p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  console.log(m, p, '->', r.status, t.slice(0, 400));
  return t ? JSON.parse(t) : null;
};
```

**Semua `id` di-generate klien** (konvensi ULID/UUIDv7) — bukan oleh server.
Auto-increment mustahil untuk penulisan offline.

---

## 5. Alur satu penjualan

Jalankan berurutan di Console.

### 5.1 Provisioning device

```js
const dev = await api('POST', '/devices', { id: uid(), outletId: OUTLET, code: 'K1', name: 'Kasir Depan' });
```

Coba juga kode yang sama dua kali — penolakannya **menyebut device mana yang
sudah memakai kode itu**, bukan sekadar "duplikat" (FR-B6).

### 5.2 Buka shift

```js
const shift = await api('POST', '/shifts', { id: uid(), outletId: OUTLET, deviceId: dev.id, businessDate: '2026-08-02', openingFloat: 200000 });
```

Buka shift kedua untuk device yang sama → `409`. Satu device, satu shift terbuka.

### 5.3 Katalog

```js
const itemId = uid(), varId = uid();
await api('POST', '/items', { id: itemId, name: 'Kopi Susu', variations: [{ id: varId, price: 25000 }] });
```

`25000` di sini adalah **harga awal** dan beku selamanya. Semua perubahan harga
lewat `price_history`.

### 5.4 Harga khusus outlet

```js
await api('POST', `/items/${itemId}/variations/${varId}/prices`, { id: uid(), price: 27000, outletId: OUTLET, reason: 'Harga outlet pusat' });
```

Lihat resolusinya, lengkap dengan anak tangga mana yang dipakai:

```js
await api('GET', `/items/${itemId}/variations/${varId}/price?outletId=${OUTLET}`);
```

→ `{ price: 27000, source: "outlet", ... }`

Tanpa `outletId`, jawabannya `25000` dengan `source: "variation"` — tangga
paling bawah.

### 5.5 Penjualan

```js
const orderId = uid();
const order = await api('POST', '/orders', {
  id: orderId, outletId: OUTLET, deviceId: dev.id, shiftId: shift.id,
  receiptNumber: 'K1-20260802-0001', businessDate: '2026-08-02',
  sequence: 1, channel: 'takeaway', checkId: uid(),
  lines: [{ id: uid(), variationId: varId, quantityMilli: 2000, discountAmount: 0, modifiers: [] }]
});
```

`quantityMilli: 2000` berarti **2 buah** — kuantitas selalu `INTEGER ×1000`,
supaya `0.5 kg` (`500`) bisa disimpan tanpa float.

Hasil sungguhan:

```
unitPrice  27000     <- dari resolver, bukan harga awal
lineTotal  54000
total      54000
taxAmount  0         <- Modul C belum ada; ini BUKAN "pajak benar"
hlc        "117025908375945216"
```

Order + check + seluruh baris + modifier ditulis dalam **satu transaksi**
(invariant #1).

---

## 6. Yang paling layak dicoba: struk tidak berubah oleh katalog

Ini janji inti FR-B3, dan paling mudah dibuktikan sendiri.

```js
await api('POST', `/items/${itemId}/variations/${varId}/prices`, { id: uid(), price: 35000, outletId: OUTLET, reason: 'Kenaikan' });
await api('PATCH', `/items/${itemId}`, { name: 'Kopi Susu Gula Aren' });
await api('POST', `/items/${itemId}/archive`, {});
await api('GET', `/orders/${orderId}`);
```

Harga sekarang `35000`, nama sekarang "Kopi Susu Gula Aren", itemnya sudah
diarsipkan — tapi order lama tetap:

```
namaDiStruk   "Kopi Susu"
hargaDiStruk  27000
total         54000
```

Struk lama tidak pernah berubah karena katalog berubah. `order_line` menyimpan
**salinan nilai**, bukan referensi yang di-resolve saat ditampilkan.

---

## 7. Coba tembus isolasi tenant

Jalankan `dev-seed.mjs` sekali lagi untuk mendapat tenant kedua, lalu pakai
`X-Tenant-Id` tenant A dengan `outletId` milik tenant B:

```js
await api('POST', '/shifts', { id: uid(), outletId: '<outlet-tenant-B>', deviceId: dev.id, businessDate: '2026-08-02', openingFloat: 0 });
```

→ `404`, dan **tidak ada baris tersimpan**.

Ini bukan formalitas. Foreign key PostgreSQL **tidak tunduk RLS** — ia dicek
dengan privilese owner tabel yang direferensikan. Empat kali di proyek ini,
menonaktifkan guard-nya membuat request lintas tenant lolos dengan `201`
**dan barisnya benar-benar tersimpan**. Rinciannya di `CLAUDE.md` §
"Temuan F1".

---

## 8. Yang belum bisa dicoba

| | Kenapa |
|---|---|
| UI kasir & back-office | Belum dibangun sama sekali |
| Pembayaran, `OPEN → PAID` | Modul C, sub-project berikutnya |
| Pajak yang benar | `TaxCalculator` (Modul C) belum ada — kolom pajak ditulis nol |
| Void & refund | Sub-project B-3 |
| Stok berkurang saat jual | Modul E |
| Offline / sync | F2 |
| Cetak struk | F4 |

Daftar operasi lengkap ada di `packages/contracts/openapi.yaml`
(cari `operationId`).

---

## Kalau macet

| Gejala | Sebab |
|---|---|
| `MISSING_TENANT_ID` / `MISSING_ACTOR_ID` | Header belum diset — tempel ulang blok `H` |
| `UNKNOWN_TENANT` | Tenant sudah terhapus. Jalankan `dev-seed.mjs` lagi |
| `fetch` diblokir CORS | Kamu tidak berada di tab `http://localhost:3000/...` |
| Server gagal start, error koneksi | `.env` tidak termuat — pakai perintah `node --env-file=.env ...` di §2 |
| `404` di endpoint yang harusnya ada | Server berjalan dari commit lama; restart |
