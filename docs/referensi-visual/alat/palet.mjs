// Palet repo dan palet mockup berdampingan, dengan rasio kontras WCAG 2.x.
//
// ⛔ Nilai dibaca dari BERKAS TOKEN, bukan diketik ulang: repo dari
// `ds-bundle/tokens/colors.css`, mockup dari `sumber/tokens/colors.css`.
// Nama token yang tidak ditemukan menghentikan run — lebih baik gagal daripada
// membandingkan warna yang disalin salah.
//
// ⛔ TANPA rekomendasi. Keluaran ini bahan keputusan user, bukan keputusannya.
//
//   node palet.mjs   → ../PALET.md + ../palet.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const AKAR_REF = path.resolve(DI_SINI, '..');
const AKAR_REPO = path.resolve(AKAR_REF, '..', '..');

function baca(berkas) {
  const teks = fs.readFileSync(berkas, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /* Hanya blok :root pertama (mode terang). */
  const akar = teks.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const peta = {};
  for (const m of akar.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
  return peta;
}
const REPO = baca(path.join(AKAR_REPO, 'ds-bundle/tokens/colors.css'));
const MOCK = baca(path.join(AKAR_REF, 'sumber/tokens/colors.css'));
const r = (t) => { if (!REPO[t]) throw new Error(`token repo ${t} tidak ada`); return { t, v: REPO[t] }; };
const m = (t) => { if (!MOCK[t]) throw new Error(`token mockup ${t} tidak ada`); return { t, v: MOCK[t] }; };

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function kontras(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const f = (k) => `${k.toFixed(2)}:1`;
const nilai = (k, ambang) => `${f(k)} ${k >= 7 ? 'AAA' : k >= 4.5 ? 'AA' : k >= 3 ? 'AA besar' : '**gagal**'}`;

/* Peran → token di kedua sisi. */
const PERAN = {
  permukaanKartu: [r('--surface'), m('--card')],
  permukaanHalaman: [r('--surface-sunk'), m('--background')],
  permukaanAlt: [r('--surface-alt'), m('--muted')],
  aksen: [r('--accent'), m('--primary')],
  aksenHover: [r('--accent-hover'), m('--accent-hover')],
  aksenLembut: [r('--accent-soft'), m('--accent-subtle')],
  teksUtama: [r('--ink'), m('--foreground')],
  teksSekunder: [r('--ink-muted'), m('--muted-foreground')],
  pembatas: [r('--border'), m('--border')],
  pembatasKuat: [r('--border-strong'), m('--input-border')],
};
/* Lima status: repo punya empat semantik + badge netral; mockup punya lima
   pasangan bernama. `pending` mockup dipasangkan dengan `.badge-neutral`
   repo, karena repo tidak punya token status "menunggu". */
const STATUS = [
  ['Sukses', [r('--success'), r('--success-soft')], [m('--status-success-text'), m('--status-success-bg')]],
  ['Info', [r('--info'), r('--info-soft')], [m('--status-info-text'), m('--status-info-bg')]],
  ['Peringatan', [r('--warning'), r('--warning-soft')], [m('--status-warning-text'), m('--status-warning-bg')]],
  ['Bahaya', [r('--danger'), r('--danger-soft')], [m('--status-danger-text'), m('--status-danger-bg')]],
  ['Netral / menunggu', [r('--ink-muted'), r('--surface-alt')], [m('--status-pending-text'), m('--status-pending-bg')]],
];

const sel = ({ t, v }) => `\`${v}\` \`${t}\``;
const baris = [];
baris.push('# Palet repo dan palet mockup — bahan keputusan');
baris.push('');
baris.push('⛔ **Tanpa rekomendasi.** Dokumen ini hanya menyajikan angka. Keputusannya milik user, dan sampai ada keputusan, token repo tidak berubah.');
baris.push('');
baris.push('Dibangkitkan `alat/palet.mjs` dari `ds-bundle/tokens/colors.css` (repo) dan `sumber/tokens/colors.css` (mockup, blok `:root` terang). Kontras dihitung dengan rumus luminans relatif WCAG 2.x. Ambang: **AA** ≥ 4,5 (teks biasa), **AA besar** ≥ 3 (teks ≥ 18,66 px tebal atau ≥ 24 px, juga batas non-teks), **AAA** ≥ 7.');
baris.push('');
baris.push('![Swatch berdampingan](palet.png)');
baris.push('');
baris.push('## Peran warna');
baris.push('');
baris.push('| Peran | Repo | Mockup |');
baris.push('|---|---|---|');
const namaPeran = { permukaanKartu: 'Permukaan kartu/panel', permukaanHalaman: 'Permukaan halaman', permukaanAlt: 'Permukaan alternatif', aksen: 'Aksen', aksenHover: 'Aksen hover', aksenLembut: 'Aksen lembut', teksUtama: 'Teks utama', teksSekunder: 'Teks sekunder', pembatas: 'Pembatas', pembatasKuat: 'Pembatas kuat / input' };
for (const [k, [a, b]] of Object.entries(PERAN)) baris.push(`| ${namaPeran[k]} | ${sel(a)} | ${sel(b)} |`);
baris.push('');
baris.push('## Kontras teks terhadap permukaannya');
baris.push('');
baris.push('| Pasangan | Repo | Mockup |');
baris.push('|---|---|---|');
const pasangKontras = [
  ['Teks utama di kartu', 'teksUtama', 'permukaanKartu'],
  ['Teks utama di halaman', 'teksUtama', 'permukaanHalaman'],
  ['Teks utama di permukaan alternatif', 'teksUtama', 'permukaanAlt'],
  ['Teks sekunder di kartu', 'teksSekunder', 'permukaanKartu'],
  ['Teks sekunder di halaman', 'teksSekunder', 'permukaanHalaman'],
  ['Teks sekunder di permukaan alternatif', 'teksSekunder', 'permukaanAlt'],
  ['Aksen sebagai teks di kartu', 'aksen', 'permukaanKartu'],
  ['Aksen sebagai teks di halaman', 'aksen', 'permukaanHalaman'],
  ['Aksen sebagai teks di aksen lembut', 'aksen', 'aksenLembut'],
];
const angka = {};
for (const [label, a, b] of pasangKontras) {
  const kr = kontras(PERAN[a][0].v, PERAN[b][0].v);
  const km = kontras(PERAN[a][1].v, PERAN[b][1].v);
  angka[label] = [kr, km];
  baris.push(`| ${label} | ${nilai(kr)} | ${nilai(km)} |`);
}
const putihR = kontras('#FFFFFF', PERAN.aksen[0].v);
const putihM = kontras('#FFFFFF', PERAN.aksen[1].v);
baris.push(`| Teks putih di tombol aksen | ${nilai(putihR)} | ${nilai(putihM)} |`);
baris.push('');
baris.push('## Pembatas (non-teks)');
baris.push('');
baris.push('WCAG 1.4.11 menuntut 3:1 untuk batas yang **dibutuhkan** agar kontrol dapat dikenali, misalnya tepi field input. Tepi dekoratif kartu tidak terkena aturan itu.');
baris.push('');
baris.push('| Pasangan | Repo | Mockup |');
baris.push('|---|---|---|');
for (const [label, a, b] of [['Pembatas di kartu', 'pembatas', 'permukaanKartu'], ['Pembatas di halaman', 'pembatas', 'permukaanHalaman'], ['Pembatas kuat / input di kartu', 'pembatasKuat', 'permukaanKartu']]) {
  baris.push(`| ${label} | ${f(kontras(PERAN[a][0].v, PERAN[b][0].v))} | ${f(kontras(PERAN[a][1].v, PERAN[b][1].v))} |`);
}
baris.push('');
baris.push('## Lima warna status — teks di atas latar lembutnya sendiri');
baris.push('');
baris.push('| Status | Repo (teks · latar) | Kontras repo | Mockup (teks · latar) | Kontras mockup |');
baris.push('|---|---|---|---|---|');
for (const [label, [rt, rb], [mt, mb]] of STATUS) {
  baris.push(`| ${label} | ${sel(rt)} · ${sel(rb)} | ${nilai(kontras(rt.v, rb.v))} | ${sel(mt)} · ${sel(mb)} | ${nilai(kontras(mt.v, mb.v))} |`);
}
baris.push('');
baris.push('⛔ Repo tidak punya token status "menunggu". Baris terakhir memasangkan `pending` mockup dengan `.badge-neutral` repo (`ds-bundle/components.css:66`). Itu padanan fungsi, bukan token bernama sama.');
baris.push('');
baris.push('## Yang ikut berubah bila palet mockup dipilih, dan bukan warna');
baris.push('');
baris.push('Dicatat supaya keputusan palet tidak diam-diam memutuskan hal lain juga:');
baris.push('');
baris.push('- **Font.** Mockup memakai Nunito Sans 400/600/700/800. Repo memakai Inter 400/500/600, self-host, dipilih karena tabular numerals (`docs/DESIGN.md` § 2).');
baris.push('- **Ukuran teks kecil.** Mockup 13 px, repo `--text-caption` 12 px. Skala lima token repo adalah keputusan user 31 Agustus 2026 (`CLAUDE.md` § Skala teks final).');
baris.push('- **Aksen** `#0D5C63` disebut `CLAUDE.md` sebagai hal yang "tidak boleh disentuh sama sekali". Memilih aksen mockup berarti mencabut aturan itu, bukan sekadar mengganti nilai.');
baris.push('- **Mode gelap.** `sumber/readme.md` menyebut 14 token yang berbeda di mode gelap, dan `sumber/guidelines/colors-dark-mode.html` memperagakannya. `sumber/tokens/colors.css` di ekspor ini hanya memuat blok `:root` terang. Aturan DS #8 repo: tanpa dark mode. Tabel di atas hanya membandingkan mode terang.');
baris.push('');
fs.writeFileSync(path.join(AKAR_REF, 'PALET.md'), baris.join('\n'));

/* Swatch: dua kolom, satu baris per peran + status. */
const barisSw = [
  ...Object.entries(PERAN).map(([k, [a, b]]) => [namaPeran[k], a.v, b.v, null, null]),
  ...STATUS.map(([l, [rt, rb], [mt, mb]]) => [`Status: ${l}`, rb.v, mb.v, rt.v, mt.v]),
];
const T = 44;
const Wsw = 900;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wsw}" height="${60 + barisSw.length * T}"><rect width="100%" height="100%" fill="#ffffff"/>`;
svg += `<text x="16" y="36" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Peran</text>`;
svg += `<text x="300" y="36" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Repo</text>`;
svg += `<text x="600" y="36" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Mockup</text>`;
barisSw.forEach(([l, a, b, ta, tb], i) => {
  const y = 50 + i * T;
  svg += `<text x="16" y="${y + 27}" font-family="sans-serif" font-size="14" fill="#333">${l}</text>`;
  for (const [x, bg, fg] of [[300, a, ta], [600, b, tb]]) {
    svg += `<rect x="${x}" y="${y + 4}" width="280" height="${T - 8}" rx="6" fill="${bg}" stroke="#999" stroke-width="1"/>`;
    const warnaTeks = fg ?? (lum(bg) > 0.3 ? '#111111' : '#FFFFFF');
    svg += `<text x="${x + 12}" y="${y + 27}" font-family="monospace" font-size="14" fill="${warnaTeks}">${fg ? `${fg} di ${bg}` : bg}</text>`;
  }
});
svg += '</svg>';
await sharp(Buffer.from(svg)).png({ palette: true, quality: 95, effort: 10 }).toFile(path.join(AKAR_REF, 'palet.png'));
console.log(JSON.stringify(Object.fromEntries(Object.entries(angka).map(([k, [a, b]]) => [k, [f(a), f(b)]])), null, 1));
