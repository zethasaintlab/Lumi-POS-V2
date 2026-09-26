import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NODES } from '../../packages/ds/ikon-data.ts';
import { NAMA_MOCKUP, PETA_BUNDLE, iconNames } from '../../packages/ds/ikon-peta.ts';

/**
 * Penjaga Task 6 — set ikon Lucide 0.468.0 apa adanya, tanpa dependency npm.
 *
 * ## Kenapa dua berkas `.ts` terpisah, bukan langsung `ikon.tsx`
 *
 * `packages/ds/ikon.tsx` merender `<svg>` lewat `createElement`, dan
 * ekstensinya `.tsx`. Node MENOLAK mengimpor `.tsx` sama sekali, terbukti
 * (dicoba sengaja saat menulis penjaga ini): baik lewat `import()` polos
 * maupun lewat `--experimental-strip-types`, atas berkas `.tsx` sekosong
 * `interface Foo { name: string }` (tanpa JSX sama sekali) — keduanya gagal
 * (`ERR_UNKNOWN_FILE_EXTENSION` / `SyntaxError: Unexpected identifier`).
 * Data yang test ini perlu baca karena itu hidup di `ikon-data.ts` (node
 * mentah) dan `ikon-peta.ts` (nama mockup + `PETA_BUNDLE` + `iconNames`) —
 * keduanya `.ts` biasa, diimpor lewat type-stripping bawaan Node 24.7, tanpa
 * flag apa pun. § (e) di bawah karena itu membaca `ikon.tsx` sebagai TEKS,
 * pola yang sama dipakai `tests/backoffice/navigasi.test.js` atas
 * `ds-bundle/components/forms/Icon.jsx`.
 */

const AKAR = join(import.meta.dirname, '..', '..');

const UI_KITS = ['kasir', 'order', 'backoffice'].map((nama) =>
  join(AKAR, 'docs/referensi-visual/sumber/ui_kits', nama, 'index.html'),
);

// Dua nama Lucide-react yang dipakai mockup adalah ALIAS lama, diresolusi
// dengan membaca ekspor sungguhan di `lucide-react@0.468.0`
// `dist/esm/lucide-react.js` (lihat kepala `ikon-peta.ts`), bukan ditebak
// dari ejaan — kebab harfiah dari nama alias ini (`bar-chart-3`,
// `pause-circle`) BUKAN nama berkas Lucide yang sungguhan ada.
const ALIAS_MOCKUP = {
  BarChart3: 'chart-column',
  PauseCircle: 'circle-pause',
};

function pascalKeKebab(nama) {
  if (nama in ALIAS_MOCKUP) return ALIAS_MOCKUP[nama];
  return nama
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2') // "Clock3" -> "Clock-3", "Trash2" -> "Trash-2"
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function parseNamaMockup() {
  const semua = new Set();
  for (const berkas of UI_KITS) {
    const teks = readFileSync(berkas, 'utf8');
    const m = teks.match(/import\s*\{([\s\S]*?)\}\s*from\s*"lucide-react";/);
    assert.ok(m, `impor lucide-react tidak ditemukan di ${berkas}`);
    const nama = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(nama.length > 0, `daftar impor kosong di ${berkas}`);
    for (const n of nama) semua.add(n);
  }
  return semua;
}

test('(a) 50 nama mockup, semuanya ada di iconNames', () => {
  const namaPascal = parseNamaMockup();
  assert.equal(namaPascal.size, 50, `jumlah nama mockup unik harus 50, dapat ${namaPascal.size}`);

  const kebabSet = new Set([...namaPascal].map(pascalKeKebab));
  assert.equal(kebabSet.size, 50, 'konversi kebab menghasilkan duplikat — periksa ALIAS_MOCKUP');

  // Kebab hasil parse mockup harus SAMA PERSIS dengan NAMA_MOCKUP di ikon-peta.ts,
  // bukan cuma superset/subset — keduanya sumber independen untuk data yang sama.
  assert.deepEqual([...kebabSet].sort(), [...NAMA_MOCKUP].sort());

  for (const kebab of kebabSet) {
    assert.ok(iconNames.includes(kebab), `"${kebab}" (dari mockup) tidak ada di iconNames`);
  }
});

test('(b) node ikon-data.ts sama persis dengan fixture nodes.json', () => {
  const fixture = JSON.parse(
    readFileSync(join(AKAR, 'tests/fixture/lucide-0.468.0/nodes.json'), 'utf8'),
  );
  const namaFixture = Object.keys(fixture);
  assert.ok(namaFixture.length >= 77, `fixture harus punya >= 77 ikon, dapat ${namaFixture.length}`);

  for (const nama of namaFixture) {
    assert.ok(nama in NODES, `"${nama}" ada di fixture tapi tidak di NODES ikon-data.ts`);
    assert.deepEqual(
      NODES[nama],
      fixture[nama],
      `node "${nama}" di ikon-data.ts berbeda dari fixture nodes.json`,
    );
  }
});

test('(c) setiap entri PETA_BUNDLE menunjuk nama di nodes.json; ke-48 nama bundle ada di iconNames', () => {
  const fixture = JSON.parse(
    readFileSync(join(AKAR, 'tests/fixture/lucide-0.468.0/nodes.json'), 'utf8'),
  );
  const namaBundle = Object.keys(PETA_BUNDLE);
  assert.equal(namaBundle.length, 48, `PETA_BUNDLE harus punya 48 entri, dapat ${namaBundle.length}`);

  for (const [namaBundleSatu, target] of Object.entries(PETA_BUNDLE)) {
    assert.ok(
      target in fixture,
      `PETA_BUNDLE["${namaBundleSatu}"] menunjuk "${target}", tapi itu tidak ada di nodes.json`,
    );
  }

  for (const namaBundleSatu of namaBundle) {
    assert.ok(iconNames.includes(namaBundleSatu), `nama bundle "${namaBundleSatu}" tidak ada di iconNames`);
  }
});

test('(d) setiap nama di iconNames punya >= 1 node', () => {
  assert.ok(iconNames.length > 0, 'iconNames kosong — penjaga ini tidak memindai apa pun');
  for (const nama of iconNames) {
    const kebab = nama in PETA_BUNDLE ? PETA_BUNDLE[nama] : nama;
    const nodes = NODES[kebab];
    assert.ok(Array.isArray(nodes) && nodes.length >= 1, `"${nama}" (-> "${kebab}") tidak punya node`);
  }
});

test('(e) atribut SVG induk: viewBox, fill, stroke, cap/join, stroke-width bawaan 2', () => {
  const sumber = readFileSync(join(AKAR, 'packages/ds/ikon.tsx'), 'utf8');
  assert.match(sumber, /viewBox:\s*['"]0 0 24 24['"]/);
  assert.match(sumber, /fill:\s*['"]none['"]/);
  assert.match(sumber, /stroke:\s*['"]currentColor['"]/);
  assert.match(sumber, /strokeLinecap:\s*['"]round['"]/);
  assert.match(sumber, /strokeLinejoin:\s*['"]round['"]/);
  assert.match(sumber, /strokeWidth\s*=\s*2\b/, 'stroke-width bawaan harus 2');
  assert.match(sumber, /size\s*=\s*20\b/, 'size bawaan harus 20');
  assert.match(sumber, /['"]aria-hidden['"]:\s*['"]true['"]/);
});

test('node fixture tidak membawa atribut `key` Lucide', () => {
  const fixture = JSON.parse(
    readFileSync(join(AKAR, 'tests/fixture/lucide-0.468.0/nodes.json'), 'utf8'),
  );
  for (const [nama, nodes] of Object.entries(fixture)) {
    for (const [, attrs] of nodes) {
      assert.ok(!('key' in attrs), `node "${nama}" masih membawa atribut key Lucide`);
    }
  }
});
