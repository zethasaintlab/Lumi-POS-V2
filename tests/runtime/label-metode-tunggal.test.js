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
// Peta berbentuk `switch`/`case` dan `Map` — sabotase independen S16b: salinan yang sama
// persis, tetapi bukan objek literal, lolos dari PETA_LOKAL. Diikat pada KODE metode yang
// langsung diikuti string tampilan (`case 'card_edc': return 'Kartu'`), bukan pada `switch`
// apa pun: switch atas kode metode untuk perilaku (mis. `return null`/ekspresi) tidak ditandai.
const KODE = "(?:cash|card_edc|qris_static|qris_dynamic|other)";
// Fallthrough ikut: `case 'qris_dynamic':\n case 'qris_static': return 'QRIS'`; dan penugasan label
// (`case 'card_edc': label = 'Kartu'; break;`). Hanya penugasan ke peubah berbau label yang ditandai.
const PETA_SWITCH = new RegExp(
  "\\bcase\\s+['\"]\\b(?:card_edc|qris_static)\\b['\"]\\s*:(?:\\s*case\\s+['\"]\\w+['\"]\\s*:)*\\s*(?:\\{\\s*)?(?:return\\s+|(?:label|nama|teks|text)\\w*\\s*=\\s*)['\"`]"
);
// Pasangan [kode, string TAMPILAN]. Larik kode biasa (`['card_edc', 'qris_static', 'other']`) bukan peta:
// elemen kedua yang juga kode metode dikecualikan.
const PETA_MAP = new RegExp(`\\[\\s*['"]\\b(?:card_edc|qris_static)\\b['"]\\s*,\\s*(?!['"\`]${KODE}['"\`])['"\`]`);
const DEKLARASI = /(?:\b(?:const|let|var)\s+LABEL_METODE\b|\bfunction\s+labelMetode\b|\b(?:const|let|var)\s+labelMetode\s*=)/;

test('⛔ G-LABEL: tidak ada peta label metode lokal di apps/backoffice, apps/hp, apps/kasir', () => {
  assert.ok(SEMUA.length >= 60, `hanya ${SEMUA.length} berkas dipindai — pindaian kosong?`);
  const pelanggar = [];
  for (const rel of SEMUA) {
    const teks = fs.readFileSync(path.join(AKAR, rel), 'utf8');
    if (PETA_LOKAL.test(teks)) pelanggar.push(`${rel}: objek literal label metode (card_edc:/qris_static: bernilai string)`);
    if (PETA_SWITCH.test(teks)) pelanggar.push(`${rel}: peta label metode berbentuk switch/case (case 'card_edc': return '…')`);
    if (PETA_MAP.test(teks)) pelanggar.push(`${rel}: peta label metode berbentuk Map (['card_edc', '…'])`);
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
  assert.ok(PETA_SWITCH.test("switch (m) { case 'card_edc': return 'Kartu / EDC'; default: return 'x'; }"), 'peta switch/case lolos dari pindaian (S16b)');
  assert.ok(PETA_SWITCH.test("case 'qris_static':\n    return \"QRIS\";"), 'case dengan return di baris berikutnya lolos');
  assert.ok(PETA_SWITCH.test("case 'qris_static': { return `QRIS`; }"), 'case berkurung kurawal lolos');
  assert.ok(PETA_MAP.test("new Map([['card_edc', 'Kartu'], ['other', 'Lainnya']])"), 'peta Map lolos dari pindaian');
  // Bukan label: switch untuk PERILAKU atas kode yang sama tidak boleh ditandai.
  assert.equal(PETA_SWITCH.test("switch (m) { case 'card_edc': return approvalCode.length > 0; }"), false, 'switch perilaku ditandai');
  assert.equal(PETA_SWITCH.test("case 'card_edc': return null;"), false, 'return non-string ditandai');
  assert.equal(PETA_SWITCH.test("case 'cash': return 'Tunai';"), false, 'kode lain ditandai (pindaian dipaku pada card_edc/qris_static seperti PETA_LOKAL)');
  assert.equal(PETA_MAP.test("m.get(['card_edc', x])"), false, 'pembacaan Map ditandai');
  assert.equal(PETA_MAP.test("const NON_TUNAI = ['card_edc', 'qris_static', 'other'];"), false, 'larik kode metode ditandai sebagai peta');
  assert.ok(PETA_SWITCH.test("case 'qris_dynamic':\n case 'qris_static':\n return 'QRIS';"), 'case fallthrough lolos');
  assert.ok(PETA_SWITCH.test("case 'card_edc':\n label = 'Kartu';\n break;"), 'penugasan label di case lolos');
  assert.equal(PETA_SWITCH.test("case 'card_edc':\n modus = 'edc';\n break;"), false, 'penugasan non-label ditandai');
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
