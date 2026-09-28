'use strict';

// Token mockup: `packages/ds/tokens-mockup.css` wajib menyalin persis ketiga
// berkas sumber (`docs/referensi-visual/sumber/tokens/*.css`), token demi
// token, KECUALI empat koreksi AA yang dipaku di CLAUDE.md dan di brief Task 1.
//
// ## Kenapa penjaga ini ada
//
// Mockup adalah sumber kebenaran untuk tampilan (Global Constraints), tapi ia
// bukan berkas yang boleh disunting bebas — nilai yang menyimpang diam-diam
// dari sumber (satu digit hex tertukar, satu token terlewat saat menyalin)
// tidak menghasilkan error apa pun; ia hanya membuat token berikutnya di rantai
// Task 2-9 memakai warna yang salah. Penjaga ini membandingkan DUA sumber yang
// tidak ada apa pun menyatukannya — sumber mockup vendor dan berkas token kami
// — persis pola yang KELAS-GAGAL.md minta.
//
// Assert jumlah token sumber === 90 memastikan penjaga ini benar-benar
// memindai sesuatu, bukan hijau karena regex-nya salah dan menemukan nol
// token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIR_SUMBER = path.join(AKAR, 'docs/referensi-visual/sumber/tokens');
const BERKAS_SUMBER = ['colors.css', 'spacing-shape.css', 'typography.css'];
const MOCKUP = path.join(AKAR, 'packages/ds/tokens-mockup.css');

// Empat koreksi AA yang dipaku (CLAUDE.md § Rebuild UI kasir, brief Task 1).
// Tidak ada nilai warna lain yang boleh menyimpang dari sumber.
const KOREKSI_AA = {
  '--status-pending-text': '#5c7177',
  '--sidebar-label': '#5e7477',
  '--step-inactive-text': '#596f71',
  '--icon-muted': '#789b9c',
};

function normalisasi(nilai) {
  return nilai.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Parser generik: token `--nama: nilai;` di dalam blok `:root { ... }`,
// komentar dibuang lebih dulu. `@import` dan `font-family` tidak diawali `--`
// jadi otomatis diabaikan tanpa filter terpisah.
function parseToken(teks) {
  const bersih = teks.replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of bersih.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      peta[m[1]] = m[2];
    }
  }
  return peta;
}

function bacaSumber() {
  const peta = {};
  for (const nama of BERKAS_SUMBER) {
    Object.assign(peta, parseToken(fs.readFileSync(path.join(DIR_SUMBER, nama), 'utf8')));
  }
  return peta;
}

test('setiap token sumber ada di tokens-mockup.css dengan nilai yang sama, kecuali koreksi AA', () => {
  const sumber = bacaSumber();
  assert.equal(
    Object.keys(sumber).length,
    90,
    `parser menemukan ${Object.keys(sumber).length} token sumber, diharapkan 90 — penjaga mungkin tidak memindai apa pun`
  );

  const teksMockup = fs.readFileSync(MOCKUP, 'utf8');
  const target = parseToken(teksMockup);

  for (const [nama, nilaiSumber] of Object.entries(sumber)) {
    assert.ok(nama in target, `token ${nama} hilang di tokens-mockup.css`);
    const diharapkan = Object.prototype.hasOwnProperty.call(KOREKSI_AA, nama) ? KOREKSI_AA[nama] : nilaiSumber;
    assert.equal(
      normalisasi(target[nama]),
      normalisasi(diharapkan),
      `token ${nama}: tokens-mockup.css punya "${target[nama].trim()}", diharapkan "${diharapkan.trim()}"` +
        (Object.prototype.hasOwnProperty.call(KOREKSI_AA, nama) ? ' (koreksi AA)' : ' (sama persis dengan sumber)')
    );
  }
});

test('koreksi AA adalah SATU-SATUNYA penyimpangan', () => {
  const sumber = bacaSumber();
  const target = parseToken(fs.readFileSync(MOCKUP, 'utf8'));

  const menyimpang = [];
  for (const [nama, nilaiSumber] of Object.entries(sumber)) {
    if (!(nama in target)) continue; // ditangkap test sebelumnya sebagai "hilang"
    if (normalisasi(target[nama]) !== normalisasi(nilaiSumber)) menyimpang.push(nama);
  }

  assert.deepEqual(
    menyimpang.sort(),
    Object.keys(KOREKSI_AA).sort(),
    'himpunan token yang nilainya berbeda dari sumber harus PERSIS empat koreksi AA, tidak lebih tidak kurang'
  );
});

test('tokens-mockup.css tidak memuat @import', () => {
  // Komentar dibuang dulu — berkas ini boleh MENYEBUT kata "@import" di
  // komentar (menjelaskan kenapa ia tidak ada), yang tidak boleh ada adalah
  // deklarasi @import yang sungguh dieksekusi CSS.
  const tanpaKomentar = fs.readFileSync(MOCKUP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/@import/i.test(tanpaKomentar),
    'tokens-mockup.css memuat deklarasi @import — font Nunito Sans wajib di-self-host (kebijakan repo sejak F0), bukan diimpor dari Google Fonts'
  );
});

// ⛔ Ronde perbaikan akhir (tinjauan Opus) — dua test lama di atas hanya
// memeriksa arah "setiap token SUMBER ada di target"; keduanya BUTA terhadap
// KONTEN TAMBAHAN di tokens-mockup.css. `nol-hex-css.test.js` mengecualikan
// berkas ini sepenuhnya (`DS_KECUALI`) karena literal warna justru intinya di
// sini — tapi itu berarti tidak ada penjaga LAIN yang memeriksa apa yang
// ditambahkan. Menambahkan `.btn-primary{background:#ff0000}` (aturan CSS
// biasa, bukan token) atau `:root{--liar:#f00}` (blok :root KEDUA berisi
// token karangan) lolos kedua test lama tanpa satu pun kegagalan — dibuktikan
// lewat sabotase sebelum perbaikan ini ditulis (lihat laporan task).
//
// Perbaikannya DUA test baru, saling melengkapi:
//   1. Himpunan NAMA token di target harus PERSIS sama dengan sumber — bukan
//      hanya superset (`--liar` akan membuat targetnya PUNYA token yang
//      sumbernya tidak punya, dan itu sekarang ditolak).
//   2. Seluruh berkas (komentar dibuang) harus PERSIS SATU blok `:root { … }`
//      teratas, tanpa apa pun di luarnya — `.btn-primary{...}` bukan token
//      dan tidak pernah cocok pola `:root`, jadi hanya test struktural ini
//      yang menangkapnya.
test('himpunan nama token di tokens-mockup.css SAMA PERSIS dengan sumber — tidak lebih, tidak kurang', () => {
  const sumber = bacaSumber();
  const target = parseToken(fs.readFileSync(MOCKUP, 'utf8'));
  const namaSumber = Object.keys(sumber).sort();
  const namaTarget = Object.keys(target).sort();
  assert.deepEqual(
    namaTarget,
    namaSumber,
    'tokens-mockup.css memuat token yang TIDAK ADA di sumber (kemungkinan token karangan atau blok :root kedua) ' +
      'atau kehilangan token sumber — himpunan namanya wajib identik'
  );
});

/**
 * Mengembalikan `true` hanya bila teks (komentar sudah dibuang, sudah
 * di-trim) adalah TEPAT SATU blok `:root { … }` di level file — tidak ada
 * apa pun sebelum `:root`, dan tidak ada apa pun (selain whitespace) sesudah
 * kurung tutup yang menutupnya. Kurung di dalam blok dilacak lewat
 * kedalaman eksplisit supaya nilai bersarang (`linear-gradient(...)`, kalau
 * ada) tidak menutup blok lebih awal — pola yang sama dengan
 * `nol-hex-css.test.js`.
 */
function satuBlokRootTeratas(teksTanpaKomentar) {
  const teks = teksTanpaKomentar.trim();
  const pembuka = /^:root(?:\[[^\]]*\])?\s*\{/.exec(teks);
  if (!pembuka) return false;

  let i = pembuka[0].length;
  let kedalaman = 1;
  while (i < teks.length && kedalaman > 0) {
    // Kurung kurawal kedua di dalam :root berarti aturan BERSARANG
    // (`:root { .btn-primary { background: #f00 } }`) — CSS bersarang yang sah
    // dan berlaku di Chromium, jadi ia lolos pemeriksaan "satu blok" bila
    // kedalaman boleh naik. Berkas token hanya berisi deklarasi `--nama: nilai`.
    if (teks[i] === '{') return false;
    if (teks[i] === '}') kedalaman--;
    i++;
  }
  if (kedalaman !== 0) return false; // kurung tidak seimbang

  const sisa = teks.slice(i).trim();
  return sisa.length === 0;
}

test('tokens-mockup.css tidak memuat apa pun di luar SATU blok :root teratas', () => {
  const tanpaKomentar = fs.readFileSync(MOCKUP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    satuBlokRootTeratas(tanpaKomentar),
    'tokens-mockup.css memuat sesuatu di luar satu blok :root teratas (mis. aturan CSS lain seperti ' +
      '.btn-primary{...}, atau blok :root kedua) — nol-hex-css.test.js mengecualikan berkas ini sepenuhnya, ' +
      'jadi struktur berkas hanya diperiksa di sini'
  );
});
