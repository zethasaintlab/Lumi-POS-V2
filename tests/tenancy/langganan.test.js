'use strict';

// F5 — menaikkan paket sendiri: tagihan → bayar → konfirmasi.
//
// ## ⛔ Dua sifat yang diuji di sini tidak dapat diperiksa dengan membaca kode
//
// 1. **Paket tidak naik tanpa konfirmasi gateway.** `spec-c:320`. Fake
//    provider selalu menjawab `pending` lebih dulu, jadi test yang lupa
//    memanggil `setStatus` akan merah — bukan hijau karena kebetulan.
// 2. **Kolom `tenant.max_*` ikut naik, bukan hanya `tenant.plan`.**
//    `batasKuota` membaca kolomnya, bukan `KUOTA_PAKET[plan]`. Menaikkan
//    `plan` saja menghasilkan merchant yang MEMBAYAR paket pro dan tetap
//    ditolak pada kuota free — tanpa satu pun error, dan dengan layar yang
//    menyebut paket baru sambil menampilkan batas lama.
//
// Keduanya diperiksa lewat `GET /tenants/usage`, yaitu angka yang benar-benar
// ditegakkan — bukan lewat SELECT langsung ke `tenant`.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { buatSesi } = require('../isolation/helpers/sesi');

// Kunci KARANGAN untuk menghitung signature webhook. Bukan kunci sungguhan.
const KUNCI_UJI = 'SB-Mid-server-LANGGANAN0123456';

let owner, appDb, app, tenant, fake;

before(async () => {
  owner = await connectAsOwner();
  appDb = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appDb.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeSubscriptionProvider } = await import(
    '../../apps/server/src/modules/payment/providers/langganan.ts'
  );
  fake = createFakeSubscriptionProvider();
  if (app) await app.close();
  app = await buildApp({ subscriptionProvider: fake, webhookSecret: KUNCI_UJI });
  tenant = await daftarkanMerchant('Kopi Langganan');
});

async function daftarkanMerchant(nama) {
  const b = {
    tenant: { id: crypto.randomUUID(), name: nama },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: {
      id: crypto.randomUUID(),
      name: 'Pemilik',
      email: `owner+${crypto.randomUUID()}@contoh.id`,
      password: 'kopi susu gula aren',
    },
  };
  const res = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: b,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 201, res.body);
  const token = await buatSesi(appDb, { tenantId: b.tenant.id, userId: b.owner.id });
  return { id: b.tenant.id, outletId: b.outlet.id, ownerId: b.owner.id, token };
}

function H(t = tenant, extra = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': t.id,
    authorization: `Bearer ${t.token}`,
    ...extra,
  };
}

const post = (url, payload, extra = {}, t = tenant) =>
  app.inject({ method: 'POST', url, payload, headers: H(t, extra) });

const get = (url, t = tenant) => app.inject({ method: 'GET', url, headers: H(t) });

function mintaTagihan(plan, over = {}, t = tenant) {
  const id = over.id ?? crypto.randomUUID();
  const key = over.key ?? crypto.randomUUID();
  return post('/tenants/subscription/invoices', { id, plan }, { 'idempotency-key': key }, t);
}

async function tagihanBaru(plan, t = tenant) {
  const res = await mintaTagihan(plan, {}, t);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

async function pemakaian(t = tenant) {
  const res = await get('/tenants/usage', t);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

const cekStatus = (invoiceId, t = tenant) =>
  post(`/tenants/subscription/invoices/${invoiceId}/check-status`, {}, {}, t);

/** Bayar tagihan sampai tuntas lewat jalur `check-status`. */
async function bayarLunas(hasil, t = tenant) {
  fake.setStatus(hasil.invoice.providerReference, 'confirmed');
  const res = await cekStatus(hasil.invoice.id, t);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

// Rumus Midtrans, diketik ulang dari dokumentasi dan BUKAN diimpor dari kode:
// test dan implementasi yang lahir dari sumber yang sama bisa salah bersamaan.
function tandaTangan({ orderId, statusCode, grossAmount, kunci = KUNCI_UJI }) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${kunci}`).digest('hex');
}

function kirimWebhook(over = {}) {
  const dasar = {
    order_id: over.order_id,
    status_code: over.status_code ?? '200',
    gross_amount: over.gross_amount ?? '349000.00',
    transaction_status: over.transaction_status ?? 'settlement',
    custom_field1: over.custom_field1 ?? tenant.id,
  };
  const body = {
    ...dasar,
    signature_key:
      over.signature_key ??
      tandaTangan({ orderId: dasar.order_id, statusCode: dasar.status_code, grossAmount: dasar.gross_amount }),
  };
  return app.inject({ method: 'POST', url: '/webhooks/midtrans', payload: body });
}

async function query(sql, params, t = tenant) {
  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.id]);
  try {
    const { rows } = await appDb.query(sql, params);
    await appDb.query('COMMIT');
    return rows;
  } catch (err) {
    await appDb.query('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tagihan
// ---------------------------------------------------------------------------

test('tagihan lahir pending_confirmation, dan paket BELUM naik', async () => {
  const hasil = await tagihanBaru('standard');

  assert.equal(hasil.invoice.status, 'pending_confirmation');
  assert.equal(hasil.invoice.plan, 'standard');
  assert.equal(hasil.gatewayReachable, true);
  assert.ok(hasil.qrString, 'QR harus ada saat gateway menjawab');

  // ⛔ Sifat #1. Ini yang `spec-c:320` tuntut.
  assert.equal((await pemakaian()).plan, 'free');
});

test('harga = harga paket × jumlah outlet, keduanya SNAPSHOT (KEP-38)', async () => {
  const { HARGA_PAKET } = await import('../../packages/domain/src/paket.ts');

  const satu = await tagihanBaru('standard');
  assert.equal(satu.invoice.outletCount, 1, 'pendaftaran membuat satu outlet');
  assert.equal(satu.invoice.unitPrice, Number(HARGA_PAKET.standard));
  assert.equal(satu.invoice.amount, Number(HARGA_PAKET.standard));

  await bayarLunas(satu);

  // Outlet kedua baru mungkin SETELAH naik ke standard — `free.maxOutlets` = 1,
  // dan tier berbayar tidak membatasi outlet justru karena harganya per outlet.
  const outlet2 = await post('/outlets', {
    id: crypto.randomUUID(),
    name: 'Cabang',
    timezone: 'Asia/Jakarta',
  });
  assert.equal(outlet2.statusCode, 201, outlet2.body);

  const dua = await tagihanBaru('pro');
  assert.equal(dua.invoice.outletCount, 2);
  assert.equal(dua.invoice.unitPrice, Number(HARGA_PAKET.pro));
  assert.equal(dua.invoice.amount, Number(HARGA_PAKET.pro) * 2);
});

test('⛔ QR TERSIMPAN — ia ikut di setiap pembacaan, bukan hanya di respons pembuatan', async () => {
  // Cacat yang ditutup, dan ia ditemukan DI BROWSER: `qrString` yang hanya
  // hidup di respons berarti merchant yang memuat ulang halaman kehilangan
  // satu-satunya cara membayar tagihan yang masih terbuka — sementara index
  // unik parsial menolak tagihan kedua. Ia terkunci sampai tagihan pertama
  // kedaluwarsa sendiri, tanpa satu pun error.
  const hasil = await tagihanBaru('standard');
  assert.ok(hasil.qrString, 'respons pembuatan tetap membawa QR');
  assert.equal(hasil.invoice.qrString, hasil.qrString, 'baris tagihan membawa QR yang sama');

  // Pembacaan BERIKUTNYA — inilah yang dulu kosong.
  const riwayat = await get('/tenants/subscription/invoices');
  assert.equal(riwayat.statusCode, 200, riwayat.body);
  const dari_riwayat = JSON.parse(riwayat.body).invoices[0];
  assert.equal(dari_riwayat.qrString, hasil.qrString);
  assert.ok(dari_riwayat.expiresAt, 'kedaluwarsa datang dari gateway, bukan dari jam kami');

  // …dan tetap ada setelah cek status yang tidak mengubah apa pun.
  const cek = await cekStatus(hasil.invoice.id);
  assert.equal(cek.statusCode, 200, cek.body);
  assert.equal(JSON.parse(cek.body).invoice.qrString, hasil.qrString);
});

test('gateway tidak menjawab: qrString `null`, bukan string kosong', async () => {
  // String kosong terbaca "ada QR" oleh setiap pemeriksaan kebenaran di
  // klien, dan menghasilkan tautan yang tidak menuju ke mana-mana.
  fake.failNextInitiate(new Error('gateway timeout'));
  const res = await mintaTagihan('standard');
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.qrString, null);
  assert.equal(body.invoice.qrString, null);
  assert.equal(body.invoice.expiresAt, null);
});

test('⛔ gateway menjawab pending: paket tetap, dan tagihan tetap terbuka', async () => {
  const hasil = await tagihanBaru('standard');

  const res = await cekStatus(hasil.invoice.id);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);

  assert.equal(body.gatewayStatus, 'pending');
  assert.equal(body.invoice.status, 'pending_confirmation');
  assert.equal(body.plan, 'free');
  assert.equal((await pemakaian()).plan, 'free');
});

test('⛔ konfirmasi menaikkan paket DAN keempat kolom kuotanya', async () => {
  const { KUOTA_PAKET } = await import('../../packages/domain/src/paket.ts');

  const hasil = await tagihanBaru('standard');
  const setelah = await bayarLunas(hasil);

  assert.equal(setelah.gatewayStatus, 'confirmed');
  assert.equal(setelah.invoice.status, 'confirmed');
  assert.ok(setelah.invoice.confirmedAt, 'confirmed_at wajib terisi');
  assert.equal(setelah.plan, 'standard');

  // ⛔ Sifat #2, dan ia dibaca dari angka yang DITEGAKKAN. Menaikkan `plan`
  // tanpa kolom kuotanya membuat merchant membayar paket standard lalu tetap
  // ditolak pada batas free — tanpa satu pun error.
  const b = await pemakaian();
  assert.equal(b.plan, 'standard');
  assert.equal(b.kuota.produk.batas, KUOTA_PAKET.standard.maxProducts);
  assert.equal(b.kuota.device.batas, KUOTA_PAKET.standard.maxDevices);
  assert.equal(b.kuota.pengguna.batas, KUOTA_PAKET.standard.maxUsers);
  assert.equal(b.kuota.outlet.batas, null, 'tier berbayar tidak membatasi outlet (KEP-38)');
});

test('audit event tertulis untuk pembuatan DAN kenaikan', async () => {
  const hasil = await tagihanBaru('standard');
  await bayarLunas(hasil);

  const rows = await query(
    `SELECT event_type, entity_id, actor_user_id, outlet_id FROM audit_event
      WHERE entity_type = 'subscription_invoice' ORDER BY event_type`
  );
  assert.deepEqual(
    rows.map((r) => r.event_type),
    ['subscription_invoice_created', 'subscription_plan_upgraded']
  );
  for (const r of rows) {
    assert.equal(r.entity_id, hasil.invoice.id);
    assert.equal(r.actor_user_id, tenant.ownerId, 'aktornya PEMINTA, bukan sistem');
    assert.equal(r.outlet_id, null, 'langganan tenant-wide, bukan urusan satu outlet');
  }
});

test('tagihan yang sudah final tidak ditanyakan lagi ke gateway', async () => {
  const hasil = await tagihanBaru('standard');
  await bayarLunas(hasil);

  const sebelum = fake.pollCalls();
  const res = await cekStatus(hasil.invoice.id);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).gatewayStatus, null, 'null ≠ "ditanya lalu dijawab pending"');
  assert.equal(fake.pollCalls(), sebelum, 'gateway tidak boleh ditanyai lagi');
});

// ---------------------------------------------------------------------------
// Penolakan
// ---------------------------------------------------------------------------

test('⛔ penurunan paket ditolak — ia belum dibangun', async () => {
  await bayarLunas(await tagihanBaru('pro'));
  assert.equal((await pemakaian()).plan, 'pro');

  const res = await mintaTagihan('standard');
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PLAN_NOT_AN_UPGRADE');
});

test('paket yang sama ditolak', async () => {
  await bayarLunas(await tagihanBaru('standard'));
  const res = await mintaTagihan('standard');
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PLAN_NOT_AN_UPGRADE');
});

test('⛔ `free` dan `enterprise` ditolak SPEC, bukan hanya kode', async () => {
  // Enum di OpenAPI adalah lapisan pertama; kalau ia longgar, permintaan
  // sampai ke handler dan penolakannya bergantung pada satu `if`.
  for (const plan of ['free', 'enterprise', 'platinum']) {
    const res = await mintaTagihan(plan);
    assert.equal(res.statusCode, 400, `${plan}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  }
});

test('⛔ satu tagihan terbuka per tenant — ditegakkan DATABASE', async () => {
  await tagihanBaru('standard');

  // Id berbeda, Idempotency-Key berbeda: yang menahan bukan idempotensi
  // melainkan index unik parsial. Ini yang melindungi dari dua klik, dua tab,
  // dan dua perangkat.
  const res = await mintaTagihan('pro');
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SUBSCRIPTION_INVOICE_OPEN');
});

test('Idempotency-Key wajib', async () => {
  const res = await post('/tenants/subscription/invoices', { id: crypto.randomUUID(), plan: 'standard' });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('key yang sama diulang: satu tagihan, satu transaksi gateway, respons identik', async () => {
  const id = crypto.randomUUID();
  const key = crypto.randomUUID();

  const a = await mintaTagihan('standard', { id, key });
  const b = await mintaTagihan('standard', { id, key });

  assert.equal(a.statusCode, 201, a.body);
  assert.equal(b.statusCode, 201, b.body);
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body));
  assert.equal(fake.gatewayTransactions(), 1);

  const rows = await query('SELECT id FROM subscription_invoice');
  assert.equal(rows.length, 1);
});

test('⛔ gateway gagal: tagihan TETAP tersimpan, dan key belum diselesaikan', async () => {
  // FR-C14 dalam bentuknya di sini: merchant mungkin sudah membayar. Tagihan
  // yang di-rollback bersama kegagalan gateway menghapus satu-satunya jejak
  // bahwa QR pernah diminta.
  fake.failNextInitiate(new Error('gateway timeout'));

  const key = crypto.randomUUID();
  const res = await mintaTagihan('standard', { key });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.gatewayReachable, false);
  assert.equal(body.qrString, null);
  assert.equal(body.invoice.status, 'pending_confirmation');

  const rows = await query('SELECT response_status FROM idempotency_key WHERE key = $1', [key]);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].response_status,
    null,
    'key yang DISELESAIKAN membuat retry menerima respons "tanpa QR" dari cache selamanya'
  );
});

test('non-owner ditolak 403 — billing owner-only (spec-f:52)', async () => {
  const kasirId = crypto.randomUUID();
  const buat = await post('/users', {
    id: kasirId,
    name: 'Kasir',
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
    outletIds: [tenant.outletId],
  });
  assert.equal(buat.statusCode, 201, buat.body);
  const kasir = { id: tenant.id, token: await buatSesi(appDb, { tenantId: tenant.id, userId: kasirId }) };

  const res = await mintaTagihan('standard', {}, kasir);
  assert.equal(res.statusCode, 403, res.body);

  const daftar = await get('/tenants/subscription/invoices', kasir);
  assert.equal(daftar.statusCode, 403, daftar.body);
});

// ---------------------------------------------------------------------------
// Riwayat
// ---------------------------------------------------------------------------

test('riwayat memuat tagihan terbaru dulu, beserta paket yang berlaku', async () => {
  const satu = await tagihanBaru('standard');
  await bayarLunas(satu);
  const dua = await tagihanBaru('pro');

  const res = await get('/tenants/subscription/invoices');
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);

  assert.equal(body.plan, 'standard', 'tagihan pro belum dibayar');
  assert.deepEqual(
    body.invoices.map((i) => i.id),
    [dua.invoice.id, satu.invoice.id]
  );
  assert.deepEqual(
    body.invoices.map((i) => i.status),
    ['pending_confirmation', 'confirmed']
  );
});

// ---------------------------------------------------------------------------
// Webhook — §4 penyelidikan F5
// ---------------------------------------------------------------------------

test('⛔ notifikasi langganan TIDAK lagi dijawab 404 PAYMENT_NOT_FOUND', async () => {
  // Ini cacatnya, dan ia operasional bukan teoretis: Midtrans mengirim ULANG
  // notifikasi yang tidak dijawab 200. Sebelum prefiks, notifikasi tagihan
  // langganan pertama akan dijawab 404 lalu diulang selamanya.
  const hasil = await tagihanBaru('standard');
  const { rujukanGatewayUntukTagihan } = await import(
    '../../apps/server/src/modules/payment/providers/langganan.ts'
  );

  const res = await kirimWebhook({ order_id: rujukanGatewayUntukTagihan(hasil.invoice.id) });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(JSON.parse(res.body), { received: true });

  assert.equal((await pemakaian()).plan, 'standard');
});

test('notifikasi TANPA prefiks tetap dicari di tabel payment', async () => {
  // Rutenya tidak boleh menelan notifikasi pembayaran. Id acak tanpa prefiks
  // masih dijawab PAYMENT_NOT_FOUND, persis seperti sebelumnya.
  const res = await kirimWebhook({ order_id: crypto.randomUUID() });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PAYMENT_NOT_FOUND');
});

test('⛔ notifikasi langganan bertenant LAIN tidak menaikkan paket siapa pun', async () => {
  const hasil = await tagihanBaru('standard');
  const lain = await daftarkanMerchant('Kopi Sebelah');
  const { rujukanGatewayUntukTagihan } = await import(
    '../../apps/server/src/modules/payment/providers/langganan.ts'
  );

  // Signature-nya SAH — yang dipalsukan hanya tenantnya. Yang menahan adalah
  // RLS: pencarian tagihan berjalan di bawah `app.tenant_id` dari notifikasi.
  const res = await kirimWebhook({
    order_id: rujukanGatewayUntukTagihan(hasil.invoice.id),
    custom_field1: lain.id,
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SUBSCRIPTION_INVOICE_NOT_FOUND');

  assert.equal((await pemakaian()).plan, 'free');
  assert.equal((await pemakaian(lain)).plan, 'free');
});

test('notifikasi langganan ber-signature salah ditolak sebelum query mana pun', async () => {
  const hasil = await tagihanBaru('standard');
  const { rujukanGatewayUntukTagihan } = await import(
    '../../apps/server/src/modules/payment/providers/langganan.ts'
  );

  const res = await kirimWebhook({
    order_id: rujukanGatewayUntukTagihan(hasil.invoice.id),
    signature_key: 'salah',
  });
  assert.equal(res.statusCode, 401, res.body);
  assert.equal((await pemakaian()).plan, 'free');
});

test('notifikasi susulan tidak membalikkan tagihan yang sudah dikonfirmasi', async () => {
  const hasil = await tagihanBaru('standard');
  const { rujukanGatewayUntukTagihan } = await import(
    '../../apps/server/src/modules/payment/providers/langganan.ts'
  );
  const rujukan = rujukanGatewayUntukTagihan(hasil.invoice.id);

  assert.equal((await kirimWebhook({ order_id: rujukan })).statusCode, 200);
  assert.equal((await pemakaian()).plan, 'standard');

  // Midtrans mengirim ulang notifikasi; pengulangan adalah keadaan NORMAL.
  const gagal = await kirimWebhook({ order_id: rujukan, transaction_status: 'deny' });
  assert.equal(gagal.statusCode, 200, gagal.body);

  const rows = await query('SELECT status FROM subscription_invoice WHERE id = $1', [hasil.invoice.id]);
  assert.equal(rows[0].status, 'confirmed', 'uangnya sudah masuk — status tidak dibalik');
  assert.equal((await pemakaian()).plan, 'standard');
});

test('gateway expire disimpan `expired`, bukan `failed`', async () => {
  // Kolomnya mengenal keduanya (0026), dan membedakannya membuat B-29 dapat
  // berkata "QR kedaluwarsa, minta yang baru" alih-alih "pembayaran gagal".
  const hasil = await tagihanBaru('standard');
  fake.setStatus(hasil.invoice.providerReference, 'expired');

  const res = await cekStatus(hasil.invoice.id);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.invoice.status, 'expired');
  assert.equal(body.plan, 'free');

  // Tagihan yang kedaluwarsa membebaskan slot "satu tagihan terbuka".
  const lagi = await mintaTagihan('standard');
  assert.equal(lagi.statusCode, 201, lagi.body);
});

// ---------------------------------------------------------------------------
// Isolasi tenant
// ---------------------------------------------------------------------------

test('⛔ tagihan tenant lain tidak terlihat dan tidak dapat dikonfirmasi', async () => {
  const hasil = await tagihanBaru('standard');
  const lain = await daftarkanMerchant('Kopi Seberang');

  const cek = await cekStatus(hasil.invoice.id, lain);
  assert.equal(cek.statusCode, 404, cek.body);

  const daftar = await get('/tenants/subscription/invoices', lain);
  assert.equal(daftar.statusCode, 200, daftar.body);
  assert.deepEqual(JSON.parse(daftar.body).invoices, []);
});
