'use strict';

// ⛔ Dua komponen `/ds-bundle` tidak boleh dirender: `CartRow` dan `ProductCard`.
//
// ## Kenapa penjaga ini ada, dan kenapa ia lahir SEBELUM dibutuhkan
//
// 1 September 2026, dalam satu hari, ENAM kali ditemukan bahwa `/ds-bundle`
// sudah mengirim komponen yang jauh lebih baik daripada yang `apps/kasir` tulis
// sendiri: `.product-card`, `.chip`, `<Icon>`, `--shadow-card`, `.stepper`,
// `<CartRow>`. Kesimpulan mudahnya — "pakai saja komponen bundle" — SALAH, dan
// sebabnya uang:
//
//   CartRow      `unitPrice * qty` — perkalian float di jalur uang
//   ProductCard  `'Rp ' + n.toLocaleString('id-ID')` — pemformat sendiri, dan
//                tanpa `−` (U+2212) untuk nilai negatif
//
// Konvensi repo ini: uang `bigint` rupiah utuh, tidak pernah float
// (`CLAUDE.md` § Konvensi data). Kedua komponen itu dirancang untuk basis kode
// yang berbeda.
//
// Bahaya ini ditemukan satu jam setelah kode yang sama ditulis. Pada butir
// keenam dari sembilan butir sapuan UI, keberuntungan itu tidak akan berulang —
// dan yang salah di sini TIDAK menghasilkan error: `28000 * 2` bekerja
// sempurna, sampai angkanya cukup besar atau cukup negatif.
//
// ## Bentuk penegakannya
//
// Penegakan UTAMA bukan test ini, melainkan `packages/ds/index.ts` yang tidak
// mengekspor keduanya — yang tidak dapat diimpor tidak dapat dipakai keliru.
// Test ini menjaga agar ekspor itu tidak dikembalikan oleh orang yang membaca
// ketiadaannya sebagai kelalaian.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const TERLARANG = ['CartRow', 'ProductCard'];

function berkasSumber() {
  const hasil = [];
  const telusuri = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('dist-')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) telusuri(p);
      else if (/\.tsx?$/.test(e.name)) hasil.push(p);
    }
  };
  for (const d of ['apps', 'packages']) telusuri(path.join(AKAR, d));
  return hasil;
}

const rel = (p) => path.relative(AKAR, p).split(path.sep).join('/');

test('⛔ `packages/ds` tidak mengekspor komponen bundle yang menyentuh uang', () => {
  const isi = fs.readFileSync(path.join(AKAR, 'packages/ds/index.ts'), 'utf8');
  // Baris ekspor, bukan penyebutan di komentar — catatan di berkas itu memang
  // menyebut kedua nama, dan itu justru yang menjelaskan ketiadaannya.
  const ekspor = isi
    .split('\n')
    .filter((b) => /^\s*export\s/.test(b))
    .join('\n');

  for (const nama of TERLARANG) {
    assert.ok(
      !new RegExp(`\\b${nama}\\b`).test(ekspor),
      `\`${nama}\` diekspor kembali dari packages/ds. Ia memformat/mengalikan ` +
        'uang sebagai `number`. Pakai KELAS-nya (`.cart-row` / `.product-card`) ' +
        'di atas markup kita, dengan `rupiah()` dari ' +
        '`packages/domain/src/uang-tampilan.ts`.'
    );
  }
});

test('⛔ tidak ada aplikasi yang mengimpor atau merender CartRow / ProductCard', () => {
  const temuan = [];
  for (const p of berkasSumber()) {
    if (rel(p) === 'packages/ds/index.ts') continue;
    const isi = fs.readFileSync(p, 'utf8');
    for (const nama of TERLARANG) {
      // Impor bernama, impor langsung dari bundle, dan pemakaian sebagai JSX.
      const pola = new RegExp(
        `(?:import[^;]*\\b${nama}\\b[^;]*from|<${nama}[\\s/>])`,
        'g'
      );
      for (const m of isi.matchAll(pola)) {
        const baris = isi.slice(0, m.index).split('\n').length;
        temuan.push(`${rel(p)}:${baris} — ${nama}`);
      }
    }
  }

  assert.deepEqual(
    temuan,
    [],
    'Komponen bundle yang menyentuh uang dipakai sebagai komponen. Pakai ' +
      'kelasnya di atas markup kita.\n  ' + temuan.join('\n  ')
  );
});

test('⛔ komponen bundle LAIN tetap boleh — penjaga ini sempit, bukan larangan menyeluruh', () => {
  // Penjaga yang melarang seluruh bundle akan dimatikan, dan yang mematikannya
  // benar: sembilan dari dua belas butir peninjauan UI ongkosnya TURUN justru
  // karena komponen bundle dipakai. Test ini membuktikan larangannya berhenti
  // pada dua nama, bukan meluas diam-diam.
  const isi = fs.readFileSync(path.join(AKAR, 'packages/ds/index.ts'), 'utf8');
  for (const nama of ['Card', 'Badge', 'Icon', 'Modal', 'Stepper', 'Switch', 'SegmentedControl', 'Chip', 'Tabs', 'Table']) {
    assert.ok(
      new RegExp(`\\b${nama}\\b`).test(isi),
      `\`${nama}\` hilang dari permukaan publik packages/ds — ia tidak menyentuh uang dan harus tetap dapat dipakai`
    );
  }
});
