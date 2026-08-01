'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
// Invoke the real oxlint entry script (node_modules/oxlint/bin/oxlint) via `node`
// directly, rather than through node_modules/.bin/oxlint(.cmd). On Windows, Node
// refuses to spawn .cmd files with execFileSync unless shell: true is set, and
// shell: true breaks here because this repo's absolute path contains spaces. This
// still runs the real, installed oxlint binary end-to-end -- not a simulation --
// it just resolves the underlying JS entry point instead of the OS-specific shim.
const OXLINT_ENTRY = path.join(REPO_ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint');
const GENERATED_CONFIG = path.join(REPO_ROOT, '.oxlintrc.generated.json');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

before(() => {
  execFileSync('node', [path.join(REPO_ROOT, 'tools', 'generate-oxlint-config.mjs')], {
    cwd: REPO_ROOT,
  });
});

// `--format=unix` di-pin eksplisit, bukan dibiarkan dipilih oxlint sendiri.
// Ditemukan lewat CI run pertama (PR #1): oxlint mendeteksi variabel
// GITHUB_ACTIONS dan otomatis beralih ke format anotasi GitHub
// (`::warning file=...,line=3,...::pesan`), sementara assertion di bawah
// mencocokkan format satu-baris-per-diagnostik (`Bad.jsx:3:25: warning ...`).
// Akibatnya suite ini hijau di mesin developer dan merah di CI -- padahal
// linter-nya sendiri berperilaku identik di keduanya dan menangkap keenam
// pelanggaran yang sama. Test yang meng-assert bentuk output harus menuntut
// bentuk itu, bukan mewarisinya dari lingkungan.
//
// Catatan: format yang dicocokkan assertion ini bernama `unix`, BUKAN
// `default` -- `default` justru format grafis multi-baris dengan kutipan
// sumber dan penanda ^^^^. Dikonfirmasi dengan menjalankan keduanya, bukan
// ditebak dari namanya.
function runOxlint(targets) {
  try {
    const output = execFileSync(
      process.execPath,
      [OXLINT_ENTRY, '--config', GENERATED_CONFIG, '--format=unix', '--deny-warnings', ...targets],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    return { exitCode: 0, output };
  } catch (err) {
    return { exitCode: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('fixture pelanggaran: hex, px, prop tak dikenal, enum salah, deep import -- semua ketangkap', () => {
  const result = runOxlint([path.join(FIXTURES_DIR, 'violations')]);
  assert.equal(result.exitCode, 1, 'oxlint harus exit 1 saat ada pelanggaran (--deny-warnings)');
  assert.match(result.output, /Raw hex color/);
  assert.match(result.output, /Raw px value/);
  assert.match(result.output, /doesn't accept that prop/);
  assert.match(result.output, /variant must be one of/);
  assert.match(result.output, /Import design-system components from 'index\.js'/);
});

test('export...from ke ds-bundle/ (idiom yang dipakai packages/ds/index.ts) juga ketangkap, bukan cuma import biasa', () => {
  const result = runOxlint([path.join(FIXTURES_DIR, 'violations')]);
  assert.equal(result.exitCode, 1, 'oxlint harus exit 1 saat ada pelanggaran (--deny-warnings)');
  // Bad.jsx punya `export { CartRow } from '.../ds-bundle/components/pos/CartRow.jsx'`
  // di baris 3. Sebelum fix, ExportNamedDeclaration tidak divisit sama sekali, jadi
  // baris ini lolos tanpa diagnostik apa pun -- bypass total pada idiom yang sama
  // dipakai packages/ds/index.ts.
  // Format `unix`: `file:baris:kolom: pesan [Warning/rule]` -- nama rule di
  // akhir dalam kurung siku, bukan di tengah seperti format implisit lama.
  // Yang diuji tetap sama persis: baris 3 (export...from) ditandai oleh rule
  // no-restricted-imports, bukan sekadar "ada diagnostik di suatu tempat".
  assert.match(
    result.output,
    /Bad\.jsx:3:\d+: Import design-system components from 'index\.js'[^\n]*\[Warning\/ds-adherence\(no-restricted-imports\)\]/
  );
});

test('fixture patuh: tidak ada pelanggaran sama sekali', () => {
  const result = runOxlint([path.join(FIXTURES_DIR, 'compliant')]);
  assert.equal(result.exitCode, 0, 'oxlint harus exit 0 pada kode yang patuh');
  assert.equal(result.output.trim(), '', 'tidak boleh ada warning sama sekali pada kode patuh');
});

test('kode asli di apps/ dan packages/ bersih', () => {
  const result = runOxlint(['apps', 'packages']);
  assert.equal(result.exitCode, 0, 'apps/kasir + packages/ds (hasil sub-project sebelumnya) harus tetap bersih');
  assert.equal(result.output.trim(), '');
});
