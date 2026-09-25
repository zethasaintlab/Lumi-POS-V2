// Fase 2 rebuild UI: pasangan mockup ↔ layar kasir yang BARU dapat dicapai
// dari galeri (K-01, K-02, K-09) atau dari jalur klik di galeri (dialog dan
// overlay: K-04/05, K-06, K-07, K-10, K-16, kas masuk/keluar), plus keadaan
// panel QRIS lewat `harness-k06`.
//
// ⛔ Overlay kasir `position: fixed; inset: 0` — ia mengikuti VIEWPORT, bukan
// panggung galeri. Harness ini menyembunyikan chrome galeri dan menaruh
// panggung 1280×800 tepat di (0,0) sebesar viewport, supaya dialog terukur di
// tempat yang sama dengan di perangkat. Kode galeri tidak disentuh.
//
//   (akar repo) npm run build:galeri && npm run build:harness-k06
//   node banding2.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromePath } from './potret.mjs';
import { sajikan, pasangRuteMockup, ukurDiHalaman, histogram, label } from './banding.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const AKAR_REF = path.resolve(DI_SINI, '..');
const AKAR_REPO = path.resolve(AKAR_REF, '..', '..');
const GALERI = path.join(AKAR_REPO, 'dist-galeri');
const K06 = path.join(AKAR_REPO, 'dist-harness-k06');
// `BANDING_KELUAR=sesudah` menulis ke `../sesudah/` (tangkapan Fase 3 rebuild
// UI) dan membiarkan `../banding/` sebagai potret SEBELUM. `BANDING_SARING`
// membatasi ke satu layar mockup (mis. `kasir`), supaya fase satu layar tidak
// menulis ulang tangkapan layar lain.
const KELUAR = path.join(AKAR_REF, process.env.BANDING_KELUAR ?? 'banding');
const SARING = process.env.BANDING_SARING ?? null;
const W = 1280;
const H = 800;

/* Jalur klik — satu tempat, dipakai pengukuran dan (kelak) penjaga Fase 3. */
export const JALUR = {
  modifier: async (h) => h.locator('.kasir-grid > button', { hasText: 'pilihan' }).first().click(),
  bayar: async (h) => h.getByRole('button', { name: 'Bayar', exact: true }).click(),
  kartu: async (h) => {
    await h.getByRole('button', { name: 'Bayar', exact: true }).click();
    await h.waitForTimeout(500);
    await h.getByRole('button', { name: 'Kartu (EDC)' }).click();
  },
  k07: async (h) => {
    await h.getByRole('button', { name: 'Bayar', exact: true }).click();
    await h.waitForTimeout(500);
    for (let i = 0; i < 6; i += 1) await h.getByRole('button', { name: '+ Rp 100.000' }).click();
    await h.getByRole('button', { name: 'Simpan Penjualan' }).click();
    await h.waitForSelector('text=Transaksi Baru', { timeout: 10_000 });
  },
  refund: async (h) => h.getByRole('button', { name: 'Kembalikan dana' }).click(),
  noSale: async (h) => h.getByRole('button', { name: /Buka laci/ }).click(),
  kasManual: async (h) => h.getByRole('button', { name: /Kas masuk/ }).click(),
};

/**
 * Pemetaan MENURUT FUNGSI. `galeri` = [layar, keadaan, jalur?]; `k06` = query
 * `harness-k06`. `catatan` menyatakan bila padanannya tidak setara fungsi.
 */
export const PASANGAN2 = [
  { mockup: ['login', null], galeri: ['K-01', 'normal'] },
  { mockup: ['shift', null], galeri: ['K-02', 'normal'] },
  { mockup: ['edit-item', null], galeri: ['K-03', 'normal', 'modifier'], catatan: 'padanan terdekat; fungsi berbeda (menyunting baris vs memilih opsi sebelum menambah)' },
  { mockup: ['bayar', 'tunai'], galeri: ['K-03', 'keranjang-penuh', 'bayar'] },
  { mockup: ['bayar', 'kartu'], galeri: ['K-03', 'keranjang-penuh', 'kartu'] },
  { mockup: ['bayar', 'qris-siap'], k06: 'render=panel&status=pending' },
  { mockup: ['bayar', 'qris-terkonfirmasi'], k06: 'render=panel&status=confirmed' },
  { mockup: ['bayar', 'qris-kedaluwarsa'], k06: 'render=panel&status=kedaluwarsa' },
  { mockup: ['sukses', null], galeri: ['K-03', 'keranjang-penuh', 'k07'] },
  { mockup: ['riwayat', 'ada'], galeri: ['K-09', 'normal'], catatan: 'detail transaksi — mockup tidak punya layar detail; dipasangkan dengan daftar riwayat' },
  { mockup: ['void', null], galeri: ['K-09', 'normal', 'refund'] },
  { mockup: ['laci', null], galeri: ['K-03', 'normal', 'kasManual'] },
  { mockup: ['laci', null], galeri: ['K-03', 'normal', 'noSale'], akhiran: 'nosale' },
];

const SEMBUNYIKAN_CHROME = `
  .galeri-bar, .galeri-tanya { display: none !important; }
  .galeri-panggung { padding: 0 !important; overflow: hidden !important; }
  .galeri-panggung > * { width: ${W}px !important; height: ${H}px !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
`;

async function main() {
  for (const d of [GALERI, K06]) {
    if (!fs.existsSync(d)) throw new Error(`${path.relative(AKAR_REPO, d)} belum dibangun (npm run build:galeri && npm run build:harness-k06)`);
  }
  fs.mkdirSync(KELUAR, { recursive: true });
  const SUMBER = path.join(AKAR_REF, 'sumber');
  const sMock = await sajikan(SUMBER, 'design-explorer.html');
  const sGal = await sajikan(GALERI, 'harness-galeri.html');
  const sK06 = await sajikan(K06, 'harness-k06.html');
  const peramban = await chromium.launch({ executablePath: chromePath() });
  const kMock = await peramban.newContext({ viewport: { width: W, height: H } });
  await pasangRuteMockup(kMock);
  const kRepo = await peramban.newContext({ viewport: { width: W, height: H } });

  const hasil = [];
  for (const p of PASANGAN2) {
    const [scr, st] = p.mockup;
    if (SARING && scr !== SARING) continue;
    const idMock = `kasir--${scr}--${st ?? 'tunggal'}`;

    const hm = await kMock.newPage();
    const qs = new URLSearchParams({ embed: '1', screen: scr });
    if (st) qs.set('state', st);
    await hm.goto(`http://127.0.0.1:${sMock.address().port}/ui_kits/kasir/index.html?${qs}`);
    await hm.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20_000 });
    await hm.evaluate(() => document.fonts.ready);
    await hm.waitForTimeout(500);
    const bufMock = await hm.screenshot();
    const ukurMock = await hm.evaluate(ukurDiHalaman, { akarSel: null, varAksen: '--primary' });
    await hm.close();

    const hr = await kRepo.newPage();
    const galat = [];
    hr.on('pageerror', (e) => galat.push(e.message));
    let idRepo;
    if (p.k06) {
      idRepo = `K-06 panel ${new URLSearchParams(p.k06).get('status')}`;
      await hr.goto(`http://127.0.0.1:${sK06.address().port}/harness-k06.html?${p.k06}`);
      await hr.waitForTimeout(1500);
    } else {
      const [layar, keadaan, jalur] = p.galeri;
      idRepo = `${layar} ${keadaan}${jalur ? ` → ${jalur}` : ''}`;
      await hr.goto(`http://127.0.0.1:${sGal.address().port}/harness-galeri.html?layar=${layar}&keadaan=${keadaan}`);
      await hr.addStyleTag({ content: SEMBUNYIKAN_CHROME });
      await hr.waitForSelector('.kasir-konten', { timeout: 15_000 });
      await hr.evaluate(() => document.fonts.ready);
      await hr.waitForTimeout(1200);
      if (jalur) {
        await JALUR[jalur](hr);
        await hr.waitForTimeout(900);
      }
    }
    const bufRepo = await hr.screenshot();
    const ukurRepo = await hr.evaluate(ukurDiHalaman, { akarSel: null, varAksen: '--accent' });
    const dialog = await hr.evaluate(() => {
      const d = document.querySelector('.overlay .dialog') ?? document.querySelector('.kasir-dialog') ?? document.querySelector('[role="dialog"]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    await hr.close();

    const CELAH = 16;
    const gabung = await sharp({ create: { width: W * 2 + CELAH, height: H + 40, channels: 3, background: '#1e292b' } })
      .composite([
        { input: label(`MOCKUP · ${idMock}`, W), left: 0, top: 0 },
        { input: label(`REPO · ${idRepo}`, W), left: W + CELAH, top: 0 },
        { input: bufMock, left: 0, top: 40 },
        { input: bufRepo, left: W + CELAH, top: 40 },
      ])
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
    const kodeRepo = idRepo.replace(/[^\w-]+/g, '-').replace(/-+$/, '');
    const berkas = `${kodeRepo}__${scr}--${st ?? 'tunggal'}${p.akhiran ? '--' + p.akhiran : ''}.png`;
    fs.writeFileSync(path.join(KELUAR, berkas), gabung);
    hasil.push({ berkas, mockup: idMock, repo: idRepo, catatan: p.catatan ?? null, galat, dialog, mockupUkur: { ...ukurMock, pikselTeratas: await histogram(bufMock) }, repoUkur: { ...ukurRepo, pikselTeratas: await histogram(bufRepo) } });
  }
  await peramban.close();
  sMock.close();
  sGal.close();
  sK06.close();
  if (!SARING) fs.writeFileSync(path.join(DI_SINI, '.vendor', 'banding2.json'), JSON.stringify(hasil, null, 1));
  console.log(JSON.stringify(hasil.map((h) => ({ berkas: h.berkas, galat: h.galat, dialog: h.dialog })), null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
