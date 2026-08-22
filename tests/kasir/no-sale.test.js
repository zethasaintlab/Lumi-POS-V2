'use strict';

// K-16 — buka laci (no-sale) dari perangkat. FR-D7.
//
// ⛔ Yang paling penting diuji: catatannya ditulis MESKI laci tidak dapat
// dibuka. `spec-d:231` menyatakan sinyalnya satu arah — dan perangkat v1
// belum punya printer sama sekali, jadi "laci tidak terbuka" adalah keadaan
// NORMAL, bukan kegagalan. Kontrol yang tersisa untuk no-sale adalah
// catatannya; kalau ia ikut gagal saat lacinya gagal, tidak ada kontrol sama
// sekali.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/no-sale.ts';

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = {
  userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false,
};
const SHIFT = { id: 's1', outlet_id: 'o1', device_id: 'd1', status: 'open' };

function dbPalsu({ shift = SHIFT, sudah = 0 } = {}) {
  const state = { tulis: [], transaksi: 0, diDalam: false };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM cash_drawer_shift/.test(sql)) return shift ? [shift] : [];
      if (/FROM audit_event/.test(sql)) return [{ n: sudah }];
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

const JAM = () => new Date('2026-08-21T10:00:00Z');
const ID = (() => {
  let n = 0;
  return () => `ns-${++n}`;
})();

function args(over = {}) {
  return {
    konfig: KONFIG,
    sesi: SESI,
    shiftId: 's1',
    alasan: { kode: 'tukar_uang', catatan: null },
    approverId: null,
    waktu: JAM,
    idBaru: ID,
    hlc: () => 77n,
    ...over,
  };
}

const audit = (db) => db.state.tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
const outbox = (db) => db.state.tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));

// ---------------------------------------------------------------------------

test('no-sale menulis audit event + outbox dalam SATU transaksi', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  const hasil = await bukaLaci({ db, ...args() });

  assert.equal(hasil.status, 'tersimpan');
  assert.equal(hasil.urutan, 1);
  assert.equal(db.state.transaksi, 1, 'harus SATU transaksi');
  assert.equal(audit(db).length, 1);
  assert.equal(outbox(db).length, 1);
  assert.ok(
    [...audit(db), ...outbox(db)].every((t) => t.dalam),
    'keduanya harus di DALAM transaksi'
  );
});

test('⛔ catatan tetap ditulis meski laci TIDAK dapat dibuka', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  const hasil = await bukaLaci({
    db,
    ...args({
      bukaLaciFisik: async () => {
        throw new Error('printer tidak terpasang');
      },
    }),
  });
  // Kontrol yang tersisa untuk no-sale adalah catatannya. Kalau ia ikut gagal
  // saat lacinya gagal, tidak ada kontrol sama sekali.
  assert.equal(hasil.status, 'tersimpan');
  assert.equal(hasil.laciTerbuka, false);
  assert.equal(audit(db).length, 1);
});

test('laci yang berhasil dibuka dilaporkan sebagai terbuka', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  const hasil = await bukaLaci({ db, ...args({ bukaLaciFisik: async () => true }) });
  assert.equal(hasil.laciTerbuka, true);
});

test('⛔ TIDAK menulis cash_movement — no-sale tidak memindahkan uang', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  await bukaLaci({ db, ...args() });
  // Movement bernilai nol akan membuat buku kas — satu-satunya definisi saldo
  // laci (`spec-d:14`) — memuat baris yang tidak menjelaskan apa pun.
  assert.equal(
    db.state.tulis.filter((t) => /cash_movement/.test(t.sql)).length,
    0
  );
});

test('shift yang sudah DITUTUP menolak, dan tidak menulis apa pun', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu({ shift: { ...SHIFT, status: 'closed' } });
  const hasil = await bukaLaci({ db, ...args() });
  assert.equal(hasil.status, 'shift_tidak_terbuka');
  assert.equal(db.state.transaksi, 0);
});

test('shift yang tidak ada ditolak', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu({ shift: null });
  assert.equal((await bukaLaci({ db, ...args() })).status, 'shift_tidak_terbuka');
});

test('alasan di luar daftar tertutup ditolak', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  const hasil = await bukaLaci({ db, ...args({ alasan: { kode: 'barang_rusak', catatan: null } }) });
  assert.equal(hasil.status, 'alasan_tidak_berlaku');
  assert.equal(db.state.transaksi, 0);
});

test('⛔ pembukaan ke-4 menuntut penyetuju; ke-3 tidak', async () => {
  const { bukaLaci } = await import(MOD);

  const ketiga = await bukaLaci({ db: dbPalsu({ sudah: 2 }), ...args() });
  assert.equal(ketiga.status, 'tersimpan');
  assert.equal(ketiga.urutan, 3);

  const keempat = await bukaLaci({ db: dbPalsu({ sudah: 3 }), ...args() });
  assert.equal(keempat.status, 'butuh_penyetuju');
  assert.equal(keempat.urutan, 4);

  const disetujui = await bukaLaci({
    db: dbPalsu({ sudah: 3 }),
    ...args({ approverId: 'u-budi' }),
  });
  assert.equal(disetujui.status, 'tersimpan');
});

test('⛔ penyetuju TIDAK BOLEH sama dengan aktor', async () => {
  const { bukaLaci } = await import(MOD);
  // `audit_event` punya CHECK yang menolaknya di server; kalau perangkat
  // meloloskannya, kasir baru tahu setelah antrean terkuras.
  const db = dbPalsu({ sudah: 5 });
  const hasil = await bukaLaci({ db, ...args({ approverId: SESI.userId }) });
  assert.equal(hasil.status, 'penyetuju_sama_dengan_aktor');
  assert.equal(db.state.transaksi, 0);
});

test('audit event membawa aktor, alasan, dan shift-nya', async () => {
  const { bukaLaci } = await import(MOD);
  const { EVENT_NO_SALE } = await import('../../packages/domain/src/no-sale.ts');
  const db = dbPalsu();
  await bukaLaci({ db, ...args({ alasan: { kode: 'setor_ke_brankas', catatan: 'ke brankas' } }) });

  const [row] = audit(db);
  // ⛔ Nilai yang di-BIND diperiksa, bukan sekadar bahwa tabelnya disentuh:
  // fake `DbLokal` tidak menegakkan satu constraint pun (`CLAUDE.md`).
  assert.equal(row.params[1], KONFIG.tenantId, 'tenant_id tidak boleh NULL');
  assert.equal(row.params[4], SESI.userId, 'aktor');
  assert.equal(row.params[5], null, 'penyetuju null di bawah ambang');
  assert.equal(row.params[6], EVENT_NO_SALE);
  assert.equal(row.params[7], 's1', 'entity_id adalah shift');
  assert.equal(row.params[8], 'setor_ke_brankas');
  assert.equal(row.params[9], 'ke brankas');
});

test('outbox memakai entityType `no_sale` dan entityId SHIFT', async () => {
  const { bukaLaci } = await import(MOD);
  const { RUTE_DIDUKUNG } = await import('../../packages/sync-client/src/http.ts');
  const db = dbPalsu();
  await bukaLaci({ db, ...args() });

  const [row] = outbox(db);
  assert.equal(row.params[1], 'no_sale');
  // `entity_id` adalah SHIFT: rutenya bersarang di bawahnya, dan ambangnya
  // dihitung per shift.
  assert.equal(row.params[2], 's1');
  assert.ok(RUTE_DIDUKUNG.includes('no_sale'), 'jalur naik tidak punya rute untuk no_sale');
});

test('⛔ keadaan HLC ditulis DI DALAM transaksi', async () => {
  const { bukaLaci } = await import(MOD);
  const db = dbPalsu();
  await bukaLaci({ db, ...args() });
  const hlc = db.state.tulis.filter((t) => /device_config/.test(t.sql));
  assert.equal(hlc.length, 1);
  // Di luar transaksi ada jendela tempat perangkat dapat mati setelah event
  // ter-commit tapi sebelum `hlc_teks` tersimpan — boot berikutnya dapat
  // menghasilkan HLC yang SUDAH dipakai (pelanggaran I10, tanpa error).
  assert.equal(hlc[0].dalam, true);
});
