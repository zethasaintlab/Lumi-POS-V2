'use strict';

// Palet kasir: kontras, arah netral, kegelapan teks, aksen, nol hex.
//
// ## ⛔ Kenapa penjaga ini ada
//
// Fase 1 rebuild UI (`docs/RENCANA-REBUILD-UI.md`) mengganti permukaan krem
// hangat dengan netral terang, lewat override di `packages/ds/lumi.css` —
// `ds-bundle/` vendor dan tidak disunting. Override adalah tempat KEDUA yang
// memutuskan warna, dan yang kedua menyimpang diam-diam: satu token yang lupa
// ditimpa tetap hangat, satu teks yang digeser terlalu terang turun kontrasnya,
// dan tidak satu pun menghasilkan error.
//
// ## Yang diperiksa terhadap TOKEN EFEKTIF (bundle ⊕ override `lumi.css`)
//
// 1. Aksen `#0D5C63` tidak berubah — invarian `CLAUDE.md`. `ds-bundle-vendor`
//    menjaga berkas bundle, bukan override yang menimpanya.
// 2. Permukaan dan pembatas TIDAK HANGAT (kanal merah tidak melebihi biru).
// 3. Teks tidak lebih TERANG daripada nilai bundle-nya — kegelapan dipertahankan.
// 4. Matriks kontras: setiap token teks di setiap permukaan ≥ 4,5; teks
//    sekunder di halaman dan kartu ≥ 6,0; badge netral ≥ 4,5; status di latar
//    lembutnya sendiri ≥ 4,5; putih di aksen tetap 7,70.
// 5. Nol hex di CSS dan TSX `apps/kasir/src` — oxlint tidak membaca CSS.
//
// ⛔ Satu sumber aturan kontras: rumus luminans WCAG 2.x di bawah, bukan
// `tools/palet-turunan.mjs`. Skrip itu MENURUNKAN nilai; penjaga ini
// MEMERIKSA hasilnya dari berkas CSS. Dua peran, dua berkas.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');

function bacaRoot(berkas) {
  const teks = fs.readFileSync(path.join(AKAR, berkas), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of teks.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
  }
  return peta;
}

const BUNDLE = bacaRoot('ds-bundle/tokens/colors.css');
const OVERRIDE = bacaRoot('packages/ds/lumi.css');
const EFEKTIF = { ...BUNDLE, ...OVERRIDE };

function luminans(h) {
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontras(a, b) {
  const [x, y] = [luminans(a), luminans(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const t = (nama) => {
  assert.ok(EFEKTIF[nama], `token ${nama} tidak ditemukan di bundle maupun override`);
  return EFEKTIF[nama];
};

const PERMUKAAN = ['--surface', '--surface-sunk', '--surface-alt'];
const TEKS = ['--ink', '--ink-muted', '--ink-subtle', '--success', '--danger', '--warning', '--info', '--accent'];

test('SENTINEL: kedua berkas token terbaca', () => {
  assert.ok(Object.keys(BUNDLE).length >= 25, `hanya ${Object.keys(BUNDLE).length} token bundle terbaca`);
  for (const n of [...PERMUKAAN, ...TEKS, '--border', '--border-strong']) t(n);
});

test('⛔ aksen tetap #0D5C63, dan putih di atasnya tetap 7,70', () => {
  assert.equal(t('--accent'), '#0D5C63', 'aksen berubah — invarian CLAUDE.md');
  assert.equal(kontras('#FFFFFF', t('--accent')).toFixed(2), '7.70');
});

test('⛔ permukaan dan pembatas TIDAK hangat', () => {
  const hangat = ['--surface-sunk', '--surface-alt', '--border', '--border-strong'].filter((n) => {
    const x = parseInt(t(n).slice(1), 16);
    return ((x >> 16) & 255) > (x & 255);
  });
  assert.deepEqual(
    hangat.map((n) => `${n} ${t(n)}`),
    [],
    'permukaan/pembatas masih krem hangat (kanal merah > biru). Fase 1 menetapkan netral terang.'
  );
});

test('⛔ teks tidak lebih TERANG daripada nilai bundle-nya', () => {
  for (const n of ['--ink', '--ink-muted', '--ink-subtle']) {
    assert.ok(
      luminans(t(n)) <= luminans(BUNDLE[n]) + 1e-9,
      `${n} ${t(n)} lebih terang daripada ${BUNDLE[n]} milik bundle — kegelapan teks wajib dipertahankan`
    );
  }
});

test('⛔ matriks kontras: setiap teks di setiap permukaan ≥ 4,5', () => {
  const gagal = [];
  for (const tx of TEKS) for (const p of PERMUKAAN) {
    const k = kontras(t(tx), t(p));
    if (k < 4.5) gagal.push(`${tx} ${t(tx)} di ${p} ${t(p)}: ${k.toFixed(2)}`);
  }
  assert.deepEqual(gagal, [], 'pasangan teks-permukaan di bawah 4,5');
});

test('⛔ teks sekunder ≥ 6,0 di halaman dan kartu; badge netral ≥ 4,5; status di latar lembutnya ≥ 4,5', () => {
  for (const p of ['--surface', '--surface-sunk']) {
    const k = kontras(t('--ink-muted'), t(p));
    assert.ok(k >= 6.0, `--ink-muted di ${p}: ${k.toFixed(2)} < 6,0`);
  }
  const netral = kontras(t('--ink-muted'), t('--surface-alt'));
  assert.ok(netral >= 4.5, `badge netral (--ink-muted di --surface-alt): ${netral.toFixed(2)} < 4,5`);
  for (const st of ['success', 'danger', 'warning', 'info']) {
    const k = kontras(t(`--${st}`), t(`--${st}-soft`));
    assert.ok(k >= 4.5, `--${st} di --${st}-soft: ${k.toFixed(2)} < 4,5`);
  }
});

test('⛔ nol hex hardcoded di CSS dan TSX apps/kasir/src', () => {
  const temuan = [];
  let dipindai = 0;
  const jalan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) jalan(p);
      else if (/\.(css|tsx)$/.test(e.name)) {
        dipindai += 1;
        /* Komentar diganti spasi, BARIS DIPERTAHANKAN, supaya nomor baris di
           pesan menunjuk baris sebenarnya di berkas. */
        const kosongkan = (m) => m.replace(/[^\n]/g, ' ');
        const tanpaKomentar = fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, kosongkan)
          .replace(/^\s*\/\/.*$/gm, kosongkan);
        for (const m of tanpaKomentar.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g)) {
          const baris = tanpaKomentar.slice(0, m.index).split('\n').length;
          temuan.push(`${path.relative(AKAR, p)}:${baris} ${m[0]}`);
        }
      }
    }
  };
  jalan(path.join(AKAR, 'apps/kasir/src'));
  assert.ok(dipindai >= 20, `hanya ${dipindai} berkas dipindai — penjaga tidak memindai apa pun`);
  assert.deepEqual(temuan, [], 'nilai warna hardcoded di komponen kasir; lewat token di packages/ds/lumi.css');
});
