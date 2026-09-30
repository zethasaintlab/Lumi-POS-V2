'use strict';

// Task 4 PR 2A — riwayat kas manual shift untuk layar Laci kas (K-18).
//
// `bacaKasManualShift` membaca `cash_movement` lokal, hanya `paid_in`/`paid_out`
// shift ini, terbaru dulu. ⛔ Di atas SQLite SUNGGUHAN (`node:sqlite`): fake
// `getAll` mengabaikan `WHERE`, jadi test yang memakainya hijau untuk query
// tanpa filter `type` — dan riwayat yang memuat movement PENJUALAN adalah
// kebocoran yang justru dijaga di sini (spec § 9: mockup hanya menampilkan
// kas manual).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kas/manual.ts';

// Kolom persis `db/local/001-initial.sql` (cash_movement).
const DDL = `
CREATE TABLE cash_movement (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, type TEXT NOT NULL,
  delta INTEGER NOT NULL, order_id TEXT, counterpart_type TEXT NOT NULL,
  reason_code TEXT, note TEXT, created_by TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);`;

let hlcSeq = 0;
function baris(sqlite, { id, shift = 'A', type, delta, alasan = null, catatan = null, oleh = 'u-sari', waktu, hlc }) {
  sqlite
    .prepare(
      `INSERT INTO cash_movement (id, shift_id, type, delta, counterpart_type, reason_code, note, created_by, occurred_at, hlc)
       VALUES (?, ?, ?, ?, 'unidentified', ?, ?, ?, ?, ?)`
    )
    .run(id, shift, type, delta, alasan, catatan, oleh, waktu, hlc ?? ++hlcSeq);
}

function buatDb({ bigint = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  const db = {
    sqlite,
    async getAll(sql, params = []) {
      const st = sqlite.prepare(sql);
      // `@powersync/web` mengembalikan INTEGER sebagai bigint (CLAUDE.md,
      // `fitur/baca.ts`); `node:sqlite` sebagai number. Keduanya diuji.
      st.setReadBigInts(bigint);
      return st.all(...params);
    },
    async execute() {
      throw new Error('pembaca riwayat tidak boleh menulis');
    },
    async transaction() {
      throw new Error('pembaca riwayat tidak boleh membuka transaksi');
    },
  };
  return db;
}

function isiCampuran(sqlite) {
  baris(sqlite, { id: 'm-open', type: 'opening_float', delta: 300000, waktu: '2026-09-01T01:00:00.000Z' });
  baris(sqlite, { id: 'm-sale', type: 'sale', delta: 54000, waktu: '2026-09-01T02:00:00.000Z' });
  baris(sqlite, { id: 'm-refund', type: 'refund', delta: -12000, waktu: '2026-09-01T03:00:00.000Z' });
  baris(sqlite, { id: 'm-in', type: 'paid_in', delta: 40000, alasan: 'tambah_modal', waktu: '2026-09-01T04:00:00.000Z' });
  baris(sqlite, {
    id: 'm-out', type: 'paid_out', delta: -25000, alasan: 'lainnya', catatan: 'beli es batu', waktu: '2026-09-01T05:00:00.000Z',
  });
  baris(sqlite, { id: 'm-b', shift: 'B', type: 'paid_in', delta: 99000, alasan: 'setoran_pemilik', waktu: '2026-09-01T06:00:00.000Z' });
}

test('riwayat laci hanya paid_in/paid_out shift ini, terbaru dulu', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  isiCampuran(db.sqlite);

  const hasil = await bacaKasManualShift(db, 'A');

  // Himpunan barisnya saja (urutan diuji test "urutan" tersendiri): pesan ini
  // hanya boleh berbunyi "movement lain/shift lain" bila HIMPUNANNYA salah.
  assert.deepEqual(
    hasil.map((b) => b.id).sort(),
    ['m-in', 'm-out'],
    'riwayat memuat movement selain kas manual (opening_float/sale/refund) atau shift lain — ' +
      `terbaca: ${JSON.stringify(hasil.map((b) => b.id))}`
  );
  assert.ok(!hasil.some((b) => b.id === 'm-b'), 'riwayat shift A memuat paid_in milik shift B');
});

test('⛔ tidak ada baris untuk sale/refund/opening_float — movement penjualan tidak masuk riwayat kas manual', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  isiCampuran(db.sqlite);
  const hasil = await bacaKasManualShift(db, 'A');
  for (const tipe of ['m-sale', 'm-refund', 'm-open']) {
    assert.ok(!hasil.some((b) => b.id === tipe), `movement "${tipe}" bocor ke riwayat kas manual`);
  }
});

test('⛔ jumlah selalu POSITIF, arah dari type — tidak pernah delta bertanda', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  isiCampuran(db.sqlite);
  const hasil = await bacaKasManualShift(db, 'A');
  const keluar = hasil.find((b) => b.id === 'm-out');
  const masuk = hasil.find((b) => b.id === 'm-in');
  assert.equal(keluar.arah, 'keluar', 'paid_out harus arah "keluar"');
  assert.equal(keluar.jumlah, 25000n, `paid_out delta −25000 harus jumlah 25000n, terbaca ${keluar.jumlah}`);
  assert.equal(masuk.arah, 'masuk', 'paid_in harus arah "masuk"');
  assert.equal(masuk.jumlah, 40000n, `paid_in delta 40000 harus jumlah 40000n, terbaca ${masuk.jumlah}`);
});

test('⛔ arah dari type, BUKAN dari tanda delta — baris dengan tanda tak cocok tetap membawa jumlah positif', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  // Baris rusak yang tidak seharusnya ada (tanda berlawanan dengan type): arah
  // mengikuti `type`, dan jumlah tetap positif — layar tidak boleh menebak arah
  // dari tanda, dan tidak boleh menampilkan angka negatif sebagai "jumlah".
  baris(db.sqlite, { id: 'x-out', type: 'paid_out', delta: 7000, waktu: '2026-09-01T01:00:00.000Z' });
  baris(db.sqlite, { id: 'x-in', type: 'paid_in', delta: -3000, waktu: '2026-09-01T02:00:00.000Z' });
  const hasil = await bacaKasManualShift(db, 'A');
  const out = hasil.find((b) => b.id === 'x-out');
  const inn = hasil.find((b) => b.id === 'x-in');
  assert.deepEqual([out.arah, out.jumlah], ['keluar', 7000n]);
  assert.deepEqual([inn.arah, inn.jumlah], ['masuk', 3000n]);
});

test('⛔ uang bigint, bukan number — dari driver number MAUPUN bigint', async () => {
  const { bacaKasManualShift } = await import(MOD);
  for (const bigint of [false, true]) {
    const db = buatDb({ bigint });
    isiCampuran(db.sqlite);
    const hasil = await bacaKasManualShift(db, 'A');
    assert.ok(hasil.length === 2, `driver ${bigint ? 'bigint' : 'number'}: harus dua baris`);
    for (const b of hasil) {
      assert.equal(typeof b.jumlah, 'bigint', `driver ${bigint ? 'bigint' : 'number'}: jumlah ${b.id} bertipe ${typeof b.jumlah}, harus bigint`);
    }
    assert.equal(hasil.find((b) => b.id === 'm-out').jumlah, 25000n);
  }
});

test('bidang lain terbawa: alasan, catatan (null tetap null), waktu, pencatat', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  isiCampuran(db.sqlite);
  const hasil = await bacaKasManualShift(db, 'A');
  assert.deepEqual(hasil.find((b) => b.id === 'm-out'), {
    id: 'm-out',
    arah: 'keluar',
    jumlah: 25000n,
    alasanKode: 'lainnya',
    catatan: 'beli es batu',
    occurredAt: '2026-09-01T05:00:00.000Z',
    createdBy: 'u-sari',
  });
  assert.equal(hasil.find((b) => b.id === 'm-in').catatan, null, 'catatan kosong harus null, bukan string kosong/undefined');
});

test('urutan: occurred_at turun; waktu kembar → hlc turun', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  baris(db.sqlite, { id: 'a', type: 'paid_in', delta: 1000, waktu: '2026-09-01T01:00:00.000Z', hlc: 1 });
  baris(db.sqlite, { id: 'c', type: 'paid_in', delta: 1000, waktu: '2026-09-01T03:00:00.000Z', hlc: 2 });
  baris(db.sqlite, { id: 'b1', type: 'paid_out', delta: -1000, waktu: '2026-09-01T02:00:00.000Z', hlc: 3 });
  baris(db.sqlite, { id: 'b2', type: 'paid_out', delta: -1000, waktu: '2026-09-01T02:00:00.000Z', hlc: 9 });
  const hasil = await bacaKasManualShift(db, 'A');
  assert.deepEqual(hasil.map((b) => b.id), ['c', 'b2', 'b1', 'a']);
});

test('shift tanpa kas manual → daftar kosong (bukan galat)', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = buatDb();
  isiCampuran(db.sqlite);
  assert.deepEqual(await bacaKasManualShift(db, 'shift-lain'), []);
});

test('galat baca DITERUSKAN — bukan daftar kosong yang terlihat sah', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const db = { getAll: async () => { throw new Error('OPFS penuh'); } };
  await assert.rejects(() => bacaKasManualShift(db, 'A'), /OPFS penuh/, 'galat baca ditelan menjadi riwayat kosong');
});

// ---------------------------------------------------------------------------
// Property: untuk shift acak, riwayat = persis baris paid_in/paid_out shift itu,
// jumlah selalu positif, dan ΣjumlahMasuk − ΣjumlahKeluar = SUM(delta) baris itu
// (kas manual tidak menciptakan sumber saldo kedua: buku kas tetap satu-satunya).
// ---------------------------------------------------------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('⛔ property (300 shift acak): jumlah > 0n, arah = type, Σmasuk − Σkeluar = SUM(delta) kas manual', async () => {
  const { bacaKasManualShift } = await import(MOD);
  const TIPE = ['opening_float', 'sale', 'refund', 'paid_in', 'paid_out', 'no_sale_dummy'];
  for (let kasus = 0; kasus < 300; kasus += 1) {
    const acak = lcg(kasus + 1);
    const db = buatDb({ bigint: kasus % 2 === 1 });
    const n = Math.floor(acak() * 12);
    let jumlahManual = 0;
    for (let i = 0; i < n; i += 1) {
      const type = TIPE[Math.floor(acak() * TIPE.length)];
      const shift = acak() < 0.7 ? 'A' : 'B';
      const besar = 1 + Math.floor(acak() * 5_000_000);
      const delta = type === 'paid_out' || type === 'refund' ? -besar : besar;
      baris(db.sqlite, { id: `r${kasus}-${i}`, shift, type, delta, waktu: `2026-09-01T${String(i).padStart(2, '0')}:00:00.000Z` });
      if (shift === 'A' && (type === 'paid_in' || type === 'paid_out')) jumlahManual += delta;
    }
    const hasil = await bacaKasManualShift(db, 'A');
    const masuk = hasil.filter((b) => b.arah === 'masuk').reduce((a, b) => a + b.jumlah, 0n);
    const keluar = hasil.filter((b) => b.arah === 'keluar').reduce((a, b) => a + b.jumlah, 0n);
    assert.ok(hasil.every((b) => b.jumlah > 0n), `kasus ${kasus}: ada jumlah ≤ 0`);
    assert.equal(masuk - keluar, BigInt(jumlahManual), `kasus ${kasus}: Σmasuk − Σkeluar ≠ SUM(delta) kas manual shift A`);
    const harapId = db.sqlite
      .prepare(`SELECT id FROM cash_movement WHERE shift_id = 'A' AND type IN ('paid_in','paid_out')`)
      .all()
      .map((r) => r.id)
      .sort();
    assert.deepEqual(hasil.map((b) => b.id).sort(), harapId, `kasus ${kasus}: himpunan baris riwayat ≠ baris kas manual shift A`);
  }
});
