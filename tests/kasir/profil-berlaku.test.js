'use strict';

// ⛔ Sebelum `berlaku.ts` ada, profil yang dipakai adalah `p[0]` — baris
// PERTAMA yang query kembalikan, dari query yang tidak punya `ORDER BY`.
//
// Merchant dengan tiga model printer tersinkron mencetak dengan profil yang
// dipilih urutan baris, bukan dengan profil printer yang benar-benar tercolok.
// Gejalanya bukan error: struk 80 mm dipotong di kolom 32, atau perintah potong
// tercetak sebagai karakter sampah di printer tanpa pemotong. Kasir
// menyimpulkan printernya rusak.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/cetak/berlaku.ts';

const profil = (id, nama = id, charsPerLine = 32) => ({
  id,
  nama,
  paperWidthMm: charsPerLine === 32 ? 58 : 80,
  charsPerLine,
  codepage: 'cp437',
  hasCutter: false,
  initCommand: '1B 40',
  cutCommand: '',
  drawerCommand: '',
  imageSupport: false,
});

test('⛔ pilihan perangkat MENANG atas urutan baris', async () => {
  // Inti berkas ini. `epson` ada di urutan ketiga; ia tetap yang berlaku.
  const { profilBerlaku } = await import(MOD);
  const daftar = [profil('xprinter'), profil('baseline-58'), profil('epson', 'Epson', 48)];
  const h = profilBerlaku(daftar, 'epson');
  assert.equal(h.profil.id, 'epson');
  assert.equal(h.sebab, 'dipilih');
});

test('⛔ yang BELUM memilih jatuh ke baseline, bukan ke daftar[0]', async () => {
  // Perangkat yang sudah terpasang sebelum kolom ini ada punya `NULL`, dan
  // seluruhnya sedang mencetak hari ini. Jatuh ke `daftar[0]` mengembalikan
  // tepat cacat yang berkas ini perbaiki, satu lapis lebih dalam.
  const { profilBerlaku, PROFIL_BAWAAN_ID } = await import(MOD);
  const daftar = [profil('xprinter'), profil('baseline-58'), profil('epson')];
  const h = profilBerlaku(daftar, null);
  assert.equal(h.profil.id, PROFIL_BAWAAN_ID);
  assert.equal(h.sebab, 'belum-dipilih');
  assert.equal(profilBerlaku(daftar, '').profil.id, PROFIL_BAWAAN_ID, 'string kosong = belum');
});

test('⛔ pilihan yang profilnya HILANG dibedakan dari belum memilih', async () => {
  // Merchant yang menghapus baris `printer_profile` membuat setiap perangkat
  // yang memilihnya jatuh ke baseline. Kasir yang strukanya tiba-tiba berubah
  // lebar berhak tahu kenapa.
  const { profilBerlaku } = await import(MOD);
  const daftar = [profil('baseline-58'), profil('xprinter')];
  const h = profilBerlaku(daftar, 'epson-yang-dihapus');
  assert.equal(h.sebab, 'pilihan-hilang');
  assert.equal(h.profil.id, 'baseline-58');
});

test('daftar KOSONG menghasilkan null, bukan melempar', async () => {
  // Perangkat yang katalog profilnya belum turun sama sekali. Layar harus
  // dapat mengatakannya, bukan jatuh.
  const { profilBerlaku } = await import(MOD);
  const h = profilBerlaku([], 'apa pun');
  assert.equal(h.profil, null);
  assert.equal(h.sebab, 'tidak-ada-profil');
});

test('baseline yang TIDAK ADA di daftar jatuh ke elemen pertama', async () => {
  // Batas yang dinyatakan: bila merchant menghapus baseline DAN belum memilih,
  // tidak ada jawaban yang benar. Yang penting: tidak melempar, dan tetap
  // dapat mencetak.
  const { profilBerlaku } = await import(MOD);
  const daftar = [profil('xprinter'), profil('epson')];
  assert.equal(profilBerlaku(daftar, null).profil.id, 'xprinter');
});

test('⛔ keempat sebab punya kalimatnya SENDIRI', async () => {
  // Kasir yang melihat profil yang bukan pilihannya harus dapat mengetahui
  // sebabnya, bukan menyimpulkan aplikasinya mengabaikan setelannya.
  const { pesanProfil } = await import(MOD);
  const pesan = ['dipilih', 'pilihan-hilang', 'belum-dipilih', 'tidak-ada-profil'].map((s) =>
    pesanProfil(s, 'Epson TM-T82')
  );
  assert.equal(new Set(pesan).size, 4, pesan.join(' | '));
  for (const p of pesan) assert.ok(typeof p === 'string' && p.trim() !== '');
});

test('⛔ "pilihan-hilang" MEMINTA tindakan, bukan hanya memberi tahu', async () => {
  const { pesanProfil } = await import(MOD);
  assert.match(pesanProfil('pilihan-hilang', 'Baseline'), /pilih ulang/i);
});

test('nama profil yang berlaku DISEBUT di kalimatnya', async () => {
  // "Memakai profil lain" tanpa menyebut yang mana tidak dapat ditindaklanjuti.
  const { pesanProfil } = await import(MOD);
  for (const sebab of ['dipilih', 'pilihan-hilang', 'belum-dipilih']) {
    assert.match(pesanProfil(sebab, 'Epson TM-T82'), /Epson TM-T82/, sebab);
  }
});
