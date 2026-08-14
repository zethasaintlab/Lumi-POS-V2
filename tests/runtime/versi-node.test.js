'use strict';

// Penjaga lantai versi Node.
//
// ⛔ Kelas cacat yang ditangkap berkas ini TIDAK MENGHASILKAN ERROR di mesin
// pengembangan. Ia hanya terlihat di CI, dan terlihatnya sebagai kegagalan
// yang menunjuk ke tempat yang salah.
//
// Terjadi 14 Agustus 2026: modul identity memakai `crypto.argon2`, yang baru
// ada sejak Node 24.7.0. Mesin pengembangan menjalankan 24.18.0 — seluruh
// 1108 test hijau. CI menjalankan Node 22, dan yang muncul di sana adalah tiga
// test PIN gagal dengan pesan dari lemparan di `pin-hasher.ts`, bukan satu
// kalimat yang menyebut versi Node. `engines.node` masih berbunyi `>=22.18`,
// jadi tidak ada satu pun berkas di repo yang menyatakan kebenarannya.
//
// Ada TIGA angka yang harus sepakat, dan tidak ada apa pun yang menyatukannya:
//
//   1. versi yang benar-benar dibutuhkan KODE  → `engines.node`
//   2. versi yang dijalankan CI                → `node-version` di workflow
//   3. versi yang dijalankan pengembang        → `process.version`
//
// Menaikkan lantai runtime lalu lupa menaikkan CI adalah langkah yang wajar
// dilakukan; yang tidak wajar adalah tidak ada yang mengeluh sampai PR-nya
// merah. Kedua test di bawah berdiri di dua momen berbeda: yang kedua gagal
// SEBELUM push, yang pertama gagal di CI dengan kalimat yang menyebut versi.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const AKAR = resolve(__dirname, '../..');
const WORKFLOWS = join(AKAR, '.github/workflows');

/**
 * Lantai `engines.node`, sebagai [major, minor, patch].
 *
 * Sengaja hanya memahami bentuk `>=X`, `>=X.Y`, dan `>=X.Y.Z` — dan MELEMPAR
 * untuk bentuk lain, bukan mengabaikannya. Rentang semver punya banyak bentuk
 * (`^`, `||`, `-`), dan penjaga yang diam-diam melewatkan bentuk yang tidak
 * dipahaminya adalah penjaga yang hijau justru saat ia paling dibutuhkan.
 * Kalau `engines` suatu saat berubah bentuk, berkas ini harus ikut diputuskan
 * — bukan menyerah sendiri.
 */
function lantaiEngines() {
  const pkg = JSON.parse(readFileSync(join(AKAR, 'package.json'), 'utf8'));
  const rentang = pkg.engines?.node;
  assert.ok(rentang, 'package.json tidak punya engines.node');
  const cocok = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(rentang.trim());
  if (!cocok) {
    throw new Error(
      `engines.node = ${JSON.stringify(rentang)} bukan bentuk ">=X.Y.Z" yang ` +
        'dipahami penjaga ini. Perbarui penjaganya — jangan longgarkan.'
    );
  }
  return [Number(cocok[1]), Number(cocok[2] ?? 0), Number(cocok[3] ?? 0)];
}

/** Negatif bila a < b, nol bila sama, positif bila a > b. */
function banding(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

/** Setiap `node-version:` di seluruh workflow, beserta nama berkasnya. */
function versiCi() {
  const hasil = [];
  for (const berkas of readdirSync(WORKFLOWS)) {
    if (!/\.ya?ml$/.test(berkas)) continue;
    const teks = readFileSync(join(WORKFLOWS, berkas), 'utf8').replace(/\r\n?/g, '\n');
    for (const baris of teks.split('\n')) {
      const bersih = baris.replace(/#.*$/, '');
      const cocok = /node-version:\s*['"]?([\d.]+)['"]?/.exec(bersih);
      if (cocok) hasil.push({ berkas, versi: cocok[1] });
    }
  }
  return hasil;
}

test('penjaga benar-benar membaca workflow — bukan hijau karena kosong', () => {
  const ci = versiCi();
  assert.ok(
    ci.length >= 2,
    `hanya ${ci.length} deklarasi node-version terbaca; parser kemungkinan rusak`
  );
});

test('⛔ Node yang MENJALANKAN test ini memenuhi engines.node', () => {
  // Yang gagal di CI 14 Agustus 2026 adalah `crypto.argon2` — tidak ada di
  // Node 22, ada sejak 24.7.0. Pesannya waktu itu datang dari dalam
  // `pin-hasher.ts` dan tidak menyebut kata "Node 22" sama sekali. Test ini
  // berdiri lebih dulu supaya yang terbaca adalah versinya, bukan gejalanya.
  const lantai = lantaiEngines();
  const kini = process.version.replace(/^v/, '').split('.').map(Number);
  assert.ok(
    banding(kini, lantai) >= 0,
    `Node ${process.version} di bawah lantai engines.node (>=${lantai.join('.')}). ` +
      'Beberapa API yang dipakai repo ini tidak ada di runtime tersebut.'
  );
});

test('⛔ setiap node-version di CI memenuhi engines.node', () => {
  // Ini penjaga yang gagal SEBELUM push, dan karena itu yang paling berharga
  // dari ketiganya.
  //
  // `actions/setup-node` meresolusi versi parsial ke rilis TERBARU yang cocok:
  // `'24'` berarti 24.x terbaru, bukan 24.0.0. Jadi major saja sudah memenuhi
  // lantai selama majornya cukup. Tapi versi yang dipatok sampai minor/patch
  // (`'24.3'`) berarti persis itu, dan harus dibandingkan apa adanya —
  // memperlakukan keduanya sama akan meloloskan patokan yang benar-benar
  // terlalu tua.
  const lantai = lantaiEngines();
  for (const { berkas, versi } of versiCi()) {
    const bagian = versi.split('.').map(Number);
    const cukup =
      bagian.length === 1 ? bagian[0] >= lantai[0] : banding(bagian, lantai) >= 0;
    assert.ok(
      cukup,
      `${berkas} menjalankan Node ${versi}, di bawah lantai engines.node ` +
        `(>=${lantai.join('.')}). CI akan gagal di tempat yang tidak menyebut versi Node.`
    );
  }
});
