'use strict';

// ⛔ G-LABEL — SATU peta label metode pembayaran untuk layar, bukan satu per layar.
//
// `packages/domain/src/metode-tampilan.ts` memegang `LABEL_METODE` dan
// `labelMetode(kode, provider?)`. Transfer (`other` + `bank_transfer`) tampil
// "Transfer" di SETIAP laporan (keputusan user P1, 28 September 2026): satu
// salinan lokal yang lupa kunci `transfer` menampilkan kode mentah atau
// "Lainnya", dan uang bank hilang dari mata pemilik.
//
// `apps/kasir` ikut dipindai (Task 7 fix 2), kecuali `cetak/metode.ts` (label struk).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIPINDAI = ['apps/backoffice/src', 'apps/hp/src', 'apps/kasir/src'];
// Satu-satunya pengecualian: label PENDEK struk 32 kolom (`LABEL_METODE` ringkas
// "Tunai/QRIS/Kartu/Lainnya"). "Transfer" tetap datang dari domain di dalamnya.
// SEMENTARA: `layar/Pembayaran.tsx` (K-06) masih punya NAMA_METODE tanpa Transfer;
// Task 8 menambah tab Transfer dan WAJIB menghapus baris ini bersama petanya.
const PENGECUALIAN = new Set(['apps/kasir/src/cetak/metode.ts', 'apps/kasir/src/layar/Pembayaran.tsx']);

function berkas(dir) {
  const hasil = [];
  for (const e of fs.readdirSync(path.join(AKAR, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkas(rel));
    else if (/\.(ts|tsx)$/.test(e.name)) hasil.push(rel);
  }
  return hasil;
}

const SEMUA = DIPINDAI.flatMap(berkas).filter((r) => !PENGECUALIAN.has(r));

const PETA_LOKAL = /(?:\bcard_edc|\bqris_static)\s*:\s*['"`]/;
const DEKLARASI = /(?:\b(?:const|let|var)\s+LABEL_METODE\b|\bfunction\s+labelMetode\b|\b(?:const|let|var)\s+labelMetode\s*=)/;

test('⛔ G-LABEL: tidak ada peta label metode lokal di apps/backoffice, apps/hp, apps/kasir', () => {
  assert.ok(SEMUA.length >= 60, `hanya ${SEMUA.length} berkas dipindai — pindaian kosong?`);
  const pelanggar = [];
  for (const rel of SEMUA) {
    const teks = fs.readFileSync(path.join(AKAR, rel), 'utf8');
    if (PETA_LOKAL.test(teks)) pelanggar.push(`${rel}: objek literal label metode (card_edc:/qris_static: bernilai string)`);
    if (DEKLARASI.test(teks)) pelanggar.push(`${rel}: deklarasi LABEL_METODE/labelMetode — impor dari packages/domain/src/metode-tampilan.ts`);
  }
  assert.deepEqual(pelanggar, [], `salinan peta label metode:\n${pelanggar.join('\n')}`);
});
