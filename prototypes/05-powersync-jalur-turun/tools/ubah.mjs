// Mengubah katalog di PostgreSQL selagi browser terhubung, untuk menguji
// replikasi BERJALAN — bukan hanya muatan awal.
//
// Muatan awal dan replikasi berjalan adalah dua jalur berbeda di PowerSync:
// yang pertama snapshot, yang kedua WAL decoding. Prototipe yang hanya
// menguji muatan awal tidak mengatakan apa pun tentang apakah perubahan harga
// sore hari sampai ke kasir.
//
// Pakai: node tools/ubah.mjs "Nama Item Baru" [alpha|beta]

import pg from 'pg';

const URL_OWNER = 'postgres://lumi_owner:lumi_owner@localhost:5433/lumi';

const namaBaru = process.argv[2] ?? `Kopi Diubah ${new Date().toISOString().slice(11, 19)}`;
const tenant = process.argv[3] === 'beta' ? 'tenant-beta' : 'tenant-alpha';

const c = new pg.Client(URL_OWNER);
await c.connect();
await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenant]);
const { rows } = await c.query(`UPDATE item SET name = $1 WHERE id = $2 RETURNING id, name`, [
  namaBaru,
  `${tenant}-item`,
]);
console.log('diubah di PostgreSQL:', rows[0] ?? '(tidak ada baris — tenant salah?)');
await c.end();
