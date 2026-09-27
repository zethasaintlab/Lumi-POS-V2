// Menurunkan palet campuran Fase 1 rebuild UI dari token bundle — BUKAN
// mengetik nilai dari mockup.
//
// Aturannya satu, dan ia yang membuat nilainya dapat diperiksa ulang:
//
//   Setiap token permukaan/pembatas/teks yang hangat dikonversi ke OKLCH.
//   Kecerahan (L) DIPERTAHANKAN, chroma diturunkan ke nyaris nol, dan rona
//   digeser ke netral-dingin (arah mockup `docs/referensi-visual`). Hasilnya
//   netral terang dengan kegelapan yang sama — bukan krem.
//
// ⛔ Untuk teks, L tidak boleh naik: hasil konversi yang kebetulan lebih terang
//    (pembulatan ke 8 bit) diturunkan sampai luminansinya ≤ aslinya.
// ⛔ Aksen, warna status, kategori, radius, spasi, font: TIDAK disentuh.
//
//   node tools/palet-turunan.mjs          → cetak nilai + kontras
//
// Nilai yang dicetak disalin ke `packages/ds/lumi.css`; ambang kontrasnya
// dijaga `tests/runtime/palet-kontras.test.js`, yang membaca berkas CSS, bukan
// skrip ini.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Rona netral-dingin (derajat OKLCH) dan chroma sisa. */
export const RONA = 215;
export const CHROMA_PERMUKAAN = 0.006;
export const CHROMA_TEKS = 0.008;

export const TOKEN_DIUBAH = {
  '--surface-sunk': 'permukaan',
  '--surface-alt': 'permukaan',
  '--border': 'permukaan',
  '--border-strong': 'permukaan',
  '--ink': 'teks',
  '--ink-muted': 'teks',
  '--ink-subtle': 'teks',
};

// --- warna ------------------------------------------------------------------

export function hexKeRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const keLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const dariLinear = (v) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};
export function luminans(h) {
  const [r, g, b] = hexKeRgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function kontras(a, b) {
  const [x, y] = [luminans(a), luminans(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function keOklch(h) {
  const [r, g, b] = hexKeRgb(h).map(keLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180) / Math.PI };
}
function dariOklch({ L, C, H }) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(dariLinear);
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function turunkan(hexAsli, jenis) {
  const o = keOklch(hexAsli);
  let L = o.L;
  let hasil = dariOklch({ L, C: jenis === 'teks' ? CHROMA_TEKS : CHROMA_PERMUKAAN, H: RONA });
  if (jenis === 'teks') {
    while (luminans(hasil) > luminans(hexAsli)) {
      L -= 0.001;
      hasil = dariOklch({ L, C: CHROMA_TEKS, H: RONA });
    }
  }
  return hasil;
}

/**
 * Warna status yang gagal ≥ 4,5 di permukaan mana pun digelapkan: L OKLCH
 * diturunkan 0,001 per langkah sampai lolos, rona dan chroma TETAP. Terukur
 * 25 September 2026: hanya `--warning`, yang di `--surface-alt` sudah gagal
 * sejak palet lama (4,31).
 */
export function gelapkanSampai(hex, permukaan, ambang = 4.5) {
  const o = keOklch(hex);
  let L = o.L;
  let hasil = hex;
  while (permukaan.some((p) => kontras(hasil, p) < ambang)) {
    L -= 0.001;
    hasil = dariOklch({ L, C: o.C, H: o.H });
  }
  return hasil;
}

export function tokenBundle() {
  const teks = fs.readFileSync(path.join(AKAR, 'ds-bundle/tokens/colors.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const m of teks.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
  return peta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const asli = tokenBundle();
  const baru = { ...asli };
  for (const [t, jenis] of Object.entries(TOKEN_DIUBAH)) baru[t] = turunkan(asli[t], jenis);
  const permukaanBaru = ['--surface', '--surface-sunk', '--surface-alt'].map((p) => baru[p]);
  for (const st of ['--success', '--danger', '--warning', '--info']) {
    const g = gelapkanSampai(asli[st], permukaanBaru);
    if (g !== asli[st]) {
      baru[st] = g;
      console.log(`Status digelapkan: ${st} ${asli[st]} → ${g}`);
    }
  }
  console.log('Token yang diturunkan:');
  for (const t of [...Object.keys(TOKEN_DIUBAH), '--warning']) {
    console.log(`  ${t.padEnd(16)} ${asli[t]} → ${baru[t]}   L ${luminans(asli[t]).toFixed(4)} → ${luminans(baru[t]).toFixed(4)}`);
  }
  const P = ['--surface', '--surface-sunk', '--surface-alt'];
  console.log('\nKontras (sebelum → sesudah):');
  for (const tx of ['--ink', '--ink-muted', '--ink-subtle', '--success', '--danger', '--warning', '--info', '--accent']) {
    for (const p of P) {
      console.log(`  ${tx.padEnd(12)} di ${p.padEnd(14)} ${kontras(asli[tx], asli[p]).toFixed(2)} → ${kontras(baru[tx], baru[p]).toFixed(2)}`);
    }
  }
  console.log(`  putih di --accent            ${kontras('#FFFFFF', asli['--accent']).toFixed(2)} → ${kontras('#FFFFFF', baru['--accent']).toFixed(2)}`);
  console.log(`  netral (.badge-neutral)      ${kontras(asli['--ink-muted'], asli['--surface-alt']).toFixed(2)} → ${kontras(baru['--ink-muted'], baru['--surface-alt']).toFixed(2)}`);
}
