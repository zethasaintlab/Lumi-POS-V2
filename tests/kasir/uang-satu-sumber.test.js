'use strict';

// ⛔ Penjaga: SATU pemformat uang untuk seluruh aplikasi.
//
// Sampai 25 Agustus 2026, `apps/kasir` punya sebelas salinan
// `Rp ${n.toLocaleString('id-ID')}` — satu per layar, semuanya identik, dan
// semuanya SALAH dengan cara yang sama: nilai negatif dicetak `Rp -20.000`
// (hyphen ASCII, tanda di dalam angkanya) alih-alih `− Rp 20.000` yang
// `CLAUDE.md` tetapkan.
//
// Tidak satu pun dari 494 test kasir merah karenanya, dan itu bukan kebetulan:
// yang salah hanya terlihat pada nilai negatif, dan nilai negatif di layar
// kasir hanya muncul pada selisih tutup kas — satu-satunya tempat yang sudah
// menangani tandanya sendiri.
//
// Berkas ini menahan salinan berikutnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const UANG = '../../packages/domain/src/uang-tampilan.ts';

function berkasSumber(dir, keluar = []) {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasSumber(p, keluar);
    else if (/\.(ts|tsx)$/.test(p)) keluar.push(p);
  }
  return keluar;
}

/**
 * ⛔ `cetak/dokumen.ts` DIKECUALIKAN, dan itu bukan kelalaian.
 *
 * Struk 58 mm hanya 32 kolom, dan renderer memotong serta meratakan kolomnya
 * sendiri terhadap lebar itu. Alasannya sama persis dengan
 * `cetak/metode.ts` yang tidak ikut pindah ke `packages/domain`: yang dicetak
 * di kertas punya batas yang tidak dimiliki layar mana pun.
 */
const DIKECUALIKAN = [join('cetak', 'dokumen.ts')];

test('⛔ TIDAK ADA pemformat rupiah kedua di apps/kasir', async () => {
  const salinan = [];
  for (const f of berkasSumber(join(AKAR, 'apps', 'kasir', 'src'))) {
    if (DIKECUALIKAN.some((d) => f.endsWith(d))) continue;
    const isi = readFileSync(f, 'utf8');
    if (/`Rp \$\{[^}]*\}`/.test(isi) || /Rp \$\{[^}]*toLocaleString/.test(isi)) {
      salinan.push(f.slice(AKAR.length + 1));
    }
  }
  assert.deepEqual(
    salinan,
    [],
    `pemformat rupiah ditulis ulang di: ${salinan.join(', ')}. ` +
      `Pakai \`rupiah\` dari packages/domain/src/uang-tampilan.ts.`
  );
});

test('⛔ TIDAK ADA pemformat rupiah kedua di apps/backoffice maupun apps/hp', async () => {
  const salinan = [];
  for (const app of ['backoffice', 'hp']) {
    for (const f of berkasSumber(join(AKAR, 'apps', app, 'src'))) {
      const isi = readFileSync(f, 'utf8');
      if (/`Rp \$\{[^}]*\}`/.test(isi)) salinan.push(f.slice(AKAR.length + 1));
    }
  }
  assert.deepEqual(salinan, [], `pemformat rupiah ditulis ulang di: ${salinan.join(', ')}`);
});

test('⛔ nilai NEGATIF memakai − (U+2212) di depan Rp, bukan hyphen di dalam angka', async () => {
  // `CLAUDE.md`: `− Rp 8.000`. `toLocaleString('id-ID')` menghasilkan
  // `Rp -8.000` — tanda yang salah, di tempat yang salah.
  const { rupiah } = await import(UANG);
  const t = rupiah(-8000);
  assert.equal(t, '− Rp 8.000');
  assert.ok(!t.includes('-'), `memakai hyphen ASCII: ${t}`);
  assert.equal(rupiah(-8000n), '− Rp 8.000', 'bigint diperlakukan sama');
  assert.equal(rupiah('-8000'), '− Rp 8.000', 'string diperlakukan sama');
});

test('⛔ nilai POSITIF tidak berubah bentuk dari yang lama', async () => {
  // Kontrol negatif: kalau seluruh layar kasir berubah tampilannya, itu bukan
  // perbaikan melainkan regresi yang lolos karena tidak ada yang memeriksanya.
  const { rupiah } = await import(UANG);
  for (const n of [0, 1000, 25000, 1847000, 999999999]) {
    assert.equal(rupiah(n), `Rp ${n.toLocaleString('id-ID')}`, String(n));
  }
});

test('⛔ nilai besar tidak kehilangan presisi lewat Number', async () => {
  // Alasan `rupiah` menerima string: `Number('9007199254740993')` menghasilkan
  // …992, satu rupiah hilang tanpa satu pun error.
  const { rupiah } = await import(UANG);
  assert.equal(rupiah('9007199254740993'), 'Rp 9.007.199.254.740.993');
});
