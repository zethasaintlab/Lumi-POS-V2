import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

/**
 * Penjaga Task 7 — plugin Vite `ikonLumi()` (`packages/ds/vite-ikon.ts`),
 * yang mengalihkan impor INTERNAL `ds-bundle/components/**` (Modal, AppShell,
 * StatCard, SyncIndicator, Ticket, Stepper) dari `forms/Icon.jsx` bundel ke
 * `packages/ds/ikon.tsx`.
 *
 * Dua penjaga di bawah, dan keduanya menjaga hal yang TIDAK menghasilkan satu
 * pun error saat rusak: config Vite yang lupa memasang plugin tetap membangun
 * dengan sukses — ia hanya merender ikon bundel lama (42 path gambar-ulang)
 * di komponen internal bundel, bersebelahan dengan ikon Lucide yang benar di
 * komponen lain pada layar yang sama.
 */

function telusuriBerkas(dir, cocok) {
  const hasil = [];
  const jalan = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(e.name) || e.name.startsWith('dist-')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) jalan(p);
      else if (cocok(e.name)) hasil.push(p);
    }
  };
  jalan(dir);
  return hasil;
}

/** Sepasang kurung siku SEIMBANG dimulai dari `mulai` (indeks karakter `[`
 * pertama) — dipakai untuk mengekstrak isi array `plugins: [...]` tanpa
 * bergantung pada regex yang buta terhadap array bersarang. */
function ekstrakArraySeimbang(teks, mulai) {
  let dalam = 0;
  for (let i = mulai; i < teks.length; i += 1) {
    if (teks[i] === '[') dalam += 1;
    else if (teks[i] === ']') {
      dalam -= 1;
      if (dalam === 0) return teks.slice(mulai, i + 1);
    }
  }
  return null;
}

test('(f) setiap config Vite `apps/**/vite*.config.ts` memasang ikonLumi() di `plugins`', () => {
  // Glob, BUKAN daftar tetap (Review Focus 5) — config yang lahir kelak
  // (aplikasi keempat, harness baru) harus ikut terperiksa tanpa siapa pun
  // perlu mengingat menambahkannya ke daftar ini.
  const configs = telusuriBerkas(join(AKAR, 'apps'), (nama) => /^vite.*\.config\.ts$/.test(nama));
  assert.ok(
    configs.length >= 5,
    `harus menemukan >= 5 config Vite di apps/**/vite*.config.ts, dapat ${configs.length}: ` +
      configs.map((c) => c.slice(AKAR.length + 1)).join(', '),
  );

  const bermasalah = [];
  for (const berkas of configs) {
    const isi = readFileSync(berkas, 'utf8');
    const relatif = berkas.slice(AKAR.length + 1);

    if (!/import\s*\{[^}]*\bikonLumi\b[^}]*\}\s*from\s*['"][^'"]*vite-ikon(?:\.ts)?['"]/.test(isi)) {
      bermasalah.push(`${relatif}: tidak mengimpor \`ikonLumi\` dari \`vite-ikon\``);
      continue;
    }

    const iPlugins = isi.indexOf('plugins:');
    const iBuka = iPlugins === -1 ? -1 : isi.indexOf('[', iPlugins);
    const blok = iBuka === -1 ? null : ekstrakArraySeimbang(isi, iBuka);
    if (!blok) {
      bermasalah.push(`${relatif}: tidak punya array \`plugins: [...]\` yang dapat diekstrak`);
      continue;
    }
    if (!/\bikonLumi\(\)/.test(blok)) {
      bermasalah.push(`${relatif}: array \`plugins\` tidak memanggil \`ikonLumi()\``);
    }
  }

  assert.deepEqual(
    bermasalah,
    [],
    `config Vite belum memasang ikonLumi() di plugins:\n${bermasalah.join('\n')}`,
  );
});

test('(g) nol berkas di tests/, tools/, apps/ membaca `forms/Icon.jsx` BUNDEL langsung, di luar Vite', () => {
  // Pengecualian BERNAMA, masing-masing dengan alasan — daftar yang tumbuh
  // diam-diam berhenti menjaga apa pun (lihat pola `DIKECUALIKAN` di
  // `tests/backoffice/navigasi.test.js`).
  const DIKECUALIKAN = new Set([
    // Berkas ini SENDIRI: memindai pola di bawah, tidak membacanya untuk
    // dikonsumsi.
    'tests/runtime/ikon-lucide.test.js',
    // Klaim "ikon-bundle" (`<Icon>` (42 ikon)`) mengukur FAKTA HISTORIS
    // tentang `ds-bundle/components/forms/Icon.jsx` itu SENDIRI — jumlah
    // path yang bundel vendor ini definisikan — bukan "ikon mana yang
    // dikenal untuk dirender". Plugin Task 7 tidak menyentuh isi berkas
    // vendor itu sama sekali (ia mengalihkan RESOLUSI impor, bukan
    // mengubah file di disk), jadi angkanya tetap benar selamanya. Yang
    // menjadikan `navigasi.test.js` cacat (dan bukan ini) adalah ia
    // memakai bacaan itu untuk memutuskan "ikon apa yang VALID di layar
    // kasir sungguhan" — pertanyaan yang jawabannya berubah sejak
    // `iconNames` mencakup 50 nama Lucide baru.
    'tests/runtime/klaim-registri.test.js',
  ]);

  // Path terkuota TUNGGAL (tanda kutip lurus, bukan backtick markdown) —
  // membedakan PEMAKAIAN KODE (`baca('ds-bundle/…/Icon.jsx')`,
  // `from '…/forms/Icon.jsx'`) dari SEBUTAN di komentar prosa, yang di
  // seluruh repo ini selalu ditulis dengan backtick.
  const POLA_STRING = /(['"])[^'"]*ds-bundle\/components\/forms\/Icon\.jsx\1/;
  const POLA_IMPOR = /from\s*(['"])[^'"]*forms\/Icon\.jsx\1/;

  const berkas = [
    ...telusuriBerkas(join(AKAR, 'tests'), (n) => /\.(js|mjs|ts|tsx|html)$/.test(n)),
    ...telusuriBerkas(join(AKAR, 'tools'), (n) => /\.(js|mjs|ts|tsx|html)$/.test(n)),
    ...telusuriBerkas(join(AKAR, 'apps'), (n) => /\.(js|mjs|ts|tsx|html)$/.test(n)),
  ];
  assert.ok(berkas.length > 100, `pemindaian tidak menyentuh cukup berkas (${berkas.length}) — penjaga ini hampa`);

  const ditemukan = [];
  for (const b of berkas) {
    const relatif = b.slice(AKAR.length + 1);
    if (DIKECUALIKAN.has(relatif)) continue;
    const isi = readFileSync(b, 'utf8');
    if (POLA_STRING.test(isi) || POLA_IMPOR.test(isi)) ditemukan.push(relatif);
  }

  assert.deepEqual(
    ditemukan,
    [],
    `berkas membaca/mengimpor forms/Icon.jsx BUNDEL langsung, di luar Vite: ${ditemukan.join(', ')}. ` +
      'Redirect `ikonLumi()` hanya berlaku di jalur Vite (`resolveId`); pemakai lain harus ' +
      'dialihkan ke `iconNames`/`Icon` dari `packages/ds/ikon-peta.ts`/`ikon.tsx` — lihat ' +
      'penanganan `tests/backoffice/navigasi.test.js`, atau ditambahkan ke `DIKECUALIKAN` di atas ' +
      'dengan alasan tertulis kalau memang bukan konsumen ikon.',
  );
});
