'use strict';

// F4 — antrean cetak `print_job`, di atas SQLite sungguhan.
//
// ⛔ Tabelnya ada sejak F0 dan TIDAK PERNAH DITULIS SIAPA PUN. Akibatnya struk
// yang gagal dicetak hilang seketika, dan satu-satunya jalan memulihkannya
// adalah membangun ulang dokumennya dari database — yang menghasilkan struk
// yang mungkin BERBEDA, karena kode di antaranya berubah. FR-B11 menuntut
// cetak ulang identik dengan cetakan pertama.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/cetak/antrean.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const db = {
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return db;
}

const PROFIL = {
  id: 'p1', nama: 'Generic 58mm', paperWidthMm: 58, charsPerLine: 32,
  codepage: 'cp437', hasCutter: false, initCommand: '1B 40', cutCommand: '',
  drawerCommand: '1B 70 00 19 FA', imageSupport: false,
};

const DOK = { baris: [{ jenis: 'teks', isi: 'KOPI LUMI' }] };

/** Port yang mencatat panggilan dan dapat disuruh gagal. */
function portPalsu({ gagalBerapa = 0 } = {}) {
  let sisa = gagalBerapa;
  const dicetak = [];
  return {
    dicetak,
    async printReceipt(bytes) {
      if (sisa > 0) {
        sisa -= 1;
        throw new Error('kertas habis');
      }
      dicetak.push(bytes.length);
    },
    async openCashDrawer() {},
    async listDevices() {
      return [];
    },
    async testDevice() {
      return true;
    },
    onBarcodeScanned() {
      return () => {};
    },
  };
}

const WAKTU = '2026-08-21T03:00:00.000Z';

// ---------------------------------------------------------------------------

test('cetak yang GAGAL tersimpan beserta dokumennya', async () => {
  const { cetakDanCatat } = await import(MOD);
  const db = dbSungguhan();

  const hasil = await cetakDanCatat(db, portPalsu({ gagalBerapa: 1 }), DOK, PROFIL, {
    id: 'j1',
    orderId: 'o1',
    waktu: WAKTU,
  });
  assert.equal(hasil.status, 'gagal');

  const [job] = await db.getAll('SELECT * FROM print_job');
  assert.equal(job.status, 'failed');
  assert.equal(job.order_id, 'o1');
  assert.equal(job.attempts, 1);
  assert.match(job.last_error, /kertas habis/);
  // ⛔ Dokumen APA ADANYA. Itu seluruh gunanya kolom ini: retry mencetak
  // persis yang gagal, bukan hasil render kedua yang bisa berbeda.
  assert.deepEqual(JSON.parse(job.document), DOK);
});

test('cetak yang berhasil juga tercatat — cetak ulang perlu jejaknya', async () => {
  const { cetakDanCatat } = await import(MOD);
  const db = dbSungguhan();

  const hasil = await cetakDanCatat(db, portPalsu(), DOK, PROFIL, {
    id: 'j1',
    orderId: 'o1',
    waktu: WAKTU,
  });
  assert.equal(hasil.status, 'tercetak');

  const [job] = await db.getAll('SELECT status, last_error FROM print_job');
  assert.equal(job.status, 'printed');
  assert.equal(job.last_error, null);
});

test('⛔ `tanpa_printer` TIDAK menulis satu baris pun', async () => {
  // Merchant tanpa printer adalah kasus SAH, dan perangkatnya akan mencetak
  // nol struk selamanya. Menuliskan setiap penjualan sebagai job `pending` di
  // perangkat seperti itu menghasilkan antrean yang tumbuh tanpa batas dan
  // tidak pernah dapat terkuras — lalu setiap layar melaporkan ribuan "cetak
  // tertunda" yang tidak berarti apa-apa.
  const { cetakDanCatat, jumlahCetakTertunda } = await import(MOD);
  const db = dbSungguhan();

  const hasil = await cetakDanCatat(db, null, DOK, PROFIL, {
    id: 'j1',
    orderId: 'o1',
    waktu: WAKTU,
  });
  assert.equal(hasil.status, 'tanpa_printer');
  assert.deepEqual(await db.getAll('SELECT * FROM print_job'), []);
  assert.equal(await jumlahCetakTertunda(db), 0);
});

test('⛔ profil yang hilang juga `tanpa_printer`, bukan gagal', async () => {
  const { cetakDanCatat } = await import(MOD);
  const db = dbSungguhan();
  const hasil = await cetakDanCatat(db, portPalsu(), DOK, null, {
    id: 'j1',
    orderId: 'o1',
    waktu: WAKTU,
  });
  assert.equal(hasil.status, 'tanpa_printer');
  assert.deepEqual(await db.getAll('SELECT * FROM print_job'), []);
});

test('retry mencetak DOKUMEN YANG TERSIMPAN dan menandainya printed', async () => {
  const { cetakDanCatat, prosesAntreanCetak, jumlahCetakTertunda } = await import(MOD);
  const db = dbSungguhan();

  // Gagal sekali, lalu port yang sehat.
  await cetakDanCatat(db, portPalsu({ gagalBerapa: 1 }), DOK, PROFIL, {
    id: 'j1', orderId: 'o1', waktu: WAKTU,
  });
  assert.equal(await jumlahCetakTertunda(db), 1);

  const port = portPalsu();
  const hasil = await prosesAntreanCetak(db, port, PROFIL);

  assert.deepEqual(hasil, { dicoba: 1, berhasil: 1, gagal: 0 });
  assert.equal(port.dicetak.length, 1, 'byte benar-benar dikirim ke port');
  assert.equal(await jumlahCetakTertunda(db), 0);

  const [job] = await db.getAll('SELECT status, attempts, last_error FROM print_job');
  assert.equal(job.status, 'printed');
  assert.equal(job.attempts, 2);
  assert.equal(job.last_error, null, 'alasan lama dibersihkan saat akhirnya berhasil');
});

test('⛔ retry TANPA printer tidak menaikkan attempts', async () => {
  // Perangkat tanpa printer akan "mencoba" setiap kali layar dibuka. Menaikkan
  // hitungannya berarti job-job itu habis percobaan tanpa pernah menyentuh
  // printer sama sekali — dan struk yang gagal hilang dari antrean karena
  // seseorang membuka layar lima kali.
  const { cetakDanCatat, prosesAntreanCetak } = await import(MOD);
  const db = dbSungguhan();

  await cetakDanCatat(db, portPalsu({ gagalBerapa: 1 }), DOK, PROFIL, {
    id: 'j1', orderId: 'o1', waktu: WAKTU,
  });

  for (let i = 0; i < 10; i += 1) {
    const hasil = await prosesAntreanCetak(db, null, PROFIL);
    assert.deepEqual(hasil, { dicoba: 0, berhasil: 0, gagal: 0 });
  }

  const [job] = await db.getAll('SELECT attempts, status FROM print_job');
  assert.equal(job.attempts, 1, 'hanya percobaan yang benar-benar menyentuh printer dihitung');
  assert.equal(job.status, 'failed');
});

test('⛔ job berhenti dicoba setelah MAKS_PERCOBAAN_CETAK, tapi TETAP tersimpan', async () => {
  // Job yang dicoba tanpa batas akan mencetak struk kemarin saat printer
  // akhirnya menyala — di tengah antrean pelanggan, tanpa ada yang memintanya.
  const { cetakDanCatat, prosesAntreanCetak, jumlahCetakTertunda, MAKS_PERCOBAAN_CETAK } =
    await import(MOD);
  const db = dbSungguhan();

  await cetakDanCatat(db, portPalsu({ gagalBerapa: 1 }), DOK, PROFIL, {
    id: 'j1', orderId: 'o1', waktu: WAKTU,
  });

  // Port yang selalu gagal.
  for (let i = 0; i < MAKS_PERCOBAAN_CETAK + 3; i += 1) {
    await prosesAntreanCetak(db, portPalsu({ gagalBerapa: 99 }), PROFIL);
  }

  const [job] = await db.getAll('SELECT attempts, status FROM print_job');
  assert.equal(job.attempts, MAKS_PERCOBAAN_CETAK, 'berhenti tepat di batas, tidak melewatinya');
  assert.equal(job.status, 'failed');
  assert.equal(await jumlahCetakTertunda(db), 0, 'tidak lagi dicoba otomatis');

  // …tapi barisnya masih ada, dan dokumennya utuh.
  const [utuh] = await db.getAll('SELECT document FROM print_job');
  assert.deepEqual(JSON.parse(utuh.document), DOK);
});

test('dokumen yang rusak tidak dicoba selamanya, dan alasannya disimpan', async () => {
  const { prosesAntreanCetak, MAKS_PERCOBAAN_CETAK } = await import(MOD);
  const db = dbSungguhan();
  await db.execute(
    `INSERT INTO print_job (id, order_id, document, status, attempts, created_at)
     VALUES ('j1', 'o1', 'bukan json', 'failed', 1, ?)`,
    [WAKTU]
  );

  const port = portPalsu();
  const hasil = await prosesAntreanCetak(db, port, PROFIL);

  assert.deepEqual(hasil, { dicoba: 0, berhasil: 0, gagal: 0 });
  assert.equal(port.dicetak.length, 0, 'tidak ada byte yang dikirim untuk dokumen rusak');

  const [job] = await db.getAll('SELECT attempts, last_error FROM print_job');
  assert.equal(job.attempts, MAKS_PERCOBAAN_CETAK);
  assert.match(job.last_error, /tidak dapat dibaca/);
});

test('antrean diproses TERLAMA DULU', async () => {
  const { prosesAntreanCetak } = await import(MOD);
  const db = dbSungguhan();

  for (const [id, waktu] of [
    ['j-baru', '2026-08-21T05:00:00.000Z'],
    ['j-lama', '2026-08-21T01:00:00.000Z'],
    ['j-tengah', '2026-08-21T03:00:00.000Z'],
  ]) {
    await db.execute(
      `INSERT INTO print_job (id, order_id, document, status, attempts, created_at)
       VALUES (?, ?, ?, 'failed', 1, ?)`,
      [id, id, JSON.stringify({ baris: [{ jenis: 'teks', isi: id }] }), waktu]
    );
  }

  const urutan = [];
  const port = {
    async printReceipt(bytes) {
      urutan.push(bytes.length);
    },
    async openCashDrawer() {},
    async listDevices() { return []; },
    async testDevice() { return true; },
    onBarcodeScanned() { return () => {}; },
  };
  await prosesAntreanCetak(db, port, PROFIL);

  const rows = await db.getAll(`SELECT id FROM print_job WHERE status = 'printed' ORDER BY id`);
  assert.equal(rows.length, 3);
  assert.equal(urutan.length, 3, 'ketiganya benar-benar dikirim');
});

test('⛔ satu job gagal tidak menghentikan sisanya', async () => {
  const { prosesAntreanCetak } = await import(MOD);
  const db = dbSungguhan();

  for (const id of ['a', 'b', 'c']) {
    await db.execute(
      `INSERT INTO print_job (id, order_id, document, status, attempts, created_at)
       VALUES (?, ?, ?, 'failed', 1, ?)`,
      [id, id, JSON.stringify(DOK), `2026-08-21T0${id === 'a' ? 1 : id === 'b' ? 2 : 3}:00:00.000Z`]
    );
  }

  const hasil = await prosesAntreanCetak(db, portPalsu({ gagalBerapa: 1 }), PROFIL);
  assert.deepEqual(hasil, { dicoba: 3, berhasil: 2, gagal: 1 });
});
