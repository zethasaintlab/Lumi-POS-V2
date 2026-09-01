import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: setiap `var(--x)` tanpa fallback wajib punya definisinya.
 *
 * ## ⛔ Cacat yang melahirkannya
 *
 * `apps/kasir/src/kasir.css` memakai DELAPAN nama token yang tidak pernah ada
 * di sistem ini: `--touch-target`, `--text`, `--text-muted`, `--radius-md`,
 * `--radius-lg`, `--space-5`, `--overlay`, `--weight-semibold`. Semuanya nama
 * yang tampak masuk akal — mereka konvensi sistem desain LAIN.
 *
 * CSS menjawab nama yang tidak terdefinisi dengan MEMBUANG seluruh
 * deklarasinya. Tanpa peringatan konsol, tanpa gaya rusak yang mencolok, tanpa
 * satu pun test merah. Yang hilang antara lain: latar gelap dialog
 * (transparan sepenuhnya), sudut membulat kartu produk, peredaman teks
 * sekunder, dan penegakan target sentuh 44px di lima selektor — aturan design
 * system #3, yang selama ini dikira berlaku.
 *
 * Ini kelas cacat yang sama dengan "test hijau karena hampa" yang F3 temukan,
 * dipindahkan ke CSS: yang salah tidak menghasilkan kegagalan, ia menghasilkan
 * KETIADAAN.
 *
 * ## Batas yang dinyatakan
 *
 * Ia memeriksa KEBERADAAN nama, bukan kepantasan nilainya. `var(--x, nilai)`
 * dengan fallback sengaja dilewatkan — fallback adalah pernyataan sadar bahwa
 * nama itu boleh tidak ada, dan `--chip`/`--kat-*` disuntikkan lewat style
 * inline saat render.
 */

const AKAR = new URL('../../', import.meta.url).pathname;

/** Prefiks yang disuntikkan saat runtime lewat `style={{ … }}`, bukan di CSS. */
const RUNTIME = /^--(chip|stat)/;

/* ⛔ Komentar DIBUANG sebelum dipindai. Berkas ini sendiri menyebut
   `var(--x)` di dalam komentar penjelas, dan penjaga yang menghitungnya
   melaporkan token karangan — penjaga yang menandai kode benar akan dimatikan
   orang berikutnya. Pelajaran yang sama sudah dibayar penjaga satu-sumber
   omzet. */
function tanpaKomentar(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function kumpulkanDefinisi() {
  const def = new Set();
  const sumber = [join(AKAR, 'ds-bundle/tokens'), join(AKAR, 'packages/ds')];
  for (const dir of sumber) {
    for (const nama of readdirSync(dir)) {
      if (!nama.endsWith('.css')) continue;
      const isi = readFileSync(join(dir, nama), 'utf8');
      /* ⛔ TANPA jangkar awal baris: `:root { --overlay: … }` yang ditulis
         satu baris tidak akan cocok, dan token yang BENAR-BENAR terdefinisi
         akan dilaporkan hilang. */
      for (const m of tanpaKomentar(isi).matchAll(/(--[a-z0-9-]+)\s*:/g)) def.add(m[1]);
    }
  }
  // `ds-bundle/components.css` mendefinisikan beberapa token di dalam selektor.
  const komponen = readFileSync(join(AKAR, 'ds-bundle/components.css'), 'utf8');
  for (const m of tanpaKomentar(komponen).matchAll(/(--[a-z0-9-]+)\s*:/g)) def.add(m[1]);
  return def;
}

function berkasCss(dir, hasil = []) {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) {
      if (/node_modules|dist|ds-bundle/.test(p)) continue;
      berkasCss(p, hasil);
    } else if (p.endsWith('.css')) {
      hasil.push(p);
    }
  }
  return hasil;
}

test('setiap var(--token) tanpa fallback punya definisinya', () => {
  const def = kumpulkanDefinisi();
  const berkas = [...berkasCss(join(AKAR, 'apps')), join(AKAR, 'packages/ds/lumi.css')];
  const hilang = [];

  for (const f of berkas) {
    const isi = tanpaKomentar(readFileSync(f, 'utf8'));
    for (const m of isi.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
      const nama = m[1];
      if (m[2] || def.has(nama) || RUNTIME.test(nama)) continue;
      hilang.push(`${f.slice(AKAR.length)}: ${nama}`);
    }
  }

  assert.deepEqual(
    [...new Set(hilang)],
    [],
    'Token berikut dipakai tanpa fallback dan tidak terdefinisi di mana pun. ' +
      'CSS akan MEMBUANG deklarasinya diam-diam:\n  ' +
      [...new Set(hilang)].join('\n  ')
  );
});
