'use strict';

// ⛔ KONEKSI IDLE YANG MATI TIDAK BOLEH MEMBUNUH PROSES.
//
// ## Kejadiannya, 12 September 2026
//
// `npm run db:reset` dijalankan sementara server hidup → server MATI. Bukan
// restart, bukan hang: prosesnya hilang, dan `curl /health` menjawab 000.
//
//     node:events:486  throw er; // Unhandled 'error' event
//     error: terminating connection due to administrator command
//     Emitted 'error' event on BoundPool instance at:
//         at Client.idleListener (node_modules/pg-pool/index.js:62:10)
//
// `db/reset.js` menjalankan `pg_terminate_backend` atas setiap koneksi ke
// database itu — memang itu tugasnya, karena `DROP DATABASE` ditolak selama
// masih ada yang terhubung. Koneksi IDLE milik pool server ikut diputus,
// `pg-pool` memancarkan `'error'` pada POOL, dan `'error'` adalah nama
// peristiwa istimewa di Node: `EventEmitter` tanpa pendengar untuknya
// MELEMPAR.
//
// ## ⛔ Kenapa test ini berbentuk begini, dan bukan "jalankan db:reset"
//
// Test yang benar-benar memanggil `db:reset` akan MEMBUANG DATABASE yang
// dipakai seluruh suite lain, dan urutan berkas test tidak dijamin apa pun.
// Yang direproduksi karena itu MEKANISMENYA, bukan perintahnya:
// `pg_terminate_backend` atas koneksi idle milik pool — persis yang
// `db/reset.js` lakukan, satu baris SQL yang sama, tanpa menyentuh database
// siapa pun.
//
// ## ⛔ Kenapa ia tidak dapat lulus dengan hampa
//
// Kalau penanganya hilang, `'error'` yang tak berpendengar akan MEMATIKAN
// PROSES TEST ITU SENDIRI — bukan menghasilkan satu assertion merah melainkan
// seluruh berkas gagal. Itu justru bukti terkuat yang tersedia.
//
// Tetapi "prosesnya tidak mati" saja tidak cukup: ia juga benar bila
// koneksinya TIDAK PERNAH benar-benar diputus, dan test yang hijau karena
// skenarionya tidak terjadi adalah bentuk kekosongan yang
// `docs/verifikasi/KELAS-GAGAL.md` catat. Karena itu setiap test di bawah
// membuktikan lebih dulu bahwa pemutusannya SUNGGUH TERJADI — lewat jumlah
// backend yang diputus, dan lewat peristiwa `'error'` yang benar-benar
// tertangkap.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');

const MOD = '../../apps/server/src/db.ts';

let pengawas;

before(async () => {
  // Koneksi TERPISAH, dan ia sengaja bukan bagian dari pool yang diuji —
  // ia yang memutus, jadi ia tidak boleh ikut terputus.
  pengawas = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pengawas.connect();
});

after(async () => {
  if (pengawas) await pengawas.end();
});

/**
 * Memutus setiap koneksi milik `pid` yang disebut — bentuk yang SAMA dengan
 * `db/reset.js`, tanpa membuang database siapa pun.
 */
async function putuskan(pids) {
  const { rows } = await pengawas.query(
    `SELECT pg_terminate_backend(pid) AS diputus FROM pg_stat_activity
      WHERE pid = ANY($1::int[]) AND pid <> pg_backend_pid()`,
    [pids]
  );
  return rows.filter((r) => r.diputus).length;
}

/** Menunggu sampai `uji()` benar, atau menyerah. Tanpa timer tetap. */
async function sampai(uji, batasMs = 5000) {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    if (await uji()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// ---------------------------------------------------------------------------

test('⛔ pool yang dibuat createPool() PUNYA pendengar `error`', async () => {
  // Pemeriksaan termurah, dan ia yang gagal paling jelas. `'error'` tanpa
  // pendengar mematikan proses; `listenerCount` menjawabnya tanpa perlu
  // memutus satu koneksi pun.
  const { createPool } = await import(MOD);
  const pool = createPool();
  try {
    assert.ok(
      pool.listenerCount('error') > 0,
      'Pool tidak punya pendengar `error`. Satu koneksi idle yang mati akan ' +
        "membunuh SELURUH proses dengan Unhandled 'error' event."
    );
  } finally {
    await pool.end();
  }
});

test('⛔ koneksi idle yang DIPUTUS tidak mematikan proses, dan pool memberi tahu', async () => {
  const { createPool } = await import(MOD);
  const pool = createPool();

  /* ⛔ Test ini TIDAK memasang `pool.on('error')`-nya sendiri, dan itu inti
     dari bentuknya.
     Versi pertama memasangnya — dan sabotase membuktikan versi itu HAMPA:
     dengan penangan produksi dicabut, test tetap hijau, karena pendengar yang
     test pasang sendiri sudah cukup menenangkan Node. Ia menguji `pg-pool`,
     bukan kode kita.
     Yang diamati sekarang EFEK SAMPING penangan produksi: baris `[db]` yang
     hanya `createPool()` dapat menghasilkan. Kalau penanganya hilang, tidak
     ada yang menulis baris itu — dan prosesnya mati sebelum sempat. */
  const baris = [];
  const aslinya = console.error;
  console.error = (...a) => baris.push(a.join(' '));

  try {
    // Paksa pool membuat koneksi, lalu kembalikan sebagai IDLE — keadaan
    // yang `db:reset` temui di server sungguhan.
    const client = await pool.connect();
    const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
    const pid = rows[0].pid;
    client.release();

    // ⛔ Dibuktikan bahwa ia BENAR-BENAR menganggur sebelum diputus. Koneksi
    // yang masih dipegang mengambil jalur `client.on('error')` yang berbeda,
    // dan test yang salah jalur tidak menguji cacat ini sama sekali.
    const menganggur = await sampai(async () => {
      const r = await pengawas.query(
        `SELECT state FROM pg_stat_activity WHERE pid = $1`,
        [pid]
      );
      return r.rows[0]?.state === 'idle';
    });
    assert.ok(menganggur, 'koneksi tidak pernah menjadi idle — skenarionya tidak terjadi');

    const diputus = await putuskan([pid]);
    assert.equal(diputus, 1, 'pemutusan tidak terjadi — test ini akan hijau dengan hampa');

    // Peristiwanya datang asinkron lewat soket.
    const terlihat = await sampai(async () => baris.some((b) => b.startsWith('[db]')));
    assert.ok(
      terlihat,
      'Penangan `error` PRODUKSI di createPool() tidak pernah jalan. Yang ' +
        `tercatat: ${JSON.stringify(baris)}`
    );
    assert.match(
      baris.find((b) => b.startsWith('[db]')),
      /terminating connection|Connection terminated/i
    );

    // ⛔ Dan proses ini MASIH HIDUP untuk menjalankan baris ini. Tanpa
    // penangan di `createPool()`, eksekusi tidak pernah sampai ke sini.
    assert.equal(typeof process.pid, 'number');
  } finally {
    console.error = aslinya;
    await pool.end();
  }
});

test('⛔ pool PULIH sendiri: query berikutnya berhasil tanpa membuat pool baru', async () => {
  // Inilah yang membuat "tidak ada strategi reconnect" menjadi pernyataan yang
  // diuji, bukan harapan. `pg-pool` sudah membuang klien matinya SEBELUM
  // memancarkan `error`; `pool.connect()` berikutnya membuat yang baru.
  const { createPool } = await import(MOD);
  // Tanpa `pool.on('error')` milik test — lihat catatan di test sebelumnya.
  const pool = createPool();

  try {
    const a = await pool.connect();
    const { rows } = await a.query('SELECT pg_backend_pid() AS pid');
    const pidLama = rows[0].pid;
    a.release();
    await sampai(async () => {
      const r = await pengawas.query('SELECT state FROM pg_stat_activity WHERE pid = $1', [pidLama]);
      return r.rows[0]?.state === 'idle';
    });
    assert.equal(await putuskan([pidLama]), 1);

    /* ⛔ Ditunggu lewat `pg_stat_activity`, BUKAN dengan mencoba
       `pool.connect()` berulang kali.
       Versi pertama test ini melakukan yang kedua, dan ia gagal DETERMINISTIK
       dengan `ECONNRESET` — bukan karena kodenya salah: percobaan `connect()`
       yang ditolak meninggalkan soket yang errornya datang BELAKANGAN, dan
       `pool.end()` di `finally` berpacu dengannya. Node melaporkannya sebagai
       *"generated asynchronous activity after the test ended"*.
       Menunggu kondisi yang dapat diamati dari koneksi LAIN tidak menyentuh
       pool sama sekali, jadi tidak ada yang tertinggal terbang. */
    const hilang = await sampai(async () => {
      const r = await pengawas.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pidLama]);
      return r.rowCount === 0;
    });
    assert.ok(hilang, 'backend lama tidak pernah hilang — pemutusannya tidak selesai');

    // SATU percobaan, pada pool yang SAMA — bukan pool baru.
    const b = await pool.connect();
    const r = await b.query('SELECT pg_backend_pid() AS pid');
    b.release();
    assert.notEqual(
      r.rows[0].pid,
      pidLama,
      'pool mengembalikan koneksi MATI yang sama — klien rusak tidak dibuang'
    );
  } finally {
    await pool.end();
  }
});

test('⛔ transaksi yang SEDANG BERJALAN tetap gagal keras, bukan diam', async () => {
  // Penangan pool TIDAK BOLEH meluas menjadi "abaikan kegagalan database".
  // Koneksi yang sedang dipegang transaksi mengambil jalur `client.on('error')`
  // di `withTenantTransaction`, dan di sana kegagalan HARUS sampai ke
  // pemanggil — penjualan yang gagal ditulis tidak boleh terlihat berhasil.
  const { createPool, withTenantTransaction } = await import(MOD);
  // Tanpa `pool.on('error')` milik test — lihat catatan di test sebelumnya.
  const pool = createPool();

  try {
    let sampai_ke_pemanggil = false;
    try {
      await withTenantTransaction(pool, '00000000-0000-0000-0000-000000000000', async (client) => {
        const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
        await putuskan([rows[0].pid]);
        // Query berikutnya di koneksi yang sudah mati.
        await client.query('SELECT 1');
      });
    } catch {
      sampai_ke_pemanggil = true;
    }
    assert.ok(
      sampai_ke_pemanggil,
      'kegagalan di tengah transaksi DITELAN — penangan pool meluas terlalu jauh'
    );
  } finally {
    await pool.end();
  }
});
