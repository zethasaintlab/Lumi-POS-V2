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
