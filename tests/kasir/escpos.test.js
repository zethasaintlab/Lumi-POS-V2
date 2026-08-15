'use strict';

// F4 — `ReceiptRenderer`: `render(ReceiptDocument, PrinterProfile) → bytes`
// (`ARCH:199`).
//
// Diuji pada BYTE-nya, bukan pada "tidak melempar". Struk yang salah byte
// tercetak sebagai karakter sampah atau kertas yang tidak terpotong, dan
// keduanya baru terlihat di tangan pelanggan.
//
// ⛔ Tidak ada printer yang terlibat di sini, dan itu memang batasnya:
// `ARCH:398` menuntut "cetak berhasil di ≥5 model" sebagai gate F4, dan itu
// hanya dapat dibuktikan dengan perangkat sungguhan. Yang dibuktikan berkas
// ini adalah byte yang KELUAR — separuh yang dapat diperiksa tanpa hardware.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/cetak/escpos.ts';

/** 58 mm, 32 karakter — kelas printer termurah, yang paling banyak dipakai. */
const PROFIL_58 = {
  id: 'p58',
  nama: 'Generic 58mm',
  paperWidthMm: 58,
  charsPerLine: 32,
  codepage: 'cp437',
  hasCutter: false,
  initCommand: '1B 40',
  cutCommand: '',
  drawerCommand: '1B 70 00 19 FA',
  imageSupport: false,
};

const PROFIL_80 = {
  ...PROFIL_58,
  id: 'p80',
  nama: 'Generic 80mm',
  paperWidthMm: 80,
  charsPerLine: 48,
  hasCutter: true,
  cutCommand: '1D 56 00',
};

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
/**
 * Teks yang BENAR-BENAR tercetak — urutan kontrol dibuang lebih dulu.
 *
 * ⛔ Tanpa ini pengukuran lebar baris salah: `1B 40` (init) adalah ESC dan
 * `@` di latin1, jadi baris pertama terbaca dua karakter lebih panjang
 * daripada yang tercetak. Versi pertama test ini mengukurnya apa adanya dan
 * menuduh renderer.
 */
const ESC = String.fromCharCode(0x1b);
const GS = String.fromCharCode(0x1d);

const teks = (bytes) =>
  Buffer.from(bytes)
    .toString('latin1')
    // ESC p m t1 t2 (laci) — DIBUANG LEBIH DULU: polanya paling panjang, dan
    // pola `ESC` + huruf tunggal di bawah akan memakan awalannya.
    .replace(new RegExp(ESC + 'p[\s\S]{3}', 'g'), '')
    // ESC @ (init) · ESC a n (rata) · ESC E n (tebal)
    .replace(new RegExp(ESC + '@', 'g'), '')
    .replace(new RegExp(ESC + '[aE][\s\S]', 'g'), '')
    // GS V n (potong)
    .replace(new RegExp(GS + 'V[\s\S]', 'g'), '');

test('dokumen kosong tetap menghasilkan perintah init', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [] }, PROFIL_58);
  // `ESC @` — reset. Tanpa ini printer mewarisi keadaan dari struk sebelumnya:
  // bold yang tidak dimatikan membuat seluruh struk berikutnya tebal.
  assert.equal(hex(out).startsWith('1b 40'), true, `tidak diawali ESC @: ${hex(out).slice(0, 20)}`);
});

test('baris teks biasa diakhiri line feed', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: 'Kopi Susu' }] }, PROFIL_58);
  assert.equal(teks(out).includes('Kopi Susu\n'), true);
});

test('⛔ dua kolom: nama kiri, angka KANAN, tepat selebar kertas', async () => {
  // Struk yang angkanya tidak rata kanan tidak dapat dibaca cepat, dan kasir
  // membacanya di bawah tekanan antrean.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos(
    { baris: [{ jenis: 'duaKolom', kiri: 'Kopi Susu', kanan: 'Rp 25.000' }] },
    PROFIL_58
  );
  const line = teks(out).split('\n').find((l) => l.includes('Kopi'));
  assert.equal(line.length, 32, `lebar baris ${line.length}, seharusnya 32`);
  assert.equal(line.endsWith('Rp 25.000'), true);
  assert.equal(line.startsWith('Kopi Susu'), true);
});

test('⛔ dua kolom yang TIDAK MUAT dipotong di kirinya, bukan di angkanya', async () => {
  // Angka adalah bagian yang tidak boleh hilang. Memotong dari kanan
  // menghasilkan "Rp 25.0" — struk yang menyebut harga yang salah.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos(
    {
      baris: [
        { jenis: 'duaKolom', kiri: 'Kopi Susu Gula Aren Ekstra Besar', kanan: 'Rp 125.000' },
      ],
    },
    PROFIL_58
  );
  const line = teks(out).split('\n').find((l) => l.includes('Rp'));
  assert.equal(line.length, 32);
  assert.equal(line.endsWith('Rp 125.000'), true, 'angka ikut terpotong');
});

test('lebar mengikuti PROFIL, bukan konstanta', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos(
    { baris: [{ jenis: 'duaKolom', kiri: 'Total', kanan: 'Rp 1.000' }] },
    PROFIL_80
  );
  const line = teks(out).split('\n').find((l) => l.includes('Total'));
  assert.equal(line.length, 48, 'profil 80mm harus 48 karakter');
});

test('rata tengah memakai perintah printer, bukan spasi', async () => {
  // Spasi yang dihitung sendiri bergeser begitu codepage atau font berubah.
  // `ESC a 1` menyerahkan penengahan ke printer.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: 'LUMI KOPI', rata: 'tengah' }] }, PROFIL_58);
  const h = hex(out);
  assert.equal(h.includes('1b 61 01'), true, 'tidak ada ESC a 1');
  // Dan dikembalikan ke kiri sesudahnya — kalau tidak, seluruh sisa struk
  // ikut tertengah.
  assert.equal(h.includes('1b 61 00'), true, 'perataan tidak dikembalikan ke kiri');
});

test('tebal dinyalakan DAN dimatikan', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: 'TOTAL', tebal: true }] }, PROFIL_58);
  const h = hex(out);
  assert.equal(h.includes('1b 45 01'), true, 'ESC E 1 tidak ada');
  assert.equal(h.includes('1b 45 00'), true, 'tebal tidak dimatikan');
});

test('garis pemisah selebar kertas', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'garis' }] }, PROFIL_58);
  const line = teks(out).split('\n').find((l) => l.includes('-'));
  assert.equal(line.length, 32);
});

test('⛔ profil TANPA cutter tidak mengirim perintah potong', async () => {
  // Perintah potong ke printer yang tidak punya pemotong tercetak sebagai
  // karakter sampah di ujung struk.
  //
  // ⛔ Profilnya sengaja TIDAK KONSISTEN: `hasCutter: false` tetapi
  // `cutCommand` terisi. Itu bentuk data yang benar-benar muncul — baris
  // profil disalin dari model lain lalu flagnya dikoreksi — dan ia satu-satunya
  // bentuk yang menguji GUARD-nya.
  //
  // Versi pertama test ini memakai `PROFIL_58` yang `cutCommand`-nya kosong,
  // jadi tanpa guard pun tidak ada byte yang keluar. Sabotase yang melepas
  // `&& profil.hasCutter` tetap hijau — test menguji string kosong, bukan
  // aturannya.
  const { renderEscPos } = await import(MOD);
  const tidakKonsisten = { ...PROFIL_58, hasCutter: false, cutCommand: '1D 56 00' };
  const out = renderEscPos({ baris: [], potong: true }, tidakKonsisten);
  assert.equal(hex(out).includes('1d 56'), false, 'perintah potong dikirim ke printer tanpa cutter');
});

test('profil dengan cutter mengirim perintah potong di AKHIR', async () => {
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: 'x' }], potong: true }, PROFIL_80);
  const h = hex(out);
  assert.equal(h.includes('1d 56 00'), true);
  assert.equal(h.trim().endsWith('1d 56 00'), true, 'potong harus perintah terakhir');
});

test('⛔ laci dibuka lewat perintah PROFIL, bukan byte yang di-hardcode', async () => {
  // `printer_profile` adalah DATA (`ERD:445`): "menambah model printer =
  // menambah baris". Byte yang di-hardcode di renderer membuat model
  // berikutnya menuntut perubahan kode.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [], bukaLaci: true }, PROFIL_58);
  assert.equal(hex(out).includes('1b 70 00 19 fa'), true);

  const lain = renderEscPos({ baris: [], bukaLaci: true }, { ...PROFIL_58, drawerCommand: '1B 70 01 32 32' });
  assert.equal(hex(lain).includes('1b 70 01 32 32'), true, 'perintah laci tidak dibaca dari profil');
});

test('teks panjang DILIPAT, tidak dipotong', async () => {
  // Nama produk yang terpotong membuat struk tidak dapat dicocokkan dengan
  // pesanan. Baris biasa dilipat; hanya kolom kiri di `duaKolom` yang
  // dipotong, karena di sana angkanya yang harus selamat.
  const { renderEscPos } = await import(MOD);
  const panjang = 'Kopi Susu Gula Aren dengan Es Batu Tambahan dan Sirup';
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: panjang }] }, PROFIL_58);
  const lines = teks(out).split('\n').filter((l) => l.includes('Kopi') || l.includes('Sirup'));
  assert.ok(lines.length >= 2, 'teks panjang tidak dilipat');
  for (const l of lines) assert.ok(l.length <= 32, `baris melebihi lebar: ${l.length}`);
});

test('⛔ karakter di luar codepage tidak menjatuhkan render', async () => {
  // Nama produk dapat memuat karakter apa pun yang diketik merchant. Render
  // yang melempar berarti struk tidak tercetak sama sekali — dan invariant #3
  // menetapkan cetak adalah efek samping yang boleh gagal, bukan yang boleh
  // menjatuhkan alur.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [{ jenis: 'teks', isi: 'Kopi 日本 ☕ Susu' }] }, PROFIL_58);
  assert.ok(out.length > 2, 'render menghasilkan byte');
  assert.equal(teks(out).includes('Kopi'), true);
  assert.equal(teks(out).includes('Susu'), true);
});

test('⛔ tipografi design system diterjemahkan, bukan diganti tanda tanya', async () => {
  // Design system memakai `−` (minus tipografis) dan `×`; codepage
  // printer termal tidak punya keduanya. Mengganti mereka dengan `?`
  // menghasilkan struk berbunyi "2? Kopi Susu" dan "? Rp 8.000" — angka yang
  // tandanya hilang.
  //
  // Yang menerjemahkan adalah RENDERER, bukan pembangun dokumen. `ARCH:204`
  // menempatkan pekerjaan itu di sini: dokumen tetap deskriptif dan setia pada
  // design system; renderer yang tahu batas codepage-nya.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos(
    { baris: [{ jenis: 'teks', isi: '2× Kopi − Rp 8.000…' }] },
    PROFIL_58
  );
  const t = teks(out);
  assert.equal(t.includes('2x Kopi - Rp 8.000...'), true, `dapat: ${JSON.stringify(t)}`);
  assert.equal(t.includes('?'), false, 'masih ada karakter yang tidak diterjemahkan');
});

test('⛔ lebar dihitung SETELAH transliterasi, bukan sebelum', async () => {
  // `…` panjangnya 1 karakter di JavaScript tetapi mencetak 3 (`...`).
  // Kalau lebar kolom dihitung sebelum diterjemahkan, baris yang "pas 32"
  // mencetak 34 — dan printer melipatnya sendiri, memindahkan angka ke baris
  // berikutnya tanpa label apa pun.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos(
    { baris: [{ jenis: 'duaKolom', kiri: 'Kopi…', kanan: 'Rp 25.000' }] },
    PROFIL_58
  );
  const line = teks(out).split('\n')[0];
  assert.equal(line.length, 32, `lebar tercetak ${line.length}, seharusnya 32`);
  assert.equal(line.endsWith('Rp 25.000'), true);
});

test('⛔ hasilnya Uint8Array, bukan string', async () => {
  // Byte yang melewati string JavaScript akan rusak pada nilai > 0x7F: UTF-16
  // mengubahnya, dan printer menerima urutan yang bukan perintah apa pun.
  const { renderEscPos } = await import(MOD);
  const out = renderEscPos({ baris: [] }, PROFIL_58);
  assert.equal(out instanceof Uint8Array, true);
});

test('render bersifat MURNI — dokumen yang sama menghasilkan byte yang sama', async () => {
  // Cetak ulang (FR-B11) harus menghasilkan struk yang identik dengan yang
  // pertama. Renderer yang menyentuh jam atau acak membuat itu mustahil.
  const { renderEscPos } = await import(MOD);
  const dok = {
    baris: [
      { jenis: 'teks', isi: 'LUMI KOPI', rata: 'tengah', tebal: true },
      { jenis: 'garis' },
      { jenis: 'duaKolom', kiri: '2x Kopi Susu', kanan: 'Rp 50.000' },
    ],
    potong: true,
  };
  assert.deepEqual(renderEscPos(dok, PROFIL_80), renderEscPos(dok, PROFIL_80));
});
