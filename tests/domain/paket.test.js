'use strict';

// Kuota per paket — `research/09` § 6, `research/11` § 3.
//
// ⛔ Tidak ada spec modul untuk ini. Delapan spec (`spec-a`…`spec-h`) tidak
// memuat satu pun acceptance criterion tentang paket, kuota, atau lisensi,
// dan 77 FR di PRD berhenti di FR-H8. Angkanya karena itu `[ASUMSI]` — yang
// diuji di sini adalah BENTUKNYA, plus dua aturan yang bukan asumsi sama
// sekali.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/paket.ts';

test('setiap paket di CHECK constraint punya kuota', async () => {
  // `0002_tenancy.sql`: CHECK (plan IN ('free','standard','pro','enterprise')).
  // Paket yang diterima database tapi tidak punya kuota akan lolos sampai
  // penegakan pertama, lalu gagal di sana.
  const { KUOTA_PAKET } = await import(MOD);
  assert.deepEqual(Object.keys(KUOTA_PAKET).sort(), ['enterprise', 'free', 'pro', 'standard']);

  for (const [nama, k] of Object.entries(KUOTA_PAKET)) {
    for (const dimensi of ['maxOutlets', 'maxDevices', 'maxUsers', 'maxProducts']) {
      assert.ok(dimensi in k, `${nama} tidak punya ${dimensi}`);
      const nilai = k[dimensi];
      assert.ok(
        nilai === null || (Number.isInteger(nilai) && nilai > 0),
        `${nama}.${dimensi} = ${nilai} — harus null (tanpa batas) atau bilangan bulat positif`
      );
    }
  }
});

test('⛔ tanpa batas dinyatakan `null`, bukan angka besar', async () => {
  // Angka besar adalah batas yang berpura-pura tidak ada. Ia akan mengejutkan
  // seseorang, sekali, di tempat yang tidak ada yang mengawasi.
  const { KUOTA_PAKET } = await import(MOD);
  assert.deepEqual(KUOTA_PAKET.enterprise, {
    maxOutlets: null,
    maxDevices: null,
    maxUsers: null,
    maxProducts: null,
  });
});

test('⛔ kuota naik monoton dari free ke pro', async () => {
  // Bukan estetika: paket yang lebih mahal dengan kuota lebih kecil di satu
  // dimensi adalah tagihan yang tidak dapat dijelaskan ke merchant.
  const { KUOTA_PAKET } = await import(MOD);
  const urutan = ['free', 'standard', 'pro'];

  for (const dimensi of ['maxOutlets', 'maxDevices', 'maxUsers', 'maxProducts']) {
    for (let i = 1; i < urutan.length; i += 1) {
      const bawah = KUOTA_PAKET[urutan[i - 1]][dimensi];
      const atas = KUOTA_PAKET[urutan[i]][dimensi];
      assert.ok(
        atas > bawah,
        `${urutan[i]}.${dimensi} (${atas}) tidak lebih besar dari ${urutan[i - 1]} (${bawah})`
      );
    }
  }
});

test('⛔ paket pendaftaran mandiri adalah `free`', async () => {
  // `POST /tenants` tidak terautentikasi. Kalau paketnya dapat dipilih —
  // lewat body, atau lewat konstanta yang salah di sini — siapa pun dapat
  // memberi dirinya kuota tanpa batas dengan satu request.
  const { PAKET_PENDAFTARAN, KUOTA_PAKET } = await import(MOD);
  assert.equal(PAKET_PENDAFTARAN, 'free');
  assert.notEqual(KUOTA_PAKET[PAKET_PENDAFTARAN].maxOutlets, null, 'tier pendaftaran harus BERBATAS');
});

test('⛔ satu outlet cukup untuk tier gratis, tapi satu perangkat tidak', async () => {
  // Kafe takeaway dengan dua terminal adalah kasus normal, bukan kasus besar.
  // Tier gratis yang hanya memuat satu perangkat memaksa upgrade pada hari
  // pertama, dan itu bukan tier gratis melainkan trial yang tidak diberi nama.
  const { KUOTA_PAKET } = await import(MOD);
  assert.equal(KUOTA_PAKET.free.maxOutlets, 1);
  assert.ok(KUOTA_PAKET.free.maxDevices >= 2);
});
