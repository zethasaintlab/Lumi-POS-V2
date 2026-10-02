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
// `layar/Pembayaran.tsx` (K-06) tidak lagi pengecualian (Task 8): `NAMA_METODE` dihapus,
// nama bagian dari `labelMetode` domain.
const PENGECUALIAN = new Set(['apps/kasir/src/cetak/metode.ts']);

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

// Posisi KUNCI objek (awal baris, sesudah `{` atau `,`), bukan ternary `? 'card_edc' : 'x'`.
// Kunci bertanda kutip termasuk: `{ 'card_edc': 'Kartu' }` lolos dari pola tanpa kutip.
const PETA_LOKAL = /(?:^|[{,])\s*['"]?\b(?:card_edc|qris_static)\b['"]?\s*:\s*['"`]/m;
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

test('pindaian G-LABEL benar-benar menangkap pola yang dilarang (penjaga tidak hampa)', () => {
  assert.ok(PETA_LOKAL.test("const x = { card_edc: 'Kartu' }"));
  assert.ok(PETA_LOKAL.test('{ qris_static: "QRIS" }'));
  assert.ok(PETA_LOKAL.test("{ 'card_edc': 'Kartu' }"), 'kunci bertanda kutip tunggal lolos dari pindaian');
  assert.ok(PETA_LOKAL.test('{ "qris_static": "QRIS" }'), 'kunci bertanda kutip ganda lolos dari pindaian');
  assert.equal(PETA_LOKAL.test('m.card_edc === 1'), false);
  assert.equal(PETA_LOKAL.test("const m = k ? 'card_edc' : 'other';"), false, 'ternary bukan peta label');
  assert.ok(PETA_LOKAL.test("const x = {\n  'qris_static': 'QRIS',\n}"), 'kunci di baris sendiri lolos');
  assert.ok(DEKLARASI.test('export const LABEL_METODE: Record<string, string> = {'));
  assert.ok(DEKLARASI.test('export function labelMetode(kode: string) {'));
  assert.equal(DEKLARASI.test("import { labelMetode } from 'x'"), false);
});

test('⛔ layar yang menampilkan SATU baris payment meneruskan provider ke labelMetode', () => {
  // B-03 (Detail.tsx) menampilkan `payments[]` per baris, bukan agregat yang sudah
  // dilipat server; tanpa `provider`, transfer terbaca "Lainnya".
  const teks = fs.readFileSync(path.join(AKAR, 'apps/backoffice/src/penjualan/Detail.tsx'), 'utf8');
  assert.match(
    teks,
    /labelMetode\(\s*p\.method\s*,\s*p\.provider\s*\)/,
    'Detail.tsx tidak meneruskan p.provider ke labelMetode -- transfer tampil sebagai Lainnya'
  );
});
