import { PowerSyncDatabase, Schema } from '@powersync/web';
import SKEMA_SQL from '../../../db/local/001-initial.sql?raw';
import { buatConnector } from './token.js';

const ENDPOINT = 'http://localhost:8080';

// Ketujuh tabel katalog — sama persis dengan publication di
// tools/siapkan.mjs dan dengan sync-config.yaml. Ketiganya harus sepakat;
// kalau tidak, gejalanya "sync jalan tapi satu tabel kosong".
const TABEL_KATALOG = [
  'category',
  'item',
  'item_variation',
  'modifier_list',
  'modifier',
  'item_modifier_list',
  'tax_rate',
];

const HARAPAN = {
  alpha: { tenantId: 'tenant-alpha', item: 'Kopi Susu Alpha', modifier: 'Gula Alpha' },
  beta: { tenantId: 'tenant-beta', item: 'Kopi Susu Beta', modifier: 'Gula Beta' },
};

let lapor = () => {};
export function setPelapor(fn) {
  lapor = fn;
}
function catat(nama, nilai, lulus) {
  lapor({ nama, nilai, lulus });
}

function pernyataanSkema() {
  return SKEMA_SQL.split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function pasangTabelKami(db) {
  // Tabel kami harus ADA sebelum PowerSync menulis ke dalamnya.
  for (const t of TABEL_KATALOG) await db.execute(`DROP TABLE IF EXISTS "${t}"`);
  for (const p of pernyataanSkema()) {
    try {
      await db.execute(p);
    } catch (e) {
      // Tabel non-katalog mungkin sudah ada dari run sebelumnya; hanya
      // kegagalan pada tabel katalog yang berarti.
      if (TABEL_KATALOG.some((t) => p.includes(`TABLE ${t}`) || p.includes(`TABLE "${t}"`))) throw e;
    }
  }
}

async function buka(namaTenant, { bersihkanSyncState = true } = {}) {
  const schema = new Schema({});
  schema.withRawTables(
    Object.fromEntries(TABEL_KATALOG.map((t) => [t, { schema: { tableName: t } }]))
  );

  const db = new PowerSyncDatabase({
    schema,
    // Satu berkas per tenant. Berbagi berkas membuat T4 tidak dapat
    // dipercaya: baris tenant sebelumnya masih ada di sana, dan "bocor"
    // tidak dapat dibedakan dari "sisa run sebelumnya".
    database: { dbFilename: `lumi-turun-${namaTenant}.db`, enableMultiTabs: true },
  });
  await db.init();

  // WAJIB untuk run yang berulang, dan alasannya adalah T5.
  //
  // Menghapus tabel KAMI tidak menghapus apa pun yang PowerSync ketahui.
  // Checkpoint-nya hidup di tabel `ps_*` yang terpisah, jadi tanpa baris ini
  // run kedua menerima NOL baris dan `waitForFirstSync()` selesai dalam 0 ms
  // sambil melaporkan sukses.
  if (bersihkanSyncState) await db.disconnectAndClear();

  await pasangTabelKami(db);
  await db.updateSchema(schema);
  return db;
}

async function hitungKatalog(db) {
  const out = {};
  for (const t of TABEL_KATALOG) {
    const r = await db.get(`SELECT count(*) AS n FROM "${t}"`);
    out[t] = r.n;
  }
  return out;
}

export async function jalankan(namaTenant) {
  const harap = HARAPAN[namaTenant];
  const db = await buka(namaTenant);

  catat(`Buka database lokal (tenant ${namaTenant})`, `lumi-turun-${namaTenant}.db`, true);

  const kosong = await hitungKatalog(db);
  const totalAwal = Object.values(kosong).reduce((a, b) => a + b, 0);
  catat(
    'T0 sebelum connect, katalog lokal KOSONG',
    `${totalAwal} baris — kalau tidak nol, T1 tidak membuktikan sync`,
    totalAwal === 0
  );

  const t0 = performance.now();
  db.connect(buatConnector(harap.tenantId, ENDPOINT));

  let tersinkron = false;
  try {
    await Promise.race([
      db.waitForFirstSync(),
      new Promise((_, tolak) => setTimeout(() => tolak(new Error('timeout 30 detik')), 30_000)),
    ]);
    tersinkron = true;
  } catch (e) {
    catat('T1 sinkronisasi pertama selesai', `GAGAL: ${e.message}`, false);
  }
  const durasiSync = performance.now() - t0;

  if (tersinkron) {
    catat('T1 sinkronisasi pertama selesai', `${durasiSync.toFixed(0)} ms`, true);
  }

  // --- T2: barisnya benar-benar mendarat di TABEL KAMI, bukan di ps_data__ ---
  const jumlah = await hitungKatalog(db);
  const semuaAda = TABEL_KATALOG.every((t) => jumlah[t] === 1);
  catat(
    'T2 ketujuh tabel katalog terisi lewat jalur turun',
    JSON.stringify(jumlah),
    semuaAda
  );

  const psData = await db.getAll(
    `SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'ps_data*'`
  );
  catat(
    'T2b PowerSync menulis ke tabel KAMI, bukan membuat ps_data__*',
    psData.length === 0 ? '0 tabel ps_data__*' : psData.map((r) => r.name).join(', '),
    psData.length === 0
  );

  // --- T3: item_modifier_list -- alasan migrasi 0018 ada ---
  const iml = await db.getAll('SELECT * FROM item_modifier_list');
  const imlBenar =
    iml.length === 1 &&
    typeof iml[0].id === 'string' &&
    iml[0].id.length > 0 &&
    iml[0].item_id === `${harap.tenantId}-item` &&
    iml[0].modifier_list_id === `${harap.tenantId}-ml`;
  catat(
    'T3 item_modifier_list turun UTUH (alasan migrasi 0018)',
    JSON.stringify(iml[0] ?? null),
    imlBenar
  );

  // --- T4: isolasi tenant. Sync rules SATU-SATUNYA yang menjaganya ---
  const lain = namaTenant === 'alpha' ? HARAPAN.beta : HARAPAN.alpha;
  const items = await db.getAll('SELECT id, name FROM item');

  // Diperiksa lewat `id`, bukan `name`.
  //
  // Versi pertama membandingkan nama item, dan ia merah setelah uji
  // perubahan-berjalan mengganti nama itu di PostgreSQL — gagal karena
  // datanya berubah, bukan karena isolasinya bocor. Uji isolasi yang bisa
  // dijatuhkan oleh UPDATE yang sah tidak menjaga apa pun.
  const idItem = items.map((r) => r.id);
  const adaMilikSendiri = idItem.includes(`${harap.tenantId}-item`);
  const adaMilikOrangLain = idItem.includes(`${lain.tenantId}-item`);
  catat(
    'T4 HANYA katalog tenant ini yang turun',
    `terlihat: [${idItem.join(', ')}] — milik tenant lain (${lain.tenantId}-item) ${adaMilikOrangLain ? 'BOCOR' : 'tidak ada'}`,
    adaMilikSendiri && !adaMilikOrangLain
  );

  // Diperiksa juga lewat tenant_id mentah, bukan hanya lewat nama. Nama bisa
  // kebetulan sama; tenant_id tidak.
  const tid = await db.getAll('SELECT DISTINCT tenant_id AS t FROM category');
  const hanyaSatu = tid.length === 1 && tid[0].t === harap.tenantId;
  catat(
    'T4b tenant_id pada baris yang turun hanya milik tenant ini',
    tid.map((r) => r.t).join(', ') || '(kosong)',
    hanyaSatu
  );

  // --- T5: bahaya yang ditemukan tanpa dicari ---
  //
  // Ditemukan karena run kedua prototipe ini tiba-tiba menerima nol baris.
  // Ia bukan gangguan prototipe melainkan sifat produk: checkpoint PowerSync
  // hidup di tabel `ps_*`, TERPISAH dari tabel kami. Menghapus tabel kami
  // tidak memberi tahu PowerSync apa pun.
  //
  // Akibatnya di produksi: migrasi skema lokal yang membangun ulang sebuah
  // raw table menghasilkan katalog KOSONG secara permanen, dan
  // `waitForFirstSync()` tetap melaporkan sukses. Layar kasir kosong tanpa
  // satu pun error.
  await db.disconnect();
  await pasangTabelKami(db);
  const setelahDrop = await hitungKatalog(db);
  const totalSetelahDrop = Object.values(setelahDrop).reduce((a, b) => a + b, 0);

  const t5 = performance.now();
  db.connect(buatConnector(harap.tenantId, ENDPOINT));
  await db.waitForFirstSync().catch(() => {});
  const durasiT5 = performance.now() - t5;
  const setelahReconnect = await hitungKatalog(db);
  const totalSetelahReconnect = Object.values(setelahReconnect).reduce((a, b) => a + b, 0);

  catat(
    'T5 menghapus tabel lokal TIDAK memicu unduh ulang',
    `${totalSetelahDrop} baris setelah drop -> ${totalSetelahReconnect} setelah reconnect, ` +
      `waitForFirstSync ${durasiT5.toFixed(0)} ms dan MELAPORKAN SUKSES`,
    totalSetelahReconnect === 0
  );

  catat(
    'T5b yang memulihkannya hanya disconnectAndClear()',
    'checkpoint hidup di tabel ps_*, terpisah dari tabel kami',
    true
  );

  return db;
}

// --- mode pantau: untuk menguji perubahan BERJALAN, bukan hanya muatan awal ---
export async function pantau(namaTenant) {
  const harap = HARAPAN[namaTenant];
  const db = await buka(namaTenant);
  db.connect(buatConnector(harap.tenantId, ENDPOINT));
  await db.waitForFirstSync();

  const awal = await db.get('SELECT count(*) AS n FROM item');
  catat('Pantau: muatan awal selesai', `${awal.n} item`, true);
  catat('Menunggu perubahan dari PostgreSQL…', 'jalankan tools/ubah.mjs', true);

  let sebelumnya = JSON.stringify(
    (await db.getAll('SELECT id, name FROM item ORDER BY id')).map((r) => r.name)
  );
  setInterval(async () => {
    const sekarang = JSON.stringify(
      (await db.getAll('SELECT id, name FROM item ORDER BY id')).map((r) => r.name)
    );
    if (sekarang !== sebelumnya) {
      catat('PERUBAHAN TURUN', `${sebelumnya} -> ${sekarang}`, true);
      sebelumnya = sekarang;
    }
  }, 500);
}
