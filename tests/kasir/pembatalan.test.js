'use strict';

// K-10 — void / refund dari perangkat (FR-B7).
//
// ⛔ `spec-b:235`: kasir TIDAK memilih "void" atau "refund". Ia menekan satu
// tombol, dan SISTEM menentukan operasinya dari status order. Di server itu
// sudah berlaku; di klien harus berlaku juga, karena saat offline tidak ada
// server yang dapat memutuskan apa pun.
//
// Aturannya dibagi lewat `packages/domain/src/cancellation.ts` — dua salinan
// akan membuat perangkat mengirim payload void untuk order yang server
// perlakukan sebagai refund.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/pembatalan.ts';

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };
const SHIFT = { id: 's1', businessDate: '2026-08-13', openingFloat: 200000 };

const ORDER_TERTUTUP = {
  id: 'o1', status: 'closed', total: 33000, amount_due: 33000,
  receipt_number: 'K1-20260813-0004', business_date: '2026-08-13',
  occurred_at: '2026-08-13T09:00:00Z', outlet_id: 'o1', device_id: 'd1', shift_id: 's1',
  subtotal: 30000, order_discount: 0, service_charge_amount: 0, tax_amount: 3000,
  rounding_adjustment: 0, channel: 'takeaway',
};

function dbPalsu({ order = ORDER_TERTUTUP, lines = [], refunds = [] } = {}) {
  const state = { tulis: [], transaksi: 0, diDalam: false, device_config: { receipt_sequence: 4, sequence_business_date: '2026-08-13' } };
  const db = {
    state,
    async getAll(sql, params = []) {
      if (/FROM "order"/.test(sql)) return order ? [order] : [];
      if (/FROM order_line/.test(sql)) return lines;
      if (/FROM refund/.test(sql)) return refunds;
      if (/FROM device_config/.test(sql)) return [state.device_config];
      if (/FROM outlet/.test(sql)) return [{ timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00' }];
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params, dalam: state.diDalam });
      if (/UPDATE device_config/.test(sql)) {
        state.device_config.receipt_sequence = params[0];
        state.device_config.sequence_business_date = params[1];
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      state.diDalam = true;
      try { return await fn(db); } finally { state.diDalam = false; }
    },
  };
  return db;
}

const JAM = () => new Date('2026-08-13T10:00:00Z');
const ID = (() => { let n = 0; return () => `c-${++n}`; })();

function args(over = {}) {
  return {
    konfig: KONFIG, sesi: SESI, orderId: 'o1',
    alasan: { kode: 'barang_rusak', catatan: null },
    approverId: 'u-budi',
    waktu: JAM, idBaru: ID, hlc: () => 99n,
    ...over,
  };
}

const BARIS = [
  { id: 'l1', variation_id: 'v1', quantity: 1000, line_total: 30000, cost_at_sale: 8000 },
];

// ---------------------------------------------------------------------------

test('⛔ SISTEM memilih operasi dari status order, bukan kasir', async () => {
  const { rencanaPembatalan } = await import(MOD);

  // `spec-b:235`. Body yang dikirim TIDAK pernah memuat nama operasinya.
  assert.equal(rencanaPembatalan('closed').operasi, 'refund');
  assert.equal(rencanaPembatalan('open').operasi, 'void');
  assert.equal(rencanaPembatalan('paid').operasi, 'void');
});

test('alasan divalidasi terhadap daftar operasi yang BERLAKU', async () => {
  const { rencanaPembatalan } = await import(MOD);

  // Daftar void dan refund BERBEDA (`spec-b` §B.4). `barang_rusak` milik
  // refund; memakainya pada void membuat server menolak setelah antrean
  // terkuras — mungkin berjam-jam kemudian.
  const refund = rencanaPembatalan('closed');
  assert.equal(refund.alasanBerlaku.includes('barang_rusak'), true);
  assert.equal(refund.alasanBerlaku.includes('salah_input'), false);

  const voidOp = rencanaPembatalan('open');
  assert.equal(voidOp.alasanBerlaku.includes('salah_input'), true);
  assert.equal(voidOp.alasanBerlaku.includes('barang_rusak'), false);
});

test('⛔ VOID: order PEMBATAL baru, order asli tidak disentuh', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ order: { ...ORDER_TERTUTUP, status: 'open' }, lines: BARIS });

  const hasil = await batalkan({
    db, ...args({ alasan: { kode: 'salah_input', catatan: null }, approverId: null }),
  });

  assert.equal(hasil.status, 'tersimpan', hasil.status);
  assert.equal(hasil.operasi, 'void');

  // AC FR-B7 pertama: tidak ada UPDATE pada order asli. Yang lahir adalah
  // order PEMBATAL, dan `voided_by_order_id` ada padanya menunjuk yang
  // dibatalkan — arahnya dipaksa oleh AC itu, karena pembatalnya belum ada
  // saat order asli ditulis.
  const update = db.state.tulis.filter((t) => /^UPDATE "order"/.test(t.sql));
  assert.deepEqual(update, [], 'order asli TIDAK boleh di-UPDATE');

  const insert = db.state.tulis.find((t) => /INSERT INTO "order"/.test(t.sql));
  assert.ok(insert, 'harus ada order pembatal');
  assert.equal(insert.params.includes('o1'), true, 'pembatal menunjuk order asli');
});

test('⛔ REFUND: baris refund, BUKAN payment negatif', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS });

  const hasil = await batalkan({ db, ...args({ jumlah: 10000, lines: [] }) });
  assert.equal(hasil.operasi, 'refund');

  // Keputusan user 7 Agustus 2026: `payment.amount` punya CHECK (amount > 0)
  // dan itu dipertahankan. Arah berlawanan dinyatakan lewat baris `refund`.
  const payment = db.state.tulis.filter((t) => /INSERT INTO payment/.test(t.sql));
  assert.deepEqual(payment, [], 'refund tidak boleh menulis payment');
  assert.ok(db.state.tulis.some((t) => /INSERT INTO refund/.test(t.sql)));
});

test('⛔ refund menuntut PENYETUJU; void tidak', async () => {
  const { batalkan } = await import(MOD);

  // `spec-b:278` menandai refund "PIN manajer, tidak dapat diubah".
  // Void berjalan tanpa PIN (keputusan user 1 Agustus 2026).
  const tanpa = await batalkan({
    db: dbPalsu({ lines: BARIS }), ...args({ jumlah: 10000, lines: [], approverId: null }),
  });
  assert.equal(tanpa.status, 'butuh_penyetuju');

  const dbVoid = dbPalsu({ order: { ...ORDER_TERTUTUP, status: 'open' }, lines: BARIS });
  const voidTanpa = await batalkan({
    db: dbVoid, ...args({ alasan: { kode: 'salah_input', catatan: null }, approverId: null }),
  });
  assert.equal(voidTanpa.status, 'tersimpan', 'void tidak menuntut penyetuju');
});

test('⛔ penyetuju TIDAK BOLEH sama dengan aktor', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS });

  // `audit_event` punya CHECK yang menolaknya di server. Kalau perangkat
  // meloloskannya, kasir baru tahu setelah refund gagal terkirim — dan uangnya
  // sudah keluar laci.
  const hasil = await batalkan({ db, ...args({ jumlah: 10000, lines: [], approverId: 'u-sari' }) });
  assert.equal(hasil.status, 'penyetuju_sama_dengan_aktor');
  assert.equal(db.state.tulis.length, 0, 'tidak boleh menulis apa pun');
});

test('refund melebihi sisa DITOLAK, dan tidak menulis apa pun', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS, refunds: [{ amount: 30000 }] });

  // Sisa 3.000. Server menegakkan batas yang sama; menolak di sini berarti
  // kasir tidak menjanjikan uang yang akan ditolak berjam-jam kemudian.
  const hasil = await batalkan({ db, ...args({ jumlah: 10000, lines: [] }) });
  assert.equal(hasil.status, 'melebihi_sisa');
  assert.equal(db.state.tulis.length, 0);
});

test('⛔ SATU transaksi: pembatalan + stok + audit + outbox', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS });

  await batalkan({ db, ...args({ jumlah: 10000, lines: [{ lineId: 'l1', quantityMilli: 1000 }] }) });

  assert.equal(db.state.transaksi, 1);
  for (const t of db.state.tulis) {
    assert.equal(t.dalam, true, `penulisan di LUAR transaksi: ${t.sql}`);
  }
  const tabel = db.state.tulis.map((t) => t.sql).join(' ');
  for (const wajib of ['refund', 'stock_movement', 'audit_event', 'outbox_local']) {
    assert.ok(tabel.includes(wajib), `tidak ada penulisan ke ${wajib}`);
  }
});

test('refund SEBAGIAN tanpa `lines` berarti uang kembali tanpa barang kembali', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS });

  // `CLAUDE.md`: "`lines: []` berarti uang kembali tanpa barang kembali."
  // Itu keadaan yang sah — bukan kelalaian — jadi ia tidak boleh ditolak,
  // tapi juga tidak boleh diam-diam merestok.
  await batalkan({ db, ...args({ jumlah: 10000, lines: [] }) });
  const stok = db.state.tulis.filter((t) => /stock_movement/.test(t.sql));
  assert.deepEqual(stok, [], 'tanpa lines, stok tidak dikembalikan');
});

test('payload outbox cocok dengan kontrak POST /orders/{id}/cancel', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ lines: BARIS });

  await batalkan({ db, ...args({ jumlah: 10000, lines: [{ lineId: 'l1', quantityMilli: 1000 }] }) });

  const item = db.state.tulis.find((t) => /outbox_local/.test(t.sql));
  assert.equal(item.params[1], 'order_cancel');
  assert.equal(item.params[2], 'o1', 'entity_id adalah order yang dibatalkan');

  const payload = JSON.parse(item.params[4]);
  // Body TIDAK memuat nama operasi — server membacanya dari status order.
  assert.equal('operation' in payload, false);
  assert.equal('operasi' in payload, false);
  assert.equal(payload.reasonCode, 'barang_rusak');
  assert.equal(payload.amount, 10000);
  assert.deepEqual(payload.lines, [{ lineId: 'l1', quantityMilli: 1000 }]);
});

test('order yang sudah dibatalkan tidak dapat dibatalkan lagi', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ order: { ...ORDER_TERTUTUP, status: 'voided' }, lines: BARIS });

  const hasil = await batalkan({ db, ...args() });
  assert.equal(hasil.status, 'tidak_dapat_dibatalkan');
  assert.equal(db.state.tulis.length, 0);
});

test('order yang tidak ada ditolak', async () => {
  const { batalkan } = await import(MOD);
  const db = dbPalsu({ order: null });
  const hasil = await batalkan({ db, ...args() });
  assert.equal(hasil.status, 'tidak_ditemukan');
});
