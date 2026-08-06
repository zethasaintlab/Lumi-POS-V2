'use strict';

// T7 -- invariant #7 ditegakkan test, bukan review.
//
// CLAUDE.md: "Tidak ada angka pajak di luar `TaxCalculator`. Kemunculan
// `0.11`, `* 0.1`, `10%` di jalur perhitungan mana pun adalah cacat
// arsitektur."
//
// AC FR-C11 pertama (spec-c:473): "Pencarian regex terhadap angka tarif
// (`0.1`, `0.11`, `10%`, `11%`) di luar modul pajak tidak menemukan hasil di
// jalur perhitungan."
//
// Kenapa ini layak jadi test dan bukan sekadar catatan review: tarif pajak
// Indonesia BERUBAH lewat perda. Ketika berubah, satu-satunya tempat yang
// perlu dicari adalah tabel `tax_rate`. Satu konstanta yang menyelinap ke
// handler atau laporan berarti ada angka yang tidak ikut berubah, dan itu
// baru ketahuan saat merchant diperiksa pajak.
//
// Guard ini murni membaca file -- tanpa database, tanpa jaringan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const SERVER_SRC = path.join(__dirname, '../../apps/server/src');
const DOMAIN_SRC = path.join(__dirname, '../../packages/domain/src');

// Satu-satunya file yang BOLEH memuat aritmetika tarif.
const TAX_MODULE = path.join(DOMAIN_SRC, 'tax.ts');

async function collectTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

// Yang dicari adalah TARIF sebagai angka: desimal pecahan yang dipakai
// sebagai pengali (0.1, 0.11, .11), dan persentase pajak yang lazim di
// Indonesia (10%, 11%, 12%).
//
// Sengaja TIDAK memakai pola "angka apa pun": kode ini penuh angka yang sah
// -- 1000 untuk skala kuantitas, 404 untuk status HTTP, 16 untuk bit counter
// HLC. Guard yang menangkap semuanya akan segera dimatikan orang, dan guard
// yang dimatikan lebih buruk daripada guard yang tidak ada.
//
// Lookahead `(?!\.\d)` mengecualikan angka bertitik berantai seperti alamat
// IP. Ditambahkan setelah guard ini menangkap `'0.0.0.0'` di
// `apps/server/src/index.ts` -- host bind, bukan tarif pajak. Kasusnya
// dikunci di sentinel "angka sah" di bawah supaya tidak terulang.
const TAX_NUMBER_PATTERN = /(?<![\w.])0?\.\d+(?!\.\d)|(?<![\w.])\d{1,2}\s*%/g;

// Baris komentar bukan jalur perhitungan. AC-nya berbunyi "di jalur
// perhitungan", dan komentar seperti "10% -> 1000n" justru MENJELASKAN
// konvensi -- melarangnya akan mendorong orang menulis kode tanpa penjelasan.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function scan(dir) {
  const files = await collectTsFiles(dir);
  const findings = [];
  for (const file of files) {
    if (path.resolve(file) === path.resolve(TAX_MODULE)) continue;
    const code = stripComments(await readFile(file, 'utf8'));
    TAX_NUMBER_PATTERN.lastIndex = 0;
    const matches = code.match(TAX_NUMBER_PATTERN);
    if (matches !== null) {
      findings.push(`${path.relative(process.cwd(), file)}: ${[...new Set(matches)].join(', ')}`);
    }
  }
  return { files, findings };
}

test('invariant #7: tidak ada angka tarif pajak di apps/server', async () => {
  const { files, findings } = await scan(SERVER_SRC);
  // Sentinel: daftar file kosong membuat guard ini lulus tanpa menegaskan
  // apa pun -- lebih buruk daripada tidak ada guard sama sekali.
  assert.ok(files.length > 0, 'tidak ada file .ts ditemukan di apps/server/src -- guard lulus vakum');
  assert.deepEqual(findings, [], `angka tarif pajak ditemukan di luar TaxCalculator:\n${findings.join('\n')}`);
});

test('invariant #7: tidak ada angka tarif pajak di packages/domain selain tax.ts', async () => {
  const { files, findings } = await scan(DOMAIN_SRC);
  assert.ok(files.length > 1, 'packages/domain/src harus punya lebih dari satu file -- guard lulus vakum');
  assert.deepEqual(findings, [], `angka tarif pajak ditemukan di luar TaxCalculator:\n${findings.join('\n')}`);
});

// Kedua sentinel di bawah membuktikan POLANYA sendiri benar. Guard yang lolos
// karena regex-nya tidak pernah match apa pun sama tidak bergunanya dengan
// guard yang lolos karena daftar filenya kosong.
test('sentinel: pola menangkap bentuk tarif yang memang dilarang', () => {
  const dilarang = [
    'const tax = base * 0.1;',
    'const ppn = base * 0.11;',
    'if (rate === .11) {',
    'const label = "PBJT 10%";',
    'return amount * 12%;',
  ];
  for (const contoh of dilarang) {
    TAX_NUMBER_PATTERN.lastIndex = 0;
    assert.ok(TAX_NUMBER_PATTERN.test(contoh), `pola gagal menangkap: ${contoh}`);
  }
});

test('sentinel: pola TIDAK menangkap angka sah yang bertebaran di kode ini', () => {
  const sah = [
    'const MILLI = 1000n;',
    'throw new HttpError(404, "NOT_FOUND", "tidak ditemukan");',
    'const COUNTER_BITS = 16n;',
    'const RATE_SCALE = 10000n;',
    'quantityMilli: 2000n,',
    'assert.equal(res.statusCode, 201);',
    // Kasus nyata yang pernah ditangkap guard ini sebagai false positive.
    "await app.listen({ port: PORT, host: '0.0.0.0' });",
    'const ver = "1.2.3";',
  ];
  for (const contoh of sah) {
    TAX_NUMBER_PATTERN.lastIndex = 0;
    assert.equal(TAX_NUMBER_PATTERN.test(contoh), false, `pola salah menangkap angka sah: ${contoh}`);
  }
});
