'use strict';

// K-15 uji cetak — profil baseline dan dokumen ujinya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const PROFIL = '../../apps/kasir/src/cetak/profil.ts';
const ESCPOS = '../../apps/kasir/src/cetak/escpos.ts';

const ESC = String.fromCharCode(0x1b);
const GS = String.fromCharCode(0x1d);
const bersih = (bytes) =>
  Buffer.from(bytes)
    .toString('latin1')
    // ⛔ `[^]` — "karakter apa pun", dan ia dipakai justru karena tidak butuh
    // backslash. `'[\\s\\S]'` di dalam string literal runtuh menjadi `[sS]`
    // bila satu lapis escape hilang, dan regex yang dihasilkan diam-diam
    // berhenti membuang urutan kontrol: pengukuran lebar lalu salah tanpa
    // satu pun error. Terjadi sekali di berkas ini.
    .replace(new RegExp(ESC + 'p[^]{3}', 'g'), '')
    .replace(new RegExp(ESC + '@', 'g'), '')
    .replace(new RegExp(ESC + '[aE][^]', 'g'), '')
    .replace(new RegExp(GS + 'V[^]', 'g'), '');

test('dua profil baseline: 32 dan 48 karakter', async () => {
  const { PROFIL_BASELINE } = await import(PROFIL);
  assert.equal(PROFIL_BASELINE.length, 2);
  assert.deepEqual(
    PROFIL_BASELINE.map((p) => p.charsPerLine).sort((a, b) => a - b),
    [32, 48]
  );
});

test('⛔ baseline 58mm TIDAK mengklaim punya pemotong', async () => {
  // Printer 58 mm murah umumnya tidak punya, dan perintah potong ke printer
  // tanpa pemotong tercetak sebagai karakter sampah di ujung struk. Baseline
  // harus menebak ke arah yang aman.
  const { PROFIL_58MM } = await import(PROFIL);
  assert.equal(PROFIL_58MM.hasCutter, false);
  assert.equal(PROFIL_58MM.cutCommand, '');
});

test('⛔ penggaris uji cetak PERSIS selebar kertas', async () => {
  // Ia yang membuat lebar profil yang salah terlihat seketika: penggaris yang
  // melipat berarti profilnya bukan untuk printer ini. Uji cetak yang hanya
  // mencetak satu kata lolos di printer yang lebarnya salah dikonfigurasi.
  const { PROFIL_BASELINE, dokumenUjiCetak } = await import(PROFIL);
  const { renderEscPos } = await import(ESCPOS);

  for (const p of PROFIL_BASELINE) {
    const out = bersih(renderEscPos(dokumenUjiCetak(p), p));
    const penggaris = out.split('\n').find((l) => l.startsWith('1234567890'));
    assert.equal(penggaris.length, p.charsPerLine, `${p.nama}: ${penggaris.length}`);
    for (const line of out.split('\n')) {
      assert.ok(line.length <= p.charsPerLine, `${p.nama} melebihi lebar: ${JSON.stringify(line)}`);
    }
  }
});

test('⛔ uji cetak memuat karakter yang HARUS diterjemahkan', async () => {
  // Kalau transliterasi rusak, uji cetak yang isinya hanya ASCII akan lolos
  // sementara struk sungguhan mencetak "2? Kopi Susu".
  const { PROFIL_58MM, dokumenUjiCetak } = await import(PROFIL);
  const { renderEscPos } = await import(ESCPOS);
  const out = bersih(renderEscPos(dokumenUjiCetak(PROFIL_58MM), PROFIL_58MM));

  assert.ok(out.includes('2x Kopi Susu'), 'tanda kali tidak diterjemahkan');
  assert.ok(out.includes('- 9.000'), 'minus tipografis tidak diterjemahkan');
  assert.equal(out.includes('?'), false, 'ada karakter yang gagal diterjemahkan');
});

test('uji cetak menyebut NAMA profil yang dipakai', async () => {
  // Kasir yang mencoba tiga profil harus dapat tahu lembar mana milik mana.
  const { PROFIL_80MM, dokumenUjiCetak } = await import(PROFIL);
  const { renderEscPos } = await import(ESCPOS);
  const out = bersih(renderEscPos(dokumenUjiCetak(PROFIL_80MM), PROFIL_80MM));
  assert.ok(out.includes(PROFIL_80MM.nama));
});
