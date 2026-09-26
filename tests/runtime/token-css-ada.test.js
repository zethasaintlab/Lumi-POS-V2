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

  /* ⛔ CSS aplikasi ikut menyumbang definisi, dan itu BUKAN pelonggaran.
     Yang dijaga adalah "token dipakai tanpa pernah didefinisikan DI MANA PUN";
     token lokal yang didefinisikan di berkas yang sama sah sepenuhnya —
     `--skala` di `galeri.css` contohnya, disetel per breakpoint.

     Versi pertama penjaga ini hanya membaca `packages/ds` dan bundle, jadi ia
     menandai `--skala` sebagai hantu. Penjaga yang menandai kode benar akan
     dimatikan orang berikutnya; ini kali ketiga pelajaran itu ditagih di sesi
     yang sama. */
  for (const f of berkasCss(join(AKAR, 'apps'))) {
    const isi = tanpaKomentar(readFileSync(f, 'utf8'));
    for (const m of isi.matchAll(/(--[a-z0-9-]+)\s*:/g)) def.add(m[1]);
  }
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

/**
 * Penjaga KEDUA: token skala teks yatim tidak dipakai di CSS.
 *
 * ⛔ Ia ada karena oxlint TIDAK MEMBACA BERKAS CSS. Larangan skala teks di
 * `tools/oxlint-plugins/ds-adherence.mjs` menangkap `className="t-hero"` dan
 * `var(--text-hero)` di dalam string TypeScript; ia tidak melihat satu pun
 * baris `.css`. Separuh permukaan yang dijaga tanpa penjaga adalah separuh
 * yang cacat berikutnya akan lewati.
 *
 * Ketiganya tidak dapat DIHAPUS dari `ds-bundle/tokens/typography.css` —
 * artefak vendor. Statusnya "orphan, dilarang"; tabel pemetaan di `CLAUDE.md`
 * mencatat itu sebagai keputusan, bukan kelalaian.
 */
const SKALA_YATIM = ['--text-hero', '--text-heading'];

test('token skala teks yatim tidak dipakai di CSS aplikasi', () => {
  const berkas = [...berkasCss(join(AKAR, 'apps')), join(AKAR, 'packages/ds/lumi.css')];
  const pakai = [];
  for (const f of berkas) {
    const isi = tanpaKomentar(readFileSync(f, 'utf8'));
    for (const t of SKALA_YATIM) {
      if (isi.includes(`var(${t})`)) pakai.push(`${f.slice(AKAR.length)}: ${t}`);
    }
  }
  assert.deepEqual(
    pakai,
    [],
    'Skala teks final adalah 32/20/15/13. `--t-metric` DIHAPUS (Task 4, ' +
      'kampanye "Hidupkan desain") — token berikut yatim dan dilarang:\n  ' +
      pakai.join('\n  ')
  );
});

/**
 * ⛔ `--t-metric` DIHAPUS 26 September 2026 (Task 4, kampanye "Hidupkan
 * desain"). Skala final kembali EMPAT token — lihat spec § 5: angka KPI
 * kartu dasbor B-01 memakai ukuran DISPLAY yang sama dengan total/kembalian
 * di kasir, bukan ukuran kelima.
 *
 * Ia bukan sekadar dihapus dari `:root` — pengikatnya (`.stat .t-title-lg`)
 * harus diarahkan ke `var(--text-display)`, bukan dibiarkan menunjuk nama
 * yang sudah tidak ada (yang akan membuat CSS membuang seluruh deklarasi
 * tanpa satu pun error — kelas cacat yang sama dengan yang melahirkan berkas
 * ini).
 */
test('--t-metric tidak didefinisikan lagi; .stat .t-title-lg memakai --text-display', () => {
  const isiLumi = tanpaKomentar(readFileSync(join(AKAR, 'packages/ds/lumi.css'), 'utf8'));

  assert.ok(
    !/--t-metric\s*:/.test(isiLumi),
    '`--t-metric` masih didefinisikan di lumi.css. Skala final punya EMPAT ' +
      'token (32/20/15/13); ia harus dihapus, bukan dipertahankan sebagai alias.'
  );
  assert.ok(
    !isiLumi.includes('--t-metric'),
    '`--t-metric` masih disebut di lumi.css (definisi atau pemakaian). Skala ' +
      'final tidak lagi punya token khusus.'
  );

  const cocokSelektor = [...isiLumi.matchAll(/([^{}]*)\{([^{}]*)\}/g)].find(([, sel]) =>
    sel.trim().split('\n').pop().trim().includes('.stat .t-title-lg')
  );
  assert.ok(cocokSelektor, 'selektor `.stat .t-title-lg` tidak ditemukan di lumi.css');
  assert.match(
    cocokSelektor[2],
    /font-size\s*:\s*var\(--text-display\)/,
    `.stat .t-title-lg harap \`font-size: var(--text-display)\`, dapat: "${cocokSelektor[2].trim()}"`
  );

  for (const f of berkasCss(join(AKAR, 'apps/kasir'))) {
    const isi = tanpaKomentar(readFileSync(f, 'utf8'));
    assert.ok(
      !isi.includes('--t-metric'),
      `${f.slice(AKAR.length)} memakai \`--t-metric\`. Token itu sudah dihapus ` +
        'dari sistem ini seluruhnya.'
    );
  }
});
