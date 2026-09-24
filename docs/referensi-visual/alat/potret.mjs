// Memotret setiap kombinasi aplikasi × layar × keadaan dari design-explorer.
//
// ⛔ Daftarnya dibaca dari BERKAS (`const APPS = [...]` di
// `sumber/design-explorer.html`), lalu dicocokkan dengan opsi dropdown yang
// benar-benar dirender bar Penjelajah. Dua sumber yang harus sepakat; yang
// tidak sepakat menghentikan run.
//
// ⛔ Navigasi lewat BAR PENJELAJAH: klik chip aplikasi, `selectOption` pada
// dropdown layar dan keadaan. Tidak ada URL iframe yang dirakit sendiri, dan
// tidak ada alur yang disimulasikan. Sesudah memilih, `src` iframe diperiksa
// memuat `screen`/`state` yang diminta — bukti bahwa pilihan itu yang tampil.
//
// Viewport halaman Penjelajah dibuat cukup besar supaya `scale` Frame = 1,
// lalu yang dipotret adalah elemen iframe-nya: tepat 1280×800 / 1440×900 /
// 390×844 piksel, tanpa bingkai perangkat.
//
//   node potret.mjs [--panen berkas.txt]   lintasan 1: panen kelas saja
//   node potret.mjs                        lintasan 2: potret

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const SUMBER = path.resolve(DI_SINI, '..', 'sumber');
const VENDOR = path.join(DI_SINI, '.vendor');
const KELUAR = path.resolve(DI_SINI, '..', 'layar');
const iPanen = process.argv.indexOf('--panen');
const PANEN = iPanen > -1 ? process.argv[iPanen + 1] : null;

/** Chromium yang sudah terpasang di lingkungan; tidak pernah mengunduh. */
export function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const dasar = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (dasar && fs.existsSync(dasar)) {
    const cocok = fs
      .readdirSync(dasar)
      .filter((d) => /^chromium-\d+$/.test(d))
      .map((d) => path.join(dasar, d, 'chrome-linux', 'chrome'))
      .filter((p) => fs.existsSync(p));
    if (cocok.length > 0) return cocok[cocok.length - 1];
  }
  return undefined;
}

/** Nama berkas untuk layar yang tidak punya dropdown keadaan. */
export const TANPA_KEADAAN = 'tunggal';

// ---------------------------------------------------------------------------
// 1. Daftar dari berkas

export function bacaApps() {
  const html = fs.readFileSync(path.join(SUMBER, 'design-explorer.html'), 'utf8');
  const m = html.match(/const APPS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('`const APPS = [...]` tidak ditemukan di design-explorer.html');
  // Literal objek JS murni (tanpa fungsi, tanpa referensi) — dievaluasi apa adanya.
  return new Function(`return ${m[1]};`)();
}

export function kombinasi(apps) {
  const semua = [];
  for (const app of apps) {
    for (const layar of app.screens) {
      const keadaan = layar.states ?? [null];
      for (const k of keadaan) {
        semua.push({
          app,
          layar,
          keadaan: k,
          berkas: `${app.id}--${layar.id}--${k ? k.id : TANPA_KEADAAN}.png`,
        });
      }
    }
  }
  return semua;
}

// ---------------------------------------------------------------------------
// 2. Server statis + pengganti CDN

function sajikan() {
  const JENIS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain' };
  const server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(SUMBER, nama === '/' ? 'design-explorer.html' : nama);
    if (!berkas.startsWith(SUMBER) || !fs.existsSync(berkas) || fs.statSync(berkas).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream' });
    fs.createReadStream(berkas).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** Foto Unsplash tidak dapat diunduh; penggantinya MENYATAKAN dirinya pengganti. */
function fotoPengganti(url) {
  const u = new URL(url);
  const w = Number(u.searchParams.get('w')) || 300;
  const h = Number(u.searchParams.get('h')) || 200;
  const fs_ = Math.max(9, Math.round(Math.min(w, h) / 9));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#c9d3d2"/>` +
    `<path d="M0 ${h} L${w} 0" stroke="#b3bfbe" stroke-width="2"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${fs_}" fill="#56696a">foto Unsplash</text>` +
    `<text x="50%" y="${50 + fs_ * 0.9 * 100 / h}%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${Math.round(fs_ * 0.8)}" fill="#56696a">tidak terunduh</text>` +
    `</svg>`
  );
}

async function pasangRute(konteks, catatan) {
  const kirim = (route, berkas, jenis) =>
    route.fulfill({ status: 200, contentType: jenis, body: fs.readFileSync(path.join(VENDOR, berkas)), headers: { 'access-control-allow-origin': '*' } });
  await konteks.route('https://cdn.tailwindcss.com/**', (r) => kirim(r, 'tailwind-cdn.js', 'text/javascript'));
  await konteks.route('https://cdn.tailwindcss.com', (r) => kirim(r, 'tailwind-cdn.js', 'text/javascript'));
  await konteks.route('https://unpkg.com/@babel/standalone@7.24.7/**', (r) => kirim(r, 'babel.min.js', 'text/javascript'));
  await konteks.route('https://esm.sh/**', (r) => {
    const u = r.request().url();
    if (/esm\.sh\/react@19(\?|$)/.test(u)) return kirim(r, 'react.mjs', 'text/javascript');
    if (/esm\.sh\/react-dom@19\/client/.test(u)) return kirim(r, 'react-dom-client.mjs', 'text/javascript');
    if (/esm\.sh\/lucide-react@0\.468\.0/.test(u)) return kirim(r, 'lucide-react.mjs', 'text/javascript');
    catatan.tidakDikenal.add(u);
    return r.fulfill({ status: 404, body: '' });
  });
  const petaFont = JSON.parse(fs.readFileSync(path.join(VENDOR, 'font', 'peta.json'), 'utf8'));
  await konteks.route('https://fonts.googleapis.com/**', (r) => kirim(r, 'font/google.css', 'text/css'));
  await konteks.route('https://fonts.gstatic.com/**', (r) => {
    const nama = petaFont[r.request().url()];
    if (!nama) {
      catatan.tidakDikenal.add(r.request().url());
      return r.fulfill({ status: 404, body: '' });
    }
    return kirim(r, `font/${nama}`, 'font/woff2');
  });
  await konteks.route('https://images.unsplash.com/**', (r) => {
    catatan.foto.add(r.request().url());
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: fotoPengganti(r.request().url()) });
  });
}

// ---------------------------------------------------------------------------
// 3. Kendali bar Penjelajah

async function tungguIframe(hal, harap) {
  const iframe = hal.locator('iframe');
  await hal.waitForFunction(
    ({ screen, state }) => {
      const f = document.querySelector('iframe');
      if (!f) return false;
      const q = new URL(f.src).searchParams;
      return q.get('screen') === screen && (state === null ? !q.has('state') : q.get('state') === state);
    },
    harap,
    { timeout: 15_000 }
  );
  const bingkai = await (await iframe.elementHandle()).contentFrame();
  await bingkai.waitForLoadState('load');
  await bingkai.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20_000 });
  await bingkai.evaluate(() => document.fonts.ready);
  await bingkai.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10_000 });
  await hal.waitForTimeout(400);
  return { iframe, bingkai };
}

async function opsiDropdown(hal, indeks) {
  return hal.$$eval('select', (s, i) => (s[i] ? [...s[i].options].map((o) => o.value) : null), indeks);
}

async function main() {
  const apps = bacaApps();
  const semua = kombinasi(apps);
  const catatan = { foto: new Set(), tidakDikenal: new Set(), galat: {}, kelas: new Set() };
  const server = await sajikan();
  const alamat = `http://127.0.0.1:${server.address().port}/design-explorer.html`;

  const peramban = await chromium.launch({ executablePath: chromePath() });
  const konteks = await peramban.newContext({ viewport: { width: 1520, height: 1120 }, deviceScaleFactor: 1 });
  await pasangRute(konteks, catatan);
  const hal = await konteks.newPage();
  let galatSaatIni = null;
  const catatGalat = (teks) => galatSaatIni && galatSaatIni.push(teks);
  hal.on('pageerror', (e) => catatGalat(`pageerror: ${e.message}`));
  hal.on('console', (m) => m.type() === 'error' && catatGalat(`console: ${m.text()}`));
  hal.on('frameattached', () => undefined);
  konteks.on('page', () => undefined);

  await hal.goto(alamat, { waitUntil: 'load' });
  await hal.waitForSelector('select', { timeout: 20_000 });
  /* Panel "Info layar" Penjelajah terbuka bawaan dan `position: fixed` di
     pojok kanan bawah HALAMAN — ia menimpa iframe back-office (1440 px lebar)
     dan ikut terpotret. Ditutup lewat tombolnya sendiri, dan ketiadaannya
     ditegaskan sebelum setiap potret. */
  await hal.getByTitle('Info layar').click();

  if (!PANEN) fs.mkdirSync(KELUAR, { recursive: true });
  const hasil = [];
  const gagal = [];

  for (const app of apps) {
    await hal.getByRole('button', { name: app.label, exact: true }).click();
    await hal.waitForTimeout(300);

    /* ⛔ Sumber kedua: opsi yang BENAR-BENAR dirender dropdown layar. */
    const opsiLayar = await opsiDropdown(hal, 0);
    const harapLayar = app.screens.map((s) => s.id);
    if (JSON.stringify(opsiLayar) !== JSON.stringify(harapLayar)) {
      throw new Error(`dropdown layar ${app.id} tidak sepakat dengan APPS: ${opsiLayar} vs ${harapLayar}`);
    }

    for (const layar of app.screens) {
      await hal.locator('select').nth(0).selectOption(layar.id);
      const daftarKeadaan = layar.states ?? [null];
      if (layar.states) {
        const opsiKeadaan = await opsiDropdown(hal, 1);
        const harapKeadaan = layar.states.map((s) => s.id);
        if (JSON.stringify(opsiKeadaan) !== JSON.stringify(harapKeadaan)) {
          throw new Error(`dropdown keadaan ${app.id}/${layar.id} tidak sepakat: ${opsiKeadaan} vs ${harapKeadaan}`);
        }
      } else if ((await hal.locator('select').count()) !== 1) {
        throw new Error(`${app.id}/${layar.id} tanpa keadaan tetapi dropdown keadaan dirender`);
      }

      for (const k of daftarKeadaan) {
        const berkas = `${app.id}--${layar.id}--${k ? k.id : TANPA_KEADAAN}.png`;
        galatSaatIni = [];
        try {
          if (k) await hal.locator('select').nth(1).selectOption(k.id);
          const { iframe, bingkai } = await tungguIframe(hal, { screen: layar.id, state: k ? k.id : null });
          if (PANEN) {
            const kls = await bingkai.evaluate(() => [...document.querySelectorAll('[class]')].flatMap((e) => [...e.classList]));
            kls.forEach((c) => catatan.kelas.add(c));
          } else {
            const tujuan = path.join(KELUAR, berkas);
            /* Klip dari kotak iframe, dibulatkan: bingkai HP memusatkan iframe
               pada koordinat pecahan, dan `iframe.screenshot()` lalu
               menghasilkan 390×845. Yang dipotret tetap piksel iframe saja. */
            if ((await hal.getByText('Info layar', { exact: true }).count()) !== 0) {
              throw new Error('panel Info layar masih terbuka dan akan menimpa tangkapan');
            }
            const kotak = await iframe.boundingBox();
            await hal.screenshot({
              path: tujuan,
              clip: { x: Math.round(kotak.x), y: Math.round(kotak.y), width: app.device.w, height: app.device.h },
            });
            const meta = await sharp(tujuan).metadata();
            if (meta.width !== app.device.w || meta.height !== app.device.h) {
              throw new Error(`ukuran ${meta.width}×${meta.height}, bukan ${app.device.w}×${app.device.h}`);
            }
          }
          if (galatSaatIni.length) catatan.galat[berkas] = galatSaatIni;
          hasil.push(berkas);
        } catch (e) {
          gagal.push({ berkas, sebab: e.message.split('\n')[0] });
        }
        galatSaatIni = null;
      }
    }
  }

  await peramban.close();
  server.close();

  /* Kompresi: PNG berpalet (kuantisasi ≤256 warna). Teks tetap terbaca, ukuran
     turun ~⅓. ⛔ Akibatnya WARNA PIKSEL di tangkapan tidak lagi persis; setiap
     angka warna di laporan diukur dari DOM (`ukur.mjs`), bukan dari gambar. */
  let byteMentah = 0;
  let byteAkhir = 0;
  if (!PANEN) {
    for (const f of hasil) {
      const p = path.join(KELUAR, f);
      const mentah = fs.readFileSync(p);
      const akhir = await sharp(mentah).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
      byteMentah += mentah.length;
      byteAkhir += akhir.length;
      fs.writeFileSync(p, akhir);
    }
  }

  if (PANEN) fs.writeFileSync(PANEN, [...catatan.kelas].sort().map((c) => `<i class="${c}"></i>`).join('\n'));

  const laporan = {
    lintasan: PANEN ? 'panen-kelas' : 'potret',
    kombinasiDariBerkas: semua.length,
    perAplikasi: Object.fromEntries(
      apps.map((a) => [a.id, { layar: a.screens.length, kombinasi: semua.filter((s) => s.app === a).length }])
    ),
    berhasil: hasil.length,
    gagal,
    kelasDipanen: PANEN ? catatan.kelas.size : undefined,
    fotoDiganti: catatan.foto.size,
    byteMentah: PANEN ? undefined : byteMentah,
    byteAkhir: PANEN ? undefined : byteAkhir,
    urlEsmTakDikenal: [...catatan.tidakDikenal],
    galatKonsol: catatan.galat,
  };
  console.log(JSON.stringify(laporan, null, 2));
  if (hasil.length !== semua.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
