'use strict';

// FR-D5 — kas masuk & kas keluar DARI PERANGKAT, offline.
//
// ⛔ Yang paling penting diuji: nilai yang di-BIND, bukan sekadar bahwa
// tabelnya disentuh. Fake `DbLokal` tidak menegakkan satu pun constraint —
// `NOT NULL`, `CHECK`, dan `ON CONFLICT` semuanya lolos di sini dan gagal
// keras di `wa-sqlite` (`CLAUDE.md`, terjadi dua kali). Test yang hanya
// menghitung baris akan hijau untuk `delta` bertanda terbalik, `delta` nol,
// dan `tenant_id` NULL sekaligus.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kas/manual.ts';

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = {
  userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false,
};
const SHIFT = { id: 's1', outlet_id: 'o1', device_id: 'd1', status: 'open' };

function dbPalsu({ shift = SHIFT } = {}) {
  const state = { tulis: [], transaksi: 0, diDalam: false };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM cash_drawer_shift/.test(sql)) return shift ? [shift] : [];
      if (/FROM device_config/.test(sql)) return [{ hlc_teks: '0' }];
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params, dalam: state.diDalam });
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      state.diDalam = true;
      try {
        return await fn(db);
      } finally {
        state.diDalam = false;
      }
    },
  };
  return db;
}

const JAM = () => new Date('2026-08-24T10:00:00Z');
const ID = (() => {
  let n = 0;
  return () => `km-${++n}`;
})();

function args(over = {}) {
  return {
    konfig: KONFIG,
    sesi: SESI,
    shiftId: 's1',
    arah: 'keluar',
    jumlah: 50_000n,
    alasan: { kode: 'bayar_pemasok', catatan: null },
    waktu: JAM,
    idBaru: ID,
    hlc: () => 77n,
    ...over,
  };
}

const baris = (db, tabel) =>
  db.state.tulis.filter((t) => new RegExp(`INSERT INTO ${tabel}`).test(t.sql));
const movement = (db) => baris(db, 'cash_movement');
const audit = (db) => baris(db, 'audit_event');
const outbox = (db) => baris(db, 'outbox_local');

// ---------------------------------------------------------------------------

test('movement + audit + outbox ditulis dalam SATU transaksi', async () => {
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  const hasil = await catatKasManual({ db, ...args() });

  assert.equal(hasil.status, 'tercatat');
  assert.equal(db.state.transaksi, 1, 'harus SATU transaksi');
  assert.equal(movement(db).length, 1);
  assert.equal(audit(db).length, 1);
  assert.equal(outbox(db).length, 1);
  assert.ok(
    [...movement(db), ...audit(db), ...outbox(db)].every((t) => t.dalam),
    'ketiganya harus di DALAM transaksi — uang yang berpindah tanpa auditnya ' +
      'adalah persis yang FR-D5 ada untuk mencegah'
  );
});

test('⛔ delta yang DI-BIND bertanda negatif untuk kas keluar, positif untuk masuk', async () => {
  const { catatKasManual } = await import(MOD);

  const keluar = dbPalsu();
  await catatKasManual({ db: keluar, ...args({ arah: 'keluar', jumlah: 30_000n }) });
  const [pKeluar] = movement(keluar).map((t) => t.params);
  assert.equal(pKeluar[2], 'paid_out');
  assert.equal(pKeluar[3], -30_000, 'delta harus NEGATIF');

  const masuk = dbPalsu();
  await catatKasManual({
    db: masuk,
    ...args({ arah: 'masuk', jumlah: 30_000n, alasan: { kode: 'tambah_modal', catatan: null } }),
  });
  const [pMasuk] = movement(masuk).map((t) => t.params);
  assert.equal(pMasuk[2], 'paid_in');
  assert.equal(pMasuk[3], 30_000, 'delta harus POSITIF');
});

test('⛔ counterpart_type diturunkan dari ALASAN, bukan dari arah', async () => {
  const { catatKasManual } = await import(MOD);
  const pemasok = dbPalsu();
  await catatKasManual({ db: pemasok, ...args({ alasan: { kode: 'bayar_pemasok', catatan: null } }) });
  const pemilik = dbPalsu();
  await catatKasManual({ db: pemilik, ...args({ alasan: { kode: 'ambil_pemilik', catatan: null } }) });

  assert.equal(movement(pemasok)[0].params[4], 'expense');
  assert.equal(movement(pemilik)[0].params[4], 'owner_draw');
  assert.equal(
    movement(pemasok)[0].params[3],
    movement(pemilik)[0].params[3],
    'jumlah dan arahnya identik — hanya alasannya yang berbeda'
  );
});

test('⛔ tenant_id audit TIDAK null — fake tidak menegakkan NOT NULL', async () => {
  // `audit_event.tenant_id = NULL` lolos di sini dan gagal keras di
  // `wa-sqlite`; itu sudah terjadi sekali (14 Agustus 2026).
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args() });
  const p = audit(db)[0].params;
  assert.equal(p[1], 't1', 'tenant_id');
  assert.equal(p[2], 'o1', 'outlet_id dari SHIFT, bukan dari konfig');
  assert.equal(p[3], 'd1', 'device_id');
  assert.equal(p[4], 'u-sari', 'actor_user_id');
  assert.equal(p[5], 'cash_paid_out', 'event_type menyebut ARAHNYA');
});

test('kas masuk memancarkan cash_paid_in', async () => {
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({
    db,
    ...args({ arah: 'masuk', alasan: { kode: 'tambah_modal', catatan: null } }),
  });
  assert.equal(audit(db)[0].params[5], 'cash_paid_in');
});

test('⛔ muatan outbox mengirim jumlah POSITIF sebagai STRING, bukan delta bertanda', async () => {
  // Server menurunkan tandanya sendiri lewat `periksaKas` yang sama. Klien
  // yang mengirim delta bertanda akan membuat server menegasikannya lagi —
  // kas keluar menjadi kas masuk, dan angkanya benar sementara arahnya tidak.
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args({ arah: 'keluar', jumlah: 50_000n }) });

  const params = outbox(db)[0].params;
  const muatan = JSON.parse(params.find((p) => typeof p === 'string' && p.startsWith('{')));
  assert.equal(muatan.jumlah, '50000');
  assert.equal(typeof muatan.jumlah, 'string', 'rupiah lewat jalur kas selalu string');
  assert.equal(muatan.arah, 'keluar');
  assert.equal(muatan.reasonCode, 'bayar_pemasok');
  assert.ok(!('delta' in muatan), 'delta bertanda TIDAK dikirim — server menurunkannya sendiri');
});

test('⛔ entity_type outbox `cash_movement` dan entity_id adalah SHIFT-nya', async () => {
  // Rutenya bersarang di bawah shift (`/shifts/{id}/cash-movements`), dan
  // `buatPengirimHttp` menyusun URL dari `entity_id`. Yang salah di sini
  // menghasilkan 404 permanen di antrean, berjam-jam setelah uangnya keluar.
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args() });
  const params = outbox(db)[0].params;
  assert.ok(params.includes('cash_movement'), 'entity_type');
  assert.ok(params.includes('s1'), 'entity_id = shiftId');
});

test('⛔ aktor DIBEKUKAN di baris outbox', async () => {
  // Antrean dapat terkuras setelah pergantian shift; aktor yang dibaca saat
  // dikirim akan menisbatkan uang kepada kasir yang salah.
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args() });
  assert.ok(outbox(db)[0].params.includes('u-sari'));
});

test('⛔ keadaan HLC ditulis DI DALAM transaksi penjualan', async () => {
  // Di luar transaksi ada jendela tempat perangkat dapat mati setelah
  // barisnya ter-commit tapi sebelum `hlc_teks` tersimpan — dan tick
  // berikutnya menghasilkan HLC yang sudah dipakai (pelanggaran I10 tanpa
  // satu pun error).
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args() });
  const hlc = db.state.tulis.filter((t) => /device_config/.test(t.sql));
  assert.ok(hlc.length >= 1, 'HLC tidak disimpan sama sekali');
  assert.ok(hlc.every((t) => t.dalam), 'HLC harus disimpan di DALAM transaksi');
});

test('⛔ shift yang TERTUTUP tidak menulis apa pun', async () => {
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu({ shift: { ...SHIFT, status: 'closed' } });
  const hasil = await catatKasManual({ db, ...args() });
  assert.equal(hasil.status, 'shift_tidak_terbuka');
  assert.equal(db.state.transaksi, 0, 'transaksi tidak boleh dibuka sama sekali');
  assert.equal(db.state.tulis.length, 0);
});

test('shift yang tidak ada ditolak tanpa menulis', async () => {
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu({ shift: null });
  const hasil = await catatKasManual({ db, ...args() });
  assert.equal(hasil.status, 'shift_tidak_terbuka');
  assert.equal(db.state.tulis.length, 0);
});

test('⛔ muatan yang ditolak domain tidak menulis apa pun — aturannya berlaku OFFLINE', async () => {
  // Aturan yang hanya hidup di server berarti kasir mengetik jumlah nol,
  // barisnya tersimpan lokal, lalu berhenti `gagal-permanen` di antrean
  // berjam-jam kemudian — bentuk cacat yang sama persis dengan refund offline.
  const { catatKasManual } = await import(MOD);

  for (const [nama, over] of [
    ['nol', { jumlah: 0n }],
    ['negatif', { jumlah: -50_000n }],
    ['alasan asing', { alasan: { kode: 'beli_kopi_buat_saya', catatan: null } }],
    ['alasan arah lain', { arah: 'masuk', alasan: { kode: 'bayar_pemasok', catatan: null } }],
    ['lainnya tanpa catatan', { alasan: { kode: 'lainnya', catatan: null } }],
  ]) {
    const db = dbPalsu();
    const hasil = await catatKasManual({ db, ...args(over) });
    assert.equal(hasil.status, 'ditolak', nama);
    assert.equal(db.state.tulis.length, 0, `${nama}: tidak boleh menulis`);
  }
});

test('⛔ order_id NULL — kas manual tidak menempel pada penjualan mana pun', async () => {
  const { catatKasManual } = await import(MOD);
  const db = dbPalsu();
  await catatKasManual({ db, ...args() });
  // Kolom `order_id` ditulis literal NULL di SQL; yang diperiksa di sini
  // adalah bahwa tidak ada id order yang menyelinap ke parameter mana pun.
  assert.match(movement(db)[0].sql, /INSERT INTO cash_movement/);
  assert.ok(!movement(db)[0].params.some((p) => typeof p === 'string' && p.startsWith('ord-')));
});
