'use strict';

// ⛔ G-LABEL — nama metode pembayaran dieja di SATU tempat:
// `packages/domain/src/metode-tampilan.ts`.
//
// ## Kenapa penjaga ini lahir bersama Transfer (PR 2B Task 7)
//
// Syarat user atas P1: laporan per metode menampilkan "Transfer", tidak pernah
// "Lainnya" — uang bank tidak boleh tersembunyi dari pemilik. Sebelum task itu
// `apps/backoffice` punya TIGA peta label (domain, `penjualan/b04.ts`,
// `laporan/Pembayaran.tsx`). Menambahkan "Transfer" ke satu peta dan lupa dua
// lainnya tidak menghasilkan error apa pun: B-19 (rekonsiliasi) tetap menyebut
// uang transfer "Lainnya" persis di layar tempat pemilik mencocokkannya dengan
// mutasi rekening.
//
// Task 8 memperluas pindaian ke `apps/kasir/src/layar`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const LINGKUP = ['apps/backoffice/src', 'apps/hp/src'];

function berkas(dir, hasil = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx)$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

// Komentar dibuang lebih dulu: penjelasan yang menyebut `card_edc: 'x'` bukan peta.
function tanpaKomentar(teks) {
  return teks.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const POLA_KUNCI = /['"]?\b(?:card_edc|qris_static)\b['"]?\s*:\s*['"`]/;
const POLA_DEKLARASI = [
  /\b(?:const|let|var)\s+LABEL_METODE\b/,
  /\b(?:const|let|var)\s+labelMetode\b/,
  /\bfunction\s+labelMetode\b/,
];

test('⛔ G-LABEL: tidak ada peta label metode lokal di apps/backoffice dan apps/hp', () => {
  const semua = LINGKUP.flatMap((d) => berkas(path.join(AKAR, d)));
  assert.ok(
    semua.length >= 20,
    `hanya ${semua.length} berkas dipindai -- pindaian kosong bukan bukti apa pun ("nol baris, bukan error")`
  );

  const pelanggaran = [];
  for (const f of semua) {
    const teks = tanpaKomentar(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(AKAR, f);
    if (POLA_KUNCI.test(teks)) {
      pelanggaran.push(`${rel}: objek literal memuat kunci card_edc/qris_static bernilai string (peta label)`);
    }
    for (const pola of POLA_DEKLARASI) {
      if (pola.test(teks)) pelanggaran.push(`${rel}: mendeklarasikan ${pola.source}`);
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    `Nama metode dieja di luar packages/domain/src/metode-tampilan.ts:\n  ${pelanggaran.join('\n  ')}`
  );
});

test('pindaian G-LABEL benar-benar menangkap pola yang dilarang (penjaga tidak hampa)', () => {
  assert.ok(POLA_KUNCI.test("const x = { card_edc: 'Kartu' }"));
  assert.ok(POLA_KUNCI.test("{ qris_static: \"QRIS\" }"));
  assert.ok(POLA_KUNCI.test("{ 'card_edc': 'Kartu' }"), 'kunci bertanda kutip tunggal lolos dari pindaian');
  assert.ok(POLA_KUNCI.test('{ "qris_static": "QRIS" }'), 'kunci bertanda kutip ganda lolos dari pindaian');
  assert.equal(POLA_KUNCI.test('m.card_edc === 1'), false);
  assert.ok(POLA_DEKLARASI[0].test("export const LABEL_METODE: Record<string, string> = {"));
  assert.ok(POLA_DEKLARASI[2].test('export function labelMetode(kode: string) {'));
  assert.equal(POLA_DEKLARASI[2].test("import { labelMetode } from 'x'"), false);
});

test('⛔ layar yang menampilkan SATU baris payment meneruskan provider ke labelMetode', () => {
  // B-03 (Detail.tsx) menampilkan `payments[]` per baris, bukan agregat yang
  // sudah dilipat server -- tanpa `provider`, transfer terbaca "Lainnya".
  // Tidak ada tes komponen untuk layar back-office, jadi yang dijaga adalah
  // pemanggilnya.
  const teks = tanpaKomentar(
    fs.readFileSync(path.join(AKAR, 'apps/backoffice/src/penjualan/Detail.tsx'), 'utf8')
  );
  assert.match(
    teks,
    /labelMetode\(\s*p\.method\s*,\s*p\.provider\s*\)/,
    'Detail.tsx tidak meneruskan p.provider ke labelMetode -- transfer tampil sebagai Lainnya'
  );
});
