'use strict';

// Task 12 — Pesanan tahan: `keranjang_tahan` MURNI LOKAL. G-TAHAN dan
// G-BATAL-AUDIT (buang) sisi perangkat.
//
// ⛔ Di atas SQLite sungguhan (`node:sqlite`): "perangkat mati di tengah
// tahan/lanjutkan/buang" hanya bermakna bila ROLLBACK-nya sungguhan. DDL
// `keranjang_tahan` DIBACA dari `db/local/001-initial.sql`, bukan diketik ulang,
// supaya tabel yang tidak ada di skema produksi membuat berkas ini merah.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/keranjang-tahan.ts';
const SKEMA = '../../apps/kasir/src/lokal/skema.ts';
const SQL_LOKAL = fs.readFileSync(path.resolve(__dirname, '../../db/local/001-initial.sql'), 'utf8');

function ddlTahan() {
  const m = /CREATE TABLE keranjang_tahan \([\s\S]*?\);/.exec(SQL_LOKAL);
  assert.ok(m, 'db/local/001-initial.sql tidak memuat CREATE TABLE keranjang_tahan');
  return m[0];
}

const DDL = `
CREATE TABLE keranjang_lokal (
  id TEXT PRIMARY KEY NOT NULL, shift_id TEXT NOT NULL, isi TEXT NOT NULL, diperbarui_pada TEXT NOT NULL
);
CREATE TABLE cash_drawer_shift (id TEXT PRIMARY KEY, outlet_id TEXT, device_id TEXT, status TEXT);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT, device_id TEXT,
  actor_user_id TEXT NOT NULL, approver_user_id TEXT,
  event_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  before TEXT, after TEXT, reason_code TEXT, reason_note TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE outbox_local (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0,
  last_error TEXT, last_attempt_at TEXT, created_at TEXT NOT NULL,
  depends_on TEXT, actor_id TEXT, approver_id TEXT
);
CREATE TABLE device_config (id INTEGER PRIMARY KEY, hlc_teks TEXT, hlc_state INTEGER);
CREATE TABLE "order" (id TEXT PRIMARY KEY);
CREATE TABLE payment (id TEXT PRIMARY KEY);
CREATE TABLE cash_movement (id TEXT PRIMARY KEY);
CREATE TABLE draf_qris_lokal (id TEXT PRIMARY KEY, shift_id TEXT);
INSERT INTO device_config (id, hlc_teks, hlc_state) VALUES (1, '0', 0);
INSERT INTO cash_drawer_shift VALUES ('s1','o1','d1','open');
INSERT INTO cash_drawer_shift VALUES ('s2','o1','d1','open');
`;

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };

function buatDb({ gagalSetelAudit = false, gagalCommit = false } = {}) {
  // Kait kegagalan dapat dinyalakan SESUDAH prasyarat ditulis (`d.gagal`).
  const gagal = { setelAudit: gagalSetelAudit, commit: gagalCommit };
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  sqlite.exec(ddlTahan());
  // ⛔ `tx` BERBEDA dari `db`: penulisan lewat `db` sementara transaksi berjalan
  // dicatat di `bocor` — penjaga "satu transaksi" tidak boleh hijau untuk kode
  // yang menulis di luar transaksinya.
  const bocor = [];
  const baca = async (sql, params = []) => sqlite.prepare(sql).all(...params);
  const tx = {
    getAll: baca,
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      if (gagal.setelAudit && /INSERT INTO audit_event/.test(sql)) {
        throw new Error('perangkat mati di tengah transaksi');
      }
    },
    async transaction() {
      throw new Error('transaksi bersarang tidak didukung');
    },
  };
  let dalamTx = false;
  const api = {
    sqlite,
    bocor,
    gagal,
    getAll: baca,
    async execute(sql, params = []) {
      if (dalamTx) bocor.push(sql.replace(/\s+/g, ' ').trim());
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      sqlite.exec('BEGIN');
      dalamTx = true;
      try {
        const hasil = await fn(tx);
        if (gagal.commit) throw new Error('perangkat mati saat COMMIT');
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      } finally {
        dalamTx = false;
      }
    },
  };
  return api;
}

const n = (d, t) => d.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

function baris(over = {}) {
  return {
    id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
    variationCount: 1, unitPrice: 20000, quantityMilli: 1000, modifier: [], ...over,
  };
}

/** Keranjang yang memuat SETIAP bidang yang harus pulih identik. */
function keranjangLengkap() {
  return {
    baris: [
      baris({
        id: 'b1', unitPrice: 25000, quantityMilli: 2000,
        modifier: [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 3000 }],
      }),
      baris({ id: 'b2', variationId: 'v2', itemName: 'Roti', variationName: 'Coklat', unitPrice: 15000, quantityMilli: 500 }),
    ],
    diskon: {
      minta: { tipe: 'persen', nilai: 3000n },
      alasanKode: 'promo', alasanCatatan: 'tamu VIP',
      approverId: 'u-mgr', nominalDisetujui: 9_007_199_254_740_993n, // di atas 2^53: number akan salah
    },
    kanal: 'dine_in',
    dataPesanan: { namaPemesan: 'Budi', nomorMeja: 'A-07', catatan: 'tanpa gula' },
  };
}

const HARGA_SAMA = {
  variation: new Map([['v1', 25000], ['v2', 15000]]),
  modifier: new Map([['m1', 5000]]),
};
const WAKTU = () => new Date('2026-09-28T03:00:00Z');
let seq = 0;
const idBaru = () => `id-${++seq}`;

async function tahan(d, k, shiftId = 's1') {
  const { tahanKeranjang } = await import(MOD);
  return tahanKeranjang(d, shiftId, k, WAKTU, idBaru);
}

// ---------------------------------------------------------------------------

test('⛔ G-TAHAN: tahan → keranjang berjalan kosong; lanjutkan → keranjang pulih IDENTIK (bigint, diskon + nominalDisetujui, kanal, dataPesanan, modifier ber-qty)', async () => {
  const { lanjutkanTahanan, daftarTahanan } = await import(MOD);
  const d = buatDb();
  const k = keranjangLengkap();
  // Keranjang berjalan tersimpan di keranjang_lokal; tahan harus memindahkannya.
  const { simpanKeranjang } = await import('../../apps/kasir/src/kasir/keranjang-simpan.ts');
  await simpanKeranjang(d, 's1', k, WAKTU);
  assert.equal(n(d, 'keranjang_lokal'), 1);

  const h = await tahan(d, k);
  assert.equal(h.ok, true, `tahan ditolak: ${h.pesan}`);
  assert.equal(n(d, 'keranjang_lokal'), 0, 'keranjang berjalan TIDAK kosong sesudah tahan (keranjang_lokal tersisa) — boot berikutnya memulihkannya dan pesanan yang sama tersimpan dua kali');

  const daftar = await daftarTahanan(d, 's1');
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].id, h.id);
  assert.equal(typeof daftar[0].subtotal, 'bigint', 'subtotal daftar harus bigint');

  const hasil = await lanjutkanTahanan(d, h.id, HARGA_SAMA, WAKTU);
  assert.ok(hasil, 'lanjutkan menjawab null untuk tahanan yang ada');
  assert.equal(hasil.subtotalBerubah, false);
  assert.deepEqual(hasil.barisDibuang, []);
  assert.deepEqual(hasil.keranjang, k, 'keranjang yang dilanjutkan TIDAK identik dengan yang ditahan');
  assert.equal(typeof hasil.keranjang.diskon.nominalDisetujui, 'bigint');
  assert.equal(hasil.keranjang.diskon.nominalDisetujui, 9_007_199_254_740_993n, 'nominalDisetujui kehilangan presisi (bigint jadi number?)');
  assert.equal(n(d, 'keranjang_tahan'), 0, 'tahanan tidak dihapus sesudah dilanjutkan');
  // Keranjang yang dilanjutkan sudah durable di transaksi yang sama.
  assert.equal(n(d, 'keranjang_lokal'), 1, 'keranjang yang dilanjutkan tidak ditulis ke keranjang_lokal dalam transaksi yang sama (mati sesudahnya = pesanan hilang)');
});

test('⛔ tahan TIDAK menulis audit (belum ada yang dibatalkan) dan tidak menyentuh order/payment/cash_movement/draf QRIS', async () => {
  const d = buatDb();
  d.sqlite.exec(`INSERT INTO draf_qris_lokal VALUES ('kini','s1')`);
  const h = await tahan(d, keranjangLengkap());
  assert.equal(h.ok, true);
  assert.equal(n(d, 'audit_event'), 0, 'tahan menulis audit_event');
  assert.equal(n(d, 'outbox_local'), 0, 'tahan menulis outbox');
  assert.equal(n(d, 'draf_qris_lokal'), 1, 'tahan menyentuh draf QRIS dinamis');
  for (const t of ['"order"', 'payment', 'cash_movement']) assert.equal(n(d, t), 0, `tahan menulis ${t}`);
});

test('⛔ tahan menolak keranjang KOSONG dengan pesan', async () => {
  const d = buatDb();
  const h = await tahan(d, { ...keranjangLengkap(), baris: [] });
  assert.equal(h.ok, false);
  assert.match(h.pesan, /kosong/i);
  assert.equal(n(d, 'keranjang_tahan'), 0);
});

test('tahanan shift lain tidak terdaftar', async () => {
  const { daftarTahanan, jumlahTahanan } = await import(MOD);
  const d = buatDb();
  await tahan(d, keranjangLengkap(), 's2');
  assert.deepEqual(await daftarTahanan(d, 's1'), []);
  assert.equal(await jumlahTahanan(d, 's1'), 0);
  assert.equal(await jumlahTahanan(d, 's2'), 1);
});

test('⛔ tahanan ke-21 ditolak dengan pesan (MAKS_TAHANAN = 20)', async () => {
  const { MAKS_TAHANAN, jumlahTahanan } = await import(MOD);
  assert.equal(MAKS_TAHANAN, 20);
  const d = buatDb();
  for (let i = 0; i < MAKS_TAHANAN; i += 1) {
    const h = await tahan(d, keranjangLengkap());
    assert.equal(h.ok, true, `tahanan ke-${i + 1} ditolak: ${h.pesan}`);
  }
  const ke21 = await tahan(d, keranjangLengkap());
  assert.equal(ke21.ok, false, 'tahanan ke-21 DITERIMA');
  assert.match(ke21.pesan, /20/);
  assert.equal(await jumlahTahanan(d, 's1'), 20);
  // Shift lain punya batasnya sendiri.
  assert.equal((await tahan(d, keranjangLengkap(), 's2')).ok, true);
});

test('⛔ lanjutkan sesudah harga berubah: harga baru, subtotalBerubah true', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const h = await tahan(d, keranjangLengkap());
  const baru = { variation: new Map([['v1', 27000], ['v2', 15000]]), modifier: new Map([['m1', 6000]]) };
  const hasil = await lanjutkanTahanan(d, h.id, baru, WAKTU);
  assert.equal(hasil.subtotalBerubah, true, 'harga berubah tetapi subtotalBerubah false');
  assert.equal(hasil.keranjang.baris[0].unitPrice, 27000, 'harga variation tidak diresolusi ulang');
  assert.equal(hasil.keranjang.baris[0].modifier[0].harga, 6000, 'harga modifier tidak diresolusi ulang');
  assert.equal(hasil.keranjang.baris[0].modifier[0].qtyMilli, 3000, 'qty modifier hilang saat harga ulang');
  assert.equal(hasil.keranjang.baris[1].unitPrice, 15000);
  assert.deepEqual(hasil.barisDibuang, []);
});

test('variation yang diarsip dibuang dan namanya dilaporkan', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const h = await tahan(d, keranjangLengkap());
  const tanpaRoti = { variation: new Map([['v1', 25000]]), modifier: new Map([['m1', 5000]]) };
  const hasil = await lanjutkanTahanan(d, h.id, tanpaRoti, WAKTU);
  assert.equal(hasil.keranjang.baris.length, 1);
  assert.equal(hasil.keranjang.baris[0].id, 'b1');
  assert.equal(hasil.barisDibuang.length, 1);
  assert.match(hasil.barisDibuang[0], /Roti/, `nama baris yang dibuang tidak dilaporkan: ${JSON.stringify(hasil.barisDibuang)}`);
  assert.equal(hasil.subtotalBerubah, true);
});

test('⛔ diskon yang tumbuh melewati nominalDisetujui sesudah harga ulang → statusDiskon menuntut persetujuan baru', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  const { statusDiskon } = await import('../../apps/kasir/src/kasir/diskon.ts');
  const { subtotalKeranjang } = await import('../../apps/kasir/src/kasir/keranjang.ts');
  const { AMBANG_DISKON_BAWAAN: AMBANG } = await import('../../packages/domain/src/diskon.ts');
  const d = buatDb();
  // 30% dari subtotal saat tahan, disetujui manajer sebesar angka itu.
  const k = {
    baris: [baris({ unitPrice: 100000 })],
    diskon: {
      minta: { tipe: 'persen', nilai: 3000n }, alasanKode: 'promo', alasanCatatan: null,
      approverId: 'u-mgr', nominalDisetujui: 30000n,
    },
    kanal: 'takeaway',
    dataPesanan: { namaPemesan: null, nomorMeja: null, catatan: null },
  };
  const h = await tahan(d, k);
  const sebelum = statusDiskon(subtotalKeranjang(k), k.diskon, AMBANG);
  assert.equal(sebelum.perluPersetujuan, false, 'prasyarat: persetujuan awal menutup potongannya');

  const hasil = await lanjutkanTahanan(d, h.id, { variation: new Map([['v1', 200000]]), modifier: new Map() }, WAKTU);
  assert.equal(hasil.keranjang.diskon.nominalDisetujui, 30000n, 'nominalDisetujui ikut berubah mengikuti harga baru (persetujuan yang tumbuh diam-diam)');
  const sesudah = statusDiskon(subtotalKeranjang(hasil.keranjang), hasil.keranjang.diskon, AMBANG);
  assert.equal(sesudah.perluPersetujuan, true, 'diskon yang tumbuh melewati nominalDisetujui TIDAK menuntut persetujuan baru');
});

function paramsAudit(d) {
  return d.sqlite.prepare('SELECT * FROM audit_event').all();
}

test('⛔ G-BATAL-AUDIT: buang menulis SATU audit_event cart_cleared + satu outbox cart_cleared, dan tidak menulis order/payment/cash_movement', async () => {
  const { buangTahanan, daftarTahanan } = await import(MOD);
  const d = buatDb();
  // Keranjang BERJALAN (bukan tahanan) harus selamat dari buang.
  const { simpanKeranjang } = await import('../../apps/kasir/src/kasir/keranjang-simpan.ts');
  await simpanKeranjang(d, 's1', { ...keranjangLengkap(), baris: [baris({ id: 'berjalan' })] }, WAKTU);
  const h = await tahan(d, keranjangLengkap());
  // tahan membersihkan keranjang_lokal; tulis lagi keranjang berjalan baru.
  await simpanKeranjang(d, 's1', { ...keranjangLengkap(), baris: [baris({ id: 'berjalan' })] }, WAKTU);

  const sebelum = { audit: n(d, 'audit_event'), outbox: n(d, 'outbox_local'), order: n(d, '"order"'), pay: n(d, 'payment'), kas: n(d, 'cash_movement') };
  let i = 0;
  await buangTahanan(d, h.id, {
    konfig: KONFIG, sesi: SESI, total: 61050n, waktu: WAKTU, idBaru: () => `buang-${++i}`, hlc: () => 77n,
  });

  assert.equal(n(d, 'audit_event') - sebelum.audit, 1, 'buang harus menulis TEPAT satu audit_event — nol audit adalah cacat yang fitur ini cegah');
  assert.equal(n(d, 'outbox_local') - sebelum.outbox, 1);
  const a = paramsAudit(d)[0];
  assert.equal(a.event_type, 'cart_cleared');
  assert.equal(a.entity_id, 's1');
  assert.equal(a.actor_user_id, 'u-sari');
  const after = JSON.parse(a.after);
  assert.equal(after.line_count, 2);
  assert.equal(after.quantity_milli, 2500, 'quantity_milli harus dari keranjang TAHANAN (2000 + 500)');
  assert.equal(after.total, '61050');
  const o = d.sqlite.prepare('SELECT * FROM outbox_local').get();
  assert.equal(o.entity_type, 'cart_cleared');
  assert.equal(o.entity_id, 's1');
  assert.equal(n(d, 'keranjang_tahan'), 0, 'tahanan tidak dihapus');
  assert.deepEqual(await daftarTahanan(d, 's1'), []);
  assert.equal(n(d, 'keranjang_lokal'), 1, 'buang tahanan MENGHAPUS keranjang BERJALAN (batalkanKeranjang membersihkan keranjang_lokal)');
  assert.equal(n(d, '"order"') - sebelum.order, 0);
  assert.equal(n(d, 'payment') - sebelum.pay, 0);
  assert.equal(n(d, 'cash_movement') - sebelum.kas, 0);
  assert.deepEqual(d.bocor, [], `penulisan di LUAR transaksi: ${JSON.stringify(d.bocor)}`);
});

test('⛔ buang gagal di tengah → tahanan UTUH dan nol audit', async () => {
  const { buangTahanan, jumlahTahanan } = await import(MOD);
  for (const kait of ['setelAudit', 'commit']) {
    const d = buatDb();
    const h = await tahan(d, keranjangLengkap());
    assert.equal(h.ok, true, `prasyarat: ${h.pesan}`);
    d.gagal[kait] = true;
    await assert.rejects(
      buangTahanan(d, h.id, { konfig: KONFIG, sesi: SESI, total: 1n, waktu: WAKTU, idBaru, hlc: () => 1n }),
      /perangkat mati/
    );
    assert.equal(await jumlahTahanan(d, 's1'), 1, `tahanan HILANG padahal buang gagal (${kait})`);
    assert.equal(n(d, 'audit_event'), 0, `audit tertulis padahal buang gagal (${kait})`);
    assert.equal(n(d, 'outbox_local'), 0, `outbox tertulis padahal buang gagal (${kait})`);
  }
});

test('⛔ tahan gagal di tengah (mati saat COMMIT) → keranjang berjalan UTUH dan tahanan tidak ada', async () => {
  const { tahanKeranjang, jumlahTahanan } = await import(MOD);
  const { simpanKeranjang } = await import('../../apps/kasir/src/kasir/keranjang-simpan.ts');
  const d = buatDb({ gagalCommit: true });
  await simpanKeranjang(d, 's1', keranjangLengkap(), WAKTU);
  await assert.rejects(tahanKeranjang(d, 's1', keranjangLengkap(), WAKTU, idBaru), /perangkat mati/);
  assert.equal(await jumlahTahanan(d, 's1'), 0);
  assert.equal(n(d, 'keranjang_lokal'), 1, 'keranjang berjalan hilang padahal tahan gagal');
});

test('⛔ keranjang_tahan terdaftar di TABEL_LOKAL_SAJA, bukan TABEL_RAW', async () => {
  const { TABEL_RAW, TABEL_LOKAL_SAJA } = await import(SKEMA);
  assert.ok(TABEL_LOKAL_SAJA.includes('keranjang_tahan'), 'keranjang_tahan tidak ada di TABEL_LOKAL_SAJA');
  assert.ok(!TABEL_RAW.includes('keranjang_tahan'), 'keranjang_tahan TIDAK BOLEH raw table: ia naik/turun lewat sync dan mengubah sidik jari skema');
});

test('lanjutkan menghapus tahanan secara atomik: dua lanjutkan beruntun → yang kedua null', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const h = await tahan(d, keranjangLengkap());
  assert.ok(await lanjutkanTahanan(d, h.id, HARGA_SAMA, WAKTU));
  // keranjang_lokal berisi hasil lanjutan; kosongkan agar yang diuji adalah "sudah habis", bukan pagar keranjang berjalan.
  d.sqlite.exec('DELETE FROM keranjang_lokal');
  assert.equal(await lanjutkanTahanan(d, h.id, HARGA_SAMA, WAKTU), null);
});

test('⛔ lanjutkan menolak (melempar) bila keranjang berjalan belum kosong — tidak pernah menimpa diam-diam', async () => {
  const { lanjutkanTahanan, jumlahTahanan } = await import(MOD);
  const { simpanKeranjang } = await import('../../apps/kasir/src/kasir/keranjang-simpan.ts');
  const d = buatDb();
  const h = await tahan(d, keranjangLengkap());
  const berjalan = { ...keranjangLengkap(), baris: [baris({ id: 'berjalan' })], diskon: null };
  await simpanKeranjang(d, 's1', berjalan, WAKTU);
  await assert.rejects(lanjutkanTahanan(d, h.id, HARGA_SAMA, WAKTU), /belum kosong/);
  assert.equal(await jumlahTahanan(d, 's1'), 1, 'tahanan hilang padahal lanjutkan ditolak');
  const isi = JSON.parse(d.sqlite.prepare('SELECT isi FROM keranjang_lokal').get().isi);
  assert.equal(isi.baris[0].id, 'berjalan', 'keranjang berjalan ditimpa');
});

test('lanjutkan tahanan yang rusak (isi tak terurai) → null dan barisnya dibuang, bukan melempar', async () => {
  const { lanjutkanTahanan, jumlahTahanan } = await import(MOD);
  const d = buatDb();
  d.sqlite.prepare(`INSERT INTO keranjang_tahan VALUES ('x','s1','bukan json',1,1,'2026-09-28T00:00:00Z')`).run();
  assert.equal(await lanjutkanTahanan(d, 'x', HARGA_SAMA, WAKTU), null);
  assert.equal(await jumlahTahanan(d, 's1'), 0);
});
