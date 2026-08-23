'use strict';

// Kosakata `audit_event.event_type` — daftar tertutup. FR-F6, `spec-f:288`.
//
// ⛔ Kenapa daftar ini ada sama sekali: `recordAuditEvent` menerima
// `eventType: string` sejak Modul B, jadi delapan belas nama tersebar di dua
// belas berkas tanpa satu pun terdaftar di mana pun. Ejaan yang menyimpang
// tidak menghasilkan error — ia menghasilkan baris audit yang tidak pernah
// cocok dengan saringan mana pun, dan laporan yang melewatkannya terlihat
// persis seperti laporan yang tidak menemukan apa pun.
//
// Bentuk cacat yang sama persis dengan `stock_movement.type`: dua kosakata
// untuk satu peristiwa menjadi laporan yang menghitung sebagian.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const MOD = '../../packages/domain/src/audit-peristiwa.ts';

test('setiap peristiwa punya kelompok, dan kelompoknya dari daftar tertutup', async () => {
  const { KUNCI_PERISTIWA, kelompokPeristiwa } = await import(MOD);
  const KELOMPOK = new Set([
    'sesi', 'shift', 'transaksi', 'kas', 'katalog', 'stok',
    'konfigurasi', 'identitas', 'perangkat', 'data', 'tenant',
  ]);
  assert.ok(KUNCI_PERISTIWA.length > 10);
  for (const k of KUNCI_PERISTIWA) {
    assert.ok(KELOMPOK.has(kelompokPeristiwa(k)), `${k} berkelompok asing`);
  }
});

test('⛔ nama asing berkelompok NULL, bukan kelompok bawaan', async () => {
  // Baris lama dapat memuat nama yang sudah tidak dipancarkan siapa pun —
  // `audit_event` tidak pernah di-UPDATE (invariant #2). Menaruhnya di
  // kelompok bawaan membuat saringan kelompok menyembunyikan baris yang justru
  // paling perlu dilihat.
  const { kelompokPeristiwa, adalahPeristiwaAudit } = await import(MOD);
  assert.equal(kelompokPeristiwa('peristiwa_lama_2025'), null);
  assert.equal(adalahPeristiwaAudit('peristiwa_lama_2025'), false);
  assert.equal(adalahPeristiwaAudit('order.voided'), true);
});

test('⛔ ejaan KODE yang dibekukan, bukan ejaan spec', async () => {
  // `spec-f:292` menulis `order_voided`; kode menulis `order.voided`. Keduanya
  // sudah ada di database merchant, dan baris lama tidak dapat ditulis ulang.
  // Menyeragamkan ke ejaan spec berarti dua ejaan untuk satu peristiwa,
  // selamanya, dan laporan yang menyaring salah satunya melewatkan separuh
  // sejarah.
  const { adalahPeristiwaAudit, PETA_EJAAN_SPEC } = await import(MOD);
  assert.equal(adalahPeristiwaAudit('order.voided'), true);
  assert.equal(adalahPeristiwaAudit('order_voided'), false);
  assert.equal(PETA_EJAAN_SPEC['order_voided'], 'order.voided');
  assert.equal(PETA_EJAAN_SPEC['order_refunded'], 'order.refunded');
});

test('⛔ daftar spec dibaca dari spec-nya, bukan dikarang', async () => {
  // Penjaga yang membuat `SPEC` tidak dapat menjadi sumber kebenaran kedua:
  // daftar yang menyimpang dari spec menghasilkan "jarak ke FR-F6" yang
  // menyebut lubang yang tidak ada dan melewatkan yang ada.
  const { KUNCI_SPEC } = await import(MOD);
  const berkas = readFileSync(
    join(AKAR, 'product', 'specs', 'spec-f-rbac-audit.md'),
    'utf8'
  );
  const hilang = KUNCI_SPEC.filter((n) => !berkas.includes(`\`${n}\``));
  assert.deepEqual(hilang, [], `disebut di daftar tapi tidak ada di spec: ${hilang.join(', ')}`);
  assert.ok(KUNCI_SPEC.length >= 30, `daftar spec terlalu pendek (${KUNCI_SPEC.length})`);
});

test('⛔ jarak ke FR-F6 DITURUNKAN, dan tidak memuat yang sudah dipancarkan', async () => {
  // FR-F6 AC pertama: "setiap event dalam daftar menghasilkan record". Daftar
  // ini menyusut sendiri saat peristiwanya mulai ditulis — tidak ada daftar
  // kedua yang harus diingat untuk dipangkas.
  const { PERISTIWA_BELUM_DIPANCARKAN, adalahPeristiwaAudit, PETA_EJAAN_SPEC, KUNCI_SPEC } =
    await import(MOD);

  for (const nama of PERISTIWA_BELUM_DIPANCARKAN) {
    assert.ok(KUNCI_SPEC.includes(nama), `${nama} bukan dari daftar spec`);
    assert.equal(
      adalahPeristiwaAudit(PETA_EJAAN_SPEC[nama] ?? nama),
      false,
      `${nama} sudah dipancarkan tapi masih terdaftar sebagai belum`
    );
  }

  // Ejaan yang berbeda BUKAN lubang.
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('order_voided'), false);
  // Yang benar-benar belum ada tetap disebut — dan `shift_opened` adalah yang
  // paling menonjol: setiap shift dibuka, dan tidak satu pun tercatat.
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('shift_opened'), true);
});

test('daftar spec dan daftar kode tidak saling menghapus', async () => {
  // Peristiwa yang kode pancarkan tapi spec tidak sebut adalah keadaan yang
  // SAH — `calculation_variance` lahir dari `spec-h:95`, dan kelompok
  // "tenant" lahir dari fitur langganan yang tidak ada saat `spec-f` ditulis.
  // Yang tidak sah adalah menghapus salah satunya supaya keduanya cocok.
  const { KUNCI_PERISTIWA, kelompokSpec } = await import(MOD);
  const diLuarSpec = KUNCI_PERISTIWA.filter((k) => kelompokSpec(k) === null);
  assert.ok(diLuarSpec.includes('calculation_variance'), JSON.stringify(diLuarSpec));
  assert.ok(diLuarSpec.includes('tenant_registered'));
});
