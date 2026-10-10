'use strict';

// G-STRUK (DOM) — pratinjau struk (Task 13, spec § 8 dan § 11). Baris yang
// tampil HARUS sama dengan `tataLetakStruk` untuk dokumen yang sama — fungsi
// yang juga dipakai `renderEscPos`, jadi pratinjau tidak menyimpang dari byte.
//
// Isi struk diuji dari K-09 (`ord-1` ada di DB palsu galeri). Dari K-07
// galeri, penjualan yang baru ditulis TIDAK ada di DB palsu, jadi pratinjau
// K-07 menampilkan keadaan "tidak dapat dibangun ulang" — itu pun diuji.
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


async function bukaPratinjauK09(query = '') {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-09&keadaan=normal${query}`, { waitUntil: 'load' });
  await hal.getByRole('button', { name: 'Pratinjau struk', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau="struk"] [data-struk-baris]', { timeout: 10_000 });
  return { hal, galat };
}

const bacaPratinjau = (hal) =>
  hal.evaluate(() => {
    const p = document.querySelector('[data-pratinjau="struk"]');
    return {
      lebar: Number(p.dataset.lebar),
      dokumen: JSON.parse(p.dataset.dokumen),
      pressed: [...p.querySelectorAll('[aria-pressed="true"]')].map((e) => e.textContent.trim()),
      baris: [...p.querySelectorAll('[data-struk-baris]')].map((e) => ({
        teks: e.textContent,
        rata: e.dataset.rata ?? null,
        tebal: e.dataset.tebal === 'ya',
        textAlign: getComputedStyle(e).textAlign,
        fontWeight: getComputedStyle(e).fontWeight,
      })),
    };
  });

/** Harapan lengkap {teks, rata, tebal} dari tataLetakStruk — garis: kiri, tidak tebal. */
async function harapan(dokumen, profilNama) {
  const { tataLetakStruk } = await import('../../apps/kasir/src/cetak/escpos.ts');
  const { PROFIL_58MM, PROFIL_80MM } = await import('../../apps/kasir/src/cetak/profil.ts');
  const profil = profilNama === '80' ? PROFIL_80MM : PROFIL_58MM;
  return tataLetakStruk(dokumen, profil).map((b) => ({
    teks: b.teks,
    rata: 'garis' in b ? 'kiri' : b.rata,
    tebal: 'garis' in b ? false : b.tebal,
  }));
}

const ALIGN = { kiri: ['left', 'start'], tengah: ['center'], kanan: ['right', 'end'] };

function cocokkan(nama, dom, harap) {
  assert.deepEqual(
    dom.baris.map(({ teks, rata, tebal }) => ({ teks, rata, tebal })),
    harap,
    `${nama}: teks/rata/tebal DOM menyimpang dari tataLetakStruk`
  );
  dom.baris.forEach((b, i) => {
    assert.ok(ALIGN[harap[i].rata].includes(b.textAlign), `${nama} baris ${i}: text-align ${b.textAlign}, harap ${harap[i].rata}`);
    assert.equal(Number(b.fontWeight) >= 600, harap[i].tebal, `${nama} baris ${i}: font-weight ${b.fontWeight}, tebal harap ${harap[i].tebal}`);
  });
}

test('⛔ baris pratinjau di DOM = tataLetakStruk untuk dokumen yang sama (teks, rata, tebal); toggle 80mm mengubah lebar kolom 32 → 48', async () => {
  const { hal, galat } = await bukaPratinjauK09('&strukPanjang=1');
  const p58 = await bacaPratinjau(hal);
  const e58 = await harapan(p58.dokumen, '58');
  await hal.getByRole('button', { name: '80mm', exact: true }).click();
  await hal.waitForFunction(() => document.querySelector('[data-pratinjau="struk"]').dataset.lebar === '48');
  const p80 = await bacaPratinjau(hal);
  const e80 = await harapan(p80.dokumen, '80');
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(p58.lebar, 32, 'lebar bawaan galeri (baseline 58mm)');
  assert.equal(p80.lebar, 48);
  assert.ok(e58.length > 8, 'dokumen terlalu pendek — penjaga hampa');
  // Dokumen uji harus MENYENTUH lipat, potong-kiri, transliterasi, tengah, tebal — diturunkan dari harapan, bukan dari DOM.
  for (const [nama, e, w] of [['58', e58, 32], ['80', e80, 48]]) {
    assert.ok(e.some((b) => b.rata === 'tengah'), `${nama}mm: harapan tanpa baris tengah — penjaga hampa`);
    assert.ok(e.some((b) => b.tebal), `${nama}mm: harapan tanpa baris tebal — penjaga hampa`);
    assert.ok(e.some((b) => b.teks === '-'.repeat(w)), `${nama}mm: harapan tanpa garis ${w} kolom`);
  }
  const namaPanjang = 'Kopi Susu Gula Aren Dingin Ukuran Besar Tanpa Es Tambah Shot Espresso Ekstra Dua';
  assert.ok(p58.dokumen.baris.some((b) => JSON.stringify(b).includes(namaPanjang)), 'fixture strukPanjang tidak sampai ke dokumen');
  // Potong-kiri: nama produk meluap di dua kolom, angka kanan UTUH (bukan "Rp 25.0").
  assert.ok(e58.some((b) => b.teks.length === 32 && /^\dx Kopi Susu/.test(b.teks) && /29\.000$/.test(b.teks)), 'dua kolom meluap tidak dipotong-kiri di 58mm: ' + JSON.stringify(e58.map((b) => b.teks)));
  assert.ok(e80.some((b) => b.teks.length === 48 && /^\dx Kopi Susu Gula Aren Dingin Ukuran Besar/.test(b.teks) && /29\.000$/.test(b.teks)), 'dua kolom 80mm: ' + JSON.stringify(e80.map((b) => b.teks)));
  // Lipat: catatan panjang menjadi >= 2 baris di 58mm (pemesan/catatan dari fixture).
  assert.ok(e58.filter((b) => /Tanpa gula|es dipisah|sedotan|bungkus|kantong|terpisah/.test(b.teks)).length >= 2, 'catatan panjang tidak terlipat di 58mm: ' + JSON.stringify(e58.map((b) => b.teks)));
  cocokkan('58mm', p58, e58);
  cocokkan('80mm', p80, e80);
  assert.ok(p80.baris.some((b) => b.teks.length === 48), 'tidak ada baris selebar 48 kolom');
  assert.ok(p58.baris.every((b) => b.teks.length <= 32) && p80.baris.every((b) => b.teks.length <= 48));
  assert.ok([...p58.baris, ...p80.baris].every((b) => /^[\x20-\x7e]*$/.test(b.teks)), 'ada karakter non-ASCII di pratinjau');
  const semua = [...p58.baris, ...p80.baris];
  assert.ok(semua.some((b) => /\.\.\./.test(b.teks)), 'transliterasi … → ... tidak terlihat di struk uji');
  assert.ok(semua.some((b) => /^Diskon +- \d/.test(b.teks)), 'transliterasi − → - tidak terlihat di baris Diskon');
});

test('⛔ baris pertama pratinjau = nama outlet fixture, bukan "LumiPOS"', async () => {
  const { hal } = await bukaPratinjauK09();
  const p = await bacaPratinjau(hal);
  await hal.close();
  assert.equal(p.baris[0].teks.trim(), 'ORIGEN Menteng');
  assert.equal(p.baris[0].rata, 'tengah');
  assert.equal(p.dokumen.baris[0].isi, 'ORIGEN Menteng', 'dokumen yang dikirim ke pratinjau tidak diawali nama outlet');
  assert.ok(!p.baris.some((b) => /LumiPOS/.test(b.teks)));
});

test('⛔ profil 80mm terpilih → lebar bawaan 48 tanpa menekan toggle', async () => {
  const { hal } = await bukaPratinjauK09('&profil80=1');
  const p = await bacaPratinjau(hal);
  await hal.close();
  assert.equal(p.lebar, 48, `data-lebar ${p.lebar} — profil 80mm terpilih, harap 48`);
  assert.deepEqual(p.pressed, ['80mm']);
  cocokkan('80mm bawaan', p, await harapan(p.dokumen, '80'));
});

test('toggle hanya mengubah pratinjau, dan UI menyatakannya', async () => {
  const { hal } = await bukaPratinjauK09();
  const t = await hal.$eval('[data-pratinjau="struk"]', (e) => e.textContent);
  await hal.close();
  assert.match(t, /hanya untuk pratinjau/);
  assert.match(t, /Pratinjau struk/);
});

test('teks pratinjau --font-mono 13px, satu-satunya elemen mono di layar', async () => {
  const { hal } = await bukaPratinjauK09();
  const u = await hal.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.fontFamily = 'var(--font-mono)';
    document.body.appendChild(probe);
    const mono = getComputedStyle(probe).fontFamily;
    probe.remove();
    const baris = [...document.querySelectorAll('[data-pratinjau="struk"] [data-struk-baris]')];
    const luar = [...document.querySelectorAll('body *')].filter(
      (e) => getComputedStyle(e).fontFamily === mono && !e.closest('[data-pratinjau="struk"]')
    );
    return {
      mono,
      n: baris.length,
      salah: baris.filter((e) => getComputedStyle(e).fontFamily !== mono || getComputedStyle(e).fontSize !== '13px').map((e) => getComputedStyle(e).fontFamily + ' ' + getComputedStyle(e).fontSize),
      luar: luar.map((e) => e.tagName + '.' + e.className),
    };
  });
  await hal.close();
  assert.ok(u.n > 0);
  assert.match(u.mono, /Courier New|monospace/, `--font-mono terbaca ${u.mono}`);
  assert.deepEqual(u.salah, [], 'baris struk bukan --font-mono 13px');
  assert.deepEqual(u.luar, [], 'elemen mono di luar pratinjau');
});

test('"Cetak" di pratinjau memanggil jalur cetak ulang yang sama dengan K-09', async () => {
  const { hal } = await bukaPratinjauK09();
  await hal.getByRole('button', { name: 'Cetak', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau="struk"] [data-cetak="ulang"]', { timeout: 10_000 });
  const t = await hal.$eval('[data-pratinjau="struk"] [data-cetak="ulang"]', (e) => e.textContent.trim());
  await hal.close();
  assert.match(t, /Belum ada printer terpasang|Struk dicetak ulang|Gagal mencetak/, `kalimat cetak: ${t}`);
});

test('pratinjau dapat dibuka dari K-09, dan ditutup dengan Escape', async () => {
  const { hal } = await bukaPratinjauK09();
  await hal.keyboard.press('Escape');
  await hal.waitForSelector('[data-pratinjau="struk"]', { state: 'detached', timeout: 5_000 });
  await hal.close();
});

test('pratinjau dari K-07: dibuka, keadaan "tidak dapat dibangun" terbaca, Tutup kembali ke K-07', async () => {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=keranjang-penuh`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-grid > *', { timeout: 10_000 });
  await hal.getByRole('button', { name: 'Bayar', exact: true }).click();
  await hal.getByLabel('Nominal diterima').fill('600.000');
  await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
  await hal.waitForSelector('text=Transaksi Baru', { timeout: 10_000 });
  await hal.getByRole('button', { name: 'Cetak Struk', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau^="struk"]', { timeout: 10_000 });
  const teks = await hal.$eval('[data-pratinjau^="struk"]', (e) => e.textContent);
  await hal.getByRole('button', { name: 'Tutup', exact: true }).click();
  await hal.waitForSelector('text=Transaksi Baru', { timeout: 5_000 });
  await hal.close();
  assert.match(teks, /tidak dapat dibangun ulang menjadi struk/, teks);
});

test('⛔ konfigurasi perangkat tak terbaca → pratinjau tetap tampil, "Cetak" nonaktif dengan alasan terlihat', async () => {
  const { hal } = await bukaPratinjauK09('&tanpaKonfigPerangkat=1');
  const u = await hal.evaluate(() => {
    const cetak = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cetak');
    const alasan = document.querySelector('[data-pratinjau="struk"] [data-cetak="nonaktif"]');
    return {
      baris: document.querySelectorAll('[data-pratinjau="struk"] [data-struk-baris]').length,
      disabled: cetak?.disabled ?? null,
      alasan: alasan?.textContent.trim() ?? null,
      terhubung: cetak && alasan ? cetak.getAttribute('aria-describedby') === alasan.id : false,
    };
  });
  await hal.close();
  assert.ok(u.baris > 0, 'pratinjau tidak tampil');
  assert.equal(u.disabled, true, '"Cetak" aktif padahal konfigurasi perangkat tak terbaca — struk akan bernama merchant kosong');
  assert.match(u.alasan ?? '', /Perangkat belum terbaca/, `alasan: ${u.alasan}`);
  assert.equal(u.terhubung, true, 'alasan tidak terhubung ke tombol lewat aria-describedby');
});

test('konfigurasi perangkat terbaca → "Cetak" aktif, tanpa alasan nonaktif', async () => {
  const { hal } = await bukaPratinjauK09();
  const u = await hal.evaluate(() => ({
    disabled: [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cetak')?.disabled,
    alasan: document.querySelector('[data-cetak="nonaktif"]') !== null,
  }));
  await hal.close();
  assert.deepEqual(u, { disabled: false, alasan: false });
});
