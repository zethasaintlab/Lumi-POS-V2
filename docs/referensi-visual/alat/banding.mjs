// Memasangkan layar mockup dengan layar galeri kasir MENURUT FUNGSI, memotret
// keduanya pada viewport yang sama, menggabungkannya berdampingan, dan
// mengukur selisihnya dari DOM + piksel.
//
// ⛔ Viewport: mockup Kasir dirancang 1280×800. Galeri merender panggung
// TETAP 1024×768 (`apps/kasir/src/galeri/galeri.css`, PRD:428). Supaya
// "viewport sama", panggung galeri diperbesar ke 1280×800 lewat CSS yang
// DISUNTIKKAN di harness ini saja — kode galeri tidak disentuh. Kepadatan
// galeri pada 1024×768 aslinya diukur juga (`asli1024`), karena itu yang
// PRD wajibkan.
//
// ⛔ Mockup dimuat LANGSUNG dari `ui_kits/kasir/index.html?embed=1&…` — URL
// yang sama persis dengan yang iframe Penjelajah muat — supaya DOM-nya dapat
// diukur. Tangkapan kirinya diambil ulang tanpa kompresi, lalu hasil gabungan
// dikompres.
//
//   (di akar repo) npm run build:galeri
//   node banding.mjs

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromePath } from './potret.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const AKAR_REF = path.resolve(DI_SINI, '..');
const SUMBER = path.join(AKAR_REF, 'sumber');
const VENDOR = path.join(DI_SINI, '.vendor');
const GALERI = path.resolve(AKAR_REF, '..', '..', 'dist-galeri');
const KELUAR = path.join(AKAR_REF, 'banding');
const W = 1280;
const H = 800;

/** Pemetaan MENURUT FUNGSI. Kiri = keadaan mockup, kanan = keadaan galeri. */
export const PASANGAN = [
  { galeri: 'K-03', mockup: 'kasir', pasang: [
    ['campuran', 'normal'],
    ['keranjang-kosong', 'normal'],
    ['keranjang-penuh', 'keranjang-penuh'],
    ['katalog-kosong', 'kosong'],
    ['offline', 'offline'],
  ] },
  { galeri: 'K-08', mockup: 'riwayat', pasang: [
    ['ada', 'normal'],
    ['kosong', 'kosong'],
  ] },
  { galeri: 'K-12', mockup: 'tutup', pasang: [[null, 'normal']] },
];

export function sajikan(akar, bawaan) {
  const JENIS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(akar, nama === '/' ? bawaan : nama);
    if (!berkas.startsWith(akar) || !fs.existsSync(berkas) || fs.statSync(berkas).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream' });
    fs.createReadStream(berkas).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

export async function pasangRuteMockup(konteks) {
  const kirim = (route, berkas, jenis) => route.fulfill({ status: 200, contentType: jenis, body: fs.readFileSync(path.join(VENDOR, berkas)) });
  const petaFont = JSON.parse(fs.readFileSync(path.join(VENDOR, 'font', 'peta.json'), 'utf8'));
  await konteks.route('https://cdn.tailwindcss.com/**', (r) => kirim(r, 'tailwind-cdn.js', 'text/javascript'));
  await konteks.route('https://unpkg.com/@babel/standalone@7.24.7/**', (r) => kirim(r, 'babel.min.js', 'text/javascript'));
  await konteks.route('https://esm.sh/**', (r) => {
    const u = r.request().url();
    const f = /react-dom@19\/client/.test(u) ? 'react-dom-client.mjs' : /lucide-react/.test(u) ? 'lucide-react.mjs' : 'react.mjs';
    return kirim(r, f, 'text/javascript');
  });
  await konteks.route('https://fonts.googleapis.com/**', (r) => kirim(r, 'font/google.css', 'text/css'));
  await konteks.route('https://fonts.gstatic.com/**', (r) => kirim(r, `font/${petaFont[r.request().url()]}`, 'font/woff2'));
  await konteks.route('https://images.unsplash.com/**', (r) => {
    const u = new URL(r.request().url());
    const w = u.searchParams.get('w') ?? 300;
    const h = u.searchParams.get('h') ?? 200;
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#c9d3d2"/></svg>` });
  });
}

// ---------------------------------------------------------------------------
// Pengukuran di dalam halaman. `akar` = elemen yang mewakili layar (viewport).

/* eslint-disable */
export function ukurDiHalaman({ akarSel, varAksen }) {
  const akar = akarSel ? document.querySelector(akarSel) : document.documentElement;
  const R = akar.getBoundingClientRect();
  const vw = akarSel ? R.width : innerWidth;
  const vh = akarSel ? R.height : innerHeight;
  const ox = akarSel ? R.left : 0;
  const oy = akarSel ? R.top : 0;
  const kotak = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left - ox), y: Math.round(r.top - oy), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const nama = (e) => {
    const t = (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = typeof e.className === 'string' ? e.className.split(/\s+/).filter((c) => !c.includes('[')).slice(0, 3).join('.') : '';
    return `${e.tagName.toLowerCase()}${k ? '.' + k : ''}${t ? ` "${t}"` : ''}`;
  };
  const semua = [...akar.querySelectorAll('*')];
  const terlihat = (r) => r.width > 0 && r.height > 0 && r.bottom > oy && r.top < oy + vh && r.right > ox && r.left < ox + vw;

  const gulir = semua
    .filter((e) => {
      const s = getComputedStyle(e);
      return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 40;
    })
    .map((e) => ({ el: nama(e).slice(0, 60), ...kotak(e), tinggiIsi: e.scrollHeight, tinggiTampak: e.clientHeight }));
  const halamanGulir = document.scrollingElement.scrollHeight > innerHeight + 1;

  const tempel = semua
    .filter((e) => /(fixed|sticky)/.test(getComputedStyle(e).position) && terlihat(e.getBoundingClientRect()))
    .map((e) => ({ el: nama(e).slice(0, 60), posisi: getComputedStyle(e).position, ...kotak(e) }));

  const aksen = getComputedStyle(document.documentElement).getPropertyValue(varAksen).trim();
  const uji = document.createElement('i');
  uji.style.color = aksen;
  document.body.appendChild(uji);
  const aksenRgb = getComputedStyle(uji).color;
  uji.remove();
  const aksi = semua
    .filter((e) => (e.matches('button, a, [role="button"]')) && getComputedStyle(e).backgroundColor === aksenRgb && terlihat(e.getBoundingClientRect()))
    .map((e) => ({ el: nama(e), ...kotak(e) }));

  /* Kartu: kontainer grid dengan anak langsung terbanyak (≥4). */
  const grid = semua
    .filter((e) => getComputedStyle(e).display === 'grid' && e.children.length >= 4)
    .sort((a, b) => b.children.length - a.children.length)[0];
  let kartu = null;
  if (grid) {
    const s = getComputedStyle(grid);
    /* Batas tampak = irisan viewport dengan setiap leluhur yang memotong. */
    let batasAtas = oy, batasBawah = oy + vh;
    for (let p = grid; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) {
        const r = p.getBoundingClientRect();
        batasAtas = Math.max(batasAtas, r.top);
        batasBawah = Math.min(batasBawah, r.bottom);
      }
    }
    const anak = [...grid.children].map((c) => c.getBoundingClientRect());
    const tinggi = anak.map((r) => Math.round(r.height)).sort((a, b) => a - b);
    const penuh = anak.filter((r) => r.top >= batasAtas - 0.5 && r.bottom <= batasBawah + 0.5).length;
    kartu = {
      grid: nama(grid).slice(0, 50),
      jumlah: anak.length,
      kolom: s.gridTemplateColumns.split(' ').length,
      tinggiMedian: tinggi[Math.floor(tinggi.length / 2)],
      lebar: Math.round(anak[0].width),
      terlihatPenuh: penuh,
      jarakKolom: s.columnGap,
      jarakBaris: s.rowGap,
    };
  }

  /* Tipografi: per karakter teks yang terlihat. */
  const tip = {};
  const warnaTeks = {};
  const jalan = document.createTreeWalker(akar, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = jalan.nextNode())) {
    const t = n.textContent.replace(/\s+/g, '');
    if (!t) continue;
    const e = n.parentElement;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    const r = rg.getBoundingClientRect();
    if (!terlihat(r)) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.opacity === '0') continue;
    const k = `${s.fontSize}/${s.fontWeight}`;
    tip[k] = (tip[k] || 0) + t.length;
    warnaTeks[s.color] = (warnaTeks[s.color] || 0) + t.length;
  }
  const keluarga = getComputedStyle(akar.querySelector('button, p, span, div') || akar).fontFamily;
  return {
    viewport: `${Math.round(vw)}×${Math.round(vh)}`,
    halamanGulir,
    gulir,
    tempel,
    aksenVar: `${varAksen}: ${aksen}`,
    aksenRgb,
    aksiBerwarnaAksen: aksi,
    kartu,
    tipografi: Object.entries(tip).sort((a, b) => b[1] - a[1]),
    warnaTeks: Object.entries(warnaTeks).sort((a, b) => b[1] - a[1]).slice(0, 6),
    keluargaFont: keluarga,
  };
}
/* eslint-enable */

/** Warna permukaan dari PIKSEL tangkapan mentah (bukan yang terkompres). */
export async function histogram(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const peta = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    peta.set(k, (peta.get(k) ?? 0) + 1);
  }
  const total = info.width * info.height;
  return [...peta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => [`#${k.toString(16).padStart(6, '0')}`, `${((v / total) * 100).toFixed(1)}%`]);
}

export function label(teks, lebar) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lebar}" height="40"><rect width="100%" height="100%" fill="#1e292b"/>` +
      `<text x="16" y="26" font-family="sans-serif" font-size="17" fill="#e7eeee">${teks}</text></svg>`
  );
}

async function main() {
  if (!fs.existsSync(path.join(GALERI, 'harness-galeri.html'))) {
    throw new Error('dist-galeri/ belum dibangun. Jalankan `npm run build:galeri` di akar repo lebih dulu.');
  }
  fs.mkdirSync(KELUAR, { recursive: true });
  const sMock = await sajikan(SUMBER, 'design-explorer.html');
  const sGal = await sajikan(GALERI, 'harness-galeri.html');
  const peramban = await chromium.launch({ executablePath: chromePath() });

  const kMock = await peramban.newContext({ viewport: { width: W, height: H } });
  await pasangRuteMockup(kMock);
  const kGal = await peramban.newContext({ viewport: { width: 1400, height: 1100 } });
  const kGal1024 = await peramban.newContext({ viewport: { width: 1200, height: 1000 } });

  const hasil = [];
  for (const p of PASANGAN) {
    for (const [kMockup, kGaleri] of p.pasang) {
      const idMock = `kasir--${p.mockup}--${kMockup ?? 'tunggal'}`;
      const idGal = `${p.galeri}--${kGaleri}`;

      const hm = await kMock.newPage();
      const qs = new URLSearchParams({ embed: '1', screen: p.mockup });
      if (kMockup) qs.set('state', kMockup);
      await hm.goto(`http://127.0.0.1:${sMock.address().port}/ui_kits/kasir/index.html?${qs}`, { waitUntil: 'load' });
      await hm.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20_000 });
      await hm.evaluate(() => document.fonts.ready);
      await hm.waitForTimeout(500);
      const bufMock = await hm.screenshot();
      const ukurMock = await hm.evaluate(ukurDiHalaman, { akarSel: null, varAksen: '--primary' });
      await hm.close();

      const ukurGaleri = async (konteks, lebar, tinggi) => {
        const hg = await konteks.newPage();
        await hg.goto(`http://127.0.0.1:${sGal.address().port}/harness-galeri.html?layar=${p.galeri}&keadaan=${kGaleri}`, { waitUntil: 'load' });
        if (lebar !== 1024) {
          await hg.addStyleTag({
            content: `.galeri-panggung > * { width: ${lebar}px !important; height: ${tinggi}px !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }`,
          });
        } else {
          await hg.addStyleTag({ content: `.galeri-panggung > * { border: 0 !important; border-radius: 0 !important; }` });
        }
        await hg.waitForSelector('.kasir-konten', { timeout: 15_000 });
        await hg.evaluate(() => document.fonts.ready);
        await hg.waitForTimeout(1200);
        const el = hg.locator('.galeri-panggung > *').first();
        const buf = await el.screenshot();
        const u = await hg.evaluate(ukurDiHalaman, { akarSel: '.galeri-panggung > *', varAksen: '--accent' });
        await hg.close();
        return { buf, u };
      };
      const g = await ukurGaleri(kGal, W, H);
      const g1024 = await ukurGaleri(kGal1024, 1024, 768);

      const metaG = await sharp(g.buf).metadata();
      if (metaG.width !== W || metaG.height !== H) throw new Error(`${idGal}: tangkapan galeri ${metaG.width}×${metaG.height}`);

      const CELAH = 16;
      const gabung = await sharp({ create: { width: W * 2 + CELAH, height: H + 40, channels: 3, background: '#1e292b' } })
        .composite([
          { input: label(`MOCKUP · ${idMock}`, W), left: 0, top: 0 },
          { input: label(`GALERI · ${p.galeri} ${kGaleri} (1280×800 disuntikkan)`, W), left: W + CELAH, top: 0 },
          { input: bufMock, left: 0, top: 40 },
          { input: g.buf, left: W + CELAH, top: 40 },
        ])
        .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
        .toBuffer();
      const berkas = `${p.galeri}--${kGaleri}__${p.mockup}--${kMockup ?? 'tunggal'}.png`;
      fs.writeFileSync(path.join(KELUAR, berkas), gabung);

      hasil.push({
        berkas,
        mockup: idMock,
        galeri: idGal,
        mockupUkur: { ...ukurMock, pikselTeratas: await histogram(bufMock) },
        galeriUkur: { ...g.u, pikselTeratas: await histogram(g.buf) },
        galeriAsli1024: { kartu: g1024.u.kartu, gulir: g1024.u.gulir, aksiBerwarnaAksen: g1024.u.aksiBerwarnaAksen },
      });
    }
  }
  await peramban.close();
  sMock.close();
  sGal.close();
  fs.writeFileSync(path.join(DI_SINI, '.vendor', 'banding.json'), JSON.stringify(hasil, null, 1));
  console.log(JSON.stringify({ pasangan: hasil.length, berkas: hasil.map((h) => h.berkas) }, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
