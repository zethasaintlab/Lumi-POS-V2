'use strict';

// Nol warna hardcoded di CSS aplikasi — aturan DS #6 ("semua styling lewat
// token; tidak ada nilai warna/ukuran hardcoded di komponen"), dan aturan
// kampanye "Rebuild UI kasir" (`CLAUDE.md`): "Nol hex hardcoded di komponen …
// belum ada penjaga untuk CSS — oxlint tidak membaca CSS."
//
// ## ⛔ Kenapa penjaga ini ada
//
// `oxlint`/`ds-adherence` memindai TSX, bukan CSS — `tools/oxlint-plugins/
// ds-adherence.mjs` menolak kelas skala teks yang ditulis sendiri, tapi tidak
// dapat melihat `apps/kasir/src/kasir.css`. Warna yang diketik langsung di
// sana (`color: #14110F`, `background: rgba(0,0,0,.4)`) lolos `lint:ds` hijau
// selamanya — kelas cacat yang sama dengan `token-css-ada.test.js`: yang
// salah tidak gagal, ia tidak terlihat siapa pun.
//
// ## Cakupan
//
// `apps/*/src/**/*.css` (kasir, backoffice, hp) — TANPA `:root` di satu pun
// berkas ini, jadi nol toleransi: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`,
// bentuk warna lain (lihat § Bentuk warna), dan nama warna CSS harus nol.
//
// `packages/ds/*.css` SELAIN `lumi.css` dan `tokens-mockup.css` — nol
// toleransi juga (F5, ronde perbaikan 1: sebelumnya TIDAK dipindai sama
// sekali; `styles.css` hanya berisi `@import` sehingga aman, tapi berkas baru
// macam `packages/ds/ekstra.css` bisa memuat literal bebas tanpa ketahuan).
// `tokens-mockup.css` DIKECUALIKAN secara eksplisit — ia SATU-SATUNYA berkas
// di mana literal warna justru INTINYA (salinan persis
// `docs/referensi-visual/sumber/tokens/*.css`), dan penjaganya sendiri ada di
// `tests/runtime/token-mockup.test.js`. Memindainya di sini akan membuat dua
// penjaga menegakkan dua aturan yang bertentangan untuk satu berkas.
//
// `packages/ds/lumi.css` PENGECUALIAN SATU-SATUNYA di luar itu: ia
// mendefinisikan token (`--kat-1`, `--overlay`, dst) dengan nilai literal —
// itulah SATU-SATUNYA tempat yang sah menuliskan warna mentah sebagai NILAI
// TOKEN. Literal di sana sah HANYA sebagai nilai deklarasi `--nama: …;` di
// dalam sebuah blok `:root { … }` yang TERATAS — bukan bersarang di dalam
// `@media`, `@supports`, atau at-rule apa pun (lihat § Ronde perbaikan 1).
// Literal di luar itu (level file lain, atau di dalam `:root` tapi bukan
// nilai `--nama:`) tetap pelanggaran.
//
// `ds-bundle/` TIDAK dipindai — ia artefak VENDOR (CLAUDE.md), dan
// penyimpangannya bukan milik kode kami untuk diperbaiki.
//
// ## ⛔ Ronde perbaikan 1 (sabotase independen, lihat task-2-report.md)
//
// F1 — `@media (...) { :root { --primary: #b94747; } } ` lolos: regex lama
// `:root(...)?\s*\{([^}]*)\}` mencari `:root` di MANA PUN dalam teks, tanpa
// peduli ia bersarang di dalam at-rule lain. Diperbaiki dengan PARSER
// bersarang-sadar (`analisisCss`) yang hanya mengenali `:root` sebagai blok
// token sah bila ia LANGSUNG anak dari level file (bukan anak dari `@media`,
// `@supports`, atau blok apa pun). `:root` yang bersarang di dalam at-rule
// diperlakukan seperti selector biasa — isinya diperiksa sebagai "di luar
// blok :root", bukan didiamkan.
//
// F2 — `POLA_LITERAL` lama peka huruf besar-kecil dan hanya mengenal
// hex/rgb/hsl. `RGBA(...)`, nama warna (`teal`, `black`, `white`, …),
// `oklch()`/`oklab()`/`lab()`/`lch()`/`hwb()`/`color()`/`color-mix()` semuanya
// lolos. Diperbaiki: seluruh pola kini `i` (case-insensitive), fungsi warna
// diperluas, dan nama warna CSS diperiksa — TAPI HANYA pada posisi NILAI
// deklarasi (`properti: nilai`), bukan pada teks bebas. Itu yang mencegah
// `white-space` (properti), nama kelas (`.olive-badge`), atau isi komentar
// (sudah dibuang) ikut tertandai — nama warna hanya berarti sebagai warna
// ketika ia muncul di sisi kanan sebuah `:`.
//
// F3 — direktori diabaikan lewat `/node_modules|dist/.test(p)` mencocokkan
// SUBSTRING path, jadi `apps/kasir/src/distribusi/` tidak pernah terlewat
// dari — maksudnya tidak pernah TERPINDAI, karena namanya mengandung "dist".
// Diperbaiki: cocokkan NAMA SEGMEN direktori itu sendiri, persis
// `node_modules`, persis `dist`, atau berawalan `dist-`.
//
// F5 — lihat § Cakupan di atas.
//
// Nomor baris pada pesan pelanggaran kini dihitung dari teks yang komentarnya
// DIGANTI SPASI (panjang sama, baris baru dipertahankan), bukan DIBUANG —
// sebelumnya nomor baris bergeser sejauh banyaknya baris komentar yang
// mendahului titik pelanggaran.
//
// ⛔ SENTINEL: penjaga wajib membuktikan ia memindai sesuatu — lihat
// `docs/verifikasi/KELAS-GAGAL.md`. Penjaga yang memeriksa nol berkas hijau
// selamanya, dan hijaunya adalah bentuk kekosongan yang sama dengan yang
// dijaganya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const LUMI = path.join(AKAR, 'packages/ds/lumi.css');
const DS_DIR = path.join(AKAR, 'packages/ds');
const DS_KECUALI = new Set(['lumi.css', 'tokens-mockup.css']);

/* --- Nama warna CSS (CSS Color Module Level 4, kata kunci "extended") ------
 *
 * Dipakai HANYA pada posisi nilai deklarasi (lihat `ekstrakDeklarasi`), bukan
 * dipindai bebas di seluruh teks — itulah yang mencegah `white-space`,
 * `.olive-badge`, atau properti lain yang KEBETULAN memuat substring nama
 * warna ikut tertandai. Kata kunci yang SENGAJA dikecualikan (bukan "warna
 * hardcoded" menurut aturan ini): `transparent`, `currentColor`, `inherit`,
 * `initial`, `unset`, `none` — tidak satu pun dari keenamnya ada di daftar
 * ini.
 */
const NAMA_WARNA_CSS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
  'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue',
  'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown',
  'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey',
  'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
];

/** Hex 3-8 digit, fungsi warna (case-insensitive), atau nama warna CSS —
 *  dengan batas kata yang MENOLAK hyphenated identifier (`white-space`). */
const POLA_HEX = /#[0-9a-fA-F]{3,8}\b/gi;
const POLA_FUNGSI_WARNA =
  /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\(/gi;
const POLA_NAMA_WARNA = new RegExp(
  `(?<![\\w-])(?:${NAMA_WARNA_CSS.join('|')})(?![\\w-])`,
  'gi'
);

function adaLiteral(teks) {
  POLA_HEX.lastIndex = 0;
  POLA_FUNGSI_WARNA.lastIndex = 0;
  POLA_NAMA_WARNA.lastIndex = 0;
  return POLA_HEX.test(teks) || POLA_FUNGSI_WARNA.test(teks) || POLA_NAMA_WARNA.test(teks);
}

/** Komentar diganti SPASI dengan panjang sama (baris baru dipertahankan),
 *  bukan dibuang — supaya indeks karakter (dan karenanya nomor baris pesan
 *  pelanggaran) tetap sejajar dengan berkas ASLI. */
function tanpaKomentar(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function segmenTerlarang(nama) {
  return nama === 'node_modules' || nama === 'dist' || nama.startsWith('dist-');
}

function berkasCss(dir, hasil = []) {
  if (!fs.existsSync(dir)) return hasil;
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) {
      if (segmenTerlarang(nama)) continue;
      berkasCss(p, hasil);
    } else if (p.endsWith('.css')) {
      hasil.push(p);
    }
  }
  return hasil;
}

function berkasDsCss() {
  if (!fs.existsSync(DS_DIR)) return [];
  return fs
    .readdirSync(DS_DIR)
    .filter((n) => n.endsWith('.css') && !DS_KECUALI.has(n))
    .map((n) => path.join(DS_DIR, n));
}

function baris(teks, indeks) {
  return teks.slice(0, indeks).split('\n').length;
}

/**
 * Parser CSS bersarang-sadar, sekadar cukup untuk penjaga ini — bukan parser
 * CSS umum. Satu kali jalan mengembalikan SETIAP deklarasi `properti: nilai;`
 * di seluruh berkas, di mana pun ia bersarang, beserta apakah ia berada
 * LANGSUNG di dalam sebuah blok `:root { … }` yang levelnya TERATAS (anak
 * langsung file, bukan anak `@media`/`@supports`/blok lain).
 *
 * Kenapa bukan regex tunggal (F1): regex `:root\s*\{([^}]*)\}` menemukan kata
 * `:root` di MANA PUN dalam teks, termasuk bersarang di dalam `@media`.
 * Parser ini melacak kedalaman brace secara eksplisit dan hanya mengenali
 * `:root` sebagai sah ketika `levelFile` benar SAAT ia ditemukan.
 *
 * Kenapa tanda kurung dilacak terpisah dari brace (bukan sekadar berhenti di
 * `;`/`{`/`}` pertama): nilai nyata di `lumi.css` memuat fungsi bersarang —
 * `linear-gradient(180deg, var(--surface-sunk) 0%, var(--surface-alt) 100%)`
 * — yang tanpa pelacakan kurung akan terputus di titik yang salah kalau
 * fungsi itu sendiri memuat karakter pemisah. Prasyarat: SETIAP delimiter
 * (`:`, `;`, `{`, `}`) yang relevan ada pada kedalaman KURUNG 0 — pola yang
 * sama menjaga `@media (prefers-reduced-motion: reduce) { … }` dari salah
 * baca sebagai deklarasi (`:` di dalam kurung level 1 tidak dianggap
 * pemisah).
 */
function ekstrakDeklarasi(isi) {
  const n = isi.length;
  let i = 0;
  const deklarasi = [];

  function lewatiSpasi() {
    while (i < n && /\s/.test(isi[i])) i++;
  }

  /** Baca sampai salah satu char di `delims` ditemui pada kedalaman kurung 0.
   *  `i` ditinggalkan TEPAT di delimiter itu (tidak dilewati). */
  function bacaSampai(delims) {
    const mulai = i;
    let d = 0;
    while (i < n) {
      const ch = isi[i];
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (d <= 0 && delims.includes(ch)) break;
      i++;
    }
    return { teks: isi.slice(mulai, i), mulai };
  }

  function masukBlokBaru(selektor, levelFile) {
    i++; // lewati '{'
    const iniRootSah = levelFile && /^:root(?:\[[^\]]*\])?$/.test(selektor);
    parseBlok(false, !!iniRootSah);
  }

  function parseBlok(levelFile, diDalamRootTeratas) {
    while (i < n) {
      lewatiSpasi();
      if (i >= n) return;
      if (isi[i] === '}') {
        i++;
        return;
      }

      const { teks: bagian1, mulai: mulaiBagian1 } = bacaSampai([':', ';', '{', '}']);
      if (i >= n) return;

      if (isi[i] === ';') {
        i++; // pernyataan tanpa efek (mis. `@import '…';`)
        continue;
      }
      if (isi[i] === '}') {
        i++;
        return;
      }
      if (isi[i] === '{') {
        masukBlokBaru(bagian1.trim(), levelFile);
        continue;
      }

      // isi[i] === ':' — bisa DEKLARASI ("prop: value;") atau bagian dari
      // SELECTOR yang memuat pseudo-class/pseudo-element (".btn:hover").
      const propName = bagian1.trim();
      i++; // lewati ':'
      const { teks: nilai, mulai: nilaiMulai } = bacaSampai([';', '{', '}']);
      if (i >= n) return;

      if (isi[i] === ';') {
        deklarasi.push({
          mulai: mulaiBagian1,
          properti: propName,
          nilai,
          nilaiMulai,
          diDalamRootTeratas: !!diDalamRootTeratas,
        });
        i++;
        continue;
      }
      if (isi[i] === '{') {
        // Ternyata SELECTOR (mis. ".btn:active:not(:disabled)"), bukan
        // deklarasi — gabungkan kembali dan masuk sebagai blok baru.
        masukBlokBaru(`${propName}:${nilai}`.trim(), levelFile);
        continue;
      }
      if (isi[i] === '}') {
        i++;
        return;
      }
    }
  }

  parseBlok(true, false);
  return deklarasi;
}

/**
 * Berkas CSS di `apps/*\/src` dan `packages/ds/*.css` (selain `lumi.css` dan
 * `tokens-mockup.css`) — nol toleransi, tanpa pengecualian `:root` sama
 * sekali: setiap literal di setiap deklarasi adalah pelanggaran.
 */
function periksaNolToleransi(fileAbs) {
  const isi = tanpaKomentar(fs.readFileSync(fileAbs, 'utf8'));
  const pelanggaran = [];
  const rel = fileAbs.slice(AKAR.length + 1);
  for (const d of ekstrakDeklarasi(isi)) {
    if (adaLiteral(d.nilai)) {
      pelanggaran.push(`${rel}:${baris(isi, d.mulai)}  "${d.properti}:${d.nilai.trim()}"`);
    }
  }
  return pelanggaran;
}

/**
 * `packages/ds/lumi.css` — literal sah HANYA sebagai nilai deklarasi
 * `--nama: …;` di dalam sebuah blok `:root { … }` yang LEVEL-nya teratas.
 */
function periksaLumiCss(isiMentah) {
  const isi = tanpaKomentar(isiMentah);
  const pelanggaran = [];
  for (const d of ekstrakDeklarasi(isi)) {
    if (!adaLiteral(d.nilai)) continue;
    if (d.diDalamRootTeratas && /^--[\w-]+$/.test(d.properti)) continue; // sah
    if (d.diDalamRootTeratas) {
      pelanggaran.push(
        `packages/ds/lumi.css:${baris(isi, d.mulai)}  di dalam :root, bukan deklarasi --nama: "${d.properti}:${d.nilai.trim()}"`
      );
    } else {
      pelanggaran.push(
        `packages/ds/lumi.css:${baris(isi, d.mulai)}  "${d.properti}:${d.nilai.trim()}" (di luar blok :root teratas)`
      );
    }
  }
  return pelanggaran;
}

test('SENTINEL: berkas CSS kasir, backoffice, hp, dan packages/ds ikut dipindai', () => {
  const dipindai = {
    kasir: berkasCss(path.join(AKAR, 'apps/kasir/src')),
    backoffice: berkasCss(path.join(AKAR, 'apps/backoffice/src')),
    hp: berkasCss(path.join(AKAR, 'apps/hp/src')),
    ds: berkasDsCss(),
  };
  for (const [app, berkas] of Object.entries(dipindai)) {
    assert.ok(berkas.length >= 1, `nol berkas .css terpindai untuk ${app} — penjaga tidak memeriksa apa pun`);
  }
});

test('⛔ nol warna hardcoded (hex/rgb()/hsl()/nama-warna/dst) di apps/*/src/**/*.css dan packages/ds/*.css', () => {
  const berkas = [
    ...berkasCss(path.join(AKAR, 'apps/kasir/src')),
    ...berkasCss(path.join(AKAR, 'apps/backoffice/src')),
    ...berkasCss(path.join(AKAR, 'apps/hp/src')),
    ...berkasDsCss(),
  ];
  const pelanggaran = berkas.flatMap(periksaNolToleransi);
  assert.deepEqual(
    pelanggaran,
    [],
    'Warna hardcoded ditemukan di CSS aplikasi — seluruh styling wajib lewat token:\n  ' +
      pelanggaran.join('\n  ')
  );
});

test('⛔ packages/ds/lumi.css: literal hanya sah sebagai nilai --nama: di dalam :root TERATAS', () => {
  const isiMentah = fs.readFileSync(LUMI, 'utf8');
  const pelanggaran = periksaLumiCss(isiMentah);
  assert.deepEqual(
    pelanggaran,
    [],
    'Literal warna di lumi.css di luar aturan (token --nama: di dalam :root teratas):\n  ' +
      pelanggaran.join('\n  ')
  );
});
