'use strict';

// Penjaga: `ds-bundle/` adalah ARTEFAK VENDOR dan tidak pernah disunting.
//
// ⛔ KENAPA PENJAGA INI ADA: SAYA MELANGGAR ATURANNYA.
//
// 31 Agustus 2026 saya menyunting empat berkas di `ds-bundle/` secara langsung
// — `components.css`, `tokens/colors.css`, dan dua komponen overlay — untuk
// memperbaiki target sentuh, warna kategori, dan Escape yang tidak menutup
// dialog. Aturannya sudah tertulis di `packages/ds/styles.css` ("ds-bundle
// sendiri tidak diubah") dan saya tetap melanggarnya.
//
// Bahayanya bukan kerapian. `ds-bundle` diperbarui dari luar repo ini, dan
// suntingan di tempat hilang TANPA JEJAK pada pembaruan berikutnya. Yang hilang
// adalah perbaikan aksesibilitas — target sentuh 44px, Escape yang menutup
// dialog. Cacat yang kembali diam-diam adalah cacat yang paling mahal ditemukan
// untuk kedua kalinya.
//
// Seluruh perubahan kini hidup di `packages/ds/lumi.css` (CSS) dan
// `packages/ds/overlay.tsx` (perilaku).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');

const AKAR = resolve(__dirname, '../..');

/** Berkas `ds-bundle/` yang berbeda dari basis upstream-nya. */
function bundleTersunting(basis) {
  const keluaran = execFileSync(
    'git',
    ['diff', '--name-only', basis, '--', 'ds-bundle/'],
    { cwd: AKAR, encoding: 'utf8' }
  );
  return keluaran.split('\n').map((b) => b.trim()).filter(Boolean);
}

test('⛔ `ds-bundle/` identik dengan basis upstream — tidak ada suntingan di tempat', () => {
  // `origin/main` adalah basis yang tersedia di CI maupun lokal. Kalau ia tidak
  // ada (checkout dangkal tanpa remote), test ini MELAPOR dilewati alih-alih
  // hijau palsu — penjaga yang diam saat tidak dapat memeriksa adalah penjaga
  // yang menipu.
  let basis = 'origin/main';
  try {
    execFileSync('git', ['rev-parse', '--verify', basis], { cwd: AKAR, stdio: 'ignore' });
  } catch {
    assert.fail(
      'Tidak dapat memverifikasi `ds-bundle/` terhadap origin/main. ' +
        'Penjaga ini tidak boleh hijau tanpa benar-benar membandingkan.'
    );
  }

  const tersunting = bundleTersunting(basis);
  assert.deepEqual(
    tersunting,
    [],
    'Berkas `ds-bundle/` disunting di tempat:\n  ' +
      tersunting.join('\n  ') +
      '\n\n`ds-bundle/` adalah artefak vendor. Pindahkan perubahannya ke ' +
      '`packages/ds/lumi.css` (CSS) atau `packages/ds/overlay.tsx` (perilaku), ' +
      'lalu kembalikan berkas bundle ke keadaan semula.'
  );
});

test('penjaga benar-benar membandingkan — bukan hijau karena tidak melihat apa pun', () => {
  // Kalau `git diff` di atas tidak pernah melihat satu berkas pun, hijau-nya
  // tidak berarti apa-apa. Yang dijaga di sini: `ds-bundle/` memang ada dan
  // memang dilacak git.
  const keluaran = execFileSync('git', ['ls-files', 'ds-bundle/'], {
    cwd: AKAR,
    encoding: 'utf8',
  });
  const jumlah = keluaran.split('\n').filter(Boolean).length;
  assert.ok(jumlah > 20, `hanya ${jumlah} berkas ds-bundle dilacak git; penjaga tidak menjaga apa pun`);
});

test('⛔ override Lumi ADA dan benar-benar dimuat', () => {
  // Mengembalikan `ds-bundle/` tanpa memasang penggantinya akan MENGHAPUS
  // perbaikan aksesibilitasnya diam-diam — hasil akhir yang lebih buruk
  // daripada pelanggaran yang diperbaiki.
  const lumi = join(AKAR, 'packages/ds/lumi.css');
  assert.ok(existsSync(lumi), 'packages/ds/lumi.css hilang');

  const styles = readFileSync(join(AKAR, 'packages/ds/styles.css'), 'utf8');
  assert.match(styles, /@import\s+'\.\/lumi\.css'/, 'lumi.css tidak diimpor styles.css');

  // Dan ia harus diimpor PALING AKHIR: override yang dimuat sebelum bundle
  // kalah oleh bundle pada kekhususan yang sama, tanpa satu pun error.
  const baris = styles.split('\n').map((b) => b.trim()).filter((b) => b.startsWith('@import'));
  assert.match(baris[baris.length - 1], /lumi\.css/, 'lumi.css bukan @import terakhir');

  const isi = readFileSync(lumi, 'utf8');
  for (const wajib of ['--kat-1', '.shell-link', 'btn:active', 'chip-kategori']) {
    assert.ok(isi.includes(wajib), `override kehilangan ${wajib}`);
  }
});

test('⛔ dialog diekspor dari pembungkus, bukan langsung dari bundle', () => {
  // Impor langsung mengembalikan cacat "Escape tidak menutup dialog".
  const index = readFileSync(join(AKAR, 'packages/ds/index.ts'), 'utf8');
  assert.match(index, /export \{ Modal, ConfirmDialog \} from '\.\/overlay\.tsx'/);
  assert.equal(
    /from '\.\.\/\.\.\/ds-bundle\/components\/overlays\//.test(index),
    false,
    'index.ts masih mengekspor dialog langsung dari bundle — Escape akan mati lagi'
  );
});
