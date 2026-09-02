'use strict';

// ⛔ Penjaga anti-salinan-kesembilan: SATU pemformat rupiah, bukan satu per layar.
//
// ## Kenapa penjaga ini ada
//
// `packages/domain/src/uang-tampilan.ts` lahir 24 Agustus 2026 karena
// `apps/hp` menjadi aplikasi ketiga yang memformat uang, dan tiga salinan yang
// menyimpang menghasilkan tiga jawaban berbeda untuk hari yang sama. Sejak itu
// 34 berkas mengimpornya.
//
// Yang penjaga ini cegah adalah salinan BERIKUTNYA, dan ia sudah punya nama:
// `/ds-bundle` mengirim `CartRow` dan `ProductCard`, dan **masing-masing
// membawa pemformat rupiahnya sendiri di atas `number`**. Keduanya calon
// salinan kesembilan dan kesepuluh, dan keduanya akan masuk lewat pintu yang
// terlihat benar — "pakai komponen bundle, jangan tulis sendiri".
//
// ## ⛔ Yang bukan cacat, dan kenapa daftarnya PENDEK
//
// Penjaga yang menandai kode benar akan dimatikan orang berikutnya. Karena itu
// pengecualian di sini disebut satu per satu dengan alasannya, bukan lewat pola
// yang melonggar:
//
// - `packages/domain/src/uang-tampilan.ts` — sumbernya sendiri.
// - `apps/kasir/src/cetak/dokumen.ts` — struk 58 mm hanya 32 kolom, dan
//   `spec-c:378` mencetak `50.000`, BUKAN `Rp 50.000`. Awalan `Rp` di setiap
//   baris memakan tiga karakter dari nama produk, dan nama produk yang
//   terpotong membuat struk tidak dapat dicocokkan dengan pesanan. Format
//   struk karena itu bukan salinan format layar — ia format yang berbeda.
//
// `toLocaleString('id-ID')` atas TANGGAL dan atas JUMLAH BARIS sengaja tidak
// diperiksa: keduanya bukan uang, dan penjaga yang menandainya akan menghitung
// tiga belas kemunculan sah lalu kehilangan kepercayaan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');

/** Direktori yang dipindai. `ds-bundle/` VENDOR — tidak disunting, tidak dinilai. */
const DIPINDAI = ['apps', 'packages'];

const DIKECUALIKAN = new Set([
  'packages/domain/src/uang-tampilan.ts',
  'apps/kasir/src/cetak/dokumen.ts',
]);

/**
 * ⛔ Komentar DIBUANG sebelum pencocokan.
 *
 * Berkas repo ini penuh komentar yang MENYEBUT bentuk yang dilarang — catatan
 * `uang-tampilan.ts` sendiri mengutip `` `Rp ${n.toLocaleString('id-ID')}` ``
 * sebagai bentuk yang dihapus. Penjaga yang membaca komentar menandai
 * dokumentasi tentang cacat sebagai cacat, dan itu persis cara sebuah penjaga
 * dimatikan.
 *
 * Ditulis sebagai mesin keadaan, bukan `replace(/\/\/.*$/gm)`: yang kedua
 * memotong `https://…` di tengah string dan mengubah kode yang dipindai.
 */
function tanpaKomentar(sumber) {
  let keluar = '';
  let i = 0;
  let kutip = null; // "'" | '"' | '`'
  while (i < sumber.length) {
    const c = sumber[i];
    const d = sumber[i + 1];
    if (kutip) {
      if (c === '\\') {
        keluar += c + (d ?? '');
        i += 2;
        continue;
      }
      if (c === kutip) kutip = null;
      keluar += c;
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < sumber.length && sumber[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < sumber.length && !(sumber[i] === '*' && sumber[i + 1] === '/')) i += 1;
      i += 2;
      // Baris baru dipertahankan supaya nomor baris tidak bergeser.
      keluar += '\n';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') kutip = c;
    keluar += c;
    i += 1;
  }
  return keluar;
}

function berkasSumber() {
  const hasil = [];
  const telusuri = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('dist-')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) telusuri(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) hasil.push(p);
    }
  };
  for (const d of DIPINDAI) telusuri(path.join(AKAR, d));
  return hasil;
}

function relatif(p) {
  return path.relative(AKAR, p).split(path.sep).join('/');
}

test('⛔ hanya SATU deklarasi pemformat rupiah di seluruh repo', () => {
  // Nama yang dipakai salinan-salinan sebelumnya: `rupiah`, `formatRupiah`,
  // `uang`, `formatUang`. Deklarasi, bukan pemanggilan — `rupiah(total)` di 34
  // berkas justru bukti penjaga ini bekerja.
  const pola = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(rupiah|formatRupiah|uang|formatUang)\b|(?:const|let)\s+(rupiah|formatRupiah|uang|formatUang)\s*=\s*(?:\(|function\b)/g;

  const temuan = [];
  for (const p of berkasSumber()) {
    const rel = relatif(p);
    if (DIKECUALIKAN.has(rel)) continue;
    const isi = tanpaKomentar(fs.readFileSync(p, 'utf8'));
    for (const m of isi.matchAll(pola)) {
      temuan.push(`${rel}: ${m[1] ?? m[2]}`);
    }
  }

  assert.deepEqual(
    temuan,
    [],
    'Pemformat uang baru ditemukan. Impor `rupiah` dari ' +
      '`packages/domain/src/uang-tampilan.ts` — ia sudah menangani `bigint`, ' +
      '`number`, `string`, nilai negatif (`−`, U+2212), dan nilai HILANG ' +
      '(`Rp —`, yang tidak sama dengan `Rp 0`). Salinan baru akan menyimpang ' +
      'tepat di ketiga tepian itu.\n  ' +
      temuan.join('\n  ')
  );
});

test('⛔ tidak ada string `Rp` yang dirakit tangan', () => {
  // Bentuk yang dicari adalah PERAKITAN, bukan penyebutan: `` `Rp ${x}` `` dan
  // `'Rp ' + x`. Literal `'Rp 20.000'` di pesan galat dan label sengaja
  // dibiarkan — ia teks, bukan pemformat, dan menandainya berarti melarang
  // kalimat menyebut angka.
  const pola = /`(?:−\s*)?Rp\s*\$\{|['"](?:−\s*)?Rp\s*['"]\s*\+/g;

  const temuan = [];
  for (const p of berkasSumber()) {
    const rel = relatif(p);
    if (DIKECUALIKAN.has(rel)) continue;
    const isi = tanpaKomentar(fs.readFileSync(p, 'utf8'));
    for (const m of isi.matchAll(pola)) {
      const baris = isi.slice(0, m.index).split('\n').length;
      temuan.push(`${rel}:${baris}`);
    }
  }

  assert.deepEqual(
    temuan,
    [],
    'String rupiah dirakit tangan. Pakai `rupiah()` dari ' +
      '`packages/domain/src/uang-tampilan.ts`.\n  ' +
      temuan.join('\n  ')
  );
});

test('penjaga ini benar-benar memindai sesuatu', () => {
  // ⛔ Penjaga yang memindai NOL berkas hijau selamanya, dan hijaunya berarti
  // "tidak ada yang diperiksa" — kelas cacat yang sama dengan 18 test
  // `stock_movement` yang menghitung seluruh baris tabel dan mendapat nol.
  const berkas = berkasSumber();
  assert.ok(berkas.length > 200, `hanya ${berkas.length} berkas terpindai`);

  const pemakai = berkas.filter((p) =>
    fs.readFileSync(p, 'utf8').includes('uang-tampilan.ts')
  );
  assert.ok(
    pemakai.length > 25,
    `hanya ${pemakai.length} berkas mengimpor pemformat kanonik — ` +
      'kalau angka ini jatuh, salinan lokal sedang kembali'
  );
});
