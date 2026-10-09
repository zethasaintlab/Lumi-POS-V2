'use strict';

// DoD CLAUDE.md: "Migrasi mengikuti expand-contract dengan `lock_timeout`". Tanpa batas, satu ALTER TABLE
// yang menunggu kunci menahan SETIAP penjualan di belakangnya — outage yang lahir dari migrasi.
// Fix round 2 Task 11 (M5): menghapus `SET LOCAL lock_timeout` dari 0037 tidak merahkan penjaga mana pun.
// Semua migrasi yang ada hari ini (0001…0037) memilikinya; tidak ada pengecualian.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const DIR = join(__dirname, '..', '..', 'db', 'migrations');
/** Pengecualian eksplisit bertanggal: `nama berkas → alasan`. KOSONG per 8 Oktober 2026. */
const PENGECUALIAN = {};

test('⛔ setiap migrasi menetapkan `SET LOCAL lock_timeout` (di luar komentar)', () => {
  const berkas = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(berkas.length >= 37, `hanya ${berkas.length} migrasi terbaca — penjaga hampa`);
  assert.ok(berkas.includes('0037_order_customer_table_note.sql'));
  const tanpa = [];
  for (const f of berkas) {
    if (PENGECUALIAN[f]) continue;
    const kode = readFileSync(join(DIR, f), 'utf8').replace(/\r\n?/g, '\n').split('\n')
      .filter((b) => !/^\s*--/.test(b)).join('\n');
    if (!/SET\s+LOCAL\s+lock_timeout\s*=/i.test(kode)) tanpa.push(f);
  }
  assert.deepEqual(tanpa, [], `migrasi tanpa SET LOCAL lock_timeout (DoD expand-contract): ${tanpa.join(', ')}`);
});
