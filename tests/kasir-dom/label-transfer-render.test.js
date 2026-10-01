'use strict';

// ⛔ S24 — komponen SUNGGUHAN (B-03, B-16, K-09) merender "Transfer" untuk transfer.
//
// Test yang memanggil `labelMetode(...)` dari domain tidak membuktikan komponen
// MEMANGGILNYA dengan provider. Di sini komponen asli di-bundle dengan esbuild
// (hanya sumber data yang di-stub), dirender di Chromium, dan teksnya dibaca dari DOM.
//
// Tanpa prasyarat build lain; butuh Chromium Playwright seperti test kasir-dom lain.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');

function chromePath() {
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

// Sumber data yang di-stub. Semuanya membaca `window.__FIX`.
const STUB = [
  [/klien-api\/src\/sesi\.tsx$/, `
    export function useSesi() {
      return { api: { minta: async (url) => (/outlets/.test(url) ? [] : window.__FIX) } };
    }`],
  [/konteks\/DbLokalProvider\.tsx$/, `export function useDbLokal() { return { db: {} }; }`],
  [/konteks\/useSesi\.ts$/, `export function useSesi() { return { sesi: { userId: 'u', nama: 'Sari', peran: ['cashier'] } }; }`],
  [/riwayat\/baca\.ts$/, `export async function bacaDetail() { return window.__FIX; }`],
  [/sync-client\/src\/perangkat\.ts$/, `export async function bacaKonfigPerangkat() { return { outletId: 'o1', deviceId: 'd1' }; }`],
];

async function bundel(entri) {
  const esbuild = require('esbuild');
  const hasil = await esbuild.build({
    stdin: { contents: entri, resolveDir: AKAR, loader: 'tsx', sourcefile: 'entri.tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty', '.woff2': 'empty', '.woff': 'empty', '.svg': 'empty', '.png': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
    plugins: [{
      name: 'stub-sumber-data',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          if (a.namespace === 'stub' || !a.path.startsWith('.')) return undefined;
          const abs = path.resolve(a.resolveDir, a.path).replace(/\\/g, '/');
          const cocok = STUB.findIndex(([re]) => re.test(abs.replace(/\.(tsx?|jsx?)$/, '') + path.extname(a.path)) || re.test(abs));
          return cocok >= 0 ? { path: String(cocok), namespace: 'stub' } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUB[Number(a.path)][1], loader: 'js' }));
      },
    }],
  });
  return hasil.outputFiles[0].text;
}

let peramban;
before(async () => {
  const { chromium } = require('playwright');
  peramban = await chromium.launch({ executablePath: chromePath() });
});
after(async () => {
  if (peramban) await peramban.close();
});

async function render(entri, fixture, tunggu) {
  const kode = await bundel(entri);
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await hal.evaluate((f) => { window.__FIX = f; }, fixture);
  await hal.addScriptTag({ content: kode });
  await hal.waitForFunction(tunggu, null, { timeout: 10_000 }).catch(() => {});
  const teks = await hal.evaluate(() => document.body.innerText);
  await hal.close();
  assert.deepEqual(galat, [], `komponen melempar: ${galat.join(' | ')}`);
  return teks;
}

const MONTASI = (impor, pakai) => `
  import { createRoot } from 'react-dom/client';
  ${impor}
  createRoot(document.getElementById('root')).render(${pakai});
`;

test('⛔ B-03 Detail transaksi (backoffice): pembayaran other+bank_transfer terbaca "Transfer"', async () => {
  const detail = {
    id: 'o1', receiptNumber: 'K1-20260822-0001', businessDate: '2026-08-22', sequence: 1, outletId: 'ou',
    channel: 'takeaway', status: 'closed', createdBy: 'u', createdByNama: 'Sari',
    occurredAt: '2026-08-22T07:00:00Z', subtotal: '20000', orderDiscount: '0', serviceChargeAmount: '0',
    taxAmount: '0', roundingAdjustment: '0', total: '20000', amountDue: '20000',
    hasCalculationVariance: false, varianceAmount: null, dibatalkanOleh: null, dibatalkanPada: null,
    lines: [], refunds: [], totalDibayar: '20000', totalRefund: '0',
    payments: [{
      id: 'p1', method: 'other', provider: 'bank_transfer', amount: '20000', tenderedAmount: null,
      changeAmount: null, status: 'confirmed', confirmedManually: true, cardLast4: null,
      occurredAt: '2026-08-22T07:00:00Z',
    }],
  };
  const teks = await render(
    MONTASI(
      `import { DetailTransaksiModal } from './apps/backoffice/src/penjualan/Detail.tsx';`,
      `<DetailTransaksiModal orderId="o1" onTutup={() => {}} />`
    ),
    detail,
    () => /Struk K1/.test(document.body.innerText)
  );
  assert.match(teks, /Struk K1-20260822-0001/, 'detail tidak termuat');
  assert.match(teks, /Transfer/, 'B-03 tidak menampilkan "Transfer"');
  assert.doesNotMatch(teks, /Lainnya/, 'B-03 menampilkan transfer sebagai "Lainnya"');
});

test('⛔ B-16 Laporan Pembayaran: baris transfer terbaca "Transfer"', async () => {
  const hasil = {
    from: '2026-08-22', to: '2026-08-22', outletId: null,
    metode: [
      { method: 'cash', jumlahTransaksi: 1, totalDiterima: '10000', perkiraanMdr: null, perkiraanSettlement: '10000' },
      { method: 'transfer', jumlahTransaksi: 2, totalDiterima: '75000', perkiraanMdr: null, perkiraanSettlement: '75000' },
    ],
    totalDiterima: '85000', totalPerkiraanMdr: '0', totalPerkiraanSettlement: '85000',
  };
  const teks = await render(
    MONTASI(
      `import { PembayaranLayar } from './apps/backoffice/src/laporan/Pembayaran.tsx';`,
      `<PembayaranLayar />`
    ),
    hasil,
    () => /Tunai/.test(document.body.innerText)
  );
  assert.match(teks, /Tunai/, 'laporan tidak termuat');
  assert.match(teks, /Transfer/, 'B-16 tidak menampilkan "Transfer"');
  assert.doesNotMatch(teks, /Lainnya/, 'B-16 menampilkan transfer sebagai "Lainnya"');
});

test('⛔ K-09 Detail transaksi (kasir): pembayaran other+bank_transfer terbaca "Transfer"', async () => {
  const detail = {
    order: {
      id: 'o1', receiptNumber: 'K1-20260822-0001', businessDate: '2026-08-22', status: 'closed',
      subtotal: 20000, orderDiscount: 0, total: 20000, amountDue: 20000, taxAmount: 0,
      roundingAdjustment: 0, occurredAt: '2026-08-22T07:00:00Z', createdBy: 'Sari', membatalkan: null,
    },
    baris: [],
    pembayaran: [{
      id: 'p1', metode: 'other', provider: 'bank_transfer', jumlah: 20000, diterima: null,
      kembalian: null, status: 'confirmed',
    }],
    refund: [],
    sisaDapatDirefund: 20000,
  };
  const teks = await render(
    MONTASI(
      `import { DetailTransaksi } from './apps/kasir/src/layar/DetailTransaksi.tsx';`,
      `<DetailTransaksi orderId="o1" />`
    ),
    detail,
    () => /K1-20260822/.test(document.body.innerText)
  );
  assert.match(teks, /K1-20260822-0001/, 'detail tidak termuat');
  assert.match(teks, /Transfer/, 'K-09 tidak menampilkan "Transfer"');
  assert.doesNotMatch(teks, /Lainnya/, 'K-09 menampilkan transfer sebagai "Lainnya"');
});
