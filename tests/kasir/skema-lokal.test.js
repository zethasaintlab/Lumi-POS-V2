'use strict';

// T2 + T3 -- modul skema lokal, dan penjaga drift terhadap
// `db/local/001-initial.sql`.
//
// Tiga dari sepuluh aturan mengikat di `CLAUDE.md` bagian F2 hidup di sini,
// dan ketiganya gagal secara DIAM kalau tidak dijaga:
//
//   - tabel kami WAJIB raw table (kalau tidak, core membuat VIEW bernama sama
//     di atas `ps_data__<nama>` dan bertabrakan dengan tabel nyata kami);
//   - raw table WAJIB punya kolom `id` (core menolaknya saat boot);
//   - tabel murni lokal TIDAK didaftarkan sama sekali -- `outbox_local` aman
//     justru karena PowerSync tidak tahu ia ada.
//
// Modul yang diuji sengaja tidak mengimpor Vite maupun PowerSync, jadi node
// dapat memuatnya apa adanya. Teks SQL-nya di-INJECT: di browser lewat
// `?raw`, di sini lewat `fs`. Kalau modul itu memuat SQL sendiri, test ini
// tidak akan bisa ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKEMA = '../../apps/kasir/src/lokal/skema.ts';
const BERKAS_SQL = path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

function sql() {
  return fs.readFileSync(BERKAS_SQL, 'utf8');
}

test('T2 pemecah pernyataan menghasilkan DDL yang dapat dijalankan satu per satu', async () => {
  const { pecahPernyataan } = await import(SKEMA);
  const p = pecahPernyataan(sql());

  assert.ok(p.length > 20, `hanya ${p.length} pernyataan`);
  assert.ok(
    p.every((s) => !s.includes('--')),
    'komentar harus sudah dibuang'
  );
  assert.ok(
    p.every((s) => s.trim().length > 0),
    'tidak boleh ada pernyataan kosong'
  );
  // PRAGMA ikut, dan itu disengaja: WAL dan foreign_keys adalah bagian skema.
  assert.ok(p.some((s) => s.startsWith('PRAGMA')));
  assert.ok(p.some((s) => s.startsWith('CREATE UNIQUE INDEX ux_item_modifier_list_pair')));
});

// Ditemukan lewat kegagalan, bukan lewat kehati-hatian: berkas skema ber-CRLF
// di Windows, dan `--.*$` TIDAK PERNAH cocok pada baris berakhiran `\r` karena
// `.` di JavaScript tidak mencocokkan `\r`. Seluruh komentar lolos, dan lima
// tabel -- termasuk `"order"` -- hilang dari hasil parse tanpa satu pun error.
// SQLite tetap menerima DDL-nya, jadi gejalanya hanya muncul di sini.
test('T2 komentar dibuang meski berkas ber-CRLF', async () => {
  const { pecahPernyataan, kolomPerTabel } = await import(SKEMA);
  const crlf = sql().replace(/\r?\n/g, '\r\n');

  assert.ok(
    pecahPernyataan(crlf).every((s) => !s.includes('--')),
    'komentar lolos pada berkas CRLF'
  );
  assert.deepEqual(
    Object.keys(kolomPerTabel(crlf)).sort(),
    Object.keys(kolomPerTabel(sql().replace(/\r\n/g, '\n'))).sort()
  );
});

test('T2 kolom dibaca dari SQL, berurutan, termasuk tabel ber-nama-kunci', async () => {
  const { kolomPerTabel } = await import(SKEMA);
  const k = kolomPerTabel(sql());

  // `order` dan `check` adalah kata kunci SQL dan ditulis dengan tanda kutip.
  // Parser yang melewatkannya akan membuat `put` untuk order kehilangan
  // seluruh kolomnya -- dan penjualan turun kosong tanpa satu pun error.
  assert.ok(k.order, 'tabel "order" tidak terbaca');
  assert.ok(k.check, 'tabel "check" tidak terbaca');

  assert.deepEqual(k.item_modifier_list, ['id', 'item_id', 'modifier_list_id', 'sort_order']);
  assert.equal(k.tax_rate[0], 'id');
  assert.ok(k.tax_rate.includes('rate'));
  // Batasan tabel bukan kolom.
  assert.ok(!k.stock_snapshot.includes('PRIMARY'));
  assert.deepEqual(k.stock_snapshot, [
    'tenant_id',
    'outlet_id',
    'variation_id',
    'balance',
    'checkpoint_hlc',
  ]);
});

// Inilah penjaga drift-nya. Tabel baru di skema lokal harus DIPUTUSKAN:
// direplikasi atau murni lokal. Tidak ada bucket ketiga, dan lupa memutuskan
// berarti test merah -- bukan tabel yang diam-diam tidak pernah turun.
test('T3 setiap tabel di skema lokal terdaftar tepat sekali', async () => {
  const { kolomPerTabel, TABEL_RAW, TABEL_LOKAL_SAJA } = await import(SKEMA);
  const diSql = Object.keys(kolomPerTabel(sql())).sort();
  const didaftarkan = [...TABEL_RAW, ...TABEL_LOKAL_SAJA].sort();

  assert.deepEqual(
    didaftarkan,
    diSql,
    'TABEL_RAW + TABEL_LOKAL_SAJA harus persis sama dengan tabel di db/local/001-initial.sql'
  );
  assert.equal(
    new Set(didaftarkan).size,
    didaftarkan.length,
    'ada tabel yang muncul di kedua daftar'
  );
});

// `CLAUDE.md` F2: "Raw table wajib punya kolom `id`. Bukan konvensi kami; core
// menolaknya (`Table X has no id column.`)." Kegagalannya saat boot -- yaitu
// di tangan kasir, bukan di CI -- kecuali ada test ini.
test('T3 setiap raw table punya kolom id', async () => {
  const { kolomPerTabel, TABEL_RAW } = await import(SKEMA);
  const k = kolomPerTabel(sql());
  for (const t of TABEL_RAW) {
    assert.ok(k[t], `tabel ${t} tidak ada di skema lokal`);
    assert.ok(k[t].includes('id'), `raw table ${t} tidak punya kolom id -- PowerSync menolaknya saat boot`);
  }
});

// Yang menjaga `outbox_local` bukan konfigurasi melainkan KETIDAKTAHUAN
// PowerSync. Mendaftarkannya sebagai raw table berarti membuka jalur naik
// kedua yang diam-diam.
test('T3 tabel murni lokal tidak pernah didaftarkan sebagai raw table', async () => {
  const { TABEL_RAW, TABEL_LOKAL_SAJA } = await import(SKEMA);
  for (const t of ['outbox_local', 'device_config', 'stock_snapshot']) {
    assert.ok(TABEL_LOKAL_SAJA.includes(t), `${t} harus ada di TABEL_LOKAL_SAJA`);
    assert.ok(!TABEL_RAW.includes(t), `${t} TIDAK BOLEH jadi raw table`);
  }
});

test('T2 definisi raw table memuat seluruh kolom dan hanya tabel yang direplikasi', async () => {
  const { kolomPerTabel, buatDefinisiRaw, TABEL_RAW, TABEL_LOKAL_SAJA } = await import(SKEMA);
  const k = kolomPerTabel(sql());
  const def = buatDefinisiRaw(k);

  assert.deepEqual(Object.keys(def).sort(), [...TABEL_RAW].sort());
  for (const t of TABEL_LOKAL_SAJA) {
    assert.equal(def[t], undefined, `${t} tidak boleh punya definisi raw table`);
  }

  for (const t of TABEL_RAW) {
    const d = def[t];
    assert.equal(d.schema.tableName, t);
    // Setiap kolom harus punya satu placeholder; jumlah params harus sama
    // dengan jumlah kolom, kalau tidak SQLite menolaknya saat baris pertama
    // turun -- di perangkat, bukan di sini.
    assert.equal(d.put.params.length, k[t].length, `jumlah params ${t}`);
    assert.equal(d.put.params[0], 'Id', `params pertama ${t} harus Id`);
    assert.equal(d.delete.sql, `DELETE FROM "${t}" WHERE id = ?`);
    assert.deepEqual(d.delete.params, ['Id']);
    for (const kolom of k[t]) {
      assert.ok(d.put.sql.includes(kolom), `kolom ${kolom} hilang dari put ${t}`);
    }
  }
});

// Nama tabel `order` dan `check` adalah kata kunci SQL. `put` tanpa tanda
// kutip menghasilkan syntax error saat baris penjualan PERTAMA turun.
test('T2 nama tabel selalu dikutip di SQL yang dihasilkan', async () => {
  const { kolomPerTabel, buatDefinisiRaw } = await import(SKEMA);
  const def = buatDefinisiRaw(kolomPerTabel(sql()));
  assert.match(def.order.put.sql, /INSERT OR REPLACE INTO "order"/);
  assert.match(def.check.put.sql, /INSERT OR REPLACE INTO "check"/);
});
