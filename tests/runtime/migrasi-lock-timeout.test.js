'use strict';

// Migrasi yang mengubah bentuk tabel (ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT)
// wajib memuat `SET LOCAL lock_timeout` (CLAUDE.md § Definition of Done: expand-
// contract dengan lock_timeout). Tanpanya antrean kunci di tabel panas menahan
// SELURUH penjualan. Diperiksa pada SQL tanpa komentar, bukan pada kata di komentar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

/** Ratchet: hanya boleh MENYUSUT. Migrasi lama tak patuh dicatat bernomor; jangan diperbaiki. */
const PENGECUALIAN = new Set([]);

const tanpaKomentar = (s) => s.replace(/--.*$/gm, '');
const MENGUBAH_TABEL = /ALTER\s+TABLE[^;]*\bADD\s+(COLUMN|CONSTRAINT)\b/is;
const PUNYA_TIMEOUT = /SET\s+LOCAL\s+lock_timeout\s*=/i;

test('⛔ setiap migrasi ALTER TABLE ADD COLUMN/CONSTRAINT memuat SET LOCAL lock_timeout', () => {
  const berkas = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(berkas.length >= 37, `hanya ${berkas.length} migrasi terbaca`);
  let diperiksa = 0;
  const salah = [];
  for (const f of berkas) {
    const sql = tanpaKomentar(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!MENGUBAH_TABEL.test(sql)) continue;
    diperiksa += 1;
    if (!PUNYA_TIMEOUT.test(sql) && !PENGECUALIAN.has(f)) salah.push(f);
  }
  assert.ok(diperiksa >= 5, `penjaga hampa: hanya ${diperiksa} migrasi ALTER terdeteksi`);
  assert.deepEqual(salah, [], `migrasi tanpa SET LOCAL lock_timeout: ${salah.join(', ')}`);
});

test('pengecualian ratchet tidak basi: tiap entri ada dan memang tak patuh', () => {
  for (const f of PENGECUALIAN) {
    const sql = tanpaKomentar(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.ok(!PUNYA_TIMEOUT.test(sql), `${f} sudah patuh — hapus dari PENGECUALIAN (ratchet menyusut)`);
  }
});
