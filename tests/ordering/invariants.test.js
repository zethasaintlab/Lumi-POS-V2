'use strict';

// T6 (docs/superpowers/plans/PLAN-ordering-fondasi.md) -- pola SAMA PERSIS
// dengan tests/catalog/invariants.test.js: grep guard murni baca file, tanpa
// database, membuktikan invariant #4 (CLAUDE.md) di modul BARU ini --
// modules/ordering TIDAK PERNAH menyebut tabel katalog (item, item_variation,
// category, modifier_list, modifier, price_history) dalam SQL. Snapshot
// (item_name, variation_name, cost_at_sale) datang lewat
// getVariationSnapshot yang DIEKSPOR catalog/index.ts (T5), dan resolvePrice
// yang sudah diekspor lebih dulu (FR-A7) -- bukan query langsung.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const ORDERING_MODULE_DIR = path.join(__dirname, '../../apps/server/src/modules/ordering');

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

// Tabel katalog terlarang, dicek sebagai kata SQL utuh (FROM/JOIN/INTO/UPDATE
// diikuti nama tabel) -- BUKAN substring polos. Substring polos akan salah
// menangkap "order_line_modifier" (tabel milik modul INI SENDIRI, lihat
// db/migrations/0007_ordering.sql) sebagai pelanggaran kata "modifier", dan
// "modifierId"/"modifierListId" (nama field body request, bukan akses tabel)
// di handlers/orders.ts. `\b` di kedua sisi memastikan "modifier" tidak match
// di dalam "order_line_modifier" (garis bawah adalah karakter word, jadi
// tidak ada word-boundary di antara "line_" dan "modifier").
const FORBIDDEN_TABLE_PATTERN =
  /\b(FROM|JOIN|INTO|UPDATE)\s+"?(item_variation|item|category|modifier_list|modifier|price_history)"?\b/gi;

// Sentinel (sama seperti tests/catalog/invariants.test.js): kalau
// collectTsFiles suatu saat mengembalikan daftar kosong (rename direktori,
// checkout parsial), guard di bawah tidak menegaskan apa pun dan lulus
// vakum -- lebih buruk daripada tidak ada guard sama sekali.
test('modules/ordering tidak pernah menyebut tabel katalog dalam SQL (invariant #4)', async () => {
  const files = await collectTsFiles(ORDERING_MODULE_DIR);
  assert.ok(
    files.length > 0,
    'tidak ada file .ts ditemukan di bawah modules/ordering -- guard ini akan lulus vakum, cek ORDERING_MODULE_DIR'
  );
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    const matches = src.match(FORBIDDEN_TABLE_PATTERN) ?? [];
    assert.equal(
      matches.length,
      0,
      `akses tabel katalog terlarang di ${file}: ${matches.join(', ')}`
    );
  }
});

// Kedua sentinel di bawah membuktikan FORBIDDEN_TABLE_PATTERN sendiri benar
// -- BUKAN regex yang diam-diam tidak pernah match apa pun (guard yang lulus
// karena regex-nya rusak sama buruknya dengan guard yang lulus vakum karena
// daftar file kosong).
test('sentinel: FORBIDDEN_TABLE_PATTERN benar-benar menangkap akses tabel katalog', () => {
  FORBIDDEN_TABLE_PATTERN.lastIndex = 0;
  assert.ok(FORBIDDEN_TABLE_PATTERN.test('SELECT * FROM item_variation WHERE id = $1'));
  FORBIDDEN_TABLE_PATTERN.lastIndex = 0;
  assert.ok(FORBIDDEN_TABLE_PATTERN.test('SELECT 1 FROM category WHERE id = $1'));
});

// Sentinel: membuktikan regex TIDAK salah menangkap tabel/field milik modul
// ordering sendiri yang secara tekstual mengandung "modifier" atau "item".
test('sentinel: FORBIDDEN_TABLE_PATTERN tidak salah menangkap tabel/field modul ordering sendiri', () => {
  FORBIDDEN_TABLE_PATTERN.lastIndex = 0;
  assert.equal(FORBIDDEN_TABLE_PATTERN.test('INSERT INTO order_line_modifier (id, tenant_id) VALUES ($1, $2)'), false);
  FORBIDDEN_TABLE_PATTERN.lastIndex = 0;
  assert.equal(FORBIDDEN_TABLE_PATTERN.test('const modifierId = body.modifierId;'), false);
  FORBIDDEN_TABLE_PATTERN.lastIndex = 0;
  assert.equal(FORBIDDEN_TABLE_PATTERN.test('SELECT * FROM order_line WHERE order_id = $1'), false);
});
