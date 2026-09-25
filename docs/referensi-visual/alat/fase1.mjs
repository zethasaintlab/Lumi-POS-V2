// Artefak Fase 1 rebuild UI: swatch palet sebelum/sesudah dengan kontras, dan
// tangkapan kelima layar galeri sebelum/sesudah.
//
//   node fase1.mjs <dist-galeri-sebelum> <dist-galeri-sesudah>
//
// "Sebelum" = galeri yang dibangun dari `main` sebelum Fase 1; "sesudah" =
// galeri dari branch Fase 1. Nilai token dibaca dari BERKAS: bundle untuk
// sebelum, bundle ⊕ override `lumi.css` untuk sesudah.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromePath } from './potret.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const AKAR_REPO = path.resolve(DI_SINI, '..', '..', '..');
const KELUAR = path.resolve(DI_SINI, '..', 'fase-1');
const [SEBELUM, SESUDAH] = process.argv.slice(2).map((p) => path.resolve(p));

const LAYAR = [
  ['K-03', 'normal'],
  ['K-08', 'normal'],
  ['K-12', 'normal'],
  ['K-14', 'offline'],
  ['K-15', 'normal'],
];

function bacaRoot(berkas) {
  const teks = fs.readFileSync(path.join(AKAR_REPO, berkas), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of teks.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
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
const kontras = (a, b) => {
  const [x, y] = [luminans(a), luminans(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function sajikan(akar) {
  const J = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
  const s = http.createServer((q, r) => {
    const n = decodeURIComponent(q.url.split('?')[0]);
    const f = path.join(akar, n === '/' ? 'harness-galeri.html' : n);
    if (!f.startsWith(akar) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end();
    r.writeHead(200, { 'content-type': J[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)));
}

const label = (teks, lebar, tinggi = 36) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="${tinggi}"><rect width="100%" height="100%" fill="#1e292b"/>` +
      `<text x="12" y="24" font-family="sans-serif" font-size="16" fill="#e7eeee">${teks}</text></svg>`
  );

async function main() {
  fs.mkdirSync(KELUAR, { recursive: true });
  const lama = bacaRoot('ds-bundle/tokens/colors.css');
  const baru = { ...lama, ...bacaRoot('packages/ds/lumi.css') };

  /* --- swatch --------------------------------------------------------- */
  const PERAN = [
    ['Latar halaman', '--surface-sunk'], ['Kartu/panel', '--surface'], ['Permukaan sekunder', '--surface-alt'],
    ['Pembatas', '--border'], ['Pembatas kuat', '--border-strong'], ['Aksen', '--accent'],
    ['Teks utama', '--ink'], ['Teks sekunder', '--ink-muted'], ['Teks redup', '--ink-subtle'],
    ['Sukses', '--success'], ['Info', '--info'], ['Peringatan', '--warning'], ['Bahaya', '--danger'],
  ];
  const KONTRAS = [
    ['Teks utama di halaman', '--ink', '--surface-sunk'], ['Teks utama di kartu', '--ink', '--surface'],
    ['Teks sekunder di halaman', '--ink-muted', '--surface-sunk'], ['Teks sekunder di kartu', '--ink-muted', '--surface'],
    ['Teks redup di permukaan sekunder', '--ink-subtle', '--surface-alt'], ['Badge netral', '--ink-muted', '--surface-alt'],
    ['Peringatan di permukaan sekunder', '--warning', '--surface-alt'], ['Peringatan di halaman', '--warning', '--surface-sunk'],
    ['Sukses di halaman', '--success', '--surface-sunk'], ['Bahaya di halaman', '--danger', '--surface-sunk'],
    ['Info di halaman', '--info', '--surface-sunk'], ['Aksen di halaman', '--accent', '--surface-sunk'],
    ['Putih di aksen', '#FFFFFF', '--accent'],
  ];
  const val = (p, k) => (k.startsWith('#') ? k : p[k]);
  const T = 40;
  const W = 1000;
  const H1 = 60 + PERAN.length * T;
  const H2 = 50 + KONTRAS.length * 30;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H1 + H2 + 20}"><rect width="100%" height="100%" fill="#ffffff"/>`;
  svg += `<text x="16" y="34" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Peran</text><text x="300" y="34" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Sebelum (main)</text><text x="640" y="34" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Sesudah (Fase 1)</text>`;
  PERAN.forEach(([l, k], i) => {
    const y = 48 + i * T;
    const berubah = lama[k] !== baru[k];
    svg += `<text x="16" y="${y + 25}" font-family="sans-serif" font-size="14" fill="#333">${l}${berubah ? '' : ' (tetap)'}</text>`;
    for (const [x, c] of [[300, lama[k]], [640, baru[k]]]) {
      svg += `<rect x="${x}" y="${y + 4}" width="320" height="${T - 8}" rx="6" fill="${c}" stroke="#999"/>`;
      svg += `<text x="${x + 12}" y="${y + 25}" font-family="monospace" font-size="14" fill="${luminans(c) > 0.3 ? '#111' : '#fff'}">${c} ${k}</text>`;
    }
  });
  const y0 = H1 + 20;
  svg += `<text x="16" y="${y0 + 20}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Kontras</text><text x="420" y="${y0 + 20}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Sebelum</text><text x="600" y="${y0 + 20}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">Sesudah</text>`;
  const barisKontras = [];
  KONTRAS.forEach(([l, a, b], i) => {
    const y = y0 + 44 + i * 30;
    const ks = kontras(val(lama, a), val(lama, b));
    const kb = kontras(val(baru, a), val(baru, b));
    barisKontras.push({ l, a, b, ks, kb });
    svg += `<text x="16" y="${y}" font-family="sans-serif" font-size="14" fill="#333">${l}</text>`;
    svg += `<text x="420" y="${y}" font-family="monospace" font-size="14" fill="${ks < 4.5 ? '#B91C1C' : '#333'}">${ks.toFixed(2)}</text>`;
    svg += `<text x="600" y="${y}" font-family="monospace" font-size="14" fill="${kb < 4.5 ? '#B91C1C' : '#333'}">${kb.toFixed(2)}</text>`;
  });
  svg += '</svg>';
  await sharp(Buffer.from(svg)).png({ palette: true, quality: 95, effort: 10 }).toFile(path.join(KELUAR, 'palet-sebelum-sesudah.png'));

  /* --- tangkapan galeri --------------------------------------------- */
  const sA = await sajikan(SEBELUM);
  const sB = await sajikan(SESUDAH);
  const b = await chromium.launch({ executablePath: chromePath() });
  const potret = async (server, layar, keadaan) => {
    const h = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await h.goto(`http://127.0.0.1:${server.address().port}/harness-galeri.html?layar=${layar}&keadaan=${keadaan}`);
    await h.waitForSelector('.kasir-konten');
    await h.waitForTimeout(1200);
    const buf = await h.locator('.galeri-panggung > *').first().screenshot();
    await h.close();
    return buf;
  };
  const berkas = [];
  for (const [layar, keadaan] of LAYAR) {
    const a = await potret(sA, layar, keadaan);
    const c = await potret(sB, layar, keadaan);
    const { width: w, height: hh } = await sharp(a).metadata();
    const gabung = await sharp({ create: { width: w * 2 + 12, height: hh + 36, channels: 3, background: '#1e292b' } })
      .composite([
        { input: label(`SEBELUM · ${layar} ${keadaan} · main`, w), left: 0, top: 0 },
        { input: label(`SESUDAH · ${layar} ${keadaan} · Fase 1`, w), left: w + 12, top: 0 },
        { input: a, left: 0, top: 36 },
        { input: c, left: w + 12, top: 36 },
      ])
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
    const nama = `${layar}--${keadaan}.png`;
    fs.writeFileSync(path.join(KELUAR, nama), gabung);
    berkas.push(nama);
  }
  await b.close();
  sA.close();
  sB.close();
  console.log(JSON.stringify({ berkas, kontras: barisKontras.map((k) => `${k.l}: ${k.ks.toFixed(2)} → ${k.kb.toFixed(2)}`) }, null, 1));
}

await main();
