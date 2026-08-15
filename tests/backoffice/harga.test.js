'use strict';

// B-10 — muatan harga dan ringkasan riwayat.
//
// ⛔ Aturan terpenting di berkas ini: "berlaku sekarang" MENGHILANGKAN
// `effectiveFrom`, tidak mengirim jam browser.
//
// `createPrice` menulis `COALESCE($6, now())` — jam PostgreSQL. Mengirim
// `new Date().toISOString()` memperkenalkan jam KETIGA, dan `CLAUDE.md`
// mencatat pengukurannya: skew ±2 ms antara jam Node dan jam PostgreSQL sudah
// cukup membuat harga yang baru ditulis dianggap belum berlaku. Jam browser
// merchant dapat meleset menit.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/katalog/harga.ts';

const ID = '018f2a10-0000-7000-8000-00000000ffff';

const DASAR = {
  harga: '30.000',
  outletId: '',
  berlaku: 'sekarang',
  tanggal: '',
  jam: '',
  alasan: '',
};

// ---------------------------------------------------------------------------

test('⛔ "berlaku sekarang" TIDAK mengirim effectiveFrom sama sekali', async () => {
  // Bukan mengirim null, bukan mengirim string kosong — kuncinya TIDAK ADA.
  // `COALESCE($6, now())` hanya jatuh ke `now()` untuk NULL, dan yang paling
  // penting: tidak ada jam browser yang pernah ikut.
  const { buatMuatanHarga } = await import(MOD);
  const hasil = buatMuatanHarga(DASAR, ID);

  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.ok(
    !('effectiveFrom' in hasil.muatan),
    `effectiveFrom ikut terkirim: ${JSON.stringify(hasil.muatan)}`
  );
  assert.deepEqual(hasil.muatan, { id: ID, price: 30000, outletId: null, reason: null });
});

test('⛔ tidak ada jalur mana pun yang menghasilkan jam browser', async () => {
  // Penjaga bentuk: apa pun isian formnya, `effectiveFrom` hanya boleh muncul
  // bila merchant MENJADWALKANNYA secara eksplisit. Versi yang mengirim
  // `new Date()` sebagai cadangan akan lolos test di atas dan tetap salah.
  const { buatMuatanHarga } = await import(MOD);
  for (const berlaku of ['sekarang', '', 'entah']) {
    const hasil = buatMuatanHarga({ ...DASAR, berlaku }, ID);
    assert.equal(hasil.ok, true, `"${berlaku}" ditolak`);
    assert.ok(!('effectiveFrom' in hasil.muatan), `"${berlaku}" mengirim effectiveFrom`);
  }
});

test('harga terjadwal mengirim effectiveFrom ISO dari tanggal + jam', async () => {
  const { buatMuatanHarga } = await import(MOD);
  const hasil = buatMuatanHarga(
    { ...DASAR, berlaku: 'terjadwal', tanggal: '2026-09-01', jam: '08:00' },
    ID
  );
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  // ISO dengan offset lokal perangkat — merchant memilih jam DINDINGNYA, dan
  // itu memang jam yang ia maksud.
  assert.match(hasil.muatan.effectiveFrom, /^2026-09-01T/);
  assert.equal(new Date(hasil.muatan.effectiveFrom).getHours(), 8);
});

test('⛔ terjadwal tanpa tanggal ditolak, bukan diam-diam jadi "sekarang"', async () => {
  // Kalau ia jatuh ke "sekarang", merchant yang bermaksud menjadwalkan kenaikan
  // harga pekan depan menaikkannya HARI INI — dan baru tahu dari laporan.
  const { buatMuatanHarga } = await import(MOD);
  const hasil = buatMuatanHarga({ ...DASAR, berlaku: 'terjadwal', tanggal: '', jam: '08:00' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'tanggal');
});

test('terjadwal tanpa jam memakai tengah malam, dan itu dinyatakan', async () => {
  const { buatMuatanHarga } = await import(MOD);
  const hasil = buatMuatanHarga({ ...DASAR, berlaku: 'terjadwal', tanggal: '2026-09-01', jam: '' }, ID);
  assert.equal(hasil.ok, true);
  assert.equal(new Date(hasil.muatan.effectiveFrom).getHours(), 0);
});

test('harga memakai aturan rupiah yang SAMA dengan B-06/B-07', async () => {
  // `bacaRupiah` sudah ada di `produk.ts` dan sudah punya cacat yang
  // diperbaiki (`25.5` → 255). Salinan kedua di sini akan mengulanginya.
  const { buatMuatanHarga } = await import(MOD);
  const { bacaRupiah } = await import('../../apps/backoffice/src/katalog/produk.ts');

  for (const teks of ['30.000', '30000', '25.5', 'abc', '']) {
    const domain = bacaRupiah(teks);
    const hasil = buatMuatanHarga({ ...DASAR, harga: teks }, ID);
    assert.equal(hasil.ok, domain !== null, `beda putusan untuk "${teks}"`);
    if (domain !== null) assert.equal(hasil.muatan.price, domain);
    else assert.equal(hasil.bidang, 'harga');
  }
});

test('outlet kosong berarti SEMUA outlet — null, bukan string kosong', async () => {
  // `outlet_id IS NULL` adalah anak tangga kedua (default tenant). String
  // kosong adalah FK ke outlet bernama kosong, dan server menjawab 404.
  const { buatMuatanHarga } = await import(MOD);
  assert.equal(buatMuatanHarga(DASAR, ID).muatan.outletId, null);
  assert.equal(buatMuatanHarga({ ...DASAR, outletId: 'o1' }, ID).muatan.outletId, 'o1');
});

test('alasan kosong dikirim null, terisi dipangkas', async () => {
  const { buatMuatanHarga } = await import(MOD);
  assert.equal(buatMuatanHarga({ ...DASAR, alasan: '  ' }, ID).muatan.reason, null);
  assert.equal(buatMuatanHarga({ ...DASAR, alasan: ' naik BBM ' }, ID).muatan.reason, 'naik BBM');
});

// ---------------------------------------------------------------------------
// Ringkasan riwayat
// ---------------------------------------------------------------------------

const SEKARANG = new Date('2026-08-15T12:00:00.000Z').getTime();

const BARIS = (over) => ({
  id: 'p1',
  variationId: 'v1',
  outletId: null,
  price: 25000,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  changedBy: 'u1',
  reason: null,
  ...over,
});

test('⛔ baris masa depan ditandai TERJADWAL, bukan berlaku', async () => {
  // `effective_from` boleh di masa depan, dan resolusi `effective_from <= at`
  // yang menentukan kapan ia berlaku. Menampilkannya sebagai "berlaku" membuat
  // merchant mengira harganya sudah naik.
  const { ringkasRiwayat } = await import(MOD);
  const hasil = ringkasRiwayat(
    [BARIS({ id: 'nanti', effectiveFrom: '2026-09-01T00:00:00.000Z' }), BARIS({ id: 'kini' })],
    SEKARANG
  );
  const peta = Object.fromEntries(hasil.map((b) => [b.id, b.status]));
  assert.equal(peta.nanti, 'terjadwal');
  assert.equal(peta.kini, 'berlaku');
});

test('⛔ hanya baris TERBARU per scope yang berlaku; sisanya lampau', async () => {
  const { ringkasRiwayat } = await import(MOD);
  const hasil = ringkasRiwayat(
    [
      BARIS({ id: 'lama', effectiveFrom: '2026-07-01T00:00:00.000Z', price: 20000 }),
      BARIS({ id: 'baru', effectiveFrom: '2026-08-01T00:00:00.000Z', price: 25000 }),
    ],
    SEKARANG
  );
  const peta = Object.fromEntries(hasil.map((b) => [b.id, b.status]));
  assert.equal(peta.baru, 'berlaku');
  assert.equal(peta.lama, 'lampau');
});

test('⛔ scope OUTLET dan scope TENANT dihitung TERPISAH', async () => {
  // Keduanya anak tangga berbeda. Harga outlet yang lebih lama TIDAK menjadi
  // "lampau" hanya karena ada harga tenant yang lebih baru — ia tetap yang
  // berlaku di outletnya, dan justru menimpa harga tenant itu.
  const { ringkasRiwayat } = await import(MOD);
  const hasil = ringkasRiwayat(
    [
      BARIS({ id: 'tenant-baru', outletId: null, effectiveFrom: '2026-08-10T00:00:00.000Z' }),
      BARIS({ id: 'outlet-lama', outletId: 'o1', effectiveFrom: '2026-08-01T00:00:00.000Z' }),
    ],
    SEKARANG
  );
  const peta = Object.fromEntries(hasil.map((b) => [b.id, b.status]));
  assert.equal(peta['tenant-baru'], 'berlaku');
  assert.equal(peta['outlet-lama'], 'berlaku', 'harga outlet ditandai lampau oleh harga tenant');
});

test('urutan tampil: terbaru dulu, dan dimiliki JS', async () => {
  // Server menjaminnya lewat ORDER BY, dan jaminan yang hanya hidup di SQL
  // tidak dapat diuji sama sekali (`CLAUDE.md`).
  const { ringkasRiwayat } = await import(MOD);
  const hasil = ringkasRiwayat(
    [
      BARIS({ id: 'a', effectiveFrom: '2026-07-01T00:00:00.000Z' }),
      BARIS({ id: 'c', effectiveFrom: '2026-09-01T00:00:00.000Z' }),
      BARIS({ id: 'b', effectiveFrom: '2026-08-01T00:00:00.000Z' }),
    ],
    SEKARANG
  );
  assert.deepEqual(hasil.map((b) => b.id), ['c', 'b', 'a']);
});

test('riwayat kosong menghasilkan daftar kosong, bukan melempar', async () => {
  const { ringkasRiwayat } = await import(MOD);
  assert.deepEqual(ringkasRiwayat([], SEKARANG), []);
});
