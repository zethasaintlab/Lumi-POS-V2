'use strict';

// DST terhadap SERVER SUNGGUHAN — Fastify + PostgreSQL, bukan model.
//
// `HANDOFF.md` mencatatnya sebagai utang yang kubuat sendiri: harness di
// `tests/dst/` memodelkan PROTOKOL, dan 10.000 iterasi terhadap PostgreSQL
// akan memakan waktu berjam-jam. Berkas ini menutup celah di antaranya —
// iterasi jauh lebih sedikit, tapi yang diuji adalah implementasi yang
// benar-benar akan dijalankan merchant.
//
// Pembagian kerjanya:
//
//   tests/dst/         10.000 iterasi, model protokol, tanpa I/O   → gate F2
//   tests/dst-server/  puluhan iterasi, server + database sungguhan → ikatan
//
// Tanpa yang kedua, gate F2 membuktikan protokolnya benar tanpa membuktikan
// bahwa kode kita mengikutinya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { createRng } = require('../dst/harness');

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
  base = await seedTenantBase(appSetup, { suffix: 'DstServer' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-07';

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

function kirim(url, payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers },
  });
}

/**
 * Satu perangkat kasir. Counter nomor struk LOKAL, antrean persisten, dan
 * idempotency key yang lahir bersama itemnya — ketiganya sifat yang dibuktikan
 * penting oleh `prototypes/02-dst-sinkronisasi/FINDINGS.md`.
 */
function buatPerangkat(kode, deviceId, shiftId, variationId) {
  let urutan = 0;
  let seq = 0;
  const outbox = [];
  const dibuat = [];

  return {
    kode,
    deviceId,
    outbox,
    dibuat,
    jual(harga) {
      urutan += 1;
      seq += 1;
      const orderId = crypto.randomUUID();
      const payload = {
        id: orderId,
        outletId: base.outlet.id,
        deviceId,
        shiftId,
        receiptNumber: `${kode}-20260807-${String(urutan).padStart(4, '0')}`,
        businessDate: BUSINESS_DATE,
        sequence: urutan,
        channel: 'takeaway',
        checkId: crypto.randomUUID(),
        lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
      };
      const item = {
        // Key lahir DI SINI, bersama itemnya -- bukan saat dikirim.
        key: `${kode}-${seq}-${orderId.slice(0, 8)}`,
        payload,
        orderId,
        harga,
      };
      outbox.push(item);
      dibuat.push(item);
      return item;
    },
  };
}

/**
 * Transport dengan cacat yang disuntikkan.
 *
 * Ketiga bentuk kegagalan diambil dari `stress.py` prototipe. Yang ketiga —
 * respons hilang setelah server MENULIS — adalah yang paling sering dilupakan
 * orang, dan satu-satunya alasan idempotency ada.
 */
async function coba(item, rng, { andal = false } = {}) {
  if (!andal && rng.chance(0.3)) {
    return 'request-hilang';
  }

  const res = await kirim('/orders', item.payload, { 'idempotency-key': item.key });

  if (!andal && rng.chance(0.15)) {
    // Duplikat: request yang sama sampai dua kali.
    await kirim('/orders', item.payload, { 'idempotency-key': item.key });
  }

  if (!andal && rng.chance(0.25)) {
    // Server SUDAH menulis; klien tidak tahu. Item tetap di antrean.
    return 'respons-hilang';
  }

  return res.statusCode;
}

// ============================================================
// Invariant, diperiksa terhadap DATABASE
// ============================================================

async function periksaInvariantServer(perangkat) {
  const pelanggaran = [];

  const rows = await query(
    'SELECT id, receipt_number, device_id, sequence, business_date, total, status FROM "order"'
  );
  const diServer = new Map(rows.map((r) => [r.id, r]));

  // I1 -- konservasi. Yang masih tertinggal di antrean bukan pelanggaran.
  for (const p of perangkat) {
    const tertinggal = new Set(p.outbox.map((o) => o.orderId));
    for (const item of p.dibuat) {
      if (!tertinggal.has(item.orderId) && !diServer.has(item.orderId)) {
        pelanggaran.push(`I1 konservasi: ${item.orderId} (${item.payload.receiptNumber}) hilang`);
      }
    }
  }

  // I2 -- tanpa duplikasi.
  const perStruk = new Map();
  for (const r of rows) {
    perStruk.set(r.receipt_number, (perStruk.get(r.receipt_number) ?? 0) + 1);
  }
  for (const [struk, jumlah] of perStruk) {
    if (jumlah > 1) pelanggaran.push(`I2 duplikasi: struk ${struk} muncul ${jumlah}x`);
  }

  // I3 -- konvergensi: server tidak mengarang order.
  const idPerangkat = new Set(perangkat.flatMap((p) => p.dibuat.map((i) => i.orderId)));
  for (const id of diServer.keys()) {
    if (!idPerangkat.has(id)) pelanggaran.push(`I3 konvergensi: ${id} tidak berasal dari perangkat mana pun`);
  }

  // I4 -- monotonisitas: urutan rapat per device + tanggal bisnis.
  for (const p of perangkat) {
    const sampai = p.dibuat
      .filter((i) => diServer.has(i.orderId))
      .map((i) => i.payload.sequence)
      .sort((a, b) => a - b);
    for (let i = 0; i < sampai.length; i += 1) {
      // Lubang HANYA pelanggaran bila order yang seharusnya mengisinya sudah
      // terkirim. Antrean yang masih menunggu bukan lubang.
      if (sampai[i] !== i + 1) {
        const hilang = i + 1;
        const masihAntre = p.outbox.some((o) => o.payload.sequence === hilang);
        if (!masihAntre) {
          pelanggaran.push(`I4 monotonisitas: ${p.kode} berlubang di ${hilang}`);
        }
        break;
      }
    }
  }

  // I5 -- konservasi uang.
  let uangPerangkat = 0n;
  for (const p of perangkat) {
    for (const item of p.dibuat) {
      if (diServer.has(item.orderId)) uangPerangkat += BigInt(item.harga);
    }
  }
  const uangServer = rows.reduce((n, r) => n + BigInt(r.total), 0n);
  if (uangPerangkat !== uangServer) {
    pelanggaran.push(`I5 uang: perangkat ${uangPerangkat} != server ${uangServer}`);
  }

  // I8 -- higienis idempotency: satu order <= satu key.
  //
  // Dibaca dari `idempotency_key.response_body`, karena di situlah id order
  // yang dihasilkan tersimpan. Kalau satu order punya dua key, dedup-nya
  // bergantung pada primary key saja -- persis cacat `regen_idem_on_retry`
  // yang lolos I1-I5 di prototipe.
  const keys = await query(
    `SELECT response_body->>'id' AS order_id, COUNT(*) AS jumlah
       FROM idempotency_key
      WHERE response_body ? 'id'
      GROUP BY response_body->>'id' HAVING COUNT(*) > 1`
  );
  for (const k of keys) {
    pelanggaran.push(`I8 idempotency: order ${k.order_id} punya ${k.jumlah} key`);
  }

  return { pelanggaran, rows };
}

// ============================================================
// Simulasi
// ============================================================

async function siapkanPerangkat(kode, nomor) {
  const deviceId = crypto.randomUUID();
  const d = await kirim('/devices', { id: deviceId, outletId: base.outlet.id, code: kode }, {
    'idempotency-key': crypto.randomUUID(),
  });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await kirim('/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId,
    businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  assert.equal(s.statusCode, 201, s.body);

  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const it = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${nomor}`, variations: [{ id: variationId, price: 20000 }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  assert.equal(it.statusCode, 201, it.body);

  return buatPerangkat(kode, deviceId, shiftId, variationId);
}

async function jalankanIterasi(seed, { jumlahPerangkat = 2, langkah = 12 } = {}) {
  const rng = createRng(seed);
  const perangkat = [];
  for (let i = 0; i < jumlahPerangkat; i += 1) {
    perangkat.push(await siapkanPerangkat(`K${i + 1}`, `${seed}-${i}`));
  }

  for (let n = 0; n < langkah; n += 1) {
    const p = perangkat[rng.int(perangkat.length)];
    p.jual(20000);
    // Antrean dikirim satu per satu, dengan jaringan yang buruk.
    const item = p.outbox[0];
    if (item !== undefined) {
      const hasil = await coba(item, rng);
      if (hasil === 201 || hasil === 409) {
        p.outbox.shift();
      }
    }
  }

  // Fase penyelesaian: jaringan pulih, seluruh antrean dikuras. Tanpa ini I1
  // selalu punya alasan sah untuk gagal, dan invariantnya tidak berarti apa-apa.
  for (let putaran = 0; putaran < 50; putaran += 1) {
    let masihAda = false;
    for (const p of perangkat) {
      const item = p.outbox[0];
      if (item === undefined) continue;
      masihAda = true;
      const hasil = await coba(item, rng, { andal: true });
      if (hasil === 201 || hasil === 409) {
        p.outbox.shift();
      }
    }
    if (!masihAda) break;
  }

  return perangkat;
}

// ============================================================
// Test
// ============================================================

// Iterasinya jauh lebih sedikit daripada gate 10.000 — setiap langkah menyentuh
// PostgreSQL sungguhan. Yang dicari di sini bukan kedalaman ruang keadaan
// (itu tugas tests/dst/), melainkan IKATAN: bahwa implementasi kita berperilaku
// seperti protokol yang sudah dibuktikan benar.
for (const seed of [1, 2, 3]) {
  test(`server sungguhan bertahan fault injection (seed=${seed})`, async () => {
    const perangkat = await jalankanIterasi(seed);
    const { pelanggaran, rows } = await periksaInvariantServer(perangkat);

    assert.deepEqual(pelanggaran, [], `seed=${seed}\n${pelanggaran.join('\n')}`);

    // Penjaga terhadap test yang lolos karena tidak melakukan apa-apa.
    const dibuat = perangkat.reduce((n, p) => n + p.dibuat.length, 0);
    assert.ok(dibuat >= 10, `terlalu sedikit order dibuat: ${dibuat}`);
    assert.ok(rows.length >= 10, `terlalu sedikit order sampai: ${rows.length}`);
  });
}

// I7 -- immutabilitas, diperiksa terhadap baris database sungguhan.
//
// Dibandingkan ke SNAPSHOT saat order pertama kali terlihat, bukan ke nilai
// sekarang. Membandingkan baris dengan dirinya sendiri tidak akan pernah
// melihat mutasi -- itu persis kenapa `void_as_update` lolos I1-I5 di
// prototipe.
test('order tidak berubah setelah tulis pertama, walau request diulang', async () => {
  const rng = createRng(99);
  const p = await siapkanPerangkat('K1', 'imut');

  const item = p.jual(20000);
  const pertama = await coba(item, rng, { andal: true });
  assert.ok(pertama === 201, `gagal menulis: ${pertama}`);

  const sebelum = await query('SELECT * FROM "order" WHERE id = $1', [item.orderId]);
  assert.equal(sebelum.length, 1);

  // Kirim ulang berkali-kali dengan key yang SAMA -- persis yang dilakukan
  // klien yang kehilangan respons.
  for (let i = 0; i < 5; i += 1) {
    const res = await kirim('/orders', item.payload, { 'idempotency-key': item.key });
    assert.ok(res.statusCode === 201 || res.statusCode === 409, res.body);
  }

  const sesudah = await query('SELECT * FROM "order" WHERE id = $1', [item.orderId]);
  assert.deepEqual(sesudah, sebelum, 'satu kolom pun tidak boleh berubah');

  const jumlah = await query('SELECT COUNT(*)::int AS n FROM "order"');
  assert.equal(jumlah[0].n, 1, 'retry tidak boleh menghasilkan order kedua');
});

// I8 -- satu order, satu key. Diperiksa langsung di tabel idempotency_key.
test('retry dengan key yang sama tidak menumbuhkan tabel idempotency', async () => {
  const rng = createRng(7);
  const p = await siapkanPerangkat('K1', 'idem');
  const item = p.jual(20000);

  await coba(item, rng, { andal: true });
  for (let i = 0; i < 4; i += 1) {
    await kirim('/orders', item.payload, { 'idempotency-key': item.key });
  }

  const keys = await query('SELECT COUNT(*)::int AS n FROM idempotency_key');
  assert.equal(keys[0].n, 1, 'lima percobaan, satu key');
});

// Key BARU untuk order yang sama adalah cacat `regen_idem_on_retry`. Yang
// menyelamatkan datanya adalah primary key order (ULID client-generated) --
// jaring pengaman KEDUA, dan test ini membuktikan ia masih ada.
test('key BARU untuk order yang sama ditolak PK order, bukan oleh idempotency', async () => {
  const rng = createRng(11);
  const p = await siapkanPerangkat('K1', 'regen');
  const item = p.jual(20000);

  await coba(item, rng, { andal: true });
  const res = await kirim('/orders', item.payload, { 'idempotency-key': `${item.key}-BARU` });

  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'ID_ALREADY_EXISTS');

  const jumlah = await query('SELECT COUNT(*)::int AS n FROM "order"');
  assert.equal(jumlah[0].n, 1, 'ULID client-generated mencegah duplikasi');

  // Dan tabel idempotency TIDAK membengkak.
  //
  // Ini alasan kenapa I8 tidak dapat menyala terhadap server ini: klaim key
  // yang gagal ikut ter-ROLLBACK bersama transaksinya, jadi key kedua tidak
  // pernah tersimpan. Cacat `regen_idem_on_retry` yang membengkakkan tabel di
  // prototipe karena itu tidak berlaku di sini -- tapi itu properti yang harus
  // DIPAKU, bukan diasumsikan: kalau suatu hari key diselesaikan di luar
  // transaksi order, angka di bawah berubah dan seseorang perlu tahu.
  const keys = await query('SELECT COUNT(*)::int AS n FROM idempotency_key');
  assert.equal(keys[0].n, 1, 'klaim yang gagal ter-rollback, tidak menumpuk');

  // Penghitung di atas harus terbukti BISA naik. Tanpa ini, angka 1 mungkin
  // datang dari query yang salah dan bukan dari perilaku yang benar.
  const lain = p.jual(20000);
  const res2 = await kirim('/orders', lain.payload, { 'idempotency-key': lain.key });
  assert.equal(res2.statusCode, 201, res2.body);
  const keys2 = await query('SELECT COUNT(*)::int AS n FROM idempotency_key');
  assert.equal(keys2[0].n, 2, 'order yang benar-benar baru MENAMBAH satu key');
});
