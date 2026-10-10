'use strict';

// K-02 — buka shift sebagai KARTU dua kolom, menurut mockup.
//
// Fase 3.8 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-02:
// mockup kartu 624 × 384 dengan ikon dan subjudul, dua kolom field, "Mulai
// Shift" di kanan bawah; repo satu kolom terpusat tanpa kartu. Yang dikejar:
//
//   1. Kartu 624 px (`--surface` + bayangan) dengan ikon.
//   2. Dua kolom: kolom "Saldo awal kas" (awalan Rp, 56 px, nilai bebas)
//      di kiri, "Staf pembuka" sebagai TEKS di kanan — diambil dari sesi,
//      bukan field yang dapat diubah. Keputusan user 28 September 2026
//      (#76): tombol pecahan DIHAPUS, kolom bebas menggantikannya.
//   3. "Mulai Shift" 56 px di kanan bawah kartu.
//
// ## Prasyarat
//
//   npm run build:galeri

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

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

const JENIS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
};

let server;
let alamat;
let peramban;

before(async () => {
  /* ⛔ MENEGASKAN, bukan membangun. Lihat `k03-chrome.test.js`. */
  assert.ok(
    fs.existsSync(path.join(DIST, 'harness-galeri.html')),
    'dist-galeri/ belum dibangun. Jalankan `npm run build:galeri` lebih dulu. ' +
      '(`npm run test:kasir-dom` melakukannya sendiri lewat `pretest:kasir-dom`.)'
  );

  server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(DIST, nama === '/' ? 'harness-galeri.html' : nama);
    if (!berkas.startsWith(DIST) || !fs.existsSync(berkas) || fs.statSync(berkas).isDirectory()) {
      res.writeHead(404).end('tidak ada');
      return;
    }
    res.writeHead(200, { 'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream' });
    fs.createReadStream(berkas).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  alamat = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = require('playwright');
  peramban = await chromium.launch({ executablePath: chromePath() });
});

after(async () => {
  if (peramban) await peramban.close();
  if (server) await new Promise((r) => server.close(r));
});

async function bukaK02(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  hal.setDefaultTimeout(3000); // elemen yang hilang gagal CEPAT dengan pesan, bukan timeout 30 detik
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-02&keadaan=normal`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        '.galeri-panggung>*{width:1280px!important;height:800px!important;border:0!important;border-radius:0!important;box-shadow:none!important}',
    });
  }
  await hal.waitForSelector('text=Mulai Shift', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(300);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const h1 = [...document.querySelectorAll('.kasir-konten h1')].find((h) => h.textContent.trim() === 'Buka Shift');
    let kartu = null;
    for (let e = h1?.parentElement; e && !e.classList.contains('kasir-konten'); e = e.parentElement) {
      if (getComputedStyle(e).boxShadow !== 'none' && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') { kartu = e; break; }
    }
    const semua = kartu ? [...kartu.querySelectorAll('*')] : [];
    const label = semua.find((e) => e.tagName === 'LABEL' && e.textContent.trim() === 'Saldo awal kas');
    const kolom = label && document.getElementById(label.htmlFor);
    const staf = semua.find((e) => e.children.length === 0 && e.textContent.trim() === 'Staf pembuka');
    const mulai = kartu && [...kartu.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mulai Shift');
    const tombolPecahan = kartu ? [...kartu.querySelectorAll('button')].filter((b) => b.textContent.trim().startsWith('+')) : [];
    const token = (nama) => {
      const e = document.createElement('div');
      e.style.background = `var(${nama})`;
      document.body.appendChild(e);
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    };
    return {
      panggung: Math.round(document.querySelector('.galeri-panggung > *').getBoundingClientRect().width),
      kartu: kartu && r(kartu),
      ikon: Boolean(kartu?.querySelector('svg')),
      kolom: kolom && r(kolom),
      staf: staf && r(staf),
      teksKartu: kartu?.innerText.replace(/\s+/g, ' ') ?? '',
      mulai: mulai && r(mulai),
      jumlahPecahan: tombolPecahan.length,
      padding: kartu ? parseFloat(getComputedStyle(kartu).paddingRight) : 0,
      latarLayar: kartu ? getComputedStyle(kartu.parentElement).backgroundColor : null,
      sunk: token('--surface-sunk'),
    };
  });

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: buka shift di kartu 624 px dua kolom, Mulai Shift di kanan bawah`, async (t) => {
    const { hal, galat } = await bukaK02(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    assert.equal(u.panggung, lebar);
    assert.ok(u.kartu, 'buka shift tidak di dalam kartu');
    assert.equal(u.kartu.w, 624, `kartu ${u.kartu.w} px — mockup 624`);
    assert.ok(u.ikon, 'kartu tanpa ikon');
    assert.ok(u.staf, '"Staf pembuka" tidak tampil');
    assert.match(u.teksKartu, /Staf pembuka Kasir Galeri/, 'nama staf pembuka bukan dari sesi');
    assert.ok(u.kolom, 'kolom "Saldo awal kas" tidak ada (keputusan user 28 September 2026, #76: kolom bebas, bukan tombol pecahan)');
    assert.ok(u.staf.l > u.kolom.r, 'Staf pembuka tidak berdampingan dengan kolom Saldo awal kas');
    assert.ok(u.kolom.h >= 56, `kolom Saldo awal kas ${u.kolom.h} px — aksi menyangkut uang 56`);
    assert.equal(u.jumlahPecahan, 0, 'tombol pecahan "+ Rp …" masih ada — keputusan user 28 September 2026 (#76) menghapusnya');
    /* Kartu putih di atas layar putih tidak terlihat sebagai kartu. */
    assert.equal(u.latarLayar, u.sunk, 'latar di belakang kartu bukan --surface-sunk');
    assert.ok(u.mulai && u.mulai.h >= 56, 'Mulai Shift hilang atau < 56 px');
    assert.equal(u.mulai.r, Math.round(u.kartu.r - u.padding), 'Mulai Shift tidak di tepi kanan kartu');
    assert.ok(u.mulai.w < u.kartu.w / 2, 'Mulai Shift selebar kartu');
  });
}

// ---------------------------------------------------------------------------
// G-NOMINAL K-02 — kolom "Saldo awal kas" (keputusan user 28 September 2026, #76).
//
// ⛔ HARAPAN di bawah ditulis dari tabel `KASUS` (angka yang diketik → angka
// yang HARUS tersimpan), bukan dibaca dari DOM layar itu sendiri. Yang dibaca
// dari db palsu (`__galeriTulis`) adalah apa yang SUNGGUH ditulis `bukaShift`.

const KASUS_DITERIMA = [
  { ketik: '0', harapan: 0 }, // laci kosong adalah keadaan nyata, bukan "belum diisi"
  { ketik: '250000', harapan: 250_000 },
  { ketik: '1.500.000', harapan: 1_500_000 },
  { ketik: 'Rp 750.000', harapan: 750_000 },
];
const KASUS_DITOLAK = ['', '25.5', 'abc', '12.34', '1.5000'];

async function tulisan(hal) {
  return hal.evaluate(() =>
    (globalThis.__galeriTulis ?? []).map((t) => ({
      sql: t.sql,
      params: t.params.map((p) => (typeof p === 'bigint' ? String(p) : p)),
    }))
  );
}

const mulaiShift = (hal) => hal.getByRole('button', { name: 'Mulai Shift' });

test('⛔ kolom kosong → Mulai Shift nonaktif dengan alasan; TIDAK membuka shift bersaldo Rp 0', async () => {
  const { hal } = await bukaK02(1280);
  const kolom = hal.getByLabel('Saldo awal kas');
  assert.equal(await kolom.count(), 1, 'kolom berlabel "Saldo awal kas" tidak ada');
  assert.equal(await kolom.inputValue(), '', 'kolom tidak mulai kosong — saldo awal tidak boleh punya nilai bawaan');
  const tombol = mulaiShift(hal);
  assert.equal(await tombol.isDisabled(), true, 'Mulai Shift menyala dengan kolom kosong (membuka shift bersaldo Rp 0 tanpa diketik)');
  const idAlasan = await tombol.getAttribute('aria-describedby');
  assert.ok(idAlasan, 'Mulai Shift nonaktif tanpa aria-describedby ke alasannya');
  const alasan = await hal.evaluate((id) => document.getElementById(id)?.textContent.trim() ?? null, idAlasan);
  assert.equal(alasan, 'Isi saldo awal kas.', 'alasan Mulai Shift nonaktif bukan "Isi saldo awal kas."');
  await tombol.click({ force: true }).catch(() => {});
  await hal.waitForTimeout(300);
  const t = await tulisan(hal);
  assert.equal(t.filter((x) => /INSERT INTO cash_drawer_shift/i.test(x.sql)).length, 0, 'shift ditulis dari kolom kosong');
  assert.equal(t.filter((x) => /INSERT INTO cash_movement/i.test(x.sql)).length, 0, 'movement opening_float ditulis dari kolom kosong');
  await hal.close();
});

for (const ketik of KASUS_DITOLAK) {
  test(`⛔ "${ketik}" tidak terbaca → Mulai Shift nonaktif, tidak ada yang ditulis`, async () => {
    const { hal } = await bukaK02(1280);
    await hal.getByLabel('Saldo awal kas').fill(ketik);
    const tombol = mulaiShift(hal);
    assert.equal(await tombol.isDisabled(), true, `"${ketik}" membuat Mulai Shift menyala — bacaRupiah mengembalikan null untuknya`);
    const idAlasan = await tombol.getAttribute('aria-describedby');
    const alasan = idAlasan && (await hal.evaluate((id) => document.getElementById(id)?.textContent.trim() ?? null, idAlasan));
    assert.equal(alasan, 'Isi saldo awal kas.', `alasan nonaktif untuk "${ketik}" bukan "Isi saldo awal kas."`);
    if (/^\d+\.\d{1,2}$|^\d+\.\d{4,}$/.test(ketik)) {
      const teks = await hal.locator('.kasir-shift-kartu').innerText();
      assert.match(teks, /Masukkan rupiah utuh, tanpa desimal\./, `"${ketik}" ditolak tanpa petunjuk desimal`);
    }
    await tombol.click({ force: true }).catch(() => {});
    await hal.waitForTimeout(200);
    const t = await tulisan(hal);
    assert.equal(t.filter((x) => /INSERT INTO cash_drawer_shift/i.test(x.sql)).length, 0, `"${ketik}" menulis shift`);
    await hal.close();
  });
}

for (const { ketik, harapan } of KASUS_DITERIMA) {
  test(`⛔ "${ketik}" diterima tepat sebagai ${harapan}: opening_float shift = delta movement = angka yang diketik`, async () => {
    const { hal } = await bukaK02(1280);
    await hal.getByLabel('Saldo awal kas').fill(ketik);
    const tombol = mulaiShift(hal);
    assert.equal(await tombol.isDisabled(), false, `"${ketik}" sah (${harapan}) tetapi Mulai Shift nonaktif`);
    assert.equal(await tombol.getAttribute('aria-describedby'), null, 'Mulai Shift menyala tetapi masih menunjuk alasan nonaktif');
    await tombol.click();
    await hal.waitForFunction(() => (globalThis.__galeriTulis ?? []).some((t) => /INSERT INTO cash_movement/i.test(t.sql)), null, { timeout: 5_000 }).catch(() => {});
    const t = await tulisan(hal);
    const shift = t.filter((x) => /INSERT INTO cash_drawer_shift/i.test(x.sql));
    const mov = t.filter((x) => /INSERT INTO cash_movement/i.test(x.sql) && /opening_float/.test(x.sql));
    await hal.close();
    assert.equal(shift.length, 1, `INSERT cash_drawer_shift ${shift.length}×, harus tepat 1`);
    assert.equal(mov.length, 1, `INSERT cash_movement opening_float ${mov.length}×, harus tepat 1 (saldo laci hanya dari cash_movement)`);
    assert.equal(Number(shift[0].params[5]), harapan, `opening_float shift ${shift[0].params[5]}, diketik "${ketik}" harus ${harapan}`);
    assert.equal(Number(mov[0].params[2]), harapan, `delta movement opening_float ${mov[0].params[2]}, harus ${harapan} (positif)`);
    assert.equal(mov[0].params[1], shift[0].params[0], 'movement opening_float menunjuk shift lain');
  });
}

test('kolom Saldo awal kas: awalan Rp, rata kanan, tanpa nilai bawaan, tanpa tombol pecahan atau Hapus', async () => {
  const { hal } = await bukaK02(1280);
  const info = await hal.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Saldo awal kas');
    const input = label && document.getElementById(label.htmlFor);
    return {
      awalan: input?.parentElement?.textContent.trim().startsWith('Rp') ?? false,
      rata: input ? getComputedStyle(input).textAlign : null,
      inputMode: input?.getAttribute('inputmode') ?? null,
      tombol: [...document.querySelectorAll('.kasir-shift-kartu button')].map((b) => b.textContent.trim()),
    };
  });
  await hal.close();
  assert.equal(info.awalan, true, 'kolom Saldo awal kas tanpa awalan "Rp"');
  assert.equal(info.rata, 'right', `kolom rata ${info.rata}, mockup rata kanan`);
  assert.equal(info.inputMode, 'numeric', 'papan ketik numerik tidak diminta');
  assert.deepEqual(info.tombol, ['Mulai Shift'], `K-02 hanya punya satu tombol, ada: ${JSON.stringify(info.tombol)}`);
});
