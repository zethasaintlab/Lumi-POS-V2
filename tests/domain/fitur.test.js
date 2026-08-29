'use strict';

// Feature flag dan kill switch. `ARCH:358`, KEP-36.
//
// "Kill switch: per fitur per merchant, dari server tanpa rilis — kebutuhan
// operasional, bukan kemewahan."
//
// ⛔ Yang paling menentukan di berkas ini ada dua, dan keduanya bukan tentang
// menyalakan fitur:
//
//   1. Kunci ASING dibaca MATI, bukan hidup. Baris yang tertinggal untuk fitur
//      yang sudah dihapus dari kode tidak boleh menyalakan apa pun.
//   2. Tidak ada flag yang boleh menyentuh audit (`spec-f:369`), dan yang
//      menegakkannya adalah daftar tertutup — karena kunci berikutnya akan
//      ditambahkan oleh orang yang sedang menangani insiden.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/fitur.ts';

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

test('tanpa penyimpangan, yang berlaku adalah bawaan KODE', async () => {
  const { FITUR, resolusiFitur } = await import(MOD);
  for (const f of FITUR) {
    assert.equal(resolusiFitur([], f.kunci, T1), f.bawaan, `${f.kunci} tidak memakai bawaannya`);
  }
});

test('⛔ penyimpangan TENANT menang atas penyimpangan GLOBAL', async () => {
  const { resolusiFitur } = await import(MOD);
  const penyimpangan = [
    { kunci: 'diskon_kasir', tenantId: null, aktif: false },
    { kunci: 'diskon_kasir', tenantId: T1, aktif: true },
  ];
  // "Matikan untuk semua kecuali yang sudah kami periksa" adalah bentuk
  // pemulihan insiden yang paling sering dipakai. Urutan yang terbalik
  // membuatnya mustahil.
  assert.equal(resolusiFitur(penyimpangan, 'diskon_kasir', T1), true);
  assert.equal(resolusiFitur(penyimpangan, 'diskon_kasir', T2), false);
});

test('penyimpangan global berlaku untuk merchant yang tidak punya barisnya', async () => {
  const { resolusiFitur } = await import(MOD);
  const penyimpangan = [{ kunci: 'pembayaran_qris_statis', tenantId: null, aktif: false }];
  assert.equal(resolusiFitur(penyimpangan, 'pembayaran_qris_statis', T2), false);
});

test('⛔ penyimpangan milik merchant LAIN tidak berpengaruh', async () => {
  const { resolusiFitur, bawaanFitur } = await import(MOD);
  const penyimpangan = [{ kunci: 'buka_laci_no_sale', tenantId: T2, aktif: false }];
  assert.equal(
    resolusiFitur(penyimpangan, 'buka_laci_no_sale', T1),
    bawaanFitur('buka_laci_no_sale'),
    'kill switch merchant lain ikut mematikan fitur di sini'
  );
});

test('⛔ kunci ASING dibaca MATI, bukan hidup', async () => {
  const { resolusiFitur } = await import(MOD);
  // Baris yang tertinggal untuk fitur yang sudah dihapus dari kode tidak boleh
  // menyalakan apa pun; dan kunci yang salah ketik di alat operator harus
  // terlihat sebagai fitur yang tidak menyala, bukan diam-diam tidak
  // berpengaruh.
  assert.equal(resolusiFitur([], 'fitur_yang_sudah_dihapus', T1), false);
  assert.equal(
    resolusiFitur([{ kunci: 'salah_ketik', tenantId: T1, aktif: true }], 'salah_ketik', T1),
    false
  );
});

test('⛔ TIDAK ADA flag yang menyentuh audit (`spec-f:369`)', async () => {
  const { FITUR } = await import(MOD);
  // "Tidak ada setting, feature flag, maupun endpoint yang menonaktifkan
  // audit trail." Daftar tertutup adalah yang menegakkannya.
  for (const f of FITUR) {
    assert.equal(
      /audit|jejak|log/i.test(`${f.kunci} ${f.keterangan.split('.')[0]}`),
      false,
      `flag "${f.kunci}" menyentuh audit — spec-f:369 melarangnya tanpa pengecualian`
    );
  }
});

test('⛔ TIDAK ADA flag yang dapat menghentikan penjualan', async () => {
  const { FITUR } = await import(MOD);
  // Kill switch yang dapat menghentikan penjualan adalah SEV-1 yang dipicu
  // sendiri. Tunai, penyimpanan penjualan, dan tutup kas tidak punya flag dan
  // tidak akan pernah punya.
  const TERLARANG = ['tunai', 'cash', 'penjualan', 'simpan_penjualan', 'tutup_kas', 'shift'];
  for (const f of FITUR) {
    for (const t of TERLARANG) {
      assert.equal(
        f.kunci === t || f.kunci.startsWith(`${t}_`),
        false,
        `flag "${f.kunci}" dapat menghentikan penjualan`
      );
    }
  }
});

test('setiap fitur punya keterangan untuk OPERATOR', async () => {
  const { FITUR } = await import(MOD);
  // Alat operator menampilkannya saat seseorang hendak mematikan sesuatu di
  // tengah insiden. Kunci telanjang tidak cukup untuk memutuskan apa pun.
  for (const f of FITUR) {
    assert.ok(f.keterangan.length > 40, `keterangan "${f.kunci}" terlalu pendek untuk berguna`);
  }
});

test('kunci unik, dan `adalahKunciFitur` sepakat dengan daftarnya', async () => {
  const { FITUR, adalahKunciFitur } = await import(MOD);
  const kunci = FITUR.map((f) => f.kunci);
  assert.equal(new Set(kunci).size, kunci.length, 'ada kunci ganda');
  for (const k of kunci) assert.equal(adalahKunciFitur(k), true);
  assert.equal(adalahKunciFitur('bukan_fitur'), false);
  assert.equal(adalahKunciFitur(null), false);
});

test('`resolusiSemuaFitur` menjawab SETIAP fitur, bukan hanya yang menyimpang', async () => {
  const { FITUR, resolusiSemuaFitur } = await import(MOD);
  const hasil = resolusiSemuaFitur([{ kunci: 'diskon_kasir', tenantId: T1, aktif: false }], T1);
  // Perangkat yang hanya menerima yang menyimpang harus menebak sisanya, dan
  // menebak dengan daftar yang lebih tua daripada server.
  assert.deepEqual(Object.keys(hasil).sort(), FITUR.map((f) => f.kunci).sort());
  assert.equal(hasil.diskon_kasir, false);
});

test('⛔ kosakata kunci SAMA dengan yang dipakai alat operator', async () => {
  const { FITUR } = await import(MOD);
  const fs = require('node:fs');
  const alat = fs.readFileSync(require('node:path').join(__dirname, '..', '..', 'tools', 'kill-switch.mjs'), 'utf8');
  // Alat yang punya daftarnya sendiri akan menyimpang, dan yang menyimpang
  // menulis baris ber-kunci yang tidak pernah cocok saat resolusi — kill
  // switch yang terlihat aktif dan tidak mematikan apa pun.
  assert.match(alat, /from '\.\.\/packages\/domain\/src\/fitur\.ts'|packages\/domain\/src\/fitur\.ts/);
  for (const f of FITUR) {
    assert.equal(
      alat.includes(`'${f.kunci}'`),
      false,
      `alat menyalin kunci "${f.kunci}" alih-alih membacanya dari domain`
    );
  }
});
