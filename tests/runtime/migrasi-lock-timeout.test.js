// Definition of Done: migrasi mengikuti expand-contract dengan `lock_timeout`.
// Mulai 0037 (Task 11), setiap migrasi yang mengubah skema wajib membatasi lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../../db/migrations/', import.meta.url);
const tanpaKomentar = (s) => s.replace(/--[^\n]*/g, '');

const berkas = readdirSync(DIR)
  .filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) >= 37)
  .sort();

test('⛔ migrasi >= 0037 yang memuat ALTER TABLE / CREATE INDEX wajib memuat SET LOCAL lock_timeout', () => {
  let diperiksa = 0;
  for (const n of berkas) {
    const sql = tanpaKomentar(readFileSync(new URL(n, DIR), 'utf8'));
    if (!/\bALTER\s+TABLE\b|\bCREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql)) continue;
    diperiksa++;
    assert.match(sql, /SET\s+LOCAL\s+lock_timeout\b/i, `${n}: ALTER TABLE/CREATE INDEX tanpa SET LOCAL lock_timeout -- migrasi bisa menahan lock tanpa batas`);
  }
  assert.ok(diperiksa >= 1, `nol berkas diperiksa (${berkas.length} berkas >= 0037) -- penjaga ini hampa`);
});

test('⛔ 0037: customer_name, table_number, note nullable tanpa DEFAULT dan tanpa NOT NULL (expand, N-1 aman)', () => {
  const n = berkas.find((b) => b.startsWith('0037_'));
  assert.ok(n, 'migrasi 0037 tidak ditemukan');
  const sql = tanpaKomentar(readFileSync(new URL(n, DIR), 'utf8'));
  for (const kolom of ['customer_name', 'table_number', 'note']) {
    const m = new RegExp(`ADD\\s+COLUMN\\s+${kolom}\\b([^\\n]*)`, 'i').exec(sql);
    assert.ok(m, `0037 tidak menambah kolom ${kolom}`);
    assert.equal(/\bDEFAULT\b/i.test(m[1]), false, `${kolom}: DEFAULT membuat klien/server N-1 menulis nilai yang tak dikenalnya`);
    assert.equal(/\bNOT\s+NULL\b/i.test(m[1]), false, `${kolom}: NOT NULL memecah penulis N-1 yang tidak mengirim kolom ini`);
  }
});
