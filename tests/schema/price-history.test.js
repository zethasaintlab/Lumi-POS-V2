'use strict';

// FR-A7 -- resolusi harga tiga tingkat (spec-a-katalog.md:202-209):
//
//   1. price_history untuk (variation, outlet) dengan effective_from
//      terbesar yang <= waktu transaksi
//   2. bila tidak ada, (variation, outlet = NULL)
//   3. bila tidak ada, item_variation.price
//
// Tabel `price_history` sendiri sudah ada sejak 0004_catalog.sql. Yang TIDAK
// ada adalah index untuk menjalankan tangga itu: seluruh 0004 hanya punya satu
// index (ux_variation_barcode). Tanpa index, setiap resolusi harga -- yang
// terjadi di jalur penjualan, per baris order -- adalah seq scan atas seluruh
// riwayat harga tenant.
//
// Test ini menjaga dua hal yang berbeda:
//   (a) index-nya ADA dengan bentuk yang benar;
//   (b) planner BISA memakainya untuk bentuk query resolusi yang sebenarnya.
// (a) saja tidak cukup: index dengan urutan kolom yang salah tetap "ada" tapi
// tidak pernah terpakai.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner } = require('../isolation/helpers/db');

let owner;

before(async () => {
  owner = await connectAsOwner();
});

after(async () => {
  await owner.end();
});

const INDEX_NAME = 'ix_price_history_resolution';

test(`${INDEX_NAME} ada di price_history`, async () => {
  const { rows } = await owner.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'price_history' AND indexname = $1`,
    [INDEX_NAME]
  );
  assert.equal(rows.length, 1, `${INDEX_NAME} tidak ditemukan di price_history`);
});

test(`${INDEX_NAME} memuat kolom tangga resolusi dengan urutan yang benar`, async () => {
  // Urutan kolom BUKAN selera: equality dulu (tenant_id, variation_id,
  // outlet_id), lalu kolom rentang (effective_from DESC) terakhir. Membalik
  // urutan itu membuat index tidak bisa melayani "effective_from terbesar yang
  // <= waktu transaksi" tanpa memindai ulang.
  const { rows } = await owner.query(
    `SELECT a.attname, ix.indoption[a.attnum - 1] AS opt, a.attnum
       FROM pg_class c
       JOIN pg_index ix ON ix.indexrelid = c.oid
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relname = $1
      ORDER BY a.attnum`,
    [INDEX_NAME]
  );
  assert.deepEqual(
    rows.map((r) => r.attname),
    ['tenant_id', 'variation_id', 'outlet_id', 'effective_from']
  );
  // indoption bit 0 (INDOPTION_DESC) = 1 berarti DESC.
  const effectiveFrom = rows[3];
  assert.equal(Number(effectiveFrom.opt) & 1, 1, 'effective_from harus DESC');
});

// Tangga resolusi ditulis sebagai DUA lookup terpisah, bukan satu predikat
// `outlet_id IS NOT DISTINCT FROM $3`. Alasannya terukur, bukan selera:
// `IS NOT DISTINCT FROM` bukan operator btree-indexable -- ia muncul sebagai
// Filter setelah scan, bukan Index Cond, sehingga seluruh riwayat harga
// variation itu tetap dibaca. `outlet_id = $3` dan `outlet_id IS NULL`
// keduanya indexable, dan masing-masing memetakan persis ke anak tangga 1 dan
// 2 di spec-a-katalog.md:202-209.
const RUNGS = [
  { label: 'anak tangga 1 (override outlet)', predicate: `outlet_id = 'O'` },
  { label: 'anak tangga 2 (default tenant)', predicate: `outlet_id IS NULL` },
];

for (const rung of RUNGS) {
  test(`planner memilih ${INDEX_NAME} untuk ${rung.label}`, async () => {
    // enable_seqscan = off tidak "memaksa" hasil palsu: kalau bentuk index
    // salah, planner tetap tidak akan memakainya -- ia akan jatuh ke index PK
    // atau ke seq scan yang dimahalkan (Disabled: true). Yang diuji di sini
    // adalah APLIKABILITAS index terhadap predikat sebenarnya, bukan biaya
    // relatifnya di tabel kosong.
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL enable_seqscan = off');
      const { rows } = await owner.query(
        `EXPLAIN (FORMAT JSON)
         SELECT price FROM price_history
          WHERE tenant_id = 'T'
            AND variation_id = 'V'
            AND ${rung.predicate}
            AND effective_from <= now()
          ORDER BY effective_from DESC
          LIMIT 1`
      );
      const plan = JSON.stringify(rows[0]['QUERY PLAN']);
      assert.ok(
        plan.includes(INDEX_NAME),
        `plan tidak menyentuh ${INDEX_NAME}:\n${plan}`
      );
      // Index yang dipakai tapi hanya sebagai Filter tidak menyelesaikan apa
      // pun -- yang dicari adalah Index Cond.
      assert.ok(
        plan.includes('Index Cond'),
        `index dipakai tanpa Index Cond (berarti predikat tidak terlayani index):\n${plan}`
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });
}
