'use strict';

// B-29 "Langganan & Batas" — aturan tampilan kuota.
//
// Diuji sebagai fungsi murni, tanpa DOM. Yang paling penting di sini adalah
// `batas: null`: setiap aritmetika yang menyentuhnya diam-diam salah, dan
// gejalanya adalah bar progres yang meledak atau "12 dari 0" pada tier yang
// justru TIDAK punya batas.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/langganan/kuota-tampilan.ts';
const KUOTA = '../../packages/domain/src/kuota.ts';

// --- ⛔ tanpa batas ---------------------------------------------------------

test('⛔ batas null → status tanpa-batas, dan persen NULL (bukan 0, bukan Infinity)', async () => {
  const { hitungBaris } = await import(MOD);
  const b = hitungBaris('produk', { terpakai: 1_000_000, batas: null });

  assert.equal(b.status, 'tanpa-batas');
  assert.equal(b.persen, null, 'persen dihitung padahal tidak ada batas');
  assert.equal(b.batas, null);
  assert.equal(b.label, 'Tanpa batas');
});

test('⛔ tanpa batas TIDAK PERNAH menghasilkan Infinity atau NaN', async () => {
  // `terpakai / null` = Infinity. Satu operasi aritmetika sebelum cabang
  // `null` sudah cukup untuk membuat bar progres melewati wadahnya.
  const { hitungBaris } = await import(MOD);
  for (const terpakai of [0, 1, 999_999]) {
    const b = hitungBaris('device', { terpakai, batas: null });
    assert.ok(b.persen === null, `persen = ${b.persen}`);
    assert.ok(Number.isFinite(b.terpakai));
  }
});

test('⛔ tanpa batas TIDAK ditandai penuh, meski pemakaiannya besar', async () => {
  // `terpakai > null` bernilai false lewat koersi ke 0 — jadi "tidak penuh"
  // kebetulan benar. Tapi `terpakai === batas` dengan terpakai 0 dan batas
  // null bernilai false juga; yang berbahaya adalah urutan cabang yang
  // berbeda. Dijaga eksplisit.
  const { hitungBaris } = await import(MOD);
  assert.equal(hitungBaris('outlet', { terpakai: 0, batas: null }).tone, 'neutral');
  assert.equal(hitungBaris('outlet', { terpakai: 500, batas: null }).status, 'tanpa-batas');
});

// --- ambang ----------------------------------------------------------------

test('status berjenjang: tersedia → mendekati → penuh → melebihi', async () => {
  const { hitungBaris } = await import(MOD);
  const s = (terpakai, batas) => hitungBaris('produk', { terpakai, batas }).status;

  assert.equal(s(0, 200), 'aman');
  assert.equal(s(159, 200), 'aman', '79,5% belum mendekati');
  assert.equal(s(160, 200), 'mendekati', '80% tepat adalah ambangnya');
  assert.equal(s(199, 200), 'mendekati');
  assert.equal(s(200, 200), 'penuh');
  assert.equal(s(201, 200), 'terlampaui');
});

test('⛔ setiap status punya LABEL teks — warna saja tidak pernah cukup', async () => {
  // Aturan design system #5. Merchant dengan gangguan penglihatan warna, dan
  // layar yang dilihat di bawah cahaya toko, keduanya membaca teksnya.
  const { hitungBaris } = await import(MOD);
  const kasus = [
    [0, 200],
    [160, 200],
    [200, 200],
    [201, 200],
    [5, null],
    [0, 0],
  ];
  for (const [terpakai, batas] of kasus) {
    const b = hitungBaris('produk', { terpakai, batas });
    assert.ok(
      typeof b.label === 'string' && b.label.length > 0,
      `status "${b.status}" tanpa label teks`
    );
  }
});

test('⛔ melebihi batas DIJEPIT di 100%, tidak melewati wadahnya', async () => {
  // Merchant yang TURUN paket berada di atas kuota barunya. Bar yang melewati
  // wadahnya terbaca seperti kerusakan tampilan, bukan seperti peringatan.
  const { hitungBaris } = await import(MOD);
  const b = hitungBaris('produk', { terpakai: 5000, batas: 200 });
  assert.equal(b.persen, 100);
  assert.equal(b.status, 'terlampaui');
  // Angka sebenarnya tetap terbaca.
  assert.equal(b.terpakai, 5000);
  assert.equal(b.batas, 200);
});

test('⛔ batas 0 tidak membagi dengan nol', async () => {
  const { hitungBaris } = await import(MOD);
  const kosong = hitungBaris('device', { terpakai: 0, batas: 0 });
  assert.equal(kosong.persen, 100);
  assert.ok(Number.isFinite(kosong.persen));
  assert.match(kosong.label, /tidak tersedia/i);

  const lebih = hitungBaris('device', { terpakai: 2, batas: 0 });
  assert.equal(lebih.status, 'terlampaui');
  assert.ok(Number.isFinite(lebih.persen));
});

// --- urutan & bentuk -------------------------------------------------------

test('⛔ urutan baris dari DIMENSI_KUOTA, bukan dari urutan kunci JSON server', async () => {
  // Baris yang berpindah tempat setiap kali data dimuat ulang adalah tabel
  // yang tidak dapat dibaca — dan urutan kunci JSON dapat berubah tanpa ada
  // yang menganggapnya perubahan.
  const { susunBaris } = await import(MOD);
  const { DIMENSI_KUOTA } = await import(KUOTA);

  const pemakaian = {
    plan: 'free',
    status: 'active',
    // Sengaja diacak.
    kuota: {
      produk: { terpakai: 1, batas: 200 },
      device: { terpakai: 2, batas: 2 },
      outlet: { terpakai: 1, batas: 1 },
      pengguna: { terpakai: 1, batas: 3 },
    },
  };

  const baris = susunBaris(pemakaian, DIMENSI_KUOTA);
  assert.deepEqual(baris.map((b) => b.dimensi), [...DIMENSI_KUOTA]);
});

test('⛔ dimensi yang TIDAK dikirim server dilewati, bukan dirender nol', async () => {
  // "0 dari 0" untuk sesuatu yang server tidak ketahui adalah berbohong
  // dengan percaya diri.
  const { susunBaris } = await import(MOD);
  const { DIMENSI_KUOTA } = await import(KUOTA);

  const baris = susunBaris(
    { plan: 'free', status: 'active', kuota: { produk: { terpakai: 3, batas: 200 } } },
    DIMENSI_KUOTA
  );
  assert.equal(baris.length, 1);
  assert.equal(baris[0].dimensi, 'produk');
});

test('respons tanpa kuota sama sekali tidak melempar', async () => {
  const { susunBaris } = await import(MOD);
  const { DIMENSI_KUOTA } = await import(KUOTA);
  assert.deepEqual(susunBaris({ plan: 'free', status: 'active' }, DIMENSI_KUOTA), []);
});

test('setiap baris punya judul yang dibaca merchant, bukan nama kolom', async () => {
  const { susunBaris } = await import(MOD);
  const { DIMENSI_KUOTA } = await import(KUOTA);
  const baris = susunBaris(
    {
      plan: 'free',
      status: 'active',
      kuota: {
        produk: { terpakai: 1, batas: 200 },
        outlet: { terpakai: 1, batas: 1 },
        pengguna: { terpakai: 1, batas: 3 },
        device: { terpakai: 0, batas: 2 },
      },
    },
    DIMENSI_KUOTA
  );
  assert.deepEqual(
    baris.map((b) => b.judul).sort(),
    ['Outlet', 'Pengguna', 'Perangkat', 'Produk']
  );
  for (const b of baris) {
    assert.ok(!/max_|_id|device$/.test(b.judul), `judul "${b.judul}" terbaca seperti nama kolom`);
  }
});

// --- label -----------------------------------------------------------------

test('⛔ paket tak dikenal ditampilkan apa adanya, tidak dijatuhkan ke Gratis', async () => {
  // Menampilkan tier yang salah di layar yang merchant pakai untuk memutuskan
  // pembayaran adalah kesalahan yang mahal.
  const { labelPaket } = await import(MOD);
  assert.equal(labelPaket('free'), 'Gratis');
  assert.equal(labelPaket('enterprise'), 'Enterprise');
  assert.equal(labelPaket('paket-baru-2027'), 'paket-baru-2027');
});

test('status tenant diterjemahkan', async () => {
  const { labelStatusTenant } = await import(MOD);
  assert.equal(labelStatusTenant('active'), 'Aktif');
  assert.equal(labelStatusTenant('suspended'), 'Ditangguhkan');
  assert.equal(labelStatusTenant('entah'), 'entah');
});
