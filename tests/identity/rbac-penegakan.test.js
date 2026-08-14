'use strict';

// §5 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- penegakan RBAC di
// endpoint yang sudah ada.
//
// ⛔ BATAS YANG HARUS DIBACA BERSAMA BERKAS INI.
//
// Perangkat kasir mengautentikasi diri sebagai PERANGKAT (secret bearer,
// FR-F12). `X-Actor-Id` dan `X-Approver-Id` adalah atribusi yang DIJAMIN
// PERANGKAT, bukan identitas yang diverifikasi server -- dan itu konsekuensi
// langsung dari offline-first: order yang antre enam jam tidak dapat membawa
// sesi hidup.
//
// Yang diuji di sini karena itu BUKAN "penyerang tidak dapat menyamar".
// Yang diuji adalah: id yang disebut memang punya hak untuk operasi itu.
// Kasir tidak dapat muncul sebagai penyetuju refund, apa pun yang dikirim
// perangkat. Perangkat yang di-root dijaga pencabutan token, bukan ini.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, freshId } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, aktor;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  const base = await seedTenantBase(appSetup, { suffix: 'Rbac' });
  tenant = base.tenant;
  outlet = base.outlet;
  aktor = base.user;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

/** Membuat pengguna langsung lewat SQL — endpoint /users diuji terpisah. */
async function buatPengguna(peran) {
  const id = freshId();
  await kueriTenant(`INSERT INTO "user" (id, tenant_id, name) VALUES ($1, $2, $3)`, [
    id,
    tenant.id,
    `Uji ${peran}`,
  ]);
  await kueriTenant(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, $4, 'outlet', $5)`,
    [freshId(), tenant.id, id, peran, outlet.id]
  );
  await kueriTenant(
    `INSERT INTO user_outlet (id, tenant_id, user_id, outlet_id) VALUES ($1, $2, $3, $4)`,
    [freshId(), tenant.id, id, outlet.id]
  );
  return id;
}

// ---------------------------------------------------------------------------

test('assertBoleh: menolak operasi di luar hak, meloloskan yang di dalamnya', async () => {
  const { assertBoleh } = await import('../../apps/server/src/modules/identity/index.ts');
  const kasir = await buatPengguna('cashier');
  const manajer = await buatPengguna('outlet_manager');

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    await assert.rejects(
      () => assertBoleh(appSetup, kasir, 'approve_authorization'),
      (e) => e.statusCode === 403 && e.code === 'FORBIDDEN',
      'kasir tidak boleh menyetujui'
    );
    await assertBoleh(appSetup, manajer, 'approve_authorization');
    await assertBoleh(appSetup, kasir, 'sale');
  } finally {
    await appSetup.query('COMMIT');
  }
});

test('assertBoleh: pengguna TANPA peran ditolak (fail-closed)', async () => {
  const { assertBoleh } = await import('../../apps/server/src/modules/identity/index.ts');
  const id = freshId();
  await kueriTenant(`INSERT INTO "user" (id, tenant_id, name) VALUES ($1, $2, 'Tanpa Peran')`, [
    id,
    tenant.id,
  ]);

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    // Pengguna yang barisnya ada tapi belum diberi peran apa pun adalah
    // keadaan yang benar-benar terjadi -- pembuatan yang setengah jalan, atau
    // peran yang dicabut. Membiarkannya lolos berarti "belum diatur" sama
    // dengan "boleh segalanya".
    await assert.rejects(() => assertBoleh(appSetup, id, 'sale'), (e) => e.statusCode === 403);
  } finally {
    await appSetup.query('COMMIT');
  }
});

// Penegakan pada jalur refund SUNGGUHAN ada di tests/ordering/refund.test.js.
// Ia menuntut order yang benar-benar tertutup lewat jalur pembayaran, dan
// harness itu hidup di sana; menduplikasinya ke sini berarti menyalin seratus
// baris setup demi satu assertion.
