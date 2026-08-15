'use strict';

// Relay SUNGGUHAN terhadap server SUNGGUHAN.
//
// `tests/sync-client` menguji relay terhadap MODEL server, dan `server-dst.test.js`
// menguji server terhadap outbox buatan tangan. Keduanya meninggalkan celah
// yang sama, dan celah itu tepat di sambungannya:
//
//   - apakah `Idempotency-Key` yang dikirim `buatPengirimHttp` benar-benar
//     dikenali Fastify+PostgreSQL, atau hanya dikenali model;
//   - apakah retry yang sah menghasilkan hash request yang sama, atau justru
//     ditolak 422 dan ditandai `failed` permanen.
//
// Satu klaim `http.ts` TETAP tidak teruji setelah berkas ini, dan itu dicoba:
// mengganti `body: baris.payload` dengan `JSON.stringify(JSON.parse(...))`
// tidak menjatuhkan satu pun test di sini. Perjalanan bolak-balik JSON
// deterministik untuk bentuk payload kami. Dicatat di `http.ts` sebagai
// pertahanan, bukan sebagai sesuatu yang dijaga test.
//
// Berkas ini memakai `packages/sync-client` apa adanya: `enqueue`,
// `kirimBatch`, `pulihkanSetelahMati`, `buatPengirimHttp`. Tidak ada tiruan
// di sisi klien, dan tidak ada tiruan di sisi server.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { createRng } = require('../dst/harness');
const { buatDb } = require('../sync-client/helpers/db');

const SYNC = '../../packages/sync-client/src/index.ts';

let owner, appSetup, app, tenant, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'RelayServer' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-07';
const T0 = Date.parse('2026-08-07T10:00:00.000Z');

async function query(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (err) {
    await appSetup.query('ROLLBACK');
    throw err;
  }
}

/**
 * `fetch` palsu di atas `app.inject`.
 *
 * Inilah satu-satunya tiruan yang tersisa, dan ia sengaja setipis mungkin:
 * hanya memetakan bentuk `fetch` ke bentuk `inject`. Segala sesuatu di
 * belakangnya — routing, validasi OpenAPI, idempotency, transaksi, RLS —
 * adalah kode yang benar-benar akan dijalankan merchant.
 */
function fetchLewatInject(catat) {
  return async function fetchFn(url, opsi) {
    const res = await app.inject({
      method: opsi.method,
      url,
      payload: opsi.body,
      headers: Object.fromEntries(
        Object.entries(opsi.headers).map(([k, v]) => [k.toLowerCase(), v])
      ),
    });
    if (catat) catat({ url, headers: opsi.headers, body: opsi.body, status: res.statusCode });
    return {
      status: res.statusCode,
      async json() {
        return JSON.parse(res.body);
      },
    };
  };
}

async function siapkanPerangkat(kode) {
  const deviceId = crypto.randomUUID();
  const d = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: kode },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(d.statusCode, 201, d.body);

  const shiftId = crypto.randomUUID();
  const s = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: {
      id: shiftId,
      outletId: base.outlet.id,
      deviceId,
      businessDate: BUSINESS_DATE,
      openingFloat: 100000,
    },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id },
  });
  assert.equal(s.statusCode, 201, s.body);

  const variationId = crypto.randomUUID();
  const it = await app.inject({
    method: 'POST',
    url: '/items',
    payload: { id: crypto.randomUUID(), name: `P-${kode}`, variations: [{ id: variationId, price: 20000 }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  assert.equal(it.statusCode, 201, it.body);

  return { kode, deviceId, shiftId, variationId };
}

function payloadOrder(perangkat, urutan) {
  const orderId = crypto.randomUUID();
  return {
    orderId,
    body: {
      id: orderId,
      outletId: base.outlet.id,
      deviceId: perangkat.deviceId,
      shiftId: perangkat.shiftId,
      receiptNumber: `${perangkat.kode}-20260807-${String(urutan).padStart(4, '0')}`,
      businessDate: BUSINESS_DATE,
      sequence: urutan,
      channel: 'takeaway',
      checkId: crypto.randomUUID(),
      lines: [
        { id: crypto.randomUUID(), variationId: perangkat.variationId, quantityMilli: 1000, discountAmount: 0 },
      ],
    },
  };
}

// ============================================================

test('relay sungguhan + server sungguhan: jaringan buruk, tepat sekali', async () => {
  const { enqueue, kirimBatch, pulihkanSetelahMati, buatPengirimHttp } = await import(SYNC);

  const JUMLAH = 24;
  const rng = createRng(20260808);
  const perangkat = await siapkanPerangkat('K1');
  const db = buatDb();

  try {
    const dibuat = [];
    await db.transaction(async (tx) => {
      for (let n = 1; n <= JUMLAH; n += 1) {
        const { orderId, body } = payloadOrder(perangkat, n);
        dibuat.push(orderId);
        await enqueue(tx, {
          id: `obx-${String(n).padStart(4, '0')}`,
          entityType: 'order',
          entityId: orderId,
          operation: 'create',
          payload: body,
          // Key lahir DI SINI, bersama itemnya. Itu yang membuat retry aman.
          idempotencyKey: `${perangkat.kode}-${n}-${orderId.slice(0, 8)}`,
          createdAt: new Date(T0 + n).toISOString(),
        });
      }
    });

    const pengirimAsli = buatPengirimHttp({
      baseUrl: '',
      tenantId: tenant.id,
      actorId: base.user.id,
      fetchFn: fetchLewatInject(),
    });

    // Cacat disuntikkan DI LUAR relay, di lapisan transport — persis tempat
    // ia terjadi di dunia nyata. Relay tidak tahu apa pun tentang ini.
    let andal = false;
    const kirim = async (baris) => {
      if (!andal && rng.chance(0.3)) {
        // Request tidak pernah sampai.
        return { status: null, pesan: 'request hilang' };
      }

      const hasil = await pengirimAsli(baris);

      if (!andal && rng.chance(0.15)) {
        // Duplikat: request yang SAMA sampai dua kali. Kalau server tidak
        // mengenali key-nya, ini yang menghasilkan order ganda.
        await pengirimAsli(baris);
      }

      if (!andal && rng.chance(0.25)) {
        // Server SUDAH menulis; klien tidak tahu. Item tetap di antrean, dan
        // percobaan berikutnya HARUS dikenali sebagai replay.
        return { status: null, pesan: 'respons hilang' };
      }

      return hasil;
    };

    let sekarang = T0 + 10_000;
    for (let putaran = 0; putaran < 60; putaran += 1) {
      if (rng.chance(0.1)) await pulihkanSetelahMati(db);
      await kirimBatch({ db, now: () => sekarang, kirim });
      sekarang += 61_000;
      const [{ n }] = await db.getAll(
        `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
      );
      if (n === 0) break;
    }

    // Fase penyelesaian: jaringan pulih. Tanpa ini, "masih ada di antrean"
    // selalu punya alasan sah dan invariantnya tidak berarti apa-apa.
    andal = true;
    for (let putaran = 0; putaran < 40; putaran += 1) {
      await kirimBatch({ db, now: () => sekarang, kirim });
      sekarang += 61_000;
      const [{ n }] = await db.getAll(
        `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
      );
      if (n === 0) break;
    }

    const status = await db.getAll(
      `SELECT status, count(*) AS n FROM outbox_local GROUP BY status ORDER BY status`
    );
    assert.deepEqual(
      Object.fromEntries(status.map((r) => [r.status, r.n])),
      { sent: JUMLAH },
      'antrean lokal belum kosong'
    );

    // Diperiksa terhadap DATABASE, bukan terhadap jawaban HTTP. Jawaban bisa
    // hilang; baris tidak.
    const rows = await query('SELECT id, receipt_number FROM "order" ORDER BY sequence');
    assert.equal(rows.length, JUMLAH, `server menyimpan ${rows.length} order, seharusnya ${JUMLAH}`);
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      [...dibuat].sort(),
      'order yang tersimpan tidak sama dengan yang dibuat'
    );

    const struk = rows.map((r) => r.receipt_number);
    assert.equal(new Set(struk).size, JUMLAH, 'ada nomor struk ganda — duplikasi lolos');

    // ⚠ Batas test ini, ditemukan lewat sabotase dan dicatat supaya tidak
    // dibaca lebih kuat daripada yang sebenarnya dibuktikannya.
    //
    // Memberi akhiran berbeda pada `Idempotency-Key` setiap percobaan TIDAK
    // menjatuhkan satu pun assertion di atas. Sebabnya `order` punya DUA
    // lapisan: Idempotency-Key, dan primary key `order.id` yang di-generate
    // klien. Duplikat tertangkap lapisan kedua sebagai 409 ID_ALREADY_EXISTS,
    // yang dibaca relay sebagai berhasil.
    //
    // Menghitung baris `idempotency_key` juga tidak membedakannya: klaim key
    // berada DI DALAM transaksi yang sama dengan penulisan order
    // (`orders.ts`, `claimIdempotencyKey`), jadi ia ikut ter-rollback saat PK
    // menolak, dan jumlahnya tetap sama dengan jumlah order.
    //
    // Jadi test ini membuktikan "tepat sekali" — dan itu memang yang dituntut
    // AC — tapi ia TIDAK membuktikan idempotency key-nya bekerja. Yang
    // membuktikan itu ada di test `payment` di bawah, satu-satunya entitas
    // yang key-nya berdiri sendiri (`CLAUDE.md`: "yang melindungi retry
    // pembayaran adalah Idempotency-Key, bukan primary key").
  } finally {
    db.tutup();
  }
});

// Klaim yang dibuat `http.ts` dan tidak pernah diuji terhadap kode yang
// menghitung hash request:
//
//   "payload dikirim APA ADANYA, tanpa parse-lalu-stringify ulang — perjalanan
//    bolak-balik itu dapat mengubah urutan kunci, dan server menghitung hash
//    request dari body."
//
// Kalau klaim itu salah, retry yang sah menerima 422 IDEMPOTENCY_KEY_REUSED
// dan penjualan yang sudah tercatat ditandai `failed` permanen.
test('retry dengan key yang sama dikenali server sebagai replay, bukan body berbeda', async () => {
  const { enqueue, kirimBatch, buatPengirimHttp } = await import(SYNC);

  const perangkat = await siapkanPerangkat('K2');
  const db = buatDb();

  try {
    const { orderId, body } = payloadOrder(perangkat, 1);
    await db.transaction((tx) =>
      enqueue(tx, {
        id: 'obx-0001',
        entityType: 'order',
        entityId: orderId,
        operation: 'create',
        payload: body,
        idempotencyKey: 'kunci-tetap-sama',
        createdAt: new Date(T0).toISOString(),
      })
    );

    const dicatat = [];
    const pengirim = buatPengirimHttp({
      baseUrl: '',
      tenantId: tenant.id,
      actorId: base.user.id,
      fetchFn: fetchLewatInject((c) => dicatat.push(c)),
    });

    // Percobaan pertama: server menulis, tapi responsnya "hilang".
    let responsPertamaHilang = true;
    const kirim = async (baris) => {
      const hasil = await pengirim(baris);
      if (responsPertamaHilang) {
        responsPertamaHilang = false;
        return { status: null, pesan: 'respons hilang' };
      }
      return hasil;
    };

    await kirimBatch({ db, now: () => T0, kirim });
    let [row] = await db.getAll(`SELECT status, attempts FROM outbox_local`);
    assert.equal(row.status, 'pending', 'respons hilang harus tetap pending, bukan failed');
    assert.equal(row.attempts, 1);

    // Percobaan kedua: key SAMA, body SAMA. Server harus mengenalinya.
    await kirimBatch({ db, now: () => T0 + 3_000, kirim });
    [row] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(row.status, 'sent');

    assert.equal(dicatat.length, 2, 'harus ada dua permintaan yang benar-benar sampai ke server');
    assert.equal(dicatat[0].body, dicatat[1].body, 'body kedua percobaan harus IDENTIK byte-per-byte');
    assert.equal(dicatat[0].headers['Idempotency-Key'], dicatat[1].headers['Idempotency-Key']);
    assert.equal(dicatat[0].status, 201, 'percobaan pertama benar-benar membuat order');
    assert.notEqual(
      dicatat[1].status,
      422,
      'server membaca body kedua sebagai BERBEDA — klaim "dikirim apa adanya" salah'
    );

    const rows = await query('SELECT id FROM "order"');
    assert.equal(rows.length, 1, 'retry menghasilkan order kedua — idempotency tidak bekerja');
    assert.equal(rows[0].id, orderId);
  } finally {
    db.tutup();
  }
});

// `openShift` tidak menuntut Idempotency-Key; yang melindunginya hanya primary
// key yang di-generate klien. Relay membaca 409 ID_ALREADY_EXISTS sebagai
// BERHASIL — dan itu diuji di sini terhadap server sungguhan, bukan terhadap
// model yang kebetulan mengembalikan kode itu.
test('shift yang dikirim ulang menerima 409 ID_ALREADY_EXISTS dan ditandai sent', async () => {
  const { enqueue, kirimBatch, buatPengirimHttp } = await import(SYNC);

  const deviceId = crypto.randomUUID();
  const d = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: 'K3' },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(d.statusCode, 201, d.body);

  const db = buatDb();
  try {
    const shiftId = crypto.randomUUID();
    const body = {
      id: shiftId,
      outletId: base.outlet.id,
      deviceId,
      businessDate: BUSINESS_DATE,
      openingFloat: 100000,
    };
    await db.transaction((tx) =>
      enqueue(tx, {
        id: 'obx-shift',
        entityType: 'shift',
        entityId: shiftId,
        operation: 'create',
        payload: body,
        idempotencyKey: 'kunci-shift',
        createdAt: new Date(T0).toISOString(),
      })
    );

    const dicatat = [];
    const pengirim = buatPengirimHttp({
      baseUrl: '',
      tenantId: tenant.id,
      actorId: base.user.id,
      fetchFn: fetchLewatInject((c) => dicatat.push(c)),
    });

    let pertama = true;
    const kirim = async (baris) => {
      const hasil = await pengirim(baris);
      if (pertama) {
        pertama = false;
        return { status: null, pesan: 'respons hilang' };
      }
      return hasil;
    };

    await kirimBatch({ db, now: () => T0, kirim });
    await kirimBatch({ db, now: () => T0 + 3_000, kirim });

    const [row] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(row.status, 'sent');
    assert.equal(dicatat[0].status, 201);
    assert.equal(
      dicatat[1].status,
      409,
      'percobaan kedua seharusnya ditolak primary key — kalau 201, ada shift ganda'
    );

    const rows = await query('SELECT id FROM cash_drawer_shift WHERE id = $1', [shiftId]);
    assert.equal(rows.length, 1);
  } finally {
    db.tutup();
  }
});

// Satu-satunya entitas yang idempotency key-nya BERDIRI SENDIRI.
//
// `CLAUDE.md`: "`payment` PK-nya `(id, occurred_at)` ... Yang melindungi retry
// pembayaran adalah Idempotency-Key, bukan primary key: satu lapisan lebih
// sedikit daripada yang dimiliki order."
//
// `occurred_at` datang dari jam database, jadi ia berbeda di setiap percobaan
// — primary key tidak menangkap apa pun di sini. Kalau relay mengirim key yang
// berbeda pada retry, pelanggan DIBAYAR DUA KALI, dan tidak ada lapisan kedua
// yang menahannya.
//
// Inilah test yang membuat klaim "key lahir bersama itemnya" punya arti. Test
// order di atas tidak bisa, dan itu dicatat di sana.
test('retry pembayaran dengan key yang sama TIDAK menagih dua kali', async () => {
  const { enqueue, kirimBatch, buatPengirimHttp } = await import(SYNC);

  const perangkat = await siapkanPerangkat('K4');
  const db = buatDb();

  try {
    // Order harus ada lebih dulu; ia dikirim lewat jalur normal.
    const { orderId, body } = payloadOrder(perangkat, 1);
    const paymentId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-order',
        entityType: 'order',
        entityId: orderId,
        operation: 'create',
        payload: body,
        idempotencyKey: 'kunci-order',
        createdAt: new Date(T0).toISOString(),
      });
      await enqueue(tx, {
        id: 'obx-payment',
        entityType: 'payment',
        entityId: orderId,
        operation: 'create',
        payload: { id: paymentId, method: 'cash', tenderedAmount: 25000 },
        idempotencyKey: 'kunci-bayar',
        createdAt: new Date(T0 + 1).toISOString(),
        // Pembayaran tidak boleh naik sebelum order-nya ada.
        dependsOn: 'obx-order',
      });
    });

    const dicatat = [];
    const pengirim = buatPengirimHttp({
      baseUrl: '',
      tenantId: tenant.id,
      actorId: base.user.id,
      fetchFn: fetchLewatInject((c) => dicatat.push(c)),
    });

    // Respons pembayaran PERTAMA hilang: server sudah menagih, klien tidak
    // tahu. Percobaan berikutnya wajib dikenali sebagai replay.
    let bayarPertamaHilang = true;
    const kirim = async (baris) => {
      const hasil = await pengirim(baris);
      if (baris.entity_type === 'payment' && bayarPertamaHilang) {
        bayarPertamaHilang = false;
        return { status: null, pesan: 'respons hilang' };
      }
      return hasil;
    };

    for (let putaran = 0; putaran < 6; putaran += 1) {
      await kirimBatch({ db, now: () => T0 + putaran * 61_000, kirim });
      const [{ n }] = await db.getAll(
        `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
      );
      if (n === 0) break;
    }

    const outbox = await db.getAll(`SELECT id, status FROM outbox_local ORDER BY id`);
    assert.deepEqual(
      outbox.map((r) => `${r.id}=${r.status}`),
      ['obx-order=sent', 'obx-payment=sent']
    );

    const bayar = await query('SELECT id, amount FROM payment WHERE order_id = $1', [orderId]);
    assert.equal(
      bayar.length,
      1,
      `${bayar.length} baris payment untuk satu order — pelanggan ditagih dua kali`
    );

    const upayaBayar = dicatat.filter((c) => c.url.endsWith('/payments'));
    assert.equal(upayaBayar.length, 2, 'harus ada dua permintaan pembayaran yang sampai ke server');
    assert.equal(
      upayaBayar[0].headers['Idempotency-Key'],
      upayaBayar[1].headers['Idempotency-Key'],
      'key pembayaran berubah antar percobaan'
    );
  } finally {
    db.tutup();
  }
});
