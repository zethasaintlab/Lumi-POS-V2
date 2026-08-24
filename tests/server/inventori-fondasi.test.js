'use strict';

// B-12, B-13, dan pembersihan keranjang terbengkalai.
//
// ⛔ Seluruhnya di atas PostgreSQL sungguhan. Yang diuji adalah SALDO —
// hasil `SUM(delta)` atas ledger — dan saldo tidak dapat diuji dengan fake
// tanpa memindahkan aturan penjumlahannya ke dalam test itu sendiri.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, device, shift, varId, varTanpaStok;

before(async () => {
  owner = await connectAsOwner();
  db = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await db.end();
  if (app) await app.close();
});

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'content-type': 'application/json',
  ...ubah,
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'InvFondasi' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  varId = crypto.randomUUID();
  varTanpaStok = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const itemId2 = crypto.randomUUID();

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, outletId, device, base.user.id]
  );
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Kopi Susu')`, [itemId, tenant.id]);
  await db.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price, track_stock)
     VALUES ($1,$2,$3,'Reguler',25000,true)`,
    [varId, tenant.id, itemId]
  );
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Jasa Antar')`, [itemId2, tenant.id]);
  await db.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price, track_stock)
     VALUES ($1,$2,$3,'Standar',10000,false)`,
    [varTanpaStok, tenant.id, itemId2]
  );
  await db.query('COMMIT');
});

async function saldo(variationId = varId) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT COALESCE(SUM(delta),0)::text s FROM stock_movement
      WHERE outlet_id = $1 AND variation_id = $2`,
    [outletId, variationId]
  );
  await db.query('COMMIT');
  return r.rows[0].s;
}

let seq = 0;

/** Order `open` dengan satu baris. `umurJam` menua `recorded_at`-nya. */
async function order({ qtyMilli = 3000, umurJam = 0, variationId = varId, status = 'open' } = {}) {
  seq += 1;
  const id = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    headers: hdr({ 'idempotency-key': crypto.randomUUID() }),
    payload: {
      id,
      outletId,
      deviceId: device,
      shiftId: shift,
      receiptNumber: `K1-20260810-${String(seq).padStart(4, '0')}`,
      businessDate: '2026-08-10',
      sequence: seq,
      channel: 'takeaway',
      checkId: crypto.randomUUID(),
      lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli }],
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  if (umurJam > 0 || status !== 'open') {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
    if (umurJam > 0) {
      await db.query(
        `UPDATE "order" SET recorded_at = now() - ($1 || ' hours')::interval WHERE id = $2`,
        [String(umurJam), id]
      );
    }
    if (status !== 'open') {
      await db.query(`UPDATE "order" SET status = $1 WHERE id = $2`, [status, id]);
    }
    await db.query('COMMIT');
  }
  return id;
}

// ⛔ TANPA content-type: permintaannya memang tidak berbadan, dan Fastify
// benar menolak 'application/json' yang badannya kosong.
const bersihkan = (ubah = {}) =>
  app.inject({
    method: 'POST',
    url: '/orders/cleanup-abandoned',
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      ...ubah,
    },
  });

async function statusOrder(id) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query('SELECT status FROM "order" WHERE id = $1', [id]);
  await db.query('COMMIT');
  return r.rows[0]?.status;
}

// ---------------------------------------------------------------------------
// TUGAS 1 — pembersihan keranjang terbengkalai
// ---------------------------------------------------------------------------

test('⛔ stok yang dikunci keranjang mati KEMBALI, persis sebanyak yang diambil', async () => {
  // Inti seluruh tugas ini. Movement `sale` ditulis saat order DIBUAT, jadi
  // keranjang yang tidak pernah dibayar memegang stoknya selamanya.
  const id = await order({ qtyMilli: 3000, umurJam: 25 });
  assert.equal(await saldo(), '-3000', 'penjualan tidak mengurangi stok');

  const res = await bersihkan();
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();

  assert.equal(body.jumlahDibersihkan, 1);
  assert.equal(body.movementDitulis, 1);
  assert.equal(body.totalStokDikembalikan, '3000');
  assert.equal(await saldo(), '0', 'stok tidak kembali ke nol');
  assert.equal(await statusOrder(id), 'abandoned');
});

test('⛔ keranjang yang MASIH MUDA tidak disentuh', async () => {
  // Ambangnya ada supaya pesanan yang sedang diketik kasir tidak dibatalkan
  // di tengah jalan.
  const id = await order({ qtyMilli: 2000, umurJam: 1 });
  const res = await bersihkan();

  assert.equal(res.json().jumlahDibersihkan, 0);
  assert.equal(await statusOrder(id), 'open');
  assert.equal(await saldo(), '-2000', 'stok keranjang muda ikut dikembalikan');
});

test('⛔ order yang SUDAH DIBAYAR tidak disentuh walau tua', async () => {
  // Ia penjualan sungguhan. Mengembalikan stoknya berarti mengaku barang itu
  // masih di rak sementara pelanggan sudah membawanya pulang.
  const id = await order({ qtyMilli: 1000, umurJam: 48, status: 'paid' });
  const res = await bersihkan();

  assert.equal(res.json().jumlahDibersihkan, 0);
  assert.equal(await statusOrder(id), 'paid');
  assert.equal(await saldo(), '-1000');
});

test('⛔ dijalankan DUA KALI tidak mengembalikan stok dua kali', async () => {
  // Kegagalan yang paling mudah terjadi dan paling sulit terlihat: stok naik
  // melebihi yang pernah ada, dan tidak ada error di mana pun.
  await order({ qtyMilli: 5000, umurJam: 30 });

  const satu = await bersihkan();
  assert.equal(satu.json().jumlahDibersihkan, 1);
  assert.equal(await saldo(), '0');

  const dua = await bersihkan();
  assert.equal(dua.json().jumlahDibersihkan, 0, 'putaran kedua memproses order yang sama');
  assert.equal(await saldo(), '0', 'stok naik melebihi yang pernah ada');
});

test('keranjang berisi produk TANPA pelacakan stok tetap ditutup', async () => {
  // Tidak ada movement untuk dibalik, tapi ordernya tetap harus ditutup —
  // kalau tidak, ia menggantung selamanya di status `open`.
  const id = await order({ qtyMilli: 1000, umurJam: 25, variationId: varTanpaStok });
  const res = await bersihkan();

  assert.equal(res.json().jumlahDibersihkan, 1);
  assert.equal(res.json().movementDitulis, 0);
  assert.equal(await statusOrder(id), 'abandoned');
});

test('⛔ movement balikannya dapat dibedakan dari void sungguhan', async () => {
  // Tipenya `void` karena FR-E2 tidak punya tipe "ditinggalkan" dan
  // menambahkannya menuntut migrasi di server DAN di skema lokal perangkat.
  // Yang membedakannya `reason_code`.
  await order({ qtyMilli: 4000, umurJam: 25 });
  await bersihkan();

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT type, reason_code, delta::text d FROM stock_movement
      WHERE variation_id = $1 AND delta > 0`,
    [varId]
  );
  await db.query('COMMIT');

  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].type, 'void');
  assert.equal(r.rows[0].reason_code, 'order_abandoned');
});

test('audit event dipancarkan untuk setiap keranjang yang ditutup', async () => {
  await order({ qtyMilli: 1000, umurJam: 25 });
  await bersihkan();

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(`SELECT event_type, reason_code FROM audit_event WHERE event_type = 'order.abandoned'`);
  await db.query('COMMIT');

  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].reason_code, 'order_abandoned');
});

test('⛔ kasir tidak dapat menjalankan pembersihan massal', async () => {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [base.user.id]);
  await db.query('COMMIT');

  const res = await bersihkan();
  assert.equal(res.statusCode, 403, res.body);
});

// ---------------------------------------------------------------------------
// TUGAS 3 — B-13 pergerakan manual
// ---------------------------------------------------------------------------

const gerak = (payload, ubah = {}) =>
  app.inject({ method: 'POST', url: '/inventory/movements', headers: hdr(ubah), payload });

test('⛔ receipt adalah satu-satunya jalan MEMASUKKAN stok', async () => {
  assert.equal(await saldo(), '0');
  const res = await gerak({ outletId, variationId: varId, type: 'receipt', delta: '10000' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await saldo(), '10000');
});

test('adjustment bertanda, boleh negatif', async () => {
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '10000' });
  const res = await gerak({
    outletId, variationId: varId, type: 'adjustment', delta: '-2500',
    reasonCode: 'rusak', note: 'Tumpah saat pemindahan',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await saldo(), '7500');
});

test('⛔ adjustment TANPA alasan ditolak (AC FR-E2)', async () => {
  const res = await gerak({ outletId, variationId: varId, type: 'adjustment', delta: '-1000' });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error.message, /reasonCode/);
  assert.equal(await saldo(), '0', 'movement tertulis walau ditolak');
});

test('⛔ receipt NEGATIF ditolak — kalau tidak, ia jalan pintas mengurangi tanpa alasan', async () => {
  const res = await gerak({ outletId, variationId: varId, type: 'receipt', delta: '-5000' });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error.message, /adjustment/);
});

test('⛔ tipe penjualan DITOLAK di endpoint manual', async () => {
  // `sale`, `void`, dan `refund` lahir dari transaksi penjualan di transaksi
  // database yang sama dengannya (invariant #1). Menerimanya di sini membuka
  // jalan menulis pergerakan penjualan tanpa penjualannya.
  for (const type of ['sale', 'void', 'refund', 'stocktake', 'transfer_in']) {
    const res = await gerak({ outletId, variationId: varId, type, delta: '1000' });
    assert.equal(res.statusCode, 400, `${type} diterima`);
  }
  assert.equal(await saldo(), '0');
});

test('delta nol dan delta cacat ditolak', async () => {
  for (const delta of ['0', 'banyak', '', '1.5']) {
    const res = await gerak({ outletId, variationId: varId, type: 'receipt', delta });
    assert.equal(res.statusCode, 400, `delta "${delta}" diterima`);
  }
});

test('⛔ variation tenant lain ditolak — kolomnya TIDAK punya FK sama sekali', async () => {
  // `stock_movement.variation_id` adalah `text NOT NULL` tanpa referensi:
  // tidak ada apa pun di database yang menolak id karangan, apalagi id milik
  // tenant lain.
  const lain = await seedTenantBase(db, { suffix: 'InvLain' });
  const varLain = crypto.randomUUID();
  const itemLain = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Milik Lain')`, [itemLain, lain.tenant.id]);
  await db.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price) VALUES ($1,$2,$3,'R',1000)`,
    [varLain, lain.tenant.id, itemLain]
  );
  await db.query('COMMIT');

  const res = await gerak({ outletId, variationId: varLain, type: 'receipt', delta: '1000' });
  assert.notEqual(res.statusCode, 201, 'variation tenant lain diterima');
});

test('⛔ kasir tidak dapat mencatat pergerakan stok', async () => {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [base.user.id]);
  await db.query('COMMIT');

  const res = await gerak({ outletId, variationId: varId, type: 'receipt', delta: '1000' });
  assert.equal(res.statusCode, 403, res.body);
});

// ---------------------------------------------------------------------------
// TUGAS 2 — B-12 saldo stok
// ---------------------------------------------------------------------------

const stok = (q = '') =>
  app.inject({ method: 'GET', url: `/reports/inventory/stocks${q}`, headers: hdr() });

test('saldo = SUM(delta), dengan nama produk dari katalog', async () => {
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '10000' });
  await order({ qtyMilli: 3000 });

  const res = await stok(`?outlet_id=${outletId}`);
  assert.equal(res.statusCode, 200, res.body);
  const baris = res.json().items.find((b) => b.variationId === varId);

  assert.equal(baris.saldoMilli, '7000');
  assert.equal(baris.itemName, 'Kopi Susu', 'nama produk tidak ikut — JOIN katalog gagal');
  assert.equal(baris.variationName, 'Reguler');
  assert.equal(baris.jumlahMovement, 2);
});

test('⛔ pembagian 1000 TIDAK dilakukan di SQL', async () => {
  // `SUM(delta) / 1000` atas kolom bigint adalah pembagian INTEGER: 2500
  // menjadi 2, dan setengah kilogram menghilang tanpa error.
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '2500' });

  const baris = (await stok(`?outlet_id=${outletId}`)).json().items.find((b) => b.variationId === varId);
  assert.equal(baris.saldoMilli, '2500');
  assert.equal(baris.saldo, '2,5', 'saldo dibulatkan — pembagian integer di SQL');
});

test('⛔ uang/kuantitas keluar sebagai STRING, presisi utuh', async () => {
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '9007199254740993' });
  const baris = (await stok(`?outlet_id=${outletId}`)).json().items.find((b) => b.variationId === varId);
  assert.equal(typeof baris.saldoMilli, 'string');
  assert.equal(baris.saldoMilli, '9007199254740993');
});

test('saldo negatif tampil apa adanya, tanpa clamp', async () => {
  await order({ qtyMilli: 4000 });
  const baris = (await stok(`?outlet_id=${outletId}`)).json().items.find((b) => b.variationId === varId);
  assert.equal(baris.saldoMilli, '-4000');
  assert.equal(baris.saldo, '-4');
});

test('penyaring only_negative menyisakan yang perlu ditindak', async () => {
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '10000' });
  await order({ qtyMilli: 1000, variationId: varTanpaStok });

  const semua = (await stok(`?outlet_id=${outletId}`)).json().items;
  const negatif = (await stok(`?outlet_id=${outletId}&only_negative=true`)).json().items;
  assert.ok(semua.length >= 1);
  assert.equal(negatif.every((b) => BigInt(b.saldoMilli) < 0n), true);
});

test('⛔ include_zero menampilkan varian yang BELUM punya movement', async () => {
  // Justru produk itu yang paling perlu terlihat di B-12: barang baru yang
  // stoknya belum pernah dimasukkan. Nol yang hilang dari daftar terbaca
  // sebagai "tidak ada masalah".
  const tanpa = (await stok(`?outlet_id=${outletId}`)).json().items;
  assert.equal(tanpa.length, 0, 'tanpa movement seharusnya kosong');

  // ⛔ Diperiksa terhadap VARIAN MILIK test ini, bukan jumlah total —
  // `seedTenantBase` ikut menanam katalognya sendiri, dan menghitung seluruh
  // baris membuat test ini pecah setiap kali seed berubah.
  const dengan = (await stok(`?outlet_id=${outletId}&include_zero=true`)).json().items;
  const punyaTest = dengan.filter((b) => [varId, varTanpaStok].includes(b.variationId));
  assert.equal(punyaTest.length, 2, 'varian tanpa movement tidak muncul');
  assert.equal(punyaTest.every((b) => b.saldoMilli === '0'), true);
  assert.equal(punyaTest.every((b) => b.jumlahMovement === 0), true);
});

test('⛔ isolasi tenant: stok tenant lain tidak pernah muncul', async () => {
  await gerak({ outletId, variationId: varId, type: 'receipt', delta: '10000' });
  const lain = await seedTenantBase(db, { suffix: 'InvStokLain' });

  const res = await app.inject({
    method: 'GET',
    url: '/reports/inventory/stocks',
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().items, []);
});

test('⛔ outlet tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'InvOutletLain' });
  const res = await stok(`?outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ saldoTampil klien-server sepakat dengan B-03', async () => {
  const { saldoTampil } = await import(
    '../../apps/server/src/modules/reporting/handlers/stok.ts'
  );
  const { kuantitasTampil } = await import(
    '../../apps/server/src/modules/reporting/handlers/detail-transaksi.ts'
  );
  for (const n of [1000, 2500, 500, 12000, 3000]) {
    assert.equal(saldoTampil(BigInt(n)), kuantitasTampil(n), `berbeda untuk ${n}`);
  }
});

// ---------------------------------------------------------------------------
// FR-C3 — `POST /orders/{id}/abandon`: kasir membatalkan SATU draf
// ---------------------------------------------------------------------------

async function kueri(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await db.query(sql, params);
    await db.query('COMMIT');
    return rows;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

const tinggalkan = (orderId, payload = {}, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: `/orders/${orderId}/abandon`,
    headers: hdr({ 'idempotency-key': crypto.randomUUID(), ...ubah }),
    payload,
  });

test('⛔ draf yang dibatalkan MEMBEBASKAN stok SEKETIKA, tanpa menunggu 24 jam', async () => {
  // Inti endpoint ini. Jalur QRIS dinamis menulis order ke server SEBELUM
  // pelanggan membayar, dan movement `sale` ditulis saat order DIBUAT. Tanpa
  // pembatalan seketika, stok terkunci sampai pembersihan massal — dan produk
  // berikutnya terlihat habis di depan pelanggan berikutnya.
  const id = await order({ qtyMilli: 3000, umurJam: 0 });
  assert.equal(await saldo(), '-3000', 'penjualan mengurangi stok saat order DIBUAT');

  const res = await tinggalkan(id, { reasonCode: 'qris_dibatalkan' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().status, 'abandoned');
  assert.equal(res.json().totalStokDikembalikan, '3000');

  assert.equal(await saldo(), '0', 'stok harus kembali utuh SEKETIKA');
});

test('⛔ ordernya TIDAK dihapus, dan nomor struknya tetap melekat', async () => {
  // Nomor yang terpakai untuk order yang dibatalkan jauh lebih baik daripada
  // LUBANG di urutan struk: 41 dan 43 ada sementara 42 tidak pernah ada di
  // mana pun tidak dapat dijelaskan siapa pun saat diperiksa.
  const id = await order();
  await tinggalkan(id);

  const [row] = await kueri(`SELECT status, receipt_number FROM "order" WHERE id = $1`, [id]);
  assert.ok(row, 'order tidak boleh dihapus');
  assert.equal(row.status, 'abandoned');
  assert.match(row.receipt_number, /^K1-/, 'nomor struknya tetap ada');
});

test('order.abandoned dipancarkan dengan alasan dan stok yang dikembalikan', async () => {
  const id = await order({ qtyMilli: 2000 });
  await tinggalkan(id, { reasonCode: 'qris_kedaluwarsa' });

  // ⛔ Disaring per `event_type`, bukan menghitung SELURUH baris tabel.
  const [row] = await kueri(
    `SELECT reason_code, reason_note, before, after FROM audit_event
      WHERE event_type = 'order.abandoned' AND entity_id = $1`,
    [id]
  );
  assert.ok(row, 'order.abandoned tidak dipancarkan');
  assert.equal(row.reason_code, 'order_abandoned');
  assert.equal(row.reason_note, 'qris_kedaluwarsa');
  assert.equal(row.before.status, 'open');
  assert.equal(row.after.status, 'abandoned');
  assert.equal(row.after.stokDikembalikan, '2000');
});

test('⛔ order yang SUDAH dibayar ditolak 409, bukan dibatalkan', async () => {
  // Membatalkan transaksi lunas adalah void/refund — dengan restock, alasan
  // daftar tertutup, dan baris pembatalnya sendiri. Jalan kedua ke sana tidak
  // punya satu pun dari itu.
  const id = await order({ status: 'closed' });
  const sebelum = await saldo();

  const res = await tinggalkan(id);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'ORDER_NOT_ABANDONABLE');
  assert.equal(await saldo(), sebelum, 'stok tidak boleh bergerak');
});

test('order yang tidak ada dijawab 404', async () => {
  const res = await tinggalkan(crypto.randomUUID());
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ pembatalan KEDUA atas draf yang sama tidak mengembalikan stok dua kali', async () => {
  // Kasir yang menekan ulang karena jaringan menggantung, atau relay yang
  // mencoba lagi. Stok yang naik dua kali dari yang pernah dikurangi baru
  // ketahuan saat opname.
  const id = await order({ qtyMilli: 5000 });
  assert.equal((await tinggalkan(id)).statusCode, 200);
  const sesudahPertama = await saldo();

  const kedua = await tinggalkan(id);
  assert.equal(kedua.statusCode, 409, kedua.body);
  assert.equal(await saldo(), sesudahPertama);
});
