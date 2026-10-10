'use strict';

// G-STRUK (runtime, ringan): PratinjauStruk memanggil `tataLetakStruk(` dan TIDAK memuat
// tata letak sendiri. Penjaga DOM hanya menyala pada dokumen yang diujinya; ini menutup
// jalan pintas yang kebetulan menghasilkan baris yang sama.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SUMBER = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'apps', 'kasir', 'src', 'komponen', 'PratinjauStruk.tsx'),
  'utf8'
);
// Komentar dibuang: penjelasan boleh menyebut nama fungsi yang dilarang.
const KODE = SUMBER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('⛔ PratinjauStruk memanggil tataLetakStruk( dari escpos.ts', () => {
  assert.match(KODE, /tataLetakStruk\(/, 'PratinjauStruk tidak memanggil tataLetakStruk(');
  assert.match(KODE, /from '\.\.\/cetak\/escpos\.ts'/);
});

test('⛔ PratinjauStruk tidak berisi tata letak sendiri', () => {
  for (const terlarang of [/\blipat\b/, /\bduaKolom\(/, /\bkeAscii\b/, /\.padStart\(/, /\.padEnd\(/, /\.repeat\(/, /\.slice\(/, /\bTRANSLITERASI\b/, /\brenderEscPos\b/, /\.replace\(/]) {
    assert.ok(!terlarang.test(KODE), `PratinjauStruk memuat ${terlarang} — tata letak harus dari tataLetakStruk saja`);
  }
});
