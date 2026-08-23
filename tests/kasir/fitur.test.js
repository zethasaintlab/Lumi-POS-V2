'use strict';

// Feature flag di perangkat. `ARCH:358`.
//
// ⛔ Dua keputusan di sini yang arahnya BERLAWANAN, dan keduanya disengaja:
//
//   1. Fitur yang TIDAK punya baris mengikuti bawaan KODE — menyala. Perangkat
//      yang baru dipasang belum pernah menyegarkan apa pun; membacanya sebagai
//      "mati" adalah kill switch yang menyala sendiri.
//   2. Fitur yang PUNYA baris bertahan meski basi — tanpa kedaluwarsa. Kill
//      switch yang berhenti berlaku setelah N jam offline tidak berlaku pada
//      perangkat yang paling membutuhkannya, dan merchant yang sedang
//      diselidiki adalah merchant yang paling mungkin mencabut internetnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BACA = '../../apps/kasir/src/fitur/baca.ts';
const SEGARKAN = '../../apps/kasir/src/fitur/segarkan.ts';

function dbPalsu({ baris = [], gagalBaca = false } = {}) {
  const state = { tulis: [] };
  return {
    state,
    async getAll(sql) {
      if (/FROM fitur_lokal/.test(sql)) {
        if (gagalBaca) throw new Error('no such table: fitur_lokal');
        return baris;
      }
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params });
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

// ---------------------------------------------------------------------------
// Membaca
// ---------------------------------------------------------------------------

test('⛔ tanpa baris sama sekali: bawaan KODE, bukan mati', async () => {
  const { bacaFitur, fiturAktif } = await import(BACA);
  const { FITUR } = await import('../../packages/domain/src/fitur.ts');

  const peta = await bacaFitur(dbPalsu());
  assert.deepEqual(Object.keys(peta).sort(), FITUR.map((f) => f.kunci).sort());
  for (const f of FITUR) {
    assert.equal(fiturAktif(peta, f.kunci), f.bawaan, `${f.kunci} tidak memakai bawaannya`);
  }
});

test('⛔ tabel BELUM ADA (migrasi lokal belum jalan): tetap bawaan, tidak melempar', async () => {
  const { bacaFitur } = await import(BACA);
  // Pemanggilnya layar kasir. Flag yang menjatuhkan layar jauh lebih berbahaya
  // daripada flag yang tidak ada.
  const peta = await bacaFitur(dbPalsu({ gagalBaca: true }));
  assert.equal(peta.diskon_kasir, true);
});

test('baris `aktif = 0` mematikan fiturnya', async () => {
  const { bacaFitur, fiturAktif } = await import(BACA);
  const peta = await bacaFitur(dbPalsu({ baris: [{ kunci: 'diskon_kasir', aktif: 0 }] }));
  assert.equal(fiturAktif(peta, 'diskon_kasir'), false);
  // Fitur lain tidak ikut mati.
  assert.equal(fiturAktif(peta, 'buka_laci_no_sale'), true);
});

test('⛔ menerima `aktif` sebagai number, bigint, DAN string', async () => {
  const { bacaFitur } = await import(BACA);
  // `@powersync/web` mengembalikan kolom INTEGER sebagai `bigint` sementara
  // driver test (`node:sqlite`) mengembalikan `number` (`CLAUDE.md`). Guard
  // yang hanya memeriksa satu bentuk hijau di seluruh test dan salah di
  // aplikasi.
  for (const nilai of [0, 0n, '0']) {
    const peta = await bacaFitur(dbPalsu({ baris: [{ kunci: 'diskon_kasir', aktif: nilai }] }));
    assert.equal(peta.diskon_kasir, false, `bentuk ${typeof nilai} tidak terbaca`);
  }
  for (const nilai of [1, 1n, '1']) {
    const peta = await bacaFitur(dbPalsu({ baris: [{ kunci: 'diskon_kasir', aktif: nilai }] }));
    assert.equal(peta.diskon_kasir, true);
  }
});

test('⛔ kunci ASING di tabel diabaikan, tidak ditambahkan ke peta', async () => {
  const { bacaFitur, fiturAktif } = await import(BACA);
  const { FITUR } = await import('../../packages/domain/src/fitur.ts');
  const peta = await bacaFitur(dbPalsu({ baris: [{ kunci: 'sudah_dihapus', aktif: 1 }] }));

  assert.deepEqual(Object.keys(peta).sort(), FITUR.map((f) => f.kunci).sort());
  // Sama dengan `resolusiFitur` di domain: kunci asing dibaca MATI.
  assert.equal(fiturAktif(peta, 'sudah_dihapus'), false);
});

test('⛔ `fiturAktif` untuk kunci asing: false, bukan undefined', async () => {
  const { fiturAktif } = await import(BACA);
  // `undefined` di `if` adalah "mati" — tapi ia juga `undefined` di setiap
  // tempat lain, dan pemanggil yang harus memeriksanya akan lupa di satu
  // tempat.
  assert.equal(fiturAktif({}, 'apa_pun'), false);
});

// ---------------------------------------------------------------------------
// Menyegarkan
// ---------------------------------------------------------------------------

function respons(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

const KONFIG = {
  baseUrl: 'http://server',
  tenantId: 't1',
  deviceId: 'd1',
  tokenSecret: 'rahasia',
  waktu: () => new Date('2026-08-23T00:00:00Z'),
};

test('respons sukses menulis setiap fitur', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  const db = dbPalsu();
  const hasil = await segarkanFitur({
    ...KONFIG,
    db,
    fetchFn: async () => respons({ fitur: { diskon_kasir: false, buka_laci_no_sale: true } }),
  });

  assert.equal(hasil.kind, 'segar');
  assert.equal(hasil.jumlah, 2);
  assert.equal(db.state.tulis.length, 2);
  assert.deepEqual(db.state.tulis[0].params, ['diskon_kasir', 0, '2026-08-23T00:00:00.000Z']);
});

test('⛔ kredensial perangkat dikirim sebagai Bearer', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  let dilihat = null;
  await segarkanFitur({
    ...KONFIG,
    db: dbPalsu(),
    fetchFn: async (url, opts) => {
      dilihat = { url, opts };
      return respons({ fitur: {} });
    },
  });
  assert.match(dilihat.url, /\/devices\/d1\/features$/);
  assert.equal(dilihat.opts.headers.Authorization, 'Bearer rahasia');
  assert.equal(dilihat.opts.headers['X-Tenant-Id'], 't1');
});

test('⛔ jaringan putus TIDAK menulis apa pun', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  const db = dbPalsu();
  const hasil = await segarkanFitur({
    ...KONFIG,
    db,
    fetchFn: async () => {
      throw new Error('offline');
    },
  });

  // Respons yang tidak sampai bukan "tidak ada flag": ia "belum tahu".
  // Menulis apa pun atas kegagalan berarti flag yang dimatikan operator
  // menyala kembali setiap kali internet merchant terputus.
  assert.equal(hasil.kind, 'gagal');
  assert.equal(db.state.tulis.length, 0);
});

test('⛔ 401 TIDAK mengosongkan keadaan lama', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  const db = dbPalsu();
  const hasil = await segarkanFitur({
    ...KONFIG,
    db,
    fetchFn: async () => respons({}, { ok: false, status: 401 }),
  });
  assert.equal(hasil.kind, 'gagal');
  assert.equal(hasil.status, 401);
  assert.equal(db.state.tulis.length, 0);
});

test('⛔ bentuk respons yang tidak dikenali diperlakukan GAGAL, bukan "tidak ada fitur"', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  for (const body of [{}, { fitur: null }, { fitur: [] }, { fitur: 'ya' }]) {
    const db = dbPalsu();
    const hasil = await segarkanFitur({ ...KONFIG, db, fetchFn: async () => respons(body) });
    // Yang kedua akan mengembalikan SELURUH flag ke bawaan pada versi server
    // yang bentuk responsnya berubah — kill switch yang mati karena
    // penyuntingan kontrak.
    assert.equal(hasil.kind, 'gagal', `bentuk ${JSON.stringify(body)} diterima`);
    assert.equal(db.state.tulis.length, 0);
  }
});

test('⛔ nilai non-boolean DIABAIKAN, tidak dikoersi', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  const db = dbPalsu();
  await segarkanFitur({
    ...KONFIG,
    db,
    // `"false"` yang dikoersi menjadi `true` adalah kill switch yang menyala
    // terbalik, dan tidak ada yang menghasilkan error.
    fetchFn: async () => respons({ fitur: { diskon_kasir: 'false', buka_laci_no_sale: false } }),
  });
  assert.equal(db.state.tulis.length, 1);
  assert.equal(db.state.tulis[0].params[0], 'buka_laci_no_sale');
});

test('⛔ menulis dengan INSERT OR REPLACE, tidak pernah DELETE lebih dulu', async () => {
  const { segarkanFitur } = await import(SEGARKAN);
  const db = dbPalsu();
  await segarkanFitur({
    ...KONFIG,
    db,
    fetchFn: async () => respons({ fitur: { diskon_kasir: false } }),
  });
  // Jendela antara DELETE dan INSERT adalah jendela tempat pembacaan lain
  // melihat tabel kosong — dan tabel kosong berarti seluruh fitur kembali ke
  // bawaan, yaitu kill switch yang mati sesaat setiap kali disegarkan.
  assert.equal(db.state.tulis.some((t) => /DELETE/i.test(t.sql)), false);
  assert.match(db.state.tulis[0].sql, /INSERT OR REPLACE INTO fitur_lokal/);
});
