'use strict';

// PowerSync menolak raw table tanpa kolom bernama `id`:
//
//   Table item_modifier_list has no id column.
//
// Bukan konvensi kami -- ekstensi core yang menolaknya
// (`InferredTableStructure::read_from_database`), diukur di
// prototypes/04-powersync-raw-tables (T1g). `item_modifier_list` adalah
// katalog: ia HARUS turun ke perangkat, dan tanpa `id` ia tidak dapat
// direplikasi sama sekali -- kasir tidak akan melihat modifier apa pun.
//
// Yang dijaga test ini bukan kolom `id`-nya. Yang dijaga adalah apa yang
// HILANG saat primary key pindah ke sana:
//
//   PRIMARY KEY (item_id, modifier_list_id)
//
// adalah satu-satunya yang menjamin satu item tidak menunjuk modifier list
// yang sama dua kali. Memindahkannya tanpa pengganti menukar satu masalah
// PowerSync dengan satu cacat data -- satu item dengan dua baris "Tingkat
// gula", dan kasir melihat daftar modifier ganda.
//
// `ux_item_modifier_list_pair` adalah penggantinya, dan ia juga yang membuat
// `ON CONFLICT (item_id, modifier_list_id) DO UPDATE` di handler tetap
// valid; tanpanya PostgreSQL menolak klausa itu dan attach-ulang untuk
// mengubah sortOrder patah.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { connectAsOwner } = require('../isolation/helpers/db');

let owner;

before(async () => {
  owner = await connectAsOwner();
});

after(async () => {
  await owner.end();
});

test('item_modifier_list punya kolom id, text NOT NULL', async () => {
  const { rows } = await owner.query(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'item_modifier_list' AND column_name = 'id'`
  );
  assert.equal(rows.length, 1, 'kolom id tidak ditemukan di item_modifier_list');
  assert.equal(rows[0].data_type, 'text');
  assert.equal(rows[0].is_nullable, 'NO', 'id harus NOT NULL -- PowerSync memakainya sebagai kunci baris');
});

test('primary key item_modifier_list adalah (id) saja', async () => {
  const { rows } = await owner.query(
    `SELECT a.attname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'item_modifier_list' AND c.contype = 'p'
      ORDER BY k.ord`
  );
  assert.deepEqual(
    rows.map((r) => r.attname),
    ['id'],
    'primary key harus pindah ke id -- PK komposit tidak diterima PowerSync'
  );
});

test('ux_item_modifier_list_pair menjaga pasangan (item_id, modifier_list_id) tetap unik', async () => {
  const { rows } = await owner.query(
    `SELECT a.attname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'item_modifier_list'
        AND c.contype = 'u'
        AND c.conname = 'ux_item_modifier_list_pair'
      ORDER BY k.ord`
  );
  assert.deepEqual(
    rows.map((r) => r.attname),
    ['item_id', 'modifier_list_id'],
    'constraint unik pengganti PK lama tidak ada -- relasi ganda jadi mungkin'
  );
});

// Yang membuktikan constraint di atas benar-benar MENAHAN, bukan sekadar
// terdaftar di katalog sistem. Test bentuk saja lolos untuk constraint yang
// ada tapi tidak pernah dievaluasi.
test('INSERT pasangan ganda ditolak database, bukan hanya oleh aplikasi', async () => {
  const suffix = `imlid-${Date.now()}`;
  await owner.query('BEGIN');
  try {
    // Kolom NOT NULL tanpa default disebut lengkap. Versi pertama test ini
    // hanya mengirim (id, name) dan gagal atas `plan` -- gagal karena
    // fixture-nya, bukan karena constraint yang diuji. Kegagalan yang salah
    // pada test yang belum hijau terbaca seperti kegagalan yang benar.
    await owner.query(
      `INSERT INTO tenant (id, name, plan, status, deployment_mode)
       VALUES ($1, 'Uji pair unik', 'standard', 'active', 'cloud')`,
      [suffix]
    );
    // `tenant` sendiri RLS-exempt; seluruh tabel di bawahnya tidak. Owner pun
    // tunduk -- FORCE ROW LEVEL SECURITY berlaku untuk pemilik tabel juga
    // (invariant #8), jadi tanpa baris ini INSERT berikutnya gagal atas
    // "unrecognized configuration parameter", bukan atas constraint.
    await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [suffix]);
    await owner.query(`INSERT INTO category (id, tenant_id, name) VALUES ($1, $2, 'Kopi')`, [
      `cat-${suffix}`,
      suffix,
    ]);
    await owner.query(
      `INSERT INTO item (id, tenant_id, name, category_id) VALUES ($1, $2, 'Kopi Susu', $3)`,
      [`itm-${suffix}`, suffix, `cat-${suffix}`]
    );
    await owner.query(
      `INSERT INTO modifier_list (id, tenant_id, name, selection_type) VALUES ($1, $2, 'Gula', 'single')`,
      [`ml-${suffix}`, suffix]
    );

    await owner.query(
      `INSERT INTO item_modifier_list (id, tenant_id, item_id, modifier_list_id, sort_order)
       VALUES ($1, $2, $3, $4, 0)`,
      [`iml-a-${suffix}`, suffix, `itm-${suffix}`, `ml-${suffix}`]
    );

    // id BERBEDA, pasangan SAMA. Inilah yang dulu mustahil karena PK komposit
    // dan kini hanya ditahan constraint unik.
    await assert.rejects(
      owner.query(
        `INSERT INTO item_modifier_list (id, tenant_id, item_id, modifier_list_id, sort_order)
         VALUES ($1, $2, $3, $4, 1)`,
        [`iml-b-${suffix}`, suffix, `itm-${suffix}`, `ml-${suffix}`]
      ),
      (err) => err.constraint === 'ux_item_modifier_list_pair',
      'pasangan ganda tersimpan -- satu item dapat menunjuk modifier list yang sama dua kali'
    );
  } finally {
    await owner.query('ROLLBACK');
  }
});

// ---------------------------------------------------------------------------
// Penjaga: setiap PRIMARY KEY tekstual di skema lokal wajib NOT NULL
// ---------------------------------------------------------------------------

/* ⛔ Predikat per-KOLOM, bukan per-baris.
 *
 * Versi pertama penjaga ini memakai predikat per-BARIS:
 *
 *     if (!/\bTEXT\s+PRIMARY\s+KEY/i.test(bersih)) continue;
 *     if (/\bNOT\s+NULL\b/i.test(bersih)) continue;   // ← celahnya
 *
 * Baris kedua memaafkan SELURUH BARIS bila ada `NOT NULL` di mana pun padanya,
 * dan 16 dari 17 tabel menulis primary key-nya sebaris dengan kolom lain:
 *
 *     id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
 *
 * `NOT NULL` di sana milik `tenant_id` dan `name`. Penjaga membacanya sebagai
 * milik `id`, melaporkan NOL pelanggar, dan memaafkan 17 tabel. `item_image`
 * tertangkap hanya karena `id`-nya kebetulan berdiri sendiri di barisnya —
 * bukan karena penjaganya lebih teliti untuk tabel itu.
 *
 * ⛔ Pemecah kolomnya DIIMPOR, tidak ditulis ulang. `bagiKolom` dan
 * `AWALAN_BATASAN` di `apps/kasir/src/lokal/skema.ts` adalah fungsi yang SAMA
 * yang `batasanNotNull` pakai, dan `batasanNotNull` sudah akurat per kolom
 * sejak lahir. Pemecah kedua akan menyimpang dari yang pertama, dan yang
 * menyimpang menghasilkan penjaga yang tidak sepakat dengan sidik jari skema
 * tentang kolom mana yang `NOT NULL`.
 *
 * Node 24.7 melucuti tipe secara bawaan, jadi `.ts` dapat diimpor dari berkas
 * CJS ini tanpa flag apa pun dan tanpa mengubah `test:schema`.
 */
async function pelanggarPk(sqlText) {
  const { pecahPernyataan, bagiKolom, batasanNotNull, AWALAN_BATASAN } = await import(
    '../../apps/kasir/src/lokal/skema.ts'
  );

  const baris = sqlText.replace(/\r\n?/g, '\n').split('\n');
  const wajib = batasanNotNull(sqlText);
  const hasil = [];

  for (const p of pecahPernyataan(sqlText)) {
    const m = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?\s*\(/i.exec(p);
    if (!m) continue;
    const tabel = m[1];

    for (const bagian of bagiKolom(p.slice(p.indexOf('(') + 1, p.lastIndexOf(')')))) {
      const d = bagian.trim();
      // Batasan tingkat tabel — `PRIMARY KEY (a, b)` — bukan kolom.
      if (d.length === 0 || AWALAN_BATASAN.test(d)) continue;
      if (!/\bPRIMARY\s+KEY\b/i.test(d)) continue;
      // ⛔ `INTEGER PRIMARY KEY` dikecualikan dan itu BUKAN kelonggaran: ia
      // alias rowid, dan SQLite mengisinya otomatis — NULL di sana mustahil.
      if (/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(d)) continue;

      const nama = /^"?([a-z_]+)"?/i.exec(d);
      if (!nama) continue;
      if ((wajib[tabel] ?? []).includes(nama[1])) continue;

      // Nomor baris untuk daftar kerja: baris pertama tabel ini yang menyebut
      // PRIMARY KEY. Ia keperluan LAPORAN, bukan bagian dari penilaian.
      const mulai = baris.findIndex((b) =>
        new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?"?${tabel}"?\\s*\\(`, 'i').test(b)
      );
      const pkBaris = baris.findIndex((b, i) => i >= mulai && /\bPRIMARY\s+KEY\b/i.test(b.replace(/--.*$/, '')));
      hasil.push({ tabel, baris: pkBaris + 1, kolom: nama[1], definisi: d.replace(/\s+/g, ' ') });
    }
  }
  return hasil;
}

const SKEMA = () =>
  readFileSync(resolve(__dirname, '../../db/local/001-initial.sql'), 'utf8').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------------------

test('⛔ penjaga PK membedakan NOT NULL milik PK dari milik kolom TETANGGA', async () => {
  /* ⛔ SENTINEL, dan bentuknya dipilih setelah sentinel lama terbukti tidak
     menguji apa pun. Yang lama menghitung baris yang cocok `TEXT PRIMARY KEY`
     dan menuntut `>= 25`. Ia membuktikan penjaga MEMINDAI sesuatu; ia tidak
     membuktikan penjaga dapat MEMBEDAKAN — dan justru ketidakmampuan
     membedakan itulah cacatnya. Ia hijau sepanjang 17 tabel dimaafkan.

     Yang diuji sekarang kemampuannya: dua definisi buatan dengan bentuk yang
     SAMA PERSIS kecuali pada satu hal yang menentukan. Penjaga yang per-baris
     menilai keduanya bersih; penjaga yang per-kolom memisahkannya. */
  const AMAN = `CREATE TABLE uji_aman (
  id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL
);`;
  const CACAT = `CREATE TABLE uji_tetangga (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL
);`;

  assert.deepEqual(
    await pelanggarPk(AMAN),
    [],
    '`id TEXT NOT NULL PRIMARY KEY` ditandai pelanggar — penjaga menuduh kolom yang benar'
  );

  const cacat = await pelanggarPk(CACAT);
  assert.equal(
    cacat.length,
    1,
    '`id TEXT PRIMARY KEY` dengan NOT NULL milik tetangga TIDAK ditandai — ' +
      'penjaga membaca per baris, bukan per kolom, dan itu tepat celah yang ' +
      `memaafkan 17 tabel. Hasil: ${JSON.stringify(cacat)}`
  );
  assert.equal(cacat[0].tabel, 'uji_tetangga');
  assert.equal(cacat[0].kolom, 'id');

  /* ⛔ Batasan tingkat tabel bukan kolom, dan penjaga yang menghitungnya akan
     menandai `stock_snapshot` sebagai kolom bernama "PRIMARY". */
  assert.deepEqual(
    await pelanggarPk(`CREATE TABLE uji_komposit (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id)
);`),
    [],
    'PRIMARY KEY tingkat tabel dibaca sebagai kolom'
  );

  /* ⛔ `INTEGER PRIMARY KEY` adalah alias rowid — SQLite mengisinya sendiri. */
  assert.deepEqual(
    await pelanggarPk('CREATE TABLE uji_rowid (id INTEGER PRIMARY KEY CHECK (id = 1), nilai TEXT);'),
    [],
    'INTEGER PRIMARY KEY ditandai pelanggar — ia alias rowid, NULL mustahil di sana'
  );
});

test('⛔ setiap PRIMARY KEY tekstual lokal ditulis NOT NULL', async () => {
  // ⛔ SQLite MENERIMA NULL di kolom PRIMARY KEY pada tabel rowid — bug lama
  // yang dipertahankan demi kompatibilitas, dan satu-satunya penawarnya adalah
  // menulis `NOT NULL` sendiri.
  //
  // Akibat kalau lupa: baris ber-id NULL diterima di perangkat sementara
  // PostgreSQL menolaknya, dan selisihnya baru terlihat saat sync — jauh dari
  // tempat dan waktu penyebabnya. PowerSync menuntut kolom `id` pada setiap
  // raw table justru karena identitas baris adalah fondasi replikasinya.
  //
  // ⛔ TEST INI MEMANG MERAH, dan itu hasil yang benar. Penjaganya baru saja
  // berhenti memaafkan 17 tabel; tabelnya sendiri belum diperbaiki, dan
  // memperbaikinya bukan keputusan teknis — SQLite tidak dapat menambahkan
  // `NOT NULL` ke kolom yang sudah ada, jadi setiap perbaikan menuntut rebuild,
  // dan rebuild pada tabel yang memegang data belum tersinkron adalah
  // keputusan produk.
  //
  // Daftar pelanggarnya dicetak lengkap dengan nama tabel dan nomor baris
  // supaya ia menjadi DAFTAR KERJA, bukan sekadar kabar buruk. Jangan
  // menambahkan daftar pengecualian, jangan melonggarkan assertion, dan jangan
  // menandai test ini skip: ketiganya mengembalikan keadaan yang baru saja
  // selesai diperbaiki, dengan biaya yang sama dan tanpa satu pun error.
  const pelanggar = await pelanggarPk(SKEMA());

  assert.deepEqual(
    pelanggar,
    [],
    'kolom PRIMARY KEY tekstual tanpa NOT NULL — SQLite akan menerima id NULL di perangkat.\n' +
      `${pelanggar.length} tabel:\n` +
      pelanggar.map((p) => `  L${p.baris}  ${p.tabel}.${p.kolom}  ${p.definisi}`).join('\n')
  );
});
