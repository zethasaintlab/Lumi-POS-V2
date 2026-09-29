'use strict';

// Invariant #4 (CLAUDE.md, ARCH § 3): tidak ada akses database lintas modul.
// Modul `cash` memiliki `cash_drawer_shift` dan `cash_movement`; tabel lain
// hanya lewat `index.ts` modul pemiliknya (audit → `audit/index.ts`
// `recordAuditEvent`, idempotensi/outbox → `sync/index.ts`, identitas →
// `identity/index.ts`). Mencerminkan penjaga `tests/catalog/invariants.test.js`
// (pemindaian sumber), tetapi untuk SQL yang menyentuh tabel modul lain.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const CASH_DIR = path.join(__dirname, '../../apps/server/src/modules/cash');
const DIMILIKI = new Set(['cash_drawer_shift', 'cash_movement']);

/**
 * ⛔ PELANGGARAN LAMA yang DILAPORKAN, bukan diperbaiki (Task 5C fix round 2):
 * `no-sale.ts` membaca `audit_event` langsung untuk menghitung ambang no-sale
 * per shift. Daftar ini hanya boleh MENYUSUT; entri baru = pelanggaran baru.
 */
const PELANGGARAN_LAMA = new Set(['handlers/no-sale.ts::audit_event']);

async function kumpulkan(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await kumpulkan(full)));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const tanpaKomentar = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Semua `<KATA KUNCI SQL> <tabel>` di literal string/template. */
function tabelDisentuh(src) {
  const hasil = [];
  const re = /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"?([a-z_][a-z0-9_]*)"?/g;
  for (const m of tanpaKomentar(src).matchAll(re)) hasil.push(m[2]);
  return hasil;
}

test('modules/cash: SQL hanya menyentuh tabel milik modul cash (invariant #4), kecuali pelanggaran lama yang dilaporkan', async () => {
  const files = await kumpulkan(CASH_DIR);
  assert.ok(files.length >= 5, `hanya ${files.length} berkas di modules/cash — guard ini akan lulus vakum`);
  let sqlTerlihat = 0;
  const baru = [];
  const lama = new Set();
  for (const file of files) {
    const rel = path.relative(CASH_DIR, file).split(path.sep).join('/');
    for (const t of tabelDisentuh(await readFile(file, 'utf8'))) {
      sqlTerlihat += 1;
      if (DIMILIKI.has(t)) continue;
      if (PELANGGARAN_LAMA.has(`${rel}::${t}`)) lama.add(`${rel}::${t}`);
      else baru.push(`${rel}: SQL menyentuh tabel "${t}" milik modul lain`);
    }
  }
  assert.ok(sqlTerlihat > 5, 'tidak ada SQL ditemukan di modules/cash — guard vakum');
  assert.deepEqual(
    baru,
    [],
    'Akses tabel lintas modul dari modules/cash (invariant #4). Lewat index.ts modul pemilik ' +
      '(audit → recordAuditEvent, sync → idempotency/outbox):\n  ' + baru.join('\n  ')
  );
  // Daftar pelanggaran lama tidak boleh menyimpan entri usang.
  assert.deepEqual([...lama].sort(), [...PELANGGARAN_LAMA].sort(), 'PELANGGARAN_LAMA memuat entri yang sudah tidak ada — hapus dari daftar');
});

test('modules/cash: penulisan audit HANYA lewat recordAuditEvent (audit/index.ts), tidak pernah INSERT audit_event mentah', async () => {
  const files = await kumpulkan(CASH_DIR);
  for (const file of files) {
    const src = tanpaKomentar(await readFile(file, 'utf8'));
    assert.equal(/INSERT\s+INTO\s+"?audit_event"?/i.test(src), false, `INSERT audit_event mentah di ${file} — pakai recordAuditEvent`);
    assert.equal(/INSERT\s+INTO\s+"?(idempotency_key|outbox)"?/i.test(src), false, `INSERT idempotency_key/outbox mentah di ${file} — pakai sync/index.ts`);
    assert.equal(/from\s+['"][^'"]*modules\/(?!cash)[a-z]+\/(?!index)/.test(src) || /from\s+['"]\.\.\/\.\.\/(?!index)[a-z-]+\/(?!index)[^'"]+['"]/.test(src), false, `import dalam-dalam lintas modul di ${file}`);
  }
});
