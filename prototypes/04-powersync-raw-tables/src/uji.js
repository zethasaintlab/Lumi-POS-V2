import { PowerSyncDatabase, Schema } from '@powersync/web';
import {
  pernyataanSkema,
  TABEL_RAW,
  TABEL_LOKAL_SAJA,
  TABEL_TANPA_ID,
  SEMUA_TABEL_KAMI,
  INDEX_KAMI,
} from './skema.js';
import { pernyataanPenjualan, TABEL_PENJUALAN } from './penjualan.js';

const NAMA_DB = 'lumi-powersync.db';

let lapor = () => {};
export function setPelapor(fn) {
  lapor = fn;
}

function catat(nama, nilai, lulus) {
  lapor({ nama, nilai, lulus });
}

function persentil(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ---------------------------------------------------------------------------

export async function bukaDatabase() {
  const schema = new Schema({});
  // Seluruh tabel yang direplikasi dideklarasikan sebagai RAW TABLE.
  // Bentuk `{ schema: { tableName } }` menyuruh core menyimpulkan sendiri
  // pernyataan put/delete dari `pragma_table_info`.
  schema.withRawTables(
    Object.fromEntries(TABEL_RAW.map((t) => [t, { schema: { tableName: t } }]))
  );

  const db = new PowerSyncDatabase({
    schema,
    database: { dbFilename: NAMA_DB, enableMultiTabs: true },
  });
  await db.init();
  return db;
}

async function pasangSkemaKami(db) {
  const sudahAda = await db.getOptional(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='order'`
  );
  if (sudahAda) return false;
  for (const p of pernyataanSkema()) {
    await db.execute(p);
  }
  return true;
}

// --- T1 -------------------------------------------------------------------

async function t1Koeksistensi(db) {
  const namaTabel = (await db.getAll(`SELECT name FROM sqlite_master WHERE type='table'`)).map(
    (r) => r.name
  );
  const namaIndex = (await db.getAll(`SELECT name FROM sqlite_master WHERE type='index'`)).map(
    (r) => r.name
  );
  const namaView = (await db.getAll(`SELECT name FROM sqlite_master WHERE type='view'`)).map(
    (r) => r.name
  );

  const hilang = SEMUA_TABEL_KAMI.filter((t) => !namaTabel.includes(t));
  catat(
    'T1a 20 tabel kami selamat setelah powersync_replace_schema',
    hilang.length === 0 ? `${SEMUA_TABEL_KAMI.length}/${SEMUA_TABEL_KAMI.length} ada` : `HILANG: ${hilang.join(', ')}`,
    hilang.length === 0
  );

  const indexHilang = INDEX_KAMI.filter((i) => !namaIndex.includes(i));
  catat(
    'T1b 15 index kami selamat',
    indexHilang.length === 0 ? `${INDEX_KAMI.length}/${INDEX_KAMI.length} ada` : `HILANG: ${indexHilang.join(', ')}`,
    indexHilang.length === 0
  );

  // Raw table TIDAK menghasilkan view maupun tabel ps_data__.
  const psData = namaTabel.filter((t) => t.startsWith('ps_data'));
  catat(
    'T1c raw table tidak membuat tabel ps_data__*',
    psData.length === 0 ? '0 tabel' : psData.join(', '),
    psData.length === 0
  );

  const viewBentrok = namaView.filter((v) => SEMUA_TABEL_KAMI.includes(v));
  catat(
    'T1d tidak ada VIEW bernama sama dengan tabel kami',
    namaView.length === 0 ? '0 view di database' : `view: ${namaView.join(', ')}`,
    viewBentrok.length === 0
  );

  const psTabel = namaTabel.filter((t) => t.startsWith('ps_')).sort();
  catat(
    'T1e tabel internal PowerSync hidup berdampingan',
    psTabel.join(', ') || '(tidak ada)',
    psTabel.length > 0
  );

  // Tabel lokal-saja tidak dideklarasikan ke PowerSync sama sekali.
  const lokalHilang = TABEL_LOKAL_SAJA.filter((t) => !namaTabel.includes(t));
  catat(
    'T1f tabel lokal-saja utuh meski tak dikenal PowerSync',
    lokalHilang.length === 0 ? TABEL_LOKAL_SAJA.join(', ') : `HILANG: ${lokalHilang.join(', ')}`,
    lokalHilang.length === 0
  );
}

// --- T1g: tabel tanpa kolom id -------------------------------------------

async function t1gTanpaId(db) {
  const t = TABEL_TANPA_ID[0];
  const json = JSON.stringify(Schema.rawTableToJson({ name: t, schema: { tableName: t } }));
  let pesan = '(tidak ada error — di luar dugaan)';
  let ditolak = false;
  try {
    await db.execute('SELECT powersync_create_raw_table_crud_trigger(?, ?, ?)', [
      json,
      `uji_${t}_insert`,
      'INSERT',
    ]);
  } catch (e) {
    pesan = e.message ?? String(e);
    // Menuntut alasan yang BENAR, bukan sekadar "ada error".
    //
    // Versi pertama uji ini menerima error apa pun, dan ia lulus — atas
    // "unexpected write type insert", karena write type-nya memang salah
    // ditulis huruf kecil. Uji yang lulus atas kegagalan yang salah tidak
    // membuktikan apa pun tentang kolom id.
    ditolak = /id column/i.test(pesan);
  }
  catat(
    `T1g ${t} (tanpa kolom id) ditolak DENGAN ALASAN kolom id`,
    pesan,
    ditolak
  );
}

// --- T2 & T3: invariant #1 ------------------------------------------------

async function hitungBarisPenjualan(db, orderId) {
  let total = 0;
  const per = [];
  for (const [tabel, klausa] of TABEL_PENJUALAN) {
    const r = await db.get(`SELECT count(*) AS n FROM "${tabel}" WHERE ${klausa}`, [orderId]);
    total += r.n;
    if (r.n > 0) per.push(`${tabel}=${r.n}`);
  }
  return { total, per };
}

async function t2Commit(db, n) {
  const orderId = `ord-${n}`;
  await db.writeTransaction(async (tx) => {
    for (const [sql, params] of pernyataanPenjualan(n)) {
      await tx.execute(sql, params);
    }
  });
  const { total, per } = await hitungBarisPenjualan(db, orderId);
  catat(
    'T2 satu penjualan utuh dalam SATU writeTransaction',
    `${total} baris tersimpan (${per.join(', ')})`,
    total === 10
  );
}

async function t3Rollback(db, n) {
  const orderId = `ord-${n}`;
  let gagalSepertiSeharusnya = false;
  let pesan = '';
  try {
    await db.writeTransaction(async (tx) => {
      for (const [sql, params] of pernyataanPenjualan(n, { rusakDiAkhir: true })) {
        await tx.execute(sql, params);
      }
    });
  } catch (e) {
    gagalSepertiSeharusnya = true;
    pesan = e.message ?? String(e);
  }

  catat(
    'T3a pernyataan terakhir memang gagal (kalau tidak, T3b hampa)',
    gagalSepertiSeharusnya ? pesan.slice(0, 120) : 'TIDAK GAGAL — uji ini tidak membuktikan apa pun',
    gagalSepertiSeharusnya
  );

  const { total, per } = await hitungBarisPenjualan(db, orderId);
  catat(
    'T3b sembilan baris sebelumnya IKUT hilang (rollback)',
    total === 0 ? '0 baris tersisa' : `${total} baris BERTAHAN: ${per.join(', ')}`,
    total === 0
  );
}

// --- T4: jalur naik tetap milik outbox_local ------------------------------

async function t4JalurNaik(db) {
  const awal = await db.get('SELECT count(*) AS n FROM ps_crud');
  catat(
    'T4a ps_crud kosong — PowerSync tidak menangkap penjualan kami',
    `${awal.n} entri setelah ${2} penjualan ditulis`,
    awal.n === 0
  );

  // Pembanding. Tanpa ini, "ps_crud kosong" bisa berarti mekanismenya memang
  // tidak pernah bekerja — dan klaim "jalur naik tetap milik kami" jadi hampa.
  const json = JSON.stringify(
    Schema.rawTableToJson({ name: 'category', schema: { tableName: 'category' } })
  );
  let mekanismeBekerja = false;
  let catatan = '';
  try {
    await db.execute('DROP TRIGGER IF EXISTS uji_category_insert');
    await db.execute('SELECT powersync_create_raw_table_crud_trigger(?, ?, ?)', [
      json,
      'uji_category_insert',
      'INSERT',
    ]);
    await db.execute(
      `INSERT INTO category (id,tenant_id,name) VALUES ('cat-uji','ten-1','Uji trigger')`
    );
    const sesudah = await db.get('SELECT count(*) AS n FROM ps_crud');
    mekanismeBekerja = sesudah.n === 1;
    catatan = `${sesudah.n} entri setelah trigger dipasang + 1 INSERT`;
  } catch (e) {
    catatan = `GAGAL: ${e.message ?? e}`;
  }
  catat(
    'T4b dengan trigger dipasang, ps_crud MEMANG terisi',
    catatan,
    mekanismeBekerja
  );

  await db.execute('DROP TRIGGER IF EXISTS uji_category_insert');
  await db.execute(
    `INSERT INTO category (id,tenant_id,name) VALUES ('cat-uji-2','ten-1','Setelah trigger dilepas')`
  );
  const akhir = await db.get('SELECT count(*) AS n FROM ps_crud');
  catat(
    'T4c trigger dilepas -> penulisan berhenti ditangkap lagi',
    `${akhir.n} entri (tetap 1)`,
    akhir.n === 1
  );
  await db.execute('DELETE FROM ps_crud');
}

// --- T5: latensi ----------------------------------------------------------

async function t5Latensi(db, mulaiDari) {
  const N = 200;
  for (let i = 0; i < 20; i += 1) {
    await db.writeTransaction(async (tx) => {
      for (const [sql, params] of pernyataanPenjualan(mulaiDari + i)) await tx.execute(sql, params);
    });
  }

  const durasi = [];
  for (let i = 0; i < N; i += 1) {
    const n = mulaiDari + 20 + i;
    const a = performance.now();
    await db.writeTransaction(async (tx) => {
      for (const [sql, params] of pernyataanPenjualan(n)) await tx.execute(sql, params);
    });
    durasi.push(performance.now() - a);
  }

  catat('T5 tulis 1 penjualan (10 baris, 8 tabel) p50', `${persentil(durasi, 50).toFixed(2)} ms`, true);
  catat('T5 tulis 1 penjualan p95', `${persentil(durasi, 95).toFixed(2)} ms`, true);
  catat('T5 tulis 1 penjualan p99', `${persentil(durasi, 99).toFixed(2)} ms`, true);
  catat(
    'T5 throughput',
    `${(1000 / (durasi.reduce((a, b) => a + b, 0) / N)).toFixed(0)} penjualan/detik`,
    true
  );

  const b0 = performance.now();
  const r = await db.get(
    `SELECT SUM(total) AS t FROM "order" WHERE business_date='2026-08-07' AND status='closed'`
  );
  catat('T5 baca total hari ini', `${(performance.now() - b0).toFixed(2)} ms — total ${r.t}`, true);

  return durasi;
}

// --- T5b/c: DARI MANA selisih terhadap prototipe 03 datang ----------------
//
// 13 ms di sini vs 3,25 ms di prototipe 03 untuk penjualan yang sama. VFS-nya
// sama (`OPFSCoopSyncVFS`), skemanya sama, barisnya sama. Yang berbeda hanya
// BENTUK pengirimannya: sepuluh `tx.execute` terpisah, masing-masing satu
// perjalanan bolak-balik ke worker, versus satu string `BEGIN;…;COMMIT;`.
//
// Menuliskan "PowerSync lebih lambat" tanpa mengukur ini akan menyalahkan
// PowerSync atas biaya yang mungkin bukan miliknya.

function satukanPernyataan(n) {
  return pernyataanPenjualan(n)
    .map(([sql, params]) => {
      let i = 0;
      return sql.replace(/\?/g, () => {
        const v = params[i++];
        if (v === null) return 'NULL';
        return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
      });
    })
    .join(';\n');
}

async function t5bBentukPengiriman(db, mulaiDari) {
  const N = 100;

  // (b) sepuluh pernyataan sebagai SATU string di dalam writeTransaction.
  const satu = [];
  for (let i = 0; i < N; i += 1) {
    const a = performance.now();
    await db.writeTransaction(async (tx) => {
      await tx.execute(satukanPernyataan(mulaiDari + i));
    });
    satu.push(performance.now() - a);
  }
  catat(
    'T5b 10 pernyataan sebagai SATU tx.execute — p50',
    `${persentil(satu, 50).toFixed(2)} ms`,
    true
  );

  // (c) transaksi kosong: lantai biaya writeTransaction itu sendiri
  //     (BEGIN IMMEDIATE + COMMIT + kunci global + 2 perjalanan ke worker).
  const kosong = [];
  for (let i = 0; i < N; i += 1) {
    const a = performance.now();
    await db.writeTransaction(async (tx) => {
      await tx.execute('SELECT 1');
    });
    kosong.push(performance.now() - a);
  }
  catat(
    'T5c writeTransaction berisi 1 pernyataan sepele — p50',
    `${persentil(kosong, 50).toFixed(2)} ms — ini lantai biayanya`,
    true
  );
}

// --- T5d: apakah SharedWorker multi-tab yang mahal? ----------------------
//
// T5b menunjukkan perjalanan bolak-balik per pernyataan BUKAN penyebabnya
// (11,25 ms untuk satu execute vs 13 ms untuk sepuluh). Tersangka berikutnya
// adalah `enableMultiTabs: true`, yang menaruh koneksi di SharedWorker alih-alih
// dedicated worker. Kalau benar, ada trade-off nyata yang harus dicatat:
// keamanan dua tab dibayar dengan latensi tulis.
async function t5dMultiTab(mulaiDari) {
  const N = 100;
  const hasil = {};

  for (const multiTab of [false, true]) {
    const schema = new Schema({});
    schema.withRawTables(
      Object.fromEntries(TABEL_RAW.map((t) => [t, { schema: { tableName: t } }]))
    );
    const db = new PowerSyncDatabase({
      schema,
      database: {
        dbFilename: `banding-${multiTab ? 'multi' : 'tunggal'}.db`,
        enableMultiTabs: multiTab,
      },
    });
    await db.init();
    for (const p of pernyataanSkema()) {
      try {
        await db.execute(p);
      } catch {
        /* sudah ada dari run sebelumnya */
      }
    }

    // Dikosongkan lebih dulu. Tanpa ini kedua database menumpuk baris antar
    // muat-ulang halaman dan angkanya menanjak tiap kali dijalankan — yang
    // membuat mereka tidak dapat dibandingkan dengan T5, apalagi prototipe 03.
    for (const [t] of TABEL_PENJUALAN) await db.execute(`DELETE FROM "${t}"`);

    const durasi = [];
    for (let i = 0; i < N; i += 1) {
      const a = performance.now();
      await db.writeTransaction(async (tx) => {
        for (const [sql, params] of pernyataanPenjualan(mulaiDari + i)) await tx.execute(sql, params);
      });
      durasi.push(performance.now() - a);
    }
    hasil[multiTab] = persentil(durasi, 50);
    await db.close();
  }

  catat(
    'T5d enableMultiTabs: false (dedicated worker) — p50',
    `${hasil[false].toFixed(2)} ms`,
    true
  );
  catat(
    'T5d enableMultiTabs: true (SharedWorker) — p50',
    `${hasil[true].toFixed(2)} ms`,
    true
  );
}

// --- T5e: apakah biaya itu melekat pada RAW TABLE, atau pada koneksinya? --
//
// `order` dideklarasikan sebagai raw table; `outbox_local` tidak pernah
// disebut ke PowerSync sama sekali. Sepuluh INSERT ke masing-masing, bentuk
// transaksi sama. Kalau angkanya sama, biaya tambahan itu milik koneksi
// PowerSync secara umum — bukan harga yang kita bayar karena memilih raw table.
async function t5eRawVsTakDikenal(db) {
  const N = 100;
  const ukur = async (buat) => {
    const d = [];
    for (let i = 0; i < N; i += 1) {
      const a = performance.now();
      await db.writeTransaction(async (tx) => {
        for (let k = 0; k < 10; k += 1) await buat(tx, i, k);
      });
      d.push(performance.now() - a);
    }
    return persentil(d, 50);
  };

  const raw = await ukur((tx, i, k) =>
    tx.execute(
      `INSERT INTO "check" (id,order_id,label,subtotal,total) VALUES (?,?,NULL,1,1)`,
      [`e-raw-${i}-${k}`, `e-${i}`]
    )
  );
  const takDikenal = await ukur((tx, i, k) =>
    tx.execute(
      `INSERT INTO outbox_local (id,entity_type,entity_id,operation,payload,idempotency_key,
        status,attempts,created_at) VALUES (?,'x',?,'create','{}',?,'pending',0,'2026-08-07')`,
      [`e-out-${i}-${k}`, `e-${i}`, `k-${i}-${k}`]
    )
  );

  catat('T5e 10 INSERT ke tabel RAW (check) — p50', `${raw.toFixed(2)} ms`, true);
  catat(
    'T5e 10 INSERT ke tabel yang PowerSync tak kenal (outbox_local) — p50',
    `${takDikenal.toFixed(2)} ms`,
    true
  );

  await db.execute(`DELETE FROM "check" WHERE id LIKE 'e-raw-%'`);
  await db.execute(`DELETE FROM outbox_local WHERE id LIKE 'e-out-%'`);
}

// ---------------------------------------------------------------------------

export async function jalankanSemua() {
  const t0 = performance.now();
  const db = await bukaDatabase();
  catat('Buka PowerSyncDatabase + init', `${(performance.now() - t0).toFixed(0)} ms`, true);

  const versi = await db.get('SELECT powersync_rs_version() AS v, sqlite_version() AS s');
  catat('Versi core PowerSync / SQLite', `${versi.v} / ${versi.s}`, true);

  // Database bersih setiap kali dijalankan, supaya hitungan baris berarti.
  for (const t of SEMUA_TABEL_KAMI) {
    await db.execute(`DROP TABLE IF EXISTS "${t}"`);
  }
  await pasangSkemaKami(db);

  // Inilah panggilan yang menjalankan powersync_replace_schema atas skema yang
  // seluruh tabelnya raw. T1 memeriksa akibatnya.
  const t1 = performance.now();
  await db.updateSchema(await bukaSkemaRaw());
  catat('updateSchema (powersync_replace_schema)', `${(performance.now() - t1).toFixed(1)} ms`, true);

  await t1Koeksistensi(db);
  await t1gTanpaId(db);
  await t2Commit(db, 1);
  await t3Rollback(db, 2);
  await t4JalurNaik(db);
  await t5Latensi(db, 100);
  await t5bBentukPengiriman(db, 1000);
  await t5eRawVsTakDikenal(db);
  await t5dMultiTab(2000);

  return db;
}

async function bukaSkemaRaw() {
  const schema = new Schema({});
  schema.withRawTables(
    Object.fromEntries(TABEL_RAW.map((t) => [t, { schema: { tableName: t } }]))
  );
  return schema;
}

// --- T6: dua tab ----------------------------------------------------------

export async function modeTahan() {
  const db = await bukaDatabase();
  catat('Tab ini berhasil MEMBUKA database', NAMA_DB, true);

  await pasangSkemaKami(db);

  const tag = `tab-${Math.floor(performance.now())}`;
  let n = 0;
  setInterval(async () => {
    n += 1;
    try {
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT OR REPLACE INTO device_config (device_code,outlet_id,receipt_sequence)
           VALUES (?, 'out-1', ?)`,
          [tag, n]
        );
      });
      const r = await db.get('SELECT count(*) AS n FROM device_config');
      catat(`tulis ke-${n} dari ${tag}`, `BERHASIL — ${r.n} tab tercatat di device_config`, true);
    } catch (e) {
      catat(`tulis ke-${n} dari ${tag}`, `GAGAL: ${e.name}: ${e.message}`, false);
    }
  }, 1500);
}
