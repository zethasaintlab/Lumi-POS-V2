'use strict';

// F4 — profil printer sebagai DATA (`ERD:445`), di atas SQLite sungguhan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/cetak/profil.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  return {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
  };
}

function tulisProfil(db, p) {
  db.sqlite.exec(`
    INSERT INTO printer_profile
      (id, name, paper_width_mm, chars_per_line, codepage, has_cutter,
       init_command, cut_command, drawer_command, image_support)
    VALUES ('${p.id}','${p.name}',${p.paper ?? 80},${p.chars ?? 48},'cp437',${p.cutter ?? 1},
            '1B 40','1D 56 00','1B 70 00 19 FA',0)
  `);
}

test('perangkat tanpa profil tersinkron tetap punya baseline', async () => {
  // Daftar kosong di layar uji cetak adalah jalan buntu yang tidak dapat
  // diselesaikan kasir sendiri.
  const { bacaProfilPrinter, PROFIL_BASELINE } = await import(MOD);
  const hasil = await bacaProfilPrinter(dbSungguhan());
  assert.equal(hasil.length, PROFIL_BASELINE.length);
});

test('profil TERSINKRON muncul, dan baseline tetap ada di belakangnya', async () => {
  const { bacaProfilPrinter } = await import(MOD);
  const db = dbSungguhan();
  tulisProfil(db, { id: 'epson-t82', name: 'Epson TM-T82' });

  const hasil = await bacaProfilPrinter(db);
  assert.equal(hasil[0].id, 'epson-t82', 'profil merchant harus di urutan pertama');
  assert.ok(hasil.some((p) => p.id === 'baseline-58'));
  assert.ok(hasil.some((p) => p.id === 'baseline-80'));
});

test('⛔ profil merchant ber-id sama MENIMPA baseline', async () => {
  // Bila merchant menambahkan baris ber-id `baseline-58`, itu koreksi yang
  // disengaja — mungkin printer 58mm mereka justru punya pemotong.
  const { bacaProfilPrinter } = await import(MOD);
  const db = dbSungguhan();
  tulisProfil(db, { id: 'baseline-58', name: 'Termal 58 (dikoreksi)', paper: 58, chars: 32, cutter: 1 });

  const hasil = await bacaProfilPrinter(db);
  const cocok = hasil.filter((p) => p.id === 'baseline-58');
  assert.equal(cocok.length, 1, 'baseline duplikat tidak disingkirkan');
  assert.equal(cocok[0].nama, 'Termal 58 (dikoreksi)');
  assert.equal(cocok[0].hasCutter, true, 'koreksi merchant tidak berlaku');
});

test('⛔ chars_per_line kosong TIDAK menjadi nol', async () => {
  // Lebar nol membuat setiap baris struk dipotong habis — struk keluar kosong
  // dan tidak ada yang menjelaskan kenapa.
  const { bacaProfilPrinter } = await import(MOD);
  const db = dbSungguhan();
  db.sqlite.exec(`
    INSERT INTO printer_profile (id, name, has_cutter, image_support)
    VALUES ('minim','Profil Minim',0,0)
  `);

  const hasil = await bacaProfilPrinter(db);
  const minim = hasil.find((p) => p.id === 'minim');
  assert.ok(minim.charsPerLine > 0, `charsPerLine = ${minim.charsPerLine}`);
  assert.equal(minim.charsPerLine, 32);
});

test('⛔ has_cutter dibaca eksplisit terhadap 1, bukan truthiness', async () => {
  // `boolean` server mendarat sebagai INTEGER. Driver yang mengembalikan
  // `'0'` sebagai string akan terbaca `true` bila hanya dicek truthy — dan
  // perintah potong dikirim ke printer yang tidak punya pemotong.
  const { bacaProfilPrinter } = await import(MOD);
  const db = dbSungguhan();
  tulisProfil(db, { id: 'tanpa-cutter', name: 'Tanpa Cutter', cutter: 0 });

  const hasil = await bacaProfilPrinter(db);
  const p = hasil.find((x) => x.id === 'tanpa-cutter');
  assert.equal(p.hasCutter, false);
  assert.equal(typeof p.hasCutter, 'boolean');
});

test('tabel yang belum ada tidak menghilangkan kemampuan cetak', async () => {
  // Perangkat lama yang skemanya belum bermigrasi.
  const { bacaProfilPrinter, PROFIL_BASELINE } = await import(MOD);
  const dbTanpaTabel = {
    async getAll() {
      throw new Error('no such table: printer_profile');
    },
  };
  const hasil = await bacaProfilPrinter(dbTanpaTabel);
  assert.equal(hasil.length, PROFIL_BASELINE.length);
});

test('profil tersinkron benar-benar dapat dipakai merender', async () => {
  // Yang diuji bukan bentuk objeknya, melainkan bahwa perintah dari DATABASE
  // sampai ke byte — itu seluruh alasan tabelnya diturunkan.
  const { bacaProfilPrinter, dokumenUjiCetak } = await import(MOD);
  const { renderEscPos } = await import('../../apps/kasir/src/cetak/escpos.ts');
  const db = dbSungguhan();
  db.sqlite.exec(`
    INSERT INTO printer_profile
      (id, name, paper_width_mm, chars_per_line, codepage, has_cutter,
       init_command, cut_command, drawer_command, image_support)
    VALUES ('khusus','Printer Khusus',80,48,'cp437',1,
            '1B 40','1D 56 41','1B 70 01 32 32',0)
  `);

  const profil = (await bacaProfilPrinter(db)).find((p) => p.id === 'khusus');
  const hex = [...renderEscPos(dokumenUjiCetak(profil), profil)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');

  assert.ok(hex.includes('1d 56 41'), 'perintah potong dari database tidak dipakai');
});
