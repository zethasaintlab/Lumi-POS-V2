'use strict';

// ⛔ QRIS statis dan EDC yang dibuat OFFLINE, lewat transport relay yang SAMA.
//
// Aturan yang lahir 21 Agustus 2026 (`CLAUDE.md`, "Transport perangkat diuji
// SEBAGAI transport"): setiap operasi yang perangkat kirim lewat outbox wajib
// punya satu test yang memakai `buatPengirimHttp` dan `klasifikasi` yang
// ASLI, dengan hanya `fetch` yang dipalsukan.
//
// Alasannya di sini persis sama dengan pada refund: muatan pembayaran disusun
// `simpanPenjualan` dan dikirim `buatPengirimHttp`, dan yang membuktikan
// keduanya cocok dengan server BUKAN test yang menuliskan muatannya sendiri.
// QRIS statis menuntut `reference`; EDC menuntut `approvalCode`. Muatan yang
// melewatkan salah satunya dijawab `400` → `gagal-permanen`, dan berhenti di
// antrean SELAMANYA — sementara pelanggan sudah membayar.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

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
  base = await seedTenantBase(appSetup, { suffix: 'RelayBayar' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

/** Order OPEN yang belum dibayar — persis keadaan sebelum relay pembayaran. */
async function orderTerbuka(seq) {
  const deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${seq}` }))
      .statusCode,
    201
  );
  const shiftId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId,
      businessDate: '2026-08-22', openingFloat: 100000,
    })).statusCode,
    201
  );
  const variationId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(), name: `Kopi ${seq}`,
      variations: [{ id: variationId, price: 20000 }],
    })).statusCode,
    201
  );
  const orderId = crypto.randomUUID();
  const o = await req('POST', '/orders', {
    id: orderId, outletId: base.outlet.id, deviceId, shiftId,
    receiptNumber: `K${seq}-20260822-000${seq}`,
    businessDate: '2026-08-22', sequence: seq, channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(o.statusCode, 201, o.body);
  return { orderId, total: o.json().total };
}

/** `fetch` yang meneruskan ke server sungguhan, apa adanya. */
function relay() {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async (url, opts) => {
      const res = await app.inject({
        method: opts.method,
        url: new URL(url).pathname,
        payload: opts.body,
        headers: opts.headers,
      });
      return {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        async json() {
          return res.json();
        },
      };
    },
  });
}

function barisOutbox(orderId, payload) {
  return {
    id: crypto.randomUUID(),
    entity_type: 'payment',
    entity_id: orderId,
    operation: 'create',
    payload: JSON.stringify(payload),
    idempotency_key: payload.id,
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
    approver_id: null,
  };
}

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

/**
 * Muatan yang benar-benar disusun `simpanPenjualan` — bukan yang ditulis
 * tangan di sini. Itu seluruh gunanya test ini.
 */
async function muatanDariPerangkat(pembayaran, orderId, amountDue) {
  const { simpanPenjualan } = await import('../../apps/kasir/src/kasir/penjualan.ts');
  const tulis = [];
  const db = {
    async getAll(sql) {
      if (/FROM outlet/.test(sql)) {
        return [{
          name: 'Outlet', timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00',
          rounding_increment: 100, rounding_mode: 'half_up', service_charge_rate: 0,
          discount_threshold_percent: null, discount_threshold_amount: null,
        }];
      }
      if (/FROM device_config/.test(sql)) return [{ receipt_sequence: 0, sequence_business_date: null }];
      return [];
    },
    async execute(sql, params = []) {
      tulis.push({ sql, params });
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };

  await simpanPenjualan({
    db,
    konfig: { deviceId: 'd1', deviceCode: 'K9', tenantId: tenant.id, outletId: base.outlet.id },
    sesi: { userId: base.user.id, nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false },
    shift: { id: 's1', businessDate: '2026-08-22', openingFloat: 0 },
    keranjang: {
      baris: [{
        id: crypto.randomUUID(), variationId: 'v1', itemName: 'Kopi',
        variationName: 'Regular', unitPrice: Number(amountDue), quantityMilli: 1000, modifier: [],
      }],
      diskon: null,
    },
    pembayaran,
    waktu: () => new Date('2026-08-22T07:00:00Z'),
    idBaru: () => crypto.randomUUID(),
    hlc: () => 1n,
  });

  const outbox = tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  const bayar = outbox.filter((t) => t.params.includes('payment'));
  // ⛔ URUTANNYA dipertahankan. Pada pembayaran campuran, server menghitung
  // nominal tunai dari `total − SUM(confirmed)` lalu MEMBULATKANNYA: bagian
  // tunai yang mendarat lebih dulu membuat server membulatkan seluruh total
  // dan menagih lebih, lalu bagian QRIS berikutnya ditolak sebagai kelebihan
  // bayar non-tunai. Test yang menyusun ulang urutannya sendiri tidak dapat
  // menangkap itu.
  return bayar.map((t) => {
    const muatan = JSON.parse(t.params.find((p) => typeof p === 'string' && p.startsWith('{')));
    // Order-nya sudah ada di server lewat jalur di atas; hanya muatannya yang
    // dipinjam dari perangkat.
    return { ...muatan, id: crypto.randomUUID(), orderId };
  });
}

// ---------------------------------------------------------------------------

test('⛔ QRIS statis dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(1);
  const [muatan] = await muatanDariPerangkat(
    { metode: 'qris_static', referensi: '22000 · ref 4821' },
    orderId,
    total
  );

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(
    klasifikasi(hasil),
    'terkirim',
    `pembayaran QRIS berhenti di antrean: ${hasil.status} ${JSON.stringify(hasil.body ?? {})}`
  );

  const { rows } = await kueriTenant(
    `SELECT method, confirmed_manually, provider_reference, tendered_amount
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'qris_static');
  // FR-G5 memakainya: tidak ada SISTEM yang memverifikasi pembayaran ini.
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].provider_reference, '22000 · ref 4821');
  assert.equal(rows[0].tendered_amount, null);
});

test('⛔ EDC dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(2);
  const [muatan] = await muatanDariPerangkat(
    { metode: 'card_edc', approvalCode: 'A12345', cardLast4: '4821' },
    orderId,
    total
  );

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(klasifikasi(hasil), 'terkirim', `${hasil.status}`);

  const { rows } = await kueriTenant(
    `SELECT method, approval_code, card_last4, confirmed_manually
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows[0].method, 'card_edc');
  assert.equal(rows[0].approval_code, 'A12345');
  assert.equal(rows[0].card_last4, '4821');
  // EDC punya bukti dari acquirer; `confirmed_manually` khusus QRIS statis.
  assert.equal(rows[0].confirmed_manually, false);
});

test('⛔ QRIS statis TIDAK menghasilkan cash_movement di server', async () => {
  const { orderId, total } = await orderTerbuka(3);
  const [muatan] = await muatanDariPerangkat(
    { metode: 'qris_static', referensi: 'ref 4821' },
    orderId,
    total
  );
  assert.equal(klasifikasi(await relay()(barisOutbox(orderId, muatan))), 'terkirim');

  // Perangkat juga tidak menulisnya secara lokal; kalau salah satu sisi
  // menulis dan sisi lain tidak, saldo laci merchant dan saldo laci server
  // berpisah tanpa satu pun error.
  const { rows } = await kueriTenant(
    `SELECT count(*)::int AS n FROM cash_movement WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows[0].n, 0);
});

test('⛔ pembayaran CAMPURAN mendarat utuh, dan urutannya yang membuatnya bisa', async () => {
  const { orderId, total } = await orderTerbuka(4);
  // QRIS 10.000, sisanya tunai. Tarif pajak tidak di-seed di suite ini, jadi
  // totalnya persis harga item — yang diperiksa perbandingannya, bukan
  // angkanya, supaya test ini tidak ikut pecah saat seed berubah.
  const muatan = await muatanDariPerangkat(
    [
      { metode: 'cash', tendered: 20000 },
      { metode: 'qris_static', referensi: 'ref 4821', nominal: 10_000n },
    ],
    orderId,
    total
  );

  assert.equal(muatan.length, 2);
  // Perangkat menyusun ulang sendiri: tunai TERAKHIR.
  assert.equal(muatan[0].method, 'qris_static');
  assert.equal(muatan[1].method, 'cash');

  for (const m of muatan) {
    const hasil = await relay()(barisOutbox(orderId, m));
    assert.equal(
      klasifikasi(hasil),
      'terkirim',
      `bagian ${m.method} berhenti di antrean: ${hasil.status}`
    );
  }

  const { rows } = await kueriTenant(
    `SELECT method, amount FROM payment WHERE order_id = $1 ORDER BY method`,
    [orderId]
  );
  assert.equal(rows.length, 2, 'pembayaran campuran tidak mendarat utuh');

  const { rows: ord } = await kueriTenant(
    `SELECT status FROM "order" WHERE id = $1`,
    [orderId]
  );
  // Order berpindah ke CLOSED hanya ketika SUM(payment confirmed) menutupinya
  // (`spec-c:223`).
  assert.equal(ord[0].status, 'closed', 'order tidak tertutup oleh dua payment');

  // Laci hanya menerima bagian tunainya.
  const { rows: kas } = await kueriTenant(
    `SELECT delta FROM cash_movement WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(kas.length, 1);
  assert.equal(
    Number(kas[0].delta),
    Number(total) - 10000,
    'laci menerima nominal non-tunai juga'
  );
});

test('⛔ SABOTASE: tunai yang mendarat lebih dulu MENOLAK bagian berikutnya', async () => {
  const { orderId, total } = await orderTerbuka(5);
  const muatan = await muatanDariPerangkat(
    [
      { metode: 'cash', tendered: 20000 },
      { metode: 'qris_static', referensi: 'ref 4821', nominal: 10_000n },
    ],
    orderId,
    total
  );

  // Urutan yang perangkat susun sengaja DIBALIK di sini. Ini yang membuat
  // aturan "tunai terakhir" bukan sekadar kerapian: server menghitung nominal
  // tunai dari sisa yang belum terbayar, jadi tunai yang datang pertama
  // menagih SELURUH total dan menutup ordernya.
  const dibalik = [...muatan].reverse();
  assert.equal(klasifikasi(await relay()(barisOutbox(orderId, dibalik[0]))), 'terkirim');

  const hasil = await relay()(barisOutbox(orderId, dibalik[1]));
  assert.notEqual(
    klasifikasi(hasil),
    'terkirim',
    'bagian kedua diterima padahal ordernya sudah tertutup oleh bagian pertama'
  );

  // Dan uangnya berpisah: laci menerima seluruh total, sementara pelanggan
  // membayar sebagian lewat QRIS.
  const { rows } = await kueriTenant(
    `SELECT delta FROM cash_movement WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(Number(rows[0].delta), Number(total));
});

// ---------------------------------------------------------------------------
// Transfer -- `other` + `bank_transfer` lewat transport relay yang SAMA
// (G-TRF-RELAY, PR 2B Task 7, keputusan user P1/P2)
// ---------------------------------------------------------------------------

const TRANSFER = { metode: 'other', provider: 'bank_transfer', referensi: 'TRF-8891', bank: 'BCA' };

/** `fetch` yang sampai ke server TETAPI jawabannya hilang: pengirim melihat jaringan putus. */
function relayResponsHilang() {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async (url, opts) => {
      await app.inject({
        method: opts.method,
        url: new URL(url).pathname,
        payload: opts.body,
        headers: opts.headers,
      });
      throw new Error('jaringan putus sebelum jawaban dibaca');
    },
  });
}

test('⛔ G-TRF-RELAY: transfer dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(6);
  const [muatan] = await muatanDariPerangkat(TRANSFER, orderId, total);

  assert.equal(muatan.method, 'other');
  assert.equal(muatan.provider, 'bank_transfer');
  assert.equal(muatan.reference, 'TRF-8891');
  assert.equal(muatan.tenderedAmount, undefined, 'tenderedAmount ikut terkirim untuk transfer');

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(
    klasifikasi(hasil),
    'terkirim',
    `pembayaran transfer berhenti di antrean: ${hasil.status} ${hasil.code} ${hasil.pesan}`
  );

  const { rows } = await kueriTenant(
    `SELECT method, provider, provider_reference, acquirer, confirmed_manually, tendered_amount
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'other');
  assert.equal(rows[0].provider, 'bank_transfer');
  assert.equal(rows[0].provider_reference, 'TRF-8891');
  assert.equal(rows[0].acquirer, 'BCA');
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].tendered_amount, null);

  const { rows: kas } = await kueriTenant(`SELECT count(*)::int AS n FROM cash_movement WHERE order_id = $1`, [orderId]);
  assert.equal(kas[0].n, 0, 'transfer menulis cash_movement di server');
});

test('⛔ G-TRF-RELAY: transfer + tunai -- bagian tunai dikirim TERAKHIR lewat depends_on dan keduanya mendarat', async () => {
  const { orderId, total } = await orderTerbuka(7);
  const muatan = await muatanDariPerangkat(
    [{ metode: 'cash', tendered: 20000 }, { ...TRANSFER, nominal: 8_000n }],
    orderId,
    total
  );
  assert.equal(muatan.length, 2);
  assert.equal(muatan[0].method, 'other', 'transfer harus dikirim SEBELUM tunai');
  assert.equal(muatan[1].method, 'cash');

  for (const m of muatan) {
    const hasil = await relay()(barisOutbox(orderId, m));
    assert.equal(klasifikasi(hasil), 'terkirim', `bagian ${m.method} berhenti: ${hasil.status} ${hasil.pesan}`);
  }

  const { rows } = await kueriTenant(
    `SELECT method, provider, amount FROM payment WHERE order_id = $1 ORDER BY method`,
    [orderId]
  );
  assert.equal(rows.length, 2, 'satu baris payment per bagian');
  assert.deepEqual(rows.map((r) => r.method).sort(), ['cash', 'other']);
  const { rows: ord } = await kueriTenant(`SELECT status FROM "order" WHERE id = $1`, [orderId]);
  assert.equal(ord[0].status, 'closed');
  const { rows: kas } = await kueriTenant(`SELECT delta FROM cash_movement WHERE order_id = $1`, [orderId]);
  assert.equal(kas.length, 1);
  assert.equal(Number(kas[0].delta), Number(total) - 8000, 'laci menerima bagian transfer');
});

test('⛔ G-TRF-RELAY: retry berulang DAN respons hilang tidak menghasilkan baris ganda', async () => {
  const { orderId, total } = await orderTerbuka(8);
  // Bagian transfer SAJA dikirim (order tetap terbuka): pada order yang
  // langsung lunas, kiriman kedua akan ditolak `ORDER_NOT_PAYABLE` dan baris
  // ganda tidak mungkin terbentuk -- test yang hijau karena alasan yang salah.
  // `payment` PK-nya `(id, occurred_at)`, jadi tanpa idempotensi retry MEMBUAT baris kedua.
  const muatanCampur = await muatanDariPerangkat(
    [{ metode: 'cash', tendered: 20000 }, { ...TRANSFER, nominal: 8_000n }],
    orderId,
    total
  );
  const muatan = muatanCampur[0];
  assert.equal(muatan.method, 'other');
  const baris = barisOutbox(orderId, muatan); // idempotency_key SAMA di ketiga kiriman

  // 1) Sampai ke server, jawabannya hilang.
  const hilang = await relayResponsHilang()(baris);
  assert.equal(klasifikasi(hilang), 'coba-lagi', 'respons hilang harus diulang, bukan gagal-permanen');
  // 2) Dan 3) Diulang: menerima jawaban dari cache.
  const ulang1 = await relay()(baris);
  const ulang2 = await relay()(baris);
  assert.equal(klasifikasi(ulang1), 'terkirim', `${ulang1.status} ${ulang1.pesan}`);
  assert.equal(klasifikasi(ulang2), 'terkirim', `${ulang2.status} ${ulang2.pesan}`);

  const { rows } = await kueriTenant(`SELECT id FROM payment WHERE order_id = $1`, [orderId]);
  assert.equal(rows.length, 1, `retry menghasilkan ${rows.length} baris payment, seharusnya 1`);
  const { rows: ev } = await kueriTenant(
    `SELECT id FROM outbox WHERE event_type = 'payment.recorded' AND aggregate_id = $1`,
    [muatan.id]
  );
  assert.equal(ev.length, 1, `event payment.recorded terbit ${ev.length}×, seharusnya 1`);
  const { rows: kunci } = await kueriTenant(`SELECT key FROM idempotency_key WHERE key = $1`, [muatan.id]);
  assert.equal(kunci.length, 1);
});

test('⛔ G-TRF-RELAY: perangkat mati di tengah -- penjualan bertransfer tersimpan lokal, terkirim setelah hidup lagi', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { buatDbBerkas } = require('../sync-client/helpers/db.js');
  const { kirimBatch, pulihkanSetelahMati } = require('../../packages/sync-client/src/relay.ts');
  const { simpanPenjualan } = await import('../../apps/kasir/src/kasir/penjualan.ts');

  // Server: perangkat, shift, dan katalog yang SAMA dengan yang perangkat pakai.
  const deviceId = crypto.randomUUID();
  const shiftId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  assert.equal((await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: 'K1' })).statusCode, 201);
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId, businessDate: '2026-08-22', openingFloat: 100000,
    })).statusCode,
    201
  );
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(), name: 'Kopi Mati', variations: [{ id: variationId, price: 20000 }],
    })).statusCode,
    201
  );

  const berkas = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trf-mati-')), 'lokal.sqlite');
  let db = buatDbBerkas(berkas);
  await db.execute(
    `INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at, rounding_increment, rounding_mode, service_charge_rate)
     VALUES ($o, $t, 'Outlet', 'Asia/Jakarta', '04:00:00', 100, 'half_up', 0)`.replace('$o', `'${base.outlet.id}'`).replace('$t', `'${tenant.id}'`)
  );
  await db.execute(
    `INSERT INTO device_config (id, device_id, device_code, tenant_id, outlet_id, base_url, receipt_sequence)
     VALUES (1, ?, 'K1', ?, ?, 'http://server', 0)`,
    [deviceId, tenant.id, base.outlet.id]
  );

  const hasil = await simpanPenjualan({
    db,
    konfig: { deviceId, deviceCode: 'K1', tenantId: tenant.id, outletId: base.outlet.id },
    sesi: { userId: base.user.id, nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false },
    shift: { id: shiftId, businessDate: '2026-08-22', openingFloat: 100000 },
    keranjang: {
      baris: [{
        id: crypto.randomUUID(), variationId, itemName: 'Kopi Mati', variationName: 'Regular',
        unitPrice: 20000, quantityMilli: 1000, modifier: [],
      }],
      diskon: null,
    },
    pembayaran: TRANSFER,
    waktu: () => new Date('2026-08-22T07:00:00Z'),
    idBaru: () => crypto.randomUUID(),
    hlc: () => 1n,
  });
  assert.equal(hasil.status, 'tersimpan', hasil.status);

  // PERANGKAT MATI: pengirim tidak pernah berjalan; berkas ditutup di tempat.
  db.tutup();
  const { rows: sebelum } = await kueriTenant(`SELECT id FROM "order" WHERE id = $1`, [hasil.orderId]);
  assert.equal(sebelum.length, 0, 'server sudah menerima sesuatu padahal pengirim tidak pernah berjalan');

  // PERANGKAT HIDUP LAGI: berkas yang sama dibuka, pengirim BARU berjalan.
  db = buatDbBerkas(berkas);
  const lokal = await db.getAll(`SELECT status FROM outbox_local ORDER BY rowid`);
  assert.deepEqual(lokal.map((r) => r.status), ['pending', 'pending'], 'penjualan tidak bertahan melewati restart');
  await pulihkanSetelahMati(db);
  // Penjadwal menjalankan putaran berulang. Order dan payment berbagi
  // `created_at`, jadi payment bisa terpilih lebih dulu dan DITUNDA satu
  // putaran (bukan gagal) -- karena itu bukan satu putaran yang diperiksa.
  let terkirim = 0;
  for (let i = 0; i < 3 && terkirim < 2; i += 1) {
    const putaran = await kirimBatch({ db, now: () => Date.now(), kirim: relay() });
    assert.equal(putaran.gagalPermanen, 0, `antrean berhenti permanen: ${JSON.stringify(putaran)}`);
    terkirim += putaran.terkirim;
  }
  assert.equal(terkirim, 2, 'order + payment harus terkirim setelah perangkat hidup lagi');

  const { rows: ord } = await kueriTenant(`SELECT status FROM "order" WHERE id = $1`, [hasil.orderId]);
  assert.equal(ord[0]?.status, 'closed', 'order bertransfer tidak tertutup di server');
  const { rows: bayar } = await kueriTenant(
    `SELECT method, provider, provider_reference, confirmed_manually FROM payment WHERE order_id = $1`,
    [hasil.orderId]
  );
  assert.equal(bayar.length, 1);
  assert.equal(bayar[0].provider, 'bank_transfer');
  assert.equal(bayar[0].provider_reference, 'TRF-8891');
  assert.equal(bayar[0].confirmed_manually, true);
  db.tutup();
});
