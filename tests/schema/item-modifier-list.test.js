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

test('⛔ setiap `id TEXT PRIMARY KEY` lokal ditulis NOT NULL', () => {
  // ⛔ SQLite MENERIMA NULL di kolom PRIMARY KEY pada tabel rowid — bug lama
  // yang dipertahankan demi kompatibilitas, dan satu-satunya penawarnya adalah
  // menulis `NOT NULL` sendiri.
  //
  // Akibat kalau lupa: baris ber-id NULL diterima di perangkat sementara
  // PostgreSQL menolaknya, dan selisihnya baru terlihat saat sync — jauh dari
  // tempat dan waktu penyebabnya. PowerSync menuntut kolom `id` pada setiap
  // raw table justru karena identitas baris adalah fondasi replikasinya.
  //
  // `HANDOFF.md` mencatat ini sebagai utang atas ~15 tabel. Saat penjaga ini
  // ditulis (29 Agustus 2026), ke-31 tabelnya SUDAH benar — utangnya lunas
  // tanpa tercatat lunas. Yang tidak ada adalah penjaganya: tabel ke-32 dapat
  // ditambahkan tanpa `NOT NULL` dan tidak ada satu pun test yang merah.
  //
  // `INTEGER PRIMARY KEY` dikecualikan dan itu BUKAN kelonggaran: ia alias
  // rowid, dan SQLite mengisinya otomatis — NULL di sana mustahil.
  const sql = readFileSync(
    resolve(__dirname, '../../db/local/001-initial.sql'),
    'utf8'
  ).replace(/\r\n?/g, '\n');

  const pelanggar = [];
  for (const baris of sql.split('\n')) {
    const bersih = baris.replace(/--.*$/, '');
    if (!/\bTEXT\s+PRIMARY\s+KEY/i.test(bersih)) continue;
    if (/\bNOT\s+NULL\b/i.test(bersih)) continue;
    pelanggar.push(baris.trim());
  }

  assert.deepEqual(
    pelanggar,
    [],
    'kolom PRIMARY KEY tekstual tanpa NOT NULL — SQLite akan menerima id NULL di perangkat:\n' +
      pelanggar.join('\n')
  );

  // Penjaga untuk penjaga: kalau polanya berhenti cocok dengan apa pun, test
  // di atas hijau karena HAMPA. Angka pastinya tidak dipaku — yang dijaga
  // adalah bahwa ia benar-benar melihat tabel.
  const jumlah = sql.split('\n').filter((b) => /\bTEXT\s+PRIMARY\s+KEY/i.test(b.replace(/--.*$/, ''))).length;
  assert.ok(jumlah >= 25, `hanya ${jumlah} kolom PRIMARY KEY tekstual terbaca; pola penjaga rusak`);
});
