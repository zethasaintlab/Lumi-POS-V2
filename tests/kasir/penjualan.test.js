'use strict';

// K-06/K-07 — menyimpan penjualan di perangkat.
//
// ⛔ Ini pertama kalinya invariant #1 berlaku di KLIEN dengan uang sungguhan:
// order + check + line + modifier + payment + DUA item outbox, semuanya dalam
// satu `writeTransaction`. Yang tersimpan setengah adalah penjualan yang
// uangnya sudah masuk laci tapi tidak ada di mana pun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/penjualan.ts';

const OUTLET = {
  id: 'o1', tenant_id: 't1', name: 'Outlet Pusat',
  timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00',
  rounding_increment: 100, rounding_mode: 'half_up', service_charge_rate: 0,
};

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};

const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };
const SHIFT = { id: 's1', businessDate: '2026-08-11', openingFloat: 200000 };

// PB1 10% EKSKLUSIF — menambah total.
const TARIF = [{
  id: 'tr1', tenant_id: 't1', outlet_id: 'o1', name: 'PB1', type: 'pbjt',
  rate: 1000, is_inclusive: 0, phase: 'subtotal', channel: 'all',
  applies_to: 'all_items', applies_to_ids: null,
  effective_from: '2026-01-01T00:00:00Z', effective_to: null,
}];

function dbPalsu({ tarif = TARIF, urutan = 0, tanggalUrutan = null } = {}) {
  const state = {
    tulis: [], transaksi: 0,
    device_config: { receipt_sequence: urutan, sequence_business_date: tanggalUrutan },
  };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM tax_rate/.test(sql)) return tarif;
      if (/FROM outlet/.test(sql)) return [OUTLET];
      if (/FROM device_config/.test(sql)) return [state.device_config];
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params });
      if (/UPDATE device_config/.test(sql)) {
        state.device_config.receipt_sequence = params[0];
        state.device_config.sequence_business_date = params[1];
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      return fn(db);
    },
  };
  return db;
}

const BARIS = [{
  id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
  unitPrice: 20000, quantityMilli: 1000, modifier: [],
}];

const JAM = () => new Date('2026-08-11T07:00:00Z');
const ID = (() => { let n = 0; return () => `id-${++n}`; })();

function args(over = {}) {
  return {
    konfig: KONFIG, sesi: SESI, shift: SHIFT,
    keranjang: { baris: BARIS },
    pembayaran: { metode: 'cash', tendered: 25000 },
    waktu: JAM, idBaru: ID, hlc: () => 42n,
    ...over,
  };
}

// ---------------------------------------------------------------------------

test('⛔ SATU transaksi untuk seluruh penjualan (invariant #1)', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();

  const hasil = await simpanPenjualan({ db, ...args() });
  assert.equal(hasil.status, 'tersimpan', hasil.status);
  assert.equal(db.state.transaksi, 1, 'seluruhnya HARUS satu writeTransaction');

  const tabel = db.state.tulis.map((t) => t.sql);
  for (const wajib of ['"order"', '"check"', 'order_line', 'payment', 'outbox_local']) {
    assert.ok(tabel.some((s) => s.includes(wajib)), `tidak ada penulisan ke ${wajib}`);
  }
});

test('pajak EKSKLUSIF menambah total; order.tax_amount = seluruh pajak', async () => {
  const { simpanPenjualan } = await import(MOD);
  const hasil = await simpanPenjualan({ db: dbPalsu(), ...args() });

  // 20.000 + 10% = 22.000
  assert.equal(hasil.total, 22000n);
  assert.equal(hasil.taxAmount, 2000n);
});

test('⛔ pajak INKLUSIF tidak menambah total, tapi tetap tercatat', async () => {
  const { simpanPenjualan } = await import(MOD);

  // `CLAUDE.md`: "order.tax_amount = totalTax (seluruh pajak, untuk struk);
  // yang MENAMBAH total hanya totalTaxExclusive. Menukar keduanya
  // menggandakan pajak inklusif."
  const inklusif = [{ ...TARIF[0], is_inclusive: 1 }];
  const hasil = await simpanPenjualan({ db: dbPalsu({ tarif: inklusif }), ...args() });

  assert.equal(hasil.total, 20000n, 'harga sudah termasuk pajak');
  assert.ok(hasil.taxAmount > 0n, 'pajaknya tetap tercatat untuk struk');
});

test('⛔ pembulatan HANYA pada amount_due tunai, bukan pada total', async () => {
  const { simpanPenjualan } = await import(MOD);

  // FR-C9. `CLAUDE.md`: "total tidak pernah dibulatkan. Yang dibulatkan
  // amount_due, dan hanya saat ada pembayaran tunai."
  const baris = [{ ...BARIS[0], unitPrice: 20050 }];
  const hasil = await simpanPenjualan({
    db: dbPalsu(),
    ...args({ keranjang: { baris }, pembayaran: { metode: 'cash', tendered: 25000 } }),
  });

  // 20.050 + 10% = 22.055 -> dibulatkan ke 22.100 (increment 100, half_up)
  assert.equal(hasil.total, 22055n, 'total TIDAK dibulatkan');
  assert.equal(hasil.amountDue, 22100n);
  assert.equal(hasil.roundingAdjustment, 45n);
});

test('kembalian dihitung dari amount_due yang SUDAH dibulatkan', async () => {
  const { simpanPenjualan } = await import(MOD);
  const baris = [{ ...BARIS[0], unitPrice: 20050 }];
  const hasil = await simpanPenjualan({
    db: dbPalsu(),
    ...args({ keranjang: { baris }, pembayaran: { metode: 'cash', tendered: 25000 } }),
  });

  // 25.000 - 22.100 = 2.900. Menghitungnya dari `total` yang tidak dibulatkan
  // memberi kembalian 45 rupiah lebih banyak, setiap transaksi.
  assert.equal(hasil.kembalian, 2900n);
});

test('uang tunai kurang DITOLAK, dan tidak menulis apa pun', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();

  const hasil = await simpanPenjualan({
    db, ...args({ pembayaran: { metode: 'cash', tendered: 10000 } }),
  });
  assert.equal(hasil.status, 'kurang_bayar');
  assert.equal(db.state.tulis.length, 0, 'tidak boleh ada penulisan sebagian');
});

test('⛔ nomor struk: counter LOKAL, dan reset per tanggal bisnis', async () => {
  const { simpanPenjualan } = await import(MOD);

  // `CLAUDE.md`: "Counter LOKAL, tidak pernah minta ke server."
  const db = dbPalsu({ urutan: 6, tanggalUrutan: '2026-08-11' });
  const hasil = await simpanPenjualan({ db, ...args() });
  assert.equal(hasil.receiptNumber, 'K1-20260811-0007');
  assert.equal(hasil.sequence, 7);

  // Tanggal bisnis BARU memulai urutan dari 1 lagi. Tanpa reset, nomor struk
  // tumbuh selamanya dan tidak lagi berarti "penjualan ke-N hari ini".
  const dbBaru = dbPalsu({ urutan: 40, tanggalUrutan: '2026-08-10' });
  const besok = await simpanPenjualan({ db: dbBaru, ...args() });
  assert.equal(besok.sequence, 1);
  assert.equal(besok.receiptNumber, 'K1-20260811-0001');
});

test('DUA item outbox: order lalu payment, payment BERGANTUNG pada order', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args() });

  const outbox = db.state.tulis.filter((t) => /outbox_local/.test(t.sql));
  assert.equal(outbox.length, 2);

  const [order, payment] = outbox.map((t) => t.params);
  assert.equal(order[1], 'order');
  assert.equal(payment[1], 'payment');
  // `depends_on` menunjuk item outbox order. Tanpa itu, payment dapat terkirim
  // lebih dulu ke order yang belum ada di server -- 404, lalu gagal permanen
  // untuk penjualan yang sempurna.
  //
  // Indeks 7 mengikuti urutan bind `enqueue` (id, entityType, entityId,
  // operation, payload, idempotencyKey, createdAt, dependsOn, actorId) --
  // BUKAN urutan kolom di SQL, yang berbeda karena beberapa kolom diisi
  // literal.
  assert.equal(payment[7], order[0], 'payment harus depends_on item order');
  assert.equal(order[7], null, 'order tidak bergantung pada apa pun');
});

test('payload order cocok dengan kontrak POST /orders', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args() });

  const item = db.state.tulis.find((t) => /outbox_local/.test(t.sql));
  const payload = JSON.parse(item.params[4]);
  for (const k of ['id', 'outletId', 'deviceId', 'shiftId', 'receiptNumber', 'businessDate', 'sequence', 'channel', 'checkId', 'lines']) {
    assert.ok(k in payload, `payload kehilangan ${k}`);
  }
  assert.match(payload.receiptNumber, /^[A-Za-z0-9]+-\d{8}-\d+$/);
  assert.equal(payload.lines[0].variationId, 'v1');
  assert.equal(payload.lines[0].quantityMilli, 1000);
  // FR-H6: harga dan total yang DIPAKAI KLIEN ikut, supaya server dapat
  // membedakan klien yang belum tersinkron dari selisih tak terjelaskan.
  assert.equal(payload.lines[0].unitPrice, 20000);
  // NUMBER, bukan string: `assertClientTotalValid` di server menuntut
  // `Number.isInteger`. Versi pertama test ini mengharapkan string dan
  // MENGUNCI bug — ketahuan hanya saat menembak server sungguhan.
  assert.equal(payload.total, 22000);
  assert.equal(typeof payload.total, 'number');
  // `hlc` sebaliknya TETAP string: ia 57-bit dan tidak muat di double.
  assert.equal(typeof payload.hlc, 'string');
  assert.equal(payload.hlc, '42');
});

test('keranjang kosong ditolak', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({ db, ...args({ keranjang: { baris: [] } }) });
  assert.equal(hasil.status, 'keranjang_kosong');
  assert.equal(db.state.tulis.length, 0);
});

test('modifier ikut ke baris DAN ke harga', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const baris = [{
    ...BARIS[0],
    modifier: [{ id: 'm3', nama: 'Ekstra', harga: 3000, bawaan: false }],
  }];
  const hasil = await simpanPenjualan({
    db,
    ...args({ keranjang: { baris }, pembayaran: { metode: 'cash', tendered: 30000 } }),
  });

  // (20.000 + 3.000) + 10% = 25.300 — melebihi Rp 25.000, jadi uang yang
  // diserahkan dinaikkan. Versi pertama test ini justru tertangkap guard
  // `kurang_bayar`, yang berarti guard itu bekerja.
  assert.equal(hasil.total, 25300n);
  const tulisModifier = db.state.tulis.filter((t) => /order_line_modifier/.test(t.sql));
  assert.equal(tulisModifier.length, 1);
  assert.equal(tulisModifier[0].params[3], 'Ekstra');
});
