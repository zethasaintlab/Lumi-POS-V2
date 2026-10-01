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
// Transfer bank (`other` + `bank_transfer`) — G-TRF-RELAY
// ---------------------------------------------------------------------------

test('⛔ transfer dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(6);
  const [muatan] = await muatanDariPerangkat(
    { metode: 'other', provider: 'bank_transfer', referensi: 'TRF-0042', bank: 'BCA' },
    orderId,
    total
  );
  assert.equal(muatan.method, 'other');
  assert.equal(muatan.provider, 'bank_transfer');

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(
    klasifikasi(hasil),
    'terkirim',
    `transfer berhenti di antrean: ${hasil.status} ${JSON.stringify(hasil.body ?? {})}`
  );

  const { rows } = await kueriTenant(
    `SELECT method, provider, provider_reference, acquirer, confirmed_manually, tendered_amount
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'other');
  assert.equal(rows[0].provider, 'bank_transfer');
  assert.equal(rows[0].provider_reference, 'TRF-0042');
  assert.equal(rows[0].acquirer, 'BCA');
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].tendered_amount, null);
  const { rows: ord } = await kueriTenant(`SELECT status FROM "order" WHERE id = $1`, [orderId]);
  assert.equal(ord[0].status, 'closed');
});

test('⛔ transfer + tunai: bagian tunai dikirim TERAKHIR lewat depends_on dan keduanya mendarat', async () => {
  const { orderId, total } = await orderTerbuka(7);
  const muatan = await muatanDariPerangkat(
    [
      { metode: 'cash', tendered: 20000 },
      { metode: 'other', provider: 'bank_transfer', referensi: 'TRF-0007', nominal: 10_000n },
    ],
    orderId,
    total
  );
  assert.equal(muatan.length, 2);
  assert.equal(muatan[0].method, 'other', 'transfer harus lebih dulu');
  assert.equal(muatan[1].method, 'cash', 'tunai harus TERAKHIR');

  for (const m of muatan) {
    const hasil = await relay()(barisOutbox(orderId, m));
    assert.equal(klasifikasi(hasil), 'terkirim', `bagian ${m.method} berhenti: ${hasil.status}`);
  }

  const { rows } = await kueriTenant(
    `SELECT method, provider, amount FROM payment WHERE order_id = $1 ORDER BY method`,
    [orderId]
  );
  assert.equal(rows.length, 2, 'transfer + tunai tidak mendarat utuh');
  const { rows: ord } = await kueriTenant(`SELECT status FROM "order" WHERE id = $1`, [orderId]);
  assert.equal(ord[0].status, 'closed');
  const { rows: kas } = await kueriTenant(
    `SELECT delta FROM cash_movement WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(kas.length, 1);
  assert.equal(Number(kas[0].delta), Number(total) - 10000, 'laci hanya menerima bagian tunai');
});

test('⛔ retry berulang DAN respons hilang tidak menghasilkan baris ganda', async () => {
  const { orderId, total } = await orderTerbuka(8);
  const [muatan] = await muatanDariPerangkat(
    { metode: 'other', provider: 'bank_transfer', referensi: 'TRF-0008' },
    orderId,
    total
  );
  const baris = barisOutbox(orderId, muatan);

  // Kiriman pertama mendarat, tetapi responsnya DIBUANG sebelum dibaca:
  // perangkat tidak tahu bahwa ia sudah berhasil dan mengirim ulang.
  const hilang = buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async (url, opts) => {
      await app.inject({
        method: opts.method, url: new URL(url).pathname, payload: opts.body, headers: opts.headers,
      });
      throw new TypeError('fetch failed');
    },
  });
  const h1 = await hilang(baris);
  assert.notEqual(klasifikasi(h1), 'terkirim', 'respons yang hilang dianggap terkirim');

  assert.equal(klasifikasi(await relay()(baris)), 'terkirim');
  assert.equal(klasifikasi(await relay()(baris)), 'terkirim');

  const { rows } = await kueriTenant(`SELECT id FROM payment WHERE order_id = $1`, [orderId]);
  assert.equal(rows.length, 1, `retry menghasilkan ${rows.length} baris payment`);
  const { rows: ev } = await kueriTenant(
    `SELECT id FROM outbox WHERE event_type = 'payment.recorded' AND aggregate_id = $1`,
    [rows[0].id]
  );
  assert.equal(ev.length, 1, `retry menghasilkan ${ev.length} event payment.recorded`);
});

test('⛔ perangkat mati di tengah: penjualan bertransfer tersimpan di disk lokal lalu terkirim oleh pengirim BARU', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const { buatDbBerkas } = require('../sync-client/helpers/db');
  const { kirimBatch } = await import('../../packages/sync-client/src/relay.ts');
  const { orderId, total } = await orderTerbuka(9);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-mati-'));
  const berkas = path.join(dir, 'lokal.db');
  try {
    // 1. Perangkat menyimpan penjualan; outbox_local ditulis ke DISK.
    const disk = buatDbBerkas(berkas);
    const lokal = {
      ...disk,
      async getAll(sql, params) {
        if (/FROM outlet/.test(sql)) {
          return [{
            name: 'Outlet', timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00',
            rounding_increment: 100, rounding_mode: 'half_up', service_charge_rate: 0,
            discount_threshold_percent: null, discount_threshold_amount: null,
          }];
        }
        if (/FROM device_config/.test(sql)) return [{ receipt_sequence: 0, sequence_business_date: null }];
        if (/FROM outbox_local/.test(sql)) return disk.getAll(sql, params);
        return [];
      },
      // Hanya outbox_local yang diteruskan ke disk; tabel lain bukan objek uji.
      async execute(sql, params = []) {
        if (/outbox_local/.test(sql)) await disk.execute(sql, params);
      },
      async transaction(fn) { return fn(lokal); },
    };
    const { simpanPenjualan } = await import('../../apps/kasir/src/kasir/penjualan.ts');
    const hasilSimpan = await simpanPenjualan({
      db: lokal,
      konfig: { deviceId: 'd1', deviceCode: 'K9', tenantId: tenant.id, outletId: base.outlet.id },
      sesi: { userId: base.user.id, nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false },
      shift: { id: 's1', businessDate: '2026-08-22', openingFloat: 0 },
      keranjang: {
        baris: [{
          id: crypto.randomUUID(), variationId: 'v1', itemName: 'Kopi', variationName: 'Regular',
          unitPrice: Number(total), quantityMilli: 1000, modifier: [],
        }],
        diskon: null,
      },
      pembayaran: { metode: 'other', provider: 'bank_transfer', referensi: 'TRF-0009' },
      waktu: () => new Date('2026-08-22T07:00:00Z'),
      idBaru: () => crypto.randomUUID(),
      hlc: () => 1n,
    });
    assert.equal(hasilSimpan.status, 'tersimpan');
    // Order-nya sudah ada di server lewat API; hanya milik pembayaran yang dipinjam.
    const [antre] = await disk.getAll(
      `SELECT id, payload FROM outbox_local WHERE entity_type = 'payment'`
    );
    assert.ok(antre, 'penjualan tersimpan tetapi tidak ada payment di outbox_local');
    const muatan = { ...JSON.parse(antre.payload), orderId };
    await disk.execute(`UPDATE outbox_local SET payload = ?, entity_id = ? WHERE id = ?`, [
      JSON.stringify(muatan), orderId, antre.id,
    ]);
    // ⛔ Order lokal memakai device/shift palsu dan DITOLAK server; yang ada di server
    // adalah order dari API. Baris order dibuang dan dependensinya dilepas supaya
    // hasilnya tidak bergantung pada urutan acak (created_at sama, id UUID acak).
    await disk.execute(`DELETE FROM outbox_local WHERE entity_type <> 'payment'`, []);
    await disk.execute(`UPDATE outbox_local SET depends_on = NULL WHERE id = ?`, [antre.id]);

    // 2. Proses mati sebelum satu byte pun terkirim: pengirim dibuang, koneksi ditutup.
    disk.tutup();
    const { rows: sebelum } = await kueriTenant(`SELECT id FROM payment WHERE order_id = $1`, [orderId]);
    assert.equal(sebelum.length, 0, 'belum ada yang boleh mendarat sebelum pengirim hidup');

    // 3. Proses BARU membuka berkas yang sama dan mengirim apa yang dibacanya.
    const hidup = buatDbBerkas(berkas);
    const kirim = relay();
    const hasil = await kirimBatch({ db: hidup, now: () => Date.now(), kirim });
    assert.equal(hasil.terkirim, 1, `pengirim baru tidak membaca outbox lokal: ${JSON.stringify(hasil)}`);
    const { rows } = await kueriTenant(`SELECT method, provider FROM payment WHERE order_id = $1`, [orderId]);
    assert.equal(rows.length, 1, `mendarat ${rows.length} kali, bukan tepat satu`);
    assert.equal(rows[0].method, 'other');
    assert.equal(rows[0].provider, 'bank_transfer');
    const [akhir] = await hidup.getAll(`SELECT status FROM outbox_local WHERE id = ?`, [antre.id]);
    assert.equal(akhir.status, 'sent');
    hidup.tutup();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
