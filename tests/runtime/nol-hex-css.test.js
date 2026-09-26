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
// berkas ini, jadi nol toleransi: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`
// harus nol.
//
// `packages/ds/lumi.css` PENGECUALIAN SATU-SATUNYA: ia mendefinisikan token
// (`--kat-1`, `--overlay`, dst) dengan nilai literal — itulah SATU-SATUNYA
// tempat yang sah menuliskan warna mentah di seluruh sistem ini. Literal di
// sana sah HANYA sebagai nilai deklarasi `--nama: …;` di dalam blok `:root`.
// Literal di luar `:root`, atau di dalam `:root` tapi bukan nilai `--nama:`,
// tetap pelanggaran.
//
// `ds-bundle/` TIDAK dipindai — ia artefak VENDOR (CLAUDE.md), dan
// penyimpangannya bukan milik kode kami untuk diperbaiki.
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

const POLA_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;

function tanpaKomentar(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function berkasCss(dir, hasil = []) {
  if (!fs.existsSync(dir)) return hasil;
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) {
      if (/node_modules|dist/.test(p)) continue;
      berkasCss(p, hasil);
    } else if (p.endsWith('.css')) {
      hasil.push(p);
    }
  }
  return hasil;
}

function baris(teks, indeks) {
  return teks.slice(0, indeks).split('\n').length;
}

/**
 * Berkas CSS di bawah `apps/kasir/src`, `apps/backoffice/src`, `apps/hp/src`
 * — nol toleransi, tanpa pengecualian `:root`.
 * Tidak satu pun dari keempat berkas ini punya blok `:root` (diverifikasi
 * 26 September 2026); token milik `packages/ds` semata.
 */
function periksaAplikasi(fileAbs) {
  const isi = tanpaKomentar(fs.readFileSync(fileAbs, 'utf8'));
  const pelanggaran = [];
  for (const m of isi.matchAll(POLA_LITERAL)) {
    pelanggaran.push(`${fileAbs.slice(AKAR.length + 1)}:${baris(isi, m.index)}  "${m[0]}"`);
  }
  return pelanggaran;
}

/**
 * `packages/ds/lumi.css` — literal sah HANYA sebagai nilai deklarasi
 * `--nama: …;` di dalam sebuah blok `:root { … }`.
 */
function periksaLumiCss(isiMentah) {
  const isi = tanpaKomentar(isiMentah);
  const pelanggaran = [];

  // Rentang setiap blok `:root { … }` di berkas (tanpa nested brace — lumi.css
  // tidak pernah menaruh blok bersarang di dalam `:root`, diverifikasi lewat
  // pembacaan berkas).
  const rentangRoot = [];
  for (const m of isi.matchAll(/:root(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
    rentangRoot.push({ mulai: m.index, akhir: m.index + m[0].length, konten: m[1] });
  }

  // Salinan berkas dengan setiap blok `:root` DIKOSONGKAN (spasi, indeks
  // tetap sama) — sisa isi ini wajib nol literal.
  let luarRoot = isi;
  for (const { mulai, akhir } of rentangRoot) {
    luarRoot = luarRoot.slice(0, mulai) + ' '.repeat(akhir - mulai) + luarRoot.slice(akhir);
  }
  for (const m of luarRoot.matchAll(POLA_LITERAL)) {
    pelanggaran.push(`packages/ds/lumi.css:${baris(isi, m.index)}  "${m[0]}" (di luar blok :root)`);
  }

  // Di dalam tiap blok `:root`: setiap PERNYATAAN (dipisah `;`) yang memuat
  // literal wajib berbentuk `--nama: …` — bukan properti CSS biasa.
  for (const { konten } of rentangRoot) {
    for (const pernyataan of konten.split(';')) {
      POLA_LITERAL.lastIndex = 0;
      if (!POLA_LITERAL.test(pernyataan)) continue;
      if (!/^\s*--[\w-]+\s*:/.test(pernyataan)) {
        pelanggaran.push(`packages/ds/lumi.css: di dalam :root, bukan deklarasi --nama: "${pernyataan.trim()}"`);
      }
    }
  }
  return pelanggaran;
}

test('SENTINEL: berkas CSS kasir, backoffice, dan hp ikut dipindai', () => {
  const dipindai = {
    kasir: berkasCss(path.join(AKAR, 'apps/kasir/src')),
    backoffice: berkasCss(path.join(AKAR, 'apps/backoffice/src')),
    hp: berkasCss(path.join(AKAR, 'apps/hp/src')),
  };
  for (const [app, berkas] of Object.entries(dipindai)) {
    assert.ok(berkas.length >= 1, `nol berkas .css terpindai untuk ${app} — penjaga tidak memeriksa apa pun`);
  }
});

test('⛔ nol warna hardcoded (hex/rgb()/hsl()) di apps/*/src/**/*.css', () => {
  const berkas = [
    ...berkasCss(path.join(AKAR, 'apps/kasir/src')),
    ...berkasCss(path.join(AKAR, 'apps/backoffice/src')),
    ...berkasCss(path.join(AKAR, 'apps/hp/src')),
  ];
  const pelanggaran = berkas.flatMap(periksaAplikasi);
  assert.deepEqual(
    pelanggaran,
    [],
    'Warna hardcoded ditemukan di CSS aplikasi — seluruh styling wajib lewat token:\n  ' +
      pelanggaran.join('\n  ')
  );
});

test('⛔ packages/ds/lumi.css: literal hanya sah sebagai nilai --nama: di dalam :root', () => {
  const isiMentah = fs.readFileSync(LUMI, 'utf8');
  const pelanggaran = periksaLumiCss(isiMentah);
  assert.deepEqual(
    pelanggaran,
    [],
    'Literal warna di lumi.css di luar aturan (token --nama: di dalam :root):\n  ' +
      pelanggaran.join('\n  ')
  );
});
