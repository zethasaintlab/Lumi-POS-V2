'use strict';

// ⛔ `new Pool()` HANYA BOLEH ADA DI SATU TEMPAT.
//
// `apps/server/src/db.ts` memasang `pool.on('error')` pada setiap pool yang ia
// buat, dan penangan itu adalah satu-satunya hal yang menahan seluruh proses
// tetap hidup saat satu koneksi menganggur mati (`pg-pool` memancarkan
// `'error'` pada POOL; `EventEmitter` tanpa pendengar untuk `'error'`
// MELEMPAR, dan lemparan dari callback soket tidak dapat ditangkap `try/catch`
// siapa pun).
//
// Pool yang dibuat di tempat LAIN melewati penangan itu sepenuhnya — dan
// gejalanya bukan test merah melainkan **server yang mati** pada hari
// PostgreSQL di-restart.
//
// ## ⛔ Kenapa penjaganya berbentuk "tidak boleh ada di tempat lain"
//
// Aturan alternatifnya — "setiap pool wajib punya penangan" — tidak dapat
// diperiksa tanpa menjalankan setiap jalur yang membuat pool. Aturan ini
// dapat: ia melarang BENTUKNYA, dan yang tidak dapat dibuat tidak dapat lupa
// diberi penangan. Bentuk yang sama dengan `packages/ds/index.ts` yang tidak
// mengekspor `CartRow`/`ProductCard` — yang tidak dapat diimpor tidak dapat
// dipakai keliru.
//
// ⛔ Pengecualiannya SATU dan diturunkan dari perannya (berkas yang memasang
// penangan itu), bukan dari daftar nama yang dapat diperpanjang orang
// berikutnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const PABRIK = 'apps/server/src/db.ts';

/** Setiap sumber TypeScript/JavaScript milik kita. */
function berkasSumber(dir, hasil = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-galeri', '.git'].includes(e.name)) continue;
    if (e.name.startsWith('dist-')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasSumber(p, hasil);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

test('⛔ `new Pool()` hanya ada di apps/server/src/db.ts', () => {
  const berkas = [
    ...berkasSumber(path.join(AKAR, 'apps')),
    ...berkasSumber(path.join(AKAR, 'packages')),
    ...berkasSumber(path.join(AKAR, 'tools')),
    ...berkasSumber(path.join(AKAR, 'db')),
  ];
  // Sentinel: penjaga yang memindai nol berkas hijau selamanya.
  assert.ok(berkas.length > 100, `pemindai hanya melihat ${berkas.length} berkas`);

  const pelanggar = [];
  let terlihat = 0;
  for (const f of berkas) {
    const isi = fs.readFileSync(f, 'utf8');
    // `new Pool(` maupun `new pg.Pool(`.
    const cocok = isi.match(/new\s+(?:pg\.)?Pool\s*\(/g) ?? [];
    if (cocok.length === 0) continue;
    terlihat += cocok.length;
    if (path.relative(AKAR, f) !== PABRIK) pelanggar.push(path.relative(AKAR, f));
  }

  // Sentinel kedua: kalau polanya tidak pernah cocok dengan apa pun, assertion
  // di bawah lulus tanpa memeriksa sesuatu — termasuk pada hari pabriknya
  // sendiri diganti bentuk lain.
  assert.ok(terlihat > 0, 'tidak ada `new Pool(` ditemukan sama sekali — apakah polanya berubah?');

  assert.deepEqual(
    pelanggar,
    [],
    'Pool dibuat di luar pabriknya, jadi ia TIDAK punya `pool.on("error")`:\n  ' +
      pelanggar.join('\n  ') +
      `\n\nPakai \`createPool()\` dari ${PABRIK}. Pool tanpa penangan \`error\` ` +
      'membunuh SELURUH proses saat satu koneksi menganggur mati — PostgreSQL ' +
      'di-restart, failover, `db:reset`, atau gangguan jaringan sesaat.'
  );
});

test('⛔ pabriknya benar-benar memasang penangan `error`', () => {
  // Penjaga di atas hanya bernilai selama pabriknya memang memasang penangan.
  // Tanpa test ini, memindahkan seluruh `new Pool()` ke satu berkas yang juga
  // TIDAK memasang penangan akan hijau — rapi, terpusat, dan tetap mematikan
  // prosesnya.
  //
  // Perilakunya diuji terhadap PostgreSQL sungguhan di
  // `tests/server/pool-koneksi-idle-mati.test.js`; yang di sini bentuknya,
  // supaya ia ikut merah di `test:runtime` yang berjalan tanpa database.
  const sumber = fs.readFileSync(path.join(AKAR, PABRIK), 'utf8');
  assert.match(
    sumber,
    /pool\.on\(\s*['"]error['"]/,
    `${PABRIK} tidak memasang \`pool.on('error')\``
  );
  // ⛔ Dan ia tidak boleh melempar ulang maupun mematikan proses — keduanya
  // mengembalikan persis cacat yang penangan ini hapus.
  const badan = sumber.slice(sumber.indexOf("pool.on('error'"));
  const blok = badan.slice(0, badan.indexOf('\n  });') + 6);
  assert.ok(!/\bthrow\b/.test(blok), 'penangan melempar ulang — prosesnya mati lagi');
  assert.ok(!/process\.exit/.test(blok), 'penangan memanggil process.exit — prosesnya mati lagi');
});
