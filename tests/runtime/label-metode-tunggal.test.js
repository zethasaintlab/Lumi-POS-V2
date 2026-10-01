'use strict';

// ⛔ G-LABEL — SATU peta label metode pembayaran untuk layar, bukan satu per layar.
//
// `packages/domain/src/metode-tampilan.ts` memegang `LABEL_METODE` dan
// `labelMetode(kode, provider?)`. Transfer (`other` + `bank_transfer`) tampil
// "Transfer" di SETIAP laporan (keputusan user P1, 28 September 2026): satu
// salinan lokal yang lupa kunci `transfer` menampilkan kode mentah atau
// "Lainnya", dan uang bank hilang dari mata pemilik.
//
// Task 8 memperluas pindaian ke `apps/kasir/src/layar`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIPINDAI = ['apps/backoffice/src', 'apps/hp/src'];

function berkas(dir) {
  const hasil = [];
  for (const e of fs.readdirSync(path.join(AKAR, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkas(rel));
    else if (/\.(ts|tsx)$/.test(e.name)) hasil.push(rel);
  }
  return hasil;
}

const SEMUA = DIPINDAI.flatMap(berkas);

const PETA_LOKAL = /(?:\bcard_edc|\bqris_static)\s*:\s*['"`]/;
const DEKLARASI = /(?:\b(?:const|let|var)\s+LABEL_METODE\b|\bfunction\s+labelMetode\b|\b(?:const|let|var)\s+labelMetode\s*=)/;

test('⛔ G-LABEL: tidak ada peta label metode lokal di apps/backoffice dan apps/hp', () => {
  assert.ok(SEMUA.length >= 20, `hanya ${SEMUA.length} berkas dipindai — pindaian kosong?`);
  const pelanggar = [];
  for (const rel of SEMUA) {
    const teks = fs.readFileSync(path.join(AKAR, rel), 'utf8');
    if (PETA_LOKAL.test(teks)) pelanggar.push(`${rel}: objek literal label metode (card_edc:/qris_static: bernilai string)`);
    if (DEKLARASI.test(teks)) pelanggar.push(`${rel}: deklarasi LABEL_METODE/labelMetode — impor dari packages/domain/src/metode-tampilan.ts`);
  }
  assert.deepEqual(pelanggar, [], `salinan peta label metode:\n${pelanggar.join('\n')}`);
});
