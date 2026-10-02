'use strict';

// ⛔ G-QR — QR QRIS dinamis di dalam kartu K-06 (Task 9, spec § 7 dan § 11).
//
// Tambahan user untuk P3b: "Gambar yang tidak dapat dipindai lebih buruk
// daripada tidak ada gambar." Karena itu penjaga ini TIDAK memeriksa matriks
// dari fungsi: ia mengambil `<svg>` yang ADA DI DOM, merasternya di kanvas pada
// ukuran tampilnya dan 4×, lalu mendekodenya dengan jsQR (devDependency) dan
// membandingkan hasilnya dengan `qrString` dari gateway, PERSIS.
//
// Layar ASLI (`harness-k06`), jaringan dikendalikan test. Prasyarat:
//   npm run build:harness-k06

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-harness-k06');

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

const JENIS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
let server;
let alamat;
let peramban;

before(async () => {
  assert.ok(fs.existsSync(path.join(DIST, 'harness-k06.html')), 'dist-harness-k06/ belum dibangun. Jalankan `npm run build:harness-k06` lebih dulu.');
  server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(DIST, nama === '/' ? 'harness-k06.html' : nama);
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

async function buka(kueri, { rute = {}, tinggi = 1000, awal = null } = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1024, height: tinggi } });
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  for (const [pola, jawab] of Object.entries(rute)) {
    await hal.route(pola, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) }));
  }
  if (awal) await hal.addInitScript(awal);
  await hal.goto(`${alamat}/harness-k06.html?${kueri}`, { waitUntil: 'networkidle' });
  await hal.waitForSelector('#k06 > *', { timeout: 10_000 });
  return hal;
}

async function tunggu(hal, fn, pesan, arg = null, timeout = 5_000) {
  try {
    await hal.waitForFunction(fn, arg, { timeout });
  } catch {
    assert.fail(pesan);
  }
}

const teks = (hal) => hal.locator('body').innerText();
const tulisan = (hal) =>
  hal.evaluate(() => (globalThis.__galeriTulis ?? []).map((t) => ({ sql: t.sql, params: t.params.map((p) => (typeof p === 'bigint' ? String(p) : p)) })));
const jumlahOrder = async (hal) => (await tulisan(hal)).filter((t) => /^INSERT INTO "order"/i.test(t.sql)).length;
const barisPayment = async (hal) => (await tulisan(hal)).filter((t) => /^INSERT INTO payment/i.test(t.sql));
const navTerkunci = (hal) => hal.$$eval('.kasir-header [role="tab"]', (b) => b.map((e) => e.getAttribute('aria-disabled') === 'true'));

// String QRIS EMVCo panjang (fixture, CRC tidak dihitung), berspasi di kedua ujung dan di dalam
// supaya `trim()` atau normalisasi spasi di mana pun dari gateway sampai gambar tertangkap.
const QRIS_PANJANG =
  '00020101021226590014ID.CO.QRIS.WWW0118ID1023456789012340210ID10234567890303UMI51440014ID.CO.QRIS.WWW0215ID20234567890120303UMI5204581253033605802ID5913Kopi  Lumi Uji6007Jakarta61051234062070703A0163041A2B';
const QRIS_BERSPASI = `  ${QRIS_PANJANG}  `;
// ⛔ Non-ASCII: byte UTF-8 (é = C3 A9), bukan potongan 8-bit (E9). Dibandingkan sebagai BYTE:
// decoder bisa menebak latin1 untuk byte tak sah dan menghasilkan string yang tampak benar.
const QRIS_NON_ASCII = '000201010212265913Kopi Café Uji6007Jakarta630412AB';
// ⛔ > 300 byte: melewati kapasitas versi 10 level L (271) dan M (213). Gambar yang memaku versi
// atau level rendah gagal merender ATAU menghasilkan kode yang tidak terpindai untuk payload panjang
// (QRIS sungguhan dengan merchant panjang melewati 200 byte); `typeNumber` otomatis menanganinya.
const QRIS_300 = `${QRIS_PANJANG}5925${'Kopi Lumi Uji Panjang Sekali '.repeat(5)}6304ABCD`;
assert.ok(Buffer.byteLength(QRIS_300) > 300, 'fixture QRIS_300 tidak melewati 300 byte');
const QRIS_KHUSUS = '00020101021226"Kopi & Roti" <Uji> 5303360540510000 6304ABCD';

const rutePenuh = (qrString, status = 'pending_confirmation') => ({
  '**/orders': { id: 'ord-uji' },
  '**/orders/*/payments': { qrString },
  '**/payments/*/check-status': { status },
});

async function mulaiQr(hal) {
  await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
  const tombol = hal.getByRole('button', { name: 'Tampilkan kode QR' });
  assert.equal(await tombol.count(), 1, 'kartu QRIS dinamis tidak punya tombol "Tampilkan kode QR" (P3b) — QR tidak dapat diminta');
  await tombol.click();
  await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'sesudah "Tampilkan kode QR" tidak ada <svg role="img" aria-label="Kode QRIS"> di DOM — gambar QR tidak dirender', null, 10_000);
}

/**
 * Meraster `<svg>` yang ADA DI DOM pada `skala` × ukuran tampilnya, lalu mendekode.
 * `rusak` menimpa pusat gambar dengan latar: pembanding positif bahwa decoder tidak buta.
 */
function dekode(hal, skala, rusak = false) {
  return hal.evaluate(
    async ({ skala, rusak }) => {
      const svg = document.querySelector('svg[role="img"][aria-label="Kode QRIS"]');
      if (!svg) return { galat: 'tidak ada svg QR di DOM' };
      const r = svg.getBoundingClientRect();
      // Warna token (var(--…)) tidak hidup di dalam gambar terpisah: ganti dengan nilai yang DIHITUNG.
      const klon = svg.cloneNode(true);
      const asli = [svg, ...svg.querySelectorAll('*')];
      const salin = [klon, ...klon.querySelectorAll('*')];
      asli.forEach((e, i) => {
        const cs = getComputedStyle(e);
        salin[i].setAttribute('style', `fill:${cs.fill};stroke:${cs.stroke}`);
      });
      const lebar = Math.round(r.width * skala);
      const tinggi = Math.round(r.height * skala);
      klon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      klon.setAttribute('width', String(lebar));
      klon.setAttribute('height', String(tinggi));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(klon)], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((ok, gagal) => {
        img.onload = ok;
        img.onerror = () => gagal(new Error('svg tidak dapat dimuat sebagai gambar'));
        img.src = url;
      });
      const kanvas = document.createElement('canvas');
      kanvas.width = lebar;
      kanvas.height = tinggi;
      const c = kanvas.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingEnabled = false;
      c.drawImage(img, 0, 0, lebar, tinggi);
      if (rusak) {
        c.fillStyle = '#ffffff';
        c.fillRect(lebar * 0.3, tinggi * 0.3, lebar * 0.4, tinggi * 0.4);
      }
      const px = c.getImageData(0, 0, lebar, tinggi);
      // ⛔ Zona tenang: pita selebar 4 MODUL (spesifikasi QR) di keempat sisi harus terang — bukan
      // sebaris piksel di tepi, yang lolos walau zona tenangnya hanya 1 modul.
      const vb = svg.viewBox.baseVal.width;
      const pita = Math.max(1, Math.floor((4 * lebar) / vb) - 1);
      let tepiGelap = 0;
      const gelap = (x, y) => {
        const i = (y * lebar + x) * 4;
        return px.data[i] + px.data[i + 1] + px.data[i + 2] < 384 && px.data[i + 3] > 128;
      };
      for (let y = 0; y < tinggi; y++) {
        for (let x = 0; x < lebar; x++) {
          if ((x < pita || x >= lebar - pita || y < pita || y >= tinggi - pita) && gelap(x, y)) tepiGelap++;
        }
      }
      const hasil = globalThis.jsQR(px.data, lebar, tinggi, { inversionAttempts: 'dontInvert' });
      return { data: hasil ? hasil.data : null, bita: hasil ? Array.from(hasil.binaryData) : null, pita, lebar, tinggi, tampilLebar: r.width, tampilTinggi: r.height, tepiGelap };
    },
    { skala, rusak }
  );
}

const suntikJsqr = (hal) => hal.addScriptTag({ path: require.resolve('jsqr/dist/jsQR.js') });

for (const [nama, qr] of [
  ['string QRIS EMVCo panjang', QRIS_PANJANG],
  ['string berspasi di ujung dan di dalam', QRIS_BERSPASI],
  ['string memuat " & < >', QRIS_KHUSUS],
  ['string > 300 byte (versi QR otomatis, level M)', QRIS_300],
  ['string non-ASCII "Kopi Café" (byte UTF-8)', QRIS_NON_ASCII],
]) {
  test(`⛔ G-QR: QR yang dirender (${nama}) di-decode di peramban dan hasilnya SAMA PERSIS dengan qrString — ukuran tampil dan 4×`, async () => {
    const hal = await buka('render=k06&baris=2', { rute: rutePenuh(qr) });
    try {
      await suntikJsqr(hal);
      await mulaiQr(hal);
      for (const skala of [1, 4]) {
        const h = await dekode(hal, skala);
        assert.ok(!h.galat, `G-QR: ${h.galat}`);
        if (skala === 1) {
          assert.equal(Math.round(h.tampilLebar), 192, `G-QR: QR tampil ${h.tampilLebar}px, harapan 192px`);
          assert.equal(Math.round(h.tampilTinggi), 192, `G-QR: QR tampil ${h.tampilTinggi}px tinggi, harapan 192px`);
        }
        assert.notEqual(h.data, null, `G-QR: gambar QR ${skala}× TIDAK dapat dipindai (decoder tidak menemukan kode) — gambar yang tidak dapat dipindai lebih buruk daripada tidak ada`);
        assert.equal(h.data, qr, `G-QR: QR ${skala}× terdekode ${JSON.stringify(h.data)}, harapan qrString dari gateway ${JSON.stringify(qr)} — pelanggan membayar ke kode yang bukan milik transaksi ini`);
        assert.deepEqual(h.bita, Array.from(new TextEncoder().encode(qr)), `G-QR: QR ${skala}× membawa BYTE yang berbeda dari UTF-8 qrString — pelanggan membayar ke kode yang bukan milik transaksi ini`);
        assert.equal(h.tepiGelap, 0, `G-QR: zona tenang QR ${skala}× dilanggar — ${h.tepiGelap} piksel gelap di dalam pita 4 modul (${h.pita}px) di tepi gambar`);
      }
    } finally {
      await hal.close();
    }
  });
}

test('⛔ G-QR anti-hampa: pusat gambar ditimpa → decoder TIDAK mengembalikan qrString (decoder membaca gambar, bukan teks halaman)', async () => {
  const hal = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    await suntikJsqr(hal);
    await mulaiQr(hal);
    const utuh = await dekode(hal, 4);
    assert.equal(utuh.data, QRIS_PANJANG, 'pembanding hampa: gambar utuh tidak terdekode, rusak-tidaknya tidak bermakna');
    const rusak = await dekode(hal, 4, true);
    assert.notEqual(rusak.data, QRIS_PANJANG, 'decoder mengembalikan qrString dari gambar yang pusatnya dihapus — penjaga G-QR buta terhadap isi gambar');
  } finally {
    await hal.close();
  }
});

test('QR 192 px di dalam kartu; qrString tetap dapat dipilih sebagai teks di bawah gambar', async () => {
  const hal = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_BERSPASI) });
  try {
    await mulaiQr(hal);
    const ukur = await hal.evaluate((qr) => {
      const svg = document.querySelector('svg[role="img"][aria-label="Kode QRIS"]');
      const kartu = document.querySelector('.kasir-bayar-kartu');
      const sr = svg.getBoundingClientRect();
      const kr = kartu.getBoundingClientRect();
      const teksEl = [...document.querySelectorAll('.kasir-bayar-kartu *')].find((e) => e.children.length === 0 && e.textContent === qr);
      return {
        dalamKartu: sr.left >= kr.left && sr.right <= kr.right && sr.top >= kr.top && sr.bottom <= kr.bottom,
        lebar: sr.width,
        tinggi: sr.height,
        adaTeks: !!teksEl,
        bisaDipilih: teksEl ? getComputedStyle(teksEl).userSelect !== 'none' : null,
        teksDiBawah: teksEl ? teksEl.getBoundingClientRect().top >= sr.bottom - 1 : null,
      };
    }, QRIS_BERSPASI);
    assert.equal(ukur.dalamKartu, true, 'QR tidak berada di dalam kartu pembayaran');
    assert.equal(Math.round(ukur.lebar), 192);
    assert.equal(Math.round(ukur.tinggi), 192);
    assert.equal(ukur.adaTeks, true, 'qrString (utuh, termasuk spasi) tidak ada sebagai teks di kartu — jalur salin hilang');
    assert.equal(ukur.bisaDipilih, true, 'teks qrString user-select:none — tidak dapat dipilih');
    assert.equal(ukur.teksDiBawah, true, 'teks qrString tidak berada di bawah gambar');
  } finally {
    await hal.close();
  }
});

test('hitung mundur menurun mengikuti jam suntikan dan berbunyi "Berlaku selama MM:SS"', async () => {
  const hal = await buka('render=panel&status=pending&jam=1&batas=300000', { awal: () => { window.__jam = 1_000_000; } });
  try {
    const baca = () => hal.evaluate(() => /Berlaku selama (\d\d:\d\d)/.exec(document.body.innerText)?.[1] ?? null);
    await tunggu(hal, () => /Berlaku selama \d\d:\d\d/.test(document.body.innerText), 'hitung mundur "Berlaku selama MM:SS" tidak tampil di kartu QRIS');
    assert.equal(await baca(), '05:00', 'awal hitung mundur bukan BATAS_POLLING_MS (05:00)');
    await hal.evaluate(() => { window.__jam += 65_000; });
    await tunggu(hal, () => /Berlaku selama 03:55/.test(document.body.innerText), 'hitung mundur tidak menurun ke 03:55 sesudah jam maju 65 dtk — jam suntikan tidak dipakai atau tidak berdetak', null, 5_000);
    await hal.evaluate(() => { window.__jam += 100_000; });
    await tunggu(hal, () => /Berlaku selama 02:15/.test(document.body.innerText), 'hitung mundur tidak menurun ke 02:15 sesudah jam maju lagi 100 dtk');
  } finally {
    await hal.close();
  }
});

test('⛔ P6/G-QR: kedaluwarsa, ditolak penerbit, dan habis waktu berkalimat BERBEDA; hanya yang pending menampilkan QR dan hitung mundur', async () => {
  const pending = await buka('render=panel&status=pending');
  const kedaluwarsa = await buka('render=panel&status=kedaluwarsa');
  const ditolak = await buka('render=panel&status=gagal');
  const habis = await buka('render=panel&status=pending&habis=1');
  try {
    const ada = (h) => h.locator('svg[role="img"][aria-label="Kode QRIS"]').count();
    assert.equal(await ada(pending), 1, 'pembanding hampa: keadaan pending tidak menampilkan QR');
    assert.match(await teks(pending), /Berlaku selama/, 'pembanding hampa: keadaan pending tidak menampilkan hitung mundur');

    await tunggu(kedaluwarsa, () => /Kode QR kedaluwarsa/.test(document.body.innerText), 'keadaan kedaluwarsa tidak berjudul "Kode QR kedaluwarsa"');
    const tKed = await teks(kedaluwarsa);
    assert.match(tKed, /Buat kode baru/, 'keadaan kedaluwarsa tidak menawarkan "Buat kode baru"');
    assert.equal(await ada(kedaluwarsa), 0, 'QR yang sudah kedaluwarsa masih tampil sebagai gambar yang dapat dipindai');
    assert.ok(!/Berlaku selama/.test(tKed), 'kedaluwarsa masih menampilkan hitung mundur');

    await tunggu(ditolak, () => /ditolak penerbit/.test(document.body.innerText), 'keadaan ditolak penerbit tidak menyebut "ditolak penerbit"');
    const tTol = await teks(ditolak);
    assert.equal(await ada(ditolak), 0, 'QR masih tampil sesudah pembayaran ditolak penerbit');
    assert.ok(!/Kode QR kedaluwarsa/.test(tTol), 'ditolak penerbit memakai kalimat kedaluwarsa');

    await tunggu(habis, () => /Belum ada konfirmasi setelah 5 menit/.test(document.body.innerText), 'keadaan habis waktu tidak menyebut "Belum ada konfirmasi setelah 5 menit"');
    const tHabis = await teks(habis);
    assert.ok(!/Kode QR kedaluwarsa/.test(tHabis) && !/ditolak penerbit/.test(tHabis), 'habis waktu memakai kalimat kedaluwarsa atau penolakan — kasir menagih ulang pelanggan yang mungkin sudah membayar');

    // ⛔ Kalimat PERINGATAN (role=alert) sendiri, bukan teks halaman: judul dan tombol yang
    // berbeda tidak boleh menutupi kalimat yang sama.
    const alert = (h) => h.$$eval('[role="alert"]', (e) => e.map((x) => x.textContent.trim()).join(' | '));
    const aKed = await alert(kedaluwarsa);
    const aTol = await alert(ditolak);
    const aHabis = await alert(habis);
    assert.match(aKed, /kedaluwarsa/, `peringatan kedaluwarsa tidak menyebut kedaluwarsa: "${aKed}"`);
    assert.ok(!/ditolak penerbit/.test(aKed), `peringatan kedaluwarsa memakai kalimat penolakan penerbit: "${aKed}"`);
    assert.match(aTol, /ditolak penerbit/, `peringatan ditolak tidak menyebut penerbit: "${aTol}"`);
    assert.ok(!/kedaluwarsa/.test(aTol), `peringatan ditolak penerbit memakai kalimat kedaluwarsa: "${aTol}"`);
    assert.ok(aKed !== aTol && aKed !== aHabis && aTol !== aHabis, 'dua dari tiga kalimat peringatan (kedaluwarsa, ditolak, habis waktu) sama persis');

    assert.match(tKed, /tidak terdebit/);
    assert.match(tTol, /tidak terdebit/);
    assert.notEqual(tKed, tTol, 'kedaluwarsa dan ditolak penerbit merender teks yang sama persis');
    assert.notEqual(tKed, tHabis, 'kedaluwarsa dan habis waktu merender teks yang sama persis');
    assert.notEqual(tTol, tHabis, 'ditolak penerbit dan habis waktu merender teks yang sama persis');
  } finally {
    await Promise.all([pending.close(), kedaluwarsa.close(), ditolak.close(), habis.close()]);
  }
});

test('terkonfirmasi (jawaban gateway confirmed) menampilkan "Pembayaran terkonfirmasi", bukan QR', async () => {
  const hal = await buka('render=panel&status=confirmed');
  try {
    await tunggu(hal, () => /Pembayaran terkonfirmasi/.test(document.body.innerText), 'status confirmed dari gateway tidak menampilkan "Pembayaran terkonfirmasi"');
    assert.equal(await hal.locator('svg[role="img"][aria-label="Kode QRIS"]').count(), 0, 'QR masih tampil sesudah pembayaran terkonfirmasi');
  } finally {
    await hal.close();
  }
});

test('⛔ [P3] QR TIDAK diminta sebelum "Tampilkan kode QR" ditekan: nol POST sesudah memilih QRIS dinamis, satu sesudah menekan', async () => {
  const hal = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    const permintaan = [];
    hal.on('request', (r) => {
      if (r.method() === 'POST' && /\/orders(\/[^/]+\/payments)?$/.test(new URL(r.url()).pathname)) permintaan.push(new URL(r.url()).pathname);
    });
    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    const tombol = hal.getByRole('button', { name: 'Tampilkan kode QR' });
    await hal.waitForTimeout(600);
    assert.equal(permintaan.length, 0, `${permintaan.length} permintaan ke server sebelum "Tampilkan kode QR" ditekan: ${permintaan.join(', ')} — QR diminta tanpa kasir menyuruhnya`);
    assert.equal(await hal.locator('svg[role="img"][aria-label="Kode QRIS"]').count(), 0, 'gambar QR tampil sebelum diminta');
    assert.equal(await hal.evaluate(() => (globalThis.__galeriTulis ?? []).filter((t) => /draf_qris_lokal|UPDATE device_config/i.test(t.sql)).length), 0, 'draf atau nomor struk dicadangkan sebelum "Tampilkan kode QR" ditekan');
    assert.equal(await tombol.count(), 1, 'kartu QRIS dinamis tidak punya tombol "Tampilkan kode QR" — pembanding hampa');
    await tombol.click();
    await hal.waitForSelector('svg[role="img"][aria-label="Kode QRIS"]', { timeout: 10_000 });
    assert.equal(permintaan.filter((p) => /payments$/.test(p)).length, 1, 'sesudah menekan, POST payments tidak tepat satu');
  } finally {
    await hal.close();
  }
});

test('⛔ tidak ada jalur ketukan yang menandai lunas: selama pending, setiap button aktif (kecuali "Tutup layar") diklik → penjualan tidak tersimpan', async () => {
  const hal = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_PANJANG, 'pending_confirmation') });
  const pembanding = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_PANJANG, 'confirmed') });
  try {
    const abandon = [];
    await hal.route('**/orders/*/abandon', (r) => { abandon.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await mulaiQr(hal);
    // ⛔ Klik BERGELOMBANG: tombol yang baru muncul sesudah satu klik juga ditekan, sampai tidak
    // ada tombol aktif baru. Satu sapuan sinkron tidak melihat tombol yang dimunculkan klik pertama.
    const diklik = [];
    for (let putaran = 0; putaran < 6; putaran++) {
      const baru = await hal.evaluate(() => {
        const nama = [];
        for (const b of document.querySelectorAll('button')) {
          if (b.disabled || b.getAttribute('aria-disabled') === 'true' || b.dataset.sudahDiklik) continue;
          if (b.textContent.trim() === 'Tutup layar') continue;
          b.dataset.sudahDiklik = '1';
          nama.push(b.textContent.trim());
          b.click();
        }
        return nama;
      });
      if (baru.length === 0) break;
      diklik.push(...baru);
      await hal.waitForTimeout(150);
    }
    assert.ok(diklik.length >= 1, 'tidak ada button aktif untuk diklik — penjaga hampa');
    await hal.waitForTimeout(900);
    assert.equal(await jumlahOrder(hal), 0, `mengetuk ${JSON.stringify(diklik)} selama pending menulis order lokal — ada jalur ketukan yang menandai lunas tanpa konfirmasi gateway`);
    assert.equal((await barisPayment(hal)).length, 0, 'mengetuk tombol selama pending menulis payment');
    assert.equal(abandon.length, 0, `mengetuk ${JSON.stringify(diklik)} selama pending memanggil /abandon (${abandon.length}×) — order yang pelanggannya sedang memindai dibatalkan dan stoknya dilepas`);
    assert.ok(!/Transaksi selesai/.test(await teks(hal)), 'mengetuk tombol selama pending sampai ke K-07');
    const utama = hal.locator('.kasir-bayar-aksi .btn-primary');
    assert.equal(await utama.isDisabled(), true, 'tombol utama aktif selama pending');
    // Pembanding positif: jawaban gateway confirmed memang menghasilkan order, jadi nol di atas bermakna.
    await mulaiQr(pembanding).catch(() => {});
    await pembanding.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    assert.equal(await jumlahOrder(pembanding), 1, 'pembanding hampa: confirmed dari gateway tidak menulis order');
  } finally {
    await hal.close();
    await pembanding.close();
  }
});

test('⛔ "Tutup layar" benar-benar menutup panel dan TETAP tertutup (draf tidak memulihkan panel seketika); kunci nav terbuka, draf lokal tetap hidup', async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    await mulaiQr(hal);
    await hal.getByRole('button', { name: 'Tutup layar' }).click();
    await hal.waitForTimeout(1200);
    assert.equal(
      await hal.locator('svg[role="img"][aria-label="Kode QRIS"]').count(),
      0,
      '"Tutup layar" tidak menutup panel: pemulihan draf membukanya lagi seketika — kasir tidak punya jalan keluar dari QR yang ditinggalkan pelanggan'
    );
    assert.deepEqual((await navTerkunci(hal)).filter(Boolean), [], 'panel ditutup tetapi tab nav tetap terkunci');
    assert.match(await teks(hal), /masih menunggu konfirmasi/, 'sesudah "Tutup layar" kalimat "masih menunggu konfirmasi" tidak tampil');
    const draf = await hal.evaluate(() => globalThis.__galeriTabel.draf_qris_lokal.length);
    assert.equal(draf, 1, 'draf QRIS lokal hilang sesudah "Tutup layar" — jejak satu-satunya untuk Cek status');
  } finally {
    await hal.close();
  }
});

test('⛔ pemulihan draf membuka tab QRIS dalam keadaan menunggu, TERKUNCI (tab metode, tab nav, tombol utama), dengan QR yang sama', async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_BERSPASI) });
  try {
    await suntikJsqr(hal);
    await mulaiQr(hal);
    // Tutup layar: draf lokal SENGAJA tetap hidup; lalu K-06 dilepas dan dipasang lagi.
    await hal.getByRole('button', { name: 'Tutup layar' }).click();
    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') === null, '"Tutup layar" tidak menutup panel (panel dipulihkan lagi seketika dari draf)');
    assert.deepEqual((await navTerkunci(hal)).filter(Boolean), [], 'pembanding hampa: tab nav terkunci padahal panel sudah ditutup');
    await hal.evaluate(() => window.__paksaKeluar());
    await tunggu(hal, () => document.querySelector('#layar-lain') !== null, 'K-06 tidak ter-unmount — pembanding hampa');
    await hal.evaluate(() => window.__paksaMasuk());

    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'sesudah K-06 dipasang lagi, draf QRIS yang tertinggal TIDAK dipulihkan: tidak ada QR menunggu');
    assert.equal((await dekode(hal, 1)).data, QRIS_BERSPASI, 'QR hasil pemulihan bukan qrString gateway PERSIS (spasi di ujung hilang di draf?) — pelanggan membayar ke kode yang bukan milik transaksi ini');
    const tab = await hal.$$eval('.kasir-bayar-tab button, .kasir-bayar-sub button', (b) => b.map((e) => e.disabled || e.getAttribute('aria-disabled') === 'true'));
    assert.ok(tab.length >= 5 && tab.every(Boolean), `pemulihan draf TIDAK mengunci tab metode: ${JSON.stringify(tab)}`);
    const nav = await navTerkunci(hal);
    assert.ok(nav.length >= 4 && nav.every(Boolean), `pemulihan draf TIDAK mengunci tab nav: ${JSON.stringify(nav)}`);
    const utama = hal.locator('.kasir-bayar-aksi .btn-primary');
    assert.equal((await utama.textContent()).trim(), 'Menunggu pembayaran…');
    assert.equal(await utama.isDisabled(), true, 'tombol utama aktif sesudah pemulihan draf');
    assert.equal(await jumlahOrder(hal), 0, 'pemulihan draf menulis order lokal');
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// ⛔ Tagih ganda sesudah "Tutup layar" — fix round Task 9, temuan C1 (spec-c:291, spec-c:326)
// ---------------------------------------------------------------------------

const TOMBOL_MINTA = 'Tampilkan kode QR';
const TOMBOL_LANJUT = 'Lanjutkan pembayaran QRIS tertunda';
const adaQr = (hal) => hal.locator('svg[role="img"][aria-label="Kode QRIS"]').count();
const drafLokal = (hal) => hal.evaluate(() => globalThis.__galeriTabel.draf_qris_lokal.map((b) => ({ order: b.order_id, payment: b.payment_id, qr: b.qr_string })));
function catatPost(hal) {
  const p = [];
  hal.on('request', (r) => {
    if (r.method() === 'POST' && /\/orders(\/[^/]+\/payments)?$/.test(new URL(r.url()).pathname)) p.push(new URL(r.url()).pathname);
  });
  return p;
}
async function tutupLayar(hal) {
  await hal.getByRole('button', { name: 'Tutup layar' }).click();
  await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') === null, '"Tutup layar" tidak menutup panel');
}
async function ulangPasang(hal) {
  await hal.evaluate(() => window.__paksaKeluar());
  await tunggu(hal, () => document.querySelector('#layar-lain') !== null, 'K-06 tidak ter-unmount — pembanding hampa');
  await hal.evaluate(() => window.__paksaMasuk());
}
const klikTeksTombol = (hal, nama) =>
  hal.evaluate((n) => {
    // Hanya tombol yang AKTIF: yang nonaktif tidak dapat ditekan kasir, dan menghitungnya membuat penjaga hijau.
    const b = [...document.querySelectorAll('button')].filter((e) => e.textContent.trim() === n && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    b.forEach((e) => e.click());
    return b.length;
  }, nama);

test(`⛔ [C1] sesudah "Tutup layar" kartu TIDAK menawarkan "${TOMBOL_MINTA}": nol POST baru, payment_id draf tetap (QR kedua = tagih ganda)`, async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    const post = catatPost(hal);
    await mulaiQr(hal);
    const sebelum = await drafLokal(hal);
    assert.equal(sebelum.length, 1, 'pembanding hampa: tidak ada draf sesudah QR diminta');
    const jumlahPost = post.length;
    assert.equal(jumlahPost, 2, `pembanding hampa: permintaan pertama = ${jumlahPost} POST, harapan 2 (order + payment)`);
    await tutupLayar(hal);
    const ditekan = await klikTeksTombol(hal, TOMBOL_MINTA);
    await hal.waitForTimeout(800);
    assert.equal(ditekan, 0, `sesudah "Tutup layar" tombol "${TOMBOL_MINTA}" masih ada (${ditekan}) — kasir dapat meminta QR kedua untuk draf yang pelanggannya mungkin sudah membayar`);
    assert.equal(post.length, jumlahPost, `${post.length - jumlahPost} POST baru sesudah "Tutup layar": ${post.slice(jumlahPost).join(', ')} — QR kedua diminta`);
    const sesudah = await drafLokal(hal);
    assert.deepEqual(sesudah, sebelum, 'draf lokal berubah sesudah "Tutup layar": jejak payment pertama ditimpa');
    assert.equal(await hal.getByRole('button', { name: TOMBOL_LANJUT }).count(), 1, `kartu tidak menawarkan "${TOMBOL_LANJUT}" — kasir tidak punya jalan kembali ke pembayaran tertunda`);
  } finally {
    await hal.close();
  }
});

test(`⛔ [C1] "${TOMBOL_LANJUT}" membuka kembali panel draf yang SAMA (QR sama, polling lanjut) tanpa POST order/payment baru`, async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    await suntikJsqr(hal);
    const post = catatPost(hal);
    let cek = 0;
    await hal.route('**/payments/*/check-status', (r) => {
      cek++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending_confirmation' }) });
    });
    await mulaiQr(hal);
    const draf0 = await drafLokal(hal);
    await tutupLayar(hal);
    const cek0 = cek;
    const post0 = post.length;
    assert.equal(await hal.getByRole('button', { name: TOMBOL_LANJUT }).count(), 1, `kartu tidak menawarkan "${TOMBOL_LANJUT}" sesudah "Tutup layar"`);
    await hal.getByRole('button', { name: TOMBOL_LANJUT }).click();
    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, `"${TOMBOL_LANJUT}" tidak membuka panel QR`);
    assert.equal((await dekode(hal, 1)).data, QRIS_PANJANG, 'QR panel yang dibuka kembali bukan qrString draf');
    await hal.waitForTimeout(700);
    assert.ok(cek > cek0, 'panel dibuka kembali tetapi polling status tidak berlanjut');
    assert.equal(post.length, post0, 'membuka kembali panel mengirim POST order/payment baru');
    assert.deepEqual(await drafLokal(hal), draf0, 'membuka kembali panel mengubah draf');
    const nav = await navTerkunci(hal);
    assert.ok(nav.length >= 4 && nav.every(Boolean), 'panel dibuka kembali tetapi tab nav tidak terkunci');
  } finally {
    await hal.close();
  }
});

test('⛔ [C1a] keranjang diubah selagi QRIS tertunda: pemulihan TIDAK menulis penjualan dari keranjang berbeda; keranjang yang sama menulisnya (pembanding)', async () => {
  const buatHal = async () => {
    const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
    await mulaiQr(hal);
    await tutupLayar(hal);
    await hal.route('**/payments/*/check-status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'confirmed' }) }));
    return hal;
  };
  const sama = await buatHal();
  const beda = await buatHal();
  try {
    // Pembanding positif: keranjang SAMA + confirmed → penjualan ditulis dari draf.
    await ulangPasang(sama);
    await sama.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    assert.equal(await jumlahOrder(sama), 1, 'pembanding hampa: keranjang sama + confirmed tidak menulis order');

    // Keranjang BERBEDA (3 baris, total lain).
    await beda.evaluate(() => window.__ubahKeranjang(3, 20000));
    await ulangPasang(beda);
    await beda.waitForSelector('.kasir-bayar-kartu, .kasir-k07', { timeout: 10_000 });
    await beda.waitForTimeout(2500);
    assert.equal(await jumlahOrder(beda), 0, 'pemulihan menulis penjualan lokal dari keranjang yang BERBEDA dari yang ditagih gateway — uang dan barang tidak cocok');
    const lanjut = beda.getByRole('button', { name: TOMBOL_LANJUT });
    assert.equal(await lanjut.count(), 1, `keranjang berbeda: kartu tidak menawarkan "${TOMBOL_LANJUT}" — pembanding hampa (tanpa klik, tidak ada yang bisa menulis penjualan)`);
    await lanjut.click();
    await beda.waitForTimeout(1200);
    assert.equal(await jumlahOrder(beda), 0, 'penjualan lokal ditulis dari keranjang yang BERBEDA dari yang ditagih gateway — uang dan barang tidak cocok');
    assert.equal((await barisPayment(beda)).length, 0, 'payment lokal ditulis dari keranjang berbeda');
    assert.ok(!/Transaksi selesai/.test(await teks(beda)), 'keranjang berbeda sampai ke K-07');
    assert.match(await teks(beda), /berbeda dari keranjang/, 'tidak ada pesan yang menyebut keranjang berbeda dari pembayaran tertunda');
    assert.equal((await drafLokal(beda)).length, 1, 'draf dihapus padahal belum ditulis sebagai penjualan');
  } finally {
    await sama.close();
    await beda.close();
  }
});

test('⛔ [C1a] panel yang dipulihkan menampilkan nominal DRAF (yang ditagih gateway), bukan total keranjang yang sudah berubah', async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    await mulaiQr(hal);
    const nominal = (await hal.locator('.kasir-qris .t-title.num').first().textContent()).trim();
    assert.match(nominal, /^Rp /, `pembanding hampa: nominal panel "${nominal}"`);
    await tutupLayar(hal);
    await hal.evaluate(() => window.__ubahKeranjang(3, 20000));
    await ulangPasang(hal);
    await hal.getByRole('button', { name: TOMBOL_LANJUT }).click();
    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'panel tidak terbuka');
    const sesudah = (await hal.locator('.kasir-qris .t-title.num').first().textContent()).trim();
    assert.equal(sesudah, nominal, `panel pemulihan menampilkan ${sesudah}, yang ditagih gateway ${nominal} — nominal bukan dari draf`);
  } finally {
    await hal.close();
  }
});

test(`⛔ [C1c] selama pemulihan draf belum selesai "${TOMBOL_MINTA}" TIDAK dapat ditekan (nol POST); sesudah selesai tidak ada QR kedua`, async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    const post = catatPost(hal);
    await mulaiQr(hal);
    await tutupLayar(hal);
    await hal.evaluate(() => window.__paksaKeluar());
    await tunggu(hal, () => document.querySelector('#layar-lain') !== null, 'K-06 tidak ter-unmount — pembanding hampa');
    await hal.evaluate(() => {
      globalThis.__galeriTahanDraf = new Promise((r) => { globalThis.__lepasDraf = r; });
    });
    const post0 = post.length;
    await hal.evaluate(() => window.__paksaMasuk());
    await hal.waitForSelector('.kasir-bayar-kartu', { timeout: 10_000 });
    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    const ditekan = await klikTeksTombol(hal, TOMBOL_MINTA);
    await hal.waitForTimeout(600);
    assert.equal(ditekan, 0, `"${TOMBOL_MINTA}" AKTIF selagi pemulihan draf belum selesai (${ditekan} tombol aktif ditekan) — balapan: QR kedua dapat diminta sebelum draf diketahui`);
    assert.equal(await hal.getByRole('button', { name: /^Meminta (kode )?QR/ }).count(), 0, 'permintaan QR berjalan selagi pemulihan draf belum selesai');
    assert.equal(post.length, post0, `${post.length - post0} POST terkirim saat pemulihan draf masih berjalan (klik ${ditekan}× pada tombol)`);
    await hal.evaluate(() => globalThis.__lepasDraf());
    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'sesudah pemulihan selesai panel draf tidak terbuka');
    assert.equal(post.length, post0, 'pemulihan selesai tetapi ada POST baru');
  } finally {
    await hal.close();
  }
});

for (const keadaan of ['menunggu', 'pemulihan']) {
  test(`⛔ [I1] tombol Kembali PERAMBAN selama QRIS ${keadaan === 'menunggu' ? 'menunggu' : 'dalam keadaan pemulihan draf'} tidak meninggalkan K-06 dan panel tetap`, async () => {
    const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG) });
    try {
      await mulaiQr(hal);
      if (keadaan === 'pemulihan') {
        await tutupLayar(hal);
        await ulangPasang(hal);
        await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'pembanding hampa: pemulihan tidak membuka panel');
      }
      assert.equal(await hal.evaluate(() => location.pathname), '/bayar', 'pembanding hampa: K-06 tidak di /bayar');
      await hal.evaluate(() => history.back());
      await hal.waitForTimeout(500);
      assert.equal(await hal.locator('#layar-lain').count(), 0, 'tombol Kembali peramban me-unmount K-06 selama QRIS menunggu — jejak QR yang sedang dipindai hilang dari layar');
      assert.equal(await hal.evaluate(() => location.pathname), '/bayar', 'jalur tidak dikembalikan ke /bayar sesudah popstate');
      assert.equal(await adaQr(hal), 1, 'panel QR hilang sesudah tombol Kembali peramban');
      const nav = await navTerkunci(hal);
      assert.ok(nav.length >= 4 && nav.every(Boolean), 'tab nav tidak terkunci sesudah popstate');
    } finally {
      await hal.close();
    }
  });
}


// ---------------------------------------------------------------------------
// ⛔ Fix round 2 Task 9 — celah penjaga yang sabotase independen Opus temukan
// ---------------------------------------------------------------------------

const RUTE_ABANDON = { '**/orders/*/abandon': { ok: true } };

test('⛔ [b7] sesudah lunas draf QRIS lokal HABIS dan K-06 yang dipasang ulang TIDAK menawarkan panel/"Lanjutkan" — satu QR dibayar, satu penjualan', async () => {
  const hal = await buka('render=k06&baris=2&rute=1', { rute: rutePenuh(QRIS_PANJANG, 'confirmed') });
  try {
    const post = catatPost(hal);
    await mulaiQr(hal).catch(() => {});
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    await hal.waitForTimeout(400);
    assert.equal(await jumlahOrder(hal), 1, 'pembanding hampa: confirmed tidak menulis tepat satu order');
    const draf = await drafLokal(hal);
    assert.equal(draf.length, 0, `${draf.length} baris draf_qris_lokal sesudah lunas — draf yang tidak dibersihkan dipulihkan sebagai pembayaran tertunda dan menulis penjualan KEDUA`);
    const post0 = post.length;
    await ulangPasang(hal);
    await hal.waitForTimeout(2500);
    assert.equal(await jumlahOrder(hal), 1, `${await jumlahOrder(hal)} order sesudah K-06 dipasang ulang — lunas ganda untuk satu pembayaran QRIS`);
    assert.equal(await adaQr(hal), 0, 'K-06 dipasang ulang membuka panel QR dari draf yang sudah lunas');
    assert.equal(await hal.getByRole('button', { name: TOMBOL_LANJUT }).count(), 0, `K-06 dipasang ulang menawarkan "${TOMBOL_LANJUT}" untuk pembayaran yang sudah lunas`);
    assert.equal(post.length, post0, 'K-06 dipasang ulang mengirim POST baru');
  } finally {
    await hal.close();
  }
});

for (const [status, tombol] of [['failed', 'Batalkan transaksi'], ['expired', 'Buat kode baru']]) {
  for (const pasangUlang of [false, true]) {
    test(`⛔ [b8] sesudah "${tombol}"${pasangUlang ? ' dan K-06 dipasang ulang' : ''}: draf 0 baris, "${TOMBOL_MINTA}" menghasilkan POST payments KEDUA (bukan tertolak seumur shift)`, async () => {
      const hal = await buka('render=k06&baris=2&rute=1', { rute: { ...rutePenuh(QRIS_PANJANG, status), ...RUTE_ABANDON } });
      try {
        const post = catatPost(hal);
        const payments = () => post.filter((p) => /payments$/.test(p)).length;
        await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
        await hal.getByRole('button', { name: TOMBOL_MINTA }).click();
        await hal.waitForSelector(`button:text-is("${tombol}")`, { timeout: 10_000 });
        assert.equal(payments(), 1, 'pembanding hampa: permintaan pertama bukan tepat satu POST payments');
        await hal.getByRole('button', { name: tombol }).click();
        await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') === null, `"${tombol}" tidak menutup panel`);
        await hal.waitForTimeout(500);
        const draf = await drafLokal(hal);
        assert.equal(draf.length, 0, `${draf.length} baris draf_qris_lokal sesudah "${tombol}" — draf ber-QR yang tertinggal memblokir QR baru seumur shift`);
        if (pasangUlang) {
          await ulangPasang(hal);
          await hal.waitForSelector('.kasir-bayar-kartu', { timeout: 10_000 });
          await hal.waitForTimeout(800);
          assert.equal(await hal.getByRole('button', { name: TOMBOL_LANJUT }).count(), 0, `sesudah dipasang ulang kartu menawarkan "${TOMBOL_LANJUT}" untuk draf yang sudah dibatalkan`);
          assert.equal(await adaQr(hal), 0, 'sesudah dipasang ulang panel QR dari draf yang sudah dibatalkan terbuka');
          await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
        }
        const tekan = hal.getByRole('button', { name: TOMBOL_MINTA });
        assert.equal(await tekan.count(), 1, `"${TOMBOL_MINTA}" tidak ada sesudah "${tombol}" — kasir tidak dapat membuat QR baru`);
        await tekan.click();
        await hal.waitForTimeout(1500);
        assert.equal(payments(), 2, `${payments()} POST payments sesudah "${tombol}" lalu "${TOMBOL_MINTA}", harapan 2 — QR baru ditolak`);
      } finally {
        await hal.close();
      }
    });
  }
}

test('⛔ [p2] polling BERLANJUT: check-status pending, pending, confirmed → "Transaksi selesai" tanpa satu ketukan pun', async () => {
  const hal = await buka('render=k06&baris=2', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    let cek = 0;
    await hal.route('**/payments/*/check-status', (r) => {
      cek++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: cek >= 3 ? 'confirmed' : 'pending_confirmation' }) });
    });
    await mulaiQr(hal);
    try {
      await hal.waitForSelector('text=Transaksi selesai', { timeout: 15_000 });
    } catch {
      assert.fail(`sesudah ${cek} cek status (pending, pending) polling berhenti: confirmed tidak pernah diminta (cek=${cek}) — pelanggan sudah membayar dan kasir tidak melihatnya tanpa mengetuk`);
    }
    assert.ok(cek >= 3, `lunas sesudah ${cek} cek status, harapan ≥ 3`);
    assert.equal(await jumlahOrder(hal), 1, 'confirmed pada putaran ke-3 tidak menulis tepat satu order');
  } finally {
    await hal.close();
  }
});

test('⛔ [p2] polling sampai BATAS: jam suntikan melewati batas → kalimat habis waktu muncul tanpa ketukan, statusnya tetap menunggu (bukan gagal)', async () => {
  const hal = await buka('render=panel&status=pending&jam=1&batas=300000', { awal: () => { window.__jam = 1_000_000; } });
  try {
    await hal.waitForTimeout(400);
    assert.ok(!/Belum ada konfirmasi setelah 5 menit/.test(await teks(hal)), 'pembanding hampa: kalimat habis waktu sudah tampil sebelum batas');
    await hal.evaluate(() => { window.__jam += 300_001; });
    await tunggu(hal, () => /Belum ada konfirmasi setelah 5 menit/.test(document.body.innerText), 'jam melewati batas 5 menit tetapi kalimat habis waktu tidak muncul — polling berhenti atau tidak pernah memeriksa batas');
    assert.ok(!/ditolak penerbit|Kode QR kedaluwarsa/.test(await teks(hal)), 'habis waktu memakai kalimat penolakan atau kedaluwarsa');
  } finally {
    await hal.close();
  }
});

test('⛔ [q14] amount POST /orders/*/payments === total order, juga total TIDAK bulat dengan pembulatan aktif (FR-C9 hanya pada sisa tunai)', async () => {
  for (const harga of [40500, 85000]) {
    const hal = await buka(`render=k06&baris=1&harga=${harga}&pembulatan=1000`, { rute: rutePenuh(QRIS_PANJANG) });
    try {
      const badan = {};
      hal.on('request', (r) => {
        if (r.method() !== 'POST') return;
        const p = new URL(r.url()).pathname;
        if (/\/orders$/.test(p)) badan.order = JSON.parse(r.postData());
        if (/payments$/.test(p)) badan.bayar = JSON.parse(r.postData());
      });
      await mulaiQr(hal);
      assert.ok(badan.order && badan.bayar, `harga ${harga}: body POST order/payments tidak tertangkap — pembanding hampa`);
      assert.equal(badan.bayar.amount, badan.order.total, `harga ${harga}: amount payment QRIS ${badan.bayar.amount} ≠ total order ${badan.order.total} — pembulatan masuk ke bagian NON-TUNAI (FR-C9 hanya pada sisa tunai); gateway menagih nominal yang bukan total`);
    } finally {
      await hal.close();
    }
  }
  // Pembanding bahwa fixture memang membedakan: setidaknya satu total bukan kelipatan 1.000.
  const hal = await buka('render=k06&baris=1&harga=40500&pembulatan=1000', { rute: rutePenuh(QRIS_PANJANG) });
  try {
    let total = null;
    hal.on('request', (r) => { if (r.method() === 'POST' && /\/orders$/.test(new URL(r.url()).pathname)) total = JSON.parse(r.postData()).total; });
    await mulaiQr(hal);
    assert.ok(total !== null && total % 1000 !== 0, `pembanding hampa: total order ${total} kelipatan 1.000, pembulatan tidak dapat dibedakan`);
  } finally {
    await hal.close();
  }
});

test('KARAKTERISASI (keputusan produk TERBUKA, bukan kontrak — lihat ledger "Temuan #5"): POST payment gagal lalu "Tampilkan kode QR" lagi membuat order/payment BARU', async () => {
  const hal = await buka('render=k06&baris=2', { rute: { ...rutePenuh(QRIS_PANJANG), ...RUTE_ABANDON } });
  try {
    const post = [];
    hal.on('request', (r) => {
      if (r.method() === 'POST' && /\/orders(\/[^/]+\/(payments|abandon))?$/.test(new URL(r.url()).pathname)) post.push(new URL(r.url()).pathname);
    });
    let n = 0;
    await hal.route('**/orders/*/payments', (r) => {
      n++;
      return n === 1
        ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ qrString: QRIS_PANJANG }) });
    });
    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    await hal.getByRole('button', { name: TOMBOL_MINTA }).click();
    await tunggu(hal, () => /tercatat sebagai dibatalkan/.test(document.body.innerText), 'sesudah POST payments 500 galat tidak tampil — pembanding hampa');
    const d1 = await drafLokal(hal);
    await hal.getByRole('button', { name: TOMBOL_MINTA }).click();
    await tunggu(hal, () => document.querySelector('svg[role="img"][aria-label="Kode QRIS"]') !== null, 'tekan kedua tidak menghasilkan QR');
    const d2 = await drafLokal(hal);
    // Perilaku HEAD yang dicatat: order dan payment pertama yatim, /abandon tidak dipanggil. Bila ini
    // diubah (opsi a/b di ledger), perbarui penjaga ini DAN ledger bersama-sama.
    assert.equal(d1.length, 1, 'draf tanpa QR tidak ada sesudah kegagalan');
    assert.equal(d1[0].qr, null, 'draf sesudah kegagalan membawa QR');
    assert.notEqual(d2[0].order, d1[0].order, 'orderId dipakai ulang — perilaku berubah, perbarui ledger "Temuan #5"');
    assert.notEqual(d2[0].payment, d1[0].payment, 'paymentId dipakai ulang — perilaku berubah, perbarui ledger "Temuan #5"');
    assert.equal(post.filter((p) => /abandon$/.test(p)).length, 0, '/abandon dipanggil — perilaku berubah, perbarui ledger "Temuan #5"');
    assert.equal(post.filter((p) => /\/orders$/.test(p)).length, 2, 'jumlah POST /orders bukan 2');
  } finally {
    await hal.close();
  }
});
