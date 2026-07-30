# SQLite Local Schema — stock_snapshot + ix_mv_hlc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `db/local/001-initial.sql` (the SQLite schema shipped to devices) with the `stock_snapshot` table and `ix_mv_hlc` index that `prototypes/01-sqlite-sizing/FINDINGS.md` proved are required before it's usable in production, and add a regression test that locks the exact validated shape in place.

**Architecture:** One SQL file edit (additive — no existing table/index touched) plus one new `node:test` file that loads the schema into an in-memory `node:sqlite` database and asserts the new table/index exist with the exact validated shape. No application code changes; this is schema-only, F0-scoped work.

**Tech Stack:** SQLite (via Node's built-in `node:sqlite` — confirmed available unflagged on the Node 24 installed in this environment), `node:test` + `node:assert/strict` (same test runner already used by `tests/isolation/`).

## Global Constraints

- Uang = `bigint`/`INTEGER` rupiah utuh, tidak pernah float (CLAUDE.md).
- Kuantitas = `INTEGER ×1000` (CLAUDE.md; ERD §13, terbukti lewat pengukuran).
- ID = ULID/UUIDv7 client-generated, disimpan sebagai `TEXT` di SQLite (ERD §13).
- Migrasi SQLite lokal wajib **aditif-saja** setelah pernah dikirim ke device (ARCH §12) — tidak relevan untuk edit ini karena `001-initial.sql` belum pernah dipakai produksi (lihat spec, keputusan #1).
- Bentuk `stock_snapshot`/`ix_mv_hlc` sudah diukur di `prototypes/01-sqlite-sizing/FINDINGS.md` §5 — implementasi harus mengikuti persis, tidak didesain ulang.

---

### Task 1: Tambah `stock_snapshot` + `ix_mv_hlc` ke skema SQLite lokal, dengan test regresi

**Files:**
- Modify: `db/local/001-initial.sql`
- Modify: `db/README.md`
- Create: `tests/sqlite-local/schema.test.js`
- Modify: `package.json` (tambah script `test:sqlite-local`)

**Interfaces:**
- Consumes: `db/local/001-initial.sql` sebagai teks mentah (dibaca lewat `node:fs`, dieksekusi lewat `node:sqlite`'s `DatabaseSync#exec`).
- Produces: tidak ada API baru yang dikonsumsi task lain — ini schema-only, task tunggal, tidak ada task berikutnya di plan ini.

- [ ] **Step 1: Tulis test yang gagal**

  Buat `tests/sqlite-local/schema.test.js`:

  ```js
  'use strict';

  const { test, before, after } = require('node:test');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');

  let db;

  before(() => {
    db = new DatabaseSync(':memory:');
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql'),
      'utf8'
    );
    db.exec(schema);
  });

  after(() => {
    db.close();
  });

  test('stock_snapshot: 5 kolom NOT NULL, PK komposit (tenant_id, outlet_id, variation_id)', () => {
    const cols = db.prepare('PRAGMA table_info(stock_snapshot)').all();
    assert.equal(cols.length, 5, 'stock_snapshot harus punya persis 5 kolom');

    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    for (const name of ['tenant_id', 'outlet_id', 'variation_id', 'balance', 'checkpoint_hlc']) {
      assert.ok(byName[name], `kolom ${name} harus ada`);
      assert.equal(byName[name].notnull, 1, `kolom ${name} harus NOT NULL`);
    }

    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    assert.deepEqual(pkCols, ['tenant_id', 'outlet_id', 'variation_id']);
  });

  test('stock_snapshot: WITHOUT ROWID', () => {
    const row = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_snapshot'`)
      .get();
    assert.ok(row, 'stock_snapshot harus ada di sqlite_master');
    assert.match(row.sql, /WITHOUT ROWID/i);
  });

  test('stock_movement: index ix_mv_hlc pada (tenant_id, outlet_id, hlc)', () => {
    const indexes = db.prepare('PRAGMA index_list(stock_movement)').all();
    const ixMvHlc = indexes.find((i) => i.name === 'ix_mv_hlc');
    assert.ok(ixMvHlc, 'index ix_mv_hlc harus ada di stock_movement');

    const indexCols = db
      .prepare('PRAGMA index_info(ix_mv_hlc)')
      .all()
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name);
    assert.deepEqual(indexCols, ['tenant_id', 'outlet_id', 'hlc']);
  });
  ```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

  Tambahkan dulu script berikut ke `package.json` (di blok `"scripts"`, sejajar dengan `test:isolation`):

  ```json
  "test:sqlite-local": "node --test \"tests/sqlite-local/*.test.js\"",
  ```

  Jalankan:
  ```bash
  npm run test:sqlite-local
  ```
  Expected: **FAIL** — `stock_snapshot` belum ada di `db/local/001-initial.sql`, jadi `db.exec(schema)` akan sukses (tabel lain tetap valid) tapi test pertama gagal dengan error semacam `no such table: stock_snapshot` atau `stock_snapshot harus ada di sqlite_master` gagal.

- [ ] **Step 3: Tambah `stock_snapshot` + `ix_mv_hlc` ke `db/local/001-initial.sql`**

  Di `db/local/001-initial.sql`, tepat setelah blok `CREATE TABLE stock_movement (...)` (baris 95–101 saat ini, sebelum `CREATE TABLE cash_drawer_shift`), sisipkan:

  ```sql
  -- stock_snapshot: cache lokal hasil agregasi stock_movement, dibangun ulang
  -- saat tutup shift (bukan direplikasi naik/turun) — bentuk dan alasan index
  -- ix_mv_hlc di bawah sudah diukur, lihat prototypes/01-sqlite-sizing/FINDINGS.md §5.
  CREATE TABLE stock_snapshot (
    tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
    balance INTEGER NOT NULL, checkpoint_hlc INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, outlet_id, variation_id)
  ) WITHOUT ROWID;
  ```

  Lalu di blok `-- ---------- INDEX (dari ERD §15) ----------`, tepat setelah baris `CREATE INDEX ix_mv_stock ON stock_movement(tenant_id, outlet_id, variation_id, occurred_at);`, sisipkan:

  ```sql
  CREATE INDEX ix_mv_hlc            ON stock_movement(tenant_id, outlet_id, hlc);
  ```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

  ```bash
  npm run test:sqlite-local
  ```
  Expected: **PASS**, ketiga test hijau.

- [ ] **Step 5: Perbarui `db/README.md`**

  Di bagian `## \`local/\` — SQLite di perangkat`, ubah:

  ```markdown
  Yang masih perlu ditambahkan ke `001-initial.sql` sebelum dipakai produksi:
  - Tabel `stock_snapshot` + index `ix_mv_hlc` (lihat ERD § 16 — hasil pengukuran)
  - Tabel `sync_checkpoint`
  ```

  menjadi:

  ```markdown
  Yang masih perlu ditambahkan ke `001-initial.sql` sebelum dipakai produksi:
  - Tabel `sync_checkpoint`
  ```

  (Baris `stock_snapshot`/`ix_mv_hlc` dihapus karena sudah selesai; `sync_checkpoint` tetap — di luar scope task ini.)

- [ ] **Step 6: Commit**

  ```bash
  git add db/local/001-initial.sql db/README.md tests/sqlite-local/schema.test.js package.json
  git commit -m "Lengkapi skema SQLite lokal: stock_snapshot + ix_mv_hlc

Bentuk tabel dan index sudah divalidasi lewat prototypes/01-sqlite-sizing/
FINDINGS.md §5 (snapshot 107x lebih cepat dari agregasi langsung, tapi
index ix_mv_hlc wajib -- tanpanya percepatan hanya 117.7ms -> 111.6ms).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

## Verifikasi akhir (di luar task, jalankan sekali di akhir plan)

- `npm run test:sqlite-local` keluar exit code 0.
- `git status --short` bersih setelah commit.
- Tidak ada regresi pada test lain: `npm run test:isolation` masih 189/189 hijau (schema PostgreSQL tidak disentuh oleh perubahan ini, tapi baik dijalankan sekali untuk memastikan).
