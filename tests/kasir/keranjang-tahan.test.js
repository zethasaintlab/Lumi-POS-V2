'use strict';

// Task 12 (PR 2C) — Pesanan tahan, sisi perangkat. Spec § 4 "Pesanan tahan —
// batas yang dinyatakan", § 11 G-TAHAN + G-BATAL-AUDIT, § 12 butir 7.
//
// ⛔ Di atas SQLite sungguhan (`node:sqlite`): "tahan", "lanjutkan", dan
// "buang" masing-masing menyentuh DUA tabel dalam satu transaksi, dan hanya
// ROLLBACK sungguhan yang membuktikan tidak ada keadaan setengah jadi
// (keranjang di dua tempat sekaligus = pelanggan ditagih dua kali).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/keranjang-tahan.ts';
const SIMPAN = '../../apps/kasir/src/kasir/keranjang-simpan.ts';
const SKEMA = '../../apps/kasir/src/lokal/skema.ts';
const SQL_LOKAL = path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const DDL = `
CREATE TABLE keranjang_lokal (
  id TEXT PRIMARY KEY NOT NULL, shift_id TEXT NOT NULL, isi TEXT NOT NULL, diperbarui_pada TEXT NOT NULL
);
CREATE TABLE keranjang_tahan (
  id TEXT PRIMARY KEY NOT NULL, shift_id TEXT NOT NULL, isi TEXT NOT NULL,
  jumlah_item INTEGER NOT NULL, subtotal INTEGER NOT NULL, dibuat_pada TEXT NOT NULL
);
CREATE TABLE draf_qris_lokal (
  id TEXT PRIMARY KEY NOT NULL, order_id TEXT, payment_id TEXT, shift_id TEXT NOT NULL,
  draf TEXT, muatan TEXT, qr_string TEXT, dibuat_pada TEXT
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
INSERT INTO device_config (id, hlc_teks, hlc_state) VALUES (1, '0', 0);
`;

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };

function buatDb({ gagalSetelAudit = false, shiftStatus = 'open' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  sqlite.prepare(`INSERT INTO cash_drawer_shift VALUES ('s1','o1','d1',?)`).run(shiftStatus);
  const bocor = [];
  const baca = async (sql, params = []) => sqlite.prepare(sql).all(...params);
  // ⛔ `tx` BERBEDA dari `db`: penulisan yang bocor keluar transaksi tercatat di `bocor`.
  const tx = {
    getAll: baca,
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      if (gagalSetelAudit && /INSERT INTO audit_event/.test(sql)) {
        throw new Error('perangkat mati di tengah transaksi');
      }
    },
    async transaction() {
      throw new Error('transaksi bersarang tidak didukung');
    },
  };
  return {
    sqlite,
    bocor,
    getAll: baca,
    async execute(sql, params = []) {
      bocor.push(sql.replace(/\s+/g, ' ').trim());
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      sqlite.exec('BEGIN');
      try {
        const hasil = await fn(tx);
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const n = (d, t) => d.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const JAM = () => new Date('2026-09-28T03:00:00Z');
function pembuatId() {
  let i = 0;
  return () => `id-${++i}`;
}

function baris(over = {}) {
  return {
    id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
    variationCount: 2, unitPrice: 20000, quantityMilli: 2000, modifier: [], ...over,
  };
}

const KERANJANG_KAYA = {
  baris: [
    baris({
      modifier: [{ id: 'm1', nama: 'Extra Shot', harga: 5000, qtyMilli: 2000 }],
    }),
    baris({ id: 'b2', variationId: 'v2', itemName: 'Roti', variationName: 'Coklat', unitPrice: 15000, quantityMilli: 1500 }),
  ],
  diskon: {
    minta: { tipe: 'persen', nilai: 3000n },
    alasanKode: 'pelanggan_langganan',
    alasanCatatan: 'langganan lama',
    approverId: 'u-manajer',
    nominalDisetujui: 1152921504606846976n,
  },
  kanal: 'dine_in',
  dataPesanan: { namaPemesan: 'Budi', nomorMeja: 'A-12', catatan: 'tanpa es' },
};

const HARGA_SAMA = {
  variation: new Map([['v1', 20000], ['v2', 15000]]),
  modifier: new Map([['m1', 5000]]),
};

function jejak(over = {}) {
  return {
    konfig: KONFIG, sesi: SESI, total: 81000n, waktu: JAM, idBaru: pembuatId(), hlc: () => 77n, ...over,
  };
}

// ---------------------------------------------------------------------------

test('⛔ G-TAHAN: tahan → keranjang berjalan kosong; lanjutkan → keranjang pulih IDENTIK (bigint, diskon + nominalDisetujui, kanal, dataPesanan, modifier ber-qty)', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const { simpanKeranjang, pulihkanKeranjang } = await import(SIMPAN);
  const d = buatDb();
  await simpanKeranjang(d, 's1', KERANJANG_KAYA, JAM);
  assert.equal(n(d, 'keranjang_lokal'), 1);

  const hasil = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.equal(hasil.ok, true);
  assert.equal(n(d, 'keranjang_tahan'), 1);
  assert.equal(n(d, 'keranjang_lokal'), 0, 'keranjang berjalan harus kosong DALAM transaksi yang sama dengan tahan');
  assert.equal((await pulihkanKeranjang(d, 's1')).status, 'kosong');

  const lanjut = await lanjutkanTahanan(d, hasil.id, HARGA_SAMA, JAM);
  assert.notEqual(lanjut, null);
  assert.deepEqual(lanjut.keranjang, KERANJANG_KAYA, 'keranjang pulih TIDAK identik');
  assert.equal(typeof lanjut.keranjang.diskon.nominalDisetujui, 'bigint');
  assert.equal(lanjut.keranjang.diskon.nominalDisetujui, 1152921504606846976n);
  assert.equal(lanjut.subtotalBerubah, false);
  assert.deepEqual(lanjut.barisDibuang, []);
  assert.equal(n(d, 'keranjang_tahan'), 0);
  // Keranjang hasil lanjutkan sudah durable di `keranjang_lokal` (tidak menunggu efek layar).
  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  assert.deepEqual(pulih.keranjang, KERANJANG_KAYA);
});

test('⛔ tahan TIDAK menulis audit (belum ada yang dibatalkan), outbox, order, payment, cash_movement', async () => {
  const { tahanKeranjang } = await import(MOD);
  const d = buatDb();
  await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
  assert.equal(n(d, '"order"'), 0);
  assert.equal(n(d, 'payment'), 0);
  assert.equal(n(d, 'cash_movement'), 0);
});

test('tahan menolak keranjang kosong dengan pesan, dan tidak menulis apa pun', async () => {
  const { tahanKeranjang } = await import(MOD);
  const d = buatDb();
  const hasil = await tahanKeranjang(d, 's1', { baris: [], diskon: null, kanal: 'takeaway', dataPesanan: {} }, JAM, pembuatId());
  assert.equal(hasil.ok, false);
  assert.match(hasil.pesan, /kosong/i);
  assert.equal(n(d, 'keranjang_tahan'), 0);
});

test('daftarTahanan memuat ringkasan (jumlah item, subtotal bigint, waktu) dan jumlahTahanan cocok', async () => {
  const { tahanKeranjang, daftarTahanan, jumlahTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  const daftar = await daftarTahanan(d, 's1');
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].id, id);
  assert.equal(daftar[0].jumlahItem, 2, 'jumlah BARIS keranjang');
  // 2 × (20000 + 5000×2) + 1,5 × 15000 = 60000 + 22500
  assert.equal(daftar[0].subtotal, 82500n);
  assert.equal(typeof daftar[0].subtotal, 'bigint');
  assert.equal(daftar[0].dibuatPada, '2026-09-28T03:00:00.000Z');
  assert.equal(await jumlahTahanan(d, 's1'), 1);
});

test('tahanan shift lain tidak terdaftar dan tidak dihitung', async () => {
  const { tahanKeranjang, daftarTahanan, jumlahTahanan } = await import(MOD);
  const d = buatDb();
  await tahanKeranjang(d, 's-lain', KERANJANG_KAYA, JAM, pembuatId());
  assert.deepEqual(await daftarTahanan(d, 's1'), []);
  assert.equal(await jumlahTahanan(d, 's1'), 0);
  assert.equal(await jumlahTahanan(d, 's-lain'), 1);
});

test('⛔ tahanan ke-21 ditolak dengan pesan; ke-20 diterima', async () => {
  const { tahanKeranjang, MAKS_TAHANAN, jumlahTahanan } = await import(MOD);
  assert.equal(MAKS_TAHANAN, 20);
  const d = buatDb();
  const idBaru = pembuatId();
  for (let i = 0; i < 20; i++) {
    const h = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, idBaru);
    assert.equal(h.ok, true, `tahanan ke-${i + 1} harus diterima`);
  }
  const ke21 = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, idBaru);
  assert.equal(ke21.ok, false);
  assert.match(ke21.pesan, /20/);
  assert.equal(await jumlahTahanan(d, 's1'), 20);
  // Batas PER SHIFT: shift lain tidak terhitung.
  assert.equal((await tahanKeranjang(d, 's-lain', KERANJANG_KAYA, JAM, idBaru)).ok, true);
});

test('⛔ lanjutkan sesudah harga berubah: harga baru, subtotalBerubah true (Review Focus 3)', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  const harga = {
    variation: new Map([['v1', 22000], ['v2', 15000]]),
    modifier: new Map([['m1', 6000]]),
  };
  const hasil = await lanjutkanTahanan(d, id, harga, JAM);
  assert.equal(hasil.subtotalBerubah, true);
  assert.equal(hasil.keranjang.baris[0].unitPrice, 22000, 'harga variation harus HARGA BARU');
  assert.equal(hasil.keranjang.baris[0].modifier[0].harga, 6000, 'harga modifier harus HARGA BARU');
  assert.equal(hasil.keranjang.baris[1].unitPrice, 15000);
  assert.deepEqual(hasil.barisDibuang, []);
});

test('hargaUlang murni: harga sama → subtotalBerubah false dan objek asal tidak bermutasi', async () => {
  const { hargaUlang } = await import(MOD);
  const salinan = JSON.stringify(KERANJANG_KAYA, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const hasil = hargaUlang(KERANJANG_KAYA, HARGA_SAMA);
  assert.equal(hasil.subtotalBerubah, false);
  assert.equal(JSON.stringify(KERANJANG_KAYA, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), salinan);
  const naik = hargaUlang(KERANJANG_KAYA, { ...HARGA_SAMA, variation: new Map([['v1', 21000], ['v2', 15000]]) });
  assert.equal(KERANJANG_KAYA.baris[0].unitPrice, 20000, 'keranjang asal tidak boleh bermutasi');
  assert.equal(naik.keranjang.baris[0].unitPrice, 21000);
});

test('variation yang diarsip dibuang dan namanya dilaporkan; subtotalBerubah true', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  const hasil = await lanjutkanTahanan(
    d,
    id,
    { variation: new Map([['v1', 20000]]), modifier: new Map([['m1', 5000]]) },
    JAM
  );
  assert.deepEqual(hasil.barisDibuang, ['Roti Coklat']);
  assert.equal(hasil.keranjang.baris.length, 1);
  assert.equal(hasil.keranjang.baris[0].variationId, 'v1');
  assert.equal(hasil.subtotalBerubah, true);
});

test('semua baris dibuang → diskon ikut lepas (tidak menempel pada pesanan berikutnya)', async () => {
  const { hargaUlang } = await import(MOD);
  const hasil = hargaUlang(KERANJANG_KAYA, { variation: new Map(), modifier: new Map() });
  assert.equal(hasil.keranjang.baris.length, 0);
  assert.equal(hasil.keranjang.diskon, null);
});

test('⛔ diskon yang tumbuh melewati nominalDisetujui sesudah harga ulang → statusDiskon menuntut persetujuan baru', async () => {
  const { hargaUlang } = await import(MOD);
  const { statusDiskon } = await import('../../apps/kasir/src/kasir/diskon.ts');
  const { subtotalKeranjang } = await import('../../apps/kasir/src/kasir/keranjang.ts');
  const { AMBANG_DISKON_BAWAAN } = await import('../../packages/domain/src/diskon.ts');

  // Diskon 30% disetujui manajer untuk subtotal 82.500 -> Rp 24.750.
  const k = {
    ...KERANJANG_KAYA,
    diskon: {
      minta: { tipe: 'persen', nilai: 3000n },
      alasanKode: 'pelanggan_langganan',
      alasanCatatan: null,
      approverId: 'u-manajer',
      nominalDisetujui: 24750n,
    },
  };
  const sebelum = statusDiskon(subtotalKeranjang(k), k.diskon, AMBANG_DISKON_BAWAAN);
  assert.equal(sebelum.perluPersetujuan, false, 'prasyarat: sebelum harga naik, persetujuan masih menutup');

  const naik = hargaUlang(k, {
    variation: new Map([['v1', 40000], ['v2', 15000]]),
    modifier: new Map([['m1', 5000]]),
  });
  assert.equal(naik.keranjang.diskon.nominalDisetujui, 24750n, 'persetujuan lama tidak boleh diubah diam-diam');
  const sesudah = statusDiskon(subtotalKeranjang(naik.keranjang), naik.keranjang.diskon, AMBANG_DISKON_BAWAAN);
  assert.equal(sesudah.perluPersetujuan, true, 'potongan yang tumbuh melewati nominalDisetujui harus menuntut persetujuan baru');
});

test('lanjutkan menghapus tahanan secara atomik: dua lanjutkan beruntun → yang kedua null', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.notEqual(await lanjutkanTahanan(d, id, HARGA_SAMA, JAM), null);
  assert.equal(await lanjutkanTahanan(d, id, HARGA_SAMA, JAM), null);
  assert.equal(n(d, 'keranjang_tahan'), 0);
});

test('lanjutkan id yang tidak ada → null', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  assert.equal(await lanjutkanTahanan(buatDb(), 'tidak-ada', HARGA_SAMA, JAM), null);
});

test('⛔ Fix1 M1: tahanan dengan isi rusak TIDAK dihapus diam-diam oleh lanjutkan — galat "tidak dapat dibaca", baris utuh', async () => {
  const { lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  d.sqlite.prepare(`INSERT INTO keranjang_tahan VALUES ('x','s1','{bukan json',1,1,'2026-09-28T00:00:00Z')`).run();
  await assert.rejects(() => lanjutkanTahanan(d, 'x', HARGA_SAMA, JAM), /tidak dapat dibaca/);
  assert.equal(n(d, 'keranjang_tahan'), 1, 'tahanan rusak hilang tanpa jejak');
  assert.equal(n(d, 'keranjang_lokal'), 0);
});

test('⛔ Fix1 M1: buang tahanan rusak menulis TEPAT satu audit cart_cleared dari kolom jumlah_item/subtotal, lalu menghapus', async () => {
  const { buangTahanan } = await import(MOD);
  const d = buatDb();
  d.sqlite.prepare(`INSERT INTO keranjang_tahan VALUES ('x','s1','{bukan json',2,50000,'2026-09-28T00:00:00Z')`).run();
  await buangTahanan(d, 'x', jejak({ total: 0n }));
  assert.equal(n(d, 'keranjang_tahan'), 0);
  assert.equal(n(d, 'audit_event'), 1, 'penghapusan tanpa audit');
  assert.equal(n(d, 'outbox_local'), 1);
  const a = d.sqlite.prepare('SELECT * FROM audit_event').get();
  assert.equal(a.event_type, 'cart_cleared');
  assert.deepEqual(JSON.parse(a.after), { line_count: 2, quantity_milli: 2000, total: '50000' });
});

test('⛔ Fix1 M2: lanjutkan menolak DI DALAM transaksi bila keranjang_lokal sudah berisi — tidak menimpa, tahanan utuh', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const { simpanKeranjang, pulihkanKeranjang } = await import(SIMPAN);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  // Penulis kedua: keranjang berjalan terisi (tab lain / efek layar) SETELAH tahan.
  const lain = { ...KERANJANG_KAYA, baris: [baris({ id: 'bz', variationId: 'v9' })], diskon: null };
  await simpanKeranjang(d, 's1', lain, JAM);
  await assert.rejects(() => lanjutkanTahanan(d, id, HARGA_SAMA, JAM), /Tahan pesanan ini dulu/);
  assert.equal(n(d, 'keranjang_tahan'), 1, 'tahanan terhapus padahal tidak dilanjutkan');
  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  assert.equal(pulih.keranjang.baris[0].id, 'bz', 'keranjang berjalan tertimpa');
});

test('⛔ G-BATAL-AUDIT: buang menulis SATU audit_event cart_cleared + satu outbox cart_cleared, dan tidak menulis order/payment/cash_movement', async () => {
  const { tahanKeranjang, buangTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);

  await buangTahanan(d, id, jejak());

  assert.equal(n(d, 'keranjang_tahan'), 0, 'tahanan tidak terhapus');
  assert.equal(n(d, 'audit_event'), 1, 'audit_event tidak tertulis (atau tertulis ganda)');
  assert.equal(n(d, 'outbox_local'), 1, 'outbox tidak tertulis');
  assert.equal(n(d, '"order"'), 0);
  assert.equal(n(d, 'payment'), 0);
  assert.equal(n(d, 'cash_movement'), 0);

  const a = d.sqlite.prepare('SELECT * FROM audit_event').get();
  assert.equal(a.event_type, 'cart_cleared');
  assert.equal(a.entity_type, 'cash_drawer_shift');
  assert.equal(a.entity_id, 's1', 'entity_id = shift tahanan');
  assert.equal(a.actor_user_id, 'u-sari');
  assert.deepEqual(JSON.parse(a.after), { line_count: 2, quantity_milli: 3500, total: '81000' });
  const ob = d.sqlite.prepare('SELECT * FROM outbox_local').get();
  assert.equal(ob.entity_type, 'cart_cleared');
  assert.equal(ob.entity_id, 's1');
  assert.equal(ob.idempotency_key, a.id);
});

test('⛔ buang TIDAK menyentuh keranjang berjalan (keranjang_lokal) milik pesanan lain', async () => {
  const { tahanKeranjang, buangTahanan } = await import(MOD);
  const { simpanKeranjang, pulihkanKeranjang } = await import(SIMPAN);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  const berjalan = { baris: [baris({ id: 'bx', variationId: 'v9' })], diskon: null, kanal: 'takeaway', dataPesanan: { namaPemesan: null, nomorMeja: null, catatan: null } };
  await simpanKeranjang(d, 's1', berjalan, JAM);
  await buangTahanan(d, id, jejak());
  assert.equal((await pulihkanKeranjang(d, 's1')).status, 'dipulihkan', 'buang tahanan menghapus keranjang berjalan');
});

test('⛔ buang gagal di tengah → tahanan UTUH dan nol audit', async () => {
  const { tahanKeranjang, buangTahanan } = await import(MOD);
  const d = buatDb({ gagalSetelAudit: true });
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  await assert.rejects(() => buangTahanan(d, id, jejak()), /perangkat mati/);
  assert.equal(n(d, 'keranjang_tahan'), 1, 'tahanan hilang tanpa jejak');
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
});

test('buang pada shift yang sudah tidak terbuka → galat dan tahanan UTUH, nol audit', async () => {
  const { tahanKeranjang, buangTahanan } = await import(MOD);
  const d = buatDb({ shiftStatus: 'closed' });
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  await assert.rejects(() => buangTahanan(d, id, jejak()), /TIDAK dibuang/);
  assert.equal(n(d, 'keranjang_tahan'), 1);
  assert.equal(n(d, 'audit_event'), 0);
});

test('buang id yang tidak ada → galat, nol audit', async () => {
  const { buangTahanan } = await import(MOD);
  const d = buatDb();
  await assert.rejects(() => buangTahanan(d, 'tidak-ada', jejak()), /tidak ditemukan/i);
  assert.equal(n(d, 'audit_event'), 0);
});

test('⛔ SEMUA penulisan tahan/lanjutkan/buang lewat tx: nol penulisan di luar transaksi', async () => {
  const { tahanKeranjang, lanjutkanTahanan, buangTahanan } = await import(MOD);
  const d = buatDb();
  const idBaru = pembuatId();
  const a = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, idBaru);
  const b = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, idBaru);
  await lanjutkanTahanan(d, a.id, HARGA_SAMA, JAM);
  await buangTahanan(d, b.id, jejak());
  assert.deepEqual(d.bocor, [], `penulisan bocor keluar transaksi: ${JSON.stringify(d.bocor)}`);
});

test('⛔ keranjang_tahan terdaftar di TABEL_LOKAL_SAJA dan di DDL lokal, BUKAN TABEL_RAW', async () => {
  const { TABEL_RAW, TABEL_LOKAL_SAJA, kolomPerTabel } = await import(SKEMA);
  assert.ok(TABEL_LOKAL_SAJA.includes('keranjang_tahan'), 'keranjang_tahan harus di TABEL_LOKAL_SAJA');
  assert.ok(!TABEL_RAW.includes('keranjang_tahan'), 'keranjang_tahan TIDAK BOLEH jadi raw table (tidak boleh naik/turun)');
  const k = kolomPerTabel(fs.readFileSync(SQL_LOKAL, 'utf8'));
  assert.deepEqual(k.keranjang_tahan, ['id', 'shift_id', 'isi', 'jumlah_item', 'subtotal', 'dibuat_pada']);
});

test('⛔ sidik jari skema lokal TIDAK berubah karena tabel murni lokal baru (perangkat lama tidak unduh ulang katalog)', async () => {
  const { sidikJariSkemaLokal } = await import(SKEMA);
  const asli = fs.readFileSync(SQL_LOKAL, 'utf8');
  const tanpa = asli.replace(/CREATE TABLE keranjang_tahan \([\s\S]*?\);\n/, '');
  assert.notEqual(tanpa, asli, 'prasyarat: DDL keranjang_tahan harus ada untuk dibuang');
  assert.equal(sidikJariSkemaLokal(asli), sidikJariSkemaLokal(tanpa));
});

// ---------------------------------------------------------------------------
// Fix round akhir I3 (jalur uang): selama draf QRIS dinamis tertunda ada untuk
// shift ini, Tahan/Buang/Lanjutkan DITOLAK -- harga dan keranjang di balik
// draf tidak boleh berubah di bawah QR yang mungkin sudah dibayar pelanggan.
// ---------------------------------------------------------------------------

const adaDraf = (d, shift = 's1') =>
  d.sqlite.prepare(`INSERT INTO draf_qris_lokal VALUES ('kini','o1','p1',?, '{}','{}',NULL,'2026-09-28T00:00:00Z')`).run(shift);

test('⛔ I3: draf QRIS ada → Tahan ditolak (galat Indonesia), keranjang berjalan UTUH, nol tahanan', async () => {
  const { tahanKeranjang } = await import(MOD);
  const { simpanKeranjang, pulihkanKeranjang } = await import(SIMPAN);
  const d = buatDb();
  await simpanKeranjang(d, 's1', KERANJANG_KAYA, JAM);
  adaDraf(d);
  const h = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.equal(h.ok, false);
  assert.match(h.pesan, /QRIS/);
  assert.equal(n(d, 'keranjang_tahan'), 0);
  assert.equal((await pulihkanKeranjang(d, 's1')).status, 'dipulihkan', 'keranjang berjalan hilang');
});

test('⛔ I3: draf QRIS ada → Buang ditolak, tahanan UTUH, nol audit', async () => {
  const { tahanKeranjang, buangTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  adaDraf(d);
  await assert.rejects(() => buangTahanan(d, id, jejak()), /QRIS/);
  assert.equal(n(d, 'keranjang_tahan'), 1);
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
});

test('⛔ I3: draf QRIS ada → Lanjutkan ditolak (tidak menghitung ulang harga), tahanan UTUH', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  const { id } = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  adaDraf(d);
  await assert.rejects(() => lanjutkanTahanan(d, id, HARGA_SAMA, JAM), /QRIS/);
  assert.equal(n(d, 'keranjang_tahan'), 1);
  assert.equal(n(d, 'keranjang_lokal'), 0);
});

test('I3: draf QRIS milik shift LAIN tidak menghalangi (perilaku lama)', async () => {
  const { tahanKeranjang, lanjutkanTahanan } = await import(MOD);
  const d = buatDb();
  adaDraf(d, 's-lain');
  const h = await tahanKeranjang(d, 's1', KERANJANG_KAYA, JAM, pembuatId());
  assert.equal(h.ok, true);
  assert.notEqual(await lanjutkanTahanan(d, h.id, HARGA_SAMA, JAM), null);
});
