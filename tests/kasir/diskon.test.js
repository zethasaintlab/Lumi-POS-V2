'use strict';

// FR-B8 di sisi perangkat — ambang outlet, label alasan, dan keadaan diskon
// terhadap subtotal SEKARANG.
//
// ⛔ Yang paling menentukan di berkas ini adalah satu aturan yang tidak ada di
// server: persetujuan manajer berlaku untuk ANGKA yang ia lihat, bukan untuk
// persentase selamanya. Tanpa itu, "30% disetujui" berlaku untuk keranjang
// berapa pun sesudahnya — kasir tinggal menambah barang setelah manajer pergi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/diskon.ts';

function dbPalsu(baris) {
  return {
    async getAll(sql) {
      if (/FROM outlet/.test(sql)) return baris === null ? [] : [baris];
      return [];
    },
  };
}

const DISKON = {
  minta: { tipe: 'persen', nilai: 3000n },
  alasanKode: 'promo_berjalan',
  alasanCatatan: null,
  approverId: null,
  nominalDisetujui: null,
};

// ---------------------------------------------------------------------------
// Ambang
// ---------------------------------------------------------------------------

test('ambang outlet dipakai bila kolomnya terisi', async () => {
  const { bacaAmbangDiskon } = await import(MOD);
  const ambang = await bacaAmbangDiskon(
    dbPalsu({ discount_threshold_percent: 1000, discount_threshold_amount: 25_000 }),
    'o1'
  );
  assert.equal(ambang.persenSkala, 1000n);
  assert.equal(ambang.nominal, 25_000n);
});

test('kolom null jatuh ke bawaan domain, satu per satu', async () => {
  const { bacaAmbangDiskon } = await import(MOD);
  const { AMBANG_DISKON_BAWAAN } = await import('../../packages/domain/src/diskon.ts');
  const ambang = await bacaAmbangDiskon(
    dbPalsu({ discount_threshold_percent: null, discount_threshold_amount: 25_000 }),
    'o1'
  );
  // Bawaan hidup di domain, BUKAN sebagai DEFAULT kolom: kolom ber-default
  // membuat perubahan bawaan hanya berlaku untuk outlet yang dibuat sesudahnya.
  assert.equal(ambang.persenSkala, AMBANG_DISKON_BAWAAN.persenSkala);
  assert.equal(ambang.nominal, 25_000n);
});

test('⛔ outlet yang TIDAK ADA tetap mendapat ambang, bukan "tanpa batas"', async () => {
  const { bacaAmbangDiskon } = await import(MOD);
  const { AMBANG_DISKON_BAWAAN } = await import('../../packages/domain/src/diskon.ts');
  // Perangkat yang katalognya belum turun penuh adalah keadaan normal.
  // Ketiadaan baris yang diartikan "tidak ada batas" mematikan kontrol FR-B8
  // justru pada perangkat yang paling baru dipasang.
  const ambang = await bacaAmbangDiskon(dbPalsu(null), 'o1');
  assert.deepEqual(ambang, AMBANG_DISKON_BAWAAN);
});

test('⛔ kolom yang tiba sebagai bigint atau string tetap terbaca', async () => {
  const { bacaAmbangDiskon } = await import(MOD);
  // `@powersync/web` mengembalikan kolom INTEGER besar sebagai `bigint`
  // sementara driver test (`node:sqlite`) mengembalikan `number`. Guard yang
  // hanya memeriksa satu bentuk hijau di seluruh test dan salah di aplikasi.
  const a = await bacaAmbangDiskon(
    dbPalsu({ discount_threshold_percent: 1500n, discount_threshold_amount: '30000' }),
    'o1'
  );
  assert.equal(a.persenSkala, 1500n);
  assert.equal(a.nominal, 30_000n);
});

// ---------------------------------------------------------------------------
// Keadaan diskon
// ---------------------------------------------------------------------------

const AMBANG = { persenSkala: 2000n, nominal: 50_000n };

test('tanpa diskon, statusnya null — bukan nol', async () => {
  const { statusDiskon } = await import(MOD);
  assert.equal(statusDiskon(100_000n, null, AMBANG), null);
});

test('di bawah ambang tidak menuntut apa pun', async () => {
  const { statusDiskon } = await import(MOD);
  const s = statusDiskon(100_000n, { ...DISKON, minta: { tipe: 'persen', nilai: 500n } }, AMBANG);
  assert.equal(s.nominal, 5000n);
  assert.equal(s.diAtasAmbang, false);
  assert.equal(s.perluPersetujuan, false);
});

test('di atas ambang tanpa penyetuju menuntut persetujuan', async () => {
  const { statusDiskon } = await import(MOD);
  const s = statusDiskon(100_000n, DISKON, AMBANG);
  assert.equal(s.nominal, 30_000n);
  assert.equal(s.diAtasAmbang, true);
  assert.equal(s.perluPersetujuan, true);
});

test('⛔ persetujuan menutup potongan yang SAMA atau lebih kecil', async () => {
  const { statusDiskon } = await import(MOD);
  const disetujui = { ...DISKON, approverId: 'u-budi', nominalDisetujui: 30_000n };

  const sama = statusDiskon(100_000n, disetujui, AMBANG);
  assert.equal(sama.perluPersetujuan, false, 'angka yang sama diminta ulang');

  // Keranjang menyusut: 30% kini Rp 15.000. Meminta persetujuan ulang untuk
  // yang lebih kecil hanya melatih manajer mengetik PIN tanpa membaca.
  const kecil = statusDiskon(50_000n, disetujui, AMBANG);
  assert.equal(kecil.nominal, 15_000n);
  assert.equal(kecil.perluPersetujuan, false);
});

test('⛔ persetujuan TIDAK menutup potongan yang TUMBUH melewatinya', async () => {
  const { statusDiskon } = await import(MOD);
  const disetujui = { ...DISKON, approverId: 'u-budi', nominalDisetujui: 30_000n };
  // Manajer melihat Rp 30.000 dan pergi; kasir menambah barang senilai
  // Rp 100.000 dan potongannya menjadi Rp 60.000 dengan persetujuan yang sama.
  const s = statusDiskon(200_000n, disetujui, AMBANG);
  assert.equal(s.nominal, 60_000n);
  assert.equal(s.diAtasAmbang, true);
  assert.equal(s.perluPersetujuan, true);
});

test('⛔ approverId TANPA nominalDisetujui tidak menutup apa pun', async () => {
  const { statusDiskon } = await import(MOD);
  // Bentuk yang lahir dari kode lama, atau dari jalur yang lupa mengisinya.
  // Menganggapnya tertutup berarti satu field yang hilang mematikan aturannya
  // diam-diam — dan yang diam adalah yang tidak pernah diperbaiki.
  const s = statusDiskon(100_000n, { ...DISKON, approverId: 'u-budi' }, AMBANG);
  assert.equal(s.perluPersetujuan, true);
});

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

test('⛔ setiap kode alasan diskon punya label, dan tidak ada label yatim', async () => {
  const { LABEL_ALASAN_DISKON } = await import(MOD);
  const { ALASAN_DISKON } = await import('../../packages/domain/src/diskon.ts');

  // Kode yang lahir di domain tanpa label muncul di layar sebagai
  // `pelanggan_langganan`. Label yang tertinggal untuk kode yang sudah dihapus
  // lebih buruk: opsi mati yang terlihat sah, dan alasannya ditolak server
  // setelah antrean terkuras.
  assert.deepEqual(Object.keys(LABEL_ALASAN_DISKON).sort(), [...ALASAN_DISKON].sort());
  for (const kode of ALASAN_DISKON) {
    assert.ok(LABEL_ALASAN_DISKON[kode].length > 0, `label kosong untuk ${kode}`);
    assert.ok(!LABEL_ALASAN_DISKON[kode].includes('_'), `label ${kode} masih kode mentah`);
  }
});

// ---------------------------------------------------------------------------
// ⛔ B-26 — ketiga ambang, dan yang membuat setelan itu berarti
// ---------------------------------------------------------------------------

test('⛔ ketiga ambang dibaca dari outlet, masing-masing jatuh ke bawaan sendiri', async () => {
  const { bacaAmbangOutlet } = await import(MOD);
  const { AMBANG_BAWAAN } = await import('../../packages/domain/src/ambang.ts');

  const ambang = await bacaAmbangOutlet(
    dbPalsu({
      discount_threshold_percent: null,
      discount_threshold_amount: null,
      cash_variance_threshold: 50_000,
      no_sale_threshold: null,
    }),
    'o1'
  );
  assert.equal(ambang.selisihKas, 50_000n);
  assert.equal(ambang.noSale, AMBANG_BAWAAN.noSale);
  assert.equal(ambang.diskonPersenSkala, AMBANG_BAWAAN.diskonPersenSkala);
});

test('⛔ NOL dari perangkat tetap NOL, bukan jatuh ke bawaan', async () => {
  // Merchant yang menyetel nol memilih "setiap kejadian menuntut otorisasi".
  // `0 || bawaan` membuangnya, dan perangkat kemudian menerima diam-diam apa
  // yang server tolak.
  const { bacaAmbangOutlet } = await import(MOD);
  const ambang = await bacaAmbangOutlet(
    dbPalsu({
      discount_threshold_percent: null,
      discount_threshold_amount: null,
      cash_variance_threshold: 0,
      no_sale_threshold: 0,
    }),
    'o1'
  );
  assert.equal(ambang.selisihKas, 0n);
  assert.equal(ambang.noSale, 0);
});

test('⛔ `bigint` dari @powersync/web diterima, sama seperti `number`', async () => {
  // Driver aplikasi mengembalikan kolom INTEGER besar sebagai `bigint`
  // sementara driver test mengembalikan `number` (`CLAUDE.md`). Guard yang
  // hanya memeriksa satu bentuk hijau di seluruh test dan salah di aplikasi.
  const { bacaAmbangOutlet } = await import(MOD);
  const ambang = await bacaAmbangOutlet(
    dbPalsu({
      discount_threshold_percent: 1000n,
      discount_threshold_amount: '25000',
      cash_variance_threshold: 50_000n,
      no_sale_threshold: 6n,
    }),
    'o1'
  );
  assert.equal(ambang.diskonPersenSkala, 1000n);
  assert.equal(ambang.diskonNominal, 25_000n);
  assert.equal(ambang.selisihKas, 50_000n);
  // ⛔ `noSale` WAJIB `number`: ia masuk perbandingan dengan `number` di
  // `butuhPenyetujuNoSale`, dan `bigint` di sana melempar TypeError — di jalur
  // buka laci, bukan di test.
  assert.equal(ambang.noSale, 6);
  assert.equal(typeof ambang.noSale, 'number');
});

test('⛔ outlet yang TIDAK ADA mendapat ketiga bawaan, bukan "tanpa batas"', async () => {
  const { bacaAmbangOutlet } = await import(MOD);
  const { AMBANG_BAWAAN } = await import('../../packages/domain/src/ambang.ts');
  assert.deepEqual(await bacaAmbangOutlet(dbPalsu(null), 'o1'), AMBANG_BAWAAN);
});
