'use strict';

// Kontras palet MOCKUP (AA) — `packages/ds/tokens-mockup.css`.
//
// ## Kenapa penjaga ini ada
//
// Ditulis ulang dari versi lama (`git show d20e814:tests/runtime/palet-kontras.test.js`,
// PR #60 belum di-merge), yang menjaga token override `packages/ds/lumi.css`
// di atas `ds-bundle/` lama. Palet itu sudah diganti sepenuhnya oleh palet
// mockup (Global Constraints, Task 1) — jadi pemeriksaan "aksen #0D5C63 tidak
// berubah" dan "nol hex hardcoded" TIDAK ikut dipindahkan ke sini: keduanya
// milik token dan komponen final (Fase 1 lanjutan), bukan token mockup
// mentah. Yang tetap dipakai persis dari versi lama adalah rumus luminans/
// kontras WCAG 2.x — satu-satunya sumber aturan kontras di repo ini.
//
// Empat token di sini (`--status-pending-text`, `--sidebar-label`,
// `--step-inactive-text`, `--icon-muted`) adalah koreksi AA yang dipaku:
// nilai mockup mentahnya gagal ambang, dan `tokens-mockup.css` menyimpan
// nilai yang SUDAH dinaikkan (`token-mockup.test.js` menjaga bahwa hanya
// keempatnya yang boleh berbeda dari sumber). Penjaga ini memeriksa bahwa
// nilai yang dinaikkan itu SUNGGUH lolos ambangnya — bukan sekadar berbeda
// dari sumber.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const MOCKUP = path.join(AKAR, 'packages/ds/tokens-mockup.css');

function bacaRootHex(berkasAbsolut) {
  const teks = fs.readFileSync(berkasAbsolut, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of teks.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      peta[m[1]] = m[2].toUpperCase();
    }
  }
  return peta;
}

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
function fmt(n) {
  return n.toFixed(2).replace('.', ',');
}

const TOKEN = bacaRootHex(MOCKUP);
const PUTIH = '#FFFFFF';
const t = (nama) => {
  assert.ok(TOKEN[nama], `token ${nama} tidak ditemukan di tokens-mockup.css`);
  return TOKEN[nama];
};

// Pasangan (teks, latar, ambang) — dideklarasikan sebagai DATA, sesuai brief
// Task 1 Step 2. `null` sebagai nama teks berarti putih literal (teks di atas
// --destructive, tombol/badge destruktif).
const PASANGAN = [];
for (const teks of ['--foreground', '--muted-foreground', '--muted-foreground-strong']) {
  for (const latar of ['--background', '--card', '--secondary']) {
    PASANGAN.push([teks, latar, 4.5]);
  }
}
PASANGAN.push(
  ['--primary-foreground', '--primary', 4.5],
  ['--primary', '--accent-subtle', 4.5],
  ['--ghost-foreground', '--card', 4.5]
);
for (const status of ['success', 'info', 'pending', 'warning', 'danger']) {
  PASANGAN.push([`--status-${status}-text`, `--status-${status}-bg`, 4.5]);
}
PASANGAN.push(
  ['--offline-badge-text', '--offline-badge-bg', 4.5],
  ['--offline-banner-text', '--offline-banner-bg', 4.5],
  [null, '--destructive', 4.5]
);
for (const latar of ['--card', '--secondary', '--background']) {
  PASANGAN.push(['--sidebar-label', latar, 4.5]);
}
PASANGAN.push(['--step-inactive-text', '--step-inactive-bg', 4.5], ['--icon-muted', '--card', 3.0]);

test('SENTINEL: token hex mockup terbaca, dan jumlah pasangan cukup', () => {
  assert.ok(
    Object.keys(TOKEN).length >= 60,
    `hanya ${Object.keys(TOKEN).length} token hex terbaca dari tokens-mockup.css — penjaga mungkin tidak memindai apa pun`
  );
  assert.ok(PASANGAN.length >= 20, `hanya ${PASANGAN.length} pasangan diperiksa, diharapkan minimal 20`);
});

test('setiap pasangan teks/latar memenuhi ambang kontras AA-nya', () => {
  const gagal = [];
  for (const [namaTeks, namaLatar, ambang] of PASANGAN) {
    const nilaiTeks = namaTeks === null ? PUTIH : t(namaTeks);
    const nilaiLatar = t(namaLatar);
    const k = kontras(nilaiTeks, nilaiLatar);
    if (k < ambang - 1e-9) {
      gagal.push(
        `${namaTeks ?? 'putih'} ${nilaiTeks} di atas ${namaLatar} ${nilaiLatar}: kontras ${fmt(k)} < ambang ${fmt(ambang)}`
      );
    }
  }
  assert.deepEqual(gagal, [], 'pasangan teks/latar di bawah ambang AA-nya — lihat pesan per pasangan');
});
