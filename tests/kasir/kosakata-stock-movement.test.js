'use strict';

// ⛔ PENJAGA: `stock_movement.type` yang KLIEN tulis harus ada di CHECK
// constraint SERVER.
//
// Lahir dari divergensi nyata. Klien menulis `void_return` dan `refund_return`;
// `db/migrations/0010_inventory.sql` menetapkan
// `CHECK (type IN ('sale','void','refund','receipt','adjustment','stocktake',
// 'transfer_in','transfer_out'))` — kedua nilai itu akan DITOLAK server.
//
// Kenapa tidak pernah gagal: baris `stock_movement` klien murni lokal. Jalur
// naik mengirim PERMINTAAN pembatalan, dan server menulis barisnya sendiri
// dengan kosakatanya sendiri; `stock_movement` juga tidak ada di sync rules
// jalur turun, jadi baris server tidak pernah mendarat di sini untuk
// bertabrakan.
//
// Yang membuatnya berbahaya adalah kalimat terakhir itu: `stock_movement`
// SUDAH terdaftar sebagai raw table (`apps/kasir/src/lokal/skema.ts`). Hari ia
// ditambahkan ke sync rules, dua kosakata untuk satu peristiwa menjadi laporan
// yang menghitung sebagian pengembalian dan melewatkan sisanya — tanpa satu
// pun error.
//
// Skema lokal sengaja TIDAK punya CHECK constraint (`db/local/001-initial.sql`),
// jadi SQLite tidak akan menangkapnya. Penjaga ini yang menangkapnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const MIGRASI = join(AKAR, 'db', 'migrations');
const SUMBER_KLIEN = join(AKAR, 'apps', 'kasir', 'src');

/** Nilai yang CHECK constraint server izinkan untuk `stock_movement.type`. */
function kosakataServer() {
  for (const nama of readdirSync(MIGRASI).sort()) {
    const isi = readFileSync(join(MIGRASI, nama), 'utf8');
    const tabel = /CREATE TABLE stock_movement[\s\S]*?\n\);/.exec(isi);
    if (tabel === null) continue;
    const cek = /type\s+text\s+NOT NULL\s+CHECK\s*\(type IN \(([^)]*)\)\)/.exec(tabel[0]);
    if (cek === null) continue;
    return new Set([...cek[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  }
  return new Set();
}

function berkasKlien(dir) {
  const hasil = [];
  for (const nama of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, nama.name);
    if (nama.isDirectory()) {
      if (nama.name === 'node_modules' || nama.name === 'dist') continue;
      hasil.push(...berkasKlien(p));
      continue;
    }
    if (/\.tsx?$/.test(nama.name)) hasil.push(p);
  }
  return hasil;
}

test('penjaga benar-benar membaca CHECK constraint — bukan hijau karena kosong', () => {
  const sah = kosakataServer();
  assert.ok(sah.size >= 5, `hanya ${sah.size} nilai terbaca; parser DDL rusak?`);
  for (const n of ['sale', 'void', 'refund', 'adjustment', 'stocktake']) {
    assert.ok(sah.has(n), `nilai inti "${n}" tidak terbaca dari migrasi`);
  }
});

test('⛔ setiap `type` yang klien tulis ke stock_movement dikenal server', () => {
  const sah = kosakataServer();

  // Berkas yang benar-benar menulis ke `stock_movement`, dan literal string
  // yang muncul di sekitarnya. Dipindai per berkas supaya pesannya menyebut
  // tempatnya.
  const asing = [];
  for (const f of berkasKlien(SUMBER_KLIEN)) {
    const isi = readFileSync(f, 'utf8');
    if (!isi.includes('INSERT INTO stock_movement')) continue;

    // Literal yang BERBENTUK nilai type: huruf kecil, garis bawah, dan
    // menyerupai salah satu kosakata yang dikenal atau turunannya.
    for (const m of isi.matchAll(/'([a-z]+(?:_[a-z]+)*)'/g)) {
      const nilai = m[1];
      // Hanya yang terlihat seperti kosakata type: dikenal, atau varian
      // ber-akhiran dari yang dikenal (`refund_return` dari `refund`).
      const menyerupai = [...sah].some((k) => nilai === k || nilai.startsWith(`${k}_`));
      if (!menyerupai) continue;
      if (!sah.has(nilai)) asing.push(`${f.slice(AKAR.length + 1)}: '${nilai}'`);
    }
  }

  assert.deepEqual(
    [...new Set(asing)],
    [],
    'Nilai `stock_movement.type` yang server TOLAK:\n  ' + [...new Set(asing)].join('\n  ')
  );
});
