'use strict';

// B-02 — helper daftar transaksi.
//
// ⛔ Seluruh berkas ini berjalan di atas PostgreSQL sungguhan, dan itu bukan
// kemalasan membuat fake. Yang diuji di sini adalah bentuk DATA, bukan
// aritmetika: sebuah penjualan yang dibatalkan menghasilkan DUA baris `order`,
// dan yang aslinya tetap berstatus `open`. Fake yang saya tulis sendiri akan
// memakai asumsi saya sendiri tentang bentuk itu — dan asumsi itulah yang
// justru salah sebelum penyelidikan ini.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const RIWAYAT = '../../apps/server/src/modules/ordering/handlers/riwayat-data.ts';

let owner, app, base, tenant, device, shift;

before(async () => {
  owner = await connectAsOwner();
  app = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await app.end();
});

beforeEach(async () => {
  await app.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(app, { suffix: 'RiwayatTest' });
  tenant = base.tenant;

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await app.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await app.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await app.query('COMMIT');
});

let n = 0;

/** Satu order. `status` sengaja dapat disetel — bentuk datanyalah yang diuji. */
async function order({
  status = 'closed',
  total = 100000,
  tanggal = '2026-08-10',
  createdBy = null,
  voidedBy = null,
  struk = null,
} = {}) {
  const id = crypto.randomUUID();
  n += 1;
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await app.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,total,amount_due,created_by,occurred_at,hlc,voided_by_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,$9,'takeaway',$10,$10,$10,$11,
             ($7::date + time '10:00') AT TIME ZONE 'UTC',$8::bigint,$12)`,
    [id, tenant.id, base.outlet.id, device, shift, struk ?? `K1-${String(tanggal).replace(/-/g, '')}-${n}`,
     tanggal, n, status, total, createdBy ?? base.user.id, voidedBy]
  );
  await app.query('COMMIT');
  return id;
}

async function refund(orderId, amount) {
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await app.query(
    `INSERT INTO refund (id,tenant_id,order_id,amount,reason_code,created_by,approved_by,hlc,method)
     VALUES ($1,$2,$3,$4,'barang_rusak',$5,$6,1,'cash')`,
    [crypto.randomUUID(), tenant.id, orderId, amount, base.user.id, base.user2.id]
  );
  await app.query('COMMIT');
}

const FILTER = {
  from: '2026-08-01', to: '2026-08-31', outletId: null, createdBy: null,
  receiptNumber: null, status: null, limit: 50, cursor: null,
};

async function ambil(ubah = {}) {
  const { ambilRiwayat } = await import(RIWAYAT);
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await ambilRiwayat(app, { ...FILTER, ...ubah });
  await app.query('COMMIT');
  return hasil;
}

// ---------------------------------------------------------------------------
// ⛔ Bentuk data: satu transaksi, dua baris
// ---------------------------------------------------------------------------

test('⛔ penjualan yang dibatalkan menghasilkan SATU baris daftar, bukan dua', async () => {
  // Inti seluruh berkas ini. Order asli tetap `status = open` (AC FR-B7:
  // "tidak ada UPDATE pada order asli"), dan pembatalnya adalah baris `order`
  // TERSENDIRI ber-status `voided` yang nilainya SALINAN.
  //
  // `SELECT * FROM "order"` menampilkan dua baris untuk satu transaksi, dan
  // salah satunya terbaca sebagai pesanan yang belum selesai.
  const asli = await order({ status: 'open', total: 25000 });
  await order({ status: 'voided', total: 25000, voidedBy: asli });

  const { items } = await ambil();
  assert.equal(items.length, 1, 'order pembatal ikut masuk daftar');
  assert.equal(items[0].id, asli);
  assert.equal(items[0].status, 'dibatalkan', 'terbaca sebagai pesanan terbuka');
  assert.notEqual(items[0].dibatalkanOleh, null, 'penunjuk ke pembatal hilang — B-03 tidak dapat drill-down');
});

test('⛔ keranjang terbuka DISEMBUNYIKAN, penjualan yang dibatalkan TIDAK', async () => {
  // Keduanya `status = open` di kolom, dan itu yang membuat penyaringnya
  // berbahaya bila salah: yang satu pesanan yang sedang berjalan, yang lain
  // penjualan yang sudah dibatalkan.
  //
  // Keputusan user 16 Agustus 2026: keranjang terbuka disembunyikan. Yang
  // dibatalkan HARUS tetap muncul — ia transaksi yang benar-benar terjadi, dan
  // ia justru yang dicari saat pelanggan komplain.
  const dibatalkan = await order({ status: 'open', total: 25000 });
  await order({ status: 'voided', total: 25000, voidedBy: dibatalkan });
  const terbuka = await order({ status: 'open', total: 9000 });

  const { items } = await ambil();
  const peta = new Map(items.map((i) => [i.id, i.status]));
  assert.equal(peta.get(dibatalkan), 'dibatalkan', 'yang dibatalkan ikut tersembunyi');
  assert.equal(peta.get(terbuka), undefined, 'keranjang terbuka bocor ke daftar');
});

test('⛔ penyaring status tidak dapat DILEWATI lewat parameter', async () => {
  // Penyaring yang hanya berlaku saat `status === null` dapat ditembus dengan
  // `?status=terbuka`. Nilainya datang dari query string, dan tipe TypeScript
  // tidak menahan apa pun di sana.
  await order({ status: 'open', total: 9000 });
  const { items } = await ambil({ status: 'terbuka' });
  assert.deepEqual(items, [], 'keranjang terbuka tembus lewat parameter status');
});

test('status ditinggalkan juga tersembunyi', async () => {
  await order({ status: 'abandoned', total: 9000 });
  const { items } = await ambil();
  assert.deepEqual(items, []);
});

test('refund menandai transaksi walau kolom status belum berubah', async () => {
  const dibayar = await order({ status: 'closed', total: 50000 });
  await refund(dibayar, 20000);

  const { items } = await ambil();
  assert.equal(items[0].status, 'direfund');
  assert.equal(items[0].nilaiRefund, '20000');
});

test('penjualan biasa berstatus terjual, tanpa refund', async () => {
  await order({ status: 'closed', total: 50000 });
  const { items } = await ambil();
  assert.equal(items[0].status, 'terjual');
  assert.equal(items[0].nilaiRefund, '0');
});

// ---------------------------------------------------------------------------
// Uang
// ---------------------------------------------------------------------------

test('⛔ uang keluar sebagai STRING, presisi utuh di atas 2^53', async () => {
  await order({ status: 'closed', total: '9007199254740993' });
  const { items } = await ambil();
  assert.equal(typeof items[0].total, 'string');
  assert.equal(items[0].total, '9007199254740993');
});

// ---------------------------------------------------------------------------
// Penyaring
// ---------------------------------------------------------------------------

test('pencarian nomor struk menemukan tepat satu transaksi', async () => {
  await order({ status: 'closed' });
  const dicari = await order({ status: 'closed' });
  const { items: semua } = await ambil();
  const nomor = semua.find((i) => i.id === dicari).receiptNumber;

  const { items } = await ambil({ receiptNumber: nomor });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, dicari);
});

test('⛔ pencarian SEBAGIAN — struk luntur, pelanggan mengetik potongannya', async () => {
  // Keputusan user 16 Agustus 2026. Struk termal memudar dan pelanggan
  // mengetik ulang bagian yang masih terbaca.
  const dicari = await order({ status: 'closed' });
  const { items: semua } = await ambil();
  const nomor = semua.find((i) => i.id === dicari).receiptNumber;
  const potongan = nomor.slice(-4);

  const { items } = await ambil({ receiptNumber: potongan });
  assert.ok(
    items.some((i) => i.id === dicari),
    `potongan "${potongan}" tidak menemukan ${nomor}`
  );
});

test('pencarian tidak peka huruf besar-kecil', async () => {
  await order({ status: 'closed' });
  const { items } = await ambil({ receiptNumber: 'k1-' });
  assert.ok(items.length > 0, 'pencarian huruf kecil tidak menemukan struk berawalan K1-');
});

test('⛔ wildcard yang DIKETIK pengguna tidak mengembalikan seluruh riwayat', async () => {
  // Tanpa pelucutan, `%` mencocokkan segalanya — kasir yang mengetiknya
  // menerima seluruh riwayat merchant dalam satu permintaan, dan `_` diam-diam
  // mencocokkan karakter apa pun. Pencarian yang mengembalikan segalanya sama
  // tidak bergunanya dengan yang mengembalikan kosong.
  await order({ status: 'closed' });
  await order({ status: 'closed' });

  for (const jahat of ['%', '_', '%%', 'K1%0001']) {
    const { items } = await ambil({ receiptNumber: jahat });
    assert.deepEqual(items, [], `wildcard "${jahat}" tidak dilucuti`);
  }
});

test('⛔ karakter wildcard dicari HARFIAH, bukan diabaikan', async () => {
  // Test pembeda. Tiga test wildcard di atas hijau juga ketika klausa `ESCAPE`
  // KOSONG — `\_` menuntut backslash harfiah, dan tidak ada nomor struk yang
  // memuatnya, jadi jawabannya nol baris. Nol karena tidak pernah cocok
  // terlihat sama persis dengan nol karena wildcard berhasil dilucuti.
  //
  // Yang membedakan keduanya hanya satu hal: struk yang benar-benar memuat
  // karakter itu HARUS ditemukan. Dengan ESCAPE kosong, test ini merah.
  await order({ status: 'closed', struk: 'K1-20260810-A_B' });
  await order({ status: 'closed', struk: 'K1-20260810-AXB' });

  const { items } = await ambil({ receiptNumber: 'A_B' });
  assert.equal(items.length, 1, 'underscore tidak dicari harfiah — ESCAPE tidak berlaku');
  assert.equal(items[0].receiptNumber, 'K1-20260810-A_B');
});

test('polaCari melucuti backslash lebih dulu', async () => {
  // Membalik urutannya meloloskan `\%` kembali menjadi wildcard.
  const { polaCari } = await import(RIWAYAT);
  assert.equal(polaCari('a%b'), '%a\\%b%');
  assert.equal(polaCari('a_b'), '%a\\_b%');
  assert.equal(polaCari('a\\%b'), '%a\\\\\\%b%');
});

test('⛔ rentang memakai business_date, bukan occurred_at', async () => {
  await order({ status: 'closed', tanggal: '2026-08-10' });
  await order({ status: 'closed', tanggal: '2026-08-20' });

  const { items } = await ambil({ from: '2026-08-01', to: '2026-08-15' });
  assert.equal(items.length, 1);
  assert.equal(items[0].businessDate, '2026-08-10');
});

test('penyaring status berjalan atas status TURUNAN, bukan kolom', async () => {
  const asli = await order({ status: 'open', total: 25000 });
  await order({ status: 'voided', total: 25000, voidedBy: asli });
  await order({ status: 'closed', total: 50000 });

  const { items } = await ambil({ status: 'dibatalkan' });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, asli);
});

test('penyaring kasir memakai created_by', async () => {
  await order({ status: 'closed' });
  await order({ status: 'closed', createdBy: base.user2.id });

  const { items } = await ambil({ createdBy: base.user2.id });
  assert.equal(items.length, 1);
  assert.equal(items[0].createdBy, base.user2.id);
});

// ---------------------------------------------------------------------------
// ⛔ Paginasi
// ---------------------------------------------------------------------------

test('halaman dibatasi limit dan memberi kursor bila masih ada', async () => {
  for (let i = 0; i < 5; i += 1) await order({ status: 'closed' });

  const h1 = await ambil({ limit: 2 });
  assert.equal(h1.items.length, 2);
  assert.notEqual(h1.cursorBerikut, null);

  const h2 = await ambil({ limit: 2, cursor: h1.cursorBerikut });
  assert.equal(h2.items.length, 2);

  const semua = [...h1.items, ...h2.items].map((i) => i.id);
  assert.equal(new Set(semua).size, 4, 'halaman tumpang tindih');
});

test('halaman terakhir tidak memberi kursor', async () => {
  await order({ status: 'closed' });
  await order({ status: 'closed' });
  const h = await ambil({ limit: 5 });
  assert.equal(h.items.length, 2);
  assert.equal(h.cursorBerikut, null, 'kursor pada halaman terakhir membuat UI memuat selamanya');
});

test('⛔ order yang MENYISIP tidak membuat transaksi terlewat', async () => {
  // Alasan keyset dipilih, bukan OFFSET. Perangkat yang tersambung setelah
  // berjam-jam offline mengirim order dengan business_date HISTORIS — ia
  // menyisip di tengah urutan, bukan di ujungnya.
  //
  // Dengan OFFSET, satu sisipan sebelum halaman 2 dibaca menggeser seluruh
  // sisanya satu langkah: satu transaksi terlewat sepenuhnya, tanpa error.
  const dibuat = [];
  for (let i = 0; i < 4; i += 1) dibuat.push(await order({ status: 'closed', tanggal: '2026-08-20' }));

  const h1 = await ambil({ limit: 2 });
  // Sisipan di tanggal yang lebih baru — ia mendarat di ATAS halaman 1.
  await order({ status: 'closed', tanggal: '2026-08-25' });
  const h2 = await ambil({ limit: 2, cursor: h1.cursorBerikut });

  const terlihat = new Set([...h1.items, ...h2.items].map((i) => i.id));
  const terlewat = dibuat.filter((id) => !terlihat.has(id));
  assert.equal(terlewat.length, 0, `transaksi terlewat setelah sisipan: ${terlewat.join(', ')}`);
});

test('urutan menurun: tanggal bisnis, lalu sequence', async () => {
  await order({ status: 'closed', tanggal: '2026-08-10' });
  await order({ status: 'closed', tanggal: '2026-08-20' });
  await order({ status: 'closed', tanggal: '2026-08-15' });

  const { items } = await ambil();
  assert.deepEqual(
    items.map((i) => i.businessDate),
    ['2026-08-20', '2026-08-15', '2026-08-10']
  );
});

// ---------------------------------------------------------------------------
// ⛔ Batas modul dan sumber tunggal
// ---------------------------------------------------------------------------

test('⛔ helper TIDAK menyentuh tabel milik modul lain', async () => {
  // Invariant #4. `payment`, `audit_event`, dan `"user"` milik modul lain, dan
  // laporan-laporan sebelumnya sudah melanggar batas itu di tujuh tempat.
  // Daftar transaksi adalah permukaan yang paling banyak dibaca — ia akan
  // menjadi contoh yang disalin, jadi batasnya ditegakkan di sini.
  const sumber = readFileSync(
    join(__dirname, '..', '..', 'apps', 'server', 'src', 'modules', 'ordering',
         'handlers', 'riwayat-data.ts'),
    'utf8'
  );
  // Hanya pernyataan SQL yang dipindai; prosa boleh menyebut nama tabelnya.
  const sql = sumber.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '').replace(/--.*$/gm, '');
  for (const tabel of ['payment', 'audit_event', '"user"', 'stock_movement', 'cash_drawer_shift']) {
    assert.doesNotMatch(
      sql,
      new RegExp(`(FROM|JOIN)\\s+${tabel.replace(/"/g, '"?')}\\b`, 'i'),
      `helper menyentuh tabel milik modul lain: ${tabel}`
    );
  }
});

test('⛔ status TIDAK dihitung ulang di JavaScript', async () => {
  // Aturannya hidup di SQL karena ia harus dapat disaring dan diurutkan.
  // Salinan di JavaScript akan menyimpang, dan bentuk penyimpangannya buruk:
  // yang satu menentukan baris mana yang MASUK halaman, yang lain menentukan
  // label yang DIBACA manajer.
  const sumber = readFileSync(
    join(__dirname, '..', '..', 'apps', 'server', 'src', 'modules', 'ordering',
         'handlers', 'riwayat-data.ts'),
    'utf8'
  );
  const js = sumber.replace(/`[\s\S]*?`/g, '').replace(/^\s*\*.*$/gm, '');
  for (const label of ['dibatalkan', 'direfund', 'ditinggalkan', 'terbuka']) {
    assert.doesNotMatch(
      js,
      new RegExp(`return\\s+'${label}'`),
      `status '${label}' dihitung ulang di JavaScript`
    );
  }
});

test('isolasi tenant: transaksi tenant lain tidak pernah muncul', async () => {
  await order({ status: 'closed' });
  const lain = await seedTenantBase(app, { suffix: 'RiwayatLain' });

  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  const { ambilRiwayat } = await import(RIWAYAT);
  const hasil = await ambilRiwayat(app, FILTER);
  await app.query('COMMIT');

  assert.deepEqual(hasil.items, []);
});
