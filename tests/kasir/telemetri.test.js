'use strict';

// Buffer telemetri lokal — di atas SQLite sungguhan.
//
// Aturan murninya diuji di `tests/domain/telemetri.test.js`. Yang diuji DI
// SINI adalah tiga hal yang hanya dapat dibuktikan terhadap database:
//
//   1. ⛔ `rekam()` menelan SETIAP kegagalan — termasuk `no such table` pada
//      perangkat yang migrasi lokalnya belum jalan. Pemanggilnya jalur
//      penjualan dan jalur cetak (`ARCH:307`).
//   2. ⛔ pemangkasan membuang yang TERLAMA. Jaminan itu hidup di `ORDER BY`,
//      dan `CLAUDE.md` mencatat bahwa fake `DbLokal` tidak menegakkan
//      `ORDER BY` sama sekali — mengujinya di atas fake berarti tidak
//      mengujinya.
//   3. ⛔ `susunMuatan` TIDAK menghapus. Menghapus sebelum server menjawab
//      berarti kegagalan jaringan membuang metrik yang justru menjelaskan
//      kegagalan itu.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/telemetri/rekam.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const db = {
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      return fn(db);
    },
    /** Hanya untuk test — pembacaan langsung tanpa lewat modul yang diuji. */
    baris() {
      return sqlite.prepare('SELECT * FROM telemetry_local ORDER BY pada_waktu ASC').all();
    },
    jumlah() {
      return Number(sqlite.prepare('SELECT count(*) AS n FROM telemetry_local').get().n);
    },
    sisip(id, event, nilai, padaWaktu, tipe = null) {
      sqlite
        .prepare('INSERT INTO telemetry_local (id, event, nilai, tipe, pada_waktu) VALUES (?, ?, ?, ?, ?)')
        .run(id, event, nilai, tipe, padaWaktu);
    },
  };
  return db;
}

const WAKTU = new Date('2026-08-21T10:00:00.000Z');

/** `deps` dengan id yang berurut, supaya assert-nya dapat menyebut baris. */
function deps(db, mode = 'full') {
  let n = 0;
  return { db, mode, waktu: () => WAKTU, idBaru: () => `t${++n}` };
}

beforeEach(async () => {
  const { resetPenghitungPangkas } = await import(MOD);
  resetPenghitungPangkas();
});

// ---------------------------------------------------------------------------
// Penulisan
// ---------------------------------------------------------------------------

test('rekam menulis satu baris dengan nilai apa adanya', async () => {
  const { rekam } = await import(MOD);
  const db = dbSungguhan();

  await rekam(deps(db), 'latensi_keranjang_ms', 42);

  const baris = db.baris();
  assert.equal(baris.length, 1);
  assert.equal(baris[0].event, 'latensi_keranjang_ms');
  assert.equal(Number(baris[0].nilai), 42);
  assert.equal(baris[0].tipe, null);
  assert.equal(baris[0].pada_waktu, WAKTU.toISOString());
});

test('⛔ mode `off` tidak menulis satu baris pun', async () => {
  const { rekam } = await import(MOD);
  const db = dbSungguhan();

  for (const e of ['latensi_keranjang_ms', 'crash', 'antrean_gagal']) {
    await rekam(deps(db, 'off'), e, 1);
  }
  assert.equal(db.jumlah(), 0);
});

test('⛔ mode `minimal` menyaring SEBELUM menulis, bukan saat mengirim', async () => {
  const { rekam } = await import(MOD);
  const db = dbSungguhan();
  const d = deps(db, 'minimal');

  // Yang disaring tidak boleh sekadar tidak terkirim — ia tidak boleh pernah
  // ADA di perangkat. Merchant yang memilih `minimal` sedang berkata ia tidak
  // mau pengukuran itu diambil.
  await rekam(d, 'latensi_keranjang_ms', 42);
  await rekam(d, 'crash', 1, 'TypeError');

  assert.deepEqual(db.baris().map((b) => b.event), ['crash']);
});

test('⛔ nilai yang bukan angka tidak pernah menyentuh database', async () => {
  const { rekam } = await import(MOD);
  const db = dbSungguhan();

  // `ARCH:309` — batas etis. SQLite akan dengan senang hati menyimpan string
  // di kolom `REAL` (affinity hanya mengubah nilai bila lossless), jadi yang
  // menahannya adalah `bersihkanPeristiwa`, bukan skema.
  for (const nilai of ['Kopi Susu', NaN, Infinity, null, undefined, { harga: 25000 }]) {
    await rekam(deps(db), 'latensi_keranjang_ms', nilai);
  }
  assert.equal(db.jumlah(), 0);
});

test('⛔ event di luar daftar tertutup tidak pernah tertulis', async () => {
  const { rekam } = await import(MOD);
  const db = dbSungguhan();
  await rekam(deps(db), 'nilai_transaksi', 25000);
  assert.equal(db.jumlah(), 0);
});

// ---------------------------------------------------------------------------
// Tidak pernah melempar
// ---------------------------------------------------------------------------

test('⛔ `no such table` DITELAN — perangkat yang migrasinya belum jalan tetap menjual', async () => {
  const { rekam } = await import(MOD);
  const sqlite = new DatabaseSync(':memory:');
  // Sengaja tanpa skema: inilah perangkat yang sudah terpasang sebelum
  // `telemetry_local` ada. Ia mendapat tabelnya lewat `rencanaBuatLokalHilang`
  // saat boot berikutnya — dan sampai itu terjadi, penjualan tidak boleh
  // gagal karena telemetri.
  const db = {
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      return fn(db);
    },
  };

  await assert.doesNotReject(() => rekam(deps(db), 'cetak_percobaan', 1));
});

test('⛔ db yang melempar apa pun DITELAN, dan `pangkas` juga', async () => {
  const { rekam, pangkas } = await import(MOD);
  const meledak = {
    async getAll() {
      throw new Error('OPFS hilang');
    },
    async execute() {
      throw new Error('disk penuh');
    },
    async transaction(fn) {
      return fn(meledak);
    },
  };

  await assert.doesNotReject(() => rekam(deps(meledak), 'crash', 1, 'TypeError'));
  await assert.doesNotReject(() => pangkas(meledak));
});

// ---------------------------------------------------------------------------
// Pemangkasan
// ---------------------------------------------------------------------------

function jam(i) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + i * 60_000).toISOString();
}

test('⛔ pemangkasan membuang yang TERLAMA, bukan yang terbaru', async () => {
  const { pangkas } = await import(MOD);
  const db = dbSungguhan();

  // Disisipkan dalam urutan ACAK supaya jaminan urutannya datang dari
  // `ORDER BY`, bukan dari urutan penulisan.
  const urutanSisip = [7, 2, 9, 0, 5, 1, 8, 3, 6, 4];
  for (const i of urutanSisip) db.sisip(`t${i}`, 'antrean_gagal', i, jam(i));

  const { jumlahDibuang } = await import('../../packages/domain/src/telemetri.ts');
  assert.equal(jumlahDibuang(10, 4), 6, 'prasyarat: batasnya memang memotong');

  // Batas kecil supaya test tidak perlu 5.000 baris.
  await pangkas(db, 4);

  const sisa = db.baris().map((b) => b.id);
  assert.deepEqual(sisa, ['t6', 't7', 't8', 't9'], 'yang tersisa adalah yang TERBARU');
});

test('pemangkasan di bawah batas tidak menghapus apa pun', async () => {
  const { pangkas } = await import(MOD);
  const db = dbSungguhan();
  for (let i = 0; i < 3; i += 1) db.sisip(`t${i}`, 'antrean_gagal', i, jam(i));

  await pangkas(db, 4);
  assert.equal(db.jumlah(), 3);
});

test('⛔ pemangkasan berjalan sendiri — buffer tidak menunggu ada yang memanggilnya', async () => {
  const { rekam, resetPenghitungPangkas } = await import(MOD);
  const { BATAS_BUFFER } = await import('../../packages/domain/src/telemetri.ts');
  const db = dbSungguhan();
  resetPenghitungPangkas();

  // Perangkat yang sudah penuh sebelum penulisan berikutnya terjadi.
  for (let i = 0; i < BATAS_BUFFER; i += 1) db.sisip(`lama${i}`, 'antrean_gagal', i, jam(i));

  const d = deps(db);
  for (let i = 0; i < 100; i += 1) await rekam(d, 'antrean_gagal', i);

  assert.equal(db.jumlah(), BATAS_BUFFER, 'buffer kembali ke batas tanpa ada yang memintanya');
  const sisa = db.baris();
  assert.equal(sisa.filter((b) => b.id.startsWith('lama')).length, BATAS_BUFFER - 100);
});

// ---------------------------------------------------------------------------
// Muatan kirim
// ---------------------------------------------------------------------------

const IDENTITAS = { appVersion: '1.0.0' };

test('buffer kosong menghasilkan `null`, bukan muatan kosong', async () => {
  const { susunMuatan } = await import(MOD);
  const db = dbSungguhan();
  assert.equal(await susunMuatan(db, IDENTITAS), null);
});

test('⛔ susunMuatan TIDAK menghapus — penghapusan menunggu server menjawab', async () => {
  const { susunMuatan } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', 'antrean_gagal', 2, jam(1));

  const hasil = await susunMuatan(db, IDENTITAS);
  assert.deepEqual(hasil.idTerbaca, ['t1']);
  assert.equal(db.jumlah(), 1, 'baris masih ada — jaringan boleh gagal');
});

test('muatan meringkas per event dan membawa jendela waktunya', async () => {
  const { susunMuatan } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', 'latensi_keranjang_ms', 10, jam(0));
  db.sisip('t2', 'latensi_keranjang_ms', 30, jam(1));
  db.sisip('t3', 'crash', 1, jam(2), 'TypeError');

  const { muatan } = await susunMuatan(db, IDENTITAS);
  assert.equal(muatan.appVersion, '1.0.0');
  assert.equal(muatan.windowStart, jam(0));
  assert.equal(muatan.windowEnd, jam(2));

  const latensi = muatan.events.find((r) => r.event === 'latensi_keranjang_ms');
  assert.deepEqual(
    { count: latensi.count, total: latensi.total, min: latensi.min, max: latensi.max },
    { count: 2, total: 40, min: 10, max: 30 }
  );
  assert.equal(muatan.events.find((r) => r.event === 'crash').type, 'TypeError');
});

test('⛔ baris dari versi aplikasi lama dibuang saat dibaca, dan tetap dihapus', async () => {
  const { susunMuatan } = await import(MOD);
  const db = dbSungguhan();
  // Event yang pernah sah di rilis sebelumnya. Kalau ia ikut terkirim, server
  // menolak seluruh muatan — dan buffer yang tidak pernah terkuras akhirnya
  // membuang metrik yang masih baik.
  db.sisip('t1', 'event_yang_sudah_tidak_ada', 5, jam(0));

  const hasil = await susunMuatan(db, IDENTITAS);
  assert.deepEqual(hasil.muatan.events, []);
  assert.deepEqual(hasil.idTerbaca, ['t1'], 'tetap ditandai supaya dapat dihapus');
});

test('tandaiTerkirim menghapus HANYA id yang disebut', async () => {
  const { tandaiTerkirim } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', 'antrean_gagal', 1, jam(0));
  db.sisip('t2', 'antrean_gagal', 2, jam(1));
  db.sisip('t3', 'antrean_gagal', 3, jam(2));

  // Baris yang lahir SELAMA permintaan terbang tidak boleh ikut terhapus —
  // ia belum pernah sampai ke server.
  await tandaiTerkirim(db, ['t1', 't2']);
  assert.deepEqual(db.baris().map((b) => b.id), ['t3']);
});

test('tandaiTerkirim dengan daftar kosong tidak menyentuh apa pun', async () => {
  const { tandaiTerkirim } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', 'antrean_gagal', 1, jam(0));
  await tandaiTerkirim(db, []);
  assert.equal(db.jumlah(), 1);
});
