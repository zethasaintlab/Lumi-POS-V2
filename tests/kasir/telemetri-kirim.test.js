'use strict';

// Pengiriman telemetri — jalur naik KEDUA.
//
// ⛔ Yang diuji di sini adalah perbedaannya dari relay penjualan, dan
// perbedaannya disengaja: relay mencoba SELAMANYA karena yang diantrekannya
// uang merchant; telemetri boleh menyerah, dan harus, karena buffer yang
// tidak pernah terkuras adalah disk yang `outbox_local` butuhkan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/telemetri/kirim.ts';
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
    jumlah() {
      return Number(sqlite.prepare('SELECT count(*) AS n FROM telemetry_local').get().n);
    },
    sisip(id, padaWaktu, event = 'antrean_gagal', nilai = 1) {
      sqlite
        .prepare('INSERT INTO telemetry_local (id, event, nilai, tipe, pada_waktu) VALUES (?, ?, ?, ?, ?)')
        .run(id, event, nilai, null, padaWaktu);
    },
  };
  return db;
}

function jam(i) {
  return new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
}

/** `fetch` palsu yang mencatat panggilannya dan dapat disuruh gagal. */
function fetchPalsu(jawaban = []) {
  const panggilan = [];
  let i = 0;
  const fn = async (url, opsi) => {
    panggilan.push({ url, opsi, body: JSON.parse(opsi.body) });
    const j = jawaban[Math.min(i, jawaban.length - 1)] ?? { status: 202 };
    i += 1;
    if (j.lempar) throw new Error('jaringan putus');
    return { ok: j.status >= 200 && j.status < 300, status: j.status };
  };
  fn.panggilan = panggilan;
  return fn;
}

function konfig(db, fetchFn) {
  return {
    db,
    baseUrl: 'https://server.contoh',
    tenantId: 't1',
    deviceId: 'd1',
    tokenSecret: 'rahasia',
    appVersion: '1.0.0',
    fetchFn,
    timeoutMs: 50,
  };
}

// ---------------------------------------------------------------------------

test('buffer kosong tidak menghasilkan permintaan HTTP sama sekali', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const f = fetchPalsu();
  const hasil = await buatPengirimTelemetri(konfig(dbSungguhan(), f)).kirimSekali();

  // Perangkat offline memanggil ini berulang. Permintaan yang tidak membawa
  // apa-apa adalah biaya jaringan tanpa imbalan.
  assert.deepEqual(hasil, { kind: 'kosong' });
  assert.equal(f.panggilan.length, 0);
});

test('sukses menghapus baris yang terkirim, dan membawa kredensial perangkat', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));
  db.sisip('t2', jam(1));
  const f = fetchPalsu([{ status: 202 }]);

  const hasil = await buatPengirimTelemetri(konfig(db, f)).kirimSekali();
  assert.equal(hasil.kind, 'terkirim');
  assert.equal(db.jumlah(), 0);

  const p = f.panggilan[0];
  assert.equal(p.url, 'https://server.contoh/devices/d1/telemetry');
  assert.equal(p.opsi.headers.Authorization, 'Bearer rahasia');
  assert.equal(p.opsi.headers['X-Tenant-Id'], 't1');
  assert.ok(p.opsi.headers['Idempotency-Key']);
  assert.equal(p.body.appVersion, '1.0.0');
  assert.equal(p.body.events.length, 1, 'dua peristiwa satu event menjadi satu agregat');
});

test('⛔ kegagalan jaringan MEMPERTAHANKAN baris — metrik yang menjelaskan kegagalan itu', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));
  const f = fetchPalsu([{ lempar: true }]);

  const hasil = await buatPengirimTelemetri(konfig(db, f)).kirimSekali();
  assert.deepEqual(hasil, { kind: 'tertunda', status: null });
  assert.equal(db.jumlah(), 1);
});

test('⛔ 401 DIPERTAHANKAN — perangkat yang kedaluwarsa akan di-provisioning ulang', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));
  const f = fetchPalsu([{ status: 401 }]);

  // Justru metrik dari masa perangkat tidak terhubung yang menjelaskan kenapa
  // ia tidak terhubung. Membuangnya di sini membuang persis itu.
  const hasil = await buatPengirimTelemetri(konfig(db, f)).kirimSekali();
  assert.equal(hasil.kind, 'tertunda');
  assert.equal(db.jumlah(), 1);
});

test('⛔ 400 DIBUANG — muatan yang bentuknya salah tidak akan pernah diterima', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));
  const f = fetchPalsu([{ status: 400 }]);

  // Mempertahankannya berarti batch itu diulang selamanya, dan buffer yang
  // tidak pernah terkuras akhirnya memangkas metrik yang MASIH BAIK.
  const hasil = await buatPengirimTelemetri(konfig(db, f)).kirimSekali();
  assert.deepEqual(hasil, { kind: 'dibuang', status: 400 });
  assert.equal(db.jumlah(), 0);
});

test('⛔ 500 dipertahankan dan diulang dengan BATCH dan KUNCI yang sama', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));
  const f = fetchPalsu([{ status: 500 }, { status: 202 }]);
  const pengirim = buatPengirimTelemetri(konfig(db, f));

  await pengirim.kirimSekali();
  // Baris baru lahir DI ANTARA dua percobaan — persis keadaan yang membuat
  // penggandaan mungkin.
  db.sisip('t2', jam(5));
  await pengirim.kirimSekali();

  assert.equal(f.panggilan.length, 2);
  // ⛔ Percobaan kedua mengirim batch yang SAMA, bukan yang lebih lebar. Kalau
  // yang pertama sebenarnya sampai (respons yang hilang), selisihnya akan
  // terhitung dua kali — dan kunci yang sama membuat server menolaknya.
  assert.equal(
    f.panggilan[1].opsi.headers['Idempotency-Key'],
    f.panggilan[0].opsi.headers['Idempotency-Key']
  );
  assert.deepEqual(f.panggilan[1].body, f.panggilan[0].body);
  // `t2` belum ikut, jadi ia tetap ada setelah batch pertama dikonfirmasi.
  assert.equal(db.jumlah(), 1);
});

test('kunci batch stabil untuk isi yang sama, berbeda untuk isi yang berbeda', async () => {
  const { kunciBatch } = await import(MOD);
  // Ia harus bertahan melewati muat ulang aplikasi: percobaan setelah restart
  // tidak boleh menghasilkan kunci baru untuk baris yang sama.
  assert.equal(kunciBatch('d1', ['a', 'b']), kunciBatch('d1', ['b', 'a']));
  assert.notEqual(kunciBatch('d1', ['a', 'b']), kunciBatch('d1', ['a', 'c']));
  assert.notEqual(kunciBatch('d1', ['ab', 'c']), kunciBatch('d1', ['a', 'bc']));
  assert.notEqual(kunciBatch('d1', ['a']), kunciBatch('d2', ['a']));
});

test('⛔ timeout membatalkan permintaan — `fetch` tidak boleh menggantung', async () => {
  const { buatPengirimTelemetri } = await import(MOD);
  const db = dbSungguhan();
  db.sisip('t1', jam(0));

  let sinyal = null;
  const fetchGantung = (_url, opsi) =>
    new Promise((_selesai, gagal) => {
      sinyal = opsi.signal;
      opsi.signal.addEventListener('abort', () => gagal(new Error('dibatalkan')));
    });

  const hasil = await buatPengirimTelemetri(konfig(db, fetchGantung)).kirimSekali();
  assert.equal(hasil.kind, 'tertunda');
  assert.equal(sinyal.aborted, true, 'permintaan tidak pernah dibatalkan');
  assert.equal(db.jumlah(), 1);
});

// ---------------------------------------------------------------------------
// Penjadwal
// ---------------------------------------------------------------------------

/** Timer palsu: menyimpan callback, dijalankan manual. */
function timerPalsu() {
  const antre = [];
  return {
    set: (fn) => {
      antre.push(fn);
      return antre.length;
    },
    clear: () => {},
    async jalankan() {
      const fn = antre.shift();
      if (fn) await fn();
    },
    sisa: () => antre.length,
  };
}

test('⛔ putaran yang MELEMPAR tidak mematikan penjadwal', async () => {
  const { jalankanTelemetri } = await import(MOD);
  const t = timerPalsu();
  let n = 0;
  const kirim = async () => {
    n += 1;
    throw new Error('meledak');
  };

  // Penjadwal yang mati pada kegagalan pertama berhenti mengirim SELAMANYA,
  // tanpa satu pun error yang terlihat — dan yang hilang justru metrik dari
  // perangkat yang sedang bermasalah.
  jalankanTelemetri(kirim, { intervalMs: 1, setTimer: t.set, clearTimer: t.clear });
  await t.jalankan();
  await t.jalankan();

  assert.equal(n, 2);
  assert.equal(t.sisa(), 1, 'putaran berikutnya tetap dijadwalkan');
});

test('hentikan() menghentikan penjadwalan ulang', async () => {
  const { jalankanTelemetri } = await import(MOD);
  const t = timerPalsu();
  let n = 0;
  const p = jalankanTelemetri(
    async () => {
      n += 1;
    },
    { intervalMs: 1, setTimer: t.set, clearTimer: t.clear }
  );

  p.hentikan();
  await t.jalankan();
  assert.equal(n, 1, 'putaran yang sudah antre tetap jalan');
  assert.equal(t.sisa(), 0, 'tapi tidak menjadwalkan yang berikutnya');
});
