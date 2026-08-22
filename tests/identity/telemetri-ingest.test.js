'use strict';

// F6 — ingest telemetri klien. `ARCH:294` § 10.
//
// Lima dari delapan metrik `ARCH:296` tidak dapat dihasilkan server
// (`apps/server/src/metrik.ts` menyebutkan alasannya satu per satu). Endpoint
// ini satu-satunya jalan mereka masuk, dan karena itu ia juga satu-satunya
// jalan tempat `ARCH:309` — BATAS ETIS — dapat dilanggar dari luar.
//
// ⛔ Yang diuji di sini bukan "apakah angkanya tersimpan" melainkan APA YANG
// DITOLAK. Klien sudah menyaring; perangkat yang di-root tidak.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'TelemetriTest' });
  tenant = base.tenant;
  outlet = base.outlet;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function headerTenant(id = tenant.id, auth = base.authHeader) {
  return auth === undefined
    ? { 'x-tenant-id': id }
    : { 'x-tenant-id': id, authorization: auth };
}

async function kueriTenant(sql, params, tenantId = tenant.id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

/** Perangkat ber-kredensial, siap mengirim telemetri. */
async function buatPerangkat(kode = 'K1') {
  const id = crypto.randomUUID();
  let res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id, outletId: outlet.id, code: kode },
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);

  res = await app.inject({
    method: 'POST',
    url: `/devices/${id}/credentials`,
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id, secret: res.json().secret };
}

const JENDELA = {
  windowStart: '2026-08-21T09:00:00.000Z',
  windowEnd: '2026-08-21T10:00:00.000Z',
};

const SATU = { event: 'latensi_keranjang_ms', type: null, count: 3, total: 90, min: 20, max: 40, p95: 40 };

function kirim(perangkat, body, opsi = {}) {
  return app.inject({
    method: 'POST',
    url: `/devices/${perangkat.id}/telemetry`,
    payload: { appVersion: '1.0.0', ...JENDELA, ...body },
    headers: {
      'x-tenant-id': opsi.tenantId ?? tenant.id,
      authorization: `Bearer ${opsi.secret ?? perangkat.secret}`,
      'idempotency-key': opsi.key ?? crypto.randomUUID(),
    },
  });
}

// ---------------------------------------------------------------------------
// Jalur normal
// ---------------------------------------------------------------------------

test('telemetri tersimpan sebagai agregat, satu baris per (event, type)', async () => {
  const p = await buatPerangkat();
  const res = await kirim(p, {
    events: [SATU, { event: 'crash', type: 'TypeError', count: 2, total: 2, min: 1, max: 1, p95: 1 }],
  });
  assert.equal(res.statusCode, 202, res.body);
  assert.deepEqual(res.json(), { deviceId: p.id, diterima: 2 });

  const { rows } = await kueriTenant(
    `SELECT event, type, sample_count, total_value, p95_value, app_version
       FROM device_telemetry WHERE device_id = $1 ORDER BY event`,
    [p.id]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, 'crash');
  assert.equal(rows[0].type, 'TypeError');
  assert.equal(Number(rows[1].sample_count), 3);
  assert.equal(Number(rows[1].total_value), 90);
  // ⛔ Versi dibekukan bersama angkanya, bukan dibaca dari `device.app_version`
  // saat laporan dibuat. `ARCH:302` memakai crash rate PER VERSI sebagai gate
  // rollout, dan versi perangkat sekarang sudah berubah saat rollout gagal.
  assert.equal(rows[0].app_version, '1.0.0');
});

test('pengiriman ulang dengan Idempotency-Key yang sama tidak menggandakan baris', async () => {
  const p = await buatPerangkat();
  const key = crypto.randomUUID();
  const satu = await kirim(p, { events: [SATU] }, { key });
  const dua = await kirim(p, { events: [SATU] }, { key });

  assert.equal(satu.statusCode, 202);
  // Respons yang hilang adalah kejadian normal di jalur ini: perangkat
  // mengirim ulang justru KARENA ia tidak pernah tahu yang pertama sampai.
  assert.equal(dua.statusCode, 202, dua.body);
  assert.deepEqual(dua.json(), satu.json());

  const { rows } = await kueriTenant('SELECT count(*) AS n FROM device_telemetry WHERE device_id = $1', [p.id]);
  assert.equal(Number(rows[0].n), 1);
});

test('Idempotency-Key yang hilang ditolak 400', async () => {
  const p = await buatPerangkat();
  const res = await app.inject({
    method: 'POST',
    url: `/devices/${p.id}/telemetry`,
    payload: { ...JENDELA, events: [SATU] },
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${p.secret}` },
  });
  assert.equal(res.statusCode, 400, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ Batas etis — `ARCH:309`
// ---------------------------------------------------------------------------

test('⛔ event di luar daftar TERTUTUP ditolak, tidak disimpan diam-diam', async () => {
  const p = await buatPerangkat();
  // Nama yang menjelaskan ISI, bukan peristiwa. Kalau ia lolos, telemetri
  // menjadi jalur yang mengirim nilai transaksi merchant ke pihak ketiga
  // tanpa merchant memintanya — dan tidak ada yang akan melihatnya.
  const res = await kirim(p, {
    events: [{ event: 'nilai_transaksi', type: null, count: 1, total: 25000, min: 25000, max: 25000, p95: 25000 }],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');

  const { rows } = await kueriTenant('SELECT count(*) AS n FROM device_telemetry', []);
  assert.equal(Number(rows[0].n), 0);
});

test('⛔ nilai bukan angka ditolak', async () => {
  const p = await buatPerangkat();
  for (const total of ['Kopi Susu', {}, []]) {
    const res = await kirim(p, { events: [{ ...SATU, total }] });
    assert.equal(res.statusCode, 400, `total=${JSON.stringify(total)} lolos: ${res.body}`);
  }
});

test('⛔ `null` menjadi 0 lewat koersi AJV, dan yang menangkapnya ARITMETIKA', async () => {
  const p = await buatPerangkat();

  // Ditemukan lewat test, bukan review: Fastify menyalakan koersi AJV secara
  // bawaan, jadi `total: null` sampai ke handler sebagai **0** — pengukuran
  // yang tidak pernah terjadi, tidak dapat dibedakan dari nol yang sungguhan,
  // dan tanpa satu pun error. `typeof === 'number'` tidak melihat apa pun.
  //
  // Yang menangkapnya adalah aturan yang berlaku untuk agregat mana pun:
  // total ada di [min × count, max × count].
  const res = await kirim(p, { events: [{ ...SATU, total: null }] });
  assert.equal(res.statusCode, 400, res.body);

  const { rows } = await kueriTenant('SELECT count(*) AS n FROM device_telemetry', []);
  assert.equal(Number(rows[0].n), 0);
});

test('⛔ agregat yang mustahil ditolak — p95 di luar [min, max], min > max', async () => {
  const p = await buatPerangkat();
  const mustahil = [
    { ...SATU, min: 50, max: 10 },
    { ...SATU, min: 20, max: 40, p95: 900 },
    { ...SATU, count: 3, min: 20, max: 40, total: 1000 },
  ];
  for (const e of mustahil) {
    const res = await kirim(p, { events: [e] });
    assert.equal(res.statusCode, 400, `${JSON.stringify(e)} lolos: ${res.body}`);
  }
});

test('⛔ `type` yang kepanjangan DIPOTONG, bukan menolak seluruh muatan', async () => {
  const p = await buatPerangkat();
  // Pemanggil yang keliru mengoper PESAN error ("Kopi Susu tidak ditemukan")
  // alih-alih tipenya. Menolak muatannya membuang metrik yang baik bersama
  // yang buruk; memotongnya membuang kelebihannya saja.
  const res = await kirim(p, {
    events: [{ ...SATU, event: 'crash', type: 'x'.repeat(200) }],
  });
  assert.equal(res.statusCode, 202, res.body);
  const { rows } = await kueriTenant('SELECT type FROM device_telemetry WHERE device_id = $1', [p.id]);
  assert.equal(rows[0].type.length, 64);
});

test('⛔ properti asing DIBUANG validator sebelum handler melihatnya', async () => {
  const p = await buatPerangkat();
  // `additionalProperties: false` + `removeAdditional` bawaan Fastify. Ia
  // TIDAK menolak — ia menghapus. Untuk batas etis itu cukup dan lebih baik:
  // muatan yang metriknya baik tetap masuk, dan konteks yang diselundupkan
  // tidak pernah sampai ke handler, apalagi ke tabel.
  const res = await kirim(p, { events: [{ ...SATU, namaProduk: 'Kopi Susu' }] });
  assert.equal(res.statusCode, 202, res.body);
});

test('⛔ tabel device_telemetry tidak punya SATU PUN kolom JSON', async () => {
  // Penjaga terhadap migrasi berikutnya yang "sekadar menambahkan konteks".
  // Kolom JSON bebas adalah pintu tempat nama produk masuk enam bulan dari
  // sekarang, lewat satu baris kode yang tidak terlihat melanggar apa pun —
  // dan `additionalProperties: false` di atas hanya menjaga bentuk yang
  // sekarang, bukan kolom yang belum ada.
  const { rows } = await appSetup.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'device_telemetry'`
  );
  assert.ok(rows.length > 0, 'tabelnya tidak terbaca — migrasi belum jalan?');
  assert.deepEqual(
    rows.filter((r) => r.data_type === 'json' || r.data_type === 'jsonb'),
    []
  );
});

// ---------------------------------------------------------------------------
// Kredensial
// ---------------------------------------------------------------------------

test('⛔ tanpa Bearer, atau dengan secret salah, ditolak 401 dengan pesan yang sama', async () => {
  const p = await buatPerangkat();

  const tanpa = await app.inject({
    method: 'POST',
    url: `/devices/${p.id}/telemetry`,
    payload: { ...JENDELA, events: [SATU] },
    headers: { 'x-tenant-id': tenant.id, 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(tanpa.statusCode, 401, tanpa.body);

  const salah = await kirim(p, { events: [SATU] }, { secret: 'bukan-secret' });
  assert.equal(salah.statusCode, 401, salah.body);

  // Perangkat yang tidak ada dijawab sama persis. Membedakannya memberi tahu
  // penebak bahwa id-nya benar.
  const hantu = await kirim({ id: crypto.randomUUID(), secret: p.secret }, { events: [SATU] });
  assert.equal(hantu.statusCode, 401, hantu.body);
  assert.equal(hantu.json().error.code, salah.json().error.code);
});

test('⛔ perangkat yang DICABUT tidak dapat mengirim telemetri', async () => {
  const p = await buatPerangkat();
  const cabut = await app.inject({
    method: 'POST',
    url: `/devices/${p.id}/revoke`,
    headers: headerTenant(),
  });
  assert.equal(cabut.statusCode, 200, cabut.body);

  const res = await kirim(p, { events: [SATU] });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ isolasi tenant: perangkat tenant lain tidak dapat dituju', async () => {
  const p = await buatPerangkat();
  const lain = await seedTenantBase(appSetup, { suffix: 'TelemetriLain' });

  // Secret-nya BENAR; yang salah hanya tenantnya. Pencarian device tunduk RLS,
  // jadi id-nya tidak ditemukan di sana — dan tidak ada jalur lain yang
  // mencari perangkat di luar RLS.
  const res = await kirim(p, { events: [SATU] }, { tenantId: lain.tenant.id });
  assert.equal(res.statusCode, 401, res.body);

  const { rows } = await kueriTenant('SELECT count(*) AS n FROM device_telemetry', [], lain.tenant.id);
  assert.equal(Number(rows[0].n), 0);
});

// ---------------------------------------------------------------------------
// Pembacaan (B-28)
// ---------------------------------------------------------------------------

test('ringkasan menjumlahkan jendela, dan p95 dilaporkan sebagai yang TERBURUK', async () => {
  const p = await buatPerangkat();
  await kirim(p, { events: [{ ...SATU, count: 2, total: 60, min: 20, max: 40, p95: 40 }] });
  await kirim(p, {
    ...JENDELA,
    windowStart: '2026-08-21T10:00:00.000Z',
    windowEnd: '2026-08-21T11:00:00.000Z',
    events: [{ ...SATU, count: 1, total: 300, min: 300, max: 300, p95: 300 }],
  });

  const res = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/telemetry`,
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 200, res.body);
  const e = res.json().events.find((x) => x.event === 'latensi_keranjang_ms');
  assert.equal(e.count, 3);
  assert.equal(e.total, 360);
  assert.equal(e.min, 20);
  assert.equal(e.max, 300);
  // ⛔ MAX dari p95, bukan rata-ratanya. Persentil tidak dapat dirata-ratakan,
  // dan angka yang "halus" di sini menyembunyikan jendela yang buruk.
  assert.equal(e.p95Terburuk, 300);
});

test('`sejak` menyaring jendela lama', async () => {
  const p = await buatPerangkat();
  await kirim(p, { events: [SATU] });

  const res = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/telemetry?sejak=2026-08-22T00:00:00.000Z`,
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().events, []);
});

test('⛔ perangkat tenant lain dijawab 404, bukan larik kosong', async () => {
  const p = await buatPerangkat();
  await kirim(p, { events: [SATU] });
  const lain = await seedTenantBase(appSetup, { suffix: 'TelemetriBaca' });

  // "Kosong" tidak dapat dibedakan dari "perangkat ini belum pernah mengirim
  // apa pun" — dan perbedaan itu yang menentukan apakah seseorang menelepon
  // outletnya.
  const res = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/telemetry`,
    headers: { 'x-tenant-id': lain.tenant.id, authorization: lain.authHeader },
  });
  assert.equal(res.statusCode, 404, res.body);
});
