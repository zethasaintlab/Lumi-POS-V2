'use strict';

// B-26 Ambang Otorisasi — `GET`/`PUT /outlets/{id}/thresholds`. `IA:205`.
//
// ⛔ Yang paling menentukan di berkas ini bukan endpointnya melainkan
// PENERAPANNYA. Layar pengaturan yang menyimpan dengan benar, menampilkan
// kembali dengan benar, dan tidak mengubah apa pun adalah bentuk kegagalan
// yang paling sulit dilihat: tidak ada error di mana pun, dan satu-satunya
// gejalanya adalah PIN yang tetap diminta pada angka yang merchant kira sudah
// ia naikkan.
//
// Karena itu setengah berkas ini menutup shift dan membuka laci sungguhan,
// bukan hanya membaca kolomnya kembali.
//
// ⛔ Dan `null` diuji sebagai nilai yang BERBEDA dari nol di kedua arah. Nol
// berarti "setiap kejadian menuntut otorisasi" — pilihan yang sah, dan yang
// paling mudah hilang lewat satu `||`.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, freshId } = require('../isolation/helpers/seed');

let owner, db, app, tenant, outletId, device, base;

before(async () => {
  owner = await connectAsOwner();
  db = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await db.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Ambang' });
  tenant = base.tenant;
  outletId = base.outlet.id;
  device = crypto.randomUUID();

  await kueri(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

async function kueri(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await db.query(sql, params);
  await db.query('COMMIT');
  return hasil;
}

function hdr(extra = {}) {
  return { 'x-tenant-id': tenant.id, authorization: base.authHeader, ...extra };
}

const baca = () =>
  app.inject({ method: 'GET', url: `/outlets/${outletId}/thresholds`, headers: hdr() });

const tulis = (body, extra = {}) =>
  app.inject({
    method: 'PUT',
    url: `/outlets/${outletId}/thresholds`,
    payload: body,
    headers: hdr(extra),
  });

/** Shift `open` milik aktor fixture. */
async function shift(saldoAwal = 100000) {
  const id = crypto.randomUUID();
  await kueri(
    `INSERT INTO cash_drawer_shift
       (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-24','open',$5,$6)`,
    [id, tenant.id, outletId, device, saldoAwal, base.user.id]
  );
  return id;
}

const tutup = (shiftId, body, extra = {}) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/close`,
    payload: body,
    headers: hdr(extra),
  });

const noSale = (shiftId, extra = {}) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/no-sale`,
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang' },
    headers: hdr({ 'idempotency-key': crypto.randomUUID(), ...extra }),
  });

// ---------------------------------------------------------------------------
// Baca & tulis
// ---------------------------------------------------------------------------

test('outlet baru: tersimpan seluruhnya null, berlaku memakai bawaan', async () => {
  const res = await baca();
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.deepEqual(b.tersimpan, {
    diskonPersenSkala: null,
    diskonNominal: null,
    selisihKas: null,
    noSale: null,
  });
  // ⛔ `berlaku` tidak boleh null di mana pun — layar memakainya apa adanya.
  assert.equal(b.berlaku.selisihKas, '20000');
  assert.equal(b.berlaku.noSale, 3);
  assert.equal(b.berlaku.diskonPersenSkala, '2000');
});

test('menyimpan lalu membaca kembali mengembalikan nilai yang sama', async () => {
  const res = await tulis({
    diskonPersenSkala: '3000',
    diskonNominal: '75000',
    selisihKas: '50000',
    noSale: 6,
  });
  assert.equal(res.statusCode, 200, res.body);

  const b = (await baca()).json();
  assert.equal(b.tersimpan.diskonPersenSkala, '3000');
  assert.equal(b.tersimpan.diskonNominal, '75000');
  assert.equal(b.tersimpan.selisihKas, '50000');
  assert.equal(b.tersimpan.noSale, 6);
  assert.equal(b.berlaku.selisihKas, '50000');
});

test('⛔ PUT yang tidak menyebut sebuah bidang MENGOSONGKANNYA', async () => {
  // PUT, bukan PATCH: mengosongkan adalah satu-satunya cara kembali ke bawaan,
  // dan PATCH yang menyimpan sebagian membuat perintah itu tidak dapat
  // dinyatakan sama sekali.
  assert.equal((await tulis({ selisihKas: '50000', noSale: 6 })).statusCode, 200);
  assert.equal((await tulis({ selisihKas: '50000' })).statusCode, 200);

  const b = (await baca()).json();
  assert.equal(b.tersimpan.noSale, null);
  assert.equal(b.berlaku.noSale, 3, 'kembali ke bawaan');
});

test('⛔ NOL tersimpan sebagai nol, bukan diperlakukan sebagai kosong', async () => {
  // `0n || bawaan` mengembalikan bawaan. Pilihan "setiap selisih menuntut
  // otorisasi" hilang tanpa satu pun error.
  assert.equal((await tulis({ selisihKas: '0', noSale: 0 })).statusCode, 200);
  const b = (await baca()).json();
  assert.equal(b.tersimpan.selisihKas, '0');
  assert.equal(b.tersimpan.noSale, 0);
  assert.equal(b.berlaku.selisihKas, '0');
  assert.equal(b.berlaku.noSale, 0);
});

test('nilai di luar batas wajar ditolak 400, menyebut bidangnya', async () => {
  // Salah ketik satu nol berlebih tidak boleh menjadi kontrol yang mati.
  const res = await tulis({ selisihKas: '999999999' });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error.message, /selisih kas/i);
});

test('⛔ uang PECAHAN ditolak — dan `number` bulat DITERIMA, karena AJV', async () => {
  // Kontraknya menulis `type: string` untuk uang, dan alasannya benar: rupiah
  // utuh melampaui 2^53 pada nilai yang masih mungkin. Tapi **AJV
  // meng-koersi** `50000` menjadi `"50000"` SEBELUM handler melihatnya —
  // bentuk yang sama persis dengan temuan telemetri (`CLAUDE.md`: koersi
  // mengubah `null` menjadi `0` pada properti bertipe `number`).
  //
  // Menolaknya di handler karena itu MUSTAHIL, dan mengejarnya pun tidak
  // berguna: angka yang melampaui 2^53 sudah kehilangan presisinya di
  // `JSON.stringify` klien, jauh sebelum permintaannya dikirim. Yang menjaga
  // sisi itu adalah `b26.ts`, yang selalu mengirim string.
  //
  // Yang MASIH dapat dijaga di sini, dan yang benar-benar menyatakan sesuatu:
  // rupiah tidak punya desimal. `50000.5` dikoersi menjadi `"50000.5"` dan
  // ditolak bentuknya.
  assert.equal((await tulis({ selisihKas: 50000 })).statusCode, 200);
  const pecahan = await tulis({ selisihKas: 50000.5 });
  assert.equal(pecahan.statusCode, 400, pecahan.body);
  assert.match(pecahan.json().error.message, /bilangan bulat/i);
});

test('outlet milik tenant lain dijawab 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'AmbangLain' });
  const res = await app.inject({
    method: 'GET',
    url: `/outlets/${lain.outlet.id}/thresholds`,
    headers: hdr(),
  });
  assert.equal(res.statusCode, 404, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ RBAC
// ---------------------------------------------------------------------------

test('⛔ Manajer Outlet tidak dapat mengubah ambang, tapi DAPAT membacanya', async () => {
  // Ambang inilah yang memutuskan kapan persetujuan MANAJER OUTLET dituntut.
  // Yang dapat menaikkannya dapat menghapus kebutuhan atas persetujuannya
  // sendiri.
  //
  // Membaca tetap terbuka: kasir yang ditolak PIN-nya berhak tahu ambang mana
  // yang menolaknya.
  await kueri('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
  await kueri(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,'outlet_manager','outlet',$4)`,
    [freshId(), tenant.id, base.user.id, outletId]
  );

  assert.equal((await baca()).statusCode, 200);
  const res = await tulis({ selisihKas: '50000' });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'FORBIDDEN');

  // ⛔ Yang menolak adalah penjaga RUTE (`PETA_PERAN` di `sesi.ts`), bukan
  // `assertBoleh` di handler — penjaga rute berjalan di `preHandler` dan
  // selalu menang. Pesannya karena itu generik ("tidak berhak melakukan
  // operasi ini"), sama dengan setiap rute berperan lain di repo ini;
  // `assertBoleh` yang menyebut "mengubah ambang otorisasi" tidak pernah
  // tercapai lewat HTTP.
  //
  // Keduanya sengaja tetap ada: peta menjaga rute, `assertBoleh` menjaga
  // fungsinya kalau kelak dipanggil dari jalur lain. Bahwa pesan yang lebih
  // menjelaskan tidak pernah terlihat adalah utang yang dicatat di
  // `HANDOFF.md`, bukan penjaga yang hilang.
  assert.doesNotMatch(res.json().error.message, /ambang otorisasi/i);
});

// ---------------------------------------------------------------------------
// ⛔ PENERAPAN — setelan yang tidak dibaca adalah layar yang tidak mengubah apa pun
// ---------------------------------------------------------------------------

test('⛔ ambang selisih kas yang dinaikkan BENAR-BENAR dipakai saat tutup kas', async () => {
  // Selisih Rp 30.000 melewati bawaan (Rp 20.000) dan tidak melewati Rp 50.000.
  assert.equal((await tulis({ selisihKas: '50000' })).statusCode, 200);

  const id = await shift(100000);
  const res = await tutup(id, { countedAmount: '130000' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().butuhOtorisasi, false);
});

test('⛔ ambang selisih kas NOL menuntut otorisasi untuk selisih sekecil apa pun', async () => {
  assert.equal((await tulis({ selisihKas: '0' })).statusCode, 200);

  const id = await shift(100000);
  // Selisih Rp 1 — jauh di bawah bawaan, dan tetap menuntut manusia.
  const res = await tutup(id, { countedAmount: '100001' });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VARIANCE_REASON_REQUIRED');
});

test('tanpa setelan, ambang selisih kas bawaan tetap berlaku', async () => {
  const id = await shift(100000);
  const res = await tutup(id, { countedAmount: '130000' });
  assert.equal(res.statusCode, 400, res.body);
});

test('⛔ ambang no-sale yang dinaikkan BENAR-BENAR dipakai', async () => {
  assert.equal((await tulis({ noSale: 5 })).statusCode, 200);
  const id = await shift();

  // Bawaan 3 berarti pembukaan KEEMPAT menuntut PIN. Dengan ambang 5, kelima
  // pembukaan pertama bebas.
  for (let i = 0; i < 5; i += 1) {
    const res = await noSale(id);
    assert.equal(res.statusCode, 201, `pembukaan ke-${i + 1}: ${res.body}`);
  }
  const keenam = await noSale(id);
  assert.equal(keenam.statusCode, 403, keenam.body);
  // ⛔ Pesannya menyebut ambang yang BERLAKU, bukan konstanta bawaan.
  assert.match(keenam.json().error.message, /ambang 5×/);
});

test('⛔ audit no-sale mencatat ambang yang BERLAKU', async () => {
  // Laporan exception yang menampilkan "ke-4 dari 3" untuk outlet berambang 6
  // menuduh orang atas aturan yang tidak pernah berlaku baginya.
  assert.equal((await tulis({ noSale: 6 })).statusCode, 200);
  const id = await shift();
  assert.equal((await noSale(id)).statusCode, 201);

  const { rows } = await kueri(
    `SELECT after FROM audit_event WHERE event_type = 'cash_drawer_opened' AND entity_id = $1`,
    [id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].after.ambang, 6);
});

// ---------------------------------------------------------------------------
// ⛔ Audit
// ---------------------------------------------------------------------------

test('⛔ threshold_changed mencatat TERSIMPAN, bukan yang berlaku', async () => {
  // Outlet yang mengosongkan ambangnya kembali ke bawaan, dan audit yang
  // mencatat angka bawaan sebagai nilai baru tidak dapat dibedakan dari
  // merchant yang mengetik angka itu — dua keadaan yang berperilaku sama HARI
  // INI dan berbeda pada hari bawaannya berubah.
  assert.equal((await tulis({ selisihKas: '50000' })).statusCode, 200);
  assert.equal((await tulis({})).statusCode, 200);

  const { rows } = await kueri(
    `SELECT before, after FROM audit_event
      WHERE event_type = 'threshold_changed' AND entity_id = $1
      ORDER BY occurred_at, id`,
    [outletId]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].before.selisihKas, null, 'sebelum disetel: null, bukan 20000');
  assert.equal(rows[0].after.selisihKas, '50000');
  assert.equal(rows[1].before.selisihKas, '50000');
  assert.equal(rows[1].after.selisihKas, null, 'dikosongkan: null, bukan 20000');
});

test('⛔ perubahan yang DITOLAK tidak meninggalkan baris audit', async () => {
  assert.equal((await tulis({ selisihKas: '999999999' })).statusCode, 400);
  const { rows } = await kueri(
    `SELECT id FROM audit_event WHERE event_type = 'threshold_changed'`,
    []
  );
  assert.deepEqual(rows, []);
});
