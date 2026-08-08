'use strict';

// T10 -- menegakkan injeksi terhadap KODE, bukan terhadap niat.
//
// `CLAUDE.md`: "Lapisan sync ditulis dengan waktu, keacakan, dan I/O
// di-inject sebagai dependensi -- prasyarat DST, dan retrofitnya mahal."
//
// Satu `Date.now()` yang menyelinap masuk membuat seluruh paket ini tidak
// dapat diputar ulang, dan kegagalan property test berubah dari "seed 20260808
// gagal di putaran 41" menjadi "kadang merah". Cerminan pemeriksa yang sama
// di tests/dst.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'packages', 'sync-client', 'src');

// Komentar dilucuti LEBIH DULU.
//
// Pemeriksa serupa di tests/dst pernah gagal karena komentarnya sendiri
// menyebut `Date.now()` untuk menjelaskan kenapa itu dilarang -- pemeriksa
// yang tersandung pada penjelasannya sendiri.
function lucutiKomentar(isi) {
  return isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const TERLARANG = [
  ['Date.now(', 'waktu harus di-inject lewat `now()` di RelayDeps'],
  // `new Date()` TANPA argumen membaca jam sistem, sama saja dengan
  // `Date.now()`. `new Date(x)` dengan argumen boleh -- ia hanya mengubah
  // bentuk stempel waktu yang SUDAH di-inject, dan relay memakainya untuk
  // menulis `last_attempt_at`.
  ['new Date()', 'membaca jam sistem; pakai `new Date(now())`'],
  ['Math.random(', 'keacakan harus di-inject'],
  ['fetch(', 'jaringan harus lewat port `kirim`'],
  ["require('node:fs')", 'tidak boleh menyentuh berkas'],
  ['from \'node:fs\'', 'tidak boleh menyentuh berkas'],
  ['setTimeout(', 'penjadwalan milik pemanggil, bukan modul ini'],
  ['setInterval(', 'penjadwalan milik pemanggil, bukan modul ini'],
];

test('tidak ada waktu, keacakan, I/O, atau penjadwalan langsung di packages/sync-client', () => {
  const berkas = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  assert.ok(berkas.length >= 5, `hanya ${berkas.length} berkas ditemukan -- pemeriksa ini mungkin salah folder`);

  const pelanggaran = [];
  for (const f of berkas) {
    const isi = lucutiKomentar(fs.readFileSync(path.join(SRC, f), 'utf8'));
    for (const [pola, alasan] of TERLARANG) {
      if (isi.includes(pola)) pelanggaran.push(`${f}: ${pola} -- ${alasan}`);
    }
  }

  assert.deepEqual(pelanggaran, [], `pelanggaran injeksi:\n${pelanggaran.join('\n')}`);
});

// Jangkar: buktikan pemeriksa di atas BENAR-BENAR menangkap sesuatu. Tanpa
// ini, `lucutiKomentar` yang terlalu rakus (mis. melucuti seluruh berkas)
// membuat test di atas hijau selamanya tanpa memeriksa apa pun.
test('pemeriksa menangkap pelanggaran bila ada (kalau tidak, ia hampa)', () => {
  const contoh = lucutiKomentar(`
    // Date.now() di komentar tidak boleh dihitung
    export function x() { return Date.now(); }
  `);
  assert.ok(contoh.includes('Date.now('), 'pemeriksa gagal melihat pelanggaran yang nyata');
  assert.equal(
    lucutiKomentar('// Date.now()\n').includes('Date.now('),
    false,
    'komentar seharusnya sudah dilucuti'
  );
});

test('index.ts mengekspor permukaan publik yang dipakai test', async () => {
  const modul = await import('../../packages/sync-client/src/index.ts');
  for (const nama of [
    'enqueue',
    'ENTITY_TYPES',
    'kirimBatch',
    'pulihkanSetelahMati',
    'klasifikasi',
    'jedaBackoffMs',
    'sudahJatuhTempo',
    'BATAS_PERCOBAAN_GAGAL',
    'BATAS_BATCH',
  ]) {
    assert.ok(modul[nama] !== undefined, `index.ts harus mengekspor ${nama}`);
  }
});
