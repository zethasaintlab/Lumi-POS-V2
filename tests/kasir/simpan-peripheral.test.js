'use strict';

// K-15 — menyimpan pilihan profil printer perangkat ini.
//
// ⛔ Diuji di atas SQLite SUNGGUHAN, bukan fake `DbLokal`. Fake tidak
// menegakkan `NOT NULL`, `CHECK`, maupun bentuk SQL apa pun — `ON CONFLICT(id)`
// dan `audit_event.tenant_id = NULL` keduanya hijau di fake dan gagal keras di
// `wa-sqlite`. Yang diuji di sini menyentuh `device_config` DAN `outbox_local`
// dalam satu transaksi, dan keduanya punya kolom wajib.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const SKEMA = readFileSync(join(AKAR, 'db', 'local', '001-initial.sql'), 'utf8');

/** Adapter `DbLokal` tipis di atas `node:sqlite`. */
function buatDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(SKEMA);
  const db = {
    async getAll(teks, params = []) {
      return sql.prepare(teks).all(...params);
    },
    async execute(teks, params = []) {
      sql.prepare(teks).run(...params);
    },
    async transaction(fn) {
      sql.exec('BEGIN');
      try {
        const hasil = await fn(db);
        sql.exec('COMMIT');
        return hasil;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  sql
    .prepare(
      `INSERT INTO device_config (id, device_id, device_code, tenant_id, outlet_id, base_url)
       VALUES (1, 'dev-1', 'K1', 'ten-1', 'out-1', 'http://x')`
    )
    .run();
  return { db, sql };
}

const opsi = (over = {}) => ({
  peripheralIdTersimpan: null,
  profilId: 'epson-tm-t82',
  deviceId: 'dev-1',
  outletId: 'out-1',
  actorId: 'user-1',
  ...over,
});

// ---------------------------------------------------------------------------

test('pilihan tersimpan di device_config DAN masuk antrean', async () => {
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  const hasil = await simpanPeripheralPrinter(db, opsi());

  const konfig = sql.prepare('SELECT printer_profile_id, peripheral_id FROM device_config').get();
  assert.equal(konfig.printer_profile_id, 'epson-tm-t82');
  assert.equal(konfig.peripheral_id, hasil.peripheralId);
  assert.equal(hasil.baru, true);

  const antre = sql.prepare('SELECT * FROM outbox_local').all();
  assert.equal(antre.length, 1);
  assert.equal(antre[0].entity_type, 'peripheral');
  assert.equal(antre[0].entity_id, hasil.peripheralId);
  assert.equal(antre[0].actor_id, 'user-1');
});

test('⛔ peripheralId DIBEKUKAN — penyimpanan kedua tidak membuat printer kedua', async () => {
  // Setiap penyimpanan dengan id BARU menghasilkan baris `peripheral` baru di
  // server, dan merchant yang mengubah profilnya lima kali punya lima printer
  // terdaftar di satu perangkat.
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  const satu = await simpanPeripheralPrinter(db, opsi());
  const dua = await simpanPeripheralPrinter(
    db,
    opsi({ peripheralIdTersimpan: satu.peripheralId, profilId: 'xprinter-58' })
  );

  assert.equal(dua.peripheralId, satu.peripheralId);
  assert.equal(dua.baru, false);
  const entitas = sql.prepare('SELECT DISTINCT entity_id FROM outbox_local').all();
  assert.equal(entitas.length, 1, 'dua penyimpanan menghasilkan dua peripheral');
});

test('⛔ kunci idempotensi BERBEDA per profil, bukan per peripheral saja', async () => {
  // Kunci yang sama untuk profil berbeda membuat server menjawab perubahan
  // KEDUA dari cache: pilihan kedua tidak pernah berlaku, dan tidak ada satu
  // pun error.
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  const satu = await simpanPeripheralPrinter(db, opsi());
  await simpanPeripheralPrinter(
    db,
    opsi({ peripheralIdTersimpan: satu.peripheralId, profilId: 'xprinter-58' })
  );

  const kunci = sql.prepare('SELECT idempotency_key FROM outbox_local ORDER BY created_at').all();
  assert.equal(kunci.length, 2);
  assert.notEqual(kunci[0].idempotency_key, kunci[1].idempotency_key);
});

test('⛔ kunci idempotensi SAMA untuk pilihan yang sama — retry bukan operasi baru', async () => {
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  const satu = await simpanPeripheralPrinter(db, opsi());
  await simpanPeripheralPrinter(db, opsi({ peripheralIdTersimpan: satu.peripheralId }));
  const kunci = sql.prepare('SELECT DISTINCT idempotency_key FROM outbox_local').all();
  assert.equal(kunci.length, 1);
});

test('⛔ SATU transaksi: kegagalan antrean membatalkan pilihannya juga', async () => {
  // Menulis `device_config` lalu mengantre di luar transaksi meninggalkan
  // jendela tempat perangkat memakai profil baru sementara server tidak pernah
  // mendengarnya.
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  // `outbox_local` dibuang: `enqueue` melempar, dan `device_config` harus ikut
  // ter-rollback.
  sql.exec('DROP TABLE outbox_local');

  await assert.rejects(() => simpanPeripheralPrinter(db, opsi()));
  const konfig = sql.prepare('SELECT printer_profile_id FROM device_config').get();
  assert.equal(konfig.printer_profile_id, null, 'pilihan tersimpan tanpa antreannya');
});

test('profil KOSONG ditolak sebelum menyentuh apa pun', async () => {
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  await assert.rejects(() => simpanPeripheralPrinter(db, opsi({ profilId: '  ' })));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM outbox_local').get().n, 0);
});

test('⛔ muatan memuat SELURUH field yang server tuntut', async () => {
  // Muatan yang kekurangan satu field dijawab 400 lalu berhenti
  // `gagal-permanen` di antrean — berjam-jam setelah kasir menutup layarnya.
  const { db, sql } = buatDb();
  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  await simpanPeripheralPrinter(db, opsi());
  const muatan = JSON.parse(sql.prepare('SELECT payload FROM outbox_local').get().payload);
  for (const field of ['id', 'outletId', 'type', 'connection']) {
    assert.ok(muatan[field], `muatan tidak punya ${field}`);
  }
  assert.equal(muatan.type, 'printer');
  assert.equal(muatan.printerProfileId, 'epson-tm-t82');
});

test('⛔ pilihan dibaca kembali; perangkat lama menjawab null, bukan melempar', async () => {
  const { db, sql } = buatDb();
  const { bacaPilihanProfil } = await import('../../apps/kasir/src/cetak/pilihan.ts');
  assert.equal(await bacaPilihanProfil(db), null, 'belum memilih');

  const { simpanPeripheralPrinter } = await import(
    '../../apps/kasir/src/cetak/simpan-peripheral.ts'
  );
  await simpanPeripheralPrinter(db, opsi());
  assert.equal(await bacaPilihanProfil(db), 'epson-tm-t82');

  // Perangkat yang migrasi lokalnya belum jalan: kolomnya belum ada.
  sql.exec('DROP TABLE device_config');
  assert.equal(await bacaPilihanProfil(db), null, 'kegagalan baca menghentikan cetak');
});
