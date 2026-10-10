'use strict';

// K-08 Riwayat Transaksi + K-09 Detail Transaksi.
//
// `IA:68` menandai K-09 dengan satu kalimat yang menentukan bentuknya:
// "Menampilkan RANTAI KOREKSI". Order asli tidak pernah di-UPDATE
// (invariant #2), jadi void dan refund adalah baris-baris LAIN — dan tanpa
// merangkainya, kasir melihat order yang terlihat normal padahal sudah
// dibatalkan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/riwayat/baca.ts';

function dbPalsu(data = {}) {
  return {
    async getAll(sql, params = []) {
      if (/FROM "order"/.test(sql)) {
        if (/WHERE o\.id = \?/.test(sql)) return (data.order ?? []).filter((o) => o.id === params[0]);
        return data.order ?? [];
      }
      // `IN (…)` = K-08 daftar (seluruh jendela sekaligus); `= ?` = K-09 detail.
      if (/FROM order_line/.test(sql)) return (data.order_line ?? []).filter((l) => (/\bIN\s*\(/i.test(sql) ? params.includes(l.order_id) : l.order_id === params[0]));
      if (/FROM payment/.test(sql)) return (data.payment ?? []).filter((p) => (/\bIN\s*\(/i.test(sql) ? params.includes(p.order_id) : p.order_id === params[0]));
      if (/FROM refund/.test(sql)) return (data.refund ?? []).filter((r) => r.order_id === params[0]);
      if (/FROM outbox_local/.test(sql)) return data.outbox ?? [];
      return [];
    },
    async execute() { return { rowsAffected: 0 }; },
    async transaction(fn) { return fn(this); },
  };
}

const ORDER = {
  id: 'o1', receipt_number: 'K1-20260813-0001', business_date: '2026-08-13',
  status: 'closed', total: 16500, amount_due: 16500, tax_amount: 1500,
  rounding_adjustment: 0, occurred_at: '2026-08-13T07:00:00Z',
  created_by: 'u-sari', voided_by_order_id: null, sequence: 1,
};

// ---------------------------------------------------------------------------

test('daftar: terbaru lebih dulu, dengan status sinkronisasi per order', async () => {
  const { bacaRiwayat } = await import(MOD);

  const db = dbPalsu({
    order: [
      { ...ORDER, id: 'o1', sequence: 1, occurred_at: '2026-08-13T07:00:00Z' },
      { ...ORDER, id: 'o2', sequence: 2, occurred_at: '2026-08-13T08:00:00Z', receipt_number: 'K1-20260813-0002' },
    ],
    outbox: [
      { entity_id: 'o1', status: 'sent' },
      { entity_id: 'o2', status: 'pending' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  assert.deepEqual(hasil.map((o) => o.id), ['o2', 'o1'], 'terbaru lebih dulu');
  assert.equal(hasil[0].statusSync, 'queued');
  assert.equal(hasil[1].statusSync, 'ok');
});

test('⛔ status sinkronisasi memakai aturan TERBURUK-MENANG', async () => {
  const { bacaRiwayat } = await import(MOD);

  // Satu order punya beberapa baris outbox — `order` dan `payment` memakai
  // `entity_id` yang sama. Order yang pembayarannya gagal terkirim TIDAK
  // boleh terlihat `ok`, karena itu justru penjualan yang uangnya berisiko.
  const db = dbPalsu({
    order: [ORDER],
    outbox: [
      { entity_id: 'o1', status: 'sent' },
      { entity_id: 'o1', status: 'failed' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  assert.equal(hasil[0].statusSync, 'failed');
});

test('order yang sudah DI-VOID ditandai, meski statusnya masih `open`', async () => {
  const { bacaRiwayat } = await import(MOD);

  // ⛔ `CLAUDE.md`: "Order yang sudah di-void tetap berstatus `open`. Jangan
  // pernah menyimpulkan 'order ini sah' dari `status = 'open'` saja."
  // Yang menandainya adalah order PEMBATAL yang menunjuk ke sini.
  const db = dbPalsu({
    order: [
      { ...ORDER, id: 'o1', status: 'open', voided_by_order_id: null },
      { ...ORDER, id: 'o-batal', status: 'voided', voided_by_order_id: 'o1', receipt_number: 'K1-20260813-0002' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  const asli = hasil.find((o) => o.id === 'o1');
  assert.equal(asli.dibatalkan, true, 'order asli harus tertandai dibatalkan');
  assert.equal(asli.dibatalkanOleh, 'o-batal');

  // Order pembatal sendiri TIDAK ditandai "dibatalkan" — ia yang membatalkan.
  const pembatal = hasil.find((o) => o.id === 'o-batal');
  assert.equal(pembatal.dibatalkan, false);
  assert.equal(pembatal.membatalkan, 'o1');
});

test('detail: baris, pembayaran, dan refund dirangkai', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      { id: 'l1', order_id: 'o1', item_name: 'Kopi Susu', variation_name: 'Regular',
        unit_price: 15000, quantity: 1000, line_total: 15000, tax_amount: 1500,
        modifier_snapshot: JSON.stringify(['Ekstra']) },
    ],
    payment: [
      { id: 'p1', order_id: 'o1', method: 'cash', amount: 16500,
        tendered_amount: 20000, change_amount: 3500, status: 'confirmed' },
    ],
    refund: [
      { id: 'r1', order_id: 'o1', amount: 5000, reason_code: 'barang_rusak',
        reason_note: null, approved_by: 'u-budi', occurred_at: '2026-08-13T09:00:00Z' },
    ],
  });

  const d = await bacaDetail(db, 'o1');
  assert.equal(d.order.receiptNumber, 'K1-20260813-0001');
  assert.equal(d.baris.length, 1);
  assert.deepEqual(d.baris[0].modifier, ['Ekstra']);
  assert.equal(d.pembayaran[0].kembalian, 3500);
  assert.equal(d.refund[0].jumlah, 5000);
  // Sisa yang masih dapat direfund — dihitung, bukan disimpan. Refund
  // sebagian menuntutnya, dan menampilkannya salah berarti kasir menjanjikan
  // uang yang server akan tolak.
  assert.equal(d.sisaDapatDirefund, 11500);
});

test('⛔ sisa refund tidak pernah negatif', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    refund: [
      { id: 'r1', order_id: 'o1', amount: 16500, reason_code: 'barang_rusak', occurred_at: '2026-08-13T09:00:00Z' },
    ],
  });
  const d = await bacaDetail(db, 'o1');
  assert.equal(d.sisaDapatDirefund, 0);
});

test('detail order yang tidak ada mengembalikan null, bukan melempar', async () => {
  const { bacaDetail } = await import(MOD);
  assert.equal(await bacaDetail(dbPalsu({}), 'tidak-ada'), null);
});

test('riwayat kosong bukan galat', async () => {
  const { bacaRiwayat } = await import(MOD);
  assert.deepEqual(await bacaRiwayat(dbPalsu({}), { batas: 50 }), []);
});

test('pencarian nomor struk', async () => {
  const { cariRiwayat } = await import(MOD);

  const daftar = [
    { id: 'o1', receiptNumber: 'K1-20260813-0001', total: 16500 },
    { id: 'o2', receiptNumber: 'K1-20260813-0042', total: 20000 },
  ];
  assert.equal(cariRiwayat(daftar, '0042').length, 1);
  assert.equal(cariRiwayat(daftar, 'K1-2026').length, 2);
  assert.equal(cariRiwayat(daftar, '').length, 2);
  assert.equal(cariRiwayat(daftar, 'tidak ada').length, 0);
});

test('⛔ snapshot modifier: bentuk LAMA dan bentuk FR-A3 sama-sama terbaca', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      // Bentuk lama — ada di perangkat merchant dan tidak dapat ditulis ulang:
      // `order_line` tidak pernah di-UPDATE (invariant #2). Menolaknya berarti
      // seluruh riwayat sebelum FR-A3 kehilangan modifiernya.
      { id: 'l1', order_id: 'o1', item_name: 'Kopi', variation_name: 'Regular',
        unit_price: 15000, quantity: 1000, line_total: 15000, tax_amount: 0,
        modifier_snapshot: JSON.stringify(['Ekstra']) },
      { id: 'l2', order_id: 'o1', item_name: 'Kopi', variation_name: 'Large',
        unit_price: 20000, quantity: 1000, line_total: 20000, tax_amount: 0,
        modifier_snapshot: JSON.stringify([
          { nama: 'Extra shot', qtyMilli: 2000 },
          { nama: 'Es sedikit', qtyMilli: 1000 },
        ]) },
      // JSON cacat tidak boleh menjatuhkan seluruh layar detail.
      { id: 'l3', order_id: 'o1', item_name: 'Teh', variation_name: 'Regular',
        unit_price: 10000, quantity: 1000, line_total: 10000, tax_amount: 0,
        modifier_snapshot: '{bukan json' },
    ],
    payment: [],
    refund: [],
  });

  const d = await bacaDetail(db, 'o1');
  assert.deepEqual(d.baris[0].modifier, ['Ekstra']);
  // Kuantitas TERLIHAT — ini layar yang dipakai memutuskan refund.
  assert.deepEqual(d.baris[1].modifier, ['Extra shot ×2', 'Es sedikit']);
  assert.deepEqual(d.baris[2].modifier, []);
});

test('⛔ snapshot modifier bentuk SERVER terbaca — bukan kata "undefined"', async () => {
  // Cacat yang DIRAMALKAN, dan 29 Agustus 2026 harinya.
  //
  // `CLAUDE.md` mencatat sejak FR-A3 bahwa snapshot klien "masih BERBEDA dari
  // snapshot server (`[{id, modifierId, name, price, quantityMilli}]`); tidak
  // berbahaya hari ini karena `order_line` tidak ada di sync rules jalur
  // turun, DAN MENJADI BERBAHAYA PADA HARI IA MASUK."
  //
  // Stream `riwayat` memasukkannya. Server menulis `name`/`quantityMilli`;
  // parser membaca `nama`/`qtyMilli`. Tanpa bentuk ketiga, setiap modifier
  // pada setiap baris yang dipulihkan dari server tampil sebagai kata
  // `"undefined"` — tanpa satu pun error, di layar yang dipakai memutuskan
  // refund.
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      { id: 'l1', order_id: 'o1', item_name: 'Kopi', variation_name: 'Large',
        unit_price: 20000, quantity: 1000, line_total: 20000, tax_amount: 0,
        modifier_snapshot: JSON.stringify([
          { id: 'olm1', modifierId: 'm1', name: 'Extra shot', price: 5000, quantityMilli: 2000 },
          { id: 'olm2', modifierId: 'm2', name: 'Es sedikit', price: 0, quantityMilli: 1000 },
        ]) },
    ],
    payment: [],
    refund: [],
  });

  const d = await bacaDetail(db, 'o1');
  assert.deepEqual(d.baris[0].modifier, ['Extra shot ×2', 'Es sedikit']);
  // Dinyatakan terpisah: kata `undefined` tidak boleh muncul di mana pun.
  // Assertion di atas sudah menutupnya, tapi yang gagal berikutnya harus
  // menyebut GEJALANYA, bukan hanya nilai yang tidak cocok.
  for (const m of d.baris[0].modifier) {
    assert.equal(m.includes('undefined'), false, `nama modifier hilang: ${m}`);
  }
});

test('⛔ ketiga bentuk snapshot hidup berdampingan dalam satu order', async () => {
  // Perangkat yang dipulihkan memuat KEDUANYA: baris lama yang ia tulis
  // sendiri (bentuk klien) dan baris yang turun dari server (bentuk server).
  // Satu order dapat memuat keduanya, dan tidak ada apa pun di barisnya yang
  // menyatakan bentuk mana yang dipakai.
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      { id: 'l1', order_id: 'o1', item_name: 'A', variation_name: 'R',
        unit_price: 1000, quantity: 1000, line_total: 1000, tax_amount: 0,
        modifier_snapshot: JSON.stringify(['Ekstra']) },
      { id: 'l2', order_id: 'o1', item_name: 'B', variation_name: 'R',
        unit_price: 1000, quantity: 1000, line_total: 1000, tax_amount: 0,
        modifier_snapshot: JSON.stringify([{ nama: 'Sirup', qtyMilli: 3000 }]) },
      { id: 'l3', order_id: 'o1', item_name: 'C', variation_name: 'R',
        unit_price: 1000, quantity: 1000, line_total: 1000, tax_amount: 0,
        modifier_snapshot: JSON.stringify([{ name: 'Sirup', quantityMilli: 3000 }]) },
    ],
    payment: [],
    refund: [],
  });

  const d = await bacaDetail(db, 'o1');
  assert.deepEqual(d.baris[0].modifier, ['Ekstra']);
  // ⛔ Kedua bentuk berkuantitas sama HARUS menghasilkan teks yang sama.
  // Baris yang sama yang dibaca berbeda tergantung asalnya adalah riwayat
  // yang tidak dapat dipakai membandingkan apa pun.
  assert.deepEqual(d.baris[1].modifier, d.baris[2].modifier);
  assert.deepEqual(d.baris[2].modifier, ['Sirup ×3']);
});

test('⛔ detail riwayat membawa provider pembayaran (transfer = other + bank_transfer)', async () => {
  // SQLite sungguhan, bukan `dbPalsu`: fake mengembalikan baris fixture utuh untuk
  // SQL apa pun, jadi SELECT tanpa `provider` tetap lulus (tinjauan Opus, I-2).
  const { DatabaseSync } = require('node:sqlite');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { bacaDetail } = await import(MOD);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(__dirname, '..', '..', 'db', 'local', '001-initial.sql'), 'utf8'));
  const db = {
    async getAll(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    async execute(sql, params = []) { sqlite.prepare(sql).run(...params); return { rowsAffected: 1 }; },
    async transaction(fn) { return fn(db); },
  };
  sqlite.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
    VALUES ('o1','t1','o1','d1','s1','K1-20260813-0001','2026-08-13',1,
            'closed','takeaway',16500,0,0,0,0,16500,16500,'u-sari','2026-08-13T07:00:00Z',1)`);
  sqlite.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('c1','o1',16500,16500)`);
  sqlite.exec(`
    INSERT INTO payment (id, order_id, check_id, method, provider, amount, status, tendered_at) VALUES
      ('p1','o1','c1','other','bank_transfer',16500,'confirmed','2026-08-13T07:00:00Z'),
      ('p2','o1','c1','other',NULL,100,'confirmed','2026-08-13T07:00:00Z')`);
  const d = await bacaDetail(db, 'o1');
  const peta = Object.fromEntries(d.pembayaran.map((p) => [p.id, p]));
  assert.equal(peta.p1.provider, 'bank_transfer', 'provider hilang -- layar menyebutnya Lainnya');
  assert.equal(peta.p2.provider, null, 'provider yang tidak ada harus null, bukan undefined');
});

// ---------------------------------------------------------------------------
// K-08 (kampanye Hidupkan desain, sub-proyek 2): kolom Item + Metode, penyaring.
// Fixture sengaja bervariasi: tunai, campuran, transfer, QRIS, `other` tanpa
// provider, dua tanggal bisnis, order pembatal tanpa pembayaran.

function fixtureVariatif() {
  const o = (id, no, tgl, jam, extra = {}) => ({
    ...ORDER, id, receipt_number: no, business_date: tgl, occurred_at: jam, sequence: Number(no.slice(-4)), ...extra,
  });
  const l = (order_id, n) => Array.from({ length: n }, (_, i) => ({ id: `${order_id}-l${i}`, order_id }));
  const p = (order_id, method, provider = null, status = 'confirmed') => ({ id: `${order_id}-${method}-${provider}`, order_id, method, provider, status });
  return dbPalsu({
    order: [
      o('t', 'K1-20260813-0001', '2026-08-13', '2026-08-13T01:00:00Z'),
      o('c', 'K1-20260813-0002', '2026-08-13', '2026-08-13T02:00:00Z'),
      o('x', 'K1-20260813-0003', '2026-08-13', '2026-08-13T03:00:00Z'),
      o('q', 'K1-20260812-0009', '2026-08-12', '2026-08-12T04:00:00Z'),
      o('o', 'K1-20260812-0010', '2026-08-12', '2026-08-12T05:00:00Z'),
      o('b', 'K1-20260812-0011', '2026-08-12', '2026-08-12T06:00:00Z', { status: 'voided', total: 0, voided_by_order_id: 't' }),
    ],
    order_line: [...l('t', 1), ...l('c', 3), ...l('x', 2), ...l('q', 2), ...l('o', 1)],
    payment: [
      p('t', 'cash'),
      p('c', 'cash'), p('c', 'qris_static'),
      p('x', 'other', 'bank_transfer'),
      p('q', 'qris_static'),
      p('o', 'other'),
      p('o', 'card_edc', null, 'failed'), // gagal: bukan bagian metode
    ],
  });
}

test('jumlahBaris dan metode per order', async () => {
  const { bacaRiwayat } = await import(MOD);
  const hasil = Object.fromEntries((await bacaRiwayat(fixtureVariatif())).map((r) => [r.id, r]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(hasil).map(([k, v]) => [k, v.jumlahBaris])),
    { t: 1, c: 3, x: 2, q: 2, o: 1, b: 0 }
  );
  assert.deepEqual(hasil.c.metode.map((m) => m.method).sort(), ['cash', 'qris_static']);
  assert.deepEqual(hasil.x.metode, [{ method: 'other', provider: 'bank_transfer' }]);
  assert.deepEqual(hasil.o.metode, [{ method: 'other', provider: null }], 'pembayaran gagal tidak ikut');
  assert.deepEqual(hasil.b.metode, []);
});

test('⛔ dua metode → "Campuran"; transfer → "Transfer"', async () => {
  const { labelMetodeRingkas } = await import(MOD);
  assert.equal(labelMetodeRingkas([{ method: 'cash', provider: null }]), 'Tunai');
  assert.equal(labelMetodeRingkas([{ method: 'cash', provider: null }, { method: 'cash', provider: null }]), 'Tunai');
  assert.equal(labelMetodeRingkas([{ method: 'cash', provider: null }, { method: 'qris_static', provider: null }]), 'Campuran');
  assert.equal(labelMetodeRingkas([{ method: 'other', provider: 'bank_transfer' }]), 'Transfer');
  assert.equal(labelMetodeRingkas([{ method: 'other', provider: null }]), 'Lainnya');
  // Transfer + other tanpa provider = dua metode di mata pemilik.
  assert.equal(labelMetodeRingkas([{ method: 'other', provider: 'bank_transfer' }, { method: 'other', provider: null }]), 'Campuran');
  assert.equal(labelMetodeRingkas([]), '—', 'tanpa pembayaran bukan "Tunai"');
});

test('saring tanggal bisnis hanya di jendela riwayat lokal', async () => {
  const { bacaRiwayat } = await import(MOD);
  const db = fixtureVariatif();
  assert.deepEqual((await bacaRiwayat(db, { saring: { tanggalBisnis: '2026-08-12' } })).map((r) => r.id).sort(), ['b', 'o', 'q']);
  assert.deepEqual((await bacaRiwayat(db, { saring: { tanggalBisnis: '2026-08-13' } })).map((r) => r.id).sort(), ['c', 't', 'x']);
  assert.deepEqual(await bacaRiwayat(db, { saring: { tanggalBisnis: '2026-01-01' } }), [], 'tanggal di luar jendela: kosong, tidak dikarang');
  assert.equal((await bacaRiwayat(db, { saring: {} })).length, 6, 'tanpa saringan = seluruh jendela');
});

test('saring metode', async () => {
  const { bacaRiwayat } = await import(MOD);
  const db = fixtureVariatif();
  const ids = async (metode, tanggalBisnis) =>
    (await bacaRiwayat(db, { saring: { metode, tanggalBisnis } })).map((r) => r.id).sort();
  assert.deepEqual(await ids('cash'), ['c', 't'], 'campuran ikut karena punya bagian tunai');
  assert.deepEqual(await ids('qris_static'), ['c', 'q']);
  assert.deepEqual(await ids('transfer'), ['x'], '"Transfer" opsi sendiri, bukan bagian dari "Lainnya"');
  assert.deepEqual(await ids('other'), ['o'], '"Lainnya" tanpa transfer');
  assert.deepEqual(await ids('card_edc'), [], 'pembayaran gagal tidak dihitung');
  assert.deepEqual(await ids('cash', '2026-08-12'), [], 'kedua saringan digabung (AND)');
  assert.deepEqual(await ids('qris_static', '2026-08-12'), ['q']);
});

test('⛔ status tetap turunan pembatal + status kirim FR-H3, bukan "Selesai" tunggal', async () => {
  const { bacaRiwayat } = await import(MOD);
  const db = dbPalsu({
    order: [
      { ...ORDER, id: 'a', status: 'open', occurred_at: '2026-08-13T01:00:00Z' },
      { ...ORDER, id: 'p', status: 'voided', voided_by_order_id: 'a', occurred_at: '2026-08-13T02:00:00Z', receipt_number: 'K1-20260813-0002' },
    ],
    outbox: [{ entity_id: 'a', status: 'failed' }],
  });
  const h = Object.fromEntries((await bacaRiwayat(db)).map((r) => [r.id, r]));
  assert.equal(h.a.dibatalkan, true);
  assert.equal(h.a.statusSync, 'failed');
  assert.equal(h.p.membatalkan, 'a');
  assert.equal(h.p.statusSync, 'ok');
});
