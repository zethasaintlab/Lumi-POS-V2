'use strict';

// K-02 — buka shift offline (FR-D1).
//
// `spec-d:3`: "Ini PEMBEDA UTAMA produk. Odoo tidak dapat membuka sesi POS
// baru tanpa internet; Toast tidak dapat login saat offline. Skenario
// nyatanya: listrik dan internet mati semalam, pagi hari kasir tidak dapat
// mulai berjualan."
//
// ⛔ Ini juga penulisan entitas bisnis PERTAMA yang dilakukan aplikasi ke
// `outbox_local`. Sebelum ini hanya berkas harness yang pernah menyentuhnya,
// jadi jalur naik lewat aplikasi sungguhan belum pernah hidup sama sekali.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kas/shift.ts';

const OUTLET = {
  id: 'o1',
  tenant_id: 't1',
  name: 'Outlet Pusat',
  timezone: 'Asia/Jakarta',
  business_day_ends_at: '04:00:00',
  rounding_increment: 100,
  rounding_mode: 'half_up',
  service_charge_rate: 0,
  archived_at: null,
};

const KONFIG = {
  deviceId: 'd1',
  deviceCode: 'K1',
  tenantId: 't1',
  outletId: 'o1',
  baseUrl: 'http://server',
  tokenSecret: 'rahasia',
};

const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };

function dbPalsu({ outlet = OUTLET, shift = [] } = {}) {
  const state = { outlet, shift, outbox: [], movement: [], transaksi: 0 };
  // SQLite punya SATU penulis: transaksi berjalan SERIAL. Tanpa antrean ini tes balapan hampa.
  let antrean = Promise.resolve();
  const db = {
    state,
    async getAll(sql, params = []) {
      if (/FROM outlet/.test(sql)) return state.outlet ? [state.outlet] : [];
      if (/FROM cash_drawer_shift/.test(sql)) {
        return state.shift.filter((s) => s.status === 'open' && s.device_id === params[0]);
      }
      return [];
    },
    async execute(sql, params = []) {
      if (/INSERT INTO cash_drawer_shift/.test(sql)) {
        // Urutan kolom = `bukaShift`: id, tenant_id, outlet_id, device_id, business_date, ['open'], opening_float, opened_by, opened_at.
        state.shift.push({
          id: params[0], tenant_id: params[1], outlet_id: params[2], device_id: params[3],
          business_date: params[4], status: 'open', opening_float: params[5],
          opened_by: params[6], opened_at: params[7],
        });
      }
      if (/INSERT INTO cash_movement/.test(sql)) {
        // id, shift_id, ['opening_float'], delta, counterpart_type, created_by, occurred_at, hlc.
        state.movement.push({
          id: params[0], shift_id: params[1], type: /'opening_float'/.test(sql) ? 'opening_float' : '?',
          delta: params[2], counterpart_type: params[3], created_by: params[4],
        });
      }
      if (/INSERT INTO outbox_local/.test(sql)) {
        state.outbox.push({ id: params[0], entity_type: params[1], entity_id: params[2], payload: params[4], actor_id: params[8] });
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      const jalan = antrean.then(() => {
        state.transaksi += 1;
        return fn(db);
      });
      antrean = jalan.catch(() => {});
      return jalan;
    },
  };
  return db;
}

const JAM = new Date('2026-08-11T07:00:00Z'); // 14:00 Jakarta 11 Agustus

// ---------------------------------------------------------------------------

test('buka shift menulis shift DAN outbox dalam SATU transaksi', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();

  const hasil = await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-1', idOutbox: () => 'ob-1', hlc: () => 7n,
  });

  assert.equal(hasil.status, 'terbuka');
  assert.equal(hasil.shift.businessDate, '2026-08-11');
  assert.equal(db.state.shift.length, 1);
  assert.equal(db.state.outbox.length, 1);

  // Invariant #1 berlaku juga di klien: shift yang tersimpan tanpa item
  // outbox tidak akan pernah sampai ke server, dan item outbox tanpa shift
  // mengirim baris yang tidak ada di perangkat.
  assert.equal(db.state.transaksi, 1, 'keduanya HARUS satu writeTransaction');
});

test('⛔ tanggal bisnis, bukan tanggal kalender', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();

  // 01:00 Jakarta 12 Agustus. Kasir yang membuka shift dini hari masih
  // berjualan di hari bisnis 11 Agustus — dan nomor struk seluruh malam itu
  // harus sekelompok dengannya.
  await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => new Date('2026-08-11T18:00:00Z'),
    idBaru: () => 'shift-2', idOutbox: () => 'ob-2', hlc: () => 7n,
  });
  assert.equal(db.state.shift[0].business_date, '2026-08-11');
});

test('⛔ aktor DIBEKUKAN di item outbox saat dibuat', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();

  // `CLAUDE.md`: antrean dapat terkuras berjam-jam kemudian, mungkin setelah
  // pergantian shift. Membaca "siapa yang sedang masuk" saat pengiriman akan
  // mencatat shift Sari atas nama Budi.
  await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-3', idOutbox: () => 'ob-3', hlc: () => 7n,
  });
  assert.equal(db.state.outbox[0].actor_id, 'u-sari');
});

test('payload outbox cocok dengan kontrak POST /shifts', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();

  await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-4', idOutbox: () => 'ob-4', hlc: () => 7n,
  });

  // Field-nya persis `required: [id, outletId, deviceId, businessDate,
  // openingFloat]` di openapi.yaml. Payload yang tidak cocok baru ketahuan
  // saat relay mengirimnya — mungkin berjam-jam kemudian, dan item itu akan
  // membakar hitungan percobaannya sampai `failed` permanen.
  const payload = JSON.parse(db.state.outbox[0].payload);
  assert.deepEqual(Object.keys(payload).sort(), ['businessDate', 'deviceId', 'id', 'openingFloat', 'outletId']);
  assert.equal(payload.id, 'shift-4');
  assert.equal(payload.outletId, 'o1');
  assert.equal(payload.deviceId, 'd1');
  assert.equal(payload.openingFloat, 200000);
  assert.equal(db.state.outbox[0].entity_type, 'shift');
  assert.equal(db.state.outbox[0].entity_id, 'shift-4');
});

test('shift yang sudah terbuka menolak shift kedua di perangkat yang sama', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu({
    shift: [{ id: 's-lama', status: 'open', device_id: 'd1', business_date: '2026-08-10' }],
  });

  // `spec-d`: "Satu device memiliki MAKSIMAL SATU shift OPEN pada satu waktu."
  // Ditegakkan di klien juga, bukan hanya server: saat offline server tidak
  // dapat menolak apa pun, dan dua shift terbuka membuat penjualan berikutnya
  // masuk ke shift yang tidak dapat ditentukan.
  const hasil = await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-5', idOutbox: () => 'ob-5', hlc: () => 7n,
  });

  assert.equal(hasil.status, 'sudah_ada');
  assert.equal(hasil.shiftId, 's-lama');
  assert.equal(db.state.shift.length, 1, 'tidak boleh menulis apa pun');
  assert.equal(db.state.outbox.length, 0);
});

test('saldo awal divalidasi: bilangan bulat rupiah >= 0', async () => {
  const { validasiSaldoAwal } = await import(MOD);

  assert.equal(validasiSaldoAwal(200000), null);
  assert.equal(validasiSaldoAwal(0), null, 'nol sah — laci boleh mulai kosong');
  assert.match(validasiSaldoAwal(-1), /negatif|minimal/i);
  assert.match(validasiSaldoAwal(1500.5), /bulat/i);
  assert.match(validasiSaldoAwal(NaN), /angka/i);
  assert.match(validasiSaldoAwal(Number.MAX_SAFE_INTEGER + 1), /besar/i);
});

test('konfigurasi outlet belum turun → shift TIDAK dibuka', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu({ outlet: null });

  // Tanpa `timezone` dan `business_day_ends_at`, tanggal bisnisnya harus
  // DITEBAK — dan tebakan yang salah menaruh seluruh penjualan hari itu di
  // tanggal yang keliru, lalu bentrok dengan
  // UNIQUE(device_id, business_date, sequence) saat shift yang benar dibuka.
  // Gagal terang lebih baik.
  const hasil = await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-6', idOutbox: () => 'ob-6', hlc: () => 7n,
  });

  assert.equal(hasil.status, 'outlet_belum_siap');
  assert.equal(db.state.shift.length, 0);
  assert.equal(db.state.outbox.length, 0);
});

test('shift terbuka milik perangkat LAIN tidak menghalangi', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu({
    shift: [{ id: 's-lain', status: 'open', device_id: 'd2', business_date: '2026-08-11' }],
  });

  // Batasnya per DEVICE (`spec-d`), bukan per outlet. Kafe dengan dua kasir
  // punya dua shift terbuka bersamaan, dan itu normal.
  const hasil = await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 200000,
    waktu: () => JAM, idBaru: () => 'shift-7', idOutbox: () => 'ob-7', hlc: () => 7n,
  });
  assert.equal(hasil.status, 'terbuka');
});

test('shift aktif dapat dibaca kembali setelah restart', async () => {
  const { shiftAktif } = await import(MOD);
  const db = dbPalsu({
    shift: [{ id: 's-aktif', status: 'open', device_id: 'd1', business_date: '2026-08-11', opening_float: 200000 }],
  });

  // Perangkat yang dimatikan di tengah shift harus kembali ke shift yang
  // sama, bukan meminta buka shift lagi — yang akan ditolak, dan kasir
  // terjebak di layar yang tidak dapat dilewati.
  const aktif = await shiftAktif(db, 'd1');
  assert.equal(aktif.id, 's-aktif');
  assert.equal(await shiftAktif(db, 'd2'), null);
});

test('⛔ shift dan movement opening_float menyimpan angka yang sama, delta POSITIF, shift_id sama', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();
  const hasil = await bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 750000,
    waktu: () => JAM, idBaru: (() => { let n = 0; return () => `id-${++n}`; })(), idOutbox: () => 'ob-m', hlc: () => 7n,
  });
  assert.equal(hasil.status, 'terbuka');
  assert.equal(db.state.shift[0].status, 'open', 'status shift bukan open');
  assert.equal(db.state.shift[0].opening_float, 750000, `opening_float shift ${db.state.shift[0].opening_float}, harus 750000`);
  assert.equal(db.state.movement.length, 1, 'harus tepat SATU movement opening_float');
  const m = db.state.movement[0];
  assert.equal(m.type, 'opening_float');
  assert.equal(m.delta, 750000, `delta movement opening_float ${m.delta}, harus +750000 (positif, sama dengan opening_float)`);
  assert.equal(m.shift_id, db.state.shift[0].id, 'movement opening_float menunjuk shift lain');
  assert.equal(m.created_by, 'u-sari');
  assert.equal(JSON.parse(db.state.outbox[0].payload).openingFloat, 750000, 'openingFloat di outbox berbeda');
});

for (const [nama, nilai] of [['negatif', -1], ['MAX_SAFE+1', Number.MAX_SAFE_INTEGER + 1], ['desimal', 1500.5], ['NaN', NaN]]) {
  test(`⛔ saldoAwal ${nama} → saldo_tidak_valid TANPA satu tulisan pun`, async () => {
    const { bukaShift } = await import(MOD);
    const db = dbPalsu();
    const hasil = await bukaShift({
      db, konfig: KONFIG, sesi: SESI, saldoAwal: nilai,
      waktu: () => JAM, idBaru: () => 'x', idOutbox: () => 'x', hlc: () => 7n,
    });
    assert.equal(hasil.status, 'saldo_tidak_valid', `saldoAwal ${nama} menghasilkan status "${hasil.status}" — harus ditolak sebelum menulis`);
    assert.equal(db.state.shift.length, 0, 'shift ditulis untuk saldo tidak valid');
    assert.equal(db.state.movement.length, 0, 'movement ditulis untuk saldo tidak valid');
    assert.equal(db.state.outbox.length, 0, 'outbox ditulis untuk saldo tidak valid');
    assert.equal(db.state.transaksi, 0, 'transaksi dibuka untuk saldo tidak valid');
  });
}

test('⛔ balapan: dua bukaShift PARALEL di perangkat yang sama → tepat satu terbuka, satu sudah_ada', async () => {
  const { bukaShift } = await import(MOD);
  const db = dbPalsu();
  const panggil = (n) => bukaShift({
    db, konfig: KONFIG, sesi: SESI, saldoAwal: 100000 * n,
    waktu: () => JAM, idBaru: (() => { let i = 0; return () => `s${n}-${++i}`; })(), idOutbox: () => `ob-${n}`, hlc: () => BigInt(n),
  });
  const [a, b] = await Promise.all([panggil(1), panggil(2)]);
  const status = [a.status, b.status].sort();
  assert.deepEqual(status, ['sudah_ada', 'terbuka'], `status ${JSON.stringify(status)} — dua shift terbuka di satu perangkat`);
  assert.equal(db.state.shift.length, 1, `${db.state.shift.length} shift tertulis; spec-d: MAKSIMAL SATU shift open per device`);
  assert.equal(db.state.movement.length, 1, 'movement opening_float ganda');
  assert.equal(db.state.outbox.length, 1, 'outbox shift ganda');
});
