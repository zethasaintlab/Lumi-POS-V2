'use strict';

// Laci kas — layar K-18 (FR-D5 + K-16 + riwayat shift), menurut mockup.
//
// Task 4 PR 2A, kampanye "Hidupkan desain" (26 September 2026, spec § 9).
// Penjaga lama (Fase 3.6 rebuild UI) memaku dialog kas masuk/keluar yang dibuka
// dari K-03 dengan toggle 56 px. Digantikan: kas manual dan buka laci pindah ke
// LAYAR tersendiri (tab "Laci kas", `/laci`) — dua kartu berdampingan, dan
// toggle arah tampil 44 px (mockup: 186×44) dengan area TEKAN ≥ 56 lewat
// `.sentuh-uang` (constraint kampanye: "elemen yang di mockup lebih kecil dari
// 44px tampil PERSIS ukuran mockup, area sentuh diperluas tak terlihat, 56px
// untuk aksi uang"). Yang tetap dikejar: tanpa gulir pada 1024×768 dan
// 1280×800 untuk KEDUA arah, termasuk alasan "Lainnya" yang menambah kolom
// catatan.
//
// Yang TIDAK dikejar: keterangan teks bebas (alasan daftar tertutup, FR-D6).
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

/** Membuka K-18. Viewport SELALU 1280×800 (galeri menskalakan panggung di
    bawah 1088 px). 1280×800: `.galeri-panggung > *` dipaksa selebar viewport.
    1024×768: panggung BAWAAN galeri (1024×768) — pola `header.test.js`. */
async function bukaLaci(lebar, tinggi, keadaan = 'normal', ekstra = '', { tungguForm = true } = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  hal.setDefaultTimeout(8_000);
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-18&keadaan=${keadaan}${ekstra}`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        `.galeri-panggung>*{width:${lebar}px!important;height:${tinggi}px!important;border:0!important;border-radius:0!important;box-shadow:none!important}`,
    });
  }
  /* ⛔ Galeri jatuh ke K-03 untuk id layar yang tidak dikenal. Yang ditunggu
     JUDUL layar Laci kas, bukan sembarang isi — K-03 yang menyamar tidak lolos. */
  if (!tungguForm) {
    /* Layar K-18 sendiri (bukan formnya): dipakai penjaga yang justru menanyakan
       apakah form masih ada, supaya kegagalannya bukan "layar hilang". */
    await hal
      .waitForFunction(() => {
        const k = document.querySelector('.kasir-konten');
        return !!k && k.innerText.trim() !== '' && !/Membaca laci dari perangkat/.test(k.innerText);
      })
      .catch(() => {
        throw new Error('K-18 tidak selesai memuat: penanda "Membaca laci dari perangkat…" tidak pernah hilang');
      });
  } else if (keadaan !== 'error') {
    await hal
      .getByRole('heading', { name: 'Operasional laci' })
      .waitFor({ timeout: 10_000 })
      .catch(() => {
        throw new Error('layar K-18 (Laci kas) tidak ada: kartu "Operasional laci" tidak dirender');
      });
  } else {
    await hal.waitForTimeout(1200);
  }
  await hal.evaluate(() => document.fonts.ready);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const kartuDari = (judul) => {
      const h = [...document.querySelectorAll('h1, h2, h3')].find((e) => e.textContent.trim() === judul);
      return h ? h.closest('section, .card') : null;
    };
    const kiri = kartuDari('Operasional laci');
    const kanan = kartuDari('Riwayat shift berjalan');
    const kotak = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const seg = kiri ? kiri.querySelector('.segmented') : null;
    const toggle = seg
      ? [...seg.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const kena = (y) => {
            const e = document.elementFromPoint(cx, y);
            return !!e && (e === b || b.contains(e));
          };
          return {
            teks: b.textContent.trim(),
            tekan: b.getAttribute('aria-pressed'),
            sentuhUang: b.classList.contains('sentuh-uang'),
            cx,
            cy,
            // 1 px DI DALAM kotak 56 px (±28 dari tengah).
            kenaAtas: kena(cy - 27),
            kenaBawah: kena(cy + 27),
          };
        })
      : [];
    const gulir = (kiri || document.body).closest('.kasir-grid-panel') || document.scrollingElement;
    return {
      kiri: kotak(kiri),
      kanan: kotak(kanan),
      seg: kotak(seg),
      toggle,
      radioArah: document.querySelectorAll('input[name="arah-kas"]').length,
      gulir: { scroll: gulir.scrollHeight, client: gulir.clientHeight },
    };
  });

for (const [lebar, tinggi] of [
  [1024, 768],
  [1280, 800],
]) {
  test(`⛔ Laci kas: dua kartu berdampingan; toggle Kas masuk/Kas keluar tampil 44 px dengan area tekan ≥ 56 (.sentuh-uang); tanpa gulir di ${lebar}×${tinggi}`, async (t) => {
    const { hal, galat } = await bukaLaci(lebar, tinggi);
    const hasil = {};
    for (const arah of ['Kas keluar', 'Kas masuk']) {
      await hal.getByRole('button', { name: arah, exact: true }).click();
      /* Kasus terburuk tinggi: alasan "Lainnya" menambah kolom catatan. */
      await hal.getByRole('radio', { name: 'Lainnya' }).check();
      hasil[arah] = await ukur(hal);
    }
    /* Area tekan diuji dengan KLIK sungguhan 27 px di atas tengah tombol
       yang belum menyala — di luar kotak 44 px `.segmented`, di dalam 56 px. */
    const masuk = hasil['Kas masuk'].toggle.find((b) => b.teks === 'Kas keluar');
    await hal.mouse.click(masuk.cx, masuk.cy - 27);
    const setelahKlik = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify({ hasil, setelahKlik: setelahKlik.toggle.map((b) => [b.teks, b.tekan]) }));

    assert.deepEqual(galat, [], 'galat konsol saat membuka K-18');
    const u = hasil['Kas keluar'];
    assert.ok(u.kiri && u.kanan, 'kartu "Operasional laci" dan/atau "Riwayat shift berjalan" tidak ada');
    assert.ok(u.kiri.r <= u.kanan.l + 1, `kartu tidak berdampingan: kiri berakhir x=${u.kiri.r}, kanan mulai x=${u.kanan.l}`);
    assert.ok(Math.abs(u.kiri.t - u.kanan.t) <= 2, `kartu tidak sejajar di atas: y=${u.kiri.t} vs y=${u.kanan.t}`);
    assert.equal(u.radioArah, 0, 'arah kas masih radio, bukan toggle');
    assert.deepEqual(u.toggle.map((b) => b.teks), ['Kas masuk', 'Kas keluar'], 'urutan toggle bukan Kas masuk · Kas keluar (mockup)');
    assert.ok(u.seg && Math.abs(u.seg.h - 44) <= 1, `toggle tampil ${u.seg && u.seg.h} px, mockup 44 px (56 px tidak lagi tampil — area tekan yang 56)`);
    for (const b of u.toggle) {
      assert.ok(b.sentuhUang, `toggle "${b.teks}" tanpa kelas .sentuh-uang — area tekan uang harus ≥ 56 px`);
      assert.ok(b.kenaAtas && b.kenaBawah, `area tekan toggle "${b.teks}" kurang dari 56 px (atas ${b.kenaAtas}, bawah ${b.kenaBawah})`);
    }
    assert.deepEqual(u.toggle.map((b) => b.tekan), ['false', 'true'], 'arah bawaan bukan "keluar"');
    assert.deepEqual(hasil['Kas masuk'].toggle.map((b) => b.tekan), ['true', 'false'], 'menekan "Kas masuk" tidak memindahkan arah');
    assert.deepEqual(
      setelahKlik.toggle.map((b) => b.tekan),
      ['false', 'true'],
      'klik 27 px di atas tengah tombol (di luar 44 px, di dalam 56 px) tidak memindahkan arah — area tekan tidak bekerja'
    );
    for (const [arah, x] of Object.entries(hasil)) {
      assert.ok(x.gulir.scroll <= x.gulir.client, `Laci kas ${arah} + alasan Lainnya menggulir (${x.gulir.scroll} dari ${x.gulir.client} px) pada ${lebar}×${tinggi}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Task 4 — perilaku (bukan hanya tata letak).
// ---------------------------------------------------------------------------

/** Fixture galeri (`db-palsu.ts`, `__galeriTabel`), dibaca dari halaman. */
const bacaFixture = (hal) =>
  hal.evaluate(() => {
    const t = globalThis.__galeriTabel;
    const shift = t.cash_drawer_shift[0];
    const gerak = t.cash_movement;
    return {
      modalAwal: Number(shift.opening_float),
      delta: gerak.map((g) => ({ id: g.id, type: g.type, delta: Number(g.delta) })),
      manual: gerak.filter((g) => g.type === 'paid_in' || g.type === 'paid_out').map((g) => Number(g.delta)),
      manualBaris: gerak.filter((g) => g.type === 'paid_in' || g.type === 'paid_out').map((g) => ({ id: g.id, delta: Number(g.delta) })),
    };
  });

/** SEMUA yang dapat sampai ke pengguna atau teknologi bantu, bukan hanya
    `innerText`: `textContent` seluruh akar (termasuk elemen `hidden`/`sr-only`)
    DAN setiap nilai atribut (`title`, `aria-*`, `data-*`, `alt`, `placeholder`)
    plus `value` kolom isian. Saldo di tooltip atau di span tersembunyi tetap
    membocorkan hitungan buta. */
const semuaTeks = (hal) =>
  hal.evaluate(() => {
    const akar = document.querySelector('.galeri-panggung');
    const semua = [...akar.querySelectorAll('*')];
    const atribut = semua.flatMap((e) => [...e.attributes].map((a) => `${e.tagName.toLowerCase()}[${a.name}]=${a.value}`));
    const nilai = semua.filter((e) => 'value' in e && typeof e.value === 'string' && e.value !== '').map((e) => `${e.tagName.toLowerCase()}.value=${e.value}`);
    return [akar.textContent, ...atribut, ...nilai].join('\n');
  });

const teksLayar = (hal) => hal.evaluate(() => document.querySelector('.kasir-konten').innerText);
const kartuRiwayat = (hal) =>
  hal.evaluate(() => {
    const h = [...document.querySelectorAll('h1, h2, h3')].find((e) => e.textContent.trim() === 'Riwayat shift berjalan');
    const k = h && h.closest('section, .card');
    return k ? { teks: k.innerText, baris: k.querySelectorAll('li').length, daftar: [...k.querySelectorAll('li')].map((l) => l.innerText.replace(/\s+/g, ' ').trim()) } : null;
  });

test('⛔ Laci kas TIDAK menampilkan saldo laci — hitungan buta FR-D2', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const fx = await bacaFixture(hal);
  const saldo = fx.modalAwal + fx.delta.reduce((a, g) => a + g.delta, 0);
  const penjualanTunai = fx.delta.filter((g) => g.type === 'sale').reduce((a, g) => a + g.delta, 0);
  const teks = await semuaTeks(hal);
  /* Setelah SATU catatan disimpan pun layar tidak boleh membocorkannya. */
  await hal.getByRole('button', { name: 'Kas masuk', exact: true }).click();
  await hal.getByLabel('Jumlah').fill('15000');
  await hal.getByRole('radio', { name: 'Tambah modal laci' }).check();
  await hal.getByRole('button', { name: 'Simpan catatan' }).click();
  await hal.getByText(/tercatat/).first().waitFor({ timeout: 5_000 });
  const teksSesudah = await semuaTeks(hal);
  const fx2 = await bacaFixture(hal);
  const saldoSesudah = fx2.modalAwal + fx2.delta.reduce((a, g) => a + g.delta, 0);
  await hal.close();
  assert.deepEqual(galat, []);

  assert.equal(saldoSesudah, saldo + 15000, 'fixture tidak menyerap kas masuk yang disimpan — penjaga ini tidak memeriksa saldo sesudah simpan');
  assert.ok(fx.delta.some((g) => g.type === 'sale'), 'fixture tanpa movement penjualan — penjaga ini tidak memeriksa apa pun');
  assert.ok(saldo > 0 && penjualanTunai > 0, `fixture tidak masuk akal: saldo ${saldo}, penjualan ${penjualanTunai}`);
  const format = (n) => [Number(n).toLocaleString('id-ID'), String(n)];
  for (const [nama, nilai] of [['saldo laci (modal awal + SUM(delta))', saldo], ['total penjualan tunai', penjualanTunai], ['modal awal', fx.modalAwal], ['saldo laci SESUDAH kas masuk disimpan', saldoSesudah]]) {
    for (const bentuk of format(nilai)) {
      for (const [kapan, isi] of [['sebelum', teks], ['sesudah menyimpan', teksSesudah]]) {
        assert.ok(
          !new RegExp(`(?<![\\d.])${bentuk.replace(/\./g, '\\.')}(?![\\d])`).test(isi),
          `Laci kas (${kapan} simpan) memuat ${nama} "${bentuk}" (teks, elemen tersembunyi ATAU atribut) — hitungan buta FR-D2: saldo hanya boleh tampil di K-12 tahap review.\n${isi}`
        );
      }
    }
  }
  for (const [kapan, isi] of [['sebelum', teks], ['sesudah menyimpan', teksSesudah]]) {
    assert.doesNotMatch(isi, /\bSaldo\b/i, `Laci kas (${kapan} simpan) memuat kata "Saldo" — ${isi}`);
    assert.doesNotMatch(isi, /Kas diharapkan/i, `Laci kas (${kapan} simpan) memuat "Kas diharapkan"`);
  }
});

test('⛔ riwayat shift berjalan: hanya kas manual, tanpa movement penjualan', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const fx = await bacaFixture(hal);
  const kartu = await kartuRiwayat(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.ok(kartu, 'kartu "Riwayat shift berjalan" tidak ada');
  assert.ok(fx.manual.length >= 3, `fixture hanya punya ${fx.manual.length} kas manual — penjaga ini tidak memeriksa apa pun`);
  assert.equal(
    kartu.baris,
    fx.manual.length,
    `riwayat menampilkan ${kartu.baris} baris; fixture punya ${fx.manual.length} kas manual (dan ${fx.delta.length - fx.manual.length} movement lain) — movement penjualan/refund/modal awal bocor ke riwayat`
  );
  const penjualan = fx.delta.filter((x) => x.type === 'sale' && x.delta > 0);
  assert.ok(penjualan.length >= 3, 'fixture tanpa penjualan — penjaga ini tidak memeriksa apa pun');
  for (const g of penjualan) {
    assert.ok(!kartu.teks.includes(`Rp ${g.delta.toLocaleString('id-ID')}`), `nominal penjualan ${g.delta} muncul di riwayat kas manual`);
  }
  for (const d of fx.manual) {
    assert.ok(kartu.teks.includes(Math.abs(d).toLocaleString('id-ID')), `nominal kas manual ${d} tidak tampil di riwayat`);
  }
  /* Arah dan nominal PER BARIS terhadap fixture (fixture terbaru dulu, sama
     dengan urutan tampil): pasangan kata↔nominal, bukan "kedua kata ada". */
  const barisTampil = kartu.daftar;
  assert.equal(barisTampil.length, fx.manualBaris.length, 'jumlah baris tampil ≠ fixture');
  for (const [i, f] of fx.manualBaris.entries()) {
    const kata = f.delta > 0 ? 'Kas masuk' : 'Kas keluar';
    const lawan = f.delta > 0 ? 'Kas keluar' : 'Kas masuk';
    const nominal = `Rp ${Math.abs(f.delta).toLocaleString('id-ID')}`;
    const b = barisTampil[i];
    assert.ok(b.includes(kata), `baris ${i + 1} (fixture ${f.id}, delta ${f.delta}): arah harus "${kata}", terbaca "${b}"`);
    assert.ok(!b.includes(lawan), `baris ${i + 1} (fixture ${f.id}): memuat arah berlawanan "${lawan}" — label arah tertukar. Terbaca "${b}"`);
    assert.ok(b.includes(nominal), `baris ${i + 1} (fixture ${f.id}): nominal harus ${nominal}, terbaca "${b}"`);
  }
  assert.doesNotMatch(kartu.teks, /−/, 'jumlah kas manual tampil bertanda (−): jumlah selalu POSITIF, arah dibawa katanya');
});

const LABEL_KELUAR = ['Bayar pemasok', 'Biaya operasional', 'Diambil pemilik', 'Setor ke bank', 'Koreksi pencatatan', 'Lainnya'];
const LABEL_MASUK = ['Tambah modal laci', 'Ambil pecahan dari bank', 'Setoran pemilik', 'Koreksi pencatatan', 'Lainnya'];

test('alasan daftar tertutup, bukan teks bebas', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const baca = () =>
    hal.evaluate(() => ({
      radio: [...document.querySelectorAll('input[type="radio"][name="alasan-kas"]')].map((r) => r.closest('label').textContent.trim()),
      teksBebas: [...document.querySelectorAll('.kasir-laci input:not([type="radio"]), .kasir-laci textarea')].map((e) => ({
        tag: e.tagName, label: (e.labels && e.labels[0] ? e.labels[0].textContent : e.getAttribute('placeholder') || '').trim(),
      })),
    }));
  /* ⛔ Struktur kontrol alasan diperiksa SEBELUM berinteraksi dengannya: kontrol
     yang diganti teks bebas harus gagal di sini dengan pesan yang menyebut
     daftar tertutupnya, bukan lewat timeout `radio.check()`. */
  const tutup = (arah, x) => {
    assert.deepEqual(
      x.radio,
      arah === 'keluar' ? LABEL_KELUAR : LABEL_MASUK,
      `kontrol alasan Kas ${arah} BUKAN kelompok radio yang opsinya = daftar tertutup ALASAN_KAS_${arah.toUpperCase()} (FR-D6: counterpart_type diturunkan dari alasan). Terbaca ${x.radio.length} radio; kolom teks: ${JSON.stringify(x.teksBebas)}`
    );
    assert.ok(!x.teksBebas.some((e) => /keterangan|alasan/i.test(e.label)), `ada kolom teks bebas berlabel "${x.teksBebas.map((e) => e.label).join(', ')}" — alasan harus daftar tertutup, bukan teks bebas`);
    assert.deepEqual(x.teksBebas.map((e) => e.tag), ['INPUT'], `selain nominal ada kolom teks lain: ${JSON.stringify(x.teksBebas)}`);
  };
  await hal.getByRole('button', { name: 'Kas keluar', exact: true }).click();
  const keluar = await baca();
  tutup('keluar', keluar);
  await hal.getByRole('button', { name: 'Kas masuk', exact: true }).click();
  const masuk = await baca();
  tutup('masuk', masuk);
  await hal.getByRole('radio', { name: 'Lainnya' }).check();
  const lainnya = await baca();
  await hal.close();
  assert.deepEqual(galat, []);
  /* Catatan hanya muncul untuk "Lainnya" (aturan `periksaKas`). */
  assert.deepEqual(lainnya.teksBebas.map((e) => e.tag), ['INPUT', 'TEXTAREA'], '"Lainnya" tanpa kolom catatan');
});

test('⛔ "Buka laci tanpa transaksi" HILANG saat buka_laci_no_sale mati — kas manual tetap ada', async () => {
  const hidup = await bukaLaci(1280, 800, 'normal');
  const tombolHidup = await hidup.hal.getByRole('button', { name: 'Buka laci tanpa transaksi' }).count();
  await hidup.hal.close();
  const mati = await bukaLaci(1280, 800, 'normal', '&matikan=buka_laci_no_sale', { tungguForm: false });
  const tombolMati = await mati.hal.getByRole('button', { name: /Buka laci/ }).count();
  const nonaktif = await mati.hal.getByText(/Buka laci tanpa transaksi/).count();
  const simpan = await mati.hal.getByRole('button', { name: 'Simpan catatan' }).count();
  const formAda = await mati.hal.getByRole('heading', { name: 'Operasional laci' }).count();
  await mati.hal.close();
  assert.deepEqual([...hidup.galat, ...mati.galat], []);
  assert.equal(tombolHidup, 1, 'fitur menyala: tombol "Buka laci tanpa transaksi" tidak ada — penjaga kill switch hampa');
  assert.equal(tombolMati, 0, 'buka_laci_no_sale MATI tetapi tombol Buka laci masih tampil (harus HILANG, bukan nonaktif)');
  assert.equal(nonaktif, 0, 'buka_laci_no_sale MATI tetapi teks tombolnya masih ada di layar');
  assert.equal(formAda, 1, 'kill switch buka_laci_no_sale ikut menghilangkan kartu "Operasional laci" — kas manual tidak boleh di balik kill switch (spec-f:369: kill switch tidak menyentuh audit/pencatatan uang)');
  assert.equal(simpan, 1, 'kill switch no-sale ikut menghilangkan tombol Simpan catatan — kas manual tidak boleh di balik kill switch (spec-f:369)');
});

test('keadaan kosong: kalimat kosong di kartu riwayat (DS #7)', async () => {
  const { hal, galat } = await bukaLaci(1280, 800, 'normal', '&tanpaKasManual=1');
  const kartu = await kartuRiwayat(hal);
  const simpan = await hal.getByRole('button', { name: 'Simpan catatan' }).count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.ok(kartu, 'kartu riwayat tidak ada pada shift tanpa kas manual');
  assert.equal(kartu.baris, 0, `shift tanpa kas manual tetap menampilkan ${kartu.baris} baris`);
  assert.match(kartu.teks, /Belum ada kas masuk atau kas keluar di shift ini/, `kalimat kosong tidak ada. Terbaca: ${kartu.teks}`);
  assert.equal(simpan, 1, 'form kas manual hilang saat riwayat kosong — kosong bukan alasan menyembunyikan form');
});

test('perangkat belum terdaftar (keadaan galeri "kosong"): layar menyatakannya, bukan form yang tak dapat bekerja', async () => {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-18&keadaan=kosong`, { waitUntil: 'load' });
  await hal.getByText('Perangkat belum terdaftar').first().waitFor({ timeout: 10_000 });
  const simpan = await hal.getByRole('button', { name: 'Simpan catatan' }).count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(simpan, 0, 'Simpan catatan tampil pada perangkat yang belum terdaftar');
});

test('keadaan error: pesan menyebut AKIBAT bagi kasir, bukan halaman kosong (DS #7)', async () => {
  const { hal, galat } = await bukaLaci(1280, 800, 'error');
  const teks = await teksLayar(hal);
  const simpan = await hal.getByRole('button', { name: 'Simpan catatan' }).count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.match(teks, /tidak dapat dicatat/, `pesan akibat tidak ada. Terbaca: ${teks}`);
  assert.equal(simpan, 0, 'tombol Simpan catatan tetap ada saat database tidak terbaca');
});

/** Mengisi form kas manual. */
async function isiKas(hal, { arah, jumlah, alasan, catatan }) {
  await hal.getByRole('button', { name: arah === 'masuk' ? 'Kas masuk' : 'Kas keluar', exact: true }).click();
  await hal.getByLabel('Jumlah').fill(jumlah);
  await hal.getByRole('radio', { name: alasan }).check();
  if (catatan !== undefined) await hal.getByRole('textbox', { name: /catatan/i }).fill(catatan);
}
/** Menunggu penyimpanan SELESAI (tombol tidak lagi "Mencatat…"), bukan menunggu
    elemen hasil tertentu: kegagalan yang ditelan tidak boleh tampil sebagai timeout. */
const tungguSelesai = (hal) =>
  hal.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^(Simpan catatan|Mencatat…)$/.test(x.textContent.trim()));
    return !!b && b.textContent.trim() === 'Simpan catatan';
  });
const tulisan = (hal) => hal.evaluate(() => globalThis.__galeriTulis.map((t) => ({ sql: t.sql, params: t.params.map((p) => (typeof p === 'bigint' ? String(p) : p)), dalam: t.dalam })));

test('⛔ simpan kas keluar: delta NEGATIF di-bind, satu transaksi (movement + audit + outbox), riwayat bertambah, formulir bersih', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const sebelum = (await kartuRiwayat(hal)).baris;
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  await hal.getByRole('button', { name: 'Simpan catatan' }).click();
  await hal.getByText(/Kas keluar Rp 25\.000 tercatat/).waitFor({ timeout: 5_000 });
  const sesudah = (await kartuRiwayat(hal)).baris;
  const tulis = await tulisan(hal);
  const nilaiJumlah = await hal.getByLabel('Jumlah').inputValue();
  const alasanTerpilih = await hal.locator('input[name="alasan-kas"]:checked').count();
  await hal.close();
  assert.deepEqual(galat, []);

  const mov = tulis.filter((t) => /INSERT INTO cash_movement/.test(t.sql));
  const aud = tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
  const obx = tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  assert.equal(mov.length, 1, `movement ditulis ${mov.length}× — harus tepat 1`);
  assert.equal(aud.length, 1, 'audit event tidak ditulis');
  assert.equal(obx.length, 1, 'outbox tidak ditulis');
  assert.ok([...mov, ...aud, ...obx].every((t) => t.dalam), 'movement/audit/outbox tidak semuanya di DALAM satu transaksi');
  assert.equal(mov[0].params[2], 'paid_out', 'type movement bukan paid_out');
  assert.equal(mov[0].params[3], -25000, `delta yang di-bind ${mov[0].params[3]} — kas KELUAR harus negatif, dan tandanya dari domain`);
  assert.equal(sesudah, sebelum + 1, `riwayat ${sebelum} → ${sesudah} baris sesudah simpan; harus bertambah satu`);
  assert.equal(nilaiJumlah, '', 'kolom jumlah tidak dikosongkan sesudah tercatat — kasir bisa menekan Simpan dua kali');
  assert.equal(alasanTerpilih, 0, 'alasan masih terpilih sesudah tercatat');
});

test('⛔ simpan kas masuk: delta POSITIF di-bind dan jumlah dibaca bacaRupiah ("25.000" = 25000, "25.5" ditolak)', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  await isiKas(hal, { arah: 'masuk', jumlah: '25.5', alasan: 'Tambah modal laci' });
  const simpan = hal.getByRole('button', { name: 'Simpan catatan' });
  const mati255 = await simpan.isDisabled();
  await hal.getByLabel('Jumlah').fill('25.000');
  const matiTitik = await simpan.isDisabled();
  await simpan.click();
  await hal.getByText(/Kas masuk Rp 25\.000 tercatat/).waitFor({ timeout: 5_000 });
  const mov = (await tulisan(hal)).filter((t) => /INSERT INTO cash_movement/.test(t.sql));
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(mati255, true, '"25.5" diterima: desimal harus ditolak (bukan dibaca 255)');
  assert.equal(matiTitik, false, '"25.000" (pemisah ribuan) ditolak');
  assert.equal(mov.length, 1);
  assert.equal(mov[0].params[2], 'paid_in');
  assert.equal(mov[0].params[3], 25000, `delta kas MASUK ${mov[0].params[3]} — harus +25000`);
});

test('Simpan catatan nonaktif DENGAN alasan yang terbaca — kosong, nol, dan "Lainnya" tanpa catatan', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const simpan = hal.getByRole('button', { name: 'Simpan catatan' });
  const alasanTeks = () =>
    hal.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simpan catatan');
      const id = b.getAttribute('aria-describedby');
      return { mati: b.disabled, teks: id ? (document.getElementById(id)?.textContent ?? '').trim() : '' };
    });
  const kosong = await alasanTeks();
  await hal.getByLabel('Jumlah').fill('0');
  await hal.getByRole('radio', { name: 'Bayar pemasok' }).check();
  const nol = await alasanTeks();
  await hal.getByLabel('Jumlah').fill('5000');
  await hal.getByRole('radio', { name: 'Lainnya' }).check();
  const lainnya = await alasanTeks();
  await hal.getByRole('textbox', { name: /catatan/i }).fill('beli es batu');
  const siap = await simpan.isDisabled();
  await hal.close();
  assert.deepEqual(galat, []);
  for (const [nama, x] of [['kosong', kosong], ['nol', nol], ['lainnya tanpa catatan', lainnya]]) {
    assert.equal(x.mati, true, `Simpan catatan aktif pada keadaan "${nama}"`);
    assert.ok(x.teks.length > 0, `Simpan catatan nonaktif pada "${nama}" TANPA alasan yang terbaca (aria-describedby kosong)`);
  }
  assert.notEqual(kosong.teks, nol.teks, 'alasan "kosong" dan "nol" sama — kolom kosong bukan nol (bacaRupiah: null ≠ 0)');
  assert.equal(siap, false, 'form lengkap tetapi Simpan catatan tetap nonaktif');
});

test('⛔ jalur gagal: penulisan gagal → TIDAK tercatat, galat tampil, isian tetap, riwayat tidak berubah', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const sebelum = (await kartuRiwayat(hal)).baris;
  await hal.evaluate(() => { globalThis.__galeriGagalTulis = true; });
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  await hal.getByRole('button', { name: 'Simpan catatan' }).click();
  await tungguSelesai(hal);
  const galatTampil = await hal.getByRole('alert').filter({ hasText: /TIDAK tercatat/ }).count();
  assert.equal(galatTampil, 1, 'gagal simpan ditelan: tidak ada galat "TIDAK tercatat" (role=alert) padahal penulisan gagal');
  const sesudah = (await kartuRiwayat(hal)).baris;
  const jumlah = await hal.getByLabel('Jumlah').inputValue();
  const alasan = await hal.locator('input[name="alasan-kas"]:checked').count();
  const teks = await teksLayar(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(sesudah, sebelum, `riwayat berubah ${sebelum} → ${sesudah} padahal penulisan gagal`);
  assert.equal(jumlah, '25000', 'isian jumlah hilang saat gagal — kasir harus mengetik ulang');
  assert.equal(alasan, 1, 'alasan terpilih hilang saat gagal');
  assert.doesNotMatch(teks, /Kas keluar Rp 25\.000 tercatat/, 'layar berkata "tercatat" padahal penulisan gagal');
});

test('⛔ shift sudah ditutup: kas TIDAK tercatat, alasan terbaca, tidak ada movement', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  await hal.evaluate(() => { globalThis.__galeriShiftTutup = true; });
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  await hal.getByRole('button', { name: 'Simpan catatan' }).click();
  await tungguSelesai(hal);
  const galatTutup = await hal.getByRole('alert').filter({ hasText: /Shift sudah ditutup/ }).count();
  assert.equal(galatTutup, 1, 'gagal simpan ditelan: shift tertutup tidak menampilkan galat "Shift sudah ditutup"');
  const mov = (await tulisan(hal)).filter((t) => /INSERT INTO cash_movement/.test(t.sql));
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(mov.length, 0, 'movement ditulis ke shift yang sudah ditutup');
});

test('⛔ Buka laci tanpa transaksi dari K-18: audit tercatat, TIDAK ada cash_movement, hasil dinyatakan di layar', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  await hal.getByRole('button', { name: 'Buka laci tanpa transaksi' }).click();
  await hal.getByRole('dialog').waitFor({ timeout: 5_000 });
  await hal.getByRole('radio', { name: 'Tukar uang pecahan' }).check();
  await hal.getByRole('dialog').getByRole('button', { name: 'Buka laci', exact: true }).click();
  await hal.getByText(/Pembukaan ke-\d+ tercatat/).first().waitFor({ timeout: 5_000 });
  const tulis = await tulisan(hal);
  const dialog = await hal.getByRole('dialog').count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(tulis.filter((t) => /INSERT INTO cash_movement/.test(t.sql)).length, 0, 'no-sale menulis cash_movement — ia tidak memindahkan uang');
  assert.ok(tulis.some((t) => /INSERT INTO audit_event/.test(t.sql)), 'no-sale tanpa audit_event');
  assert.equal(dialog, 0, 'dialog tidak tertutup sesudah tercatat');
});

test('⛔ dua klik beruntun pada Simpan catatan (dalam satu tugas) menulis SATU movement, bukan dua', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  /* `click()` dua kali tanpa jeda: tidak ada render di antaranya, jadi hanya
     penjaga di dalam `jalankan` (dan tombol yang menonaktifkan diri) yang
     berdiri di antara kasir yang gugup dan uang yang tercatat dua kali. */
  await hal.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simpan catatan');
    b.click();
    b.click();
  });
  await hal.getByText(/Kas keluar Rp 25\.000 tercatat/).waitFor({ timeout: 5_000 });
  await hal.waitForTimeout(300);
  const mov = (await tulisan(hal)).filter((t) => /INSERT INTO cash_movement/.test(t.sql));
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(mov.length, 1, `dua klik menulis ${mov.length} movement — uang yang sama tercatat dua kali`);
});

test('⛔ tombol aksi uang utama "Simpan catatan" tinggi ≥ 56 px (aksi menyangkut uang, DS #3)', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const ukuranDua = {};
  ukuranDua.nonaktif = await hal.getByRole('button', { name: 'Simpan catatan' }).evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  ukuranDua.aktif = await hal.getByRole('button', { name: 'Simpan catatan' }).evaluate((b) => Math.round(b.getBoundingClientRect().height * 10) / 10);
  await hal.close();
  assert.deepEqual(galat, []);
  for (const [k, h] of Object.entries(ukuranDua)) {
    assert.ok(h >= 56, `"Simpan catatan" (${k}) tinggi ${h} px — aksi menyangkut uang harus ≥ 56 px (DS #3, kelas kritis)`);
  }
});

test('⛔ galat baca riwayat saat MEMUAT: keadaan error bertulis, BUKAN kalimat "Belum ada kas…" (nol baris bukan error)', async () => {
  const { hal, galat } = await bukaLaci(1280, 800, 'normal', '&gagalBacaKas=1', { tungguForm: false });
  const teks = await semuaTeks(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.doesNotMatch(teks, /Belum ada kas masuk atau kas keluar/, 'galat baca riwayat ditelan menjadi "Belum ada kas masuk atau kas keluar" — nol baris yang menyamar sebagai keadaan sah');
  assert.match(teks, /tidak dapat dicatat/, `galat baca riwayat tidak menghasilkan keadaan error bertulis (GagalBaca). Terbaca: ${teks.slice(0, 300)}`);
  assert.match(teks, /pembacaan riwayat kas manual gagal/, 'keadaan error tidak membawa pesan galat aslinya');
});

test('⛔ galat baca-ulang riwayat SESUDAH simpan: galat bertulis, daftar lama TIDAK dikosongkan, bukan "Belum ada kas…"', async () => {
  const { hal, galat } = await bukaLaci(1280, 800);
  const sebelum = (await kartuRiwayat(hal)).baris;
  await hal.evaluate(() => { globalThis.__galeriGagalBacaKas = true; });
  await isiKas(hal, { arah: 'keluar', jumlah: '25000', alasan: 'Bayar pemasok' });
  await hal.getByRole('button', { name: 'Simpan catatan' }).click();
  await tungguSelesai(hal);
  await hal.getByText(/Kas keluar Rp 25\.000 tercatat/).waitFor();
  const kartu = await kartuRiwayat(hal);
  const alert = await hal.getByRole('alert').filter({ hasText: /Riwayat tidak dapat dibaca ulang/ }).count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(alert, 1, 'galat baca-ulang riwayat ditelan: tidak ada galat "Riwayat tidak dapat dibaca ulang" (role=alert)');
  assert.doesNotMatch(kartu.teks, /Belum ada kas masuk atau kas keluar/, 'galat baca-ulang mengubah riwayat menjadi "Belum ada kas…" — nol baris yang menyamar sebagai keadaan sah');
  assert.equal(kartu.baris, sebelum, `daftar lama dikosongkan/diubah saat baca-ulang gagal (${sebelum} → ${kartu.baris} baris)`);
});
